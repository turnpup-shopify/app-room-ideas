import { NextResponse } from 'next/server';
import { getConfig } from '../../../lib/config.js';
import { fetchProducts } from '../../../lib/shopify.js';
import { buildRooms } from '../../../lib/rules.js';
import { buildPrompt } from '../../../lib/promptBuilder.js';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const filters = body?.filters ?? {};

    const config = getConfig();

    const products = await fetchProducts(config);

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'No qualifying products found. Check your vendor filter and inventory settings.' },
        { status: 404 }
      );
    }

    const rooms = buildRooms(products, config, filters);

    if (rooms.length === 0) {
      return NextResponse.json(
        { error: 'No valid room combinations could be built. Check productTypeCombinations in config.json.' },
        { status: 404 }
      );
    }

    const maxImages = config.maxImagesPerProduct ?? 3;

    const mapProduct = (p) => ({
      id: p.id,
      title: p.title,
      productType: p.productType,
      materials: p.materials,
      dimensions: p.dimensions,
      images: p.images.slice(0, maxImages),
    });

    const accessoriesList = config.accessories || [];

    const result = await Promise.all(rooms.map(async (room) => {
      const { prompt, scene, itemList } = await buildPrompt(room, filters, accessoriesList);
      return {
        style: room.style,
        combinationName: room.combinationName,
        score: room.score,
        prompt,
        scene,    // raw CSV fields — null if CSV was unavailable
        itemList, // product description string for client-side re-assembly
        products: room.products.map((p, i) => ({
          ...mapProduct(p),
          alternatives: (room.alternatives?.[i] || []).map(mapProduct),
        })),
      };
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/rooms]', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
