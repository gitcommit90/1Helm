// node --import ./test/stubs/register.mjs test/byok-handoff.test.mjs
// Own AI key with more than one category: every chat message goes to the request sorter, and the turn follows the same orchestration as a managed plan.
// The main turn always runs on General's models; a message sorted into another category makes Primary hand the job to a background worker that runs on that category's
// models through the person's own key. The real Resident (node:sqlite) runs real turns; fetch is faked (their endpoint and the request sorter). Only app facts are judged:
// which model was dispatched, the tools offered, helper rows, job-started lines. Never model wording.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs";
import { test, after } from "node:test";
import { ACK_JOB_STARTED_VARIANTS } from "../src/plain-ack.js";
import { Resident } from "../src/resident.js";
import { byokChat, loadByok, effortFields } from "../src/byok.js";
import { connDdl } from "../src/ee/byok-connections.js";
import { HANDOFF_PREFIX } from "../src/ee/route2.js";
import { sealSecret } from "../src/sentinel.js";
import { byokRouteTurn, planForCall, saveOwn, readOwn, ownPicker, ownKeyPlan, byokChatChain, endpointRecords, listedRecords, ownKeyKind, _resetLists, recordOfListed } from "../src/ee/byok-custom.js";
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
// The scripted endpoint: a call that offers "done" is a worker (it finishes at once); a call that offers start_helper answers with it when `script.start` is set; a returned worker's result
// (a user message that starts with the context note) is answered in plain text; anything else answers in plain text. Every call is recorded with the model, the tools offered and its position.
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const prov = [], sorter = []; let sorterPick = "Software", sorterSteer = "none", sorterFails = false; const script = { start: false, failModels: new Set(), hang: null };
const callOf = (model, name, args) => sse([{ model, choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${prov.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }, { model, choices: [{ delta: {}, finish_reason: "tool_calls" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.5 } }]);
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const url = new URL(u);
  if (/systemone/.test(u)) { if (sorterFails) return jres({ error: "down" }, 500); sorter.push(JSON.parse(init.body || "{}")); return jres({ answers: { is_task: { noul: 1 }, category: { choice: sorterPick }, unmet: { noul: 0 }, steer: { choice: sorterSteer } }, usage: { cost: 0.0004 } }); }
  if (url.hostname !== HOST) throw new Error(`unexpected fetch ${u}`);
  if (init.method === "GET") return jres(PLAIN);
  const body = JSON.parse(init.body || "{}"), tools = (body.tools || []).map((t) => t.function.name); prov.push({ url: u, host: url.hostname, auth: init.headers?.authorization, body, tools });
  if (script.hang?.(body, tools)) return new Promise(() => {});
  if (script.failModels.has(body.model)) return jres({ error: { message: `model ${body.model} is overloaded` } }, 503);
  const last = body.messages.at(-1), answered = body.messages.some((m) => m.role === "tool");
  if (typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX)) return sse([{ model: body.model, choices: [{ delta: { content: JSON.stringify({ completed: ["notes"], changed_files: [], working_commands: [], decisions: [], key_facts: [], unfinished: [] }) }, finish_reason: "stop" }] }]);
  if (!body.stream) return jres({ model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ title: "T", result: "R", summary: "S", chat_title: "C", why: {} }) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
  if (tools.includes("done") && !answered) return callOf(body.model, "done", { response: "worker result" });
  const returned = typeof last.content === "string" && last.content.startsWith("(Context note, not from the person: worker #");
  if (script.start && tools.includes("start_helper") && !answered && !returned) return callOf(body.model, "start_helper", { name: "Fix the bug", task: "Fix the bug in the app" });
  return sse([{ model: body.model, choices: [{ delta: { content: `answer from ${body.model}` } }] }, { model: body.model, choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.5 } }]);
};
const cfgOf = (base = BASE, model = "main-1") => Object.defineProperty({ base, host: new URL(base).hostname, model, fast: "fast-1", last4: KEY.slice(-4) }, "key", { value: KEY });
async function saveRow({ base = BASE, model = "main-1", fast = "fast-1" } = {}) {
  await connDdl(env); d1.exec("DELETE FROM byok_connections; DELETE FROM byok_multi;");   // the account still has the one saved key of before: it becomes a connection when first read
  d1.prepare("INSERT OR REPLACE INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,?,?)").run(base, model, fast, await sealSecret(env, KEY), KEY.slice(-4), Date.now(), Date.now());
}
const reset = (level = "unrestricted") => { d1.exec("UPDATE tenants SET custom_models_own_on=0, custom_models_own=NULL, custom_models_on=0, custom_models=NULL, plan='byok' WHERE id='t1'"); _resetLists(); script.failModels = new Set(); return setPrivacy({ DB: D1 }, "t1", level); };
const entry = (model, effort = null) => ({ model: model.includes(":") ? model : `p_main:${model}`, effort });
const cat = (id, title, ...chain) => ({ id, title, chain, max_price: null });
const rec = (id, efforts = ["none", "low", "high"], levels = ["unrestricted", "no_training", "zdr"]) => ({ id, source: "OR", kinds: ["chat", "chore"], name: `Name ${id.split("/")[1]}`, eligible: true, reasons: [], efforts, default_effort: efforts[1] || efforts[0], levels, hosts: ["acme"],
  terms: { zdr: levels.includes("zdr"), no_training: levels.includes("no_training") }, context_length: 100000, max_output: 8000, input_modalities: ["text"], pricing: { prompt: 1, completion: 2 }, json: true, tool_choice: ["auto", "none"] });
