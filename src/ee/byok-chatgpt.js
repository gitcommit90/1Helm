// Continue with ChatGPT (Captain 2026-11-02): OpenAI's "Sign in with ChatGPT" for open-source apps (https://developers.openai.com/siwc/token-sharing-open-source).
// It is a sibling of Sign in with OpenRouter (byok-openrouter.js) and of a pasted key (byok.js): the same $10 plan, the same metering of 1Helm's own parts, the same
// modes and the same privacy note (the AI part is under OpenAI's terms). What differs is the credential (an OAuth token set for the person's ChatGPT plan) and the API
// (POST https://api.openai.com/v1/responses, not /chat/completions), so byokChat (byok.js) hands a call to chatgptChat below and gets back a chat/completions-shaped
// answer. Nothing else in 1Helm changes.
//
// Sign in (the workspace is the "remote host" of OpenAI's self-hosted-vms guidance: it has its own stable host ID and is the only owner of refreshes):
//   1. GET /w/<slug>/byok/chatgpt/start (opened in a new tab by the app): a fresh state, nonce and PKCE verifier (sealed in D1), then a 302 to
//      https://auth.openai.com/api/accounts/authorize with client_id dynamic_agent_client (first registration; the issued oaiapp_ id afterwards), agent_name_hint=1Helm,
//      ext_agent_host_id (urn:uuid, made once per workspace), the scopes, resource, and redirect_uri http://127.0.0.1:1479/auth/callback.
//   2. OpenAI requires a 127.0.0.1 redirect and 1Helm is a website, so nothing listens there: the person's browser ends on a page that fails to load, with code, state and
//      client_id in its address. The app asks them to paste that address (POST /api/byok/chatgpt/finish { url }).
//   3. finish: the state must be one of this account's pending sign-ins (deleted first: one use, 10 minutes). access_denied stops there. The code is exchanged server-side
//      (form-encoded authorization_code grant to /api/accounts/oauth/token with the issued client_id, code_verifier, the same redirect_uri and resource). The ID token is
//      checked (JWKS signature, issuer, audience = issued client_id, expiry, nonce) and chatgpt.tokens.use.direct must be among the granted scopes.
//   4. The record (client id, subject, email, tokens, expiry, scopes, host id) is sealed with VAULT_KEY in byok_chatgpt. Tokens are never returned or logged.
//      Save (byok.js, source "chatgpt") then picks models, tests and writes the byok row with no key.
// Refresh: access tokens last an hour and refresh tokens rotate, so two refreshes with one refresh token would burn it. The refresh has one owner at a time: a lease in
// the D1 row (lock_id, lock_until) taken with a compare-and-set on ver. The winner refreshes and writes the new tokens together (ver + 1, lease cleared); the others wait
// for ver to change and read the new token. A winner that dies leaves a 45 second lease that others may take over. A terminal refresh error marks the row broken (tokens
// cleared, client id and host id kept) and the app asks the person to sign in again; a network or 5xx error keeps everything.
import { sealSecret, openSecret } from "../sentinel.js";
import { cacheKey } from "../model.js";
import { ByokError, fail, redact, readCapped, errorDetail, guardStream, firstEventOk } from "../byok.js";
import { parseCodexUsage, noteLimit, limitText, usageView, epochMs } from "./byok-usage.js";

export const CG_SOURCE = "chatgpt";
export const CG_BASE = "https://api.openai.com/v1";
export const CG_ISSUER = "https://auth.openai.com";
export const CG_AUTH_URL = "https://auth.openai.com/api/accounts/authorize";
export const CG_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const CG_DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration";
export const CG_JWKS_FALLBACK = "https://auth.openai.com/.well-known/jwks.json";
export const CG_REDIRECT = "http://127.0.0.1:1479/auth/callback";
export const CG_RESOURCE = "https://api.openai.com/v1";
export const CG_SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const CG_USE_SCOPE = "chatgpt.tokens.use.direct";
export const CG_DYNAMIC = "dynamic_agent_client";
export const CG_AGENT_NAME = "1Helm";
export const CG_USAGE_PAGE = "https://chatgpt.com/settings/usage";
export const CG_TTL_MS = 10 * 60e3;
export const CG_LEASE_MS = 45e3;
export const CG_EARLY_MS = 120e3;   // refresh when the access token has less than this left
const MAX_TOKEN_BYTES = 256 << 10;

const now = () => Date.now();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")), (c) => c.charCodeAt(0));
export const challengeOf = async (verifier) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));

// ---- D1 (also migrations_085_byok_chatgpt.sql; made here too so a fresh dev D1 just works) ----
export const CG_DDL = [
  "CREATE TABLE IF NOT EXISTS byok_chatgpt_host (tenant_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS byok_chatgpt_pkce (state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS byok_chatgpt (tenant_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', record_sealed TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL DEFAULT 0, ver INTEGER NOT NULL DEFAULT 0, lock_id TEXT NOT NULL DEFAULT '', lock_until INTEGER NOT NULL DEFAULT 0, broken INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)",
];
let ddlDone = null;
export async function cgDdl(env) {
  if (ddlDone === env.DB) return;
  for (const q of CG_DDL) await env.DB.prepare(q).run();
  ddlDone = env.DB;
}

