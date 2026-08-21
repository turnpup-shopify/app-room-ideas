import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const PINS_DIR = join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Pinterest', 'Htgt');

/**
 * POST /api/save-pin
 * Body: { imageUrl, filename }
 * Downloads the image and saves it to ~/Downloads/new_pins_generated/<filename>.
 */
export async function POST(request) {
  try {
    const { imageUrl, filename } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required.' }, { status: 400 });
    }

    // Ensure destination folder exists
    await mkdir(PINS_DIR, { recursive: true });

    // Download image
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

    const safe = (filename || String(Date.now()))
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-|-$/g, '');

    const finalName = `${safe}.${ext}`;
    await writeFile(join(PINS_DIR, finalName), buffer);

    return NextResponse.json({ saved: finalName, path: join(PINS_DIR, finalName) });
  } catch (err) {
    console.error('[/api/save-pin]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
