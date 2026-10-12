// node --import ./test/stubs/register.mjs test/background-nine-settings.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { BACKGROUND_POLICIES } from "../src/ee/background-policy.js";
import { LEGACY_SETTINGS_CHORES, SETTINGS_CHORES, defaultModelSettings, validateModelSettings, configuredChore, modelSettingsOptions, readModelSettings, modelSettingsView, saveModelSettings, restoreModelSettings } from "../src/ee/model-settings.js";

assert.equal(LEGACY_SETTINGS_CHORES.length, 13);
assert.equal(SETTINGS_CHORES.length, 16);
assert.equal(Object.keys(BACKGROUND_POLICIES).length, 9);
const legacy = () => {
  const c = defaultModelSettings();
  for (const key of ["notes_refine", "ambient_extract", "ambient_review"]) delete c.chores[key];
  return c;
};
const old = legacy();
old.chores.notes = { model: "dsflash", effort: "high" };
old.chores.label = { model: "oss120", effort: "medium" };
const snapshot = JSON.stringify(old), normalized = validateModelSettings(old);
assert.equal(JSON.stringify(old), snapshot, "normalization never mutates persisted caller input");
for (const key of LEGACY_SETTINGS_CHORES) assert.deepEqual(normalized.chores[key], old.chores[key]);
assert.deepEqual(normalized.chores.notes_refine, old.chores.notes, "legacy notes applied to refinement too");
for (const key of ["ambient_extract", "ambient_review"]) assert.deepEqual(normalized.chores[key], { model: "default", effort: "default" });
assert.deepEqual(validateModelSettings(legacy()).chores.notes_refine, { model: "default", effort: "default" });
normalized.chores.notes_refine = { model: "haiku", effort: "low" };
assert.deepEqual(validateModelSettings(normalized).chores.notes_refine, normalized.chores.notes_refine, "new independent selection stays independent");
assert.equal(normalized.chores.notes.model, "dsflash");
for (const mutate of [c => delete c.chores.notes, c => { c.chores.unknown = c.chores.notes; }, c => delete c.chores.ambient_review, c => { c.chores.notes_refine.effort = "invalid"; }]) {
  const c = defaultModelSettings(); mutate(c); assert.throws(() => validateModelSettings(c), e => e.status === 400);
}
for (const key of ["notes", "label"]) {
  const c = legacy(); c.chores[key] = null; assert.throws(() => validateModelSettings(c), e => e.status === 400);
}
const options = modelSettingsOptions({ CHORE_MODEL_LABEL: "oss20", CHORE_MODEL_MJVERIFY: "oss120:high" });
for (const [role, p] of Object.entries(BACKGROUND_POLICIES)) {
  assert.equal(p.effort, "low");
  assert.equal(options.choreDefaults[role], `Inherited: ${p.model}, LOW reasoning; no other-model fallback`);
  for (const model of ["haiku", "dsflash", "luna", "oss120"]) {
    const config = defaultModelSettings(); config.chores[role] = { model, effort: "low" };
    const route = configuredChore({ MODEL_SETTINGS: config }, role);
    assert.deepEqual(route.fallbacks, [], `${role}: explicit ${model} is never replaced`);
    assert.equal(route.effort, "low"); assert.equal(route.pin, true);
  }
}
const remaining = defaultModelSettings(); remaining.chores.handoff = { model: "haiku", effort: "high" };
assert.equal(configuredChore({ MODEL_SETTINGS: remaining }, "handoff").fallbacks[0].model, "openai/gpt-oss-120b");

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../db/migrations/0048_model_settings.sql", import.meta.url), "utf8"));
sql.prepare("INSERT INTO model_settings_versions VALUES(?,?,?,?,?,?)").run("dev", 2, snapshot, 1, "fixture", "save");
sql.prepare("INSERT INTO model_settings_versions VALUES(?,?,?,?,?,?)").run("live", 3, JSON.stringify(legacy()), 1, "fixture", "save");
const DB = { withSession() { return this; }, prepare(q) { const s = sql.prepare(q); let a = []; return { bind(...v) { a = v; return this; }, async first() { return s.get(...a) || null; }, async all() { return { results: s.all(...a) }; }, async run() { return { meta: { changes: Number(s.run(...a).changes) } }; } }; } };
try {
  const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" };
  const view = await modelSettingsView(env); assert.equal(view.revision, 2); assert.equal(view.config_error, null);
  assert.deepEqual(view.config.chores.notes_refine, old.chores.notes);
  assert.equal(sql.prepare("SELECT config FROM model_settings_versions WHERE environment='dev'").get().config, snapshot, "read normalization does not write a migration");
  assert.equal((await readModelSettings({ ...env, ENV_NAME: "live" })).revision, 3);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM model_settings_versions").get().n, 2);
  const saved = await saveModelSettings(env, { revision: 2, config: old }, "fixture");
  assert.equal(saved.revision, 3); assert.equal(Object.keys(saved.config.chores).length, 16);
  const restored = await restoreModelSettings(env, { revision: 3, restore_revision: 2 }, "fixture");
  assert.equal(restored.revision, 4); assert.deepEqual(restored.config.chores.notes_refine, old.chores.notes);
  assert.equal(sql.prepare("SELECT config FROM model_settings_versions WHERE environment='dev' AND revision=2").get().config, snapshot);
  assert.equal((await readModelSettings({ ...env, ENV_NAME: "live" })).revision, 3);
} finally { sql.close(); }
console.log("PASS nine-role settings: exact legacy normalization, preserved overrides/history, independent new roles, canonical display and no cross-model fallback; untouched-role fallback unchanged");

