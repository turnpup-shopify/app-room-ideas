import { NextResponse } from 'next/server';
import { saveManualToken, validateToken } from '../../../../lib/pinterest.js';

export async function POST(request) {
  try {
    const { accessToken } = await request.json();
    if (!accessToken || !accessToken.trim()) {
      return NextResponse.json({ error: 'accessToken is required' }, { status: 400 });
    }

    saveManualToken(accessToken.trim());

    // Validate immediately so the user knows if it works
    const validation = await validateToken();
    if (!validation.valid) {
      return NextResponse.json({
        saved: true,
        valid: false,
        reason: validation.reason,
      });
    }

    return NextResponse.json({
      saved: true,
      valid: true,
      username: validation.username || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
