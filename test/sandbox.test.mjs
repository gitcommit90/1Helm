// node --import ./test/stubs/register.mjs test/sandbox.test.mjs
// The Sandbox send route (src/sandbox.js) with a local fixture sample and a stubbed network: the real dispatcher is called with the job, placeholders become file
// content, the model override applies, tools are described and never run, the gateway log says kind "sandbox", and nothing is written to account storage.
// It does not depend on the real samples (chat.js and media.js): it adds its own to chat.js's array for the test.
import test from "node:test";
import assert from "node:assert/strict";
import { modelsRoute } from "../src/ee/models-console.js";
import { sandboxSend, sandboxRead, resolveRequest, jobRows, VIAS, FILES_MAX, toBase64 } from "../src/ee/sandbox.js";
import { samples } from "../src/ee/sandbox-samples/chat.js";
import { JOBS } from "../src/ee/model-jobs.js";
import { SEED, withSettings, ID } from "./helpers/seed-settings.mjs";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const gw = { CF_ACCOUNT_ID: "acct", AIG_ID: "gw", AIG_TOKEN: "tok", OPENROUTER_API_KEY: "k", MODEL_ADMINS: "admin@example.com" };
const dbCalls = [], waits = [];
const spyDb = { prepare(q) { dbCalls.push(q); const s = { bind() { return s; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 0 } }; } }; return s; } };
const envWith = (mut = () => {}) => {
  const e = withSettings({ ...gw, DB: spyDb, waitUntil: (p) => waits.push(p),
    ASSETS: { fetch: async (req) => (new URL(req.url).pathname === "/app-static/sandbox/p.png" ? new Response(PNG) : new Response("no", { status: 404 })) } });
  mut(e.MODEL_SETTINGS); return e;
};
const url = new URL("https://models.example.test/models/api/sandbox/send");
function net(handler) {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => { const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body; const c = { url: String(u), body, meta: JSON.parse(init.headers?.["cf-aig-metadata"] || "{}") }; calls.push(c); return handler(c); };
  return { calls, done: () => { globalThis.fetch = real; } };
}
const chatOk = (model, extra = {}) => new Response(JSON.stringify({ model, provider: "Azure", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "hello back", ...extra } }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0004 } }), { status: 200 });
const LOCAL = { job: "label", via: "model-dispatch.js#dispatch", build: async () => ({
  request: { messages: [{ role: "system", content: "Title the card." }, { role: "user", content: [{ type: "text", text: "A picture" }, { type: "image_url", image_url: { url: { $file: "p.png", as: "data_url" } } }] }],
    tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }], stream: true },
  files: [{ name: "p.png", type: "image/png", path: "/app-static/sandbox/p.png" }] }) };
samples.unshift(LOCAL);
const fixtureBody = (extra = {}) => ({ job: "label", request: { ...(structuredCloneable(LOCAL)) }, files: [{ name: "p.png", type: "image/png", source: "fixture", path: "/app-static/sandbox/p.png" }], ...extra });
function structuredCloneable() { return JSON.parse(JSON.stringify({ messages: [{ role: "system", content: "Title the card." }, { role: "user", content: [{ type: "text", text: "A picture" }, { type: "image_url", image_url: { url: { $file: "p.png", as: "data_url" } } }] }],
  tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }], stream: true })); }

