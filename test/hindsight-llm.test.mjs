// node --import ./test/stubs/register.mjs test/hindsight-llm.test.mjs
// The Worker endpoint for the Hindsight memory server's model calls (src/ee/hindsight-llm.js): the shared secret, the path to saved job mapping, the saved settings that
// reach the wire, the bank id that never leaves the Worker, the Cloud switch gate, streaming, errors and the reranker.
import test from "node:test";
import assert from "node:assert/strict";
import { hindsightRoute, bankParts, cleanChatRequest, HS_PROXY_HEADER, MAX_BODY } from "../src/ee/hindsight-llm.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { SEED, withSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const TENANT = "11111111-2222-3333-4444-555555555555", DEV_BANK = `dev-${TENANT}-main`, LIVE_BANK = `live-${TENANT}-main`;
const KEY = "test-key-not-a-secret";
const gw = { CF_ACCOUNT_ID: "acct", AIG_ID: "gw", AIG_TOKEN: "tok", OPENROUTER_API_KEY: "k", HINDSIGHT_LLM_KEY: KEY };
const envFor = (name, mut = () => {}, extra = {}) => { const e = withSettings({ ...gw, ENV_NAME: name, PROMPT_CACHE: "off", ...extra }); mut(e.MODEL_SETTINGS); e.MODEL_SETTINGS = validateModelSettings(e.MODEL_SETTINGS); return e; };
function net(handler) {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { const text = typeof init.body === "string" ? init.body : ""; const c = { url: String(url), text, body: text ? JSON.parse(text) : null, init, headers: init.headers || {}, meta: JSON.parse(init.headers?.["cf-aig-metadata"] || "{}") }; calls.push(c); return handler(c); };
  return { calls, done: () => { globalThis.fetch = real; } };
}
const chatOk = (model = "served/model") => new Response(JSON.stringify({ model, provider: "Azure", choices: [{ message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 } }), { status: 200, headers: { "content-type": "application/json" } });
const post = (path, body, { key = KEY, headers = {} } = {}) => new Request(`https://selfhost.example.com${path}`, { method: "POST", headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const route = (req, env) => hindsightRoute(req, env, null, new URL(req.url));
const chatBody = (extra = {}) => ({ model: "decoy/hindsight-model", user: DEV_BANK, messages: [{ role: "user", content: "hello" }], ...extra });
const LLM = (job) => `/_hs/llm/${job}/v1/chat/completions`, RANK = "/_hs/rerank/v1/systemone";
const questions = { rank: { type: "choice", instructions: "pick the best", criteria: { c0: "a", c1: "b" } } };
const rankOk = (model = "served/ranker") => new Response(JSON.stringify({ model, answers: { rank: { probabilities: { c0: 0.7, c1: 0.3 }, choice: "c0" } }, usage: { cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
test("bank ids: the gateway tag parts", () => {
  assert.deepEqual(bankParts(DEV_BANK), { tenant: TENANT, channel: "main" }); assert.deepEqual(bankParts(`dev-${TENANT}-project-x`), { tenant: TENANT, channel: "project-x" });
  assert.deepEqual(bankParts(`selfhost-${TENANT}-main`), { tenant: TENANT, channel: "main" });
  assert.deepEqual(bankParts(`a2a-dev-${TENANT}-abc123`), { tenant: TENANT, channel: "a2a" }); assert.deepEqual(bankParts("hs-memtest-1"), { tenant: null, channel: null });
  assert.deepEqual(bankParts(""), { tenant: null, channel: null }); assert.deepEqual(bankParts(undefined), { tenant: null, channel: null });
});
test("secret: no secret set is 503, a missing or wrong key is 401, other methods and paths are refused, and every answer says it came from the endpoint", async () => {
  const n = net(() => chatOk());
  try {
    const env = envFor("selfhost");
    const noSecret = await route(post(LLM("retain"), chatBody()), { ...env, HINDSIGHT_LLM_KEY: undefined });
    assert.equal(noSecret.status, 503); assert.equal(noSecret.headers.get(HS_PROXY_HEADER), "1");
    for (const key of [null, "wrong", `${KEY}x`, KEY.slice(1)]) { const r = await route(post(LLM("retain"), chatBody(), { key }), env); assert.equal(r.status, 401, String(key)); assert.equal(r.headers.get(HS_PROXY_HEADER), "1"); }
    assert.equal((await route(new Request(`https://selfhost.example.com${LLM("retain")}`, { method: "GET" }), env)).status, 405);
    assert.equal((await route(post("/_hs/llm/other/v1/chat/completions", chatBody()), env)).status, 404);
    assert.equal((await route(post("/_hs/llm/retain/v1/models", chatBody()), env)).status, 404);
    assert.equal((await route(post(LLM("retain"), "not json"), env)).status, 400); assert.equal((await route(post(LLM("retain"), { user: DEV_BANK }), env)).status, 400);
    assert.equal((await route(post(RANK, { questions }), env)).status, 400);
    assert.equal(n.calls.length, 0, "a refused call sends nothing");
  } finally { n.done(); }
});
test("job mapping: each path runs its own saved job, and the startup check uses the consolidation settings", async () => {
  const ids = { retain: "hs_retain", consolidation: "hs_consolidation", reflect: "hs_reflect", refresh: "hs_refresh", default: "hs_consolidation" };
  const record = (id) => ({ id, name: id, eligible: true, reasons: [], efforts: ["default", "none", "low", "medium", "high"], default_effort: "low", levels: ["unrestricted", "no_training", "zdr"], hosts: ["h"], context_length: 100000, max_output: 8000, input_modalities: ["text"], pricing: { prompt: 1, completion: 1 }, json: true, tool_choice: ["auto"] });
  const env = envFor("selfhost", (s) => { for (const id of ["hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh"]) { const m = `sentinel/${id}`; s.catalog[m] = record(m); s.jobs[id].model = m; } });
  const n = net((c) => chatOk(c.body.model));
  try {
    for (const [path, job] of Object.entries(ids)) {
      const r = await route(post(LLM(path), chatBody(path === "default" ? { user: undefined } : {})), env);
      assert.equal(r.status, 200, path); assert.equal(n.calls.at(-1).body.model, `sentinel/${job}`, path);
      assert.equal(n.calls.at(-1).meta.job, job, "the job is in the gateway log"); assert.equal(n.calls.at(-1).meta.kind, path === "default" ? "memory-check" : `memory-${path}`);
    }
    assert.equal(n.calls.length, 5);
  } finally { n.done(); }
});
test("saved settings reach the wire: model, reasoning level, max output, sort, max price, zero data retention, and nothing Hindsight chose for itself", async () => {
  const env = envFor("selfhost", (s) => { Object.assign(s.jobs.hs_reflect, { max_output: 777, sort: "latency", max_price: { prompt: 0.4, completion: 1.2 } }); s.jobs.hs_reflect.effort = "high"; });
  const n = net((c) => chatOk(c.body.model));
  try {
    const r = await route(post(LLM("reflect"), chatBody({ max_tokens: 99999, max_completion_tokens: 88888, reasoning_effort: "none", provider: { only: ["evil"], order: ["evil"] }, models: ["x/y"], reasoning: { effort: "low" }, prompt_cache_key: "k", extra_body: { x: 1 }, metadata: { a: 1 },
      tools: [{ type: "function", function: { name: "search", parameters: { type: "object" } } }], tool_choice: "required", response_format: { type: "json_object" }, temperature: 0.9 })), env);
    assert.equal(r.status, 200);
    const b = n.calls[0].body, job = env.MODEL_SETTINGS.jobs.hs_reflect;
    assert.equal(b.model, job.model); assert.equal(b.max_tokens, 777); assert.deepEqual(b.reasoning, { effort: "high" });
    assert.equal(b.provider.sort, "latency"); assert.deepEqual(b.provider.max_price, { prompt: 0.4, completion: 1.2 }); assert.equal(b.provider.zdr, true); assert.equal(b.provider.data_collection, "deny"); assert.equal(b.provider.require_parameters, true);
    for (const k of ["order", "only", "ignore"]) assert.ok(!(k in b.provider), k);
    for (const k of ["user", "models", "max_completion_tokens", "reasoning_effort", "prompt_cache_key", "extra_body", "metadata"]) assert.ok(!(k in b), `${k} is not sent`);
    assert.deepEqual(b.tools, [{ type: "function", function: { name: "search", parameters: { type: "object" } } }]); assert.equal(b.tool_choice, "required"); assert.deepEqual(b.response_format, { type: "json_object" });
    assert.equal(b.temperature, 0.9, "a temperature the model takes is kept");
    // an empty output limit sends none
    const env2 = envFor("selfhost", (s) => { s.jobs.hs_reflect.max_output = null; }), n2 = net((c) => chatOk(c.body.model));
    try { await route(post(LLM("reflect"), chatBody({ max_tokens: 5 })), env2); assert.ok(!("max_tokens" in n2.calls[0].body)); } finally { n2.done(); }
  } finally { n.done(); }
  // a saved timeout stops the attempt
  const env3 = envFor("selfhost", (s) => { s.jobs.hs_retain.timeout_ms = 1000; }), slow = net(async (c) => { await new Promise((ok, no) => { const keep = setTimeout(ok, 5000); c.init.signal?.addEventListener("abort", () => { clearTimeout(keep); no(Object.assign(new Error("aborted"), { name: "TimeoutError" })); }); }); return chatOk(); });
  try { const r = await route(post(LLM("retain"), chatBody()), env3); assert.ok([502, 504].includes(r.status), String(r.status)); assert.equal(r.headers.get(HS_PROXY_HEADER), "1"); } finally { slow.done(); }
});
test("the model's facts decide the temperature and the tool choice, not the name Hindsight guessed from", () => {
  const luna = SEED.jobs.hs_retain.model, flash = SEED.jobs.hs_reflect.model;
  assert.equal(SEED.catalog[luna].quirks.no_temperature, true);
  assert.ok(!("temperature" in cleanChatRequest({ messages: [], temperature: 0.1 }, SEED, "hs_retain")), "no_temperature drops it");
  assert.equal(cleanChatRequest({ messages: [], temperature: 0 }, SEED, "hs_consolidation").temperature, 0, "a model that takes one keeps it");
  assert.ok(!("temperature" in cleanChatRequest({ messages: [] }, SEED, "hs_consolidation")), "none is ever added");
  const s = clone(SEED); s.catalog[flash].quirks = { auto_tool_choice_only: true };
  assert.ok(!("tool_choice" in cleanChatRequest({ messages: [], tool_choice: "required" }, s, "hs_reflect")), "only automatic choice: the forced choice is dropped");
  assert.equal(cleanChatRequest({ messages: [], tool_choice: "auto" }, s, "hs_reflect").tool_choice, "auto");
  // a fallback that refuses a temperature counts for the whole job, because the same request goes to each step
  const t = clone(SEED); t.jobs.hs_consolidation.fallbacks = [{ model: luna, effort: "low" }]; t.catalog[luna] = clone(SEED.catalog[luna]);
  assert.ok(!("temperature" in cleanChatRequest({ messages: [], temperature: 0 }, t, "hs_consolidation")));
  const m = cleanChatRequest({ messages: [{ role: "assistant", content: "x", tool_calls: [], reasoning_content: "" }, { role: "assistant", content: "y", reasoning_content: "kept" }] }, SEED, "hs_reflect").messages;
  assert.ok(!("reasoning_content" in m[0])); assert.equal(m[1].reasoning_content, "kept");
});
test("fallbacks: the next model of the saved job answers when the first fails, and the job's own error status goes back to Hindsight", async () => {
  const env = envFor("selfhost", (s) => { s.jobs.hs_consolidation.fallbacks = [{ model: s.jobs.hs_retain.model, effort: "low" }]; });
  const first = env.MODEL_SETTINGS.jobs.hs_consolidation.model, second = env.MODEL_SETTINGS.jobs.hs_retain.model;
  const n = net((c) => c.body.model === first ? new Response("{}", { status: 503 }) : chatOk(c.body.model));
  try { const r = await route(post(LLM("consolidation"), chatBody()), env); assert.equal(r.status, 200); assert.deepEqual(n.calls.map((c) => c.body.model), [first, second]); } finally { n.done(); }
  const rate = net(() => new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 }));
  try { const r = await route(post(LLM("retain"), chatBody()), env), j = await r.json(); assert.equal(r.status, 429); assert.equal(j.error.code, 429); assert.equal(r.headers.get(HS_PROXY_HEADER), "1"); } finally { rate.done(); }
});
test("the bank id never leaves the Worker: not in the body, not in any header, and the gateway log carries only the tenant, channel, job and kind", async () => {
  const env = envFor("selfhost"), n = net(() => chatOk());
  try {
    await route(post(LLM("retain"), chatBody({ user: DEV_BANK, messages: [{ role: "user", content: "hello" }] }), { headers: { "x-hindsight-bank-id": DEV_BANK } }), env);
    const c = n.calls[0], whole = JSON.stringify({ body: c.text, headers: c.headers, url: c.url });
    assert.ok(!whole.includes(DEV_BANK), "the whole bank id is not sent"); assert.ok(!("user" in c.body));
    assert.deepEqual(c.meta, { kind: "memory-retain", tenant: TENANT, channel: "main", job: "hs_retain" });
    assert.ok(c.url.startsWith("https://gateway.ai.cloudflare.com/v1/acct/gw/openrouter/v1/chat/completions"), "through the AI Gateway");
    assert.ok(!/memory-retain.*hindsight/i.test(c.headers.authorization || ""), "the OpenRouter key, not the shared secret");
    assert.equal(c.headers.authorization, "Bearer k"); assert.ok(!whole.includes(KEY), "the shared secret is not sent on");
    // the reranker's bank id is in a header the same way
    const rn = net(() => rankOk());
    try {
      await route(post(RANK, { model: "decoy", state: "Question: x", questions }, { headers: { "x-hindsight-bank-id": DEV_BANK } }), env);
      const rc = rn.calls[0]; assert.ok(!JSON.stringify({ body: rc.text, headers: rc.headers }).includes(DEV_BANK)); assert.equal(rc.meta.tenant, TENANT); assert.equal(rc.meta.job, "hs_rerank");
    } finally { rn.done(); }
    // no tenant part: nothing about it is invented
    const odd = net(() => chatOk());
    try { await route(post(LLM("retain"), chatBody({ user: "hs-memtest-7" })), env); assert.equal(odd.calls[0].meta.tenant, undefined); assert.ok(!odd.calls[0].text.includes("hs-memtest-7")); } finally { odd.done(); }
  } finally { n.done(); }
});
test("streaming and structured output pass through", async () => {
  const env = envFor("selfhost"), sse = "data: {\"model\":\"served/m\",\"provider\":\"Azure\",\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}],\"usage\":{\"cost\":0.001}}\n\ndata: [DONE]\n\n";
  const n = net(() => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
  try {
    const r = await route(post(LLM("reflect"), chatBody({ stream: true, stream_options: { include_usage: true } })), env);
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /event-stream/); assert.equal(await r.text(), sse); assert.equal(n.calls[0].body.stream, true);
  } finally { n.done(); }
  const schema = { type: "json_schema", json_schema: { name: "response", strict: true, schema: { type: "object", properties: { facts: { type: "array" } } } } }, m = net((c) => c.body ? chatOk(c.body.model) : new Response("{}", { status: 404 }));
  try { const r = await route(post(LLM("retain"), chatBody({ response_format: schema, temperature: 0.1 })), env); assert.equal(r.status, 200); const b = m.calls.find((c) => c.url.endsWith("/chat/completions")).body; assert.deepEqual(b.response_format, schema); assert.equal(b.provider.require_parameters, true); assert.ok(!("temperature" in b), "luna takes none"); } finally { m.done(); }
});
test("reranker: the saved ranking model answers, the raw answer with every probability comes back, and a model that is not a ranking model is refused when saved", async () => {
  const env = envFor("selfhost", (s) => { const m = "sentinel/ranker"; s.catalog[m] = { id: m, name: "Ranker", kinds: ["decider"], efforts: [] }; s.jobs.hs_rerank.model = m; });
  const n = net((c) => rankOk(c.body.model));
  try {
    const r = await route(post(RANK, { model: "decoy/memory-ranker", state: "Question: where", questions, user: DEV_BANK }, { headers: { "x-hindsight-bank-id": DEV_BANK } }), env), j = await r.json();
    assert.equal(r.status, 200); assert.deepEqual(j.answers.rank.probabilities, { c0: 0.7, c1: 0.3 });
    const c = n.calls[0]; assert.ok(c.url.endsWith("/systemone")); assert.equal(c.body.model, "sentinel/ranker"); assert.equal(c.body.state, "Question: where"); assert.deepEqual(c.body.questions, questions);
    assert.equal(c.body.provider.zdr, true); assert.ok(!("user" in c.body));
  } finally { n.done(); }
  const s = clone(SEED); const lunaFacts = s.catalog[s.jobs.hs_retain.model]; s.jobs.hs_rerank.model = s.jobs.hs_retain.model; assert.ok(lunaFacts);
  assert.throws(() => validateModelSettings(s), /can't be used|Needs a ranking model/);
  const t = clone(SEED); t.jobs.hs_rerank.effort = "low"; assert.throws(() => validateModelSettings(t), /no reasoning level/);
  const u = clone(SEED); u.jobs.hs_rerank.max_output = 100; assert.throws(() => validateModelSettings(u), /no text/);
});
test("settings that cannot be read, or a job with no model that can run, answer 503 and send nothing", async () => {
  const n = net(() => chatOk());
  try {
    const noSettings = { ...gw, ONEHELM_EE: "1hc", ENV_NAME: "selfhost", PROMPT_CACHE: "off", DB: { withSession() { return this; }, prepare() { throw new Error("db down"); } } };
    const r = await route(post(LLM("retain"), chatBody()), noSettings); assert.equal(r.status, 503); assert.equal(r.headers.get(HS_PROXY_HEADER), "1");
    assert.equal(n.calls.length, 0);
  } finally { n.done(); }
});
test("the memory jobs are saved jobs with the memory server's starting values", () => {
  const j = SEED.jobs;
  assert.deepEqual([j.hs_retain.model, j.hs_consolidation.model, j.hs_reflect.model, j.hs_refresh.model, j.hs_rerank.model], ["~openai/gpt-luna-latest", "~deepseek/deepseek-flash-latest", "~deepseek/deepseek-flash-latest", "~deepseek/deepseek-flash-latest", "~perplexity/pplx-decider-latest"]);
  assert.deepEqual([j.hs_retain.effort, j.hs_consolidation.effort, j.hs_reflect.effort, j.hs_refresh.effort, j.hs_rerank.effort], ["low", "none", "low", "low", null]);
  assert.deepEqual([j.hs_retain, j.hs_consolidation, j.hs_reflect, j.hs_refresh, j.hs_rerank].map((x) => x.fallbacks.length), [0, 0, 0, 0, 0]);
});

test("one environment: any bank id is served here with this Worker's saved settings, and no request is sent anywhere but the model provider", async () => {
  const env = envFor("selfhost", (s) => { s.jobs.hs_retain.max_output = 4242; }, {}), n = net((c) => chatOk(c.body.model));
  try {
    for (const user of [DEV_BANK, LIVE_BANK, undefined, "hs-memtest-1", `a2a-live-${TENANT}-abc123`]) { const r = await route(post(LLM("retain"), chatBody({ user })), env); assert.equal(r.status, 200, String(user)); assert.equal(n.calls.at(-1).body.max_tokens, 4242); }
    assert.equal((await route(post(LLM("retain"), chatBody({ user: LIVE_BANK }), { headers: { "x-hs-forwarded": "1" } }), env)).status, 200);
  } finally { n.done(); }
});

test("the Cloud switch: without ONEHELM_EE the route is a 404 in the Worker's route gate, with it the route is open to the endpoint", async () => {
  const { routeEnabled } = await import("../src/ee/index.js");
  for (const p of [LLM("retain"), LLM("default"), RANK, "/_hs/anything"]) { assert.equal(routeEnabled({}, p), false, p); assert.equal(routeEnabled({ ONEHELM_EE: "other" }, p), false, p); assert.equal(routeEnabled({ ONEHELM_EE: "1hc" }, p), true, p); }
  assert.equal(routeEnabled({}, "/health"), true);
});

test("bounded input: a body over the limit is refused as it streams, with or without a Content-Length, and only after the secret is checked", async () => {
  const env = envFor("selfhost"), n = net(() => chatOk());
  try {
    const big = new Uint8Array(MAX_BODY + 1024).fill(97);
    const stream = () => new ReadableStream({ start(c) { c.enqueue(big.slice(0, MAX_BODY / 2)); c.enqueue(big.slice(0, MAX_BODY / 2)); c.enqueue(big.slice(0, 2048)); c.close(); } });
    const streamed = new Request("https://selfhost.example.com" + LLM("retain"), { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: stream(), duplex: "half" });
    const r = await route(streamed, env); assert.equal(r.status, 413); assert.equal(r.headers.get(HS_PROXY_HEADER), "1");
    const claimed = post(LLM("retain"), "{}", { headers: { "content-length": String(MAX_BODY + 1) } }); assert.equal((await route(claimed, env)).status, 413);
    const noKey = new Request("https://selfhost.example.com" + LLM("retain"), { method: "POST", headers: { "content-type": "application/json" }, body: stream(), duplex: "half" });
    assert.equal((await route(noKey, env)).status, 401, "an unauthenticated body is never read");
    const bad = new Request("https://selfhost.example.com" + LLM("retain"), { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: new Uint8Array([0xff, 0xfe, 0xfd]) });
    assert.equal((await route(bad, env)).status, 400, "bytes that are not UTF-8 are a bad request");
    assert.equal(n.calls.length, 0);
  } finally { n.done(); }
});
