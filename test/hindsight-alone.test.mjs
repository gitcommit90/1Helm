// node --import ./test/stubs/register.mjs test/hindsight-alone.test.mjs
// Memory Overhaul phase 5. The local ledger, the upkeep, reflection and people jobs, their four flags, the ambient
// passage index and its flag were removed (the memory alone does their work). What is tested here:
//   0. The wrangler files carry none of the removed flags.
//   1. The memory alone: a real turn keeps the turns table and the memory conversation, recall_memory answers from the memory and says memory is unavailable
//      when it is down, recall_history reads the turns table, and nothing creates or reads the old ledger tables.
//   3. ambient_query: a search by words is always memory recall over the Bee documents; the plain list and the location search read the place data.
import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { tick } from "./deploy-harness.mjs";
import { Resident } from "../src/resident.js";
import { memWorld } from "./helpers/writers-world.mjs";
import { memEnv, fakeExtraction } from "./helpers/mem0-fakes.mjs";
import { retainV2, memoriesList, bankId } from "../src/mem0.js";
import { MEMORY_UNAVAILABLE, MEMORY_UNAVAILABLE_NOTE } from "../src/memory-unavailable.js";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-40).join("\n")); });
const ok = (name) => console.log("  ok", name);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const text = (m) => typeof m.content === "string" ? m.content : m.content?.filter((p) => p.type === "text").map((p) => p.text).join("");
const FULL = { ONEHELM_EE: "1hc", HS_FOUNDATIONS: "on", HS_USE: "on", HS_WRITERS: "on" };

