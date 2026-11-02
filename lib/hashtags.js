// Shared by the client (tag library UI) and server (pin copy).

/**
 * Normalize any tag-ish string to "#CamelCase" form. Returns null if empty.
 * Keeps existing internal capitalization ("#MidCenturyModern" stays as-is).
 */
export function normalizeHashtag(str) {
  const words = String(str || '').replace(/^#+/, '').replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return '#' + words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

/** Split pasted text / file contents (commas, newlines, spaces between #tags) into normalized, de-duplicated hashtags. */
export function parseHashtags(text) {
  const raw = String(text || '').includes('#')
    ? String(text).split(/[\s,;]+(?=#)|[\n,;]+/)
    : String(text || '').split(/[\n,;]+/);
  return dedupeHashtags(raw.map(normalizeHashtag).filter(Boolean));
}

export function dedupeHashtags(tags) {
  const seen = new Set();
  return tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
