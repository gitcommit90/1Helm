// node --import ./test/stubs/register.mjs test/models-changes.test.mjs
// What changed between saved versions, and when each row's models last changed. The Models page judges a served call only against the models that
// were saved when it was served, so a row's `since` must be the time of the version that last changed its models, and nothing else.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { changesBetween, changeTimes, rowsOfVersion } from "../src/ee/model-changes.js";
import { servedView, noteServed, resetServedCache } from "../src/ee/model-served.js";
import { consoleState } from "../src/ee/models-console.js";
import { modelSettingsView, saveModelSettings } from "../src/ee/model-settings.js";
import * as C from "../app-assets/app-static/models-console-core.js";

globalThis.fetch = async () => { throw new Error("offline: this test does not use the network"); };
let checks = 0; const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };
const job = (model, effort = null, fallbacks = [], extra = {}) => ({ model, effort, fallbacks: fallbacks.map((m) => ({ model: m, effort: null })), ...extra });
const cat = (id, unrestricted, extra = {}) => ({ id, title: id, chains: { unrestricted: unrestricted.map((m) => ({ model: m, effort: null })), no_training: [], zdr: [] }, ...extra });
const ver = (revision, at, jobs, categories = [cat("general", ["a/one"])], limits = undefined) => ({ revision, at, by: "t", action: "save", jobs, routing: { categories }, limits });

await test("a version's rows: jobs, routing categories and saved limits, with starting values for missing fields", () => {
  const rows = rowsOfVersion(ver(1, 1, { label: job("a/one") }, [cat("general", ["a/one"])], { steps: 3 }));
  assert.deepEqual([...rows.keys()].sort(), ["cat:general", "label", "limit:steps"]);
  assert.equal(rows.get("label").fields.max_output ?? null, null);
});

await test("changesBetween names the rows and fields that changed, and ignores a field written out at its starting value", () => {
  const a = ver(1, 1, { label: job("a/one"), notes: job("a/two") }), b = ver(2, 2, { label: job("a/one"), notes: job("a/three", "low", ["a/two"]) });
  assert.deepEqual(changesBetween(a, b), [{ key: "notes", fields: ["chain"] }]);
  const c = ver(3, 3, { label: job("a/one", null, [], { max_output: 4000, sort: "price" }), notes: job("a/three", "low", ["a/two"]) });
  assert.deepEqual(changesBetween(b, c), [{ key: "label", fields: ["max_output", "sort"] }]);
  assert.deepEqual(changesBetween(c, c), []);
  const d = ver(4, 4, { label: job("a/one", null, [], { max_output: 4000, sort: "price" }) }, [cat("general", ["a/one"]), cat("tech", ["a/x"])]);
  assert.deepEqual(changesBetween(c, d).map((x) => [x.key, !!x.added, !!x.removed]), [["cat:tech", true, false], ["notes", false, true]]);
  const e = ver(5, 5, d.jobs, [cat("general", ["a/one"], { max_output: 500 }), cat("tech", ["a/x"])]);
  assert.deepEqual(changesBetween(d, e), [{ key: "cat:general", fields: ["max_output"] }]);
});

await test("since: the time of the version that last changed a row's models, and a limit or reasoning change does not move it", () => {
  const v = [
    ver(4, 400, { label: job("a/one", "high", [], { max_output: 9 }), notes: job("a/three") }, [cat("general", ["a/g2"])]),
    ver(3, 300, { label: job("a/one", "low", [], { max_output: 9 }), notes: job("a/three") }, [cat("general", ["a/g2"])]),
    ver(2, 200, { label: job("a/one"), notes: job("a/three") }, [cat("general", ["a/g1"])]),
    ver(1, 100, { label: job("a/one"), notes: job("a/two") }, [cat("general", ["a/g1"])]),
  ];
  const { since, history } = changeTimes(v, { complete: true });
  assert.equal(since.label, 0, "label has had the same models since the first version");
  assert.equal(since.notes, 200); assert.equal(since["chat:general"], 300);
  assert.deepEqual(history[4], [{ key: "label", fields: ["effort"] }], "only the reasoning level changed");
  assert.deepEqual(history[3], [{ key: "label", fields: ["effort", "max_output"] }, { key: "cat:general", fields: ["chain"] }]);
  assert.equal(history[1], undefined, "the first version has nothing to compare with");
  // not every version was read: a row that did not change in the window is only known to be unchanged since the oldest version read
  assert.equal(changeTimes(v.slice(0, 3)).since.label, 200);
});

