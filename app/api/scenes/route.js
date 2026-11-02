import { fetchScenes } from '../../../lib/promptBuilder.js';

/**
 * GET /api/scenes
 * Returns all scene templates from the Google Sheets CSV,
 * mapped to the same keys the client uses (room_type, style_tags, etc.)
 */
export async function GET() {
  try {
    const raw = await fetchScenes();

    const scenes = raw.map((r) => ({
      room_type:                   r.rooms || '',
      room_details:                r.room_details || '',
      furniture_types:             r.furniture_types || '',
      style_tags:                  r.styles || '',
      materials:                   r.materials || '',
      lighting:                    r.lighting || '',
      camera:                      r.camera || '',
      color_grade:                 r.color_grade || '',
      hero_object_placement_logic: r.hero_object_placement_logic || '',
      negative_styling_rules:      r.negative_styling_rules || '',
      realism_constraints:         r.realism_constraints || '',
    }));

    return Response.json(scenes);
  } catch (err) {
    console.error('[/api/scenes] Failed to fetch scenes:', err.message);
    return Response.json({ error: 'Failed to fetch scenes' }, { status: 500 });
  }
}
