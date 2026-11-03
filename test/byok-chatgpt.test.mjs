// node --import ./test/stubs/register.mjs test/byok-chatgpt.test.mjs
// Continue with ChatGPT (src/byok-chatgpt.js + the own key path in src/byok.js), against a fake auth.openai.com and a fake api.openai.com (no real calls). Checks:
//   1. start: the authorize URL (dynamic_agent_client then the issued id, host id, scopes, resource, 127.0.0.1 redirect, S256); the verifier sealed in D1; the host id kept; a cross-site start refused.
//   2. the pasted address: wrong/foreign/used states, access_denied, the exchange's form, ID token checks (signature, issuer, audience, expiry, nonce), the scope, a different account.
//   3. the record: sealed, never in a response or log; the page sees the email only.
//   4. refresh: one owner at a time (five callers, one refresh), rotation saved together, terminal errors need a new sign-in, a network error keeps a valid token.
//   5. the Responses translation both ways (system → instructions, tools, tool calls, no unsupported field; text, tool calls, usage, failed, usage limit, cut-off streams).
//   6. the whole path: Save with source "chatgpt" (test + row with no key), loadByok, chat through byokChat, a 401 refreshes once, the model list, Disconnect revokes and clears.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { byokApi, loadByok, byokChat, ByokError } from "../src/byok.js";
import { chatgptToken, checkIdToken, responsesBody, translateStream, parsePasted, challengeOf, hostId, _resetChatgpt, CG_REDIRECT, CG_SCOPE, CG_TOKEN_URL, CG_AUTH_URL } from "../src/ee/byok-chatgpt.js";
import { openSecret } from "../src/sentinel.js";
import { saveOwn, _resetLists } from "../src/ee/byok-custom.js";
import { sealSecret } from "../src/sentinel.js";

