import fs from 'fs';
import path from 'path';

// Uttermost daily inventory feed history.
// The Apps Script in scripts/apps-script/uttermost-feed-archive.gs saves one CSV per day
// (SKU, EC Qty, EC Next Avail, WC Qty, WC Next Avail, TX Qty, TX Next Avail) and serves them;
// syncFeedSnapshots() mirrors them into vendor-feed/. Day-over-day drops in warehouse stock
// are units Uttermost shipped to all dealers, so they estimate market demand per SKU.
//
// Caveats baked into the numbers:
// - Warehouse quantities are capped at 50, so a SKU sitting at 50 hides its sales.
// - A restock on the same day as sales hides those sales; transfers/adjustments look like sales.

const FEED_DIR = path.join(process.cwd(), 'vendor-feed');
const FILE_RE = /^uttermost-avail-(\d{4}-\d{2}-\d{2})\.csv$/;
const WAREHOUSES = ['EC', 'WC', 'TX'];
const QTY_CAP = 50;

export function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

/** Download any archived days not yet in vendor-feed/. Returns { added, total }. */
export async function syncFeedSnapshots() {
  const url = process.env.UTTERMOST_FEED_URL;
  const token = process.env.UTTERMOST_FEED_TOKEN;
  if (!url || !token) throw new Error('Set UTTERMOST_FEED_URL and UTTERMOST_FEED_TOKEN in .env.local (see scripts/apps-script/uttermost-feed-archive.gs).');
  fs.mkdirSync(FEED_DIR, { recursive: true });

  const call = async (params) => {
    const res = await fetch(`${url}?${new URLSearchParams({ token, ...params })}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Feed archive returned ${res.status}`);
    return res;
  };
  const listText = await (await call({ action: 'list' })).text();
  if (/^\s*</.test(listText)) {
    throw new Error(
      'The feed archive returned a Google sign-in page instead of data. In Apps Script, set the web app deployment to ' +
      '"Who has access: Anyone", deploy a new version, and make sure UTTERMOST_FEED_URL ends in /exec (not /dev).'
    );
  }
  const list = JSON.parse(listText);
  if (list.error) throw new Error(`Feed archive: ${list.error}`);

  let added = 0;
  for (const date of list.snapshots ?? []) {
    const file = path.join(FEED_DIR, `uttermost-avail-${date}.csv`);
    if (fs.existsSync(file)) continue;
    // Apps Script occasionally returns a transient error page; retry once before giving up
    let text = await (await call({ action: 'get', date })).text();
    if (!text.startsWith('SKU')) text = await (await call({ action: 'get', date })).text();
    if (!text.startsWith('SKU')) throw new Error(`Feed archive returned an unexpected file for ${date}`);
    fs.writeFileSync(file, text);
    added++;
  }
  return { added, total: (list.snapshots ?? []).length };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** @returns {Array<{ date: string, skus: Map<string, { qty: number[], notes: string[] }> }>} oldest first */
export function loadSnapshots(dir = FEED_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => name.match(FILE_RE))
    .filter(Boolean)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([name, date]) => {
      const [header, ...lines] = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/).filter(Boolean);
      const cols = parseCsvLine(header).map((c) => c.trim());
      const idx = (label) => cols.indexOf(label);
      const skus = new Map();
      for (const line of lines) {
        const row = parseCsvLine(line);
        const sku = normalizeSku(row[idx('SKU')]);
        if (!sku) continue;
        skus.set(sku, {
          qty: WAREHOUSES.map((w) => parseInt(row[idx(`${w} Qty`)], 10) || 0),
          notes: WAREHOUSES.map((w) => String(row[idx(`${w} Next Avail`)] || '').trim()),
        });
      }
      return { date, skus };
    });
}

/**
 * Estimated sell-through per SKU across the loaded snapshots.
 * @returns {{ from: string|null, to: string|null, days: number, snapshots: number, skus: Map<string, object> }}
 */
export function analyzeDemand(snapshots = loadSnapshots()) {
  const result = { from: snapshots[0]?.date ?? null, to: snapshots.at(-1)?.date ?? null, snapshots: snapshots.length, days: 0, skus: new Map() };
  if (snapshots.length < 2) return result;
  result.days = Math.round((Date.parse(result.to) - Date.parse(result.from)) / 86400000);

  const latest = snapshots.at(-1).skus;
  for (const [sku, now] of latest) {
    result.skus.set(sku, {
      sku,
      unitsOut: 0,        // sum of warehouse drops
      restocks: 0,        // warehouse-days where stock went up
      cappedDays: 0,      // days every warehouse sat at the 50 cap (sales invisible)
      stockoutDays: 0,    // days with 0 in every warehouse
      observedDays: 0,
      current: now.qty.reduce((a, b) => a + b, 0),
      notes: [...new Set(now.notes.filter(Boolean))],
      discontinued: now.notes.some((n) => /NO LONGER AVAILABLE/i.test(n)),
    });
  }

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].skus;
    const cur = snapshots[i].skus;
    for (const [sku, stat] of result.skus) {
      const a = prev.get(sku);
      const b = cur.get(sku);
      if (!a || !b) continue;
      stat.observedDays++;
      for (let w = 0; w < WAREHOUSES.length; w++) {
        const delta = b.qty[w] - a.qty[w];
        if (delta < 0) stat.unitsOut += -delta;
        else if (delta > 0) stat.restocks++;
      }
      if (b.qty.every((q) => q >= QTY_CAP)) stat.cappedDays++;
      if (b.qty.every((q) => q === 0)) stat.stockoutDays++;
    }
  }

  for (const stat of result.skus.values()) {
    const days = Math.max(stat.observedDays, 1);
    stat.perWeek = Math.round((stat.unitsOut / days) * 7 * 10) / 10;
    // Days until the vendor runs out at the current pace (null when not selling)
    stat.daysOfCover = stat.unitsOut > 0 ? Math.round(stat.current / (stat.unitsOut / days)) : null;
    // Share of observed days where the cap hid sales; high values mean perWeek is a floor
    stat.cappedShare = Math.round((stat.cappedDays / days) * 100) / 100;
  }
  return result;
}
