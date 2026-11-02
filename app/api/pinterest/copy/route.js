import { NextResponse } from 'next/server';
import { generatePinCopy } from '../../../../lib/pinCopy.js';
import { getConfig } from '../../../../lib/config.js';
import { isConnected, listBoards } from '../../../../lib/pinterest.js';
import { fetchCleanImage, resizeImageBuffer } from '../../../../lib/cleanImage.js';
import { imageHash, findPostedImage, duplicateImageError, pinHistoryFor } from '../../../../lib/pinHistory.js';

/**
 * POST /api/pinterest/copy
 * Body: { imageUrl, style, roomType, scene, products, roomDescription, link }
 * Drafts pin title / description / alt text / hashtags / topics, suggests a board, and lists warnings
 * from the pin guide's repeat and image rules, for review before posting.
 */
export async function POST(request) {
  try {
    const { imageUrl, style, roomType, scene, products, roomDescription, link } = await request.json();
    const warnings = [];

    // Claude sees the render (shrunk); the cleaned bytes are hashed to catch an image that was already pinned
    let image;
    if (/^https?:\/\//.test(imageUrl || '')) {
      try {
        const { buffer } = await fetchCleanImage(imageUrl);
        const dup = duplicateImageError(findPostedImage({ hash: imageHash(buffer), sourceImageUrl: imageUrl }));
        if (dup) warnings.push(dup);
        image = { base64: (await resizeImageBuffer(buffer)).toString('base64'), mediaType: 'image/jpeg' };
      } catch (err) {
        console.warn('[/api/pinterest/copy] Could not load the image for Claude:', err.message);
      }
    }

    // Board suggestion and history are best-effort: copy still drafts if Pinterest isn't connected
    const [boards, history] = await Promise.all([
      isConnected() ? listBoards().catch(() => []) : [],
      pinHistoryFor({ handles: (products || []).map((p) => p.handle) }),
    ]);
    const copy = await generatePinCopy({
      style, roomType, scene, products: products || [], roomDescription, link,
      boards: boards.map((b) => b.name), image, history,
    });
    const boardId = boards.find((b) => b.name === copy.board)?.id ?? null;
    warnings.push(...history.warningsFor(copy.link), ...copy.imageIssues.map((i) => `Image check: ${i}`));

    // Include the hashtag library so the review modal can offer extra tags
    return NextResponse.json({ ...copy, boardId, warnings, library: getConfig().pinterestHashtags ?? [] });
  } catch (err) {
    console.error('[/api/pinterest/copy]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
