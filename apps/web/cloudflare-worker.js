const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (shouldProxyToApi(url.pathname)) {
      return proxyToApi(request, env.API_ORIGIN);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, isHtml(response));
  },
};

function shouldProxyToApi(pathname) {
  return pathname.startsWith('/api/') || pathname === '/docs' || pathname.startsWith('/docs/');
}

async function proxyToApi(request, apiOrigin) {
  if (!apiOrigin) {
    return jsonError('Cloudflare API_ORIGIN is not configured.', 502);
  }

  let origin;
  try {
    origin = new URL(apiOrigin);
  } catch {
    return jsonError('Cloudflare API_ORIGIN is not a valid URL.', 502);
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
  const headers = new Headers(request.headers);
  headers.set('X-Forwarded-Host', incomingUrl.host);
  headers.set('X-Forwarded-Proto', incomingUrl.protocol.replace(':', ''));
  headers.set('X-Forwarded-Origin', incomingUrl.origin);

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  const response = await fetch(targetUrl, init);
  return withSecurityHeaders(response, false);
}

function withSecurityHeaders(response, noStore) {
  const secured = new Response(response.body, response);
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(header, value);
  }
  if (noStore) secured.headers.set('Cache-Control', 'no-store');
  return secured;
}

function isHtml(response) {
  return response.headers.get('Content-Type')?.includes('text/html') ?? false;
}

function jsonError(message, status) {
  return withSecurityHeaders(
    Response.json({ error: { code: 'CLOUDFLARE_CONFIGURATION', message } }, { status }),
    false,
  );
}
