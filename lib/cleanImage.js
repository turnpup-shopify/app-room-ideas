import { spawn } from 'child_process';

// Same ImageMagick pass as ~/scripts/clean-images.command:
//   magick in -strip -auto-orient -colorspace sRGB out.jpg
// Re-encoding drops EXIF, XMP, IPTC, comments, and embedded provenance (C2PA) segments.
// It cannot remove watermarks baked into the pixels themselves.
const MAGICK = process.env.MAGICK_PATH || '/opt/homebrew/bin/magick';
const JPEG_QUALITY = '92';
const TIMEOUT_MS = 60 * 1000;

/**
 * Strip all metadata from an image buffer. Returns a clean sRGB JPEG.
 * @param {Buffer} input
 * @returns {Promise<Buffer>}
 */
export function cleanImageBuffer(input) {
  return runMagick(input, ['-', '-strip', '-auto-orient', '-colorspace', 'sRGB', '-quality', JPEG_QUALITY, 'jpg:-']);
}

/**
 * Shrink an image to fit within `max` px on its longest side (never enlarges). Returns a JPEG.
 * Used to send renders to Claude without hitting its image size limit.
 * @param {Buffer} input
 * @param {number} [max]
 * @returns {Promise<Buffer>}
 */
export function resizeImageBuffer(input, max = 1024) {
  return runMagick(input, ['-', '-resize', `${max}x${max}>`, '-quality', '85', 'jpg:-']);
}

function runMagick(input, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(MAGICK, args);
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Image cleaning timed out'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new Error(`ImageMagick not found at ${MAGICK}. Install with: brew install imagemagick`)
        : err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (code !== 0 || out.length === 0) return reject(new Error(`ImageMagick failed (${code}): ${stderr.trim() || 'no output'}`));
      resolve(out);
    });

    proc.stdin.on('error', () => {}); // surfaced via 'close' instead
    proc.stdin.end(input);
  });
}

/**
 * Download an image and return a metadata-free JPEG.
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, contentType: 'image/jpeg', ext: 'jpg' }>}
 */
export async function fetchCleanImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = await cleanImageBuffer(Buffer.from(await res.arrayBuffer()));
  return { buffer, contentType: 'image/jpeg', ext: 'jpg' };
}
