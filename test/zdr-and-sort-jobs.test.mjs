// node --import ./test/stubs/register.mjs test/zdr-and-sort-jobs.test.mjs
// Every job that can run on OpenRouter asks for zero-data-retention endpoints, and the picture job asks for the fastest one.
// Synthetic transport only: no paid calls and no judgement of model output.
import assert from "node:assert/strict";
import test from "node:test";
import { JOBS, JOB_KINDS, jobRoute, choreRouteOf, zdrApplies, zdrBlocked } from "../src/ee/model-jobs.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { modelDashboard } from "../src/ee/model-dashboard.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { seedSettings } from "./helpers/seed-settings.mjs";

const GEMMA = "google/gemma-4-26b-a4b-it";
const orRecord = (id, kinds, levels = ["unrestricted", "no_training", "zdr"]) => ({ id, name: id, source: "OR", kinds, eligible: true, reasons: [], efforts: ["default"], default_effort: "default", levels, hosts: ["nextbit/bf16", "venice/bf16"], context_length: 262144, max_output: 8192, input_modalities: ["text", "image"], pricing: { prompt: 0.1, completion: 0.3 }, json: true, tool_choice: [] });
const withGemma = () => { const s = seedSettings(); s.jobs.vision_files = { model: GEMMA, effort: null, fallbacks: [] }; s.catalog[GEMMA] = orRecord(GEMMA, ["vision"]); return validateModelSettings(s); };
const envFor = (settings) => ({ ENV_NAME: "dev", DYNAMIC_ROUTING: "on", OPENROUTER_API_KEY: "synthetic", MODEL_SETTINGS: settings, PROMPT_CACHE: "off", DB: { prepare() { return { bind() { return this; }, async first() { return { ai_privacy: "unrestricted" }; } }; } } });
const sendFor = async (settings, jobId, kind, max_tokens = 100) => {
  let sent = null; const real = globalThis.fetch;
  globalThis.fetch = async (_u, init) => { sent = JSON.parse(init.body); return Response.json({ model: sent.model, choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { cost: 0 } }); };
  try { await openRouterChat(envFor(settings), { messages: [{ role: "user", content: "hi" }], max_tokens }, null, jobRoute(jobId), { tenant: "t", kind }); } finally { globalThis.fetch = real; }
  return sent;
};

test("only chat and Cloudflare-only kinds may leave zdr off", () => {
  // chat and recovery follow the account's privacy setting instead. The others run only on Cloudflare (no OpenRouter request exists).
  const exempt = new Set(["chat", "recovery", "speech_cloudflare", "speech_live", "workers_ai", "look", "search", "embedding_memory"]);
  for (const [name, kind] of Object.entries(JOB_KINDS)) assert.equal(!!kind.zdr, !exempt.has(name), `job kind ${name}: zdr is ${!!kind.zdr}`);
  for (const kind of ["vision", "embedding_files"]) assert.equal(JOB_KINDS[kind].zdr, true, kind);
});

test("every zero-data-retention job sends provider.zdr true to OpenRouter", async () => {
  const settings = withGemma();
  for (const def of JOBS.filter((j) => JOB_KINDS[j.kind].zdr && ["chore", "decider", "classic", "vision"].includes(j.kind))) {
    const s = structuredClone(settings), model = s.jobs[def.id].model;
    if (model.startsWith("@cf/")) continue;   // a Cloudflare model never makes an OpenRouter request
    const sent = await sendFor(s, def.id, def.id === "vision_files" ? "sidecar-vision-picture" : "chat");
    assert.ok(sent, `${def.id}: a request was sent`);
    assert.equal(sent.provider.zdr, true, `${def.id}: provider.zdr`);
  }
});

test("picture descriptions sort by throughput among zero-data-retention endpoints and send no host order", async () => {
  const sent = await sendFor(withGemma(), "vision_files", "sidecar-vision-picture");
  assert.equal(sent.model, GEMMA);
  assert.equal(sent.provider.zdr, true);
  assert.equal(sent.provider.sort, "throughput");
  assert.equal(sent.provider.allow_fallbacks, true);
  assert.equal(sent.provider.data_collection, "deny");
  assert.ok(!("order" in sent.provider) && !("only" in sent.provider), "an order would make OpenRouter ignore the sort");
  assert.equal(choreRouteOf(withGemma(), "vision_files").sort, "throughput");
  // Other background jobs keep their own routing.
  assert.equal(choreRouteOf(withGemma(), "label").sort, undefined);
});

test("the Models page shows pictures and the ambient index as zero-data-retention jobs", () => {
  const settings = withGemma(), page = modelDashboard({ config: settings, hidden: [] });
  for (const id of ["vision_files", "embed_files"]) assert.equal(page.jobs.find((j) => j.id === id).privacy, "zdr", id);
  assert.equal(page.jobs.find((j) => j.id === "vision_files").saved.sort, "throughput");
});

test("the picker rejects a picture or ambient index model with no zero-data-retention endpoint", () => {
  const noZdr = orRecord("example/vision-no-zdr", ["vision", "embedding_files"], ["unrestricted", "no_training"]);
  const settings = withGemma(); settings.catalog[noZdr.id] = noZdr;
  for (const kind of ["vision", "embedding_files"]) { assert.equal(zdrApplies(JOB_KINDS[kind], noZdr), true, kind); assert.equal(zdrBlocked(settings, noZdr.id), true, kind); }
  assert.equal(zdrBlocked(settings, GEMMA), false);
  const bad = structuredClone(settings); bad.jobs.vision_files.model = noZdr.id;
  assert.throws(() => validateModelSettings(bad), /zero-data-retention/);
});

test("pictures and video name no output limit and no model, and their reservation follows the saved max output and the model's catalog price", async () => {
  const { visionReserve, videoReserve, VISION_INPUT_TOKENS, MARKUP } = await import("../src/sidecar.js");
  assert.equal((await import("../src/ee/model-jobs.js")).VISION_MAX_OUT, undefined, "no code constant: the saved max output is the source");
  // The reservation covers the most one call can cost: the input, plus the saved max_output at the model's saved price, plus the markup.
  const settings = withGemma(), env = { MODEL_SETTINGS: settings }, price = settings.catalog[GEMMA].pricing;
  settings.jobs.vision_files.max_output = 5000;
  const out = (await import("../src/ee/model-plan.js")).plan(settings, "vision_files", { level: "unrestricted" }).steps[0].maxOutput;
  assert.ok(out > 0 && out <= 5000);
  assert.equal(await visionReserve(env), Math.ceil(Math.ceil(VISION_INPUT_TOKENS * price.prompt * 1000 + out * price.completion * 1000) * MARKUP));
  assert.equal(await videoReserve(env), await visionReserve(env));
  // A bigger saved limit reserves more.
  const bigger = structuredClone(settings); bigger.jobs.vision_files.max_output = 8192;
  assert.ok(await visionReserve({ MODEL_SETTINGS: bigger }) > await visionReserve(env));
  // The source has no output limit, model or provider literal on the picture, video or card paths.
  const { readFileSync } = await import("node:fs"), src = readFileSync(new URL("../src/sidecar.js", import.meta.url), "utf8");
  assert.ok(!/max_tokens\s*:/.test(src) || /task: "query"/.test(src), "only the browser look's own call may carry max_tokens until the look adapter lands");
  assert.ok(!/VISION_MAX_OUT|enable_thinking|testModelFor|dynamicProvidersOn|\.AI\.run\(model, body/.test(src));
});