const FAKE = { "acme/a": rec("acme/a"), "acme/b": rec("acme/b"), "acme/c": rec("acme/c"), "acme/open": rec("acme/open", ["low"], ["unrestricted"]) };
const lookup = async (id) => FAKE[id] || null;
const PLAIN = { data: [{ id: "main-1" }, { id: "llama-3.3-70b", name: "Llama 3.3 70B", context_length: 131072 }, { id: "o-reason", supported_reasoning_efforts: ["low", "medium", "high"] }, { id: "qwen-coder" }, { id: "mistral-small", pricing: { prompt: "0.0000002", completion: "0.0000006" } },
  { id: "embed-only", supported_parameters: ["max_tokens"] }, { id: "gemma-2" }, { id: "bad id with spaces" }] };
const refuses = (p, re, status = 400) => assert.rejects(p, (e) => { assert.equal(e.status, status); assert.match(e.message, re); assert.ok(!String(e.message).includes(KEY)); return true; });

// ---- the Resident ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) || /\bRETURNING\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = [];
const ctx = { storage: { sql, transactionSync: (f) => f(), getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p), id: { toString: () => "res-byokc-000000000000000000000" } };
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

// ---- helpers for the tests ----
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
// Waits for the turn and the workers it started; a call the script hangs on is given up on after a moment.
const settle = async (R0 = R) => { for (let i = 0; i < 40; i++) { const n = waits.length, r = (R0._helperRuns || []).length; await Promise.race([Promise.allSettled([...waits.splice(0), ...(R0._helperRuns || []), ...(R0._resumeRuns || [])]), sleep(150)]); await sleep(5); if (!n && !waits.length && (R0._helperRuns || []).length === r) break; } };
const setup = async (categories) => { for (const t of ["helpers", "helper_rounds", "turn_runs", "turn_effects"]) R.sql.exec(`DELETE FROM ${t}`); await reset(); await saveRow(); const base = { cfg: cfgOf(), kind: "plain" }; await saveOwn(env, "t1", { on: true }, base); await saveOwn(env, "t1", { categories }, base); script.start = false; script.hang = null; sorterFails = false; sorterSteer = "none"; };
const twoCats = () => setup([cat("general", "General", entry("main-1")), cat("c_soft0001", "Software", entry("o-reason", "high"), entry("gemma-2"))]);
const send = async (S, text, opts = {}) => {
  const p0 = prov.length, s0 = sorter.length, r0 = led.res.length;
  const r = await R.runTurn("t1", "main", "1", text, () => {}, { session: S, ...opts }); await settle();
  const calls = prov.slice(p0), main = calls.filter((c) => c.body.stream && !String(c.body.messages.at(-1).content).startsWith(HANDOFF_PREFIX));
  return { r, calls, main, chores: calls.filter((c) => !main.includes(c)), sorter: sorter.slice(s0), res: led.res.slice(r0), after: prov.slice(p0) };
};
const helpers = () => R.sql.exec("SELECT * FROM helpers ORDER BY id").toArray();
const acks = (r) => ACK_JOB_STARTED_VARIANTS.includes(r.reply?.trim());

