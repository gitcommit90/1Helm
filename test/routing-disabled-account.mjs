import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createRouter } = require("@gitcommit90/rerouted/src/lib/router.js");

test("a disabled xAI account is absent from real shared-model attempts, activity, and logs", async () => {
  const providers = [
    {
      id: "xai-exhausted-disabled",
      type: "xai",
      name: "Exhausted xAI account",
      accountAlias: "oauth1",
      accessToken: "disabled-secret-token",
      enabled: false,
      createdAt: 1,
      models: [{ id: "grok-4.5", name: "Grok 4.5", enabled: true }],
    },
    {
      id: "xai-healthy-enabled",
      type: "xai",
      name: "Healthy xAI account",
      accountAlias: "oauth2",
      accessToken: "healthy-secret-token",
      enabled: true,
      createdAt: 2,
      models: [{ id: "grok-4.5", name: "Grok 4.5", enabled: true }],
    },
  ];
  const cfg = { providers, combos: [] };
  const attemptedTokens = [];
  const requestLog = [];
  const loggerEntries = [];
  const router = createRouter({
    store: { load: () => cfg, update: (fn) => fn(cfg) },
    requestLog: { push: (entry) => requestLog.push(entry), list: () => [...requestLog], count: () => requestLog.length },
    logger: {
      info: (message, meta) => loggerEntries.push({ level: "info", message, meta }),
      warn: (message, meta) => loggerEntries.push({ level: "warn", message, meta }),
      error: (message, meta) => loggerEntries.push({ level: "error", message, meta }),
    },
    fetchImpl: async (_url, init = {}) => {
      const authorization = new Headers(init.headers).get("authorization") || "";
      attemptedTokens.push(authorization);
      const delta = { type: "response.output_text.delta", delta: "healthy xAI answer" };
      const completed = { type: "response.completed", response: { usage: { input_tokens: 2, output_tokens: 3 } } };
      return new Response(`event: response.output_text.delta\ndata: ${JSON.stringify(delta)}\n\nevent: response.completed\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  assert.deepEqual(router.listModels().data.map((model) => model.id), ["xai/grok-4.5"]);
  const response = await router.chatCompletions({ body: { model: "xai/grok-4.5", stream: false, messages: [{ role: "user", content: "route only to the enabled account" }] } });
  assert.equal(response.ok, true);
  assert.match(response.openAiJson.choices[0].message.content, /healthy xAI answer/);
  assert.deepEqual(attemptedTokens, ["Bearer healthy-secret-token"]);
  const evidence = JSON.stringify({ requestLog, loggerEntries, response });
  assert.equal(evidence.includes("xai-exhausted-disabled"), false);
  assert.equal(evidence.includes("oauth1"), false);
  assert.equal(evidence.includes("Exhausted xAI account"), false);
  assert.equal(evidence.includes("disabled-secret-token"), false);
  assert.match(evidence, /xai-healthy-enabled/);
});
