// node --import ./test/stubs/register.mjs test/model-dispatch.test.mjs
// Every dispatch adapter builds its request from the saved job alone: model, effort, max output, provider fields, and the job in the gateway log.
import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/ee/model-dispatch.js";
import { SEED, withSettings, ID } from "./helpers/seed-settings.mjs";

const gw = { CF_ACCOUNT_ID: "acct", AIG_ID: "gw", AIG_TOKEN: "tok", OPENROUTER_API_KEY: "k" };
const envWith = (mut = () => {}, extra = {}) => { const e = withSettings({ ...gw, ...extra }); mut(e.MODEL_SETTINGS); return e; };
function net(handler) {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body; const c = { url: String(url), body, init, meta: JSON.parse(init.headers?.["cf-aig-metadata"] || "{}") }; calls.push(c); return handler(c); };
  return { calls, done: () => { globalThis.fetch = real; } };
}
const chatOk = (model) => new Response(JSON.stringify({ model, provider: "Azure", choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
const allLevels = (s, ...ids) => { for (const id of ids) s.catalog[id] = { ...(s.catalog[id] || { id }), source: "CF", levels: ["unrestricted", "no_training", "zdr"] }; };
const msgs = { messages: [{ role: "user", content: "hello" }] };

test("chat: the saved model, effort, max output, sort and price cap are sent, and the job is in the gateway log", async () => {
  const env = envWith((s) => { s.jobs.label.max_output = 321; s.jobs.label.sort = "latency"; s.jobs.label.max_price = { prompt: 0.7, completion: 2 }; });
  const n = net((c) => chatOk(c.body.model));
  try {
    const r = await dispatch(env, "label", { ...msgs, max_tokens: 99999, model: "x/evil", provider: { order: ["a"], only: ["a"] }, models: ["y"], reasoning: { effort: "max" } }, { meta: { tenant: "t1", kind: "card-label" } });
    assert.equal(r.status, 200);
    const b = n.calls[0].body;
    assert.equal(b.model, env.MODEL_SETTINGS.jobs.label.model);
    assert.equal(b.max_tokens, Math.min(321, env.MODEL_SETTINGS.catalog[b.model]?.max_output ?? 321));
    assert.equal(b.provider.sort, "latency"); assert.deepEqual(b.provider.max_price, { prompt: 0.7, completion: 2 });
    for (const k of ["order", "only", "ignore"]) assert.ok(!(k in b.provider), k);
    assert.equal(b.models, undefined); assert.notEqual(b.reasoning?.effort, "max");
    assert.equal(n.calls[0].meta.job, "label"); assert.equal(n.calls[0].meta.env, undefined);
    assert.equal(r.served.model, b.model);
  } finally { n.done(); }
});

test("chat: the next model of the job answers when the first fails, and nothing outside the saved list is tried", async () => {
  const env = envWith((s) => { s.jobs.label.fallbacks = [{ model: ID.LUNA, effort: "low" }]; });
  const n = net((c) => c.body.model === env.MODEL_SETTINGS.jobs.label.model ? new Response("{}", { status: 503 }) : chatOk(c.body.model));
  try {
    const r = await dispatch(env, "label", msgs, { meta: { tenant: "t1" } });
    assert.equal(r.status, 200); assert.deepEqual(n.calls.map((c) => c.body.model), [env.MODEL_SETTINGS.jobs.label.model, ID.LUNA]);
  } finally { n.done(); }
  const n2 = net(() => new Response("{}", { status: 503 }));
  try { await assert.rejects(() => dispatch(env, "label", msgs, { meta: {} }), (e) => e.errors?.length === 2); } finally { n2.done(); }
});

test("chat: a Workers AI model of the job goes to env.AI.run, with the saved max output and no OpenRouter fields", async () => {
  const env = envWith((s) => { s.jobs.label = { ...s.jobs.label, model: ID.WAI_CHAT, effort: null, fallbacks: [], max_output: 123 }; allLevels(s, ID.WAI_CHAT); });
  const ran = []; env.AI = { run: async (m, input) => { ran.push({ m, input }); return { response: "ok" }; } };
  const n = net(() => { throw new Error("no network"); });
  try {
    const r = await dispatch(env, "label", msgs, { meta: { tenant: "t1" } });
    assert.equal((await r.json()).model, ID.WAI_CHAT);
    assert.equal(ran[0].m, ID.WAI_CHAT); assert.equal(ran[0].input.max_tokens, Math.min(123, env.MODEL_SETTINGS.catalog[ID.WAI_CHAT].max_output ?? 123)); assert.ok(!("provider" in ran[0].input)); assert.equal(n.calls.length, 0);
  } finally { n.done(); }
});

test("embeddings: OpenRouter gets the saved model and zero data retention, and no price cap unless one is saved", async () => {
  const env = envWith((s) => { s.jobs.embed_files.model = ID.EMBED_FILES; });
  const n = net(() => new Response(JSON.stringify({ data: [{ embedding: [1], index: 0 }] }), { status: 200 }));
  try {
    await dispatch(env, "embed_files", { input: ["a"], model: "x/other" }, { meta: { tenant: "t1" } });
    const c = n.calls[0]; assert.match(c.url, /\/embeddings$/); assert.equal(c.body.model, ID.EMBED_FILES); assert.equal(c.body.provider.zdr, true); assert.equal(c.body.provider.max_price, undefined);
    assert.equal(c.meta.job, "embed_files");
  } finally { n.done(); }
});

test("transcribe: each step gets its own body, a failing model moves on, and the saved provider has no host list", async () => {
  const env = envWith(); const stt = env.MODEL_SETTINGS.jobs.stt;
  const made = [];
  const n = net((c) => c.body.model === stt.model ? new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 }) : new Response(JSON.stringify({ text: "hi", segments: [] }), { status: 200 }));
  try {
    const r = await dispatch(env, "stt", { openrouter: ({ model, provider }) => { made.push({ model, provider }); const s = JSON.stringify({ model, provider, input_audio: { data: "AA" } }); return () => s; }, cloudflare: () => ({ audio: "AA" }) }, { meta: { tenant: "t1", kind: "stt" } });
    assert.equal((await r.json()).text, "hi");
    assert.equal(made[0].model, stt.model); assert.equal(made[0].provider.zdr, true); for (const k of ["order", "only", "ignore"]) assert.ok(!(k in made[0].provider));
    assert.ok(n.calls.every((c) => c.url.endsWith("/audio/transcriptions")) && n.calls.length >= 2);
  } finally { n.done(); }
});

test("transcribe: a Workers AI step runs on env.AI with the caller's input", async () => {
  const env = envWith((s) => { s.jobs.stt_cloudflare.model = ID.STT_WAI; allLevels(s, ID.STT_WAI); });
  const ran = []; env.AI = { run: async (m, input) => { ran.push({ m, input }); return { text: "ok", segments: [] }; } };
  const r = await dispatch(env, "stt_cloudflare", { cloudflare: () => ({ audio: "AA", task: "transcribe" }) }, { meta: { tenant: "t1" } });
  assert.equal((await r.json()).text, "ok"); assert.equal(ran[0].m, ID.STT_WAI); assert.equal(ran[0].input.audio, "AA");
});

test("decide_systemone: posts the saved model, provider fields and the questions to /systemone", async () => {
  const env = envWith((s) => { s.jobs.decider.model = ID.PPLX; s.jobs.decider.fallbacks = []; });
  const n = net(() => new Response(JSON.stringify({ answers: { a: { noul: 0.9 } }, model: "pplx", usage: { cost: 0 } }), { status: 200 }));
  try {
    const r = await dispatch(env, "decider", { state: { s: 1 }, questions: { a: { type: "noul" } } }, { meta: { tenant: "t1" } });
    const c = n.calls[0]; assert.match(c.url, /\/openrouter\/v1\/systemone$/); assert.equal(c.body.model, ID.PPLX); assert.deepEqual(c.body.state, { s: 1 }); assert.equal(c.body.provider.zdr, true);
    assert.equal(c.meta.kind, "decider"); assert.equal(c.meta.job, "decider"); assert.equal((await r.json()).answers.a.noul, 0.9);
  } finally { n.done(); }
});

test("decide_clef: runs the saved Workers AI decider model with the short model name", async () => {
  const CLEF = "@cf/cloudflare/clef-flash";
  const env = envWith((s) => { s.catalog[CLEF] = { id: CLEF, name: "Clef Flash", kinds: ["workers_decider"], efforts: [], source: "CF", levels: ["unrestricted", "no_training", "zdr"] }; s.jobs.decider = { model: CLEF, effort: null, fallbacks: [] }; }); const ran = [];
  env.AI = { run: async (m, input) => { ran.push({ m, input }); return { answers: { a: { noul: 0.1 } }, usage: {} }; } };
  const r = await dispatch(env, "decider", { state: {}, questions: { a: { type: "noul" } } }, { meta: { tenant: "t1" } });
  assert.equal(ran[0].m, CLEF); assert.equal(ran[0].input.model, "clef-flash"); assert.equal((await r.json()).answers.a.noul, 0.1);
});

test("decide_json: a JSON chat with require_parameters, through the chat route", async () => {
  const env = envWith((s) => { s.jobs.decider.model = ID.DEEPSEEK; s.jobs.decider.fallbacks = []; });
  const n = net((c) => chatOk(c.body.model));
  try {
    await dispatch(env, "decider", { ...msgs, response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } } }, { meta: { tenant: "t1" }, jsonLevels: async () => null });
    assert.equal(n.calls[0].body.provider.require_parameters, true); assert.equal(n.calls[0].body.max_tokens, undefined, "an empty saved max output sends no max_tokens");
  } finally { n.done(); }
});

