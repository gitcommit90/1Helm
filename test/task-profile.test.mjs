// node --import ./test/stubs/register.mjs test/task-profile.test.mjs
// Synthetic provider fixtures only: no credentials, network or paid model calls.
import assert from "node:assert/strict";
import { ensureTaskRuntime, authorizeTaskProfile, taskRoute, TASK_PROFILE_KEY, recordTaskServed, approvedTaskTransition, readTaskProfile } from "../src/ee/task-profile.js";
import { openRouterChat, taskPayload, orFetch } from "../src/model.js";
import { defaultModelSettings } from "../src/ee/model-settings.js";
import { taskModelCatalog } from "../src/ee/model-catalog.js";
import { MUSE_C, SOL } from "../src/ee/pool.js";
import { dispatchOrder, escalationAfter, escalationBefore, newEsc } from "../src/ee/route2.js";

const catalog = (id, hosts, context = 262144) => ({ id, eligible: true, hosts, efforts: ["minimal", "low", "high"],
  levels: id === MUSE_C ? ["unrestricted"] : ["unrestricted", "zdr", "no_training"], context_length: context,
  max_output: 65536, input_modalities: ["text", "image"], pricing: { prompt: .1, completion: .2 }, tool_choice: id === MUSE_C ? ["auto"] : ["auto", "none"], json: true });
// Actual public Muse endpoint metadata advertised all choices while Meta's
// 400 response explicitly rejected none/required/named choices.
const records = { [MUSE_C]: { ...catalog(MUSE_C, ["meta"]), tool_choice: ["auto", "none", "required", "function"] }, [SOL]: catalog(SOL, ["azure"]) };
let settings = defaultModelSettings(), revision = 1, level = "unrestricted", fetches = [], calls = 0;
const env = { ONEHELM_EE: "1hc", OPENROUTER_API_KEY: "synthetic-fixture", ROUTER_MODE: "two", TASK_MODEL_CATALOG: records,
  DB: { prepare(sql) { return { bind() { return this; }, async first() {
    if (sql.includes("model_settings_versions")) return { revision, config: JSON.stringify(settings) };
    if (sql.includes("ai_privacy")) return { ai_privacy: level };
    throw new Error(`Unexpected database query: ${sql}`);
  } }; } } };
