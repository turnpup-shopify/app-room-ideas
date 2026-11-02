import { NextResponse } from 'next/server';
import { graphqlRequest } from '../../../../lib/shopify.js';
import { fetchCleanImage } from '../../../../lib/cleanImage.js';
import { stageImageUpload } from '../../../../lib/shopifyUpload.js';

const PRODUCT_CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const MEDIA_STATUS = `
  query mediaStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        status
      }
    }
  }
`;

/**
 * POST /api/products/add-image
 * Body: { imageUrl, productId (Shopify GID), productTitle?, alt? }
 * Appends the (metadata-stripped) image to the end of the product's media gallery.
 * Returns { mediaId, status, adminUrl }.
 */
export async function POST(request) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) {
    return NextResponse.json({ error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN environment variables.' }, { status: 500 });
  }

  try {
    const { imageUrl, productId, productTitle, alt } = await request.json();
    if (!imageUrl || !productId) {
      return NextResponse.json({ error: 'imageUrl and productId are required.' }, { status: 400 });
    }

    const { buffer, contentType, ext } = await fetchCleanImage(imageUrl);
    const slug = String(productTitle || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${slug}-room-${Date.now()}.${ext}`;
    const resourceUrl = await stageImageUpload(domain, token, { buffer, filename, contentType });

    const data = await graphqlRequest(domain, token, PRODUCT_CREATE_MEDIA, {
      productId,
      media: [{ mediaContentType: 'IMAGE', originalSource: resourceUrl, alt: alt || '' }],
    });
    const errors = data.productCreateMedia.mediaUserErrors;
    if (errors?.length > 0) throw new Error(`Add image error: ${errors.map((e) => e.message).join(', ')}`);
    const mediaId = data.productCreateMedia.media?.[0]?.id;
    if (!mediaId) throw new Error('No media ID returned from productCreateMedia');

    // Wait for Shopify to process it so a FAILED image is reported (timeout 30s)
    let status = data.productCreateMedia.media[0].status;
    const pollStart = Date.now();
    while (status !== 'READY' && Date.now() - pollStart < 30_000) {
      await new Promise((r) => setTimeout(r, 2000));
      status = (await graphqlRequest(domain, token, MEDIA_STATUS, { id: mediaId })).node?.status;
      if (status === 'FAILED') throw new Error('Shopify image processing failed');
    }

    const store = domain.replace('.myshopify.com', '');
    const adminUrl = `https://admin.shopify.com/store/${store}/products/${productId.split('/').pop()}`;
    return NextResponse.json({ mediaId, status, adminUrl });
  } catch (err) {
    console.error('[/api/products/add-image]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
