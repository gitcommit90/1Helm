import { boundedJson } from "../bounded-body.js";
// Managed vs Self-managed apps: account connection and sign-in choices.
// The person picks, at the end of onboarding and later in Settings → Connected accounts, how their apps reach Composio:
//   managed (default; every workspace made before this): 1Helm's Composio project, user_id "1hc:<tenant>" (composio-transport.js).
//   self: the person's OWN Composio account ("Composio for You"). 1Helm signs in to it with OAuth 2.1 + PKCE as its own public client
//         (registered by Dynamic Client Registration at connect.composio.dev, client id in env.COMPOSIO_CONNECT_CLIENT, redirect
//         https://<APP_HOST>/composio/callback) and calls their Composio Connect MCP server (connect.composio.dev/mcp) with their token.
// This file: the choice (D1 tenant_flags k='apps_mode' = 'self'; no row = managed; consent in k='apps_consent'), the sign-in, the
// per-workspace tokens (D1 composio_self: AES-GCM sealed with VAULT_KEY like Passwords & keys, sentinel.js sealSecret), refresh-token
// rotation (the new refresh token is always saved; one refresher at a time across every isolate, a D1 lease), and the MCP client
// (streamable-HTTP JSON-RPC, Bearer, keeps the mcp-session-id, re-initializes on 400/404).
// Rules: tokens are never logged, returned or put in an error. Only four Connect tools are ever called (search, multi-execute, schemas,
// manage connections, the last only under 1Helm's own Connect buttons); REMOTE_WORKBENCH / REMOTE_BASH_TOOL and everything else are
// refused by name before anything is sent. A revoked or expired sign-in is never papered over: the workspace stays Self-managed, the
// helper says "Your Composio sign-in ended" with a Reconnect card (resident.js cmpGate), and nothing falls back to 1Helm's account.
// Composio advertises no token revocation endpoint, so "sign out" here forgets the tokens on 1Helm's side.
import { sealSecret, openSecret } from "../sentinel.js";
import { RETRY, RateGauge, nextWait, retryAfterMs, unknownOutcome, rateLimited, rateLog } from "./composio-api.js";   // stage 6: the same retry rules as REST

export const AUTHORIZE_URL = "https://connect.composio.dev/oauth/authorize";
export const TOKEN_URL = "https://login.composio.dev/oauth2/token";
export const MCP_URL = "https://connect.composio.dev/mcp";
const SCOPE = "openid profile email offline_access", PROTO = "2025-06-18";
export const redirectUri = (env) => `https://${env.APP_HOST || env.GATEWAY_HOST}/composio/callback`;
export const clientId = (env) => String(env.COMPOSIO_CONNECT_CLIENT || "");
export const selfAvailable = (env) => !!(clientId(env) && env.VAULT_KEY && env.DB);

// The only Connect MCP tools 1Helm calls. Workbench / bash (and anything new Composio adds) are refused by name.
export const MCP_ALLOWED = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MULTI_EXECUTE_TOOL", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS"]);
export const MCP_NEVER = new Set(["COMPOSIO_REMOTE_WORKBENCH", "COMPOSIO_REMOTE_BASH_TOOL"]);

// ---- "Your Composio sign-in ended" ----
export const CMP_ENDED = "composio_signin_ended";
export const ENDED_LINE = "Your Composio sign-in ended";
export class SignInEnded extends Error { constructor(why = "ended") { super(`${ENDED_LINE}. Sign in again in Settings → Connected accounts.`); this.code = CMP_ENDED; this.why = why; } }
export const isEnded = (e) => e?.code === CMP_ENDED;
// What the helper gets instead of a result. Plain line for the person, a Reconnect card on screen, no other way in.
export const endedToolText = () => `COMPOSIO SIGN-IN ENDED: nothing was run. This person's apps run on their own Composio account (Self-managed), and 1Helm's sign-in to it ended (expired or removed). Tell them plainly in one short line: "${ENDED_LINE}. Tap Reconnect to sign in again." A Reconnect card is on screen. Don't retry, don't reach their apps any other way, don't suggest connecting apps one by one, and end your turn.`;
export const ENDED_PREFIX = "COMPOSIO SIGN-IN ENDED";

