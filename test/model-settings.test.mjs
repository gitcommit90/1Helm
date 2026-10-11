// node --import ./test/stubs/register.mjs test/model-settings.test.mjs
// Real SQLite conditional writes plus captured outbound requests: global edits apply to already-held env/routes, not just CRUD.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { defaultModelSettings, validateModelSettings, modelSettingsView, saveModelSettings, resetModelSettings, restoreModelSettings, readModelSettings, modelSettingsEnv } from "../src/ee/model-settings.js";
import { openRouterChat, orFetch } from "../src/model.js";
import { policyRoute, HANDOFF_PREFIX, jevAsk } from "../src/ee/route2.js";
import { browserPlan } from "../src/ee/browser-agent.js";
import { mjRoute } from "../src/memjobs-core.js";
import { POOL } from "../src/ee/pool.js";

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
sql.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,ai_privacy TEXT); INSERT INTO tenants VALUES('t','zdr')");
let primaryReads = 0;
const DB = { withSession(mode) { assert.equal(mode, "first-primary"); primaryReads++; return this; }, prepare(q) {
  const s = sql.prepare(q); let a = [];
  const o = { bind(...v) { a = v; return o; }, first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) }; return o;
} };
const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", ROUTER_MODE: "two", OPENROUTER_API_KEY: "unit-key", PROMPT_CACHE: "off", CHORE_MODEL_LABEL: "dsflash", CHORE_MODEL_BROWSER: "dsflash" };
const cfg = defaultModelSettings(); let revision = 0;
const save = async (c = cfg) => { const v = await saveModelSettings(env, { revision, config: c }, "unit@example.com"); revision = v.revision; return v; };
const bad = (change) => { const c = structuredClone(cfg); change(c); assert.throws(() => validateModelSettings(c), (e) => e.status === 400); };
bad((c) => { c.efforts.sol = "none"; });
bad((c) => { c.efforts.deepseek = "medium"; });
bad((c) => { c.chains.general.zdr = ["muse-c"]; });
bad((c) => { c.chains.general.no_training = ["muse-c"]; });
bad((c) => { c.chains.general.zdr = ["unknown"]; });
bad((c) => { c.chains.general.zdr = ["luna", "luna"]; });
bad((c) => { c.chains.general.zdr = []; });
bad((c) => { c.chores.browser = { model: "oss120", effort: "none" }; });
bad((c) => { c.chores.browser = { model: "constructor", effort: "low" }; });
bad((c) => { c.decider = POOL.sol.model; });
bad((c) => { c.evil = true; });
assert.deepEqual((await readModelSettings(env)), { revision: 0, config: null });