// ---- OpenAI's published keys and endpoints (OpenID configuration) ----
let DISCO = null, JWKS = null;
export const _resetChatgpt = () => { DISCO = null; JWKS = null; };
const onAuthHost = (u) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "auth.openai.com"; } catch { return false; } };
async function getJson(url, fetchImpl, what) {
  const r = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (!r.ok) { r.body?.cancel?.().catch?.(() => {}); throw new Error(`${what} ${r.status}`); }
  const text = await r.text(); if (text.length > 1 << 20) throw new Error(`${what} too big`);
  return JSON.parse(text);
}
async function discovery(fetchImpl) {
  if (DISCO && now() - DISCO.at < 3600e3) return DISCO.d;
  let d = {}; try { d = await getJson(CG_DISCOVERY_URL, fetchImpl, "discovery"); } catch (e) { console.log("byok chatgpt: discovery", String(e?.message || e).slice(0, 60)); }
  DISCO = { at: now(), d: { jwks_uri: onAuthHost(d.jwks_uri) ? d.jwks_uri : CG_JWKS_FALLBACK, revocation_endpoint: onAuthHost(d.revocation_endpoint) ? d.revocation_endpoint : "" } };
  return DISCO.d;
}
async function jwk(kid, fetchImpl) {
  const find = (set) => (set?.keys || []).find((k) => (!kid || k.kid === kid));
  if (JWKS && now() - JWKS.at < 3600e3) { const k = find(JWKS.set); if (k) return k; }
  const set = await getJson((await discovery(fetchImpl)).jwks_uri, fetchImpl, "jwks");
  JWKS = { at: now(), set };
  return find(set);
}

// ---- the ID token ----
// → the claims, or throws Error(reason). aud is the issued client_id; nonce is this sign-in's.
export async function checkIdToken(token, { clientId, nonce, fetchImpl = globalThis.fetch, at = now() } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  let head, claims; try { head = JSON.parse(new TextDecoder().decode(unb64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1]))); } catch { throw new Error("unreadable"); }
  const algs = { RS256: [{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }], ES256: [{ name: "ECDSA", namedCurve: "P-256" }, { name: "ECDSA", hash: "SHA-256" }] };
  const a = algs[head.alg]; if (!a) throw new Error("unsupported alg");
  const k = await jwk(head.kid, fetchImpl); if (!k) throw new Error("no matching key");
  const key = await crypto.subtle.importKey("jwk", { ...k, alg: undefined, use: undefined, key_ops: undefined }, a[0], false, ["verify"]);
  const okSig = await crypto.subtle.verify(a[1], key, unb64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!okSig) throw new Error("bad signature");
  if (claims.iss !== CG_ISSUER) throw new Error("wrong issuer");
  if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(clientId)) throw new Error("wrong audience");
  if (!(Number(claims.exp) * 1000 > at - 60e3)) throw new Error("expired");
  if (nonce && claims.nonce !== nonce) throw new Error("wrong nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("no subject");
  return claims;
}
const scopesOf = (s) => String(s || "").split(/\s+/).filter(Boolean);
const claimsOf = (jwt) => { try { return JSON.parse(new TextDecoder().decode(unb64u(String(jwt).split(".")[1]))); } catch { return {}; } };

// ---- the host id: once per workspace, kept for good ----
export async function hostId(env, tid) {
  await cgDdl(env);
  const r = await env.DB.prepare("SELECT host_id FROM byok_chatgpt_host WHERE tenant_id=?").bind(tid).first();
  if (r?.host_id) return r.host_id;
  await env.DB.prepare("INSERT OR IGNORE INTO byok_chatgpt_host (tenant_id,host_id,created_at) VALUES (?,?,?)").bind(tid, `urn:uuid:${crypto.randomUUID()}`, now()).run();
  return (await env.DB.prepare("SELECT host_id FROM byok_chatgpt_host WHERE tenant_id=?").bind(tid).first()).host_id;
}

// ---- 1. start ----
// → { url }. The verifier stays in D1, sealed. A new start replaces this account's earlier unfinished one.
export async function cgStart(env, t) {
  await cgDdl(env);
  const verifier = rand(48), state = rand(24), nonce = rand(24), challenge = await challengeOf(verifier);
  const saved = await env.DB.prepare("SELECT client_id FROM byok_chatgpt WHERE tenant_id=?").bind(t.id).first(), clientId = saved?.client_id || "";
  await env.DB.prepare("DELETE FROM byok_chatgpt_pkce WHERE created_at<? OR tenant_id=?").bind(now() - CG_TTL_MS, t.id).run();
  await env.DB.prepare("INSERT INTO byok_chatgpt_pkce (state,tenant_id,verifier,nonce,client_id,created_at) VALUES (?,?,?,?,?,?)").bind(state, t.id, await sealSecret(env, verifier), nonce, clientId, now()).run();
  const a = new URL(CG_AUTH_URL);
  const q = { client_id: clientId || CG_DYNAMIC, ...(clientId ? {} : { agent_name_hint: CG_AGENT_NAME }), ext_agent_host_id: await hostId(env, t.id), response_type: "code", redirect_uri: CG_REDIRECT, scope: CG_SCOPE, resource: CG_RESOURCE,
    state, nonce, code_challenge: challenge, code_challenge_method: "S256" };
  for (const [k, v] of Object.entries(q)) a.searchParams.set(k, v);
  return { url: a.toString() };
}

