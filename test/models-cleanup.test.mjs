// node --import ./test/stubs/register.mjs test/models-cleanup.test.mjs
// The Models page cleanup (Captain, 2026-10-15): retired jobs, the hidden ambient index job, corrected descriptions and model facts, the rule that
// the saved catalog holds only models a job uses, the read-only section for models chosen elsewhere.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { validateModelSettings, readModelSettings, saveModelSettings, modelSettingsView, withoutRetiredJobs, pruneCatalog, saveFullModelSettings } from "../src/ee/model-settings.js";
import { seedFresh, SEED_FACTS } from "../src/ee/model-seed.js";
import { JOBS, JOB_IDS, GROUPS, jobDef, entriesOf, effortBody } from "../src/ee/model-jobs.js";
import { modelDashboard } from "../src/ee/model-dashboard.js";
import { outsideModels } from "../src/ee/outside-models.js";
import { HINDSIGHT_MODELS, HINDSIGHT_ENV_NAMES, compareHindsightEnv } from "../src/ee/hindsight-models.js";
import { modelsHtml } from "../src/ee/models-page.js";
import { WAI_NANO_PER_MIN } from "../src/transcribe.js";
import { ID, SEED, EXTRA_FACTS, withExtraModels } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
let checks = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const RETIRED = ["memory_summary", "upkeep_write", "upkeep_verify", "people_write", "people_verify", "reflect_write", "reflect_verify", "memory_supersede"];

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("./fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
  const DB = { withSession() { return this; }, prepare(q) { const s = sql.prepare(q); let a = []; const o = { bind(...v) { a = v; return o; }, first: async () => s.get(...a) || null,
    all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) }; return o; } };
  return { sql, DB };
}
const ambientOff = { HINDSIGHT: {}, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", HS_FOUNDATIONS: "on", HS_WRITERS: "on", LEGACY_AMBIENT_SEARCH: "off" };

await test("the eight retired jobs are not in the registry, and the registry has no memory wording left", () => {
  for (const id of RETIRED) assert.ok(!JOB_IDS.includes(id), id); assert.equal(JOBS.length, 32);
  assert.ok(!JOBS.some((j) => /memory/i.test(`${j.label} ${j.description}`) && j.id !== "embed_memory"), "no job describes memory work that no longer runs");
  const seed = seedFresh({}); for (const id of RETIRED) assert.ok(!(id in seed.jobs), `${id} is not seeded`);
});

await test("tolerant read: a saved version with retired or unknown jobs reads as the current jobs, and nothing is added or rewritten", async () => {
  const { sql, DB } = database(), env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" };
  const first = await readModelSettings(env); assert.equal(first.revision, 1); assert.equal(first.retired, undefined);
  const raw = clone(first.config); for (const id of RETIRED) raw.jobs[id] = clone(raw.jobs.handoff); raw.jobs.some_future_job = clone(raw.jobs.handoff);
  sql.prepare("INSERT INTO model_job_settings_versions VALUES(?,?,?,?,?,?)").run("dev", 2, JSON.stringify(raw), 1, "fixture", "save");
  const r = await readModelSettings(env);
  assert.equal(r.revision, 2, "no new version was written by the read"); assert.deepEqual(Object.keys(r.config.jobs).sort(), [...JOB_IDS].sort());
  assert.deepEqual(r.retired.sort(), [...RETIRED, "some_future_job"].sort());
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM model_job_settings_versions WHERE environment='dev'").get().n, 2);
  assert.ok(!sql.prepare("SELECT action FROM model_job_settings_versions").all().some((x) => /add-jobs/.test(x.action)), "retired jobs are not 'missing jobs' to fill in");
  // the strict validator itself still refuses extra jobs, and a missing current job is still repaired the old way
  assert.throws(() => validateModelSettings(raw), (e) => e.status === 400); assert.deepEqual(withoutRetiredJobs(raw).jobs.handoff, raw.jobs.handoff);
  // a save through the page writes a clean version
  const view = await saveModelSettings(env, { revision: 2, config: { version: 2, jobs: r.config.jobs } }, "admin"); assert.equal(view.revision, 3);
  assert.ok(!Object.keys(JSON.parse(sql.prepare("SELECT config FROM model_job_settings_versions WHERE revision=3").get().config).jobs).some((id) => RETIRED.includes(id)));
});

await test("the ambient search index job is hidden from the page when the ambient passage index is off, and stays in the saved settings", async () => {
  const { DB } = database(), on = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" }, off = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", ...ambientOff };
  const shown = await modelSettingsView(on), hidden = await modelSettingsView(off);
  assert.ok(shown.options.jobs.some((j) => j.id === "embed_memory")); assert.deepEqual(shown.hidden, []);
  assert.ok(!hidden.options.jobs.some((j) => j.id === "embed_memory")); assert.deepEqual(hidden.hidden, ["embed_memory"]);
  assert.ok(hidden.config.jobs.embed_memory, "its saved setting stays, so saves from the page still validate");
  assert.ok(!modelDashboard(hidden).jobs.some((j) => j.id === "embed_memory")); assert.ok(modelDashboard(shown).jobs.some((j) => j.id === "embed_memory"));
  const saved = await saveModelSettings(off, { revision: hidden.revision, config: { version: 2, jobs: hidden.config.jobs } }, "admin"); assert.equal(saved.revision, hidden.revision + 1);
  const def = jobDef("embed_memory"); assert.match(def.description, /ambient passage index/); assert.doesNotMatch(def.description, /saved memory\. Changing/);
});