const sent = [], decisions = []; let failures = new Set();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const p = JSON.parse(init.body);
  if (String(url).endsWith("/systemone")) {
    decisions.push(p); return Response.json({ model: p.model, answers: { is_task: { noul: 0.9 }, category: { choice: "general" }, unmet: { noul: 0.01 } }, usage: { cost: 0.00001 } });
  }
  assert.match(String(url), /\/chat\/completions$/); sent.push(p);
  return failures.has(p.model) ? Response.json({ error: { message: "fixture unavailable" } }, { status: 503 }) : Response.json({ model: p.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0.00001 } });
};
const body = { messages: [{ role: "user", content: "Hello" }], max_tokens: 100, reasoning: { effort: "max" } };
const route = policyRoute("general", "zdr", "test");
const call = (r = route, kind = "chat", b = body, e = env) => openRouterChat(e, b, "session-kept", r, { tenant: "t", kind });
try {
  await call(); assert.equal(sent.at(-1).model, POOL.deepseek.model); assert.equal(sent.at(-1).reasoning.effort, "max");
  // Existing label's unusual Qwen primary is unchanged until its role is explicitly overridden.
  const { labelChore } = await import("../src/tracker.js");
  await call(labelChore(env), "card-label", { messages: body.messages }); assert.equal(sent.at(-1).model, "qwen/qwen3.8-27b");
  cfg.efforts.sol = "low"; cfg.efforts.haiku = "medium"; cfg.chains.general.zdr = ["sol", "haiku"];
  await save();
  await call(); assert.equal(sent.at(-1).model, POOL.sol.model); assert.equal(sent.at(-1).reasoning.effort, "low");
  assert.equal(route.effort, "low", "recorded routing reports the configured wire effort");
  assert.equal(sent.at(-1).provider.zdr, true); assert.equal(sent.at(-1).provider.require_parameters, true);
  assert.deepEqual(sent.at(-1).provider.max_price, { prompt: 3, completion: 15 });
  assert.deepEqual(sent.at(-1).provider.only, ["azure", "azure/us", "azure/eu"]);
  failures.add(POOL.sol.model); const before = sent.length; await call(); failures.clear();
  assert.deepEqual(sent.slice(before).map((p) => [p.model, p.reasoning.effort]), [[POOL.sol.model, "low"], [POOL.haiku.model, "medium"]]);
  await call(labelChore(env), "card-label", { messages: body.messages }); assert.equal(sent.at(-1).model, "qwen/qwen3.8-27b");
  await assert.rejects(saveModelSettings(env, { revision: 0, config: cfg }, "other"), (e) => e.status === 409);
  // Distinct databases are used in deployment; environment key also guards accidental mixing here.
  assert.equal((await modelSettingsView({ ...env, ENV_NAME: "live" })).revision, 0);
  cfg.efforts.sol = "high"; await save(); await call(); assert.equal(sent.at(-1).reasoning.effort, "high");
  cfg.chains.general.zdr = ["luna"]; cfg.efforts.luna = "none"; await save(); await call(); assert.deepEqual(sent.at(-1).reasoning, { enabled: false });
  cfg.chores.handoff = { model: "haiku", effort: "high" }; cfg.chores.label = { model: "oss120", effort: "medium" };
  cfg.chores.notes = { model: "dsflash", effort: "none" }; cfg.chores.notes_final = { model: "sol", effort: "low" };
  cfg.chores.people_verify = { model: "oss20", effort: "high" }; cfg.chores.browser = { model: "haiku", effort: "medium" }; await save();
  await call(route, "chat", { messages: [{ role: "user", content: HANDOFF_PREFIX + " Make notes." }] });
  assert.equal(sent.at(-1).model, POOL.haiku.model); assert.equal(sent.at(-1).reasoning.effort, "high");
  await call(labelChore(env), "card-label"); assert.equal(sent.at(-1).model, "openai/gpt-oss-120b"); assert.equal(sent.at(-1).reasoning.effort, "medium");
  await call({ chore: true, model: POOL.haiku.model }, "live-notes-update"); assert.equal(sent.at(-1).model, POOL.deepseek.model); assert.deepEqual(sent.at(-1).reasoning, { enabled: false });
  await call({ chore: true, model: POOL.luna.model }, "live-notes-final"); assert.equal(sent.at(-1).model, POOL.sol.model); assert.equal(sent.at(-1).reasoning.effort, "low");
  const oldMemoryRoute = mjRoute(env, "people", "verify");
  await call(oldMemoryRoute, "memjob-people-verify", { ...body, response_format: { type: "json_object" } });
  assert.equal(sent.at(-1).model, "openai/gpt-oss-20b"); assert.equal(sent.at(-1).reasoning.effort, "high"); assert.equal(sent.at(-1).response_format, undefined);
  failures.add("openai/gpt-oss-20b"); await call(oldMemoryRoute, "memjob-people-verify"); failures.clear();
  assert.equal(sent.at(-1).model, "openai/gpt-oss-120b"); assert.equal(sent.at(-1).reasoning.effort, "medium");
  let plan = await browserPlan(env); await orFetch(env, { ...plan[0], messages: body.messages }, { tenant: "t", kind: "browser-oss" });
  assert.equal(sent.at(-1).model, POOL.haiku.model); assert.equal(sent.at(-1).reasoning.effort, "medium"); assert.equal(sent.at(-1).provider.zdr, true);
  cfg.chores.browser = { model: "luna", effort: "low" }; cfg.decider = "~typesafe/jev-latest"; await save();
  plan = await browserPlan(env); assert.equal(plan[0].model, POOL.luna.model); assert.equal(plan[0].reasoning.effort, "low");
  await jevAsk(env, {}); assert.equal(decisions.at(-1).model, "~typesafe/jev-latest"); assert.deepEqual(decisions.at(-1).provider.only, ["typesafe"]);
  // Public source ignores private test model overrides and preserves the configured route.
  await call(route, "chat", body, { ...env, TEST_MODEL: POOL.haiku.model, TEST_MODEL_SCOPE: "all-dev", TEST_MODEL_EFFORT: "high" });
  assert.equal(sent.at(-1).model, POOL.luna.model); assert.notEqual(sent.at(-1).reasoning.effort, "high");
  const own = { BYOK: { model: "own-model" } }; assert.equal(await modelSettingsEnv(own), own);
  const restored = await restoreModelSettings(env, { revision, restore_revision: 1 }, "admin"); revision = restored.revision;
  await call(); assert.equal(sent.at(-1).model, POOL.sol.model); assert.equal(sent.at(-1).reasoning.effort, "low");
  const reset = await resetModelSettings(env, { revision }, "admin"); revision = reset.revision;
  assert.equal(reset.inherited, true); await call(); assert.equal(sent.at(-1).model, POOL.deepseek.model); assert.equal(sent.at(-1).reasoning.effort, "max");
  assert.equal(reset.history[0].action, "reset"); assert.ok(reset.history.some((r) => r.action === "restore:1"));
  const writes = await Promise.allSettled([saveModelSettings(env, { revision, config: cfg }, "a"), saveModelSettings(env, { revision, config: cfg }, "b")]);
  assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1); assert.equal(writes.find((r) => r.status === "rejected").reason.status, 409);
  revision++;
  sql.prepare("INSERT INTO model_settings_versions VALUES(?,?,?,?,?,?)").run("dev", ++revision, "broken json", Date.now(), "fixture", "invalid-fixture");
  const broken = await modelSettingsView(env); assert.match(broken.config_error, /invalid/); assert.equal(broken.revision, revision);
  await assert.rejects(call(), (e) => e.status === 503);
  await resetModelSettings(env, { revision }, "admin"); await call(); assert.equal(sent.at(-1).model, POOL.deepseek.model);
  assert.ok(primaryReads > 10);
  await assert.rejects(readModelSettings({ DB: { prepare() { throw new Error("database unavailable"); } } }), (e) => e.status === 503);
  assert.equal((await readModelSettings({ DB: { prepare() { throw new Error("no such table: model_settings_versions"); } } })).config, null);
  console.log("PASS model settings: validation, primary reads, environment isolation, atomic stale writes, history/reset/restore, uncached dispatch changes, destination fallback effort, off reasoning, chores/memory/browser/decider, test and BYOK precedence, legacy defaults and read failure.");
} finally { globalThis.fetch = originalFetch; sql.close(); }
