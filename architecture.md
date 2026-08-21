# HTGT Room Ideas — Architecture

## Overview

A Next.js tool for generating AI-rendered furniture room vignettes. It pulls curated products from Shopify, groups them into cohesive room combinations, builds detailed AI prompts from scene templates, renders images via the Higgsfield CLI, and publishes results back to Shopify as metaobjects.

---

## Directory Structure

```
app-room-ideas/
├── app/
│   ├── api/
│   │   ├── rooms/route.js       # Room generation pipeline (main orchestrator)
│   │   ├── generate/route.js    # Higgsfield image generation via CLI
│   │   ├── publish/route.js     # Shopify metaobject publisher
│   │   └── download/route.js    # ZIP export bundler
│   ├── page.jsx                 # Main UI (client component)
│   ├── layout.jsx               # Root layout + metadata
│   └── globals.css              # Tailwind imports
├── lib/
│   ├── config.js                # Singleton config loader
│   ├── shopify.js               # Shopify GraphQL client + product fetcher
│   ├── rules.js                 # Room combination algorithm
│   └── promptBuilder.js         # AI prompt composer
├── config.json                  # Master configuration
├── next.config.js               # Next.js + image domain config
├── tailwind.config.js
└── package.json
```

---

## Data Flow

```
User clicks "Generate Rooms"
        │
        ▼
POST /api/rooms
        ├── getConfig()                  → load config.json
        ├── fetchProducts(config)        → Shopify Admin GraphQL (paginated)
        │     └── filters: vendor, tags, inventory, designStyle metafield
        ├── buildRooms(products, config) → group by design style, score + sample combinations
        │     └── each product used in at most one room
        └── buildPrompt(room)            → fetch scene CSV from Google Sheets (5-min cache)
              └── inject product descriptions into template fields
        │
        ▼
Frontend renders RoomCards (product images, prompt, style badge, actions)
        │
        ├── "Generate Image" → POST /api/generate
        │       ├── download + downscale product images (512px)
        │       ├── exec Higgsfield CLI with prompt + up to 14 reference images
        │       └── return imageUrl
        │
        ├── "Publish to Store" → POST /api/publish
        │       ├── download generated image
        │       ├── stage upload in Shopify → upload multipart → register file
        │       ├── poll file status until READY
        │       └── create Shopify metaobject (type: "room")
        │
        └── "Download ZIP" → POST /api/download
                ├── create ZIP with prompt.txt
                └── add per-product image folders → return binary blob
```

---

## Key Modules

### `lib/shopify.js`
- `graphqlRequest()` — thin wrapper around Shopify Admin GraphQL API (2024-01)
- `fetchProducts(config)` — paginates through all products, applies filters:
  - `includeVendors` — whitelist by vendor name
  - `excludeTags` — skip products with specific tags
  - `requireInventory` — must have stock
  - requires `designStyle` metafield (JSON array of design style strings)
- Returns normalized product objects with images, type, vendor, tags, metafields

### `lib/rules.js`
- `buildRooms(products, config)` — core combination engine:
  1. Groups products by design style
  2. For each style + product type combination (defined in config), samples up to 50 random product sets
  3. Scores each set: +1 per shared design style, +1 per shared material keyword
  4. Keeps highest-scoring combination per style/combo
  5. Marks products as "used" to ensure exclusivity across rooms
  6. Shuffles final room order for variety each run

### `lib/promptBuilder.js`
- `fetchScenes()` — fetches scene template CSV from Google Sheets (cached 5 min)
- `buildPrompt(room)` — picks a random scene template row, injects:
  - Product descriptions (type + first material keyword)
  - Room type, materials, lighting, camera angle, color grade, placement logic
  - Negative rules and realism constraints
- Falls back to a hardcoded prompt if CSV is unavailable
- `describeProduct()` — generates short product name: e.g., "iron coffee table", "ceramic vase"

