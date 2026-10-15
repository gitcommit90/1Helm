// node --import ./test/stubs/register.mjs test/ambient-search.test.mjs
// Hybrid ambient search: tolerant keywords plus meaning (fake embedder), ranking, filters, paging, billing,
// resume, privacy and deletion. Real model quality is not measured here.
import assert from "node:assert/strict";
import { makeStore, T } from "./helpers/search-store.mjs";
import { termVariants, groupHit, normText, passageWindows, quantize, cosineQ, fuse } from "../src/ee/ambient-search.js";
import { fakeEmbed } from "./helpers/fake-embedder.mjs";
import { ambientQuery } from "../src/ee/ambient-query.js";

const DAY1 = ["so um i gotta call the land lord about the leak in the bathroom", "Remind me to pick up Sarah's prescripshun tomorrow around five", "maybe I could learn the cello someday", "buy oat milk and some bread"];
const DAY2 = ["call the guy about the leak under the sink", "email the accountant about the tax form", "need to renew the car registration by friday", "the landlord called back about the lease"];
const DAY3 = ["the weather is lovely today", "we watched a documentary about penguins"];
const task = (text, quote, line, kind = "task") => ({ kind, speech_act: "intention", text, quote, line, status: "open", due_text: "", relation: null, supersedes: [] });
const extract = async (lines) => ({ items: lines.flatMap((l, i) => /call|remind|email|renew/i.test(l.text) ? [task(l.text.replace(/^so um i gotta /i, "").replace(/^remind me to /i, "").replace(/^need to /i, ""), l.text, i, /remind/i.test(l.text) ? "reminder" : "task")] : []) });

async function build(opts = {}) {
  const F = makeStore({ ...opts, extract });
  const conv = F.conv; F.conv = conv;
  await F.store.ingest("bee", 1, F.conv(1, DAY1)); await F.store.ingest("bee", 2, F.conv(2, DAY2, { at: T + 864e5 })); await F.store.ingest("bee", 3, F.conv(3, DAY3, { at: T + 2 * 864e5 })); await F.store.ingest("bee", 4, F.conv(4, ["I think we should repaint the", "kitchen before summer"], { at: T + 3 * 864e5, gap: 5000 }));
  for (let i = 0; i < 6; i++) await F.store.run();
  return F;
}
const texts = (r) => (r.transcripts || []).map((x) => x.text.toLowerCase());
const hit = (r, needle, k = 3) => texts(r).slice(0, k).some((t) => t.includes(needle));

// ---- 1. tolerant keyword pieces ----
const vocab = new Set(["landlord", "land", "lord", "prescripshun", "leak", "plumbers", "accountant"]);
assert.ok(groupHit(termVariants("landlord", vocab)[0], normText("call the land lord")), "a joined word matches its split form");
assert.ok(groupHit(termVariants("land lord", vocab).find((g) => g.term === "land"), normText("the landlord called")), "split query words match the joined form");
assert.ok(groupHit(termVariants("prescription", vocab)[0], normText("my prescripshun")) > 0, "a phonetic ASR spelling of a long word");
assert.equal(groupHit(termVariants("prescription", new Set(["prescripshun", "persecution"]))[0], normText("the persecution")), 0, "a different word is not a typo");
assert.ok(groupHit(termVariants("acountant", vocab)[0], normText("the accountant")), "one missing letter");
assert.ok(groupHit(termVariants("plumber", vocab)[0], normText("two plumbers came")), "plural by stem");
assert.equal(termVariants("the and of", vocab).length, 3, "a query of only small words still searches");
assert.deepEqual(passageWindows([{ text: "a", speaker: "x", at: 0 }, { text: "b", speaker: "x", at: 1000 }, { text: "c", speaker: "y", at: 2000 }]).map((p) => [p.speaker, p.text]), [["x", "a b"], ["y", "c"]], "passages join adjacent lines of one speaker only");
const qa = quantize(fakeEmbed("plumber leak")), qb = quantize(fakeEmbed("plumber leak")); assert.ok(cosineQ(qa.q, qb.q, qa.scale * qb.scale) > 0.98);
assert.deepEqual(fuse([{ name: "a", ids: ["x", "y"] }, { name: "b", ids: ["y", "z"] }]).map((f) => f.id), ["y", "x", "z"], "an id in both lists rises");