const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const claims = (jwt) => { try { return JSON.parse(atob(String(jwt).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; } };

// ---- D1 (also migrations_037_composio_self.sql; made here too so a fresh dev D1 just works) ----
export const SELF_DDL = [
  "CREATE TABLE IF NOT EXISTS composio_self (tenant_id TEXT PRIMARY KEY, sealed TEXT NOT NULL, who TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ok', mcp_sid TEXT, lease INTEGER, connected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS composio_self_pkce (state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, verifier TEXT NOT NULL, back TEXT NOT NULL DEFAULT '', then_mode TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS composio_self_apps (tenant_id TEXT NOT NULL, toolkit TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, toolkit))",
];
let ddlDone = null;
async function ddl(env) { if (ddlDone === env.DB) return; for (const q of SELF_DDL) await env.DB.prepare(q).run(); ddlDone = env.DB; }

// ---- the choice ----
const MODE = new Map();   // tenant → { m, at }: 5 s per isolate, so a turn doesn't ask D1 on every call
export async function appsMode(env, tenantId) {
  if (!env?.DB || !tenantId) return "managed";
  const c = MODE.get(tenantId); if (c && now() - c.at < 5000) return c.m;
  let m = "managed";
  try { if ((await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k='apps_mode'").bind(tenantId).first())?.v === "self") m = "self"; } catch {}
  MODE.set(tenantId, { m, at: now() }); return m;
}
// mode: "managed" | "self". Self needs a working sign-in first. consent: the person ticked the box (onboarding) → recorded with the time.
export async function setAppsMode(env, tenantId, mode, { consent = false } = {}) {
  if (mode !== "self" && mode !== "managed") throw new Error("mode must be managed or self");
  if (mode === "self") { if (!selfAvailable(env)) throw new Error("Self-managed isn't set up on this server yet."); if ((await selfStatus(env, tenantId)).status !== "ok") throw new Error("Sign in with Composio first."); }
  if (mode === "self") await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,'apps_mode','self',?) ON CONFLICT(tenant_id,k) DO UPDATE SET v='self', updated_at=excluded.updated_at").bind(tenantId, now()).run();
  else await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k='apps_mode'").bind(tenantId).run();
  if (consent) await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,'apps_consent',?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at").bind(tenantId, `${mode}:${new Date().toISOString()}`, now()).run();
  MODE.set(tenantId, { m: mode, at: now() });
  return { mode };
}

// The onboarding's last step ("Open 1Helm"): apps = { mode, consent }. The box must be ticked; Self-managed also needs the sign-in done.
export async function saveOnboardingChoice(env, tenantId, apps = {}) {
  const mode = apps.mode === "self" ? "self" : "managed";
  if (apps.consent !== true) return { error: "Check the box to continue." };
  if (mode === "self" && (await selfStatus(env, tenantId)).status !== "ok") return { error: "Sign in with Composio to continue." };
  try { await setAppsMode(env, tenantId, mode, { consent: true }); } catch (e) { return { error: e.message }; }
  return { ok: true, mode };
}
// Settings → Connected accounts → How apps connect: /w/<slug>/api/apps/mode (index.js). t = the tenant row; deps: { readOnly (→ the
// payment-needed response, or null), disconnectAllManaged, managedCount } from composio.js. GET → the side, the sign-in, leftovers on
// 1Helm's account; POST { mode } switches (Self-managed without a sign-in → { need_signin, url }); { op: "clear_managed" } deletes the
// leftovers at Composio. → a Response, or null for another method.
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function appsModeRoute(req, env, t, deps = {}) {
  const s = await selfStatus(env, t.id), mode = await appsMode(env, t.id);
  const signinUrl = (then) => `/w/${t.slug}/composio/connect?${then ? "then=self&" : ""}back=${encodeURIComponent(`/w/${t.slug}/app?settings=accounts`)}`;
  if (req.method === "GET") {
    let left = 0; if (mode === "self" && env.COMPOSIO_KEY && deps.managedCount) try { left = await deps.managedCount(env, t.id); } catch {}
    return J({ mode, available: selfAvailable(env), signin: s.status, who: s.who, managed_left: left, signin_url: signinUrl(false) });
  }
  if (req.method !== "POST") return null;
  if (deps.readOnly) return deps.readOnly();
  const b = await boundedJson(req);
  if (b.op === "clear_managed") { try { return J({ ok: true, removed: await deps.disconnectAllManaged(env, t.id) }); } catch (e) { return J({ error: e.message }); } }
  const want = b.mode === "self" ? "self" : b.mode === "managed" ? "managed" : "";
  if (!want) return J({ error: "mode must be managed or self" }, 400);
  if (want === "self" && !selfAvailable(env)) return J({ error: "Self-managed isn't set up on this server yet." });
  if (want === "self" && s.status !== "ok") return J({ need_signin: true, url: signinUrl(true) });
  try { await setAppsMode(env, t.id, want); } catch (e) { return J({ error: e.message }); }
  LIST.delete(t.id);
  return J({ ok: true, mode: want });
}

// The onboarding tab that signed in to Composio (back=close): says so and closes; the onboarding page sees it on its own.
export function composioDonePage(r, v = "") {
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ok = !!r.ok, msg = ok ? `You're signed in to Composio${r.who ? ` as ${esc(r.who)}` : ""}.` : esc(r.error || "Composio didn't finish the sign-in. Try again.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Composio · 1Helm</title><meta name="robots" content="noindex"><link rel="icon" type="image/png" href="/1helm-icon-64.png"><link rel="stylesheet" href="/onboard/kit.css?v=${v}">
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--page,#f3f2ef);color:var(--ink,#1c1b19);font:16px/1.5 "Instrument Sans",system-ui,sans-serif;text-align:center;padding:24px}h1{font:400 32px/1.2 "Instrument Serif",Georgia,serif;margin:12px 0 8px}p{color:var(--mute,#77746c);margin:0 0 6px}</style></head>
<body><main><img src="/1helm-icon.png" width="48" height="48" alt=""><h1>${ok ? "Signed in" : "Not signed in"}</h1><p>${msg}</p><p>${ok ? "You can close this tab and go back to 1Helm." : "Close this tab and try again in 1Helm."}</p></main>
<p><a class="pbtn" href="/onboard${ok ? "?cmp=ok" : ""}" id="back" style="margin-top:14px">Back to 1Helm</a></p>
<script>(function(){var ok=${ok};
// Tell the onboarding tab every way we can (it also polls the server, the source of truth): postMessage when the opener survived the
// Composio pages, else BroadcastChannel / a localStorage ping. Then close; a tab that can't close goes back to the step itself.
try{window.opener&&window.opener.postMessage({t:"composio-signin",ok:ok},location.origin)}catch(e){}
try{new BroadcastChannel("1hc-composio").postMessage({t:"composio-signin",ok:ok})}catch(e){}
try{localStorage.setItem("1hc-composio-signin",String(Date.now()))}catch(e){}
if(ok){setTimeout(function(){try{window.close()}catch(e){}},1200);setTimeout(function(){if(!window.closed)location.replace("/onboard?cmp=ok")},2600)}})();</script></body></html>`;
}

// ---- sign-in (OAuth 2.1 + PKCE, public client) ----
// back: where the browser goes after the callback (a path inside this workspace, "/onboard", or "close" for the onboarding tab).
// then: "self" switches the workspace to Self-managed once signed in (Settings switch).
export async function signInStart(env, tenantId, { back = "", then = "" } = {}) {
  if (!selfAvailable(env)) throw new Error("Self-managed isn't set up on this server yet.");
  await ddl(env);
  const verifier = rand(48), state = rand(24), challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await env.DB.prepare("DELETE FROM composio_self_pkce WHERE created_at<?").bind(now() - 15 * 60e3).run();
  await env.DB.prepare("INSERT INTO composio_self_pkce (state,tenant_id,verifier,back,then_mode,created_at) VALUES (?,?,?,?,?,?)").bind(state, tenantId, await sealSecret(env, verifier), String(back).slice(0, 400), then === "self" ? "self" : "", now()).run();
  const a = new URL(AUTHORIZE_URL);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: clientId(env), redirect_uri: redirectUri(env), scope: SCOPE, state, code_challenge: challenge, code_challenge_method: "S256", resource: MCP_URL })) a.searchParams.set(k, v);
  return { url: a.toString(), state };
}
// The callback. cookieState: the state this browser was given at the start (a cookie), so a sign-in started elsewhere can't land in this
// workspace; tenantId: the signed-in person's workspace. → { ok, tenantId, back, who } | { error, back }
export async function signInFinish(env, { code = "", state = "", error = "", cookieState = "", tenantId = "" } = {}) {
  await ddl(env);
  const row = state ? await env.DB.prepare("SELECT * FROM composio_self_pkce WHERE state=?").bind(state).first() : null;
  if (row) await env.DB.prepare("DELETE FROM composio_self_pkce WHERE state=?").bind(state).run();   // one use
  if (!row || now() - Number(row.created_at) > 15 * 60e3) return { error: "That Composio sign-in link expired. Try again." };
  const back = row.back || "";
  if (!cookieState || cookieState !== state || !tenantId || tenantId !== row.tenant_id) return { error: "That Composio sign-in didn't start in this browser. Try again from 1Helm.", back };
  if (error) return { error: error === "access_denied" ? "Composio sign-in was cancelled." : "Composio didn't finish the sign-in. Try again.", back };
  if (!code) return { error: "Composio didn't finish the sign-in. Try again.", back };
  let verifier; try { verifier = await openSecret(env, row.verifier); } catch { return { error: "That Composio sign-in link expired. Try again.", back }; }
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(env), client_id: clientId(env), code_verifier: verifier, resource: MCP_URL }), signal: AbortSignal.timeout(20000) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !d.access_token) { console.log("composio self sign-in: token exchange failed", r?.status || "network", String(d?.error || "").slice(0, 60)); return { error: "Composio didn't finish the sign-in. Try again.", back }; }
  const c = claims(d.id_token || ""), who = String(c.email || c.preferred_username || c.name || "").slice(0, 120);
  const t = { access_token: d.access_token, refresh_token: d.refresh_token || "", expires_at: now() + (Number(d.expires_in) || 3600) * 1000, scope: d.scope || "" };
  await env.DB.prepare(`INSERT INTO composio_self (tenant_id,sealed,who,status,mcp_sid,lease,connected_at,updated_at) VALUES (?,?,?,'ok',NULL,NULL,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET sealed=excluded.sealed, who=excluded.who, status='ok', mcp_sid=NULL, lease=NULL, connected_at=excluded.connected_at, updated_at=excluded.updated_at`)
    .bind(row.tenant_id, await sealSecret(env, JSON.stringify(t)), who, now(), now()).run();
  TOK.delete(row.tenant_id); SID.delete(row.tenant_id); LIST.delete(row.tenant_id);
  if (row.then_mode === "self") await setAppsMode(env, row.tenant_id, "self");
  return { ok: true, tenantId: row.tenant_id, back, who };
}
// → { status: "none" | "ok" | "ended", who }
export async function selfStatus(env, tenantId) {
  if (!env?.DB || !tenantId) return { status: "none", who: "" };
  try { await ddl(env); const r = await env.DB.prepare("SELECT status, who FROM composio_self WHERE tenant_id=?").bind(tenantId).first(); return r ? { status: r.status === "ended" ? "ended" : "ok", who: r.who || "" } : { status: "none", who: "" }; }
  catch { return { status: "none", who: "" }; }
}
// Forget the tokens on 1Helm's side (Composio has no revocation endpoint for this client).
export async function selfSignOut(env, tenantId) {
  await ddl(env); TOK.delete(tenantId); SID.delete(tenantId); LIST.delete(tenantId);
  return Number((await env.DB.prepare("DELETE FROM composio_self WHERE tenant_id=?").bind(tenantId).run()).meta?.changes || 0);
}

// ---- tokens ----
const TOK = new Map();   // tenant → { access, exp, sealed } (this isolate)
const readRow = (env, tid) => env.DB.prepare("SELECT * FROM composio_self WHERE tenant_id=?").bind(tid).first();
const openTok = async (env, sealed) => JSON.parse(await openSecret(env, sealed));
const keep = (tid, t, sealed) => { const v = { access: t.access_token, exp: Number(t.expires_at) || 0, sealed }; TOK.set(tid, v); return v; };
async function markEnded(env, tid, why = "") {
  TOK.delete(tid); SID.delete(tid); LIST.delete(tid);
  await env.DB.prepare("UPDATE composio_self SET status='ended', lease=NULL, mcp_sid=NULL, updated_at=? WHERE tenant_id=?").bind(now(), tid).run().catch(() => {});
  console.log("composio self sign-in ended", why);
}
// A usable access token: cached, else from D1, refreshed when within a minute of expiry (force: the server said 401 to this one).
export async function accessToken(env, tid, { force = false } = {}) {
  const c = TOK.get(tid);
  if (!force && c && c.exp - 60e3 > now()) return c;
  await ddl(env);
  let row = await readRow(env, tid);
  if (!row) throw new SignInEnded("none");
  if (row.status === "ended") throw new SignInEnded("ended");
  let t; try { t = await openTok(env, row.sealed); } catch { await markEnded(env, tid, "unreadable"); throw new SignInEnded("ended"); }
  if (t.expires_at - 60e3 > now() && (!force || (c && c.sealed !== row.sealed))) return keep(tid, t, row.sealed);   // force, but someone refreshed since
  return refresh(env, tid, row, t);
}
async function refresh(env, tid, row, t) {
  if (!t.refresh_token) { await markEnded(env, tid, "no refresh token"); throw new SignInEnded("ended"); }
  // One refresher at a time across every isolate: a rotating refresh token used twice fails. The lease is the row's own `lease` column.
  for (let i = 0; ; i++) {
    const got = Number((await env.DB.prepare("UPDATE composio_self SET lease=? WHERE tenant_id=? AND sealed=? AND status='ok' AND (lease IS NULL OR lease<?)").bind(now() + 20e3, tid, row.sealed, now()).run()).meta?.changes || 0);
    if (got) break;
    if (i >= 24) throw new Error("Composio sign-in is busy. Try again in a moment.");
    await sleep(500);
    const r2 = await readRow(env, tid);
    if (!r2) throw new SignInEnded("none");
    if (r2.status === "ended") throw new SignInEnded("ended");
    if (r2.sealed !== row.sealed) { const t2 = await openTok(env, r2.sealed); if (t2.expires_at - 60e3 > now()) return keep(tid, t2, r2.sealed); row = r2; t = t2; }
  }
  const release = () => env.DB.prepare("UPDATE composio_self SET lease=NULL WHERE tenant_id=?").bind(tid).run().catch(() => {});
  let r; try {
    r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId(env) }), signal: AbortSignal.timeout(15000) });
  } catch { await release(); throw new Error("Composio's sign-in service didn't answer. Try again in a minute."); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    // 400/401 (invalid_grant: revoked, expired or already used): the sign-in is over. Anything else may pass: keep it, say try again.
    if (r.status === 400 || r.status === 401) { await markEnded(env, tid, `refresh HTTP ${r.status} ${String(d?.error || "").slice(0, 40)}`); throw new SignInEnded("ended"); }
    await release(); throw new Error(`Composio's sign-in service said HTTP ${r.status}. Try again in a minute.`);
  }
  // Rotation: always save the new refresh token (and keep the old one only if none came back).
  const nt = { ...t, access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: now() + (Number(d.expires_in) || 3600) * 1000, refreshed: (t.refreshed || 0) + 1 };
  const sealed = await sealSecret(env, JSON.stringify(nt));
  await env.DB.prepare("UPDATE composio_self SET sealed=?, lease=NULL, status='ok', updated_at=? WHERE tenant_id=?").bind(sealed, now(), tid).run();
  return keep(tid, nt, sealed);
}

// ---- the MCP client ----
const SID = new Map();   // tenant → mcp-session-id (this isolate; also kept in D1 so other isolates reuse it). "-" = initialized, no session id:
// Composio Connect answers initialize with 200 and NO mcp-session-id (stateless; 10-07, the composio-test rig never got one either), so the
// id is optional. Requiring it broke every Self-managed call ("Composio didn't start a connection (HTTP 200)": empty app list, Settings stuck).
const STATELESS = "-";
// How long one Connect call may take: listing / searching / schemas answer in a few seconds; running app actions can take longer.
const CALL_MS = (tool, env) => Number(env?.COMPOSIO_CONNECT_MS) || (tool === "COMPOSIO_MULTI_EXECUTE_TOOL" ? 30000 : 10000);   // env override: tests
async function getSid(env, tid) { if (SID.has(tid)) return SID.get(tid); const r = await readRow(env, tid).catch(() => null); const s = r?.mcp_sid || null; SID.set(tid, s); return s; }
async function setSid(env, tid, sid) { SID.set(tid, sid); await env.DB.prepare("UPDATE composio_self SET mcp_sid=? WHERE tenant_id=?").bind(sid, tid).run().catch(() => {}); }
// Rate limits (stage 6): the person's own Composio organization has its own budget, so each Self-managed workspace has its own gauge.
const GAUGES = new Map();
export const gaugeOf = (tid) => { let g = GAUGES.get(tid); if (!g) { if (GAUGES.size > 500) GAUGES.clear(); GAUGES.set(tid, (g = new RateGauge())); } return g; };
// A Connect call that only reads: search, schemas, and MANAGE_CONNECTIONS when every toolkit is a "list". MULTI_EXECUTE is a read only
// when the caller checked every action in it (opts.read: app_run's read-only check / multiExecute).
export const mcpReadOnly = (tool, args = {}, opts = {}) => tool === "COMPOSIO_SEARCH_TOOLS" || tool === "COMPOSIO_GET_TOOL_SCHEMAS" || (tool === "COMPOSIO_MULTI_EXECUTE_TOOL" && opts.read === true)
  || (tool === "COMPOSIO_MANAGE_CONNECTIONS" && Array.isArray(args?.toolkits) && args.toolkits.length > 0 && args.toolkits.every((t) => t?.action === "list"));
async function post(access, sid, body, gauge = null, ms = 10000) {
  const h = { authorization: `Bearer ${access}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTO };
  if (sid && sid !== STATELESS) h["mcp-session-id"] = sid;
  if (gauge) await gauge.pace("POST", "/mcp");
  let r;
  try { r = await fetch(MCP_URL, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); }
  catch (e) { return { status: 0, msg: null, sid: null, dropped: /timeout|timed out|aborted/i.test(`${e?.name} ${e?.message}`) ? "timeout" : "dropped" }; }
  gauge?.note(r.headers);
  const txt = await r.text().catch(() => "");
  let msg = null;
  if ((r.headers.get("content-type") || "").includes("event-stream")) { for (const line of txt.split("\n")) if (line.startsWith("data:")) { try { const m = JSON.parse(line.slice(5)); if (m.id !== undefined) msg = m; } catch {} } }
  else { try { msg = JSON.parse(txt); } catch {} }
  return { status: r.status, msg, sid: r.headers.get("mcp-session-id"), headers: r.headers };
}
// One Connect tool call → the tool's parsed result ({ data, error, successful }); throws Error on a failure (SignInEnded when the
// sign-in is over). A 401 gets one refresh and one retry; an MCP session Composio forgot (400/404) is started again.
// Stage 6 (composio-api.js rules): a 429 is retried with Retry-After within RETRY's bounds (Connect answers it before running anything);
// a timeout, a dropped connection or a 5xx on the tool call is retried only for a read (mcpReadOnly). For a write it may or may not have
// happened: never re-sent, the helper gets "MAY OR MAY NOT HAVE HAPPENED". opts.read: the caller checked a multi-execute is reads only.
export async function mcpCall(env, tid, tool, args = {}, opts = {}) {
  tool = String(tool || "");
  if (MCP_NEVER.has(tool) || !MCP_ALLOWED.has(tool)) throw new Error(`1Helm never calls ${tool || "that tool"} on Composio.`);
  let tok = await accessToken(env, tid), refreshed = false;
  const unauthorized = async () => { if (refreshed) { await markEnded(env, tid, "401 after refresh"); throw new SignInEnded("ended"); } refreshed = true; tok = await accessToken(env, tid, { force: true }); };
  const read = mcpReadOnly(tool, args, opts), gauge = gaugeOf(tid), what = `/mcp ${tool}`;
  let waited = 0, tries = 0, timeouts = 0;
  // → true when it waited and the call should go again; false when it's over (the caller throws).
  const again = async (ra, why) => { const ms = nextWait(tries, waited, ra); if (ms < 0) return false; tries++; waited += ms; rateLog(`${why}, retry ${tries} of ${RETRY.max}`, "POST", what, `waiting ${ms} ms`); await RETRY.sleep(ms); gauge.waited(); return true; };
  for (let attempt = 0; attempt < 5 + RETRY.max; attempt++) {
    let sid = await getSid(env, tid);
    if (!sid) {
      const i = await post(tok.access, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "1Helm", version: "1" } } }, gauge, CALL_MS("", env));
      if (i.status === 401) { await unauthorized(); continue; }
      if (i.status === 429 || i.dropped || i.status >= 500) { if (await again(i.status === 429 ? retryAfterMs(i.headers) : null, i.status === 429 ? "429 starting" : "no answer starting")) continue; if (i.status === 429) throw rateLimited(retryAfterMs(i.headers)); }   // nothing has run yet
      if (i.status !== 200) throw new Error(`Composio didn't start a connection (HTTP ${i.status}). Try again in a minute.`);
      sid = i.sid || STATELESS; await setSid(env, tid, sid);
      await post(tok.access, sid, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }).catch(() => {});
    }
    const r = await post(tok.access, sid, { jsonrpc: "2.0", id: now(), method: "tools/call", params: { name: tool, arguments: args || {} } }, gauge, CALL_MS(tool, env));
    if (r.status === 401) { await unauthorized(); continue; }
    if (r.status === 400 || r.status === 404) { await setSid(env, tid, null); continue; }   // the MCP session expired: start a new one
    if (r.status === 429) { if (await again(retryAfterMs(r.headers), "429")) continue; rateLog("429, gave up", "POST", what); throw rateLimited(retryAfterMs(r.headers)); }
    if (r.dropped || r.status >= 500 || r.status === 408) {
      const why = r.dropped === "timeout" ? "Composio didn't answer in time" : r.dropped ? "the connection to Composio dropped" : `Composio answered HTTP ${r.status}`;
      if (!read) { rateLog(`write not retried (${r.dropped || `HTTP ${r.status}`})`, "POST", what); throw unknownOutcome(why); }
      if (!(r.dropped === "timeout" && timeouts++) && (await again(null, r.dropped || `HTTP ${r.status}`))) continue;
      throw new Error(`${why}. Try again in a minute.`);
    }
    if (r.status !== 200) throw new Error(`Composio answered HTTP ${r.status}. Try again in a minute.`);
    if (r.msg?.error) throw new Error(String(r.msg.error.message || "Composio said no").slice(0, 300));
    const res = r.msg?.result || {}, text = (res.content || []).filter((c) => c?.type === "text").map((c) => c.text).join("");
    let d; try { d = JSON.parse(text); } catch { d = { data: text, successful: !res.isError }; }
    if (res.isError || d?.successful === false) throw new Error(String(d?.error || text || "Composio said no").slice(0, 300));
    return d;
  }
  throw new Error("Composio kept dropping the connection. Try again in a minute.");
}
export const mcpCaller = (env, tid) => (tool, args, opts) => mcpCall(env, tid, tool, args, opts);

// ---- which toolkits to ask about (Connect MCP lists connections per toolkit name; there's no "list everything") ----
// The common ones + every toolkit this workspace connected or used through 1Helm (composio_self_apps).
export const SELF_DEFAULT_APPS = ["gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "slack", "notion", "github", "linear", "outlook"];
export async function selfApps(env, tid) {
  try { await ddl(env); return ((await env.DB.prepare("SELECT toolkit FROM composio_self_apps WHERE tenant_id=? ORDER BY at").bind(tid).all()).results || []).map((r) => r.toolkit); } catch { return []; }
}
export async function rememberApps(env, tid, apps) {
  const list = [...new Set((apps || []).map((s) => String(s || "").toLowerCase()).filter((s) => /^[a-z0-9_]{2,64}$/.test(s)))];
  if (!list.length || !env?.DB) return;
  try { await ddl(env); for (const s of list) await env.DB.prepare("INSERT INTO composio_self_apps (tenant_id,toolkit,at) VALUES (?,?,?) ON CONFLICT(tenant_id,toolkit) DO NOTHING").bind(tid, s, now()).run(); } catch {}
}
// The last listing per workspace (this isolate, 15 s): Settings and a turn asking at once don't list twice. Dropped on any change.
export const LIST = new Map();
