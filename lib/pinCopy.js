import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config.js';
import { normalizeHashtag, dedupeHashtags } from './hashtags.js';
import { STYLE_NAMES } from './styleProfiles.js';

// Pinterest limits
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;
const ALT_MAX = 500;

// Pin guide (prompts/pinterest-pin-guide.md) targets
const BODY_MIN = 150;
const BODY_MAX = 300;
const HASHTAG_MAX = 3;
const TOPIC_MIN = 5;
const TOPIC_MAX = 10;
const HEADLINE_MAX_WORDS = 7;

// Sonnet follows the long pin guide on the first draft; Haiku 4.5 needed retries and still wrote decorator cliches
const MODEL = process.env.PIN_COPY_MODEL || 'claude-sonnet-5-5';
const PROMPTS_DIR = path.join(process.cwd(), 'prompts');

// Banned outright by no-ai-slop, plus the decorator words the pin copy kept reaching for
const BANNED_WORDS = [
  'delve', 'foster', 'leverage', 'utilize', 'facilitate', 'empower', 'streamline', 'robust', 'cutting-edge',
  'game changer', 'tapestry', 'realm', 'beacon', 'multifaceted', 'meticulous', 'intricate', 'paramount',
  'transformative', 'elevate', 'elevates', 'embark', 'supercharge', 'harness', 'ever-evolving',
  'curated', 'effortless', 'seamless', 'stunning', 'must-have', 'statement piece', 'tie the room together',
  'anchor the space', 'anchors', 'grounds', 'warm and inviting', 'pop of color',
];
const GENERIC_HASHTAGS = new Set(['#decor', '#homedecor', '#home', '#interiordesign', '#interiors', '#interior', '#design', '#furniture', '#inspo', '#inspiration', '#homeinspo']);

/** "#warmmodernlivingroom" form, as in the pin guide. */
function lowerHashtag(str) {
  const tag = String(str || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return tag ? `#${tag}` : null;
}

/** Text of a Messages API reply, skipping any non-text blocks such as thinking. */
function replyText(message) {
  return (message.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

function readPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/**
 * System prompt for all pin writing: the HTGT pin guide plus the no-ai-slop skill and its checklist.
 * Read from prompts/ on each call so edits apply without a restart. Cached on Anthropic's side.
 */
function pinSystemPrompt() {
  const text =
    'You write Pinterest copy for HTGT Furniture. Follow the pin guide below. ' +
    'Apply every word and pattern rule from the no-ai-slop skill to what you write. That skill is written for editing a draft: ' +
    'ignore its parts about asking the user questions, preserving a writer\'s voice, and returning a "What changed" section. ' +
    'You write from scratch and return only what the user message asks for. Where the two disagree, the pin guide wins.\n\n' +
    `<pin_guide>\n${readPrompt('pinterest-pin-guide.md')}\n</pin_guide>\n\n` +
    `<no_ai_slop>\n${readPrompt('no-ai-slop.md')}\n</no_ai_slop>\n\n` +
    `<no_ai_slop_checklist>\n${readPrompt('no-ai-slop-eval.md')}\n</no_ai_slop_checklist>`;
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

function clip(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  const cut = str.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,.;:-]+$/, '') + '…';
}

/** Trim to whole sentences that fit; fall back to a word clip if even the first sentence is too long. */
function clipSentences(str, max) {
  if (!str || str.length <= max) return str || '';
  const sentences = str.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
  let out = '';
  for (const sentence of sentences) {
    if ((out + sentence).trim().length > max) break;
    out += sentence;
  }
  return out.trim() || clip(str, max);
}

function uniq(arr) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = String(x).toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sentenceCount(text) {
  return (String(text).match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).length;
}

/**
 * House punctuation: no dashes, hyphens, semicolons, colons, or exclamation marks (pin guide section 4).
 * Also strips AI mentions and doubled words.
 */
function scrub(text) {
  return String(text || '')
    .replace(/\b(?:an?\s+)?ai[-\s]?(?:generated|rendered|created)\s*/gi, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/(\w)-(?=\w)/g, '$1 ')
    .replace(/\s*[;:]\s*(\w?)/g, (_, c) => `. ${c.toUpperCase()}`)
    .replace(/!/g, '.')
    .replace(/\b(\w+)\s+\1\b/gi, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*(\w)/, (m) => m.toUpperCase())
    .trim();
}

/** Sentence case for titles the model wrote in Title Case. Keeps acronyms (HTGT) as they are. */
function sentenceCase(title) {
  const words = title.split(' ');
  const long = words.slice(1).filter((w) => w.length > 3);
  const capped = long.filter((w) => /^[A-Z][a-z]/.test(w));
  if (!long.length || capped.length / long.length < 0.6) return title;
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()))).join(' ');
}

