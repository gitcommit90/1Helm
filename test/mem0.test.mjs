// node --import ./test/stubs/register.mjs test/mem0.test.mjs
// The Mem0 memory (src/mem0.js, src/mem0-store.js): what is stored and found per channel, document replace and append, raw chunks without a model call,
// the time and source filters, the topK limit of Vectorize, deletes, and the category block. Tests check what is stored and found, never the model's wording.
import test from "node:test";
import assert from "node:assert/strict";
import { retainV2, recall, forgetDocument, forgetChannel, forgetTenant, memoriesList, listDocuments, categoryBlock, factsOf, bankId, pieces, CATEGORIES } from "../src/mem0.js";
import { vecFilter, sqlFilter, nsOf, MemStore } from "../src/mem0-store.js";
import { memEnv, fakeExtraction } from "./helpers/mem0-fakes.mjs";

const T1 = "11111111-2222-3333-4444-555555555555", T2 = "99999999-2222-3333-4444-555555555555";
const bankA = bankId({ ENV_NAME: "dev" }, T1, "main"), bankB = bankId({ ENV_NAME: "dev" }, T1, "project"), bankC = bankId({ ENV_NAME: "dev" }, T2, "main");
const newest = (p) => p.split("## New Messages").pop().split("## Observation Date")[0];   // the part of the extraction prompt that holds the item
const tea = (p) => (/tea/i.test(p) ? [{ text: "Sam prefers green tea in the morning", category: "preference" }] : /walnut/i.test(p) ? [{ text: "Sam's sister Priya is allergic to walnuts", category: "person" }] : []);

test("filters: Mem0 filters become Vectorize and SQL filters, and anything else is refused", () => {
  assert.deepEqual(vecFilter({ user_id: "x", ts: { gte: 5, lt: 9 }, source: "bee" }), { ts: { $gte: 5, $lt: 9 }, source: { $eq: "bee" } });
  assert.equal(vecFilter({ user_id: "x" }), undefined);
  assert.throws(() => vecFilter({ doc: "a" }), /not indexed/);
  assert.throws(() => vecFilter({ $or: [{ ts: 1 }] }), /not supported/);
  assert.throws(() => vecFilter({ ts: { contains: 1 } }), /operator/);
  assert.deepEqual(sqlFilter({ user_id: "x", ts: { gte: 5 }, doc: "d" }), { sql: " AND json_extract(payload,'$.ts') >= ? AND json_extract(payload,'$.doc') = ?", args: [5, "d"] });
  assert.throws(() => sqlFilter({ "a'b": 1 }), /not valid/);
});

test("a long text is cut at line breaks into pieces of at most the size", () => {
  const out = pieces(`${"a".repeat(30)}\n${"b".repeat(30)}\n${"c".repeat(100)}`, 70);
  assert.ok(out.every((p) => p.length <= 70)); assert.equal(out.join("").replace(/\n/g, ""), `${"a".repeat(30)}${"b".repeat(30)}${"c".repeat(100)}`);
});

test("retain extracts facts with a category, search finds them in that channel only, and the index is asked for at most 100", async () => {
  const { env, index } = memEnv(), x = fakeExtraction(tea);
  try {
    await retainV2(env, bankA, [{ document_id: "note:1", content: "Sam prefers green tea in the morning.", at: Date.UTC(2026, 9, 1), context: "A note", metadata: { kind: "note" }, tags: ["source:note"] }]);
    assert.equal(x.calls.length, 1, "one extraction call for the item");
    assert.match(JSON.stringify(x.calls[0].messages), /Observation Date/);
    const r = await recall(env, bankA, "which tea does Sam like", {});
    assert.equal(r.results.length, 1); assert.equal(r.results[0].type, "preference"); assert.equal(r.results[0].document_id, "note:1"); assert.match(r.results[0].text, /green tea/);
    const words = await new MemStore(env, await nsOf(bankA)).keywordSearch("green tea", 5, { user_id: "x" });
    assert.equal(words.length, 1, "the keyword index finds the fact too"); assert.ok(words[0].score > 0);
    assert.deepEqual((await recall(env, bankB, "which tea does Sam like", {})).results, [], "another channel of the same account sees nothing");
    assert.deepEqual((await recall(env, bankC, "which tea does Sam like", {})).results, [], "another account sees nothing");
    assert.ok(index.calls.length && index.calls.every((c) => c.topK <= 100), "topK is clamped to what Vectorize allows");
    assert.ok(CATEGORIES.includes(r.results[0].type));
  } finally { x.done(); }
});

