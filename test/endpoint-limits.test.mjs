// node --import ./test/stubs/register.mjs test/endpoint-limits.test.mjs
// A model's max output is the largest limit among its usable endpoints (OpenRouter sends the request to one that can take it), each endpoint's own limit is
// kept as a display fact, and the Models page warns about a saved number only when no allowed endpoint can take it (Captain 2026-10-17).
// The numbers are google/gemma-4-26b-a4b-it as OpenRouter lists it: top_provider 235,929, two small endpoints (Venice 8,192 and DeepInfra 16,384), eleven at 128k or more.
import test from "node:test";
import assert from "node:assert/strict";
import { assessModelCatalog, validCatalogRecord, withEndpointLimits, resetEndpointLimitCache } from "../src/ee/model-catalog.js";
import { jobView, limitNote } from "../src/ee/model-dashboard.js";
import { jobDef, JOB_KINDS } from "../src/ee/model-jobs.js";
import { SEED } from "./helpers/seed-settings.mjs";

const GEMMA = "google/gemma-4-26b-a4b-it";
const clone = (x) => JSON.parse(JSON.stringify(x));
const ep = (tag, max) => ({ model_id: GEMMA, tag, status: 0, context_length: 262144, max_completion_tokens: max, pricing: { prompt: "0.00000015", completion: "0.0000006" },
  supported_parameters: ["tools", "max_tokens", "reasoning", "response_format"], supports_tool_choice: { auto: true, none: true, required: true, function: true } });
const ENDPOINTS = [ep("venice/fp8", 8192), ep("deepinfra/fp8", 16384), ...["google-vertex", "novita", "together", "fireworks", "parasail", "nebius", "gmicloud", "akashml", "makora", "atlas-cloud", "friendli"].map((t, i) => ep(t, i < 9 ? 131072 : 235929))];
const MODEL = { id: GEMMA, name: "Gemma 4 26B A4B", context_length: 262144, top_provider: { max_completion_tokens: 235929 }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, reasoning: null,
  pricing: { prompt: "0.00000015", completion: "0.0000006" }, supported_parameters: ["tools", "max_tokens", "response_format"] };

test("the catalog keeps the largest endpoint limit as max_output and every endpoint's own limit as a display fact", () => {
  const [rec] = assessModelCatalog([MODEL], ENDPOINTS, { checked: new Set([GEMMA]) });
  assert.equal(ENDPOINTS.length, 13);
  assert.equal(rec.max_output, 235929, "not Venice's 8,192");
  assert.ok(rec.endpoint_limits.length >= 2 && rec.endpoint_limits.every((e) => e.host && e.max_output > 0 && Array.isArray(e.levels)));
  assert.equal(rec.endpoint_limits.find((e) => e.host === "venice/fp8")?.max_output, 8192);
  assert.equal(Math.max(...rec.endpoint_limits.map((e) => e.max_output)), rec.max_output);
  if (rec.eligible) assert.ok(validCatalogRecord(rec, GEMMA), "the record with its endpoint list is still a valid saved record");
  assert.ok(!validCatalogRecord({ ...rec, endpoint_limits: [{ host: "x", max_output: -1, levels: [] }] }, GEMMA), "a bad endpoint list is refused");
});

const settingsWith = (limits, saved, job = "label") => {
  const s = clone(SEED), model = s.jobs[job].model;
  s.catalog[model] = { ...(s.catalog[model] || { id: model, name: "Gemma 4 26B A4B" }), id: model, name: "Gemma 4 26B A4B", source: "OR", max_output: Math.max(...limits.map((l) => l.max_output)), context_length: 262144, endpoint_limits: limits };
  s.jobs[job].max_output = saved; s.jobs[job].fallbacks = []; return { s, model };
};
const LIMITS = [{ host: "venice/fp8", max_output: 8192, levels: ["unrestricted", "no_training", "zdr"] }, { host: "deepinfra/fp8", max_output: 16384, levels: ["unrestricted", "zdr"] },
  { host: "novita", max_output: 131072, levels: ["unrestricted", "no_training", "zdr"] }, { host: "google-vertex", max_output: 235929, levels: ["unrestricted", "no_training", "zdr"] }];

