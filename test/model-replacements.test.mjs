// node --import ./test/stubs/register.mjs test/model-replacements.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { modelCatalog, assessModelCatalog } from "../src/ee/model-catalog.js";
import { defaultModelSettings, saveModelSettings, resetModelSettings, restoreModelSettings, modelSettingsView, replacementModel } from "../src/ee/model-settings.js";
import { openRouterChat, orFetch } from "../src/model.js";
import { policyRoute, dispatchOrder } from "../src/ee/route2.js";
import { browserPlan } from "../src/ee/browser-agent.js";
import { enforceRequest } from "../src/privacy.js";
import { POOL, SOL, MUSE_C, MUSE_S } from "../src/ee/pool.js";

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
const models = [model(A), model(B), model(BAD), model(TOOLLESS), model(MUSE_C, { reasoning: { mandatory: true, supported_efforts: ["high", "xhigh"] } }), model(MUSE_S), model("example/plain", { reasoning: null })];
const eps = [endpoint(A), endpoint(B), endpoint(BAD, { pricing: { prompt: "0.000004", completion: "0.000020" } }), endpoint(TOOLLESS, { supported_parameters: [] }), endpoint("example/plain", { supported_parameters: ["tools", "max_tokens"] })];
const originalFetch = globalThis.fetch, sent = [], catalogRequests = []; let outage = false, redirect = false, failures = new Set();
globalThis.fetch = async (url, init = {}) => {
  assert.ok(String(url).startsWith("https://openrouter.ai/api/v1/"));
  if (!String(url).endsWith("/chat/completions")) {
    catalogRequests.push(String(url)); assert.equal(init.headers?.authorization, undefined);
    if (redirect) return new Response(null, { status: 302, headers: { location: "https://redirect.invalid/private" } });
    if (outage) return new Response("unavailable", { status: 503 });
    if (String(url).endsWith("/models")) return Response.json({ data: models });
    if (String(url).endsWith("/endpoints/zdr")) return Response.json({ data: eps });
    if (String(url).includes(`/models/${MUSE_C}/`)) return Response.json({ data: { endpoints: [endpoint(MUSE_C, { tag: "meta" })] } });
    if (String(url).includes(`/models/${MUSE_S}/`)) return Response.json({ data: { endpoints: [endpoint(MUSE_S, { tag: "meta" })] } });
    assert.fail(`Unexpected URL ${url}`);
  }
  const p = JSON.parse(init.body); sent.push(p);
  return failures.has(p.model) ? Response.json({ error: { message: "unavailable" } }, { status: 503 }) : Response.json({ model: p.model, choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0.00001 } });
};
let revision = 0, cfg = defaultModelSettings();
const save = async (c = cfg) => { const view = await saveModelSettings(env, { revision, config: c }, "admin@example.com"); revision = view.revision; return view; };
const call = (route = policyRoute("general", "zdr", "test"), body = { messages: [{ role: "user", content: "hello" }], max_tokens: 100000 }, kind = "chat") => openRouterChat(env, body, "existing-session", route, { tenant: "t", kind });
try {
  let catalog = await modelCatalog(env, { q: "ARBITRARY" }); assert.deepEqual(catalog.models.map((m) => m.id), [A, B]);
  assert.deepEqual(catalog.models[0].efforts, ["none", "low", "high"]); assert.equal(catalog.models[0].pricing.prompt, 1);
  catalog = await modelCatalog(env); assert.equal(catalog.models.find((m) => m.id === BAD).eligible, false); assert.match(catalog.models.find((m) => m.id === BAD).reasons.join(), /\$3/);
  assert.equal(catalog.models.find((m) => m.id === TOOLLESS).eligible, false);
  assert.deepEqual(catalog.models.find((m) => m.id === MUSE_C).levels, ["unrestricted"]);
  assert.deepEqual(catalog.models.find((m) => m.id === MUSE_S).levels, ["unrestricted", "no_training"]);
  assert.deepEqual(catalog.models.find((m) => m.id === "example/plain").efforts, ["default"]);
  await assert.rejects(modelCatalog(env, { q: "x".repeat(161) }), (e) => e.status === 400);
  redirect = true; await assert.rejects(modelCatalog(env), (e) => e.status === 503); redirect = false;
  assert.equal(replacementModel(null, "removed/unknown"), null);
  // Merely rendering all original slot IDs does not require network validation; old four-key configs still work.
  cfg.models = Object.fromEntries(Object.entries(POOL).map(([key, m]) => [key, m.model]));
  outage = true; await save(); outage = false;
  cfg.models.deepseek = A; cfg.efforts.deepseek = "high";
  cfg.models.sol = B; cfg.efforts.sol = "low";
  cfg.catalog = { [A]: { hosts: ["attacker"], efforts: ["max"], max_output: 99999999 } };
  const saved = await save(); const firstReplacement = revision;
  assert.deepEqual(saved.config.catalog[A].hosts, ["safe-host/fp16"]); assert.equal(saved.options.models.find((m) => m.key === "deepseek").model, A);
  let route = policyRoute("general", "zdr", "kept-before-save");
  await call(route); assert.equal(sent.at(-1).model, A); assert.equal(sent.at(-1).reasoning.effort, "high"); assert.equal(route.effort, "high");
  assert.equal(sent.at(-1).max_tokens, 4096); assert.deepEqual(sent.at(-1).provider.only, ["safe-host/fp16"]);
  assert.equal(sent.at(-1).provider.zdr, true); assert.equal(sent.at(-1).provider.data_collection, "deny"); assert.equal(sent.at(-1).provider.require_parameters, true);
  assert.deepEqual(sent.at(-1).provider.max_price, { prompt: 3, completion: 15 });
  assert.equal(sent.at(-1).models, undefined);
  // Both quality recovery constants and legacy resumed static primaries resolve through current stable slots.
  await call(policyRoute("general", "zdr", "recovery", { recovery: SOL })); assert.equal(sent.at(-1).model, B); assert.equal(sent.at(-1).reasoning.effort, "low");
  await call({ two: true, primary: SOL, category: "general", effort: "max" }); assert.equal(sent.at(-1).model, B);
  cfg.chains.general.zdr = ["deepseek", "sol"]; await save(); failures.add(A); const before = sent.length; await call(); failures.clear();
  assert.deepEqual(sent.slice(before).map((p) => [p.model, p.reasoning.effort]), [[A, "high"], [B, "low"]]);
  // Runtime dispatch relies on the saved server snapshot, not catalog availability.
  outage = true; await call(); assert.equal(sent.at(-1).model, A);
  await assert.rejects(save(), (e) => e.status === 503); assert.equal((await modelSettingsView(env)).revision, revision); outage = false;
  // Stale saves fail before hitting OpenRouter and cannot replace settings.
  const fetchCount = catalogRequests.length;
  await assert.rejects(saveModelSettings(env, { revision: 0, config: cfg }, "other"), (e) => e.status === 409); assert.equal(catalogRequests.length, fetchCount);
  for (const invalid of ["https://evil.invalid/foo", "example/../escape", "example/%2fsecret", "example/model?query", "constructor", BAD, TOOLLESS, "missing/model"]) {
    const c = structuredClone(cfg); c.models.deepseek = invalid;
    await assert.rejects(saveModelSettings(env, { revision, config: c }, "admin"), (e) => e.status === 400);
  }
  let bad = structuredClone(cfg); bad.efforts.deepseek = "max";
  await assert.rejects(saveModelSettings(env, { revision, config: bad }, "admin"), /Unsupported effort/);
  bad = structuredClone(cfg); bad.models.sol = A;
  await assert.rejects(saveModelSettings(env, { revision, config: bad }, "admin"), /same effort/);
  bad = structuredClone(cfg); bad.models.deepseek = MUSE_C; bad.efforts.deepseek = "xhigh";
  await assert.rejects(saveModelSettings(env, { revision, config: bad }, "admin"), /not an eligible model/);
  const active = (await modelSettingsView(env)).config;
  assert.deepEqual(dispatchOrder(route, "zdr", { settings: active, body: { messages: [{ content: [{ type: "image_url", image_url: { url: "https://example.test/image" } }] }] } }).models, []);
  // Background overrides use actual IDs with strict pins; their fallback remains separately configured.
  cfg.chores.label = { model: A, effort: "none" }; cfg.chores.browser = { model: B, effort: "high" }; await save();
  await call({ chore: true, model: "old/model" }, { messages: [{ role: "user", content: "label" }], model: "attacker/model", provider: { only: ["attacker"] }, reasoning: { effort: "max" }, max_tokens: 9999 }, "card-label");
  assert.equal(sent.at(-1).model, A); assert.deepEqual(sent.at(-1).reasoning, { enabled: false }); assert.equal(sent.at(-1).max_tokens, 4096); assert.deepEqual(sent.at(-1).provider.only, ["safe-host/fp16"]);
  const plan = await browserPlan(env); await orFetch(env, { ...plan[0], messages: [{ role: "user", content: "browser" }] }, { tenant: "t" });
  assert.equal(sent.at(-1).model, B); assert.equal(sent.at(-1).reasoning.effort, "high"); assert.equal(sent.at(-1).max_tokens, 4096);
  // Removed previous replacement IDs on an old resumed route cannot resurrect that model.
  cfg.models.deepseek = POOL.deepseek.model; cfg.efforts.deepseek = "max"; cfg.chores.label = { model: "default", effort: "default" }; await save();
  await call({ two: true, primary: A, category: "general" }); assert.equal(sent.at(-1).model, POOL.deepseek.model);
  let restored = await restoreModelSettings(env, { revision, restore_revision: firstReplacement }, "admin"); revision = restored.revision;
  await call(); assert.equal(sent.at(-1).model, A);
  outage = true; await resetModelSettings(env, { revision }, "admin"); outage = false; await call(); assert.equal(sent.at(-1).model, POOL.deepseek.model);
  // Narrow endpoint pins are not widened to a whole registered provider. Unknown retained endpoint suffixes are refused.
  const qualified = enforceRequest({ model: "openai/gpt-oss-120b", provider: { only: ["cerebras/fp16"] } }, "unrestricted");
  assert.deepEqual(qualified.provider.only, ["cerebras/fp16"]); assert.equal(qualified.provider.zdr, true); assert.equal(qualified.provider.data_collection, "deny");
  assert.throws(() => enforceRequest({ model: "openai/gpt-oss-120b", provider: { only: ["cerebras-evil/fp16"] } }, "unrestricted"), (e) => e.privacy);
  assert.throws(() => enforceRequest({ model: MUSE_C, provider: { only: ["meta/unverified"] } }, "unrestricted"), (e) => e.privacy);
  assert.throws(() => enforceRequest({ model: MUSE_S, provider: { only: ["meta/unverified"] } }, "no_training"), (e) => e.privacy);
  const qualifiedCatalog = assessModelCatalog([model("openai/gpt-oss-120b")], [endpoint("openai/gpt-oss-120b", { tag: "cerebras/fp16" })]); assert.equal(qualifiedCatalog[0].eligible, true);
  console.log("PASS replacements: public catalog/search/capabilities, authoritative snapshots, old configs, actual wire IDs/efforts, strict privacy and pins, caps, recovery/fallback/resume, main+background, outage and stale safety, reset/restore, invalid IDs and metadata spoofing.");
} finally { globalThis.fetch = originalFetch; sql.close(); }
