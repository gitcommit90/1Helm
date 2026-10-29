// node --import ./test/stubs/register.mjs test/model-job-fields.test.mjs
// The saved per job fields max_output, sort and max_price and the Browser look job: validation, starting values that match what the code sent
// before, saved settings from before the fields (the Live Release 36 copy) still loading.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { JOBS, JOB_IDS, JOB_KINDS, jobDef, jobLimits, jobResults, jobMaxOutput, jobSort, jobMaxPrice, choreRouteOf } from "../src/ee/model-jobs.js";
import { jobFieldDefaults, optionalJobDefault, OPTIONAL_JOB_IDS, MOONDREAM } from "../src/ee/model-seed.js";
import { validateModelSettings, withoutProviderLists, readModelSettings } from "../src/ee/model-settings.js";
import { SEED, seedSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const rejects = (cfg, re) => assert.throws(() => validateModelSettings(cfg), re);
const withJob = (id, patch) => { const s = clone(SEED); Object.assign(s.jobs[id], patch); return s; };

const MEMORY_MAX = { notes: 6000, notes_final: 24000, notes_refine: 24000 };
await test("every job starts with an empty max output, so no limit is sent (Captain 2026-10-17), except the live notes jobs", () => {
  for (const id of JOB_IDS) assert.equal(jobMaxOutput(SEED, id), MEMORY_MAX[id] ?? null, id);
  for (const id of JOB_IDS) { assert.equal(jobSort(SEED, id), id === "vision_files" ? "throughput" : null, id); assert.equal(jobMaxPrice(SEED, id), null, id); }
  // no code constant is left: the job definitions carry neither a sort nor a max output, so the saved fields are the only source
  for (const d of JOBS) assert.ok(!("sort" in d) && !("maxOut" in d), `${d.id} has no sort or maxOut constant`);
  assert.equal(jobFieldDefaults("vision_files").max_output, null); assert.equal(jobFieldDefaults("vision_files").sort, "throughput");
  assert.deepEqual(Object.keys(jobFieldDefaults("label")).sort(), ["max_output", "max_price", "results", "sort", "timeout_ms"]);
  // the web search job counts results, not tokens: its own field, 5 by default
  assert.equal(jobResults(SEED, "web_search"), 5); assert.equal(jobFieldDefaults("web_search").results, 5); assert.equal(jobFieldDefaults("web_search").max_output, null);
  for (const id of JOB_IDS) if (id !== "web_search") assert.equal(jobResults(SEED, id), null, id);
});

await test("a saved value wins over the starting value, and a saved null is a real value", () => {
  const s = withJob("label", { max_output: 500, sort: "latency", max_price: { prompt: 1, completion: 2 } });
  assert.deepEqual(jobLimits(validateModelSettings(s), "label"), { max_output: 500, sort: "latency", max_price: { prompt: 1, completion: 2 }, timeout_ms: 30000 });
  const t = validateModelSettings(withJob("vision_files", { max_output: null, sort: null }));
  assert.equal(jobMaxOutput(t, "vision_files"), null); assert.equal(jobSort(t, "vision_files"), null);
  assert.equal(choreRouteOf(t, "vision_files").sort, undefined);
});

await test("the picture route: sort and max output come from the saved fields", () => {
  const r = choreRouteOf(SEED, "vision_files"); assert.equal(r.sort, "throughput"); assert.equal(r.maxOut, undefined);
  const s = validateModelSettings(withJob("vision_files", { max_output: 1234, sort: "price" })), q = choreRouteOf(s, "vision_files"); assert.equal(q.sort, "price"); assert.equal(q.maxOut, 1234);
  assert.equal(choreRouteOf(SEED, "label").sort, undefined); assert.equal(choreRouteOf(SEED, "label").maxOut, undefined);
});

await test("validation of max_output, sort and max_price", () => {
  for (const ok of [1, 30000, 1000000, null]) validateModelSettings(withJob("notes", { max_output: ok }));
  for (const bad of [0, -1, 1.5, "100", 1000001, {}]) rejects(withJob("notes", { max_output: bad }), /max output/);
  for (const ok of [1, 5, 10]) validateModelSettings(withJob("web_search", { results: ok }));
  for (const bad of [0, 11, 2.5, "5", null]) rejects(withJob("web_search", { results: bad }), /number of results/);
  rejects(withJob("notes", { results: 5 }), /only a web search job/);
  // saved before the field existed: the count sat in max_output and is read as results
  { const old = clone(SEED); old.jobs.web_search = { model: SEED.jobs.web_search.model, effort: null, fallbacks: [], max_output: 7 }; const v = validateModelSettings(old); assert.equal(jobResults(v, "web_search"), 7); assert.equal(jobMaxOutput(v, "web_search"), null); }
  rejects(withJob("stt", { max_output: 100 }), /no text/); validateModelSettings(withJob("stt", { max_output: null }));
  for (const ok of ["price", "throughput", "latency", null]) validateModelSettings(withJob("notes", { sort: ok }));
  for (const bad of ["fast", "", 3, true]) rejects(withJob("notes", { sort: bad }), /sort must be/);
  for (const ok of [null, { prompt: 0, completion: 0 }, { prompt: 0.5, completion: 15 }]) validateModelSettings(withJob("notes", { max_price: ok }));
  for (const bad of [{}, { prompt: 1 }, { prompt: 1, completion: -1 }, { prompt: 1, completion: "2" }, { prompt: 1, completion: 2, extra: 3 }, { prompt: 1, completion: 20000 }, [1, 2], 5]) rejects(withJob("notes", { max_price: bad }), /max price/);
  const f = clone(SEED); f.routing.categories[0].chains.zdr[1] = { ...f.routing.categories[0].chains.zdr[1], max_output: 10 }; rejects(f, /Invalid/);
  // a routing category carries the limits of its replies, checked like a job's
  const cat = (over) => { const c = clone(SEED); Object.assign(c.routing.categories[0], over); return c; };
  for (const ok of [{ max_output: 4000, sort: "latency", max_price: { prompt: 1, completion: 5 }, timeout_ms: 60000 }, { max_output: null, sort: null, max_price: null, timeout_ms: null }]) validateModelSettings(cat(ok));
  rejects(cat({ max_output: 0 }), /max output/); rejects(cat({ sort: "fast" }), /sort must be/); rejects(cat({ max_price: { prompt: 1 } }), /max price/); rejects(cat({ timeout_ms: 5 }), /timeout/);
});

await test("hosts and pin on an entry are refused", () => {
  rejects(withJob("label", { hosts: ["azure"], pin: true }), /provider lists/); rejects(withJob("label", { pin: false }), /provider lists/);
});

await test("the look job is Cloudflare only, with no fallback and no reasoning level", () => {
  const d = jobDef("look"); assert.equal(d.kind, "look"); assert.equal(JOB_KINDS.look.cloudflare, true); assert.equal(SEED.jobs.look.model, MOONDREAM); assert.equal(SEED.jobs.look.fallbacks.length, 0);
  assert.equal(jobMaxOutput(SEED, "look"), null);
  const s = clone(SEED); s.jobs.look = { model: "meta/muse-spark-1.3", effort: null, fallbacks: [] }; rejects(s, /look|choose|can't be used|only on Cloudflare/i);
  const t = clone(SEED); t.jobs.look.fallbacks = [{ model: MOONDREAM, effort: null }]; rejects(t, /fallback/);
});

await test("Moondream's price is in its facts, and an older saved copy reads it too", () => {
  assert.deepEqual(optionalJobDefault("look").facts.pricing, { prompt: 0.3, completion: 1 });
  const s = clone(SEED); delete s.catalog[MOONDREAM].pricing; assert.deepEqual(validateModelSettings(s).catalog[MOONDREAM].pricing, { prompt: 0.3, completion: 1 });
  const bad = clone(SEED); bad.catalog[MOONDREAM].pricing = { prompt: -1, completion: 1 }; assert.throws(() => validateModelSettings(bad), /metadata/);
});

console.log(`model-job-fields: ${n} checks passed`);
