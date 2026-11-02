import { NextResponse } from 'next/server';
import { createPin, classifyPinError, tagProductsOnPin } from '../../../../../../lib/pinterest.js';
import { imageHash, findPostedImage, duplicateImageError, recordPostedPin } from '../../../../../../lib/pinHistory.js';
import { getSavedPin, updateSavedPin, deleteSavedPin, readSavedPinImage } from '../../../../../../lib/pinQueue.js';

/**
 * POST /api/pinterest/saved/:id/post
 * Body: optional edited fields (title, body, hashtags, altText, link, boardId), saved before posting.
 * Posts the pin, then removes it from the saved list.
 */
export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const edits = await request.json().catch(() => ({}));
    const pin = Object.keys(edits).length ? updateSavedPin(id, edits) : getSavedPin(id);
    if (!pin) return NextResponse.json({ error: 'Saved pin not found' }, { status: 404 });

    // Never upload an image Pinterest has already seen (pin guide section 7)
    const imageBuffer = await readSavedPinImage(id);
    const hash = imageHash(imageBuffer);
    const dup = duplicateImageError(findPostedImage({ hash, sourceImageUrl: pin.sourceImageUrl }));
    if (dup) return NextResponse.json({ error: dup, duplicateImage: true }, { status: 409 });

    const result = await createPin({
      imageBuffer,
      title: pin.title,
      description: [pin.body?.trim(), pin.hashtags?.trim()].filter(Boolean).join('\n\n'),
      link: pin.link?.trim() || undefined,
      boardId: pin.boardId || undefined,
      altText: pin.altText || undefined,
    });

    recordPostedPin({ pinId: result.id, pinUrl: result.url, title: pin.title, link: pin.link, pattern: pin.pattern, hash, sourceImageUrl: pin.sourceImageUrl });

    const tagging = await tagProductsOnPin(result.id, (pin.tagProducts ?? []).filter((p) => p.tag !== false));
    console.log('[pinterest] Product tags:', tagging);

    deleteSavedPin(id);
    return NextResponse.json({ pinId: result.id, pinUrl: result.url, tagging });
  } catch (err) {
    console.error('[/api/pinterest/saved/post]', err);
    const { status, ...body } = classifyPinError(err);
    return NextResponse.json(body, { status });
  }
}