test("a send calls the real dispatcher with the job, resolves the file, tags the log, and writes nothing", async () => {
  const env = envWith(), saved = env.MODEL_SETTINGS.jobs.label.model, n = net((c) => chatOk(c.body.model, { tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: "{\"q\":1}" } }] }));
  try {
    const { status, value } = await sandboxSend(env, fixtureBody(), url);
    assert.equal(status, 200); assert.equal(value.ok, true);
    assert.equal(n.calls.length, 1, "tools are described to the model and never run, so there is no second call");
    const c = n.calls[0];
    assert.match(c.url, /gateway\.ai\.cloudflare\.com.*chat\/completions/);
    assert.equal(c.body.model, saved); assert.equal(c.meta.job, "label"); assert.equal(c.meta.kind, "card-label", "the job keeps its own kind"); assert.equal(c.meta.sandbox, true); assert.equal(c.meta.tenant, "sandbox");
    assert.equal(c.body.messages[1].content[1].image_url.url, `data:image/png;base64,${toBase64(PNG)}`);
    assert.equal(c.body.tools[0].function.name, "lookup"); assert.ok(!c.body.stream, "a sandbox send is not streamed");
    assert.deepEqual(value.view.tool_calls, [{ id: "c1", name: "lookup", arguments: { q: 1 } }]);
    assert.equal(value.view.text, "hello back"); assert.equal(value.tokens_in, 12); assert.equal(value.tokens_out, 3); assert.equal(value.cost, 0.0004); assert.equal(value.served, saved);
    assert.equal(value.raw_request.requests.length, 1);
    const q = value.raw_request.requests[0];
    assert.equal(q.body.messages[1].content[1].image_url.url, `<p.png, ${PNG.length} bytes>`);
    assert.equal(q.body.model, saved); assert.match(q.url, /chat\/completions/);
    assert.deepEqual(dbCalls, [], "no read or write reached the account database"); assert.deepEqual(waits, []);
    assert.equal(env.MODEL_SETTINGS.jobs.label.model, saved, "the saved settings are untouched");
  } finally { n.done(); }
});

test("the model chosen for one send replaces the job's models for that send only", async () => {
  const env = envWith((s) => { s.jobs.label.fallbacks = [{ model: ID.LUNA, effort: "low" }]; }), before = JSON.stringify(env.MODEL_SETTINGS);
  const n = net((c) => chatOk(c.body.model));
  try {
    const { value } = await sandboxSend(env, fixtureBody({ model: "vendor/other-model", effort: "low", facts: { kinds: ["chat", "chore"], levels: ["unrestricted", "no_training", "zdr"], junk: 1 } }), url);
    assert.equal(value.ok, true); assert.equal(n.calls[0].body.model, "vendor/other-model"); assert.equal(value.requested, "vendor/other-model");
    assert.equal(JSON.stringify(env.MODEL_SETTINGS), before);
    n.calls.length = 0;
    await sandboxSend(env, fixtureBody(), url);
    assert.equal(n.calls[0].body.model, env.MODEL_SETTINGS.jobs.label.model);
  } finally { n.done(); }
});

test("a failed call is reported as an error with the raw request, and a bad request is refused before any call", async () => {
  const env = envWith(), n = net(() => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 }));
  try {
    const { status, value } = await sandboxSend(env, fixtureBody(), url);
    assert.equal(status, 502); assert.equal(value.ok, false); assert.match(value.error, /400/); assert.equal(value.raw_request.requests[0].body.model, env.MODEL_SETTINGS.jobs.label.model);
    const calls = n.calls.length;
    await assert.rejects(sandboxSend(env, fixtureBody({ files: [] }), url), (e) => e.status === 400 && /p\.png/.test(e.message));
    await assert.rejects(sandboxSend(env, { ...fixtureBody(), files: [{ name: "x", source: "fixture", path: "/etc/passwd" }] }, url), (e) => e.status === 400);
    await assert.rejects(sandboxSend(env, { ...fixtureBody(), model: "bad model!" }, url), (e) => e.status === 400);
    await assert.rejects(sandboxSend(env, { ...fixtureBody(), job: "nope" }, url), (e) => e.status === 404);
    assert.equal(n.calls.length, calls);
  } finally { n.done(); }
});

