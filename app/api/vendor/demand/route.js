import { NextResponse } from 'next/server';
import { buildDemandReport } from '../../../../lib/vendorDemand.js';

/**
 * GET /api/vendor/demand[?refresh=1]
 * Uttermost demand report built from the local feed history (see lib/vendorDemand.js).
 */
export async function GET(request) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    return NextResponse.json(await buildDemandReport({ top: 40, refresh }));
  } catch (err) {
    console.error('[/api/vendor/demand]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
