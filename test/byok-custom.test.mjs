// node --import ./test/stubs/register.mjs test/byok-custom.test.mjs
// Custom Model Selection on an own AI key (src/byok-custom.js): the same editor and routing as a full plan, with the models the person's own endpoint serves.
// The real Resident (node:sqlite) runs real turns; fetch is faked: the person's endpoint (plain: llm.example-ai.com; OpenRouter: openrouter.ai) and the request sorter.
// Checks: the model list (OpenRouter's catalog and a plain endpoint's GET /models), validation against it, the one-to-three model chain, the starting setting (the main model),
// effort sent per endpoint type, the chain's fallback on an error, categories routed by the request sorter (General alone asks nobody), the off state (one main model),
// chores on the fast model, and a full plan unchanged (exactly three models, same messages).
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Resident } from "../src/resident.js";
import { byokChat, loadByok, effortFields } from "../src/byok.js";
import { connDdl } from "../src/ee/byok-connections.js";
import { HANDOFF_PREFIX } from "../src/ee/route2.js";
import { sealSecret } from "../src/sentinel.js";
import { saveOwn, readOwn, ownPicker, ownViewFor, ownKeyPlan, byokChatChain, endpointRecords, listedRecords, ownKeyKind, _resetLists, recordOfListed } from "../src/ee/byok-custom.js";
import { validateCategories, statusOfRow, saveCustom } from "../src/ee/custom-models.js";
import { setPrivacy } from "../src/privacy.js";
import { accountRoute } from "../src/account.js";
import { withSettings } from "./helpers/seed-settings.mjs";

