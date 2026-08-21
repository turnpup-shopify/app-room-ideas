# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (uses Turbopack)
npm run build    # Production build
npm run start    # Serve production build
```

No test runner or linter is configured.

## What This App Does

An internal content production tool for HTGT/Uttermost furniture. The goal is to generate AI-rendered room vignette images at scale — publishing them to the Shopify storefront as browsable "room ideas" and distributing them to Pinterest to drive traffic back to the store.

The workflow per room:
1. Pull matching products from Shopify (filtered by vendor, inventory, design style metafield)
2. Group them into cohesive combinations using a scoring algorithm (shared styles + materials)
3. Build a detailed Higgsfield prompt from a Google Sheets scene template library
4. Render an image via the Higgsfield CLI
5. Publish to Shopify as a `room` metaobject + back-link each product's `custom.rooms` metafield
6. (In progress) Generate a 2:3 Pinterest-format version that links back to the room/product pages

**Storefront**: A theme section already exists that renders published room metaobjects. The `custom.rooms` metafield on products is used by the PDP to show "rooms this product appears in" — so `linkRoomToProducts()` is critical for the storefront, not optional.

**Usage pattern**: Single user, run ad hoc. The current card-by-card review + publish flow is intentional — each room is reviewed before publishing.

## Active development areas (as of this session)

- **custom.rooms metafield back-linking**: After publishing a room, each product in that room should have its `custom.rooms` (type: `list.metaobject_reference`) updated to include the new room GID. This is being debugged — the `linkRoomToProducts()` function in `/api/publish/route.js` now has verbose logging to surface Shopify `userErrors`.
- **Pinterest integration**: Mode toggle exists (standard / Pinterest). Pinterest mode generates at 2:3 and saves to `~/Downloads/new_pins_generated/`. Posting to Pinterest is a placeholder — API keys not yet configured. When implemented, pins should link back to the Shopify room or product page (traffic goal).
- **Throttling**: Shopify GraphQL query cost was being exhausted by concurrent fetches from `/api/options` (page load) and `/api/rooms` (generate click). Fixed: `/api/options` now sources styles from the Google Sheets CSV column K only, never touching Shopify.

## Environment Variables

Required in `.env.local`:
```
SHOPIFY_STORE_DOMAIN=htgtfurniture.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...
ANTHROPIC_API_KEY=sk-ant-...       # Optional — falls back to template description if missing
GOOGLE_SHEETS_SCRIPT_URL=...       # Optional — required only for /api/sync-scene
```

## Architecture

### Request flow for "Generate Rooms"

```
POST /api/rooms
  → fetchProducts(config)        lib/shopify.js       paginated Shopify GraphQL, filters by vendor/inventory/designStyle metafield
  → buildRooms(products, config) lib/rules.js         groups by style, samples combos, scores by shared styles+materials
  → buildPrompt(room, filters)   lib/promptBuilder.js picks a Google Sheets CSV row, injects product descriptions
  → returns rooms[] to frontend
```

### Request flow for "Publish to Store"

```
POST /api/publish
  → generateRoomDescription()  calls Claude (claude-haiku-4-5) with no-ai-slop rules; fallback template if no API key
  → download image from Higgsfield CDN
  → stagedUploadsCreate → multipart upload → fileCreate → poll until READY
  → metaobjectCreate (type: "room") with image GID + product GIDs
  → linkRoomToProducts()       reads each product's custom.rooms metafield, appends new room GID, writes back via metafieldsSet
  → returns { metaobjectId, handle, description, linkResult }
```

### Key design constraints

- **Product uniqueness**: `buildRooms` tracks `usedProductIds` — each product appears in at most one room per generation run. This is intentional. Do not cache `fetchProducts` across requests — randomness between runs is a core feature.
- **`/api/options` must not call `fetchProducts`**: Styles come from the Google Sheets CSV column K, not Shopify, to avoid concurrent GraphQL fetches that exhaust the Shopify query cost bucket.
- **Shopify GraphQL throttling**: `graphqlRequest()` in `lib/shopify.js` has retry-with-backoff (up to 4 retries, exponential 500ms–4s) for THROTTLED errors. Sequential fetches in `linkRoomToProducts` are deliberate.
- **Concurrent image generation**: `/api/generate` uses a module-level semaphore limiting to 2 concurrent Higgsfield CLI calls. Returns 429 if exceeded.
- **Prompt assembly is mirrored**: `assemblePrompt()` in `lib/promptBuilder.js` and `assemblePromptFromScene()` in `app/page.jsx` must stay in sync — the client re-assembles the prompt live when users edit scene fields without a round-trip.

### `config.json`

Central configuration. The `productTypeCombinations` array (30 entries) defines what product types constitute each room type. Room generation only works if Shopify has products matching the required `productType` values for a given design style. Use `GET /api/catalogue` to audit which combinations are viable against the live catalog.

### Scene templates (Google Sheets CSV)

Column mapping (raw CSV header → scene object key):
- `room_name` (col A) → used as scene identifier in "Any scene" filter and `overrides.roomName`
- `styles` (col K) → `scene.style_tags`
- `rooms` (col L) → `scene.room_type`

The CSV is cached in `lib/promptBuilder.js` with a 5-minute TTL. `clearScenesCache()` is exported and called by `/api/sync-scene` after writing changes back to the sheet.

### Shopify data model

- `custom.design_style` on products: `list` (JSON array of style strings), e.g. `["Coastal","Modern"]`
- `custom.rooms` on products: `list.mixed_reference` — JSON array of room metaobject GIDs; updated by `linkRoomToProducts()` after each publish
- Room metaobjects (type `room`) fields: `room_name`, `description` (rich_text), `image` (file GID), `products` (list of product GIDs), `instagram_handle`

### Room description generation

`generateRoomDescription()` in `/api/publish/route.js` calls Claude with Dwell-magazine-style writing rules baked into the prompt (no superlatives, no banned words, active voice, present tense, third person). Responds with only the description text. Falls back to a template string if `ANTHROPIC_API_KEY` is not set or the call fails.