let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const logs = []; for (const k of ["log", "error", "warn", "info"]) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map((x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ")); if (process.env.VERBOSE || /^ok \d/.test(String(a[0]))) o(...a); }; }

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', past_due_since INTEGER, stripe_customer TEXT DEFAULT '',
  stripe_subscription TEXT DEFAULT '', sub_status TEXT, plan TEXT, updated_at INTEGER, onboarding_completed INTEGER DEFAULT 1);
  INSERT INTO tenants (id, slug, owner_user_id, helper_name, first_name, plan) VALUES ('t1','ck1','u1','Ollie','Sam','byok'), ('t2','ck2','u2','Ada','Lee','byok');
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','sam@example.com'), ('u2','lee@example.com');
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER);`);
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0069_byok_chatgpt", "0038_046_ai_privacy", "0064_custom_models", "0065_custom_models_own_key", "0068_byok_effort"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", ENV_NAME: "test", MEMORY: "off",
  VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64"), LEDGER: { idFromName: (x) => x, get: () => ({}) } };
const sha = async (s) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");
const TOK1 = "ab".repeat(16);
d1.prepare("INSERT INTO sessions VALUES (?,?,?)").run(await sha(TOK1), "u1", Date.now() + 3600e3);

// ---- the fake OpenAI ----
const b64u = (b) => Buffer.from(b).toString("base64url");
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwkPub = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const sign = async (claims, key = keys.privateKey, kid = "k1") => { const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), p = b64u(JSON.stringify(claims)); return `${h}.${p}.${b64u(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`))))}`; };
const ISSUED = "app_Test-client.123";   // any issued id is accepted: "oaiapp_…" is only an example in OpenAI's docs
const SECRET_BITS = ["AT-SECRET", "RT-SECRET", "CODE-SECRET"];
const authz = new Map();   // code → { challenge, nonce, client_id }
const plainCalls = [], ex = [], refreshes = [], revokes = [], responses = [], modelCalls = [];
const mode = { exchange: "ok", scope: CG_SCOPE, sub: "user-1", email: "sam@chat.example", aud: ISSUED, exp: 3600, nonce: null, signer: "ok", refresh: "ok", refreshDelay: 0, resp: "ok", fail401: 0, fetchModels: "ok", expiresIn: 3600 };
let seq = 0, curAT = null, curRT = null;
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const rsse = (evs) => new Response(evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
const form = (init) => Object.fromEntries(new URLSearchParams(String(init.body)));
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u === "https://auth.openai.com/.well-known/openid-configuration") return jres({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/.well-known/jwks.json", revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" });
  if (u === "https://auth.openai.com/.well-known/jwks.json") return jres({ keys: [jwkPub] });
  if (u === CG_TOKEN_URL) {
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "manual"); assert.match(init.headers["content-type"], /x-www-form-urlencoded/);
    const f = form(init);
    if (f.grant_type === "authorization_code") {
      ex.push(f);
      if (mode.exchange === "down") throw new TypeError("fetch failed");
      if (mode.exchange === "500") return jres({ error: "boom" }, 500);
      const want = authz.get(f.code);
      if (!want || (await challengeOf(f.code_verifier)) !== want.challenge || f.redirect_uri !== CG_REDIRECT || f.resource !== "https://api.openai.com/v1" || f.client_id !== ISSUED) return jres({ error: "invalid_grant" }, 400);
      authz.delete(f.code);
      curAT = `AT-SECRET-${++seq}`; curRT = `RT-SECRET-${seq}`;
      const now = Math.floor(Date.now() / 1000), key = mode.signer === "bad" ? other.privateKey : keys.privateKey;
      const id = await sign({ iss: "https://auth.openai.com", aud: mode.aud, sub: mode.sub, email: mode.email, exp: now + mode.exp, iat: now, nonce: mode.nonce ?? want.nonce }, key);
      return jres({ access_token: curAT, refresh_token: curRT, id_token: id, token_type: "Bearer", expires_in: mode.expiresIn, scope: mode.scope, earliest_refresh_at: now + 1800 });
    }
    if (f.grant_type === "refresh_token") {
      refreshes.push(f);
      if (mode.refreshDelay) await new Promise((r) => setTimeout(r, mode.refreshDelay));
      if (mode.refresh === "down") throw new TypeError("fetch failed");
      if (mode.refresh === "reused" || f.refresh_token !== curRT) return jres({ error: "refresh_token_reused" }, 400);
      if (mode.refresh === "500") return jres({ error: "server_error" }, 500);
      curAT = `AT-SECRET-${++seq}`; curRT = `RT-SECRET-${seq}`;
      return jres({ access_token: curAT, refresh_token: curRT, token_type: "Bearer", expires_in: 3600, scope: CG_SCOPE });
    }
  }
  if (u === "https://auth.openai.com/api/accounts/oauth/revoke") { revokes.push(form(init)); return new Response("", { status: 200 }); }
  if (u === "https://old.example.com/v1/models") return jres({ data: [{ id: "m1", supported_reasoning_efforts: ["low", "high"] }, { id: "m2" }] });
  if (u === "https://old.example.com/v1/chat/completions") { const body = JSON.parse(init.body); plainCalls.push(body); return jres({ model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }], usage: {} }); }
  if (u === "https://api.openai.com/v1/models") {
    modelCalls.push(init.headers.authorization);
    return jres({ models: [{ slug: "gpt-5.1", display_name: "GPT-5.1", visibility: "list", context_window: 400000, supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] }, { slug: "hidden-one", display_name: "Hidden", visibility: "hide" }, { slug: "gpt-5-mini", display_name: "GPT-5 mini", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "bogus" }] }] });
  }
  if (u === "https://api.openai.com/v1/responses") {
    const body = JSON.parse(init.body); responses.push({ auth: init.headers.authorization, headers: init.headers, body, redirect: init.redirect });
    if (mode.fail401 > 0) { mode.fail401--; return jres({ detail: "nope" }, 401); }
    if (init.headers.authorization !== `Bearer ${curAT}`) return jres({ detail: "bad token" }, 401);
    const tc = body.tools?.some((t) => t.name === "ping");
    if (mode.resp === "badmodel") return jres({ detail: `The '${body.model}' model is not supported when using Codex with a ChatGPT account.` }, 400);
    if (mode.resp === "limit") return jres({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit", param: null } }, 429);
    if (mode.resp === "failed") return rsse([{ type: "response.created", response: {} }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable", message: "x" } } }]);
    if (mode.resp === "cut") return rsse([{ type: "response.created", response: {} }, { type: "response.output_text.delta", delta: "Hel" }]);
    if (tc) return rsse([{ type: "response.created", response: {} }, { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "ping", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"word\":" }, { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "\"ok\"}" },
      { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "ping", arguments: "{\"word\":\"ok\"}" } },
      { type: "response.completed", response: { usage: { input_tokens: 11, output_tokens: 5, input_tokens_details: { cached_tokens: 2 } } } }]);
    return rsse([{ type: "response.created", response: {} }, { type: "response.output_text.delta", delta: "O" }, { type: "response.output_text.delta", delta: "K" }, { type: "response.completed", response: { usage: { input_tokens: 7, output_tokens: 2 } } }]);
  }
  throw new Error(`unexpected fetch ${u}`);
};
const ctx = { waitUntil: () => {} };
const go = (path, { tok = TOK1, headers = {} } = {}) => worker.fetch(new Request(`https://app.example.test${path}`, { headers: { cookie: `hc_session=${tok}`, ...headers } }), env, ctx);
const T = (id = "t1") => d1.prepare("SELECT * FROM tenants WHERE id=?").get(id);
const seen = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const api = async (sub, body, tid = "t1") => { const r = await byokApi(new Request(`https://app.example.test/w/ck1${sub}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), env, T(tid), sub, { json }); const text = await r.text(); seen.push(text); return { status: r.status, d: JSON.parse(text) }; };
const startRes = async () => { const r = await go("/w/ck1/byok/chatgpt/start"); seen.push(JSON.stringify([...r.headers])); return r; };
// What OpenAI does at consent: hands out a code for the challenge, and the browser ends on a 127.0.0.1 address.
function consent(res, { clientId = ISSUED, withClient = true } = {}) {
  const a = new URL(res.headers.get("location")); const code = `CODE-SECRET-${authz.size}-${Math.random().toString(36).slice(2, 8)}`;
  authz.set(code, { challenge: a.searchParams.get("code_challenge"), nonce: a.searchParams.get("nonce") });
  const q = new URLSearchParams({ code, state: a.searchParams.get("state"), ...(withClient ? { client_id: clientId } : {}) });
  return { code, state: a.searchParams.get("state"), address: `http://127.0.0.1:1479/auth/callback?${q}` };
}
const finish = (address) => api("/api/byok/chatgpt/finish", { url: address });
const reset = () => { for (const t of ["byok_chatgpt", "byok_chatgpt_pkce", "byok"]) d1.exec(`DELETE FROM ${t}`); _resetChatgpt(); };

// ===== 1. start =====
{
  const r = await startRes();
  assert.equal(r.status, 302); assert.equal(r.headers.get("cache-control"), "no-store");
  const a = new URL(r.headers.get("location"));
  assert.equal(`${a.origin}${a.pathname}`, CG_AUTH_URL);
  const p = a.searchParams;
  assert.equal(p.get("client_id"), "dynamic_agent_client"); assert.equal(p.get("agent_name_hint"), "1Helm");
  assert.match(p.get("ext_agent_host_id"), /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(p.get("response_type"), "code"); assert.equal(p.get("redirect_uri"), "http://127.0.0.1:1479/auth/callback");
  assert.equal(p.get("scope"), "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"); assert.equal(p.get("resource"), "https://api.openai.com/v1");
  assert.equal(p.get("code_challenge_method"), "S256"); assert.match(p.get("state"), /^[A-Za-z0-9_-]{32}$/); assert.match(p.get("nonce"), /^[A-Za-z0-9_-]{32}$/);
  const row = d1.prepare("SELECT * FROM byok_chatgpt_pkce WHERE state=?").get(p.get("state"));
  const verifier = await openSecret(env, row.verifier);
  assert.ok(!row.verifier.includes(verifier)); assert.equal(await challengeOf(verifier), p.get("code_challenge")); assert.ok(!a.href.includes(verifier));
  const host1 = p.get("ext_agent_host_id");
  const r2 = await startRes(); const p2 = new URL(r2.headers.get("location")).searchParams;
  assert.equal(p2.get("ext_agent_host_id"), host1, "the host id is made once per workspace");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt_pkce").get().n, 1, "a new start replaces the earlier unfinished one");
  assert.notEqual(await hostId(env, "t2"), host1, "each workspace has its own");
  const x = await go("/w/ck1/byok/chatgpt/start", { headers: { "sec-fetch-site": "cross-site" } });
  assert.match(x.headers.get("location"), /\/w\/ck1\/app\?settings=byok$/); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt_pkce").get().n, 1);
  assert.deepEqual(parsePasted("code=a&state=b&client_id=c"), { code: "a", state: "b", error: "", clientId: "c" });
  assert.equal(parsePasted("   "), null);
  ok("start: authorize URL, sealed verifier, one host id per workspace, cross-site refused");
}

// ===== 2. the pasted address =====
{
  reset(); ex.length = 0;
  let s = await startRes(), c = consent(s);
  assert.equal((await finish("not an address at all")).d.why, "paste");
  assert.equal((await finish("http://127.0.0.1:1479/auth/callback?code=x&state=unknown")).d.why, "expired");
  assert.equal(ex.length, 0);
  // another account's pending sign-in
  s = await startRes(); c = consent(s);
  const r = await byokApi(new Request("https://app.example.test/w/ck2/api/byok/chatgpt/finish", { method: "POST", body: JSON.stringify({ url: c.address }) }), env, T("t2"), "/api/byok/chatgpt/finish", { json });
  assert.equal((await r.json()).why, "expired"); assert.equal(ex.length, 0, "nothing exchanged for another account's state");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt_pkce WHERE tenant_id='t1'").get().n, 1, "another account's paste can't remove this account's pending sign-in");
  d1.exec("DELETE FROM byok_chatgpt_pkce");
  // denied
  s = await startRes(); const a = new URL(s.headers.get("location"));
  let q = await finish(`http://127.0.0.1:1479/auth/callback?error=access_denied&state=${a.searchParams.get("state")}`);
  assert.equal(q.d.why, "cancelled"); assert.equal(ex.length, 0);
  // old state
  s = await startRes(); c = consent(s); d1.exec("UPDATE byok_chatgpt_pkce SET created_at=created_at-700000");
  assert.equal((await finish(c.address)).d.why, "expired");
  // a first sign-in must come back with the issued client id
  s = await startRes(); c = consent(s, { withClient: false });
  assert.equal((await finish(c.address)).d.why, "paste"); assert.equal(ex.length, 0);
  // the registration entry point is never an issued id
  s = await startRes(); c = consent(s, { clientId: "dynamic_agent_client" }); assert.equal((await finish(c.address)).d.why, "paste"); assert.equal(ex.length, 0);
  // the exchange
  mode.exchange = "down"; s = await startRes(); c = consent(s); assert.equal((await finish(c.address)).d.why, "network");
  mode.exchange = "500"; s = await startRes(); c = consent(s); assert.equal((await finish(c.address)).d.why, "network");
  mode.exchange = "ok";
  s = await startRes(); c = consent(s); authz.delete(c.code); assert.equal((await finish(c.address)).d.why, "exchange");
  // ID token checks
  for (const [label, set, why] of [["signature", () => { mode.signer = "bad"; }, "verify"], ["audience", () => { mode.aud = "oaiapp_other"; }, "verify"], ["expired", () => { mode.exp = -7200; }, "verify"], ["nonce", () => { mode.nonce = "wrong"; }, "verify"], ["scope", () => { mode.scope = "openid profile email offline_access resource.invoke"; }, "no_use"]]) {
    Object.assign(mode, { signer: "ok", aud: ISSUED, exp: 3600, nonce: null, scope: CG_SCOPE }); set();
    s = await startRes(); c = consent(s); const x = await finish(c.address);
    assert.equal(x.d.why, why, label); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt").get().n, 0, `${label}: nothing saved`);
  }
  Object.assign(mode, { signer: "ok", aud: ISSUED, exp: 3600, nonce: null, scope: CG_SCOPE });
  ok("pasted address: bad, foreign, used, old and denied sign-ins; refused exchanges; ID token signature, audience, expiry, nonce; missing plan permission");
}

// ===== 3. success, the record =====
let firstAT;
{
  ex.length = 0;
  const s = await startRes(), c = consent(s), x = await finish(c.address);
  assert.equal(x.status, 200); assert.deepEqual(x.d.connections.map((c) => [c.id, c.kind, c.email, c.signin_again]), [["chatgpt", "chatgpt", "sam@chat.example", false]]);
  assert.equal(ex.length, 1); assert.equal(ex[0].client_id, ISSUED); assert.equal(ex[0].redirect_uri, CG_REDIRECT); assert.equal(ex[0].resource, "https://api.openai.com/v1"); assert.equal(ex[0].grant_type, "authorization_code");
  const row = d1.prepare("SELECT * FROM byok_chatgpt WHERE tenant_id='t1'").get();
  assert.equal(row.client_id, ISSUED); assert.equal(row.subject, "user-1"); assert.equal(row.broken, 0);
  assert.ok(!row.record_sealed.includes("AT-SECRET") && !row.record_sealed.includes("RT-SECRET"), "sealed at rest");
  const rec = JSON.parse(await openSecret(env, row.record_sealed));
  assert.equal(rec.client_id, ISSUED); assert.equal(rec.sub, "user-1"); assert.equal(rec.host_id, (await hostId(env, "t1"))); assert.ok(rec.scopes.includes("chatgpt.tokens.use.direct")); assert.match(rec.refresh_token, /^RT-SECRET/); assert.ok(rec.id_token && rec.expires_at > Date.now());
  firstAT = rec.access_token;
  assert.equal((await finish(c.address)).d.why, "expired", "one use");
  // a later sign-in uses the issued client id and no registration hint
  const s2 = await startRes(); const p = new URL(s2.headers.get("location")).searchParams;
  assert.equal(p.get("client_id"), ISSUED); assert.ok(!p.has("agent_name_hint"));
  // a different account can't replace it
  const keepAT = curAT, keepRT = curRT; mode.sub = "user-2"; const c2 = consent(s2); assert.equal((await finish(c2.address)).d.why, "other_account"); mode.sub = "user-1"; curAT = keepAT; curRT = keepRT;   // the refused account's tokens are not ours
  assert.equal((await api("/api/byok")).d.connections[0].email, "sam@chat.example");
  ok("pasted address: success seals the record, shows only the email, reuses the issued client id, refuses a different account");
}

// ===== 4. refresh =====
{
  const exp = (ms) => d1.prepare("UPDATE byok_chatgpt SET expires_at=?, lock_id='', lock_until=0 WHERE tenant_id='t1'").run(Date.now() + ms);
  assert.equal(await chatgptToken(env, "t1"), firstAT, "a token with time left is used as it is"); assert.equal(refreshes.length, 0);
  exp(30e3); mode.refreshDelay = 60;
  const got = await Promise.all([1, 2, 3, 4, 5].map(() => chatgptToken(env, "t1", { waitMs: 10 })));
  assert.equal(refreshes.length, 1, "five callers, one refresh"); assert.equal(new Set(got).size, 1); assert.equal(got[0], curAT); assert.notEqual(got[0], firstAT);
  assert.equal(refreshes[0].grant_type, "refresh_token"); assert.equal(refreshes[0].client_id, ISSUED); assert.equal(refreshes[0].resource, "https://api.openai.com/v1"); assert.ok(!("scope" in refreshes[0]));
  const rec = JSON.parse(await openSecret(env, d1.prepare("SELECT record_sealed FROM byok_chatgpt").get().record_sealed));
  assert.equal(rec.access_token, curAT); assert.equal(rec.refresh_token, curRT, "the rotated refresh token is saved with the access token"); assert.ok(rec.id_token, "the ID token is kept"); assert.ok(rec.expires_at > Date.now() + 3000e3);
  assert.equal(d1.prepare("SELECT lock_id, lock_until FROM byok_chatgpt").get().lock_until, 0); mode.refreshDelay = 0;
  // a network error while the token still has time: keep using it, keep the record
  exp(60e3); mode.refresh = "down"; const before = curAT;
  assert.equal(await chatgptToken(env, "t1"), before); assert.equal(d1.prepare("SELECT broken FROM byok_chatgpt").get().broken, 0);
  mode.refresh = "500"; assert.equal(await chatgptToken(env, "t1"), before);
  // expired and the network is down: an error that keeps the record
  exp(-1000); mode.refresh = "down";
  await assert.rejects(chatgptToken(env, "t1"), (e) => e.cg === "network"); assert.equal(d1.prepare("SELECT broken FROM byok_chatgpt").get().broken, 0);
  // a dead lease is taken over
  mode.refresh = "ok"; d1.prepare("UPDATE byok_chatgpt SET lock_id='dead', lock_until=? WHERE tenant_id='t1'").run(Date.now() - 1); await chatgptToken(env, "t1");
  // terminal: reused refresh token → sign in again, tokens cleared, client id and host kept
  exp(-1000); mode.refresh = "reused";
  await assert.rejects(chatgptToken(env, "t1"), (e) => e.cg === "signin");
  const row = d1.prepare("SELECT * FROM byok_chatgpt").get(); assert.equal(row.broken, 1); assert.equal(row.record_sealed, ""); assert.equal(row.client_id, ISSUED);
  const st = (await api("/api/byok")).d.connections.find((c) => c.id === "chatgpt"); assert.equal(st.signin_again, true);
  await assert.rejects(chatgptToken(env, "t1"), (e) => e.cg === "signin");
  // signing in again fixes it
  mode.refresh = "ok"; const s = await startRes(); assert.equal(new URL(s.headers.get("location")).searchParams.get("client_id"), ISSUED);
  assert.equal((await finish(consent(s).address)).d.connections.find((c) => c.id === "chatgpt").signin_again, false); assert.equal(d1.prepare("SELECT broken FROM byok_chatgpt").get().broken, 0);
  ok("refresh: one owner for five callers, rotation saved together, network errors keep the record, a dead lease is taken over, a reused token asks to sign in again");
}

// ===== 5. translation =====
{
  const body = { messages: [{ role: "system", content: "You are the helper." }, { role: "system", content: "Be brief." }, { role: "user", content: "hi" },
    { role: "assistant", content: "calling", tool_calls: [{ id: "call_a", type: "function", function: { name: "ping", arguments: "{\"word\":\"ok\"}" } }] }, { role: "tool", tool_call_id: "call_a", content: "pong" },
    { role: "system", content: "steer note" }, { role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
    tools: [{ type: "function", function: { name: "ping", description: "d", parameters: { type: "object", properties: { word: { type: "string" } } } } }], tool_choice: "auto", stream: true, stream_options: { include_usage: true },
    max_tokens: 100, temperature: 0.2, top_p: 1, user: "u", metadata: { a: 1 }, response_format: { type: "json_object" } };
  const r = responsesBody(body, "gpt-5.1", { effort: "high" });
  assert.equal(r.model, "gpt-5.1"); assert.equal(r.store, false); assert.equal(r.stream, true); assert.equal(r.instructions, "You are the helper.\n\nBe brief.");
  for (const k of ["max_output_tokens", "max_tokens", "temperature", "top_p", "user", "metadata", "previous_response_id", "stream_options", "messages", "background", "conversation", "truncation", "safety_identifier", "prompt_cache_retention"]) assert.ok(!(k in r), `no ${k}`);
  assert.ok(!r.input.some((i) => i.role === "system"), "no system-role item");
  assert.deepEqual(r.input.map((i) => i.type || i.role), ["user", "assistant", "function_call", "function_output".replace("_output", "_call_output"), "developer", "user"]);
  assert.deepEqual(r.input[2], { type: "function_call", call_id: "call_a", name: "ping", arguments: "{\"word\":\"ok\"}" }); assert.deepEqual(r.input[3], { type: "function_call_output", call_id: "call_a", output: "pong" });
  assert.equal(r.input[5].content[1].type, "input_image"); assert.equal(r.tools[0].type, "function"); assert.equal(r.tools[0].name, "ping"); assert.equal(r.tool_choice, "auto");
  assert.deepEqual(r.reasoning, { effort: "high" }); assert.deepEqual(r.text, { format: { type: "json_object" } });
  const cfg = { host: "ChatGPT", provider: "chatgpt" };
  const read = async (events) => { const body = new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("")).body; const out = []; const rd = translateStream(cfg, body, "m").getReader(), dec = new TextDecoder(); let txt = ""; for (;;) { const { value, done } = await rd.read(); if (done) break; txt += dec.decode(value); } for (const l of txt.split("\n\n")) if (l.startsWith("data:") && !l.includes("[DONE]")) out.push(JSON.parse(l.slice(5))); return { out, txt }; };
  const t = await read([{ type: "response.output_text.delta", delta: "Hi " }, { type: "response.reasoning_summary_text.delta", delta: "think" }, { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc", call_id: "c9", name: "ping" } },
    { type: "response.output_item.done", output_index: 1, item: { type: "function_call", id: "fc", call_id: "c9", name: "ping", arguments: "{\"word\":\"x\"}" } }, { type: "response.completed", response: { usage: { input_tokens: 9, output_tokens: 4, output_tokens_details: { reasoning_tokens: 1 } } } }]);
  assert.equal(t.out[0].choices[0].delta.content, "Hi "); assert.equal(t.out[1].choices[0].delta.reasoning, "think");
  assert.deepEqual(t.out[2].choices[0].delta.tool_calls[0], { index: 0, id: "c9", type: "function", function: { name: "ping", arguments: "" } }); assert.equal(t.out[3].choices[0].delta.tool_calls[0].function.arguments, "{\"word\":\"x\"}", "arguments that only arrive in the done event are sent");
  const last = t.out.at(-1); assert.equal(last.choices[0].finish_reason, "tool_calls"); assert.equal(last.usage.prompt_tokens, 9); assert.equal(last.usage.completion_tokens, 4); assert.equal(last.usage.cost, 0); assert.ok(t.txt.trimEnd().endsWith("data: [DONE]"));
  const inc = await read([{ type: "response.output_text.delta", delta: "x" }, { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }]); assert.equal(inc.out.at(-1).choices[0].finish_reason, "length");
  await assert.rejects(read([{ type: "response.output_text.delta", delta: "x" }]), (e) => e instanceof ByokError && /stopped sending/.test(e.message));   // no response.completed: not a success
  await assert.rejects(read([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]), (e) => e instanceof ByokError && /usage limit/.test(e.message) && /^Your AI service \(ChatGPT\)/.test(e.message));
  await assert.rejects(read([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable" } } }]), (e) => /couldn't check your usage/.test(e.message));
  ok("translation: Responses request (no unsupported field, instructions, tool calls, images) and event stream (text, reasoning, tool calls, usage, incomplete, failed, cut off)");
}

// ===== 6. the whole path =====
{
  reset(); ex.length = 0; d1.exec("DELETE FROM byok_connections; DELETE FROM byok_multi;");
  // sign in: the ChatGPT connection is there at once, with no models to pick first
  const s = await startRes(); const fin = await finish(consent(s).address); assert.equal(fin.status, 200);
  assert.deepEqual(fin.d.connections.map((c) => [c.id, c.kind, c.label]), [["chatgpt", "chatgpt", "ChatGPT"]]);
  responses.length = 0; modelCalls.length = 0;
  // Test: the model list with the token, no model call
  const tst = await api("/api/byok/test", { id: "chatgpt" }); assert.equal(tst.d.ok, true, JSON.stringify(tst.d)); assert.equal(modelCalls.at(-1), `Bearer ${curAT}`); assert.equal(responses.length, 0, "no model ran");
  // models are chosen in Custom Model Selection only: General on gpt-5.1, Background jobs on gpt-5-mini
  const saved = await saveOwn(env, "t1", { categories: [{ id: "general", title: "General", chain: [{ model: "chatgpt:gpt-5.1", effort: "high" }], max_price: null }], background: { chain: [{ model: "chatgpt:gpt-5-mini", effort: "low" }] } }, {});
  assert.equal(saved.models["chatgpt:gpt-5.1"].service, "ChatGPT");
  const cfg = await loadByok(env, "t1"), conn = cfg.connections.chatgpt;
  assert.equal(conn.provider, "chatgpt"); assert.equal(conn.host, "ChatGPT"); assert.equal(cfg.model, "chatgpt:gpt-5.1"); assert.equal(cfg.fast, "chatgpt:gpt-5-mini"); assert.ok(!JSON.stringify(cfg).includes("SECRET"));
  // chat: streamed, a tool call, and a chore on the fast model
  responses.length = 0;
  const r = await byokChat(cfg, { messages: [{ role: "system", content: "S" }, { role: "user", content: "hi" }], stream: true });
  const txt = await r.text(); assert.match(txt, /"content":"O"/); assert.match(txt, /"content":"K"/); assert.match(txt, /"finish_reason":"stop"/); assert.equal(responses[0].body.model, "gpt-5.1", "ChatGPT gets its own model name");
  const j = await (await byokChat(cfg, { messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "ping", parameters: { type: "object", properties: {} } } }] })).json();
  assert.equal(j.choices[0].message.tool_calls[0].function.name, "ping"); assert.equal(j.choices[0].message.tool_calls[0].function.arguments, "{\"word\":\"ok\"}"); assert.equal(j.choices[0].finish_reason, "tool_calls"); assert.equal(j.usage.cost, 0); assert.equal(j.usage.prompt_tokens, 11);
  await byokChat(cfg, { messages: [{ role: "user", content: "x" }] }, { fast: true }); assert.equal(responses.at(-1).body.model, "gpt-5-mini");
  responses.length = 0; refreshes.length = 0; mode.fail401 = 1;
  await (await byokChat(cfg, { messages: [{ role: "user", content: "x" }], stream: true })).text(); assert.equal(responses.length, 2); assert.equal(refreshes.length, 1); assert.equal(responses[1].auth, `Bearer ${curAT}`);
  mode.resp = "limit"; await assert.rejects(byokChat(cfg, { messages: [{ role: "user", content: "x" }], stream: true }), (e) => e instanceof ByokError && e.limit === true && /^Your AI service \(ChatGPT\) has reached the usage limit of your ChatGPT plan/.test(e.message) && /\[Manage usage\]\(https:\/\/chatgpt\.com\/settings\/usage\)/.test(e.message));
  mode.resp = "failed"; await assert.rejects(byokChat(cfg, { messages: [{ role: "user", content: "x" }], stream: true }), (e) => e instanceof ByokError && /couldn't check your usage/.test(e.message));
  mode.resp = "cut"; await assert.rejects((async () => { const r = await byokChat(cfg, { messages: [{ role: "user", content: "x" }], stream: true }); await r.text(); })(), (e) => e instanceof ByokError);
  mode.resp = "ok";
  // prompt caching: the Responses body carries prompt_cache_key (the field the Codex client sends to this endpoint): the task's key on a chat turn, a stable account and purpose key on a chore
  { const { cacheKey } = await import("../src/model.js"); responses.length = 0;
    await (await byokChat(cfg, { messages: [{ role: "user", content: "x" }], stream: true }, { session: "task-1" })).text(); await (await byokChat(cfg, { messages: [{ role: "user", content: "y" }], stream: true }, { session: "task-1" })).text();
    assert.equal(responses[0].body.prompt_cache_key, cacheKey("task-1")); assert.equal(responses[1].body.prompt_cache_key, responses[0].body.prompt_cache_key, "the same task keeps the same key");
    await byokChat(cfg, { messages: [{ role: "user", content: "x" }] }, { fast: true }); await byokChat(cfg, { messages: [{ role: "user", content: "z" }] }, { fast: true });
    assert.match(responses[2].body.prompt_cache_key, /^1h-[0-9a-f]{16}$/); assert.equal(responses[3].body.prompt_cache_key, responses[2].body.prompt_cache_key, "chores of one purpose share a stable key"); assert.notEqual(responses[2].body.prompt_cache_key, responses[0].body.prompt_cache_key);
    assert.ok(!("session_id" in responses[0].body), "no other field is added");
    // the session headers Codex sends (codex-api build_session_headers): session-id and thread-id, with x-client-request-id, all equal to the prompt_cache_key and stable across one task's calls
    for (const i of [0, 1, 2, 3]) { const h = responses[i].headers, k = responses[i].body.prompt_cache_key; assert.equal(h["session-id"], k); assert.equal(h["thread-id"], k); assert.equal(h["x-client-request-id"], k); }
    assert.equal(responses[1].headers["session-id"], responses[0].headers["session-id"], "one task, one session header"); assert.equal(responses[3].headers["session-id"], responses[2].headers["session-id"]); assert.notEqual(responses[2].headers["session-id"], responses[0].headers["session-id"]); }
  d1.prepare("UPDATE byok_chatgpt SET broken=1, record_sealed=''").run();
  await assert.rejects(byokChat(cfg, { messages: [{ role: "user", content: "x" }] }), (e) => e instanceof ByokError && /sign in with ChatGPT again/.test(e.message));
  assert.equal((await api("/api/byok")).d.connections[0].signin_again, true, "the list says to sign in again");
  const s3 = await startRes(); await finish(consent(s3).address);
  // Remove revokes and clears, takes its models out of the setting; the host id stays
  const host = d1.prepare("SELECT host_id FROM byok_chatgpt_host WHERE tenant_id='t1'").get().host_id; revokes.length = 0;
  const del = await api("/api/byok/remove", { id: "chatgpt" }); assert.equal(del.status, 200); assert.deepEqual(del.d.connections, []); assert.equal(del.d.removed_models, 2);
  assert.equal(revokes.length, 1); assert.equal(revokes[0].token, curRT); assert.equal(revokes[0].client_id, ISSUED); assert.equal(revokes[0].token_type_hint, "refresh_token");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt").get().n, 0); assert.equal(d1.prepare("SELECT host_id FROM byok_chatgpt_host WHERE tenant_id='t1'").get().host_id, host);
  ok("whole path: sign-in is the connection, Test with no model call, models chosen in Custom Model Selection, streamed and tool chat, fast model, 401 refresh, plain failures, Remove revokes and clears");
}

// ===== 7. nothing secret anywhere =====
{
  const blob = [...seen, ...logs].join("\n");
  for (const bit of SECRET_BITS) assert.ok(!blob.includes(bit), `${bit} never appears in a response or log`);
  assert.ok(!blob.includes("id_token") || !/eyJ[A-Za-z0-9_-]{10,}\./.test(blob), "no JWT in a response or log");
  ok("no token, code or ID token in any response or log");
}

console.log(`1..${n}`);

{
  const { withCacheBreakpoints } = await import("../src/model.js");
  const messages = [{ role: "system", content: "Be brief." }, { role: "user", content: "q1" }, { role: "assistant", content: "a1", tool_calls: [{ id: "c1", type: "function", function: { name: "w", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: "r1" }, { role: "assistant", content: "done" }, { role: "user", content: "q2" }];
  const plain = responsesBody({ messages }, "gpt-5.1"), marked = responsesBody(withCacheBreakpoints({ messages, session_id: "s", tools: [{ type: "function", function: { name: "w", parameters: {} } }] }), "gpt-5.1");
  assert.deepEqual(marked.input, plain.input); assert.equal(marked.instructions, plain.instructions);
  assert.ok(!JSON.stringify(marked).includes("cache_control"));
}
