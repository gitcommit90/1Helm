import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

import { providerCacheRequest } from "../src/server/bot-output.ts";

const require = createRequire(import.meta.url);
const claude = require("@gitcommit90/rerouted/src/lib/providers/claude.js");
const chatgpt = require("@gitcommit90/rerouted/src/lib/providers/chatgpt.js");
const xai = require("@gitcommit90/rerouted/src/lib/providers/xai.js");

const tool = (id, content) => ({ role: "tool", tool_call_id: id, name: "run_command", content });

test("Claude shaping is deferred to ReRouted after provider selection", () => {
  const messages = [
    { role: "system", content: "stable system" },
    { role: "user", content: "task" },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "run_command", arguments: "{}" } }] },
    tool("t1", "one"),
  ];
  for (const route of ["claude/claude-fable-5-1", "fable", "main", "quick"]) {
    const request = providerCacheRequest(route, messages, "user:channel:thread");
    assert.equal(request.messages, messages);
    assert.doesNotMatch(JSON.stringify(request.messages), /cache_control/);
    assert.match(request.prompt_cache_key, /^[a-f0-9]{64}$/);
  }
  const anthropic = claude.toAnthropicBody({ messages }, "claude-fable-5-1", false);
  assert.equal((JSON.stringify(anthropic).match(/cache_control/g) || []).length, 2);
});

test("every route receives a stable scoped cache key and ChatGPT forwards it", () => {
  const messages = [{ role: "system", content: "stable" }, { role: "user", content: "task" }];
  for (const route of ["main", "work", "chatgpt/gpt-5.6-sol", "xai/grok-4.5", "Bedrock/custom/model"]) {
    const first = providerCacheRequest(route, messages, "1:2:3");
    const repeat = providerCacheRequest(route, messages, "1:2:3");
    const otherThread = providerCacheRequest(route, messages, "1:2:4");
    assert.equal(first.messages, messages);
    assert.equal(first.prompt_cache_key, repeat.prompt_cache_key);
    assert.notEqual(first.prompt_cache_key, otherThread.prompt_cache_key);
  }
  const request = providerCacheRequest("main", messages, "1:2:3");
  assert.equal(chatgpt.toResponsesBody({ messages, prompt_cache_key: request.prompt_cache_key }, "gpt-5.6-sol").prompt_cache_key, request.prompt_cache_key);
  assert.equal(xai.toResponsesBody({ messages, prompt_cache_key: request.prompt_cache_key }, "grok-4.5").prompt_cache_key, request.prompt_cache_key);
});


test("1Helm marks stable instructions, deferred dynamic context, and inline history distinctly", () => {
  const source = readFileSync(new URL("../src/server/bots.ts", import.meta.url), "utf8");
  assert.match(source, /index < 2 \? "stable_instruction" : "dynamic_context"/);
  assert.match(source, /cache_scope: "inline_context"/);
  assert.match(source, /invocationContext[\s\S]*cache_scope: "dynamic_context"/);
});

test("Claude OAuth request shaping preserves complete late system context", () => {
  const handoff = `THREAD_HANDOFF_START_${"handoff-state-".repeat(300)}THREAD_HANDOFF_END`;
  const request = providerCacheRequest("claude/claude-fable-5-1", [
    { role: "system", content: `identity-${"i".repeat(800)}` },
    { role: "system", content: handoff },
    { role: "user", content: "Confirm the handoff." },
  ], "user:channel:thread");
  const anthropic = claude.applyCloaking(
    claude.toAnthropicBody({ messages: request.messages }, "claude-fable-5-1", false),
    "sk-ant-oat-test", "00000000-0000-4000-8000-000000000000",
  );
  const firstUser = anthropic.messages.find((message) => message.role === "user");
  const forwarded = Array.isArray(firstUser.content)
    ? firstUser.content.map((block) => block.text || "").join("\n")
    : String(firstUser.content || "");
  assert.match(forwarded, /<system-reminder>/);
  assert.ok(forwarded.includes(handoff), "the full late handoff system block must reach Claude OAuth");
  assert.ok(forwarded.indexOf("THREAD_HANDOFF_END") < forwarded.indexOf("IMPORTANT:"), "the handoff must not be truncated before the reminder footer");
});