await test("descriptions: speech jobs, group name, page lead, router jobs", () => {
  const d = (id) => jobDef(id).description;
  assert.match(d("stt"), /\/api\/transcribe/); assert.match(d("stt"), /Live notes/); assert.match(d("stt"), /AssemblyAI goes first for WAV/); assert.match(d("stt"), /Qwen3 ASR and then Whisper/);
  assert.match(d("live_dictation"), /AssemblyAI/); assert.match(d("live_dictation"), /WAV chunks cut at pauses/); assert.match(d("live_dictation"), /Deepgram Nova 3 on Cloudflare streams is the fallback/);
  assert.match(d("stt_cloudflare"), /only for the Speech to text job/); assert.match(d("stt_cloudflare"), /under 20 MB/);
  assert.equal(GROUPS.find((g) => g.id === "search").title, "Search and pictures");
  assert.doesNotMatch(jobDef("classic_decider").label + d("classic_decider"), /older/i); assert.match(d("classic_decider"), /OWN_ROUTER is on/);
  assert.match(d("classic_router"), /dormant while ROUTER_MODE is two/);
  const html = modelsHtml({ environment: "dev", revision: 1, config: SEED, options: {}, dashboard: { jobs: [], groups: [] }, history: [], outside: [] }, { ENV_NAME: "dev" });
  assert.doesNotMatch(html, /only place models are chosen/); assert.match(html, /id="outside"/);
});