test("a General message answers on General with no helper, and a software message keeps the main turn on General and hands the job to a worker on Software's models", async () => {
  await twoCats(); const S = R.newSession("Task");
  sorterPick = "General"; const a = await send(S, "hello");
  assert.equal(a.sorter.length, 1, "every message goes to the sorter"); assert.deepEqual(a.main.map((c) => c.body.model), ["main-1"]); assert.equal(helpers().length, 0);
  assert.ok(a.main[0].tools.includes("run_command"), "General keeps its full tools");
  sorterPick = "Software"; script.start = true;
  const b = await send(S, "fix the bug in my app");
  assert.equal(b.sorter.length, 1);
  const [primary, ...rest] = b.main;
  assert.equal(primary.body.model, "main-1", "the main turn stays on General's model");
  assert.ok(primary.tools.includes("start_helper") && !primary.tools.includes("run_command"), `Primary's tools are restricted: ${primary.tools.join()}`);
  const h = helpers(); assert.equal(h.length, 1); assert.equal(h[0].dynamic_routing, 1); assert.equal(h[0].category, "c_soft0001"); assert.equal(h[0].required_delegation, 1);
  const worker = rest.filter((c) => c.tools.includes("done"));
  assert.ok(worker.length >= 1 && worker.every((c) => c.body.model === "o-reason" && c.body.reasoning_effort === "high"), `the worker's calls use Software's chain: ${rest.map((c) => c.body.model).join()}`);
  assert.ok(worker.every((c) => c.host === HOST && c.auth === `Bearer ${KEY}`), "through their own key");
  assert.ok(acks(b.r), `a job-started line was posted: ${b.r.reply}`);
  assert.ok(!b.res.some(([id]) => id.startsWith("res:") || id.startsWith("rtr:")), "the AI itself is never reserved or charged");
});

test("the result goes back to General: Primary gets it on General's model with no approval tool and answers, and the worker closes", async () => {
  await twoCats(); const S = R.newSession("Task"); sorterPick = "Software"; script.start = true;
  const b = await send(S, "fix the bug in my app");
  assert.ok(b.after.every((c) => !c.tools.includes("approve_subagent")), "approve_subagent is never offered");
  const back = b.after.filter((c) => c.body.stream && !c.tools.includes("done") && c.body.messages.some((m) => typeof m.content === "string" && m.content.startsWith("(Context note, not from the person: worker #")));
  assert.ok(back.length >= 1, `Primary got the returned result: ${b.after.map((c) => `${c.body.model}:${c.tools.length}`).join()}`);
  assert.ok(back.every((c) => c.body.model === "main-1"), "the result goes back to General's model");
  assert.ok(back.every((c) => c.body.messages.at(-1).content.includes("worker result") && c.body.messages.at(-1).content.includes("Present the result")), "the response comes with the result, no review step");
  assert.equal(helpers().length, 1, "no second worker"); assert.equal(helpers()[0].status, "approved"); assert.equal(sorter.length > 0, true);
  assert.equal(b.after.filter((c) => c.body.stream && c.tools.includes("start_helper") && c.body.messages.at(-1).role === "user" && c.body.model !== "main-1").length, 0, "no category model ever answered as Primary");
});

test("a sorter that fails answers from General: no helper, the full tools", async () => {
  await twoCats(); const S = R.newSession("Task"); sorterFails = true; script.start = false;
  const a = await send(S, "fix the bug in my app");
  assert.deepEqual(a.main.map((c) => c.body.model), ["main-1"]); assert.equal(helpers().length, 0); assert.ok(a.main[0].tools.includes("run_command"));
  sorterFails = false;
});

test("a sorter that can't be paid for answers from General: no sorter call, no helper", async () => {
  await twoCats(); const S = R.newSession("Task"); const real = ledger.reserve; ledger.reserve = async (id, n) => (id.startsWith("byok-route:") ? { ok: false } : real(id, n));
  try { const a = await send(S, "fix the bug in my app"); assert.equal(a.sorter.length, 0); assert.deepEqual(a.main.map((c) => c.body.model), ["main-1"]); assert.equal(helpers().length, 0); } finally { ledger.reserve = real; }
});

test("own key with only General: no sorter call, no handoff, the same tools as before", async () => {
  await setup([cat("general", "General", entry("main-1"))]); const S = R.newSession("Task"); script.start = false;
  const a = await send(S, "fix the bug in my app");
  assert.equal(a.sorter.length, 0); assert.deepEqual(a.main.map((c) => c.body.model), ["main-1"]); assert.equal(helpers().length, 0); assert.ok(a.main[0].tools.includes("run_command") && a.main[0].tools.includes("start_helper"));
});