test("look: Moondream runs on env.AI, and the saved max output applies to the question call only", async () => {
  const env = envWith((s) => { s.jobs.look.max_output = 222; allLevels(s, s.jobs.look.model); }); const ran = [];
  env.AI = { run: async (m, input) => { ran.push({ m, input }); return { answer: "yes" }; } };
  await dispatch(env, "look", { task: "query", image: "data:x", question: "q", max_tokens: 9999 }, { meta: { tenant: "t1" } });
  await dispatch(env, "look", { task: "caption", image: "data:x" }, { meta: { tenant: "t1" } });
  assert.equal(ran[0].m, env.MODEL_SETTINGS.jobs.look.model); assert.equal(ran[0].input.max_tokens, 222); assert.equal(ran[0].input.stream, false); assert.equal(ran[1].input.max_tokens, undefined);
});

test("search: the saved provider goes through the gateway, and the plan step is a gateway call with no provider object", async () => {
  const env = envWith();
  const calls = []; env.AI = { websearch: async (a) => { calls.push(a); return new Response(JSON.stringify({ items: [] }), { status: 200 }); } };
  const { plan } = await import("../src/ee/model-dispatch.js"), st = plan(env.MODEL_SETTINGS, "web_search", { level: "zdr" }).steps[0];
  assert.equal(st.source, "CF"); assert.equal(st.adapter, "search"); assert.equal(st.provider, null); assert.equal(st.privacy_note, undefined);
  await dispatch(env, "web_search", { query: "x", limit: 3 }, { meta: {} });
  assert.equal(calls[0].provider, st.model.split("/")[1]); assert.equal(calls[0].limit, 3);
});

