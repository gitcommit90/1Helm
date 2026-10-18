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
import { HINDSIGHT_LOCAL, HINDSIGHT_ENV_NAMES, compareHindsightEnv } from "../src/ee/hindsight-models.js";
import { consoleState, consoleHtml } from "../src/ee/models-console.js";
import { pageHtml } from "../app-assets/app-static/models-console-core.js";
import { WAI_NANO_PER_MIN } from "../src/transcribe.js";
import { ID, SEED, EXTRA_FACTS, withExtraModels } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
let checks = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const RETIRED = ["memory_summary", "upkeep_write", "upkeep_verify", "people_write", "people_verify", "reflect_write", "reflect_verify", "memory_supersede", "embed_memory"];

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("./fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
  const DB = { withSession() { return this; }, prepare(q) { const s = sql.prepare(q); let a = []; const o = { bind(...v) { a = v; return o; }, first: async () => s.get(...a) || null,
    all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) }; return o; } };
  return { sql, DB };
}
await test("the nine retired jobs are not in the registry, and only the memory server's jobs mention memory", () => {
  for (const id of RETIRED) assert.ok(!JOB_IDS.includes(id), id); assert.equal(JOBS.length, 24);
  assert.deepEqual(JOBS.filter((j) => /memory/i.test(`${j.label} ${j.description}`)).map((j) => j.id), ["hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh", "hs_rerank"], "only the Hindsight jobs describe memory work");
  const seed = seedFresh({}); for (const id of RETIRED) assert.ok(!(id in seed.jobs), `${id} is not seeded`);
});

await test("tolerant read: a saved version with retired or unknown jobs reads as the current jobs, and the strip version drops them once", async () => {
  const { sql, DB } = database(), env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" };
  const first = await readModelSettings(env); assert.equal(first.revision, 1); assert.equal(first.retired, undefined);
  const raw = clone(first.config); for (const id of RETIRED) raw.jobs[id] = clone(raw.jobs.handoff); raw.jobs.some_future_job = clone(raw.jobs.handoff);
  sql.prepare("INSERT INTO model_job_settings_versions VALUES(?,?,?,?,?,?)").run("dev", 2, JSON.stringify(raw), 1, "fixture", "save");
  const r = await readModelSettings(env);
  assert.equal(r.revision, 3, "one strip version was written by the read"); assert.deepEqual(Object.keys(r.config.jobs).sort(), [...JOB_IDS].sort());
  assert.equal(sql.prepare("SELECT action FROM model_job_settings_versions WHERE revision=3").get().action, "strip-provider-lists");
  assert.ok(!Object.keys(JSON.parse(sql.prepare("SELECT config FROM model_job_settings_versions WHERE revision=3").get().config).jobs).some((id) => !JOB_IDS.includes(id)), "no retired job is stored in the new version");
  assert.equal((await readModelSettings(env)).revision, 3, "reading again writes nothing");
  assert.ok(!sql.prepare("SELECT action FROM model_job_settings_versions").all().some((x) => /add-jobs/.test(x.action)), "retired jobs are not 'missing jobs' to fill in");
  // the strict validator itself still refuses extra jobs, and a missing current job is still repaired the old way
  assert.throws(() => validateModelSettings(raw), (e) => e.status === 400); assert.deepEqual(withoutRetiredJobs(raw).jobs.handoff, raw.jobs.handoff);
  // a save through the page writes a clean version
  const view = await saveModelSettings(env, { revision: 3, config: { version: 3, jobs: r.config.jobs, routing: r.config.routing } }, "admin"); assert.equal(view.revision, 4);
  assert.ok(!Object.keys(JSON.parse(sql.prepare("SELECT config FROM model_job_settings_versions WHERE revision=4").get().config).jobs).some((id) => RETIRED.includes(id)));
});

