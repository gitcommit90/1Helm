// Sign in with OpenRouter (Captain 10-08): an optional button in Settings → Use my own AI key. OAuth PKCE
// (https://openrouter.ai/docs/guides/overview/auth/oauth): no client registration, no app secret; OpenRouter mints a key the person
// controls (and can revoke in their OpenRouter account), and 1Helm then uses it exactly like a pasted key (src/byok.js).
//   1. GET /w/<slug>/byok/openrouter/start (a top-level navigation from the app, same tab everywhere: desktop, phone, installed app):
//      a random verifier (sealed with VAULT_KEY in D1, never sent anywhere but OpenRouter's exchange) + a random state, bound to this
//      account (the D1 row) and to this browser (an HttpOnly, Secure, SameSite=Lax cookie on /w/<slug>/byok/openrouter, 10 minutes).
//      → 302 https://openrouter.ai/auth?callback_url=<this host>/w/<slug>/byok/openrouter/callback&code_challenge=<S256>&
//        code_challenge_method=S256&state=<state>&key_label=1Helm
//   2. GET …/callback?code=…&state=…: the state row is deleted first (one use; a second callback finds nothing); the state must equal
//      the cookie and the row must belong to the signed-in account and be under 10 minutes old (OpenRouter's codes live 10 minutes).
//      Then the code is exchanged server-side (POST https://openrouter.ai/api/v1/auth/keys { code, code_verifier, S256 }).
//      The key is checked like a pasted key (byok.js KEY_RE) and sealed into byok_or_key (one per account), waiting for the person to
//      pick a model. → 302 back to the app's Settings → Use my own AI key with ?orauth=ok, or ?orauth=err&orwhy=<reason>.
//   3. Save (POST /api/byok/save { source: "openrouter", model, fast, ack }) runs byok.js's same path as a pasted key: the base is
//      https://openrouter.ai/api/v1, the key comes from byok_or_key (or the saved OpenRouter key, when only the models change), then
//      the connection test, the ZDR tick, and the same sealed byok row (source = 'openrouter'). byok_or_key is then emptied.
//   4. Disconnect = byok.js's /api/byok/delete (both the saved row and any waiting key go); /api/byok/openrouter/forget drops only a
//      waiting key. OpenRouter has no way for us to delete the key itself, so the panel links to it in their OpenRouter account.
// Never logged or returned: the code, the verifier, the key. The app only ever sees ••••last4 and the OpenRouter page for the key
// (https://openrouter.ai/keys/<sha256 of the key>, OpenRouter's own deep link; it only opens for the key's owner).
import { sealSecret, openSecret } from "./sentinel.js";
import { cappedResponseBytes, cappedResponseJson } from "./bounded-response.js";

export const OR_SOURCE = "openrouter";
export const OR_BASE = "https://openrouter.ai/api/v1";
export const OR_AUTH_URL = "https://openrouter.ai/auth";
export const OR_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
export const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OR_KEYS_PAGE = "https://openrouter.ai/settings/keys";
export const OR_TTL_MS = 10 * 60e3;
export const OR_COOKIE = "hc_orauth";
export const OR_KEY_LABEL = "1Helm";
const KEY_RE = /^[^\x00-\x1f\x7f]{1,4000}$/;   // byok.js's rule for a pasted key (one line, ≤ 4000), and not empty

const now = () => Date.now();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const challengeOf = async (verifier) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
export const keyHash = async (key) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameStr = (a, b) => { a = String(a); b = String(b); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ---- D1 (also migrations_045_byok_openrouter.sql; made here too so a fresh dev D1 just works) ----
export const OR_DDL = [
  "CREATE TABLE IF NOT EXISTS byok_or_pkce (state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, verifier TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS byok_or_key (tenant_id TEXT PRIMARY KEY, key_sealed TEXT NOT NULL, key_last4 TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
  "ALTER TABLE byok ADD COLUMN source TEXT NOT NULL DEFAULT ''",
];
let ddlDone = null;
export async function orDdl(env) {
  if (ddlDone === env.DB) return;
  for (const q of OR_DDL) await env.DB.prepare(q).run().catch((e) => { if (!/duplicate column|already exists/i.test(String(e?.message))) throw e; });
  ddlDone = env.DB;
}

// ---- 1. start ----
export const callbackUrl = (origin, slug) => `${origin}/w/${slug}/byok/openrouter/callback`;
export const cookiePath = (slug) => `/w/${slug}/byok/openrouter`;
export const orCookie = (slug, state, maxAge = OR_TTL_MS / 1000) => `${OR_COOKIE}=${state}; Path=${cookiePath(slug)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const orCookieOf = (req) => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${OR_COOKIE}=([A-Za-z0-9_-]{16,64})`))?.[1] || "";
// → { url, state }. The verifier stays in D1, sealed.
export async function orStart(env, t, origin) {
  await orDdl(env);
  const verifier = rand(48), state = rand(24), challenge = await challengeOf(verifier);
  await env.DB.prepare("DELETE FROM byok_or_pkce WHERE created_at<?").bind(now() - OR_TTL_MS).run();
  await env.DB.prepare("INSERT INTO byok_or_pkce (state,tenant_id,verifier,created_at) VALUES (?,?,?,?)").bind(state, t.id, await sealSecret(env, verifier), now()).run();
  const a = new URL(OR_AUTH_URL);
  for (const [k, v] of Object.entries({ callback_url: callbackUrl(origin, t.slug), code_challenge: challenge, code_challenge_method: "S256", state, key_label: OR_KEY_LABEL })) a.searchParams.set(k, v);
  return { url: a.toString(), state };
}