test("files are bounded to 20 MB in total", async () => {
  const env = envWith(), big = "A".repeat(Math.ceil((FILES_MAX + 10) / 3) * 4);
  await assert.rejects(sandboxSend(env, { ...fixtureBody(), files: [{ name: "p.png", type: "image/png", source: "upload", data: big }] }, url), (e) => e.status === 413 && /20 MB/.test(e.message));
  const small = resolveRequest({ a: { $file: "f", as: "text" }, b: [{ $file: "f", as: "bytes" }] }, new Map([["f", { name: "f", type: "text/plain", bytes: new TextEncoder().encode("hi") }]]));
  assert.equal(small.real.a, "hi"); assert.deepEqual([...small.real.b[0]], [104, 105]); assert.deepEqual(small.shown, { a: "<f, 2 bytes>", b: ["<f, 2 bytes>"] });
});

test("a chat category runs the main chat's route with its own chain", async () => {
  const env = envWith(), general = env.MODEL_SETTINGS.routing.categories[0], first = general.chains.unrestricted[0].model;
  const orig = samples.slice();
  samples.unshift({ job: "chat:general", via: "model-dispatch.js#dispatch", build: async () => ({ request: { messages: [{ role: "user", content: "hi" }], stream: true }, files: [] }) });
  const n = net((c) => chatOk(c.body.model));
  try {
    let r = await sandboxSend(env, { job: "chat:general", request: { messages: [{ role: "user", content: "hi" }] } }, url);
    assert.equal(r.value.ok, true, JSON.stringify(r.value)); assert.equal(n.calls[0].body.model, first); assert.equal(n.calls[0].meta.kind, "chat"); assert.equal(n.calls[0].meta.sandbox, true); assert.equal(n.calls[0].meta.job, "chat");
    assert.deepEqual(dbCalls, []);
  } finally { n.done(); samples.splice(0, samples.length, ...orig); }
});

test("a decision job asked through a chat model returns its answers", async () => {
  const env = envWith(); env.MODEL_SETTINGS.catalog[ID.DEEPSEEK] ||= { id: ID.DEEPSEEK, kinds: ["chat", "chore"], levels: ["unrestricted", "no_training", "zdr"] };
  samples.unshift({ job: "decider", via: "text-decision.js#askJob", build: async () => ({ request: { state: { task: "say hi" }, questions: { done: { type: "noul", instructions: "Is it trivial?" } } }, files: [] }) });
  const n = net((c) => chatOk(c.body.model, { content: JSON.stringify({ done: { noul: 0.9 } }) }));
  try {
    const r = await sandboxSend(env, { job: "decider", request: { state: { task: "say hi" }, questions: { done: { type: "noul", instructions: "Is it trivial?" } } }, model: ID.DEEPSEEK, effort: null }, url);
    assert.equal(r.value.ok, true, JSON.stringify(r.value)); assert.equal(r.value.view.type, "answers"); assert.equal(r.value.view.answers.done.noul, 0.9);
    const chat = n.calls.find((c) => /chat\/completions/.test(c.url)); assert.equal(chat.meta.kind, "decider"); assert.equal(chat.meta.sandbox, true); assert.equal(chat.meta.job, "decider"); assert.deepEqual(dbCalls, []);
  } finally { n.done(); samples.shift(); }
});

