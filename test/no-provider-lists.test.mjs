// node --import ./test/stubs/register.mjs test/no-provider-lists.test.mjs
// OpenRouter chooses the provider (https://openrouter.ai/docs/guides/routing/provider-selection). No request body carries provider.order or
// provider.only, even when the saved settings still hold "hosts" and "pin" from earlier versions. Synthetic transport only.
import assert from "node:assert/strict";
import test from "node:test";
import { JOBS, jobRoute, choreRouteOf } from "../src/ee/model-jobs.js";
import { orFetch, poolPayload, taskPayload } from "../src/model.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { plan } from "../src/ee/model-plan.js";
import { validateModelSettings, withoutProviderLists } from "../src/ee/model-settings.js";
import { seedSettings, ID } from "./helpers/seed-settings.mjs";

const noLists = (provider, what) => { assert.ok(provider, what); assert.equal(provider.order, undefined, `${what}: order`); assert.equal(provider.only, undefined, `${what}: only`); };
const envFor = (settings) => ({ ENV_NAME: "dev", DYNAMIC_ROUTING: "on", OPENROUTER_API_KEY: "synthetic", MODEL_SETTINGS: settings, PROMPT_CACHE: "off", DB: { prepare() { return { bind() { return this; }, async first() { return { ai_privacy: "zdr" }; } }; } } });
const capture = async (fn) => { const real = globalThis.fetch, sent = []; globalThis.fetch = async (_u, init) => { const p = JSON.parse(init.body); sent.push(p); return Response.json({ model: p.model, choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { cost: 0 } }); }; try { await fn(); } finally { globalThis.fetch = real; } return sent; };

test("saved hosts and pins never reach OpenRouter, for every background job", async () => {
  const s = seedSettings();
  for (const def of JOBS) { const j = s.jobs[def.id]; j.hosts = ["some-host", "other-host"]; j.pin = true; for (const f of j.fallbacks || []) { f.hosts = ["some-host"]; f.pin = true; } }
  assert.throws(() => validateModelSettings(s), /provider lists/, "saved lists are refused");
  const settings = validateModelSettings(withoutProviderLists(s)), env = envFor(settings);
  for (const def of JOBS.filter((j) => j.group === "background")) {
    const route = choreRouteOf(settings, def.id); assert.equal(route.host, undefined, `${def.id}: route host`); assert.equal(route.pin, undefined, `${def.id}: route pin`);
    const sent = await capture(() => openRouterChat(env, { messages: [{ role: "user", content: "hi" }] }, null, jobRoute(def.id), { tenant: "t", kind: "chat" }));
    assert.ok(sent.length >= 1, `${def.id}: sent`); for (const p of sent) { noLists(p.provider, def.id); assert.equal(p.provider.zdr, true, `${def.id}: zdr`); }
  }
});

test("a caller's own provider order or only list is dropped before the request leaves", async () => {
  const sent = await capture(() => orFetch(envFor(seedSettings()), { model: ID.SOL, messages: [], provider: { order: ["azure"], only: ["azure"], allow_fallbacks: false } }, { tenant: "t" }));
  noLists(sent[0].provider, "orFetch");
});

test("every other request builder sends no provider list", () => {
  const settings = seedSettings(), env = envFor(settings);
  for (const level of ["unrestricted", "no_training", "zdr"]) noLists(poolPayload(env, ID.DEEPSEEK, level, { messages: [] }, "s").provider, `pool ${level}`);
  for (const st of plan(seedSettings(), "stt", { level: "zdr" }).steps) noLists(st.provider, "speech");
  const profile = { requestedModel: ID.DEEPSEEK, effort: "low", maxOutput: 800, hosts: ["a", "b"], cacheSession: "x", catalog: { id: ID.DEEPSEEK, pricing: { prompt: 1, completion: 2 } } };
  noLists(taskPayload(profile, { messages: [] }, { level: "zdr", settings }).provider, "task");
});
