import { clearScenesCache } from '../../../../lib/promptBuilder.js';

/**
 * POST /api/scenes/add
 *
 * Appends a new scene row to the scene sheet via the htgtprompts2026 Apps Script
 * (GOOGLE_SHEETS_APPEND_URL). That script's doPost appends one row from the scene
 * fields (room_type, style_tags, room_details, ...). /api/sync-scene uses a different
 * script that only edits existing rows.
 *
 * Body: { scene: { room_name, room_type, room_details, ..., style_tags } }
 */
export async function POST(request) {
  const scriptUrl = process.env.GOOGLE_SHEETS_APPEND_URL;
  if (!scriptUrl) {
    return Response.json({ error: 'GOOGLE_SHEETS_APPEND_URL is not set in .env.local' }, { status: 501 });
  }

  let scene;
  try {
    ({ scene } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!scene || typeof scene !== 'object' || !scene.room_details) {
    return Response.json({ error: 'Body must contain { scene } with at least room_details' }, { status: 400 });
  }

  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: '', ...scene }),
      redirect: 'follow',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Apps Script returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    if (/^\s*</.test(text)) throw new Error('Apps Script returned a Google sign-in page; check the deployment is set to "Anyone".');

    // Apps Script returns 200 even when the script throws; check the body
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* plain text */ }
    if (parsed?.error || (/error/i.test(text) && !parsed?.ok && !parsed?.success)) {
      throw new Error(`Apps Script error: ${text.slice(0, 300)}`);
    }

    clearScenesCache();
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[/api/scenes/add]', err);
    return Response.json({ error: err.message }, { status: 502 });
  }
}
