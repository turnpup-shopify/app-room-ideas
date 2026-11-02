import fs from 'fs';
import path from 'path';
import { graphqlRequest } from './shopify.js';
import { loadSnapshots, analyzeDemand, normalizeSku } from './vendorFeed.js';

// Uttermost demand report: feed history (lib/vendorFeed.js) joined with the Shopify catalog,
// plus names/photos from uttermost.com for SKUs you don't carry.
// Used by scripts/vendor-demand.mjs and /api/vendor/demand.

const PLACEHOLDER_INVENTORY = 999;
const UTTERMOST_GRAPHQL = 'https://uttermost.com/graphql';
const CATALOG_CACHE = path.join(process.cwd(), 'vendor-feed', 'uttermost-catalog.json');
const CATALOG_TTL = 7 * 86400000;
// Uttermost category names that say nothing about the product type
const GENERIC_CATEGORIES = new Set([
  'view all', 'shop by type', 'shop by room', 'best sellers', 'regional best sellers', 'national best sellers',
  'other', 'new', 'new arrivals', 'sale', 'accessories', 'furniture', 'lighting', 'living', 'dining', 'bedroom', 'office', 'outdoor',
]);

const VARIANTS_QUERY = `
  query vendorVariants($cursor: String) {
    productVariants(first: 250, after: $cursor, query: "vendor:Uttermost") {
      pageInfo { hasNextPage endCursor }
      nodes { sku inventoryQuantity product { id title handle status productType featuredImage { url } designStyle: metafield(namespace: "custom", key: "design_style") { value } } }
    }
  }
`;

async function fetchStoreSkus() {
  const bySku = new Map();
  let cursor = null;
  do {
    const data = await graphqlRequest(process.env.SHOPIFY_STORE_DOMAIN, process.env.SHOPIFY_ACCESS_TOKEN, VARIANTS_QUERY, { cursor });
    for (const v of data.productVariants.nodes) {
      const sku = normalizeSku(v.sku);
      if (!sku) continue;
      const { featuredImage, designStyle, ...product } = v.product;
      bySku.set(sku, { ...product, qty: v.inventoryQuantity, thumbnail: featuredImage?.url ?? null, hasStyle: !!designStyle?.value && designStyle.value !== '[]' });
    }
    cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (cursor);
  return bySku;
}

function readCatalogCache() {
  try { return JSON.parse(fs.readFileSync(CATALOG_CACHE, 'utf8')); } catch { return {}; }
}

/**
 * Name, photo, link, and category for Uttermost SKUs from uttermost.com (public catalog API).
 * Cached in vendor-feed/uttermost-catalog.json for a week. Never throws.
 * @returns {Promise<Map<string, { name, url, image, category, nationalBestSeller }>>}
 */
export async function lookupUttermostProducts(skus) {
  const cache = readCatalogCache();
  const now = Date.now();
  const missing = [...new Set(skus.map(normalizeSku))].filter((s) => s && !(cache[s] && now - cache[s].fetchedAt < CATALOG_TTL));
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const res = await fetch(UTTERMOST_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($skus: [String]) { products(filter: { sku: { in: $skus } }, pageSize: 50) { items { sku name url_key small_image { url } categories { name } } } }`,
          variables: { skus: chunk },
        }),
      });
      const items = (await res.json())?.data?.products?.items ?? [];
      const found = new Set();
      for (const item of items) {
        const sku = normalizeSku(item.sku);
        const names = (item.categories ?? []).map((c) => c.name);
        found.add(sku);
        cache[sku] = {
          name: item.name,
          url: item.url_key ? `https://uttermost.com/${item.url_key}` : null,
          image: item.small_image?.url ?? null,
          category: names.find((n) => !GENERIC_CATEGORIES.has(n.toLowerCase())) ?? null,
          nationalBestSeller: names.includes('National Best Sellers'),
          fetchedAt: now,
        };
      }
      // Remember misses too so they aren't re-queried every run
      for (const sku of chunk) if (!found.has(sku)) cache[sku] = { name: null, fetchedAt: now };
    } catch (err) {
      console.warn('[vendorDemand] uttermost.com lookup failed:', err.message);
      break;
    }
  }
  try {
    fs.mkdirSync(path.dirname(CATALOG_CACHE), { recursive: true });
    fs.writeFileSync(CATALOG_CACHE, JSON.stringify(cache));
  } catch { /* cache is optional */ }
  return new Map(skus.map((s) => [normalizeSku(s), cache[normalizeSku(s)]]).filter(([, v]) => v?.name));
}

