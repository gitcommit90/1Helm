// Custom MCP connections (Settings → Advanced): a person brings a public HTTPS MCP server and uses its tools through 1Helm's existing Composio
// tool path (app_actions / app_run), on 1Helm's own Composio project (the server-side COMPOSIO_KEY; the person never has a Composio account).
//
// Composio's experimental custom-toolkit API registers a project-wide CUSTOM_* toolkit per server ("shared with every user in the project"), so
// EVERYTHING per-person is 1Helm's job and lives here:
//   * ownership: one custom_mcp_server row per registration (tenant + user + opaque id + generated non-PII toolkit slug CUSTOM_<HC|HP>_<80 random bits>);
//     nothing is ever shared across people, even for identical URLs. Owner ids always come from the authenticated workspace, never the request.
//   * the switch: tenant_flags k='custom_mcp' = 'on' (off by default). Off, or a server that isn't 'connected', or one being removed, is
//     simply absent from customUsable(): that one function is what discovery, execution, sessions and the helper's apps line consult, on
//     every call, from D1 (no cache), so disable/disconnect take effect at once, in existing sessions too.
//   * secrets: API keys are write-only. They go to Composio's credential store in the one request that creates the connected account and are
//     never stored, logged, echoed or returned. OAuth is Composio-hosted DCR (authorization-code); our state is a random single-use token, stored
//     as a SHA-256 hash, bound to user + workspace + server, with a 15 minute expiry.
//   * setup is resumable and idempotent (client_request_id), persisted before each step; removal blocks use first and retries upstream deletion.
// Live status: the dev project's SCOPED key is refused by Composio for these routes (403 code 812, see availability()), so the feature reports
// available:false (reason "gated") there. The Composio calls below follow the official docs and are covered by mocks only until a full-access
// key can run them. See local validation evidence
import { composioRequest } from "./composio-api.js";
import { checkPublicUrl, dnsCheck, UrlError } from "./custom-mcp-url.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";

export const FLAG = "custom_mcp";
export const isCustomSlug = (s) => /^custom_/i.test(String(s || ""));
// What status lines and step titles call a custom server (they have no workspace data to look its name up): never its raw generated slug.
export const CUSTOM_WORDS = "your custom MCP server";
// Dev and Live share ONE Composio project, so each environment stamps its registrations with its own slug prefix (CUSTOM_HC_ dev, CUSTOM_HP_ Live,
// from the CUSTOM_MCP_SLUG_PREFIX var, default HC). The prefix exists ONLY so each sweeper can tell its own orphans from the other environment's
// live registrations. Isolation between workspaces/environments is NOT the prefix: a workspace can use a slug only if it has that slug in its own D1 rows.
const PREFIXES = ["HC", "HP"];
export const slugPrefix = (env) => { const p = String(env?.CUSTOM_MCP_SLUG_PREFIX || "HC").toUpperCase(); return PREFIXES.includes(p) ? p : "HC"; };
const ownRe = (env) => new RegExp(`^CUSTOM_${slugPrefix(env)}_[A-Z2-7]{16}$`);   // the sweeper's filter: this environment's slugs only, never the other's
const SLUG_RE = /^CUSTOM_H[CP]_[A-Z2-7]{16}$/;   // any valid generated slug (routing/validation); still only usable via the workspace's own rows
const ID_RE = /^cm_[a-z2-7]{20}$/;
export const LIMITS = { servers: 50, tools: 100, toolText: 200, syncGraceMs: 8000, syncDeadlineMs: 180000, pollMinMs: 2000, healthMs: 60000, stateTtlMs: 900000, cleanupRetryMs: 30000, lockMs: 30000, probeTtlMs: 300000 };
const uid = (tenantId) => `1hc:${tenantId}`;
const now = () => Date.now();
export class ApiError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
// Test seam: DNS answers (see custom-mcp-url.js dnsCheck).
export const hooks = { resolve: null };