test("live dictation: the Workers AI socket is opened through the gateway with logging off", async () => {
  const env = envWith(); const id = env.MODEL_SETTINGS.jobs.live_dictation.model; if (!id.startsWith("@cf/")) return;
  let seen; const ws = { accept() {}, close() {} };
  const r = await dispatch(env, "live_dictation", {}, { meta: { tenant: "t1" }, fetch: async (url, init) => { seen = { url, init }; return { status: 101, webSocket: ws }; } });
  assert.equal(r.webSocket, ws); assert.match(seen.url, /gateway\.ai\.cloudflare\.com\/v1\/acct\/gw\/workers-ai\?/); assert.ok(seen.url.includes(encodeURIComponent(id)) || seen.url.includes(id));
  assert.equal(seen.init.headers["cf-aig-collect-log"], "false");
});

test("no step can run: nothing is sent", async () => {
  const env = envWith((s) => { for (const j of Object.keys(s.catalog)) s.catalog[j].levels = []; });
  const n = net(() => { throw new Error("sent"); });
  try { await assert.rejects(() => dispatch(env, "label", msgs, { meta: {}, level: "zdr" }), (e) => e.privacyBlocked); assert.equal(n.calls.length, 0); } finally { n.done(); }
});

test("model_served: written when the served model changes, and not on every call", async () => {
  const { resetServedCache } = await import("../src/ee/model-served.js"); resetServedCache();
  const writes = []; const env = envWith(() => {}, { ENV_NAME: "dev", DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { writes.push({ sql, a }); return {}; }, first: async () => null }) }) } });
  let served = "x/a";
  const n = net((c) => new Response(JSON.stringify({ model: served, provider: "P", choices: [{ message: { content: "k" } }] }), { status: 200 }));
  try {
    for (let i = 0; i < 3; i++) await dispatch(env, "label", msgs, { meta: { tenant: "t1" } });
    assert.equal(writes.length, 1); assert.equal(writes[0].a[0], "dev"); assert.equal(writes[0].a[1], "label"); assert.equal(writes[0].a[3], "x/a");
    served = "x/b"; await dispatch(env, "label", msgs, { meta: { tenant: "t1" } });
    assert.equal(writes.length, 2); assert.equal(writes[1].a[3], "x/b");
  } finally { n.done(); }
});

