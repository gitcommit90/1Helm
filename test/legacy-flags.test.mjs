// node --import ./test/stubs/register.mjs test/legacy-flags.test.mjs
// Memory Overhaul phase 5 (the design notes). The local ledger, the upkeep, reflection and people jobs and their four flags were
// removed on 2026-10-15 (Hindsight alone does their work). What stays and is tested here:
//   0. LEGACY_AMBIENT_SEARCH (the ambient passage index) and the wrangler files.
//   1. Hindsight alone: a real turn keeps the turns table and the Hindsight conversation, recall_memory answers from Hindsight and says memory is unavailable
//      when it is down, recall_history reads the turns table, and nothing creates or reads the old ledger tables.
//   3. The ambient search flag on and off.
import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { world, tick } from "./deploy-harness.mjs";
import { Resident } from "../src/resident.js";
import { ambientSearchOn } from "../src/legacy-flags.js";
import { MEMORY_UNAVAILABLE, MEMORY_UNAVAILABLE_NOTE } from "../src/memory-unavailable.js";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-40).join("\n")); });
const ok = (name) => console.log("  ok", name);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const text = (m) => typeof m.content === "string" ? m.content : m.content?.filter((p) => p.type === "text").map((p) => p.text).join("");
const HS = { HINDSIGHT: {}, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight" }, FULL = { ...HS, HS_FOUNDATIONS: "on", HS_USE: "on", HS_WRITERS: "on" };

function fakeHs(o = {}) {
  const banks = new Map(), calls = [], failNext = [];
  const bank = (b) => { if (!banks.has(b)) banks.set(b, { models: new Map(), mem: new Map(), docs: new Map(), recallResults: o.recall || [], retains: [], history: new Map(), lists: [] }); return banks.get(b); };
  const HINDSIGHT = { fetch: async (u, init = {}) => {
    const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname).replace("/v1/default", ""), body = init.body ? JSON.parse(init.body) : null, key = `${m} ${p}${url.search}`;
    calls.push({ m, p, q: url.search, body, key });
    if (failNext.length && failNext[0].re.test(key)) { const f = failNext.shift(); return J({ detail: f.detail || "boom" }, f.status || 500); }
    let r;
    if (o.delay) await sleep(o.delay);
    if ((r = p.match(/^\/banks\/([^/]+)$/))) { if (m === "PUT") { bank(r[1]); return J({ bank_id: r[1] }); } if (m === "DELETE") { banks.delete(r[1]); return J({ success: true }); } }
    if ((r = p.match(/^\/banks\/([^/]+)\/import$/)) && m === "POST") { const b = bank(r[1]); b.config = body; for (const mm of body.mental_models || []) if (!b.models.has(mm.id)) b.models.set(mm.id, { id: mm.id, content: "", last_refreshed_at: null, last_refresh_failed_at: null }); return J({ mental_models_created: (body.mental_models || []).length }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models$/)) && m === "GET") { const b = bank(r[1]); return J({ items: [...b.models.values()].map((x) => ({ id: x.id })) }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models\/([^/]+)\/refresh$/)) && m === "POST") { const b = bank(r[1]), x = b.models.get(r[2]); if (!x) return J({ detail: "nf" }, 404); b.refreshed = [...(b.refreshed || []), r[2]]; x.content = x.content || `Refreshed ${r[2]}.`; x.last_refreshed_at = new Date().toISOString(); return J({ operation_id: "op" }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models\/([^/]+)$/)) && m === "GET") { const x = bank(r[1]).models.get(r[2]); if (!x) return J({ detail: "nf" }, 404); return J(x); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/recall$/)) && m === "POST") { const b = bank(r[1]); return J({ results: typeof b.recallResults === "function" ? b.recallResults(body) : b.recallResults, entities: o.entities || {} }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/list$/)) && m === "GET") { const b = bank(r[1]); b.lists.push(url.searchParams.toString()); const tf = url.searchParams.get("time_field"); return J({ items: (o.list || {})[tf] || [], total: ((o.list || {})[tf] || []).length }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/([^/]+)\/history$/)) && m === "GET") { return J(bank(r[1]).history.get(r[2]) || []); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories\/([^/]+)$/))) { const b = bank(r[1]), x = b.mem.get(r[2]);
      if (m === "GET") return x ? J(x) : J({ detail: "nf" }, 404);
      if (m === "PATCH") { if (!x) return J({ detail: "nf" }, 404); if (x.type === "observation") return J({ detail: "observations are derived" }, 400); if (body.state === "invalidated") { x.state = "invalidated"; x.invalidation_reason = body.reason; b.invalidated = [...(b.invalidated || []), { id: r[2], reason: body.reason }]; } return J({ id: r[2], state: x.state }); } }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories$/)) && m === "POST") { const b = bank(r[1]); b.retains.push(body); for (const i of body.items || []) b.docs.set(i.document_id, i); return J({ success: true, async: true, operation_id: body.operation_id || "op", items_count: (body.items || []).length }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/operations$/))) return J({ operations: [] });
    if ((r = p.match(/^\/banks\/([^/]+)\/stats/))) return J({ pending_operations: 0, failed_operations: 0, pending_consolidation: 0, failed_consolidation: 0 });
    return J({ detail: `unhandled ${key}` }, 500);
  } };
  return { HINDSIGHT, calls, bank, failNext, banks, env: (x = {}) => ({ HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", HS_FOUNDATIONS: "on", HS_USE: "on", ...x }) };
}

// ================= 0. the flag =================
{
  assert.equal(ambientSearchOn({ ...FULL }), true, "unset means the index runs");
  assert.equal(ambientSearchOn({ ...FULL, LEGACY_AMBIENT_SEARCH: "on" }), true); assert.equal(ambientSearchOn({ ...FULL, LEGACY_AMBIENT_SEARCH: "off" }), false, "off retires it");
  assert.equal(ambientSearchOn({ ...FULL, LEGACY_AMBIENT_SEARCH: " OFF " }), false, "the value is trimmed and case blind"); assert.equal(ambientSearchOn({ ...FULL, LEGACY_AMBIENT_SEARCH: "0" }), true, "only off retires");
  assert.equal(ambientSearchOn({ LEGACY_AMBIENT_SEARCH: "off" }), true, "with no Hindsight there is nothing to replace it, so it keeps running"); assert.equal(ambientSearchOn(undefined), true);
  assert.equal(ambientSearchOn({ ...HS, LEGACY_AMBIENT_SEARCH: "off" }), true, "ambient search needs the Bee transcripts in the bank (HS_WRITERS)");
  assert.equal(ambientSearchOn({ ...HS, HS_FOUNDATIONS: "on", HS_WRITERS: "on", LEGACY_AMBIENT_SEARCH: "off" }), false);
  const example = readFileSync(new URL("../wrangler.example.jsonc", import.meta.url), "utf8");
  for (const name of ["LEGACY_LEDGER", "LEGACY_UPKEEP", "LEGACY_REFLECT", "LEGACY_PEOPLE"]) assert.ok(!example.includes(name), `${name} is not in the example configuration`);
  ok("0. the ambient search flag: unset or on = runs, off = retired, only when Hindsight and HS_WRITERS are configured; the four removed flags are not in the example configuration");
}

// ================= 1. Hindsight alone =================
const T0 = Date.UTC(2026, 9, 14, 17, 0);
function mkR({ channel = "work", server, notes = [], extra = {} } = {}) {
  const f = server || fakeHs();
  const W = world({ engine: "classic", env: { CONTEXT_LAYOUT: "v2", RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0, GENUI: "on", MEMORY: "on", ...f.env({ HS_USE: "on", HS_WRITERS: "on", HS_USE_SHADOW: "off" }), ...extra } });
  W.d1.exec("ALTER TABLE tenants ADD COLUMN helper_tone INTEGER; CREATE TABLE vault (tenant_id TEXT,name TEXT,hosts TEXT); CREATE TABLE logins (tenant_id TEXT,site TEXT,username TEXT);");
  W.d1.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc)); CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, state TEXT, status TEXT, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT);");
  const arch = { channel: async () => ({ channel: { name: channel, purpose: "Home base" }, memory: arch.rows, messages: [] }), channels: async () => [{ id: 1, name: channel, slug: channel }, { id: 2, name: "recipes", slug: "recipes" }],
    wsRecall: async () => ({ pack: "", ids: [], people: [] }), reflectionNote: async () => null, peopleList: async () => [], noteRow: async (c, id) => arch.rows.find((x) => x.id === id) || null, rows: notes };
  W.env.ARCHIVE = { idFromName: (n) => n, get: () => arch };
  const attach = (R) => { R.systemPrompt = Resident.prototype.systemPrompt; R.conns = async () => [];
    R.put("channel", channel); R.put("tenant", "t1"); R.put("channel_id", "1"); R.archive = () => arch; return R; };
  const boot = W.boot; W.boot = () => attach(boot()); attach(W.R); W.f = f; W.arch = arch; W.R.memoryMode = () => "on";
  return W;
}
const ctx = { context: { version: 2 }, session: "s1", turn: "t-1" };
const REC = [{ id: "o1", type: "observation", text: "Sam's dentist is Dr. Okafor.", mentioned_at: "2026-10-03T12:00:00Z", scores: { final: 0.9 } }];
{ // a real turn: the turns table and Hindsight; no ledger tables
  const f = fakeHs(), W = mkR({ server: f }), R = W.R; W.brain = () => "Noted: Dr. Okafor on Elm Street.";
  const r = await R.runTurn("t1", "work", "1", "My dentist is Dr. Okafor on Elm Street.", null, { session: R.newSession("T") }); assert.ok(!r.error, r.error);
  await tick(); await sleep(40);
  assert.ok(R.sql.exec("SELECT COUNT(*) n FROM turns WHERE user_text LIKE '%Okafor%'").one().n >= 1, "the raw turn is saved");
  assert.ok(JSON.stringify(f.bank("dev-t1-work").retains).includes("Okafor"), "Hindsight gets the conversation");
  assert.equal(R.sql.exec("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('mem_rows','mem_fts','mem_segments')").one().n, 0, "no ledger table is created any more");
  ok("1a. a real turn: the turns table and Hindsight get it, no ledger tables");
}
{ // recall: Hindsight answers, then Hindsight is down
  const f = fakeHs({ recall: REC }), W = mkR({ server: f }), R = W.R;
  let out = await R.localToolInner("recall_memory", { query: "dentist" }, ctx); assert.match(out, /Dr\. Okafor/, "Hindsight's answer is used");
  f.failNext.push({ re: /memories\/recall/, status: 500 }); out = await R.localToolInner("recall_memory", { query: "sister Dana" }, ctx);
  assert.equal(out, MEMORY_UNAVAILABLE, "no local fallback: the helper is told memory is unavailable right now"); assert.match(out, /not available right now/);
  const f2 = fakeHs({ recall: [] }), R2 = mkR({ server: f2 }).R; out = await R2.localToolInner("recall_memory", { query: "nothing here" }, ctx); assert.ok(!/unavailable right now/.test(out), "an empty answer from Hindsight is not an outage");
  ok("1b. recall_memory: Hindsight alone, and a plain unavailable message when it is down");
}
{ // recall_history over the raw turns table stays
  const W = mkR(), R = W.R; W.brain = () => "Noted.";
  await R.runTurn("t1", "work", "1", "The garage door code word is pineapple.", null, { session: R.newSession("T") }); await tick(); await sleep(20);
  const h = await R.localToolInner("recall_history", { query: "pineapple" }, ctx); assert.match(String(h), /pineapple/i, "recall_history finds the raw turn");
  ok("1c. recall_history over the turns table works");
}
{ // the legacy automatic recall (layout other than v2) says so too
  const f = fakeHs({ recall: REC }), W = mkR({ server: f }), R = W.R; const tc = { session: "s1", turn: "t-2", context: {} };
  f.failNext.push({ re: /memories\/recall/, status: 500 });
  const note = await R.recallContext("my sister", tc, { onDemand: false });
  assert.ok(note.includes(MEMORY_UNAVAILABLE_NOTE), "automatic recall: the turn is told memory is unavailable"); assert.equal(tc.memNote, note);
  const rec = R.sql.exec("SELECT mode FROM mem_receipts ORDER BY id DESC LIMIT 1").one(); assert.equal(rec.mode, "on:hindsight-unavailable");
  ok("1d. automatic recall on a Hindsight outage: the turn is told memory is unavailable, and a receipt says so");
}
{ // the automatic arm (B2) on an outage
  const f = fakeHs({ recall: REC }), W = mkR({ server: f }), R = W.R; R.put("tz", "UTC"); W.brain = () => "ok";
  f.failNext.push({ re: /memories\/recall/, status: 500 });
  await R.runTurn("t1", "work", "1", "Plan my Friday", null, { session: R.newSession("T") });
  const call = W.calls.find((c) => c.who === "main"), all = JSON.stringify(call.messages), tr = JSON.parse(R.sql.exec("SELECT trace FROM turns ORDER BY at DESC LIMIT 1").one().trace).find((t) => t.tool === "memory_arm");
  assert.ok(all.includes("Memory is unavailable right now") && all.includes("<injected-memory>"), "the turn context says memory is unavailable, wrapped so it is never retained"); assert.equal(tr.args, "B2");
  ok("1e. arm B2 on an outage: adds the unavailable note (wrapped, so it is never retained)");
}

