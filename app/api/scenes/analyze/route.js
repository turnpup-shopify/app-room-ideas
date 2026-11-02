import Anthropic from '@anthropic-ai/sdk';

/**
 * POST /api/scenes/analyze
 *
 * Claude reads a room photo and fills in the scene sheet columns, so the photo can be
 * added as a new scene template (☰ → Add Scene). Ported from htgtprompts2026's add-room.
 *
 * Body: { imageBase64, mediaType, roomTypes?: string[], styles?: string[] }
 * Returns { data: { room_name, room_type, room_details, ..., style_tags } }
 */

const FIELDS_PROMPT = `Analyze this interior design / room photograph and extract structured metadata for an AI image generation prompt database.

Return ONLY a valid JSON object with exactly these keys (no markdown fences, no explanation):

{
  "room_name": "Short unique name for this scene (e.g. 'Plaster Arch Reading Nook')",
  "room_type": "Comma-separated room types from the allowed list",
  "room_details": "Detailed description of the room's fixed architectural features: wall treatments, flooring, ceiling, windows, built-ins, spatial arrangement, textures and colors",
  "furniture_types": "Comma-separated list of main furniture types visible (e.g. 'Accent Chair, Side Table, Floor Lamp')",
  "materials": "Comma-separated list of key materials and finishes (e.g. 'Limewash plaster, Oak hardwood, Cognac leather, Brushed brass')",
  "lighting": "Lighting quality, direction, source, and mood (e.g. 'Soft directional daylight from left window, warm ambient fill, no harsh shadows')",
  "camera": "Camera angle, lens feel, and composition style (e.g. 'Eye-level, medium shot, slight three-quarter angle, 50mm lens feel')",
  "color_grade": "Overall color palette and tone description (e.g. 'Warm earthy neutrals, low saturation, muted cognac and ivory palette')",
  "negative_styling_rules": "What is absent or should be avoided in this aesthetic (e.g. 'No clutter, no bright colors, no chrome hardware, no visible technology')",
  "hero_object_placement_logic": "Where a new hero product object would ideally be placed in this scene and why",
  "realism_constraints": "Technical photorealism rendering requirements (e.g. 'Accurate contact shadows, realistic material texture, no cutout edges, no halo effects')",
  "style_tags": "Comma-separated design styles from the allowed list"
}`;

const listOf = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);

// Keep only values from the allowed list, in its spelling
function keepAllowed(value, allowed) {
  if (!allowed.length) return value || '';
  return String(value || '')
    .split(',')
    .map((t) => allowed.find((a) => a.toLowerCase() === t.trim().toLowerCase()))
    .filter(Boolean)
    .join(', ');
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not set in .env.local' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { imageBase64, mediaType } = body;
  if (!imageBase64) return Response.json({ error: 'No image provided' }, { status: 400 });
  const roomTypes = listOf(body.roomTypes);
  const styles = listOf(body.styles);

  let prompt = FIELDS_PROMPT;
  if (roomTypes.length) prompt += `\n\nAllowed room types (pick 1-3): ${roomTypes.join(', ')}`;
  if (styles.length) prompt += `\n\nAllowed design styles (pick 1-3): ${styles.join(', ')}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const text = message.content.find((c) => c.type === 'text')?.text || '';
    let data;
    try {
      data = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
    } catch {
      return Response.json({ error: 'Could not parse Claude response', raw: text }, { status: 502 });
    }
    data.room_type = keepAllowed(data.room_type, roomTypes);
    data.style_tags = keepAllowed(data.style_tags, styles);
    return Response.json({ data });
  } catch (err) {
    console.error('[/api/scenes/analyze]', err);
    return Response.json({ error: err?.message || 'Analysis failed' }, { status: 500 });
  }
}