const KEY = "sk-test-SECRET-abc123XYZ7890keepout", HOST = "llm.example-ai.com", BASE = `https://${HOST}/v1`, OR_BASE = "https://openrouter.ai/api/v1";

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', past_due_since INTEGER, stripe_customer TEXT DEFAULT '',
  stripe_subscription TEXT DEFAULT '', sub_status TEXT, plan TEXT, updated_at INTEGER);
  INSERT INTO tenants (id, slug, helper_name, first_name, plan, stripe_subscription) VALUES ('t1','ck1','Ollie','Sam','byok','sub_1');
  CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);`);
for (const f of ["0022_031_byok", "0017_026_plan_cancel", "0038_046_ai_privacy", "0064_custom_models", "0065_custom_models_own_key"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
d1.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER, ua TEXT, place TEXT)");
d1.exec(/CREATE TABLE IF NOT EXISTS email_changes[^;]*;/.exec(readFileSync(new URL("../db/migrations/0021_030_account.sql", import.meta.url), "utf8"))[0]); d1.exec(readFileSync(new URL("../db/migrations/0013_023_tenant_flags.sql", import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };

// ---- ledger ----
const led = { res: [], settles: [] };
const ledger = { reserve: async (id, n) => { led.res.push([id, n]); return { ok: true }; }, settle: async (id, n) => { led.settles.push([id, n]); return { ok: true }; } };
const env = withSettings({ ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", MEMORY: "off", GENUI: "off", WORKMEM: "off", OPENROUTER_API_KEY: "or-key", ROUTER_MODE: "two", OWN_ROUTER: "on", DYNAMIC_ROUTING: "on",
  MODEL: "@cf/zai-org/glm-5.3-flash", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 3 + 7)).toString("base64"), LEDGER: { idFromName: (n) => n, get: () => ledger }, ENV_NAME: "test",
  AI: { run: async (m, b) => { if (m === "@cf/baai/bge-m3") return { data: b.text.map(() => [1, 0, 0]), usage: { prompt_tokens: 1000 } }; throw new Error("workers ai must not be called"); } } });
const SETTINGS = env.MODEL_SETTINGS;

// ---- fake network ----
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const prov = [], gets = [], sorter = []; let failModels = new Set(), sorterPick = "Research", modelList = null;
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const url = new URL(u);
  if (/systemone/.test(u)) { sorter.push(JSON.parse(init.body || "{}")); return jres({ answers: { is_task: { noul: 1 }, category: { choice: sorterPick }, unmet: { noul: 0 }, steer: { choice: "none" } }, usage: { cost: 0.0004 } }); }
  if (url.hostname !== HOST && url.hostname !== "openrouter.ai") throw new Error(`unexpected fetch ${u}`);
  if (init.method === "GET") { gets.push({ url: u, auth: init.headers?.authorization, redirect: init.redirect }); return modelList instanceof Response ? modelList : jres(modelList ?? { data: [] }); }
  const body = JSON.parse(init.body || "{}"); prov.push({ url: u, host: url.hostname, auth: init.headers?.authorization, body });
  if (failModels.has(body.model)) return jres({ error: { message: `model ${body.model} is overloaded` } }, 503);
  const last = body.messages.at(-1);
  if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return sse([{ model: body.model, choices: [{ delta: { content: JSON.stringify({ completed: ["notes"], changed_files: [], working_commands: [], decisions: [], key_facts: [], unfinished: [] }) }, finish_reason: "stop" }] }]);
  if (!body.stream) return jres({ model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ title: "T", result: "R", summary: "S", chat_title: "C", why: {} }) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
  return sse([{ model: body.model, choices: [{ delta: { content: `answer from ${body.model}` } }] }, { model: body.model, choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.5 } }]);
};
const cfgOf = (base = BASE, model = "main-1") => Object.defineProperty({ base, host: new URL(base).hostname, model, fast: "fast-1", last4: KEY.slice(-4) }, "key", { value: KEY });   // one service, no connections: the single-service path of byokChat
// Connected services of the account (byok-connections.js): rows written directly, and the account marked as upgraded so nothing is read from the old byok row.
async function connect(...list) {
  await connDdl(env); d1.exec("DELETE FROM byok_connections; DELETE FROM byok;"); d1.prepare("INSERT OR REPLACE INTO byok_multi (tenant_id, upgraded_at) VALUES ('t1', 1)").run();
  for (const [id, kind, base] of list.length ? list : [["p_main", "plain", BASE]])
    d1.prepare("INSERT INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,?,1,1)").run(id, kind, kind === "openrouter" ? "OpenRouter" : new URL(base).hostname, base, await sealSecret(env, KEY), KEY.slice(-4));
}
const P = (m) => `p_main:${m}`, O = (m) => `openrouter:${m}`;

const reset = async (level = "unrestricted", ...conns) => { d1.exec("UPDATE tenants SET custom_models_own_on=0, custom_models_own=NULL, custom_models_on=0, custom_models=NULL, plan='byok' WHERE id='t1'"); _resetLists(); failModels = new Set(); modelList = null; await connect(...conns); return setPrivacy({ DB: D1 }, "t1", level); };
const entry = (model, effort = null) => ({ model, effort });
const cat = (id, title, ...chain) => ({ id, title, chain, max_price: null });
const rec = (id, efforts = ["none", "low", "high"], levels = ["unrestricted", "no_training", "zdr"]) => ({ id, source: "OR", kinds: ["chat", "chore"], name: `Name ${id.split("/")[1]}`, eligible: true, reasons: [], efforts, default_effort: efforts[1] || efforts[0], levels, hosts: ["acme"],
  terms: { zdr: levels.includes("zdr"), no_training: levels.includes("no_training") }, context_length: 100000, max_output: 8000, input_modalities: ["text"], pricing: { prompt: 1, completion: 2 }, json: true, tool_choice: ["auto", "none"] });
const FAKE = { "acme/a": rec("acme/a"), "acme/b": rec("acme/b"), "acme/c": rec("acme/c"), "acme/open": rec("acme/open", ["low"], ["unrestricted"]) };
const lookup = async (id) => FAKE[id] || null;
const PLAIN = { data: [{ id: "main-1" }, { id: "llama-3.3-70b", name: "Llama 3.3 70B", context_length: 131072 }, { id: "o-reason", supported_reasoning_efforts: ["low", "medium", "high"] }, { id: "qwen-coder" }, { id: "mistral-small", pricing: { prompt: "0.0000002", completion: "0.0000006" } },
  { id: "embed-only", supported_parameters: ["max_tokens"] }, { id: "gemma-2" }, { id: "bad id with spaces" }, { id: "fast-1" }] };
const refuses = (p, re, status = 400) => assert.rejects(p, (e) => { assert.equal(e.status, status); assert.match(e.message, re); assert.ok(!String(e.message).includes(KEY)); return true; });
const base = { settings: { ...SETTINGS, catalog: {} }, lookup };

// ---- the Resident ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = [];
const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p), id: { toString: () => "res-byokc-000000000000000000000" } };
const R = new Resident(ctx, env);
R.systemPrompt = async () => "SYSTEM";
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
async function turn(text) {
  const S = R.newSession("Task"), p0 = prov.length, s0 = sorter.length, r0 = led.res.length;
  const r = await R.runTurn("t1", "main", "1", text, () => {}, { session: S });
  await Promise.allSettled(waits.splice(0));
  const calls = prov.slice(p0), main = calls.filter((c) => c.body.stream && !String(c.body.messages.at(-1).content).startsWith(HANDOFF_PREFIX));
  return { r, calls, main, chores: calls.filter((c) => !main.includes(c)), sorter: sorter.slice(s0), res: led.res.slice(r0), S };
}


// ===== the model list =====
test("a plain service's model list: GET <base>/models with its key, no redirect, only what the list says; the picker names the service", async () => {
  await reset(); modelList = PLAIN;
  const list = await endpointRecords(cfgOf(), "t1");
  assert.deepEqual(list.map((r) => r.id).sort(), ["fast-1", "gemma-2", "llama-3.3-70b", "main-1", "mistral-small", "o-reason", "qwen-coder"], "no tool-less one, no unusable id");
  assert.deepEqual(gets.at(-1), { url: `${BASE}/models`, auth: `Bearer ${KEY}`, redirect: "manual" });
  const by = Object.fromEntries(list.map((r) => [r.id, r]));
  assert.deepEqual(by["o-reason"].efforts, ["low", "medium", "high"]); assert.equal(by["o-reason"].default_effort, "medium");
  assert.deepEqual(by["qwen-coder"].efforts, [], "no reasoning level is invented");
  assert.equal(by["llama-3.3-70b"].context_length, 131072); assert.deepEqual(by["mistral-small"].pricing, { prompt: 0.2, completion: 0.6 }); assert.equal(by["qwen-coder"].pricing, null);
  const n = gets.length; await endpointRecords(cfgOf(), "t1"); assert.equal(gets.length, n, "asked once for a minute of searches");
  const t = { id: "t1" }, p = await ownPicker(env, t, "own", "");
  assert.equal(p.models.length, 7); assert.ok(p.models.every((m) => m.allowed === true && m.source === "BYOK" && m.id.startsWith("p_main:") && m.service === HOST));
  assert.deepEqual((await ownPicker(env, t, "own", "llama")).models.map((m) => m.id), ["p_main:llama-3.3-70b"]);
  assert.ok(!JSON.stringify(p).includes(KEY));
  for (const bad of [new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }), jres({ error: { message: `bad key ${KEY}` } }, 401), new Response("<html>", { status: 200 })]) {
    _resetLists(); modelList = bad;
    await assert.rejects(endpointRecords(cfgOf(), "t1"), (e) => e.byok && !e.message.includes(KEY));
    const q = await ownPicker(env, t, "own", ""); assert.deepEqual([q.models.length, q.errors.map((x) => x.id)], [0, ["p_main"]], "a service that can't be read is named, nothing is thrown");
  }
  assert.equal(listedRecords({ models: [{ model: "a/b" }] })[0].id, "a/b"); assert.equal(recordOfListed({ id: "x", supported_parameters: ["tools", "reasoning_effort"] }).efforts.length, 3);
  assert.equal(recordOfListed({ id: "x", tools: false }), null, "a model that says it has no tools"); assert.equal(recordOfListed({ id: "x", family: "responses" }).family, "responses");
});

test("on OpenRouter the picker is the same catalog and privacy filter as a full plan", async () => {
  await reset("zdr", ["openrouter", "openrouter", OR_BASE]);
  const search = async () => Object.values(FAKE), t = { id: "t1" };
  const p = await ownPicker(env, t, "own", "acme", { settings: { ...SETTINGS, catalog: {} }, search });
  assert.deepEqual(p.models.map((m) => m.id).sort(), [O("acme/a"), O("acme/b"), O("acme/c")], "zdr: the unrestricted-only model is not offered");
  assert.deepEqual(p.models[0].efforts, ["none", "low", "high"]); assert.ok(p.models[0].pricing); assert.equal(p.models[0].service, "OpenRouter");
  await setPrivacy({ DB: D1 }, "t1", "unrestricted");
  assert.ok((await ownPicker(env, t, "own", "acme", { settings: { ...SETTINGS, catalog: {} }, search })).models.some((m) => m.id === O("acme/open")));
});

// ===== saving =====
test("a plain service: nothing is chosen for the account, then models are validated against the list, one to three, no max price", async () => {
  await reset(); modelList = PLAIN;
  const none = await ownViewFor(env, { id: "t1" }, "own");
  assert.deepEqual(none.categories, [{ id: "general", title: "General", chain: [], max_price: null }]); assert.equal(none.no_model, true, "no model is picked on the account's behalf"); assert.deepEqual(none.connections.map((c) => c.id), ["p_main"]);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General")] }, base), /first model/);
  const ok0 = await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")))] }, base);
  assert.equal(ok0.no_model, false); assert.equal(ok0.own_key, true); assert.equal(ok0.on, true);
  assert.equal(d1.prepare("SELECT custom_models_on n FROM tenants WHERE id='t1'").get().n, 0, "the setting for our models is untouched");
  const ok = await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")), entry(P("o-reason"), "high"), entry(P("llama-3.3-70b"))), cat("c_code0001", "Coding", entry(P("qwen-coder")), entry(P("main-1")))] }, base);
  assert.equal(ok.categories.length, 2); assert.deepEqual(ok.categories[0].chain.map((e) => e.model), [P("main-1"), P("o-reason"), P("llama-3.3-70b")]); assert.equal(ok.categories[0].chain[1].effort, "high");
  assert.equal(ok.models[P("o-reason")].allowed, true); assert.equal(ok.models[P("o-reason")].service, HOST);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("not-served")))] }, base), /isn't in the model list of/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("qwen-coder"), "high"))] }, base), /doesn't support the reasoning level "high"/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("o-reason"), "max"))] }, base), /doesn't support the reasoning level "max"/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")), entry(P("main-1")))] }, base), /different models/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")), entry(P("gemma-2")), entry(P("qwen-coder")), entry(P("mistral-small")))] }, base), /up to two fallbacks/);
  await refuses(saveOwn(env, "t1", { categories: [{ ...cat("general", "General", entry(P("main-1"))), max_price: { prompt: 1, completion: 2 } }] }, base), /only available on OpenRouter/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1"))), cat("c_dup00001", "general", entry(P("gemma-2")))] }, base), /different name/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry("gone:main-1"))] }, base), /isn't connected/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry("main-1"))] }, base), /isn't connected|choose a model/, 400);
  assert.equal((await readOwn(env, "t1")).config.categories.length, 2, "a refused save changes nothing");
  _resetLists(); modelList = jres({ error: { message: "nope" } }, 500);
  assert.equal((await saveOwn(env, "t1", { categories: ok.categories }, base)).categories.length, 2, "a list that can't be read: models already saved stay");
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("gemma-2")))] }, base), /Couldn't read the model list of/, 503);
  const gone = await saveOwn(env, "t1", { on: false }, base); assert.equal(gone.categories.length, 2, "an own key has no off state: on is ignored");
});

test("an OpenRouter connection: the same catalog rules as a full plan, with max price and the privacy level", async () => {
  await reset("zdr", ["openrouter", "openrouter", OR_BASE]);
  const ok = await saveOwn(env, "t1", { categories: [{ ...cat("general", "General", entry(O("acme/a")), entry(O("acme/b"), "high")), max_price: { prompt: 0.5, completion: 3 } }] }, base);
  assert.deepEqual(ok.categories[0].max_price, { prompt: 0.5, completion: 3 }); assert.equal(ok.categories[0].chain.length, 2); assert.equal(ok.has_openrouter, true); assert.equal(ok.models[O("acme/a")].service, "OpenRouter");
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(O("acme/open"), "low"))] }, base), /Zero Data Retention/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(O("acme/a"), "max"))] }, base), /reasoning level "max"/);
  await refuses(saveOwn(env, "t1", { categories: [cat("general", "General", entry(O("acme/nope"), "low"))] }, base), /no longer offered/);
  await refuses(validateCategories(env, [cat("general", "General", entry("acme/a", "low"), entry("acme/b", "low"))], "zdr", { settings: SETTINGS, lookup }), /choose a first model and two fallbacks/);
  await setPrivacy({ DB: D1 }, "t1", "unrestricted"); await saveOwn(env, "t1", { categories: [cat("general", "General", entry(O("acme/open"), "low"))] }, base);
  await setPrivacy({ DB: D1 }, "t1", "zdr");
  const row = d1.prepare("SELECT * FROM tenants WHERE id='t1'").get();
  const st = statusOfRow(row, "own"); assert.equal(st.needs_choice, true); assert.equal(st.problems[0].model, O("acme/open")); assert.equal(st.own_key, true);
  await assert.rejects(ownKeyPlan(env, "t1", { settings: "s" }), (e) => e.code === "custom_models_required" && /Nothing was sent/.test(e.message));
});

// ===== sending =====
test("effort is sent the way each endpoint takes it", async () => {
  assert.deepEqual(effortFields(cfgOf(OR_BASE), "high", "acme/a", FAKE["acme/a"]), { reasoning: { effort: "high" } });
  assert.deepEqual(effortFields(cfgOf(OR_BASE), "none", "acme/b", { ...FAKE["acme/b"], efforts: ["low", "high"] }), { reasoning: { effort: "low" } }, "none is the lowest level for a model that lists no none, as on a full plan");
  assert.deepEqual(effortFields(cfgOf(OR_BASE), "default", "acme/a"), {}); assert.deepEqual(effortFields(cfgOf(OR_BASE), null, "acme/a"), {});
  assert.deepEqual(effortFields(cfgOf(), "high", "o-reason"), { reasoning_effort: "high" }); assert.deepEqual(effortFields(cfgOf(), null, "o-reason"), {});
  const msg = { messages: [{ role: "user", content: "hi" }] }, p0 = prov.length;
  await byokChat(cfgOf(OR_BASE), msg, { model: "acme/a", effort: "high", facts: FAKE["acme/a"], maxPrice: { prompt: 0.5, completion: 3 }, privacy: "zdr" });
  const o = prov.at(-1).body; assert.deepEqual(o.reasoning, { effort: "high" }); assert.deepEqual(o.provider, { zdr: true, data_collection: "deny", max_price: { prompt: 0.5, completion: 3 } }); assert.equal(o.model, "acme/a");
  await byokChat(cfgOf(), msg, { model: "o-reason", effort: "medium", maxPrice: { prompt: 1, completion: 1 } });
  const p = prov.at(-1).body; assert.equal(p.reasoning_effort, "medium"); assert.ok(!("reasoning" in p) && !("provider" in p), "no OpenRouter fields to a plain endpoint, no max price");
  assert.equal(prov.length, p0 + 2);
});

test("a model that fails hands the call to the next one in the chain; a bad key and Stop do not", async () => {
  await reset(); failModels = new Set(["a-1"]);
  const cfg = await loadByok(env, "t1");
  const plan = { title: "General", maxPrice: null, chain: [{ model: P("a-1"), effort: null, facts: null }, { model: P("b-2"), effort: "high", facts: null }, { model: P("c-3"), effort: null, facts: null }] };
  const body = { messages: [{ role: "user", content: "hi" }], stream: true }, p0 = prov.length;
  const r = await byokChatChain(cfg, body, plan);
  assert.equal(r.pick.model, P("b-2")); assert.equal(r.pick.slot, 1); assert.equal(r.pick.failed[0].model, P("a-1")); assert.match(r.pick.failed[0].error, /overloaded/);
  assert.deepEqual(prov.slice(p0).map((c) => [c.body.model, c.body.reasoning_effort ?? null]), [["a-1", null], ["b-2", "high"]], "the service gets its own model name; the third is never asked");
  failModels = new Set(["a-1", "b-2", "c-3"]);
  await assert.rejects(byokChatChain(cfg, body, plan), (e) => e.byok && /Settings → AI services/.test(e.message) && !e.message.includes(KEY), "all fail: the plain message with the Settings link");
  const ac = new AbortController(); ac.abort(); failModels = new Set(["a-1"]); const p1 = prov.length;
  await assert.rejects(byokChatChain(cfg, body, plan, { signal: ac.signal })); assert.ok(prov.length - p1 <= 1, "Stop ends the chain");
  await assert.rejects(byokChat(cfg, body, { model: "gone:x" }), /disconnected/); await assert.rejects(byokChat(cfg, body), /no model is chosen/);
});

test("a real turn: nothing chosen says so and sends nothing; the chain answers; chores use Background jobs, else General's first model", async () => {
  await reset(); modelList = PLAIN; const p0 = prov.length;
  const t0 = await turn("hello"); assert.match(t0.r.reply, /no model is chosen/); assert.equal(prov.length, p0, "no request went to any service");
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("qwen-coder")), entry(P("o-reason"), "high"), entry(P("gemma-2")))] }, base);
  failModels = new Set(["qwen-coder"]);
  const t3 = await turn("who answers?");
  assert.deepEqual(t3.main.map((c) => [c.body.model, c.body.reasoning_effort ?? null]), [["qwen-coder", null], ["o-reason", "high"]]);
  assert.equal(t3.r.reply, "answer from o-reason"); assert.ok(t3.chores.every((c) => c.body.model === "qwen-coder" || c.body.model === "o-reason"), `no Background jobs chosen: chores use General's first model, falling back down its chain: ${t3.chores.map((c) => c.body.model)}`);
  assert.ok(t3.r.models.some((x) => /o-reason \[byok\/General 2\] \[fallback: p_main:qwen-coder:/.test(x)), `the turn stats say which model answered: ${t3.r.models.join(" | ")}`);
  assert.ok(!t3.res.some(([id]) => id.startsWith("res:") || id.startsWith("rtr:")), "the AI itself is never reserved or charged");
  failModels = new Set(); await saveOwn(env, "t1", { background: { chain: [entry(P("fast-1"))] } }, base);
  const t4 = await turn("again"); assert.ok(t4.chores.length > 0 && t4.chores.every((c) => c.body.model === "fast-1"), "chores keep the Background jobs model");
});

