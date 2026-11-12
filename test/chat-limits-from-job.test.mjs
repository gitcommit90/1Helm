// node --import ./test/stubs/register.mjs test/chat-limits-from-job.test.mjs
// A routed chat turn reads its output limit from the routing category it was routed to (src/job-limits.js), empty means no limit.
import assert from "node:assert/strict";
import { plannedChatMaxOutput, plannedChatHoldNano, holdOutput, holdOutNano, UNKNOWN_MODEL_HOLD } from "../src/ee/job-limits.js";
import { CHAT_JOB, categoryLimits } from "../src/ee/model-jobs.js";
import { taskPayload } from "../src/model.js";
import { SEED } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const settings = (category, max_output) => { const s = clone(SEED); s.routing.categories.find((c) => c.id === category).max_output = max_output; return s; };
const env = (s) => ({ MODEL_SETTINGS: s });

// Every chat reply reads its output limit from the category it was routed to, and a category without a saved limit reads General's.
assert.equal(CHAT_JOB, "chat");
assert.ok(!("chat" in SEED.jobs), "the chat job is not a saved job any more");
assert.equal(await plannedChatMaxOutput(env(settings("general", 777)), "general"), 777, "the saved limit is the planned limit");
{ const s = settings("general", 111); s.routing.categories.push({ ...clone(s.routing.categories[0]), id: "technical", title: "Technical", max_output: 222 });
  assert.equal(categoryLimits(s, "technical").max_output, 222, "a category reads its own limit"); assert.equal(categoryLimits(s, "nope").max_output, 111, "an unknown category reads General"); }
{ const s = settings("general", 777), profile = (category) => ({ requestedModel: "m/x", effort: null, category, catalog: { context_length: 200000, max_output: 32000, pricing: { prompt: 1, completion: 4 } }, cacheSession: "s" });
  s.routing.categories.push({ ...clone(s.routing.categories[0]), id: "technical", title: "Technical", max_output: 555, sort: "latency" });
  assert.equal(taskPayload(profile("general"), { messages: [] }, { level: null, settings: s }).max_tokens, 777, "General reads its own limit");
  const t = taskPayload(profile("technical"), { messages: [] }, { level: null, settings: s });
  assert.equal(t.max_tokens, 555, "technical reads its own limit"); assert.equal(t.provider.sort, "latency", "and its own sort"); }
// A category with no saved limit has none: nothing in code sets or lowers it.
assert.equal(await plannedChatMaxOutput(env(settings("general", null)), "general"), null, "empty stays empty");
assert.ok((await plannedChatHoldNano(env(settings("general", 100)), "general")) > 0, "the spend hold is sized from the category's models");
// A spend hold, not a request limit: the saved number, else the model's published maximum (the largest endpoint), kept below its context window.
const facts = { catalog: { "m/x": { max_output: 32000, context_length: 200000 }, "m/small": { max_output: 90000, context_length: 50000 } } };
assert.equal(holdOutput(facts, "m/x", 777), 777, "a saved limit is the hold");
assert.equal(holdOutput(facts, "m/x", null), 32000, "no saved limit: the model's published maximum");
assert.equal(holdOutput(facts, "m/small", null), 49999, "kept below the context window");
assert.equal(holdOutput(facts, "unknown/model", null), UNKNOWN_MODEL_HOLD, "no facts: a call is still held for output");
// The output hold is priced at the model's own completion price ($ per million tokens x 1000 = nano dollars per token), or at the ceiling without one.
const priced = { catalog: { "m/p": { max_output: 100000, context_length: 200000, pricing: { prompt: 1, completion: 4 } }, "m/n": { max_output: 100000, context_length: 200000 } } };
assert.equal(holdOutNano(priced, "m/p", null), 100000 * 4000); assert.equal(holdOutNano(priced, "m/p", 500), 500 * 4000); assert.equal(holdOutNano(priced, "m/n", null), 100000 * 15000, "no price: the reservation ceiling");
console.log("chat-limits-from-job: all ok");
