import assert from "node:assert/strict";
import { _resetModels, OR_MODELS_URL, orModels } from "../src/byok-openrouter.js";

let cancelled = false;
const largeFetch = async (url) => {
  assert.equal(String(url), OR_MODELS_URL);
  return new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(4_500_000).fill(65)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json", "content-length": "1" } });
};
_resetModels();
await assert.rejects(orModels({ fetchImpl: largeFetch }), /models list too big/);
assert.equal(cancelled, true, "the oversized provider response was cancelled before buffering it all");

const smallFetch = async (url) => {
  assert.equal(String(url), OR_MODELS_URL);
  return Response.json({ data: [
    { id: "vendor/tool-model", name: "Tool model", supported_parameters: ["tools"], pricing: { prompt: "0.000001", completion: "0.000002" } },
    { id: "vendor/chat-only", name: "Chat only", supported_parameters: [] },
  ] });
};
assert.deepEqual((await orModels({ fetchImpl: smallFetch })).map((m) => m.id), ["vendor/tool-model"]);
console.log("ok - OpenRouter model discovery caps remote JSON before parsing");
