// Rules engine
// Groups products by shared design_style and selects a room combination per style.
// Uses randomization so each run produces different results.

/** Shuffle an array in place (Fisher-Yates) and return it. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Score a candidate set of products.
 * Higher score = more cohesive room.
 * Scoring criteria:
 *   +1 for each shared style between any two products in the set
 *   +1 for each shared material between any two products in the set
 */
function scoreSet(products) {
  let score = 0;
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i];
      const b = products[j];

      // Shared styles
      const sharedStyles = a.designStyles.filter((s) => b.designStyles.includes(s));
      score += sharedStyles.length;

      // Shared material keywords (compare lowercase words)
      const aWords = a.materials.toLowerCase().split(/[\s,/+&]+/).filter(Boolean);
      const bWords = b.materials.toLowerCase().split(/[\s,/+&]+/).filter(Boolean);
      const sharedMaterials = aWords.filter((w) => bWords.includes(w));
      score += sharedMaterials.length;
    }
  }
  return score;
}

/**
 * Given a list of products that all have the target style in their designStyles,
 * sample random valid combinations matching the given type combination.
 * Returns a randomly-chosen combo from the top-scoring tier, or null if none is possible.
 *
 * Collects all valid samples then picks randomly from the top third by score —
 * so rooms are still coherent but the same high-overlap products don't always win.
 */
const MAX_SAMPLES = 30;

const MAX_ALTERNATIVES = 10;

function sampleBestCombo(styleProducts, combination) {
  const slots = combination.types;

  // For each slot, find and shuffle matching products
  const candidates = slots.map((type) =>
    shuffle(styleProducts.filter((p) => p.productType === type))
  );

  // If any slot has zero candidates, this combination is impossible
  if (candidates.some((c) => c.length === 0)) return null;

  const validCombos = [];

  for (let attempt = 0; attempt < MAX_SAMPLES; attempt++) {
    const chosen = [];
    const usedIds = new Set();
    let valid = true;

    for (const pool of candidates) {
      // Pick a random candidate not already chosen in this combo
      const available = pool.filter((p) => !usedIds.has(p.id));
      if (available.length === 0) { valid = false; break; }
      const pick = available[Math.floor(Math.random() * available.length)];
      chosen.push(pick);
      usedIds.add(pick.id);
    }

    if (!valid) continue;

    validCombos.push({ products: chosen, score: scoreSet(chosen), combinationName: combination.name });
  }

  if (validCombos.length === 0) return null;

  // Sort by score, take the top third, pick randomly from that tier.
  // This keeps rooms coherent while preventing the same high-overlap products
  // from winning every single time.
  validCombos.sort((a, b) => b.score - a.score);
  const topTier = validCombos.slice(0, Math.max(1, Math.ceil(validCombos.length / 3)));
  const winner = topTier[Math.floor(Math.random() * topTier.length)];

  // Build per-slot alternatives: other candidates of the same type, excluding
  // every product chosen in the winning combo.
  const chosenIds = new Set(winner.products.map((p) => p.id));
  winner.alternatives = winner.products.map((_, slotIdx) =>
    candidates[slotIdx]
      .filter((p) => !chosenIds.has(p.id))
      .slice(0, MAX_ALTERNATIVES)
  );

  return winner;
}

/**
 * Build rooms from products.
 *
 * Default behaviour: one room per design style (original behaviour).
 *
 * When filters.count is set: keep looping through the eligible styles,
 * each pass consuming previously-unused products, until the target count
 * is reached or no more valid combinations can be found.
 * This is what allows "10 Coastal rooms" — the same style is visited on
 * every pass, each time drawing from a shrinking pool of unused products.
 *
 * @param {Array}  products - Normalized product array from shopify.js
 * @param {Object} config   - Loaded config.json
 * @param {Object} filters  - Optional { designStyle, roomType, count }
 * @returns {Array} rooms   - Array of { style, combinationName, products, score }
 */