// ---- 2. the pasted address ----
// reasons (the app says each in plain words): cancelled · expired · paste (not the address of a ChatGPT sign-in from this account) · exchange (OpenAI refused the code) ·
// network · verify (the ID token didn't check out) · no_use (the plan use permission wasn't given) · other_account (a different ChatGPT account than before)
export const CG_WHY = ["cancelled", "expired", "paste", "exchange", "network", "verify", "no_use", "other_account"];
export const CG_WHY_TEXT = {
  cancelled: "ChatGPT sign-in was cancelled. Nothing was saved.",
  expired: "That ChatGPT sign-in took too long or was already used. Try again.",
  paste: "That isn't the address from your ChatGPT sign-in. Copy the whole address from the page that didn't load, and paste it here.",
  exchange: "ChatGPT didn't accept the sign-in. Try again.",
  network: "ChatGPT didn't answer. Try again in a minute.",
  verify: "ChatGPT's answer couldn't be checked, so nothing was saved. Try again.",
  no_use: "ChatGPT sign-in worked, but you didn't allow 1Helm to use your ChatGPT plan. Try again and allow it.",
  other_account: "That's a different ChatGPT account than the one connected before. Sign out first, then sign in with the new account.",
};
export function parsePasted(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 8000) return null;
  let q; try { q = new URL(s).searchParams; } catch { try { q = new URL(s.includes("?") ? s : `http://127.0.0.1/?${s.replace(/^[?#]/, "")}`).searchParams; } catch { return null; } }
  return { code: q.get("code") || "", state: q.get("state") || "", error: q.get("error") || "", clientId: q.get("client_id") || "" };
}
const form = (o) => new URLSearchParams(o).toString();
async function postForm(url, o, fetchImpl) {
  const r = await fetchImpl(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form(o), signal: AbortSignal.timeout(20000) });
  let d = {}; try { const text = await readText(r.body); d = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, d };
}
async function readText(body) {
  if (!body) return "";
  const reader = body.getReader(), dec = new TextDecoder(); let n = 0, s = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; n += value.byteLength; if (n > MAX_TOKEN_BYTES) { reader.cancel().catch(() => {}); throw new Error("too big"); } s += dec.decode(value, { stream: true }); }
  return s;
}
// → { ok: true, email } | { error: <reason> }
export async function cgFinish(env, { tenantId = "", pasted = "", fetchImpl = globalThis.fetch } = {}) {
  await cgDdl(env);
  const p = parsePasted(pasted);
  if (!p?.state) return { error: "paste" };
  if (!tenantId) return { error: "paste" };
  // Only this account's pending sign-in is read or deleted, so another account's state can't remove it.
  const row = await env.DB.prepare("SELECT * FROM byok_chatgpt_pkce WHERE state=? AND tenant_id=?").bind(p.state, tenantId).first();
  // One use: whoever deletes the row goes on; a repeated paste finds nothing.
  const del = row ? await env.DB.prepare("DELETE FROM byok_chatgpt_pkce WHERE state=? AND tenant_id=?").bind(p.state, tenantId).run() : null;
  if (!row || Number(del?.meta?.changes ?? 0) !== 1) return { error: "expired" };
  if (now() - Number(row.created_at) > CG_TTL_MS) return { error: "expired" };
  if (p.error) return { error: p.error === "access_denied" ? "cancelled" : "exchange" };
  if (!p.code) return { error: "paste" };
  // A first sign-in is registered by OpenAI and answers with the issued client id; a later one must come back with the saved one.
  const clientId = row.client_id || p.clientId;
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(clientId) || (!row.client_id && clientId === CG_DYNAMIC)) return { error: "paste" };   // any issued id (oaiapp_… is only an example), never the registration entry point
  if (row.client_id && p.clientId && p.clientId !== row.client_id) return { error: "paste" };
  let verifier; try { verifier = await openSecret(env, row.verifier); } catch { return { error: "expired" }; }
  let r;
  try { r = await postForm(CG_TOKEN_URL, { grant_type: "authorization_code", client_id: clientId, code: p.code, code_verifier: verifier, redirect_uri: CG_REDIRECT, resource: CG_RESOURCE }, fetchImpl); }
  catch { console.log("byok chatgpt: exchange didn't answer"); return { error: "network" }; }
  if (!r.ok) { console.log("byok chatgpt: exchange refused", r.status, String(r.d?.error || "").slice(0, 40)); return { error: r.status >= 500 ? "network" : "exchange" }; }
  const d = r.d || {};
  if (typeof d.access_token !== "string" || typeof d.id_token !== "string" || typeof d.refresh_token !== "string") { console.log("byok chatgpt: exchange answered without tokens"); return { error: "verify" }; }
  let claims; try { claims = await checkIdToken(d.id_token, { clientId, nonce: row.nonce, fetchImpl }); } catch (e) { console.log("byok chatgpt: id token", String(e?.message || e).slice(0, 60)); return { error: "verify" }; }
  const scopes = scopesOf(d.scope || claimsOf(d.access_token).scope);
  if (!scopes.includes(CG_USE_SCOPE)) return { error: "no_use" };
  const before = await env.DB.prepare("SELECT subject, record_sealed FROM byok_chatgpt WHERE tenant_id=?").bind(tenantId).first();
  if (before?.subject && before.record_sealed && before.subject !== claims.sub) return { error: "other_account" };
  const rec = { client_id: clientId, issuer: CG_ISSUER, sub: claims.sub, email: typeof claims.email === "string" ? claims.email.slice(0, 200) : "", host_id: await hostId(env, tenantId), id_token: d.id_token, access_token: d.access_token,
    refresh_token: d.refresh_token, token_type: String(d.token_type || "Bearer"), expires_at: now() + (Number(d.expires_in) > 0 ? Number(d.expires_in) : 3600) * 1000, scopes, saved_at: now() };
  await env.DB.prepare(`INSERT INTO byok_chatgpt (tenant_id,client_id,subject,email,record_sealed,expires_at,ver,lock_id,lock_until,broken,updated_at) VALUES (?,?,?,?,?,?,1,'',0,0,?)
    ON CONFLICT(tenant_id) DO UPDATE SET client_id=excluded.client_id, subject=excluded.subject, email=excluded.email, record_sealed=excluded.record_sealed, expires_at=excluded.expires_at,
      ver=byok_chatgpt.ver+1, lock_id='', lock_until=0, broken=0, updated_at=excluded.updated_at`)
    .bind(tenantId, clientId, claims.sub, rec.email, await sealSecret(env, JSON.stringify(rec)), rec.expires_at, now()).run();
  return { ok: true, email: rec.email };
}