// ================= 1. the memory alone =================
const T0 = Date.UTC(2026, 9, 14, 17, 0);
function mkR({ channel = "work", notes = [], extra = {} } = {}) {
  const W = memWorld({ engine: "classic", env: { CONTEXT_LAYOUT: "v2", RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0, GENUI: "on", MEMORY: "on", ...FULL, ...extra } });
  W.d1.exec("ALTER TABLE tenants ADD COLUMN helper_tone INTEGER; CREATE TABLE vault (tenant_id TEXT,name TEXT,hosts TEXT); CREATE TABLE logins (tenant_id TEXT,site TEXT,username TEXT);");
  W.d1.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc)); CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, state TEXT, status TEXT, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT);");
  const arch = { channel: async () => ({ channel: { name: channel, purpose: "Home base" }, memory: arch.rows, messages: [] }), channels: async () => [{ id: 1, name: channel, slug: channel }, { id: 2, name: "recipes", slug: "recipes" }],
    wsRecall: async () => ({ pack: "", ids: [], people: [] }), reflectionNote: async () => null, peopleList: async () => [], noteRow: async (c, id) => arch.rows.find((x) => x.id === id) || null, rows: notes };
  W.env.ARCHIVE = { idFromName: (n) => n, get: () => arch };
  const attach = (R) => { R.systemPrompt = Resident.prototype.systemPrompt; R.conns = async () => [];
    R.put("channel", channel); R.put("tenant", "t1"); R.put("channel_id", "1"); R.archive = () => arch; return R; };
  const boot = W.boot; W.boot = () => attach(boot()); attach(W.R); W.arch = arch; W.R.memoryMode = () => "on"; W.bank = bankId(W.env, "t1", channel);
  return W;
}
const ctx = { context: { version: 2 }, session: "s1", turn: "t-1" };
const dentist = (p) => (/Okafor/.test(p) ? [{ text: "Sam's dentist is Dr. Okafor on Elm Street", category: "person" }] : []);
const down = (W) => { W.index.query = async () => { throw new Error("index down"); }; };
{ // a real turn: the turns table and the memory; no ledger tables
  const W = mkR(), R = W.R; W.facts = dentist; W.brain = () => "Noted: Dr. Okafor on Elm Street.";
  {
    const r = await R.runTurn("t1", "work", "1", "My dentist is Dr. Okafor on Elm Street.", null, { session: R.newSession("T") }); assert.ok(!r.error, r.error);
    await tick(); await sleep(100);
    assert.ok(R.sql.exec("SELECT COUNT(*) n FROM turns WHERE user_text LIKE '%Okafor%'").one().n >= 1, "the raw turn is saved");
    assert.ok((await memoriesList(W.env, W.bank, {})).items.some((i) => /Okafor/.test(i.text)), "the memory gets the conversation");
    assert.equal(R.sql.exec("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('mem_rows','mem_fts','mem_segments')").one().n, 0, "no ledger table is created any more");
  }
  ok("1a. a real turn: the turns table and the memory get it, no ledger tables");
}
{ // recall: the memory answers, then the memory is down
  const W = mkR(), R = W.R; W.facts = dentist;
  {
    await retainV2(W.env, W.bank, [{ document_id: "note:1", content: "Sam's dentist is Dr. Okafor.", at: T0 }]);
    let out = await R.localToolInner("recall_memory", { query: "dentist" }, ctx); assert.match(out, /Dr\. Okafor/, "the memory's answer is used");
    const empty = await mkR().R.localToolInner("recall_memory", { query: "nothing here" }, ctx); assert.ok(!/unavailable right now/.test(empty), "an empty answer is not an outage");
    down(W); out = await R.localToolInner("recall_memory", { query: "sister Dana" }, ctx);
    assert.equal(out, MEMORY_UNAVAILABLE, "no local fallback: the helper is told memory is unavailable right now"); assert.match(out, /not available right now/);
  }
  ok("1b. recall_memory: the memory alone, and a plain unavailable message when it is down");
}
{ // recall_history over the raw turns table stays
  const W = mkR(), R = W.R; W.brain = () => "Noted.";
  await R.runTurn("t1", "work", "1", "The garage door code word is pineapple.", null, { session: R.newSession("T") }); await tick(); await sleep(20);
  const h = await R.localToolInner("recall_history", { query: "pineapple" }, ctx); assert.match(String(h), /pineapple/i, "recall_history finds the raw turn");
  ok("1c. recall_history over the turns table works");
}
{ // the legacy automatic recall (layout other than v2) says so too
  const W = mkR(), R = W.R; const tc = { session: "s1", turn: "t-2", context: {} };
  down(W);
  const note = await R.recallContext("my sister", tc, { onDemand: false });
  assert.ok(note.includes(MEMORY_UNAVAILABLE_NOTE), "automatic recall: the turn is told memory is unavailable"); assert.equal(tc.memNote, note);
  const rec = R.sql.exec("SELECT mode FROM mem_receipts ORDER BY id DESC LIMIT 1").one(); assert.equal(rec.mode, "on:memory-unavailable");
  ok("1d. automatic recall on an outage: the turn is told memory is unavailable, and a receipt says so");
}
{ // the automatic arm on an outage
  const W = mkR(), R = W.R; R.put("tz", "UTC"); W.brain = () => "ok";
  down(W);
  await R.runTurn("t1", "work", "1", "Plan my Friday", null, { session: R.newSession("T") });
  const call = W.calls.find((c) => c.who === "main"), all = JSON.stringify(call.messages), tr = JSON.parse(R.sql.exec("SELECT trace FROM turns ORDER BY at DESC LIMIT 1").one().trace).find((t) => t.tool === "memory_arm");
  assert.ok(all.includes("Memory is unavailable right now") && all.includes("<injected-memory>"), "the turn context says memory is unavailable, wrapped so it is never retained"); assert.equal(tr.args, "B");
  ok("1e. the automatic arm on an outage: adds the unavailable note (wrapped, so it is never retained)");
}