test("a Cloudflare model with no verified zdr route still runs at zdr, and the plan carries a privacy note", async () => {
  const env = envWith(); env.AI = { run: async () => ({ text: "x" }) };
  const r = await dispatch(env, "look", { task: "caption", image: "d" }, { meta: {}, level: "zdr" }); assert.equal(r.status, 200);
  const { plan } = await import("../src/ee/model-dispatch.js");
  assert.match(plan(env.MODEL_SETTINGS, "look", { level: "zdr" }).steps[0].privacy_note, /no training, not zero retention/);
  assert.equal(plan(env.MODEL_SETTINGS, "look", { level: "no_training" }).steps[0].privacy_note, undefined);
  assert.equal(plan(env.MODEL_SETTINGS, "label", { level: "zdr" }).steps.find((s) => s.source === "OR").privacy_note, undefined);
});

// ---- empty max output, and what answered each call (Captain 2026-10-17) ----
test("an empty saved max output sends no max_tokens, on OpenRouter and on Cloudflare, and no caller or plan override can set one", async () => {
  const { plan } = await import("../src/ee/model-plan.js");
  const env = envWith();
  assert.equal(env.MODEL_SETTINGS.jobs.label.max_output ?? null, null);
  assert.equal(plan(env.MODEL_SETTINGS, "label", { level: "zdr", call: { maxOutput: 100 } }).steps[0].maxOutput, null, "a per call maxOutput is gone");
  const n = net((c) => chatOk(c.body.model));
  try {
    await dispatch(env, "label", { ...msgs, max_tokens: 99999 }, { meta: { tenant: "t1" } });
    assert.equal("max_tokens" in n.calls[0].body, false, "the caller's max_tokens never reaches the wire, and nothing replaces it");
  } finally { n.done(); }
  const cf = envWith((s) => { s.jobs.label = { ...s.jobs.label, model: ID.WAI_CHAT, effort: null, fallbacks: [] }; allLevels(s, ID.WAI_CHAT); });
  const ran = []; cf.AI = { run: async (m, input) => { ran.push(input); return { response: "ok" }; } };
  await dispatch(cf, "label", msgs, { meta: { tenant: "t1" } });
  assert.equal("max_tokens" in ran[0], false);
});

