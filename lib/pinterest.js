import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const TOKEN_FILE = join(process.cwd(), 'pinterest-auth.json');
// catalogs:read lets us find each product's catalog pin for product tagging
const SCOPES = 'user_accounts:read,boards:read,boards:write,pins:read,pins:write,catalogs:read';
const MANUAL_TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Read env at call time so changes don't require a server restart. */
function getApiHost() {
  return process.env.PINTEREST_SANDBOX === '1'
    ? 'api-sandbox.pinterest.com'
    : 'api.pinterest.com';
}

function getAppCredentials() {
  const appId = process.env.PINTEREST_APP_ID;
  const appSecret = process.env.PINTEREST_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/**
 * Build the Pinterest OAuth authorization URL.
 * @param {string} redirectUri - Full callback URL
 * @returns {string}
 */
export function getAuthUrl(redirectUri) {
  const creds = getAppCredentials();
  if (!creds) throw new Error('PINTEREST_APP_ID and PINTEREST_APP_SECRET must be set');
  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: creds.appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `https://www.pinterest.com/oauth/?${params.toString()}`;
}

function readTokenFile() {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Exchange authorization code for access + refresh tokens.
 * @param {string} code
 * @param {string} redirectUri
 * @returns {Promise<object>} Token data
 */
export async function exchangeCode(code, redirectUri) {
  const creds = getAppCredentials();
  if (!creds) throw new Error('Pinterest credentials not configured');

  const basicAuth = Buffer.from(`${creds.appId}:${creds.appSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString();

  const res = await fetch(`https://${getApiHost()}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json();
  if (res.status !== 200) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
  };

  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  return tokenData;
}

/**
 * Refresh an expired access token.
 * @returns {Promise<object>} Updated token data
 */
async function refreshAccessToken() {
  const creds = getAppCredentials();
  if (!creds) throw new Error('Pinterest credentials not configured');

  const stored = readTokenFile();
  if (!stored || !stored.refresh_token) {
    throw new Error('No refresh token available — re-authorize via OAuth');
  }

  const basicAuth = Buffer.from(`${creds.appId}:${creds.appSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
  }).toString();

  const res = await fetch(`https://${getApiHost()}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json();
  if (res.status !== 200) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }

  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || stored.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
  };

  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  return tokenData;
}

/**
 * Get a valid access token, refreshing if expired.
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  const stored = readTokenFile();
  if (!stored || !stored.access_token) {
    throw new Error('Not connected to Pinterest — authorize via OAuth first');
  }

  // Manual tokens — check 24h TTL, no auto-refresh
  if (stored.manual) {
    const expiresAt = stored.obtained_at + MANUAL_TOKEN_TTL;
    if (Date.now() > expiresAt) {
      throw new Error('Pinterest token expired — paste a new token');
    }
    return stored.access_token;
  }

  // Check if token is expired (with 5 min buffer)
  const expiresAt = stored.obtained_at + (stored.expires_in * 1000);
  if (Date.now() > expiresAt - 300000) {
    const refreshed = await refreshAccessToken();
    return refreshed.access_token;
  }

  return stored.access_token;
}

/**
 * Check whether we have a stored token (does NOT validate it).
 * @returns {boolean}
 */
export function isConnected() {
  const stored = readTokenFile();
  if (!stored || !stored.access_token) return false;
  // Manual tokens expire after 24h
  if (stored.manual) {
    const expiresAt = stored.obtained_at + MANUAL_TOKEN_TTL;
    if (Date.now() > expiresAt) return false;
  }
  return true;
}

/**
 * Validate the stored token by hitting the Pinterest user account endpoint.
 * Returns { valid: true, username } if the token works, { valid: false, reason } if not.
 * @returns {Promise<{ valid: boolean, username?: string, reason?: string }>}
 */
export async function validateToken() {
  try {
    const token = await getAccessToken();
    const host = getApiHost();

    // Try /v5/user_account first, fall back to /v5/boards (works without user_accounts:read scope)
    let username = null;
    let validRead = false;

    const userRes = await fetch(`https://${host}/v5/user_account`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const userData = await userRes.json().catch(() => ({}));

    if (userRes.status === 200) {
      validRead = true;
      username = userData.username || userData.business_name || null;
    } else {
      // user_account may fail if token lacks user_accounts:read — try boards instead
      console.log(`[pinterest] /v5/user_account returned ${userRes.status}, trying /v5/boards…`);
      const boardsRes = await fetch(`https://${host}/v5/boards?page_size=1`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const boardsData = await boardsRes.json().catch(() => ({}));

      if (boardsRes.status === 200) {
        validRead = true;
        // Extract username from board owner if available
        const firstBoard = boardsData.items?.[0];
        username = firstBoard?.owner?.username || null;
      } else {
        // Both endpoints failed — token is truly invalid
        const detail = boardsData.message || userData.message || JSON.stringify(userData);
        console.error(`[pinterest] validateToken: both endpoints failed. user_account=${userRes.status} boards=${boardsRes.status}`, detail);
        if (userRes.status === 401 || boardsRes.status === 401) {
          return { valid: false, reason: 'expired', detail, apiHost: host };
        }
        return { valid: false, reason: `Pinterest API returned ${userRes.status}`, detail, apiHost: host };
      }
    }

    // Token is valid for reading — probe write scopes with an intentionally
    // malformed pin create (empty body). If we get a scope error (code 3) the
    // token lacks write access. Any other error means write scope is present.
    const scopes = ['boards:read'];
    if (userRes.status === 200) scopes.push('user_accounts:read');
    let canWrite = false;
    try {
      const probeRes = await fetch(`https://${host}/v5/pins`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // intentionally invalid — we just check if scope allows it
      });
      const probeData = await probeRes.json().catch(() => ({}));
      if (probeData.code === 3) {
        // Scope error — extract missing scopes
        const missingMatch = (probeData.message || '').match(/Missing:\s*\[([^\]]+)\]/);
        if (missingMatch) console.log(`[pinterest] Missing write scopes: ${missingMatch[1]}`);
      } else {
        // Got a validation error or other non-scope error = write scope present
        canWrite = true;
        scopes.push('boards:write', 'pins:write');
      }
    } catch { /* probe failed, assume no write */ }

    return { valid: true, username, apiHost: host, scopes, canWrite };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

/**
 * Save a manually-provided access token to the token file.
 * @param {string} accessToken
 */
export function saveManualToken(accessToken) {
  const tokenData = {
    access_token: accessToken,
    refresh_token: null,
    token_type: 'bearer',
    expires_in: MANUAL_TOKEN_TTL / 1000,
    obtained_at: Date.now(),
    manual: true,
  };
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
}

/**
 * List the user's Pinterest boards.
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function listBoards() {
  const token = await getAccessToken();
  const allBoards = [];
  let bookmark = null;

  do {
    const url = bookmark
      ? `https://${getApiHost()}/v5/boards?page_size=100&bookmark=${encodeURIComponent(bookmark)}`
      : `https://${getApiHost()}/v5/boards?page_size=100`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    const data = await res.json();
    if (res.status !== 200) {
      throw new Error(`Failed to list boards: ${JSON.stringify(data)}`);
    }

    for (const b of (data.items || [])) {
      allBoards.push({ id: b.id, name: b.name });
    }

    bookmark = data.bookmark || null;
  } while (bookmark);

  return allBoards;
}

/**
 * Create a pin on Pinterest with a base64-encoded image buffer.
 * @param {{ imageBuffer: Buffer, title: string, description: string, link?: string, boardId: string, altText?: string }} opts
 * @returns {Promise<{ id: string, url: string }>}
 */
export async function createPin({ imageBuffer, title, description, link, boardId, altText }) {
  const token = await getAccessToken();
  const base64Image = imageBuffer.toString('base64');

  const payload = {
    title: title || '',
    description: description || '',
    media_source: {
      source_type: 'image_base64',
      content_type: 'image/jpeg',
      data: base64Image,
    },
  };

  if (boardId) payload.board_id = boardId;

  if (link) payload.link = link;
  if (altText) payload.alt_text = altText;

  const res = await fetch(`https://${getApiHost()}/v5/pins`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Failed to create pin: ${JSON.stringify(data)}`);
  }

  const pinUrl = `https://www.pinterest.com/pin/${data.id}/`;
  return { id: data.id, url: pinUrl };
}

// ── Product tagging ──────────────────────────────────────────────────────────
// A pin can carry up to 24 product tags. Each tag is a *product pin* from the account's
// catalog (synced from Shopify), found by matching the catalog's item_group_id to the
// Shopify product ID.

const MAX_PRODUCT_TAGS = 24;
const FEEDS_TTL = 10 * 60 * 1000;
let feedsCache = null; // { ids: string[], at: number }

async function pinterestGet(path, token) {
  const res = await fetch(`https://${getApiHost()}/v5${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200) throw Object.assign(new Error(data.message || `Pinterest ${path} returned ${res.status}`), { status: res.status, data });
  return data;
}

async function pinterestPost(path, token, body) {
  const res = await fetch(`https://${getApiHost()}/v5${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Retail catalog feed IDs for the connected account (cached). */
async function listRetailFeedIds(token) {
  if (feedsCache && Date.now() - feedsCache.at < FEEDS_TTL) return feedsCache.ids;
  const ids = [];
  let bookmark = null;
  do {
    const data = await pinterestGet(`/catalogs/feeds?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`, token);
    for (const f of data.items ?? []) {
      if ((f.catalog_type ?? 'RETAIL') === 'RETAIL' && f.status !== 'INACTIVE') ids.push(f.id);
    }
    bookmark = data.bookmark || null;
  } while (bookmark);
  feedsCache = { ids, at: Date.now() };
  return ids;
}

/** "gid://shopify/Product/123" → "123" */
function shopifyNumericId(gid) {
  return String(gid || '').split('/').pop();
}

/**
 * Every catalog item (one per variant) for these Shopify products.
 * @param {string[]} productGids
 * @returns {Promise<Array<{ gid: string, pinId: string }>>}
 */
async function listCatalogItems(productGids, token) {
  const byNumeric = new Map(productGids.map((gid) => [shopifyNumericId(gid), gid]));
  const numericIds = [...byNumeric.keys()];
  const items = [];
  const feedIds = await listRetailFeedIds(token);
  for (const feedId of feedIds) {
    for (let i = 0; i < numericIds.length; i += 100) {
      const chunk = numericIds.slice(i, i + 100);
      let bookmark = null;
      do {
        const { status, data } = await pinterestPost(
          `/catalogs/products/get_by_product_group_filters?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`,
          token,
          { feed_id: feedId, filters: { any_of: chunk.map((id) => ({ ITEM_GROUP_ID: { values: [id] } })) } },
        );
        if (status !== 200) {
          throw Object.assign(new Error(data.message || `Catalog lookup returned ${status}`), { status, data });
        }
        for (const item of data.items ?? []) {
          const gid = byNumeric.get(String(item.metadata?.item_group_id ?? ''));
          if (gid && item.pin?.id) items.push({ gid, pinId: String(item.pin.id) });
        }
        bookmark = data.bookmark || null;
      } while (bookmark);
    }
  }
  return items;
}

/**
 * Find the catalog product pin for each Shopify product.
 * @param {string[]} productGids
 * @returns {Promise<Map<string, string>>} Shopify GID → product pin ID
 */
async function findProductPins(productGids, token) {
  const found = new Map();
  for (const { gid, pinId } of await listCatalogItems(productGids, token)) {
    // Keep the first variant's pin per product
    if (!found.has(gid)) found.set(gid, pinId);
  }
  return found;
}

/**
 * Destination links of catalog product pins (e.g. https://htgtfurniture.com/products/<handle>?variant=…),
 * so product tags on existing pins can be traced back to Shopify products.
 * @param {string[]} pinIds
 * @returns {Promise<Map<string, string>>} product pin ID → link (pins that can't be read are left out)
 */
export async function getPinLinks(pinIds = []) {
  const token = await getAccessToken();
  const links = new Map();
  const queue = [...new Set(pinIds.map(String))];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const pin = await pinterestGet(`/pins/${id}`, token);
        if (pin.link) links.set(id, pin.link);
      } catch {
        // deleted or private product pin: skip
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return links;
}

/**
 * All pins on the connected account, newest first.
 * @returns {Promise<Array<{ id, created_at, title, link, product_tags? }>>}
 */
export async function listAllPins() {
  const token = await getAccessToken();
  const pins = [];
  let bookmark = null;
  do {
    const data = await pinterestGet(`/pins?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`, token);
    pins.push(...(data.items ?? []));
    bookmark = data.bookmark || null;
  } while (bookmark);
  return pins;
}

/**
 * Top pins by a metric over the last `days` (Pinterest keeps 90 days of analytics).
 * @param {'IMPRESSION'|'SAVE'|'OUTBOUND_CLICK'|'ENGAGEMENT'} sortBy
 * @returns {Promise<Array<{ pin_id: string, metrics: object }>>}
 */
export async function getTopPins(sortBy, days = 90) {
  const token = await getAccessToken();
  const day = (d) => d.toISOString().slice(0, 10);
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const data = await pinterestGet(
    `/user_account/analytics/top_pins?start_date=${day(start)}&end_date=${day(end)}&sort_by=${sortBy}&num_of_pins=50`,
    token,
  );
  return data.pins ?? [];
}

/**
 * Which Shopify products have a product pin in the Pinterest catalog (i.e. can be tagged).
 * @param {string[]} productGids
 * @returns {Promise<string[]>} the GIDs that are in the catalog
 */
export async function findCatalogProducts(productGids = []) {
  if (!productGids.length) return [];
  const pinsByGid = await findProductPins(productGids, await getAccessToken());
  return [...pinsByGid.keys()];
}

/**
 * Tag a pin with the room's products. Never throws: tagging is best-effort and must not
 * undo a pin that was already created.
 * @param {string} pinId
 * @param {Array<{ id: string, title: string }>} products - Shopify GIDs + titles
 * @returns {Promise<{ tagged: string[], notInCatalog: string[], ineligible: Array<{ title: string, reason: string }>, error?: string }>}
 */
export async function tagProductsOnPin(pinId, products = []) {
  const result = { tagged: [], notInCatalog: [], ineligible: [] };
  if (!pinId || !products.length) return result;
  try {
    const token = await getAccessToken();
    const pinsByGid = await findProductPins(products.map((p) => p.id), token);
    result.notInCatalog = products.filter((p) => !pinsByGid.has(p.id)).map((p) => p.title);

    let candidates = products.filter((p) => pinsByGid.has(p.id)).slice(0, MAX_PRODUCT_TAGS);
    const titleByPin = new Map(candidates.map((p) => [pinsByGid.get(p.id), p.title]));

    // The endpoint is all-or-nothing, so drop ineligible tags and retry once
    for (let attempt = 0; attempt < 2 && candidates.length; attempt++) {
      const { status, data } = await pinterestPost(`/pins/${pinId}/product_tags`, token, {
        product_tags: candidates.map((p) => ({ pin_id: pinsByGid.get(p.id) })),
      });
      if (status === 200) {
        result.tagged = candidates.map((p) => p.title);
        return result;
      }
      const bad = data.details?.product_tags ?? [];
      if (status === 400 && bad.length) {
        const badIds = new Set(bad.map((b) => b.pin_id));
        result.ineligible.push(...bad.map((b) => ({ title: titleByPin.get(b.pin_id) ?? b.pin_id, reason: b.error_message })));
        candidates = candidates.filter((p) => !badIds.has(pinsByGid.get(p.id)));
        continue;
      }
      throw Object.assign(new Error(data.message || `Product tagging returned ${status}`), { status, data });
    }
    return result;
  } catch (err) {
    console.error('[pinterest] Product tagging failed:', err.message, err.data ?? '');
    const missingScope = err.data?.code === 3 || /catalogs:read|scope/i.test(err.message);
    result.error = missingScope
      ? 'Reconnect Pinterest (menu → Pinterest) to allow catalog access for product tagging.'
      : err.message;
    return result;
  }
}

/**
 * Map a createPin / auth error to a response body the UI understands.
 * @returns {{ error: string, authError: boolean, scopeError: boolean, trialError: boolean, status: number }}
 */
export function classifyPinError(err) {
  const msg = err.message || '';
  const trialError = /Trial access|use API Sandbox/i.test(msg);
  const scopeError = !trialError && /sufficient permissions|Missing:.*write/i.test(msg);
  const authError = !trialError && !scopeError && /authorize|expired|401|not connected/i.test(msg);
  const status = trialError || scopeError ? 403 : authError ? 401 : 500;
  return { error: msg, authError, scopeError, trialError, status };
}

/**
 * Delete the stored token file.
 */
export function disconnect() {
  if (existsSync(TOKEN_FILE)) {
    unlinkSync(TOKEN_FILE);
  }
}
