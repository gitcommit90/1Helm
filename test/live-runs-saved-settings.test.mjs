// node --import ./test/stubs/register.mjs test/live-runs-saved-settings.test.mjs
// "Push to prod" copies dev's saved model settings to Live, so Live must run them exactly as dev does.
// Synthetic transport only: no paid calls and no judgement of model output.
import assert from "node:assert/strict";
import test from "node:test";
import { vision } from "../src/sidecar.js";
import { seedSettings } from "./helpers/seed-settings.mjs";

const GEMMA = "google/gemma-4-26b-a4b-it";
const orRecord = (id, kinds) => ({ id, name: id, source: "OR", kinds, eligible: true, reasons: [], efforts: ["default"], default_effort: "default", levels: ["unrestricted", "no_training", "zdr"], hosts: [], context_length: 262144, max_output: 8192, input_modalities: ["text", "image"], pricing: { prompt: 0.07, completion: 0.23 }, json: true, tool_choice: [] });
const pushed = () => { const s = seedSettings(); s.jobs.vision_files = { model: GEMMA, effort: null, fallbacks: [] }; s.catalog[GEMMA] = orRecord(GEMMA, ["vision"]); return s; };

test("a pushed OpenRouter picture model goes to OpenRouter on Live, not Workers AI", async () => {
  const s = pushed(), real = globalThis.fetch; let sent = null, aiRuns = 0;
  globalThis.fetch = async (_u, init) => { sent = JSON.parse(init.body); return Response.json({ model: sent.model, choices: [{ message: { content: JSON.stringify({ description: "d", text: "" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40, cost: 0.00002 } }); };
  const env = { ENV_NAME: "live", DYNAMIC_ROUTING: "on", OPENROUTER_API_KEY: "synthetic", MODEL_SETTINGS: s, PROMPT_CACHE: "off", AI: { run: async () => { aiRuns++; return {}; } },
    DB: { prepare() { return { bind() { return this; }, async first() { return { ai_privacy: "unrestricted" }; } }; } } };
  try { await vision(env, { tenant: "t" }, { mime: "image/png", data: new Uint8Array([1]) }, "picture"); } finally { globalThis.fetch = real; }
  assert.equal(aiRuns, 0); assert.equal(sent.model, GEMMA); assert.equal(sent.provider.zdr, true);
});
