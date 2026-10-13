// node --import ./test/stubs/register.mjs test/model-settings.test.mjs
// The saved model settings (src/model-settings.js): validation, the first saved version (first-run data, and the one-time carry-over from the
// earlier slot-based settings and environment variables), saving with history and restore, stale and concurrent writes, uncached reads that
// change the very next dispatch, and failure behavior (last saved copy, or a clear error, never a built-in model). Real SQLite stands in for D1.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { validateModelSettings, readModelSettings, modelSettingsView, saveModelSettings, restoreModelSettings, modelSettingsEnv, ModelSettingsError } from "../src/ee/model-settings.js";
import { seedFresh, seedFromLegacy } from "../src/ee/model-seed.js";
import { JOBS, JOB_IDS, jobSetting, choreRouteOf } from "../src/ee/model-jobs.js";
import { openRouterChat } from "../src/model.js";
import { policyRoute, dispatchOrder } from "../src/ee/route2.js";
import { ID, SEED, seedSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));   // the earlier table, kept for the one-time carry-over
sql.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,ai_privacy TEXT); INSERT INTO tenants VALUES('t','zdr')");
let primaryReads = 0, broken = false;
const DB = { withSession(mode) { assert.equal(mode, "first-primary"); primaryReads++; return this; }, prepare(q) {
  if (broken) throw new Error("database unavailable");
  const s = sql.prepare(q); let a = [];
  const o = { bind(...v) { a = v; return o; }, first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) }; return o;
} };
const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", ROUTER_MODE: "two", OPENROUTER_API_KEY: "unit-key", PROMPT_CACHE: "off", CHORE_MODEL_BROWSER: "dsflash" };
const rows = (e = "dev") => { try { return sql.prepare("SELECT revision,action,by FROM model_job_settings_versions WHERE environment=? ORDER BY revision").all(e).map((r) => ({ ...r })); } catch (err) { if (/no such table/.test(err.message)) return []; throw err; } };   // the table is made on first read, or by migrations_058
const origLog = console.log, origErr = console.error, logs = [], errs = [];
console.log = (...a) => logs.push(a.join(" ")); console.error = (...a) => errs.push(a.join(" "));