const b32 = (n) => { const a = crypto.getRandomValues(new Uint8Array(n)); let s = ""; for (const x of a) s += "abcdefghijklmnopqrstuvwxyz234567"[x & 31]; return s; };
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))))].map((b) => b.toString(16).padStart(2, "0")).join("");
// Plain one-line text from a server's or person's words: control characters and bracket/quote syntax gone, short.
export const cleanText = (s, n = 60) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/[\[\]{}"`<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, n).trim();

// ---------------- Composio (experimental custom-toolkit API; always { custom: true } so composio-api.js lets it through) ----------------
const cx = (env, path, init = {}) => composioRequest(env, path, { ...init, custom: true });
// The /custom/toolkits/* lifecycle (upsert, sync, delete) needs a full-access Composio key, which Composio's scoped keys can never have. It uses the
// separate optional Worker secret COMPOSIO_CUSTOM_KEY and nothing else does; everything else (auth configs, connected accounts, tool listing,
// execution) stays on the scoped COMPOSIO_KEY. Unset = the feature is "gated". The key is never logged (composioRequest masks it in errors).
const cxAdmin = (env, path, init = {}) => {
  if (!env?.COMPOSIO_CUSTOM_KEY) throw Object.assign(new Error("This scoped API key cannot be used for custom toolkits (no COMPOSIO_CUSTOM_KEY is set)."), { httpStatus: 403 });
  return composioRequest({ ...env, COMPOSIO_KEY: env.COMPOSIO_CUSTOM_KEY }, path, { ...init, custom: true });
};
const GATED = /scoped[- ]?(?:api[- ])?key|not covered by any scoped|InsufficientPermissions/i;
const KEYLIKE = /\b(?:ak|sk|pk)_[A-Za-z0-9*_.-]{2,}/g;
// An upstream failure as { code, message } safe to store and show (no key, no credentials, short).
export function mapErr(e, secrets = []) {
  let msg = String(e?.message ?? e ?? "");
  for (const s of secrets) if (s && String(s).length > 3) msg = msg.split(String(s)).join("[hidden]");
  msg = msg.replace(KEYLIKE, "[key]").replace(/\s+/g, " ").slice(0, 200);
  if (GATED.test(msg)) return { code: "gated", message: "Custom MCP isn't turned on for 1Helm's Composio project yet.", gated: true };
  if (e?.rateLimited) return { code: "busy", message: "Composio is busy right now. Try again in a minute." };
  if (e?.unknownOutcome) return { code: "unknown_outcome", message: "Composio didn't answer in time, so it's unclear whether that finished. Check again in a moment." };
  const st = e?.httpStatus;
  if (st === 409) return { code: "conflict", message: "Composio says this registration conflicts with an existing one. Remove it and add it again." };
  if (st === 400 || st === 422) return { code: "rejected", message: `Composio couldn't use this server: ${cleanText(msg, 140)}` };
  if (st === 401 || st === 403) return { code: "upstream_denied", message: "1Helm's Composio project didn't allow that." };
  if (st === 404) return { code: "upstream_missing", message: "Composio no longer has this server." };
  return { code: "upstream_error", message: "Composio couldn't complete that. Try again in a minute." };
}
const definitive = (e) => !e?.unknownOutcome && !e?.rateLimited && e?.httpStatus >= 400 && e?.httpStatus < 500;

async function composioUpsert(env, row, scheme) {
  const d = await cxAdmin(env, "/custom/toolkits/upsert", { method: "POST", retry: "read", body: JSON.stringify({ slug: row.slug.replace(/^CUSTOM_/, ""), toolkit_config: { name: `1Helm custom MCP ${row.slug.slice(-6)}`, app_url: row.endpoint, auth_schemes: [scheme] } }) });
  return String(d?.slug || "");
}
const composioSync = (env, row) => cxAdmin(env, "/custom/toolkits/sync", { method: "POST", retry: "read", body: JSON.stringify({ slug: row.slug, ...(row.auth !== "none" && row.account_id ? { connected_account_id: row.account_id } : {}) }) });
const composioDelete = (env, row) => cxAdmin(env, `/custom/toolkits/${encodeURIComponent(row.slug)}`, { method: "DELETE", retry: "read" });
// The synced tools of one toolkit (latest version): [{ slug, name, description }].
async function composioTools(env, slug) {
  const d = await cx(env, `/tools?toolkit_slug=${encodeURIComponent(slug)}&toolkit_versions=latest&limit=${LIMITS.tools}`, { retry: "read" });
  const items = (d.items || []).filter((t) => t?.slug && (!t.toolkit?.slug || String(t.toolkit.slug).toUpperCase() === slug.toUpperCase()));
  return { items, total: Number.isFinite(Number(d.total_items)) ? Number(d.total_items) : items.length };
}
async function authConfigFor(env, row) {
  const scheme = row.auth === "oauth" ? "DCR_OAUTH" : "API_KEY";
  const have = await cx(env, `/auth_configs?toolkit_slug=${encodeURIComponent(row.slug)}&limit=20`, { retry: "read" });
  const hit = (have.items || []).find((a) => String(a.toolkit?.slug || "").toUpperCase() === row.slug && a.status !== "DISABLED" && (!a.auth_scheme || a.auth_scheme === scheme));
  if (hit?.id) return String(hit.id);
  const d = await cx(env, "/auth_configs", { method: "POST", retry: "read", body: JSON.stringify({ toolkit: { slug: row.slug }, auth_config: { type: "use_custom_auth", authScheme: scheme, credentials: {} } }) });
  const id = d.auth_config?.id; if (!id) throw new Error("Composio made no auth config.");
  return String(id);
}
// An account on this registration, only if it is this workspace's, on this toolkit and auth config.
async function ownAccount(env, tenantId, row, id) {
  const a = await cx(env, `/connected_accounts/${encodeURIComponent(id)}`, { retry: "read" });
  if (a.user_id !== uid(tenantId) || String(a.toolkit?.slug || "").toUpperCase() !== row.slug || (row.auth_config_id && a.auth_config?.id && a.auth_config.id !== row.auth_config_id)) throw new ApiError("not_found", "That connection isn't yours.", 404);
  return a;
}

// ---------------- persistence ----------------
const COLS = new Set(["name", "slug", "auth_config_id", "account_id", "status", "step", "tool_count", "tools", "tool_version", "last_synced_at", "sync_started_at", "sync_attempts", "checked_at", "lock_until", "error_code", "error_message", "cleanup_attempts", "cleanup_at"]);
async function upd(env, id, f) {
  const ks = Object.keys(f).filter((k) => COLS.has(k)); if (!ks.length) return;
  // 'removing' is one-way: a step that was already running when Remove was pressed can never put the row back to a usable state.
  await env.DB.prepare(`UPDATE custom_mcp_server SET ${ks.map((k) => `${k}=?`).join(", ")}, updated_at=? WHERE id=?${f.status === "removing" ? "" : " AND status<>'removing'"}`).bind(...ks.map((k) => f[k]), now(), id).run();
}
const rowById = (env, tenantId, id) => ID_RE.test(String(id || "")) ? env.DB.prepare("SELECT * FROM custom_mcp_server WHERE id=? AND tenant_id=?").bind(String(id), tenantId).first() : Promise.resolve(null);
const reload = (env, row) => env.DB.prepare("SELECT * FROM custom_mcp_server WHERE id=?").bind(row.id).first().then((r) => r || null);
async function lock(env, row) {
  const t = now(), r = await env.DB.prepare("UPDATE custom_mcp_server SET lock_until=? WHERE id=? AND lock_until<?").bind(t + LIMITS.lockMs, row.id, t).run();
  return (r?.meta?.changes ?? r?.changes ?? 0) > 0;
}
const unlock = (env, row) => env.DB.prepare("UPDATE custom_mcp_server SET lock_until=0 WHERE id=?").bind(row.id).run().catch(() => {});
const fail = (row, m, status = "failed") => ({ status, error_code: m.code, error_message: m.message });
const clearErr = { error_code: null, error_message: null };

const toolsOf = (row) => { try { const t = JSON.parse(row.tools || "[]"); return Array.isArray(t) ? t : []; } catch { return []; } };
export function viewOf(row, { tools = true } = {}) {
  const t = tools ? toolsOf(row) : [];
  return { id: row.id, name: row.name, endpoint: row.endpoint, auth: row.auth, status: row.status, tool_count: Number(row.tool_count) || 0, ...(t.length ? { tools: t } : {}),
    ...(row.last_synced_at ? { last_synced_at: Number(row.last_synced_at) } : {}), ...(row.error_code ? { error: { code: row.error_code, message: row.error_message || "" } } : {}) };
}
const packTools = (items) => JSON.stringify(items.slice(0, LIMITS.tools).map((t) => ({ name: cleanText(t.name || t.slug, 80), description: cleanText(t.description, LIMITS.toolText) })));

// ---------------- switch and availability ----------------
export async function enabled(env, tenantId) {
  try { return (await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(tenantId, FLAG).first())?.v === "on"; } catch { return false; }
}
export async function setEnabled(env, tenantId, on) {
  if (on) await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?, 'on', ?) ON CONFLICT(tenant_id,k) DO UPDATE SET v='on', updated_at=excluded.updated_at").bind(tenantId, FLAG, now()).run();
  else await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k=?").bind(tenantId, FLAG).run();
}
const PROBES = new Map();
// → { available: true } or { available: false, reason: "unconfigured" | "self_managed" | "gated" }.
// "gated": the project's key can't use Composio's custom-toolkit routes. Probed without creating anything: DELETE of a slug that can't exist
// is 404 for a key that may write custom toolkits and 403 (APIKey_InsufficientPermissions, code 812) for one that may not. Kept 5 minutes.
export async function availability(env, tenantId) {
  if (!env?.COMPOSIO_KEY || env.CUSTOM_MCP === "off" || !env?.DB) return { available: false, reason: "unconfigured" };
  const { appsMode } = await import("./composio-self.js");
  if ((await appsMode(env, tenantId)) === "self") return { available: false, reason: "self_managed" };
  const c = PROBES.get(env.COMPOSIO_KEY);
  if (c && now() - c.at < LIMITS.probeTtlMs) return c.res;
  let res = { available: true };
  try { await cxAdmin(env, `/custom/toolkits/${probeSlug(env)}`, { method: "DELETE", retry: "read" }); }
  catch (e) { if (mapErr(e).gated) res = { available: false, reason: "gated" }; else if (e?.httpStatus !== 404) { return res; } }   // anything but a clear answer: not cached
  if (PROBES.size > 20) PROBES.clear(); PROBES.set(env.COMPOSIO_KEY, { at: now(), res });
  return res;
}
export const resetProbe = () => PROBES.clear();