await test("model facts match the live data read on 2026-10-15", () => {
  assert.equal(SEED_FACTS["@cf/cloudflare/clef-flash"].in_nano, 38, "$0.038 per million input tokens on Cloudflare");
  assert.deepEqual(SEED_FACTS[ID.GLM].efforts, ["low", "high", "max"]); assert.equal(SEED_FACTS[ID.GLM].quirks.reasoning_mandatory, true);
  assert.deepEqual(effortBody("none", ID.GLM, SEED), { reasoning: { effort: "low" } }, "reasoning can't be turned off for GLM 5.3 Flash, so none is sent as low");
  const c = clone(SEED); c.jobs.notes_refine.fallbacks = [{ model: ID.GLM, effort: "none", hosts: ["together"], pin: false }];
  assert.throws(() => validateModelSettings(c), /doesn't support reasoning level none/);
  assert.deepEqual(EXTRA_FACTS[ID.QWEN].efforts, ["xhigh", "medium", "low", "none"]);
  assert.equal(WAI_NANO_PER_MIN, Math.round(46.63 * 0.011 / 1000 * 1e6) * 1000, "46.63 neurons at $0.011 per 1,000 neurons is $0.000513 a minute; the pricing page rounds it to $0.0005");
});

await test("the catalog keeps only models a job uses; Sol, Qwen 3.8, gpt-oss-20b and Jev are gone from the first-run data", () => {
  const seed = validateModelSettings(seedFresh({})), used = new Set(Object.values(seed.jobs).flatMap((j) => entriesOf(j).map((e) => e.model)));
  assert.deepEqual(Object.keys(seed.catalog).sort(), [...used].sort());
  for (const id of ["openai/gpt-6.1-sol", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "~typesafe/jev-latest"]) { assert.ok(!(id in seed.catalog), id); assert.ok(!(id in SEED_FACTS), id); }
  const withExtra = withExtraModels(seed); assert.ok(Object.keys(withExtra.catalog).length > Object.keys(seed.catalog).length);
  assert.deepEqual(Object.keys(pruneCatalog(withExtra).catalog).sort(), Object.keys(seed.catalog).sort());
});

await test("a save that leaves a model unused drops it from the catalog, and the picker still offers it", async () => {
  const { DB } = database(), env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" }, v0 = await modelSettingsView(env);
  assert.ok(v0.config.catalog[ID.STT_FALLBACK]);
  const jobs = clone(v0.config.jobs); jobs.stt.fallbacks = jobs.stt.fallbacks.filter((f) => f.model !== ID.STT_FALLBACK);
  const v1 = await saveModelSettings(env, { revision: v0.revision, config: { version: 2, jobs } }, "admin");
  assert.ok(!(ID.STT_FALLBACK in v1.config.catalog), "no job uses it, so it left the catalog");
  assert.ok(v1.options.choices.speech.some((m) => m.id === ID.STT_FALLBACK), "the picker still lists it, from the known facts");
  const jobs2 = clone(v1.config.jobs); jobs2.stt.fallbacks.push({ model: ID.STT_FALLBACK, effort: null });
  const v2 = await saveModelSettings(env, { revision: v1.revision, config: { version: 2, jobs: jobs2 } }, "admin");
  assert.deepEqual(v2.config.catalog[ID.STT_FALLBACK], { id: ID.STT_FALLBACK, ...SEED_FACTS[ID.STT_FALLBACK] }, "added again with its known facts");
});

await test("models chosen elsewhere are listed read only on the page: browser look, decision shadow, Hindsight", async () => {
  const out = outsideModels({ ENV_NAME: "dev", DECISION_SHADOW: "off" }), by = Object.fromEntries(out.map((g) => [g.id, g]));
  assert.deepEqual(out.map((g) => g.id), ["browser_look", "decision_shadow", "hindsight"]);
  assert.equal(by.browser_look.items[0].model, "@cf/moondream/moondream3.1-9B-A2B"); assert.equal(outsideModels({ SIDECAR_LOOK_MODEL: "@cf/x/y" })[0].items[0].model, "@cf/x/y");
  assert.equal(by.decision_shadow.items[0].model, "perplexity/pplx-decider-v1.1-27b"); assert.match(by.decision_shadow.items[0].detail, /^Off \(DECISION_SHADOW is off\)/);
  assert.deepEqual(by.hindsight.items.map((i) => i.model), HINDSIGHT_MODELS.map((m) => m.model)); assert.match(by.hindsight.note, /compose file/);
  const { DB } = database(), view = await modelSettingsView({ ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" });
  const html = modelsHtml({ ...view, dashboard: modelDashboard(view), outside: out }, { ENV_NAME: "dev" });
  assert.match(html, /Chosen elsewhere/); assert.match(html, /moondream3\.1/); assert.match(html, /gpt-6-luna/);
  assert.ok(!/<select|<button/.test(html.split('id="outside"')[1].split("</div>")[0]), "the section has no picker and no save");
});

await test("the Hindsight list is checked against the host's variables", () => {
  const host = HINDSIGHT_MODELS.flatMap((m) => Object.entries(m.env).map(([f, name]) => `${name}=${m[f]}`)).join("\n");
  assert.deepEqual(compareHindsightEnv(host), []);
  assert.equal(HINDSIGHT_ENV_NAMES.some((n) => /KEY|TOKEN|SECRET|PASSWORD|URL/.test(n)), false, "the check reads no secret");
  const changed = host.replace("HINDSIGHT_API_REFLECT_LLM_MODEL=deepseek/deepseek-v4.1-flash", "HINDSIGHT_API_REFLECT_LLM_MODEL=openai/gpt-oss-20b");
  assert.deepEqual(compareHindsightEnv(changed), [{ job: "reflect", variable: "HINDSIGHT_API_REFLECT_LLM_MODEL", expected: "deepseek/deepseek-v4.1-flash", actual: "openai/gpt-oss-20b" }]);
  assert.equal(compareHindsightEnv(host.split("\n").slice(1).join("\n")).length, 1, "a missing variable is a difference");
});

console.log(`PASS models cleanup: ${checks} checks`);
