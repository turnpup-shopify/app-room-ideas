import { NextResponse } from 'next/server';
import { getAuthUrl } from '../../../../lib/pinterest.js';

export async function GET(request) {
  try {
    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/pinterest/callback`;
    const authUrl = getAuthUrl(redirectUri);
    return NextResponse.json({ authUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