// ---------------- what this workspace may use right now (the one gate) ----------------
// → Map<lowercase toolkit slug, row> of this workspace's servers that are enabled AND fully synced ('connected'). Read from D1 every time.
export async function customUsable(env, tenantId) {
  const out = new Map(); if (!env?.DB || !tenantId) return out;
  try {
    const rows = (await env.DB.prepare("SELECT * FROM custom_mcp_server WHERE tenant_id=? AND status='connected'").bind(tenantId).all()).results || [];
    if (!rows.length) return out;
    const fl = Object.fromEntries(((await env.DB.prepare("SELECT k, v FROM tenant_flags WHERE tenant_id=? AND k IN (?, 'apps_mode')").bind(tenantId, FLAG).all()).results || []).map((x) => [x.k, x.v]));
    if (fl[FLAG] !== "on" || fl.apps_mode === "self") return out;   // off, or a Self-managed workspace (its apps run on the person's own Composio)
    for (const r of rows) out.set(r.slug.toLowerCase(), r);
  } catch (e) { console.log("custom mcp usable", String(e?.message || e).slice(0, 80)); }
  return out;
}
export const CUSTOM_DENIED = "NOT AVAILABLE: that custom MCP server is switched off, disconnected, or not set up for this person, so nothing was run. This is final: don't retry it, don't look for it with app_actions or find_app, and don't offer_connect it. Tell the person in one short line that it isn't available (they can switch it on or add it again in Settings → Advanced).";
// A custom tool or toolkit slug → its row if this workspace may use it, else null. A tool belongs to the server whose toolkit slug prefixes it.
export function ownerOf(usable, slug) {
  const s = String(slug || "").toLowerCase(); if (!isCustomSlug(s)) return null;
  for (const [k, r] of usable) if (s === k || s.startsWith(`${k}_`)) return r;
  return null;
}
export async function assertCustom(env, tenantId, slug) {
  const r = ownerOf(await customUsable(env, tenantId), slug);
  if (!r) throw Object.assign(new Error(CUSTOM_DENIED), { customDenied: true });
  return r;
}
// The helper-facing rows (the same shape as listConnections rows) for this workspace's usable servers. The name is shown in the model's
// prompt, so it is plain text only.
export async function customConnRows(env, tenantId) {
  const out = [];
  for (const r of (await customUsable(env, tenantId)).values())
    out.push({ id: r.auth === "none" ? "" : String(r.account_id || ""), app: r.slug.toLowerCase(), name: displayOf(r), logo: "", status: "connected", email: "", label: cleanText(r.name, 40) || "Server",
      default: true, since: new Date(Number(r.created_at) || 0).toISOString(), via: "custom", custom: true });
  return out;
}
// How a server is named to the person and the model: its display name with where it lives, so a generic name ("MCP") is still identifiable.
export const hostOf = (endpoint) => { try { return new URL(endpoint).hostname.toLowerCase(); } catch { return ""; } };
export const displayOf = (r) => `${cleanText(r.name, 40) || "Server"} (custom MCP server at ${hostOf(r.endpoint)})`;
const GENERIC = new Set(["www", "api", "mcp", "app", "apps", "com", "net", "org", "io", "dev", "co", "ai", "the", "server", "custom"]);
// The words that mean this server: its display name and the host's labels (twenty.loartla.com → twenty, loartla; not the TLD or generic labels).
export function customKeys(r) {
  const labels = hostOf(r.endpoint).split(".").slice(0, -1), name = cleanText(r.name, 40).toLowerCase().split(/[^a-z0-9]+/);
  return new Set([...name.filter((w) => w.length >= 3 && w !== "server" && w !== "custom"), ...labels.filter((w) => w.length >= 3 && !GENERIC.has(w))]);
}
// This workspace's own usable (enabled, synced) servers that a piece of text names. Never another workspace's: customUsable() is per tenant.
export async function customMentions(env, tenantId, text) {
  const ws = new Set(String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)); if (!ws.size) return [];
  const out = []; for (const r of (await customUsable(env, tenantId)).values()) { const ks = customKeys(r); if ([...ks].some((k) => ws.has(k) || ws.has(`${k}s`))) out.push(r); }
  return out;
}
export const withCustomRows = async (env, tenantId, conns = []) => [...conns.filter((c) => !isCustomSlug(c.app)), ...(await customConnRows(env, tenantId))];