let reportCache = null; // { at, top, data }
const REPORT_TTL = 10 * 60 * 1000;

export function clearDemandReportCache() {
  reportCache = null;
}

/**
 * Full demand report. Cached for 10 minutes; cleared by a sync.
 * @returns {Promise<object>} sections of plain JSON rows
 */
export async function buildDemandReport({ top = 25, refresh = false } = {}) {
  if (!refresh && reportCache && reportCache.top === top && Date.now() - reportCache.at < REPORT_TTL) return reportCache.data;

  const snapshots = loadSnapshots();
  const demand = analyzeDemand(snapshots);
  const base = { from: demand.from, to: demand.to, snapshots: demand.snapshots, days: demand.days };
  if (demand.snapshots < 2) return { ...base, ready: false };

  const store = await fetchStoreSkus();
  const rows = [...demand.skus.values()].map((s) => {
    const p = store.get(s.sku);
    return {
      sku: s.sku, unitsOut: s.unitsOut, perWeek: s.perWeek, vendorStock: s.current, daysOfCover: s.daysOfCover,
      capped: s.cappedShare >= 0.5, notes: s.notes, discontinued: s.discontinued,
      product: p ? { id: p.id, title: p.title, handle: p.handle, status: p.status, productType: p.productType, qty: p.qty, thumbnail: p.thumbnail, hasStyle: p.hasStyle } : null,
    };
  });
  const active = (r) => r.product?.status === 'ACTIVE';
  const bySales = (a, b) => b.unitsOut - a.unitsOut;

  const notCarried = rows.filter((r) => !r.product && !r.discontinued && r.unitsOut > 0).sort(bySales).slice(0, top);
  const lookups = await lookupUttermostProducts(notCarried.map((r) => r.sku));
  for (const r of notCarried) r.uttermost = lookups.get(r.sku) ?? null;

  const typeTotals = new Map();
  for (const r of rows.filter(active)) {
    const t = r.product.productType || '(no type)';
    const cur = typeTotals.get(t) ?? { type: t, skus: 0, unitsOut: 0 };
    cur.skus++;
    cur.unitsOut += r.unitsOut;
    typeTotals.set(t, cur);
  }

  const data = {
    ...base,
    ready: true,
    generatedAt: new Date().toISOString(),
    topCarried: rows.filter((r) => active(r) && r.unitsOut > 0).sort(bySales).slice(0, top),
    topNotCarried: notCarried,
    runningLow: rows
      .filter((r) => active(r) && r.vendorStock > 0 && r.unitsOut > 0 && r.daysOfCover !== null && r.daysOfCover <= 21)
      .sort((a, b) => a.daysOfCover - b.daysOfCover)
      .slice(0, top),
    soldOutSelling: rows.filter((r) => active(r) && r.vendorStock === 0 && r.unitsOut > 0 && !r.discontinued).sort(bySales).slice(0, top),
    byType: [...typeTotals.values()].filter((t) => t.unitsOut > 0).sort((a, b) => b.unitsOut - a.unitsOut),
    housekeeping: {
      discontinuedActive: rows.filter((r) => active(r) && r.discontinued),
      overrideHasStock: rows.filter((r) => active(r) && r.product.qty === PLACEHOLDER_INVENTORY && r.vendorStock >= 10),
      activeNotInFeed: [...store.entries()]
        .filter(([sku, p]) => p.status === 'ACTIVE' && !demand.skus.has(sku))
        .map(([sku, p]) => ({ sku, title: p.title, id: p.id })),
    },
  };
  reportCache = { at: Date.now(), top, data };
  return data;
}

/**
 * Per-SKU demand for ranking (no network): perWeek and vendor stock from the local feed history.
 * Returns null when there isn't enough history to be meaningful.
 * @returns {Map<string, { perWeek: number, vendorStock: number, daysOfCover: number|null }>|null}
 */
export function demandBySku(minSnapshots = 7) {
  const demand = analyzeDemand(loadSnapshots());
  if (demand.snapshots < minSnapshots) return null;
  return new Map([...demand.skus].map(([sku, s]) => [sku, { perWeek: s.perWeek, vendorStock: s.current, daysOfCover: s.daysOfCover }]));
}
