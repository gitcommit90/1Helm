// node --import ./test/stubs/register.mjs test/mem0-nodrop.test.mjs
// An extracted fact is never lost without an error (mem0ai issues 5509 and 4932): a failed embedding is retried and then thrown, and an empty or cut-off extraction throws.
import test from "node:test";
import assert from "node:assert/strict";
import { retainV2, memoriesList, bankId, EMBED_RETRY_MS } from "../src/mem0.js";
import { memEnv, fakeExtraction, embedding } from "./helpers/mem0-fakes.mjs";

EMBED_RETRY_MS.splice(0, EMBED_RETRY_MS.length, 0, 0);   // no waiting in tests
const bank = bankId({ ENV_NAME: "dev" }, "11111111-2222-3333-4444-555555555555", "main");
const two = () => [{ text: "Sam prefers green tea in the morning", category: "preference" }, { text: "Sam's sister Priya is allergic to walnuts", category: "person" }];
const item = { document_id: "note:1", content: "Sam prefers green tea. Priya is allergic to walnuts.", at: Date.UTC(2026, 9, 1) };
const texts = async (env) => (await memoriesList(env, bank, { doc: "note:1" })).items.map((i) => i.text).sort();
// An AI binding whose embedding fails as `fails(texts, callNumber)` says (it throws, or returns nothing for a short count).
const aiWith = (fails) => { let n = 0; const calls = []; return { calls, run: async (_m, input) => { calls.push(input.text); fails(input.text, ++n); return { data: input.text.map(embedding), usage: {} }; } }; };

test("a batch embedding that fails once is retried and every fact is stored", async () => {
  const ai = aiWith((t, n) => { if (t.length === 2 && n <= 2) throw new Error("3040: Capacity temporarily exceeded"); }), { env } = memEnv({ AI: ai }), x = fakeExtraction(two);
  try {
    await retainV2(env, bank, [item]);
    assert.equal((await texts(env)).length, 2);
    assert.equal(ai.calls.filter((t) => t.length === 2).length, 2, "the batch was tried twice");
  } finally { x.done(); }
});

test("a batch that always fails still stores every fact when each single embedding works", async () => {
  const { env } = memEnv({ AI: aiWith((t) => { if (t.length === 2) throw new Error("boom"); }) }), x = fakeExtraction(two);
  try { await retainV2(env, bank, [item]); assert.equal((await texts(env)).length, 2); } finally { x.done(); }
});

test("a fact whose own embedding fails makes the add throw, and nothing from that add is written", async () => {
  const { env } = memEnv({ AI: aiWith((t) => { if (t.length === 2 || t[0].startsWith("Sam's sister")) throw new Error("boom"); }) }), x = fakeExtraction(two), log = console.warn; console.warn = () => {};
  try {
    await assert.rejects(retainV2(env, bank, [item]), /embedding failed/);
    assert.deepEqual(await texts(env), [], "Mem0 would have stored the first fact and reported success");
  } finally { x.done(); console.warn = log; }
});

test("a 400 from the embedding model is not retried", async () => {
  const ai = aiWith(() => { throw Object.assign(new Error("bad input"), { status: 400 }); }), { env } = memEnv({ AI: ai }), x = fakeExtraction(two), log = console.warn; console.warn = () => {};
  try { await assert.rejects(retainV2(env, bank, [item])); assert.equal(ai.calls.length, 1, "one try only"); } finally { x.done(); console.warn = log; }
});

// Replaces fetch: every extraction answers with the given choice.
const fakeChoice = (choice) => { const real = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ model: "served/m", provider: "P", choices: [choice], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } }); return () => { globalThis.fetch = real; }; };
for (const [name, choice, why] of [["empty content", { message: { role: "assistant", content: "" }, finish_reason: "stop" }, /no content/],
  ["content cut at the token limit", { message: { role: "assistant", content: '{"memory":[{"text":"Sam' }, finish_reason: "length" }, /cut off/],
  ["text that is not the memory list", { message: { role: "assistant", content: "I could not find anything." }, finish_reason: "stop" }, /not the memory list/]]) {
  test(`extraction with ${name} throws instead of saving an empty result`, async () => {
    const { env } = memEnv(), done = fakeChoice(choice), log = console.error; console.error = () => {};
    try { await assert.rejects(retainV2(env, bank, [item]), why); assert.deepEqual(await texts(env), []); } finally { done(); console.error = log; }
  });
}

test("an extraction that finds no facts ({\"memory\":[]}) is a success, and a repeated fact is not a loss", async () => {
  const { env } = memEnv(); let x = fakeExtraction(() => []);
  try { assert.deepEqual(await retainV2(env, bank, [item]), { items: 1 }); } finally { x.done(); }
  x = fakeExtraction(two);
  try { await retainV2(env, bank, [{ ...item, update_mode: "append" }]); await retainV2(env, bank, [{ ...item, update_mode: "append" }]); assert.equal((await texts(env)).length, 2, "the second add skips the duplicates and does not throw"); } finally { x.done(); }
});