test("the page names the providers that can't serve a saved number, and warns only when none can", () => {
  const { s } = settingsWith(LIMITS, 30000), v = jobView(s, jobDef("label"));
  assert.equal(v.limit_note.level, "info"); assert.equal(v.limit_note.text, "Venice and Deepinfra can't serve 30,000. OpenRouter uses the others.");
  assert.doesNotMatch(v.limit_note.text, /above the published limit/);
  assert.equal(limitNote(...[settingsWith(LIMITS, 8000).s, [{ model: settingsWith(LIMITS, 8000).s.jobs.label.model }], 8000, JOB_KINDS.chore]), null, "every provider takes 8,000: no note");
  assert.equal(jobView(settingsWith(LIMITS, null).s, jobDef("label")).limit_note, null, "an empty value has nothing to judge");
  const none = settingsWith(LIMITS, 300000).s, w = jobView(none, jobDef("label")).limit_note;
  assert.equal(w.level, "warn"); assert.match(w.text, /above what every provider of Gemma 4 26B A4B can serve \(the most is 235,929\)/);
});

test("only the endpoints the job may use count: a zero-data-retention job ignores an endpoint that keeps data", () => {
  const limits = [{ host: "keeper", max_output: 4000, levels: ["unrestricted"] }, { host: "novita", max_output: 9000, levels: ["unrestricted", "no_training", "zdr"] }];
  const { s } = settingsWith(limits, 20000);   // label is a zero-data-retention job: only novita counts, and it can't take 20,000
  assert.equal(jobView(s, jobDef("label")).limit_note.level, "warn");
  const { s: s2 } = settingsWith(limits, 5000);
  assert.equal(jobView(s2, jobDef("label")).limit_note, null, "novita takes 5,000, and the data-keeping endpoint is not allowed here");
});

test("a saved record from before the endpoint list is completed from the live catalog for the page, and nothing is saved", async () => {
  resetEndpointLimitCache();
  const { s, model } = settingsWith(LIMITS, 30000);
  const old = clone(s); delete old.catalog[model].endpoint_limits; old.catalog[model].max_output = 8192; old.catalog[model].eligible = true; old.catalog[model].kinds = ["chat", "chore", "vision"];
  const asked = [];
  const out = await withEndpointLimits(old, { lookup: async (id) => { asked.push(id); return { endpoint_limits: LIMITS, max_output: 235929 }; } });
  assert.ok(asked.includes(model)); assert.equal(out.catalog[model].max_output, 235929); assert.deepEqual(out.catalog[model].endpoint_limits, LIMITS);
  assert.equal(old.catalog[model].max_output, 8192, "the saved copy is untouched");
  assert.equal(jobView(out, jobDef("label")).limit_note.level, "info");
  const again = await withEndpointLimits(old, { lookup: async () => { throw new Error("asked twice"); } });
  assert.deepEqual(again.catalog[model].endpoint_limits, LIMITS, "a second page view within 30 minutes asks nothing");
  resetEndpointLimitCache();
  const failed = await withEndpointLimits(old, { lookup: async () => { throw new Error("offline"); } });
  assert.equal(failed.catalog[model].max_output, 8192, "a failed lookup leaves the record as it was, and the page shows no note");
});

test("no runtime path uses the catalog's max_output to lower a saved value", async () => {
  const { plan } = await import("../src/ee/model-plan.js");
  const { s, model } = settingsWith([{ host: "venice/fp8", max_output: 8192, levels: ["zdr"] }, { host: "novita", max_output: 131072, levels: ["zdr"] }], 30000);
  assert.equal(plan(s, "label", { level: "zdr" }).steps[0].maxOutput, 30000, "30,000 goes out as saved although one endpoint takes 8,192");
  s.catalog[model].context_length = 20000;
  assert.equal(plan(s, "label", { level: "zdr" }).steps[0].maxOutput, 19999, "the one guard: below the context window");
});
