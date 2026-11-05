// Plan usage bars under each connected AI service in Settings, AI services (task usage-bars, 2026-11-03).
// What the page shows for a service: up to two windows (a session window of about 5 hours and a weekly window), each with the percent used and when it resets, or, when no numbers
// can be read, a "Manage usage" link to the service's own usage page. Nothing here changes how a model call is sent.
//
// Sources, tried in this order per service (each is read only; no model call, and no token is logged or returned):
//   ChatGPT      no source here. OpenAI's Sign in with ChatGPT guidelines say not to use ChatGPT backend-api endpoints for this flow, so the page shows a summary counted from the
//                token usage of each completed Responses call (byok-chatgpt.js recordChatgptUse and chatgptUseSummary) and a "Manage usage" link.
//   Claude Code  the rate limit headers Anthropic sends on every model call, kept by the engine (claude-engine.js), else GET https://api.anthropic.com/api/oauth/usage run INSIDE the
//                engine's container with the CLI's own token (src/ee/claude-engine/relay/usage.mjs), else the link.
//   OpenCode     no usage endpoint is documented for a personal API key (opencode.ai/v2/docs/console/api), so it is the link.
// A failed source is remembered (a permanent refusal 6 hours, a network or server error 2 minutes), so a page view never retries it, and the link shows meanwhile.
//
// The parser for the Claude usage answer is ported from rerouted (https://github.com/gitcommit90/rerouted, src/lib/quota.js, MIT), the Captain's own app.
// No imports: this file is used by the Worker, by the engine object and by tests.

export const USAGE_MANAGE = {
  chatgpt: "https://chatgpt.com/settings/usage",
  claudecode: "https://claude.ai/settings/usage",
  opencode: "https://opencode.ai/console",
};
export const USAGE_NAME = { chatgpt: "ChatGPT", claudecode: "Claude Code", opencode: "OpenCode" };
export const USAGE_KINDS = ["chatgpt", "claudecode", "opencode"];
export const USAGE_TTL_MS = 5 * 60e3;          // numbers newer than this are shown from the cache
export const FAIL_PERMANENT_MS = 6 * 3600e3;   // 401, 403, 404 or an answer with no windows
export const FAIL_TRANSIENT_MS = 2 * 60e3;     // network error, timeout, 5xx or 429
const LIMIT_SHOW_MS = 6 * 3600e3;              // a limit message stays when its reset time is unknown

export const USAGE_DDL = "CREATE TABLE IF NOT EXISTS byok_usage (tenant_id TEXT NOT NULL, service TEXT NOT NULL, state_json TEXT NOT NULL DEFAULT '', fetched_at INTEGER NOT NULL DEFAULT 0, fail_at INTEGER NOT NULL DEFAULT 0, fail_why TEXT NOT NULL DEFAULT '', limit_json TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, service))";
let ddlDone = null;
export async function usageDdl(env) { if (ddlDone === env.DB) return; await env.DB.prepare(USAGE_DDL).run(); ddlDone = env.DB; }
export const _resetUsageDdl = () => { ddlDone = null; };

