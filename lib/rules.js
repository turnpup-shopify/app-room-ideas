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
 * find valid combinations matching the given type combination.
 * Returns an array of { products, score, combinationName } (may be empty).
 */
function findCombosForStyle(styleProducts, combination) {
  const slots = combination.types;

  // For each slot, find all products that match the type
  const candidates = slots.map((type) =>
    styleProducts.filter((p) => p.productType === type)
  );

  // If any slot has zero candidates, this combination is impossible
  if (candidates.some((c) => c.length === 0)) return [];

  const results = [];

  function enumerate(slotIdx, chosen) {
    if (slotIdx === candidates.length) {
      // Ensure no duplicate products
      const ids = chosen.map((p) => p.id);
      if (new Set(ids).size !== ids.length) return;
      results.push({
        products: [...chosen],
        score: scoreSet(chosen),
        combinationName: combination.name,
      });
      return;
    }
    for (const product of candidates[slotIdx]) {
      if (chosen.some((c) => c.id === product.id)) continue;
      enumerate(slotIdx + 1, [...chosen, product]);
    }
  }

  enumerate(0, []);
  return results;
}

/**
 * Pick a random item from an array, weighted by score.
 * Higher-scoring combos are more likely but not guaranteed.
 */
function weightedRandomPick(combos) {
  if (combos.length === 0) return null;
  if (combos.length === 1) return combos[0];

  // Shift scores so the minimum becomes 1, then use as weights
  const minScore = Math.min(...combos.map((c) => c.score));
  const weights = combos.map((c) => c.score - minScore + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let r = Math.random() * totalWeight;
  for (let i = 0; i < combos.length; i++) {
    r -= weights[i];
    if (r <= 0) return combos[i];
  }
  return combos[combos.length - 1];
}

/**
 * Build one best room per design style.
 * For each style:
 *   - Collect all products that include that style
 *   - Try each productTypeCombination
 *   - Pick the highest-scoring valid combination
 *
 * @param {Array} products - Normalized product array from shopify.js
 * @param {Object} config - Loaded config.json
 * @returns {Array} rooms - Array of { style, combinationName, products, score }
 */
export function buildRooms(products, config) {
  const { productTypeCombinations } = config;

  // Collect all unique styles and shuffle so different styles get first pick each run
  const allStyles = shuffle([...new Set(products.flatMap((p) => p.designStyles))]);

  console.log(`Design styles found (shuffled): ${allStyles.join(', ')}\n`);

  // Track products already assigned to a room so each room gets unique products
  const usedProductIds = new Set();

  const rooms = [];

  for (const style of allStyles) {
    // Products that include this style, excluding any already used in another room
    const styleProducts = products.filter(
      (p) => p.designStyles.includes(style) && !usedProductIds.has(p.id)
    );

    // Collect all valid combos across all room type combinations
    const allCombos = productTypeCombinations.flatMap((combination) =>
      findCombosForStyle(styleProducts, combination)
    );

    if (allCombos.length === 0) {
      console.log(`  [${style}] — no valid room combination found (missing product types or all used)`);
      continue;
    }

    // Pick a combo using weighted random selection (higher scores more likely)
    const picked = weightedRandomPick(allCombos);

    // Mark these products as used so they won't appear in subsequent rooms
    for (const p of picked.products) {
      usedProductIds.add(p.id);
    }

    console.log(
      `  [${style}] → "${picked.combinationName}" (score: ${picked.score})\n` +
        picked.products.map((p) => `    - ${p.title} (${p.productType})`).join('\n')
    );

    rooms.push({
      style,
      combinationName: picked.combinationName,
      products: picked.products,
      score: picked.score,
    });
  }

  // Shuffle the final rooms array so the output order varies too
  shuffle(rooms);

  console.log(`\n${rooms.length} rooms built.\n`);
  return rooms;
}