// ---------------- parsing ----------------
const FORBIDDEN_HEADERS = /^(host|content-length|content-type|connection|cookie|set-cookie|transfer-encoding|upgrade|te|trailer|expect|proxy-.*|x-forwarded-.*|accept-encoding)$/i;
export function parseCreate(b) {
  b = b && typeof b === "object" ? b : {};
  const requestId = String(b.client_request_id ?? ""); if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new ApiError("bad_request", "client_request_id is required (8-80 letters, digits, - or _).");
  const name = cleanText(b.name, 60); if (!name) throw new ApiError("bad_name", "Give this server a name.");
  let u; try { u = checkPublicUrl(b.url); } catch (e) { if (e instanceof UrlError) throw new ApiError(e.code, e.message); throw e; }
  const a = b.auth && typeof b.auth === "object" ? b.auth : null, type = a?.type;
  let auth, header = null, discovery = null;
  if (type === "none") auth = { type };
  else if (type === "api_key") {
    const key = typeof a.key === "string" ? a.key : ""; if (!key || key.length > 4096 || /[\u0000-\u001f\u007f]/.test(key)) throw new ApiError("bad_key", "Enter the API key (one line, up to 4096 characters).");
    header = String(a.header ?? "Authorization").trim() || "Authorization"; if (!/^[A-Za-z0-9-]{1,64}$/.test(header) || FORBIDDEN_HEADERS.test(header)) throw new ApiError("bad_header", "That header name can't be used.");
    // The UI's placeholder is {key}; Composio's custom-toolkit config expects {{generic_api_key}} (docs). Either form is accepted.
    const tpl = a.template == null || a.template === "" ? (header.toLowerCase() === "authorization" ? "Bearer {{generic_api_key}}" : "{{generic_api_key}}") : String(a.template).replace(/(?<!\{)\{key\}(?!\})/g, "{{generic_api_key}}");
    if (tpl.length > 200 || /[\u0000-\u001f\u007f]/.test(tpl) || !tpl.includes("{{generic_api_key}}") || tpl.replace(/\{\{generic_api_key\}\}/g, "").includes("{{")) throw new ApiError("bad_template", "The header format must contain {key} (the API key) and no other {{ }} placeholders.");
    auth = { type, key, template: tpl };
  } else if (type === "oauth") {
    auth = { type };
    if (a.discovery_url != null && a.discovery_url !== "") { try { discovery = checkPublicUrl(a.discovery_url, { what: "OAuth discovery URL" }).endpoint; } catch (e) { if (e instanceof UrlError) throw new ApiError(e.code, e.message); throw e; } }
    else discovery = `https://${u.host}/.well-known/oauth-authorization-server`;
  } else throw new ApiError("unsupported_auth", "Choose no sign-in, an API key, or OAuth.");
  return { requestId, name, u, endpoint: u.endpoint, auth, header, discovery };
}
const schemeOf = (row, p) => row.auth === "none" ? { mode: "NO_AUTH" } : row.auth === "api_key" ? { mode: "API_KEY", headers: { [row.header]: p.auth.template } } : { mode: "DCR_OAUTH", discovery_url: row.discovery_url };

// ---------------- lifecycle ----------------
const gate = async (env, ctx, { write = true } = {}) => {
  if (!env?.DB) throw new ApiError("unavailable", "Custom MCP isn't available.", 503);
  const av = await availability(env, ctx.tenantId);
  if (!av.available) throw new ApiError("unavailable", av.reason === "self_managed" ? "Custom MCP works with Managed apps, not a Self-managed Composio account." : av.reason === "gated" ? "Custom MCP isn't turned on for 1Helm's Composio project yet." : "Custom MCP isn't set up on this server.", 409);
  if (write && !(await enabled(env, ctx.tenantId))) throw new ApiError("disabled", "Turn on Custom MCP connections in Settings → Advanced first.", 403);
  return av;
};

export async function stateOf(env, ctx) {
  const av = await availability(env, ctx.tenantId), on = await enabled(env, ctx.tenantId);
  let rows = ((await env.DB.prepare("SELECT * FROM custom_mcp_server WHERE tenant_id=? ORDER BY created_at, id").bind(ctx.tenantId).all()).results || []);
  if (av.available) await sweepOrphans(env).catch((e) => console.log("custom mcp sweep", String(e?.message || e).slice(0, 80)));
  if (av.available) {   // removals that failed upstream are retried here, a few at a time
    let n = 0;
    for (const r of rows) if (r.status === "removing" && now() - Number(r.cleanup_at) >= LIMITS.cleanupRetryMs && n++ < 3) await cleanup(env, r);
    rows = ((await env.DB.prepare("SELECT * FROM custom_mcp_server WHERE tenant_id=? ORDER BY created_at, id").bind(ctx.tenantId).all()).results || []);
  }
  return { enabled: on, available: av.available, ...(av.available ? {} : { unavailable_reason: av.reason }), servers: rows.map((r) => viewOf(r, { tools: false })) };
}

export async function createServer(env, ctx, body) {
  await gate(env, ctx);
  const p = parseCreate(body);
  try { await dnsCheck(p.u.hostname, { resolve: hooks.resolve }); if (p.discovery) await dnsCheck(new URL(p.discovery).hostname, { resolve: hooks.resolve }); }
  catch (e) { if (e instanceof UrlError) throw new ApiError(e.code, e.message); throw e; }
  let row = await env.DB.prepare("SELECT * FROM custom_mcp_server WHERE tenant_id=? AND request_id=?").bind(ctx.tenantId, p.requestId).first();
  if (row) {
    if (row.endpoint !== p.endpoint || row.auth !== p.auth.type) throw new ApiError("request_conflict", "That request id was already used for a different server.", 409);
    if (row.status === "removing") throw new ApiError("removing", "That server is being removed.", 409);
  } else {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM custom_mcp_server WHERE tenant_id=?").bind(ctx.tenantId).first())?.n || 0;
    if (n >= LIMITS.servers) throw new ApiError("limit_reached", `You can connect up to ${LIMITS.servers} custom servers. Remove one first.`, 409);
    const t = now(); let made = false;
    for (let i = 0; i < 3 && !made; i++) {
      const id = `cm_${b32(20)}`, slug = `CUSTOM_${slugPrefix(env)}_${b32(16).toUpperCase()}`;
      try {
        await env.DB.prepare("INSERT INTO custom_mcp_server (id, tenant_id, user_id, request_id, name, endpoint, auth, header, discovery_url, slug, status, step, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'connecting','new',?,?)")
          .bind(id, ctx.tenantId, ctx.userId, p.requestId, p.name, p.endpoint, p.auth.type, p.header, p.discovery, slug, t, t).run();
        made = true;
      } catch (e) { if (!/UNIQUE|constraint/i.test(String(e?.message))) throw e; if (await env.DB.prepare("SELECT 1 AS x FROM custom_mcp_server WHERE tenant_id=? AND request_id=?").bind(ctx.tenantId, p.requestId).first()) break; }
    }
    row = await env.DB.prepare("SELECT * FROM custom_mcp_server WHERE tenant_id=? AND request_id=?").bind(ctx.tenantId, p.requestId).first();
    if (!row) throw new ApiError("busy", "Couldn't save that. Try again.", 503);
  }
  return runSetup(env, ctx, row, p);
}

