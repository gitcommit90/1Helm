import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { providerCacheRequest } from "../src/server/bot-output.ts";

const require = createRequire(import.meta.url);
const claude = require("@gitcommit90/rerouted/src/lib/providers/claude.js");
const xai = require("@gitcommit90/rerouted/src/lib/providers/xai.js");

const tool = (id, content) => ({ role: "tool", tool_call_id: id, name: "run_command", content });

test("Claude receives one stable base breakpoint and a rolling three-tool frontier", () => {
  const original = [
    { role: "system", content: "stable system" },
    { role: "user", content: "original task" },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "run_command", arguments: "{}" } }] },
    tool("t1", "one"), tool("t2", "two"), tool("t3", "three"), tool("t4", "four"),
  ];
  const request = providerCacheRequest("claude/claude-fable-5-1", original, "user:channel:thread");
  assert.notEqual(request.messages, original);
  assert.equal(original[1].content, "original task", "request shaping must not mutate retained context");
  assert.deepEqual(request.messages[1].content, [{ type: "text", text: "original task", cache_control: { type: "ephemeral" } }]);
  assert.equal(request.messages[3].extra_content, undefined, "old tool frontiers roll out before the four-breakpoint limit");
  for (const [index, id, content] of [[4, "t2", "two"], [5, "t3", "three"], [6, "t4", "four"]]) {
    assert.deepEqual(request.messages[index].extra_content.anthropic.tool_result, {
      type: "tool_result", tool_use_id: id, content, cache_control: { type: "ephemeral" },
    });
  }

  const anthropic = claude.applyCloaking(
    claude.toAnthropicBody({ messages: request.messages }, "claude-fable-5-1", false),
    "sk-ant-oat-test", "00000000-0000-4000-8000-000000000000",
  );
  const serialized = JSON.stringify(anthropic);
  assert.equal((serialized.match(/"cache_control":\{"type":"ephemeral"\}/g) || []).length, 4);
  assert.match(serialized, /"tool_use_id":"t4","content":"four","cache_control"/);
});

test("xAI receives a stable scoped prompt cache key and no Claude markers", () => {
  const messages = [{ role: "system", content: "stable" }, { role: "user", content: "task" }];
  const first = providerCacheRequest("xai/grok-4.5", messages, "1:2:3");
  const repeat = providerCacheRequest("xai/grok-4.5", messages, "1:2:3");
  const otherThread = providerCacheRequest("xai/grok-4.5", messages, "1:2:4");
  assert.equal(first.messages, messages);
  assert.match(first.prompt_cache_key, /^[a-f0-9]{64}$/);
  assert.equal(first.prompt_cache_key, repeat.prompt_cache_key);
  assert.notEqual(first.prompt_cache_key, otherThread.prompt_cache_key);
  assert.equal(xai.toResponsesBody({ messages, prompt_cache_key: first.prompt_cache_key }, "grok-4.5").prompt_cache_key, first.prompt_cache_key);
});

test("custom and other providers receive no cache activation metadata", () => {
  const messages = [{ role: "user", content: "task" }];
  for (const model of ["Bedrock/custom/sonnet-4-6", "openrouter/free", "nvidia/model", "main"]) {
    assert.deepEqual(providerCacheRequest(model, messages, "scope"), { messages });
  }
});
