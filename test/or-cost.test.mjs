import test from "node:test";
import assert from "node:assert/strict";
import { orFetch } from "../src/model.js";

const sse = `data: {"id":"gen-1","choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"id":"gen-1","choices":[],"usage":{"prompt_tokens":5,"cost":0.00123,"cost_details":{"upstream_inference_cost":0.5}}}\n\ndata: [DONE]\n\n`;
function setup(body, headers = { "cf-aig-log-id": "log-1" }) {
  const patches = [];
  const env = { OPENROUTER_API_KEY: "k", AIG_ID: "g", AIG_TOKEN: "t", CF_ACCOUNT_ID: "a", PROMPT_CACHE: "off",
    AI: { gateway: (id) => ({ patchLog: async (log, b) => { patches.push([id, log, b]); } }) } };
  const fetchImpl = async () => new Response(body, { status: 200, headers });
  return { env, fetchImpl, patches };
}
const call = (s, meta = { kind: "chat", tenant: "t1" }) => orFetch(s.env, { model: "x/y", messages: [] }, { ...meta, _privacy: "standard" }, {}, null, s.fetchImpl);
const settle = () => new Promise((r) => setTimeout(r, 20));

test("streamed call: log metadata gets usage.cost and keeps the tags", async () => {
  const s = setup(sse); const r = await call(s); assert.equal(await r.text(), sse); await settle();
  assert.deepEqual(s.patches, [["g", "log-1", { metadata: { tenant: "t1", kind: "chat", or_cost: 0.00123 } }]]);
});
test("non-streamed call: records usage.cost", async () => {
  const s = setup(JSON.stringify({ usage: { cost: 0.004, total_tokens: 3 } })); await (await call(s)).text(); await settle();
  assert.equal(s.patches[0][2].metadata.or_cost, 0.004);
});
test("no usage.cost or no log id: nothing patched, reply intact", async () => {
  const a = setup(JSON.stringify({ usage: { total_tokens: 3 } })); assert.ok((await (await call(a)).text()).includes("total_tokens")); await settle();
  const b = setup(sse, {}); await (await call(b)).text(); await settle();
  assert.equal(a.patches.length + b.patches.length, 0);
});
test("a slow or failing patch never delays or breaks the reply", async () => {
  const s = setup(sse); let done = false;
  s.env.AI.gateway = () => ({ patchLog: () => new Promise((_, rej) => setTimeout(() => { done = true; rej(new Error("x")); }, 200)) });
  const r = await call(s); assert.equal(await r.text(), sse); assert.equal(done, false);
});
test("Stop mid-stream: the source stream is cancelled, no further pulls, and nothing is patched", async () => {
  const s = setup(""); let pulls = 0, cancelled = false;
  const src = new ReadableStream({ pull(c) { pulls++; c.enqueue(new TextEncoder().encode(`data: {"usage":{"cost":0.5}}\n\n`)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  s.fetchImpl = async () => new Response(src, { status: 200, headers: { "cf-aig-log-id": "log-1" } });
  const reader = (await call(s)).body.getReader(); await reader.read(); await reader.cancel(); await settle();
  const n = pulls; await settle();
  assert.equal(cancelled, true); assert.equal(pulls, n); assert.equal(s.patches.length, 0);
});