test("categories: General alone asks nobody; with more the request sorter picks among the titles, and the main turn stays on General (a worker takes the other categories: test/byok-handoff.test.mjs)", async () => {
  await reset(); modelList = PLAIN;
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")))] }, base);
  assert.deepEqual((await turn("alone")).sorter, []);
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1"))), cat("c_code0001", "Coding", entry(P("qwen-coder")), entry(P("gemma-2"))), cat("c_wrte0001", "Writing", entry(P("mistral-small"), null))], background: { chain: [entry(P("fast-1"))] } }, base);
  sorterPick = "Coding"; const a = await turn("fix this bug");
  assert.equal(a.sorter.length, 1, "the request sorter was asked once");
  assert.ok(/General/.test(JSON.stringify(a.sorter[0])) && /Coding/.test(JSON.stringify(a.sorter[0])) && /Writing/.test(JSON.stringify(a.sorter[0])), "the account's titles");
  assert.ok(a.main.length >= 1 && a.main.every((c) => c.body.model === "main-1"), `Primary stays on General's model: ${a.main.map((c) => c.body.model)}`); assert.ok(a.res.some(([id]) => id.startsWith("byok-route:")), "reserved first, like every part 1Helm runs on an own key");
  assert.ok(a.chores.every((c) => c.body.model === "fast-1"));
  const settled = led.settles.filter(([id]) => id.startsWith("byok-route:")).at(-1); assert.equal(settled[1], Math.ceil(0.0004 * 1e9 * 1.15), "the sorter is charged at its cost + 15%");
  sorterPick = "General"; const c = await turn("hi"); assert.deepEqual(c.main.map((x) => x.body.model), ["main-1"]);
  assert.ok(a.r.models.every((x) => /\[byok\/General 1\]/.test(x)), a.r.models.join());
  const real = ledger.reserve; ledger.reserve = async (id, n) => (id.startsWith("byok-route:") ? { ok: false } : real(id, n)); sorterPick = "Coding";
  try { const d = await turn("again"); assert.equal(d.sorter.length, 0); assert.deepEqual(d.main.map((x) => x.body.model), ["main-1"]); } finally { ledger.reserve = real; }
});