// ---- 1) validation: exactly the known jobs, models that fit each job, reasoning levels the model has ----
const bad = (change, re = /./) => { const c = clone(SEED); change(c); assert.throws(() => validateModelSettings(c), (e) => e.status === 400 && re.test(e.message)); };
bad((c) => { c.evil = true; }); bad((c) => { c.version = 1; }, /version/);
bad((c) => { delete c.jobs.handoff; }); bad((c) => { c.jobs.unknown = c.jobs.handoff; }); bad((c) => { c.jobs.handoff = null; });
bad((c) => { c.jobs["chat.general"].effort = "none"; }, /doesn't support reasoning level/);          // Sol/DeepSeek/etc. have their own lists; Muse has no "none"
bad((c) => { c.jobs.decider.effort = "low"; }, /no reasoning level/); bad((c) => { c.jobs.stt.fallbacks[0].effort = "low"; }, /no reasoning level/);
bad((c) => { c.jobs["chat.general"].fallbacks.push({ model: ID.MUSE_C, effort: "low" }); }, /listed once/);
bad((c) => { c.jobs["chat.general"].fallbacks = Array(6).fill(0).map((_, i) => ({ model: `x/m${i}`, effort: "low" })); });
bad((c) => { c.jobs["recover.technical"].fallbacks = [{ model: ID.HAIKU, effort: "low" }]; }, /fallback/);
bad((c) => { c.jobs.decider.model = ID.STT; }, /can't be used/); bad((c) => { c.jobs.memory_supersede.model = ID.STT; }, /can't be used/); bad((c) => { c.jobs["chat.technical"].model = ID.STT; }, /can't be used/);
bad((c) => { c.jobs.handoff = { model: ID.MUSE_C, effort: "low", fallbacks: [] }; }, /can't be used/);
bad((c) => { c.catalog["acme/leaky"] = { id: "acme/leaky", name: "Leaky", eligible: true, reasons: [], efforts: ["low"], default_effort: "low", levels: ["unrestricted"], hosts: ["h"], context_length: 1000, max_output: 100,
  input_modalities: ["text"], pricing: { prompt: 1, completion: 1 }, json: true, tool_choice: ["auto"] }; c.jobs.handoff = { model: "acme/leaky", effort: "low", fallbacks: [] }; }, /zero-data-retention/);
bad((c) => { c.jobs.handoff = { model: "not a model id", effort: "low", fallbacks: [] }; }); bad((c) => { c.jobs.handoff.hosts = ["bad host!"]; });
bad((c) => { c.catalog["evil/x"] = { id: "evil/x", name: "x", kinds: ["chat"], efforts: ["low"], hosts: ["a"] }; }, /metadata/);
assert.deepEqual(Object.keys(SEED.jobs).sort(), [...JOB_IDS].sort(), "every job has a saved setting, and only the known jobs");
assert.ok(JOBS.length >= 36 && new Set(JOB_IDS).size === JOBS.length);
for (const j of Object.values(SEED.jobs)) for (const e of [j, ...j.fallbacks]) assert.ok(SEED.catalog[e.model], `${e.model} is described in the saved settings`);

// ---- 2) the first saved version: nothing saved yet → the first-run data, once, with the variable that used to choose a model carried in ----
{ assert.equal(rows().length, 0);
  const [a, b] = await Promise.all([readModelSettings(env), readModelSettings(env)]);
  assert.equal(a.revision, 1); assert.equal(b.revision, 1); assert.deepEqual(rows(), [{ revision: 1, action: "seed", by: "system" }], "two readers at once still make one first version");
  assert.deepEqual(a.config, validateModelSettings(seedFresh(env)));
  assert.equal(jobSetting(a.config, "browser").model, ID.DEEPSEEK, "CHORE_MODEL_BROWSER=dsflash was carried into the saved setting");
  assert.equal((await readModelSettings(env)).revision, 1); assert.equal(rows().length, 1, "reading again writes nothing");
  assert.equal(rows("live").length, 0, "environments are separate");
  assert.ok(primaryReads > 0, "settings are read from the primary database");
  // from now on the variable has no say: the saved setting does, even when the variable changes
  const e2 = { ...env, CHORE_MODEL_BROWSER: "oss20", DECIDER_MODEL: ID.JEV, STT_MODEL: "x/y", MODEL: "@cf/other/model" };
  const r = await readModelSettings(e2); assert.equal(jobSetting(r.config, "browser").model, ID.DEEPSEEK); assert.equal(jobSetting(r.config, "decider").model, ID.PPLX);
  assert.equal(jobSetting(r.config, "workers_ai_chat").model, ID.WAI_CHAT); }

// ---- 3) a save is a new version; history; stale and concurrent writes ----
let revision = 1;
const save = async (config, e = env) => { const v = await saveModelSettings(e, { revision, config }, "unit@example.com"); revision = v.revision; return v; };
{ const cfg = clone(SEED); cfg.jobs["chat.general"] = { model: ID.SOL, effort: "low", fallbacks: [{ model: ID.HAIKU, effort: "medium" }] };
  const v = await save(cfg); assert.equal(v.revision, 2); assert.deepEqual(v.config.jobs["chat.general"], cfg.jobs["chat.general"]);
  assert.equal(v.history[0].action, "save"); assert.equal(v.history[0].by, "unit@example.com");
  assert.equal(v.options.groups.length, 7); assert.ok(v.options.choices.chat.some((m) => m.id === ID.SOL));
  await assert.rejects(saveModelSettings(env, { revision: 1, config: cfg }, "other"), (e) => e.status === 409);
  const writes = await Promise.allSettled([saveModelSettings(env, { revision, config: cfg }, "a"), saveModelSettings(env, { revision, config: cfg }, "b")]);
  assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1); assert.equal(writes.find((r) => r.status === "rejected").reason.status, 409); revision++;
  // a browser can't smuggle endpoint, price or capability data in: only the jobs are taken, the catalog stays the server's
  const evil = clone((await readModelSettings(env)).config); evil.catalog[ID.SOL] = { id: ID.SOL, name: "x", kinds: ["chat"], efforts: ["low"], hosts: ["attacker"] };
  await save(evil); assert.deepEqual((await readModelSettings(env)).config.catalog[ID.SOL], SEED.catalog[ID.SOL]); }

// ---- 4) a saved change is what the very next dispatch uses (nothing cached) ----
const sent = []; let failures = new Set(); const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { const p = JSON.parse(init.body); sent.push(p);
  return failures.has(p.model) ? Response.json({ error: { message: "fixture unavailable" } }, { status: 503 }) : Response.json({ model: p.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0.00001 } }); };
const body = { messages: [{ role: "user", content: "Hello" }], max_tokens: 100, reasoning: { effort: "max" } };
const call = (route, kind = "chat", e = env, b = body) => openRouterChat(e, b, "session-kept", route, { tenant: "t", kind });
try {
  const route = async () => policyRoute((await readModelSettings(env)).config, "general", "zdr", "test");
  await call(await route()); assert.equal(sent.at(-1).model, ID.SOL); assert.equal(sent.at(-1).reasoning.effort, "low", "the saved effort, not the caller's");
  failures.add(ID.SOL); let n = sent.length; await call(await route()); failures.clear();
  assert.deepEqual(sent.slice(n).map((p) => [p.model, p.reasoning.effort]), [[ID.SOL, "low"], [ID.HAIKU, "medium"]], "each fallback uses its own saved effort");
  const c2 = clone((await readModelSettings(env)).config); c2.jobs["chat.general"].effort = "high"; await save(c2); await call(await route()); assert.equal(sent.at(-1).reasoning.effort, "high");
  c2.jobs["chat.general"] = { model: ID.LUNA, effort: "none", fallbacks: [] }; await save(c2); await call(await route()); assert.deepEqual(sent.at(-1).reasoning, { enabled: false });
  // background jobs, one by one: the saved model, effort and fallbacks for that job
  const c3 = clone((await readModelSettings(env)).config);
  c3.jobs.label = { model: ID.OSS120, effort: "medium", hosts: ["cerebras"], pin: true, fallbacks: [] };
  c3.jobs.handoff = { model: ID.HAIKU, effort: "high", fallbacks: [{ model: ID.OSS120, effort: "low", hosts: ["cerebras"], pin: false }] };
  c3.jobs.people_verify = { model: ID.OSS20, effort: "high", hosts: ["amazon-bedrock"], pin: true, strict: true, fallbacks: [] };
  await save(c3);
  await call({ chore: true }, "card-label"); assert.equal(sent.at(-1).model, ID.OSS120); assert.equal(sent.at(-1).reasoning.effort, "medium");
  await call((await route()), "chat", env, { messages: [{ role: "user", content: "(Turn finished; the person has your reply. Write notes.)" }] });
  assert.equal(sent.at(-1).model, ID.HAIKU, "hand-off notes read the saved handoff job"); assert.equal(sent.at(-1).reasoning.effort, "high");
  await call({ chore: true }, "memjob-people-verify", env, { ...body, response_format: { type: "json_object" } });
  assert.equal(sent.at(-1).model, ID.OSS20); assert.equal(sent.at(-1).response_format, undefined, "a model with no JSON mode gets no response format");
  failures.add(ID.OSS20); n = sent.length; await assert.rejects(call({ chore: true }, "memjob-people-verify"), /503/); failures.clear();
  assert.ok(sent.slice(n).every((p) => p.model === ID.OSS20), "a job with no fallbacks never substitutes another model");
  // Public source ignores private test model overrides and keeps the saved route; an own-key account keeps its own precedence
  await call(await route(), "chat", { ...env, TEST_MODEL: ID.HAIKU, TEST_MODEL_SCOPE: "all-dev", TEST_MODEL_EFFORT: "high" }); assert.equal(sent.at(-1).model, ID.LUNA);
  const own = { BYOK: { model: "own-model" } }; assert.equal(await modelSettingsEnv(own), own);
  // restore an earlier version: new revision, the old content, history says so
  const hist = (await modelSettingsView(env)).history, first = hist.filter((h) => h.action === "save").at(-1).revision;
  const restored = await restoreModelSettings(env, { revision, restore_revision: first }, "admin"); revision = restored.revision;
  assert.ok(restored.history.some((r) => r.action === `restore:${first}`)); await call(await route()); assert.equal(sent.at(-1).model, ID.SOL);
  await assert.rejects(restoreModelSettings(env, { revision, restore_revision: 999 }, "admin"), (e) => e.status === 404);
  assert.deepEqual(rows().map((r) => r.revision), rows().map((_, i) => i + 1), "versions are append-only and consecutive");
} finally { globalThis.fetch = originalFetch; }

// ---- 5) the one-time carry-over from the earlier slot-based settings (and what was in effect there) ----
{ const SPEC = { "muse-c": [ID.MUSE_C, "xhigh"], "muse-s": [ID.MUSE_S, "xhigh"], deepseek: [ID.DEEPSEEK, "max"], luna: [ID.LUNA, "xhigh"], sol: [ID.SOL, "high"], haiku: [ID.HAIKU, "xhigh"] };
  const legacy = { efforts: Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, v[1]])),
    chains: Object.fromEntries(["general", "research", "apps_economical", "skills", "spreadsheet", "technical", "apps_complete"].map((c) => [c, { unrestricted: ["muse-c", "deepseek", "sol"], no_training: ["deepseek", "sol", "muse-s"], zdr: ["deepseek", "sol", "haiku"] }])),
    chores: Object.fromEntries(["handoff", "label", "browser", "notes", "notes_refine", "notes_final", "memory_summary", "sidecar_card", "ambient_extract", "ambient_review", "upkeep_write", "upkeep_verify", "people_write", "people_verify", "reflect_write", "reflect_verify"].map((r) => [r, { model: "default", effort: "default" }])),
    decider: "default" };
  legacy.efforts.sol = "low"; legacy.efforts.haiku = "medium";
  // what the earlier page did when Sol was chosen for everyday chat: Sol first in every level's list
  legacy.chains.general = { unrestricted: ["sol", "muse-c", "deepseek"], no_training: ["sol", "deepseek", "muse-s"], zdr: ["sol", "deepseek", "haiku"] }; legacy.chains.technical = { unrestricted: ["haiku"], no_training: ["haiku", "sol"], zdr: ["haiku"] };
  legacy.chores.label = { model: "oss120", effort: "medium" }; legacy.chores.notes = { model: "dsflash", effort: "none" }; legacy.chores.handoff = { model: "haiku", effort: "high" }; legacy.decider = ID.JEV;
  sql.prepare("INSERT INTO model_settings_versions VALUES(?,?,?,?,?,?)").run("live", 4, JSON.stringify(legacy), 1, "fixture", "save");
  const live = { ...env, ENV_NAME: "live", CHORE_MODEL_BROWSER: "oss20" };
  const r = await readModelSettings(live); assert.equal(r.revision, 1); assert.deepEqual(rows("live"), [{ revision: 1, action: "migrate", by: "system" }]);
  const s = r.config, level = (cat, lv) => dispatchOrder(policyRoute(s, cat, lv, "x"), lv, { settings: s }).attempts.map((a) => [a.model, a.effort]);
  // every level's choice is what the earlier settings gave: customised lists and efforts, and the untouched defaults
  // every level gives back its own earlier list, in order, with each model's own earlier effort
  assert.deepEqual(level("general", "zdr"), [[ID.SOL, "low"], [ID.DEEPSEEK, "max"], [ID.HAIKU, "medium"]]);
  assert.deepEqual(level("general", "no_training"), [[ID.SOL, "low"], [ID.DEEPSEEK, "max"], [ID.MUSE_S, "xhigh"]]);
  assert.deepEqual(level("general", "unrestricted"), [[ID.SOL, "low"], [ID.MUSE_C, "xhigh"], [ID.DEEPSEEK, "max"]]);
  assert.deepEqual(level("research", "zdr"), [[ID.DEEPSEEK, "max"], [ID.SOL, "low"], [ID.HAIKU, "medium"]]);
  assert.deepEqual(level("research", "no_training"), [[ID.DEEPSEEK, "max"], [ID.SOL, "low"], [ID.MUSE_S, "xhigh"]]);
  assert.deepEqual(level("research", "unrestricted"), [[ID.MUSE_C, "xhigh"], [ID.DEEPSEEK, "max"], [ID.SOL, "low"]]);
  // a level whose earlier list was shorter than the merged list keeps its own models first and gets the others after them as fallbacks
  // (models that level may use, so privacy is unchanged); its first choice and the order of its own models never change
  assert.deepEqual(level("technical", "zdr"), [[ID.HAIKU, "medium"], [ID.SOL, "low"]]); assert.deepEqual(level("technical", "no_training"), [[ID.HAIKU, "medium"], [ID.SOL, "low"]]);
  assert.deepEqual(level("technical", "unrestricted"), [[ID.HAIKU, "medium"], [ID.SOL, "low"]]);
  assert.equal(s.jobs["recover.technical"].model, ID.SOL); assert.equal(s.jobs["recover.technical"].effort, "low", "recovery uses the saved effort of the slot it used");
  assert.equal(jobSetting(s, "decider").model, ID.JEV);
  const lab = choreRouteOf(s, "label"); assert.deepEqual([lab.model, lab.effort, lab.host, lab.pin, lab.fallbacks.length, lab.runtimeSettings], [ID.OSS120, "medium", "cerebras", true, 0, true]);
  const notes = choreRouteOf(s, "notes"); assert.deepEqual([notes.model, notes.effort, notes.fallbacks.length], [ID.DEEPSEEK, "none", 1]);
  const hand = choreRouteOf(s, "handoff"); assert.deepEqual([hand.model, hand.effort, hand.fallbacks.map((f) => [f.model, f.effort])], [ID.HAIKU, "high", [[ID.OSS120, "low"]]]);
  assert.equal(choreRouteOf(s, "browser").model, ID.OSS20, "the variable CHORE_MODEL_BROWSER was carried over once");
  assert.equal(choreRouteOf(s, "upkeep_verify").model, ID.DEEPSEEK); assert.equal(choreRouteOf(s, "upkeep_verify").effort, "none");
  // the earlier row is only read, never changed
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM model_settings_versions WHERE environment='live'").get().n, 1);
  // an invalid earlier row stops the carry-over with a clear error; it is never replaced by guessing
  sql.prepare("DELETE FROM model_job_settings_versions WHERE environment='live'").run();
  sql.prepare("INSERT INTO model_settings_versions VALUES(?,?,?,?,?,?)").run("live", 5, JSON.stringify({ efforts: { sol: "ludicrous" }, chains: { general: { unrestricted: ["nope"] } } }), 1, "fixture", "save");
  const fresh = await import("../src/ee/model-settings.js?no-copy-yet");   // a new instance of the module: it has no last saved copy to fall back on
  await assert.rejects(fresh.readModelSettings(live), (e) => e instanceof ModelSettingsError && e.status === 503);
  assert.equal(rows("live").length, 0, "nothing was saved from the invalid earlier row"); }

