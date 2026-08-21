import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { graphqlRequest } from '../../../lib/shopify.js';

const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        resourceUrl
        url
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_QUERY = `
  query fileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        image {
          url
        }
      }
    }
  }
`;

const METAOBJECT_CREATE = `
  mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PRODUCT_ROOMS_METAFIELD = `
  query getProductRooms($id: ID!) {
    product(id: $id) {
      metafield(namespace: "custom", key: "rooms") {
        value
      }
    }
  }
`;

const PRODUCT_UPDATE_ROOMS = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        metafield(namespace: "custom", key: "rooms") {
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * For each product in the room, append the new room metaobject ID
 * to the product's custom.rooms metafield (list.metaobject_reference).
 * Reads current value first so existing room links are preserved.
 * Updates each product individually for clear per-product error reporting.
 *
 * Returns a summary object { linked, skipped, errors } for the API response.
 */
async function linkRoomToProducts(domain, token, productGids, roomMetaobjectId) {
  console.log(`[publish:link] Starting — ${productGids.length} product(s), room: ${roomMetaobjectId}`);

  if (productGids.length === 0) {
    console.log('[publish:link] No product GIDs — skipping.');
    return { linked: 0, skipped: 0, errors: [] };
  }

  let linked = 0;
  let skipped = 0;
  const errors = [];

  for (const gid of productGids) {
    try {
      // 1. Read current custom.rooms list for this product
      console.log(`[publish:link] Reading custom.rooms for ${gid}`);
      const readData = await graphqlRequest(domain, token, GET_PRODUCT_ROOMS_METAFIELD, { id: gid });
      const raw = readData.product?.metafield?.value;
      console.log(`[publish:link]   current value: ${raw ?? '(none)'}`);
      const currentList = raw ? JSON.parse(raw) : [];

      // 2. Skip if already linked
      if (currentList.includes(roomMetaobjectId)) {
        console.log(`[publish:link]   already linked — skipping`);
        skipped++;
        continue;
      }

      // 3. Append new room and write back via productUpdate
      const newValue = JSON.stringify([...currentList, roomMetaobjectId]);
      console.log(`[publish:link]   setting to: ${newValue}`);

      const writeData = await graphqlRequest(domain, token, PRODUCT_UPDATE_ROOMS, {
        input: {
          id: gid,
          metafields: [{
            namespace: 'custom',
            key: 'rooms',
            type: 'list.mixed_reference',
            value: newValue,
          }],
        },
      });

      const userErrors = writeData.productUpdate?.userErrors ?? [];
      const stored = writeData.productUpdate?.product?.metafield?.value;
      console.log(`[publish:link]   response — stored: ${stored ?? '(null)'}, userErrors: ${JSON.stringify(userErrors)}`);

      if (userErrors.length > 0) {
        const msg = userErrors.map(e => `[${e.field?.join?.('.')}] ${e.message}`).join('; ');
        console.error(`[publish:link]   FAILED: ${msg}`);
        errors.push(`${gid}: ${msg}`);
      } else {
        console.log(`[publish:link]   linked OK`);
        linked++;
      }
    } catch (err) {
      console.error(`[publish:link] Exception for ${gid}:`, err.message);
      errors.push(`${gid}: ${err.message}`);
    }
  }

  console.log(`[publish:link] Done — linked: ${linked}, skipped: ${skipped}, errors: ${errors.length}`);
  return { linked, skipped, errors };
}

/**
 * Generate a sharp, Dwell-style room description from scene and product context.
 * Writing rules are baked into the prompt (no-ai-slop principles).
 * Falls back to a minimal template if ANTHROPIC_API_KEY is not set or the call fails.
 */
async function generateRoomDescription({ style, scene, products, roomName }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const productList = products
    .map((p) => [p.title, p.materials].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('; ');

  const context = [
    style       && `Style: ${style}`,
    scene?.room_type    && `Room type: ${scene.room_type}`,
    scene?.room_details && `Room character: ${scene.room_details}`,
    scene?.materials    && `Materials: ${scene.materials}`,
    scene?.lighting     && `Lighting: ${scene.lighting}`,
    scene?.color_grade  && `Color tone: ${scene.color_grade}`,
    scene?.style_tags   && `Style tags: ${scene.style_tags}`,
    productList         && `Products: ${productList}`,
  ].filter(Boolean).join('\n');

  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 180,
        messages: [{
          role: 'user',
          content: `Write a 2–3 sentence room description for a furniture brand's website. ` +
            `Match the register of Dwell magazine: specific, direct, present tense, third person. ` +
            `Name the actual materials, light quality, or spatial character — not abstractions. ` +
            `\n\nHard rules:\n` +
            `- No superlatives or praise words: perfect, stunning, beautiful, incredible, amazing, exceptional\n` +
            `- No banned words: delve, foster, leverage, utilize, facilitate, empower, streamline, robust, ` +
            `cutting-edge, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, ` +
            `transformative, elevate, embark, supercharge, harness\n` +
            `- No throat-clearing openers ("Here's the thing", "Let me be clear", "The truth is")\n` +
            `- No importance puffery ("stands as a testament", "marks a pivotal moment", "plays a vital role")\n` +
            `- No colon reveals used for drama\n` +
            `- No fake-profound kicker at the end\n` +
            `- No binary contrasts ("It's not X. It's Y.")\n` +
            `- Active voice. Make verbs do the work.\n` +
            `- If a sentence could describe any room anywhere, cut it.\n` +
            `\nRespond with only the description, nothing else.\n\n${context}`,
        }],
      });
      const text = message.content?.[0]?.text?.trim();
      if (text) return text;
    } catch (err) {
      console.warn('[publish] Claude description failed, using fallback:', err.message);
    }
  }

  // Fallback: minimal template from scene data
  const roomLabel = scene?.room_type || roomName;
  const materialNote = scene?.materials || products.map((p) => p.materials).filter(Boolean)[0];
  const lightNote = scene?.lighting;

  let fallback = `${style ? style + ' ' : ''}${roomLabel}`;
  if (materialNote) fallback += ` in ${materialNote.toLowerCase()}`;
  fallback += '.';
  if (scene?.room_details) fallback += ` ${scene.room_details}`;
  if (lightNote) fallback += ` ${lightNote}.`;

  return fallback;
}

