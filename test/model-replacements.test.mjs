// node --import ./test/stubs/register.mjs test/model-replacements.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { modelCatalog, assessModelCatalog } from "../src/ee/model-catalog.js";
import { saveModelSettings, restoreModelSettings, modelSettingsView, readModelSettings } from "../src/ee/model-settings.js";
import { openRouterChat, orFetch } from "../src/model.js";
import { policyRoute as policyRoute0, dispatchOrder as dispatchOrder0 } from "../src/ee/route2.js";
import { browserPlan } from "../src/ee/browser-agent.js";
import { enforceRequest } from "../src/privacy.js";
import { jobSetting } from "../src/ee/model-jobs.js";
import { ID, SEED } from "./helpers/seed-settings.mjs";
const SOL = ID.SOL, MUSE_C = ID.MUSE_C, MUSE_S = ID.MUSE_S;

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("fixtures/migrations/migrations_055_model_settings.sql", import.meta.url), "utf8"));
sql.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,ai_privacy TEXT); INSERT INTO tenants VALUES('t','zdr')");
const DB = { withSession(mode) { assert.equal(mode, "first-primary"); return this; }, prepare(q) { const stmt = sql.prepare(q); let values = [];
  const self = { bind(...v) { values = v; return self; }, first: async () => stmt.get(...values) || null, all: async () => ({ results: stmt.all(...values) }), run: async () => ({ meta: { changes: Number(stmt.run(...values).changes) } }) }; return self; } };
const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", ROUTER_MODE: "two", OPENROUTER_API_KEY: "never-forward-to-catalog", PROMPT_CACHE: "off" };
const model = (id, extra = {}) => ({ id, name: `Name ${id}`, context_length: 16384, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: { mandatory: false, supported_efforts: ["low", "high"], default_effort: "low" }, pricing: { prompt: "0.000001", completion: "0.000002" }, ...extra });
const endpoint = (model_id, extra = {}) => ({ model_id, tag: "safe-host/fp16", status: 0, context_length: 16384, max_completion_tokens: 4096,
  pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["tools", "max_tokens", "reasoning", "reasoning_effort", "response_format"], supports_tool_choice: { auto: true, none: true, required: true, function: true }, ...extra });
const A = "example/arbitrary-alpha", B = "example/arbitrary-beta", BAD = "example/too-expensive", TOOLLESS = "example/no-tools";
const models = [model(A), model(B), model(BAD), model(TOOLLESS), model(MUSE_C, { reasoning: { mandatory: true, supported_efforts: ["high", "xhigh"] } }), model(MUSE_S), model("example/plain", { reasoning: null }),
  model("openai/gpt-oss-120b", { reasoning: { mandatory: true, supported_efforts: ["low", "medium", "high"], default_effort: "medium" } })];   // a saved model that no job uses any more leaves the catalog and comes back from this list
