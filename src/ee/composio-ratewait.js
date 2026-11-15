// Rate limited READS of connected apps (Composio). An app's own limit (e.g. Reddit's 100 queries a minute per OAuth client,
// shared by every Composio customer) answers HTTP 429. It is reported at once, never waited for.
const RATE_TEXT = /\bHTTP 429\b|\b429 Client Error\b|rate limited this request|too many requests/i;
export const isRateLimited = (e) => !!e && (e.rateLimited === true || Number(e.status) === 429 || RATE_TEXT.test(String(e.message ?? e)));

// Retry-After (seconds or an HTTP date) or X-Ratelimit-Reset (seconds until the window resets) from any headers object Composio passed, else null.
export function retryAfterMs(...sources) {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const holder of [src, src.headers, src.response_headers, src.http_headers, src.data?.headers, src.data?.response_headers]) {
      if (!holder || typeof holder !== "object") continue;
      const get = (name) => { const k = Object.keys(holder).find((x) => x.toLowerCase() === name); return k ? holder[k] : undefined; };
      const ra = get("retry-after"), rs = get("x-ratelimit-reset");
      for (const v of [ra, rs]) {
        if (v == null || v === "") continue;
        const n = Number(Array.isArray(v) ? v[0] : v);
        if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
        const t = Date.parse(String(v)); if (Number.isFinite(t)) return Math.max(0, t - Date.now());
      }
    }
  }
  return null;
}
export const rateLimitedError = (message, retryAfter = null) => Object.assign(new Error(message), { rateLimited: true, retryAfterMs: retryAfter });

// run() is one attempt (it throws on a rate limit). first: an error the caller already got from an attempt it ran itself.
// A rate limit is reported at once, with a plain message: 1Helm's Composio project is shared, and waiting for its limit does not succeed (each wait is about 215 s).
export async function retryRead(run, { first = null } = {}) {
  let err = first;
  if (!err) { try { return await run(); } catch (e) { err = e; } }
  if (isRateLimited(err) && !err.waitedNote) { err.message = `${err.message} The app's limit is shared with other 1Helm workspaces, so 1Helm does not wait for it. Try again in a few minutes.`; err.waitedNote = true; }
  throw err;
}
