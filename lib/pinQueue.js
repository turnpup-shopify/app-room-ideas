import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fetchCleanImage } from './cleanImage.js';

// Pins saved to post later. Images are downloaded locally because Higgsfield CDN URLs aren't permanent.
const QUEUE_FILE = join(process.cwd(), 'pinterest-saved.json');
const IMAGE_DIR = join(process.cwd(), 'saved-pins');
const EDITABLE = ['title', 'body', 'hashtags', 'topics', 'pattern', 'altText', 'link', 'boardId', 'tagProducts'];

function readQueue() {
  if (!existsSync(QUEUE_FILE)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeQueue(items) {
  writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2));
}

function imagePath(id) {
  return join(IMAGE_DIR, `${id}.jpg`);
}

export function listSavedPins() {
  return readQueue().sort((a, b) => b.savedAt - a.savedAt);
}

export function getSavedPin(id) {
  return readQueue().find((p) => p.id === id) || null;
}

/**
 * Save a pin for later: downloads the image and stores the copy.
 * @param {{ imageUrl: string, roomName?: string, title, body, hashtags, altText, link, boardId, tagProducts?: Array<{ id, title }> }} pin
 */
export async function savePin(pin) {
  if (!pin.imageUrl) throw new Error('imageUrl is required');
  // Stored already cleaned, so the later post sends a metadata-free image
  const { buffer } = await fetchCleanImage(pin.imageUrl);
  const id = randomUUID();
  mkdirSync(IMAGE_DIR, { recursive: true });
  await writeFile(imagePath(id), buffer);

  const entry = {
    id,
    roomName: pin.roomName || '',
    sourceImageUrl: pin.imageUrl,
    ...Object.fromEntries(EDITABLE.map((k) => [k, pin[k] ?? (k === 'tagProducts' ? [] : '')])),
    savedAt: Date.now(),
  };
  writeQueue([...readQueue(), entry]);
  return entry;
}

export function updateSavedPin(id, fields) {
  const items = readQueue();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  for (const k of EDITABLE) if (k in fields) items[idx][k] = fields[k] ?? (k === 'tagProducts' ? [] : '');
  items[idx].updatedAt = Date.now();
  writeQueue(items);
  return items[idx];
}

export function deleteSavedPin(id) {
  writeQueue(readQueue().filter((p) => p.id !== id));
  if (existsSync(imagePath(id))) unlinkSync(imagePath(id));
}

export async function readSavedPinImage(id) {
  return readFile(imagePath(id));
}
