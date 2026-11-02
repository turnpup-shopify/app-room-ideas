import { NextResponse } from 'next/server';
import { createPin, classifyPinError, tagProductsOnPin } from '../../../../lib/pinterest.js';
import { generatePinCopy } from '../../../../lib/pinCopy.js';
import { fetchCleanImage } from '../../../../lib/cleanImage.js';
import { imageHash, findPostedImage, duplicateImageError, recordPostedPin } from '../../../../lib/pinHistory.js';

export async function POST(request) {
  try {
    const { imageUrl, boardId, title, description, altText, link, pattern, tagProducts, style, roomType, scene, products, roomDescription } = await request.json();

    if (!imageUrl) return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });

    // Use the copy reviewed in the modal when sent; otherwise draft it here
    const copy = title || description
      ? { title: title || '', description: description || '', altText: altText || '' }
      : await generatePinCopy({ style, roomType, scene, products: products || [], roomDescription, link: link?.trim() || undefined });
    console.log('[pinterest] Pin copy:', copy);

    // Download from Higgsfield CDN and strip metadata
    const { buffer: imageBuffer } = await fetchCleanImage(imageUrl);

    // Never upload an image Pinterest has already seen (pin guide section 7)
    const hash = imageHash(imageBuffer);
    const dup = duplicateImageError(findPostedImage({ hash, sourceImageUrl: imageUrl }));
    if (dup) return NextResponse.json({ error: dup, duplicateImage: true }, { status: 409 });

    const result = await createPin({
      imageBuffer,
      title: copy.title,
      description: copy.description,
      // Product page link only, never the home page
      link: link?.trim() || copy.link || undefined,
      boardId,
      altText: copy.altText || undefined,
    });

    recordPostedPin({ pinId: result.id, pinUrl: result.url, title: copy.title, link: link?.trim() || copy.link, pattern: pattern || copy.pattern, hash, sourceImageUrl: imageUrl });

    // Tag the room's products (best-effort; the pin already exists)
    const tagging = await tagProductsOnPin(result.id, (tagProducts ?? []).filter((p) => p.tag !== false));
    console.log('[pinterest] Product tags:', tagging);

    return NextResponse.json({ pinId: result.id, pinUrl: result.url, copy, tagging });
  } catch (err) {
    console.error('Pinterest publish error:', err);
    const { status, ...body } = classifyPinError(err);
    return NextResponse.json(body, { status });
  }
}