/** Rule checks from the pin guide's QA list that code can verify. Returns a list of problems. */
function checkCopy(copy) {
  const problems = [];
  const title = String(copy.title || '');
  const body = String(copy.description || '');
  const all = [title, body, copy.altText].join(' ');
  if (title.length > TITLE_MAX) problems.push(`Title is ${title.length} characters, over ${TITLE_MAX}.`);
  if (/[—–\-;:!]/.test(title + body)) problems.push('Copy contains a dash, hyphen, semicolon, colon, or exclamation mark.');
  if (sentenceCase(title) !== title) problems.push('Title is in Title Case. Use sentence case.');
  if (sentenceCount(body) !== 3) problems.push(`Description has ${sentenceCount(body)} sentences, not three.`);
  if (body.length < BODY_MIN || body.length > BODY_MAX) problems.push(`Description is ${body.length} characters. Aim for ${BODY_MIN} to ${BODY_MAX}.`);
  if (body.includes('#')) problems.push('Description contains hashtags. Put them only in "hashtags".');
  if (/costa mesa|showroom/i.test(title + body)) problems.push('Mentions Costa Mesa or the showroom.');
  const banned = BANNED_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(all));
  if (banned.length) problems.push(`Uses banned words: ${banned.join(', ')}.`);
  if ((copy.topics ?? []).length < TOPIC_MIN) problems.push(`Only ${(copy.topics ?? []).length} topics. Give ${TOPIC_MIN} to ${TOPIC_MAX}.`);
  return problems;
}

const styleSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** True when the tag names a product style other than this pin's, e.g. #OrganicModernLivingRoom on a Modern pin. */
function namesOtherStyle(tag, style) {
  const own = styleSlug(style);
  const t = styleSlug(tag);
  return STYLE_NAMES.some((n) => {
    const slug = styleSlug(n);
    return slug !== own && !own.includes(slug) && t.includes(slug);
  });
}

/** Library tags whose words overlap the style / room / product types, generic tags removed. */
function matchLibraryTags(library, keywords) {
  const generic = new Set(['room', 'rooms', 'ideas', 'decor', 'home', 'and', 'the', 'with']);
  // "Mid-Century" → "midcentury" so it can match #MidCenturyModernLivingRoom
  const words = uniq(keywords.flatMap((k) => String(k || '').toLowerCase().replace(/-/g, '').split(/\s+/)).filter((w) => w.length > 2 && !generic.has(w)));
  const scored = library
    .filter((tag) => !GENERIC_HASHTAGS.has(tag.toLowerCase()))
    .map((tag) => {
      const t = tag.toLowerCase();
      return { tag, score: words.reduce((n, w) => n + (t.includes(w) || t.includes(w.replace(/s$/, '')) ? 1 : 0), 0) };
    });
  return scored.filter((s) => s.score > 1).sort((a, b) => b.score - a.score).map((s) => s.tag);
}

