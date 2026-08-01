import { NextResponse } from 'next/server';
import { getConfig } from '../../../lib/config.js';
import { fetchProducts } from '../../../lib/shopify.js';
import { buildRooms } from '../../../lib/rules.js';
import { buildPrompt } from '../../../lib/promptBuilder.js';

export async function POST() {
  try {
    const config = getConfig();

    const products = await fetchProducts(config);

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'No qualifying products found. Check your vendor filter and inventory settings.' },
        { status: 404 }
      );
    }

    const rooms = buildRooms(products, config);

    if (rooms.length === 0) {
      return NextResponse.json(
        { error: 'No valid room combinations could be built. Check productTypeCombinations in config.json.' },
        { status: 404 }
      );
    }

    const result = rooms.map((room) => ({
      style: room.style,
      combinationName: room.combinationName,
      score: room.score,
      prompt: buildPrompt(room),
      products: room.products.map((p) => ({
        title: p.title,
        productType: p.productType,
        materials: p.materials,
        dimensions: p.dimensions,
        images: p.images.slice(0, config.maxImagesPerProduct ?? 3),
      })),
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