export async function POST(request) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return NextResponse.json(
      { error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN environment variables.' },
      { status: 500 }
    );
  }

  try {
    const { imageUrl, roomName, style, scene, products } = await request.json();

    if (!imageUrl || !roomName) {
      return NextResponse.json(
        { error: 'imageUrl and roomName are required.' },
        { status: 400 }
      );
    }

    // 1. Generate room description with Claude (or fallback template)
    const description = await generateRoomDescription({ style, scene, products: products || [], roomName });
    console.log('[publish] Room description:', description);

    // 2. Download the generated image from Higgsfield CDN
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      throw new Error(`Failed to download image: ${imageRes.status}`);
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const contentType = imageRes.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    const filename = `${roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;

    // 3. Stage upload
    const stagedData = await graphqlRequest(domain, token, STAGED_UPLOADS_CREATE, {
      input: [{
        resource: 'IMAGE',
        filename,
        mimeType: contentType,
        httpMethod: 'POST',
        fileSize: String(imageBuffer.length),
      }],
    });

    const target = stagedData.stagedUploadsCreate.stagedTargets?.[0];
    const stagedErrors = stagedData.stagedUploadsCreate.userErrors;
    if (stagedErrors?.length > 0) {
      throw new Error(`Staged upload error: ${stagedErrors.map(e => e.message).join(', ')}`);
    }
    if (!target) {
      throw new Error('No staged upload target returned');
    }

    // 4. Upload image bytes via multipart form POST
    const form = new FormData();
    for (const param of target.parameters) {
      form.append(param.name, param.value);
    }
    form.append('file', new Blob([imageBuffer], { type: contentType }), filename);

    const uploadRes = await fetch(target.url, {
      method: 'POST',
      body: form,
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`Upload failed (${uploadRes.status}): ${text}`);
    }

    // 5. Register file via fileCreate
    const fileData = await graphqlRequest(domain, token, FILE_CREATE, {
      files: [{
        contentType: 'IMAGE',
        originalSource: target.resourceUrl,
        alt: roomName,
      }],
    });

    const fileErrors = fileData.fileCreate.userErrors;
    if (fileErrors?.length > 0) {
      throw new Error(`File create error: ${fileErrors.map(e => e.message).join(', ')}`);
    }

    const fileId = fileData.fileCreate.files?.[0]?.id;
    if (!fileId) {
      throw new Error('No file ID returned from fileCreate');
    }

    // 6. Poll file status until READY (timeout 30s)
    const pollStart = Date.now();
    while (Date.now() - pollStart < 30_000) {
      const statusData = await graphqlRequest(domain, token, FILE_QUERY, { id: fileId });
      const status = statusData.node?.fileStatus;
      if (status === 'READY') break;
      if (status === 'FAILED') throw new Error('Shopify file processing failed');
      await new Promise(r => setTimeout(r, 2000));
    }

    // 7. Create metaobject
    const richTextDescription = JSON.stringify({
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'text', value: description }],
      }],
    });

    const productGids = (products || [])
      .map(p => p.id)
      .filter(Boolean);

    const metaobjectData = await graphqlRequest(domain, token, METAOBJECT_CREATE, {
      metaobject: {
        type: 'room',
        capabilities: {
          publishable: {
            status: 'ACTIVE',
          },
        },
        fields: [
          { key: 'room_name', value: roomName },
          { key: 'instagram_handle', value: '' },
          { key: 'description', value: richTextDescription },
          { key: 'image', value: fileId },
          { key: 'products', value: JSON.stringify(productGids) },
        ],
      },
    });

    const metaErrors = metaobjectData.metaobjectCreate.userErrors;
    if (metaErrors?.length > 0) {
      throw new Error(`Metaobject create error: ${metaErrors.map(e => e.message).join(', ')}`);
    }

    const metaobject = metaobjectData.metaobjectCreate.metaobject;

    // 8. Back-link: append this room to each product's custom.rooms metafield
    const linkResult = await linkRoomToProducts(domain, token, productGids, metaobject.id);

    return NextResponse.json({
      metaobjectId: metaobject.id,
      handle: metaobject.handle,
      description,
      linkResult,
    });
  } catch (err) {
    console.error('[/api/publish]', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
