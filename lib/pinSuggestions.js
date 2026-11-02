import { graphqlRequest } from './shopify.js';
import { getConfig } from './config.js';
import { listAllPins, getPinLinks, getTopPins } from './pinterest.js';
import { demandBySku } from './vendorDemand.js';
import { normalizeSku } from './vendorFeed.js';

// Which in-stock products to pin next, from pin history (Pinterest), what performs on
// Pinterest (last 90 days of analytics), and stock / sales / newness (Shopify).

const CACHE_TTL = 30 * 60 * 1000;
const DAY = 86400000;
const MAX_PRODUCTS = 200;
const MAX_ROOMS = 6;
const MAX_ORDER_PAGES = 40;
const PLACEHOLDER_INVENTORY = 999;

let cache = null; // { at, data }

const CANDIDATES_QUERY = `
  query pinCandidates($cursor: String, $query: String) {
    products(first: 100, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        productType
        vendor
        totalInventory
        createdAt
        featuredImage { url }
        designStyle: metafield(namespace: "custom", key: "design_style") { value }
        variants(first: 10) { nodes { sku } }
      }
    }
  }
`;

const ORDERS_QUERY = `
  query recentOrders($cursor: String, $query: String) {
    orders(first: 25, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        lineItems(first: 20) { nodes { quantity product { id } } }
      }
    }
  }
`;

function parseStyles(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return [value];
  }
}

async function fetchCandidates(domain, token, config) {
  const parts = ['status:active'];
  if (config.includeVendors?.length) parts.push(`(${config.includeVendors.map((v) => `vendor:"${v}"`).join(' OR ')})`);
  for (const t of config.excludeTags ?? []) parts.push(`-tag:${t}`);
  const products = [];
  let cursor = null;
  do {
    const data = await graphqlRequest(domain, token, CANDIDATES_QUERY, { cursor, query: parts.join(' AND ') });
    for (const p of data.products.nodes) {
      if (config.includeVendors?.length && !config.includeVendors.includes(p.vendor)) continue;
      if (p.totalInventory <= 0) continue;
      products.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        productType: p.productType || '',
        totalInventory: p.totalInventory,
        createdAt: p.createdAt,
        thumbnail: p.featuredImage?.url || null,
        designStyles: parseStyles(p.designStyle?.value),
        skus: p.variants.nodes.map((v) => normalizeSku(v.sku)).filter(Boolean),
      });
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return products;
}

/** Units sold per product GID over the last 90 days. */
async function fetchUnitsSold(domain, token) {
  const since = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
  const units = new Map();
  let cursor = null;
  let pages = 0;
  do {
    const data = await graphqlRequest(domain, token, ORDERS_QUERY, { cursor, query: `created_at:>=${since}` });
    for (const order of data.orders.nodes) {
      for (const li of order.lineItems.nodes) {
        if (li.product?.id) units.set(li.product.id, (units.get(li.product.id) ?? 0) + li.quantity);
      }
    }
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor && ++pages < MAX_ORDER_PAGES);
  return units;
}

/** Pinterest's three top-50 lists, merged into pin ID → metrics. */
async function fetchPinMetrics() {
  const metrics = new Map();
  for (const sortBy of ['SAVE', 'OUTBOUND_CLICK', 'IMPRESSION']) {
    for (const { pin_id, metrics: m } of await getTopPins(sortBy)) metrics.set(String(pin_id), m);
  }
  return metrics;
}

const pinValue = (m) => (m?.SAVE ?? 0) + 3 * (m?.OUTBOUND_CLICK ?? 0) + 0.01 * (m?.IMPRESSION ?? 0);

function daysAgo(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
}

