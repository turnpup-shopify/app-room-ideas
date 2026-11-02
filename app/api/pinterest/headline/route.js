import { NextResponse } from 'next/server';
import { generateOverlayHeadline } from '../../../../lib/pinCopy.js';

/**
 * POST /api/pinterest/headline
 * Body: { style, roomType, products }
 * Drafts the text-overlay headline for an image render.
 */
export async function POST(request) {
  try {
    const { style, roomType, products } = await request.json();
    const headline = await generateOverlayHeadline({ style, roomType, products: products || [] });
    return NextResponse.json({ headline });
  } catch (err) {
    console.error('[/api/pinterest/headline]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
