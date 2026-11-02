#!/usr/bin/env node
// Audit Uttermost product types against config.json productTypeCombinations.
//
// Reports every product type the vendor carries, how many products are usable for
// room generation (in stock + custom.design_style set), which types no combination
// uses, and which combinations can't currently build a room. Then asks Claude to
// propose combinations that cover the missing types.
//
// Usage:
//   npm run audit:combos                       # report + proposals (dry run)
//   npm run audit:combos -- --apply            # also append proposals to config.json
//   npm run audit:combos -- --min 5            # only cover types with >= 5 usable products (default 3)
//   npm run audit:combos -- --vendor Uttermost # vendor to audit (default Uttermost)
//   npm run audit:combos -- --ignore "Gift Cards,Hardware"
//   npm run audit:combos -- --json             # machine-readable output

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { graphqlRequest } from '../lib/shopify.js';

const CONFIG_PATH = join(process.cwd(), 'config.json');
const TYPES_PER_COMBO = 3;

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const VENDOR = opt('vendor', 'Uttermost');
const MIN_USABLE = Number(opt('min', 3));
const IGNORE = new Set(opt('ignore', '').split(',').map((s) => s.trim()).filter(Boolean));
const APPLY = flag('apply');
const JSON_OUT = flag('json');

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

// ── Fetch ─────────────────────────────────────────────────────────────────────
const QUERY = `
  query auditProducts($cursor: String, $query: String) {
    products(first: 250, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          productType
          totalInventory
          designStyle: metafield(namespace: "custom", key: "design_style") { value }
        }
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

async function fetchVendorProducts(config) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN (run via npm run audit:combos so .env.local loads)');

  // Same tag exclusions the app applies in fetchProducts()
  const query = [`vendor:"${VENDOR}"`, 'status:active', ...(config.excludeTags ?? []).map((t) => `-tag:${t}`)].join(' AND ');
  const products = [];
  let cursor = null;
  do {
    const data = await graphqlRequest(domain, token, QUERY, { cursor, query });
    for (const { node } of data.products.edges) {
      products.push({
        productType: node.productType || '(blank)',
        inStock: node.totalInventory > 0,
        styles: parseStyles(node.designStyle?.value),
      });
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    if (!JSON_OUT) process.stdout.write(`\r  fetched ${products.length} products…`);
  } while (cursor);
  log('');
  return products;
}

// ── Analysis ──────────────────────────────────────────────────────────────────
function analyze(products, config) {
  const combos = config.productTypeCombinations;
  const usable = (p) => (!config.requireInventory || p.inStock) && p.styles.length > 0;

  // Per type: totals, usable count, usable count per style
  const types = new Map();
  for (const p of products) {
    const t = types.get(p.productType) ?? { type: p.productType, total: 0, inStock: 0, withStyle: 0, usable: 0, styles: {} };
    t.total++;
    if (p.inStock) t.inStock++;
    if (p.styles.length) t.withStyle++;
    if (usable(p)) {
      t.usable++;
      for (const s of p.styles) t.styles[s] = (t.styles[s] ?? 0) + 1;
    }
    types.set(p.productType, t);
  }

  const comboCount = (type) => combos.filter((c) => c.types.includes(type)).length;
  const typeRows = [...types.values()]
    .map((t) => ({ ...t, combos: comboCount(t.type) }))
    .sort((a, b) => b.usable - a.usable || b.total - a.total);

  // A combination builds a room for a style only if every type has a usable product in that style
  const allStyles = [...new Set(typeRows.flatMap((t) => Object.keys(t.styles)))].sort();
  const comboRows = combos.map((c) => {
    const missingTypes = c.types.filter((t) => !(types.get(t)?.usable > 0));
    const viableStyles = allStyles.filter((s) => c.types.every((t) => types.get(t)?.styles[s] > 0));
    return { name: c.name, types: c.types, missingTypes, viableStyles };
  });

  const uncovered = typeRows.filter((t) =>
    t.combos === 0 && t.usable >= MIN_USABLE && t.type !== '(blank)' && !IGNORE.has(t.type));
  const belowMin = typeRows.filter((t) =>
    t.combos === 0 && t.usable > 0 && t.usable < MIN_USABLE && t.type !== '(blank)' && !IGNORE.has(t.type));

  return { typeRows, comboRows, uncovered, belowMin, allStyles, types };
}

// ── Proposals ─────────────────────────────────────────────────────────────────
async function proposeCombinations({ uncovered, typeRows, types }, config) {
  if (!uncovered.length) return { proposals: [], skipped: [] };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log('\n  ANTHROPIC_API_KEY not set, skipping proposals.');
    return { proposals: [], skipped: [] };
  }

  const usableTypes = typeRows.filter((t) => t.usable > 0 && t.type !== '(blank)');
  const catalog = usableTypes.map((t) => `${t.type} (${t.usable} usable; styles: ${Object.keys(t.styles).join(', ')})`).join('\n');
  const existing = config.productTypeCombinations.map((c) => `${c.name}: ${c.types.join(', ')}`).join('\n');

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You configure a furniture store's room-vignette generator. Each "combination" is a named room vignette made of exactly ${TYPES_PER_COMBO} product types that would plausibly be photographed together in one styled scene.\n\n` +
        `These product types have stock but are not used by any combination:\n${uncovered.map((t) => `- ${t.type}`).join('\n')}\n\n` +
        `Propose 1-2 new combinations for each uncovered type. Rules:\n` +
        `- Exactly ${TYPES_PER_COMBO} types per combination, all different, each copied EXACTLY from the catalog below.\n` +
        `- Include the uncovered type, and pair it with types that share its design styles so rooms can be built.\n` +
        `- Prefer pairing with well-stocked types. Mix a furniture piece, a lighting or wall piece, and a decor accent where it makes sense.\n` +
        `- Names are short room labels like the existing ones (e.g. "Entryway Alt", "Reading Nook"), and must not duplicate existing names.\n` +
        `- If a type can't appear in a styled room scene (parts, hardware, gift cards, swatches), skip it and say why.\n\n` +
        `Return JSON only, no code fences: {"proposals":[{"name":"...","types":["...","...","..."],"covers":"<uncovered type>","reason":"<short>"}],"skipped":[{"type":"...","reason":"..."}]}\n\n` +
        `Catalog (usable types):\n${catalog}\n\nExisting combinations:\n${existing}`,
    }],
  });

  const raw = message.content?.[0]?.text?.trim() ?? '';
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));

  // Validate: real types, right count, unique names, can build at least one style
  const names = new Set(config.productTypeCombinations.map((c) => c.name.toLowerCase()));
  const proposals = [];
  for (const p of parsed.proposals ?? []) {
    const problems = [];
    const uniqueTypes = [...new Set(p.types ?? [])];
    if (uniqueTypes.length !== TYPES_PER_COMBO) problems.push(`needs ${TYPES_PER_COMBO} distinct types`);
    const unknown = uniqueTypes.filter((t) => !(types.get(t)?.usable > 0));
    if (unknown.length) problems.push(`unknown/unstocked types: ${unknown.join(', ')}`);
    if (!p.name || names.has(p.name.toLowerCase())) problems.push('duplicate or missing name');
    const viableStyles = [...new Set(uniqueTypes.flatMap((t) => Object.keys(types.get(t)?.styles ?? {})))]
      .filter((s) => uniqueTypes.every((t) => types.get(t)?.styles[s] > 0));
    if (!problems.length && !viableStyles.length) problems.push('no design style has all three types in stock');
    proposals.push({ ...p, types: uniqueTypes, viableStyles, problems });
    if (!problems.length) names.add(p.name.toLowerCase());
  }
  return { proposals, skipped: parsed.skipped ?? [] };
}