test("jobs, samples and the admin check work through the route", async () => {
  const env = envWith(), admin = { email: "admin@example.com" };
  const get = (path, user = admin) => modelsRoute(new Request(`https://models.example.test${path}`), env, user);
  let r = await get("/models/api/sandbox/jobs"); const jobs = (await r.json()).jobs;
  assert.deepEqual(jobs.filter((j) => !j.id.startsWith("chat:")).map((j) => j.id), JOBS.map((j) => j.id));
  assert.deepEqual(jobs.filter((j) => j.id.startsWith("chat:")).map((j) => j.id), SEED.routing.categories.map((c) => `chat:${c.id}`));
  assert.equal(jobs.find((j) => j.id === "stt").inputs[0], "audio");
  r = await get("/models/api/sandbox/sample?job=label"); const s = await r.json();
  assert.equal(s.via, "model-dispatch.js#dispatch"); assert.equal(s.shape, "chat"); assert.deepEqual(s.files, [{ name: "p.png", type: "image/png", path: "/app-static/sandbox/p.png", size: PNG.length }]);
  assert.equal((await get("/models/api/sandbox/sample?job=nope")).status, 404);
  for (const path of ["/models/api/sandbox/jobs", "/models/api/sandbox/sample?job=label"]) { assert.equal((await get(path, { email: "other@example.com" })).status, 403); assert.equal((await get(path, null)).status, 401); }
  // a send is a write: it needs the origin proof, the header and JSON, and POST only
  const post = (headers, body = "{}") => modelsRoute(new Request("https://models.example.test/models/api/sandbox/send", { method: "POST", headers, body }), env, admin);
  assert.equal((await post({ "content-type": "application/json" })).status, 403);
  assert.equal((await post({ origin: "https://evil.example", "content-type": "application/json", "x-model-settings": "1" })).status, 403);
  assert.equal((await modelsRoute(new Request("https://models.example.test/models/api/sandbox/send"), env, admin)).status, 405);
  assert.equal((await post({ origin: "https://models.example.test", "content-type": "application/json", "x-model-settings": "1" })).status, 404, "an empty request names no job");
});

test("every function the Sandbox can send through is a function of a module the jobs use", () => {
  assert.deepEqual(Object.keys(VIAS).sort(), ["media-job.js#dispatchMedia", "model-dispatch.js#dispatch", "text-decision.js#askDecider", "text-decision.js#askJob", "transcribe.js#stt"]);
  assert.ok(jobRows(SEED).length >= JOBS.length + 1);
});

test("each kind of answer gets its own view", async () => {
  const j = (o) => new Response(JSON.stringify(o));
  const read = (o, jobId, kind, via = "model-dispatch.js#dispatch") => import("../src/ee/sandbox.js").then((m) => m.readReply(o, { jobId, kind, via }));
  let r = await read(j({ data: [{ embedding: Array.from({ length: 1024 }, (_, i) => i / 10) }], usage: { prompt_tokens: 5, cost: 0.1 } }), "embed_files", "embedding_files");
  assert.deepEqual(r.view, { type: "embedding", size: 1024, first: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7] }); assert.equal(r.tokens_in, 5);
  r = await read(j({ choices: [{ message: { content: "x" } }], usage: { completion_tokens: 4856, completion_tokens_details: { reasoning_tokens: 4693 } } }), "label", "text"); assert.equal(r.tokens_out, 4856); assert.equal(r.tokens_reasoning, 4693);
  r = await read(j({ choices: [{ message: { content: "x" } }], usage: { completion_tokens: 5 } }), "label", "text"); assert.equal(r.tokens_reasoning, null);
  r = await read(j({ text: "hello there", duration: 3 }), "stt", "speech"); assert.deepEqual(r.view, { type: "transcript", text: "hello there" });
  r = await read({ ok: true, results: [{ title: "T", url: "https://x.example", snippet: "S" }] }, "web_search", "search"); assert.deepEqual(r.view.results, [{ title: "T", url: "https://x.example", snippet: "S" }]);
  r = await read({ ok: true, items: [{ title: "T", url: "https://x.example", description: "S" }] }, "web_search", "search"); assert.deepEqual(r.view.results, [{ title: "T", url: "https://x.example", snippet: "S" }], "the web search provider's items list");
  r = await read(j({ answer: "a red button" }), "look", "look"); assert.deepEqual(r.view, { type: "look", answer: "a red button", points: null });
  r = await read({ text: "words", model: "m/asr", nano: 2e9 }, "stt", "speech", "transcribe.js#stt"); assert.equal(r.cost, 2); assert.equal(r.served, "m/asr");
});

const JSON_CHORE = { messages: [{ role: "system", content: "Title." }, { role: "user", content: "A red button" }], temperature: 0,
  response_format: { type: "json_schema", json_schema: { name: "card_label", strict: true, schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } } } };
const strip = (calls) => calls.filter((c) => /chat\/completions/.test(c.url));

