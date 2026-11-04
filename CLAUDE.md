# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (uses Turbopack)
npm run build    # Production build
npm run start    # Serve production build
npm run audit:combos              # Audit Uttermost product types vs config.json combinations (dry run)
npm run audit:combos -- --apply   # ...and append Claude-proposed, validated combinations to config.json
npm run vendor:demand             # Uttermost demand report from the daily inventory feed history (vendor-feed/)
npm run vendor:demand -- --sync   # ...pull new days from the Apps Script archive first
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
6. Optionally publish a 2:3 Pinterest-format pin (via Pinterest API) that links back to the room/product pages

**Storefront**: A theme section already exists that renders published room metaobjects. The `custom.rooms` metafield on products is used by the PDP to show "rooms this product appears in" — so `linkRoomToProducts()` is critical for the storefront, not optional.

**Usage pattern**: Single user, run ad hoc. The current card-by-card review + publish flow is intentional — each room is reviewed before publishing.

## Active development areas (as of this session)

- **custom.rooms metafield back-linking**: After publishing a room, each product in that room should have its `custom.rooms` (type: `list.metaobject_reference`) updated to include the new room GID. This is being debugged — the `linkRoomToProducts()` function in `/api/publish/route.js` now has verbose logging to surface Shopify `userErrors`.
- **Pinterest integration**: Full OAuth flow via Pinterest v5 API. Connect in the hamburger menu, select a board, then publish pins from room cards. Pins auto-generate title/description/alt-text from room data. If the room was published to Shopify first, the pin links back to the room page. Token stored in `pinterest-auth.json` (gitignored). The `lib/pinterest.js` client handles auth, token refresh, board listing, and pin creation. Local save to iCloud Drive still works independently via `/api/save-pin`.
- **Throttling**: Shopify GraphQL query cost was being exhausted by concurrent fetches from `/api/options` (page load) and `/api/rooms` (generate click). Fixed: `/api/options` now sources styles from the Google Sheets CSV column K only, never touching Shopify.

## Environment Variables

