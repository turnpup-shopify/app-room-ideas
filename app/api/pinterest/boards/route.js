import { NextResponse } from 'next/server';
import { listBoards } from '../../../../lib/pinterest.js';

export async function GET() {
  try {
    const boards = await listBoards();
    return NextResponse.json(boards);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
