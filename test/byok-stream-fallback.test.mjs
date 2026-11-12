// A reply that fails partway on an own key goes to the next model of the plan (src/byok.js streamFallback, byok-custom.js byokChatChain), and the own-key waits follow the saved
// Models page limits (byokLimits). No network: fetch is faked.
import { test, mock } from "node:test";
import assert from "node:assert";
import { byokChat, byokLimits, streamFallback, ByokError, FIRST_BYTE_MS, IDLE_MS, TOTAL_MS } from "../src/byok.js";
import { byokChatChain } from "../src/ee/byok-custom.js";

const cfg = Object.defineProperty({ base: "https://llm.example-ai.com/v1", host: "llm.example-ai.com", model: "m", fast: "m" }, "key", { value: "sk-test-fallback-0000" });
const enc = new TextEncoder(), dec = new TextDecoder();
const ev = (content) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
const body = { messages: [{ role: "user", content: "hi" }], stream: true };
// model "a": one event, then the connection drops. model "b": a whole answer.
function fakeFetch(calls, plan = {}) {
  return async (_url, init) => {
    const model = JSON.parse(init.body).model; calls.push(model);
    const mode = plan[model] || "ok";
    if (mode === "http500") return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 500 });
    const parts = mode === "drop" ? [ev(`partial-${model}`)] : [ev(`answer-${model}`), enc.encode("data: [DONE]\n\n")];
    let i = 0;
    return new Response(new ReadableStream({ pull(c) { if (i < parts.length) c.enqueue(parts[i++]); else if (mode === "drop") c.error(new Error("socket reset")); else c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
const planOf = (...models) => ({ title: "G", maxPrice: null, chain: models.map((m) => ({ model: m, effort: null, facts: null })) });
const readAll = async (resp) => { const r = resp.body.getReader(); let t = ""; for (;;) { const { value, done } = await r.read(); if (done) return t; t += dec.decode(value, { stream: true }); } };

test("a stream that fails mid-reply on model 1 is retried on model 2, and the step's result comes from model 2 only", async () => {
  const calls = [], r = await byokChatChain(cfg, body, planOf("a", "b", "c"), { fetchImpl: fakeFetch(calls, { a: "drop" }) });
  assert.equal(r.pick.model, "a");
  const text = await readAll(r.response);
  assert.deepEqual(calls, ["a", "b"], "the third model is never asked");
  const at = text.indexOf("byok_reset"); assert.ok(at > text.indexOf("partial-a"), "the reset event follows the failed attempt's output");
  const reset = JSON.parse(text.slice(text.indexOf("{", at - 3), text.indexOf("\n", at))).byok_reset;
  assert.equal(reset.model, "b"); assert.equal(reset.slot, 1); assert.equal(reset.failed[0].model, "a"); assert.match(reset.failed[0].error, /dropped/);
  assert.ok(text.slice(at).includes("answer-b") && !text.slice(at).includes("partial-a"), "after the reset only model 2 speaks");
  assert.equal(r.pick.failed[0].model, "a");
});

test("the next model also fails before its first byte or mid-reply: the third answers; all fail: the stream errors", async () => {
  let calls = [], r = await byokChatChain(cfg, body, planOf("a", "b", "c"), { fetchImpl: fakeFetch(calls, { a: "drop", b: "http500" }) });
  const text = await readAll(r.response); assert.deepEqual(calls, ["a", "b", "c"]); assert.ok(text.includes("answer-c"));
  assert.equal(JSON.parse(text.slice(text.indexOf('{"byok_reset'), text.indexOf("\n", text.indexOf('{"byok_reset')))).byok_reset.slot, 2);
  calls = []; r = await byokChatChain(cfg, body, planOf("a", "b"), { fetchImpl: fakeFetch(calls, { a: "drop", b: "drop" }) });
  await assert.rejects(readAll(r.response), (e) => e instanceof ByokError);
  assert.deepEqual(calls, ["a", "b"]);
});

test("a one-model plan and a non-streamed call are unchanged", async () => {
  const calls = [], r = await byokChatChain(cfg, body, planOf("a"), { fetchImpl: fakeFetch(calls, { a: "drop" }) });
  await assert.rejects(readAll(r.response), (e) => e instanceof ByokError); assert.deepEqual(calls, ["a"]);
});

test("the person's Stop and a 401 end a failed stream without a fallback", async () => {
  const calls = [], ac = new AbortController(), r = await byokChatChain(cfg, body, planOf("a", "b"), { signal: ac.signal, fetchImpl: fakeFetch(calls, { a: "drop" }) });
  const rd = r.response.body.getReader(); await rd.read(); ac.abort(new Error("stopped"));
  await assert.rejects((async () => { for (;;) { const { done } = await rd.read(); if (done) return; } })()); assert.deepEqual(calls, ["a"], "Stop: model b never asked");
  let ran = 0; const first = new Response(new ReadableStream({ start(c) { c.error(new ByokError("bad key", 401)); } }));
  const s = streamFallback(first, [{ model: "b", slot: 1, run: async () => { ran++; return new Response("x"); } }], { model0: "a" });
  await assert.rejects(readAll(s), (e) => e.http === 401); assert.equal(ran, 0, "401: no fallback");
});

test("byokLimits: the saved Models page limits when passed, the constants otherwise", () => {
  assert.deepEqual(byokLimits(cfg), { first: FIRST_BYTE_MS, idle: IDLE_MS, total: TOTAL_MS });
  assert.deepEqual(byokLimits({ limits: { headersMs: 30e3, idleMs: 40e3, totalMs: 300e3 } }), { first: 30e3, idle: 40e3, total: 300e3 });
  assert.deepEqual(byokLimits({ limits: { idleMs: 40e3 } }), { first: FIRST_BYTE_MS, idle: 40e3, total: TOTAL_MS }, "a missing value falls back one by one");
});

const tick = async (ms) => { for (let i = 0; i < ms / 1000; i++) { mock.timers.tick(1000); await new Promise((r) => setImmediate(r)); } };
test("own-key guard uses the configured first, idle and total limits", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const limits = { headersMs: 15e3, idleMs: 20e3, totalMs: 60e3 };
    // first reply: headers never arrive
    const never = (_u, init) => new Promise((_, no) => init.signal.addEventListener("abort", () => no(new Error("aborted"))));
    let out = byokChat(cfg, body, { fetchImpl: never, limits }).then(() => "resolved", (e) => e); await tick(16e3);
    assert.match(String((await out).message), /no answer within 15 seconds/);
    // idle: comments only after the headers
    const quiet = async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(": hi\n\n")); } }), { status: 200 });
    out = byokChat(cfg, body, { fetchImpl: quiet, limits }).then(() => "resolved", (e) => e); await tick(21e3);
    assert.match(String((await out).message), /no answer within 20 seconds/);
    // total: an event every 10 s keeps it idle-alive, the total limit ends it
    const slow = async () => { let t; return new Response(new ReadableStream({ start(c) { c.enqueue(ev("x")); t = setInterval(() => { try { c.enqueue(ev("y")); } catch {} }, 10e3); }, cancel() { clearInterval(t); } }), { status: 200 }); };
    const r = await byokChat(cfg, body, { fetchImpl: slow, limits }), rd = r.body.getReader(); let err = null;
    const reading = (async () => { try { for (;;) { const { done } = await rd.read(); if (done) return; } } catch (e) { err = e; } })();
    await tick(65e3); await reading; assert.match(String(err?.message), /took too long to finish/);
  } finally { mock.timers.reset(); }
});
