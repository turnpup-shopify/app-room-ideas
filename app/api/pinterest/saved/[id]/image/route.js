import { readSavedPinImage } from '../../../../../../lib/pinQueue.js';

/** GET /api/pinterest/saved/:id/image — the locally stored pin image */
export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const buffer = await readSavedPinImage(id);
    const type = buffer[0] === 0x89 && buffer[1] === 0x50 ? 'image/png' : buffer.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg';
    return new Response(buffer, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
