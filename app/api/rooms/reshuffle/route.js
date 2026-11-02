import { NextResponse } from 'next/server';
import { getConfig } from '../../../../lib/config.js';
import { fetchProducts, fetchProductByHandle } from '../../../../lib/shopify.js';
import { buildRooms } from '../../../../lib/rules.js';

/**
 * POST /api/rooms/reshuffle
 * Returns a single new room combination for the given design style.
 * Used by the client to swap products on a card without regenerating all rooms.
 *
 * Body: { style: string, productCount?: number, roomType?: string }
 */
export async function POST(request) {
  try {
    const { style, productCount = 3, roomType, featuredProductHandles } = await request.json();

    if (!style) {
      return NextResponse.json({ error: 'style is required' }, { status: 400 });
    }

    const config = getConfig();
    const products = await fetchProducts(config);

    const filters = {
      designStyle: style,
      count: '1',
      productCount: String(productCount),
    };
    if (roomType) filters.roomType = roomType;

    // Resolve featured product handles if provided
    if (featuredProductHandles?.length > 0) {
      const resolved = [];
      for (const handle of featuredProductHandles) {
        const featured = await fetchProductByHandle(handle);
        if (!featured) {
          return NextResponse.json(
            { error: `Featured product not found for handle "${handle}".` },
            { status: 404 }
          );
        }
        resolved.push(featured);
      }
      filters.featuredProducts = resolved;
    }

    const rooms = buildRooms(products, config, filters);

    if (rooms.length === 0) {
      return NextResponse.json(
        { error: 'No valid combination found for this style.' },
        { status: 404 }
      );
    }

    const room = rooms[0];
    const maxImages = config.maxImagesPerProduct ?? 3;
    const mapProduct = (p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      productType: p.productType,
      materials: p.materials,
      dimensions: p.dimensions,
      images: p.images.slice(0, maxImages),
    });

    return NextResponse.json({
      style: room.style,
      combinationName: room.combinationName,
      score: room.score,
      products: room.products.map((p, i) => ({
        ...mapProduct(p),
        alternatives: (room.alternatives?.[i] || []).map(mapProduct),
      })),
    });
  } catch (err) {
    console.error('[/api/rooms/reshuffle]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
