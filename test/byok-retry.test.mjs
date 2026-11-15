// Own-key calls retry a failure with no status, a 5xx or a timeout on the same model (src/byok.js byokChatOne) before the chain moves on. No network: fetch and sleep are faked.
import { test } from "node:test";
import assert from "node:assert";
import { OWN_RETRY_WAITS } from "../src/byok.js";
import { byokChatChain } from "../src/ee/byok-custom.js";

assert.deepEqual(OWN_RETRY_WAITS, [1000, 3000]); OWN_RETRY_WAITS.splice(0, 2, 0, 0);   // the real waits, then none so the test does not sleep
const cfg = Object.defineProperty({ base: "https://llm.example-ai.com/v1", host: "llm.example-ai.com", model: "m", fast: "m" }, "key", { value: "sk-test-retry-0000" });
const body = { messages: [{ role: "user", content: "hi" }], stream: false };
const answer = (model) => Response.json({ choices: [{ message: { role: "assistant", content: `answer-${model}` } }], usage: {} });
// steps per model: "drop" (fetch throws, no status), "500", "429-limit", "ok"; the last step repeats.
function fake(steps) {
  const calls = [];
  const f = async (_u, init) => {
    const model = JSON.parse(init.body).model, n = calls.filter((c) => c === model).length; calls.push(model);
    const s = steps[model][Math.min(n, steps[model].length - 1)];
    if (s === "drop") throw new TypeError("fetch failed");
    if (s === "500") return new Response("{}", { status: 500 });
    if (s === "429-limit") return Response.json({ error: { message: "weekly usage limit reached" } }, { status: 429 });
    return answer(model);
  };
  f.calls = calls; return f;
}
const planOf = (...models) => ({ title: "G", maxPrice: null, chain: models.map((m) => ({ model: m, effort: null, facts: null })) });
const run = async (steps, models) => {
  const f = fake(steps);
  const plan = planOf(...models);
  const r = await byokChatChain(cfg, body, plan, { fetchImpl: f });
  return { r, calls: f.calls };
};

test("no status twice, then success: the same model answers", async () => {
  const { r, calls } = await run({ a: ["drop", "drop", "ok"], b: ["ok"] }, ["a", "b"]);
  assert.equal(r.pick.model, "a"); assert.deepEqual(calls, ["a", "a", "a"]);
  assert.match(await r.response.text(), /answer-a/);
});
test("no status three times: the chain moves to the next model; the failure says what happened", async () => {
  const { r, calls } = await run({ a: ["drop"], b: ["ok"] }, ["a", "b"]);
  assert.equal(r.pick.model, "b"); assert.deepEqual(calls, ["a", "a", "a", "b"]);
  assert.match(r.pick.failed[0].error, /couldn't connect/);
});
test("a 5xx retries too", async () => {
  const { r, calls } = await run({ a: ["500", "ok"] }, ["a"]);
  assert.equal(r.pick.model, "a"); assert.deepEqual(calls, ["a", "a"]);
});
test("a 429 limit goes straight to the next model", async () => {
  const { r, calls } = await run({ a: ["429-limit"], b: ["ok"] }, ["a", "b"]);
  assert.equal(r.pick.model, "b"); assert.deepEqual(calls, ["a", "b"]);
});