test("replace deletes the document's facts first, and append keeps them", async () => {
  const { env } = memEnv(), x = fakeExtraction((p) => [{ text: `fact ${/zq2/.test(newest(p)) ? "second" : /zq3/.test(newest(p)) ? "third" : "first"} walnut`, category: "other" }]);
  try {
    const item = (content, mode) => ({ document_id: "conv:t:2026-10-01", content, at: Date.now(), update_mode: mode });
    await retainV2(env, bankA, [item("zq1", "replace")]);
    await retainV2(env, bankA, [item("zq2", "append")]);
    assert.deepEqual((await memoriesList(env, bankA, { doc: "conv:t:2026-10-01" })).items.map((i) => i.text).sort(), ["fact first walnut", "fact second walnut"]);
    await retainV2(env, bankA, [item("zq3", "replace")]);
    assert.deepEqual((await memoriesList(env, bankA, { doc: "conv:t:2026-10-01" })).items.map((i) => i.text), ["fact third walnut"]);
    assert.deepEqual(await listDocuments(env, bankA, { q: "conv:" }), [{ id: "conv:t:2026-10-01", facts: 1 }]);
  } finally { x.done(); }
});

test("raw kinds are stored as chunks with no model call, and a search can be limited to one source and a time range", async () => {
  const { env } = memEnv(), x = fakeExtraction(() => []);
  try {
    const lines = Array.from({ length: 30 }, (_, i) => `[t] Speaker: the plumber said the leak under the sink is fixed ${i}`).join("\n");
    const out = await retainV2(env, bankA, [{ document_id: "bee:conv:1", content: lines, at: Date.UTC(2026, 9, 5), strategy: "raw-transcript", tags: ["source:bee", "kind:raw"] },
      { document_id: "file:9", content: "plumber invoice for the leak", at: Date.UTC(2026, 9, 20), strategy: "reference", tags: ["source:file"] }]);
    assert.equal(out.items, 2); assert.equal(x.calls.length, 0, "no extraction call");
    const bee = await recall(env, bankA, "plumber leak", { source: "bee" });
    assert.ok(bee.results.length > 1 && bee.results.every((r) => r.raw && r.document_id === "bee:conv:1"));
    const early = await recall(env, bankA, "plumber leak", { scope: { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 10) } });
    assert.ok(early.results.length && early.results.every((r) => r.document_id === "bee:conv:1"), "a range keeps only the items inside it");
    const late = await recall(env, bankA, "plumber leak", { scope: { from: Date.UTC(2026, 9, 10) } });
    assert.ok(late.results.length && late.results.every((r) => r.document_id === "file:9"));
    assert.equal((await factsOf(env, bankA)).length, 0, "raw chunks are not facts of the profile");
  } finally { x.done(); }
});

