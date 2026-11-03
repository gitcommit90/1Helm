// node --import ./test/stubs/register.mjs test/repeat-answer.test.mjs
// After two looping steps the person still gets an answer (BYOK lane, real Resident, faked endpoint): one last attempt with tools off, a short output cap
// and the next model of the account's own Custom Model Selection category, summed usage, and an accurate plain message when that fails too.
// Tests check app facts (calls sent, models, tools, caps, which message was kept), never model wording.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Resident } from "../src/resident.js";
import { byokChat, loadByok, effortFields } from "../src/byok.js";
import { connDdl } from "../src/ee/byok-connections.js";
import { HANDOFF_PREFIX } from "../src/ee/route2.js";
import { sealSecret } from "../src/sentinel.js";
import { saveOwn, readOwn, ownPicker, ownKeyPlan, byokChatChain, endpointRecords, listedRecords, ownKeyKind, _resetLists, recordOfListed } from "../src/ee/byok-custom.js";
import { validateCategories, statusOfRow, saveCustom } from "../src/ee/custom-models.js";
import { setPrivacy } from "../src/privacy.js";
import { accountRoute } from "../src/account.js";
import { withSettings } from "./helpers/seed-settings.mjs";

const KEY = "fake-own-key-for-test-keepout", HOST = "llm.example-ai.com", BASE = `https://${HOST}/v1`, OR_BASE = "https://openrouter.ai/api/v1";

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

import { REPEAT_NOTE, REPEAT_FALLBACK, REPEAT_FALLBACK_AFTER_WORK, BATCH_FALLBACK, BATCH_FALLBACK_AFTER_WORK, FINAL_ASK, FINAL_MAX_OUT } from "../src/repeat-guard.js";
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const enc = new TextEncoder(), ev = (e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
function loopStream(model) {
  let i = 0;
  return new Response(new ReadableStream({ pull(c) { if (i > 100000) { c.close(); return; } const chunk = Array.from({ length: 20 }, () => `2026-01-${String(1 + (i++ % 28)).padStart(2, "0")}`).join(" ") + " ";
    c.enqueue(ev({ model, choices: [{ delta: { content: chunk } }] })); } }), { status: 200 });
}
function batchStream(model) {
  let i = 0;
  return new Response(new ReadableStream({ pull(c) { if (i >= 100) { c.close(); return; } const n = i++;
    c.enqueue(ev({ model, choices: [{ delta: { tool_calls: [{ index: n, id: `b${n}`, type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "ls", step_title: `s${n}` }) } }] } }] })); } }), { status: 200 });
}
let failModels = new Set(), modelList = null;
const prov = []; let script = [];   // script items by call: "LOOP", "BATCH", "TOOL" (a run_command call), or the answer text
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const url = new URL(u);
  if (/systemone/.test(u)) return jres({ answers: { is_task: { noul: 1 }, category: { choice: "General" }, unmet: { noul: 0 }, steer: { choice: "none" } }, usage: { cost: 0.0004 } });
  if (url.hostname !== HOST) throw new Error(`unexpected fetch ${u}`);
  if (init.method === "GET") return jres({ data: [{ id: "main-1" }, { id: "second-2" }, { id: "third-3" }] });
  const body = JSON.parse(init.body || "{}"); const last = body.messages.at(-1);
  if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return sse([{ model: body.model, choices: [{ delta: { content: "{}" }, finish_reason: "stop" }] }]);
  if (!body.stream) return jres({ model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ title: "T", result: "R", summary: "S", chat_title: "C", why: {} }) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
  prov.push({ body }); const s = script.shift() ?? "Done.";
  if (s === "LOOP") return loopStream(body.model); if (s === "BATCH") return batchStream(body.model);
  if (s === "TOOL") return sse([{ model: body.model, choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "echo hi", step_title: "Look" }) } }] }, finish_reason: "tool_calls" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } }]);
  return sse([{ model: body.model, choices: [{ delta: { content: s } }] }, { model: body.model, choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } }]);
};
const cfgOf = (base = BASE, model = "main-1") => Object.defineProperty({ base, host: new URL(base).hostname, model, fast: "fast-1", last4: KEY.slice(-4) }, "key", { value: KEY });
async function saveRow({ base = BASE, model = "main-1", fast = "fast-1" } = {}) {
  await connDdl(env); d1.exec("DELETE FROM byok_connections; DELETE FROM byok_multi;");   // the account still has the one saved key of before: it becomes a connection when first read
  d1.prepare("INSERT OR REPLACE INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,?,?)").run(base, model, fast, await sealSecret(env, KEY), KEY.slice(-4), Date.now(), Date.now());
}
const reset = (level = "unrestricted") => { d1.exec("UPDATE tenants SET custom_models_own_on=0, custom_models_own=NULL, custom_models_on=0, custom_models=NULL, plan='byok' WHERE id='t1'"); _resetLists(); failModels = new Set(); modelList = null; return setPrivacy({ DB: D1 }, "t1", level); };
const entry = (model, effort = null) => ({ model: model.includes(":") ? model : `p_main:${model}`, effort });
const cat = (id, title, ...chain) => ({ id, title, chain, max_price: null });
// ---- the Resident ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = [];
const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p), id: { toString: () => "res-byokc-000000000000000000000" } };
const R = new Resident(ctx, env);
R.systemPrompt = async () => "SYSTEM";
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.systemPrompt = async () => "SYSTEM"; R.computer = () => ({ warm: async () => ({ ok: true }) });
const ran = []; R.execComputerTool = async (name, a) => { ran.push([name, a]); return { code: 0, out: "ok" }; };
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
const mains = (p0) => prov.slice(p0).map((c) => c.body).filter((b) => !String(b.messages.at(-1).content).startsWith(HANDOFF_PREFIX));
async function turn(text, steps, { chain = ["main-1", "second-2", "third-3"] } = {}) {
  await reset(); await saveRow();
  await saveOwn(env, "t1", { on: true }, { cfg: cfgOf(), kind: "plain" });
  await saveOwn(env, "t1", { categories: [cat("general", "General", ...chain.map((m) => entry(m)))] }, { cfg: cfgOf(), kind: "plain" });
  script = [...steps]; ran.length = 0; const p0 = prov.length;
  const r = await R.runTurn("t1", "main", "1", text, () => {}, { session: R.newSession("Task") });
  const calls = mains(p0), used = R.sql ? null : null; void used;
  return { r, calls, p0 };
}
const tools = (b) => (b.tools || []).length, wasNoted = (b, note) => b.messages.some((m) => m.content === note);

