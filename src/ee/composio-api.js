// The one door to Composio's REST API (10-06, composio-upgrade stage 1). Every Composio HTTP request in 1Helm goes through
// composioRequest(): REST v3.1 with the project's SCOPED project API key (env.COMPOSIO_KEY, header x-api-key; set as a Worker secret,
// never in git, tests, logs or output). Sessions (stage 2) and rate limits / retries (stage 6, below) go here, in one place, and a
// managed/self-managed "transport" (part 2) wraps the functions in composio.js that call it.
// Hard rule: the server never reads Composio logs or usage. The dev key has Observability = No access, and this door refuses those
// routes before sending anything (test/composio-key.test.mjs also greps src/ for them).
export const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";
const FORBIDDEN = /^\/(?:logs(?:\/|\?|$)|project\/usage|org\/[^?]*usage)/i;

// ---- Which Composio toolkit version (10-06) ----
// Unset COMPOSIO_TOOLKIT_VERSION (prod today): Composio's pinned version "00000000_00" for every toolkit. On v3 that was the default when
// no version was sent; v3.1 defaults the version-taking tool endpoints (GET /tools, GET /tools/{slug}, POST /tools/execute/{slug}) to
// "latest", so the pinned version is now sent explicitly. On it ~200 apps have NO actions (78 of the top 400: Square, Wix, Zoho Books,
// Basecamp, Twitch…) and the big ones are years behind (Gmail 23 actions, Outlook 43, Stripe 33).
// COMPOSIO_TOOLKIT_VERSION="latest" (dev): every toolkit's newest version, everywhere the helper meets one: app_actions lists it, app_run
// runs exactly the version it listed (the tool's own version id, so the inputs it showed are the inputs that run), the app page counts it,
// and the catalog (app-static/integrations-latest.json) marks Soon from it.
// Connections don't depend on it: a connected account belongs to an auth config, not to a tool version.
export const PINNED_VERSION = "00000000_00";
export const latestVersion = (env) => env?.COMPOSIO_TOOLKIT_VERSION === "latest";
export const toolVersion = (env) => (latestVersion(env) ? "latest" : PINNED_VERSION);   // for POST /tools/execute (body `version`)
export const versionQuery = (env, first = false) => `${first ? "?" : "&"}toolkit_versions=${toolVersion(env)}`;   // for GET /tools, /tools/{slug}

// ---- Rate limits and retries (10-07, composio-upgrade stage 6) ----
// Composio limits requests per organization over a fixed one-minute window (every endpoint shares it) and says so on every response:
// X-RateLimit (the window's total), X-RateLimit-Remaining, X-RateLimit-Window-Size ("60s"), X-RateLimit-Reset when sent, and Retry-After
// on a 429. The rules, here for REST (composioRequest) and in composio-self.js for the Self-managed MCP client:
//   - a READ (GET, or a call the caller marked retry: "read": session search / create / update, multi-execute of reads, a read action, a
//     proxy GET, the file-staging request) is retried on 429, 408, 5xx, a timeout or a dropped connection;
//   - a WRITE (every other non-GET: an action that changes something, a proxy POST/PUT/PATCH/DELETE, deleting a connected account, making a
//     trigger…) is retried only on Composio's OWN 429 ("Rate limit exceeded"), which comes back before anything runs. A timeout, a dropped
//     connection or a 5xx after the request went out means it may or may not have happened, and it is never sent again: the helper gets
//     UNKNOWN_LINE (check first, then tell the person). Composio itself never deduplicates executions (docs: production-readiness).
//   - at most RETRY.max retries, at most RETRY.budgetMs of waiting in all (a Retry-After longer than what's left isn't waited for), jitter
//     on every wait; a timeout is retried once at most (each one already cost 30 s).
//   - when X-RateLimit-Remaining runs low the next requests are spaced out until the window resets (pace()); all of it is logged as
//     "composio rate limit …" lines with the method and route only (no key, no query string, no body).
export const RETRY = { max: 2, budgetMs: 8000, baseMs: 400, jitterMs: 300, paceMaxMs: 1500, lowFrac: 0.03, lowMin: 10,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: () => Math.random(), log: (...a) => console.log(...a) };
export const UNKNOWN_OUTCOME = "composio_unknown_outcome";
export const UNKNOWN_LINE = "MAY OR MAY NOT HAVE HAPPENED";
export const isUnknownOutcome = (e) => e?.code === UNKNOWN_OUTCOME;
// A write whose outcome is unknown: the plain line the helper gets (runAppTool / runProxy prefix "error: " and keep 300 chars).
export function unknownOutcome(why) {
  return Object.assign(new Error(`${UNKNOWN_LINE}: ${String(why || "no answer").slice(0, 70)} after the request went out, so this may or may not have happened. Don't run it again: check in the app first (e.g. look for the message or item), then tell the person.`), { code: UNKNOWN_OUTCOME, unknownOutcome: true });
}
export const BUSY_LINE = "Composio is busy right now (too many requests), so this didn't run. Try again in a minute.";
export const rateLimited = () => Object.assign(new Error(BUSY_LINE), { rateLimited: true });   // nothing ran; callers don't fall back to another route (it shares the limit)
const route = (method, path) => `${method} ${String(path || "").split("?")[0].replace(/\/(trs|ca|ti|ac)_[\w-]+/g, "/$1_…").slice(0, 80)}`;
export const rateLog = (what, method, path, extra = "") => RETRY.log(`composio rate limit: ${what} on ${route(method, path)}${extra ? ` (${extra})` : ""}`);

