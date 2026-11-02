'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { parseHashtags, dedupeHashtags } from '../lib/hashtags.js';
import { STYLE_NAMES } from '../lib/styleProfiles.js';

// ─── Style badge colors ───────────────────────────────────────────────────────
const STYLE_COLORS = {
  Coastal:          'bg-sky-100 text-sky-800',
  Glam:             'bg-purple-100 text-purple-800',
  'Organic Modern': 'bg-amber-100 text-amber-800',
  'Art Deco':       'bg-yellow-100 text-yellow-800',
  Farmhouse:        'bg-green-100 text-green-800',
  'French Country': 'bg-pink-100 text-pink-800',
  Industrial:       'bg-zinc-200 text-zinc-800',
  Modern:           'bg-blue-100 text-blue-800',
  Rustic:           'bg-orange-100 text-orange-800',
  Traditional:      'bg-red-100 text-red-800',
  Transitional:     'bg-teal-100 text-teal-800',
};

function badgeClass(style) {
  return STYLE_COLORS[style] ?? 'bg-stone-200 text-stone-700';
}

// ─── Scene field definitions ─────────────────────────────────────────────────
// Keep in sync with SCENE_FIELDS in lib/promptBuilder.js
const SCENE_FIELDS = [
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

// ─── Client-side prompt assembly ─────────────────────────────────────────────
// Mirrors assemblePrompt() in lib/promptBuilder.js.
// When a scene field is edited, this rebuilds the prompt textarea live.
// Keep in sync with the server-side version if you change the structure.
const PRODUCT_FIDELITY_INSTRUCTION =
  'Product fidelity (critical): Every featured product must be reproduced exactly as shown in the reference images. ' +
  'Do not alter the color, finish, material, texture, shape, silhouette, scale, or proportions of any product under any circumstances. ' +
  'Do not reinterpret, stylize, or adapt the products to match the scene — the scene must be built around the products as they are. ' +
  'Dimensional accuracy: When dimensions are given (e.g. 10W x 10D x 22H), the rendered product must match those proportions exactly — ' +
  'a narrow, delicate table must stay narrow and delicate, not become wider, chunkier, or more substantial. ' +
  'Preserve the exact thickness of table tops, the slenderness of legs and bases, and the overall visual weight of each piece.';

function assemblePromptFromScene(scene, itemList) {
  const parts = [];
  if (scene.room_type && scene.room_details) {
    let sceneDesc = `${scene.room_type} scene: ${scene.room_details}`;
    if (scene.accessories) {
      sceneDesc += ` ${scene.accessories}`;
    }
    parts.push(sceneDesc);
  }
  if (scene.design_style) {
    parts.push(
      `Design style: ${scene.design_style}. Render the architecture, finishes, decor, and accessories in ${scene.design_style} style; ` +
      `where the scene description points to a different style, adapt it to ${scene.design_style} while keeping the room type and layout.`
    );
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

// ─── Client-side product description helpers ──────────────────────────────────
// Mirrors describeProduct / formatItemList in lib/promptBuilder.js.
// Used to rebuild the item list when the user toggles products on/off.
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

function buildItemList(products, selectedIds) {
  const selected = products.filter((p) => selectedIds.has(p.id));
  if (selected.length === 0) return '';
  const items = selected.map(describeProduct);
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ─── Higgsfield generation queue ───────────────────────────────────────────────
// Mirrors the server's 2-concurrent limit so extra clicks wait in line (and can be
// cancelled) instead of all hitting /api/generate at once.
const MAX_ACTIVE_GENERATIONS = 2;
let activeGenerations = 0;
const generationQueue = [];

function pumpGenerationQueue() {
  while (activeGenerations < MAX_ACTIVE_GENERATIONS && generationQueue.length) {
    const job = generationQueue.shift();
    activeGenerations++;
    job.onStart?.();
    job.task()
      .then(job.resolve, job.reject)
      .finally(() => { activeGenerations--; pumpGenerationQueue(); });
  }
}

/** Queue an async generation task. Returns { promise, cancel }; cancel only works while still queued. */
function queueGeneration(task, onStart) {
  let job;
  const promise = new Promise((resolve, reject) => { job = { task, onStart, resolve, reject }; });
  generationQueue.push(job);
  pumpGenerationQueue();
  const cancel = () => {
    const idx = generationQueue.indexOf(job);
    if (idx === -1) return;
    generationQueue.splice(idx, 1);
    job.reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
  };
  return { promise, cancel };
}

const IMAGE_FORMATS = [
  { aspect: '1:1', label: 'Square', hint: 'Product gallery, Instagram' },
  { aspect: '2:3', label: 'Pinterest', hint: 'Standard pin' },
  { aspect: '4:5', label: 'Portrait', hint: 'Instagram feed, store' },
  { aspect: '9:16', label: 'Reel', hint: 'Reels, Stories, TikTok' },
];

const PIN_TITLE_MAX = 100;

// Appended to the prompt for a Pinterest 2:3 render when exactly one product is featured
function singleProductPinFraming(productName) {
  return 'FINAL FRAMING (overrides any earlier camera or room description):\n' +
    `Crop the scene to the ${productName} only.\n` +
    'Product fills 50 to 70 percent of frame height, fully visible.\n' +
    'Keep only the wall and floor directly behind it\n' +
    'and at most one supporting object.\n' +
    'Treat every other furniture piece above as off camera.\n' +
    '2:3 vertical. No wide shot.';
}

// Overlay looks, rotated so a batch doesn't repeat one template (pin guide section 6)
const OVERLAY_STYLES = [
  'Typography: a high-contrast editorial serif (Didot or Canela style), light weight, centered, two or three lines, over the calmest area in the top third (plain wall, sky, ceiling, or soft shadow).',
  'Typography: a light, wide-tracked geometric sans, left aligned in the upper left corner, two lines, generous letter spacing, like a design magazine section opener.',
  'Typography: a large italic serif in a refined display cut, right aligned in the upper right area, set over a plain wall, three short lines with tight leading.',
  'Typography: a medium-weight modern grotesk stacked in three or four short lines down the upper left side, tight leading, set into the wall or window area like gallery signage.',
];

/** Index of an overlay style that differs from the last one used (remembered in localStorage). */
function nextOverlayStyle() {
  let last = -1;
  try { last = Number(localStorage.getItem('pinOverlayStyle') ?? -1); } catch {}
  const options = OVERLAY_STYLES.map((_, i) => i).filter((i) => i !== last);
  const pick = options[Math.floor(Math.random() * options.length)];
  try { localStorage.setItem('pinOverlayStyle', String(pick)); } catch {}
  return pick;
}

// Appended to the prompt when the card's "Text overlay" box is checked
function textOverlayInstructions(headline, styleIndex = 0) {
  return 'TEXT OVERLAY (render this text on the image, styled like a luxury interiors magazine cover):\n' +
    `Headline, spelled exactly, nothing added or removed: "${headline}"\n` +
    'The photo stays full-bleed, edge to edge. Set the text directly on the photo, inside the scene. Compose the shot with negative space where the text sits so it has room.\n' +
    `${OVERLAY_STYLES[styleIndex] ?? OVERLAY_STYLES[0]}\n` +
    'Medium or light weight, not heavy or bold. Sentence case, as written above.\n' +
    'Color: soft white or warm ivory over a darker area, or deep charcoal over a light area, picked from the scene\'s palette. ' +
    'At most a faint, natural shadow or subtle gradient in the photo itself for legibility.\n' +
    'Large enough to read on a phone at a glance, but elegant, not shouting.\n' +
    'NEVER: white or colored bars, banners, header strips, boxes, frames, borders, letterboxing, or blank margins around the photo. ' +
    'No heavy black Arial/Helvetica-style type, no outlines, no drop-shadow glow.\n' +
    'Keep every letter out of the bottom 20 percent of the frame, where Pinterest\'s buttons sit.\n' +
    'Do not cover the featured products. No other words, logos, or watermarks anywhere in the image.';
}

const PIN_DESCRIPTION_MAX = 500;
const PIN_ALT_MAX = 500;

// ─── Pinterest mode icon ──────────────────────────────────────────────────────
function PinterestIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
    </svg>
  );
}

// ─── RoomCard ─────────────────────────────────────────────────────────────────
function RoomCard({ room, mode, combinationNames = [], accessoriesList = [], featuredProductHandles = [], pinterestConnected = false, pinterestBoard = null, pinterestBoards = [], onPinterestAuthError, onPinSavedForLater, pinLog = () => {} }) {
  const [prompt, setPrompt] = useState(room.prompt);
  const [scene, setScene] = useState(room.scene);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [allScenes, setAllScenes] = useState(null);
  const [products, setProducts] = useState(room.products);
  const [combinationName, setCombinationName] = useState(room.combinationName);
  const [reshuffling, setReshuffling] = useState(false);
  const [comboPickerOpen, setComboPickerOpen] = useState(false);
  const [accessoryPickerOpen, setAccessoryPickerOpen] = useState(false);
  const [accessorySelection, setAccessorySelection] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // 'ok' | { error: string }
  // Per-slot alternative index: -1 = original product, 0+ = index into alternatives array
  const [activeAlts, setActiveAlts] = useState(() => new Map());
  const [selectedIds, setSelectedIds] = useState(() => new Set(room.products.map((p) => p.id)));

  // Derive the currently-displayed product per slot
  const activeProducts = products.map((original, i) => {
    const altIdx = activeAlts.get(i) ?? -1;
    if (altIdx < 0 || !original.alternatives?.length) return original;
    return original.alternatives[altIdx] || original;
  });

  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [genError, setGenError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishedHandle, setPublishedHandle] = useState(null); // room handle from Shopify publish
  const [publishedDescription, setPublishedDescription] = useState(null); // room description from Shopify publish, reused for pin copy
  const [publishError, setPublishError] = useState(null);
  const [linkWarning, setLinkWarning] = useState(null); // non-null = back-link errors
  // Image format: aspect of the current image, the one being created, and the picker menu
  const [imageAspect, setImageAspect] = useState('2:3');
  const [pendingAspect, setPendingAspect] = useState('2:3');
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayText, setOverlayText] = useState('');
  const [overlayDrafting, setOverlayDrafting] = useState(false);
  // Add a square image to one product's gallery: { [productId]: { adding, adminUrl, error } }
  const [galleryProductId, setGalleryProductId] = useState('');
  const [galleryStatus, setGalleryStatus] = useState({});
  const [savingPin, setSavingPin] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState(null);
  // Pinterest publish state
  const [pinPosting, setPinPosting] = useState(false);
  const [pinPosted, setPinPosted] = useState(null); // null or { pinUrl }
  const [pinPostError, setPinPostError] = useState(null);
  const [pinTokenPrompt, setPinTokenPrompt] = useState(false);
  const [pinTokenInput, setPinTokenInput] = useState('');
  const [pinTokenSaving, setPinTokenSaving] = useState(false);
  // Generation queue state
  const [genQueued, setGenQueued] = useState(false);
  const genCancelRef = useRef(null);
  // Pin review modal: null when closed
  const [pinDraft, setPinDraft] = useState(null); // { imageUrl, title, body, hashtags, altText, link, boardId, library, loading, error }
  const pinDraftStashRef = useRef(null); // last cancelled draft, restored if the same image is reopened
  const [pinSavingForLater, setPinSavingForLater] = useState(false);
  const [pinSavedForLater, setPinSavedForLater] = useState(false);

  const isPinterest = mode === 'pinterest';

  const promptEdited = prompt !== room.prompt;

  // Toggle a product in/out of the scene; rebuild itemList and prompt.
  function toggleProduct(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      if (next.size <= 1) return; // always keep at least one
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
    const newItemList = buildItemList(activeProducts, next);
    if (newItemList) setPrompt(assemblePromptFromScene(scene, newItemList));
  }

  // Cycle to a different alternative for a slot
  function cycleSlot(slotIndex, direction) {
    const original = products[slotIndex];
    const alts = original.alternatives || [];
    const totalOptions = 1 + alts.length; // original + alternatives
    if (totalOptions <= 1) return;

    const currentAlt = activeAlts.get(slotIndex) ?? -1;
    // Map -1 (original) to index 0, alt[0] to 1, etc.
    const currentPos = currentAlt + 1;
    const nextPos = (currentPos + direction + totalOptions) % totalOptions;
    const nextAlt = nextPos - 1; // back to -1 for original

    const oldProduct = activeProducts[slotIndex];
    const newProduct = nextAlt < 0 ? original : alts[nextAlt];

    // Update activeAlts
    const nextAlts = new Map(activeAlts);
    nextAlts.set(slotIndex, nextAlt);
    setActiveAlts(nextAlts);

    // Update selectedIds: swap old → new, preserving selected state of this slot
    const wasSelected = selectedIds.has(oldProduct.id);
    if (wasSelected) {
      const next = new Set(selectedIds);
      next.delete(oldProduct.id);
      next.add(newProduct.id);
      setSelectedIds(next);

      // Rebuild active products with the swap applied for prompt rebuild
      const updatedProducts = activeProducts.map((p, i) =>
        i === slotIndex ? newProduct : p
      );
      const newItemList = buildItemList(updatedProducts, next);
      if (newItemList) setPrompt(assemblePromptFromScene(scene, newItemList));
    }
  }

  // Update a single scene field, then re-assemble the prompt live.
  function updateSceneField(key, value) {
    const newScene = { ...scene, [key]: value };
    setScene(newScene);
    const currentItemList = buildItemList(activeProducts, selectedIds);
    if (currentItemList) {
      setPrompt(assemblePromptFromScene(newScene, currentItemList));
    } else if (room.itemList) {
      setPrompt(assemblePromptFromScene(newScene, room.itemList));
    }
  }

  // Fetch all scene templates (lazy — first time scene breakdown opens or randomize is clicked)
  async function ensureAllScenes() {
    if (allScenes) return allScenes;
    try {
      const res = await fetch('/api/scenes');
      const data = await res.json();
      setAllScenes(data);
      return data;
    } catch {
      return null;
    }
  }

  // Randomize a single scene field from a random scene template
  async function randomizeField(key) {
    const scenes = await ensureAllScenes();
    if (!scenes || scenes.length === 0) return;
    // Collect non-empty values for this field (excluding current value)
    const candidates = scenes
      .map((s) => s[key])
      .filter((v) => v && v !== scene[key]);
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    updateSceneField(key, pick);
  }

  async function reshuffle(targetRoomType) {
    setReshuffling(true);
    try {
      const body = {
        style: room.style,
        productCount: products.length,
      };
      if (targetRoomType) body.roomType = targetRoomType;
      const activeHandles = featuredProductHandles.filter(h => h.trim());
      if (activeHandles.length > 0) body.featuredProductHandles = activeHandles;
      const res = await fetch('/api/rooms/reshuffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reshuffle failed');

      setProducts(data.products);
      setCombinationName(data.combinationName);
      setActiveAlts(new Map());
      const newSelected = new Set(data.products.map((p) => p.id));
      setSelectedIds(newSelected);

      const newItemList = buildItemList(data.products, newSelected);
      if (newItemList) setPrompt(assemblePromptFromScene(scene, newItemList));

      setGeneratedImage(null);
      setPublished(false);
      setPublishError(null);
      setLinkWarning(null);
      setPinSaved(false);
    } catch (err) {
      console.error('Reshuffle failed:', err.message);
    } finally {
      setReshuffling(false);
    }
  }

  function resetAll() {
    setProducts(room.products);
    setCombinationName(room.combinationName);
    setPrompt(room.prompt);
    setScene(room.scene);
    setSyncStatus(null);
    setActiveAlts(new Map());
    setSelectedIds(new Set(room.products.map((p) => p.id)));
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Queue a Higgsfield render. onQueued/onStart/onDone drive the card's button states.
  async function runQueuedGeneration({ aspectRatio, headline, cancelRef, setQueued, setRunning, setError, onImage }) {
    const selectedProducts = activeProducts.filter((p) => selectedIds.has(p.id));
    const featuredHandles = featuredProductHandles.filter((h) => h.trim());
    const featured = featuredHandles.length === 1 && selectedProducts.find((p) => p.handle === featuredHandles[0]);
    const framedPrompt = [
      prompt,
      aspectRatio === '2:3' && featured && singleProductPinFraming(featured.title),
      headline && textOverlayInstructions(headline, nextOverlayStyle()),
    ].filter(Boolean).join('\n\n');
    const body = JSON.stringify({
      prompt: framedPrompt,
      products: selectedProducts.map((p) => ({ title: p.title, images: p.images })),
      aspectRatio,
    });
    setError(null);
    setQueued(true);
    const { promise, cancel } = queueGeneration(
      async () => {
        const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Generation failed');
        return data.imageUrl;
      },
      () => { setQueued(false); setRunning(true); },
    );
    cancelRef.current = cancel;
    try {
      onImage(await promise);
    } catch (err) {
      if (!err.cancelled) setError(err.message);
    } finally {
      cancelRef.current = null;
      setQueued(false);
      setRunning(false);
    }
  }

  // Draft the overlay headline (keyword + benefit or number) with Claude
  async function draftOverlayHeadline() {
    setOverlayDrafting(true);
    try {
      const res = await fetch('/api/pinterest/headline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style: room.style,
          roomType: scene?.room_type || combinationName,
          products: activeProducts.filter((p) => selectedIds.has(p.id)).map((p) => ({ title: p.title, productType: p.productType })),
        }),
      });
      const data = await res.json();
      if (res.ok && data.headline) {
        setOverlayText(data.headline);
        return data.headline;
      }
    } catch (err) {
      console.warn('Overlay headline draft failed:', err.message);
    } finally {
      setOverlayDrafting(false);
    }
  }

  function toggleOverlay(on) {
    setOverlayOn(on);
    if (on && !overlayText.trim()) draftOverlayHeadline();
  }

  async function generateImage(aspect) {
    setPinSaved(false);
    setPinError(null);
    setPendingAspect(aspect);
    // A ticked overlay always gets text: wait for the draft if it isn't ready, else use the template headline
    let headline = '';
    if (overlayOn) {
      headline = overlayText.trim() || (await draftOverlayHeadline())
        || `${room.style} ${scene?.room_type || combinationName} Ideas That Actually Work`;
      setOverlayText(headline);
    }
    return runQueuedGeneration({
      aspectRatio: aspect,
      headline,
      cancelRef: genCancelRef,
      setQueued: setGenQueued,
      setRunning: setGenerating,
      setError: setGenError,
      onImage: (url) => {
        setGeneratedImage(url);
        setImageAspect(aspect);
        setPinPosted(null);
        setPinSavedForLater(false);
        setPublished(false);
        setGalleryStatus({});
      },
    });
  }

  async function addImageToProduct() {
    const product = activeProducts.find((p) => p.id === galleryProductId);
    if (!product) return;
    setGalleryStatus((s) => ({ ...s, [product.id]: { adding: true } }));
    try {
      const res = await fetch('/api/products/add-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: generatedImage,
          productId: product.id,
          productTitle: product.title,
          alt: `${product.title} in a ${room.style.toLowerCase()} ${combinationName.toLowerCase()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Adding image failed');
      setGalleryStatus((s) => ({ ...s, [product.id]: { adminUrl: data.adminUrl } }));
    } catch (err) {
      setGalleryStatus((s) => ({ ...s, [product.id]: { error: err.message } }));
    }
  }

  async function publishToStore() {
    setPublishing(true);
    setPublishError(null);
    setLinkWarning(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: generatedImage,
          roomName: `${room.style} ${combinationName}`,
          style: room.style,
          scene,
          products: activeProducts
            .filter((p) => selectedIds.has(p.id))
            .map((p) => ({ id: p.id, title: p.title, materials: p.materials })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Publish failed');
      setPublished(true);
      if (data.handle) setPublishedHandle(data.handle);
      if (data.description) setPublishedDescription(data.description);
      if (data.linkResult?.errors?.length > 0) {
        setLinkWarning(`Room published, but product back-links failed: ${data.linkResult.errors.join(' | ')}`);
      }
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function downloadZip() {
    setDownloading(true);
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          styleName: room.style,
          prompt,
          products: activeProducts.filter((p) => selectedIds.has(p.id)).map((p) => ({ title: p.title, images: p.images })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${room.style.toLowerCase().replace(/\s+/g, '-')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  }

  async function savePin(imageUrl) {
    if (!imageUrl || savingPin || pinSaved) return;
    setSavingPin(true);
    setPinError(null);
    try {
      const filename = `${room.style}-${combinationName}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') + `-${Date.now()}`;
      const res = await fetch('/api/save-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPinSaved(true);
    } catch (err) {
      setPinError(err.message);
    } finally {
      setSavingPin(false);
    }
  }

  // Open the review modal. Connection is checked on "Post now", so pins can be saved for later while disconnected.
  function publishToPinterest(imageUrl) {
    if (!imageUrl || pinPosting || pinPosted) return;
    pinLog('info', 'Opening pin review');
    return openPinEditor(imageUrl);
  }

  // Draft the pin copy and open the review modal
  async function openPinEditor(imageUrl, { redraft = false } = {}) {
    setPinPostError(null);
    const stash = pinDraftStashRef.current;
    if (!redraft && stash?.imageUrl === imageUrl) {
      setPinDraft(stash);
      return;
    }
    pinDraftStashRef.current = null;
    setPinDraft({
      imageUrl, title: '', body: '', hashtags: '', topics: '', pattern: null, warnings: [], altText: '',
      link: '', boardId: pinterestBoard || '', suggestedBoard: null, library: [], loading: true, error: null,
      products: activeProducts.filter((p) => selectedIds.has(p.id)).map((p) => ({ id: p.id, title: p.title, tag: true })),
    });
    try {
      const selectedProducts = activeProducts.filter((p) => selectedIds.has(p.id));
      const res = await fetch('/api/pinterest/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          style: room.style,
          roomType: scene?.room_type || combinationName,
          scene,
          products: selectedProducts.map((p) => ({ title: p.title, handle: p.handle, productType: p.productType, materials: p.materials, dimensions: p.dimensions })),
          roomDescription: publishedDescription || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not draft pin copy');
      pinLog('info', `Drafted pin copy: "${data.title}"`, data);
      setPinDraft((d) => d && ({
        ...d,
        title: data.title,
        body: data.body ?? data.description,
        hashtags: (data.hashtags ?? []).join(' '),
        topics: (data.topics ?? []).join(', '),
        pattern: data.pattern ?? null,
        warnings: data.warnings ?? [],
        altText: data.altText,
        link: d.link || data.link || '', // hero product's page
        boardId: data.boardId || d.boardId, // style + room board picked from the pin guide
        suggestedBoard: data.board ?? null,
        library: data.library ?? [],
        loading: false,
      }));
    } catch (err) {
      pinLog('error', `Pin copy draft failed: ${err.message}`);
      setPinDraft((d) => d && ({ ...d, loading: false, error: err.message }));
    }
  }

  function closePinEditor() {
    pinDraftStashRef.current = pinDraft;
    setPinDraft(null);
    setPinPostError(null);
  }

  async function savePinForLater(draft) {
    setPinSavingForLater(true);
    setPinPostError(null);
    try {
      const res = await fetch('/api/pinterest/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: draft.imageUrl,
          roomName: `${room.style} ${combinationName}`,
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
          topics: draft.topics,
          pattern: draft.pattern,
          altText: draft.altText,
          link: draft.link,
          boardId: draft.boardId,
          tagProducts: draft.products ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      pinLog('info', `Saved pin for later: "${draft.title}"`, data);
      pinDraftStashRef.current = null;
      setPinDraft(null);
      setPinSavedForLater(true);
      onPinSavedForLater?.();
    } catch (err) {
      pinLog('error', `Save for later failed: ${err.message}`);
      setPinPostError(err.message);
    } finally {
      setPinSavingForLater(false);
    }
  }

  async function doPublishPin(draft) {
    setPinPosting(true);
    setPinPostError(null);
    try {
      const description = pinDraftDescription(draft);
      pinLog('info', `Publishing pin: "${draft.title}" board=${draft.boardId || 'default'}`, { title: draft.title, description, altText: draft.altText, link: draft.link, boardId: draft.boardId });

      const res = await fetch('/api/pinterest/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: draft.imageUrl,
          title: draft.title.trim(),
          description,
          altText: draft.altText.trim(),
          link: draft.link.trim(),
          boardId: draft.boardId || undefined,
          pattern: draft.pattern || undefined,
          tagProducts: draft.products ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = pinErrorCode(data);
        pinLog('error', `Publish failed: ${data.error}`, data);
        setPinPostError(code);
        if (code === '__auth__') {
          setPinTokenPrompt(true);
          onPinterestAuthError?.();
        }
        return; // modal stays open so the pin can still be saved for later
      }
      pinLog('info', `Pin created: ${data.pinUrl}`, data);
      setPinPosted({ pinUrl: data.pinUrl, tagSummary: pinTagSummary(data.tagging) });
      pinDraftStashRef.current = null;
      setPinDraft(null);
    } catch (err) {
      pinLog('error', `Publish exception: ${err.message}`);
      setPinPostError(err.message);
    } finally {
      setPinPosting(false);
    }
  }

  async function saveTokenAndPublish(imageUrl) {
    if (!pinTokenInput.trim()) return;
    setPinTokenSaving(true);
    setPinPostError(null);
    pinLog('info', 'Saving manual token…');
    try {
      const res = await fetch('/api/pinterest/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: pinTokenInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      if (!data.valid) throw new Error(data.reason || 'Token is invalid');
      pinLog('info', `Token saved & validated: user=${data.username ?? '—'}`, data);
      // Token saved — close prompt, refresh parent status, and publish
      setPinTokenPrompt(false);
      setPinTokenInput('');
      if (onPinterestAuthError) onPinterestAuthError();
      await openPinEditor(imageUrl);
    } catch (err) {
      pinLog('error', `Token save failed: ${err.message}`);
      setPinPostError(err.message);
    } finally {
      setPinTokenSaving(false);
    }
  }

  async function syncToSheet() {
    if (!scene || typeof scene.rowIndex !== 'number') return;
    setSyncing(true);
    setSyncStatus(null);
    try {
      const { rowIndex, ...fields } = scene;
      const res = await fetch('/api/sync-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex, scene: fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      setSyncStatus('ok');
    } catch (err) {
      setSyncStatus({ error: err.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden flex flex-col">
      {/* Generated image */}
      {generatedImage && (
        <div className="relative group">
          <img
            src={generatedImage}
            alt={`Generated ${room.style} room scene`}
            className="w-full object-cover"
            style={{ aspectRatio: imageAspect.replace(':', '/') }}
          />
          <span className="absolute top-2 left-2 text-xs font-medium bg-violet-600 text-white px-2 py-0.5 rounded-full">
            {IMAGE_FORMATS.find((f) => f.aspect === imageAspect)?.label ?? 'Image'} · {imageAspect}
          </span>
          <button
            onClick={async () => {
              try {
                // Download through the server so the file has its metadata stripped
                const res = await fetch(`/api/clean-image?url=${encodeURIComponent(generatedImage)}`);
                if (!res.ok) throw new Error(await res.text());
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${room.style}-${combinationName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.jpg';
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                window.open(generatedImage, '_blank');
              }
            }}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="Save image"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>
      )}

      {/* Generating spinner */}
      {generating && (
        <div className="flex items-center justify-center gap-3 py-8 bg-violet-50">
          <svg className="animate-spin h-5 w-5 text-violet-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-violet-700 font-medium">Creating {pendingAspect} image…</span>
        </div>
      )}

      {genError && (
        <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {genError}
        </div>
      )}
      {publishError && !isPinterest && (
        <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {publishError}
        </div>
      )}

      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
        <span className={`text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full ${badgeClass(room.style)}`}>
          {room.style}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">Combo:</span>
          {combinationNames.length > 1 && (
            <button
              onClick={() => {
                const idx = combinationNames.indexOf(combinationName);
                const prev = combinationNames[(idx - 1 + combinationNames.length) % combinationNames.length];
                reshuffle(prev);
              }}
              disabled={reshuffling}
              className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 disabled:opacity-50"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setComboPickerOpen(true)}
            disabled={reshuffling}
            className="text-xs text-stone-500 hover:text-stone-700 px-1 hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {reshuffling ? 'Loading…' : combinationName}
          </button>
          {combinationNames.length > 1 && (
            <button
              onClick={() => {
                const idx = combinationNames.indexOf(combinationName);
                const next = combinationNames[(idx + 1) % combinationNames.length];
                reshuffle(next);
              }}
              disabled={reshuffling}
              className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 disabled:opacity-50"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Combination picker modal */}
      {comboPickerOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setComboPickerOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setComboPickerOpen(false)}>
            <div
              className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-sm max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                <h3 className="text-sm font-semibold text-stone-800">Choose Combination</h3>
                <button
                  onClick={() => setComboPickerOpen(false)}
                  className="text-stone-400 hover:text-stone-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto py-2">
                {combinationNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      setComboPickerOpen(false);
                      if (name !== combinationName) reshuffle(name);
                    }}
                    className={`w-full text-left px-5 py-2.5 text-sm transition-colors ${
                      name === combinationName
                        ? 'bg-stone-100 text-stone-900 font-medium'
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Product images — click to toggle inclusion in the scene */}
      <div className="flex gap-3 p-5">
        {activeProducts.map((product, slotIdx) => {
          const original = products[slotIdx];
          const alts = original.alternatives || [];
          const totalOptions = 1 + alts.length;
          const hasAlts = totalOptions > 1;
          const currentPos = (activeAlts.get(slotIdx) ?? -1) + 1; // 0 = original
          const selected = selectedIds.has(product.id);
          return (
            <div
              key={`slot-${slotIdx}`}
              className={`flex-1 flex flex-col items-center gap-2 min-w-0 select-none transition-opacity ${
                selected ? 'opacity-100' : 'opacity-35'
              }`}
            >
              <div className="w-full aspect-square rounded-xl overflow-hidden bg-stone-100 relative">
                <div
                  onClick={() => toggleProduct(product.id)}
                  title={selected ? 'Click to remove from scene' : 'Click to add to scene'}
                  className="cursor-pointer w-full h-full"
                >
                  {product.images[0] ? (
                    <Image
                      src={product.images[0]}
                      alt={product.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 33vw, 200px"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-stone-300 text-xs">
                      No image
                    </div>
                  )}
                </div>
                <span
                  className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm ${
                    selected ? 'bg-green-500' : 'bg-stone-500'
                  }`}
                >
                  {selected ? '\u2713' : '\u00d7'}
                </span>
                {/* Arrow navigation */}
                {hasAlts && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); cycleSlot(slotIdx, -1); }}
                      className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-stone-600 text-xs"
                      title="Previous alternative"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); cycleSlot(slotIdx, 1); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-stone-600 text-xs"
                      title="Next alternative"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs text-stone-600 text-center leading-tight line-clamp-2 w-full">
                {product.title}
              </p>
              {product.materials && (
                <p className="text-xs text-stone-400 text-center">{product.materials}</p>
              )}
              {hasAlts && (
                <p className="text-xs text-stone-400">{currentPos + 1}/{totalOptions}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Product combination panel */}
      <div className="mx-5 mb-3 border border-stone-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setProductsOpen((o) => !o)}
          className="flex items-center justify-between w-full px-4 py-2.5 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
        >
          <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
            Products ({activeProducts.filter((p) => selectedIds.has(p.id)).length}/{activeProducts.length})
          </span>
          <svg
            className={`w-3.5 h-3.5 text-stone-400 transition-transform ${productsOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {productsOpen && (
          <div className="border-t border-stone-200">
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-stone-100">
              <button
                type="button"
                onClick={() => {
                  const nextAlts = new Map();
                  const nextSelected = new Set();
                  products.forEach((original, slotIdx) => {
                    const alts = original.alternatives || [];
                    const totalOptions = 1 + alts.length;
                    // Pick a random option for this slot
                    const pick = Math.floor(Math.random() * totalOptions) - 1; // -1 = original
                    nextAlts.set(slotIdx, pick);
                    const product = pick < 0 ? original : (alts[pick] || original);
                    nextSelected.add(product.id);
                  });
                  setActiveAlts(nextAlts);
                  setSelectedIds(nextSelected);
                }}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Shuffle Products
              </button>
            </div>
            <div className="divide-y divide-stone-100">
            {activeProducts.map((product, slotIdx) => {
              const original = products[slotIdx];
              const alts = original.alternatives || [];
              const totalOptions = 1 + alts.length;
              const hasAlts = totalOptions > 1;
              const currentPos = (activeAlts.get(slotIdx) ?? -1) + 1;
              const selected = selectedIds.has(product.id);
              return (
                <div
                  key={`prod-panel-${slotIdx}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-opacity ${selected ? 'opacity-100' : 'opacity-40'}`}
                >
                  {/* Thumbnail */}
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0 relative">
                    {product.images[0] ? (
                      <Image
                        src={product.images[0]}
                        alt={product.title}
                        fill
                        className="object-cover"
                        sizes="40px"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-300 text-[8px]">N/A</div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-stone-700 truncate">{product.title}</p>
                    <p className="text-[10px] text-stone-400 truncate">
                      {product.productType}
                      {product.materials ? ` · ${product.materials}` : ''}
                    </p>
                  </div>

                  {/* Alt cycling */}
                  {hasAlts && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => cycleSlot(slotIdx, -1)}
                        className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="text-[10px] text-stone-400 w-7 text-center">{currentPos + 1}/{totalOptions}</span>
                      <button
                        onClick={() => cycleSlot(slotIdx, 1)}
                        className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Toggle inclusion */}
                  <button
                    onClick={() => toggleProduct(product.id)}
                    className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${
                      selected ? 'bg-green-500 hover:bg-red-400' : 'bg-stone-300 hover:bg-green-400'
                    } transition-colors`}
                    title={selected ? 'Remove from scene' : 'Add to scene'}
                  >
                    {selected ? '\u2713' : '+'}
                  </button>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </div>

      {/* Prompt */}
      <div className="px-5 pb-2 flex-1">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
            Higgsfield Prompt
          </label>
          {promptEdited && (
            <button
              onClick={resetAll}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-40 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
        />
      </div>

      {/* Scene breakdown (only shown when CSV data is available) */}
      {room.scene && (
        <div className="mx-5 mb-3 border border-stone-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setSceneOpen((o) => !o)}
            className="flex items-center justify-between w-full px-4 py-2.5 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
          >
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Scene Breakdown
            </span>
            <svg
              className={`w-3.5 h-3.5 text-stone-400 transition-transform ${sceneOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {sceneOpen && scene && (
            <div className="p-4 space-y-3 border-t border-stone-200">
              <button
                type="button"
                onClick={async () => {
                  const scenes = await ensureAllScenes();
                  if (!scenes || scenes.length === 0) return;
                  const newScene = { ...scene };
                  for (const { key } of SCENE_FIELDS) {
                    const candidates = scenes.map((s) => s[key]).filter(Boolean);
                    if (candidates.length > 0) {
                      newScene[key] = candidates[Math.floor(Math.random() * candidates.length)];
                    }
                  }
                  setScene(newScene);
                  const currentItemList = buildItemList(activeProducts, selectedIds);
                  if (currentItemList) {
                    setPrompt(assemblePromptFromScene(newScene, currentItemList));
                  } else if (room.itemList) {
                    setPrompt(assemblePromptFromScene(newScene, room.itemList));
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Shuffle All Fields
              </button>
              {SCENE_FIELDS.map(({ key, label, multiline }) => (
                <div key={key}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="text-xs font-medium text-stone-400">
                      {label}
                    </label>
                    <button
                      type="button"
                      onClick={() => randomizeField(key)}
                      title={`Randomize ${label}`}
                      className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                  {multiline ? (
                    <textarea
                      value={scene[key] || ''}
                      onChange={(e) => updateSceneField(key, e.target.value)}
                      rows={2}
                      className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
                    />
                  ) : (
                    <input
                      type="text"
                      value={scene[key] || ''}
                      onChange={(e) => updateSceneField(key, e.target.value)}
                      className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono"
                    />
                  )}
                </div>
              ))}

              {/* Accessories — sourced from config, picker + editable textarea */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-medium text-stone-400">
                    Accessories
                  </label>
                  {accessoriesList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        // Pre-select accessories that match current text
                        const current = scene.accessories || '';
                        const sel = new Set();
                        accessoriesList.forEach((item, i) => {
                          if (current.includes(item)) sel.add(i);
                        });
                        setAccessorySelection(sel);
                        setAccessoryPickerOpen(true);
                      }}
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
                    >
                      Choose
                    </button>
                  )}
                </div>
                <textarea
                  value={scene.accessories || ''}
                  onChange={(e) => updateSceneField('accessories', e.target.value)}
                  rows={2}
                  placeholder="e.g. A white Porsche GT3 is visible through the windows. Assouline travel books sit on the coffee table."
                  className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
                />
              </div>

              {/* Accessories picker modal */}
              {accessoryPickerOpen && (
                <>
                  <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setAccessoryPickerOpen(false)} />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAccessoryPickerOpen(false)}>
                    <div
                      className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md max-h-[70vh] flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                        <h3 className="text-sm font-semibold text-stone-800">Choose Accessories</h3>
                        <button
                          onClick={() => setAccessoryPickerOpen(false)}
                          className="text-stone-400 hover:text-stone-600 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="overflow-y-auto py-2 flex-1">
                        {accessoriesList.map((item, i) => {
                          const checked = accessorySelection.has(i);
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                const next = new Set(accessorySelection);
                                if (checked) next.delete(i); else next.add(i);
                                setAccessorySelection(next);
                              }}
                              className={`w-full text-left px-5 py-3 text-xs font-mono leading-relaxed transition-colors flex items-start gap-3 ${
                                checked ? 'bg-stone-100' : 'hover:bg-stone-50'
                              }`}
                            >
                              <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                                checked ? 'bg-stone-800 border-stone-800 text-white' : 'border-stone-300'
                              }`}>
                                {checked && (
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </span>
                              <span className="text-stone-600">{item}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="px-5 py-4 border-t border-stone-100 flex items-center justify-between gap-3">
                        <span className="text-xs text-stone-400">
                          {accessorySelection.size} selected
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAccessoryPickerOpen(false)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const selected = accessoriesList.filter((_, i) => accessorySelection.has(i));
                              updateSceneField('accessories', selected.join(' '));
                              setAccessoryPickerOpen(false);
                            }}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Sync to sheet */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={syncToSheet}
                  disabled={syncing}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {syncing ? 'Syncing…' : 'Sync to Sheet'}
                </button>
                {syncStatus === 'ok' && (
                  <span className="text-xs text-green-600">Saved to sheet</span>
                )}
                {syncStatus?.error && (
                  <span className="text-xs text-red-600 truncate" title={syncStatus.error}>
                    {syncStatus.error}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-5 py-4">
        <button
          onClick={copyPrompt}
          className="flex-1 text-sm font-medium py-2 rounded-lg border border-stone-300 hover:bg-stone-100 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy Prompt'}
        </button>
        <button
          onClick={downloadZip}
          disabled={downloading}
          className="flex-1 text-sm font-medium py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {downloading ? 'Packaging...' : 'Download ZIP'}
        </button>
        <div className="relative flex-1 flex">
          <button
            onClick={() => (genQueued ? genCancelRef.current?.() : setAspectMenuOpen((o) => !o))}
            disabled={generating}
            title={genQueued ? 'Waiting for a free Higgsfield slot. Click to cancel.' : 'Choose a format and create an image'}
            className={`flex-1 text-sm font-medium py-2 rounded-lg flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-wait transition-colors ${
              genQueued ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-violet-600 text-white hover:bg-violet-500'
            }`}
          >
            {generating
              ? `Creating ${pendingAspect}…`
              : genQueued
                ? `Queued ${pendingAspect} · Cancel`
                : generatedImage ? 'New Image' : 'Create Image'}
            {!generating && !genQueued && (
              <svg className={`w-3.5 h-3.5 transition-transform ${aspectMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {aspectMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAspectMenuOpen(false)} />
              <div className="absolute right-0 bottom-full mb-2 z-20 w-64 bg-white rounded-xl shadow-lg border border-stone-200 p-1.5">
                {IMAGE_FORMATS.map((f) => (
                  <button
                    key={f.aspect}
                    onClick={() => { setAspectMenuOpen(false); generateImage(f.aspect); }}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-violet-50 text-left transition-colors"
                  >
                    <span className="w-7 h-9 flex items-center justify-center shrink-0">
                      <span className="block border-2 border-violet-500 rounded-sm" style={{ aspectRatio: f.aspect.replace(':', '/'), height: '100%' }} />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-stone-800">{f.label} <span className="text-stone-400 font-normal">{f.aspect.replace(':', '×')}</span></span>
                      <span className="block text-[11px] text-stone-400">{f.hint}</span>
                    </span>
                  </button>
                ))}
                <div className="border-t border-stone-100 mt-1.5 pt-2 px-2.5 pb-1">
                  <label className="flex items-center gap-2 text-sm font-medium text-stone-800 cursor-pointer">
                    <input type="checkbox" checked={overlayOn} onChange={(e) => toggleOverlay(e.target.checked)} className="accent-violet-600" />
                    Text overlay
                  </label>
                  <p className="text-[11px] text-stone-400 mt-0.5">Search phrase on the image, 3 to 7 words (e.g. “Warm modern living room idea”). Shows wherever this image is used.</p>
                  {overlayOn && (
                    <div className="mt-1.5 flex gap-1">
                      <input
                        type="text"
                        value={overlayText}
                        onChange={(e) => setOverlayText(e.target.value)}
                        placeholder={overlayDrafting ? 'Drafting…' : 'Headline'}
                        disabled={overlayDrafting}
                        className="flex-1 min-w-0 text-xs text-stone-800 border border-stone-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
                      />
                      <button
                        onClick={draftOverlayHeadline}
                        disabled={overlayDrafting}
                        title="Draft a new headline"
                        className="text-xs text-violet-700 border border-violet-200 rounded-md px-2 hover:bg-violet-50 disabled:opacity-50"
                      >
                        ↻
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {overlayOn && (
        <p className="px-5 -mt-2 pb-3 text-[11px] text-violet-700">
          Text overlay on: {overlayDrafting ? 'drafting headline…' : overlayText.trim() ? `“${overlayText.trim()}”` : 'headline drafts when you create the image'}
        </p>
      )}

      {/* Post-generate actions */}
      {generatedImage && (
        <div className="px-5 pb-4 flex flex-col gap-2">
          {!isPinterest && (
            <>
              {publishError && (
                <p className="text-xs text-red-600">{publishError}</p>
              )}
              {linkWarning && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{linkWarning}</p>
              )}
              <button
                onClick={publishToStore}
                disabled={publishing || published}
                className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                  published
                    ? 'bg-green-100 text-green-800 cursor-default'
                    : 'bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-wait'
                }`}
              >
                {published ? 'Published' : publishing ? 'Publishing...' : 'Publish to Store'}
              </button>
              <div className="border-t border-stone-100 my-1" />
            </>
          )}
          {/* Square images can go back into a product's own gallery */}
          {imageAspect === '1:1' && (() => {
            const galleryProducts = activeProducts.filter((p) => selectedIds.has(p.id));
            const current = galleryStatus[galleryProductId] ?? {};
            return (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-stone-500">Add to a product's image gallery (optional)</label>
                <div className="flex gap-2">
                  <select
                    value={galleryProductId}
                    onChange={(e) => setGalleryProductId(e.target.value)}
                    className="flex-1 min-w-0 text-sm text-stone-700 border border-stone-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
                  >
                    <option value="">Choose a product…</option>
                    {galleryProducts.map((p) => (
                      <option key={p.id} value={p.id}>{galleryStatus[p.id]?.adminUrl ? '✓ ' : ''}{p.title}</option>
                    ))}
                  </select>
                  <button
                    onClick={addImageToProduct}
                    disabled={!galleryProductId || current.adding || !!current.adminUrl}
                    className="shrink-0 text-sm font-medium px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                  >
                    {current.adding ? 'Adding…' : current.adminUrl ? 'Added' : 'Add Image'}
                  </button>
                </div>
                {current.error && <p className="text-xs text-red-600">{current.error}</p>}
                {current.adminUrl && (
                  <a href={current.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 hover:underline">
                    Added as the last image in the gallery. View in Shopify admin
                  </a>
                )}
              </div>
            );
          })()}
          {/* Save to Downloads */}
          {pinError && (
            <p className="text-xs text-red-600">{pinError}</p>
          )}
          <button
            onClick={() => savePin(generatedImage)}
            disabled={savingPin || pinSaved}
            className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
              pinSaved
                ? 'bg-green-100 text-green-800 cursor-default'
                : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
            }`}
          >
            {pinSaved ? 'Saved to Downloads' : savingPin ? 'Saving…' : 'Save to Downloads'}
          </button>
          {/* Publish to Pinterest */}
          {pinPostError && !['__auth__', '__scope__', '__trial__'].includes(pinPostError) && (
            <p className="text-xs text-red-600">{pinPostError}</p>
          )}
          {/* Trial error — app not approved for production writes */}
          {pinPostError === '__trial__' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-amber-800 font-medium">Pinterest app is in Trial mode</p>
              <p className="text-[10px] text-amber-700">Trial apps can only create pins on the sandbox API. To publish to real boards, submit your app for review in the Pinterest developer dashboard to get Standard access.</p>
              <button onClick={() => setPinPostError(null)} className="text-[10px] text-stone-400 hover:text-stone-600">Dismiss</button>
            </div>
          )}
          {/* Scope error — token works but is read-only */}
          {pinPostError === '__scope__' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-amber-800 font-medium">Token is read-only — missing write permissions</p>
              <p className="text-[10px] text-amber-700">The Pinterest developer dashboard only generates read-only tokens. To publish pins, connect via OAuth in the menu (hamburger → Pinterest → Connect to Pinterest).</p>
              <button onClick={() => setPinPostError(null)} className="text-[10px] text-stone-400 hover:text-stone-600">Dismiss</button>
            </div>
          )}
          {/* Auth error — token expired or missing */}
          {pinTokenPrompt && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-rose-700">{pinPostError === '__auth__' ? 'Token expired — paste a new one or reconnect via OAuth in the menu.' : 'Paste your Pinterest access token to publish.'}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pinTokenInput}
                  onChange={(e) => { setPinTokenInput(e.target.value); setPinPostError(null); }}
                  placeholder="pina_…"
                  className="flex-1 text-xs text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400 font-mono placeholder:text-stone-400"
                />
                <button
                  onClick={() => saveTokenAndPublish(generatedImage)}
                  disabled={pinTokenSaving || !pinTokenInput.trim()}
                  className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
                >
                  {pinTokenSaving ? 'Saving…' : 'Save & Publish'}
                </button>
              </div>
              <button onClick={() => { setPinTokenPrompt(false); setPinPostError(null); }} className="text-[10px] text-stone-400 hover:text-stone-600">Cancel</button>
            </div>
          )}
          {!pinTokenPrompt && pinPostError !== '__scope__' && (
            <button
              onClick={() => publishToPinterest(generatedImage)}
              disabled={pinPosting || !!pinPosted}
              className={`w-full text-sm font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                pinPosted
                  ? 'bg-green-100 text-green-800 cursor-default'
                  : 'bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 disabled:cursor-wait'
              }`}
            >
              <PinterestIcon className="w-4 h-4" />
              {pinPosted ? 'Published to Pinterest' : pinPosting ? 'Publishing…' : 'Publish to Pinterest'}
            </button>
          )}
          {pinPosted && (
            <a href={pinPosted.pinUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-rose-600 hover:underline text-center">
              View pin on Pinterest
            </a>
          )}
          {pinPosted?.tagSummary && (
            <p className="text-xs text-stone-500 text-center">{pinPosted.tagSummary}</p>
          )}
          {pinSavedForLater && !pinPosted && (
            <p className="text-xs text-stone-500 text-center">Saved for later. Find it in ☰ → Saved Pins.</p>
          )}
        </div>
      )}

      {/* Pin review modal */}
      {pinDraft && (
        <PinReviewModal
          draft={pinDraft}
          onChange={setPinDraft}
          boards={pinterestBoards}
          busy={pinPosting ? 'posting' : pinSavingForLater ? 'saving' : null}
          error={pinErrorText(pinPostError)}
          onClose={closePinEditor}
          onRedraft={() => openPinEditor(pinDraft.imageUrl, { redraft: true })}
          onPost={() => doPublishPin(pinDraft)}
          onSave={() => savePinForLater(pinDraft)}
          saveLabel="Save for later"
        />
      )}
    </div>
  );
}

// ─── Pin review modal (shared by room cards and the Saved Pins menu) ─────────

function pinDraftDescription(draft) {
  return [draft.body.trim(), draft.hashtags.trim()].filter(Boolean).join('\n\n');
}

/** Human message for a pin post error (codes come from classifyPinError on the server). */
function pinErrorText(code) {
  if (!code) return null;
  if (code === '__trial__') return 'The Pinterest app is in Trial mode and can only post to the sandbox. Save the pin for later until the app is approved.';
  if (code === '__scope__') return 'The Pinterest token is read-only. Reconnect via OAuth (menu → Pinterest), or save the pin for later.';
  if (code === '__auth__') return 'Pinterest is not connected or the session expired. Reconnect in the menu (☰ → Pinterest), or save the pin for later.';
  return code;
}

/** One-line summary of product tagging after a post, or null if nothing was requested. */
function pinTagSummary(tagging) {
  if (!tagging) return null;
  const parts = [];
  if (tagging.tagged?.length) parts.push(`Tagged ${tagging.tagged.length} product${tagging.tagged.length === 1 ? '' : 's'}`);
  if (tagging.notInCatalog?.length) parts.push(`not in your Pinterest catalog: ${tagging.notInCatalog.join(', ')}`);
  if (tagging.ineligible?.length) parts.push(`not taggable: ${tagging.ineligible.map((i) => `${i.title} (${i.reason})`).join(', ')}`);
  if (tagging.error) parts.push(`product tagging failed: ${tagging.error}`);
  return parts.length ? parts.join('; ') + '.' : null;
}

/** Map a failed post response to an error code for pinErrorText. */
function pinErrorCode(data) {
  if (data.trialError) return '__trial__';
  if (data.scopeError) return '__scope__';
  if (data.authError) return '__auth__';
  return data.error ?? 'Pinterest publish failed';
}

function PinReviewModal({ draft, onChange, boards = [], busy, error, onClose, onRedraft, onPost, onSave, saveLabel }) {
  const set = (key) => (e) => onChange((d) => ({ ...d, [key]: e.target.value }));
  const description = pinDraftDescription(draft);
  const overLimit = draft.title.length > PIN_TITLE_MAX || description.length > PIN_DESCRIPTION_MAX || draft.altText.length > PIN_ALT_MAX;
  const blocked = draft.loading || !!busy || overLimit;

  // Which products can be tagged: null while checking, Set of in-catalog IDs, or { error }
  const [catalog, setCatalog] = useState(null);
  const productIds = (draft.products ?? []).map((p) => p.id).join(',');
  useEffect(() => {
    if (!productIds) return;
    let cancelled = false;
    fetch('/api/pinterest/catalog-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: productIds.split(',') }),
    })
      .then((r) => r.json())
      .then((data) => !cancelled && setCatalog(data.error ? { error: data.error } : new Set(data.inCatalog)))
      .catch((err) => !cancelled && setCatalog({ error: err.message }));
    return () => { cancelled = true; };
  }, [productIds]);

  function toggleHashtag(tag) {
    onChange((d) => {
      const tags = d.hashtags.split(/\s+/).filter(Boolean);
      const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
      const next = has ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag];
      return { ...d, hashtags: next.join(' ') };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50" onClick={() => !busy && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col sm:flex-row">
        {/* Image preview */}
        <div className="sm:w-64 shrink-0 bg-stone-100 p-4 flex items-start justify-center">
          <img src={draft.imageUrl} alt={draft.altText || 'Pin image'} className="w-full max-w-[220px] sm:max-w-none rounded-lg" />
        </div>

        {/* Fields */}
        <div className="flex-1 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-stone-800 flex items-center gap-2">
              <PinterestIcon className="w-4 h-4 text-rose-600" />
              Review pin
            </h3>
            {onRedraft && (
              <button onClick={onRedraft} disabled={draft.loading || !!busy} className="text-xs text-rose-600 hover:underline disabled:opacity-50">
                {draft.loading ? 'Drafting…' : 'Redraft copy'}
              </button>
            )}
          </div>

          {draft.error && <p className="text-xs text-red-600">Drafting failed: {draft.error}. You can still write the copy yourself.</p>}

          {draft.warnings?.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1 list-disc list-inside">
              {draft.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}

          <fieldset disabled={draft.loading || !!busy} className={`space-y-4 ${draft.loading ? 'opacity-50' : ''}`}>
            <PinField label="Title" value={draft.title} max={PIN_TITLE_MAX}>
              <input
                type="text"
                value={draft.title}
                onChange={set('title')}
                className="w-full text-sm text-stone-800 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
              />
            </PinField>

            <PinField label="Description" value={description} max={PIN_DESCRIPTION_MAX} hint="Counts description + hashtags together">
              <textarea
                value={draft.body}
                onChange={set('body')}
                rows={5}
                className="w-full text-sm text-stone-800 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400 resize-y"
              />
            </PinField>

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Hashtags</label>
              <input
                type="text"
                value={draft.hashtags}
                onChange={set('hashtags')}
                className="w-full text-sm text-rose-700 font-mono border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
              />
              {draft.library?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 max-h-24 overflow-y-auto">
                  {draft.library.map((tag) => {
                    const on = draft.hashtags.split(/\s+/).some((t) => t.toLowerCase() === tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleHashtag(tag)}
                        className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${
                          on ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-stone-200 text-stone-500 hover:border-rose-300'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Topic tags</label>
              <textarea
                value={draft.topics ?? ''}
                onChange={set('topics')}
                rows={2}
                className="w-full text-sm text-stone-800 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400 resize-y"
              />
              <p className="text-[10px] text-stone-400 mt-1">Pinterest's API can't set topic tags. Add these to the pin in Pinterest after posting.</p>
            </div>

            <PinField label="Alt text" value={draft.altText} max={PIN_ALT_MAX}>
              <textarea
                value={draft.altText}
                onChange={set('altText')}
                rows={2}
                className="w-full text-sm text-stone-800 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400 resize-y"
              />
            </PinField>

            {draft.products?.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Tag products</label>
                <div className="space-y-1">
                  {draft.products.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={p.tag !== false}
                        onChange={(e) => onChange((d) => ({
                          ...d,
                          products: d.products.map((x) => (x.id === p.id ? { ...x, tag: e.target.checked } : x)),
                        }))}
                        className="accent-rose-600"
                      />
                      <span className="truncate">{p.title}</span>
                      {catalog instanceof Set && (catalog.has(p.id)
                        ? <span className="shrink-0 text-[10px] text-emerald-600">In catalog</span>
                        : <span className="shrink-0 text-[10px] text-amber-600">Not in Pinterest catalog, won't tag</span>)}
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-stone-400 mt-1">
                  {catalog === null ? 'Checking your Pinterest catalog…'
                    : catalog.error ? `Couldn't check the catalog: ${catalog.error}`
                    : 'Tagged after posting, using each product\'s pin from your Pinterest catalog. Products appear there once they are published to the Pinterest sales channel in Shopify and the catalog syncs.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Website</label>
                <input
                  type="url"
                  value={draft.link}
                  onChange={set('link')}
                  placeholder="https://htgtfurniture.com/products/…"
                  className="w-full text-sm text-stone-800 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Board</label>
                <select
                  value={draft.boardId}
                  onChange={set('boardId')}
                  className="w-full text-sm text-stone-800 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-400"
                >
                  <option value="">Default board</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {draft.suggestedBoard && !boards.some((b) => b.name === draft.suggestedBoard) && (
                  <p className="text-[10px] text-amber-600 mt-1">Suggested board “{draft.suggestedBoard}” isn't on your account yet.</p>
                )}
              </div>
            </div>
          </fieldset>

          {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={!!busy}
              className="sm:flex-1 text-sm font-medium py-2 rounded-lg border border-stone-300 hover:bg-stone-100 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={blocked}
              className="sm:flex-1 text-sm font-medium py-2 rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busy === 'saving' ? 'Saving…' : saveLabel}
            </button>
            <button
              onClick={onPost}
              disabled={blocked || !draft.title.trim()}
              className="sm:flex-1 text-sm font-medium py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <PinterestIcon className="w-4 h-4" />
              {busy === 'posting' ? 'Posting…' : 'Post now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Labeled field with a live character count against Pinterest's limit
// ─── Pin suggestions (☰ → Pin Suggestions) ───────────────────────────────────

function formatPinAge(iso) {
  if (!iso) return 'Never pinned';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'Pinned today';
  if (days < 60) return `Pinned ${days}d ago`;
  if (days < 730) return `Pinned ${Math.round(days / 30)} mo ago`;
  return `Pinned ${Math.floor(days / 365)} yr ago`;
}

function PinSuggestionsModal({ state, onClose, onRefresh, onMakeRoom }) {
  const [tab, setTab] = useState('rooms');
  const [typeFilter, setTypeFilter] = useState('');
  const [hideRecent, setHideRecent] = useState(true);
  const { loading, error, data } = state;

  const types = data ? [...new Set(data.products.map((p) => p.productType).filter(Boolean))].sort() : [];
  const recentCutoff = Date.now() - 90 * 86400000;
  const products = (data?.products ?? []).filter((p) =>
    (!typeFilter || p.productType === typeFilter) &&
    (!hideRecent || !p.lastPinnedAt || new Date(p.lastPinnedAt).getTime() < recentCutoff));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-stone-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Pin Suggestions</h2>
              <p className="text-xs text-stone-500 mt-0.5">
                In-stock products ranked by time since last pin, stock, sales, and what earns saves and clicks on your Pinterest (last 90 days).
              </p>
            </div>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-700" aria-label="Close">✕</button>
          </div>

          {data && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-stone-600">
              <span><b className="text-stone-900">{data.summary.neverPinned}</b> of {data.summary.inStock} in-stock products never pinned</span>
              <span><b className="text-stone-900">{data.summary.pinnedLast90}</b> pinned in the last 90 days</span>
              {data.summary.topTypes[0] && (
                <span>Best type: <b className="text-stone-900">{data.summary.topTypes[0].type}</b> ({data.summary.topTypes[0].saves} saves, {data.summary.topTypes[0].clicks} clicks)</span>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[['rooms', `Suggested rooms${data ? ` (${data.rooms.length})` : ''}`], ['products', 'Products']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${tab === key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
              >
                {label}
              </button>
            ))}
            {tab === 'products' && data && (
              <>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="text-xs text-stone-700 border border-stone-200 rounded-full px-2.5 py-1.5 bg-white"
                >
                  <option value="">All types</option>
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer">
                  <input type="checkbox" checked={hideRecent} onChange={(e) => setHideRecent(e.target.checked)} className="accent-stone-900" />
                  Hide pinned in last 90 days
                </label>
              </>
            )}
            <button onClick={onRefresh} disabled={loading} className="ml-auto text-xs text-stone-500 hover:text-stone-800 disabled:opacity-50">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">
          {loading && !data && (
            <p className="text-sm text-stone-500 py-10 text-center">Reading your pins, Pinterest analytics, and Shopify stock and sales. This takes about 15 seconds.</p>
          )}
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {data?.warnings?.map((w) => <p key={w} className="text-xs text-amber-700 mb-2">{w}</p>)}

          {data && tab === 'rooms' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.rooms.length === 0 && <p className="text-sm text-stone-400 italic">No rooms could be built from unpinned products.</p>}
              {data.rooms.map((room) => (
                <div key={`${room.style}-${room.combination}-${room.products[0].id}`} className="border border-stone-200 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-stone-800">{room.style} · {room.combination}</span>
                    <span className="text-[10px] text-stone-400">score {room.score}</span>
                  </div>
                  <div className="flex gap-2">
                    {room.products.map((p) => (
                      <div key={p.id} className="flex-1 min-w-0">
                        {p.thumbnail
                          ? <img src={p.thumbnail} alt={p.title} className="w-full aspect-square object-cover rounded-lg bg-stone-100" />
                          : <div className="w-full aspect-square rounded-lg bg-stone-100" />}
                        <p className="text-[10px] text-stone-600 mt-1 line-clamp-2">{p.title}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => onMakeRoom(room.products)}
                    className="text-xs font-medium py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
                  >
                    Make this room
                  </button>
                </div>
              ))}
            </div>
          )}

          {data && tab === 'products' && (
            <div className="divide-y divide-stone-100">
              {products.length === 0 && <p className="text-sm text-stone-400 italic py-4">No products match.</p>}
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5">
                  {p.thumbnail
                    ? <img src={p.thumbnail} alt={p.title} className="w-12 h-12 object-cover rounded-md bg-stone-100 shrink-0" />
                    : <div className="w-12 h-12 rounded-md bg-stone-100 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-800 truncate">{p.title}</p>
                    <p className="text-[11px] text-stone-500 truncate">
                      {p.productType || 'No type'} · {formatPinAge(p.lastPinnedAt)}{p.pinCount > 1 ? ` (${p.pinCount} pins)` : ''}
                    </p>
                    <p className="text-[11px] text-stone-400 truncate">{p.reasons.filter((r) => !r.startsWith('Never pinned') && !r.startsWith('Last pinned')).join(' · ')}</p>
                  </div>
                  <span className="text-xs font-medium text-stone-500 w-8 text-right shrink-0" title="Suggestion score (0–100)">{p.score}</span>
                  <button
                    onClick={() => onMakeRoom([p])}
                    disabled={!p.roomReady}
                    title={p.roomReady ? 'Generate rooms featuring this product' : 'Needs a design style (custom.design_style) before it can be used in rooms'}
                    className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:bg-stone-200 disabled:text-stone-500 transition-colors"
                  >
                    {p.roomReady ? 'Make a room' : 'No style'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add scene from a photo (☰ → Add Scene) ──────────────────────────────────
// Ported from htgtprompts2026's /add-room: Claude reads a room photo into scene sheet
// columns (/api/scenes/analyze), you edit them, and /api/scenes/add appends the row.

const ADD_SCENE_FIELDS = [
  ['room_name', 'Scene name', 1],
  ['room_details', 'Room details', 3],
  ['furniture_types', 'Furniture types', 1],
  ['materials', 'Materials', 2],
  ['lighting', 'Lighting', 2],
  ['camera', 'Camera', 1],
  ['color_grade', 'Color grade', 1],
  ['negative_styling_rules', 'Avoid', 2],
  ['hero_object_placement_logic', 'Hero placement', 2],
  ['realism_constraints', 'Realism', 2],
];

// Re-encode as a JPEG no larger than 1536px, so the request stays small and the format is
// one Claude accepts. Resolves null when the browser can't decode the file (e.g. HEIC in Chrome).
function resizeImageDataUrl(dataUrl, maxDim = 1536) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function TagPicker({ label, options, value, onChange }) {
  const selected = value.split(',').map((t) => t.trim()).filter(Boolean);
  const has = (o) => selected.some((t) => t.toLowerCase() === o.toLowerCase());
  const toggle = (o) => onChange((has(o) ? selected.filter((t) => t.toLowerCase() !== o.toLowerCase()) : [...selected, o]).join(', '));
  return (
    <div>
      <p className="text-xs font-medium text-stone-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${has(o) ? 'bg-stone-900 text-white border-stone-900' : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'}`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddSceneModal({ roomTypes, styles, onClose }) {
  const [image, setImage] = useState(null); // { dataUrl, base64, mediaType, name }
  const [fields, setFields] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(null); // room_name of the last row added

  function pickFile(file) {
    if (!file?.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = await resizeImageDataUrl(e.target.result);
      if (!dataUrl) {
        setError(`This browser can't read ${file.name}. Save it as a JPEG or PNG and try again.`);
        return;
      }
      setImage({ dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', name: file.name });
      setFields(null);
      setError(null);
      setAdded(null);
    };
    reader.readAsDataURL(file);
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/scenes/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: image.base64, mediaType: image.mediaType, roomTypes, styles }),
      });
      const json = await res.json().catch(() => ({ error: res.status === 413 ? 'Image too large, try a smaller photo' : `Server error (${res.status})` }));
      if (!res.ok || json.error) throw new Error(json.error || `Server error (${res.status})`);
      setFields(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function addToSheet() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/scenes/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: fields }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Could not add the row');
      setAdded(fields.room_name || 'Scene');
      setImage(null);
      setFields(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const setField = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-stone-100 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">Add Scene</h2>
            <p className="text-xs text-stone-500 mt-0.5">Upload a room photo. Claude fills in the scene columns, you edit them, and the row is added to the scene sheet.</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700" aria-label="Close">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-4">
          {added && (
            <p className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
              Added “{added}” to the scene sheet. Generation picks it up within about 5 minutes, once Google republishes the sheet.
            </p>
          )}

          <label
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 cursor-pointer text-center transition-colors ${image ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200 bg-stone-50 hover:bg-stone-100'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          >
            <span className="text-sm font-medium text-stone-700">{image ? image.name : 'Choose a room photo or drop it here'}</span>
            <span className="text-xs text-stone-400">From your camera roll or computer</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>

          {image && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={image.dataUrl} alt="Uploaded room" className="w-full max-h-72 object-cover rounded-xl border border-stone-200" />
          )}

          {image && (
            <button
              onClick={analyze}
              disabled={analyzing}
              className="w-full text-sm font-medium px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
            >
              {analyzing ? 'Analyzing with Claude…' : fields ? 'Re-analyze' : 'Analyze with Claude'}
            </button>
          )}

          {error && <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {fields && (
            <>
              <TagPicker label="Room types" options={roomTypes} value={fields.room_type || ''} onChange={setField('room_type')} />
              <TagPicker label="Styles" options={styles} value={fields.style_tags || ''} onChange={setField('style_tags')} />
              {ADD_SCENE_FIELDS.map(([key, label, rows]) => (
                <label key={key} className="block">
                  <span className="text-xs font-medium text-stone-500">{label}</span>
                  <textarea
                    rows={rows}
                    value={fields[key] || ''}
                    onChange={(e) => setField(key)(e.target.value)}
                    className="mt-1 w-full text-sm text-stone-800 rounded-lg border border-stone-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-stone-300 resize-y"
                  />
                </label>
              ))}
              <button
                onClick={addToSheet}
                disabled={saving || !fields.room_details?.trim()}
                className="w-full text-sm font-semibold px-4 py-2.5 rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Adding…' : 'Add to scene sheet'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Vendor demand dashboard (☰ → Vendor Demand) ─────────────────────────────

const VENDOR_TABS = [
  ['topCarried', 'Top sellers'],
  ['topNotCarried', "Don't carry"],
  ['runningLow', 'Running low'],
  ['soldOutSelling', 'Sold out'],
  ['byType', 'By type'],
  ['housekeeping', 'Cleanup'],
];

function VendorStat({ label, value, tone = 'text-stone-900' }) {
  return (
    <div className="text-right shrink-0">
      <p className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] text-stone-400">{label}</p>
    </div>
  );
}

function VendorProductRow({ row, onMakeRoom, extra }) {
  const p = row.product;
  return (
    <div className="flex items-center gap-3 py-2.5">
      {p.thumbnail
        ? <img src={p.thumbnail} alt={p.title} className="w-12 h-12 object-cover rounded-md bg-stone-100 shrink-0" />
        : <div className="w-12 h-12 rounded-md bg-stone-100 shrink-0" />}
      <div className="flex-1 min-w-0">
        <a href={`https://htgtfurniture.com/products/${p.handle}`} target="_blank" rel="noopener noreferrer" className="block text-sm text-stone-800 truncate hover:underline">{p.title}</a>
        <p className="text-[11px] text-stone-500 truncate">{p.productType || 'No type'} · SKU {row.sku}{row.notes?.length ? ` · ${row.notes.join(' / ')}` : ''}</p>
      </div>
      {extra}
      <VendorStat label="units" value={`${row.unitsOut}${row.capped ? '+' : ''}`} />
      <VendorStat label="/wk" value={row.perWeek} />
      <VendorStat label="Uttermost inv" value={row.vendorStock} tone={row.vendorStock === 0 ? 'text-red-600' : row.vendorStock <= 5 ? 'text-amber-600' : 'text-stone-900'} />
      {p.qty !== row.vendorStock && (
        <VendorStat label="Your inv" value={p.qty === 999 ? '999 (override)' : p.qty} tone="text-stone-500" />
      )}
      {onMakeRoom && (
        <button
          onClick={() => onMakeRoom([{ id: p.id, title: p.title, handle: p.handle, productType: p.productType, thumbnail: p.thumbnail }])}
          disabled={!p.hasStyle || row.vendorStock === 0}
          title={!p.hasStyle ? 'Needs a design style (custom.design_style) before it can be used in rooms' : row.vendorStock === 0 ? 'Sold out at Uttermost' : 'Generate rooms featuring this product'}
          className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:bg-stone-200 disabled:text-stone-500 transition-colors"
        >
          Make a room
        </button>
      )}
    </div>
  );
}

function VendorDemandModal({ state, onClose, onSync, onMakeRoom }) {
  const [tab, setTab] = useState('topCarried');
  const { loading, syncing, error, syncResult, data } = state;
  const maxType = data?.byType?.[0]?.unitsOut || 1;

  const counts = data?.ready ? {
    topCarried: data.topCarried.length,
    topNotCarried: data.topNotCarried.length,
    runningLow: data.runningLow.length,
    soldOutSelling: data.soldOutSelling.length,
    byType: data.byType.length,
    housekeeping: data.housekeeping.discontinuedActive.length + data.housekeeping.overrideHasStock.length,
  } : {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-stone-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Vendor Demand</h2>
              <p className="text-xs text-stone-500 mt-0.5">
                {data?.ready
                  ? `Uttermost sell-through from ${data.snapshots} daily inventory feeds, ${data.from} to ${data.to}. Units are day-over-day warehouse drops across all dealers; "+" means stock sat at the 50 cap, so real sales are higher.`
                  : 'Estimated Uttermost sell-through from the daily inventory feed emails.'}
              </p>
            </div>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-700" aria-label="Close">✕</button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {data?.ready && VENDOR_TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${tab === key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
              >
                {label}{counts[key] ? ` (${counts[key]})` : ''}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3">
              {syncResult && (
                <span className="text-xs text-stone-500">
                  {syncResult.added > 0 ? `Synced ${syncResult.added} new day${syncResult.added === 1 ? '' : 's'}` : 'Already up to date'}
                </span>
              )}
              <button
                onClick={onSync}
                disabled={syncing || loading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
              >
                {syncing ? 'Syncing…' : 'Sync feed'}
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {loading && !data && <p className="text-sm text-stone-500 py-10 text-center">Reading the feed history and your Shopify catalog…</p>}
          {data && !data.ready && (
            <p className="text-sm text-stone-500 py-10 text-center">
              Not enough feed history yet ({data.snapshots} day{data.snapshots === 1 ? '' : 's'}). Click Sync feed to pull the daily files from the Apps Script archive.
            </p>
          )}

          {data?.ready && tab === 'topCarried' && (
            <div className="divide-y divide-stone-100">
              {data.topCarried.map((r) => <VendorProductRow key={r.sku} row={r} onMakeRoom={onMakeRoom} />)}
            </div>
          )}

          {data?.ready && tab === 'topNotCarried' && (
            <div className="divide-y divide-stone-100">
              <p className="text-xs text-stone-500 pb-2">Uttermost SKUs that sell across dealers but aren't on your store. Names and photos come from uttermost.com.</p>
              {data.topNotCarried.map((r) => (
                <div key={r.sku} className="flex items-center gap-3 py-2.5">
                  {r.uttermost?.image
                    ? <img src={r.uttermost.image} alt={r.uttermost.name} className="w-12 h-12 object-cover rounded-md bg-stone-100 shrink-0" />
                    : <div className="w-12 h-12 rounded-md bg-stone-100 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    {r.uttermost?.url
                      ? <a href={r.uttermost.url} target="_blank" rel="noopener noreferrer" className="block text-sm text-stone-800 truncate hover:underline">{r.uttermost.name}</a>
                      : <p className="text-sm text-stone-800 truncate">{r.uttermost?.name ?? 'Name not found on uttermost.com'}</p>}
                    <p className="text-[11px] text-stone-500 truncate">
                      {r.uttermost?.category ? `${r.uttermost.category} · ` : ''}SKU {r.sku}{r.notes?.length ? ` · ${r.notes.join(' / ')}` : ''}
                    </p>
                  </div>
                  {r.uttermost?.nationalBestSeller && (
                    <span className="shrink-0 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">National best seller</span>
                  )}
                  <VendorStat label="units" value={`${r.unitsOut}${r.capped ? '+' : ''}`} />
                  <VendorStat label="/wk" value={r.perWeek} />
                  <VendorStat label="Uttermost inv" value={r.vendorStock} tone={r.vendorStock === 0 ? 'text-red-600' : 'text-stone-900'} />
                </div>
              ))}
            </div>
          )}

          {data?.ready && tab === 'runningLow' && (
            <div className="divide-y divide-stone-100">
              <p className="text-xs text-stone-500 pb-2">Your products selling fast enough to run out at Uttermost within 21 days. Hold off on pins and ads for these until restocked.</p>
              {data.runningLow.map((r) => (
                <VendorProductRow key={r.sku} row={r} extra={<VendorStat label="days left" value={r.daysOfCover} tone="text-amber-600" />} />
              ))}
            </div>
          )}

          {data?.ready && tab === 'soldOutSelling' && (
            <div className="divide-y divide-stone-100">
              <p className="text-xs text-stone-500 pb-2">Sold out at Uttermost now, but were selling. Good candidates to promote once they're back; restock dates are shown when Uttermost lists them.</p>
              {data.soldOutSelling.map((r) => <VendorProductRow key={r.sku} row={r} />)}
            </div>
          )}

          {data?.ready && tab === 'byType' && (
            <div className="space-y-1.5">
              <p className="text-xs text-stone-500 pb-1">
                Estimated units sold by Uttermost to all dealers, {data.from} to {data.to}, for the products you carry, grouped by your Shopify product type. Sell-through, not inventory.
              </p>
              {data.byType.map((t) => (
                <div key={t.type} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 truncate text-stone-700">{t.type}</span>
                  <div className="flex-1 h-4 bg-stone-100 rounded">
                    <div className="h-4 bg-violet-500 rounded" style={{ width: `${Math.max(1, (t.unitsOut / maxType) * 100)}%` }} />
                  </div>
                  <span className="w-20 text-right tabular-nums text-stone-800">{t.unitsOut} sold</span>
                  <span className="w-16 text-right text-[11px] text-stone-400">{t.skus} SKUs</span>
                </div>
              ))}
            </div>
          )}

          {data?.ready && tab === 'housekeeping' && (
            <div className="space-y-5 text-sm">
              <div>
                <h3 className="font-medium text-stone-800">Active on your store, discontinued by Uttermost ({data.housekeeping.discontinuedActive.length})</h3>
                {data.housekeeping.discontinuedActive.map((r) => <p key={r.sku} className="text-stone-600 mt-1">{r.product.title} <span className="text-stone-400">· SKU {r.sku}</span></p>)}
              </div>
              <div>
                <h3 className="font-medium text-stone-800">999 override, but Uttermost has 10+ in stock ({data.housekeeping.overrideHasStock.length})</h3>
                <p className="text-xs text-stone-500">The override may no longer be needed.</p>
                {data.housekeeping.overrideHasStock.map((r) => <p key={r.sku} className="text-stone-600 mt-1">{r.product.title} <span className="text-stone-400">· SKU {r.sku} · Uttermost {r.vendorStock}</span></p>)}
              </div>
              <div>
                <h3 className="font-medium text-stone-800">Active SKUs missing from the feed ({data.housekeeping.activeNotInFeed.length})</h3>
                <p className="text-xs text-stone-500">Possibly renamed or retired at Uttermost; their stock can't be tracked.</p>
                <p className="text-stone-600 mt-1">{data.housekeeping.activeNotInFeed.slice(0, 40).map((r) => r.sku).join(', ')}{data.housekeeping.activeNotInFeed.length > 40 ? ', …' : ''}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PinField({ label, value, max, hint, children }) {
  const len = (value || '').length;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-xs font-medium text-stone-500">{label}</label>
        <span className={`text-[10px] ${len > max ? 'text-red-600 font-medium' : 'text-stone-400'}`}>
          {hint && <span className="mr-1">{hint} ·</span>}{len}/{max}
        </span>
      </div>
      {children}
    </div>
  );
}

// ─── Filter select / input shared styles ──────────────────────────────────────
const selectClass =
  'text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400';
const inputClass =
  'text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400 w-48';

// ─── Product search picker ────────────────────────────────────────────────────
function ProductSearchPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchProducts = useCallback(async (q) => {
    setLoading(true);
    try {
      const url = q ? `/api/products/search?q=${encodeURIComponent(q)}` : '/api/products/search';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setHighlightIdx(-1);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProducts(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open, fetchProducts]);

  // Click-outside to close
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightIdx];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  function handleOpen() {
    if (!open) {
      setOpen(true);
      setQuery('');
      setHighlightIdx(-1);
      fetchProducts('');
    }
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && results[highlightIdx]) {
      e.preventDefault();
      select(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  function select(product) {
    onChange(product);
    setQuery('');
    setOpen(false);
  }

  function clear(e) {
    e.stopPropagation();
    onChange(null);
    setQuery('');
    // Focus the input after clearing so user can immediately search again
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center gap-2 text-sm text-stone-700 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5 h-[38px]">
          {value.thumbnail && (
            <img src={value.thumbnail + '&width=48'} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
          )}
          <span className="truncate max-w-[180px] font-medium">{value.title}</span>
          {value.productType && (
            <span className="text-xs text-amber-500 truncate max-w-[80px] hidden sm:inline">{value.productType}</span>
          )}
          <button onClick={clear} className="text-amber-400 hover:text-amber-700 ml-0.5 leading-none text-base shrink-0" title="Remove product">&times;</button>
        </div>
      ) : (
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleOpen}
            onKeyDown={handleKeyDown}
            placeholder="Pin a product…"
            className="text-sm text-stone-700 bg-white border border-stone-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400 w-48"
          />
        </div>
      )}

      {open && !value && (
        <div ref={listRef} className="absolute top-full left-0 mt-1 w-80 max-h-72 overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-lg z-30">
          {loading && results.length === 0 && (
            <div className="px-3 py-4 text-xs text-stone-400 text-center">Loading…</div>
          )}
          {loading && results.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-stone-300 text-center bg-stone-50 border-b border-stone-100 sticky top-0">Updating…</div>
          )}
          {!loading && results.length === 0 && query && (
            <div className="px-3 py-4 text-xs text-stone-400 text-center">No products match &ldquo;{query}&rdquo;</div>
          )}
          {!loading && results.length === 0 && !query && (
            <div className="px-3 py-4 text-xs text-stone-400 text-center">No products found</div>
          )}
          {results.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => select(p)}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`flex items-center gap-3 w-full px-3 py-2 transition-colors text-left ${
                idx === highlightIdx ? 'bg-stone-100' : 'hover:bg-stone-50'
              }`}
            >
              {p.thumbnail ? (
                <img src={p.thumbnail + '&width=64'} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-stone-100 shrink-0 flex items-center justify-center">
                  <svg className="w-4 h-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-700 truncate">{p.title}</div>
                {p.productType && (
                  <div className="text-xs text-stone-400 truncate">{p.productType}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tag chip input ───────────────────────────────────────────────────────────
function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState('');

  function add() {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  }

  function remove(tag) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-stone-50 border border-stone-200 rounded-lg min-h-[38px]">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-stone-200 text-stone-700 text-xs rounded-md">
          {tag}
          <button onClick={() => remove(tag)} className="text-stone-400 hover:text-stone-700 leading-none">&times;</button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-xs text-stone-700 outline-none placeholder:text-stone-400"
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Page() {
  const [mode, setMode] = useState('standard'); // 'standard' | 'fantasy' | 'pinterest'
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [styleOptions, setStyleOptions] = useState([]);
  const [roomTypeOptions, setRoomTypeOptions] = useState([]);
  const [combinationNames, setCombinationNames] = useState([]);
  const [accessoriesList, setAccessoriesList] = useState([]);
  const [roomNameOptions, setRoomNameOptions] = useState([]);
  const [filters, setFilters] = useState({
    designStyle: '',
    roomType: '',
    roomName: '',
    lighting: '',
    camera: '',
    count: '',
    productCount: 3,
    featuredProducts: [null, null, null],
  });

  // ── Hamburger menu ──────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [criteria, setCriteria] = useState(null);   // null = not yet loaded
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  const [criteriaSaved, setCriteriaSaved] = useState(false);
  const [criteriaError, setCriteriaError] = useState(null);
  const [accessoriesOpen, setAccessoriesOpen] = useState(false);
  const [accessoriesInput, setAccessoriesInput] = useState('');
  const [accessoriesSaving, setAccessoriesSaving] = useState(false);
  const [accessoriesSaved, setAccessoriesSaved] = useState(false);
  const [accessoriesError, setAccessoriesError] = useState(null);
  const [hashtagsOpen, setHashtagsOpen] = useState(false);
  const [hashtagsInput, setHashtagsInput] = useState('');
  const [hashtagsFilter, setHashtagsFilter] = useState('');
  const [hashtagsSaving, setHashtagsSaving] = useState(false);
  const [hashtagsSaved, setHashtagsSaved] = useState(false);
  const [hashtagsError, setHashtagsError] = useState(null);
  // Pinterest state
  const [pinterestOpen, setPinterestOpen] = useState(false);
  const [pinterestStatus, setPinterestStatus] = useState(null); // { connected, hasCredentials, valid, username, reason }
  const [pinterestBoards, setPinterestBoards] = useState([]);
  const [pinterestBoard, setPinterestBoard] = useState(''); // selected board ID
  const [pinterestLoading, setPinterestLoading] = useState(false);
  const [pinterestTokenInput, setPinterestTokenInput] = useState('');
  const [pinterestTokenError, setPinterestTokenError] = useState(null);
  // Pins saved to post later
  const [savedPinsOpen, setSavedPinsOpen] = useState(false);
  // Pin suggestions: null = closed, otherwise { loading, error, data }
  const [suggestions, setSuggestions] = useState(null);
  // Vendor demand dashboard: null = closed, otherwise { open, loading, syncing, error, syncResult, data }
  const [vendorDemand, setVendorDemand] = useState(null);
  const [addSceneOpen, setAddSceneOpen] = useState(false);
  const [savedPins, setSavedPins] = useState([]);
  const [savedPinDraft, setSavedPinDraft] = useState(null); // draft open in the review modal, has .id
  const [savedPinBusy, setSavedPinBusy] = useState(null); // 'posting' | 'saving' | null
  const [savedPinError, setSavedPinError] = useState(null);
  const [savedPinNotice, setSavedPinNotice] = useState(null); // { pinUrl } after a successful post
  // Pinterest debug log
  const [pinLogs, setPinLogs] = useState([]);
  const [pinLogOpen, setPinLogOpen] = useState(false);
  const pinLog = useCallback((level, msg, data) => {
    const entry = { ts: new Date().toLocaleTimeString(), level, msg, data: data ?? null };
    setPinLogs((prev) => [...prev.slice(-99), entry]);
    if (level === 'error') console.error(`[pin] ${msg}`, data);
    else console.log(`[pin] ${msg}`, data ?? '');
  }, []);

  const fetchSavedPins = useCallback(async () => {
    try {
      const res = await fetch('/api/pinterest/saved');
      if (res.ok) setSavedPins(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSavedPins(); }, [fetchSavedPins]);

  async function openSavedPin(pin) {
    setMenuOpen(false);
    setSavedPinError(null);
    setSavedPinNotice(null);
    setSavedPinDraft({
      id: pin.id,
      imageUrl: `/api/pinterest/saved/${pin.id}/image`,
      title: pin.title, body: pin.body, hashtags: pin.hashtags, topics: pin.topics || '', pattern: pin.pattern || null, altText: pin.altText,
      link: pin.link || '', boardId: pin.boardId || '',
      library: criteria?.pinterestHashtags ?? [], loading: false, error: null,
      products: pin.tagProducts ?? [],
    });
    // Board list and hashtag library may not be loaded yet if the Pinterest / hashtag panels were never opened
    if (pinterestBoards.length === 0 && pinterestStatus?.connected) {
      fetch('/api/pinterest/boards').then((r) => (r.ok ? r.json() : [])).then(setPinterestBoards).catch(() => {});
    }
    if (!criteria) {
      fetch('/api/config').then((r) => r.json()).then((c) => {
        setCriteria(c);
        setSavedPinDraft((d) => d && ({ ...d, library: c.pinterestHashtags ?? [] }));
      }).catch(() => {});
    }
  }

  function savedPinFields(draft) {
    const { title, body, hashtags, topics, pattern, altText, link, boardId, products } = draft;
    return { title, body, hashtags, topics, pattern, altText, link, boardId, tagProducts: products ?? [] };
  }

  async function saveSavedPinChanges(draft) {
    setSavedPinBusy('saving');
    setSavedPinError(null);
    try {
      const res = await fetch(`/api/pinterest/saved/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedPinFields(draft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setSavedPinDraft(null);
      await fetchSavedPins();
    } catch (err) {
      setSavedPinError(err.message);
    } finally {
      setSavedPinBusy(null);
    }
  }

  async function postSavedPin(draft) {
    setSavedPinBusy('posting');
    setSavedPinError(null);
    try {
      const res = await fetch(`/api/pinterest/saved/${draft.id}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedPinFields(draft)),
      });
      const data = await res.json();
      if (!res.ok) {
        pinLog('error', `Saved pin post failed: ${data.error}`, data);
        setSavedPinError(pinErrorText(pinErrorCode(data)));
        if (data.authError) fetchPinterestStatus();
        await fetchSavedPins(); // edits were stored before posting
        return;
      }
      pinLog('info', `Saved pin posted: ${data.pinUrl}`, data);
      setSavedPinDraft(null);
      setSavedPinNotice({ pinUrl: data.pinUrl, tagSummary: pinTagSummary(data.tagging) });
      await fetchSavedPins();
    } catch (err) {
      setSavedPinError(err.message);
    } finally {
      setSavedPinBusy(null);
    }
  }

  async function deleteSavedPin(pin) {
    if (!confirm(`Delete saved pin "${pin.title || 'Untitled'}"?`)) return;
    await fetch(`/api/pinterest/saved/${pin.id}`, { method: 'DELETE' }).catch(() => {});
    await fetchSavedPins();
  }

  async function openMenu() {
    setMenuOpen(true);
    if (!criteria) {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        setCriteria(data);
      } catch {
        setCriteria({ includeVendors: [], excludeTags: [], requireInventory: true, maxImagesPerProduct: 3 });
      }
    }
  }

  async function saveCriteria() {
    setCriteriaSaving(true);
    setCriteriaSaved(false);
    setCriteriaError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criteria),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setCriteria(data);
      setCriteriaSaved(true);
      setTimeout(() => setCriteriaSaved(false), 2500);
    } catch (err) {
      setCriteriaError(err.message);
    } finally {
      setCriteriaSaving(false);
    }
  }

  async function saveAccessories() {
    setAccessoriesSaving(true);
    setAccessoriesSaved(false);
    setAccessoriesError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessories: criteria.accessories }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setCriteria((c) => ({ ...c, accessories: data.accessories }));
      setAccessoriesSaved(true);
      setTimeout(() => setAccessoriesSaved(false), 2500);
    } catch (err) {
      setAccessoriesError(err.message);
    } finally {
      setAccessoriesSaving(false);
    }
  }

  function addHashtags(text) {
    const parsed = parseHashtags(text);
    if (!parsed.length) return;
    setCriteria((c) => ({ ...c, pinterestHashtags: dedupeHashtags([...(c.pinterestHashtags ?? []), ...parsed]) }));
  }

  async function uploadHashtagFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    addHashtags(await file.text());
  }

  async function saveHashtags() {
    setHashtagsSaving(true);
    setHashtagsSaved(false);
    setHashtagsError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinterestHashtags: criteria.pinterestHashtags ?? [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setCriteria((c) => ({ ...c, pinterestHashtags: data.pinterestHashtags }));
      setHashtagsSaved(true);
      setTimeout(() => setHashtagsSaved(false), 2500);
    } catch (err) {
      setHashtagsError(err.message);
    } finally {
      setHashtagsSaving(false);
    }
  }

  // Fetch Pinterest status on mount and when window regains focus (after OAuth redirect)
  const fetchPinterestStatus = useCallback(async () => {
    pinLog('info', 'Checking Pinterest status…');
    try {
      const res = await fetch('/api/pinterest/status?validate=1');
      const data = await res.json();
      setPinterestStatus(data);
      pinLog(data.valid === false ? 'warn' : 'info', `Status: connected=${data.connected} valid=${data.valid} user=${data.username ?? '—'} host=${data.apiHost ?? '—'}`, data);
      if (data.valid && data.canWrite === false) {
        pinLog('warn', 'Token is READ-ONLY — missing write scopes. Use OAuth "Connect to Pinterest" to get write access.');
      } else if (data.valid && data.canWrite) {
        pinLog('info', `Scopes: ${(data.scopes || []).join(', ')}`);
      }
      if (data.connected && data.valid !== false && pinterestBoards.length === 0) {
        pinLog('info', 'Fetching boards…');
        const bRes = await fetch('/api/pinterest/boards');
        if (bRes.ok) {
          const boards = await bRes.json();
          setPinterestBoards(boards);
          pinLog('info', `Loaded ${boards.length} board(s)`);
        } else {
          pinLog('error', `Boards fetch failed: ${bRes.status}`);
        }
      }
    } catch (err) {
      pinLog('error', 'Status check failed', err.message);
    }
  }, [pinterestBoards.length, pinLog]);

  useEffect(() => {
    fetchPinterestStatus();
    const onFocus = () => fetchPinterestStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchPinterestStatus]);

  useEffect(() => {
    fetch('/api/options')
      .then((r) => r.json())
      .then((data) => {
        setStyleOptions(data.styles ?? []);
        setRoomTypeOptions(data.roomTypes ?? []);
        setRoomNameOptions(data.roomNames ?? []);
        setCombinationNames(data.combinationNames ?? []);
        setAccessoriesList(data.accessoriesList ?? []);
      })
      .catch(() => {});
  }, []);

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function clearFilters() {
    setFilters({ designStyle: '', roomType: '', roomName: '', lighting: '', camera: '', count: '', productCount: 3, featuredProducts: [null, null, null] });
  }

  const hasActiveFilters =
    !!(filters.designStyle || filters.roomType || filters.roomName || filters.lighting || filters.camera || filters.count || filters.featuredProducts.some(p => p)) ||
    filters.productCount !== 3;

  async function loadSuggestions(refresh = false) {
    setSuggestions((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/pinterest/suggestions${refresh ? '?refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load suggestions');
      setSuggestions({ loading: false, error: null, data });
    } catch (err) {
      setSuggestions((s) => ({ ...s, loading: false, error: err.message }));
    }
  }

  async function loadVendorDemand(refresh = false) {
    setVendorDemand((v) => ({ ...v, open: true, loading: true, error: null }));
    try {
      const res = await fetch(`/api/vendor/demand${refresh ? '?refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load vendor demand');
      setVendorDemand((v) => ({ ...v, loading: false, data }));
    } catch (err) {
      setVendorDemand((v) => ({ ...v, loading: false, error: err.message }));
    }
  }

  async function syncVendorFeed() {
    setVendorDemand((v) => ({ ...v, syncing: true, error: null, syncResult: null }));
    try {
      const res = await fetch('/api/vendor/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      setVendorDemand((v) => ({ ...v, syncing: false, syncResult: data }));
      if (data.added > 0) await loadVendorDemand(true);
    } catch (err) {
      setVendorDemand((v) => ({ ...v, syncing: false, error: err.message }));
    }
  }

  function openVendorDemand() {
    setMenuOpen(false);
    if (vendorDemand?.data) setVendorDemand((v) => ({ ...v, open: true }));
    else loadVendorDemand();
  }

  function openSuggestions() {
    setMenuOpen(false);
    setSuggestions((s) => ({ ...(s ?? { loading: true }), open: true }));
    if (!suggestions?.data) loadSuggestions();
  }

  // Feature the suggested products (up to the 3 featured slots) and generate rooms around them
  function makeRoomFrom(products) {
    const slots = [...products.slice(0, 3).map(({ id, title, handle, productType, thumbnail }) => ({ id, title, handle, productType, thumbnail }))];
    while (slots.length < 3) slots.push(null);
    const next = { ...filters, featuredProducts: slots };
    setFilters(next);
    setSuggestions((s) => (s ? { ...s, open: false } : s));
    setVendorDemand((v) => (v ? { ...v, open: false } : v));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    generate(next);
  }

  async function generate(source = filters) {
    setLoading(true);
    setError(null);
    setRooms([]);

    const activeFilters = Object.fromEntries(
      Object.entries(source).filter(([k, v]) => {
        if (k === 'featuredProducts') return false; // handled below
        return String(v).trim();
      })
    );
    const nonEmptyHandles = source.featuredProducts.filter(p => p).map(p => p.handle);
    if (nonEmptyHandles.length > 0) activeFilters.featuredProducts = nonEmptyHandles;
    if (mode !== 'standard') activeFilters.mode = mode;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: activeFilters }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setRooms(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <main className="max-w-7xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
            HTGT Room Ideas
          </h1>
          <p className="mt-2 text-stone-500 text-sm">
            Generates cohesive room vignettes from your Uttermost catalog — one per design style — with Higgsfield-ready prompts and reference images.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mode toggle */}
          <button
            onClick={() => setMode((m) => m === 'standard' ? 'fantasy' : m === 'fantasy' ? 'pinterest' : 'standard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              mode === 'pinterest'
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : mode === 'fantasy'
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {mode === 'pinterest' ? (
              <PinterestIcon className="w-4 h-4" />
            ) : mode === 'fantasy' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            ) : null}
            {mode === 'pinterest' ? 'Pinterest Mode' : mode === 'fantasy' ? 'Fantasy Mode' : 'Standard Mode'}
          </button>

          {/* Hamburger menu */}
          <div className="relative">
            <button
              onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
              className="flex flex-col justify-center items-center w-9 h-9 rounded-lg bg-stone-100 hover:bg-stone-200 transition-colors gap-1"
              aria-label="Menu"
            >
              <span className="block w-4 h-0.5 bg-stone-600 rounded-full" />
              <span className="block w-4 h-0.5 bg-stone-600 rounded-full" />
              <span className="block w-4 h-0.5 bg-stone-600 rounded-full" />
            </button>

            {menuOpen && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />

                {/* Dropdown */}
                <div className="absolute right-0 top-11 z-20 w-80 bg-white rounded-2xl shadow-lg border border-stone-200 overflow-hidden">
                  {/* Criteria row */}
                  <button
                    onClick={() => setCriteriaOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                  >
                    <span className="text-sm font-medium text-stone-700">Query Criteria</span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${criteriaOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Criteria panel */}
                  {criteriaOpen && criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 space-y-4">
                      <p className="text-xs text-stone-400">
                        Controls which Shopify products are pulled when building rooms. Changes take effect on the next Generate.
                      </p>

                      {/* Vendors */}
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Include vendors
                        </label>
                        <TagInput
                          tags={criteria.includeVendors ?? []}
                          onChange={(v) => setCriteria((c) => ({ ...c, includeVendors: v }))}
                          placeholder="Type vendor name, press Enter…"
                        />
                        <p className="text-xs text-stone-400 mt-1">Leave empty to include all vendors.</p>
                      </div>

                      {/* Excluded tags */}
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Exclude tags
                        </label>
                        <TagInput
                          tags={criteria.excludeTags ?? []}
                          onChange={(v) => setCriteria((c) => ({ ...c, excludeTags: v }))}
                          placeholder="Type tag, press Enter…"
                        />
                      </div>

                      {/* Require inventory */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-stone-500">Require inventory</p>
                          <p className="text-xs text-stone-400">Skip products with zero stock</p>
                        </div>
                        <button
                          onClick={() => setCriteria((c) => ({ ...c, requireInventory: !c.requireInventory }))}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                            criteria.requireInventory ? 'bg-stone-800' : 'bg-stone-300'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
                            criteria.requireInventory ? 'translate-x-4' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </div>

                      {/* Max images */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-stone-500">Max images per product</p>
                          <p className="text-xs text-stone-400">Used in download ZIP and Higgsfield prompt</p>
                        </div>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={criteria.maxImagesPerProduct ?? 3}
                          onChange={(e) => setCriteria((c) => ({ ...c, maxImagesPerProduct: parseInt(e.target.value, 10) || 1 }))}
                          className="w-14 text-sm text-center text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-stone-400"
                        />
                      </div>

                      {/* How it works */}
                      <div className="border-t border-stone-100 pt-4 space-y-2">
                        <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">How room building works</p>
                        <div className="text-[11px] text-stone-400 space-y-1.5 leading-relaxed">
                          <p><span className="font-medium text-stone-500">1. Product pull:</span> All products matching the vendor, tag, and inventory filters above are fetched from Shopify. Products must also have a <code className="bg-stone-100 px-1 rounded text-[10px]">custom.design_style</code> metafield or they are skipped.</p>
                          <p><span className="font-medium text-stone-500">2. Style grouping:</span> Products are grouped by their design style (e.g. Coastal, Modern). Each room is built from products that share a style.</p>
                          <p><span className="font-medium text-stone-500">3. Combination matching:</span> Each room follows a product type combination from <code className="bg-stone-100 px-1 rounded text-[10px]">config.json</code> (e.g. &ldquo;Entryway&rdquo; = Console Tables + Mirrors + Table Lamps). The combo defines which <code className="bg-stone-100 px-1 rounded text-[10px]">productType</code> slots to fill. If no products exist for a required type in a given style, that combo is skipped.</p>
                          <p><span className="font-medium text-stone-500">4. Scoring:</span> Multiple candidate sets are sampled, then scored by shared styles and materials between products. A top-tier set is picked randomly so rooms are cohesive but vary each run.</p>
                          <p><span className="font-medium text-stone-500">5. Uniqueness:</span> Each product appears in at most one room per generate. Once assigned, it is excluded from subsequent rooms.</p>
                        </div>
                      </div>

                      {/* Save */}
                      {criteriaError && (
                        <p className="text-xs text-red-600">{criteriaError}</p>
                      )}
                      <button
                        onClick={saveCriteria}
                        disabled={criteriaSaving}
                        className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                          criteriaSaved
                            ? 'bg-green-100 text-green-800'
                            : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                        }`}
                      >
                        {criteriaSaved ? 'Saved' : criteriaSaving ? 'Saving…' : 'Save Criteria'}
                      </button>
                    </div>
                  )}

                  {/* Loading state */}
                  {criteriaOpen && !criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 text-xs text-stone-400">
                      Loading…
                    </div>
                  )}

                  {/* Accessories row */}
                  <button
                    onClick={() => setAccessoriesOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700">Accessories</span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${accessoriesOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Accessories panel */}
                  {accessoriesOpen && criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 space-y-3">
                      <p className="text-xs text-stone-400">
                        Each generate randomly picks 1–2 from this list and appends them to the scene description.
                      </p>

                      {/* Existing entries */}
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {(criteria.accessories ?? []).map((item, i) => (
                          <div key={i} className="flex items-start gap-2 group">
                            <p className="flex-1 text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 font-mono leading-relaxed">
                              {item}
                            </p>
                            <button
                              onClick={() => setCriteria((c) => ({
                                ...c,
                                accessories: c.accessories.filter((_, j) => j !== i),
                              }))}
                              className="shrink-0 mt-1.5 text-stone-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              title="Remove"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        {(criteria.accessories ?? []).length === 0 && (
                          <p className="text-xs text-stone-300 italic">No accessories yet.</p>
                        )}
                      </div>

                      {/* Add new */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={accessoriesInput}
                          onChange={(e) => setAccessoriesInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && accessoriesInput.trim()) {
                              setCriteria((c) => ({
                                ...c,
                                accessories: [...(c.accessories ?? []), accessoriesInput.trim()],
                              }));
                              setAccessoriesInput('');
                            }
                          }}
                          placeholder="A white Porsche GT3 is visible through the windows."
                          className="flex-1 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 font-mono placeholder:text-stone-400"
                        />
                        <button
                          onClick={() => {
                            if (accessoriesInput.trim()) {
                              setCriteria((c) => ({
                                ...c,
                                accessories: [...(c.accessories ?? []), accessoriesInput.trim()],
                              }));
                              setAccessoriesInput('');
                            }
                          }}
                          className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                        >
                          Add
                        </button>
                      </div>

                      {/* Save */}
                      {accessoriesError && (
                        <p className="text-xs text-red-600">{accessoriesError}</p>
                      )}
                      <button
                        onClick={saveAccessories}
                        disabled={accessoriesSaving}
                        className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                          accessoriesSaved
                            ? 'bg-green-100 text-green-800'
                            : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                        }`}
                      >
                        {accessoriesSaved ? 'Saved' : accessoriesSaving ? 'Saving…' : 'Save Accessories'}
                      </button>
                    </div>
                  )}

                  {/* Pin suggestions row */}
                  <button
                    onClick={openSuggestions}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700">Pin Suggestions</span>
                    <span className="text-[10px] text-stone-400">What to pin next</span>
                  </button>

                  {/* Add scene row */}
                  <button
                    onClick={() => { setAddSceneOpen(true); setMenuOpen(false); }}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700">Add Scene</span>
                    <span className="text-[10px] text-stone-400">From a room photo</span>
                  </button>

                  {/* Vendor demand row */}
                  <button
                    onClick={openVendorDemand}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700">Vendor Demand</span>
                    <span className="text-[10px] text-stone-400">Uttermost sell-through</span>
                  </button>

                  {/* Saved pins row */}
                  <button
                    onClick={() => setSavedPinsOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700 flex items-center gap-2">
                      Saved Pins
                      {savedPins.length > 0 && (
                        <span className="text-[10px] font-medium text-white bg-rose-600 rounded-full px-1.5 py-0.5 leading-none">{savedPins.length}</span>
                      )}
                    </span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${savedPinsOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Saved pins panel */}
                  {savedPinsOpen && (
                    <div className="border-t border-stone-100 px-4 py-3 space-y-2 max-h-96 overflow-y-auto">
                      {savedPins.length === 0 && (
                        <p className="text-xs text-stone-300 italic">No saved pins. Use “Save for later” in the pin review.</p>
                      )}
                      {savedPins.map((pin) => (
                        <div key={pin.id} className="flex gap-3 items-start group">
                          <button onClick={() => openSavedPin(pin)} className="shrink-0" title="Review & post">
                            <img
                              src={`/api/pinterest/saved/${pin.id}/image`}
                              alt={pin.altText || pin.title}
                              className="w-12 h-[72px] object-cover rounded-md bg-stone-100"
                            />
                          </button>
                          <div className="flex-1 min-w-0">
                            <button onClick={() => openSavedPin(pin)} className="block text-left w-full">
                              <p className="text-xs font-medium text-stone-700 line-clamp-2">{pin.title || 'Untitled pin'}</p>
                              <p className="text-[10px] text-stone-400 mt-0.5">
                                {pin.roomName ? `${pin.roomName} · ` : ''}{new Date(pin.savedAt).toLocaleDateString()}
                              </p>
                            </button>
                            <div className="flex gap-3 mt-1">
                              <button onClick={() => openSavedPin(pin)} className="text-[11px] font-medium text-rose-600 hover:underline">
                                Review & post
                              </button>
                              <button onClick={() => deleteSavedPin(pin)} className="text-[11px] text-stone-400 hover:text-red-500">
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pinterest hashtags row */}
                  <button
                    onClick={() => setHashtagsOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700 flex items-center gap-2">
                      Pinterest Hashtags
                      {(criteria?.pinterestHashtags ?? []).length > 0 && (
                        <span className="text-[10px] font-normal text-stone-400">{criteria.pinterestHashtags.length}</span>
                      )}
                    </span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${hashtagsOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Pinterest hashtags panel */}
                  {hashtagsOpen && criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 space-y-3">
                      <p className="text-xs text-stone-400">
                        Each pin gets up to 3 specific hashtags picked from this library to match the room. Leave it empty to let Claude write its own.
                      </p>

                      {/* Add / paste */}
                      <textarea
                        value={hashtagsInput}
                        onChange={(e) => setHashtagsInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            addHashtags(hashtagsInput);
                            setHashtagsInput('');
                          }
                        }}
                        rows={2}
                        placeholder="#IndustrialDecor #LoftLiving, mid century modern…"
                        className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 font-mono placeholder:text-stone-400 resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { addHashtags(hashtagsInput); setHashtagsInput(''); }}
                          disabled={!hashtagsInput.trim()}
                          className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 disabled:opacity-50 transition-colors"
                        >
                          Add
                        </button>
                        <label className="flex-1 text-center cursor-pointer text-xs font-medium px-3 py-2 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors">
                          Upload .txt / .csv
                          <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={uploadHashtagFile} className="hidden" />
                        </label>
                      </div>

                      {/* Library */}
                      {(criteria.pinterestHashtags ?? []).length > 8 && (
                        <input
                          type="text"
                          value={hashtagsFilter}
                          onChange={(e) => setHashtagsFilter(e.target.value)}
                          placeholder="Filter…"
                          className="w-full text-xs text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
                        />
                      )}
                      <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
                        {(criteria.pinterestHashtags ?? [])
                          .filter((t) => t.toLowerCase().includes(hashtagsFilter.trim().toLowerCase().replace(/^#/, '')))
                          .map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-1 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-full pl-2.5 pr-1 py-0.5">
                              {tag}
                              <button
                                onClick={() => setCriteria((c) => ({
                                  ...c,
                                  pinterestHashtags: c.pinterestHashtags.filter((t) => t !== tag),
                                }))}
                                className="text-rose-300 hover:text-red-600 transition-colors"
                                title="Remove"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          ))}
                        {(criteria.pinterestHashtags ?? []).length === 0 && (
                          <p className="text-xs text-stone-300 italic">No hashtags yet.</p>
                        )}
                      </div>
                      {(criteria.pinterestHashtags ?? []).length > 0 && (
                        <button
                          onClick={() => { if (confirm('Remove all hashtags from the library?')) setCriteria((c) => ({ ...c, pinterestHashtags: [] })); }}
                          className="text-xs text-stone-400 hover:text-red-500 transition-colors"
                        >
                          Clear all
                        </button>
                      )}

                      {/* Save */}
                      {hashtagsError && (
                        <p className="text-xs text-red-600">{hashtagsError}</p>
                      )}
                      <button
                        onClick={saveHashtags}
                        disabled={hashtagsSaving}
                        className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                          hashtagsSaved
                            ? 'bg-green-100 text-green-800'
                            : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                        }`}
                      >
                        {hashtagsSaved ? 'Saved' : hashtagsSaving ? 'Saving…' : 'Save Hashtags'}
                      </button>
                    </div>
                  )}

                  {/* Pinterest row */}
                  <button
                    onClick={() => setPinterestOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700 flex items-center gap-2">
                      <PinterestIcon className="w-4 h-4 text-rose-500" />
                      Pinterest
                      {pinterestStatus?.connected && pinterestStatus?.valid !== false && (
                        <span className={`w-2 h-2 rounded-full inline-block ${pinterestStatus.canWrite === false ? 'bg-amber-500' : 'bg-green-500'}`} title={pinterestStatus.canWrite === false ? 'Read-only' : 'Connected'} />
                      )}
                      {pinterestStatus?.connected && pinterestStatus?.valid === false && (
                        <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" title="Session expired" />
                      )}
                    </span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${pinterestOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Pinterest panel */}
                  {pinterestOpen && (
                    <div className="border-t border-stone-100 px-4 py-4 space-y-3">
                      {/* Expired session warning */}
                      {pinterestStatus?.connected && pinterestStatus?.valid === false && (
                        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          <span>Session expired{pinterestStatus.reason ? ` (${pinterestStatus.reason})` : ''} — reconnect or paste a new token below.</span>
                        </div>
                      )}

                      {/* Connected + valid */}
                      {pinterestStatus?.connected && pinterestStatus?.valid !== false && (
                        <>
                          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${pinterestStatus.canWrite === false ? 'text-amber-700 bg-amber-50' : 'text-green-700 bg-green-50'}`}>
                            <span className={`w-2 h-2 rounded-full ${pinterestStatus.canWrite === false ? 'bg-amber-500' : 'bg-green-500'}`} />
                            <span>
                              Connected to Pinterest{pinterestStatus.username ? ` as ${pinterestStatus.username}` : ''}
                              {pinterestStatus.canWrite === false && <><br /><strong>Read-only token</strong> — use OAuth below to get write access</>}
                            </span>
                          </div>

                          {/* Board picker */}
                          <div>
                            <label className="block text-xs font-medium text-stone-500 mb-1.5">Board</label>
                            <select
                              value={pinterestBoard}
                              onChange={(e) => setPinterestBoard(e.target.value)}
                              className="w-full text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400"
                            >
                              <option value="">Select a board…</option>
                              {pinterestBoards.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                            {pinterestBoards.length === 0 && (
                              <button
                                onClick={async () => {
                                  setPinterestLoading(true);
                                  try {
                                    const res = await fetch('/api/pinterest/boards');
                                    if (res.ok) setPinterestBoards(await res.json());
                                  } catch { /* ignore */ }
                                  finally { setPinterestLoading(false); }
                                }}
                                disabled={pinterestLoading}
                                className="text-xs text-rose-600 hover:underline mt-1"
                              >
                                {pinterestLoading ? 'Loading boards…' : 'Refresh boards'}
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {/* OAuth connect button — shown when disconnected or expired */}
                      {(!pinterestStatus?.connected || pinterestStatus?.valid === false) && pinterestStatus?.hasCredentials && (
                        <button
                          onClick={async () => {
                            setPinterestLoading(true);
                            try {
                              const res = await fetch('/api/pinterest/auth');
                              const data = await res.json();
                              if (data.authUrl) window.open(data.authUrl, '_blank');
                            } catch { /* ignore */ }
                            finally { setPinterestLoading(false); }
                          }}
                          disabled={pinterestLoading}
                          className="w-full text-sm font-medium py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                        >
                          <PinterestIcon className="w-4 h-4" />
                          {pinterestLoading ? 'Loading…' : pinterestStatus?.connected ? 'Reconnect to Pinterest' : 'Connect to Pinterest'}
                        </button>
                      )}

                      {/* No credentials hint */}
                      {!pinterestStatus?.hasCredentials && !pinterestStatus?.connected && (
                        <p className="text-xs text-stone-400">
                          Add <code className="bg-stone-100 px-1 rounded text-[10px]">PINTEREST_APP_ID</code> and <code className="bg-stone-100 px-1 rounded text-[10px]">PINTEREST_APP_SECRET</code> to <code className="bg-stone-100 px-1 rounded text-[10px]">.env.local</code> to enable OAuth, or paste a token below.
                        </p>
                      )}

                      {/* Manual token input — always available */}
                      <div className="border-t border-stone-100 pt-3">
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Paste access token
                        </label>
                        <p className="text-[10px] text-stone-400 mb-1.5">
                          From the Pinterest developer dashboard. Works without OAuth app credentials.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={pinterestTokenInput}
                            onChange={(e) => { setPinterestTokenInput(e.target.value); setPinterestTokenError(null); }}
                            placeholder="pina_…"
                            className="flex-1 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 font-mono placeholder:text-stone-400"
                          />
                          <button
                            onClick={async () => {
                              if (!pinterestTokenInput.trim()) return;
                              setPinterestLoading(true);
                              setPinterestTokenError(null);
                              pinLog('info', 'Saving token from menu…');
                              try {
                                const res = await fetch('/api/pinterest/token', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ accessToken: pinterestTokenInput.trim() }),
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error ?? 'Save failed');
                                if (!data.valid) {
                                  pinLog('warn', `Token invalid: ${data.reason}`, data);
                                  setPinterestTokenError(`Token saved but invalid: ${data.reason || 'unknown error'}`);
                                } else {
                                  pinLog('info', `Token valid: user=${data.username ?? '—'}`, data);
                                  setPinterestTokenInput('');
                                }
                                // Refresh status either way
                                await fetchPinterestStatus();
                              } catch (err) {
                                pinLog('error', `Token save error: ${err.message}`);
                                setPinterestTokenError(err.message);
                              } finally {
                                setPinterestLoading(false);
                              }
                            }}
                            disabled={pinterestLoading || !pinterestTokenInput.trim()}
                            className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
                          >
                            {pinterestLoading ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        {pinterestTokenError && (
                          <p className="text-xs text-red-600 mt-1.5">{pinterestTokenError}</p>
                        )}
                      </div>

                      {/* Disconnect — shown when connected */}
                      {pinterestStatus?.connected && (
                        <button
                          onClick={async () => {
                            try {
                              await fetch('/api/pinterest/disconnect', { method: 'POST' });
                              setPinterestStatus({ ...pinterestStatus, connected: false, valid: undefined, username: undefined });
                              setPinterestBoards([]);
                              setPinterestBoard('');
                            } catch { /* ignore */ }
                          }}
                          className="text-xs text-stone-400 hover:text-red-500 transition-colors"
                        >
                          Disconnect Pinterest
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fantasy mode banner */}
      {mode === 'fantasy' && (
        <div className="mb-6 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-3 text-sm text-indigo-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span>Fantasy mode — scene templates are drawn from rows tagged with &ldquo;Fantasy&rdquo; in column K (styles).</span>
        </div>
      )}

      {/* Pinterest mode banner */}
      {mode === 'pinterest' && (
        <div className="mb-6 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-sm text-rose-700">
          <PinterestIcon className="w-4 h-4 shrink-0" />
          <span>Pinterest mode — Shopify publishing is disabled. Create Image lets you pick Pinterest (2:3), Portrait (4:5), or Reel (9:16); pins can be saved locally, saved for later, or posted directly.</span>
        </div>
      )}

      {/* Featured product banner */}
      {filters.featuredProducts.some(p => p) && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-sm text-amber-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          <span>Featured product mode —{' '}
            {filters.featuredProducts.filter(p => p).map((p, i) => (
              <span key={i}>{i > 0 && ', '}<code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">{p.title}</code></span>
            ))} will appear in every generated room.</span>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 p-4 bg-white border border-stone-200 rounded-xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-stone-500 uppercase tracking-wide mr-1">
            Pin
          </span>

          <select
            value={filters.designStyle}
            onChange={(e) => setFilter('designStyle', e.target.value)}
            className={selectClass}
          >
            <option value="">Any style</option>
            {styleOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={filters.roomType}
            onChange={(e) => setFilter('roomType', e.target.value)}
            className={selectClass}
          >
            <option value="">Any room type</option>
            {roomTypeOptions.map((t, i) => (
              <option key={`${t}-${i}`} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={filters.roomName}
            onChange={(e) => setFilter('roomName', e.target.value)}
            className={selectClass}
          >
            <option value="">Any scene</option>
            {roomNameOptions.map((n, i) => (
              <option key={`${n}-${i}`} value={n}>{n}</option>
            ))}
          </select>

          <input
            type="text"
            value={filters.lighting}
            onChange={(e) => setFilter('lighting', e.target.value)}
            placeholder="Lighting override…"
            className={inputClass}
          />

          <input
            type="text"
            value={filters.camera}
            onChange={(e) => setFilter('camera', e.target.value)}
            placeholder="Camera override…"
            className={inputClass}
          />

          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide whitespace-nowrap">
              Featured
            </span>
            {filters.featuredProducts.map((picked, idx) => (
              <ProductSearchPicker
                key={`fp-${idx}`}
                value={picked}
                onChange={(p) => {
                  const next = [...filters.featuredProducts];
                  next[idx] = p;
                  setFilter('featuredProducts', next);
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide whitespace-nowrap">
              # Rooms
            </span>
            <input
              type="number"
              min="1"
              max="50"
              value={filters.count}
              onChange={(e) => setFilter('count', e.target.value)}
              placeholder="Default"
              className="text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400 w-24"
            />
          </div>

          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide whitespace-nowrap">
              Products
            </span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setFilter('productCount', n)}
                  className={`w-7 h-7 text-xs font-medium rounded-md transition-colors ${
                    filters.productCount === n
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors ml-1"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-4 mb-10">
        <button
          onClick={() => generate()}
          disabled={loading}
          className="px-6 py-3 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {loading ? 'Fetching rooms…' : rooms.length > 0 ? 'Regenerate Rooms' : 'Generate Rooms'}
        </button>

        {rooms.length > 0 && !loading && (
          <span className="text-sm text-stone-400">
            {rooms.length} room{rooms.length !== 1 ? 's' : ''} generated
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-stone-200 h-96 animate-pulse" />
          ))}
        </div>
      )}

      {/* Room cards */}
      {!loading && rooms.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {rooms.map((room, i) => (
            <RoomCard key={`${room.style}-${i}`} room={room} mode={mode} combinationNames={combinationNames} accessoriesList={accessoriesList} featuredProductHandles={filters.featuredProducts.filter(p => p).map(p => p.handle)} pinterestConnected={!!(pinterestStatus?.connected && pinterestStatus?.valid !== false)} pinterestBoard={pinterestBoard || null} pinterestBoards={pinterestBoards} onPinSavedForLater={fetchSavedPins} onPinterestAuthError={fetchPinterestStatus} pinLog={pinLog} />
          ))}
        </div>
      )}

      {/* Pin suggestions */}
      {suggestions && suggestions.open !== false && (
        <PinSuggestionsModal
          state={suggestions}
          onClose={() => setSuggestions((s) => ({ ...s, open: false }))}
          onRefresh={() => loadSuggestions(true)}
          onMakeRoom={makeRoomFrom}
        />
      )}

      {/* Add scene from a photo */}
      {addSceneOpen && (
        <AddSceneModal
          roomTypes={roomTypeOptions}
          styles={[...new Map([...styleOptions, ...STYLE_NAMES].map((s) => [s.toLowerCase(), s])).values()].sort()}
          onClose={() => setAddSceneOpen(false)}
        />
      )}

      {/* Vendor demand dashboard */}
      {vendorDemand?.open && (
        <VendorDemandModal
          state={vendorDemand}
          onClose={() => setVendorDemand((v) => ({ ...v, open: false }))}
          onSync={syncVendorFeed}
          onMakeRoom={makeRoomFrom}
        />
      )}

      {/* Saved pin review modal */}
      {savedPinDraft && (
        <PinReviewModal
          draft={savedPinDraft}
          onChange={setSavedPinDraft}
          boards={pinterestBoards}
          busy={savedPinBusy}
          error={savedPinError}
          onClose={() => { setSavedPinDraft(null); setSavedPinError(null); }}
          onPost={() => postSavedPin(savedPinDraft)}
          onSave={() => saveSavedPinChanges(savedPinDraft)}
          saveLabel="Save changes"
        />
      )}
      {savedPinNotice && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-stone-900 text-white text-sm rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
          <PinterestIcon className="w-4 h-4 text-rose-400" />
          <span>Pin posted.{savedPinNotice.tagSummary ? ` ${savedPinNotice.tagSummary}` : ''}</span>
          <a href={savedPinNotice.pinUrl} target="_blank" rel="noopener noreferrer" className="text-rose-300 hover:underline">View</a>
          <button onClick={() => setSavedPinNotice(null)} className="text-stone-400 hover:text-white" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && rooms.length === 0 && !error && (
        <div className="text-center py-24 text-stone-300">
          <p className="text-lg">Click Generate Rooms to get started</p>
        </div>
      )}
    </main>

      {/* Pinterest debug log panel — fixed bottom-right */}
      {pinLogs.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
          <button
            onClick={() => setPinLogOpen((o) => !o)}
            className="ml-auto flex items-center gap-1.5 text-[10px] font-mono bg-stone-800 text-stone-300 px-3 py-1.5 rounded-t-lg hover:bg-stone-700 transition-colors"
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${pinLogs[pinLogs.length - 1]?.level === 'error' ? 'bg-red-400' : pinLogs[pinLogs.length - 1]?.level === 'warn' ? 'bg-amber-400' : 'bg-green-400'}`} />
            Pinterest Log ({pinLogs.length})
            <span className="ml-1">{pinLogOpen ? '▼' : '▲'}</span>
          </button>
          {pinLogOpen && (
            <div className="bg-stone-900 border border-stone-700 rounded-b-lg rounded-tl-lg max-h-64 overflow-y-auto p-2 space-y-0.5">
              {pinLogs.map((entry, i) => (
                <div key={i} className={`text-[10px] font-mono leading-relaxed ${
                  entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-400' : 'text-stone-400'
                }`}>
                  <span className="text-stone-600">{entry.ts}</span>{' '}
                  <span>{entry.msg}</span>
                  {entry.data && typeof entry.data === 'object' && (
                    <details className="inline ml-1">
                      <summary className="inline cursor-pointer text-stone-600 hover:text-stone-400">data</summary>
                      <pre className="mt-0.5 text-[9px] text-stone-500 whitespace-pre-wrap break-all">{JSON.stringify(entry.data, null, 2)}</pre>
                    </details>
                  )}
                  {entry.data && typeof entry.data === 'string' && (
                    <span className="text-stone-600 ml-1">({entry.data})</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
