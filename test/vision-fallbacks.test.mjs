// node --import ./test/stubs/register.mjs test/vision-fallbacks.test.mjs
// Picture descriptions (job vision_files) may list up to 3 fallback models, and the dispatcher runs them.
// Synthetic transport only: no paid calls and no judgement of model output.
import assert from "node:assert/strict";
import test from "node:test";
import { vision, visionReserve } from "../src/sidecar.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { seedSettings } from "./helpers/seed-settings.mjs";

const MAIN = "google/gemma-4-26b-a4b-it", FB = ["vendor/vision-a", "vendor/vision-b", "vendor/vision-c", "vendor/vision-d"];
const rec = (id, pricing = { prompt: 0.1, completion: 0.3 }) => ({ id, name: id, source: "OR", kinds: ["vision"], eligible: true, reasons: [], efforts: ["default"], default_effort: "default", levels: ["unrestricted", "no_training", "zdr"], hosts: ["nextbit/bf16", "venice/bf16"], context_length: 262144, max_output: 8192, input_modalities: ["text", "image"], pricing, json: true, tool_choice: [] });
const withFallbacks = (n) => {
  const s = seedSettings(); s.catalog[MAIN] = rec(MAIN); for (const id of FB) s.catalog[id] = rec(id);
  s.jobs.vision_files = { model: MAIN, effort: null, fallbacks: FB.slice(0, n).map((model) => ({ model, effort: null })) };
  return s;
};
const envFor = (settings) => ({ ENV_NAME: "dev", DYNAMIC_ROUTING: "on", OPENROUTER_API_KEY: "synthetic", MODEL_SETTINGS: settings, PROMPT_CACHE: "off",
  DB: { prepare() { return { bind() { return this; }, async first() { return { ai_privacy: "unrestricted" }; } }; } } });

test("a picture description setting saves with 1 to 3 fallbacks and refuses a 4th", () => {
  for (const n of [1, 2, 3]) assert.doesNotThrow(() => validateModelSettings(withFallbacks(n)), `${n} fallback(s)`);
  assert.throws(() => validateModelSettings(withFallbacks(4)), /at most 3 fallback/);
});

test("when the main picture model fails, the first fallback describes the picture", async () => {
  const s = validateModelSettings(withFallbacks(2)), real = globalThis.fetch, sent = [];
  globalThis.fetch = async (_u, init) => {
    const b = JSON.parse(init.body); sent.push(b);
    if (b.model === MAIN) return Response.json({ error: "busy" }, { status: 503 });
    return Response.json({ model: b.model, choices: [{ message: { content: JSON.stringify({ description: "d", text: "" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 50, cost: 0.00002 } });
  };
  let r; try { r = await vision(envFor(s), { tenant: "t" }, { mime: "image/png", data: new Uint8Array([1]) }, "picture"); } finally { globalThis.fetch = real; }
  assert.deepEqual(sent.map((b) => b.model), [MAIN, FB[0]], "the main model first, then the first fallback only");
  assert.ok(sent.every((b) => b.provider.zdr === true), "every step asks for zero-data-retention endpoints");
  assert.equal(r.value.description, "d");
  assert.ok(r.nano >= 20000, "charged from the answering model's reported cost (20000 nano dollars) plus markup");
});

test("the reservation covers the dearest model of the job, not only the main one", async () => {
  const base = withFallbacks(0), dear = withFallbacks(1); dear.catalog[FB[0]] = rec(FB[0], { prompt: 5, completion: 20 });
  assert.ok(await visionReserve(envFor(validateModelSettings(dear))) > await visionReserve(envFor(validateModelSettings(base))));
});
