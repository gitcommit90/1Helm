// Short, host-only HSTS rollout: reversible without affecting sibling sites.
export const HSTS = 'max-age=300';

export function httpsOrigin(input) {
  const url = new URL(input);
  url.protocol = 'https:';
  return url.origin;
}

export function transportGate(req) {
  const url = new URL(req.url);
  if (url.protocol === 'https:') return null;
  url.protocol = 'https:';
  if (req.method === 'GET' || req.method === 'HEAD')
    return new Response(null, { status: 307, headers: { location: url.href, 'cache-control': 'no-store' } });
  // Never process credentials or replay a write submitted over plaintext HTTP.
  return new Response(JSON.stringify({ error: 'Use HTTPS to connect to 1Helm.' }), {
    status: 426, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function transportHeaders(req, res) {
  if (new URL(req.url).protocol !== 'https:' || res.status === 101) return res;
  const headers = new Headers(res.headers);
  headers.set('strict-transport-security', HSTS);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
