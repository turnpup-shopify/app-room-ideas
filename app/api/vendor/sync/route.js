import { NextResponse } from 'next/server';
import { syncFeedSnapshots } from '../../../../lib/vendorFeed.js';
import { clearDemandReportCache } from '../../../../lib/vendorDemand.js';

/**
 * POST /api/vendor/sync
 * Pulls new daily Uttermost feed snapshots from the Apps Script archive into vendor-feed/.
 * Returns { added, total }.
 */
export async function POST() {
  try {
    const result = await syncFeedSnapshots();
    if (result.added > 0) clearDemandReportCache();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/vendor/sync]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
