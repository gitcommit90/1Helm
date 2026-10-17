// node --import ./test/stubs/register.mjs test/models-stale.test.mjs
// A model OpenRouter no longer lists is never offered by search, is refused when saved, and is flagged on its card (fetch mocked).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { modelCatalog, taskModelCatalog, validModelId, isLatestAlias } from "../src/ee/model-catalog.js";
import { saveModelSettings, restoreModelSettings, modelSettingsView, readModelSettings, unlistedModels } from "../src/ee/model-settings.js";
import { ID, SEED } from "./helpers/seed-settings.mjs";
const SOL = ID.SOL, MUSE_C = ID.MUSE_C, MUSE_S = ID.MUSE_S;

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../db/migrations/0050_model_job_settings.sql", import.meta.url), "utf8"));
sql.exec(readFileSync(new URL("./fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
sql.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,ai_privacy TEXT); INSERT INTO tenants VALUES('t','zdr')");
const DB = { withSession(mode) { assert.equal(mode, "first-primary"); return this; }, prepare(q) { const stmt = sql.prepare(q); let values = [];
  const self = { bind(...v) { values = v; return self; }, first: async () => stmt.get(...values) || null, all: async () => ({ results: stmt.all(...values) }), run: async () => ({ meta: { changes: Number(stmt.run(...values).changes) } }) }; return self; } };
const env = { DB, ONEHELM_EE: "1hc", ENV_NAME: "dev", ROUTER_MODE: "two", OPENROUTER_API_KEY: "never-forward-to-catalog", PROMPT_CACHE: "off" };
const model = (id, extra = {}) => ({ id, name: `Name ${id}`, context_length: 16384, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: { mandatory: false, supported_efforts: ["low", "high"], default_effort: "low" }, pricing: { prompt: "0.000001", completion: "0.000002" }, ...extra });
const endpoint = (model_id, extra = {}) => ({ model_id, tag: "safe-host/fp16", status: 0, context_length: 16384, max_completion_tokens: 4096,
  pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools", "max_tokens", "reasoning", "reasoning_effort", "response_format"], supports_tool_choice: { auto: true, none: true, required: true, function: true }, ...extra });
import { readFileSync as readText } from "node:fs";
import { unlistedIds } from "../src/ee/model-catalog.js";
const A = "example/gone-a", B = "example/keep-b", C = "example/gone-c";
let list = [model(A), model(B), model(C)], zdr = [endpoint(A), endpoint(B), endpoint(C)], dead = new Set(), inits = [], failLists = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); assert.equal(u.hostname, "openrouter.ai"); inits.push({ path: u.pathname, init });
  if (failLists) return new Response("down", { status: 500 });
  if (u.pathname === "/api/v1/models") return Response.json({ data: list });
  if (u.pathname === "/api/v1/endpoints/zdr") return Response.json({ data: zdr });
  if (u.pathname === "/api/v1/embeddings/models") return Response.json({ data: [] });
  const m = u.pathname.match(/^\/api\/v1\/models\/(.+)\/endpoints$/);
  if (m) return dead.has(m[1]) ? new Response("{}", { status: 404 }) : Response.json({ data: { endpoints: zdr.filter((e) => e.model_id === m[1]) } });
  assert.fail(`Unexpected URL ${url}`);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
let revision = 0;
const current = async () => (await readModelSettings(env)).config;
const save = async (mutate) => { const c = clone(await current()); mutate(c); const view = await saveModelSettings(env, { revision, config: c }, "admin@example.com"); revision = view.revision; return view; };
try {
  revision = (await readModelSettings(env)).revision;
  // 1. Every OpenRouter read asks for no cache and a minute-old copy at most.
  let r = await modelCatalog(env, { q: "example" });
  assert.deepEqual(r.models.map((m) => m.id).sort(), [A, C, B]);
  assert.ok(inits.length > 0 && inits.every((x) => x.init.cache === "no-store"), "every OpenRouter fetch is sent with cache: no-store");
  // 2. A job uses A and C. OpenRouter then drops A from its list and answers 404 for C's endpoints (listed, but gone).
  let view = await save((c) => { c.jobs["chat.general"] = { model: A, effort: "low", fallbacks: [{ model: B, effort: "low" }] }; });
  revision = view.revision;
  const un0 = await unlistedModels(env); assert.ok(!un0.includes(A) && !un0.includes(B), "nothing is flagged while OpenRouter lists the model (the first-run models this mock omits are)");
  list = list.filter((m) => m.id !== A);
  // Search never offers it, even by its exact ID, and the answer names it as unlisted because a saved job uses it.
  r = await modelCatalog(env, { q: A, settings: await current() });
  assert.deepEqual(r.models, []); assert.ok(r.unlisted.includes(A) && !r.unlisted.includes(B));
  r = await modelCatalog(env, { q: "", settings: await current() }); assert.ok(!r.models.some((m) => m.id === A)); assert.ok(r.models.some((m) => m.id === B));
  dead.add(C); r = await modelCatalog(env, { q: "gone-c" }); assert.deepEqual(r.models, [], "a listed model whose endpoints answer 404 is not offered");
  assert.deepEqual(await unlistedIds([A, B, "@cf/meta/x"]), [A]);
  // 3. The page view flags it, and dispatch settings still hold it with its fallbacks.
  const un = await unlistedModels(env); assert.ok(un.includes(A) && !un.includes(B)); view = await modelSettingsView(env);
  assert.equal(view.config.jobs["chat.general"].model, A); assert.equal(view.config.jobs["chat.general"].fallbacks[0].model, B);
  // 4. Saving a model OpenRouter doesn't list is refused with the reason, for a new model and for one the settings already know.
  list = [...list, model(C)]; dead.clear(); zdr = zdr.filter((e) => e.model_id !== C);
  const gone = [C, "example/never-existed"]; list = list.filter((m) => m.id !== C);
  for (const id of gone) await assert.rejects(save((c) => { c.jobs["chat.technical"] = { model: id, effort: "low", fallbacks: [] }; }), (e) => /no longer offered by OpenRouter/.test(e.message) && e.message.startsWith(id) && e.status === 400, id);
  await assert.rejects(save((c) => { c.jobs["chat.technical"] = { model: A, effort: "low", fallbacks: [] }; }), (e) => /no longer offered by OpenRouter/.test(e.message), "known to the settings, still refused for a new pick");
  assert.equal((await current()).jobs["chat.technical"].model !== A, true);
  // Keeping the job on A (saving something else) is not blocked.
  await save((c) => { c.jobs["chat.general"].fallbacks = []; });
  assert.equal((await current()).jobs["chat.general"].model, A);
  // 5. A lookup failure flags nothing and refuses nothing it can't judge as gone.
  failLists = true; assert.deepEqual(await unlistedModels(env), []); failLists = false;
  // 6. The console flags a delisted model on its row and keeps it out of the picker's lists.
  const code = readText(new URL("../app-assets/app-static/models-console.js", import.meta.url), "utf8") + readText(new URL("../app-assets/app-static/models-console-core.js", import.meta.url), "utf8");
  for (const piece of ["/models/api/unlisted", "A model is no longer offered", '!(state.unlisted || []).includes(m.id)']) assert.ok(code.includes(piece), piece);
  console.log("PASS models-stale: no-store fetches, delisted models hidden, refused on save, flagged in the view");
} finally { globalThis.fetch = originalFetch; sql.close(); }
