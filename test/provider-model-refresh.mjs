import assert from "node:assert/strict";
import test from "node:test";
import { applyStoredProviderModels, previewStoredProviderModels, runDueProviderModelRefreshes, setProviderModelAutoRefresh } from "../src/server/provider-model-refresh.ts";

const catalog = [
  { id: "paid", name: "Paid", pricing: { prompt: "0.01", completion: "0.02" } },
  { id: "free-priced", name: "Free priced", pricing: { prompt: "0", completion: 0 } },
  { id: "named:free", name: "Named free" },
];
const makeStore = (provider) => {
  const config = { providers: [structuredClone(provider)] };
  return { config, store: { load: () => structuredClone(config), update: (fn) => fn(config) } };
};

test("manual refresh preserves absent models unless Override is explicitly checked", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: catalog }), { status: 200, headers: { "content-type": "application/json" } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const { config, store } = makeStore({ id: "openrouter-1", type: "openrouter", baseUrl: "https://openrouter.test/api/v1", models: [{ id: "manual", enabled: true }] });
  const first = await previewStoredProviderModels(config.providers[0], 7, 1_000);
  assert.equal(config.providers[0].modelAutoRefreshMode, undefined, "automatic refresh defaults off");
  assert.equal(applyStoredProviderModels(store, config.providers[0], 7, { previewToken: first.previewToken, modelIds: ["free-priced"], override: false }, 1_001).ok, true);
  assert.equal(config.providers[0].models.some((model) => model.id === "manual"), true, "the default refresh preserves absent manual IDs");
  const second = await previewStoredProviderModels(config.providers[0], 7, 2_000);
  assert.equal(applyStoredProviderModels(store, config.providers[0], 7, { previewToken: second.previewToken, modelIds: ["free-priced"], override: true }, 2_001).ok, true);
  assert.deepEqual(config.providers[0].models, [{ id: "free-priced", name: "Free priced", enabled: true }],
    "Override persists exactly the checked active models—no absent, unchecked, or disabled catalog entries remain");
});

test("OpenRouter automatic all/free modes are exclusive and refresh exact catalogs every 24 hours", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: catalog }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const { config, store } = makeStore({ id: "openrouter-2", type: "openrouter", baseUrl: "https://openrouter.test/api/v1", models: [{ id: "stale", enabled: true }] });
  const all = await setProviderModelAutoRefresh(store, config.providers[0], "all", 10_000);
  assert.equal(all.ok, true); assert.equal(config.providers[0].modelAutoRefreshMode, "all");
  assert.deepEqual(config.providers[0].models.map((model) => model.id), ["paid", "free-priced", "named:free"]);
  const free = await setProviderModelAutoRefresh(store, config.providers[0], "free", 20_000);
  assert.equal(free.ok, true); assert.equal(config.providers[0].modelAutoRefreshMode, "free", "one stored mode makes all/free mutually exclusive");
  assert.deepEqual(config.providers[0].models.map((model) => model.id), ["free-priced", "named:free"]);
  config.providers[0].models.push({ id: "became-stale", enabled: true });
  await runDueProviderModelRefreshes(store, 20_000 + 24 * 60 * 60_000 - 1);
  assert.equal(config.providers[0].models.some((model) => model.id === "became-stale"), true, "the catalog is not refreshed before 24 hours");
  await runDueProviderModelRefreshes(store, 20_000 + 24 * 60 * 60_000);
  assert.equal(config.providers[0].models.some((model) => model.id === "became-stale"), false, "the due daily run overwrites the saved free catalog");
  const custom = makeStore({ id: "custom", type: "openai-compat", baseUrl: "https://custom.test", models: [] });
  assert.equal((await setProviderModelAutoRefresh(custom.store, custom.config.providers[0], "free", 1)).ok, false, "free-only mode is rejected outside OpenRouter");
});


test("automatic refresh never erases a saved catalog when discovery fails or returns no eligible models", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "paid", pricing: { prompt: 1, completion: 1 } }] }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const { config, store } = makeStore({ id: "openrouter-safe", type: "openrouter", baseUrl: "https://openrouter.test/api/v1", models: [{ id: "saved-free", enabled: true }] });
  const result = await setProviderModelAutoRefresh(store, config.providers[0], "free", 50_000);
  assert.equal(result.refresh.ok, false);
  assert.deepEqual(config.providers[0].models.map((model) => model.id), ["saved-free"], "an empty free result preserves the last usable catalog");
  assert.match(config.providers[0].modelAutoRefreshError, /no free models/i);
});