test("loop, loop, then an answer: the person gets the answer from the next model, tools off, short cap, no tool run", async () => {
  const t = await turn("why is it dearer?", ["LOOP", "LOOP", "Here is the answer."]);
  assert.equal(t.r.error, null); assert.equal(t.r.reply, "Here is the answer."); assert.equal(ran.length, 0);
  assert.deepEqual(t.calls.map((b) => b.model), ["main-1", "main-1", "second-2"], "first retry stays on the same model, the last attempt uses the next model in the category order");
  assert.ok(wasNoted(t.calls[1], REPEAT_NOTE)); assert.equal(t.calls[2].messages.at(-1).content, FINAL_ASK);
  assert.equal(tools(t.calls[2]), 0, "tools are off on the last attempt"); assert.ok(tools(t.calls[0]) > 0);
  assert.equal(t.calls[2].max_tokens, FINAL_MAX_OUT, "short output cap");
  assert.ok(!JSON.stringify(t.calls[2].messages).includes("2026-01-01 2026-01-02"), "the discarded output is not sent again");
  assert.equal(t.r.models.length, 1, "one step recorded");
});

test("loop, loop, loop: the plain message, accurate when no earlier step ran a tool; three calls only", async () => {
  const t = await turn("why is it dearer?", ["LOOP", "LOOP", "LOOP"]);
  assert.equal(t.calls.length, 3); assert.equal(t.r.reply, REPEAT_FALLBACK); assert.equal(ran.length, 0);
});

test("earlier steps ran a tool: the plain message says so and no longer says nothing ran", async () => {
  const t = await turn("look then explain", ["TOOL", "LOOP", "LOOP", "LOOP"]);
  assert.equal(ran.length, 1); assert.equal(t.r.reply, REPEAT_FALLBACK_AFTER_WORK); assert.ok(!/Nothing from that step was run/.test(t.r.reply));
  const u = await turn("look then explain", ["TOOL", "LOOP", "LOOP", "Answer after tools."]);
  assert.equal(u.r.reply, "Answer after tools."); assert.equal(u.calls.length, 4);
});

test("a tool batch that is stopped twice gets the same last attempt and its own accurate fallback", async () => {
  const a = await turn("do many things", ["BATCH", "BATCH", "Answer instead."]);
  assert.equal(a.r.reply, "Answer instead."); assert.equal(ran.length, 0); assert.equal(tools(a.calls[2]), 0);
  const b = await turn("do many things", ["TOOL", "BATCH", "BATCH", "BATCH"]);
  assert.equal(b.r.reply, REPEAT_FALLBACK_AFTER_WORK, "a batch-repeat hit uses the repeat message; batch-limit uses the batch one (unit test below)");
});