// ================= 3. LEGACY_AMBIENT_SEARCH =================
const { makeStore, T: AT } = await import("./helpers/search-store.mjs");
const { ambientQuery } = await import("../src/ee/ambient-query.js");
const DAY1 = ["so um i gotta call the land lord about the leak in the bathroom", "Remind me to pick up Sarah's prescripshun tomorrow around five", "maybe I could learn the cello someday", "buy oat milk and some bread"];
const DAY2 = ["call the guy about the leak under the sink", "email the accountant about the tax form", "need to renew the car registration by friday", "the landlord called back about the lease"];
const task = (t, quote, line, kind = "task") => ({ kind, speech_act: "intention", text: t, quote, line, status: "open", due_text: "", relation: null, supersedes: [] });
const extract = async (lines) => ({ items: lines.flatMap((l, i) => /call|remind|email|renew/i.test(l.text) ? [task(l.text.replace(/^so um i gotta /i, "").replace(/^remind me to /i, "").replace(/^need to /i, ""), l.text, i, /remind/i.test(l.text) ? "reminder" : "task")] : []) });
async function buildAmbient(flag) {
  const F = makeStore({ extract }); Object.assign(F.env, FULL, { LEGACY_AMBIENT_SEARCH: flag });
  await F.store.ingest("bee", 1, F.conv(1, DAY1)); await F.store.ingest("bee", 2, F.conv(2, DAY2, { at: AT + 864e5 })); for (let i = 0; i < 6; i++) await F.store.run();
  return F;
}
const count = (F, t) => F.store.rows(`SELECT COUNT(*) n FROM ${t}`)[0].n;
for (const flag of ["on", "off"]) {
  const on = flag === "on", F = await buildAmbient(flag);
  assert.ok(count(F, "ambient_items") >= 4, "extraction (the voice inbox) runs either way"); assert.ok(count(F, "ambient_sources") === 2);
  if (on) { assert.ok(count(F, "ambient_passages") > 0, "on: the passage index is built"); assert.ok(F.aiCalls.length > 0, "and embedded"); }
  else { assert.equal(count(F, "ambient_passages"), 0, "off: no passage index is built"); assert.equal(count(F, "ambient_item_vec"), 0); assert.equal(count(F, "ambient_vocab"), 0); assert.equal(F.aiCalls.length, 0, "off: nothing is embedded, ever"); }
  // the plain list (no query) is the voice inbox screen's data and is unchanged
  const list = await F.store.search({ mode: "items" }); assert.ok(list.items.length >= 4); assert.equal((await F.store.search({ mode: "items", kind: "reminder" })).items.every((x) => x.kind === "reminder"), true);
  // a search by meaning: the paraphrase finds the speech with the index, and does not without it
  const aiBefore = F.aiCalls.length, r = await F.store.search({ mode: "transcript", query: "plumber", limit: 5 });
  if (on) assert.ok(r.transcripts.some((t) => /leak/.test(t.text)), "on: meaning search finds the leak by 'plumber'"); else { assert.equal(r.transcripts.length, 0); assert.equal(r.coverage.search.retired, true); assert.equal(F.aiCalls.length, aiBefore, "off: the query is not embedded"); }
  const w = await F.store.search({ mode: "transcript", query: "leak", limit: 5 }); assert.ok(w.transcripts.some((t) => /leak/.test(t.text)), "plain words still match raw lines either way");
  // a location search by place text still works and builds nothing
  const loc = await F.store.search({ mode: "locations", query: "anything", limit: 5 }); assert.ok(Array.isArray(loc.locations)); if (!on) assert.equal(count(F, "ambient_passages"), 0);
  // deletion still clears the index tables
  F.store.remove("bee", 1); assert.equal(F.store.rows("SELECT COUNT(*) n FROM ambient_passages WHERE source_id='1'")[0].n, 0);
  ok(`3a(${flag}). the store: ${on ? "passage index and embeddings built, meaning search works" : "no index, no embedding, extraction and the plain list unchanged, plain word search still works"}`);
}
{ // 3b. ambient_query: a query goes through Hindsight recall with the source:bee tag when the index is retired
  const F = await buildAmbient("off"); let dsearch = 0, dquery = [];
  const mkRes = (flag, f, extra = {}) => ({ get: (k) => ({ channel: "main", tenant: "t1" })[k], memoryMode: () => "on", forgottenNow: (json) => json.includes("cello"), hsBankId: () => "dev-t1-main", hsRecallPrice: async () => 1, byokHold: async () => ({ done: async () => {} }),
    env: { ...FULL, ONEHELM_EE: "1hc", ENV_NAME: "dev", HINDSIGHT: f.HINDSIGHT, LEGACY_AMBIENT_SEARCH: flag, BEE_SYNC: { idFromName: (n) => n, get: () => ({ ambientSearch: async (a) => { dsearch++; return F.store.search(a); }, ambientQuery: async (a) => { dquery.push(a); return F.store.query(a); } }) } }, ...extra });
  const hits = [{ id: "h1", type: "experience", text: "Sam asked the plumber about the leak under the sink.", document_id: "bee:conv:2", mentioned_at: new Date(AT + 864e5).toISOString() }, { id: "h2", type: "world", text: "Sam might learn the cello.", document_id: "bee:conv:1", mentioned_at: new Date(AT).toISOString() },
    { id: "h3", type: "world", text: "Sam confirmed the dentist item.", document_id: "inbox:ambient:abc", mentioned_at: new Date(AT).toISOString() }];
  let f = fakeHs({ recall: hits }), res = mkRes("off", f);
  let out = await ambientQuery(res, { mode: "transcript", query: "who do I call about the pipe" }); const body = f.calls.find((c) => /memories\/recall/.test(c.key)).body;
  assert.deepEqual(body.tags, ["source:bee"]); assert.equal(body.tags_match, "any_strict"); assert.equal(body.query, "who do I call about the pipe"); assert.equal(f.calls.find((c) => /memories\/recall/.test(c.key)).p, "/banks/dev-t1-main/memories/recall", "General's own bank only");
  assert.equal(dsearch, 0, "the index search is not called"); assert.equal(dquery.length, 1); assert.equal(dquery[0].query, undefined, "the coverage read carries no query"); assert.equal(dquery[0].limit, 1);
  assert.deepEqual(out.items, []); assert.deepEqual(out.transcripts, []); assert.equal(out.ranked, true); assert.equal(out.next_cursor, null); assert.equal(out.coverage.search.backend, "hindsight"); assert.ok(out.coverage.sources >= 1, "the processing coverage is still reported");
  assert.ok(out.memories.some((m) => m.source_id === "2" && /plumber/.test(m.text)), "each hit names its recording"); assert.ok(out.memories.every((m) => m.untrusted === true)); assert.ok(out.memories.find((m) => m.id === "hs:h3") && !("source_id" in out.memories.find((m) => m.id === "hs:h3")), "an inbox item document has no recording id");
  assert.ok(!JSON.stringify(out).includes("cello"), "forgotten speech does not come back through recall either"); assert.ok(out.coverage.withheld_by_memory_preferences >= 1); assert.match(out.search_note, /omit the query/);
  // filters: a recording, a date range
  out = await ambientQuery(res, { mode: "items", query: "leak", source_id: "2" }); assert.deepEqual(out.memories.map((m) => m.source_id), ["2"], "source_id keeps one recording"); assert.equal(dquery.at(-1).source_id, "2");
  out = await ambientQuery(res, { mode: "items", query: "leak", from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" }); assert.ok(out.memories.every((m) => Date.parse(m.mentioned_at) >= Date.parse("2026-10-11T00:00:00Z")), "a date range keeps nearby hits"); assert.ok(f.calls.filter((c) => /recall/.test(c.key)).at(-1).body.temporal_window, "and ranks by it");
  // a recording kept as raw chunks (bee:conv:<id>, tag kind:raw): a hit is a stretch of the recording's own words, with its time and speaker, so the helper gets the matched text
  { const line = (n) => `[2026-10-12T08:${String(n % 60).padStart(2, "0")}:00-07:00] Ana (wearer, the user): the plumber said the leak under the sink needs a new pipe, part ${n}`, long = Array.from({ length: 20 }, (_, i) => line(i)).join("\n"), fact = "x".repeat(1200);
    const rf = fakeHs({ recall: [{ id: "r1", type: "world", text: long, document_id: "bee:conv:2", tags: ["source:bee", "kind:raw"], mentioned_at: new Date(AT + 864e5).toISOString() }, { id: "r2", type: "world", text: fact, document_id: "bee:conv:2", tags: ["source:bee"], mentioned_at: new Date(AT + 864e5).toISOString() }] });
    const o2 = await ambientQuery(mkRes("off", rf), { mode: "transcript", query: "plumber leak" }), raw = o2.memories.find((m) => m.id === "hs:r1"), fx = o2.memories.find((m) => m.id === "hs:r2");
    assert.equal(raw.kind, "transcript"); assert.equal(raw.source_id, "2", "a raw chunk names its recording like a fact does"); assert.ok(raw.text.length === 2000 && raw.text.startsWith("[2026-10-12T08:00:00-07:00] Ana (wearer, the user):"), "the matched words come back with their time and speaker lines, up to 2,000 characters");
    assert.equal(fx.kind, "world"); assert.equal(fx.text.length, 900, "an extracted fact is still clipped at 900"); assert.deepEqual(rf.calls.find((c) => /memories\/recall/.test(c.key)).body.tags, ["source:bee"], "one strict recall over source:bee finds both documents"); assert.match(o2.coverage.search.note, /kind transcript/);
    const o3 = await ambientQuery(mkRes("off", rf), { mode: "items", query: "plumber", source_id: "2" }); assert.equal(o3.memories.length, 2, "source_id keeps the hits of that recording"); }
  // a cursor means nothing here
  assert.equal((await ambientQuery(res, { mode: "items", query: "leak", cursor: "AAAA" })).status, "invalid_query");
  // the plain list never touches Hindsight; the location search keeps its own path
  f.calls.length = 0; out = await ambientQuery(res, { mode: "items" }); assert.ok(out.items.length >= 4); assert.equal(f.calls.length, 0, "no query: the inbox list, no recall");
  dsearch = 0; out = await ambientQuery(res, { mode: "locations", query: "home" }); assert.equal(dsearch, 1, "a location search stays with the place data"); assert.equal(f.calls.length, 0);
  // an outage is an outage, not an empty list
  f.failNext.push({ re: /memories\/recall/, status: 500 }); out = await ambientQuery(res, { mode: "transcript", query: "leak" }); assert.equal(out.status, "unavailable"); assert.match(out.error, /could not be read right now/); assert.deepEqual(out.items, []);
  // no credits
  out = await ambientQuery(mkRes("off", fakeHs({ recall: hits }), { byokHold: async () => null }), { mode: "transcript", query: "leak" }); assert.match(out.error, /credits are unavailable/); assert.equal(out.coverage.searched, false);
  // memory off
  assert.equal((await ambientQuery(mkRes("off", f, { memoryMode: () => "off" }), { mode: "items", query: "x" })).status, "memory_disabled");
  // flag on: the old index path, no Hindsight call
  f = fakeHs({ recall: hits }); dsearch = 0; out = await ambientQuery(mkRes("on", f), { mode: "transcript", query: "leak" }); assert.equal(dsearch, 1, "on: the index search"); assert.equal(f.calls.filter((c) => /recall/.test(c.key)).length, 0); assert.ok(!("memories" in out));
  // retired flag but Hindsight writers off: nothing replaces the index, so the index path stays
  dsearch = 0; res = mkRes("off", f); res.env.HS_WRITERS = "off"; out = await ambientQuery(res, { mode: "transcript", query: "leak" }); assert.equal(dsearch, 1, "without HS_WRITERS the flag cannot retire the index");
  ok("3b. ambient_query with a query: Hindsight recall over the source:bee documents when retired (tags, filters, forgotten text, outages, credits), the index path when on or when nothing replaces it; the plain list and the location search are unchanged");
}