// ---- 2. the query fixture: before (literal, all words) and after ----
const QUERIES = [
  ["landlord", "land lord"], ["land lord", "landlord"], ["prescription", "prescripshun"], ["pharmacy pickup", "prescripshun"], ["plumber", "leak"], ["plomero", "leak"], ["fuga", "leak"],
  ["instrument to learn", "cello"], ["music", "cello"], ["taxes", "tax form"], ["contador", "accountant"], ["groceries", "oat milk"], ["car paperwork", "registration"], ["rent", "land"],
  ["oat milk", "oat milk"], ["leak plumber sink", "leak"], ["acountant", "accountant"], ["somebody to fix the pipe", "leak"], ["painting job", "kitchen"],
];
const allLines = [...DAY1, ...DAY2, ...DAY3, "I think we should repaint the", "kitchen before summer"];
const literal = (q) => allLines.filter((l) => q.toLowerCase().split(/\s+/).every((w) => l.toLowerCase().includes(w)));
const before = QUERIES.filter(([q, n]) => literal(q).slice(0, 3).some((l) => l.toLowerCase().includes(n))).length;
const F = await build(), G = await build({ ai: false });
let hybrid = 0, keyword = 0; const misses = [];
for (const [q, n] of QUERIES) {
  const h = await F.store.search({ mode: "transcript", query: q, limit: 3 }), k = await G.store.search({ mode: "transcript", query: q, limit: 3 });
  if (hit(h, n)) hybrid++; else misses.push(q);
  if (hit(k, n)) keyword++;
}
console.log(`RECALL@3 over ${QUERIES.length} queries: literal all-words before ${before}, tolerant keywords only ${keyword}, hybrid ${hybrid}${misses.length ? ` (missed: ${misses.join(", ")})` : ""}`);
assert.ok(before <= 5 && keyword > before && hybrid >= QUERIES.length - 1 && hybrid > keyword);

