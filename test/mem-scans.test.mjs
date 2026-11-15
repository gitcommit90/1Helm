// node --import ./test/stubs/register.mjs test/mem-scans.test.mjs
// No full scans of `mem`, size errors keep the file (embedded cut short), and a retry after a failed write does not extract again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { retainV2, memoriesList, bankId, EMBED_RETRY_MS } from "../src/mem0.js";
import { removeRows, nsOf } from "../src/mem0-store.js";
import { memEnv, fakeExtraction, embedding } from "./helpers/mem0-fakes.mjs";

EMBED_RETRY_MS.splice(0, EMBED_RETRY_MS.length, 0, 0);
const bank = bankId({ ENV_NAME: "dev" }, "11111111-2222-3333-4444-555555555555", "main");
const item = { document_id: "note:1", content: "Sam prefers green tea.", at: Date.UTC(2026, 9, 1) };
const one = () => [{ text: "Sam prefers green tea", category: "preference" }];

test("the mem statements use an index (EXPLAIN QUERY PLAN on the real schema)", () => {
  const ddl = readFileSync("db/migrations/0063_memory.sql", "utf8") + readFileSync("db/migrations/0085_mem_id_index.sql", "utf8");
  const plan = (q) => execFileSync("sqlite3", [":memory:"], { input: `${ddl}\nEXPLAIN QUERY PLAN ${q};`, encoding: "utf8" });
  for (const q of ["SELECT id, ns FROM mem WHERE ns>='a' AND ns<'a￿' AND doc='x'", "DELETE FROM mem WHERE ns>='a' AND ns<'a￿' AND id IN ('1','2')", "SELECT id FROM mem WHERE id IN ('1','2')", "SELECT COUNT(*) FROM mem WHERE ns>='a' AND ns<'a￿'"])
    assert.ok(!/SCAN mem\b(?! USING INDEX)/.test(plan(q).replace(/SCAN mem USING COVERING INDEX \S+/, "")), q + "\n" + plan(q));
});

test("removeRows by prefix deletes only that prefix", async () => {
  const { env } = memEnv(), ns = await nsOf(bank), x = fakeExtraction(one);
  try { await retainV2(env, bank, [item]); assert.equal(await removeRows(env, "zz"), 0); assert.ok(await removeRows(env, ns) >= 1); assert.equal((await memoriesList(env, bank, {})).items.length, 0); } finally { x.done(); }
});

test("a text too long for the embedding model is stored, embedded cut short, and the error is not retried", async () => {
  const long = "x".repeat(9000), calls = [];
  const ai = { run: async (_m, input) => { calls.push(input.text.map((t) => t.length)); if (input.text.some((t) => t.length > 4000)) throw new Error("8007: Sequence too long: 11950 > 8192"); return { data: input.text.map(embedding), usage: {} }; } };
  const { env } = memEnv({ AI: ai });
  await retainV2(env, bank, [{ document_id: "file:1", content: long, strategy: "verbatim", at: Date.now() }]);
  assert.equal((await memoriesList(env, bank, { doc: "file:1" })).items.length, 1, "the file is remembered");
  assert.deepEqual(calls, [[9000], [4000]], "one try as is, then the cut text");
});

test("a retry after only the write failed does not extract again", async () => {
  const { env } = memEnv(), x = fakeExtraction(one), real = env.DB.batch.bind(env.DB), it = { ...item };
  try {
    env.DB.batch = async () => { throw new Error("D1_ERROR: D1 DB is overloaded"); };
    await assert.rejects(retainV2(env, bank, [it]), /overloaded/);
    const paid = x.calls?.length ?? null;
    env.DB.batch = real;
    await retainV2(env, bank, [JSON.parse(JSON.stringify(it))]);   // the outbox stores the item as JSON
    assert.equal((await memoriesList(env, bank, { doc: "note:1" })).items.length, 1);
    if (paid != null) assert.equal(x.calls.length, paid, "no second extraction call");
  } finally { x.done(); }
});
