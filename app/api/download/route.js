import JSZip from 'jszip';
import { slugify } from '../../../lib/promptBuilder.js';

/**
 * POST /api/download
 * Body: { styleName, prompt, products: [{ title, images: [url, ...] }] }
 * Returns a ZIP file containing prompt.txt + per-product image subfolders.
 */
export async function POST(request) {
  try {
    const { styleName, prompt, products } = await request.json();

    if (!styleName || !prompt || !Array.isArray(products)) {
      return new Response('Invalid request body', { status: 400 });
    }

    const zip = new JSZip();

    // Add prompt.txt
    zip.file('prompt.txt', prompt);

    // Fetch all product images in parallel
    await Promise.all(
      products.map(async (product) => {
        const folder = zip.folder(slugify(product.title));
        const imageUrls = product.images ?? [];

        await Promise.all(
          imageUrls.map(async (url, idx) => {
            try {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const buffer = await res.arrayBuffer();
              const ext = imageExtension(url);
              folder.file(`image-${idx + 1}${ext}`, buffer);
            } catch (err) {
              console.warn(`[download] Failed to fetch image ${url}: ${err.message}`);
            }
          })
        );
      })
    );

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const filename = `${slugify(styleName)}.zip`;

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zipBuffer.byteLength),
      },
    });
  } catch (err) {
    console.error('[/api/download]', err);
    return new Response(err.message, { status: 500 });
  }
}

function imageExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1];
    return ext ? `.${ext.toLowerCase()}` : '.jpg';
  } catch {
    return '.jpg';
  }
}
