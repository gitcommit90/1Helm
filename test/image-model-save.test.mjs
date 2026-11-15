// node --import ./test/stubs/register.mjs test/image-model-save.test.mjs
// Saving a model that outputs both text and pictures (e.g. google/gemini-3.1-flash-lite-image) for the image job. The catalog lists it twice
// (a chat record and an image record), and the save must judge it by the record of the job's own kind. No real OpenRouter call is made.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { saveModelSettings, readModelSettings } from "../src/ee/model-settings.js";
import { ID } from "./helpers/seed-settings.mjs";

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
sql.exec(readFileSync(new URL("../db/migrations/0050_model_job_settings.sql", import.meta.url), "utf8"));
sql.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,ai_privacy TEXT); INSERT INTO tenants VALUES('t','zdr')");
const DB = { withSession() { return this; }, prepare(q) { const stmt = sql.prepare(q); let values = [];
  const self = { bind(...v) { values = v; return self; }, first: async () => stmt.get(...values) || null, all: async () => ({ results: stmt.all(...values) }), run: async () => ({ meta: { changes: Number(stmt.run(...values).changes) } }) }; return self; } };
const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", ROUTER_MODE: "two", DYNAMIC_ROUTING: "on", OPENROUTER_API_KEY: "unit-key", PROMPT_CACHE: "off" };
const IMG = "example/pixel-flash-image";
const row = { id: IMG, name: "Pixel Flash Image", context_length: 16384, architecture: { input_modalities: ["text", "image"], output_modalities: ["text", "image"] }, pricing: { prompt: "0.000001", completion: "0.000002" } };
// The only endpoint has no tools, no reasoning and no published token limits, so the chat rules reject it.
const endpoint = { model_id: IMG, tag: "safe-host/fp16", status: 0, context_length: 16384, pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["max_tokens"] };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(String(url)); assert.equal(u.hostname, "openrouter.ai");
  if (u.pathname === "/api/v1/models") return Response.json({ data: [row] });
  if (u.pathname === "/api/v1/endpoints/zdr") return Response.json({ data: [endpoint] });
  if (u.pathname === "/api/v1/embeddings/models") return Response.json({ data: [] });
  if (u.pathname === "/api/v1/images/models") return Response.json({ data: [row] });
  if (u.pathname.includes("/endpoints")) return Response.json({ data: { endpoints: [endpoint] } });
  assert.fail(`Unexpected URL ${url}`);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
try {
  const first = await readModelSettings(env); let revision = first.revision;
  const tryJob = async (job) => { const c = clone((await readModelSettings(env)).config); c.jobs[job] = { model: IMG, effort: null, fallbacks: [] }; return saveModelSettings(env, { revision, config: c }, "admin@example.com"); };
  // A chat-kind job still judges the model by its chat record and rejects it.
  await assert.rejects(() => tryJob("handoff"), (e) => /No compatible endpoint with tools/.test(e.message));
  // The image job judges the same model by its image record and saves it.
  const view = await tryJob("image_gen"); revision = view.revision;
  const saved = (await readModelSettings(env)).config;
  assert.equal(saved.jobs.image_gen.model, IMG); assert.deepEqual(saved.catalog[IMG].kinds, ["image"]);
  console.log("PASS image-model-save");
} finally { globalThis.fetch = originalFetch; }