// Retry-After: seconds or an HTTP date → ms (null when absent or odd).
export function retryAfterMs(h, now = Date.now()) {
  const v = String(h?.get?.("retry-after") ?? "").trim(); if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const t = Date.parse(v); return Number.isFinite(t) ? Math.max(0, t - now) : null;
}
// How long to wait before retry number `attempt` (0-based), or -1 when the budget won't stretch to it.
export function nextWait(attempt, waited, retryAfter) {
  if (attempt >= RETRY.max) return -1;
  const ms = Math.round((retryAfter != null ? retryAfter : RETRY.baseMs * 2 ** attempt) + RETRY.random() * RETRY.jitterMs);
  return waited + ms > RETRY.budgetMs ? -1 : ms;
}
// What the rate-limit headers said last, per Composio organization (one for 1Helm's project, one per Self-managed person), this isolate.
export class RateGauge {
  constructor() { this.remaining = null; this.limit = null; this.resetAt = 0; this.warned = 0; }
  note(h, now = Date.now()) {
    const num = (k) => { const v = h?.get?.(k); return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v); };
    const rem = num("x-ratelimit-remaining"); if (rem == null) return;
    this.remaining = rem; this.limit = num("x-ratelimit") ?? num("x-ratelimit-limit") ?? this.limit;
    const reset = num("x-ratelimit-reset"), win = String(h.get("x-ratelimit-window-size") || "60s").match(/^(\d+)\s*(ms|s|m)?$/i);
    const winMs = win ? Number(win[1]) * ({ ms: 1, s: 1000, m: 60000 }[(win[2] || "s").toLowerCase()]) : 60000;
    // Reset: an epoch (seconds or ms) or seconds from now; without one, the latest the fixed window can end.
    const ra = retryAfterMs(h, now);   // on a 429: exactly when the window resets
    this.resetAt = ra != null ? now + ra : reset == null ? (this.resetAt > now ? this.resetAt : now + winMs) : reset > 1e12 ? reset : reset > 1e9 ? reset * 1000 : now + reset * 1000;
  }
  waited() { this.remaining = null; }   // just waited out a 429: the retry isn't held again by pace()
  low() { return this.remaining != null && this.remaining <= Math.max(RETRY.lowMin, Math.ceil((this.limit || 0) * RETRY.lowFrac)); }
  // Before a request: when the window is nearly used up, space requests out over what's left of it (bounded per request).
  async pace(method, path, now = Date.now()) {
    if (!this.low()) return 0;
    if (this.resetAt <= now) { this.remaining = null; return 0; }
    const left = this.resetAt - now, ms = Math.min(RETRY.paceMaxMs, this.remaining <= 0 ? left : Math.ceil(left / (this.remaining + 1)));
    if (now - this.warned > 10000) { this.warned = now; rateLog(`low (${this.remaining}${this.limit ? ` of ${this.limit}` : ""} left), slowing down`, method, path, `${ms} ms between requests`); }
    if (this.remaining > 0) this.remaining--;
    await RETRY.sleep(ms); return ms;
  }
}
export const GAUGE = new RateGauge();   // 1Helm's own Composio project (Managed)
// Composio's own org limit (as opposed to an app's): its message, or its headers saying the window is spent.
const ownLimit = (d, h) => /rate limit exceeded/i.test(String(d?.message || d?.error?.message || "")) || String(h?.get?.("x-ratelimit-remaining") ?? "") === "0";
const timedOut = (e) => /timeout|timed out|aborted/i.test(`${e?.name} ${e?.message}`);

