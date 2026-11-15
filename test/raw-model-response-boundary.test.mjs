import assert from "node:assert/strict";
import { embedTexts } from "../src/sidecar.js";
import { stt } from "../src/transcribe.js";

let mode = "large", cancelled = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(init.method, "POST");
  assert.match(String(url), /^https:\/\/openrouter\.ai\/api\/v1\/(?:embeddings|audio\/transcriptions)$/);
  if (mode === "small") return Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 2 } });
  return new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(4_500_000).fill(65)); },
    cancel() { cancelled++; },
  }), { headers: { "content-type": "application/json", "content-length": "1" } });
};
const env = { OPENROUTER_API_KEY: "fixture" };
await assert.rejects(embedTexts(env, ["one"], { tenant: "t1" }), /embeddings 200/);
assert.equal(cancelled, 1, "oversized embedding JSON was cancelled despite a forged short length");
await assert.rejects(stt(env, { bytes: new Uint8Array([1, 2, 3, 4]) }), /couldn't transcribe/);
assert.equal(cancelled, 3, "both oversized transcription attempts were cancelled before fallback");

mode = "small";
const embedded = await embedTexts(env, ["one"], { tenant: "t1" });
assert.deepEqual(embedded.vectors, [[0.1, 0.2]]);
console.log("ok - raw model transcription and embedding responses stop at the stream cap");
