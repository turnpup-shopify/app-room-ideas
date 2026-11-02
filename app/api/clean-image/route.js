import { fetchCleanImage } from '../../../lib/cleanImage.js';

/**
 * GET /api/clean-image?url=<image url>
 * Returns the image as a metadata-free JPEG (used by the card's download button).
 */
export async function GET(request) {
  const url = new URL(request.url).searchParams.get('url');
  if (!url || !/^https?:\/\//.test(url)) return new Response('url is required', { status: 400 });
  try {
    const { buffer, contentType } = await fetchCleanImage(url);
    return new Response(buffer, { headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    console.error('[/api/clean-image]', err);
    return new Response(err.message, { status: 500 });
  }
}
