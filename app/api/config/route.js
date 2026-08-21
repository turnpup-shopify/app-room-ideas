import { NextResponse } from 'next/server';
import { getConfig, saveConfig } from '../../../lib/config.js';

// Fields exposed to the UI — omit productTypeCombinations and higgsfield internals
const CRITERIA_KEYS = ['includeVendors', 'excludeTags', 'requireInventory', 'maxImagesPerProduct', 'accessories'];

export async function GET() {
  const config = getConfig();
  return NextResponse.json(
    Object.fromEntries(CRITERIA_KEYS.map((k) => [k, config[k] ?? null]))
  );
}

export async function POST(request) {
  try {
    const body = await request.json();
    const updates = Object.fromEntries(
      CRITERIA_KEYS.filter((k) => k in body).map((k) => [k, body[k]])
    );
    const updated = saveConfig(updates);
    console.log('[/api/config] Saved criteria:', JSON.stringify(updates));
    return NextResponse.json(
      Object.fromEntries(CRITERIA_KEYS.map((k) => [k, updated[k] ?? null]))
    );
  } catch (err) {
    console.error('[/api/config]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
