// Rules engine
// Groups products by shared design_style and selects the best room combination per style.

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
 * find the best combination matching the given type combination.
 * Returns { products, score, combinationName } or null if not possible.
 */
function findBestComboForStyle(styleProducts, combination) {
  const slots = combination.types;

  // For each slot, find all products that match the type
  const candidates = slots.map((type) =>
    styleProducts.filter((p) => p.productType === type)
  );

  // If any slot has zero candidates, this combination is impossible
  if (candidates.some((c) => c.length === 0)) return null;

  // Enumerate all combinations (slots[0] x slots[1] x ... slots[n])
  // For performance, we'll use a greedy approach when there are many candidates:
  // pick the best candidate for each slot given the already-chosen products.
  // For small catalogs like this one, full enumeration is fine.
  let bestScore = -1;
  let bestProducts = null;

  function enumerate(slotIdx, chosen) {
    if (slotIdx === candidates.length) {
      // Ensure no duplicate products
      const ids = chosen.map((p) => p.id);
      if (new Set(ids).size !== ids.length) return;
      const score = scoreSet(chosen);
      if (score > bestScore) {
        bestScore = score;
        bestProducts = [...chosen];
      }
      return;
    }
    for (const product of candidates[slotIdx]) {
      // Skip if already used in this set
      if (chosen.some((c) => c.id === product.id)) continue;
      enumerate(slotIdx + 1, [...chosen, product]);
    }
  }

  enumerate(0, []);

  if (!bestProducts) return null;

  return {
    products: bestProducts,
    score: bestScore,
    combinationName: combination.name,
  };
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

  // Collect all unique styles across all products
  const allStyles = [...new Set(products.flatMap((p) => p.designStyles))].sort();

  console.log(`Design styles found: ${allStyles.join(', ')}\n`);

  const rooms = [];

  for (const style of allStyles) {
    // Products that include this style
    const styleProducts = products.filter((p) => p.designStyles.includes(style));

    let bestRoom = null;

    for (const combination of productTypeCombinations) {
      const result = findBestComboForStyle(styleProducts, combination);
      if (!result) continue;

      if (!bestRoom || result.score > bestRoom.score) {
        bestRoom = result;
      }
    }

    if (!bestRoom) {
      console.log(`  [${style}] — no valid room combination found (missing product types)`);
      continue;
    }

    console.log(
      `  [${style}] → "${bestRoom.combinationName}" (score: ${bestRoom.score})\n` +
        bestRoom.products.map((p) => `    - ${p.title} (${p.productType})`).join('\n')
    );

    rooms.push({
      style,
      combinationName: bestRoom.combinationName,
      products: bestRoom.products,
      score: bestRoom.score,
    });
  }

  console.log(`\n${rooms.length} rooms built.\n`);
  return rooms;
}