Required in `.env.local`:
```
SHOPIFY_STORE_DOMAIN=htgtfurniture.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...
ANTHROPIC_API_KEY=sk-ant-...       # Optional — falls back to template description if missing
GOOGLE_SHEETS_SCRIPT_URL=...       # Optional — required only for /api/sync-scene
GOOGLE_SHEETS_APPEND_URL=...       # Optional — htgtprompts2026 Apps Script that appends scene rows (☰ → Add Scene)
PINTEREST_APP_ID=...               # Optional — required for Pinterest integration
PINTEREST_APP_SECRET=...           # Optional — required for Pinterest integration
UTTERMOST_FEED_URL=...             # Optional — Apps Script web app serving the daily feed archive
UTTERMOST_FEED_TOKEN=...           # Optional — shared secret for that web app
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
- **Concurrent image generation**: `/api/generate` allows 2 concurrent Higgsfield CLI calls; extra requests wait in a server-side queue (no 429). The client mirrors this with `queueGeneration()` in `app/page.jsx` so cards show "Queued · Cancel" while waiting.
- **Image formats**: each card's Create Image button opens a picker (`IMAGE_FORMATS` in `app/page.jsx`): Square 1:1, Pinterest 2:3, Portrait 4:5, Reel 9:16, sent as `aspectRatio` to `/api/generate`. A 1:1 image can optionally be appended to one of the room's products' media gallery via `/api/products/add-image` (`productCreateMedia`; staged upload shared with store publish in `lib/shopifyUpload.js`). One image per card; store publish, Save to Downloads, and Pinterest all use it. `config.higgsfield.aspectRatio` is only the API fallback. A Pinterest 2:3 render with exactly one featured product (and it's selected on the card) gets a FINAL FRAMING block appended (`singleProductPinFraming()` in `app/page.jsx`) that crops to that product; it's added at generate time, so it doesn't show in the card's prompt box. The format menu also has an optional **Text overlay** checkbox: ticking it drafts the pin's search phrase in 3 to 7 words (pin guide section 6) via `/api/pinterest/headline` (`generateOverlayHeadline()` in `lib/pinCopy.js`), editable in the menu, and `textOverlayInstructions()` appends it to the prompt so the image model renders the text in the same pass, using one of four `OVERLAY_STYLES` (typography + placement) chosen by `nextOverlayStyle()` so consecutive renders differ (last pick in localStorage). Text stays out of the bottom 20 percent (editorial type set inside the full-bleed photo; bands, boxes, and borders are explicitly banned because the model otherwise adds a white header strip). Works with any format; the text is baked into the image wherever it's used.
- **Pin copy rules live in `prompts/`**: `pinterest-pin-guide.md` (the HTGT pin guide: title patterns A/B/C, three sentence description, topic tags, max 3 specific hashtags, style plus room boards, QA list) plus a copy of the no-ai-slop skill (`no-ai-slop.md`, `no-ai-slop-eval.md`). `pinSystemPrompt()` in `lib/pinCopy.js` sends all three as the cached system prompt for pin copy and overlay headlines, read on every call. Change the rules there, not in code. If `~/.claude/skills/no-ai-slop/` changes, re-copy it. `checkCopy()` verifies what code can (length, three sentences, no dash/hyphen/semicolon/colon/!, sentence case, no Costa Mesa, banned words, topic count) and retries once with the problems; `scrub()` then strips banned punctuation. Model is `claude-sonnet-5-5` (`PIN_COPY_MODEL` overrides); 5.x models think first, so `max_tokens` must leave room. The project skill `.claude/skills/pin-creation` points Claude Code at the same files.
- **Pin posting**: clicking Publish/Post opens a review modal. `/api/pinterest/copy` downloads and cleans the render, sends a 1024px copy to Claude (`resizeImageBuffer()`), and drafts title/description/alt/hashtags/topic tags from what's visible, plus `imageIssues` from the guide's reject list. It suggests a board (`suggestBoard()`: a board matching both style and room, on the account or in the guide's target set, else a room-only board that doesn't name another room or style, else a new "[Style] [Room] Ideas" name; the modal warns when it doesn't exist yet).
- **Pin history** (`lib/pinHistory.js`, `pinterest-posted.json`, gitignored): every post logs title, link, pattern (A/B/C), and a SHA-256 of the cleaned JPEG. Both publish routes return 409 for an image already pinned (same hash or source URL). `pinHistoryFor()` merges the log with the account's pins (cached 10 min) to give Claude earlier titles for the room's products (new angle, not a room swap), a pattern hint for the 70/30 room idea vs hero mix (last 10 logged pins), and modal warnings when the hero product has 5+ pins or was pinned in the last 7 days. The pattern travels with the draft and saved pins so the mix counts them. Hashtags come from the `pinterestHashtags` library in `config.json` (style × room and style × hero product tags); tags naming a different product style are filtered out per pin (`namesOtherStyle()`). Topic tags are shown for copying into Pinterest by hand; the v5 API can't set them. Both the Claude prompt and the no-key fallback follow the guide; `/api/pinterest/publish` posts the edited values. Website starts blank and is filled with the hero product's page (`https://htgtfurniture.com/products/<handle>`, from `generatePinCopy`'s `link`); pins never link to the home page. "Save for later" stores the copy in `pinterest-saved.json` and downloads the image to `saved-pins/` (both gitignored, `lib/pinQueue.js`, `/api/pinterest/saved`); saved pins are reviewed/posted from ☰ → Saved Pins and removed once posted.
- **Room Type filter** values come from the scene sheet (col L), not combination names. `buildRooms` matches combinations by case-insensitive substring and falls back to all combinations when none match.
- **Scene choice and style**: `buildPrompt` picks a scene matching room type (col L) and the room's design style (col K), loosening to room type only, then style only, then any. The room's style is stored as `scene.design_style` and `assemblePrompt` adds a "Design style:" line telling the model to adapt the scene to it, so a scene tagged with another style still renders in the room's style. When the scene isn't tagged with the room's style, `buildPrompt` also replaces the scene's materials, lighting, color grade, avoid rules, and realism notes with the style's look from `lib/styleProfiles.js` (one entry per `custom.design_style` value) and keeps only its layout. Without this, a detailed scene renders the same room whatever style is asked for.
- **Image metadata is stripped before anything leaves the app**: `lib/cleanImage.js` (`fetchCleanImage`) runs the same `magick - -strip -auto-orient -colorspace sRGB` pass as `~/scripts/clean-images.command` and returns a JPEG. Used by Shopify publish, Pinterest publish, saved pins, save-pin, and `/api/clean-image` (card download button). New upload paths should go through it.
- **Pinterest product tags**: after a pin is created, `tagProductsOnPin()` in `lib/pinterest.js` finds each product's catalog pin (`/catalogs/products/get_by_product_group_filters`, matching `item_group_id` to the numeric Shopify product ID) and calls `POST /pins/{id}/product_tags`. Best-effort: failures come back as `tagging` in the response, never fail the post. Needs the `catalogs:read` scope. The review modal calls `/api/pinterest/catalog-check` to mark which products are in the catalog; products only appear there once published to the Pinterest sales channel in Shopify.
- **Pin suggestions** (☰ → Pin Suggestions, `/api/pinterest/suggestions`, `lib/pinSuggestions.js`): ranks in-stock products by time since last pin, stock, 90-day units sold, new arrivals, and Pinterest top-pin analytics (saves/clicks credited to product types). A pin counts for a product if it links to `/products/<handle>` or has a product tag (tag pin → its link → handle). Also builds suggested rooms of unpinned products that share a style and fill a `productTypeCombinations` entry. "Make a room" puts the products in the featured slots and calls `generate()`. Results cached 30 min (`?refresh=1`); a full run takes ~15s.
- **Uttermost demand** (`lib/vendorFeed.js`, `scripts/vendor-demand.mjs`): the vendor emails a daily inventory feed (subject "[Uttermost] Uttermost Item Availability", SKU + EC/WC/TX qty + next-avail notes). `scripts/apps-script/uttermost-feed-archive.gs` (added to the user's existing inv-uttermost-gmail Apps Script project) saves one CSV per day to Drive and serves them; `syncFeedSnapshots()` mirrors them into `vendor-feed/` (gitignored). Day-over-day warehouse drops estimate units sold by all dealers. Warehouse qty caps at 50, so sales of SKUs at the cap are invisible. `lib/vendorDemand.js` builds the report (shared by the CLI and `/api/vendor/demand`) and looks up names/photos for SKUs you don't carry via uttermost.com's public Magento GraphQL (`https://uttermost.com/graphql`, cached a week in `vendor-feed/uttermost-catalog.json`). In the app: ☰ → Vendor Demand (dashboard + Sync feed button → `/api/vendor/sync`). Pin Suggestions adds up to 15 points for Uttermost sell-through and subtracts 20 for products about to sell out at the vendor (`demandBySku()`, needs ≥ 7 snapshots).
- **Add Scene** (☰ → Add Scene, `AddSceneModal` in `app/page.jsx`, ported from htgtprompts2026's `/add-room`): upload a room photo, `/api/scenes/analyze` has Claude fill in the scene sheet columns (room types and styles limited to the sheet's values plus `STYLE_NAMES` from `lib/styleProfiles.js`), edit, then `/api/scenes/add` appends the row through `GOOGLE_SHEETS_APPEND_URL` and clears the scenes cache. The published CSV can lag a few minutes behind the sheet.
- **Prompt assembly is mirrored**: `assemblePrompt()` in `lib/promptBuilder.js` and `assemblePromptFromScene()` in `app/page.jsx` must stay in sync — the client re-assembles the prompt live when users edit scene fields without a round-trip.

### `config.json`

Central configuration. The `productTypeCombinations` array (54 entries, including one per scene-sheet room type so room type filters don't fall back to random combos) defines what product types constitute each room type. Room generation only works if Shopify has products matching the required `productType` values for a given design style. Use `GET /api/catalogue` to audit which combinations are viable against the live catalog.

### Scene templates (Google Sheets CSV)

Column mapping (raw CSV header → scene object key):
- `room_name` (col A) → used as scene identifier in "Any scene" filter and `overrides.roomName`
- `styles` (col K) → `scene.style_tags`
- `rooms` (col L) → `scene.room_type`

The CSV is cached in `lib/promptBuilder.js` with a 5-minute TTL. Blank rows are dropped on load, so each scene keeps `dataRow` (its position under the header) and that is what `/api/sync-scene` receives as `rowIndex`. `clearScenesCache()` is exported and called by `/api/sync-scene` after writing changes back to the sheet.

### Shopify data model

- `custom.design_style` on products: `list.single_line_text_field` limited to the 14 `STYLE_NAMES`, e.g. `["Coastal","Modern"]`
- `custom.materials` on products: text, but the definition only allows certain product categories (Paintings, Lighting, Pillows, etc. are rejected). `metafieldsSet` is atomic, so one disallowed product fails its whole batch.
- `custom.rooms` on products: `list.mixed_reference` — JSON array of room metaobject GIDs; updated by `linkRoomToProducts()` after each publish
- Room metaobjects (type `room`) fields: `room_name`, `description` (rich_text), `image` (file GID), `products` (list of product GIDs), `instagram_handle`

### Room description generation

`generateRoomDescription()` in `/api/publish/route.js` calls Claude with Dwell-magazine-style writing rules baked into the prompt (no superlatives, no banned words, active voice, present tense, third person). Responds with only the description text. Falls back to a template string if `ANTHROPIC_API_KEY` is not set or the call fails.