const store = new Map([["tenant", "tenant-a"], ["channel", "main"]]);
// Resident KV stores String(value), not structured objects. Exercise the actual
// serialization contract, including a fresh read on every simulated restart.
const R = { env, get(k) { return store.get(k) ?? null; }, put(k,v) { store.set(k, String(v)); } };
await assert.rejects(ensureTaskRuntime({ ...R, env: { OPENROUTER_API_KEY: "synthetic-fixture" } }, { session: "public" }, {}), e => e.reason === "ee-disabled");
await assert.rejects(authorizeTaskProfile({ OPENROUTER_API_KEY: "synthetic-fixture" }, {}, "tenant-a"), e => e.reason === "ee-disabled");
const args = () => ({ kind: "job", text: "Do the same task", hist: [], stats: { charge: 0 } });
const response = () => Response.json({ model: "meta/actual-served-version", provider: "Meta", choices: [{ message: { content: "Done" } }], usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 900 }, cost: .00001 } });
globalThis.fetch = async (_url, init) => { calls++; fetches.push(JSON.parse(init.body)); return response(); };
let tc = { session: "task-a" }, profile = await ensureTaskRuntime(R, tc, args());
assert.equal(profile.requestedModel, MUSE_C);
assert.equal(profile.contextLength, 262144, "uses verified fixture capacity, not an assumed million");
assert.equal(profile.maxOutput, 50000);
assert.equal(profile.servedModel, null, "requested identity is not presented as confirmed served identity");
assert.deepEqual(profile.catalog.tool_choice, ["auto"], "known provider restriction overrides advertised flags");
const staleProfile = { ...profile, catalog: records[MUSE_C] };
R.put(TASK_PROFILE_KEY("stale-catalog"), JSON.stringify(staleProfile));
const repairedProfile = await ensureTaskRuntime(R, { session: "stale-catalog" }, args());
assert.deepEqual(repairedProfile, { ...staleProfile, catalog: { ...staleProfile.catalog, tool_choice: ["auto"] } }, "old snapshots repaired without changing affinity/cache identity/limits");
assert.deepEqual(records[MUSE_C].tool_choice, ["auto", "none", "required", "function"], "source snapshot is not mutated");
for (const tool_choice of ["none", "required", { type: "function", function: { name: "lookup" } }]) {
  await assert.rejects(authorizeTaskProfile(env, staleProfile, "tenant-a", { tool_choice }), e => e.reason === "unsupported-tool-choice");
  assert.throws(() => taskPayload(staleProfile, { tool_choice }), e => e.reason === "unsupported-tool-choice");
}
assert.equal(calls, 0, "unsupported tool choices are blocked before a provider call");
const original = structuredClone(profile), messages = [{ role: "system", content: "Stable system" }];
const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
for (let turn = 1; turn <= 50; turn++) {
  // Rebuild the resident/turn view from serialized state each time (restart-equivalent profile boundary).
  tc = { session: "task-a" };
  if (turn === 2) { settings.chains.general.unrestricted = ["sol"]; settings.efforts["muse-c"] = "high"; revision++; }
  profile = await ensureTaskRuntime(R, tc, args());
  assert.deepEqual(profile, original, "defaults and effort edits cannot mutate an existing task");
  messages.push({ role: "user", content: `Message ${turn}: ${"keep the decision ".repeat(100)}` });
  const r = await openRouterChat(env, { messages, tools, max_tokens: 50000 }, "ignored-changing-session", tc.route, { tenant: "tenant-a" });
  const result = await r.json(); assert.equal(result.usage.prompt_tokens_details.cached_tokens, 900, "usage preserved without invented cache hits");
  assert.equal(result.usage.cost, .00001);
  messages.push({ role: "assistant", content: `Answer ${turn}` });
}
assert.equal(calls, 50);
assert(fetches.every((p) => p.model === MUSE_C && !p.models));
assert(fetches.every((p) => JSON.stringify(p.reasoning) === JSON.stringify(fetches[0].reasoning)));
assert(fetches.every((p) => p.prompt_cache_key === fetches[0].prompt_cache_key && p.session_id === fetches[0].session_id));
assert(fetches.every((p) => JSON.stringify(p.provider) === JSON.stringify(fetches[0].provider)));
assert(fetches.every((p) => !("order" in p.provider)), "actual wire permits session-based provider stickiness");
assert(fetches.every((p) => JSON.stringify(p.provider.only) === '["meta"]'));
assert(fetches.every((p) => JSON.stringify(p.tools) === JSON.stringify(fetches[0].tools)));
const unmark = (m) => ({ ...m, content: Array.isArray(m.content) && m.content.length === 1 && m.content[0].type === "text" ? m.content[0].text : m.content });
for (let i = 1; i < fetches.length; i++) assert.deepEqual(fetches[i].messages.slice(0, fetches[i-1].messages.length).map(unmark), fetches[i-1].messages.map(unmark));
assert(JSON.stringify(fetches.at(-1).messages).length > 60000);
assert.equal((await ensureTaskRuntime(R, { session: "task-b" }, args())).requestedModel, SOL, "new task picks updated default");
assert.notEqual(readTaskProfile(R, "task-b").cacheSession, profile.cacheSession);
recordTaskServed(R, tc, { model: "meta/actual-served-version", provider: "Meta" });
assert.equal(readTaskProfile(R, "task-a").servedProvider, "Meta");
assert.equal(readTaskProfile(R, "task-a").requestedModel, MUSE_C);
let identityWrites = 0;
const countingR = { ...R, put(k,v) { identityWrites++; R.put(k,v); } };
for (let chunk = 0; chunk < 500; chunk++) recordTaskServed(countingR, tc, { model: "meta/actual-served-version", provider: "Meta" });
assert.equal(identityWrites, 0, "identical SSE metadata does not rewrite durable profile per chunk");
recordTaskServed(countingR, tc, { model: "meta/actual-served-version", provider: "Meta", providerHost: "meta" });
assert.equal(identityWrites, 1, "new canonical endpoint evidence is persisted");
for (let chunk = 0; chunk < 500; chunk++) recordTaskServed(countingR, tc, { model: "meta/actual-served-version", provider: "Meta", providerHost: "meta" });
assert.equal(identityWrites, 1);

