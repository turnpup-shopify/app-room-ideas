import { exchangeCode } from '../../../../lib/pinterest.js';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    const error = url.searchParams.get('error') || 'No authorization code received';
    return new Response(errorPage(error), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  try {
    const origin = url.origin;
    const redirectUri = `${origin}/api/pinterest/callback`;
    await exchangeCode(code, redirectUri);

    return new Response(successPage(origin), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err) {
    return new Response(errorPage(err.message), {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

function successPage(origin) {
  return `<!DOCTYPE html>
<html>
<head><title>Pinterest Connected</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafaf9;">
  <div style="text-align: center; max-width: 400px; padding: 2rem;">
    <div style="font-size: 3rem; margin-bottom: 1rem;">&#10003;</div>
    <h1 style="font-size: 1.25rem; color: #1c1917; margin-bottom: 0.5rem;">Pinterest Connected</h1>
    <p style="color: #78716c; font-size: 0.875rem;">You can close this tab and return to the app.</p>
    <script>setTimeout(() => window.location.href = '${origin}', 2000);</script>
  </div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html>
<head><title>Pinterest Connection Failed</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafaf9;">
  <div style="text-align: center; max-width: 400px; padding: 2rem;">
    <div style="font-size: 3rem; margin-bottom: 1rem;">&#10007;</div>
    <h1 style="font-size: 1.25rem; color: #1c1917; margin-bottom: 0.5rem;">Connection Failed</h1>
    <p style="color: #78716c; font-size: 0.875rem;">${message}</p>
  </div>
</body>
</html>`;
}