test("deleting a document, a channel and an account removes rows and vectors, and only theirs", async () => {
  const { env, index } = memEnv(), x = fakeExtraction((p) => [{ text: `tea fact ${newest(p).match(/zq\d+/)?.[0]}`, category: "other" }]);
  try {
    let n = 0;
    for (const [b, d] of [[bankA, "note:1"], [bankA, "note:2"], [bankB, "note:1"], [bankC, "note:1"]]) await retainV2(env, b, [{ document_id: d, content: `tea zq${n++}`, at: Date.now() }]);
    const count = async (b) => (await env.DB.prepare("SELECT COUNT(*) n FROM mem WHERE ns LIKE ?").bind(`${(await nsOf(b))}%`).first()).n;
    const [a0, b0] = [await count(bankA), await count(bankB)];
    assert.ok(a0 > 0 && b0 > 0 && index.rows.size > 0);
    assert.equal((await forgetDocument(env, bankA, "note:2")).deleted, 1); assert.equal((await forgetDocument(env, bankA, "note:2")).deleted, 0, "a second delete finds nothing");
    assert.ok((await count(bankA)) < a0 && (await count(bankB)) === b0);
    await forgetChannel(env, T1, "main"); assert.equal(await count(bankA), 0); assert.equal(await count(bankB), b0);
    const keep = await count(bankC); await forgetTenant(env, T1); assert.equal(await count(bankB), 0); assert.equal(await count(bankC), keep, "another account keeps its memory");
    const nsA = await nsOf(bankA);
    assert.equal([...index.rows.values()].filter((v) => v.namespace.startsWith(nsA.slice(0, 16))).length, 0, "the vectors went with the rows");
    assert.equal(await env.DB.prepare("SELECT COUNT(*) n FROM mem_fts WHERE ns=?").bind(await nsOf(bankA)).first().then((r) => r.n), 0, "and the keyword index");
  } finally { x.done(); }
});

test("the profile block ranks categories, always keeps identity and respects the budget", () => {
  const f = (type, text, at) => ({ type, text, mentioned_at: new Date(at).toISOString() });
  const facts = [f("place", "Lives near the lake", 3), f("identity", "Sam is a baker", 1), f("preference", "Likes green tea", 2), f("rule", "Never book flights without asking", 2), f("preference", "Likes quiet hotels", 5)];
  const out = categoryBlock(facts, { chars: 100 }).split("\n");
  assert.equal(out[0], "Identity:"); assert.ok(out.indexOf("Rule:") < out.indexOf("Preference:"), "category order");
  assert.ok(out.indexOf("- Likes quiet hotels") < out.indexOf("- Likes green tea"), "newest first inside a category");
  assert.ok(out.includes("- Sam is a baker"), "identity is kept past the budget");
  assert.ok(!out.includes("- Lives near the lake"), "the budget cuts the rest");
});

test("deleting a document also removes its facts from the entity rows, and an entity with no fact left", async () => {
  const { env, index } = memEnv(), x = fakeExtraction((p) => [{ text: `${newest(p).match(/zq\d+/)?.[0]} visited Lisbon with Priya`, category: "person" }]);
  try {
    for (const d of ["note:a", "note:b"]) await retainV2(env, bankA, [{ document_id: d, content: `zq${d.length + d.charCodeAt(5)} text`, at: Date.now() }]);
    const ns = await nsOf(bankA), ents = async () => (await env.DB.prepare("SELECT id, payload FROM mem WHERE ns=?").bind(`${ns}_entities`).all()).results.map((r) => ({ id: r.id, ...JSON.parse(r.payload) }));
    const before = await ents()
    const priya = before.find((e) => e.data === "Lisbon");
    assert.ok(priya && priya.linkedMemoryIds.length === 2, "the shared entity links both facts");
    const keep = (await memoriesList(env, bankA, { doc: "note:b" })).items[0].id;
    await forgetDocument(env, bankA, "note:a");
    const after = await ents(), p2 = after.find((e) => e.id === priya.id);
    assert.deepEqual(p2.linkedMemoryIds, [keep], "the shared entity keeps only the kept fact");
    assert.ok(after.every((e) => e.linkedMemoryIds.every((id) => id === keep)), "no entity links a deleted fact");
    await forgetDocument(env, bankA, "note:b");
    assert.equal((await ents()).length, 0, "an entity with no fact left is deleted"); assert.equal([...index.rows.values()].filter((v) => v.namespace.endsWith("_entities")).length, 0, "and its vector");
  } finally { x.done(); }
});