test("an OpenRouter connection sends reasoning.effort and max price with the privacy fields, and its models fall back in order", async () => {
  await reset("zdr", ["openrouter", "openrouter", OR_BASE]);
  await saveOwn(env, "t1", { categories: [{ ...cat("general", "General", entry(O("acme/b"), "high"), entry(O("acme/c"), "low")), max_price: { prompt: 0.5, completion: 3 } }] }, base);
  failModels = new Set(["acme/b"]); const t = await turn("hello");
  assert.deepEqual(t.main.map((c) => c.body.model), ["acme/b", "acme/c"]); assert.ok(t.main.every((c) => c.url === `${OR_BASE}/chat/completions`));
  assert.deepEqual(t.main[0].body.reasoning, { effort: "high" }); assert.deepEqual(t.main[1].body.reasoning, { effort: "low" });
  assert.deepEqual(t.main[1].body.provider, { zdr: true, data_collection: "deny", max_price: { prompt: 0.5, completion: 3 } });
  assert.equal(t.r.reply, "answer from acme/c");
});

// ===== the account routes =====
test("the account routes on an own key: state, picker, save; a full plan still gets its own editor", async () => {
  await reset(); modelList = PLAIN;
  const origin = "https://app.example.test", user = { id: "u1", email: "a@example.com" }, deps = { modelSettings: async () => SETTINGS, search: async () => [], lookup };
  const call = async (method, sub, body) => { const url = new URL(origin + "/w/ck1" + sub); sub = sub.split("?")[0];
    const res = await accountRoute(new Request(url, { method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, d1.prepare("SELECT * FROM tenants WHERE id='t1'").get(), user, url, sub, deps); return { status: res.status, body: await res.json() }; };
  assert.equal(await ownKeyKind(env, { id: "t1", plan: "byok" }), "own");
  let r = await call("GET", "/api/account/custom-models"); assert.deepEqual([r.status, r.body.on, r.body.own_key, r.body.no_model, r.body.categories[0].chain], [200, true, true, true, []]);
  assert.deepEqual((await call("GET", "/api/account")).body.custom_models, { on: true, level: "unrestricted", own_key: true, needs_choice: false, no_model: true, problems: [], endpoint: "own" });
  r = await call("GET", "/api/account/custom-models/catalog?q=o-re"); assert.deepEqual(r.body.models.map((m) => m.id), ["p_main:o-reason"]); assert.equal(r.body.endpoint, "own");
  r = await call("POST", "/api/account/custom-models", { categories: [cat("general", "General", entry(P("main-1")), entry(P("gemma-2")))] }); assert.equal(r.status, 200); assert.equal(r.body.categories[0].chain.length, 2);
  r = await call("POST", "/api/account/custom-models", { categories: [cat("general", "General", entry(P("zzz")))] }); assert.equal(r.status, 400); assert.match(r.body.error, /model list/);
  assert.equal(JSON.stringify(r.body).includes(KEY), false);
  assert.equal((await call("GET", "/api/account")).body.custom_models.no_model, false);
  d1.exec("UPDATE tenants SET plan='plus' WHERE id='t1'"); d1.exec("DELETE FROM byok");
  r = await call("GET", "/api/account/custom-models"); assert.equal(r.body.own_key, undefined); assert.equal(r.body.on, false);
  assert.equal((await call("GET", "/api/account")).body.custom_models.own_key, undefined);
});

// ===== Background jobs: the chores' own chain =====
const chat = { messages: [{ role: "user", content: "title this" }], max_tokens: 50 };
test("Background jobs: the chores use its chain with fallback; with none chosen they use General's first model", async () => {
  await reset(); modelList = PLAIN;
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")))] }, base);
  let p0 = prov.length; await byokChat(await loadByok(env, "t1"), chat, { fast: true }); assert.deepEqual(prov.slice(p0).map((c) => c.body.model), ["main-1"]);
  const saved = await saveOwn(env, "t1", { background: { chain: [entry(P("qwen-coder")), entry(P("o-reason"), "high")] } }, base);
  assert.deepEqual(saved.background.chain, [{ model: P("qwen-coder"), effort: null }, { model: P("o-reason"), effort: "high" }]); assert.deepEqual(saved.categories[0].chain, [{ model: P("main-1"), effort: null }]);
  failModels = new Set(["qwen-coder"]); p0 = prov.length; await byokChat(await loadByok(env, "t1"), chat, { fast: true });
  assert.deepEqual(prov.slice(p0).map((c) => [c.body.model, c.body.reasoning_effort ?? null]), [["qwen-coder", null], ["o-reason", "high"]]);
  const again = await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")), entry(P("llama-3.3-70b")))] }, base);
  assert.deepEqual(again.background.chain.map((e) => e.model), [P("qwen-coder"), P("o-reason")], "saving only the categories keeps Background jobs");
  failModels = new Set(); const t = await turn("hello");
  assert.deepEqual(t.main.map((c) => c.body.model), ["main-1"]); assert.ok(t.chores.length > 0 && t.chores.every((c) => c.body.model === "qwen-coder" && c.body.reasoning_effort === undefined), t.chores.map((c) => c.body.model).join());
  const none = await saveOwn(env, "t1", { background: { chain: [] } }, base); assert.deepEqual(none.background.chain, []);
  p0 = prov.length; await byokChat(await loadByok(env, "t1"), chat, { fast: true }); assert.deepEqual(prov.slice(p0).map((c) => c.body.model), ["main-1"]);
});

test("Background jobs is validated like a category and exists only for own-key accounts", async () => {
  await reset(); modelList = PLAIN;
  await refuses(saveOwn(env, "t1", { background: { chain: [entry(P("qwen-coder"))] } }, base), /Choose a model for General first/, 409);
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry(P("main-1")))] }, base);
  await refuses(saveOwn(env, "t1", { background: { chain: [entry(P("not-served"))] } }, base), /isn't in the model list of/);
  await refuses(saveOwn(env, "t1", { background: { chain: [entry(P("qwen-coder"), "high")] } }, base), /Background jobs, first choice|doesn't support the reasoning level "high"/);
  await refuses(saveOwn(env, "t1", { background: { chain: [entry(P("main-1")), entry(P("main-1"))] } }, base), /Background jobs: choose different models/);
  await refuses(saveOwn(env, "t1", { background: { chain: [entry(P("main-1")), entry(P("gemma-2")), entry(P("qwen-coder")), entry(P("mistral-small"))] } }, base), /Background jobs: choose a first model and up to two fallbacks/);
  await refuses(saveOwn(env, "t1", { background: { chain: [entry(P("main-1"))], extra: 1 } }, base), /Invalid Background jobs/);
  await assert.rejects(saveCustom(env, "t1", { background: { chain: [entry("acme/a")] } }, { settings: SETTINGS }), /Nothing to change/);
  d1.exec("UPDATE tenants SET plan='plus' WHERE id='t1'"); assert.equal(await loadByok(env, "t1"), null);
});
