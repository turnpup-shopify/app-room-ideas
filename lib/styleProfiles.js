// Look of each design style used in the custom.design_style product metafield.
// The scene sheet only covers some styles (col K), so when the chosen scene isn't tagged with
// the room's style, buildPrompt() swaps the scene's own materials, lighting, color grade, and
// "avoid" rules for these. Otherwise a detailed scene (e.g. the one Kitchen row: fluted oak,
// breccia marble, sandy neutrals) renders the same room whatever style is asked for.
// Keys match the metafield values.

export const STYLE_PROFILES = {
  'Transitional': {
    architecture: 'simple raised-panel or Shaker millwork, crown molding, painted walls, classic proportions with clean lines',
    materials: 'painted wood cabinetry or millwork in greige or soft white, honed marble or quartz, medium oak flooring, linen and performance-velvet upholstery, brushed brass and satin nickel hardware',
    lighting: 'soft natural daylight with warm lamp light, balanced and even, gentle shadows',
    color_grade: 'warm greige and soft white base, muted navy, sage, or taupe accents, moderate contrast, natural saturation',
    avoid: 'no rustic reclaimed wood, no ornate gilding, no stark minimalism, no bold saturated color',
  },
  'Organic Modern': {
    architecture: 'smooth limewash or plaster walls, softened corners, minimal trim, large windows',
    materials: 'light white oak, travertine or honed stone, boucle and linen, rattan and jute, unlacquered brass, handmade ceramics',
    lighting: 'bright diffused natural daylight, soft shadows, airy',
    color_grade: 'warm sandy neutrals, cream and oatmeal, low saturation, soft contrast',
    avoid: 'no dark dramatic tones, no chrome, no busy patterns, no saturated color',
  },
  'Coastal': {
    architecture: 'white or pale painted walls, beadboard or board-and-batten paneling, wide windows with daylight',
    materials: 'whitewashed or bleached oak, woven seagrass and rattan, washed linen and cotton, sea glass, weathered driftwood, brushed nickel',
    lighting: 'bright airy sunlight, cool clean daylight, light shadows',
    color_grade: 'crisp whites, sand, pale blue and soft aqua accents, light and fresh, low contrast',
    avoid: 'no dark heavy woods, no gilding, no moody lighting, no kitschy anchors or nautical cliches',
  },
  'Modern': {
    architecture: 'flat slab surfaces, flush trimless details, clean geometric volumes, large expanses of glass',
    materials: 'matte lacquer, smooth plaster, polished concrete or large-format stone, walnut veneer, black steel, glass',
    lighting: 'crisp natural light with clean architectural shadows, controlled and even',
    color_grade: 'white, warm gray, and black with one muted accent, neutral white balance, clean contrast',
    avoid: 'no ornament, no distressed finishes, no traditional moldings, no clutter',
  },
  'Traditional': {
    architecture: 'raised-panel wainscoting, crown and dentil molding, symmetrical layout, paneled doors',
    materials: 'cherry or mahogany wood, damask, silk and velvet upholstery, Persian or Oriental rug, polished brass, marble',
    lighting: 'warm lamp light and soft window light, rich gentle shadows',
    color_grade: 'warm rich tones, burgundy, hunter green, navy and cream, medium contrast, warm white balance',
    avoid: 'no stark minimalism, no industrial metal, no raw concrete, no stark white walls',
  },
  'Rustic': {
    architecture: 'exposed timber ceiling beams, rough plaster or stone walls, plank flooring',
    materials: 'reclaimed and knotty wood, natural stone, wrought iron, leather, wool and cowhide, hand-forged hardware',
    lighting: 'warm golden light, firelight or late-afternoon sun, deep soft shadows',
    color_grade: 'earthy browns, rust, moss, and warm amber, natural texture, warm white balance',
    avoid: 'no glossy lacquer, no chrome, no sleek modern slab surfaces, no pastel colors',
  },
  'Farmhouse': {
    architecture: 'white shiplap or board-and-batten walls, exposed wood beams, wide-plank floors, apron-front sink in kitchens, open shelving',
    materials: 'painted white or sage cabinetry, butcher block, distressed reclaimed wood, black iron and oil-rubbed bronze hardware, galvanized metal, cotton ticking and gingham',
    lighting: 'bright cheerful daylight, warm and homey, soft shadows',
    color_grade: 'warm white and cream base, natural wood tones, black accents, muted sage or blue, gentle contrast',
    avoid: 'no high gloss, no marble waterfall islands, no breccia marble, no fluted modern cabinetry, no gilding',
  },
  'Industrial': {
    architecture: 'exposed brick, concrete ceilings, visible ductwork and pipes, steel-framed factory windows',
    materials: 'raw and blackened steel, poured concrete, reclaimed wood, distressed leather, Edison bulbs, riveted metal',
    lighting: 'directional daylight from tall windows, moody contrast, warm bulb light',
    color_grade: 'charcoal, rust, cognac leather, and gray, slightly desaturated, high contrast',
    avoid: 'no pastel colors, no ornate moldings, no delicate florals, no gilding',
  },
  'Art Deco': {
    architecture: 'geometric millwork, curved walls and arches, fluted and reeded details, terrazzo or chevron parquet floors',
    materials: 'lacquer, burl wood, polished brass, black marble, velvet, mirrored and smoked glass',
    lighting: 'glamorous warm accent lighting, polished reflections, dramatic but soft',
    color_grade: 'emerald, deep teal, black and gold, rich saturation, glossy contrast',
    avoid: 'no rustic wood, no farmhouse elements, no washed-out pastels, no raw concrete',
  },
  'French Country': {
    architecture: 'aged plaster walls, exposed beams, stone or terracotta floors, arched doorways',
    materials: 'distressed painted wood, toile and linen, rush seating, wrought iron, antique brass, terracotta',
    lighting: 'soft golden countryside light, warm and romantic, gentle shadows',
    color_grade: 'buttery yellow, soft blue, lavender, faded cream, gentle warmth, low contrast',
    avoid: 'no sleek modern slab surfaces, no chrome, no stark white, no industrial metal',
  },
  'Glam': {
    architecture: 'high-gloss paneling, mirrored surfaces, tray ceilings, dramatic chandeliers',
    materials: 'velvet, crystal, mirrored furniture, gold and brass, polished marble, lacquer, faux fur',
    lighting: 'sparkling reflective light, warm chandelier glow, luminous highlights',
    color_grade: 'blush, champagne, silver, jewel accents, luminous, polished contrast',
    avoid: 'no rustic reclaimed wood, no raw concrete, no matte earthy textures',
  },
  'Brutalist': {
    architecture: 'monolithic board-formed concrete walls, heavy geometric volumes, deep recesses',
    materials: 'raw concrete, rough stone, dark oak, blackened steel, wool, sculptural block forms',
    lighting: 'strong directional light, crisp deep shadows, sculptural',
    color_grade: 'stone gray, charcoal, warm earth accents, desaturated, high contrast',
    avoid: 'no ornament, no pastels, no delicate florals, no gilding, no glossy lacquer',
  },
  'Mid-Century Modern': {
    architecture: 'post-and-beam structure, wood-paneled walls, clerestory windows, terrazzo or teak floors',
    materials: 'teak and walnut, molded plywood, tapered legs, tweed and boucle upholstery, brass accents, atomic-era ceramics',
    lighting: 'warm afternoon sun, retro glow, soft shadows',
    color_grade: 'mustard, burnt orange, olive, and teal accents on warm wood, vintage film warmth',
    avoid: 'no ornate traditional moldings, no rustic farmhouse elements, no high-gloss glam',
  },
  'Contemporary': {
    architecture: 'clean open plan, smooth walls, soft-edged geometry, floor-to-ceiling windows',
    materials: 'light woods, matte finishes, mixed metals, natural fibers, sculptural shapes',
    lighting: 'bright balanced daylight, soft shadows',
    color_grade: 'neutral palette with soft black and one muted accent, balanced contrast',
    avoid: 'no heavy ornament, no clutter, no dated finishes',
  },
};

export const STYLE_NAMES = Object.keys(STYLE_PROFILES);

export function styleProfile(style) {
  const wanted = String(style || '').trim().toLowerCase();
  const name = STYLE_NAMES.find((n) => n.toLowerCase() === wanted);
  return name ? STYLE_PROFILES[name] : null;
}