test("items of different documents are written at once (at most 4), and one document keeps its order", async () => {
  const { env } = memEnv(); let now = 0, peak = 0; const real = globalThis.fetch, order = [];
  globalThis.fetch = async (url, init = {}) => { const p = JSON.parse(init.body).messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join(""))).join("\n"), tag = newest(p).match(/zq\d+/)?.[0];
    now++; peak = Math.max(peak, now); await new Promise((z) => setTimeout(z, 20)); now--; order.push(tag);
    return new Response(JSON.stringify({ model: "m", provider: "P", choices: [{ message: { role: "assistant", content: JSON.stringify({ memory: [{ id: "0", text: `fact ${tag}`, category: "other" }] }) }, finish_reason: "stop" }], usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    await retainV2(env, bankA, Array.from({ length: 9 }, (_, k) => ({ document_id: `d:${k}`, content: `zq${k}`, at: Date.now() })));
    assert.equal(peak, 4, "four at a time, no more"); peak = 0; order.length = 0;
    await retainV2(env, bankA, [{ document_id: "same", content: "zq100", at: Date.now(), update_mode: "append" }, { document_id: "same", content: "zq101", at: Date.now(), update_mode: "append" }]);
    assert.equal(peak, 1); assert.deepEqual(order, ["zq100", "zq101"], "the same document is written in order");
  } finally { globalThis.fetch = real; }
});

test("a rare word that the vector search misses is still found, because keyword hits join the candidates", async () => {
  const { env } = memEnv(), x = fakeExtraction(() => []);
  try {
    const fillers = Array.from({ length: 100 }, (_, k) => ({ document_id: `bee:conv:f${k}`, content: `plumber leak sink note${k}`, at: Date.now(), strategy: "verbatim", tags: ["source:bee"] }));
    await retainV2(env, bankA, [...fillers, { document_id: "bee:conv:t", content: "zorblax plumber aa bb", at: Date.now(), strategy: "verbatim", tags: ["source:bee"] }]);
    const r = await recall(env, bankA, "plumber leak sink zorblax", { source: "bee", topK: 200 });   // the vector search returns at most 100 of the 101 chunks
    assert.ok(r.results.some((x) => x.document_id === "bee:conv:t"), "the chunk with the rare word is among the results");
  } finally { x.done(); }
});

test("when one item of a wave fails, the others finish before the error is thrown", async () => {
  const { env } = memEnv(); let running = 0; const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { const p = JSON.parse(init.body).messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join(""))).join("\n");
    if (/zq0/.test(newest(p))) return new Response("down", { status: 500 });
    running++; await new Promise((z) => setTimeout(z, 60)); running--;
    return new Response(JSON.stringify({ model: "m", provider: "P", choices: [{ message: { role: "assistant", content: JSON.stringify({ memory: [{ id: "0", text: `fact ${newest(p).match(/zq\d+/)[0]}`, category: "other" }] }) }, finish_reason: "stop" }], usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    await assert.rejects(retainV2(env, bankA, [0, 1, 2].map((k) => ({ document_id: `d:${k}`, content: `zq${k}`, at: Date.now() }))));
    assert.equal(running, 0, "no write is still going when the error is thrown");
  } finally { globalThis.fetch = real; }
});

test("Vectorize mutations are batched, and a 429 (code 40041) is tried again instead of failing the write", async () => {
  const { env, index } = memEnv(); let upserts = 0, deletes = 0, fail = 2; const up = index.upsert, del = index.deleteByIds;
  index.upsert = async (l) => { upserts++; if (fail-- > 0) throw new Error("VECTOR_UPSERT_ERROR (code = 40041): Too Many Requests"); return up(l); };
  index.deleteByIds = async (i) => { deletes++; return del(i); };
  const lines = Array.from({ length: 30 }, (_, k) => `line ${k} ${"word ".repeat(100)}`).join("\n");   // 6 or more chunks
  await retainV2(env, bankA, [{ document_id: "r", content: lines, at: Date.now(), strategy: "raw-transcript" }]);
  assert.equal(upserts, 3, "two refused tries and one that worked, for all the chunks of the item together");
  assert.ok((await memoriesList(env, bankA, { doc: "r" })).items.length >= 6);
  await forgetDocument(env, bankA, "r"); assert.equal(deletes, 1, "all the vectors of a delete go in one call");
  fail = 99; await assert.rejects(retainV2(env, bankA, [{ document_id: "s", content: "text", at: Date.now(), strategy: "verbatim" }]), /40041/, "after five tries the error is thrown");
});