// ---- the record, and its refresh ----
export async function cgRow(env, tid) { await cgDdl(env); return env.DB.prepare("SELECT tenant_id, client_id, subject, email, expires_at, ver, broken, updated_at, record_sealed != '' AS has FROM byok_chatgpt WHERE tenant_id=?").bind(tid).first(); }
const TERMINAL = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
export const SIGN_AGAIN = "sign in with ChatGPT again";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// → the access token. Throws ByokError-shaped errors through `bad(detail, http)`.
export async function chatgptToken(env, tid, { fetchImpl = globalThis.fetch, force = false, waitMs = 250, maxWaitMs = 50e3 } = {}) {
  await cgDdl(env);
  const t0 = now();
  for (;;) {
    const row = await env.DB.prepare("SELECT * FROM byok_chatgpt WHERE tenant_id=?").bind(tid).first();
    if (!row || row.broken || !row.record_sealed) throw Object.assign(new Error(SIGN_AGAIN), { cg: "signin" });
    let rec; try { rec = JSON.parse(await openSecret(env, row.record_sealed)); } catch { throw Object.assign(new Error(SIGN_AGAIN), { cg: "signin" }); }
    const left = Number(row.expires_at) - now();
    if (!force && left > CG_EARLY_MS) return rec.access_token;
    // Take the lease (only while ver is what we read: someone may have refreshed since).
    const lock = rand(12);
    const got = await env.DB.prepare("UPDATE byok_chatgpt SET lock_id=?, lock_until=? WHERE tenant_id=? AND ver=? AND lock_until<?").bind(lock, now() + CG_LEASE_MS, tid, row.ver, now()).run();
    if (Number(got?.meta?.changes ?? 0) !== 1) {
      // Another refresh owns it (or just finished): wait for the new version, then read again.
      if (now() - t0 > maxWaitMs) { if (left > 0 && !force) return rec.access_token; throw Object.assign(new Error("refresh busy"), { cg: "busy" }); }
      await sleep(waitMs); force = false; continue;
    }
    let r;
    try { r = await postForm(CG_TOKEN_URL, { grant_type: "refresh_token", client_id: rec.client_id, refresh_token: rec.refresh_token, resource: CG_RESOURCE }, fetchImpl); }
    catch { await release(env, tid, lock); if (left > 0) return rec.access_token; throw Object.assign(new Error("ChatGPT didn't answer"), { cg: "network" }); }
    const d = r.d || {};
    if (!r.ok) {
      const code = String(d.error || d.error_code || d.code || "");
      if (r.status < 500 && r.status !== 429 && TERMINAL.has(code)) {
        await env.DB.prepare("UPDATE byok_chatgpt SET record_sealed='', broken=1, expires_at=0, ver=ver+1, lock_id='', lock_until=0, updated_at=? WHERE tenant_id=? AND lock_id=?").bind(now(), tid, lock).run();
        console.log("byok chatgpt: refresh token unusable", code);
        throw Object.assign(new Error(SIGN_AGAIN), { cg: "signin" });
      }
      await release(env, tid, lock);
      console.log("byok chatgpt: refresh failed", r.status, code.slice(0, 40));
      if (left > 0 && !force) return rec.access_token;
      throw Object.assign(new Error(code === "invalid_client" ? "ChatGPT refused the sign-in settings" : "ChatGPT didn't accept the refresh"), { cg: r.status >= 500 ? "network" : "refresh" });
    }
    const scopes = scopesOf(d.scope || claimsOf(d.access_token).scope);
    if (typeof d.access_token !== "string" || typeof d.refresh_token !== "string") { await release(env, tid, lock); throw Object.assign(new Error("ChatGPT answered without tokens"), { cg: "refresh" }); }
    if (!scopes.includes(CG_USE_SCOPE)) {
      await env.DB.prepare("UPDATE byok_chatgpt SET record_sealed='', broken=1, expires_at=0, ver=ver+1, lock_id='', lock_until=0, updated_at=? WHERE tenant_id=? AND lock_id=?").bind(now(), tid, lock).run();
      throw Object.assign(new Error(SIGN_AGAIN), { cg: "signin" });
    }
    // The access token, expiry, scopes and the rotated refresh token are replaced together.
    const next = { ...rec, access_token: d.access_token, refresh_token: d.refresh_token, id_token: typeof d.id_token === "string" ? d.id_token : rec.id_token, token_type: String(d.token_type || rec.token_type || "Bearer"),
      expires_at: now() + (Number(d.expires_in) > 0 ? Number(d.expires_in) : 3600) * 1000, scopes, saved_at: now() };
    const w = await env.DB.prepare("UPDATE byok_chatgpt SET record_sealed=?, expires_at=?, ver=ver+1, lock_id='', lock_until=0, updated_at=? WHERE tenant_id=? AND lock_id=?").bind(await sealSecret(env, JSON.stringify(next)), next.expires_at, now(), tid, lock).run();
    if (Number(w?.meta?.changes ?? 0) !== 1) throw Object.assign(new Error(SIGN_AGAIN), { cg: "signin" });   // signed out while it refreshed
    return next.access_token;
  }
}
const release = (env, tid, lock) => env.DB.prepare("UPDATE byok_chatgpt SET lock_id='', lock_until=0 WHERE tenant_id=? AND lock_id=?").bind(tid, lock).run().catch(() => {});

