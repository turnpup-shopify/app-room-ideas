import { NextResponse } from 'next/server';
import { isConnected, validateToken } from '../../../../lib/pinterest.js';

export async function GET(request) {
  const hasCredentials = !!(process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET);
  const connected = isConnected();

  // If a token file exists, optionally validate it against the API
  const url = new URL(request.url);
  const shouldValidate = url.searchParams.get('validate') === '1';

  if (connected && shouldValidate) {
    const validation = await validateToken();
    return NextResponse.json({
      connected,
      hasCredentials,
      valid: validation.valid,
      username: validation.username || null,
      reason: validation.reason || null,
      apiHost: validation.apiHost || null,
      scopes: validation.scopes || null,
      canWrite: validation.canWrite ?? null,
    });
  }

  return NextResponse.json({ connected, hasCredentials });
}