const served = (rows) => rows.at(-1)?.a;   // [environment, job, requested, served_model, served_provider, ...]
const servedEnv = (writes, extra = {}) => envWith(() => {}, { ENV_NAME: "dev", DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { writes.push({ sql, a }); return {}; }, first: async () => null }) }) }, ...extra });
test("served model: each adapter records what the answer says, never the requested ID", async () => {
  const { resetServedCache } = await import("../src/ee/model-served.js");
  const wait = () => new Promise((z) => setTimeout(z, 5));
  // decide_systemone: the request names an alias, the answer names the dated model and the provider
  resetServedCache(); let writes = []; let env = servedEnv(writes);
  const alias = "~perplexity/pplx-decider-latest";
  env.MODEL_SETTINGS.catalog[alias] = { id: alias, name: "Perplexity Decider (latest)", source: "OR", kinds: ["decider"], eligible: true, reasons: [], efforts: ["default"], levels: ["unrestricted", "no_training", "zdr"], hosts: ["perplexity"], context_length: 100000, max_output: 1000, input_modalities: ["text"], pricing: { prompt: 0.02, completion: 0 }, json: false, tool_choice: [] };
  env.MODEL_SETTINGS.jobs.decider = { model: alias, effort: null, fallbacks: [] };
  let n = net(() => new Response(JSON.stringify({ model: "perplexity/pplx-decider-v1.2-20261016", provider: "Perplexity", answers: { a: { noul: 0.5 } }, usage: { cost: 0 } }), { status: 200 }));
  try { await dispatch(env, "decider", { state: {}, questions: { a: { type: "noul", instructions: "x" } } }, { meta: { tenant: "t1" } }); await wait(); } finally { n.done(); }
  assert.equal(served(writes)[2], alias); assert.equal(served(writes)[3], "perplexity/pplx-decider-v1.2-20261016"); assert.equal(served(writes)[4], "Perplexity");
  // decide_json (a chat model on the decider job)
  resetServedCache(); writes = []; env = servedEnv(writes); env.MODEL_SETTINGS.jobs.decider = { model: ID.DEEPSEEK, effort: null, fallbacks: [] };
  n = net(() => new Response(JSON.stringify({ model: "deepseek/deepseek-v4.1-flash-20260901", provider: "Together", choices: [{ message: { content: "{}" } }] }), { status: 200 }));
  try { await dispatch(env, "decider", { ...msgs, response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } } }, { meta: { tenant: "t1" } }); await wait(); } finally { n.done(); }
  assert.equal(served(writes)[3], "deepseek/deepseek-v4.1-flash-20260901"); assert.equal(served(writes)[4], "Together");
  // embeddings on OpenRouter
  resetServedCache(); writes = []; env = servedEnv(writes); env.MODEL_SETTINGS.jobs.embed_files.model = ID.EMBED_FILES;
  n = net(() => new Response(JSON.stringify({ model: "perplexity/pplx-embed-v1-0.6b-20260801", provider: "DeepInfra", data: [{ embedding: [1], index: 0 }] }), { status: 200 }));
  try { await dispatch(env, "embed_files", { input: ["x"] }, { meta: { tenant: "t1" } }); await wait(); } finally { n.done(); }
  assert.equal(served(writes)[3], "perplexity/pplx-embed-v1-0.6b-20260801"); assert.equal(served(writes)[4], "DeepInfra");
  // an answer that names nothing records no served model: the requested ID is not copied in its place
  resetServedCache(); writes = []; env = servedEnv(writes);
  n = net(() => new Response(JSON.stringify({ choices: [{ message: { content: "k" } }] }), { status: 200 }));
  try { await dispatch(env, "label", msgs, { meta: { tenant: "t1" } }); await wait(); } finally { n.done(); }
  assert.equal(served(writes)[2], env.MODEL_SETTINGS.jobs.label.model); assert.equal(served(writes)[3], null); assert.equal(served(writes)[4], null);
  // a Cloudflare step: the requested @cf ID, provider "cloudflare"
  resetServedCache(); writes = []; env = servedEnv(writes); env.MODEL_SETTINGS.jobs.label = { ...env.MODEL_SETTINGS.jobs.label, model: ID.WAI_CHAT, effort: null, fallbacks: [] }; allLevels(env.MODEL_SETTINGS, ID.WAI_CHAT);
  env.AI = { run: async () => ({ response: "ok" }) };
  await dispatch(env, "label", msgs, { meta: { tenant: "t1" } }); await wait();
  assert.equal(served(writes)[3], ID.WAI_CHAT); assert.equal(served(writes)[4], "cloudflare");
});

