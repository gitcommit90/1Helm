// node --import ./test/stubs/register.mjs test/chat-limits-from-job.test.mjs
// A routed chat turn reads its output limit from the saved chat.<category> job (src/job-limits.js), empty means no limit.
import assert from "node:assert/strict";
import { plannedMaxOutput, holdOutput, holdOutNano, UNKNOWN_MODEL_HOLD } from "../src/ee/job-limits.js";
import { chatJobId } from "../src/ee/model-jobs.js";
import { SEED } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const settings = (id, max_output) => { const s = clone(SEED); s.jobs[id].max_output = max_output; return s; };
const env = (s) => ({ MODEL_SETTINGS: s });

assert.equal(chatJobId("technical"), "chat.technical");
assert.equal(chatJobId("nonsense"), "chat.general");
for (const cat of ["general", "technical", "spreadsheet"]) {
  const id = chatJobId(cat);
  assert.equal(await plannedMaxOutput(env(settings(id, 777)), id), 777, `${id} saved limit is the planned limit`);
  assert.notEqual(await plannedMaxOutput(env(settings(id, 777)), chatJobId(cat === "general" ? "technical" : "general")), 777, "another category's job is not affected");
}
// A step with no saved limit has none: nothing in code sets or lowers it.
assert.equal(await plannedMaxOutput(env(settings("chat.general", null)), "chat.general"), null, "empty stays empty");
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
