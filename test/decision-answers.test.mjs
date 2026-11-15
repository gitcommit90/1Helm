// node --import ./test/stubs/register.mjs test/decision-answers.test.mjs
// The decision answer validator and its cost estimate (src/decision-answers.js), and askSystemone through the dispatcher.
import assert from "node:assert/strict";
import * as DS from "../src/ee/decision-answers.js";
import { withSettings, ID } from "./helpers/seed-settings.mjs";

const Q = { next: { type: "choice", criteria: { a1: "x", a2: "y" } }, done: { type: "noul" } };
assert.deepEqual(DS.validateAnswers(Q, { next: { choice: "a2", probabilities: { a1: 0.1, a2: 0.9 } }, done: { noul: 0.3 } }).answers, { next: { choice: "a2", p: 0.9 }, done: { noul: 0.3 } });
for (const bad of [null, {}, { next: { choice: "a9" }, done: { noul: 0.3 } }, { next: { choice: "a1" }, done: { noul: 1.2 } }, { next: { choice: "a1" }, done: { noul: "0.4" } },
  { next: { choice: "a1", probabilities: { a3: 0.2 } }, done: { noul: 0.3 } }, { next: { choice: "a1", probabilities: { a1: -1 } }, done: { noul: 0.3 } }, { next: { choice: 1 }, done: { noul: 0.1 } }, { next: { choice: "a1" }, done: { noul: NaN } }])
  assert.ok(DS.validateAnswers(Q, bad).error, JSON.stringify(bad));
assert.deepEqual(DS.shadowCost({ cost: 0.00000206, input_tokens: 103 }), { nano: 2060, src: "reported" });
assert.deepEqual(DS.shadowCost({ input_tokens: 1_000_000 }), { nano: 20_000_000, src: "estimated" });

// askSystemone: the saved decider job's model and provider fields go through the dispatcher, and a model swap is an error.
const env = withSettings({ OPENROUTER_API_KEY: "k" }), seen = [], real = globalThis.fetch;
let answerModel = "perplexity/pplx-decider-v1.1-27b-20261006";
globalThis.fetch = async (u, init) => { seen.push({ u: String(u), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ model: answerModel, answers: { done: { noul: 0.2 }, next: { choice: "a1" } }, usage: { cost: 0.000002 } }), { status: 200 }); };
try {
  const r = await DS.askSystemone(env, ID.PPLX, { s: 1 }, Q, { meta: { tenant: "t" } });
  assert.deepEqual(r.answers.done, { noul: 0.2 }); assert.equal(seen[0].body.model, ID.PPLX); assert.equal(seen[0].body.provider.zdr, true);
  for (const k of ["order", "only", "ignore"]) assert.equal(seen[0].body.provider[k], undefined);
  answerModel = "someone/else"; assert.match((await DS.askSystemone(env, ID.PPLX, { s: 1 }, Q, {})).error, /answered by someone\/else/);
  const out = await DS.askSystemone(env, "not/a-model-of-the-job", { s: 1 }, Q, {}); assert.ok(out.error, "a model that is not in the saved job is never sent");
} finally { globalThis.fetch = real; }
console.log("PASS decision answers: validation, cost, askSystemone through the dispatcher");