function scoreProduct(p, ctx) {
  const reasons = [];
  let score = 0;

  const last = ctx.lastPinned.get(p.id);
  const age = last ? daysAgo(last) : null;
  if (age === null) { score += 35; reasons.push('Never pinned'); }
  else if (age > 365) { score += 30; reasons.push(`Last pinned ${Math.floor(age / 365)}+ yr ago`); }
  else if (age > 180) { score += 22; reasons.push(`Last pinned ${Math.round(age / 30)} months ago`); }
  else if (age > 90) { score += 12; reasons.push(`Last pinned ${Math.round(age / 30)} months ago`); }

  // 999 is a manual override for SKUs the vendor feed gets wrong: available, real count unknown
  if (p.totalInventory === PLACEHOLDER_INVENTORY) {
    score += 15 * 0.5;
  } else {
    score += 15 * Math.min(p.totalInventory, 40) / 40;
    if (p.totalInventory >= 20) reasons.push(`${p.totalInventory} in stock`);
  }

  const typeStat = ctx.typeStats.get(p.productType);
  if (typeStat && ctx.maxTypeValue > 0) {
    const share = typeStat.value / ctx.maxTypeValue;
    score += 20 * share;
    if (share >= 0.25) reasons.push(`${p.productType} pins earn ${typeStat.saves} saves, ${typeStat.clicks} clicks (90 days)`);
  }

  const perf = ctx.productValue.get(p.id) ?? 0;
  if (perf > 0 && ctx.maxProductValue > 0) {
    score += 10 * perf / ctx.maxProductValue;
    if (age !== null && age > 90) reasons.push('Its older pin still performs');
  }

  const sold = ctx.unitsSold.get(p.id) ?? 0;
  if (sold > 0) {
    score += 15 * Math.min(sold, 10) / 10;
    reasons.push(`${sold} sold in 90 days`);
  }

  if (daysAgo(p.createdAt) <= 60) { score += 5; reasons.push('New arrival'); }

  // Market demand from the Uttermost feed: reward what sells across all dealers,
  // and push down what's about to sell out (a pin would send traffic to an empty page)
  if (ctx.vendorDemand) {
    const rows = p.skus.map((sku) => ctx.vendorDemand.get(sku)).filter(Boolean);
    if (rows.length) {
      const perWeek = rows.reduce((n, r) => n + r.perWeek, 0);
      const vendorStock = rows.reduce((n, r) => n + r.vendorStock, 0);
      const cover = Math.min(...rows.map((r) => r.daysOfCover ?? Infinity));
      score += 15 * Math.min(perWeek, 10) / 10;
      if (perWeek >= 3) reasons.push(`Uttermost sells ~${Math.round(perWeek)}/wk`);
      if (vendorStock <= 5 || cover <= 7) { score -= 20; reasons.push(`Almost sold out at Uttermost (${vendorStock} left)`); }
    }
  }

  const roomReady = p.designStyles.length > 0;
  if (!roomReady) score -= 10;

  return { score: Math.round(score), reasons, lastPinnedAt: last ?? null, pinCount: ctx.pinCount.get(p.id) ?? 0, unitsSold: sold, roomReady };
}

/** Keep one product type from filling the top of the list: at most 4 per type per 40 places. */
function diversify(sorted) {
  const out = [];
  let rest = sorted;
  while (rest.length) {
    const perType = new Map();
    const next = [];
    for (const p of rest) {
      const n = perType.get(p.productType) ?? 0;
      if (n >= 4 || out.length >= MAX_PRODUCTS) { next.push(p); continue; }
      out.push(p);
      perType.set(p.productType, n + 1);
      if (out.length % 40 === 0) perType.clear();
    }
    if (next.length === rest.length || out.length >= MAX_PRODUCTS) break;
    rest = next;
  }
  return out;
}

/** Rooms of unpinned products that share a style and fill one of the configured combinations. */
function suggestRooms(products, combinations) {
  const pool = products.filter((p) => p.roomReady && (p.lastPinnedAt === null || daysAgo(p.lastPinnedAt) > 90));
  const styles = [...new Set(pool.flatMap((p) => p.designStyles))];
  const options = [];
  for (const combo of combinations) {
    const types = (combo.types ?? []).slice(0, 3);
    if (!types.length) continue;
    for (const style of styles) {
      const picks = [];
      for (const type of types) {
        const best = pool
          .filter((p) => p.productType === type && p.designStyles.includes(style) && !picks.includes(p))
          .sort((a, b) => b.score - a.score)[0];
        if (!best) break;
        picks.push(best);
      }
      if (picks.length !== types.length) continue;
      options.push({ combination: combo.name, style, products: picks, score: Math.round(picks.reduce((n, p) => n + p.score, 0) / picks.length) });
    }
  }

  // Best first, each product in one room, at most two rooms per combination
  options.sort((a, b) => b.score - a.score);
  const used = new Set();
  const perCombo = new Map();
  const rooms = [];
  for (const room of options) {
    if (rooms.length >= MAX_ROOMS) break;
    if ((perCombo.get(room.combination) ?? 0) >= 2) continue;
    if (room.products.some((p) => used.has(p.id))) continue;
    room.products.forEach((p) => used.add(p.id));
    perCombo.set(room.combination, (perCombo.get(room.combination) ?? 0) + 1);
    rooms.push({ ...room, products: room.products.map(({ id, title, handle, productType, thumbnail }) => ({ id, title, handle, productType, thumbnail })) });
  }
  return rooms;
}