// ---- sign out ----
// Revokes the refresh token at OpenAI (twice at most on a network error or 5xx), then deletes the record either way. Pending sign-ins go too. The host id stays.
export async function cgForget(env, tid, { fetchImpl = globalThis.fetch, revoke = true } = {}) {
  await cgDdl(env);
  const row = await env.DB.prepare("SELECT * FROM byok_chatgpt WHERE tenant_id=?").bind(tid).first();
  if (revoke && row?.record_sealed) {
    try {
      const rec = JSON.parse(await openSecret(env, row.record_sealed)), ep = (await discovery(fetchImpl)).revocation_endpoint;
      if (ep) for (let i = 0; i < 2; i++) {
        try { const r = await postForm(ep, { token: rec.refresh_token, token_type_hint: "refresh_token", client_id: rec.client_id }, fetchImpl); if (r.status < 500) break; } catch {}
      }
    } catch (e) { console.log("byok chatgpt: revoke", String(e?.message || e).slice(0, 60)); }
  }
  await env.DB.prepare("DELETE FROM byok_chatgpt WHERE tenant_id=?").bind(tid).run();
  await env.DB.prepare("DELETE FROM byok_chatgpt_pkce WHERE tenant_id=?").bind(tid).run();
}
// What the page shows: the signed-in account (email) while a usable record exists, and whether the person has to sign in again.
export async function cgView(env, tid, row) {
  const r = await cgRow(env, tid).catch(() => null);
  const saved = row?.source === CG_SOURCE;
  return { connected: !!r?.has && !r.broken, email: r?.email || "", signin_again: !!r?.broken, pending: !!r?.has && !r.broken && !saved ? { email: r.email || "", at: Number(r.updated_at) || null } : null, manage: CG_USAGE_PAGE };
}

// ---- plan usage (byok-usage.js) ----
// The ChatGPT account id from the sign-in's own tokens (never returned or logged), "" when none is there.
export async function chatgptAccountId(env, tid) {
  const row = await env.DB.prepare("SELECT record_sealed FROM byok_chatgpt WHERE tenant_id=?").bind(tid).first();
  if (!row?.record_sealed) return "";
  let rec; try { rec = JSON.parse(await openSecret(env, row.record_sealed)); } catch { return ""; }
  for (const jwt of [rec.id_token, rec.access_token]) {
    const c = claimsOf(jwt), a = c?.["https://api.openai.com/auth"] || {};
    const id = a.chatgpt_account_id || c?.chatgpt_account_id || "";
    if (typeof id === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(id)) return id;
  }
  return "";
}
// GET https://chatgpt.com/backend-api/wham/usage with the connection's own access token. → { windows, plan } or throws an Error with .why ("http_401", "network", ...).
export const CG_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export async function chatgptUsage(env, tid, { fetchImpl = globalThis.fetch } = {}) {
  let token; try { token = await chatgptToken(env, tid, { fetchImpl, maxWaitMs: 5e3 }); } catch (e) { throw Object.assign(new Error("no token"), { why: e?.cg === "signin" ? "signin" : "network" }); }
  const accountId = await chatgptAccountId(env, tid).catch(() => "");
  let r;
  try { r = await fetchImpl(CG_USAGE_URL, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10e3), headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "1Helm", ...(accountId ? { "chatgpt-account-id": accountId } : {}) } }); }
  catch (e) { throw Object.assign(new Error("network"), { why: e?.name === "TimeoutError" ? "timeout" : "network" }); }
  if (!r.ok) { r.body?.cancel?.().catch?.(() => {}); throw Object.assign(new Error(`http ${r.status}`), { why: `http_${r.status}`, permanent: r.status < 500 && r.status !== 429 }); }
  let text; try { text = (await r.text()).slice(0, 256 << 10); } catch { throw Object.assign(new Error("network"), { why: "network" }); }
  let j; try { j = JSON.parse(text); } catch { throw Object.assign(new Error("not json"), { why: "none" }); }
  return { ...parseCodexUsage(j), source: "wham" };
}
// A call that ran into the ChatGPT usage limit: the words for the reply, and a note so the page shows it. j: the parsed error body (any reset time in it is used).
async function limitReply(cfg, j) {
  const h = cfg.chatgptHandle, e = j?.error || {};
  const secs = Number(e.resets_in_seconds ?? e.reset_after_seconds ?? e.retry_after_seconds), at = epochMs(e.resets_at ?? e.reset_at) || (secs > 0 ? now() + secs * 1000 : null);
  let window = "", resets_at = at;
  if (h) {
    try {
      const w = (await usageView(h.env, h.tid, "chatgpt")).windows.filter((x) => x.used >= 99.5).sort((x, y) => (y.resets_at || 0) - (x.resets_at || 0))[0];
      if (w) { window = w.id; resets_at = resets_at || w.resets_at; }
    } catch {}
    await noteLimit(h.env, h.tid, "chatgpt", { window, resets_at });
  }
  return limitText("chatgpt", { window, resets_at, host: "ChatGPT" });
}

