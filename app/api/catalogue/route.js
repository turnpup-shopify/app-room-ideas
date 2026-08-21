import { NextResponse } from 'next/server';
import { getConfig } from '../../../lib/config.js';
import { fetchProducts } from '../../../lib/shopify.js';

/**
 * GET /api/catalogue
 *
 * Diagnostic endpoint — returns all distinct productType values and designStyle
 * values found in the live Shopify catalogue after applying config filters.
 *
 * Use this to audit config.json productTypeCombinations:
 *   - "types" in config must exactly match the productType strings returned here
 *   - Any type in config not present here will silently produce zero rooms
 *
 * Also shows which types are used vs unused by the current config,
 * and which config types have no matching products.
 */
export async function GET() {
  try {
    const config = getConfig();
    const products = await fetchProducts(config);

    // Distinct product types with counts
    const typeCounts = {};
    for (const p of products) {
      const t = p.productType || '(blank)';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const productTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));

    // Distinct design styles with counts
    const styleCounts = {};
    for (const p of products) {
      for (const s of p.designStyles) {
        styleCounts[s] = (styleCounts[s] || 0) + 1;
      }
    }
    const designStyles = Object.entries(styleCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([style, count]) => ({ style, count }));

    // Which config types have no matching products (will silently fail)
    const configTypes = new Set(
      config.productTypeCombinations.flatMap((c) => c.types)
    );
    const shopifyTypes = new Set(Object.keys(typeCounts));

    const missingFromShopify = [...configTypes].filter((t) => !shopifyTypes.has(t)).sort();
    const unusedInConfig = [...shopifyTypes]
      .filter((t) => t !== '(blank)' && !configTypes.has(t))
      .sort();

    // Which combinations are completable vs not
    const combinationStatus = config.productTypeCombinations.map((combo) => {
      const missing = combo.types.filter((t) => !shopifyTypes.has(t));
      return {
        name: combo.name,
        types: combo.types,
        viable: missing.length === 0,
        missingTypes: missing,
      };
    });

    return NextResponse.json({
      totalProducts: products.length,
      productTypes,
      designStyles,
      configAudit: {
        missingFromShopify,
        unusedInConfig,
        combinationStatus,
      },
    });
  } catch (err) {
    console.error('[/api/catalogue]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