### `lib/config.js`
- Singleton that loads and caches `config.json` in memory on first read

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/rooms` | POST | Full room generation pipeline — returns array of room objects |
| `/api/generate` | POST | Run Higgsfield CLI — returns `imageUrl` |
| `/api/publish` | POST | Upload image + create Shopify metaobject |
| `/api/download` | POST | Bundle prompt + images into ZIP |

---

## Configuration (`config.json`)

```jsonc
{
  "outputDir": "~/Downloads/room-ideas",      // local output path (unused by web UI)
  "includeVendors": ["Uttermost"],            // Shopify vendor whitelist
  "excludeTags": ["need-optimization"],       // tags to skip
  "requireInventory": true,
  "maxImagesPerProduct": 3,
  "productTypeCombinations": [               // 27 room style definitions
    {
      "name": "Living Room",
      "types": ["Coffee Tables", "Accent Tables", "Table Lamps", ...]
    },
    // ... 26 more room types
  ],
  "higgsfield": {
    "model": "nano_banana_2",
    "aspectRatio": "1:1"
  }
}
```

---

## External Services

| Service | Purpose | Auth |
|---------|---------|------|
| Shopify Admin GraphQL | Fetch products, upload files, create metaobjects | `SHOPIFY_ACCESS_TOKEN` env var |
| Higgsfield CLI | Local AI image generation | Local installation at `/opt/homebrew/bin/higgsfield` |
| Google Sheets (CSV) | Scene prompt templates | Public URL, no auth |
| Shopify CDN | Product image hosting | Public URLs |
| Higgsfield CDN | Generated image storage | URLs returned by CLI |

### Required Environment Variables
```
SHOPIFY_STORE_DOMAIN=mystore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...
```

---

## Frontend (`app/page.jsx`)

Client component. No persistent state — all data lives in React state per session.

**State:**
- `rooms` — array of room objects returned by `/api/rooms`
- `generating` — boolean for loading state during room generation
- Per-card state (inside `RoomCard`): generated image URL, publish status, copy state

**Key interactions:**
- "Generate Rooms" button → POST `/api/rooms` → populate `rooms`
- RoomCard "Generate Image" → POST `/api/generate` → display image in card
- RoomCard "Publish" → POST `/api/publish` → show metaobject link
- RoomCard "Download ZIP" → POST `/api/download` → browser download
- RoomCard "Copy Prompt" → `navigator.clipboard.writeText()`

Style badges are color-coded per design style (e.g., Modern = blue, Coastal = teal).

---

## Image Generation Pipeline (Higgsfield)

1. Download up to 14 product images from Shopify CDN, downscaled to 512px
2. Save to a temp directory (cleaned up after generation)
3. Exec Higgsfield CLI: `higgsfield generate --model nano_banana_2 --prompt "..." --images ...`
4. Max 2 concurrent generations (returns HTTP 429 if exceeded)
5. 3-minute timeout per generation
6. Return `imageUrl` from CLI JSON output

---

## Shopify Publish Pipeline

1. Download generated image from Higgsfield CDN
2. `stagedUploadsCreate` mutation → get upload URL + parameters
3. POST image as multipart form to staged upload URL
4. `fileCreate` mutation → register file in Shopify
5. Poll `files` query every 2s until `READY` (timeout: 30s)
6. `metaobjectCreate` mutation → create metaobject of type `room` with:
   - `room_name`, `description`, `image` (file GID), `products` (list of GIDs)

---

## Room Combination Algorithm

For each run of `/api/rooms`:

1. Products grouped by each design style in their `designStyle` metafield
2. Config defines `productTypeCombinations` — 27 named room styles, each requiring a set of product types (e.g., Living Room = Coffee Table + Sofa + Table Lamp + ...)
3. For each style × combination, up to 50 random product sets are sampled and scored
4. Scoring: +1 per shared design style between products, +1 per shared material keyword
5. Best-scoring set wins; all products in the winning set are marked "used" (not reused in other rooms)
6. Rooms shuffled before returning — different results every generation

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `next` ^16 | Framework, API routes, SSR |
| `react` ^18 | UI |
| `jszip` ^3.10 | ZIP file creation |
| `tailwindcss` ^3 | Styling |
| `autoprefixer`, `postcss` | CSS toolchain |