// ── Output ────────────────────────────────────────────────────────────────────
function pad(str, n) {
  str = String(str);
  return str.length >= n ? str.slice(0, n - 1) + '…' : str + ' '.repeat(n - str.length);
}

/** Group product types that differ only by case / plural, e.g. "Accent Chair" vs "Accent Chairs". */
function findNearDuplicates(typeRows) {
  const key = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/(es|s)\b/g, '');
  const groups = new Map();
  for (const t of typeRows) {
    if (t.type === '(blank)') continue;
    const k = key(t.type);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function printReport({ typeRows, comboRows, uncovered, belowMin }, products) {
  log(`\n${VENDOR}: ${products.length} active products across ${typeRows.length} product types`);
  log(`Usable = ${config.requireInventory ? 'in stock + ' : ''}custom.design_style set (what room generation can actually pick)\n`);

  log(`${pad('PRODUCT TYPE', 34)}${pad('TOTAL', 7)}${pad('IN STOCK', 10)}${pad('STYLED', 8)}${pad('USABLE', 8)}COMBOS`);
  for (const t of typeRows) {
    const marker = t.combos === 0 && t.usable > 0 ? '  ← not in any combination' : t.combos > 0 && t.usable === 0 ? '  ← in combos but no usable products' : '';
    log(`${pad(t.type, 34)}${pad(t.total, 7)}${pad(t.inStock, 10)}${pad(t.withStyle, 8)}${pad(t.usable, 8)}${t.combos}${marker}`);
  }

  const broken = comboRows.filter((c) => c.missingTypes.length || !c.viableStyles.length);
  log(`\nCombinations: ${comboRows.length - broken.length}/${comboRows.length} can build a room in at least one style`);
  for (const c of broken) {
    log(`  ✗ ${c.name} (${c.types.join(', ')})` +
      (c.missingTypes.length ? `: no usable ${c.missingTypes.join(', ')}` : ': no single style has all three types'));
  }

  const dupes = findNearDuplicates(typeRows);
  if (dupes.length) {
    log(`\nNear-duplicate product types (products under the minority spelling are invisible to combinations using the other):`);
    for (const g of dupes) log(`  - ${g.map((t) => `"${t.type}" (${t.total})`).join(' vs ')}`);
  }
  if (typeRows.some((t) => t.type === '(blank)')) {
    log(`  - ${typeRows.find((t) => t.type === '(blank)').total} product(s) have no product type at all`);
  }

  log(`\nUncovered types with >= ${MIN_USABLE} usable products: ${uncovered.length ? uncovered.map((t) => `${t.type} (${t.usable})`).join(', ') : 'none 🎉'}`);
  if (belowMin.length) log(`Uncovered but below --min ${MIN_USABLE}: ${belowMin.map((t) => `${t.type} (${t.usable})`).join(', ')}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
log(`Auditing ${VENDOR} product types against ${config.productTypeCombinations.length} combinations…`);
const products = await fetchVendorProducts(config);
const analysis = analyze(products, config);
printReport(analysis, products);

const { proposals, skipped } = await proposeCombinations(analysis, config);
const valid = proposals.filter((p) => !p.problems.length);

if (proposals.length) {
  log(`\nProposed combinations:`);
  for (const p of proposals) {
    const status = p.problems.length ? `✗ rejected (${p.problems.join('; ')})` : `✓ ${p.viableStyles.length} style(s): ${p.viableStyles.join(', ')}`;
    log(`  ${p.name}: ${p.types.join(', ')}\n      covers ${p.covers}. ${p.reason ?? ''}\n      ${status}`);
  }
}
if (skipped.length) {
  log(`\nSkipped (not room-scene products):`);
  for (const s of skipped) log(`  - ${s.type}: ${s.reason}`);
}

const stillUncovered = analysis.uncovered.filter((t) => !valid.some((p) => p.types.includes(t.type)) && !skipped.some((s) => s.type === t.type));
if (stillUncovered.length) log(`\nStill uncovered after proposals: ${stillUncovered.map((t) => t.type).join(', ')}`);

if (APPLY && valid.length) {
  const fresh = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  fresh.productTypeCombinations.push(...valid.map(({ name, types }) => ({ name, types })));
  writeFileSync(CONFIG_PATH, JSON.stringify(fresh, null, 2) + '\n');
  log(`\n✓ Added ${valid.length} combination(s) to config.json (now ${fresh.productTypeCombinations.length}).`);
} else if (valid.length) {
  log(`\nDry run. Re-run with --apply to add the ${valid.length} valid combination(s) to config.json.`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ vendor: VENDOR, totalProducts: products.length, ...analysis, types: undefined, proposals, skipped, applied: APPLY ? valid.length : 0 }, null, 2));
}
