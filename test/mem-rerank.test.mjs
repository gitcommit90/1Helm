// node --import ./test/stubs/register.mjs test/mem-rerank.test.mjs
// Memory: rerank (job mem_rerank, src/mem0.js). Mem0's own reranker hook calls dispatch() for every search, so these tests check app facts only: the order Mem0 returns follows the scores
// the reranker model gave, a failed or malformed rerank keeps the search order, the call is the saved job with its gateway tags, the sizes sent, and the metered price. No test judges a model's wording.
import test from "node:test";
import assert from "node:assert/strict";
import { retainV2, recall, bankId } from "../src/mem0.js";
import { METER, hsRecallNano } from "../src/byok.js";
import { memEnv, embedding, overlap } from "./helpers/mem0-fakes.mjs";

const T1 = "11111111-2222-3333-4444-555555555555", bank = bankId({ ENV_NAME: "dev" }, T1, "main");
const FACTS = ["Sam pays the Maple Street Bakery invoice on Fridays", "The Maple Street Bakery invoice was added to the budget sheet", "Maple Street Bakery sends an invoice each month", "Priya is allergic to walnuts"];
const QUERY = "Maple Street Bakery invoice";
// An env whose Workers AI binding embeds like the default fake and answers the reranker with `rerank(input)`; every call is kept.
function setup(rerank) {
  const calls = [], { env } = memEnv();
  const embed = env.AI.run;
  env.AI = { run: async (model, input, opts) => { if (!input.contexts) return embed(model, input, opts); calls.push({ model, input, opts }); return rerank(input); } };
  return { env, calls };
}
const seed = (env, facts = FACTS) => retainV2(env, bank, facts.map((text, i) => ({ document_id: `d${i}`, content: text, at: Date.UTC(2026, 9, 1), strategy: "verbatim" })));
const texts = async (env, o = {}) => (await recall(env, bank, QUERY, o)).results.map((r) => r.text);

test("the order of a search follows the reranker's scores, and the number of results is the same", async () => {
  const plain = setup(() => { throw new Error("reranker down"); }); await seed(plain.env);
  const original = await texts(plain.env);
  const ranked = setup((i) => ({ response: i.contexts.map((_, id) => ({ id, score: id })) }));   // the last candidate scores highest
  await seed(ranked.env);
  const reordered = await texts(ranked.env);
  assert.equal(ranked.calls.length, 1, "one rerank call for one search");
  assert.deepEqual(reordered, ranked.calls[0].input.contexts.map((c) => c.text).reverse(), "best score first");
  assert.deepEqual([...reordered].sort(), [...original].sort(), "the same facts");
  assert.equal(reordered.length, original.length);
  const scored = (await recall(ranked.env, bank, QUERY, {})).results, plainScored = (await recall(plain.env, bank, QUERY, {})).results;
  assert.ok(scored.every((r) => Number.isFinite(r.scores.rerank)), "every result carries scores.rerank"); assert.ok(plainScored.every((r) => r.scores.rerank === undefined), "a failed rerank leaves none");
});

test("a rerank that fails, or answers with something unusable, keeps the order the search found and does not fail the search", async () => {
  const warn = console.warn, logged = []; console.warn = (...a) => logged.push(a.join(" "));
  try {
    const base = setup(() => { throw new Error("x"); }); await seed(base.env); const original = await texts(base.env);
    for (const bad of [() => { throw new Error("Workers AI 500"); }, () => ({ response: [{ id: 0, score: 1 }] }), () => ({ response: [{ id: 9, score: 1 }] }), () => ({}), () => new Promise((r) => setTimeout(() => r({ response: [{ id: 0, score: 1 }, { id: 1, score: 2 }, { id: 2, score: 3 }, { id: 3, score: 4 }] }), 400))]) {   // the last one answers after the job's timeout (50 ms)
      logged.length = 0;
      const s = setup(bad), env = { ...s.env, MODEL_SETTINGS: { ...s.env.MODEL_SETTINGS, jobs: { ...s.env.MODEL_SETTINGS.jobs, mem_rerank: { ...s.env.MODEL_SETTINGS.jobs.mem_rerank, timeout_ms: 50 } } } };
      await seed(env);
      assert.deepEqual(await texts(env), original, String(bad));
      assert.ok(logged.some((l) => /Reranking failed/.test(l)), "the failure is logged");
    }
  } finally { console.warn = warn; }
});

test("the call is the saved job mem_rerank, sent with its gateway tags, and a changed saved model is the one used", async () => {
  const s = setup((i) => ({ response: i.contexts.map((_, id) => ({ id, score: 0.5 })) }));
  await seed(s.env); await texts(s.env);
  assert.equal(s.calls[0].model, s.env.MODEL_SETTINGS.jobs.mem_rerank.model); assert.equal(s.calls[0].model, "@cf/baai/bge-reranker-base");
  assert.equal(s.calls[0].opts.gateway.metadata.job, "mem_rerank"); assert.equal(s.calls[0].opts.gateway.metadata.kind, "memory-rerank"); assert.equal(s.calls[0].opts.gateway.metadata.tenant, T1);
  const saved = JSON.parse(JSON.stringify(s.env.MODEL_SETTINGS)); saved.jobs.mem_rerank.model = "@cf/sentinel/other-reranker"; saved.catalog["@cf/sentinel/other-reranker"] = { ...saved.catalog["@cf/baai/bge-reranker-base"], name: "Other" };
  delete saved.catalog["@cf/baai/bge-reranker-base"];
  await texts({ ...s.env, MODEL_SETTINGS: saved });
  assert.equal(s.calls.at(-1).model, "@cf/sentinel/other-reranker");
});

test("the question and each fact are cut to a size the reranker can read, and a search asks for 20 results as before", async () => {
  const s = setup((i) => ({ response: i.contexts.map((_, id) => ({ id, score: overlap(i.query, i.contexts[id].text) })) }));
  const many = Array.from({ length: 25 }, (_, i) => `${"Maple Street Bakery invoice ".repeat(100)} number ${i}`);
  await seed(s.env, many);
  const r = await recall(s.env, bank, "Maple Street Bakery invoice ".repeat(25), {});
  assert.equal(r.results.length, 20, "the same count as without a rerank (topK 20)");
  const sent = s.calls[0].input; assert.equal(sent.contexts.length, 20); assert.ok(sent.query.length <= 400); assert.ok(sent.contexts.every((c) => c.text.length <= 1200));
});

test("a search with no result makes no rerank call, and the price of a search covers the query embedding and the rerank", async () => {
  const s = setup(() => { throw new Error("must not be called"); });
  assert.deepEqual(await texts(s.env), []); assert.equal(s.calls.length, 0);
  assert.equal(hsRecallNano(), METER.mem_search);
  assert.equal(METER.mem_search, Math.round(1000 + 20 * 200 * METER.mem_rerank_token), "embedding (1,000) plus 20 facts of about 200 tokens at the saved price");
  assert.ok(embedding("a").length === 1024);
});
