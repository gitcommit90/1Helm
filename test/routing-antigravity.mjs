import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const antigravity = require("@gitcommit90/rerouted/src/lib/providers/antigravity.js");
const enginePackage = require("@gitcommit90/rerouted/package.json");

test("embedded ReRouted keeps Antigravity CRLF streams visible", async () => {
  assert.equal(enginePackage.version, "0.5.10", "the embedded router contains the scoped Antigravity stream fix");
  const upstream = {
    response: {
      candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4, cachedContentTokenCount: 2 },
    },
  };
  const writes = [];
  const usage = await antigravity.pipeGeminiSse(
    Readable.from([`data: ${JSON.stringify(upstream)}\r\n\r\n`]),
    { write(chunk) { writes.push(String(chunk)); } },
    "gemini-3-flash-agent",
  );
  const chunks = writes.join("").split("\n\n")
    .filter((block) => block.startsWith("data: ") && block !== "data: [DONE]")
    .map((block) => JSON.parse(block.slice(6)));
  assert.equal(chunks.map((chunk) => chunk.choices[0].delta.content).filter(Boolean).join(""), "OK");
  assert.equal(chunks.at(-1).choices[0].finish_reason, "stop");
  assert.deepEqual(usage, {
    prompt_tokens: 3,
    completion_tokens: 1,
    total_tokens: 4,
    prompt_tokens_details: { cached_tokens: 2 },
  });
});