// path: relative to the v3.1 base, e.g. "/connected_accounts?user_ids=…". Returns the parsed JSON; throws Error(message) on a non-2xx.
// init.retry: "read" | "write" (default: GET/HEAD read, anything else write); see the rules above.
export async function composioRequest(env, path, init = {}) {
  if (!env?.COMPOSIO_KEY) throw new Error("Connections aren't set up on this server yet.");
  path = String(path || "");
  if (!path.startsWith("/") || path.startsWith("/api/")) throw new Error(`bad Composio path ${path.slice(0, 80)}`);
  if (FORBIDDEN.test(path)) throw new Error("1Helm never reads Composio logs or usage.");
  const { retry, ...rest } = init, method = String(rest.method || "GET").toUpperCase();
  const read = retry ? retry === "read" : method === "GET" || method === "HEAD";
  let waited = 0, timeouts = 0;
  for (let attempt = 0; ; attempt++) {
    await GAUGE.pace(method, path);
    let r;
    try { r = await fetch(`${COMPOSIO_BASE}${path}`, { ...rest, headers: { "x-api-key": env.COMPOSIO_KEY, "content-type": "application/json", accept: "application/json" }, signal: AbortSignal.timeout(30000) }); }
    catch (e) {
      const to = timedOut(e), why = to ? "Composio didn't answer in time" : "the connection to Composio dropped";
      if (!read) { rateLog(`write not retried (${to ? "timeout" : "connection dropped"})`, method, path); throw unknownOutcome(why); }
      const ms = to && timeouts++ ? -1 : nextWait(attempt, waited, null);
      if (ms < 0) throw new Error(`${why}. Try again in a minute.`);
      waited += ms; await RETRY.sleep(ms); continue;
    }
    GAUGE.note(r.headers);
    const d = await r.json().catch(() => ({}));
    if (r.ok) return d;
    if (r.status === 429) {
      const ra = retryAfterMs(r.headers), ms = read || ownLimit(d, r.headers) ? nextWait(attempt, waited, ra) : -1;
      if (ms >= 0) { rateLog(`429, retry ${attempt + 1} of ${RETRY.max}`, method, path, `waiting ${ms} ms${ra != null ? `, Retry-After ${Math.round(ra / 1000)} s` : ""}`); waited += ms; await RETRY.sleep(ms); GAUGE.waited(); continue; }
      rateLog(read || ownLimit(d, r.headers) ? "429, gave up" : "429 from the app on a write, not retried", method, path, ra != null ? `Retry-After ${Math.round(ra / 1000)} s` : "");
      throw rateLimited();
    }
    if (r.status >= 500 || r.status === 408) {
      if (!read) { rateLog(`write not retried (HTTP ${r.status})`, method, path); const m = d?.error?.message || d?.message; throw unknownOutcome(`Composio answered HTTP ${r.status}${m ? ` (${errorText(env, r.status, d).slice(0, 40)})` : ""}`); }
      const ms = nextWait(attempt, waited, retryAfterMs(r.headers));
      if (ms >= 0) { waited += ms; await RETRY.sleep(ms); continue; }
    }
    throw new Error(errorText(env, r.status, d));
  }
}
// What a Composio error says, safe to hand to the helper or a log: Composio echoes a masked key on a bad one ("Invalid API key: ak_**_xyz"),
// so a 401 gets a fixed message and anything key-shaped is cut from the rest.
function errorText(env, status, d) {
  if (status === 401) return "Composio didn't accept this server's key (HTTP 401).";
  const m = String(d?.error?.message || d?.message || `Composio HTTP ${status}`);
  return m.split(env.COMPOSIO_KEY).join("[key]").replace(/\b(ak|sk|pk)_[A-Za-z0-9*_.-]{2,}/g, "[key]").slice(0, 300);
}
