import { NextResponse } from 'next/server';
import { findCatalogProducts } from '../../../../lib/pinterest.js';

/**
 * POST /api/pinterest/catalog-check
 * Body: { ids: string[] } (Shopify product GIDs)
 * Returns { inCatalog: string[] }: the products that have a catalog pin and can be tagged.
 */
export async function POST(request) {
  try {
    const { ids } = await request.json();
    return NextResponse.json({ inCatalog: await findCatalogProducts(Array.isArray(ids) ? ids : []) });
  } catch (err) {
    const missingScope = err.data?.code === 3 || /catalogs:read|scope/i.test(err.message);
    return NextResponse.json({ error: missingScope ? 'reconnect Pinterest to allow catalog access' : err.message }, { status: missingScope ? 403 : 500 });
  }
}