/** Board names from the pin guide's target set (section 8). */
function guideBoards() {
  const section = readPrompt('pinterest-pin-guide.md').split(/^## 8\./m)[1]?.split(/^## /m)[0] ?? '';
  return [...section.matchAll(/^- (.+?)(?: \(.*\))?$/gm)].map((m) => m[1].trim());
}

const ROOM_WORDS = ['living room', 'bedroom', 'kitchen', 'bathroom', 'entryway', 'dining', 'office', 'patio', 'outdoor', 'nursery', 'bar'];

// Product styles plus the guide's aesthetic lanes, longest first so "warm modern" matches before "modern"
const BOARD_STYLES = [...new Set([...STYLE_NAMES, 'Warm Modern', 'Coastal Modern', 'Warm Minimalist', 'Minimalist']
  .map((st) => st.toLowerCase().replace(/-/g, ' ')))].sort((a, b) => b.length - a.length);

/** True when a board name is about a different room or style than this pin's (e.g. a kitchen pin on a living room board). */
function namesOtherRoom(board, room, style = '') {
  let b = String(board).toLowerCase().replace(/-/g, ' ');
  const r = String(room).toLowerCase();
  if (ROOM_WORDS.some((w) => b.includes(w) && !r.includes(w))) return true;
  const own = String(style).toLowerCase().replace(/-/g, ' ');
  for (const st of BOARD_STYLES) {
    if (!new RegExp(`\\b${st}\\b`).test(b)) continue;
    if (st !== own) return true;
    b = b.replace(st, ' ');
  }
  return false;
}

/**
 * Board for a style + room: a board on the account or in the guide's target set that shares the style and room,
 * else a room match that doesn't name a different room, else a new name in the guide's format ("Organic Modern Kitchen Ideas").
 */
function suggestBoard(boardNames, style, room, productTypes = []) {
  const guide = guideBoards();
  const titleCase = (str) => str.replace(/\b\w/g, (c) => c.toUpperCase());
  const fits = (list) => list.filter((b) => !namesOtherRoom(b, room, style));
  const both = (list) => fits(list).filter((b) => pickBoard([b], style, '', []) && pickBoard([b], '', room, [], true));
  return both(boardNames)[0] || both(guide)[0]
    || pickBoard(fits(boardNames), '', room, productTypes, true) || pickBoard(fits(guide), '', room, productTypes, true)
    || `${titleCase(style)} ${titleCase(room)} Ideas`;
}

/** Best board from a list by shared words. Needs a style or room word in common (a room word if needRoom); product types only break ties. */
function pickBoard(boardNames, style, room, productTypes = [], needRoom = false) {
  const words = (s) => String(s || '').toLowerCase().split(/\s+/).map((w) => w.replace(/s$/, '')).filter((w) => w.length > 2 && !['idea', 'and', 'the', 'decor', 'home'].includes(w));
  const styleWords = words(style);
  const roomWords = words(room);
  const typeWords = productTypes.flatMap(words);
  let best = null;
  for (const name of boardNames) {
    const b = new Set(words(name));
    const placeScore = styleWords.filter((w) => b.has(w)).length * 2 + roomWords.filter((w) => b.has(w)).length * 2;
    const score = placeScore + typeWords.filter((w) => b.has(w)).length;
    if (needRoom && !roomWords.some((w) => b.has(w))) continue;
    if (placeScore > 0 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name ?? null;
}

const STORE_URL = 'https://htgtfurniture.com';

/** Product page URL for a product handle. Pins link here, never to the home page. */
export function productPageUrl(handle) {
  return handle ? `${STORE_URL}/products/${handle}` : '';
}

function linkedHandle(link) {
  try {
    const p = new URL(link).pathname;
    return p.startsWith('/products/') ? p.split('/')[2] : null;
  } catch {
    return null;
  }
}

/**
 * Build Pinterest title / description / alt text / hashtags / topics / board for a room,
 * following prompts/pinterest-pin-guide.md and the no-ai-slop skill (prompts/no-ai-slop.md).
 * Hashtags come from the `pinterestHashtags` library in config.json when it has entries.
 * Uses Claude when ANTHROPIC_API_KEY is set; otherwise a template in the same format.
 * When `image` is given, Claude sees the render, writes only what is visible, and lists problems from the guide's reject list.
 * `history` (from pinHistoryFor) passes earlier titles per product and a pattern mix hint.
 * @param {{ style: string, roomType: string, scene?: object, products: Array<{title, handle?, productType?, materials?, dimensions?}>, roomDescription?: string, link?: string, boards?: string[], image?: { base64: string, mediaType: string }, history?: { earlierTitles?: Record<string, string[]>, patternHint?: string|null } }} opts
 * @returns {Promise<{ title, description, body, altText, hashtags: string[], topics: string[], board: string|null, pattern: string|null, imageIssues: string[], link: string }>}
 */
export async function generatePinCopy({ style, roomType, scene, products = [], roomDescription, link, boards = [], image, history }) {
  const room = roomType || 'Room';
  const productTypes = uniq(products.map((p) => p.productType).filter(Boolean));
  const materials = uniq(products.flatMap((p) => String(p.materials || '').split(/[,;]/).map((m) => m.trim())).filter(Boolean));
  const handle = linkedHandle(link);

  const library = dedupeHashtags((getConfig().pinterestHashtags ?? []).map(normalizeHashtag).filter(Boolean))
    .filter((t) => !namesOtherStyle(t, style));
  const libraryKeys = new Map(library.map((t) => [t.toLowerCase(), t]));
  const fallbackTags = library.length
    ? matchLibraryTags(library, [style, room, ...productTypes, ...materials]).slice(0, HASHTAG_MAX)
    : [lowerHashtag(`${style} ${room}`)].filter(Boolean);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const context = [
      `Style: ${style}`,
      `Room type: ${room}`,
      scene?.room_details && `Room character: ${scene.room_details}`,
      scene?.materials && `Scene materials: ${scene.materials}`,
      scene?.color_grade && `Color tone: ${scene.color_grade}`,
      roomDescription && `Store description of this room: ${roomDescription}`,
      handle && `The pin links to the product with handle "${handle}". That product is the hero.`,
      `Products shown in the image:\n${products.map((p, i) => `${i}. ` + [p.title, p.productType, p.materials && `materials: ${p.materials}`, p.dimensions && `dimensions: ${p.dimensions}`].filter(Boolean).join(' | ')).join('\n')}`,
      boards.length && `Boards on the account: ${boards.map((b) => `"${b}"`).join(', ')}`,
    ].filter(Boolean).join('\n');

    // Earlier pins for these products: a new pin needs a new angle, not the same idea with another room (guide section 4)
    const earlier = products
      .filter((p) => history?.earlierTitles?.[p.handle]?.length)
      .map((p) => `${p.title}:\n${history.earlierTitles[p.handle].map((t) => `  - ${t}`).join('\n')}`);
    const historyNote = [
      earlier.length && `Pins already posted for these products. If one of them is your hero, take a different angle than these titles. Swapping the room or style alone does not count:\n${earlier.join('\n')}`,
      history?.patternHint && `Pattern mix: ${history.patternHint}`,
    ].filter(Boolean).join('\n\n');

    const imageNote = image
      ? `The attached image is the pin. Describe only what is visible in it. Take materials, finishes, and sizes from the product data, and leave out any listed product you cannot see.\n\n`
      : '';

    const hashtagInstruction = library.length
      ? `- "hashtags": 0 to ${HASHTAG_MAX} hashtags copied exactly from this library, only ones specific to this style and room. None is fine.\n  Library: ${library.join(' ')}\n`
      : `- "hashtags": 0 to ${HASHTAG_MAX} specific hashtags such as #warmmodernlivingroom. Never generic tags like #decor.\n`;

    const messages = [{
      role: 'user',
      content: [
        ...(image ? [{ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } }] : []),
        { type: 'text', text: `Write the copy for one pin from this room image.\n\n${imageNote}${context}\n\n${historyNote ? historyNote + '\n\n' : ''}` +
        `Pick ONE hero product from the list (the largest or most prominent piece, or the linked product). ` +
        `Choose the title pattern (A room idea, B hero piece with hook, C styling how to) that best fits a phrase people search.\n\n` +
        `Return JSON only, no code fences, with keys:\n` +
        `- "heroIndex": number of the hero product in the list.\n` +
        `- "pattern": "A", "B", or "C".\n` +
        `- "title": guide section 4. Sentence case, under ${TITLE_MAX} characters, search phrase in the first 40. Use a plain search term for the product, never the brand product name.\n` +
        `- "description": guide section 5. Exactly three sentences, ${BODY_MIN} to ${BODY_MAX} characters. Materials, finishes, and sizes only from the product data above. No hashtags.\n` +
        hashtagInstruction +
        `- "topics": ${TOPIC_MIN} to ${TOPIC_MAX} lowercase search phrases matching the title and description, e.g. "coastal entryway ideas".\n` +
        `- "board": the one board this pin belongs on. Use an exact name from the account's boards when one is a good style plus room fit, otherwise the best name from the guide's target set (section 8). If none fits both the style and the room, give a new name in the same format, e.g. "Organic Modern Kitchen Ideas".\n` +
        `- "altText": one plain sentence describing what is visible (the room, the furniture, materials, light), under 250 characters. Do not start with "Image of".\n` +
        (image
          ? `- "imageIssues": problems you can see from the guide's reject list (section 7): warped geometry, duplicated objects, unreadable or misspelled text, product on white, product floating in an empty unstyled room, hero product not visible. Short phrases. Empty array if none.\n`
          : '') +
        `\nBefore answering, check the copy against the guide's QA list (section 11) and the no-ai-slop checklist.` }],
    }];

    try {
      const client = new Anthropic({ apiKey });
      let json = null;
      // One retry when the copy breaks a rule code can check
      for (let attempt = 0; attempt < 2; attempt++) {
        const message = await client.messages.create({ model: MODEL, max_tokens: 4000, system: pinSystemPrompt(), messages });
        const raw = replyText(message);
        json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        const problems = json.title && json.description ? checkCopy(json) : ['Missing title or description.'];
        if (!problems.length) break;
        console.warn(`[pinCopy] Draft ${attempt + 1} broke rules:`, problems);
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `Fix these and return the full JSON again:\n- ${problems.join('\n- ')}` });
      }
      if (json?.title && json?.description) {
        let hashtags = (Array.isArray(json.hashtags) ? json.hashtags : []).map(lowerHashtag).filter(Boolean);
        // Enforce the library: drop anything Claude invented, use the library's exact spelling
        if (library.length) hashtags = hashtags.map((h) => libraryKeys.get(h)).filter(Boolean);
        hashtags = dedupeHashtags(hashtags).filter((h) => !GENERIC_HASHTAGS.has(h.toLowerCase())).slice(0, HASHTAG_MAX);
        const pick = products[Number(json.heroIndex)] ?? products[0];
        const hero = handle ? products.find((p) => p.handle === handle) ?? pick : pick;
        const topics = uniq((Array.isArray(json.topics) ? json.topics : []).map((t) => scrub(t).toLowerCase().replace(/[.#]/g, '').trim())).slice(0, TOPIC_MAX);
        const named = json.board && !namesOtherRoom(json.board, room, style) ? json.board : null;
        const board = (named && (boards.find((b) => b.toLowerCase() === named.toLowerCase()) || named)) || suggestBoard(boards, style, room, productTypes);
        const pattern = ['A', 'B', 'C'].includes(json.pattern) ? json.pattern : null;
        const imageIssues = (Array.isArray(json.imageIssues) ? json.imageIssues : []).map((i) => scrub(i)).filter(Boolean);
        return { ...assemble(json.title, json.description, json.altText, hashtags), topics, board: board || null, pattern, imageIssues, link: link || productPageUrl(hero?.handle) };
      }
    } catch (err) {
      console.warn('[pinCopy] Claude pin copy failed, using fallback:', err.message);
    }
  }

  // Fallback template: Pattern A title + the guide's three description sentences
  const hero = (handle && products.find((p) => p.handle === handle)) || products.find((p) => p.materials) || products[0] || {};
  const heroType = (hero.productType || productTypes[0] || 'furniture').toLowerCase();
  const heroMaterial = String(hero.materials || '').split(/[,;]/)[0].trim().toLowerCase();
  const piece = `${heroMaterial ? heroMaterial + ' ' : ''}${heroType}`;
  const others = uniq(products.filter((p) => p !== hero).map((p) => (p.productType || p.title || '').toLowerCase()).filter(Boolean)).slice(0, 3);
  const join = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '');
  const plural = (s) => (/s$/i.test(s) ? s : `${s}s`);
  const article = (s) => (/^[aeiou]/i.test(s) ? 'an' : 'a');
  const styleLc = style.toLowerCase();
  const roomLc = room.toLowerCase();

  const title = `${styleLc} ${roomLc} idea with ${article(piece)} ${piece}`;
  const description = [
    `${article(styleLc).replace(/^a/, 'A')} ${styleLc} ${roomLc} built around ${article(piece)} ${piece}.`,
    others.length
      ? `The ${heroType}${hero.dimensions ? ` measures ${hero.dimensions} and` : ''} sits with the ${join(others)}.`
      : `The ${heroType}${hero.dimensions ? ` measures ${hero.dimensions} and` : ''} sets the tone for the room.`,
    `${roomLc.replace(/^\w/, (c) => c.toUpperCase())} inspiration for ${styleLc} decor and ${plural(heroType)}.`,
  ].join(' ');
  const topics = uniq([
    `${styleLc} ${roomLc} ideas`,
    `${roomLc} ideas`,
    `${styleLc} decor`,
    `${piece}`,
    `${heroType} styling`,
    ...others.map((o) => `${styleLc} ${o}`),
  ]).slice(0, TOPIC_MAX);
  const pieces = products.map((p) => p.title).filter(Boolean);
  const altText = `${style} ${roomLc} with ${join(pieces.slice(0, 4)) || join(productTypes.map((t) => t.toLowerCase())) || 'furniture'}`;

  return {
    ...assemble(title, description, altText, fallbackTags),
    topics,
    board: suggestBoard(boards, style, room, productTypes),
    pattern: 'A',
    imageIssues: [],
    link: link || productPageUrl(hero.handle),
  };
}

function assemble(title, description, altText, hashtags) {
  // Keep whole sentences; drop hashtags before cutting the body
  const body = clipSentences(scrub(description), DESCRIPTION_MAX);
  while (hashtags.length && body.length + hashtags.join(' ').length + 2 > DESCRIPTION_MAX) hashtags = hashtags.slice(0, -1);
  const tagStr = hashtags.join(' ');
  return {
    title: clip(sentenceCase(scrub(title).replace(/\.$/, '')), TITLE_MAX),
    description: tagStr ? `${body}\n\n${tagStr}` : body,
    body,
    altText: clip(scrub(altText), ALT_MAX),
    hashtags,
  };
}

/**
 * Text overlay rendered on the image: the pin's search phrase in 3 to 7 words (pin guide section 6),
 * e.g. "Warm modern living room idea". Not a slogan.
 * @param {{ style: string, roomType: string, products?: Array<{title, productType?}> }} opts
 * @returns {Promise<string>}
 */
export async function generateOverlayHeadline({ style, roomType, products = [] }) {
  const room = roomType || 'Room';
  const fallback = `${style} ${room} idea`.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: pinSystemPrompt(),
      messages: [{
        role: 'user',
        content: `Write the text overlay for a pin image, following guide section 6: the search phrase a person would type, ` +
          `3 to ${HEADLINE_MAX_WORDS} words, sentence case. Not a slogan. No hashtags, no quotes, no store name, no punctuation.\n` +
          `Return only the overlay text.\n\n` +
          `Style: ${style}\nRoom type: ${room}\nProducts: ${products.map((p) => [p.title, p.productType].filter(Boolean).join(' | ')).join('; ')}`,
      }],
    });
    const text = sentenceCase(scrub(replyText(message)).replace(/^["“']+|["”']+$/g, '').replace(/[.]+$/, '').trim());
    const words = text.split(/\s+/).filter(Boolean).length;
    return words >= 3 && words <= HEADLINE_MAX_WORDS + 1 ? text : fallback;
  } catch (err) {
    console.warn('[pinCopy] Overlay headline failed, using fallback:', err.message);
    return fallback;
  }
}
