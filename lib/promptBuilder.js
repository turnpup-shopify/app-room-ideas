// Prompt builder
// Generates a descriptive, Higgsfield-ready scene prompt for each room.

// Style-specific descriptor cues for the prompt
const STYLE_DESCRIPTORS = {
  'Coastal': {
    lighting: 'bright, natural daylight with soft shadows',
    background: 'whitewashed walls, linen textiles, driftwood accents, and hints of sea-glass blue',
    palette: 'natural sandy tones, ocean blues, weathered whites, and warm naturals',
    mood: 'airy and relaxed beach-house',
  },
  'Glam': {
    lighting: 'warm ambient glow with dramatic accent lighting',
    background: 'rich velvet drapes, mirrored surfaces, and plush upholstery',
    palette: 'warm gold, ivory, champagne, and jewel tones',
    mood: 'luxurious and sophisticated',
  },
  'Organic Modern': {
    lighting: 'soft, diffused natural light',
    background: 'raw plaster walls, organic linen textiles, and dried botanicals',
    palette: 'warm greige, terracotta, stone, and natural wood tones',
    mood: 'serene and grounded',
  },
  'Art Deco': {
    lighting: 'dramatic directional lighting with warm metallic reflections',
    background: 'geometric tile, lacquered surfaces, and bold architectural details',
    palette: 'black, gold, ivory, and deep emerald or navy',
    mood: 'bold and opulent',
  },
  'Farmhouse': {
    lighting: 'warm, soft morning light',
    background: 'shiplap walls, galvanized metal accents, and rustic wood beams',
    palette: 'cream, warm white, sage green, and natural wood',
    mood: 'cozy and inviting country',
  },
  'French Country': {
    lighting: 'soft, golden afternoon light through sheer curtains',
    background: 'distressed painted wood, toile fabric, and antique ceramic accents',
    palette: 'soft lavender, warm cream, aged white, and dusty blue',
    mood: 'charming and romantic Provençal',
  },
  'Industrial': {
    lighting: 'cool, directional Edison-bulb lighting',
    background: 'exposed brick, raw concrete, and dark metal pipe details',
    palette: 'charcoal, raw steel, warm amber, and matte black',
    mood: 'urban and edgy loft',
  },
  'Modern': {
    lighting: 'clean, bright diffused natural light',
    background: 'smooth white walls, minimal decor, and clean architectural lines',
    palette: 'crisp white, charcoal, warm wood, and muted accent tones',
    mood: 'clean and refined contemporary',
  },
  'Rustic': {
    lighting: 'warm, golden fireplace-adjacent light',
    background: 'reclaimed wood paneling, stone accents, and woven textiles',
    palette: 'warm amber, deep brown, forest green, and rust',
    mood: 'warm and rugged mountain cabin',
  },
  'Traditional': {
    lighting: 'warm, layered lamp light',
    background: 'crown molding, rich wood millwork, and classic patterned fabrics',
    palette: 'navy, burgundy, warm taupe, and honey wood tones',
    mood: 'timeless and elegant',
  },
  'Transitional': {
    lighting: 'balanced, comfortable ambient light',
    background: 'neutral walls with subtle texture, layered area rugs, and mixed wood tones',
    palette: 'warm white, taupe, soft grey, and natural wood',
    mood: 'versatile and approachable',
  },
};

const DEFAULT_DESCRIPTOR = {
  lighting: 'soft, natural ambient light',
  background: 'neutral walls and carefully curated decor',
  palette: 'warm neutrals and natural tones',
  mood: 'elegant and considered',
};

function getDescriptor(style) {
  return STYLE_DESCRIPTORS[style] || DEFAULT_DESCRIPTOR;
}

/**
 * Infer the dominant material palette from a set of products.
 * Returns a short string like "rattan, woven banana leaf, and natural fiber".
 */
function inferMaterialPalette(products) {
  const materials = products
    .map((p) => p.materials)
    .filter(Boolean)
    .join(', ')
    .toLowerCase();

  if (!materials) return 'natural and curated materials';
  return materials;
}

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
 * Build a Higgsfield-ready descriptive scene prompt for a room.
 *
 * @param {Object} room - { style, combinationName, products }
 * @returns {string} The full prompt text
 */
export function buildPrompt(room) {
  const { style, combinationName, products } = room;
  const desc = getDescriptor(style);
  const materialPalette = inferMaterialPalette(products);

  // Describe each product in a natural sentence
  const productDescriptions = products.map((p, i) => {
    const material = p.materials ? ` crafted in ${p.materials}` : '';
    const dims = p.dimensions ? `, measuring ${p.dimensions}` : '';
    const role = i === 0 ? 'anchors the space' : i === 1 ? 'adds layered texture and scale' : 'completes the composition';
    return `A **${p.title}**${material}${dims} ${role}.`;
  });

  const productList = products.map((p) => p.title).join(', ');

  const prompt = `A ${desc.mood} ${style} ${combinationName.toLowerCase()} vignette styled for professional interior photography.

${productDescriptions.join(' ')}

The palette draws from ${materialPalette} — ${desc.palette}. The room is bathed in ${desc.lighting}, with ${desc.background}. Every detail feels intentional: textured surfaces catch the light, proportions are carefully balanced, and the overall composition evokes a ${desc.mood} sensibility.

Style: ${style}
Room type: ${combinationName}
Featured pieces: ${productList}

---
HIGGSFIELD GENERATION NOTE: Use the product images in the subfolders alongside this prompt as reference images. Each subfolder corresponds to one featured piece.`;

  return prompt;
}
