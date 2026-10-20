// node --import ./test/stubs/register.mjs test/structured-output.test.mjs
import { SEED } from "./helpers/seed-settings.mjs";
import assert from "node:assert/strict";
import { S, structuredFormat, structuredChat, parseStructuredResponse, assertStructuredSchema } from "../src/structured-output.js";
import { openRouterChat } from "./helpers/or-chat.mjs";
import { byokChat } from "../src/byok.js";
import { generateHandoff, HANDOFF_PROMPT, HANDOFF_SCHEMA, renderHandoff } from "../src/resident.js";
import { summarizeCard } from "../src/tracker.js";
const schema = S.object({ action: { type: "string", enum: ["keep", "change"] }, rows: S.array(S.object({ id: S.integer, note: { type: ["string", "null"] } })) });
const good = { action: "keep", rows: [{ id: 1, note: null }] };
const response = (value, extra = {}) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) }, ...extra }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: .001, prompt_tokens_details: { cached_tokens: 3 } } });
assertStructuredSchema(schema);
assert.deepEqual(parseStructuredResponse(response(good), schema), good);
for (const value of [{ ...good, extra: true }, { action: "keep" }, { ...good, action: "invented" }, { ...good, rows: [{ id: "1", note: null }] }, { ...good, rows: [{ id: 1, note: null, extra: "x" }] }]) assert.throws(() => parseStructuredResponse(response(value), schema), /structured output/);
for (const extra of [{ finish_reason: "length" }, { finish_reason: null }, { finish_reason: "content_filter" }, { message: { refusal: "no", content: JSON.stringify(good) } }, { message: { content: `\`\`\`json\n${JSON.stringify(good)}\n\`\`\`` } }, { message: { content: "x".repeat(1_000_001) } }]) assert.throws(() => parseStructuredResponse(response(good, extra), schema), /structured output/);
assert.throws(() => structuredFormat("bad", { type: "string", pattern: "x" }), /unsupported schema keyword/);
assert.throws(() => structuredFormat("bad", { anyOf: [S.string], enum: ["x"] }), /sibling/);
assert.throws(() => structuredFormat("bad", { type: "object", properties: {}, required: [] }), /forbid extras/);
let calls = 0, observed = 0;
const out = await structuredChat(async body => {
  assert.equal(body.response_format.type, "json_schema"); assert.equal(body.response_format.json_schema.strict, true);
  calls++; return response(calls === 1 ? { action: "keep" } : good);
}, {}, { name: "test", schema, onUsage: () => { observed++; } });
assert.equal(out.attempts, 2); assert.equal(observed, 2); assert.equal(out.usage.cost, .002); assert.equal(out.usage.prompt_tokens_details.cached_tokens, 6);
let failed;
try { await structuredChat(async () => response({}), {}, { name: "test", schema }); } catch (e) { failed = e; }
assert.equal(failed.attempts, 2); assert.equal(failed.usage.cost, .002);
const saved = globalThis.fetch; const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(response(good))); };
try {
  await openRouterChat({ MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "test", PROMPT_CACHE: "off" }, { messages: [{ role: "user", content: "test" }], response_format: structuredFormat("test", schema), provider: { require_parameters: true } }, null,
    { model: "qwen/qwen3.8-27b", host: "cerebras/fp16", effort: "none" });
  assert.equal(sent[0].provider.order, undefined); assert.equal(sent[0].provider.max_price.prompt, 3);
  assert.equal(sent[0].provider.require_parameters, true); assert.equal(sent[0].provider.zdr, true);
} finally { globalThis.fetch = saved; }
const cfg = { base: "https://structured.example/v1", model: "main", fast: "fast", key: "" };
let requests = 0;
await assert.rejects(byokChat(cfg, { messages: [], response_format: structuredFormat("test", schema) }, { fast: true, fetchImpl: async (_, init) => {
  requests++; assert.equal(JSON.parse(init.body).response_format.type, "json_schema"); return new Response(JSON.stringify({ error: { message: "unsupported response_format" } }), { status: 400 });
} }), /response_format/);
assert.equal(requests, 1, "BYOK never retries a schema rejection as unconstrained prose");
// A legacy JSON-mode quirk cached for the same endpoint/model cannot remove a later strict schema.
await byokChat(cfg, { messages: [], response_format: { type: "json_object" } }, { fast: true, fetchImpl: async (_, init) => {
  const b = JSON.parse(init.body); return b.response_format ? new Response('unsupported response_format', { status: 400 }) : new Response(JSON.stringify(response(good)));
} });
await byokChat(cfg, { messages: [], response_format: structuredFormat("test", schema) }, { fast: true, fetchImpl: async (_, init) => {
  assert.equal(JSON.parse(init.body).response_format.type, "json_schema"); return new Response(JSON.stringify(response(good)));
} });
console.log("PASS strict schema validation, bounded retry/accounting, classic privacy/host/price preservation, BYOK fail-closed and cached downgrade protection");
const notes = Object.fromEntries(Object.keys(HANDOFF_SCHEMA.properties).map(k => [k, [k]]));
assert.equal(renderHandoff(Object.fromEntries(Object.entries(notes).reverse())), renderHandoff(notes));
let fins = 0, paid = 0;
const rendered = await generateHandoff({ callModelOnce: async (messages, _tool, _text, noTools) => {
  assert.equal(messages.at(-1).content, HANDOFF_PROMPT); assert.equal(noTools, true);
  fins++; return { content: JSON.stringify(notes), finish: fins === 1 ? "length" : "stop", calls: [], charge: 100 };
} }, [], null, fin => { paid += fin.charge; });
assert.equal(fins, 2); assert.equal(paid, 200); assert.equal(rendered, renderHandoff(notes));
const labelInput = { kind: "chat", msgs: [{ at: 1, text: "Plan a garden" }], steps: [], reply: "Grow peas." };
let managedCalls = 0, release, sawAbort = false;
const settled = [];
globalThis.fetch = async (_url, init) => { if (/openrouter\.ai\/api\/v1\/(models|endpoints)/.test(String(_url))) return new Response("{}", { status: 503 }); managedCalls++; init.signal.addEventListener("abort", () => { sawAbort = true; }, { once: true }); return new Promise(resolve => { release = resolve; }); };
const pendingLabels = summarizeCard({ input: labelInput, timeoutMs: 5, env: { MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture" },
  ledger: { reserve: async () => ({ ok: true }), settle: async (_id, nano) => { settled.push(nano); } } });
await new Promise(resolve => setTimeout(resolve, 20));
assert.ok(sawAbort); assert.deepEqual(settled, [], "keep reservation until an abort-racing paid response is consumed");
release(Response.json(response({ title: "Plan a garden", result: "Suggested peas", summary: "Suggested peas.", why: {} })));
const labels = await pendingLabels;
assert.equal(labels.title_src, "auto"); assert.equal(managedCalls, 1);
assert.deepEqual(settled, [1150000], "late usage settles once; timed-out content never publishes");
let aborted = false;
globalThis.fetch = async (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => { aborted = true; reject(init.signal.reason); }, { once: true }));
try {
  const r = await summarizeCard({ input: labelInput, timeoutMs: 5, env: { MODEL_SETTINGS: SEED, OPENROUTER_API_KEY: "fixture", ROUTER_MODE: "two" }, bill: false });
  assert.equal(r.title_src, "auto"); assert.ok(aborted);
} finally { globalThis.fetch = saved; }
console.log("PASS handoff deterministic rendering, actual retry seam/accounting, managed timeout late-usage accounting and OpenRouter abort");