/**
 * Rank in-stock products by how much they need (and deserve) a pin.
 * Cached for 30 minutes; pass refresh to recompute.
 */
export async function getPinSuggestions({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN environment variables.');
  const config = getConfig();
  const warnings = [];

  // Optional sources degrade to a warning instead of failing the whole ranking
  const optional = (promise, fallback, label) => promise.catch((err) => {
    warnings.push(`${label}: ${err.message}`);
    return fallback;
  });
  const [candidates, pins, pinMetrics, unitsSold] = await Promise.all([
    fetchCandidates(domain, token, config),
    listAllPins(),
    optional(fetchPinMetrics(), new Map(), 'Pinterest analytics unavailable'),
    optional(fetchUnitsSold(domain, token), new Map(), 'Sales not counted'),
  ]);
  const byHandle = new Map(candidates.map((p) => [p.handle, p.id]));
  const gidFromLink = (link) => byHandle.get((link || '').match(/\/products\/([^/?#]+)/)?.[1]);

  // Pin history: which products each pin shows, via product tags and /products/<handle> links
  const tagLinks = await optional(
    getPinLinks(pins.flatMap((pin) => (pin.product_tags ?? []).map((t) => t.pin_id))),
    new Map(),
    'Product tags not counted',
  );
  const productsByPin = new Map();
  for (const pin of pins) {
    const gids = new Set();
    for (const tag of pin.product_tags ?? []) {
      const gid = gidFromLink(tagLinks.get(String(tag.pin_id)));
      if (gid) gids.add(gid);
    }
    const linked = gidFromLink(pin.link);
    if (linked) gids.add(linked);
    if (gids.size) productsByPin.set(String(pin.id), { gids: [...gids], createdAt: pin.created_at });
  }
  const lastPinned = new Map();
  const pinCount = new Map();
  for (const { gids, createdAt } of productsByPin.values()) {
    for (const gid of gids) {
      pinCount.set(gid, (pinCount.get(gid) ?? 0) + 1);
      if (!lastPinned.has(gid) || createdAt > lastPinned.get(gid)) lastPinned.set(gid, createdAt);
    }
  }

  // What performs: top pins in the last 90 days, credited to their products and product types
  const typeOf = new Map(candidates.map((p) => [p.id, p.productType]));
  const typeStats = new Map();
  const productValue = new Map();
  for (const [pinId, m] of pinMetrics) {
    for (const gid of productsByPin.get(pinId)?.gids ?? []) {
      productValue.set(gid, (productValue.get(gid) ?? 0) + pinValue(m));
      const type = typeOf.get(gid);
      if (!type) continue;
      const stat = typeStats.get(type) ?? { saves: 0, clicks: 0, impressions: 0, value: 0 };
      stat.saves += m.SAVE ?? 0;
      stat.clicks += m.OUTBOUND_CLICK ?? 0;
      stat.impressions += m.IMPRESSION ?? 0;
      stat.value += pinValue(m);
      typeStats.set(type, stat);
    }
  }

  const ctx = {
    lastPinned, pinCount, typeStats, productValue, unitsSold,
    vendorDemand: demandBySku(),
    maxTypeValue: Math.max(0, ...[...typeStats.values()].map((s) => s.value)),
    maxProductValue: Math.max(0, ...productValue.values()),
  };
  const scored = candidates
    .map((p) => ({ ...p, ...scoreProduct(p, ctx) }))
    .sort((a, b) => b.score - a.score);

  const recentCutoff = Date.now() - 90 * DAY;
  const data = {
    generatedAt: new Date().toISOString(),
    summary: {
      inStock: candidates.length,
      neverPinned: scored.filter((p) => p.lastPinnedAt === null).length,
      pinnedLast90: scored.filter((p) => p.lastPinnedAt && new Date(p.lastPinnedAt).getTime() > recentCutoff).length,
      pinsTotal: pins.length,
      pinsMatched: productsByPin.size,
      lastPinAt: pins[0]?.created_at ?? null,
      topTypes: [...typeStats.entries()]
        .sort((a, b) => b[1].value - a[1].value)
        .slice(0, 5)
        .map(([type, s]) => ({ type, saves: s.saves, clicks: s.clicks, impressions: s.impressions })),
    },
    products: diversify(scored).slice(0, MAX_PRODUCTS),
    rooms: suggestRooms(scored, config.productTypeCombinations ?? []),
    warnings,
  };
  cache = { at: Date.now(), data };
  return data;
}