// OpenRouter lists the first-run models too, so choosing one again isn't refused as no longer offered.
for (const id of Object.keys(SEED.catalog)) if (!models.some((m) => m.id === id) && !id.startsWith("@cf/")) models.push(model(id));
const eps = [endpoint(A), endpoint(B), endpoint(BAD, { pricing: { prompt: "0.000004", completion: "0.000020" } }), endpoint(TOOLLESS, { supported_parameters: [] }), endpoint("example/plain", { supported_parameters: ["tools", "max_tokens"] }), endpoint("openai/gpt-oss-120b", { tag: "cerebras" })];
const originalFetch = globalThis.fetch, sent = [], catalogRequests = []; let outage = false, redirect = false, failures = new Set();
globalThis.fetch = async (url, init = {}) => {
  assert.ok(String(url).startsWith("https://openrouter.ai/api/v1/"));
  if (!String(url).endsWith("/chat/completions")) {
    catalogRequests.push(String(url)); assert.equal(init.headers?.authorization, undefined);
    if (redirect) return new Response(null, { status: 302, headers: { location: "https://redirect.invalid/private" } });
    if (outage) return new Response("unavailable", { status: 503 });
    if (/\/models(\?|$)/.test(String(url))) return Response.json({ data: models });
    if (String(url).endsWith("/endpoints/zdr")) return Response.json({ data: eps });
    if (String(url).includes(`/models/${MUSE_C}/`)) return Response.json({ data: { endpoints: [endpoint(MUSE_C, { tag: "meta" })] } });
    if (String(url).includes(`/models/${MUSE_S}/`)) return Response.json({ data: { endpoints: [endpoint(MUSE_S, { tag: "meta" })] } });
    assert.fail(`Unexpected URL ${url}`);
  }
  const p = JSON.parse(init.body); sent.push(p);
  return failures.has(p.model) ? Response.json({ error: { message: "unavailable" } }, { status: 503 }) : Response.json({ model: p.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0.00001 } });
};
const clone = (x) => JSON.parse(JSON.stringify(x));
let revision = 0;
const current = async () => (await readModelSettings(env)).config;
const save = async (mutate) => { const c = clone(await current()); mutate(c); const view = await saveModelSettings(env, { revision, config: c }, "admin@example.com"); revision = view.revision; return view; };
const policyRoute = async (...a) => policyRoute0(await current(), ...a), dispatchOrder = async (r, lv, o = {}) => dispatchOrder0(r, lv, { settings: await current(), ...o });
const call = async (route, body = { messages: [{ role: "user", content: "hello" }], max_tokens: 100000 }, kind = "chat") => openRouterChat(env, body, "existing-session", route || await policyRoute("general", "zdr", "test"), { tenant: "t", kind });
try {
  let catalog = await modelCatalog(env, { q: "ARBITRARY" }); assert.deepEqual(catalog.models.map((m) => m.id), [A, B]);
  assert.deepEqual(catalog.models[0].efforts, ["none", "low", "high"]); assert.equal(catalog.models[0].pricing.prompt, 1);
  catalog = await modelCatalog(env); assert.equal(catalog.models.find((m) => m.id === BAD).eligible, true, "price never hides a model"); assert.equal(catalog.models.find((m) => m.id === BAD).pricing.prompt, 4);
  assert.equal(catalog.models.find((m) => m.id === TOOLLESS).eligible, false);
  assert.deepEqual(catalog.models.find((m) => m.id === MUSE_C).levels, ["unrestricted"]);
  assert.deepEqual(catalog.models.find((m) => m.id === MUSE_S).levels, ["unrestricted", "no_training"]);
  assert.deepEqual(catalog.models.find((m) => m.id === "example/plain").efforts, ["default"]);
  await assert.rejects(modelCatalog(env, { q: "x".repeat(161) }), (e) => e.status === 400);
  redirect = true; await assert.rejects(modelCatalog(env), (e) => e.status === 503); redirect = false;
  // models the saved settings describe as accepting only automatic tool choice come back that way from the catalog
  const withSettings = await modelCatalog(env, { settings: SEED }); assert.deepEqual(withSettings.models.find((m) => m.id === MUSE_C).tool_choice, ["auto"]);
  assert.deepEqual(catalog.models.find((m) => m.id === MUSE_C).tool_choice, ["auto", "none", "required", "function"], "without the saved facts nothing is assumed");
  // first read makes the first saved version with no network call: every model in it is described by the first-run data
  outage = true; const first = await modelSettingsView(env); outage = false; revision = first.revision; assert.equal(catalogRequests.length > 0, true);
  // a replacement: the server checks OpenRouter's catalog and keeps its own snapshot; whatever endpoint data the browser sent is dropped
  let view = await save((c) => {
    c.jobs["chat.general"] = { model: A, effort: "high", fallbacks: [{ model: B, effort: "low" }]};
    c.jobs["recover.technical"] = { model: B, effort: "low", fallbacks: [] };
    c.catalog[A] = { id: A, name: "evil", eligible: true, hosts: ["attacker"], efforts: ["max"], max_output: 99999999 };
  });
  const firstReplacement = revision;
  assert.deepEqual(view.config.catalog[A].hosts, ["safe-host/fp16"]); assert.equal(view.config.catalog[A].name, `Name ${A}`);
  let route = await policyRoute("general", "zdr", "kept-before-save");
  await call(route); assert.equal(sent.at(-1).model, A); assert.equal(sent.at(-1).reasoning.effort, "high"); assert.equal(route.effort, "high");
  assert.equal(sent.at(-1).max_tokens, 4096); assert.deepEqual(sent.at(-1).provider.only, ["safe-host/fp16"]);
  assert.equal(sent.at(-1).provider.zdr, true); assert.equal(sent.at(-1).provider.data_collection, "deny"); assert.equal(sent.at(-1).provider.require_parameters, true);
  assert.deepEqual(sent.at(-1).provider.max_price, { prompt: 3, completion: 15 });
  assert.equal(sent.at(-1).models, undefined);
  // the quality recovery job names its own model; an old stored route that names a model directly keeps that model first
  await call(await policyRoute("technical", "zdr", "recovery", { recoveryJob: "recover.technical" })); assert.equal(sent.at(-1).model, B); assert.equal(sent.at(-1).reasoning.effort, "low");
  await call({ two: true, primary: SOL, category: "general", effort: "max" }); assert.equal(sent.at(-1).model, SOL, "a route saved before these settings still names its model; the effort comes from the settings");
  failures.add(A); const before = sent.length; await call(); failures.clear();
  assert.deepEqual(sent.slice(before).map((p) => [p.model, p.reasoning.effort]), [[A, "high"], [B, "low"]]);
  // Runtime dispatch relies on the saved server snapshot, not catalog availability.
  outage = true; await call(); assert.equal(sent.at(-1).model, A);
  await assert.rejects(save((c) => { c.jobs["chat.research"] = { model: BAD, effort: "low", fallbacks: [] }; }), (e) => e.status === 503); assert.equal((await modelSettingsView(env)).revision, revision); outage = false;
  // Stale saves fail before hitting OpenRouter and cannot replace settings.
  const fetchCount = catalogRequests.length;
  await assert.rejects(saveModelSettings(env, { revision: 0, config: await current() }, "other"), (e) => e.status === 409); assert.equal(catalogRequests.length, fetchCount);
  for (const invalid of ["https://evil.invalid/foo", "example/../escape", "example/%2fsecret", "example/model?query", "constructor", TOOLLESS, "missing/model"]) {
    await assert.rejects(save((c) => { c.jobs["chat.general"] = { model: invalid, effort: "low", fallbacks: [] }; }), (e) => e.status === 400 || e.status === 503, invalid);
  }
  await assert.rejects(save((c) => { c.jobs["chat.general"].effort = "max"; }), /doesn't support reasoning level/);
  const beforeIncompatible = (await modelSettingsView(env)).revision, dispatchesBeforeIncompatible = sent.length;
  await assert.rejects(save((c) => { c.jobs["chat.general"].model = ID.STT; c.jobs["chat.general"].effort = null; }), (e) => e.status === 400, "a speech model cannot replace a chat model");
  assert.equal((await modelSettingsView(env)).revision, beforeIncompatible, "an incompatible pick creates no settings revision");
  assert.equal(sent.length, dispatchesBeforeIncompatible, "validation sends no chat request");
  // a model with a forbidden privacy level is saved but never used for that level: at ZDR the list skips it, and the page shows it
  const noImage = await dispatchOrder(route, "zdr", { body: { messages: [{ content: [{ type: "image_url", image_url: { url: "https://example.test/image" } }] }] } });
  assert.deepEqual(noImage.attempts.map((a) => a.model), [], "no listed model reads pictures here: nothing is sent to a model that can't");
  // Background jobs take replacements too, with strict pins; their fallbacks are separate settings.
  await save((c) => { c.jobs.label = { model: A, effort: "none", strict: true, fallbacks: [] }; c.jobs.browser = { model: B, effort: "high", strict: true, fallbacks: [] }; });
  await call({ chore: true }, { messages: [{ role: "user", content: "label" }], model: "attacker/model", provider: { only: ["attacker"] }, reasoning: { effort: "max" }, max_tokens: 9999 }, "card-label");
  assert.equal(sent.at(-1).model, A); assert.deepEqual(sent.at(-1).reasoning, { enabled: false }); assert.equal(sent.at(-1).max_tokens, 4096); assert.deepEqual(sent.at(-1).provider.only, ["safe-host/fp16"]);
  const plan = await browserPlan(env); await orFetch(env, { ...plan[0], messages: [{ role: "user", content: "browser" }] }, { tenant: "t" });
  assert.equal(sent.at(-1).model, B); assert.equal(sent.at(-1).reasoning.effort, "high"); assert.equal(sent.at(-1).max_tokens, 4096);
  // Choosing the original model again drops the replacement; an old resumed route naming the replaced model can't resurrect it as a primary of the list.
  await save((c) => { c.jobs["chat.general"] = clone(SEED.jobs["chat.general"]); c.jobs.label = clone(SEED.jobs.label); c.jobs.browser = clone(SEED.jobs.browser); c.jobs["recover.technical"] = clone(SEED.jobs["recover.technical"]); });
  assert.ok(!(await current()).catalog[A], "a replacement nothing uses is dropped from the saved catalog");
  await call(); assert.equal(sent.at(-1).model, ID.DEEPSEEK, "at zero data retention the first allowed model of the saved list answers");
  const restored = await restoreModelSettings(env, { revision, restore_revision: firstReplacement }, "admin"); revision = restored.revision;
  await call(); assert.equal(sent.at(-1).model, A);
  // Narrow endpoint pins are not widened to a whole registered provider. Unknown retained endpoint suffixes are refused.
  const qualified = enforceRequest({ model: "openai/gpt-oss-120b", provider: { only: ["cerebras/fp16"] } }, "unrestricted");
  assert.deepEqual(qualified.provider.only, ["cerebras/fp16"]); assert.equal(qualified.provider.zdr, true); assert.equal(qualified.provider.data_collection, "deny");
  assert.throws(() => enforceRequest({ model: "openai/gpt-oss-120b", provider: { only: ["cerebras-evil/fp16"] } }, "unrestricted"), (e) => e.privacy);
  assert.throws(() => enforceRequest({ model: MUSE_C, provider: { only: ["meta/unverified"] } }, "unrestricted"), (e) => e.privacy);
  assert.throws(() => enforceRequest({ model: MUSE_S, provider: { only: ["meta/unverified"] } }, "no_training"), (e) => e.privacy);
  const qualifiedCatalog = assessModelCatalog([model("openai/gpt-oss-120b")], [endpoint("openai/gpt-oss-120b", { tag: "cerebras/fp16" })]); assert.equal(qualifiedCatalog[0].eligible, true);
  console.log("PASS replacements: public catalog/search/capabilities, authoritative snapshots, actual wire IDs/efforts, strict privacy and pins, caps, recovery/fallback/resume, main+background, outage and stale safety, restore, invalid IDs and efforts");
} finally { globalThis.fetch = originalFetch; sql.close(); }
