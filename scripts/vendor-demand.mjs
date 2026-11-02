#!/usr/bin/env node
// Uttermost demand report from the daily inventory feed history (lib/vendorFeed.js,
// lib/vendorDemand.js). The same data is in the app under ☰ → Vendor Demand.
//
// Usage:
//   npm run vendor:demand                 # report from vendor-feed/
//   npm run vendor:demand -- --sync       # pull new days from the Apps Script archive first
//   npm run vendor:demand -- --top 30     # rows per section (default 20)
//   npm run vendor:demand -- --json       # machine-readable output

import { syncFeedSnapshots } from '../lib/vendorFeed.js';
import { buildDemandReport } from '../lib/vendorDemand.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const TOP = Number(opt('top', 20));
const JSON_OUT = flag('json');
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

function table(rows, cols) {
  if (!rows.length) return log('  (none)');
  const widths = cols.map(([label, get]) => Math.min(48, Math.max(label.length, ...rows.map((r) => String(get(r)).length))));
  log('  ' + cols.map(([label], i) => label.padEnd(widths[i])).join('  '));
  for (const r of rows) log('  ' + cols.map(([, get], i) => String(get(r)).slice(0, widths[i]).padEnd(widths[i])).join('  '));
}

if (flag('sync')) {
  try {
    const { added, total } = await syncFeedSnapshots();
    log(`Synced feed archive: ${added} new day(s), ${total} in the archive.`);
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }
}

const report = await buildDemandReport({ top: TOP });
if (!report.ready) {
  console.error(`Need at least 2 daily snapshots in vendor-feed/ (have ${report.snapshots}). Run with --sync after setting up the Apps Script archive.`);
  process.exit(1);
}
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const units = (r) => `${r.unitsOut}${r.capped ? '+' : ''}`;
const notes = (r) => r.notes.join(' / ');
log(`\nUttermost demand, ${report.from} → ${report.to} (${report.snapshots} snapshots over ${report.days} days)`);
log('Units = summed day-over-day warehouse drops across EC/WC/TX for all dealers. "+" = stock sat at the 50 cap on most days, so real sales are higher.\n');

log('Top sellers you carry');
table(report.topCarried, [['Units', units], ['/wk', (r) => r.perWeek], ['Vendor stock', (r) => r.vendorStock], ['Your stock', (r) => r.product.qty], ['Type', (r) => r.product.productType], ['Product', (r) => r.product.title]]);

log('\nTop sellers you don\'t carry (Uttermost SKUs not on your store)');
table(report.topNotCarried, [['Units', units], ['/wk', (r) => r.perWeek], ['Vendor stock', (r) => r.vendorStock], ['SKU', (r) => r.sku], ['Name', (r) => r.uttermost?.name ?? ''], ['Category', (r) => r.uttermost?.category ?? '']]);

log('\nSelling fast and running low at the vendor (≤ 21 days of stock at this pace)');
table(report.runningLow, [['Days left', (r) => r.daysOfCover], ['/wk', (r) => r.perWeek], ['Vendor stock', (r) => r.vendorStock], ['Product', (r) => r.product.title], ['Next avail', notes]]);

log('\nSold out at the vendor now, but were selling (watch for restock)');
table(report.soldOutSelling, [['Units', units], ['/wk', (r) => r.perWeek], ['Your stock', (r) => r.product.qty], ['Product', (r) => r.product.title], ['Next avail', notes]]);

log('\nDemand by product type (SKUs you carry)');
table(report.byType.slice(0, TOP), [['Units', (r) => r.unitsOut], ['SKUs', (r) => r.skus], ['Type', (r) => r.type]]);

const hk = report.housekeeping;
log('\nHousekeeping');
log(`  Active on your store but marked NO LONGER AVAILABLE: ${hk.discontinuedActive.length}`);
for (const r of hk.discontinuedActive) log(`    ${r.sku}  ${r.product.title}`);
log(`  999 override but the vendor now has 10+ in stock: ${hk.overrideHasStock.length}`);
for (const r of hk.overrideHasStock) log(`    ${r.sku}  ${r.product.title} (vendor ${r.vendorStock})`);
log(`  Active SKUs missing from the feed: ${hk.activeNotInFeed.length}${hk.activeNotInFeed.length ? ' (e.g. ' + hk.activeNotInFeed.slice(0, 5).map((r) => r.sku).join(', ') + ')' : ''}`);