// ---- parsing ----
const clampPercent = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; };
export function epochMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string" && !/^\d+(?:\.\d+)?$/.test(v.trim())) { const p = Date.parse(v); return Number.isFinite(p) ? p : null; }
  const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e10 ? n * 1000 : n;
}
function windowOf(id, used, resetsAt, seconds) {
  const u = clampPercent(used); if (u == null) return null;
  const fiveHours = id === "session" && (!seconds || (Number(seconds) >= 17000 && Number(seconds) <= 19000));
  return { id, label: id === "weekly" ? "This week" : fiveHours ? "5 hours" : "Session", used: Math.round(u * 10) / 10, resets_at: epochMs(resetsAt) };
}
// Claude: { five_hour: { utilization, resets_at }, seven_day: { ... } } (utilization is a percent)
export function parseClaudeUsage(data) {
  const windows = [], f = data?.five_hour, w = data?.seven_day || data?.seven_day_oauth_apps;
  const a = windowOf("session", f?.utilization, f?.resets_at, 18000), b = windowOf("weekly", w?.utilization, w?.resets_at, null);
  if (a) windows.push(a); if (b) windows.push(b);
  return { plan: typeof data?.subscription_type === "string" ? data.subscription_type.slice(0, 40) : "", windows };
}
// The response headers the Claude relay keeps (anthropic-ratelimit-*; lower case names). Claude Code reads the same unified headers for its status line:
//   anthropic-ratelimit-unified-5h-utilization / -5h-reset and -7d-utilization / -7d-reset (a fraction from 0 to 1, and epoch seconds), -status (allowed, rejected), -reset, -representative-claim.
export function parseClaudeHeaders(h) {
  const get = (k) => (h && typeof h === "object" ? h[`anthropic-ratelimit-unified-${k}`] : undefined), windows = [];
  for (const [id, ab] of [["session", "5h"], ["weekly", "7d"]]) {
    const u = get(`${ab}-utilization`); if (u == null || u === "" || !Number.isFinite(Number(u))) continue;
    const n = Number(u), w = windowOf(id, n > 1 ? n : n * 100, get(`${ab}-reset`), id === "session" ? 18000 : null);
    if (w) windows.push(w);
  }
  return { windows, status: String(get("status") || "").slice(0, 40), claim: String(get("representative-claim") || "").slice(0, 40), reset: epochMs(get("reset")) };
}
// ---- time words ----
export function resetIn(ms, now = Date.now()) {
  const left = Number(ms) - now; if (!Number.isFinite(left) || left <= 0) return "";
  const m = Math.max(1, Math.round(left / 60e3));
  if (m < 60) return `in ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `in ${h} hour${h === 1 ? "" : "s"} ${r} minutes` : `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(left / 86400e3);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

// ---- the cache ----
async function rowOf(env, tid, service) { await usageDdl(env); return (await env.DB.prepare("SELECT state_json, fetched_at, fail_at, fail_why, limit_json FROM byok_usage WHERE tenant_id=? AND service=?").bind(String(tid), service).first()) || null; }
const parse = (s) => { try { const v = s ? JSON.parse(s) : null; return v && typeof v === "object" ? v : null; } catch { return null; } };
// What the page gets for one service. A window whose reset time has passed shows 0 used with no reset time (its usage began again from nothing).
export function viewOf(service, row, now = Date.now()) {
  const st = parse(row?.state_json), lim = parse(row?.limit_json);
  const windows = (st?.windows || []).map((w) => (w.resets_at && w.resets_at <= now ? { ...w, used: 0, resets_at: null } : w));
  const limit = lim && ((lim.resets_at && lim.resets_at > now) || (!lim.resets_at && now - lim.at < LIMIT_SHOW_MS)) ? { window: lim.window || "", resets_at: lim.resets_at || null } : null;
  return { windows, at: Number(row?.fetched_at) || 0, tried: !!(Number(row?.fetched_at) || Number(row?.fail_at)), manage: USAGE_MANAGE[service] || "", limit };
}
export async function usageView(env, tid, service) { try { return viewOf(service, await rowOf(env, tid, service)); } catch { return viewOf(service, null); } }
// All cached views for an account, with no network. rows: the account's connections (only their kinds are looked up).
export async function usageCache(env, tid, kinds) {
  const out = {}; const want = [...new Set((kinds || []).filter((k) => USAGE_KINDS.includes(k)))]; if (!want.length) return out;
  try {
    await usageDdl(env);
    const r = await env.DB.prepare("SELECT service, state_json, fetched_at, fail_at, fail_why, limit_json FROM byok_usage WHERE tenant_id=?").bind(String(tid)).all();
    const by = Object.fromEntries((r?.results || []).map((x) => [x.service, x]));
    for (const k of want) out[k] = viewOf(k, by[k] || null);
  } catch (e) { console.log("byok usage: cache read", String(e?.message || e).slice(0, 80)); for (const k of want) out[k] = viewOf(k, null); }
  return out;
}
async function saveOk(env, tid, service, state, now) {
  await env.DB.prepare("INSERT INTO byok_usage (tenant_id, service, state_json, fetched_at, fail_at, fail_why, limit_json) VALUES (?,?,?,?,0,'','') ON CONFLICT(tenant_id, service) DO UPDATE SET state_json=excluded.state_json, fetched_at=excluded.fetched_at, fail_at=0, fail_why=''")
    .bind(String(tid), service, JSON.stringify(state), now).run();
}
async function saveFail(env, tid, service, why, now) {
  await env.DB.prepare("INSERT INTO byok_usage (tenant_id, service, state_json, fetched_at, fail_at, fail_why, limit_json) VALUES (?,?,'',0,?,?,'') ON CONFLICT(tenant_id, service) DO UPDATE SET fail_at=excluded.fail_at, fail_why=excluded.fail_why")
    .bind(String(tid), service, now, String(why).slice(0, 40)).run();
}
export async function dropUsage(env, tid, service = null) {
  try { await usageDdl(env); if (service) await env.DB.prepare("DELETE FROM byok_usage WHERE tenant_id=? AND service=?").bind(String(tid), service).run(); else await env.DB.prepare("DELETE FROM byok_usage WHERE tenant_id=?").bind(String(tid)).run(); } catch {}
}

// Refresh one service when its cache is stale and its last failure is old enough. getter() → { windows, plan? } or throws an Error with .why (a short word) and .permanent.
// Never throws. Returns the view. force: a limit was just hit, so read again now (a failure is still remembered).
export async function refreshUsage(env, tid, service, getter, { force = false, now = Date.now() } = {}) {
  let row = null;
  try { row = await rowOf(env, tid, service); } catch (e) { console.log("byok usage: cache read", String(e?.message || e).slice(0, 80)); return viewOf(service, null, now); }
  if (!getter) return viewOf(service, row, now);   // a service with no source: the link only
  const st = parse(row?.state_json), fresh = st && now - Number(row.fetched_at) < USAGE_TTL_MS && !(st.windows || []).some((w) => w.resets_at && w.resets_at <= now);
  const failedFor = Number(row?.fail_at) ? now - Number(row.fail_at) : Infinity, failWait = /^(http_(401|403|404)|none)$/.test(row?.fail_why || "") ? FAIL_PERMANENT_MS : FAIL_TRANSIENT_MS;
  if (!force && (fresh || failedFor < failWait)) return viewOf(service, row, now);
  try {
    const got = await getter();
    const windows = (got?.windows || []).filter((w) => w && Number.isFinite(w.used));
    if (!windows.length) throw Object.assign(new Error("no windows"), { why: "none", permanent: true });
    await saveOk(env, tid, service, { windows, plan: got.plan || "", source: got.source || "" }, now);
    console.log(`byok usage: ${service} ok${got.source ? " " + got.source : ""}`);
  } catch (e) {
    const why = String(e?.why || (e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "network")).slice(0, 40);
    try { await saveFail(env, tid, service, why, now); } catch {}
    console.log(`byok usage: ${service} failed ${why}`);
  }
  try { return viewOf(service, await rowOf(env, tid, service), now); } catch { return viewOf(service, null, now); }
}

// A usage limit was just hit on a call: remember which window and when it resets, and make the next read ignore the cache.
export async function noteLimit(env, tid, service, { window = "", resets_at = null } = {}, now = Date.now()) {
  try {
    await usageDdl(env);
    const lim = JSON.stringify({ at: now, window: window === "weekly" || window === "session" ? window : "", resets_at: epochMs(resets_at) });
    await env.DB.prepare("INSERT INTO byok_usage (tenant_id, service, state_json, fetched_at, fail_at, fail_why, limit_json) VALUES (?,?,'',0,0,'',?) ON CONFLICT(tenant_id, service) DO UPDATE SET limit_json=excluded.limit_json, fetched_at=0, fail_at=0")
      .bind(String(tid), service, lim).run();
  } catch (e) { console.log("byok usage: note limit", String(e?.message || e).slice(0, 80)); }
}
// A newer successful read ends an old limit note once its reset time has passed (viewOf already hides it); this clears it when the numbers show room again.
export function limitFromWindows(windows) {
  let top = null; for (const w of windows || []) if (w.used >= 99.5 && (!top || (w.resets_at || 0) > (top.resets_at || 0))) top = w;
  return top ? { window: top.id, resets_at: top.resets_at } : null;
}

// ---- the words for a limit ----
export function limitText(service, { window = "", resets_at = null, host = "", now = Date.now() } = {}) {
  // ChatGPT: OpenAI's wording. The limit code alone says nothing about a reset time (an app-specific limit can apply), so none is given for it.
  if (service === "chatgpt") return `Your AI service (${host || "ChatGPT"}): Usage limit reached. Review your plan or this app's limit in ChatGPT settings. [Manage usage](${USAGE_MANAGE.chatgpt})`;
  const name = USAGE_NAME[service] || "AI service", plan = service === "claudecode" ? "Claude plan" : "OpenCode Go plan";
  const which = window === "weekly" ? "weekly" : window === "session" ? "5-hour" : "";
  const when = resetIn(resets_at, now);
  return `Your AI service (${host || name}) has reached the ${which ? which + " " : ""}usage limit of your ${plan}${when ? `, and it resets ${when}` : ""}, so I couldn't finish this. [Manage usage](${USAGE_MANAGE[service]}), ${service === "opencode" ? "switch this connection to pay as you go, or choose another model" : "or choose another model"} in Settings → AI services.`;
}