test("a JSON chore sends the same body in the Sandbox as the real job path (same kind handling)", async () => {
  const mut = (s) => { const m = s.jobs.label.model; s.catalog[m] = { ...(s.catalog[m] || { id: m }), quirks: { no_temperature: true }, json_levels: ["zdr"] }; };
  const real = envWith(mut), box = envWith(mut), { dispatch } = await import("../src/ee/model-dispatch.js");
  const n1 = net((c) => chatOk(c.body.model));
  try { await dispatch(real, "label", JSON.parse(JSON.stringify(JSON_CHORE)), { meta: { kind: "card-label" } }); } finally { n1.done(); }
  const realBody = strip(n1.calls)[0].body, realMeta = strip(n1.calls)[0].meta;
  const n2 = net((c) => chatOk(c.body.model));
  samples.unshift({ job: "label", via: "model-dispatch.js#dispatch", build: async () => ({ request: JSON_CHORE, files: [] }) });
  try { await sandboxSend(box, { job: "label", request: JSON_CHORE, files: [] }, url); } finally { n2.done(); samples.shift(); }
  const boxBody = strip(n2.calls)[0].body;
  assert.equal(realBody.temperature, undefined, "the real path removes the temperature");
  assert.deepEqual(boxBody, realBody);
  assert.deepEqual({ ...strip(n2.calls)[0].meta, sandbox: undefined, tenant: undefined }, { ...realMeta, sandbox: undefined, tenant: undefined });
});

test("the raw request is what the network received, in order, with no credentials and no file bytes", async () => {
  const env = envWith((s) => { s.jobs.label.fallbacks = [{ model: ID.LUNA, effort: "low" }]; }), first = env.MODEL_SETTINGS.jobs.label.model;
  const n = net((c) => (c.body.model === first ? new Response("{}", { status: 503 }) : chatOk(c.body.model)));
  const seen = []; const inner = globalThis.fetch;
  globalThis.fetch = async (u, init) => { seen.push({ u: String(u), init }); return inner(u, init); };
  try {
    const { value } = await sandboxSend(env, fixtureBody(), url);
    const withNet = seen.filter((x) => /chat\/completions/.test(x.u));
    assert.equal(value.raw_request.requests.length, 2, "each attempt is listed, the failed model first");
    value.raw_request.requests.forEach((q, i) => { assert.equal(q.url, withNet[i].u); assert.equal(q.method, "POST");
      const sentBody = JSON.parse(withNet[i].init.body); assert.deepEqual(q.body.model, sentBody.model); assert.deepEqual(q.body.tools, sentBody.tools); assert.equal(q.body.messages[1].content[1].image_url.url, `<p.png, ${PNG.length} bytes>`); });
    const all = JSON.stringify(value.raw_request);
    assert.doesNotMatch(all, /Bearer|tok"|"k"|authorization|base64,/i);
    for (const q of value.raw_request.requests) for (const h of Object.keys(q.headers)) assert.doesNotMatch(h, /auth|key|token/);
  } finally { globalThis.fetch = inner; n.done(); }
});

test("an unrelated fetch made during a send is not recorded, and globalThis.fetch is never replaced", async () => {
  const env = envWith(); let release; const gate = new Promise((r) => { release = r; });
  const n = net(async (c) => { if (/chat\/completions/.test(c.url)) await gate; return chatOk(c.body.model || "x"); });
  const stub = globalThis.fetch;
  try {
    const pending = sandboxSend(env, fixtureBody(), url);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(globalThis.fetch, stub, "the global fetch is the same function during the send");
    await globalThis.fetch("https://other-user.example/files", { method: "POST", body: JSON.stringify({ secret: "someone else's request" }) });
    release();
    const { value } = await pending;
    assert.equal(value.raw_request.requests.length, 1);
    assert.doesNotMatch(JSON.stringify(value.raw_request), /other-user|someone else/);
  } finally { release(); n.done(); }
});
