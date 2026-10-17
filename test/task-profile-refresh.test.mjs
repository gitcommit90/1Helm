// node --import ./test/stubs/register.mjs test/task-profile-refresh.test.mjs
// A running task picks up a change saved on the Models page at the next person message, and keeps its model inside one turn.
import assert from "node:assert/strict";
import { ensureTaskRuntime, TASK_PROFILE_KEY, readTaskProfile } from "../src/ee/task-profile.js";
import { seedSettings, ID } from "./helpers/seed-settings.mjs";
const MUSE_C = ID.MUSE_C, SOL = ID.SOL;
const cat = (id, hosts) => ({ id, eligible: true, hosts, efforts: ["minimal", "low", "high"], levels: ["unrestricted", "zdr", "no_training"], context_length: 262144, max_output: 65536, input_modalities: ["text"], pricing: { prompt: .1, completion: .2 }, tool_choice: ["auto"], json: true });
const records = { [MUSE_C]: cat(MUSE_C, ["meta"]), [SOL]: cat(SOL, ["azure"]) };
const settings = seedSettings(); let revision = 1;
const env = { ONEHELM_EE: "1hc", OPENROUTER_API_KEY: "x", TASK_MODEL_CATALOG: records, DB: { prepare(sql) { return { bind() { return this; }, async first() {
  if (sql.includes("model_job_settings_versions")) return { revision, config: JSON.stringify(settings) };
  if (sql.includes("ai_privacy")) return { ai_privacy: "unrestricted" };
  throw new Error(sql); } }; } } };
const store = new Map([["tenant", "t"], ["channel", "main"]]);
const R = { env, get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, String(v)) };
const args = () => ({ kind: "job", text: "go", hist: [], stats: { charge: 0 } });

let p = await ensureTaskRuntime(R, { session: "s1", turn: "c1" }, args());
assert.equal(p.requestedModel, MUSE_C); assert.equal(p.refreshedTurn, "c1");
settings.jobs["chat.general"] = { model: SOL, effort: "high", fallbacks: [] }; revision++;
p = await ensureTaskRuntime(R, { session: "s1", turn: "c1" }, args());
assert.equal(p.requestedModel, MUSE_C, "inside one turn (a resume included) the model stays fixed");
const cache = p.cacheSession;
p = await ensureTaskRuntime(R, { session: "s1", turn: "c2" }, args());
assert.equal(p.requestedModel, SOL, "the next person message reads the saved job again"); assert.equal(p.effort, "high"); assert.equal(p.cacheSession, cache);
assert.equal(p.transitions.length, 1); assert.equal(p.transitions[0].from, MUSE_C); assert.equal(readTaskProfile(R, "s1").requestedModel, SOL);
// the same model again: nothing recorded as a transition
p = await ensureTaskRuntime(R, { session: "s1", turn: "c3" }, args()); assert.equal(p.transitions.length, 1);
// a profile saved before this release has no refreshedTurn: kept for the turn it is resumed in, refreshed at the next message
settings.jobs["chat.general"] = { model: MUSE_C, effort: "low", fallbacks: [] }; revision++;
const { refreshedTurn, ...legacy } = p; store.set(TASK_PROFILE_KEY("old"), JSON.stringify(legacy));
p = await ensureTaskRuntime(R, { session: "old", turn: "k5" }, args()); assert.equal(p.requestedModel, SOL, "a resumed turn of an older task keeps its model"); assert.equal(readTaskProfile(R, "old").refreshedTurn, "k5");
p = await ensureTaskRuntime(R, { session: "old", turn: "k6" }, args()); assert.equal(p.requestedModel, MUSE_C);
console.log("PASS task profile refresh at the next message, fixed inside a turn, safe for profiles saved before");