// Walks the setup steps from where the row says it is. Each step is saved before the next; a failure keeps the row (status failed) at the
// last good step, so the same request id resumes it and Remove cleans it up. → { server, authorize_url? }
async function runSetup(env, ctx, row, p) {
  if (!(await lock(env, row))) return { server: viewOf(await reload(env, row)) };
  let authorize_url;
  try {
    row = await reload(env, row); if (!row || row.status === "removing") return { server: row ? viewOf(row) : undefined };
    if (row.step === "new") {
      let slug; try { slug = await composioUpsert(env, row, schemeOf(row, p)); }
      catch (e) {
        const m = mapErr(e);
        if (definitive(e)) { await env.DB.prepare("DELETE FROM custom_mcp_server WHERE id=?").bind(row.id).run(); throw new ApiError(m.code, m.message, m.gated ? 409 : 502); }   // nothing exists upstream
        await upd(env, row.id, fail(row, m)); return { server: viewOf(await reload(env, row)) };   // unclear: kept so Remove can clean up and a retry resumes
      }
      if (slug.toUpperCase() !== row.slug) { await upd(env, row.id, fail(row, { code: "upstream_error", message: "Composio registered an unexpected name. Remove this and try again." })); return { server: viewOf(await reload(env, row)) }; }
      await upd(env, row.id, { step: "registered", ...clearErr });
      row = await reload(env, row); if (row.status === "removing") return { server: viewOf(row) };   // removed while the registration was in flight: Remove's retry deletes it upstream
    }
    if (row.step === "registered") {
      if (row.auth === "none") { await upd(env, row.id, { step: "syncing", status: "syncing", sync_started_at: now(), ...clearErr }); }
      else { try { const ac = await authConfigFor(env, row); await upd(env, row.id, { step: "authcfg", auth_config_id: ac, ...clearErr }); } catch (e) { await upd(env, row.id, fail(row, mapErr(e))); return { server: viewOf(await reload(env, row)) }; } }
      row = await reload(env, row);
    }
    if (row.step === "authcfg" && row.auth === "api_key") {
      try {
        let acct = ((await cx(env, `/connected_accounts?user_ids=${encodeURIComponent(uid(ctx.tenantId))}&toolkit_slugs=${encodeURIComponent(row.slug)}&limit=10`, { retry: "read" })).items || [])
          .find((a) => a.user_id === uid(ctx.tenantId) && String(a.toolkit?.slug || "").toUpperCase() === row.slug && String(a.status).toUpperCase() === "ACTIVE");   // resume: already made
        if (!acct) {
          acct = await cx(env, "/connected_accounts", { method: "POST", body: JSON.stringify({ auth_config: { id: row.auth_config_id }, connection: { user_id: uid(ctx.tenantId), state: { authScheme: "API_KEY", val: { generic_api_key: p.auth.key } } } }) });
          acct = { ...acct, id: acct.id || acct.connected_account_id };
          if (!acct.id) throw new Error("Composio made no connection.");
          if (acct.status && String(acct.status).toUpperCase() !== "ACTIVE") throw Object.assign(new Error("Composio did not accept the key."), { httpStatus: 400 });
        }
        await upd(env, row.id, { step: "syncing", status: "syncing", account_id: String(acct.id), sync_started_at: now(), ...clearErr });
      } catch (e) { const m = mapErr(e, [p?.auth?.key]); await upd(env, row.id, fail(row, m)); return { server: viewOf(await reload(env, row)) }; }
      row = await reload(env, row);
    }
    if (row.step === "authcfg" && row.auth === "oauth") {
      await upd(env, row.id, { step: "authorize", status: "authorization_required", ...clearErr }); row = await reload(env, row);
    }
    if (row.step === "authorize" && row.auth === "oauth") {
      try { authorize_url = await issueAuthorize(env, ctx, row); } catch (e) { await upd(env, row.id, fail(row, mapErr(e), "authorization_required")); }
      row = await reload(env, row);
    }
  } finally { await unlock(env, row); }
  if (row.status === "syncing") row = await reconcile(env, ctx, row, { force: true });
  return { server: viewOf(row), ...(authorize_url ? { authorize_url } : {}) };
}

