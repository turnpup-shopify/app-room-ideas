import { NextResponse } from 'next/server';
import { getPinSuggestions } from '../../../../lib/pinSuggestions.js';

/**
 * GET /api/pinterest/suggestions[?refresh=1]
 * Ranked products to pin next, plus suggested rooms built from them.
 */
export async function GET(request) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    return NextResponse.json(await getPinSuggestions({ refresh }));
  } catch (err) {
    console.error('[/api/pinterest/suggestions]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
