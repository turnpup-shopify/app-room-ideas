import { NextResponse } from 'next/server';
import { disconnect } from '../../../../lib/pinterest.js';

export async function POST() {
  try {
    disconnect();
    return NextResponse.json({ disconnected: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