let before = calls; level = "zdr";
await assert.rejects(openRouterChat(env, { messages }, "s", tc.route, { tenant: "tenant-a" }), (e) => e.privacy && e.reason === "task-privacy-revoked");
assert.equal(calls, before, "revocation blocks before any provider request");
level = "unrestricted";
await assert.rejects(authorizeTaskProfile({ ...env, TASK_REVOKED_MODELS: MUSE_C }, profile, "tenant-a"), (e) => e.reason === "model-revoked");
await assert.rejects(authorizeTaskProfile({ ...env, TASK_REVOKED_HOSTS: "meta" }, profile, "tenant-a"), (e) => e.reason === "provider-revoked");
await assert.rejects(authorizeTaskProfile({ ...env, OPENROUTER_API_KEY: "" }, profile, "tenant-a"), (e) => e.reason === "credential-unavailable");
await assert.rejects(openRouterChat({ ...env, BYOK: { model: "person/model", base: "https://example.invalid/v1" } }, { messages }, "s", tc.route), (e) => e.reason === "credential-mode-changed");
assert.equal(calls, before, "billing fallback cannot send managed history to own-key endpoint");
await assert.rejects(authorizeTaskProfile(env, profile, "tenant-a", { tool_choice: "required" }), (e) => e.reason === "unsupported-tool-choice");
const same = taskPayload(profile, { messages: [{ role: "assistant", content: "", reasoning_details: [{ type: "reasoning.encrypted", data: "opaque" }], _rmodel: MUSE_C }] });
assert.equal(same.messages[0].reasoning_details[0].data, "opaque"); assert(!("_rmodel" in same.messages[0]));
assert(!taskPayload({ ...profile, requestedModel: SOL }, { messages: [{ role: "assistant", content: "", reasoning_details: [{}], _rmodel: MUSE_C }] }).messages[0].reasoning_details);

fetches = []; calls = 0;
globalThis.fetch = async (_u, init) => { calls++; fetches.push(JSON.parse(init.body)); return calls === 1 ? new Response("unavailable", { status: 503 }) : response(); };
await openRouterChat(env, { messages }, "s", tc.route, { tenant: "tenant-a" });
assert.equal(calls, 2); assert(fetches.every((p) => p.model === MUSE_C));
assert.deepEqual(fetches[0], fetches[1], "same-model retry preserves exact payload/cache identity");
assert(fetches.every((p) => !("order" in p.provider)));
calls = 0;
globalThis.fetch = async (_u, init) => { calls++; fetches.push(JSON.parse(init.body)); return new Response("unavailable", { status: 503 }); };
await assert.rejects(openRouterChat(env, { messages }, "s", tc.route, { tenant: "tenant-a" }), (e) => e.reason === "model-unavailable");
assert.equal(calls, 2, "bounded retry does not walk fallback models"); assert(fetches.every((p) => p.model === MUSE_C));
calls = 0; globalThis.fetch = async () => { calls++; return new Response("maximum context length exceeded", { status: 400 }); };
await assert.rejects(openRouterChat(env, { messages }, "s", tc.route, { tenant: "tenant-a" }), (e) => e.contextOverflow);
assert.equal(calls, 1, "capacity error is left to governor, not provider/model retries");
calls = 0; globalThis.fetch = async () => { calls++; level = "zdr"; return new Response("unavailable", { status: 503 }); };
await assert.rejects(openRouterChat(env, { messages }, "s", tc.route, { tenant: "tenant-a" }), e => e.privacy);
assert.equal(calls, 1, "privacy tightening blocks even the same-model retry"); level = "unrestricted";
assert.deepEqual(dispatchOrder(tc.route, level, { settings }).models, [MUSE_C]);
tc.esc = newEsc(); tc.esc.tools = 2;
assert.equal(escalationAfter(R, tc, { content: "I'm stuck", calls: [] }), null);
assert.equal(escalationBefore(R, tc, []), null);
assert.equal(tc.route.model, MUSE_C);

assert.throws(() => approvedTaskTransition(profile, readTaskProfile(R, "task-b")), /approved migration/);
const migrated = approvedTaskTransition(profile, readTaskProfile(R, "task-b"), { approved: true, reason: "explicit owner-approved migration" });
R.put(TASK_PROFILE_KEY("task-a"), JSON.stringify(migrated));
assert.equal((await ensureTaskRuntime(R, { session: "task-a" }, args())).requestedModel, SOL);
assert.equal(migrated.transitions.at(-1).from, MUSE_C);
assert.equal(migrated.cacheSession, profile.cacheSession);
R.put(TASK_PROFILE_KEY("corrupt-task"), "[object Object]");
await assert.rejects(ensureTaskRuntime(R, { session: "corrupt-task" }, args()), (e) => e.reason === "invalid-profile");
R.put(TASK_PROFILE_KEY("corrupt-task"), "null");
await assert.rejects(ensureTaskRuntime(R, { session: "corrupt-task" }, args()), (e) => e.reason === "invalid-profile");

// Provider observations stay diagnostic. Stable session_id lets OpenRouter
// retain its chosen endpoint; a manual order must never disable that behavior.
const multi = { ...migrated, hosts: ["azure/us", "azure/eu"] }, providerTc = { session: "provider-task", taskProfile: multi, route: taskRoute(multi) };
recordTaskServed(R, providerTc, { model: SOL, provider: "Azure Europe", providerHost: "azure/eu" });
assert.equal(providerTc.taskProfile.preferredHost, "azure/eu");
const providerAuth = await authorizeTaskProfile(env, providerTc.taskProfile, "tenant-a");
const sticky = taskPayload(providerTc.taskProfile, { messages: [] }, providerAuth);
assert(!("order" in sticky.provider));
assert.deepEqual(sticky.provider.only, ["azure/us", "azure/eu"]);
recordTaskServed(R, providerTc, { model: SOL, provider: "Mystery Regional Endpoint" });
assert.equal(providerTc.taskProfile.preferredHost, "azure/eu");