await test("descriptions: speech jobs, group name, page lead, router jobs", async () => {
  const d = (id) => jobDef(id).description;
  assert.match(d("stt"), /\/api\/transcribe/); assert.match(d("stt"), /Live notes/); assert.match(d("stt"), /AssemblyAI goes first for WAV/); assert.match(d("stt"), /Qwen3 ASR and then Whisper/);
  assert.match(d("live_dictation"), /AssemblyAI/); assert.match(d("live_dictation"), /WAV chunks cut at pauses/); assert.match(d("live_dictation"), /Deepgram Nova 3 on Cloudflare streams is the fallback/);
  assert.match(d("stt_cloudflare"), /only for the Speech to text job/); assert.match(d("stt_cloudflare"), /under 20 MB/);
  assert.equal(GROUPS.find((g) => g.id === "search").title, "Search and pictures");
  for (const gone of ["classic_decider", "classic_router", "doors_shadow"]) assert.equal(jobDef(gone), null, `${gone} is not a job`);
  assert.equal(jobDef("workers_ai_chat").label, "Backup chat"); assert.match(d("workers_ai_chat"), /OpenRouter can't be reached/);
  for (const j of JOBS) assert.doesNotMatch(j.label + j.description, /OWN_ROUTER|ROUTER_MODE/, j.id);
  const { DB } = database(), state = await consoleState(await modelSettingsView({ ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" }), { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" }), html = consoleHtml(state);
  assert.doesNotMatch(html, /only place models are chosen/); assert.match(html, /data-view="readonly"/);
});

await test("model facts match the live data read on 2026-10-15", () => {
  assert.equal(SEED_FACTS["@cf/cloudflare/clef-flash"].in_nano, 38, "$0.038 per million input tokens on Cloudflare");
  assert.deepEqual(SEED_FACTS[ID.GLM].efforts, ["low", "high", "max"]); assert.equal(SEED_FACTS[ID.GLM].quirks.reasoning_mandatory, true);
  assert.deepEqual(effortBody("none", ID.GLM, { catalog: { [ID.GLM]: { id: ID.GLM, ...SEED_FACTS[ID.GLM] } } }), { reasoning: { effort: "low" } }, "reasoning can't be turned off for GLM 5.3 Flash, so none is sent as low");
  const c = clone(SEED); c.catalog[ID.GLM] = { id: ID.GLM, ...clone(SEED_FACTS[ID.GLM]) }; c.jobs.notes_refine.fallbacks = [{ model: ID.GLM, effort: "none" }];
  assert.throws(() => validateModelSettings(c), /doesn't support reasoning level none/);
  assert.deepEqual(EXTRA_FACTS[ID.QWEN].efforts, ["xhigh", "medium", "low", "none"]);
  assert.equal(WAI_NANO_PER_MIN, Math.round(46.63 * 0.011 / 1000 * 1e6) * 1000, "46.63 neurons at $0.011 per 1,000 neurons is $0.000513 a minute; the pricing page rounds it to $0.0005");
});

await test("the catalog keeps only models a job or a category uses; Sol, Qwen 3.8, gpt-oss-20b and Jev are gone from the first-run data", () => {
  const seed = validateModelSettings(seedFresh({})), used = new Set([...Object.values(seed.jobs).flatMap((j) => entriesOf(j).map((e) => e.model)), ...seed.routing.categories.flatMap((c) => Object.values(c.chains).flat().map((e) => e.model))]);
  assert.deepEqual(Object.keys(seed.catalog).sort(), [...used].sort());
  for (const id of ["openai/gpt-6.1-sol", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "~typesafe/jev-latest"]) { assert.ok(!(id in seed.catalog), id); assert.ok(!(id in SEED_FACTS), id); }
  const withExtra = withExtraModels(seed); assert.ok(Object.keys(withExtra.catalog).length > Object.keys(seed.catalog).length);
  assert.deepEqual(Object.keys(pruneCatalog(withExtra).catalog).sort(), Object.keys(seed.catalog).sort());
});

await test("a save that leaves a model unused drops it from the catalog, and the picker still offers it", async () => {
  const { DB } = database(), env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" }, v0 = await modelSettingsView(env);
  assert.ok(v0.config.catalog[ID.STT_FALLBACK]);
  const jobs = clone(v0.config.jobs); jobs.stt.fallbacks = jobs.stt.fallbacks.filter((f) => f.model !== ID.STT_FALLBACK);
  const v1 = await saveModelSettings(env, { revision: v0.revision, config: { version: 3, jobs, routing: v0.config.routing } }, "admin");
  assert.ok(!(ID.STT_FALLBACK in v1.config.catalog), "no job uses it, so it left the catalog");
  assert.ok(v1.options.choices.speech.some((m) => m.id === ID.STT_FALLBACK), "the picker still lists it, from the known facts");
  const jobs2 = clone(v1.config.jobs); jobs2.stt.fallbacks.push({ model: ID.STT_FALLBACK, effort: null });
  const v2 = await saveModelSettings(env, { revision: v1.revision, config: { version: 3, jobs: jobs2, routing: v1.config.routing } }, "admin");
  assert.deepEqual(v2.config.catalog[ID.STT_FALLBACK], { id: ID.STT_FALLBACK, ...SEED_FACTS[ID.STT_FALLBACK] }, "added again with its known facts");
});

await test("calls chosen elsewhere are listed read only on the page: OCR, web search, page reading, the memory server's local embeddings (the memory models are saved jobs)", async () => {
  const out = outsideModels({ ENV_NAME: "dev" }), by = Object.fromEntries(out.map((g) => [g.id, g]));
  assert.deepEqual(out.map((g) => g.id), ["ocr", "web_search", "browser_run", "hindsight"]);
  assert.equal(by.ocr.items[0].model, "no hosted model"); assert.match(by.browser_run.items[0].detail, /Browser Run/);
  assert.deepEqual(by.hindsight.items.map((i) => i.model), HINDSIGHT_LOCAL.map((m) => m.model)); assert.deepEqual(by.hindsight.items.map((i) => i.model), ["BAAI/bge-small-en-v1.5"]); assert.match(by.hindsight.note, /Memory jobs/);
  const { DB } = database(), view = await modelSettingsView({ ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" });
  const state = await consoleState(view, { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev" }), ui = { view: "readonly", q: "", sel: null, level: "unrestricted", env: "dev", live: null };
  const html = pageHtml(state, ui, Date.now()).toString(), json = consoleHtml(state);
  assert.match(html, /Read only/); assert.match(json, /moondream3\.1/); assert.match(html, /bge-small-en-v1\.5/); assert.match(html, /Cloudflare Browser Run/);
  // the memory models are ordinary saved jobs in their own group, so they are on the page with pickers
  assert.ok(GROUPS.some((g) => g.id === "memory")); for (const id of ["hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh", "hs_rerank"]) assert.ok(state.jobs.some((j) => j.id === id && j.group === "memory"), id);
  assert.match(json, /~openai\/gpt-luna-latest/); assert.match(json, /~perplexity\/pplx-decider-latest/);
  assert.ok(!/<select|<input/.test(html.split('class="ro"')[1]), "the section has no picker and no save");
});

await test("the Hindsight environment check covers the embeddings and the two bank id switches, and reads no secret", () => {
  const good = (over = {}) => ["HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-en-v1.5", "HINDSIGHT_API_LLM_SEND_BANK_AS_USER=true", "HINDSIGHT_API_RERANKER_SEND_BANK_AS_HEADER=true"]
    .filter((l) => !(l.split("=")[0] in over)).concat(Object.entries(over).map(([k, v]) => `${k}=${v}`)).join("\n");
  assert.deepEqual(compareHindsightEnv(good()), []);
  assert.equal(HINDSIGHT_ENV_NAMES.some((n) => /KEY|TOKEN|SECRET|PASSWORD|URL/.test(n)), false, "the check names no secret and no URL");
  assert.deepEqual(compareHindsightEnv(good({ HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL: "other" })), [{ job: "embeddings", variable: "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL", expected: "BAAI/bge-small-en-v1.5", actual: "other" }]);
  assert.deepEqual(compareHindsightEnv(good({ HINDSIGHT_API_LLM_SEND_BANK_AS_USER: "false" })).map((d) => d.variable), ["HINDSIGHT_API_LLM_SEND_BANK_AS_USER"], "the bank id switch");
  assert.equal(compareHindsightEnv(good().split("\n").slice(1).join("\n")).length, 1, "a missing variable is a difference");
});

console.log(`PASS models cleanup: ${checks} checks`);
