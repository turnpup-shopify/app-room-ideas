import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { isConnected, listAllPins } from './pinterest.js';

// Pins posted from this app, for the pin guide's repeat rules (sections 7 and 9):
// never re-upload an image, cap pins per product URL, spread a product's pins out, keep the 70/30 pattern mix.
const POSTED_FILE = join(process.cwd(), 'pinterest-posted.json');
const PINS_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
const URL_PIN_CAP = 5;
const SPREAD_DAYS = 7;
const MIX_WINDOW = 10;
const HERO_SHARE = 0.3;

function readLog() {
  if (!existsSync(POSTED_FILE)) return [];
  try {
    return JSON.parse(readFileSync(POSTED_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/** SHA-256 of the cleaned JPEG. Same render cleaned twice gives the same hash. */
export function imageHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Product handle from a store URL, or null. */
function productHandle(link) {
  const m = String(link || '').match(/\/products\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Log a posted pin.
 * @param {{ pinId: string, pinUrl?: string, title: string, link?: string, pattern?: string, hash?: string, sourceImageUrl?: string }} pin
 */
export function recordPostedPin(pin) {
  const log = readLog();
  log.push({ ...pin, handle: productHandle(pin.link), postedAt: Date.now() });
  writeFileSync(POSTED_FILE, JSON.stringify(log, null, 2));
  pinsCache = null;
}

/** The logged pin that used this image (same cleaned bytes or same source URL), or null. */
export function findPostedImage({ hash, sourceImageUrl }) {
  return readLog().find((p) => (hash && p.hash === hash) || (sourceImageUrl && p.sourceImageUrl === sourceImageUrl)) ?? null;
}

/** Error message for a re-used image, or null if the image is new. */
export function duplicateImageError(match) {
  if (!match) return null;
  const when = new Date(match.postedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `This image was already pinned on ${when} ("${match.title}"${match.pinUrl ? `, ${match.pinUrl}` : ''}). ` +
    'Pinterest treats re-uploads as spam. Create a new image for this pin.';
}

let pinsCache = null;

/** Pins on the Pinterest account (cached 10 min), so pins posted outside the app count too. Empty when not connected. */
async function accountPins() {
  if (pinsCache && Date.now() - pinsCache.at < PINS_TTL_MS) return pinsCache.pins;
  const pins = isConnected() ? await listAllPins().catch(() => []) : [];
  pinsCache = { at: Date.now(), pins };
  return pins;
}

/**
 * What the pin guide's repeat rules say about a new pin for these products.
 * @param {{ handles: string[] }} opts the room's product handles (any of them could end up the hero)
 * @returns {Promise<{ earlierTitles: Record<string, string[]>, patternHint: string|null, warningsFor: (link: string) => string[] }>}
 */
export async function pinHistoryFor({ handles = [] }) {
  const wanted = new Set(handles.filter(Boolean));
  const log = readLog();
  const pins = await accountPins();

  // Pins per product: account pins by link, plus logged pins not yet in the account list
  const byHandle = new Map();
  const add = (handle, pin) => {
    if (!handle || !wanted.has(handle)) return;
    const list = byHandle.get(handle) ?? [];
    if (!list.some((p) => p.id === pin.id)) list.push(pin);
    byHandle.set(handle, list);
  };
  for (const p of pins) add(productHandle(p.link), { id: p.id, title: p.title, at: Date.parse(p.created_at) });
  for (const p of log) add(p.handle, { id: p.pinId, title: p.title, at: p.postedAt });
  for (const list of byHandle.values()) list.sort((a, b) => b.at - a.at);

  function warningsFor(link) {
    const productPins = byHandle.get(productHandle(link)) ?? [];
    const warnings = [];
    if (productPins.length >= URL_PIN_CAP) {
      warnings.push(`${productPins.length} pins already link to this product. The guide caps it at 3 to 5 per product.`);
    }
    const daysAgo = productPins[0] ? Math.floor((Date.now() - productPins[0].at) / DAY_MS) : null;
    if (daysAgo !== null && daysAgo < SPREAD_DAYS) {
      warnings.push(`This product was last pinned ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}. Spread pins for one product across weeks.`);
    }
    return warnings;
  }

  // 70/30 mix: room idea (A, C) vs hero piece (B) over the last pins posted from the app
  const recent = log.filter((p) => p.pattern).slice(-MIX_WINDOW);
  const heroShare = recent.length ? recent.filter((p) => p.pattern === 'B').length / recent.length : 0;
  let patternHint = null;
  if (recent.length >= 3 && heroShare > HERO_SHARE) {
    patternHint = `${Math.round(heroShare * 100)} percent of the last ${recent.length} pins used Pattern B. Use Pattern A or C for this one.`;
  } else if (recent.length >= 5 && heroShare < HERO_SHARE - 0.1) {
    patternHint = `Only ${Math.round(heroShare * 100)} percent of the last ${recent.length} pins used Pattern B. Use Pattern B if the hero piece supports a real hook.`;
  }

  const earlierTitles = Object.fromEntries([...byHandle].map(([h, list]) => [h, list.map((p) => p.title).filter(Boolean).slice(0, 8)]));
  return { earlierTitles, patternHint, warningsFor };
}
