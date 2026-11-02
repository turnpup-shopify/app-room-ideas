import { NextResponse } from 'next/server';
import { updateSavedPin, deleteSavedPin } from '../../../../../lib/pinQueue.js';

/** PATCH /api/pinterest/saved/:id — update the saved copy */
export async function PATCH(request, { params }) {
  const { id } = await params;
  const entry = updateSavedPin(id, await request.json());
  if (!entry) return NextResponse.json({ error: 'Saved pin not found' }, { status: 404 });
  return NextResponse.json(entry);
}

/** DELETE /api/pinterest/saved/:id — remove the pin and its image */
export async function DELETE(request, { params }) {
  const { id } = await params;
  deleteSavedPin(id);
  return NextResponse.json({ ok: true });
}
