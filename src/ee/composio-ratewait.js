// Automatic waiting for rate limited READS of connected apps (Composio). An app's own limit (e.g. Reddit's 100 queries a minute per OAuth client,
// shared by every Composio customer) answers HTTP 429. A read that comes back 429 is tried again after a wait that respects the limit: the
// app's Retry-After / X-Ratelimit-Reset when Composio passes one, else 20 s, 60 s, then 120 s. Total waiting stays under WAIT.budgetMs.
// Writes are never retried here. Reads of one batch are retried one after another, never in parallel.
export const WAIT = {
  schedule: [20e3, 60e3, 120e3], budgetMs: 230e3,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
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
const secs = (ms) => { const s = Math.round(ms / 1000); return s >= 120 && s % 60 === 0 ? `${s / 60} minutes` : `${s} seconds`; };

// run() is one attempt (it throws on a rate limit). first: an error the caller already got from an attempt it ran itself (a batch's parallel
// first round). budget: { waited, tries } shared by every read of one batch. → run()'s value, or throws the error (with how long 1Helm waited).
export async function retryRead(run, { ctx = {}, app = "", budget = { waited: 0, tries: 0 }, first = null } = {}) {
  let err = first, attempt = 0;
  for (;;) {
    if (!err) { try { return await run(); } catch (e) { err = e; } }
    if (!isRateLimited(err)) throw err;
    const asked = Number.isFinite(err.retryAfterMs) ? err.retryAfterMs + 1000 : null;
    const w = asked ?? WAIT.schedule[attempt];
    if (w == null || budget.waited + w > WAIT.budgetMs) {
      if (budget.tries > 0 && !err.waitedNote) { err.message = `${err.message} 1Helm already waited ${secs(budget.waited)} and tried ${budget.tries + 1} times in total before giving up.`; err.waitedNote = true; }
      throw err;
    }
    const name = ctx.appName || (ctx.app ? String(ctx.app) : "") || app || "The app";
    try { ctx.onWait?.(`${name} is limiting requests; trying again in ${Math.round(w / 1000)} s`); } catch {}
    await WAIT.sleep(w); budget.waited += w; budget.tries++; attempt++; err = null;
  }
}
