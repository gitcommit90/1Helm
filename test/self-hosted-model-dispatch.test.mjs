// node --import ./test/stubs/register.mjs test/self-hosted-model-dispatch.test.mjs
// A self-hosted deployment (the EE switch off) keeps working with no model settings table and none of the retired model variables: the saved
// jobs fall back to the first-run data, the backup chat job runs on Workers AI, and an own AI key still answers every chat call.
import assert from "node:assert/strict";
import { dispatch } from "../src/ee/model-dispatch.js";
import { modelSettingsEnv, jobModel } from "../src/ee/model-settings.js";

const retired = ["OWN_ROUTER", "OWN_ROUTER_CLEF", "ROUTER_MODE", "ROUTER_LAB", "DECISION_SHADOW", "CHORE_MODEL_LABEL", "CHORE_MODEL_BROWSER", "DYNAMIC_ROUTING_ZDR_THIRD_MODEL", "DYNAMIC_ROUTING_SHARED_OR", "TEST_MODEL", "MODEL", "HS_USE_SHADOW"];
const log = console.log; console.log = () => {};   // the stub database refuses every read, and the Worker logs each refusal
const openDb = { prepare() { throw new Error("the shared settings table must not be read without the EE switch"); } };

// 1) No settings table is read, and no retired variable is needed to know the backup chat model.
const bare = { DB: openDb };
const snap = await modelSettingsEnv(bare);
assert.equal(snap.MODEL_SETTINGS_REVISION, 0);
const backup = await jobModel(bare, "workers_ai_chat");
assert.match(backup, /^@cf\//, "the backup chat job is a Workers AI model");
for (const name of retired) assert.ok(!(name in bare), `${name} is not set`);

// 2) The backup chat job runs on Workers AI through the dispatcher.
const calls = [];
const env = { DB: openDb, AI: { run: async (model, input) => { calls.push({ model, input }); return { response: "hello", usage: { prompt_tokens: 3, completion_tokens: 1 } }; } } };
const answer = await dispatch(env, "workers_ai_chat", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1", kind: "backup-chat" } });
assert.equal(answer.ok, true);
assert.equal(calls.length, 1); assert.equal(calls[0].model, backup);
assert.ok(Array.isArray(calls[0].input.messages) && calls[0].input.messages[0].content === "hi");

// 3) An own AI key answers every chat call, whatever the saved jobs say, and Workers AI is not used.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ choices: [{ message: { role: "assistant", content: "own" } }], model: "own-model", usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
try {
  calls.length = 0;
  const own = { DB: openDb, AI: env.AI, BYOK: { base: "https://provider.example.test/v1", key: "k", model: "own-model" } };
  const r = await dispatch(own, "chat.general", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t1" } });
  assert.equal((await r.json()).choices[0].message.content, "own");
  assert.equal(sent.length, 1); assert.match(sent[0].url, /^https:\/\/provider\.example\.test\/v1\//);
  assert.equal(calls.length, 0, "Workers AI was not called for an own-key chat");
} finally { globalThis.fetch = realFetch; }
console.log = log;
console.log("ok - a self-hosted deployment runs the backup chat and own-key chat without the EE switch or retired variables");
