// Own-key stream wait (src/byok.js guardStream): comment-only keep-alive chunks must not keep a silent call alive.
// A gateway that sends ": keep-alive" lines while the model never answers used to hold the turn until the 20 minute total limit.
import { test, mock } from "node:test";
import assert from "node:assert";
import { byokChat, IDLE_MS, TOTAL_MS } from "../src/byok.js";

const cfg = Object.defineProperty({ base: "https://llm.example-ai.com/v1", host: "llm.example-ai.com", model: "m", fast: "m" }, "key", { value: "sk-test-keepalive-0000" });
const enc = new TextEncoder();
// A response whose body emits `first` at once, then `beat` every 5 seconds (fake clock), and `then` after `thenAfter` ms when given.
function fakeFetch({ first = ": hello\n\n", beat = ": keep-alive\n\n", then = null, thenAfter = 0 } = {}) {
  return async () => {
    let t = null, started = 0;
    const body = new ReadableStream({
      start(c) { c.enqueue(enc.encode(first)); started = Date.now(); t = setInterval(() => { try { if (then && Date.now() - started >= thenAfter) { c.enqueue(enc.encode(then)); clearInterval(t); } else c.enqueue(enc.encode(beat)); } catch {} }, 5000); },
      cancel() { clearInterval(t); },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
const tick = async (ms) => { for (let i = 0; i < ms / 1000; i++) { mock.timers.tick(1000); await new Promise((r) => setImmediate(r)); } };

test("keep-alive comments only: the call fails after the idle limit with a plain message, not after the total limit", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const p = byokChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { fetchImpl: fakeFetch() });
    const out = p.then(() => "resolved", (e) => e);
    await tick(IDLE_MS + 2000);
    const e = await Promise.race([out, Promise.resolve("still waiting")]);
    assert.notStrictEqual(e, "still waiting", "the call must have ended by the idle limit");
    assert.ok(Date.now() - 0 < TOTAL_MS);
    assert.match(String(e?.message || e), /no answer within 120 seconds/);
  } finally { mock.timers.reset(); }
});

test("a real event after a long comment-only wait still answers (reasoning models can be slow under the limit)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const ev = `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`;
    const p = byokChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { fetchImpl: fakeFetch({ then: ev, thenAfter: 60000 }) });
    const out = p.then((r) => r, (e) => e);
    await tick(65000);
    const r = await out;
    assert.ok(r instanceof Response, String(r?.message || r));
  } finally { mock.timers.reset(); }
});
