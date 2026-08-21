// Prompt builder
// Fetches scene templates from a Google Sheets CSV and builds prompts
// by picking a random template and injecting product descriptions.

const SCENES_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTjHCJEc5XQvvRp46F_aDH0trJc1AAYaW1SZsnKcGI7WFcgBVrgMlWfvnj4MsSU-33xjL-VZE7XRmQk/pub?output=csv';

// ─── CSV cache ───────────────────────────────────────────────────────────────
let cachedScenes = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // refresh every 5 minutes

/**
 * Parse a CSV string into an array of objects keyed by header row.
 * Handles quoted fields with commas and newlines.
 */
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  const chars = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const fields = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inQuotes) {
      if (ch === '"' && chars[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else if (ch === '\n') {
        fields.push(current);
        current = '';
        rows.push([...fields]);
        fields.length = 0;
      } else {
        current += ch;
      }
    }
  }
  if (current || fields.length > 0) {
    fields.push(current);
    rows.push(fields);
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] || '').trim();
    });
    return obj;
  });
}

export async function fetchScenes() {
  if (cachedScenes && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedScenes;
  }

  const res = await fetch(SCENES_CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch scene CSV: ${res.status}`);
  const text = await res.text();
  cachedScenes = parseCSV(text).filter((s) => s.room_name);
  cacheTimestamp = Date.now();

  console.log(`[promptBuilder] Loaded ${cachedScenes.length} scene templates`);
  return cachedScenes;
}

// ─── Accessories ────────────────────────────────────────────────────────────

/**
 * Pick 1–2 random accessories from a flat list.
 * Each entry is a complete sentence appended to the scene description.
 * Returns the joined text, or '' if the list is empty.
 */
function pickAccessories(list) {
  if (!list || list.length === 0) return '';
  const count = 1 + Math.floor(Math.random() * Math.min(2, list.length));
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).join(' ');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Slugify a product title for use in folder names.
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build a short description of a product (e.g. "iron coffee table")
 * from its type and materials — without using the full product title.
 */
function describeProduct(product) {
  const type = product.productType?.toLowerCase() || 'piece';
  const singular = type.replace(/s$/i, '');
  const material = product.materials?.toLowerCase();
  let desc = material
    ? `${material.split(/[\s,/&]+/).filter(Boolean)[0]} ${singular}`
    : singular;
  if (product.dimensions) {
    desc += ` (${product.dimensions})`;
  }
  return desc;
}

function formatItemList(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRODUCT_FIDELITY_INSTRUCTION =
  'Product fidelity (critical): Every featured product must be reproduced exactly as shown in the reference images. ' +
  'Do not alter the color, finish, material, texture, shape, silhouette, scale, or proportions of any product under any circumstances. ' +
  'Do not reinterpret, stylize, or adapt the products to match the scene — the scene must be built around the products as they are.';

/**
 * The scene fields exposed for editing, in prompt order.
 * Exported so the sync endpoint knows which keys map to which sheet columns.
 */
export const SCENE_FIELDS = [
  { key: 'room_type',                   label: 'Room Type',        multiline: false },
  { key: 'room_details',                label: 'Room Details',     multiline: true  },
  { key: 'furniture_types',             label: 'Furniture Types',  multiline: false },
  { key: 'style_tags',                  label: 'Style Tags',       multiline: false },
  { key: 'materials',                   label: 'Materials',        multiline: false },
  { key: 'lighting',                    label: 'Lighting',         multiline: false },
  { key: 'camera',                      label: 'Camera',           multiline: false },
  { key: 'color_grade',                 label: 'Color Grade',      multiline: false },
  { key: 'hero_object_placement_logic', label: 'Placement Logic',  multiline: true  },
  { key: 'negative_styling_rules',      label: 'Avoid',            multiline: true  },
  { key: 'realism_constraints',         label: 'Realism',          multiline: true  },
];

// ─── Prompt assembly ─────────────────────────────────────────────────────────

/**
 * Assemble a prompt string from a scene object and an itemList string.
 *
 * This is the single source of truth for prompt structure.
 * It is mirrored client-side in page.jsx so edits to individual scene
 * fields can re-assemble the prompt live without a round-trip.
 *
 * Keep the two in sync if you change the structure here.
 */
export function assemblePrompt(scene, itemList) {
  const parts = [];
  if (scene.room_type && scene.room_details) {
    let sceneDesc = `${scene.room_type} scene: ${scene.room_details}`;
    if (scene.accessories) {
      sceneDesc += ` ${scene.accessories}`;
    }
    parts.push(sceneDesc);
  }
  parts.push(`Featured products: a ${itemList}.`);
  parts.push(PRODUCT_FIDELITY_INSTRUCTION);
  if (scene.materials)                   parts.push(`Materials: ${scene.materials}.`);
  if (scene.lighting)                    parts.push(`Lighting: ${scene.lighting}.`);
  if (scene.camera)                      parts.push(`Camera: ${scene.camera}.`);
  if (scene.color_grade)                 parts.push(`Color grade: ${scene.color_grade}.`);
  if (scene.hero_object_placement_logic) parts.push(`Placement: ${scene.hero_object_placement_logic}.`);
  if (scene.negative_styling_rules)      parts.push(`Avoid: ${scene.negative_styling_rules}.`);
  if (scene.realism_constraints)         parts.push(`Realism: ${scene.realism_constraints}.`);
  return parts.join('\n\n');
}

/**
 * Bust the scenes cache — call after writing changes back to the sheet
 * so the next generation picks up the updated row.
 */
export function clearScenesCache() {
  cachedScenes = null;
  cacheTimestamp = 0;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Build a scene prompt for a room.
 *
 * Returns { prompt, scene, itemList } where:
 *   prompt   — the assembled prompt string (for Higgsfield)
 *   scene    — the raw scene fields used (rowIndex + all CSV columns),
 *              so the UI can display and edit them individually
 *   itemList — the product description string (e.g. "iron coffee table and ceramic vase"),
 *              needed for client-side prompt re-assembly after field edits
 *
 * @param {Object}   room            - { style, combinationName, products }
 * @param {Object}   overrides       - optional { lighting, camera, colorGrade }
 * @param {string[]} accessoriesList - flat list of accessory sentences from config
 */
export async function buildPrompt(room, overrides = {}, accessoriesList = []) {
  const { products } = room;

  const items = products.map((p) => describeProduct(p));
  const itemList = formatItemList(items);

  let scenes;
  try {
    scenes = await fetchScenes();
  } catch (err) {
    console.warn('[promptBuilder] CSV fetch failed, using fallback:', err.message);
    const fallback =
      `A room scene featuring a ${itemList}, styled for professional interior photography. ` +
      `The scene should feel intentional and balanced with natural lighting and warm tones.\n\n` +
      PRODUCT_FIDELITY_INSTRUCTION;
    return { prompt: fallback, scene: null, itemList };
  }

  let rowIndex = overrides.roomName
    ? scenes.findIndex((s) => s.room_name === overrides.roomName)
    : -1;

  // Fantasy mode: prefer rows where column K (styles) contains "fantasy"
  if (rowIndex === -1 && overrides.mode === 'fantasy') {
    const fantasyRows = scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => (s.styles || '').toLowerCase().includes('fantasy'));
    if (fantasyRows.length > 0) {
      const pick = fantasyRows[Math.floor(Math.random() * fantasyRows.length)];
      rowIndex = pick.i;
    }
  }

  if (rowIndex === -1) rowIndex = Math.floor(Math.random() * scenes.length);
  const raw = scenes[rowIndex];

  // Pick random accessories from the flat list
  const accessories = pickAccessories(accessoriesList);

  // Merge filter overrides on top of the raw scene values
  const scene = {
    rowIndex,
    room_type:                   raw.rooms,
    room_details:                raw.room_details,
    furniture_types:             raw.furniture_types,
    style_tags:                  raw.styles,
    materials:                   raw.materials,
    lighting:                    overrides.lighting   || raw.lighting,
    camera:                      overrides.camera     || raw.camera,
    color_grade:                 overrides.colorGrade || raw.color_grade,
    hero_object_placement_logic: raw.hero_object_placement_logic,
    negative_styling_rules:      raw.negative_styling_rules,
    realism_constraints:         raw.realism_constraints,
    accessories,
  };

  return { prompt: assemblePrompt(scene, itemList), scene, itemList };
}