// ---- models ----
// GET /v1/models with the token: keep visibility "list", show display_name, send slug. Returned as an OpenAI-style list the picker code already reads.
export async function chatgptModelsJson(cfg, { fetchImpl = globalThis.fetch, signal = null } = {}) {
  const go = async (force) => {
    const token = await tokenOf(cfg, { fetchImpl, force });
    return fetchImpl(`${CG_BASE}/models`, { method: "GET", redirect: "manual", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "1Helm" } });
  };
  let r; try { r = await go(false); if (r.status === 401) { r.body?.cancel?.().catch?.(() => {}); r = await go(true); } }
  catch (e) { if (e?.byok) throw e; throw fail(cfg, `couldn't connect: ${redact(e?.message, "", 80)}`); }
  if (!r.ok) { const { detail } = await errorDetail(cfg, r); throw fail(cfg, chatgptDetail(r.status, null, detail), r.status); }
  const text = await readCapped(cfg, r.body, 4 << 20, "model list");
  let j; try { j = JSON.parse(text); } catch { throw fail(cfg, "the model list wasn't JSON"); }
  const list = (Array.isArray(j?.models) ? j.models : []).filter((m) => m && m.visibility === "list" && typeof m.slug === "string" && m.slug);
  return { data: list.map((m) => ({ id: m.slug, name: String(m.display_name || m.slug), context_length: m.context_window ?? m.context_length,
    supported_reasoning_efforts: (m.supported_reasoning_levels || m.supported_reasoning_efforts || []).map((x) => (typeof x === "string" ? x : x?.effort)).filter(Boolean) })) };
}
// The picker's list for Settings: [{ id, name, ctx, in, out }] like OpenRouter's, with no prices.
const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export async function cgModels(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const j = await chatgptModelsJson(cfg, { fetchImpl });
  return j.data.map((m) => ({ id: m.id.slice(0, 200), name: m.name.slice(0, 120), ctx: Number(m.context_length) || 0, in: null, out: null, efforts: [...new Set((m.supported_reasoning_efforts || []).filter((x) => LEVELS.includes(x)))] })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- the Responses API ----
async function tokenOf(cfg, { fetchImpl, force = false }) {
  const h = cfg.chatgptHandle; if (!h) throw new ByokError("Your AI service isn't set up yet. Sign in with ChatGPT in Settings → AI services.");
  try { return await chatgptToken(h.env, h.tid, { fetchImpl, force }); }
  catch (e) {
    if (e?.cg === "signin") throw fail(cfg, "your ChatGPT sign-in ended, so sign in with ChatGPT again", 401);
    if (e?.cg) throw fail(cfg, e.message);
    throw e;
  }
}
// The plain words for an error from OpenAI (status, structured code, short detail). No token or ids go into it.
export function chatgptDetail(status, code, detail = "", param = "") {
  const c = String(code || "");
  if (c === "subscription_sharing_usage_limit_exceeded") return `you've reached your ChatGPT usage limit. [Manage usage](${CG_USAGE_PAGE})`;
  if (c === "subscription_sharing_usage_unavailable") return "ChatGPT couldn't check your usage just now. Try again in a little while";
  if (c === "subscription_sharing_user_not_eligible") return "your ChatGPT plan can't be used this way";
  if (c === "subscription_sharing_unsupported_capability") return `ChatGPT didn't accept part of the request${param ? ` (${redact(param, "", 60)})` : ""}`;
  if (c === "subscription_sharing_route_not_supported") return "ChatGPT didn't accept that request";
  if (c === "subscription_sharing_invalid_user" || status === 401) return "ChatGPT rejected the sign-in. Try signing in with ChatGPT again";
  if (c === "subscription_sharing_user_unavailable" || status === 503) return "ChatGPT isn't available right now. Try again in a little while";
  if (status === 403) return "ChatGPT didn't allow this request";
  return `error ${status}${detail ? `: ${detail}` : ""}`;
}
const RESPONSES_URL = `${CG_BASE}/responses`;
const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p?.type === "text" || p?.type === "input_text" ? p.text || "" : "")).join("") : c == null ? "" : String(c));
export const callId = (id) => String(id ?? "call").slice(0, 64);
// A chat/completions body (what the rest of 1Helm builds) → a Responses request for ChatGPT plan use. Unsupported fields are never sent: max_output_tokens, temperature, top_p, metadata, user,
// previous_response_id and the others OpenAI lists; system-role items are not sent either (leading system messages become `instructions`, later ones developer messages).
export function responsesBody(body, model, { effort = null, cacheKey: pck = null } = {}) {
  const instr = [], input = []; let lead = true;
  for (const m of body.messages || []) {
    if (m.role === "system" || m.role === "developer") {
      const t = text(m.content);
      if (lead) { if (t) instr.push(t); } else if (t) input.push({ role: "developer", content: t });
      continue;
    }
    lead = false;
    if (m.role === "user") {
      if (Array.isArray(m.content) && m.content.some((p) => p?.type === "image_url")) {
        input.push({ role: "user", content: m.content.map((p) => (p?.type === "image_url" ? { type: "input_image", image_url: typeof p.image_url === "string" ? p.image_url : p.image_url?.url } : { type: "input_text", text: text([p]) })).filter((p) => p.image_url || p.text) });
      } else input.push({ role: "user", content: text(m.content) });
    } else if (m.role === "assistant") {
      const t = text(m.content); if (t) input.push({ role: "assistant", content: t });
      for (const c of m.tool_calls || []) input.push({ type: "function_call", call_id: callId(c.id), name: c.function?.name, arguments: c.function?.arguments || "{}" });
    } else if (m.role === "tool") input.push({ type: "function_call_output", call_id: callId(m.tool_call_id), output: text(m.content) });
  }
  const out = { model, store: false, stream: true, input: input.length ? input : [{ role: "user", content: "" }] };
  if (instr.length) out.instructions = instr.join("\n\n");
  if (pck) out.prompt_cache_key = pck;   // the field the Codex client sends on this same endpoint (codex-api common.rs ResponsesApiRequest)
  const tools = (body.tools || []).filter((t) => t?.type === "function" && t.function?.name).map((t) => ({ type: "function", name: t.function.name, description: t.function.description || "", parameters: t.function.parameters || { type: "object", properties: {} }, strict: false }));
  if (tools.length) {
    out.tools = tools;
    const tc = body.tool_choice;
    if (tc === "auto" || tc === "none" || tc === "required") out.tool_choice = tc;
    else if (tc?.type === "function" && tc.function?.name) out.tool_choice = { type: "function", name: tc.function.name };
  }
  if (effort && effort !== "default") out.reasoning = { effort };
  const rf = body.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) out.text = { format: { type: "json_schema", name: String(rf.json_schema.name || "reply").slice(0, 64), schema: rf.json_schema.schema, strict: rf.json_schema.strict === true } };
  else if (rf?.type === "json_object") out.text = { format: { type: "json_object" } };
  return out;
}

