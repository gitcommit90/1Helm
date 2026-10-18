// node --import ./test/stubs/register.mjs test/chat-job-migration.test.mjs
// Dev and Live saved the chat limits as the job "chat.general", next to a chat job for each old kind of request, four retry jobs and "escalate".
// The chat job is gone too: its max output, sort, max price and timeout now belong to each routing category. Reading such a saved version must give every
// category the saved limits of "chat.general" (or "chat"), drop the other jobs, and write one new version (the old row stays in History). Real SQLite stands in for D1.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readModelSettings, withoutRetiredJobs, validateModelSettings } from "../src/ee/model-settings.js";
import { withRoutingConfig } from "../src/ee/routing-config.js";
import { JOB_IDS, CHAT_JOB } from "../src/ee/model-jobs.js";
import { SEED } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const OLD_CHAT = ["chat.general", "chat.research", "chat.apps_economical", "chat.skills", "chat.spreadsheet", "chat.technical", "chat.apps_complete"];
const OLD_OTHER = ["recover.apps_economical", "recover.apps_complete", "recover.technical", "recover.spreadsheet", "escalate"];

// The shape Live and dev store today: version 3 with routing categories, and the twelve old jobs.
const routed = clone(SEED);
const chat = { model: routed.routing.categories[0].chains.zdr[0].model, effort: null, fallbacks: [], max_output: 12000, sort: "throughput", max_price: { prompt: 2, completion: 9 }, timeout_ms: 90000 };
const LIMITS = { max_output: 12000, sort: "throughput", max_price: { prompt: 2, completion: 9 }, timeout_ms: 90000 };
const old = clone(routed);
for (const c of old.routing.categories) for (const k of Object.keys(LIMITS)) delete c[k];
old.routing.categories.push({ ...clone(old.routing.categories[0]), id: "technical", title: "Technical" });
old.jobs["chat.general"] = chat;
for (const id of OLD_CHAT.slice(1)) old.jobs[id] = { ...clone(chat), max_output: 111, sort: null, max_price: null, timeout_ms: null };
for (const id of OLD_OTHER) old.jobs[id] = { model: chat.model, effort: chat.effort, fallbacks: [] };

// 1. the pure step
{ const out = withoutRetiredJobs(clone(old));
  for (const c of out.routing.categories) assert.deepEqual({ max_output: c.max_output, sort: c.sort, max_price: c.max_price, timeout_ms: c.timeout_ms }, LIMITS, `${c.id} takes every saved limit of chat.general`);
  for (const id of [CHAT_JOB, ...OLD_CHAT, ...OLD_OTHER]) assert.ok(!(id in out.jobs), `${id} is dropped`);
  assert.deepEqual(Object.keys(out.jobs).sort(), [...JOB_IDS].sort());
  assert.equal(validateModelSettings(out).routing.categories[1].max_output, 12000);
  // a version that already has the chat job uses it, and a category that already has its own limits keeps them
  const both = clone(old); both.jobs.chat = { ...clone(chat), max_output: 5 }; both.routing.categories[1].max_output = 7; both.routing.categories[1].sort = null; both.routing.categories[1].max_price = null; both.routing.categories[1].timeout_ms = null;
  const kept = withoutRetiredJobs(both).routing.categories; assert.equal(kept[0].max_output, 5); assert.equal(kept[1].max_output, 7, "a category's own limits are kept"); }
// a version 2 version (no categories) becomes version 3 from the chat job's models, and General takes its limits
{ const v2 = clone(SEED); delete v2.routing; v2.version = 2;
  v2.jobs.chat = { model: SEED.routing.categories[0].chains.zdr[0].model, effort: SEED.routing.categories[0].chains.zdr[0].effort, fallbacks: [SEED.routing.categories[0].chains.zdr[1], SEED.routing.categories[0].chains.zdr[2]], max_output: 321 };
  const out = validateModelSettings(withoutRetiredJobs(v2)); assert.equal(out.version, 3); assert.equal(out.routing.categories[0].max_output, 321); assert.ok(!("chat" in out.jobs)); }

// 2. reading a stored row
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../db/migrations/0050_model_job_settings.sql", import.meta.url), "utf8"));
sql.prepare("INSERT INTO model_job_settings_versions (environment,revision,config,at,by,action) VALUES (?,?,?,?,?,?)").run("live", 7, JSON.stringify(old), 1, "captain", "save");
let writes = 0;
const DB = { withSession() { return this; }, prepare(q) {
  if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(q)) writes++;
  const s = sql.prepare(q); let a = [];
  const o = { bind(...v) { a = v; return o; }, first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) };
  return o;
} };
const env = { DB, ONEHELM_EE: "1hc", ENV_NAME: "live", DYNAMIC_ROUTING: "on" };
const log = console.log; console.log = () => {};
const first = await readModelSettings(env), again = await readModelSettings(env);
console.log = log;
assert.equal(writes, 1, "one new version, written once"); assert.equal(first.revision, 8); assert.equal(again.revision, 8);
assert.ok(!(CHAT_JOB in first.config.jobs), "the chat job is gone");
assert.equal(first.config.version, 3); assert.deepEqual(first.config.routing.categories.map((c) => c.chains), old.routing.categories.map((c) => c.chains), "routing chains are untouched");
for (const c of first.config.routing.categories) assert.deepEqual({ max_output: c.max_output, sort: c.sort, max_price: c.max_price, timeout_ms: c.timeout_ms }, LIMITS, `${c.id} has the saved limits`);
assert.deepEqual(Object.keys(first.config.jobs).sort(), [...JOB_IDS].sort());
const rows = sql.prepare("SELECT revision,action,config FROM model_job_settings_versions ORDER BY revision").all();
assert.equal(rows.length, 2); assert.equal(rows[1].action, "strip-provider-lists"); assert.deepEqual(JSON.parse(rows[0].config), old, "the old version stays in History as it was");
console.log("chat-job-migration: ok");
