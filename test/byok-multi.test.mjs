// node --import ./test/stubs/register.mjs test/byok-multi.test.mjs
// Several AI services on one account (src/byok-connections.js, byok.js, byok-custom.js). No real calls: fetch is faked for two plain services (a.example-ai.com and b.example-ai.com),
// OpenRouter, OpenCode (the real transport, src/byok-opencode.js) and ChatGPT's sign-in record (a saved row only).
// Checks: the lazy upgrade of an account with the old single key, models named per connection and each call sent to its
// own service with its own key, the same model name on two services, mixed chains and Background jobs, the picker listing every service with its label, removing a connection, the
// limits (one OpenRouter, one ChatGPT, one OpenCode), adding OpenCode (a key check with no paid call), and the onboarding card.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { test } from "node:test";
import { byokApi, loadByok, byokChat, ByokError } from "../src/byok.js";
import { listRows, connDdl, ensureUpgrade, splitModel, nsModel, upgradedConfig, withoutConnection } from "../src/ee/byok-connections.js";
import { saveOwn, readOwn, ownPicker, ownViewFor, ownKeyPlan, byokChatChain, _resetLists } from "../src/ee/byok-custom.js";
import { privacyBoot } from "../src/privacy.js";
import { _resetOpencode, OC_BASE } from "../src/ee/byok-opencode.js";
import { sealSecret } from "../src/sentinel.js";
import { orDdl } from "../src/byok-openrouter.js";

const KEY_A = "sk-aaaa-SECRET-1111", KEY_B = "sk-bbbb-SECRET-2222", KEY_OC = "oc-SECRET-key-3333", KEY_OR = "sk-or-v1-SECRET-4444", ALL_KEYS = [KEY_A, KEY_B, KEY_OC, KEY_OR];
const A = "https://a.example-ai.com/v1", B = "https://b.example-ai.com/v1";

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', plan TEXT, stripe_subscription TEXT DEFAULT '', updated_at INTEGER);
  INSERT INTO tenants (id, slug, helper_name, first_name, plan) VALUES ('t1','ck1','Ollie','Sam','byok');`);
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0038_046_ai_privacy", "0065_custom_models_own_key", "0069_byok_chatgpt", "0068_byok_effort", "0070_byok_connections"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", ENV_NAME: "test", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 1)).toString("base64"), LEDGER: { idFromName: (n) => n, get: () => ({}) } };

// ---- fake services ----
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const sse = (model) => new Response(`data: ${JSON.stringify({ model, choices: [{ delta: { content: `answer from ${model}` } }] })}\n\ndata: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
const seen = [], logs = []; let down = new Set(), ocKeyOk = true;
const M = (id, extra = {}) => ({ id, ...extra });
const LISTS = { "a.example-ai.com": [M("main-1"), M("shared-model"), M("o-reason", { supported_reasoning_efforts: ["low", "high"] })], "b.example-ai.com": [M("shared-model"), M("b-only", { name: "B Only Model" })] };
const OC_LIST = { data: [{ id: "free-one", name: "Free One", type: "chat", api: { "chat-completions": { base_url: `${OC_BASE}/openai/v1` } }, cost: { text: { input: { price: 0 }, output: { price: 0 } } } }, { id: "gpt-x", name: "GPT X", type: "chat", api: { responses: { base_url: `${OC_BASE}/openai/v1` } }, cost: { text: { input: { price: 0.1 }, output: { price: 0.2 } } } },
  { id: "kimi-k3", name: "Kimi K3", type: "chat", api: { "chat-completions": { base_url: `${OC_BASE}/openai/v1` } }, cost: { text: { input: { price: 3 }, output: { price: 9 } } } },
  { id: "glm-5.3", name: "GLM 5.3", type: "chat", api: { "chat-completions": { base_url: `${OC_BASE}/openai/v1` } }, cost: { text: { input: { price: 1 }, output: { price: 4 } } }, capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ["low", "medium", "high"] } }, limit: { context: 200000, output: 8000 } }] };
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const url = new URL(u), method = init.method || "GET", auth = init.headers?.authorization, body = init.body ? JSON.parse(init.body) : null; seen.push({ host: url.hostname, path: url.pathname, method, auth, body, redirect: init.redirect, sess: init.headers?.["x-opencode-session"], ua: init.headers?.["user-agent"] });
  if (url.hostname === "opencode.ai") {
    const go = url.pathname.startsWith("/inference/go/"), path = go ? url.pathname.replace("/inference/go/", "/inference/") : url.pathname;   // Go is the default plan; the fake serves both
    if (path === "/inference/v1/models") return jres(go ? { data: OC_LIST.data.filter((m) => m.id !== "free-one") } : OC_LIST);   // public: no key
    if (path === "/inference/openai/v1/chat/completions") {
      if (go && !init.headers?.["x-opencode-session"]) return jres({ type: "error", error: { type: "MissingSessionID" } }, 400);
      if (auth !== `Bearer ${KEY_OC}` || !ocKeyOk) return jres({ error: { message: "bad key" } }, 401);
      if (!body.messages.length) return jres({ error: { message: "messages must not be empty" } }, 400);   // the key was checked first
      return body.stream ? sse(body.model) : jres({ model: body.model, choices: [{ message: { role: "assistant", content: "ok" } }], usage: { cost: 0.002 } });
    }
  }
  if (url.hostname === "openrouter.ai") {
    if (url.pathname === "/api/v1/key") return auth === `Bearer ${KEY_OR}` ? jres({ data: {} }) : jres({ error: {} }, 401);
    if (url.pathname === "/api/v1/chat/completions") return sse(body.model);
  }
  if (LISTS[url.hostname]) {
    if (down.has(url.hostname)) return jres({ error: { message: "down" } }, 503);
    if (method === "GET" && url.pathname === "/v1/models") return auth ? jres({ data: LISTS[url.hostname] }) : jres({ error: {} }, 401);
    if (url.pathname === "/v1/chat/completions") return body.stream ? sse(body.model) : jres({ model: body.model, choices: [{ message: { role: "assistant", content: "ok" } }] });
  }
  throw new Error(`unexpected fetch ${u}`);
};
const origLog = console.log; console.log = (...a) => { logs.push(a.join(" ")); };

