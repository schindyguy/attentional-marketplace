// Proxies avatar requests to unavatar.io. Keeps the API key server-side
// and lets us cache responses at the Cloudflare edge so we don't burn
// the unavatar quota on repeat views.
//
// GET /api/avatar/ig/:handle   → instagram.com/<handle> avatar
// GET /api/avatar/fb/:slug     → facebook.com/<slug> avatar (fallback)

export async function handleAvatar(request, env, url) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const parts = url.pathname.split('/').filter(Boolean);
  // ['api', 'avatar', 'ig', 'thedodo']
  const platform = parts[2];
  const handle   = decodeURIComponent(parts.slice(3).join('/') || '').replace(/^@/, '').trim();

  const provider = platform === 'ig' || platform === 'instagram' ? 'instagram'
                 : platform === 'fb' || platform === 'facebook'  ? 'facebook'
                 : null;

  if (!provider || !handle) {
    return new Response('Bad request', { status: 400 });
  }

  // Edge cache lookup
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const headers = {};
  if (env.UNAVATAR_API_KEY) {
    headers['x-api-key'] = env.UNAVATAR_API_KEY;
  }

  const upstream = `https://unavatar.io/${provider}/${encodeURIComponent(handle)}?fallback=false`;
  let upstreamResp;
  try {
    upstreamResp = await fetch(upstream, { headers });
  } catch (e) {
    return new Response('Upstream error', { status: 502 });
  }

  if (!upstreamResp.ok) {
    return new Response('Avatar not found', { status: 404 });
  }

  // Buffer the body so we can size-check before serving. Unavatar serves
  // Instagram's generic 150x150 logo placeholder (~1.5–2 KB) when it can't
  // actually scrape the profile pic. Real IG profile images are always
  // much larger, so anything under 3 KB on IG is the placeholder — return
  // 404 so the frontend falls back to initials.
  const bodyBuf = await upstreamResp.arrayBuffer();
  if (provider === 'instagram' && bodyBuf.byteLength < 3000) {
    const r = new Response('Avatar not found', { status: 404 });
    cache.put(request, r.clone()).catch(() => {});
    return r;
  }

  const resp = new Response(bodyBuf, {
    status: 200,
    headers: {
      'Content-Type':  upstreamResp.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'Access-Control-Allow-Origin': '*',
    },
  });

  cache.put(request, resp.clone()).catch(() => {});

  return resp;
}
