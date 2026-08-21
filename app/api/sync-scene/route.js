import { NextResponse } from 'next/server';
import { clearScenesCache } from '../../../lib/promptBuilder.js';

/**
 * POST /api/sync-scene
 *
 * Writes edited scene fields back to the Google Sheet row they came from,
 * then busts the local CSV cache so the next generation picks up the change.
 *
 * Body: { rowIndex: number, scene: { room_type, room_details, lighting, ... } }
 *
 * ─── Setup required ───────────────────────────────────────────────────────────
 * This endpoint delegates the actual write to a Google Apps Script web app.
 * Set GOOGLE_SHEETS_SCRIPT_URL in your .env.local to the deployed script URL.
 *
 * Deploy the following script in your Google Sheet (Extensions → Apps Script):
 *
 *   function doPost(e) {
 *     try {
 *       const { rowIndex, scene } = JSON.parse(e.postData.contents);
 *       // rowIndex is 0-based in the data array; +2 for header row + 1-based index
 *       const sheetRow = rowIndex + 2;
 *       const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
 *       const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
 *       for (const [field, value] of Object.entries(scene)) {
 *         const col = headers.indexOf(field);
 *         if (col !== -1) sheet.getRange(sheetRow, col + 1).setValue(value);
 *       }
 *       return ContentService
 *         .createTextOutput(JSON.stringify({ ok: true }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     } catch (err) {
 *       return ContentService
 *         .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     }
 *   }
 *
 * After pasting the script:
 *   1. Click Deploy → New deployment → Web app
 *   2. Execute as: Me
 *   3. Who has access: Anyone (or restrict to specific users)
 *   4. Copy the deployment URL into GOOGLE_SHEETS_SCRIPT_URL in .env.local
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(request) {
  const scriptUrl = process.env.GOOGLE_SHEETS_SCRIPT_URL;

  if (!scriptUrl) {
    return NextResponse.json(
      {
        error:
          'GOOGLE_SHEETS_SCRIPT_URL is not set. ' +
          'Deploy a Google Apps Script web app from your sheet and add its URL to .env.local.',
      },
      { status: 501 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { rowIndex, scene } = body;

  if (typeof rowIndex !== 'number' || !scene || typeof scene !== 'object') {
    return NextResponse.json(
      { error: 'Body must contain { rowIndex: number, scene: object }' },
      { status: 400 }
    );
  }

  // Remap scene keys back to the CSV column headers the Apps Script expects.
  // buildPrompt reads CSV columns "rooms" and "styles" into scene keys
  // "room_type" and "style_tags" — reverse that for the write.
  const KEY_TO_HEADER = {
    room_type:  'rooms',
    style_tags: 'styles',
  };
  const SKIP_KEYS = new Set(['accessories']); // not on the scenes sheet

  const mapped = {};
  for (const [key, value] of Object.entries(scene)) {
    if (SKIP_KEYS.has(key)) continue;
    mapped[KEY_TO_HEADER[key] || key] = value;
  }

  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, scene: mapped }),
      redirect: 'follow',
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Apps Script sometimes returns plain text on auth errors
      throw new Error(`Unexpected response from Apps Script: ${text}`);
    }

    if (!data.ok) {
      throw new Error(data.error ?? 'Apps Script returned ok: false');
    }

    // Bust the local CSV cache so the next generation picks up the change
    clearScenesCache();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[/api/sync-scene]', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