// ---- helpers ----
const chatBody = { messages: [{ role: "user", content: "hi" }], stream: true };
const wipe = async () => { await orDdl(env); await connDdl(env); d1.exec("DELETE FROM byok; DELETE FROM byok_connections; DELETE FROM byok_multi; DELETE FROM byok_chatgpt; DELETE FROM byok_tests; UPDATE tenants SET plan='byok', custom_models_own=NULL, custom_models_own_on=0"); _resetLists(); _resetOpencode(); down = new Set(); ocKeyOk = true; seen.length = 0; };
async function conn(id, kind, base, key, label = "") {
  await connDdl(env); d1.prepare("INSERT OR IGNORE INTO byok_multi (tenant_id, upgraded_at) VALUES ('t1', 1)").run();
  d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,?,1,1)").run(id, kind, label || new URL(base).hostname, base, key ? await sealSecret(env, key) : "", key.slice(-4));
}
const seal = (k) => sealSecret(env, k);
async function connect(...list) { await wipe(); for (const [id, kind, base, key, label] of list) { await connDdl(env); d1.prepare("INSERT OR IGNORE INTO byok_multi (tenant_id, upgraded_at) VALUES ('t1', 1)").run(); d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,?,?,1)").run(id, kind, label || new URL(base).hostname, base, await seal(key), key.slice(-4), list.findIndex((x) => x[0] === id) + 1); } }
const entry = (model, effort = null) => ({ model, effort });
const cat = (id, title, ...chain) => ({ id, title, chain, max_price: null });
const T = () => d1.prepare("SELECT * FROM tenants WHERE id='t1'").get();
const api = async (sub, body) => { const r = await byokApi(new Request(`https://app.example.test/w/ck1${sub}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), env, T(), sub, { json: (o, status = 200) => jres(o, status) });
  const text = await r.text(); for (const k of ALL_KEYS) assert.ok(!text.includes(k), `a key is never in a response (${sub})`); return { status: r.status, d: JSON.parse(text) }; };
const sentTo = (since) => seen.slice(since).filter((x) => x.method === "POST");

test("names: <connection id>:<model>, split at the first colon, so a model with colons keeps its name", () => {
  assert.equal(nsModel("p_ab12c", "llama3:8b"), "p_ab12c:llama3:8b"); assert.deepEqual(splitModel("p_ab12c:llama3:8b"), { conn: "p_ab12c", model: "llama3:8b" });
  assert.deepEqual(splitModel("openrouter:openai/gpt-5"), { conn: "openrouter", model: "openai/gpt-5" }); assert.deepEqual(splitModel("chatgpt:gpt-5.1"), { conn: "chatgpt", model: "gpt-5.1" });
  for (const bad of ["main-1", ":x", "openai/gpt-5", "nope:x", "p_ab:", "", null, undefined]) assert.equal(splitModel(bad), null, String(bad));
});

// ===== the lazy upgrade =====
test("an existing account with one saved key keeps working with no action: the key becomes a connection, main, fast and levels become the own-key setting", async () => {
  await wipe();
  d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,mode,source,effort,fast_effort) VALUES ('t1',?,?,?,?,?,5,6,'fallback','','high','low')").run(A, "o-reason", "main-1", "SEALED-PLACEHOLDER", KEY_A.slice(-4));
  d1.prepare("UPDATE byok SET key_sealed=?").run(await seal(KEY_A));
  const cfg = await loadByok(env, "t1");   // a read is all it takes
  assert.deepEqual(Object.keys(cfg.connections), ["p_main"]); assert.equal(cfg.model, "p_main:o-reason"); assert.equal(cfg.effort, "high"); assert.equal(cfg.fast, "p_main:main-1"); assert.equal(cfg.connections.p_main.key, KEY_A);
  const own = (await readOwn(env, "t1")).config;
  assert.deepEqual(own.categories[0].chain, [{ model: "p_main:o-reason", effort: "high" }]); assert.deepEqual(own.background.chain, [{ model: "p_main:main-1", effort: "low" }]);
  assert.deepEqual(Object.keys(own.catalog).sort(), ["p_main:main-1", "p_main:o-reason"]); assert.equal(own.catalog["p_main:o-reason"].conn, "p_main"); assert.equal(own.catalog["p_main:o-reason"].connKind, "plain");
  const row = d1.prepare("SELECT * FROM byok").get(); assert.equal(row.mode, "fallback", "the plan option stays"); assert.deepEqual([row.base_url, row.model, row.fast_model], [A, "o-reason", "main-1"], "the old row is not changed: an undone release still finds its key");
  const c = d1.prepare("SELECT * FROM byok_connections").get(); assert.deepEqual([c.id, c.kind, c.base_url, c.created_at], ["p_main", "plain", A, 5]); assert.ok(!JSON.stringify(c).includes(KEY_A));
  // once: a second read changes nothing, and removing the connection does not bring the old key back
  await ensureUpgrade(env, "t1"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 1);
  const p0 = seen.length; await (await byokChat(cfg, chatBody)).text(); assert.deepEqual(sentTo(p0).map((x) => [x.host, x.auth, x.body.model, x.body.reasoning_effort]), [["a.example-ai.com", `Bearer ${KEY_A}`, "o-reason", "high"]]);
  await api("/api/byok/remove", { id: "p_main" }); assert.equal((await api("/api/byok")).d.connections.length, 0);
});

test("a case: ChatGPT signed in beside an older plain key, with Custom Model Selection on that key's ids", async () => {
  await wipe(); d1.exec("UPDATE tenants SET plan='plus'");
  d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,mode) VALUES ('t1',?,?,?,?,?,1,1,'fallback')").run(B, "shared-model", "b-only", await seal(KEY_B), KEY_B.slice(-4));
  d1.prepare("INSERT INTO byok_chatgpt (tenant_id,client_id,subject,email,record_sealed,expires_at,ver,broken,updated_at) VALUES ('t1','oaiapp_x','u','sam@chat.example','SEALED',9999999999999,1,0,1)").run();
  const OLD = { version: 1, categories: [{ id: "general", title: "General", chain: [{ model: "shared-model", effort: null }, { model: "b-only", effort: null }], max_price: null }, { id: "c_code0001", title: "Coding", chain: [{ model: "b-only", effort: null }], max_price: null }],
    background: { chain: [{ model: "b-only", effort: null }] }, catalog: { "shared-model": { id: "shared-model", name: "shared", source: "BYOK", kinds: ["chat"], efforts: [], default_effort: null, levels: [], pricing: null }, "b-only": { id: "b-only", name: "B Only Model", source: "BYOK", kinds: ["chat"], efforts: [], default_effort: null, levels: [], pricing: null } } };
  d1.prepare("UPDATE tenants SET custom_models_own_on=1, custom_models_own=? WHERE id='t1'").run(JSON.stringify(OLD));
  const st = (await api("/api/byok")).d;
  assert.deepEqual(st.connections.map((c) => [c.id, c.kind, c.label, c.email || ""]), [["p_main", "plain", "b.example-ai.com", ""], ["chatgpt", "chatgpt", "ChatGPT", "sam@chat.example"]]);
  assert.equal(st.mode, "fallback", "the plan option stays as it was");
  const own = (await readOwn(env, "t1")).config;
  assert.deepEqual(own.categories.map((c) => [c.id, c.chain.map((e) => e.model)]), [["general", ["p_main:shared-model", "p_main:b-only"]], ["c_code0001", ["p_main:b-only"]]]); assert.deepEqual(own.background.chain.map((e) => e.model), ["p_main:b-only"]);
  assert.ok(Object.keys(own.catalog).every((k) => k.startsWith("p_main:")), "none of the old names is left unnamed");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt").get().n, 1, "the ChatGPT sign-in is untouched");
});

test("an old row from Sign in with OpenRouter becomes the OpenRouter connection; an old row that was ChatGPT leaves only the ChatGPT connection; nothing saved leaves nothing", async () => {
  await wipe();
  d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,source) VALUES ('t1','https://openrouter.ai/api/v1','acme/a','',?,?,1,1,'openrouter')").run(await seal(KEY_OR), KEY_OR.slice(-4));
  const cfg = await loadByok(env, "t1"); assert.deepEqual(Object.keys(cfg.connections), ["openrouter"]); assert.equal(cfg.model, "openrouter:acme/a"); assert.equal(cfg.connections.openrouter.provider, "openrouter");
  assert.equal((await readOwn(env, "t1")).config.catalog["openrouter:acme/a"].connKind, "openrouter");
  await wipe();
  d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,source) VALUES ('t1','https://api.openai.com/v1','gpt-5.1','gpt-5-mini','','',1,1,'chatgpt')").run();
  d1.prepare("INSERT INTO byok_chatgpt (tenant_id,client_id,subject,email,record_sealed,expires_at,ver,broken,updated_at) VALUES ('t1','oaiapp_x','u','sam@chat.example','SEALED',9999999999999,1,0,1)").run();
  const c2 = await loadByok(env, "t1"); assert.deepEqual(Object.keys(c2.connections), ["chatgpt"]); assert.equal(c2.model, "chatgpt:gpt-5.1"); assert.equal(c2.fast, "chatgpt:gpt-5-mini"); assert.ok(c2.connections.chatgpt.chatgptHandle);
  await wipe(); const c3 = await loadByok(env, "t1"); assert.equal(c3.missing, true); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 0);
  assert.deepEqual(upgradedConfig(null, false, { model: "m", fast_model: "", effort: "", fast_effort: "" }, "p_main", "plain").background.chain, [{ model: "p_main:m", effort: null }]);
});

// ===== routing =====
test("the same model name on two services never collides: each call goes to its model's service with that service's key and its own model name", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A], ["p_bbbbb", "plain", B, KEY_B], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"], ["openrouter", "openrouter", "https://openrouter.ai/api/v1", KEY_OR, "OpenRouter"]);
  const cfg = await loadByok(env, "t1"); assert.equal(cfg.model, "", "nothing chosen: no model is picked for the account"); assert.deepEqual(Object.keys(cfg.connections).sort(), ["opencode", "openrouter", "p_aaaaa", "p_bbbbb"]);
  await assert.rejects(byokChat(cfg, chatBody), (e) => e instanceof ByokError && /no model is chosen/.test(e.message)); assert.equal(seen.filter((x) => x.method === "POST").length, 0);
  const v = { settings: null, lookup: async () => null, fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:shared-model"), entry("p_bbbbb:shared-model"), entry("opencode:glm-5.3", "high")), cat("c_code0001", "Coding", entry("p_bbbbb:b-only"))], background: { chain: [entry("p_bbbbb:b-only"), entry("p_aaaaa:main-1")] } }, v);
  const cfg2 = await loadByok(env, "t1"); assert.equal(cfg2.model, "p_aaaaa:shared-model"); assert.equal(cfg2.fast, "p_bbbbb:b-only");
  const plan = await ownKeyPlan(env, "t1", cfg2, "general"); assert.equal(plan.chain.length, 3);
  // each model of General, tried in turn by making the earlier ones fail
  let p0 = seen.length; await (await byokChatChain(cfg2, chatBody, plan)).response.text();
  assert.deepEqual(sentTo(p0).map((x) => [x.host, x.auth, x.body.model]), [["a.example-ai.com", `Bearer ${KEY_A}`, "shared-model"]]);
  down.add("a.example-ai.com"); p0 = seen.length; const r2 = await byokChatChain(cfg2, chatBody, plan); await r2.response.text();
  assert.equal(r2.pick.model, "p_bbbbb:shared-model"); assert.deepEqual(sentTo(p0).map((x) => [x.host, x.auth, x.body.model]).slice(-1), [["b.example-ai.com", `Bearer ${KEY_B}`, "shared-model"]]);
  // OpenCode: the real transport, its own address, with the session header, and the family from its public list
  p0 = seen.length; await (await byokChat(cfg2, chatBody, { model: "opencode:glm-5.3", effort: "high", session: "sess-1" })).text();
  const oc = sentTo(p0).at(-1); assert.deepEqual([oc.host, oc.path, oc.auth, oc.body.model, oc.body.reasoning_effort], ["opencode.ai", "/inference/go/openai/v1/chat/completions", `Bearer ${KEY_OC}`, "glm-5.3", "high"]);
  assert.ok(seen.slice(p0).filter((x) => x.path === "/inference/v1/models").every((x) => !x.auth), "the public list gets no key");
  // chores: Background jobs' models in order, each to its own service
  down = new Set(["b.example-ai.com"]); p0 = seen.length; await (await byokChat(cfg2, { messages: [{ role: "user", content: "title" }] }, { fast: true })).text();
  assert.deepEqual(sentTo(p0).map((x) => [x.host, x.body.model]), [["b.example-ai.com", "b-only"], ["a.example-ai.com", "main-1"]], "the first chore model fails, the next one is on another service");
  // OpenRouter keeps its own privacy and effort fields
  p0 = seen.length; await (await byokChat(cfg2, chatBody, { model: "openrouter:acme/a", privacy: "zdr" })).text(); assert.deepEqual(sentTo(p0)[0].body.provider, { zdr: true, data_collection: "deny" }); assert.equal(sentTo(p0)[0].auth, `Bearer ${KEY_OR}`);
  // a model whose service was removed behind the setting's back: a plain message, nothing sent
  p0 = seen.length; await assert.rejects(byokChat(cfg2, chatBody, { model: "p_zzzzz:x" }), /was disconnected/); assert.equal(seen.length, p0);
  assert.ok(logs.every((l) => ALL_KEYS.every((k) => !l.includes(k))), "no key in any log line");
});

test("the picker lists every connected service together, each model labelled with its service; one that can't be read is named and the rest still list", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "Work"], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"], ["p_bbbbb", "plain", B, KEY_B]);
  const t = { id: "t1" }, p = await ownPicker(env, t, "own", "");
  assert.deepEqual(p.models.map((m) => [m.id, m.service]), [["p_aaaaa:main-1", "Work"], ["p_aaaaa:o-reason", "Work"], ["p_aaaaa:shared-model", "Work"], ["opencode:glm-5.3", "OpenCode"], ["opencode:gpt-x", "OpenCode"], ["opencode:kimi-k3", "OpenCode"], ["p_bbbbb:b-only", "b.example-ai.com"], ["p_bbbbb:shared-model", "b.example-ai.com"]]);
  assert.deepEqual(p.models.find((m) => m.id === "opencode:glm-5.3").efforts, ["low", "medium", "high"]); assert.deepEqual(p.models.find((m) => m.id === "p_aaaaa:o-reason").efforts, ["low", "high"]);
  assert.equal(p.models.find((m) => m.id === "opencode:glm-5.3").family, "chat-completions", "the record carries its family");
  assert.deepEqual((await ownPicker(env, t, "own", "glm opencode")).models.map((m) => m.id), ["opencode:glm-5.3"], "search reads the name and the service");
  assert.deepEqual((await ownPicker(env, t, "own", "shared")).models.map((m) => m.id), ["p_aaaaa:shared-model", "p_bbbbb:shared-model"]);
  _resetLists(); down.add("a.example-ai.com"); const q = await ownPicker(env, t, "own", "");
  assert.deepEqual(q.errors.map((e) => e.id), ["p_aaaaa"]); assert.equal(q.models.length, 5);
  for (const k of ALL_KEYS) assert.ok(!JSON.stringify(p).includes(k));
});

test("one chain mixes services; saving checks each model against its own service; the editor view names the services", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "Work"], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"]);
  const rej = (b, re, st = 400) => assert.rejects(saveOwn(env, "t1", b, {}), (e) => { assert.equal(e.status, st); assert.match(e.message, re); return true; });
  const none = await ownViewFor(env, { id: "t1" }, "own"); assert.equal(none.no_model, true); assert.deepEqual(none.categories[0].chain, []); assert.deepEqual(none.connections.map((c) => c.label), ["Work", "OpenCode"]);
  assert.deepEqual(none.connections.map((c) => c.host), ["a.example-ai.com", ""], "a plain service sends its address, so the picker can show its logo");
  const ok = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:o-reason", "high"), entry("opencode:glm-5.3", "low"))] }, {});
  assert.equal(ok.no_model, false); assert.deepEqual(ok.models["opencode:glm-5.3"].efforts, ["low", "medium", "high"]); assert.equal(ok.models["opencode:glm-5.3"].service, "OpenCode"); assert.equal(ok.has_openrouter, false);
  await rej({ categories: [cat("general", "General", entry("opencode:o-reason"))] }, /isn't in the model list of OpenCode/);
  await rej({ categories: [cat("general", "General", entry("p_aaaaa:glm-5.3"))] }, /isn't in the model list of Work/);
  await rej({ categories: [cat("general", "General", entry("p_aaaaa:o-reason", "max"))] }, /doesn't support the reasoning level "max"/);
  await rej({ categories: [cat("general", "General", entry("p_zzzzz:x"))] }, /isn't connected/);
  await rej({ categories: [cat("general", "General", entry("opencode:glm-5.3", "low"), entry("opencode:glm-5.3", "high"))] }, /different models/);
  assert.equal((await readOwn(env, "t1")).config.categories[0].chain.length, 2, "a refused save changes nothing");
  assert.equal((await saveOwn(env, "t1", { background: { chain: [entry("opencode:glm-5.3", "low")] } }, {})).background.chain[0].model, "opencode:glm-5.3");
});

// ===== removing =====
test("removing a connection takes its models out of the chains and Background jobs, and the editor asks for replacements; the last one ends the backup option", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "Work"], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"]);
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("opencode:glm-5.3", "low"), entry("p_aaaaa:main-1")), cat("c_code0001", "Coding", entry("opencode:glm-5.3", "high"))], background: { chain: [entry("opencode:glm-5.3", "low")] } }, {});
  d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at,mode) VALUES ('t1','','','','','',1,1,'fallback') ON CONFLICT(tenant_id) DO UPDATE SET mode='fallback'").run();
  d1.exec("UPDATE tenants SET plan='plus'");
  let x = await api("/api/byok/remove", { id: "opencode" });
  assert.equal(x.status, 200); assert.equal(x.d.removed_models, 3); assert.deepEqual(x.d.connections.map((c) => c.id), ["p_aaaaa"]); assert.equal(x.d.mode, "fallback", "one service is left, so the backup stays");
  const own = (await readOwn(env, "t1")).config;
  assert.deepEqual(own.categories.map((c) => [c.id, c.chain.map((e) => e.model)]), [["general", ["p_aaaaa:main-1"]], ["c_code0001", []]]); assert.deepEqual(own.background.chain, []); assert.ok(!Object.keys(own.catalog).some((k) => k.startsWith("opencode:")));
  const v = await ownViewFor(env, { id: "t1" }, "own"); assert.equal(v.no_model, false); assert.deepEqual(v.categories[1].chain, [], "the emptied category shows nothing chosen");
  const cfg = await loadByok(env, "t1"); assert.equal(cfg.fallback, true);
  // a category with nothing left answers from General
  assert.equal((await ownKeyPlan(env, "t1", cfg, "c_code0001")).category, "general");
  // removing the one that held General's only model: nothing is chosen, and chat says so
  x = await api("/api/byok/remove", { id: "p_aaaaa" }); assert.deepEqual(x.d.connections, []); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok").get().n, 0, "the backup option ended with the last service");
  assert.equal((await readOwn(env, "t1")).config, null); assert.equal((await api("/api/byok/remove", { id: "p_aaaaa" })).status, 404);
  assert.deepEqual(withoutConnection(null, "x"), { config: null, removed: 0 });
});

// ===== adding =====
test("OpenCode: the key from the console is checked with no paid call, needs the note ticked, is sealed, and there is only one; a wrong key is refused and kept nowhere", async () => {
  await wipe();
  let x = await api("/api/byok/opencode", { key: KEY_OC }); assert.equal(x.d.field, "ack");
  x = await api("/api/byok/opencode", { key: "", ack: true }); assert.equal(x.d.field, "key"); x = await api("/api/byok/opencode", { key: "a\nb", ack: true }); assert.equal(x.d.field, "key");
  ocKeyOk = false; x = await api("/api/byok/opencode", { key: KEY_OC, ack: true }); assert.equal(x.status, 400); assert.match(x.d.error, /OpenCode didn't accept that key/); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 0); ocKeyOk = true;
  const p0 = seen.length; x = await api("/api/byok/opencode", { key: KEY_OC, ack: true });
  assert.equal(x.d.ok, true, JSON.stringify(x.d)); assert.deepEqual(x.d.connections.map((c) => [c.id, c.kind, c.label, c.last4, c.test.ok]), [["opencode", "opencode", "OpenCode", KEY_OC.slice(-4), true]]);
  const checks = seen.slice(p0); const posts = checks.filter((c) => c.method === "POST");
  assert.deepEqual(posts.map((c) => [c.host, c.path, c.body.model, c.body.messages]), [["opencode.ai", "/inference/go/openai/v1/chat/completions", "gpt-x", []]], "one request with an empty message list and a listed Go model (Go asks every model through chat/completions): no model runs");
  assert.equal(posts[0].sess, "1helm-t1-test", "the Go test sends the session header");
  assert.equal(posts[0].auth, `Bearer ${KEY_OC}`); assert.equal(posts[0].redirect, "manual"); assert.ok(checks.filter((c) => c.method === "GET").every((c) => !c.auth), "the public list gets no key");
  assert.ok(!JSON.stringify(d1.prepare("SELECT * FROM byok_connections").all()).includes(KEY_OC), "sealed");
  x = await api("/api/byok/opencode", { key: KEY_OC, ack: true }); assert.equal(x.d.connections.length, 1, "pasting again replaces the key");
  ocKeyOk = false; x = await api("/api/byok/test", { id: "opencode" }); assert.equal(x.d.ok, false); assert.match(x.d.test.checks.reach.error, /OpenCode didn't accept that key/); assert.equal(x.d.connections[0].test.ok, false);
});

test("an OpenRouter key from the sign-in replaces the one OpenRouter connection; ChatGPT and OpenCode are one each; plain services are any number", async () => {
  await connect(["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"]);
  d1.prepare("INSERT INTO byok_or_key (tenant_id,key_sealed,key_last4,created_at) VALUES ('t1',?,?,1)").run(await seal(KEY_OR), KEY_OR.slice(-4));
  let x = await api("/api/byok"); assert.deepEqual(x.d.connections.map((c) => c.id), ["opencode", "openrouter"], "the waiting key is the connection at once"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_or_key").get().n, 0);
  const first = d1.prepare("SELECT created_at c FROM byok_connections WHERE id='openrouter'").get().c;
  d1.prepare("INSERT INTO byok_or_key (tenant_id,key_sealed,key_last4,created_at) VALUES ('t1',?,'new1',1)").run(await seal("sk-or-v1-NEWKEY-new1"));
  x = await api("/api/byok"); assert.equal(x.d.connections.filter((c) => c.kind === "openrouter").length, 1); assert.equal(x.d.connections.find((c) => c.id === "openrouter").last4, "new1"); assert.equal(d1.prepare("SELECT created_at c FROM byok_connections WHERE id='openrouter'").get().c, first);
  const add = (b) => api("/api/byok/connections", { ack: true, ...b });
  x = await add({ base: A, key: KEY_A }); x = await add({ base: B, key: KEY_B }); assert.equal(x.d.connections.filter((c) => c.kind === "plain").length, 2);
  assert.equal(x.d.connections.length, 4); assert.deepEqual(x.d.connections.map((c) => c.kind).sort(), ["opencode", "openrouter", "plain", "plain"]);
  assert.equal((await api("/api/byok/connections", { ack: true, base: "https://x.example-ai.com", key: "k" })).d.field, "base");
});

test("the plan option works with connections: on a full plan it needs one first; the page state carries the services, never a key", async () => {
  await wipe(); d1.exec("UPDATE tenants SET plan='plus'");
  const x = await byokApi(new Request("https://app.example.test/w/ck1/api/byok/mode", { method: "POST", body: JSON.stringify({ mode: "fallback" }) }), env, T(), "/api/byok/mode", { json: (o, s = 200) => jres(o, s), stripe: async () => ({}), PLANS: { plus: {} } });
  assert.equal(x.status, 409); assert.match((await x.json()).error, /Connect your AI service first/);
  await conn("p_aaaaa", "plain", A, KEY_A); assert.equal((await api("/api/byok")).d.connections.length, 1);
  assert.deepEqual(await privacyBoot(env, { ...T(), plan: "byok" }).then((v) => v.byok), "other", "a plain service: its provider's terms apply");
  await wipe(); await conn("openrouter", "openrouter", "https://openrouter.ai/api/v1", KEY_OR); assert.equal((await privacyBoot(env, T())).byok, "openrouter", "only OpenRouter: the privacy setting reaches it");
  await conn("p_aaaaa", "plain", A, KEY_A); assert.equal((await privacyBoot(env, T())).byok, "other", "any other service in play: their terms apply");
});

test("the upgrade changes nothing in the old byok row, and a second read does not import again", async () => {
  await wipe();
  d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,test_json,tested_at,created_at,updated_at,mode,source,effort,fast_effort) VALUES ('t1',?,?,?,?,?,'{\"ok\":true}',7,5,6,'fallback','','high','low')").run(A, "o-reason", "main-1", await seal(KEY_A), KEY_A.slice(-4));
  const before = JSON.stringify(d1.prepare("SELECT * FROM byok").get());
  await loadByok(env, "t1"); await ensureUpgrade(env, "t1");
  assert.equal(JSON.stringify(d1.prepare("SELECT * FROM byok").get()), before, "the old row is exactly as it was");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_multi").get().n, 1);
  // removing the connection or choosing other models never imports the old row again, and its address and key are not read
  await api("/api/byok/remove", { id: "p_main" }); d1.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,1,1) ON CONFLICT(tenant_id) DO NOTHING").run(A, "x", "x", "x", "x");
  await loadByok(env, "t1"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 0, "a second read imports nothing");
});

console.log = origLog;

// ===== models carried over by the upgrade (task slider-vanish) =====
const seedRec = (conn, id, effort = "") => ({ id: `${conn}:${id}`, name: id, source: "BYOK", conn, connKind: "plain", kinds: ["chat"], efforts: effort ? [effort] : [], default_effort: null, levels: [], pricing: null, seed: true });
async function upgradedAccount() {
  await connect(["p_aaaaa", "plain", A, KEY_A]);
  const config = { version: 1, categories: [{ id: "general", title: "General", chain: [entry("p_aaaaa:main-1")], max_price: null }], background: { chain: [entry("p_aaaaa:o-reason")] }, catalog: { "p_aaaaa:main-1": seedRec("p_aaaaa", "main-1"), "p_aaaaa:o-reason": seedRec("p_aaaaa", "o-reason") } };
  d1.prepare("UPDATE tenants SET custom_models_own_on=1, custom_models_own=? WHERE id='t1'").run(JSON.stringify(config));
}
test("picking a model that is also a seed record keeps the list's name and reasoning levels, and so does the next reload", async () => {
  await upgradedAccount(); const v = { settings: null, lookup: async () => null, fetchImpl: globalThis.fetch };
  // the editor sends General and Background jobs together, as it does after every pick
  const view = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:o-reason", "high"))], background: { chain: [entry("p_aaaaa:main-1")] } }, v);
  assert.deepEqual(view.models["p_aaaaa:o-reason"].efforts, ["low", "high"], "the picked model has its reasoning levels");
  assert.equal(view.models["p_aaaaa:o-reason"].name, "o-reason");
  const again = await ownViewFor(env, { id: "t1" }, "own"); assert.deepEqual(again.models["p_aaaaa:o-reason"].efforts, ["low", "high"], "still there after a reload");
  assert.ok(!(await readOwn(env, "t1")).config.catalog["p_aaaaa:o-reason"].seed, "no longer a seed");
});
test("loading the editor shows carried-over seed models with the list's facts but writes nothing; a later save stores them", async () => {
  await upgradedAccount(); const stored = () => d1.prepare("SELECT custom_models_own FROM tenants WHERE id='t1'").get().custom_models_own, before = stored();
  const view = await ownViewFor(env, { id: "t1" }, "own", { fetchImpl: globalThis.fetch });
  assert.deepEqual(view.models["p_aaaaa:o-reason"].efforts, ["low", "high"], "the carried-over model shows its reasoning levels");
  assert.deepEqual(view.categories[0].chain, [entry("p_aaaaa:main-1")], "the choices themselves are untouched");
  assert.equal(stored(), before, "a GET leaves the stored setting unchanged");
  const v = { settings: null, lookup: async () => null, fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:main-1"))], background: { chain: [entry("p_aaaaa:o-reason", "high")] } }, v);
  const rec = (await readOwn(env, "t1")).config.catalog["p_aaaaa:o-reason"]; assert.deepEqual(rec.efforts, ["low", "high"]); assert.ok(!rec.seed, "the save stored the list's record, and an effort on it validated");
});

// ===== picking an OpenCode model while a carried-over model with reasoning levels sits in another slot (task picker-speed) =====
test("a pick is saved when another slot keeps a carried-over model whose list names reasoning levels and whose saved level is empty", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "Work"], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"]);
  const config = { version: 1, categories: [{ id: "general", title: "General", chain: [entry("p_aaaaa:o-reason")], max_price: null }], background: { chain: [entry("p_aaaaa:o-reason")] }, catalog: { "p_aaaaa:o-reason": seedRec("p_aaaaa", "o-reason") } };
  d1.prepare("UPDATE tenants SET custom_models_own_on=1, custom_models_own=? WHERE id='t1'").run(JSON.stringify(config));
  const v = { settings: null, lookup: async () => null, fetchImpl: globalThis.fetch };
  await assert.rejects(saveOwn(env, "t1", { categories: [cat("general", "General", entry("opencode:glm-5.3"))] }, v), /reasoning level/, "a newly picked model still needs one of its levels");
  const view = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("opencode:glm-5.3", "medium"))], background: { chain: [entry("p_aaaaa:o-reason")] } }, v);
  assert.equal(view.categories[0].chain[0].model, "opencode:glm-5.3", "the OpenCode pick is stored while Background keeps its unchanged model");
  assert.equal(view.background.chain[0].effort, null, "the unchanged slot keeps its empty level");
});

test("a keyless OpenCode connection from the removed sign-in without a key is removed when read, with its models", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "A"]);
  d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at) VALUES ('t1','opencode','opencode','OpenCode',?,'','',9,1)").run(OC_BASE);
  const entry = (m) => ({ model: m, effort: null });
  d1.prepare("UPDATE tenants SET custom_models_own=?, custom_models_own_on=1 WHERE id='t1'").run(JSON.stringify({ version: 1, categories: [{ id: "general", title: "General", chain: [entry("opencode:glm-5.3"), entry("p_aaaaa:main-1")], max_price: null }], background: { chain: [entry("opencode:glm-5.3")] }, catalog: { "opencode:glm-5.3": { id: "opencode:glm-5.3" }, "p_aaaaa:main-1": { id: "p_aaaaa:main-1" } } }));
  const rows = await listRows(env, "t1");
  assert.deepEqual(rows.map((r) => r.id), ["p_aaaaa"], "the keyless row is gone");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections WHERE id='opencode'").get().n, 0);
  const cfg = JSON.parse(d1.prepare("SELECT custom_models_own c FROM tenants WHERE id='t1'").get().c);
  assert.deepEqual(cfg.categories[0].chain.map((e) => e.model), ["p_aaaaa:main-1"], "its models left the chain");
  assert.deepEqual(cfg.background.chain, []);
  assert.deepEqual(Object.keys(cfg.catalog), ["p_aaaaa:main-1"]);
});

test("the picker answers for one connection on its own, and a failing service is named while the others still list (task picker-speed)", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "Work"], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"], ["p_bbbbb", "plain", B, KEY_B]);
  const t = { id: "t1" }; _resetLists(); down.add("b.example-ai.com");
  const all = await ownPicker(env, t, "own", ""); assert.deepEqual(all.errors.map((e) => e.id), ["p_bbbbb"]); assert.ok(all.models.some((m) => m.conn === "p_aaaaa") && all.models.some((m) => m.conn === "opencode"));
  const one = await ownPicker(env, t, "own", "", { conn: "opencode" }); assert.deepEqual([...new Set(one.models.map((m) => m.conn))], ["opencode"]); assert.deepEqual(one.errors, []);
  const bad = await ownPicker(env, t, "own", "", { conn: "p_bbbbb" }); assert.deepEqual([bad.models.length, bad.errors.map((e) => e.id)], [0, ["p_bbbbb"]]);
  down.delete("b.example-ai.com");
});

test("from a carried-over setting (seed records, empty levels), a reasoning level can be set on General's first choice and on Background, and an OpenCode model can be picked (task picker-speed)", async () => {
  await connect(["p_aaaaa", "plain", A, KEY_A, "Work"], ["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"]);
  const seeds = { "p_aaaaa:o-reason": seedRec("p_aaaaa", "o-reason"), "p_aaaaa:main-1": seedRec("p_aaaaa", "main-1") };
  const stored = () => ({ version: 1, categories: [{ id: "general", title: "General", chain: [entry("p_aaaaa:o-reason")], max_price: null }], background: { chain: [entry("p_aaaaa:o-reason")] }, catalog: seeds });
  const v = { settings: null, lookup: async () => null, fetchImpl: globalThis.fetch };
  const reset = () => d1.prepare("UPDATE tenants SET custom_models_own_on=1, custom_models_own=? WHERE id='t1'").run(JSON.stringify(stored()));
  // the editor always sends General and Background together
  reset(); let view = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:o-reason", "high"))], background: { chain: [entry("p_aaaaa:o-reason")] } }, v);
  assert.equal(view.categories[0].chain[0].effort, "high"); assert.equal(view.background.chain[0].effort, null, "Background keeps its level");
  reset(); view = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:o-reason"))], background: { chain: [entry("p_aaaaa:o-reason", "high")] } }, v);
  assert.equal(view.background.chain[0].effort, "high"); assert.equal(view.categories[0].chain[0].effort, null);
  reset(); view = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("opencode:glm-5.3", "medium"))], background: { chain: [entry("p_aaaaa:o-reason")] } }, v);
  assert.equal(view.categories[0].chain[0].model, "opencode:glm-5.3");
  reset(); view = await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:o-reason")) ], background: { chain: [entry("opencode:glm-5.3", "low")] } }, v);
  assert.equal(view.background.chain[0].model, "opencode:glm-5.3");
  await assert.rejects(saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:o-reason", "max"))] }, v), /reasoning level "max"/, "a level the model doesn't list is still refused, with its reason");
});

test("OpenCode plans: Go is the default (also for a saved connection), pay as you go switches the base and the list, every call sends a session id, a 402 is told per plan", async () => {
  await connect(["opencode", "opencode", OC_BASE, KEY_OC, "OpenCode"]);   // a row saved before plans existed: the column default makes it Go
  const cfgGo = await loadByok(env, "t1"); const go = cfgGo.connections.opencode; assert.equal(go.plan, "go"); assert.equal(go.base, "https://opencode.ai/inference/go");
  let x = await api("/api/byok"); assert.equal(x.d.connections[0].plan, "go");
  const sessions = [];
  const run = async (opts) => { const p0 = seen.length; await (await byokChat(cfgGo, chatBody, { model: "opencode:glm-5.3", ...opts })).text(); return sentTo(p0).at(-1); };
  let c = await run({ session: "task-42" }); assert.deepEqual([c.path, c.sess, c.ua], ["/inference/go/openai/v1/chat/completions", "task-42", "1Helm/1.0"]);
  c = await run({}); assert.equal(c.sess, "1helm-t1-chat", "a call with no task still has a session id");
  c = await run({ fast: true, model: "opencode:glm-5.3" }); assert.equal(c.sess, "1helm-t1-chores");
  c = await run({ purpose: "mem_extract" }); assert.equal(c.sess, "1helm-t1-mem_extract");
  for (const q of seen.filter((q) => q.host === "opencode.ai" && q.method === "POST")) sessions.push(q.sess); assert.ok(sessions.length && sessions.every(Boolean), "no call to OpenCode lacks the session header");
  // switch to pay as you go
  const g0 = seen.length; x = await api("/api/byok/opencode-plan", { plan: "bad" }); assert.equal(x.status, 400);
  x = await api("/api/byok/opencode-plan", { plan: "payg" }); assert.equal(x.d.connections[0].plan, "payg");
  const cfgP = await loadByok(env, "t1"); const p = cfgP.connections.opencode; assert.deepEqual([p.plan, p.base], ["payg", "https://opencode.ai/inference"]);
  const recs = await ownPicker(env, T(), "own", ""); assert.ok(recs.models.some((m) => m.id === "opencode:glm-5.3") && !recs.models.some((m) => m.id === "opencode:free-one"), "pay as you go lists the paid models");
  assert.ok(seen.slice(g0).some((q) => q.path === "/inference/v1/models"), "the plan switch makes the list read again from the pay as you go address");
  const pg = seen.length; await (await byokChat(cfgP, chatBody, { model: "opencode:glm-5.3" })).text(); c = sentTo(pg).at(-1); assert.deepEqual([c.path, c.sess], ["/inference/openai/v1/chat/completions", "1helm-t1-chat"]);
  x = await api("/api/byok/opencode-plan", { plan: "go" }); assert.equal(x.d.connections[0].plan, "go");
  assert.ok((await ownPicker(env, T(), "own", "")).models.some((m) => m.id === "opencode:glm-5.3"));
});