test("a message for an open worker is steered to it: the dispatch carries the steer, General stays the category", async () => {
  await twoCats(); const S = R.newSession("Task"); sorterPick = "Software"; script.start = true; script.hang = (b, t) => t.includes("done");   // the worker never answers: it stays open
  await send(S, "fix the bug in my app").catch(() => {});
  const id = helpers()[0].id; assert.equal(helpers()[0].status, "running");
  sorterPick = "General"; sorterSteer = String(id); script.start = false;
  const tc = { session: S, kind: "chat" }, stats = { charge: 0 };
  await byokRouteTurn(R, tc, { kind: "chat", text: "also make the button blue", hist: [], stats });
  assert.equal(tc.byokProfile.dispatch.steer, id); assert.equal(tc.byokProfile.dispatch.requiredDelegation, false); assert.equal(tc.byokProfile.dispatch.category, "general");
  assert.equal(tc.byokPlan.category, "general"); assert.equal(stats.route.steer, id);
  const sorted = sorter.at(-1); assert.ok(JSON.stringify(sorted).includes("Fix the bug"), "the sorter was told which workers are open");
  script.hang = null;
});

test("a worker's own turn uses its category's plan; the main turn and chores never do", async () => {
  await twoCats();
  const worker = { dynamic_routing: 1, category: "c_soft0001" };
  assert.equal((await planForCall(R, { helper: worker })).category, "c_soft0001");
  assert.deepEqual((await planForCall(R, { helper: worker })).chain.map((e) => e.model), ["p_main:o-reason", "p_main:gemma-2"]);
  assert.equal((await planForCall(R, { session: "s" })).category, "general");
  assert.equal((await planForCall(R, { helper: { dynamic_routing: 0, category: null } })).category, "general");
});

test("a deploy mid-worker: the worker carries on from its saved category and finishes on Software's models, and nothing starts twice", async () => {
  await twoCats(); const S = R.newSession("Task"); sorterPick = "Software"; script.start = true; script.hang = (b, t) => t.includes("done");
  await send(S, "fix the bug in my app");
  assert.equal(helpers().length, 1); assert.equal(helpers()[0].status, "running");
  // the deploy: a fresh Resident over the same storage takes over; the old one's hung call never comes back
  script.hang = null; const p0 = prov.length;
  const R2 = new Resident({ ...ctx, waitUntil: (p) => waits.push(p) }, env); R2.systemPrompt = async () => "SYSTEM";
  await R2.alarm().catch(() => {}); R2.resumeDue({ force: true }); await settle(R2);
  const after = prov.slice(p0).filter((c) => c.body.stream && c.tools.includes("done"));
  assert.ok(after.length >= 1 && after.every((c) => c.body.model === "o-reason"), `the resumed worker runs on Software's chain: ${prov.slice(p0).map((c) => c.body.model).join()}`);
  assert.equal(helpers().length, 1, "no second worker"); assert.equal(helpers()[0].status, "approved", "it returned, its result went to Primary and the worker closed");
});

test("a deploy mid-Primary: the resumed turn keeps General's model and its saved dispatch, and starts no second worker", async () => {
  await twoCats(); const S = R.newSession("Task"); sorterPick = "Software"; script.start = true; script.hang = (b, t) => t.includes("start_helper");   // Primary's call never answers
  const turnP = R.runTurn("t1", "main", "1", "fix the bug in my app", () => {}, { session: S }); await new Promise((z) => setTimeout(z, 300));
  const row = R.sql.exec("SELECT card,extra FROM turn_runs").toArray()[0]; assert.ok(row, "the turn is journaled");
  const saved = JSON.parse(row.extra).byokProfile; assert.equal(saved.dispatch.requiredDelegation, true); assert.equal(saved.dispatch.category, "c_soft0001"); assert.equal(saved.requestedModel, "p_main:main-1");
  script.hang = null; const p0 = prov.length;
  const R2 = new Resident({ ...ctx, waitUntil: (p) => waits.push(p) }, env); R2.systemPrompt = async () => "SYSTEM";
  await R2.alarm().catch(() => {}); R2.resumeDue({ force: true }); await settle(R2);
  const primary = prov.slice(p0).filter((c) => c.body.stream && c.tools.includes("start_helper") && !String(c.body.messages.at(-1)?.content).startsWith("(Context note, not from the person: worker #"));   // the dispatch turn, not the later turn that gets the result
  assert.ok(primary.length >= 1 && primary.every((c) => c.body.model === "main-1" && !c.tools.includes("run_command")), `General's model with the restricted tools: ${primary.map((c) => c.body.model + ":" + c.tools.length).join()}`);
  assert.equal(helpers().length, 1, "one worker"); assert.equal(helpers()[0].category, "c_soft0001");
  void turnP;
});

// A worker whose call the script hung on keeps its deadline timers (hours long) alive, so the file ends itself once the results are written.
after(() => { setTimeout(() => process.exit(0), 300); });