// Fresh single-use state + Composio's hosted sign-in link. Earlier unused states for this server stop working.
async function issueAuthorize(env, ctx, row) {
  if (!ctx.origin) throw new Error("No callback address.");
  const state = b32(40), t = now();
  const link = await cx(env, "/connected_accounts/link", { method: "POST", retry: "read", body: JSON.stringify({ auth_config_id: row.auth_config_id, user_id: uid(ctx.tenantId), callback_url: `${ctx.origin}/w/${ctx.slug}/custom-mcp/callback?state=${state}` }) });
  const url = String(link.redirect_url || ""); if (!/^https:\/\//i.test(url)) throw new Error("Composio returned no sign-in link.");
  await env.DB.prepare("UPDATE custom_mcp_state SET used_at=? WHERE server_id=? AND used_at IS NULL").bind(t, row.id).run();
  await env.DB.prepare("INSERT INTO custom_mcp_state (state_hash, server_id, tenant_id, user_id, pending_account_id, expires_at) VALUES (?,?,?,?,?,?)")
    .bind(await sha256(state), row.id, ctx.tenantId, ctx.userId, String(link.connected_account_id || ""), t + LIMITS.stateTtlMs).run();
  return url;
}
export async function authorizeServer(env, ctx, id) {
  await gate(env, ctx);
  const row = await rowById(env, ctx.tenantId, id); if (!row) throw new ApiError("not_found", "No such server.", 404);
  if (row.auth !== "oauth") throw new ApiError("unsupported_auth", row.auth === "api_key" ? "An API key can't be changed. Remove this server and add it again with the new key." : "This server doesn't need a sign-in.");
  if (!row.auth_config_id || !["authorization_required", "reconnect_required", "failed", "connected"].includes(row.status) || row.status === "removing") throw new ApiError("bad_state", "This server isn't ready to sign in yet.", 409);
  let url; try { url = await issueAuthorize(env, ctx, row); } catch (e) { const m = mapErr(e); throw new ApiError(m.code, m.message, 502); }
  if (row.status !== "connected") await upd(env, row.id, { status: "authorization_required", ...clearErr });
  return { authorize_url: url };
}
// Back from Composio's sign-in page. Never trusts the redirect's own parameters beyond "did it fail": the account is looked up at Composio by
// the id stored with the state, and must be this person's, on this server's toolkit and auth config, and ACTIVE. → the app path to go back to.
export async function finishAuthorize(env, ctx, params) {
  const back = `/w/${ctx.slug}/app?settings=advanced`, state = String(params.get("state") || "");
  if (!/^[a-z2-7]{40}$/.test(state)) return back;
  const hash = await sha256(state), st = await env.DB.prepare("SELECT * FROM custom_mcp_state WHERE state_hash=?").bind(hash).first();
  if (!st || st.tenant_id !== ctx.tenantId || st.user_id !== ctx.userId || Number(st.expires_at) < now() || st.used_at) return back;   // unknown, someone else's, expired or replayed: nothing happens
  const used = await env.DB.prepare("UPDATE custom_mcp_state SET used_at=? WHERE state_hash=? AND used_at IS NULL").bind(now(), hash).run();
  if (!((used?.meta?.changes ?? used?.changes ?? 0) > 0)) return back;
  const row = await rowById(env, ctx.tenantId, st.server_id); if (!row || row.status === "removing" || !(await enabled(env, ctx.tenantId))) return back;
  const said = String(params.get("status") || params.get("error") || "").toLowerCase();
  const cancelled = (code, message) => upd(env, row.id, { status: row.status === "connected" ? "connected" : "authorization_required", error_code: code, error_message: message });
  if (params.get("error") || (said && said !== "success")) { await cancelled("authorization_cancelled", "Sign-in wasn't completed. Choose Authorize to try again."); return back; }
  try {
    const a = await ownAccount(env, ctx.tenantId, row, st.pending_account_id);
    if (String(a.status).toUpperCase() !== "ACTIVE") { await cancelled("authorization_cancelled", "Sign-in wasn't completed. Choose Authorize to try again."); return back; }
    const old = row.account_id && row.account_id !== a.id ? row.account_id : null;
    await upd(env, row.id, { account_id: String(a.id), status: "syncing", step: "syncing", sync_started_at: now(), sync_attempts: 0, checked_at: 0, ...clearErr });
    if (old) await cx(env, `/connected_accounts/${encodeURIComponent(old)}`, { method: "DELETE", retry: "read" }).catch(() => {});   // the replaced sign-in (it is this registration's own)
  } catch (e) { const m = mapErr(e); await upd(env, row.id, { status: row.status === "connected" ? "connected" : "authorization_required", error_code: m.code === "upstream_error" ? "authorization_failed" : m.code, error_message: m.code === "not_found" ? "That sign-in didn't match this server. Choose Authorize to try again." : m.message }); }
  return back;
}

// Moves a server forward: waits for / starts the tool sync, checks the connection's health. Bounded: at most one or two Composio requests per
// call and never more often than every 2 s per server. Connected only once tools have really synced.
export async function reconcile(env, ctx, row, { force = false } = {}) {
  const t = now();
  if (row.status === "removing") { if (t - Number(row.cleanup_at) >= LIMITS.cleanupRetryMs) await cleanup(env, row); return (await reload(env, row)) || row; }
  const gap = row.status === "connected" ? LIMITS.healthMs : LIMITS.pollMinMs;
  if (!["syncing", "connected", "authorization_required"].includes(row.status) || (!force && t - Number(row.checked_at) < gap)) return row;
  if (!(await lock(env, row))) return row;
  try {
    row = await reload(env, row); if (!row || row.status === "removing") return row;
    await upd(env, row.id, { checked_at: t });
    if (row.status === "syncing") {
      let tools;
      try { tools = await composioTools(env, row.slug); } catch (e) { const m = mapErr(e); if (m.code !== "busy" && m.code !== "unknown_outcome" && m.code !== "upstream_error") await upd(env, row.id, fail(row, m)); return await reload(env, row); }
      if (tools.items.length) { await upd(env, row.id, { status: "connected", tool_count: tools.total, tools: packTools(tools.items), last_synced_at: Number(row.last_synced_at) || t, ...clearErr }); return await reload(env, row); }
      const waited = t - Number(row.sync_started_at || t);
      if (!row.sync_attempts && waited >= LIMITS.syncGraceMs) {   // the automatic first sync produced nothing: ask for one
        await upd(env, row.id, { sync_attempts: 1 });
        try {
          const r = await composioSync(env, row);
          if (Number(r?.synced_count) === 0) await upd(env, row.id, { status: "connected", tool_count: 0, tools: "[]", tool_version: String(r?.version || ""), last_synced_at: t, ...clearErr });
          else await upd(env, row.id, { tool_version: String(r?.version || "") });
        } catch (e) { await upd(env, row.id, fail(row, syncErr(e))); }
      } else if (waited >= LIMITS.syncDeadlineMs) await upd(env, row.id, fail(row, { code: "sync_timeout", message: "The server's tools didn't sync in time. Choose Refresh to try again." }));
    } else if (row.status === "connected" && row.auth !== "none" && row.account_id) {   // is the sign-in / key still good?
      try { const a = await ownAccount(env, ctx.tenantId, row, row.account_id); if (/^(EXPIRED|FAILED|INACTIVE|DISABLED)$/i.test(String(a.status))) await upd(env, row.id, { status: "reconnect_required", error_code: "reconnect_required", error_message: row.auth === "oauth" ? "The sign-in expired or was revoked. Choose Authorize to sign in again." : "The server stopped accepting this key. Remove it and add it again with a new key." }); }
      catch (e) { if (e?.code === "not_found" || e?.httpStatus === 404) await upd(env, row.id, { status: "reconnect_required", error_code: "reconnect_required", error_message: "This connection no longer exists upstream. Remove it and add it again." }); }
    } else if (row.status === "authorization_required" && row.account_id == null) { /* waiting for the person; the callback moves it */ }
  } finally { await unlock(env, row); }
  return (await reload(env, row)) || row;
}
const syncErr = (e) => { const m = mapErr(e); return m.code === "rejected" || m.code === "upstream_error" ? { code: "sync_failed", message: m.code === "rejected" ? `Composio couldn't read this server's tools: ${m.message.replace(/^Composio couldn't use this server: /, "")}` : "Composio couldn't read this server's tools. Choose Refresh to try again." } : m; };

export async function getServer(env, ctx, id) {
  const row = await rowById(env, ctx.tenantId, id); if (!row) throw new ApiError("not_found", "No such server.", 404);
  if (!(await availability(env, ctx.tenantId)).available) return { server: viewOf(row) };
  return { server: viewOf(await reconcile(env, ctx, row)) };
}
// Refresh = the documented sync. "syncing" is saved first; connected again only when Composio says the sync finished. A refresh that fails
// keeps a working server working (Composio keeps the last good tool version) and says so in `error`.
export async function refreshServer(env, ctx, id) {
  await gate(env, ctx);
  let row = await rowById(env, ctx.tenantId, id); if (!row) throw new ApiError("not_found", "No such server.", 404);
  if (row.status === "removing") throw new ApiError("removing", "That server is being removed.", 409);
  if (row.step !== "syncing" || (row.auth !== "none" && !row.account_id)) throw new ApiError("bad_state", row.auth === "oauth" && row.status === "authorization_required" ? "Sign in first (Authorize)." : "Setup isn't finished. Try adding the server again, or remove it.", 409);
  if (row.status === "reconnect_required") throw new ApiError("bad_state", "Reconnect this server first.", 409);
  if (!(await lock(env, row))) return { server: viewOf(row) };
  const was = row.status; let t = now();
  try {
    await upd(env, row.id, { status: "syncing", sync_started_at: t, checked_at: t, sync_attempts: 1 });
    try {
      const r = await composioSync(env, row);
      const tools = await composioTools(env, row.slug).catch(() => null);
      await upd(env, row.id, { status: "connected", tool_count: tools ? tools.total : Number(r?.synced_count) || 0, tools: tools ? packTools(tools.items) : row.tools, tool_version: String(r?.version || row.tool_version || ""), last_synced_at: now(), ...clearErr });
    } catch (e) {
      const m = syncErr(e), usable = was === "connected" && toolsOf(row).length;
      await upd(env, row.id, usable ? { status: "connected", error_code: "refresh_failed", error_message: `Refresh failed; the last synced tools are still in use. ${m.message}`.slice(0, 300) } : fail(row, m));
    }
  } finally { await unlock(env, row); }
  return { server: viewOf(await reload(env, row)) };
}

// Disconnect: block use first (status removing; customUsable only ever lists 'connected'), then delete only this registration upstream. If that
// fails the row stays 'removing' and the next list / get / delete retries; it never becomes usable again.
export async function removeServer(env, ctx, id) {
  if (!env?.DB) throw new ApiError("unavailable", "Custom MCP isn't available.", 503);
  const row = await rowById(env, ctx.tenantId, id); if (!row) throw new ApiError("not_found", "No such server.", 404);
  if (row.status !== "removing") await upd(env, row.id, { status: "removing", error_code: null, error_message: null });
  await env.DB.prepare("UPDATE custom_mcp_state SET used_at=? WHERE server_id=? AND used_at IS NULL").bind(now(), row.id).run();
  const r = await cleanup(env, (await reload(env, row)) || row);
  return r.done ? { ok: true } : { server: viewOf(r.row) };
}
async function cleanup(env, row) {
  // Never while a setup step holds the row (it may be registering this very toolkit upstream right now): the retry picks it up afterwards.
  if (!(await lock(env, row))) return { done: false, row: (await reload(env, row)) || row };
  try { return await cleanupLocked(env, row); } finally { await unlock(env, row); }
}
async function cleanupLocked(env, row) {
  if (!SLUG_RE.test(row.slug)) { await env.DB.prepare("DELETE FROM custom_mcp_server WHERE id=?").bind(row.id).run(); return { done: true }; }   // never a slug we didn't generate
  try { await composioDelete(env, row); }
  catch (e) {
    if (e?.httpStatus !== 404) {
      const m = mapErr(e);
      await upd(env, row.id, { status: "removing", cleanup_attempts: Number(row.cleanup_attempts) + 1, cleanup_at: now(), error_code: "cleanup_pending", error_message: m.gated ? m.message : "Removal is waiting on Composio. It will be retried; this server can't be used meanwhile." });
      return { done: false, row: await reload(env, row) };
    }
  }
  await env.DB.prepare("DELETE FROM custom_mcp_state WHERE server_id=?").bind(row.id).run();
  await env.DB.prepare("DELETE FROM custom_mcp_server WHERE id=?").bind(row.id).run();
  return { done: true };
}

// ---------------- orphan sweep ----------------
// Every upstream registration is made only after its D1 row exists (insert, then upsert), and removal never deletes the row before the toolkit.
// Anything still found upstream with OUR generated slug shape and NO row is therefore a leftover (a crash between steps, a lost response, a race
// that was closed later). Composio shows the project's whole custom list, so the sweep deletes only: slugs matching this environment's CUSTOM_<HC|HP>_<16 base32>, with no
// row in any workspace, first seen (or created, if Composio says) more than 30 minutes ago, at most 5 per run, at most every 10 minutes.
// Never anything else. The first sighting is only recorded (tenant_flags k='seen:<slug>' under a reserved tenant id). CUSTOM_MCP_SWEEP=off stops it.
// NOTE: if two environments (e.g. dev and prod) ever shared one Composio project, each would see the other's rows as orphans: don't share one.
export const SWEEP = { windowMs: 1800000, everyMs: 600000, max: 5 };
const SWEEP_T = "_custom_mcp";
const probeSlug = (env) => `CUSTOM_${slugPrefix(env)}_AAAAAAAAAAAAAAAA`;
export async function sweepOrphans(env, { force = false } = {}) {
  const out = { deleted: [], seen: 0 };
  if (!env?.DB || !env?.COMPOSIO_KEY || !env?.COMPOSIO_CUSTOM_KEY || env.CUSTOM_MCP_SWEEP === "off") return out;
  const t = now(), flag = (k) => env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(SWEEP_T, k).first();
  const setFlag = (k, v) => env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at").bind(SWEEP_T, k, String(v), t).run();
  if (!force && t - Number((await flag("sweep_at"))?.v || 0) < SWEEP.everyMs) return out;
  await setFlag("sweep_at", t);
  let items = [], cursor = "";
  for (let i = 0; i < 3; i++) {
    const d = await cx(env, `/toolkits?type=custom&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { retry: "read" });
    items.push(...(d.items || [])); cursor = d.next_cursor || ""; if (!cursor) break;
  }
  const upstream = new Map(items.map((x) => [String(x.slug || "").toUpperCase(), x]).filter(([k]) => ownRe(env).test(k) && k !== probeSlug(env)));
  const have = new Set(((await env.DB.prepare("SELECT slug FROM custom_mcp_server").all()).results || []).map((r) => r.slug));
  const seen = Object.fromEntries(((await env.DB.prepare("SELECT k, v FROM tenant_flags WHERE tenant_id=? AND k LIKE 'seen:%'").bind(SWEEP_T).all()).results || []).map((r) => [r.k.slice(5), Number(r.v)]));
  for (const slug of Object.keys(seen)) if (!upstream.has(slug) || have.has(slug)) await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k=?").bind(SWEEP_T, `seen:${slug}`).run();   // gone, or it has a row after all
  for (const [slug, item] of upstream) {
    if (have.has(slug)) continue;
    if (!seen[slug]) { await setFlag(`seen:${slug}`, t); out.seen++; if (!(Date.parse(item.created_at) < t - SWEEP.windowMs)) continue; }
    const since = Math.min(seen[slug] ?? t, Number.isFinite(Date.parse(item.created_at)) ? Date.parse(item.created_at) : Infinity);
    if (t - since < SWEEP.windowMs || out.deleted.length >= SWEEP.max) continue;
    if (await env.DB.prepare("SELECT 1 AS x FROM custom_mcp_server WHERE slug=?").bind(slug).first()) continue;   // a row appeared meanwhile: it is not an orphan
    try { await composioDelete(env, { slug }); out.deleted.push(slug); console.log("custom mcp sweep: deleted orphan", slug); await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k=?").bind(SWEEP_T, `seen:${slug}`).run(); }
    catch (e) { if (e?.httpStatus === 404) out.deleted.push(slug); }
  }
  return out;
}

// ---------------- HTTP ----------------
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const jerr = (e) => {
  if (e instanceof ApiError) return J({ error: { code: e.code, message: e.message } }, e.status);
  console.log("custom mcp error", String(e?.message || e).slice(0, 120));
  return J({ error: { code: "server_error", message: "Something went wrong. Try again." } }, 500);
};
// ctx: { tenantId, userId, slug, origin }; denyWrite(): a Response when the workspace is read-only (unpaid), else null.
export async function customMcpRoute(req, env, ctx, sub, { denyWrite = null, look = false } = {}) {
  const m = sub.match(/^\/api\/custom-mcp(?:\/(settings)|\/servers(?:\/([^/]+)(?:\/(authorize|refresh))?)?)?$/);
  const cb = sub === "/custom-mcp/callback" && req.method === "GET";
  if (!m && !cb) return null;
  const method = req.method;
  if (!cb && method !== "GET") {
    if (look) return J({ error: { code: "read_only", message: "Read-only view." } }, 403);
    const o = req.headers.get("origin");
    if ((o && o !== ctx.origin) || req.headers.get("sec-fetch-site") === "cross-site") return J({ error: { code: "forbidden", message: "Not allowed." } }, 403);
    const pay = denyWrite?.(); if (pay) return pay;
  }
  try {
    if (cb) {
      if (look) return new Response(null, { status: 302, headers: { location: `${ctx.origin}/w/${ctx.slug}/app?settings=advanced` } });
      const to = await finishAuthorize(env, ctx, new URL(req.url).searchParams);
      return new Response(null, { status: 302, headers: { location: `${ctx.origin}${to}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    }
    const [, settings, id, action] = m;
    const body = async () => { try { return JSON.parse(await boundedText(req, 32768)); } catch (e) { if (e instanceof BodyTooLargeError) throw new ApiError("too_large", "Request is too large.", 413); throw new ApiError("bad_request", "Send JSON."); } };
    if (m[0] === "/api/custom-mcp") return method === "GET" ? J(await stateOf(env, ctx)) : J({ error: { code: "method_not_allowed", message: "Use GET." } }, 405);
    if (settings) {
      if (method !== "PUT") return J({ error: { code: "method_not_allowed", message: "Use PUT." } }, 405);
      const b = await body(); if (typeof b?.enabled !== "boolean") throw new ApiError("bad_request", "enabled must be true or false.");
      if (b.enabled) await gate(env, ctx, { write: false });
      await setEnabled(env, ctx.tenantId, b.enabled);
      return J(await stateOf(env, ctx));
    }
    if (!id) { if (method === "POST") return J(await createServer(env, ctx, await body())); return J({ error: { code: "method_not_allowed", message: "Use POST." } }, 405); }
    if (!action) {
      if (method === "GET") return J(await getServer(env, ctx, id));
      if (method === "DELETE") return J(await removeServer(env, ctx, id));
    } else if (method === "POST") {
      if (action === "authorize") return J(await authorizeServer(env, ctx, id));
      if (action === "refresh") return J(await refreshServer(env, ctx, id));
    }
    return J({ error: { code: "method_not_allowed", message: "Not supported." } }, 405);
  } catch (e) { return jerr(e); }
}
