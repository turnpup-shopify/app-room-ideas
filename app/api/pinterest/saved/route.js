import { NextResponse } from 'next/server';
import { listSavedPins, savePin } from '../../../../lib/pinQueue.js';

/** GET /api/pinterest/saved — pins saved to post later, newest first */
export async function GET() {
  return NextResponse.json(listSavedPins());
}

/** POST /api/pinterest/saved — Body: { imageUrl, roomName, title, body, hashtags, altText, link, boardId } */
export async function POST(request) {
  try {
    const entry = await savePin(await request.json());
    return NextResponse.json(entry);
  } catch (err) {
    console.error('[/api/pinterest/saved]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
