// node --import ./test/stubs/register.mjs test/byok-jobs.test.mjs
// Own-key accounts (env.BYOK): plain chat-message calls go to the person's own endpoint, and every other job runs on the model saved on the Models page.
// No network and no model calls: fetch, Workers AI and the saved settings are stubs.
import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/ee/model-dispatch.js";
import { askDecider } from "../src/ee/text-decision.js";
import { modelSettingsEnv } from "../src/ee/model-settings.js";
import { byokEnv } from "../src/byok.js";
import { SEED, ID, seedWith } from "./helpers/seed-settings.mjs";

const KEY = "sk-test-own-key", BASE = "https://llm.example-ai.com/v1";
const own = Object.defineProperty({ base: BASE, host: "llm.example-ai.com", model: "m", fast: "m" }, "key", { value: KEY });
// The saved settings live in D1: a stub that answers the one settings read.
const mkDb = (config) => ({ withSession() { return this; }, prepare() { return { bind() { return this; }, async first() { return { revision: 1, config: JSON.stringify(config), at: 1, by: "t", action: "save" }; }, async run() { return {}; }, async all() { return { results: [] }; } }; } });
let aiCalls = [], fetched = [];
const baseEnv = (config = SEED, extra = {}) => ({ DB: mkDb(config), ENV_NAME: "dev", PROMPT_CACHE: "off", OPENROUTER_API_KEY: "k", CF_ACCOUNT_ID: "a", AIG_ID: "g", AIG_TOKEN: "t",
  AI: { run: async (model, body) => { aiCalls.push({ model, body }); return model.includes("moondream") ? { result: { answer: "a", caption: "c" } } : { answers: { next: { choice: "stop" } }, usage: { input_tokens: 10 } }; },
    websearch: async (q) => { aiCalls.push({ websearch: q }); return { ok: true, results: [] }; } }, ...extra });
const ownEnv = (config, extra) => byokEnv(baseEnv(config, extra), own);
const reset = () => { aiCalls = []; fetched = []; };
globalThis.fetch = async (url, init) => { fetched.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return Response.json({ model: "m", choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: {} }); };

test("an own-key env gets the saved settings and keeps its own key", async () => {
  const e = await modelSettingsEnv(ownEnv());
  assert.ok(e.MODEL_SETTINGS?.jobs?.browser_decider, "the saved settings are attached");
  assert.strictEqual(e.BYOK, own, "the own key stays on the env");
});

const questions = { next: { type: "choice", instructions: "Next?", criteria: { stop: "stop", go: "go" } } };
test("the browser's decider (a chat model saved) on an own key runs on our model, never the person's key", async () => {
  reset();
  const reply = JSON.stringify({ next: { choice: "stop" } });
  globalThis.fetch = async (url, init) => { fetched.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return Response.json({ model: "m", choices: [{ message: { role: "assistant", content: reply }, finish_reason: "stop" }], usage: { cost: 0.000001, prompt_tokens: 5 } }); };
  const r = await askDecider(ownEnv(seedWith({ browser_decider: { model: ID.DEEPSEEK, effort: null, fallbacks: [] } })), {}, questions, { job: "browser_decider", timeoutMs: 0 });
  assert.ok(!/No saved model setting/.test(r.error || ""), `no missing-settings error: ${r.error}`);
  assert.ok(fetched.length >= 1 && !fetched.some((f) => f.url.startsWith(BASE)), "nothing went to the person's endpoint for a decision job");
  assert.ok(fetched[0].url.includes("openrouter.ai") || fetched[0].url.includes("gateway.ai"), fetched[0].url);
});

test("the browser's decider (saved default) on an own key reads the saved setting", async () => {
  reset();
  const r = await askDecider(ownEnv(), {}, questions, { job: "browser_decider", timeoutMs: 0 });
  assert.ok(!/No saved model setting/.test(r.error || ""), `no missing-settings error: ${r.error}`);
  assert.ok(!fetched.some((f) => f.url.startsWith(BASE)));
});

test("the screen look on an own key runs on the saved look model", async () => {
  reset();
  const r = await dispatch(ownEnv(), "look", { task: "caption", image: "data:image/jpeg;base64,AA" }, { meta: { tenant: "t1" } });
  assert.equal((await r.json()).result.caption, "c");
  assert.equal(aiCalls[0].model, SEED.jobs.look.model);
  assert.equal(fetched.length, 0);
});

test("web search on an own key runs on the saved search provider", async () => {
  reset();
  await dispatch(ownEnv(), "web_search", { query: "x", limit: 3 }, { meta: { tenant: "t1" } });
  assert.equal(aiCalls.length, 1); assert.ok(aiCalls[0].websearch);
});

test("a plain chat-messages call on an own key still goes to the person's endpoint, never to our models", async () => {
  reset();
  await dispatch(ownEnv(), "label", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1" }, level: "zdr" });
  assert.equal(fetched.length, 1); assert.ok(fetched[0].url.startsWith(BASE), fetched[0].url); assert.equal(aiCalls.length, 0);
});

test("a chat-messages call on an own key works even when the saved settings cannot be read", async () => {
  reset();
  const env = ownEnv(); env.DB = { prepare() { throw new Error("no db"); } };
  await dispatch(env, "label", { messages: [{ role: "user", content: "hi" }] }, { meta: {}, level: "zdr" });
  assert.ok(fetched[0].url.startsWith(BASE));
});