export const sseLines = (stream) => {   // a stream of bytes → Responses events { event, data }
  const reader = stream.getReader(), dec = new TextDecoder(); let buf = "";
  return { async next() {
    for (;;) {
      const i = buf.indexOf("\n\n");
      if (i >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data || data === "[DONE]") continue;
        try { return JSON.parse(data); } catch { continue; }
      }
      const { value, done } = await reader.read();
      if (done) { if (buf.trim()) { const tail = buf; buf = ""; const data = tail.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"); try { return JSON.parse(data); } catch { return null; } } return null; }
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    }
  }, cancel: (x) => reader.cancel(x) };
};
// The Responses event stream → a chat.completion.chunk SSE stream. Only response.completed ends it well; response.failed and an `error` event throw ByokError (before any output
// that lets byokChatChain use the next model), response.incomplete ends with finish_reason "length" (or "content_filter"), and a stream that stops before a terminal event throws.
// opts (used by byok-opencode.js, defaults keep ChatGPT exactly as before): detail(status, code, message, param) words an error; usage(rawUsage) → extra fields merged into the final usage (ChatGPT: cost 0).
export function translateStream(cfg, body, model, opts = {}) {
  const detailOf = opts.detail || ((st, code, msg, param) => chatgptDetail(st, code, msg, param)), extraUsage = opts.usage || (() => ({ cost: 0 }));
  const ev = sseLines(body), enc = new TextEncoder(), calls = new Map(); let nTools = 0, sentAny = false, done = false;
  const chunk = (delta, finish = null, extra = {}) => enc.encode(`data: ${JSON.stringify({ object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  const callOf = (e) => calls.get(e.item_id) || calls.get(`o${e.output_index}`);
  return new ReadableStream({
    async pull(c) {
      if (done) { c.close(); return; }
      for (;;) {
        const e = await ev.next();
        if (!e) throw fail(cfg, "it stopped sending in the middle of the answer");
        switch (e.type) {
          case "response.output_text.delta": if (e.delta) { sentAny = true; c.enqueue(chunk({ content: String(e.delta) })); return; } break;
          case "response.reasoning_summary_text.delta": case "response.reasoning_text.delta": if (e.delta) { c.enqueue(chunk({ reasoning: String(e.delta) })); return; } break;
          case "response.output_item.added": if (e.item?.type === "function_call") {
            const k = { index: nTools++, args: false }; calls.set(e.item.id || `o${e.output_index}`, k); calls.set(`o${e.output_index}`, k); sentAny = true;
            c.enqueue(chunk({ tool_calls: [{ index: k.index, id: callId(e.item.call_id || e.item.id), type: "function", function: { name: e.item.name, arguments: "" } }] })); return;
          } break;
          case "response.function_call_arguments.delta": { const k = callOf(e); if (k && e.delta) { k.args = true; c.enqueue(chunk({ tool_calls: [{ index: k.index, function: { arguments: String(e.delta) } }] })); return; } break; }
          case "response.function_call_arguments.done": case "response.output_item.done": {
            const k = callOf(e), a = e.type === "response.output_item.done" ? (e.item?.type === "function_call" ? e.item.arguments : null) : e.arguments;
            if (k && !k.args && typeof a === "string" && a) { k.args = true; c.enqueue(chunk({ tool_calls: [{ index: k.index, function: { arguments: a } }] })); return; }
            break;
          }
          case "response.completed": case "response.incomplete": {
            const r = e.response || {}, u = r.usage || {}, inc = e.type === "response.incomplete";
            const finish = inc ? (r.incomplete_details?.reason === "content_filter" ? "content_filter" : "length") : nTools ? "tool_calls" : "stop";
            done = true;
            c.enqueue(chunk({}, finish, { usage: { prompt_tokens: u.input_tokens || 0, completion_tokens: u.output_tokens || 0, total_tokens: u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0),
              prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens || 0 }, completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens || 0 }, ...extraUsage(u) } }));
            c.enqueue(enc.encode("data: [DONE]\n\n")); return;
          }
          case "response.failed": case "error": {
            const er = e.type === "error" ? e : e.response?.error || {};
            throw fail(cfg, detailOf(Number(er.status) || 0, er.code, redact(er.message || "", "", 120), er.param), Number(er.status) || 0);
          }
          default: break;
        }
      }
    },
    cancel(x) { return ev.cancel(x); },
  });
}
// Reads a translated stream into one chat.completion (for calls that don't stream: Test connection, chores).
export async function collect(cfg, stream, model, { keepUsage = false } = {}) {
  const reader = stream.getReader(), dec = new TextDecoder(); let buf = "", content = "", finish = "stop", usage = {}; const tools = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
      if (!line.startsWith("data:") || line.endsWith("[DONE]")) continue;
      const j = JSON.parse(line.slice(5)), ch = j.choices?.[0], d = ch?.delta || {};
      if (d.content) content += d.content;
      for (const t of d.tool_calls || []) { const x = (tools[t.index] ||= { id: t.id, type: "function", function: { name: "", arguments: "" } }); if (t.id) x.id = t.id; if (t.function?.name) x.function.name = t.function.name; if (t.function?.arguments) x.function.arguments += t.function.arguments; }
      if (ch?.finish_reason) finish = ch.finish_reason;
      if (j.usage) usage = j.usage;
    }
  }
  return { object: "chat.completion", model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: content || (tools.length ? null : ""), ...(tools.length ? { tool_calls: tools.filter(Boolean) } : {}) } }], usage: keepUsage ? usage : { ...usage, cost: 0 } };
}
// The one call to ChatGPT plan use. Same contract as byokChat: SSE chunks when body.stream, else JSON, usage.cost 0. A 401 refreshes the token once and tries again.
// Prompt caching: a chat turn's key is cacheKey(task id), the same value the OpenRouter path sends. A call with no task (a chore, a title, a background or memory job) gets a stable key of its account and purpose.
export const chatgptCacheKey = (cfg, session = null, purpose = "chat") => cacheKey(session ? String(session) : `1helm-${cfg?.chatgptHandle?.tid || cfg?.tenantId || "account"}-${purpose || "chat"}`);
// The headers Codex sends on a Responses call (codex-api build_session_headers: `session-id` and `thread-id`, plus `x-client-request-id`); its source says "ChatGPT derives cache affinity from the Responses session-id header". Codex also sends the prompt_cache_key equal to the session id, so all four carry the same value.
export const chatgptSessionHeaders = (key) => ({ "session-id": key, "thread-id": key, "x-client-request-id": key });
export async function chatgptChat(cfg, body, { signal = null, fetchImpl = globalThis.fetch, model, effort = null, timeouts = {}, session = null, purpose = null } = {}) {
  const pck = chatgptCacheKey(cfg, session, purpose);
  const req = responsesBody(body, model, { effort, cacheKey: pck });
  const accountId = await chatgptAccountId(cfg.chatgptHandle?.env, cfg.chatgptHandle?.tid).catch(() => "");   // Codex sends chatgpt-account-id on every call
  const FIRST = timeouts.first ?? 120e3;
  let r;
  for (let attempt = 0; ; attempt++) {
    const token = await tokenOf(cfg, { fetchImpl, force: attempt > 0 });
    const ac = new AbortController(), onAbort = () => ac.abort(signal?.reason);
    if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener("abort", onAbort, { once: true }); }
    const timer = setTimeout(() => ac.abort(new Error("first-byte timeout")), FIRST);
    try {
      r = await fetchImpl(RESPONSES_URL, { method: "POST", redirect: "manual", signal: ac.signal, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream", "user-agent": "1Helm", ...chatgptSessionHeaders(pck), ...(accountId ? { "chatgpt-account-id": accountId } : {}) }, body: JSON.stringify(req) });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw fail(cfg, ac.signal.aborted ? `no answer within ${Math.round(FIRST / 1000)} seconds` : `couldn't connect${e?.message ? `: ${redact(e.message, "", 100)}` : ""}`);
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
    if (r.status === 401 && attempt === 0) { r.body?.cancel?.().catch?.(() => {}); continue; }
    break;
  }
  if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch?.(() => {}); throw fail(cfg, `error ${r.status || 302}: it redirected to another address`, r.status || 302); }
  if (!r.ok) {
    const { raw, detail } = await errorDetail(cfg, r);
    let code = "", param = ""; try { const j = JSON.parse(raw); code = j?.error?.code || ""; param = j?.error?.param || ""; } catch {}
    if (code === "subscription_sharing_usage_limit_exceeded") { let j = null; try { j = JSON.parse(raw); } catch {} throw Object.assign(new ByokError(await limitReply(cfg, j), r.status, chatgptDetail(r.status, code)), { limit: true }); }
    throw fail(cfg, chatgptDetail(r.status, code, detail, param), r.status);
  }
  if (!r.body) throw fail(cfg, "an empty answer");
  const translated = new Response(translateStream(cfg, guardStream(cfg, r.body, signal), model), { status: 200, headers: { "content-type": "text/event-stream" } });
  if (body.stream) return new Response(await firstEventOk(cfg, translated.body), { status: 200, headers: { "content-type": "text/event-stream" } });
  const j = await collect(cfg, translated.body, model);
  return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
}
