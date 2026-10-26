// node --import ./test/stubs/register.mjs test/mem0-orphan-vectors.test.mjs
// A vector that Vectorize writes after the delete (its writes land late) has no D1 row. Deleted ids are deleted again later, and a search is not shortened by such vectors.
import test from "node:test";
import assert from "node:assert/strict";
import { MemStore, nsOf, removeRows, goneVectorsDue } from "../src/mem0-store.js";
import { memEnv, embedding } from "./helpers/mem0-fakes.mjs";

const bank = "dev-11111111-2222-3333-4444-555555555555-main";
const add = async (env, ns, id, text) => new MemStore(env, ns).write([embedding(text)], [id], [{ data: text, hash: id, createdAt: "2026-10-26T00:00:00Z" }]);

test("a vector written after its delete is deleted again by the recheck, and only after its delay", async () => {
  const { env, index } = memEnv(), ns = await nsOf(bank), real = Date.now;
  try {
    await add(env, ns, "a1", "physician appointment tomorrow");
    await removeRows(env, ns);
    assert.equal(index.rows.size, 0, "deleted now");
    index.rows.set("a1", { id: "a1", namespace: ns, values: embedding("physician appointment tomorrow"), metadata: {} });   // the late write of Vectorize
    assert.equal(await goneVectorsDue(env), 0, "nothing is due at once");
    let t = real() + 3 * 60e3; Date.now = () => t;
    assert.equal(await goneVectorsDue(env), 1); assert.equal(index.rows.size, 0, "the late vector is gone");
    t += 11 * 60e3; assert.equal(await goneVectorsDue(env), 1, "a second recheck at 10 minutes");
    t += 31 * 60e3; assert.equal(await goneVectorsDue(env), 1, "a third at 30 minutes");
    t += 31 * 60e3; assert.equal(await goneVectorsDue(env), 0, "then the id is forgotten");
    assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM mem_vec_gone").first()).n, 0);
  } finally { Date.now = real; }
});

test("stale vectors with no D1 row never shorten a page: the index is asked for more and the page is cut after the filter", async () => {
  const { env, index } = memEnv(), ns = await nsOf(bank), q = embedding("physician appointment");
  for (let i = 0; i < 25; i++) index.rows.set(`stale${i}`, { id: `stale${i}`, namespace: ns, values: embedding("physician appointment"), metadata: {} });   // closer to the query than any real fact
  for (let i = 0; i < 12; i++) await add(env, ns, `real${i}`, `physician appointment note ${i} with other words`);
  const out = await new MemStore(env, ns).search(q, 10);
  assert.equal(out.length, 10, "a full page of real facts");
  assert.ok(out.every((r) => r.id.startsWith("real")));
  assert.ok(index.calls.at(-1).topK >= 40 && index.calls.at(-1).topK <= 100, "more than the page was asked for, never over the limit");
  assert.equal((await new MemStore(env, ns).search(q, 100)).length, 12, "a page of 100 still works");
});

test("an id that has a row in D1 again before its recheck keeps its vector, and the other ids are still deleted again", async () => {
  const { env, index } = memEnv(), ns = await nsOf(bank), real = Date.now;
  try {
    await add(env, ns, "same", "physician appointment tomorrow"); await add(env, ns, "other", "dentist on friday");
    await removeRows(env, ns);
    await add(env, ns, "same", "physician appointment tomorrow");   // written again with the same id before the recheck
    index.rows.set("other", { id: "other", namespace: ns, values: embedding("dentist on friday"), metadata: {} });   // the late write of the deleted one
    Date.now = () => real() + 3 * 60e3;
    assert.equal(await goneVectorsDue(env), 2);
    assert.ok(index.rows.has("same"), "the live vector survives"); assert.ok(!index.rows.has("other"), "the deleted one is gone");
    assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM mem_vec_gone WHERE id='same'").first()).n, 0, "the live id is forgotten");
  } finally { Date.now = real; }
});