test("Claude OAuth keeps volatile invocation context behind reusable stable and history prefixes", () => {
  const scoped = (content, cache_scope) => ({ role: "system", content, extra_content: { openai: { cache_scope } } });
  const payload = claude.applyCloaking(claude.toAnthropicBody({ messages: [
    scoped("stable identity", "stable_instruction"),
    scoped("volatile time one", "dynamic_context"),
    { role: "user", content: "old task" },
    { role: "assistant", content: "old answer" },
    scoped("current invocation", "dynamic_context"),
    { role: "user", content: "current task" },
  ] }, "claude-opus-5-5", false), "sk-ant-oat-test", "00000000-0000-4000-8000-000000000000");
  const blocks = payload.messages.flatMap((message) => message.content);
  const stable = blocks.findIndex((block) => block.text?.includes("stable identity"));
  const history = blocks.findIndex((block) => block.text === "old answer");
  const volatile = blocks.findIndex((block) => block.text?.includes("volatile time one"));
  const current = blocks.findIndex((block) => block.text === "current task");
  assert.ok(stable >= 0 && stable < history && history < volatile && volatile < current);
  assert.equal(blocks[stable].cache_control.type, "ephemeral");
  assert.equal(blocks[history].cache_control.type, "ephemeral");
  assert.equal(blocks[volatile].cache_control, undefined);
});

test("Claude groups parallel tool results and view-image evidence into one immediate user message", () => {
  const payload = claude.toAnthropicBody({ messages: [
    { role: "user", content: "inspect both" },
    { role: "assistant", content: "", tool_calls: [
      { id: "call-a", type: "function", function: { name: "view_image", arguments: "{}" } },
      { id: "call-b", type: "function", function: { name: "view_image", arguments: "{}" } },
      { id: "call-c", type: "function", function: { name: "run_command", arguments: "{}" } },
    ] },
    { role: "tool", tool_call_id: "call-a", content: "viewed a" },
    { role: "user", content: [{ type: "text", text: "image a" }, { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } }] },
    { role: "tool", tool_call_id: "call-b", content: "viewed b" },
    { role: "user", content: [{ type: "text", text: "image b" }, { type: "image_url", image_url: { url: "data:image/png;base64,Yg==" } }] },
    { role: "tool", tool_call_id: "call-c", content: "done" },
  ] }, "claude-opus-5-5", false);
  assert.deepEqual(payload.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.deepEqual(payload.messages[2].content.slice(0, 3).map((block) => [block.type, block.tool_use_id]), [
    ["tool_result", "call-a"], ["tool_result", "call-b"], ["tool_result", "call-c"],
  ]);
  assert.equal(payload.messages[2].content.filter((block) => block.type === "image").length, 2);
});

test("multimodal content survives 1Helm cache shaping and ReRouted provider translation", () => {
  const messages = [{ role: "user", content: [
    { type: "text", text: "Describe this image." },
    { type: "image_url", image_url: { url: "data:image/webp;base64,QUJD", detail: "high" } },
  ] }];
  const shaped = providerCacheRequest("claude/claude-fable-5-1", messages, "vision-scope");
  assert.equal(messages[0].content[0].cache_control, undefined, "cache shaping does not mutate canonical multimodal content");
  const anthropic = claude.toAnthropicBody({ messages: shaped.messages }, "claude-fable-5-1", false);
  assert.deepEqual(anthropic.messages[0].content.find((part) => part.type === "image"), {
    type: "image", source: { type: "base64", media_type: "image/webp", data: "QUJD" }, cache_control: { type: "ephemeral" },
  });
  const responses = xai.toResponsesBody({ messages }, "grok-4.5");
  assert.deepEqual(responses.input[0].content[1], {
    type: "input_image", image_url: "data:image/webp;base64,QUJD", detail: "high",
  });
  const chatgptResponses = chatgpt.toResponsesBody({ messages }, "gpt-5.6", false);
  assert.deepEqual(chatgptResponses.input[0].content[1], {
    type: "input_image", image_url: "data:image/webp;base64,QUJD", detail: "high",
  });
});