test("served model: the main chat (a routed call) records its category job, with the model and provider from the stream", async () => {
  const { resetServedCache } = await import("../src/ee/model-served.js"); resetServedCache();
  const { policyRoute } = await import("../src/ee/route2.js");
  const writes = []; const env = servedEnv(writes);
  const route = policyRoute(env.MODEL_SETTINGS, "technical", "zdr", "x");
  const n = net((c) => new Response(`data: ${JSON.stringify({ model: `${c.body.model}-served`, provider: "Fireworks", choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }));
  try { const r = await dispatch(env, "chat", { ...msgs, stream: true }, { meta: { tenant: "t1" }, route, session: "s1" }); await r.text(); await new Promise((z) => setTimeout(z, 5)); } finally { n.done(); }
  const row = served(writes); assert.equal(row[1], "chat:technical"); assert.match(row[3], /-served$/); assert.equal(row[4], "Fireworks");
  assert.equal(row[2], route.served, "requested is the exact list entry that answered");
});

test("served model: each routing category has its own row, a route with no category is General's, and a failed reply is recorded on its category row", async () => {
  const { resetServedCache, servedJobOf } = await import("../src/ee/model-served.js");
  const { policyRoute } = await import("../src/ee/route2.js");
  assert.equal(servedJobOf("label"), "label"); assert.equal(servedJobOf("chat", {}), "chat:general"); assert.equal(servedJobOf("chat", { taskProfile: { category: "research" } }), "chat:research"); assert.equal(servedJobOf("chat", { category: "skills", taskProfile: { category: "research" } }), "chat:skills");
  resetServedCache(); const writes = []; const env = servedEnv(writes);
  const n = net((c) => new Response(`data: ${JSON.stringify({ model: c.body.model, provider: "P", choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }));
  try {
    for (const cat of ["general", "technical", "research"]) { const r = await dispatch(env, "chat", { ...msgs, stream: true }, { meta: { tenant: "t1" }, route: policyRoute(env.MODEL_SETTINGS, cat, "zdr", "x"), session: "s1" }); await r.text(); }
    await new Promise((z) => setTimeout(z, 5));
  } finally { n.done(); }
  const rows = new Set(writes.map((w) => w.a[1]));
  assert.ok(rows.has("chat:general") && rows.has("chat:technical") && rows.has("chat:research"), "one row for each category: " + [...rows]);
    assert.ok(!writes.some((w) => w.a[1] === "chat"), "nothing is recorded under the shared chat row any more");
});

test("served model: a job that answers records its requested entry even when the answer names no model", async () => {
  const { resetServedCache } = await import("../src/ee/model-served.js");
  resetServedCache(); const writes = []; const env = servedEnv(writes);
  const n = net(() => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
  try { await dispatch(env, "label", msgs, { meta: { tenant: "t1" } }); await new Promise((z) => setTimeout(z, 5)); } finally { n.done(); }
  assert.equal(served(writes)[1], "label"); assert.equal(served(writes)[2], env.MODEL_SETTINGS.jobs.label.model); assert.equal(served(writes)[3], null);
});

test("served model: Workers AI jobs (the backup chat, the browser look) and web search each record their requested entry", async () => {
  const { resetServedCache } = await import("../src/ee/model-served.js");
  resetServedCache(); const writes = []; const env = servedEnv(writes);
  env.AI = { run: async (m) => (m.includes("moondream") ? { answer: "a page", caption: "x", points: [] } : { response: "ok" }), websearch: async () => ({ ok: true, results: [] }) };
  env.AIG_ID = "g";
  await dispatch(env, "workers_ai_chat", msgs, { meta: { tenant: "t1" } });
  await dispatch(env, "look", { task: "query", image: "data:image/png;base64,AA==", question: "q" }, { meta: { tenant: "t1" } });
  await dispatch(env, "web_search", { query: "q", limit: 3 }, { meta: { kind: "web-search" } });
  await new Promise((z) => setTimeout(z, 5));
  const rows = Object.fromEntries(writes.map((w) => [w.a[1], w.a]));
  for (const job of ["workers_ai_chat", "look", "web_search"]) { assert.ok(rows[job], `${job} has a row`); assert.equal(rows[job][2], env.MODEL_SETTINGS.jobs[job].model, `${job} records the entry that answered`); }
});

test("structured request: a model with no endpoint accepting response_format at the job's level gets prompt-only JSON, and one with support keeps json_schema", async () => {
  const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
  const request = { ...msgs, response_format: { type: "json_schema", json_schema: { name: "x", strict: true, schema } } };
  const run = async (json_levels, jsonLevels = null) => {
    const env = envWith((s) => { s.catalog[s.jobs.label.model] = { ...s.catalog[s.jobs.label.model], levels: ["unrestricted", "no_training", "zdr"], json_levels }; }, {});
    const n = net((c) => chatOk(c.body.model));
    try { await dispatch(env, "label", request, { meta: { tenant: "t1", kind: "card-label" }, level: "zdr", jsonLevels }); return n.calls[0].body; } finally { n.done(); }
  };
  const without = await run(["unrestricted"]);
  assert.equal(without.response_format, undefined);
  assert.ok(!JSON.stringify(without.messages.at(-1)).includes("json_schema"));
  assert.match(without.messages.at(-1).content, /JSON schema/);
  assert.equal(without.messages.length, 2);
  const withSupport = await run(["unrestricted", "zdr"]);
  assert.equal(withSupport.response_format.type, "json_schema");
  assert.equal(withSupport.provider.require_parameters, true);
  const older = await run(undefined, async () => null);
  assert.equal(older.response_format.type, "json_schema");
});

test("structured request: a saved record without json_levels is checked against the live endpoints, and a failed lookup keeps json_schema", async () => {
  const request = { ...msgs, response_format: { type: "json_schema", json_schema: { name: "x", strict: true, schema: { type: "object" } } } };
  const run = async (jsonLevels) => {
    const env = envWith();
    const n = net((c) => chatOk(c.body.model));
    try { await dispatch(env, "label", request, { meta: { tenant: "t1" }, level: "zdr", jsonLevels }); return n.calls[0].body; } finally { n.done(); }
  };
  const seen = []; const none = await run(async (id) => { seen.push(id); return ["unrestricted"]; });
  assert.equal(none.response_format, undefined); assert.equal(seen.length, 1);
  assert.equal((await run(async () => ["unrestricted", "zdr"])).response_format.type, "json_schema");
  assert.equal((await run(async () => { throw new Error("down"); })).response_format.type, "json_schema");
});

test("jsonLevelsFor: one live lookup per model, and a failure answers null", async () => {
  const { jsonLevelsFor, resetJsonLevelCache } = await import("../src/ee/model-catalog.js");
  resetJsonLevelCache(); let n = 0;
  const lookup = async () => { n++; return { json_levels: ["unrestricted"] }; };
  assert.deepEqual(await jsonLevelsFor("openai/x-y", {}, { lookup }), ["unrestricted"]); await jsonLevelsFor("openai/x-y", {}, { lookup }); assert.equal(n, 1);
  assert.equal(await jsonLevelsFor("openai/z-y", {}, { lookup: async () => { throw new Error("x"); } }), null);
});

test("gateway log: the routed chat sends the session (the OpenRouter session_id), and tenant, session, channel, kind and px are never pushed out, and job is the key dropped from the main chat", async () => {
  const { policyRoute } = await import("../src/ee/route2.js");
  const { aigMeta } = await import("../src/model.js");
  const env = envWith(), route = policyRoute(env.MODEL_SETTINGS, "technical", "zdr", "x");
  const n = net((c) => new Response(`data: ${JSON.stringify({ model: c.body.model, provider: "Fireworks", choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }));
  try {
    // The main chat's own meta: tenant, channel, kind and px (a cache-prefix label). dispatch adds job, and the session comes with the call.
    const r = await dispatch(env, "chat", { ...msgs, stream: true }, { meta: { tenant: "t1", channel: "main", kind: "chat", px: "prefix.run" }, route, session: "res-abc" }); await r.text();
    const c = n.calls[0];
    assert.equal(c.meta.session, c.body.session_id, "the gateway tag is the same value as the OpenRouter session_id");
    assert.deepEqual(Object.keys(c.meta).sort(), ["channel", "kind", "px", "session", "tenant"], "job is the key dropped when the main chat sends all six");
  } finally { n.done(); }
  // Direct check of the ordering rule: the first five of tenant, session, channel, kind, px, job win over extras, whatever order the caller built the object in.
  const m = aigMeta({}, { other: "o", job: "chat", px: "p", kind: "chat", channel: "c", session: "s", tenant: "t", _prov: "x" });
  assert.deepEqual(Object.keys(m).sort(), ["channel", "kind", "px", "session", "tenant"]);
  // A saved job's call (fewer than five keys) keeps everything, job included, and an extra key fills a free slot.
  assert.deepEqual(Object.keys(aigMeta({}, { tenant: "t", kind: "card-label", job: "label", session: "s" })).sort(), ["job", "kind", "session", "tenant"]);
  assert.deepEqual(Object.keys(aigMeta({}, { tenant: "t", channel: "c", kind: "chat", other: "o", job: "chat" })).sort(), ["channel", "job", "kind", "other", "tenant"]);
  // Values are capped at 64 characters, and numbers and booleans stay as they are.
  assert.equal(aigMeta({}, { session: "s".repeat(100), n: 3 }).session.length, 64); assert.equal(aigMeta({}, { n: 3 }).n, 3);
});
