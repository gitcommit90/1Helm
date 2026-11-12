import assert from "node:assert/strict";
import { BodyTooLargeError } from "../src/bounded-body.js";
import { firstOk, MODEL_STREAM_PRELUDE_MAX } from "../src/model.js";

const bytes = (text) => new TextEncoder().encode(text);
const response = (chunks, onCancel = () => {}) => new Response(new ReadableStream({
  pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
  cancel: onCancel,
}));

const good = [bytes(": OPENROUTER PROCESSING\n\n"), bytes('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'), bytes("data: [DONE]\n\n")];
const expected = Buffer.concat(good.map((chunk) => Buffer.from(chunk))).toString();
assert.equal(await (await firstOk(response([...good]), true)).text(), expected, "the model stream is handed back byte for byte after its first event");

let cancelled = false;
await assert.rejects(firstOk(response([new Uint8Array(MODEL_STREAM_PRELUDE_MAX), bytes("x")], () => { cancelled = true; }), true),
  /response prelude exceeds 1 MiB/);
assert.equal(cancelled, true, "a model stream with no usable event is cancelled at the cap");

await assert.rejects(firstOk(response([bytes('data: {"error":{"code":429,"message":"busy"}}\n\n')]), true),
  (error) => error.orStatus === 429 && /busy/.test(error.message), "an early provider error still triggers model fallback");

const plain = '{"choices":[{"message":{"content":"Hi"}}]}';
const checked = await firstOk(new Response(plain, { headers: { "x-provider": "test" } }), false);
assert.equal(checked.headers.get("x-provider"), "test");
assert.equal(await checked.text(), plain, "a checked nonstream reply stays available to the caller");
await assert.rejects(firstOk(new Response('{"error":{"code":429,"message":"busy"}}'), false),
  (error) => error.orStatus === 429 && /busy/.test(error.message), "a nonstream provider error still triggers fallback");

const oversizedJson = new Response('{"choices":[]}', { headers: { "content-length": String(16 * 1024 * 1024 + 1) } });
await assert.rejects(firstOk(oversizedJson, false), BodyTooLargeError, "nonstream JSON is bounded before parsing");
assert.equal(oversizedJson.bodyUsed, true, "the oversized response is cancelled");
console.log("ok - model response preflight has a byte cap and preserves usable streams");
