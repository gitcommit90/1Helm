// node --import ./test/stubs/register.mjs test/byok-oldtask.test.mjs
// An own-key task that already had saved append-runtime state (a task profile or transcript, from before the account answered on its own key) must keep answering on the own key.
// It used to fail before any model call with "No saved routing models for this category" (ensureTaskRuntime asked the managed routing lists; an own-key env has none).
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Resident } from "../src/resident.js";
import { byokChat, loadByok, effortFields } from "../src/byok.js";
import { HANDOFF_PREFIX } from "../src/ee/route2.js";
import { sealSecret } from "../src/sentinel.js";
import { saveOwn, readOwn, ownPicker, ownKeyPlan, byokChatChain, endpointRecords, listedRecords, ownKeyKind, _resetLists, recordOfListed } from "../src/ee/byok-custom.js";
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
const env = withSettings({ DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", MEMORY: "off", GENUI: "off", WORKMEM: "off", OPENROUTER_API_KEY: "or-key", ROUTER_MODE: "two", OWN_ROUTER: "on", DYNAMIC_ROUTING: "on",
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
const cfgOf = (base = BASE, model = "main-1") => Object.defineProperty({ base, host: new URL(base).hostname, model, fast: "fast-1", last4: KEY.slice(-4) }, "key", { value: KEY });
async function saveRow({ base = BASE, model = "main-1", fast = "fast-1" } = {}) {
  d1.prepare("INSERT OR REPLACE INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,created_at,updated_at) VALUES ('t1',?,?,?,?,?,?,?)").run(base, model, fast, await sealSecret(env, KEY), KEY.slice(-4), Date.now(), Date.now());
}
const reset = (level = "unrestricted") => { d1.exec("UPDATE tenants SET custom_models_own_on=0, custom_models_own=NULL, custom_models_on=0, custom_models=NULL, plan='byok' WHERE id='t1'"); _resetLists(); failModels = new Set(); modelList = null; return setPrivacy({ DB: D1 }, "t1", level); };
const entry = (model, effort = null) => ({ model, effort });
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

import { usesAppendRuntime, TASK_PROFILE_KEY } from "../src/ee/task-profile.js";

test("usesAppendRuntime: an own-key turn never uses the append runtime, other accounts keep their rules", () => {
  const base = { kind: "chat", session: "s" };
  assert.equal(usesAppendRuntime({ ...base, existing: true, byok: true }), false);
  assert.equal(usesAppendRuntime({ ...base, flagOn: true, byok: true }), false);
  assert.equal(usesAppendRuntime({ ...base, resumed: true, resumedAppend: true, byok: true }), false);
  assert.equal(usesAppendRuntime({ ...base, existing: true }), true);
  assert.equal(usesAppendRuntime({ ...base, flagOn: true }), true);
  assert.equal(usesAppendRuntime({ ...base }), false);
  assert.equal(usesAppendRuntime({ ...base, resumed: true, resumedAppend: true }), true);
  assert.equal(usesAppendRuntime({ ...base, resumed: true, existing: true }), false);
  assert.equal(usesAppendRuntime({ kind: "workflow", session: "s", existing: true }), false);
});

test("an older own-key task with a saved task profile answers on the own key", async () => {
  await reset(); await saveRow();
  const S = R.newSession("Old task");
  R.put(TASK_PROFILE_KEY(S), JSON.stringify({ requestedModel: "managed/old", category: "general", level: "unrestricted", dynamicRouting: false, refreshedTurn: "x" }));
  const p0 = prov.length;
  const r = await R.runTurn("t1", "main", "1", "hello again", () => {}, { session: S });
  await Promise.allSettled(waits.splice(0));
  assert.ok(!/No saved routing models|Something went wrong/.test(String(r?.reply ?? r?.error ?? "")), `turn failed: ${JSON.stringify(r).slice(0, 300)}`);
  const main = prov.slice(p0).filter((c) => c.body.stream && !String(c.body.messages.at(-1).content).startsWith(HANDOFF_PREFIX));
  assert.ok(main.length >= 1 && main.every((c) => c.host === HOST && c.auth === `Bearer ${KEY}`), "the main call went to their endpoint with their key");
  assert.equal(main[0].body.model, "main-1");
});