// ---- 2. the callback ----
// reasons (the app turns each into plain words): cancelled · expired · browser (not started in this browser/account) · exchange
// (OpenRouter refused the code) · network (OpenRouter didn't answer) · bad_key (an answer without a usable key)
export const OR_WHY = ["cancelled", "expired", "browser", "exchange", "network", "bad_key"];
// → { ok: true, last4 } | { error: <reason> }
export async function orFinish(env, { tenantId = "", code = "", state = "", cookieState = "", fetchImpl = globalThis.fetch } = {}) {
  await orDdl(env);
  // Denied / cancelled: OpenRouter sends no state then; the cookie says which sign-in it was, so that one is used up too.
  if (!code) {
    const s = state || cookieState;
    if (s) await env.DB.prepare("DELETE FROM byok_or_pkce WHERE state=? AND tenant_id=?").bind(s, tenantId).run();
    return { error: "cancelled" };
  }
  if (!state) return { error: "browser" };
  const row = await env.DB.prepare("SELECT * FROM byok_or_pkce WHERE state=?").bind(state).first();
  // One use: whoever deletes the row goes on; a replayed or parallel callback finds nothing.
  const del = row ? await env.DB.prepare("DELETE FROM byok_or_pkce WHERE state=?").bind(state).run() : null;
  if (!row || Number(del?.meta?.changes ?? 0) !== 1) return { error: "expired" };
  if (now() - Number(row.created_at) > OR_TTL_MS) return { error: "expired" };
  if (!sameStr(cookieState, state) || !tenantId || row.tenant_id !== tenantId) return { error: "browser" };
  let verifier; try { verifier = await openSecret(env, row.verifier); } catch { return { error: "expired" }; }
  let r;
  try {
    r = await fetchImpl(OR_KEYS_URL, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }), signal: AbortSignal.timeout(20000) });
  } catch { console.log("byok openrouter: exchange didn't answer"); return { error: "network" }; }
  if (!r.ok) { r.body?.cancel?.().catch?.(() => {}); console.log("byok openrouter: exchange refused", r.status); return { error: r.status >= 500 ? "network" : "exchange" }; }
  const d = await cappedResponseJson(r, 64 << 10).catch(() => null) || {};
  const key = typeof d?.key === "string" ? d.key.trim() : "";
  if (!KEY_RE.test(key)) { console.log("byok openrouter: exchange answered without a usable key"); return { error: "bad_key" }; }
  await env.DB.prepare(`INSERT INTO byok_or_key (tenant_id,key_sealed,key_last4,created_at) VALUES (?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET key_sealed=excluded.key_sealed, key_last4=excluded.key_last4, created_at=excluded.created_at`)
    .bind(row.tenant_id, await sealSecret(env, key), key.slice(-4), now()).run();
  return { ok: true, last4: key.slice(-4) };
}

// ---- the waiting key (signed in, models not picked yet) ----
export async function orPending(env, tid) { await orDdl(env); return env.DB.prepare("SELECT key_sealed, key_last4, created_at FROM byok_or_key WHERE tenant_id=?").bind(tid).first(); }
export async function orPendingKey(env, tid) { const r = await orPending(env, tid); if (!r) return null; try { return await openSecret(env, r.key_sealed); } catch { return null; } }
export async function orForget(env, tid) { await orDdl(env); await env.DB.prepare("DELETE FROM byok_or_key WHERE tenant_id=?").bind(tid).run(); }
// What the page shows about OpenRouter: a waiting key (last 4 + when), and the key's page in their OpenRouter account.
// row: the saved byok row (its key is used when it came from Sign in with OpenRouter).
export async function orView(env, tid, row) {
  const p = await orPending(env, tid).catch(() => null);
  const sealed = p?.key_sealed || (row?.source === OR_SOURCE ? row.key_sealed : "");
  let manage = OR_KEYS_PAGE; if (sealed) try { manage = `https://openrouter.ai/keys/${await keyHash(await openSecret(env, sealed))}`; } catch {}
  return { pending: p ? { last4: p.key_last4 || "", at: Number(p.created_at) || null } : null, manage };
}

// ---- the model list (public; no key needed): only models that can call tools, as 1Helm needs ----
let MODELS = null;   // { at, list }
const price = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null; };   // $ per million tokens
export async function orModels({ fetchImpl = globalThis.fetch } = {}) {
  if (MODELS && now() - MODELS.at < 15 * 60e3) return MODELS.list;
  const r = await fetchImpl(OR_MODELS_URL, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`models ${r.status}`);
  const bytes = await cappedResponseBytes(r, 8 << 20);
  if (!bytes) throw new Error("models list too big");
  const list = (JSON.parse(new TextDecoder().decode(bytes))?.data || []).filter((m) => typeof m?.id === "string" && (m.supported_parameters || []).includes("tools"))
    .map((m) => ({ id: m.id.slice(0, 200), name: String(m.name || m.id).slice(0, 120), ctx: Number(m.context_length) || 0, in: price(m.pricing?.prompt), out: price(m.pricing?.completion) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  MODELS = { at: now(), list };
  return list;
}
export const _resetModels = () => { MODELS = null; };