// ---- the real stores: a save moves the row's `since`, a served row carries it, and the page reads the two together ----
function environment() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["test/fixtures/migrations/migrations_055_model_settings.sql", "db/migrations/0050_model_job_settings.sql", "db/migrations/0058_model_served.sql", "db/migrations/0061_model_served_last_error.sql"]) db.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  const DB = { prepare(q) { const st = db.prepare(q); let a = []; const s = { bind(...v) { a = v; return s; }, async first() { return st.get(...a) || null; }, async all() { return { results: st.all(...a) }; }, async run() { return { meta: { changes: Number(st.run(...a).changes) } }; } }; return s; } };
  return { ONEHELM_EE: "1hc", ENV_NAME: "dev", DYNAMIC_ROUTING: "on", DB, db, waitUntil() {} };
}
await test("a call served before a save is history in the page, a call after it is judged, and the History list says what each save changed", async () => {
  const env = environment(), v1 = await modelSettingsView(env), first = v1.config.jobs.label.model, other = Object.keys(v1.config.catalog).find((m) => m !== first && !m.startsWith("@") && v1.config.jobs.label.fallbacks.every((f) => f.model !== m) && v1.config.catalog[m].kinds?.includes("chore"));
  assert.ok(other, "the seeded catalog has another chore model");
  resetServedCache();
  const t0 = Date.now();
  await noteServed(env, { job: "label", requested: first, served: { model: first, provider: "p" }, now: t0 - 5 * 3600000 });
  const cfg = structuredClone(v1.config); cfg.jobs.label = { ...cfg.jobs.label, model: other, fallbacks: [] };
  await saveModelSettings(env, { revision: v1.revision, config: cfg }, "admin@example.com");
  let state = await consoleState(await modelSettingsView(env), env);
  const sv = state.served.label; assert.equal(typeof sv.since, "number"); assert.ok(sv.since > sv.last_at, "the row's models changed after the call");
  let info = C.view(state, { view: "all", q: "", sel: null, level: "unrestricted", env: "dev", live: null }).info.find((x) => x.row.key === "label");
  assert.equal(info.ss.k, "history"); assert.deepEqual(C.attentionKinds(info.flags), [], "no flag for a call that predates the save");
  // a call after the save that still asked for the old model is real news
  resetServedCache(); await noteServed(env, { job: "label", requested: first, served: { model: first, provider: "p" }, now: Date.now() + 5 });
  state = await consoleState(await modelSettingsView(env), env);
  info = C.view(state, { view: "all", q: "", sel: null, level: "unrestricted", env: "dev", live: null }).info.find((x) => x.row.key === "label");
  assert.equal(info.ss.k, "other"); assert.equal(C.attentionKinds(info.flags).length, 1);
  // History: the save lists the job and what changed, the first version has no list
  assert.deepEqual(state.history[0].changes, [{ key: "label", fields: ["chain"] }]); assert.equal(state.history[state.history.length - 1].changes, null);
  assert.deepEqual(C.changeLines(state, state.history[0].changes), ["Task summaries: models"]);
  // a save that changes only a limit leaves `since` alone
  const v3 = await modelSettingsView(env), cfg2 = structuredClone(v3.config); cfg2.jobs.label.max_output = 777;
  await saveModelSettings(env, { revision: v3.revision, config: cfg2 }, "admin@example.com");
  const state2 = await consoleState(await modelSettingsView(env), env);
  assert.equal(state2.served.label.since, sv.since, "a limit change is not a change of models");
  // a server that reports no `since` (an older Live) is never judged
  const { since, ...bare } = state2.served.label;
  assert.equal(C.servedState(state2, C.rowByKey(state2, "label"), C.chainsOf(state2, C.rowByKey(state2, "label"), C.snapshotFromConfig(state2)), { label: bare }).k, "history");
  assert.equal((await servedView(env)).label.since, null, "without the change times the row carries none");
});

await test("history lines are plain words: actions are named and a list of changes is cut to four lines", () => {
  assert.equal(C.actionText("seed"), "First settings"); assert.equal(C.actionText("save"), "");
  assert.equal(C.actionText("restore:7"), "Restored revision 7");
  assert.equal(C.actionText("add-jobs:a,b"), "Added a, b"); assert.equal(C.actionText("strip-provider-lists"), "Removed saved provider lists");
  const html = C.historyBody({ revision: 9, history: [{ revision: 9, at: 1, by: "x", action: "save", changes: Array.from({ length: 6 }, (_, i) => ({ key: "job" + i, fields: ["sort"] })) }], limits: null, config: { routing: { categories: [] } }, jobs: [], groups: [] }, null).toString();
  assert.match(html, /and 2 more/); assert.doesNotMatch(html, /restore:|push:dev|>save</);
});
console.log(`PASS ${checks} models changes checks`);
