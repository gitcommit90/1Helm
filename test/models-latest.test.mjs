// node --import ./test/stubs/register.mjs test/models-latest.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { modelCatalog, taskModelCatalog, validModelId, isLatestAlias } from "../src/ee/model-catalog.js";
import { saveModelSettings, restoreModelSettings, modelSettingsView, readModelSettings } from "../src/ee/model-settings.js";
import { orFetch } from "../src/model.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { policyRoute as policyRoute0, dispatchOrder as dispatchOrder0 } from "../src/ee/route2.js";
import { browserPlan } from "./helpers/browser-plan.mjs";
import { enforceRequest } from "../src/privacy.js";
import { jobSetting } from "../src/ee/model-jobs.js";
import { ID, SEED, setGeneral } from "./helpers/seed-settings.mjs";
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
import { savedModelPrice, estimateStepCost } from "../src/step-price.js";
const ALIAS = "~example/family-latest", TARGET = "example/family-2", DEC_ALIAS = "~example/decider-latest", DEC_TARGET = "example/decider-2", BAD_ALIAS = "~example/retained-latest", FRESH = "example/released-today";
const aliasRow = (id, slug, extra = {}) => model(id, { alias_target: { name: slug, slug }, architecture: { input_modalities: ["text"], output_modalities: ["text"], tokenizer: "Router" }, ...extra });
const decisionRow = (id, extra = {}) => model(id, { architecture: { input_modalities: ["text"], output_modalities: ["decisions"] }, reasoning: undefined, pricing: { prompt: "0.00000002", completion: "0" }, ...extra });
let list = [model(TARGET), aliasRow(ALIAS, TARGET), aliasRow(BAD_ALIAS, "example/not-on-zdr"), decisionRow(DEC_TARGET), decisionRow(DEC_ALIAS, { alias_target: { slug: DEC_TARGET } })];
const zdr = [endpoint(TARGET), endpoint(DEC_TARGET, { tag: "example" })], urls = [], sent = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); assert.equal(u.hostname, "openrouter.ai");
  if (u.pathname.endsWith("/chat/completions")) { const p = JSON.parse(init.body); sent.push(p); return Response.json({ model: "example/family-2", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0.00002 } }); }
  urls.push(String(url));
  if (u.pathname === "/api/v1/models") return Response.json({ data: list });
  if (u.pathname === "/api/v1/endpoints/zdr") { assert.equal(u.search, "", "the ZDR list answers 404 to query values"); return Response.json({ data: zdr }); }
  if (u.pathname === "/api/v1/embeddings/models") return Response.json({ data: [] });
  if (u.pathname.includes("/endpoints")) return Response.json({ data: { endpoints: [] } });
  assert.fail(`Unexpected URL ${url}`);
};
const clone = (x) => JSON.parse(JSON.stringify(x));
let revision = 0;
const current = async () => (await readModelSettings(env)).config;
const save = async (mutate) => { const c = clone(await current()); mutate(c); const view = await saveModelSettings(env, { revision, config: c }, "admin@example.com"); revision = view.revision; return view; };
try {
  // 1. Search reads OpenRouter's current list on every request: a model released after the first search shows up in the next one.
  let r = await modelCatalog(env, { q: "released" }); assert.deepEqual(r.models, []);
  list = [model(FRESH, { name: "Fresh Model" }), ...list]; zdr.push(endpoint(FRESH));
  r = await modelCatalog(env, { q: "fresh model" }); assert.deepEqual(r.models.map((m) => m.id), [FRESH]); assert.equal(r.models[0].eligible, true);
  assert.ok(urls.some((u) => u.includes("/models?output_modalities=all&_=")), "the list is requested with decision models and a minute-old copy at most");
  assert.ok(urls.every((u) => !u.includes("/endpoints/zdr?")));

  // 2. Latest-resolution IDs: validated strictly, listed with the resolved model's facts, and kept exactly as written.
  for (const id of ["~deepseek/deepseek-flash-latest", "~perplexity/pplx-decider-latest", ALIAS, "~unbiased/pareto-latest"]) assert.equal(validModelId(id), true, id);
  for (const id of ["~deepseek/deepseek-flash", "~/x-latest", "~a/b-latest/c", "a/~b-latest", "~~a/b-latest", "~a/b-latest ", "~a b/c-latest", "deepseek/~x-latest", `~a/${"x".repeat(160)}-latest`]) assert.equal(validModelId(id), false, id);
  assert.equal(isLatestAlias(ALIAS), true); assert.equal(isLatestAlias("example/plain"), false);
  r = await modelCatalog(env, { q: "~example" });
  const alias = r.models.find((m) => m.id === ALIAS); assert.equal(alias.eligible, true); assert.deepEqual(alias.hosts, ["safe-host/fp16"]); assert.deepEqual(alias.levels, ["unrestricted", "no_training", "zdr"]);
  assert.equal(alias.pricing.prompt, 1, "the price is the resolved model's"); assert.equal(r.models.find((m) => m.id === BAD_ALIAS).eligible, false);
  const dec = r.models.find((m) => m.id === DEC_ALIAS); assert.equal(dec.eligible, true); assert.deepEqual(dec.kinds, ["decider"]); assert.equal(dec.in_nano, 20);
  assert.ok(!r.models.some((m) => m.id === DEC_TARGET && m.kinds.includes("chat")), "decision models are never chat models");

  // 3. Saving: a ~ ID is accepted for a chat job (main and fallback) and for the decider job, and stored as entered.
  const first = await modelSettingsView(env); revision = first.revision;
  let view = await save((c) => { setGeneral(c, [{ model: ALIAS, effort: "low" }, { model: TARGET, effort: "low" }]); c.jobs.decider = { model: DEC_ALIAS, effort: null, fallbacks: [] }; });
  assert.equal(view.config.routing.categories[0].chains.zdr[0].model, ALIAS); assert.equal(view.config.jobs.decider.model, DEC_ALIAS);
  assert.equal(view.config.catalog[ALIAS].pricing.prompt, 1); assert.deepEqual(view.config.catalog[DEC_ALIAS].kinds, ["decider"]);
  view = await save((c) => { c.jobs.notes_refine.fallbacks = [{ model: ALIAS, effort: "low" }]; });
  assert.equal(view.config.jobs.notes_refine.fallbacks[0].model, ALIAS);
  // Wrong input stays refused: a ~ ID the catalog can't verify, a ~ ID that is not a latest ID, a decision model on a chat job.
  for (const [id, msg] of [[BAD_ALIAS, /not-on-zdr|zero-data-retention/], ["~example/unlisted-latest", /not available|Invalid/], ["~example/family-2", /Invalid/]]) {
    await assert.rejects(save((c) => { setGeneral(c, [{ model: id, effort: "low" }]); }), (e) => e.modelSettings || e.status === 400, id);
  }
  await assert.rejects(save((c) => { setGeneral(c, [{ model: DEC_ALIAS, effort: "low" }]); }), (e) => e.status === 400);

  // 4. Dispatch: the ~ ID goes to OpenRouter as written, and the model OpenRouter reports is what the app records.
  const route = { model: ALIAS, effort: "low", host: "safe-host/fp16", pin: true, strict: true, max_output: 4096 };
  const reply = await openRouterChat(env, { messages: [{ role: "user", content: "hi" }], max_tokens: 100 }, "s", { chore: true, only: true, ...route }, { tenant: "t", kind: "chat" });
  assert.equal(sent.at(-1).model, ALIAS); assert.equal(sent.at(-1).provider.zdr, true); assert.equal(sent.at(-1).models, undefined);
  assert.equal(reply.model ?? (await reply.json?.())?.model, "example/family-2", "the resolved model is what comes back");
  // Cost: OpenRouter's reported cost is used when present. Without it, the resolved model's price (kept on the ~ ID's record) prices the step.
  const catalogs = [(await current()).catalog], price = savedModelPrice(catalogs, ["example/family-2-unlisted", ALIAS]);
  assert.deepEqual(price, { model: ALIAS, in: 1000, out: 2000 }); assert.equal(estimateStepCost({ inTok: 1000, outTok: 500 }, price).unknown, false);

  // 5. A task's capabilities come from the model the ~ ID resolves to now.
  const cap = await taskModelCatalog(ALIAS, null, env); assert.equal(cap.id, ALIAS); assert.deepEqual(cap.hosts, ["safe-host/fp16"]); assert.equal(cap.max_output, 4096);
  await assert.rejects(taskModelCatalog(BAD_ALIAS, null, env), (e) => e.code === "model_capabilities_unavailable");
  console.log("PASS models-latest: live-list search, ~latest validation, save, dispatch, cost");
} finally { globalThis.fetch = originalFetch; sql.close(); }