export function buildRooms(products, config, filters = {}) {
  const { productTypeCombinations } = config;
  const { designStyle: pinnedStyle, roomType: pinnedRoomType, count } = filters;

  const targetCount = count ? Math.max(1, parseInt(count, 10)) : null;
  const wantedProductCount = Math.min(5, Math.max(1, parseInt(filters.productCount || '3', 10)));

  // Collect all unique styles and shuffle so different styles get first pick each run
  let allStyles = shuffle([...new Set(products.flatMap((p) => p.designStyles))]);

  // If a design style is pinned, restrict to only that style.
  // If no products carry that style, fall back to all styles rather than returning nothing.
  if (pinnedStyle) {
    const filtered = allStyles.filter((s) => s === pinnedStyle);
    if (filtered.length > 0) {
      allStyles = filtered;
    } else {
      console.warn(`[buildRooms] No products found for style "${pinnedStyle}" — ignoring style filter.`);
    }
  }

  console.log(`Design styles (shuffled): ${allStyles.join(', ')}\n`);

  const eligibleCombinations = pinnedRoomType
    ? productTypeCombinations.filter((c) => c.name === pinnedRoomType)
    : [...productTypeCombinations];

  // Track products already assigned to a room so each room gets unique products
  const usedProductIds = new Set();
  const rooms = [];

  // When a count is requested we may need multiple passes through the style list.
  // Without a count we do exactly one pass (original behaviour).
  const maxPasses = targetCount ? Math.ceil(targetCount / Math.max(allStyles.length, 1)) : 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const roomsAtStartOfPass = rooms.length;

    for (const style of allStyles) {
      if (targetCount && rooms.length >= targetCount) break;

      // Products that include this style, excluding any already used in another room
      const styleProducts = products.filter(
        (p) => p.designStyles.includes(style) && !usedProductIds.has(p.id)
      );

      // Try combinations in shuffled order; take the first valid one.
      // Previously this compared scores across all combinations and always took
      // the max — causing the same high-overlap products to win every run.
      let picked = null;
      for (const combination of shuffle([...eligibleCombinations])) {
        const candidate = sampleBestCombo(styleProducts, combination);
        if (candidate) {
          picked = candidate;
          break;
        }
      }

      if (!picked) {
        console.log(`  [${style}] pass ${pass + 1} — no valid combination found (products exhausted or types missing)`);
        continue;
      }

      // Pad with extra style-matched products up to wantedProductCount
      if (picked.products.length < wantedProductCount) {
        const usedInCombo = new Set(picked.products.map((p) => p.id));
        const pool = shuffle(
          styleProducts.filter((p) => !usedInCombo.has(p.id) && !usedProductIds.has(p.id))
        );
        const extras = pool.slice(0, wantedProductCount - picked.products.length);
        if (extras.length > 0) {
          // Build alternatives for the extra slots — same productType from remaining pool
          const extraAlts = extras.map((extra) => {
            const allIds = new Set([...usedInCombo, ...extras.map((e) => e.id)]);
            return pool
              .filter((p) => p.productType === extra.productType && !allIds.has(p.id))
              .slice(0, MAX_ALTERNATIVES);
          });
          picked = {
            ...picked,
            products: [...picked.products, ...extras],
            alternatives: [...(picked.alternatives || []), ...extraAlts],
          };
        }
      }

      // Mark these products as used
      for (const p of picked.products) {
        usedProductIds.add(p.id);
      }

      console.log(
        `  [${style}] pass ${pass + 1} → "${picked.combinationName}" (score: ${picked.score})\n` +
          picked.products.map((p) => `    - ${p.title} (${p.productType})`).join('\n')
      );

      rooms.push({
        style,
        combinationName: picked.combinationName,
        products: picked.products,
        alternatives: picked.alternatives || picked.products.map(() => []),
        score: picked.score,
      });
    }

    // If this pass added nothing, products are exhausted — no point continuing
    if (rooms.length === roomsAtStartOfPass) break;
  }

  // Shuffle the final rooms array so output order varies each run
  shuffle(rooms);

  console.log(`\n${rooms.length} rooms built.\n`);
  return rooms;
}