// ---- 3. specific behaviours ----
let r = await F.store.search({ mode: "transcript", query: "plumber", limit: 5 });
assert.ok(hit(r, "leak"), "a paraphrase finds the speech"); assert.ok(r.transcripts[0].match.via.includes("meaning")); assert.equal(r.coverage.search.semantic, "used");
r = await G.store.search({ mode: "transcript", query: "plumber", limit: 5 });
assert.equal(r.transcripts.length, 0, "without semantic search a paraphrase has no keyword to match"); assert.equal(r.coverage.search.semantic, "not_used"); assert.match(r.coverage.search.semantic_unavailable, /not available/);
r = await G.store.search({ mode: "transcript", query: "landlord", limit: 5 });
assert.ok(hit(r, "land lord") && hit(r, "landlord called"), "keyword-only still finds split and joined forms"); assert.deepEqual(r.transcripts[0].match.via, ["keyword"]);
r = await F.store.search({ mode: "transcript", query: "leak plumber sink", limit: 10 });
assert.ok(r.transcripts.length >= 2 && texts(r)[0].includes("leak"), "any word ranks, not all words required");
assert.ok(r.transcripts[0].kind === "passage" && r.transcripts[0].utterance_ids.length >= 1 && r.transcripts[0].source_id, "passages carry their source");
// passages span adjacent lines by one speaker
assert.ok(F.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE line_to>line_from")[0].n >= 1, "passages join adjacent lines");

// items: meaning search finds the clean statement, filters still apply
r = await F.store.search({ mode: "items", query: "plumber" });
assert.ok(r.items.some((x) => /leak/i.test(x.text)) && r.items[0].match.via.includes("meaning"), "items are found by meaning");
r = await F.store.search({ mode: "items", query: "plumber", kind: "reminder" }); assert.equal(r.items.filter((x) => x.kind !== "reminder").length, 0, "kind filter holds");
r = await F.store.search({ mode: "items", query: "leak", from: T + 864e5 - 1000, to: T + 2 * 864e5 }); assert.ok(r.items.length && r.items.every((x) => x.source_at >= T + 864e5 - 1000), "date filter holds");
r = await F.store.search({ mode: "items", query: "leak", status: "completed" }); assert.equal(r.items.length, 0, "status filter holds");
r = await F.store.search({ mode: "transcript", query: "leak", source_id: "2" }); assert.ok(r.transcripts.length && r.transcripts.every((x) => x.source_id === "2"), "source filter holds");
r = await F.store.search({ mode: "transcript", query: "leak", from: T + 2 * 864e5 }); assert.equal(r.transcripts.length, 0, "date filter holds in transcript mode");

// pagination: ranked pages are consistent and complete
const full = await F.store.search({ mode: "transcript", query: "leak landlord tax milk", limit: 50 });
assert.ok(full.transcripts.length >= 4);
const pages = []; let cursor; do { const p = await F.store.search({ mode: "transcript", query: "leak landlord tax milk", limit: 2, ...(cursor ? { cursor } : {}) }); pages.push(...p.transcripts.map((x) => x.id)); cursor = p.next_cursor; } while (cursor);
assert.deepEqual(pages, full.transcripts.map((x) => x.id), "paging returns the full ranked list in order");
const first = await F.store.search({ mode: "transcript", query: "leak landlord tax milk", limit: 1 });
assert.ok((await F.store.search({ mode: "transcript", query: "other words", limit: 1, cursor: first.next_cursor })).error, "a cursor is bound to its query");
const bad = JSON.parse(atob(first.next_cursor)); bad.id = full.transcripts[3].id;
assert.ok((await F.store.search({ mode: "transcript", query: "leak landlord tax milk", limit: 1, cursor: btoa(JSON.stringify(bad)) })).error, "a cursor that does not match the ranking is rejected");
const itemsPage = await F.store.search({ mode: "items", query: "leak call", limit: 1 }); assert.ok(itemsPage.next_cursor, "items page"); const itemsNext = await F.store.search({ mode: "items", query: "leak call", limit: 1, cursor: itemsPage.next_cursor }); assert.notEqual(itemsNext.items[0]?.id, itemsPage.items[0].id);

// listing without a query is unchanged (chronological lines)
r = await F.store.search({ mode: "transcript", limit: 3 }); assert.ok(r.transcripts[0].at >= r.transcripts[1].at && r.transcripts[0].kind === undefined);

// ---- 4. locations mode matches by place or speech, tolerantly ----
{
  const L = makeStore({ extract }); await L.store.ingest("bee", 7, L.conv(7, ["call the land lord about the leak"], { location: { address: "12 Harbour Street", latitude: 1, longitude: 2 } })); await L.store.ingest("bee", 8, L.conv(8, ["buy oat milk"], { location: { address: "Corner Market", latitude: 3, longitude: 4 } }));
  for (let i = 0; i < 4; i++) await L.store.run();
  let lr = await L.store.search({ mode: "locations", query: "landlord" }); assert.deepEqual(lr.locations.map((x) => x.source_id), ["7"]); assert.ok(lr.locations[0].matching_transcript_evidence[0].text.includes("land lord"));
  lr = await L.store.search({ mode: "locations", query: "plumber" }); assert.deepEqual(lr.locations.map((x) => x.source_id), ["7"], "a place query also matches by meaning");
  lr = await L.store.search({ mode: "locations", query: "harbor street" }); assert.deepEqual(lr.locations.map((x) => x.source_id), ["7"], "address words match tolerantly");
  lr = await L.store.search({ mode: "locations", query: "nothing relevant here at all" }); assert.equal(lr.locations.length, 0);
}

// ---- 5. billing goes through the ledger ----
assert.ok(F.reserved.length && F.reserved.length === F.settled.length, "every embedding reserves and settles");
const firstTokens = F.aiCalls[0].texts.reduce((m, t) => m + Math.ceil(t.length / 4), 0), firstCost = Math.ceil(firstTokens * 12 * 1.15);
assert.equal(F.settled.find(([id]) => id.startsWith("ambient:embed:"))[1], firstCost, "charged by tokens at the Workers AI rate ($0.012 per million) with the usual 15 percent markup");
assert.ok(F.reserved[0][1] >= firstCost, "the reservation covers the charge");
assert.equal(F.store.rows("SELECT COUNT(*) n FROM ambient_attempts")[0].n, 0, "no reservation is left open");
{
  const B = makeStore({ extract }); B.allowSpend = false; await B.store.ingest("bee", 1, B.conv(1, DAY1)); for (let i = 0; i < 3; i++) await B.store.run();
  assert.equal(B.aiCalls.length, 0, "no credits: nothing is embedded"); assert.equal(B.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE vec IS NOT NULL")[0].n, 0);
  assert.ok(B.store.rows("SELECT COUNT(*) n FROM ambient_passages")[0].n > 0, "passages are still built");
  const kw = await B.store.search({ mode: "transcript", query: "landlord" }); assert.ok(kw.transcripts.length, "keyword search works without credits");
  assert.equal(B.store.dueAt() > Date.now() + 200000, true, "a paused index does not spin the alarm");
  B.allowSpend = true; B.host.put("ambient_embed_retry_at", null); await B.store.run(); assert.ok(B.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE vec IS NOT NULL")[0].n > 0, "indexing resumes when credits return");
}

// ---- 6. resume and bounded retries ----
{
  const R = makeStore({ extract }); R.failAI = 100; await R.store.ingest("bee", 1, R.conv(1, DAY1)); for (let i = 0; i < 8; i++) { R.store.sql.exec("UPDATE ambient_passages SET retry_at=0"); R.store.sql.exec("UPDATE ambient_item_vec SET retry_at=0"); R.host.put("ambient_embed_retry_at", null); await R.store.run(); }
  const tries = R.store.rows("SELECT MAX(tries) m FROM ambient_passages")[0].m; assert.equal(tries, 3, "each passage is tried at most 3 times");
  const calls = R.failAI; R.store.sql.exec("UPDATE ambient_passages SET retry_at=0"); R.store.sql.exec("UPDATE ambient_item_vec SET retry_at=0"); R.host.put("ambient_embed_retry_at", null); await R.store.run(); assert.equal(R.failAI, calls, "no further attempts after the bound");
  assert.equal((await R.store.search({ mode: "transcript", query: "landlord" })).transcripts.length >= 1, true, "failed embedding leaves keyword search working");
  assert.equal(R.store.rows("SELECT COUNT(*) n FROM ambient_attempts")[0].n, 0);
  // a crash between reserve and settle leaves a recoverable attempt that the next run releases
  R.store.sql.exec("INSERT INTO ambient_attempts VALUES('ambient:embed:crashed',?)", Date.now()); await R.store.run(); assert.ok(R.settled.some(([id, n]) => id === "ambient:embed:crashed" && n === 0), "interrupted reservation is released");
}

// ---- 7. privacy ----
{
  const P = makeStore({ extract }); P.hidden = "prescripshun"; await P.store.ingest("bee", 1, P.conv(1, DAY1)); for (let i = 0; i < 4; i++) await P.store.run();
  assert.ok(P.aiCalls.every((c) => c.texts.every((t) => !t.includes("prescripshun"))), "forgotten text is never sent to the embedder");
  assert.equal(P.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE vec IS NULL AND tries>=3 AND text LIKE '%prescripshun%'")[0].n >= 1, true);
  const M = makeStore({ extract }); await M.store.ingest("bee", 1, M.conv(1, DAY1)); M.memory = false; await M.store.run(); assert.equal(M.aiCalls.length, 0, "memory off: nothing is embedded");
  // forgotten while the embedding request ran: the vector is not stored
  const Q = makeStore({ extract }); await Q.store.ingest("bee", 1, Q.conv(1, DAY1)); const run = Q.env.AI.run; Q.env.AI.run = async (...a) => { const out = await run(...a); Q.hidden = "cello"; return out; };
  await Q.store.run(); assert.equal(Q.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE vec IS NOT NULL AND text LIKE '%cello%'")[0].n, 0, "text forgotten during the request is not stored");
}
// ambient_query: forgotten speech is excluded from search results, and a memory-off channel never reaches the index
{
  const S = F; let searches = 0;
  const binding = { idFromName: (n) => n, get: () => ({ ambientSearch: async (a) => { searches++; return S.store.search(a); }, ambientQuery: async (a) => S.store.query(a) }) };
  const res = { get: (k) => ({ channel: "main", tenant: "t1" })[k], env: { ONEHELM_EE: "1hc", BEE_SYNC: binding }, memoryMode: () => "on", forgottenNow: (json) => json.includes("cello") };
  const out = await ambientQuery(res, { mode: "transcript", query: "music instrument" });
  assert.ok(!JSON.stringify(out).includes("cello"), "forgotten speech does not come back through search"); assert.equal(out.coverage.withheld_by_memory_preferences >= 1, true);
  const off = await ambientQuery({ ...res, memoryMode: () => "off" }, { mode: "transcript", query: "leak" }); assert.equal(off.status, "memory_disabled"); assert.equal(searches, 1, "memory off does not reach the index");
  // an older object without ambientSearch falls back to the plain query
  const old = await ambientQuery({ ...res, env: { ONEHELM_EE: "1hc", BEE_SYNC: { idFromName: (n) => n, get: () => ({ ambientSearch: async () => { throw new Error("The RPC receiver does not implement the method ambientSearch"); }, ambientQuery: async (a) => S.store.query(a) }) } } }, { mode: "items", query: "leak" });
  assert.ok(Array.isArray(old.items));
  // unverified items are returned apart from confirmed ones
  const ghost = { id: "ambient:" + "c".repeat(64), kind: "task", text: "Book a flight", grounding: { state: "unlocated" }, evidence: [] }, real = { id: "ambient:" + "d".repeat(64), kind: "task", text: "Call mom", grounding: { state: "located" }, evidence: [] };
  const split = await ambientQuery({ ...res, forgottenNow: () => false, env: { ONEHELM_EE: "1hc", BEE_SYNC: { idFromName: (n) => n, get: () => ({ ambientQuery: async () => ({ items: [real, ghost], coverage: {}, next_cursor: null }) }) } } }, { mode: "items" });
  assert.deepEqual(split.items.map((x) => x.id), [real.id]); assert.deepEqual(split.possibly_said.map((x) => x.id), [ghost.id]); assert.match(split.possibly_said_note, /could not be found/);
}

// ---- 8. deletion removes vectors and index rows ----
{
  const D = await build(); const count = (t) => D.store.rows(`SELECT COUNT(*) n FROM ${t}`)[0].n;
  assert.ok(count("ambient_passages") > 0 && count("ambient_item_vec") > 0 && count("ambient_vocab") > 0);
  assert.ok((await D.store.search({ mode: "transcript", query: "penguins" })).transcripts.length, "searchable before delete");
  D.store.remove("bee", 3);   // Bee conversation deletion
  assert.equal(D.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE source_id='3'")[0].n, 0, "passages of a deleted conversation are gone");
  assert.equal((await D.store.search({ mode: "transcript", query: "penguins documentary" })).transcripts.length, 0);
  { const idx = D.store.index, streamed = []; const iter = idx.iter.bind(idx); idx.iter = (q, ...a) => { streamed.push(q); return iter(q, ...a); }; D.host.put("ambient_vocab_dirty", "1");
    assert.ok(!idx.vocab().has("penguins"), "its words leave the vocabulary");
    assert.ok(streamed.some((q) => /FROM ambient_passages/.test(q)) && streamed.some((q) => /FROM ambient_items/.test(q)), "the vocabulary rebuild streams passages and items instead of loading them all"); idx.vocab(); idx.vocabSet = null; idx.vocab(); assert.ok(streamed.some((q) => /FROM ambient_vocab/.test(q)), "so does the vocabulary load"); }
  D.store.remove("bee", 2);   // items of a deleted conversation lose their vectors
  assert.equal(D.store.rows("SELECT COUNT(*) n FROM ambient_item_vec v WHERE NOT EXISTS(SELECT 1 FROM ambient_items i WHERE i.id=v.id)")[0].n, 0, "no vector outlives its item");
  // changed speech replaces its passages
  await D.store.ingest("bee", 1, D.conv(1, ["brand new words about volcanoes"])); for (let i = 0; i < 3; i++) await D.store.run();
  assert.equal((await D.store.search({ mode: "transcript", query: "cello" })).transcripts.length, 0, "old passages of a changed recording are gone"); assert.ok((await D.store.search({ mode: "transcript", query: "volcanoes" })).transcripts.length);
  // disconnect "remove" (clear) wipes every index table
  D.store.clear(); for (const t of ["ambient_passages", "ambient_item_vec", "ambient_vocab", "ambient_qvec"]) assert.equal(count(t), 0, `${t} wiped by disconnect remove`);
  assert.equal((await D.store.search({ mode: "transcript", query: "volcanoes" })).transcripts.length, 0);
  // account deletion: the object's whole storage is deleted, and a rebuilt store starts empty
  const fresh = makeStore({ extract }); assert.equal(fresh.store.rows("SELECT COUNT(*) n FROM ambient_passages")[0].n, 0);
}
// the query vector is cached so paging never embeds (or bills) again
{ const before = F.aiCalls.length; await F.store.search({ mode: "transcript", query: "leak landlord tax milk", limit: 1 }); await F.store.search({ mode: "transcript", query: "leak landlord tax milk", limit: 1 }); assert.equal(F.aiCalls.length, before, "repeated query does not call the model again"); }
// ---- 9. the 24 hour ambient-day fixture: recall and indexing cost ----
{
  const { ambientDayConversation } = await import("./fixtures/ambient-day.mjs");
  const mk = async (opts) => { const D = makeStore(opts); await D.store.ingest("bee", 910011, ambientDayConversation()); for (let i = 0; i < 40 && D.store.index.nextWork() != null; i++) { D.host.put("ambient_embed_retry_at", null); await D.store.run(true); } return D; };
  const H = await mk({}), K = await mk({ ai: false });
  const DQ = [["libary books", "library books"], ["doctor visit", "rivera"], ["travel document", "passport"], ["school paperwork", "permission form"], ["gardening event", "seed swap"], ["quiet appointments", "quiet appointments"], ["passprt", "passport"], ["permision form", "permission form"], ["email priya", "email priya"], ["tomorow at ten", "tomorrow at ten"]];
  const lines = ambientDayConversation().transcriptions[0].utterances.map((u) => u.text.toLowerCase());
  const lit = DQ.filter(([q, n]) => lines.filter((l) => q.split(" ").every((w) => l.includes(w))).slice(0, 3).some((l) => l.includes(n))).length;
  let h = 0, k = 0;
  for (const [q, n] of DQ) { if (hit(await H.store.search({ mode: "transcript", query: q, limit: 3 }), n)) h++; if (hit(await K.store.search({ mode: "transcript", query: q, limit: 3 }), n)) k++; }
  console.log(`AMBIENT-DAY RECALL@3 over ${DQ.length} queries: literal all-words before ${lit}, tolerant keywords only ${k}, hybrid ${h}`);
  assert.ok(h >= DQ.length - 1 && k > lit && h >= k);
  const chars = H.aiCalls.flatMap((c) => c.texts).reduce((n, t) => n + t.length, 0), tokens = Math.ceil(chars / 4), passages = H.store.rows("SELECT COUNT(*) n FROM ambient_passages")[0].n, nano = H.settled.reduce((n, [, c]) => n + c, 0);
  const rawChars = lines.reduce((n, l) => n + l.length, 0);
  console.log(`AMBIENT-DAY INDEX COST: ${lines.length} utterances, ${rawChars} transcript characters, ${passages} passages, ${tokens} embedded tokens, charged ${nano} nano dollars ($${(nano / 1e9).toFixed(6)}) for the day; per year ($${(nano / 1e9 * 365).toFixed(4)})`);
  assert.ok(nano > 0 && nano < 5e6, "a full day of speech costs under half a cent to index");
  assert.equal(H.store.query({ mode: "transcript", query: "passport" }).coverage.search.indexing_complete, true);
}
console.log("PASS ambient search: tolerant keywords, meaning, ranking, filters, paging, locations, billing, resume, privacy, deletion");
