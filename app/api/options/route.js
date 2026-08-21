import { NextResponse } from 'next/server';
import { fetchScenes } from '../../../lib/promptBuilder.js';
import { getConfig } from '../../../lib/config.js';

/**
 * GET /api/options
 *
 * Returns filter options for the UI — all sourced from the scenes CSV sheet
 * so this route never touches Shopify (preventing concurrent fetches that
 * would exhaust the GraphQL query cost budget when Generate is clicked).
 *
 *   styles    — unique values from column K of the scenes sheet
 *   roomTypes — unique values from column L of the scenes sheet
 *   roomNames — room names from column A of the scenes sheet (in sheet order)
 */
export async function GET() {
  const config = getConfig();

  let styles = [];
  let roomTypes = [];
  let roomNames = [];

  try {
    const scenes = await fetchScenes();

    // Column K: styles — comma-separated in some rows; split, deduplicate, sort
    styles = [...new Set(
      scenes.flatMap((s) =>
        (s.styles || '').split(',').map((r) => r.trim()).filter(Boolean)
      )
    )].sort();

    // Column L: rooms — comma-separated in some rows; split, deduplicate, sort
    roomTypes = [...new Set(
      scenes.flatMap((s) =>
        (s.rooms || '').split(',').map((r) => r.trim()).filter(Boolean)
      )
    )].sort();

    // Column A: room_name — one per row, preserve sheet order
    roomNames = scenes.map((s) => s.room_name?.trim()).filter(Boolean);
  } catch (err) {
    console.warn('[/api/options] Scene CSV fetch failed:', err.message);

    // Fallback room types from config.json
    try {
      roomTypes = config.productTypeCombinations.map((c) => c.name);
    } catch (_) {}
  }

  return NextResponse.json({ styles, roomTypes, roomNames });
}