const providerWires = [];
globalThis.fetch = async (_url, init) => { providerWires.push(JSON.parse(init.body)); return response(); };
await openRouterChat(env, { messages: [], provider: { order: ["outside"], only: ["outside"] } }, "ignored", providerTc.route, { tenant: "tenant-a" });
assert.deepEqual(providerWires[0], sticky, "final privacy boundary also removes order, without widening caller-overridden hosts");
await openRouterChat({ ...env, TASK_REVOKED_HOSTS: "azure/us" }, { messages: [] }, "ignored", providerTc.route, { tenant: "tenant-a" });
assert.deepEqual(providerWires[1].provider.only, ["azure/eu"], "revocation narrows final wire whitelist");
assert(!("order" in providerWires[1].provider));
assert.equal(providerWires[1].provider.zdr, true); assert.equal(providerWires[1].provider.data_collection, "deny");
assert.equal(providerWires[1].provider.require_parameters, true);
assert.deepEqual(providerWires[1].provider.max_price, { prompt: 3, completion: 15 });
assert.equal(providerWires[1].session_id, providerWires[0].session_id);
assert.equal(providerWires[1].prompt_cache_key, providerWires[0].prompt_cache_key);
const retryEnv = { ...env }, retryWires = [];
globalThis.fetch = async (_url, init) => { retryWires.push(JSON.parse(init.body)); if (retryWires.length === 1) { retryEnv.TASK_REVOKED_HOSTS = "azure/us"; return new Response("unavailable", { status: 503 }); } return response(); };
await openRouterChat(retryEnv, { messages: [] }, "ignored", providerTc.route, { tenant: "tenant-a" });
assert.equal(retryWires.length, 2); assert.deepEqual(retryWires[1].provider.only, ["azure/eu"]);
assert(retryWires.every(p => !("order" in p.provider) && p.model === SOL && p.session_id === sticky.session_id));
let legacyWire;
globalThis.fetch = async (_url, init) => { legacyWire = JSON.parse(init.body); return response(); };
await orFetch(env, { model: SOL, messages: [], provider: { order: ["azure/eu", "azure/us"], only: ["azure/us", "azure/eu"] } }, { tenant: "tenant-a" });
assert.deepEqual(legacyWire.provider.order, ["azure/eu", "azure/us"], "legacy manual provider order is unchanged");
assert.equal(providerTc.taskProfile.providerIdentityUnresolved, true);
recordTaskServed(R, providerTc, { providerHost: "untrusted-host" });
assert.equal(providerTc.taskProfile.preferredHost, "azure/eu");

// BYOK remains a separate path, using the person's endpoint/model and no managed key.
let byokWire;
globalThis.fetch = async (url, init) => { byokWire = { url, body: JSON.parse(init.body) }; return response(); };
await openRouterChat({ BYOK: { model: "person/model", fast: "person/fast", base: "https://example.invalid/v1", key: "fixture-own-key" } }, { messages: [{ role: "user", content: "hello" }] }, "s");
assert.equal(byokWire.body.model, "person/model"); assert.equal(byokWire.url, "https://example.invalid/v1/chat/completions");
const seenUrls = [];
globalThis.fetch = async (url) => {
  seenUrls.push(String(url));
  if (String(url).endsWith("/models")) return Response.json({ data: [{ id: MUSE_C, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning: { mandatory: true, supported_efforts: ["low"] } }] });
  return Response.json({ data: { endpoints: [{ tag: "meta", context_length: 99999, max_completion_tokens: 12345, pricing: { prompt: "0.0000001", completion: "0.0000002" }, supported_parameters: ["tools", "max_tokens", "reasoning"], supports_tool_choice: { auto: true, none: true, required: true, function: true } }] } });
};
const liveShape = await taskModelCatalog(MUSE_C);
assert.equal(liveShape.context_length, 99999); assert.equal(liveShape.max_output, 12345);
assert.deepEqual(liveShape.tool_choice, ["auto"]);
assert.equal(seenUrls.length, 2);
globalThis.fetch = async () => Response.json({ data: [] });
await assert.rejects(taskModelCatalog(MUSE_C), /Published capabilities/);
console.log("PASS task-profile: 50 persisted turns, stable wire prefix/model/effort/cache identity, new defaults, privacy/provider/credential revocation, bounded same-model retry, overflow, reasoning, explicit transition, own-key legacy, published capabilities.");