// ---- 6) failure behavior: the last saved copy that was read (logged), or a clear error; never a built-in model ----
{ const dev = await readModelSettings(env); errs.length = 0; broken = true;
  const stale = await readModelSettings(env); assert.equal(stale.stale, true); assert.deepEqual(stale.config, dev.config); assert.ok(errs.some((e) => /using the last saved copy/.test(e)), "the fallback is logged");
  const wrapped = await modelSettingsEnv(env); assert.equal(wrapped.MODEL_SETTINGS_STALE, true);
  const fresh = await import("../src/ee/model-settings.js?never-read");
  await assert.rejects(fresh.readModelSettings(env), (e) => e instanceof ModelSettingsError && e.status === 503 && /Nothing was sent/.test(e.message));
  await assert.rejects(fresh.modelSettingsEnv(env), /Nothing was sent/); broken = false;
  // a stored version that doesn't validate is reported, and the last good copy keeps serving
  sql.prepare("INSERT INTO model_job_settings_versions VALUES(?,?,?,?,?,?)").run("dev", revision + 1, "broken json", Date.now(), "fixture", "invalid-fixture");
  const again = await readModelSettings(env); assert.equal(again.stale, true);
  sql.prepare("DELETE FROM model_job_settings_versions WHERE action='invalid-fixture'").run(); }
{ // a job added by a later release is filled in once, as a new version, from the first-run data; nothing else changes
  const cur = await readModelSettings(env), c = clone(cur.config); delete c.jobs.embed_memory;
  sql.prepare("INSERT INTO model_job_settings_versions VALUES(?,?,?,?,?,?)").run("dev", cur.revision + 1, JSON.stringify(c), Date.now(), "fixture", "older-release");
  const after = await readModelSettings(env); assert.equal(after.revision, cur.revision + 2); assert.equal(jobSetting(after.config, "embed_memory").model, ID.EMBED_MEMORY);
  assert.deepEqual({ ...after.config.jobs, embed_memory: null }, { ...cur.config.jobs, embed_memory: null });
  assert.match(rows().at(-1).action, /^add-jobs:embed_memory/); revision = after.revision; }

console.log = origLog; console.error = origErr;
console.log("PASS model settings: validation, first version (first-run data, carried variables, earlier settings), save/history/restore, stale and concurrent writes, uncached dispatch changes, jobs, failure behavior");
sql.close();
