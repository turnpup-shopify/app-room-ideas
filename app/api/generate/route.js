import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getConfig } from '../../../lib/config.js';

const CLI_PATH = '/opt/homebrew/bin/higgsfield';
const CLI_TIMEOUT = 3 * 60 * 1000; // 3 minutes
const MAX_CONCURRENT = 2;

let activeGenerations = 0;

/**
 * POST /api/generate
 * Body: { prompt, products: [{ title, images: [url, ...] }] }
 * Runs the Higgsfield CLI to generate a room scene image.
 */
export async function POST(request) {
  if (activeGenerations >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: 'Too many generations in progress. Please wait and try again.' },
      { status: 429 }
    );
  }

  const config = getConfig();
  const model = config.higgsfield?.model ?? 'nano_banana_2';
  const aspectRatio = config.higgsfield?.aspectRatio ?? '4:3';

  let tempDir = null;
  activeGenerations++;

  try {
    const { prompt, products } = await request.json();

    if (!prompt || !Array.isArray(products)) {
      return NextResponse.json(
        { error: 'Invalid request body: prompt and products are required.' },
        { status: 400 }
      );
    }

    // Download reference images to a temp directory
    tempDir = join(tmpdir(), `higgsfield-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    const imagePaths = [];
    for (const product of products) {
      for (const url of product.images ?? []) {
        try {
          // Downscale Shopify images to 512px wide
          const fetchUrl = url.includes('cdn.shopify.com')
            ? `${url}&width=512`
            : url;

          const res = await fetch(fetchUrl);
          if (!res.ok) continue;

          const buffer = Buffer.from(await res.arrayBuffer());
          const filename = `ref-${imagePaths.length}.jpg`;
          const filepath = join(tempDir, filename);
          await writeFile(filepath, buffer);
          imagePaths.push(filepath);
        } catch (err) {
          console.warn(`[generate] Failed to download image ${url}: ${err.message}`);
        }
      }
    }

    // Build CLI arguments
    const args = ['generate', 'create', model, '--prompt', prompt];

    if (aspectRatio) {
      args.push('--aspect-ratio', aspectRatio);
    }

    for (const imgPath of imagePaths) {
      args.push('--image-references', imgPath);
    }

    args.push('--wait', '--json');

    // Run CLI
    const result = await new Promise((resolve, reject) => {
      execFile(CLI_PATH, args, { timeout: CLI_TIMEOUT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') {
            reject(new Error('Higgsfield CLI not found. Install with: npm i -g @higgsfield/cli'));
          } else if (err.killed) {
            reject(new Error('Generation timed out after 3 minutes.'));
          } else if (stderr && (stderr.includes('not authenticated') || stderr.includes('auth'))) {
            reject(new Error('Higgsfield CLI not authenticated. Run: higgsfield auth login'));
          } else if (stderr && stderr.includes('workspace')) {
            reject(new Error('No Higgsfield workspace set. Run: higgsfield workspace set <id>'));
          } else {
            reject(new Error(stderr || err.message));
          }
          return;
        }
        resolve(stdout);
      });
    });

    // Parse CLI JSON output (array format)
    const parsed = JSON.parse(result);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;

    if (!entry || !entry.result_url) {
      return NextResponse.json(
        { error: 'Generation completed but no result URL was returned.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      imageUrl: entry.result_url,
      thumbnailUrl: entry.min_result_url ?? entry.result_url,
    });
  } catch (err) {
    console.error('[/api/generate]', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  } finally {
    activeGenerations--;
    if (tempDir) {
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