test("one model only: the last attempt stays on it; usage of every attempt is summed", async () => {
  const t = await turn("why?", ["LOOP", "LOOP", "Short answer."], { chain: ["main-1"] });
  assert.deepEqual(t.calls.map((b) => b.model), ["main-1", "main-1", "main-1"]); assert.equal(t.r.reply, "Short answer.");
  assert.equal(t.r.step_in.length, 1, "one step"); assert.equal(t.r.in, t.r.step_in[0], "the step input is the sum of its attempts");
  assert.ok(t.r.in > 100 + 2 * 100, `both looped attempts are counted as well as the answer: ${t.r.in}`); assert.ok(t.r.out > 1000, `looped output is counted: ${t.r.out}`);
});

test("fallback texts: accurate and plain", () => {
  assert.ok(!/Nothing from that step was run/.test(REPEAT_FALLBACK_AFTER_WORK) && !/Nothing from that step was run/.test(BATCH_FALLBACK_AFTER_WORK));
  assert.ok(/earlier steps/.test(BATCH_FALLBACK_AFTER_WORK) && /Nothing from that step was run/.test(BATCH_FALLBACK));
});

// ---- OpenRouter route: the model chain of a running task (model.js taskChat) ----
import { capped } from "../src/model.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { seedSettings, ID } from "./helpers/seed-settings.mjs";
test("OpenRouter task route: the last attempt starts at the next model of the frozen chain and takes the short cap; no start index means the first model", async () => {
  await new Promise((r) => setTimeout(r, 100));   // chores of the turns before finish first, so none of their calls lands in this test's list
  const s = seedSettings(), ids = [ID.SOL, ID.MUSE_C];
  const cat1 = (id) => ({ id, source: "OR", eligible: true, kinds: ["chat"], hosts: ["azure"], levels: ["unrestricted", "no_training", "zdr"], efforts: ["default", "high"], context_length: 16000, max_output: 8000, input_modalities: ["text"], pricing: { prompt: 1, completion: 2 }, tool_choice: ["auto", "none"], json: false });
  for (const id of ids) s.catalog[id] = cat1(id);
  const prof = (id) => ({ version: 1, mode: "managed", source: "OR", requestedModel: id, effort: "high", catalog: s.catalog[id], hosts: ["azure"], contextLength: 16000, maxOutput: 8000, cacheSession: "stable", level: "unrestricted" });
  const chain = ids.map(prof), wire = [], saved = globalThis.fetch;
  const e = { ONEHELM_EE: "1hc", ENV_NAME: "dev", DYNAMIC_ROUTING: "on", MODEL_SETTINGS: s, OPENROUTER_API_KEY: "synthetic", PROMPT_CACHE: "off", DB: { prepare() { return { bind() { return this; }, async first() { return { ai_privacy: "unrestricted" }; } }; } } };
  globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); wire.push(b); return Response.json({ model: b.model, choices: [{ message: { content: "ok" } }], usage: { cost: 0.00001 } }); };
  try {
    let route = { taskAffinity: true, taskProfile: { ...chain[0], poolChain: chain } };
    await openRouterChat(e, { messages: [] }, "ignored", route, { tenant: "t" }); assert.equal(wire.at(-1).model, ids[0]); assert.equal(wire.at(-1).max_tokens, undefined, "no saved limit, none sent");
    route = { taskAffinity: true, taskProfile: { ...chain[0], poolChain: chain }, startAt: 1, capOut: 2000 };
    await openRouterChat(e, { messages: [] }, "ignored", route, { tenant: "t" }); assert.equal(wire.at(-1).model, ids[1], "the next model"); assert.equal(wire.at(-1).max_tokens, 2000); assert.equal(route.servedIndex, 1);
    route = { taskAffinity: true, taskProfile: { ...chain[0], poolChain: chain.slice(0, 1) }, startAt: 1, capOut: 2000 };
    await openRouterChat(e, { messages: [] }, "ignored", route, { tenant: "t" }); assert.equal(wire.at(-1).model, ids[0], "no next model: the same one"); assert.equal(wire.at(-1).max_tokens, 2000);
    assert.equal(capped(8000, 20000), 8000, "a cap never raises a saved limit"); assert.equal(capped(null, 2000), 2000); assert.equal(capped(500, 2000), 500); assert.equal(capped(8000, null), 8000);
  } finally { globalThis.fetch = saved; }
});