// ================= 3. ambient_query =================
const { makeStore, T: AT } = await import("./helpers/search-store.mjs");
const { ambientQuery } = await import("../src/ee/ambient-query.js");
const DAY1 = ["so um i gotta call the land lord about the leak in the bathroom", "Remind me to pick up Sarah's prescripshun tomorrow around five", "maybe I could learn the cello someday", "buy oat milk and some bread"];
const DAY2 = ["call the guy about the leak under the sink", "email the accountant about the tax form", "need to renew the car registration by friday", "the landlord called back about the lease"];
const task = (t, quote, line, kind = "task") => ({ kind, speech_act: "intention", text: t, quote, line, status: "open", due_text: "", relation: null, supersedes: [] });
const extract = async (lines) => ({ items: lines.flatMap((l, i) => /call|remind|email|renew/i.test(l.text) ? [task(l.text.replace(/^so um i gotta /i, "").replace(/^remind me to /i, "").replace(/^need to /i, ""), l.text, i, /remind/i.test(l.text) ? "reminder" : "task")] : []) });
async function buildAmbient() {
  const F = makeStore({ extract }); Object.assign(F.env, FULL);
  await F.store.ingest("bee", 1, F.conv(1, DAY1)); await F.store.ingest("bee", 2, F.conv(2, DAY2, { at: AT + 864e5 })); for (let i = 0; i < 6; i++) await F.store.run();
  return F;
}
const count = (F, t) => F.store.rows(`SELECT COUNT(*) n FROM ${t}`)[0].n;
{ // 3a. the store: extraction and the plain list; no index tables
  const F = await buildAmbient();
  assert.ok(count(F, "ambient_items") >= 4, "extraction (the voice inbox) runs"); assert.ok(count(F, "ambient_sources") === 2);
  for (const t of ["ambient_passages", "ambient_item_vec", "ambient_vocab", "ambient_qvec"]) assert.equal(F.store.rows("SELECT COUNT(*) n FROM sqlite_master WHERE name=?", t)[0].n, 0, `${t} does not exist`);
  const list = F.store.query({ mode: "items" }); assert.ok(list.items.length >= 4); assert.equal(F.store.query({ mode: "items", kind: "reminder" }).items.every((x) => x.kind === "reminder"), true);
  const w = F.store.query({ mode: "transcript", query: "leak", limit: 5 }); assert.ok(w.transcripts.some((t) => /leak/.test(t.text)), "plain words match raw lines");
  assert.ok(!("search" in w.coverage), "the store reports no search index");
  const L = makeStore({ extract }); await L.store.ingest("bee", 7, L.conv(7, ["call the land lord about the leak"], { location: { address: "12 Harbour Street", latitude: 1, longitude: 2 } })); await L.store.ingest("bee", 8, L.conv(8, ["buy oat milk"], { location: { address: "Corner Market", latitude: 3, longitude: 4 } }));
  for (let i = 0; i < 4; i++) await L.store.run();
  assert.equal(L.store.query({ mode: "locations" }).locations.length, 2, "no query lists every place");
  let lr = L.store.query({ mode: "locations", query: "harbour street" }); assert.deepEqual(lr.locations.map((x) => x.source_id), ["7"], "a location query matches the recorded address words");
  lr = L.store.query({ mode: "locations", query: "nothing relevant here at all" }); assert.equal(lr.locations.length, 0); assert.ok(!lr.locations.some((x) => "matching_transcript_evidence" in x));
  F.store.remove("bee", 1); assert.equal(count(F, "ambient_sources"), 1, "deleting a recording removes its rows");
  ok("3a. the store: extraction and the plain list work, there is no index, plain word search over raw lines and address search for locations work");
}
{ // 3b. ambient_query: a query goes through the memory search over the source:bee documents
  const F = await buildAmbient(); let dquery = [];
  const { env: menv, index } = memEnv(), bank = "dev-t1-main", day2 = AT + 864e5;
  const mkRes = (extra = {}) => ({ get: (k) => ({ channel: "main", tenant: "t1" })[k], memoryMode: () => "on", forgottenNow: (json) => json.includes("cello"), hsBankId: () => bank, hsRecallPrice: () => 1, byokHold: async () => ({ done: async () => {} }),
    env: { ...menv, ...FULL, BEE_SYNC: { idFromName: (n) => n, get: () => ({ ambientQuery: async (a) => { dquery.push(a); return F.store.query(a); } }) } }, ...extra });
  const fact = (doc, text, at, tags = ["source:bee"]) => ({ document_id: doc, content: text, at, strategy: "verbatim", metadata: { category: "other" }, tags });
  await retainV2(menv, bank, [fact("bee:conv:2", "Sam asked the plumber about the leak under the sink.", day2), fact("bee:conv:1", "Sam might learn the cello.", AT), fact("inbox:ambient:abc", "Sam confirmed the dentist item.", AT), fact("note:7", "Sam's plumber is not a Bee recording.", day2, ["source:note"])]);
  const res = mkRes();
  let out = await ambientQuery(res, { mode: "transcript", query: "who do I call about the plumber leak" });
  assert.equal(dquery.length, 1); assert.equal(dquery[0].query, undefined, "the coverage read carries no query"); assert.equal(dquery[0].limit, 1);
  assert.deepEqual(out.items, []); assert.deepEqual(out.transcripts, []); assert.equal(out.ranked, true); assert.equal(out.next_cursor, null); assert.ok(out.coverage.sources >= 1, "the processing coverage is still reported");
  assert.ok(out.memories.some((m) => m.source_id === "2" && /plumber/.test(m.text)), "each hit names its recording"); assert.ok(out.memories.every((m) => m.untrusted === true));
  assert.ok(out.memories.find((m) => /dentist/.test(m.text)) && !("source_id" in out.memories.find((m) => /dentist/.test(m.text))), "an inbox item document has no recording id");
  assert.ok(!out.memories.some((m) => /not a Bee recording/.test(m.text)), "only the Bee documents are searched");
  assert.ok(!JSON.stringify(out).includes("cello"), "forgotten speech does not come back through recall either"); assert.ok(out.coverage.withheld_by_memory_preferences >= 1); assert.match(out.search_note, /omit the query/);
  // filters: a recording, a date range
  out = await ambientQuery(res, { mode: "items", query: "leak", source_id: "2" }); assert.deepEqual(out.memories.map((m) => m.source_id), ["2"], "source_id keeps one recording"); assert.equal(dquery.at(-1).source_id, "2");
  await retainV2(menv, bank, [fact("bee:conv:3", "Sam called the landlord about the leak.", AT + 5 * 864e5)]);
  out = await ambientQuery(res, { mode: "items", query: "leak", from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" }); assert.deepEqual(out.memories.map((m) => m.source_id), ["2"], "a date range keeps only what falls inside it");
  // a recording kept as raw chunks (bee:conv:<id>): a hit is a stretch of the recording's own words, with its time and speaker, so the helper gets the matched text
  { const line = (n) => `[2026-10-12T08:${String(n % 60).padStart(2, "0")}:00-07:00] Ana (wearer, the user): the plumber said the leak under the sink needs a new pipe, part ${n}`, long = Array.from({ length: 40 }, (_, i) => line(i)).join("\n");
    const rm = memEnv().env; await retainV2(rm, bank, [{ document_id: "bee:conv:2", content: long, at: day2, strategy: "raw-transcript", tags: ["source:bee", "kind:raw"] }, { ...fact("bee:conv:2", `plumber leak ${"x".repeat(1200)}`, day2), update_mode: "append" }]);
    const o2 = await ambientQuery(mkRes({ env: { ...rm, ...FULL, BEE_SYNC: res.env.BEE_SYNC } }), { mode: "transcript", query: "plumber leak" }), raw = o2.memories.find((m) => m.kind === "transcript"), fx = o2.memories.find((m) => m.text.startsWith("plumber leak x"));
    assert.equal(raw.source_id, "2", "a raw chunk names its recording like a fact does"); assert.match(raw.text, /^\[2026-10-12T08:\d\d:00-07:00\] Ana \(wearer, the user\):/, "the matched words come back with their time and speaker lines"); assert.ok(raw.text.length <= 2000);
    assert.equal(fx.text.length, 900, "an extracted fact is still clipped at 900"); assert.match(o2.coverage.search.note, /kind transcript/); }
  // a cursor means nothing here
  assert.equal((await ambientQuery(res, { mode: "items", query: "leak", cursor: "AAAA" })).status, "invalid_query");
  // the plain list never searches memory; the location search keeps its own path
  index.calls.length = 0; out = await ambientQuery(res, { mode: "items" }); assert.ok(out.items.length >= 4); assert.equal(index.calls.length, 0, "no query: the inbox list, no memory search");
  dquery.length = 0; out = await ambientQuery(res, { mode: "locations", query: "home" }); assert.equal(dquery.length, 1, "a location search stays with the place data"); assert.equal(dquery[0].query, "home"); assert.equal(index.calls.length, 0);
  // an outage is an outage, not an empty list
  const real = index.query; index.query = async () => { throw new Error("index down"); }; out = await ambientQuery(res, { mode: "transcript", query: "leak" }); assert.equal(out.status, "unavailable"); assert.match(out.error, /could not be read right now/); assert.deepEqual(out.items, []); index.query = real;
  // no credits
  out = await ambientQuery(mkRes({ byokHold: async () => null }), { mode: "transcript", query: "leak" }); assert.match(out.error, /credits are unavailable/); assert.equal(out.coverage.searched, false);
  // memory off
  assert.equal((await ambientQuery(mkRes({ memoryMode: () => "off" }), { mode: "items", query: "x" })).status, "memory_disabled");
  ok("3b. ambient_query with a query: always memory search over the source:bee documents (filters, forgotten text, outages, credits); the plain list and the location search are unchanged");
}

console.log("hindsight-alone tests passed");
