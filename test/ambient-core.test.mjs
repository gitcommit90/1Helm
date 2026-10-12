// node --import ./test/stubs/register.mjs test/ambient-core.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "./ambient-review-stub.mjs";
import { AmbientStore, ambientLines, ambientChunks, validateAmbient, ambientErrorCode } from "../src/ee/ambient.js";

const T = Date.UTC(2026, 9, 11), db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "test"], ["status", "active"]]);
db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const s = db.prepare(q); const rows = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows }; } };
let active = true, memory = true, hidden = "", arms = [], settled = [], reserved = [], allowSpend = true, calls = 0, cueSettings = null, cueReadFails = false;
const host = { sql, ctx: { storage: { transactionSync(fn) { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } } }, gen: 0,
  env: { ONEHELM_EE: "1hc",  OPENROUTER_API_KEY: "test", DB: { prepare(query) { return { bind() { return { first: async () => { if (query.includes("SELECT v FROM tenant_flags")) { if (cueReadFails) throw Error("private DB details"); return cueSettings ? { v: JSON.stringify(cueSettings) } : null; } return { status: active ? "active" : "read_only", plan: "plus" }; } }; } }; } },
    RESIDENT: { idFromName: (x) => x, get(name) { assert.equal(name, "res:test:main"); return { ambientPrivacy: async (texts) => ({ mode: memory ? "on" : "off", allowed: texts.flatMap((s, i) => hidden && s.includes(hidden) ? [] : [i]) }) }; } }, WS: { get: async () => null } },
  get: (k) => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => kv.get("tenant"), arm: async (at) => arms.push(at), bump() {}, ledger: () => ({ reserve: async (id, n) => { reserved.push([id, n]); return { ok: allowSpend, reason: "day_limit" }; }, settle: async (id, n) => settled.push([id, n]) }) };
let store = new AmbientStore(host);
store.review = retainReview;
assert.equal(ambientErrorCode(new Error("The RPC receiver does not implement the method ambientPrivacy. PRIVATE DETAILS")), "rpc_method_unavailable");
assert.equal(ambientErrorCode(new Error("D1_ERROR: no such column private_metadata")), "database_schema");
assert.equal(ambientErrorCode(new Error("PRIVATE DETAILS")), "step_failed");
const conv = (id, text, at = T, speaker = { name: "Ana", id: "s1", is_user: true }, live = false) => ({ id, start_time: T - 864e5, end_time: live ? null : at + 1000, updated_at: 1, transcriptions: [{ realtime: live, utterances: [{ id: `u${id}`, text, speaker, spoken_at: at }] }] });
const extract = async (lines, previous) => { calls++; return { items: lines.map((l, i) => ({ kind: /remind/i.test(l.text) ? "reminder" : "task", quote: l.text, line: i, status: /returned|done/i.test(l.text) ? "completed" : "open", due_text: "", relation: /returned|done/i.test(l.text) ? "completion" : /instead/i.test(l.text) ? "correction" : /still/i.test(l.text) ? "repeat" : null, supersedes: previous.filter((p) => /library books/.test(p.text) && /library books/.test(l.text)).map((p) => p.id) })) }; };
store.extract = extract;

const unordered = conv(1, "second", T + 1000); unordered.transcriptions[0].utterances.push({ id: "first", text: "first", speaker: { name: "Ana", is_user: true }, spoken_at: T });
assert.deepEqual(ambientLines(unordered).map((x) => x.text), ["first", "second"]); assert.equal(ambientLines(unordered)[0].speaker, "wearer");
const large = ambientLines(conv(2, "x".repeat(35000))); assert.equal(large.map((l) => l.text).join("").length, 35000); assert.ok(ambientChunks(large).length > 3);
assert.equal(validateAmbient({ items: [{ kind: "task", quote: "I am not done with the library books", line: 0, status: "completed" }] }, [{ text: "I am not done with the library books", speaker: "Ana", offset: 0 }])[0].status, "open");
assert.throws(() => validateAmbient({ items: [{ kind: "task", quote: "hallucinated", line: 0 }] }, [{ text: "real source" }]));

await store.ingest("bee", 1, conv(1, "I need to return the library books", T, "Unknown", true));
let q = store.query({ mode: "transcript", from: T - 1, to: T + 1 }); assert.equal(q.transcripts.length, 1); assert.equal(q.coverage.live_sources, 1); assert.equal(q.transcripts[0].extraction_state, "queued");
await store.run(); q = store.query(); assert.equal(q.items.length, 1); assert.equal(q.items[0].needs_review, true); assert.equal(q.items[0].owner, "Unknown");
const oldId = q.items[0].id, before = calls; await store.ingest("bee", 1, conv(1, "I need to return the library books", T, "Unknown", true)); await store.run(); assert.equal(calls, before, "same content free");
await store.ingest("bee", 2, conv(2, "I returned the library books", T + 2000, "Unknown")); await store.run();
q = store.query(); assert.equal(q.items.length, 1); assert.equal(q.items[0].status, "completed"); assert.deepEqual(q.items[0].previous_ids, [oldId]); assert.equal(q.items[0].needs_review, true);
assert.equal(store.query({ from: T, to: T + 3000 }).items.length, 1, "today inventory collapses completion inside the day");
const historical = store.query({ from: T, to: T + 1 }); assert.equal(historical.items.length, 1); assert.equal(historical.items[0].current_resolution.status, "completed", "earlier window retains occurrence with later resolution");
store.remove("bee", 2); assert.equal(store.query().items[0].status, "open", "source deletion undoes resolution");

await store.ingest("bee", 1, conv(1, "Remind me to call Doctor Rivera tomorrow at nine", T + 3000)); await store.run();
assert.ok(!store.query().items.some((i) => i.id === oldId), "same updated_at changed speech removes old items");
assert.equal(store.query().items[0].notification_status, "not_scheduled"); assert.equal(store.query().items[0].due_at, null);
await store.ingest("bee", 3, conv(3, "A separate useful intention", T + 4000)); await store.run();
q = store.query({ limit: 1 }); assert.ok(q.next_cursor); const page2 = store.query({ limit: 1, cursor: q.next_cursor }); assert.equal(page2.items.length, 1); assert.notEqual(page2.items[0].id, q.items[0].id);
assert.ok(store.query({ query: "different", cursor: q.next_cursor }).error, "cursor bound to query");
await store.ingest("bee", 4, conv(4, "Another separate intention", T + 5000)); assert.ok(store.query({ cursor: q.next_cursor }).error, "cursor rejects changed snapshots");
assert.equal(store.query({ from: T + 2999, to: T + 3001 }).items.length, 1, "dates select utterance, not 24h source start");

memory = false; const beforeOff = calls; await store.run(); assert.equal(calls, beforeOff, "memory off prevents model calls"); assert.ok(store.query().coverage.failed);
memory = true; store.sql.exec("UPDATE ambient_chunks SET retry_at=0"); hidden = "Another separate"; await store.run(); assert.equal(store.query({ query: hidden }).items.length, 0, "forgotten text never extracted"); hidden = "";
await store.ingest("bee", 5, conv(5, "Retry me safely", T + 6000)); store.extract = async () => { throw new Error("provider down PRIVATE DETAILS"); }; await store.run(); assert.ok(store.query().coverage.failed);
assert.equal(JSON.parse(host.get("ambient_error")).phase, "model_dispatch"); assert.ok(!host.get("ambient_note").includes("PRIVATE DETAILS")); assert.ok(!host.get("ambient_error").includes("PRIVATE DETAILS"));
store = new AmbientStore(host); store.extract = extract; store.review = retainReview; store.sql.exec("UPDATE ambient_chunks SET retry_at=0,reservation_id='interrupted-model' WHERE state='failed'"); await store.run(); assert.ok(settled.some(([id, n]) => id === "interrupted-model" && n === 0)); assert.equal(store.query().coverage.failed, 0, "persistent retry survives reconstruction");
store.sql.exec("INSERT INTO ambient_attempts VALUES('revision-interrupted-model',?)", T);
await store.ingest("bee", 5, conv(5, "New source revision while old model was in flight", T + 6500));
assert.equal(store.rows("SELECT COUNT(*) n FROM ambient_attempts")[0].n, 1, "revision deletion preserves attempt ownership");
store = new AmbientStore(host); store.extract = extract; store.review = retainReview; await store.run();
assert.ok(settled.some(([id, n]) => id === "revision-interrupted-model" && n === 0), "restart releases interrupted reservation after source replacement");

const sourcesBeforeAdmission = store.query().coverage.sources;
await assert.rejects(store.ingest("bee", 99, conv(99, "Cannot store outside admitted capacity", T), async () => { throw new Error("storage full"); }));
assert.equal(store.query().coverage.sources, sourcesBeforeAdmission, "raw admission failure does not populate DO transcript storage");

await store.ingest("bee", 6, conv(6, "Do not resurrect after removal", T + 7000)); store.extract = async () => { host.gen++; store.clear(); return { items: [] }; }; await store.run(); assert.equal(store.query().items.length, 0); assert.equal(store.query().coverage.sources, 0);
store.extract = extract; active = false; await store.ingest("bee", 7, conv(7, "Read-only account cannot extract", T)); const beforeReadOnly = calls; await store.run(); assert.equal(calls, beforeReadOnly);
active = true; host.put("status", "stopped"); await store.run(); assert.equal(calls, beforeReadOnly); host.put("ambient_indexing", "1"); await store.run(); assert.ok(calls > beforeReadOnly, "explicit kept-history indexing works disconnected");
await store.ingest("bee", 8, { id: 8, start_time: T, end_time: T + 1000, transcriptions: [] }); assert.ok(store.query().coverage.empty_sources); assert.equal(store.query().coverage.incomplete, true);
await store.ingest("bee", 9, { ...conv(9, "A finished recording still being processed by Bee", T), state: "PROCESSING" });
await store.run(); const provisional = store.query({ source_id: "9" }); assert.equal(provisional.coverage.live_sources, 0); assert.equal(provisional.coverage.nonfinal_sources, 1); assert.equal(provisional.coverage.processing_complete, true); assert.equal(provisional.items[0].source_state, "PROCESSING");
cueSettings = { enabled: true, phrases: ["Hey Pixie"], revision: 1, updated_at: T };
let cueInput;
store.extract = async (lines, previous) => { cueInput = lines; return extract(lines, previous); };
await store.ingest("bee", 10, conv(10, "Hey Pixie, I should build a garden bed", T + 10000, "Unknown")); await store.run();
let cued = store.query({ source_id: "10" }).items[0]; assert.equal(cued.intentional_capture, true); assert.equal(cued.capture_attribution, "unconfirmed"); assert.equal(cued.capture_cues[0].quote, "Hey Pixie"); assert.equal(cueInput[0].intentional_capture, true);
store.extract = async (lines, previous) => { cueSettings = { ...cueSettings, enabled: false, revision: 2 }; return extract(lines, previous); };
await store.ingest("bee", 11, conv(11, "Hey Pixie, I should buy garden gloves", T + 11000)); await store.run();
assert.equal(store.query({ source_id: "11" }).items.length, 0, "mid-call settings change invalidates the review context before publication");
store.extract = extract; store.sql.exec("UPDATE ambient_chunks SET retry_at=0 WHERE source_id='11'"); await store.run();
assert.equal(store.query({ source_id: "11" }).items[0].intentional_capture, false, "retry uses disabled cue settings without stale annotation");
cueSettings = { ...cueSettings, enabled: true, revision: 3 }; hidden = "Hey Pixie"; store.extract = extract;
const forgottenCue = conv(12, "Hey Pixie", T + 12000); forgottenCue.transcriptions[0].utterances.push({ text: "I should buy flower seeds", spoken_at: T + 13000, speaker: "Unknown" });
await store.ingest("bee", 12, forgottenCue); await store.run(); assert.equal(store.query({ source_id: "12" }).items[0].intentional_capture, false, "forgotten cue never prioritizes following fragment"); hidden = "";
cueReadFails = true; await store.ingest("bee", 13, conv(13, "Hey Pixie, meaningful uncued fallback task", T + 14000)); await store.run(); assert.equal(store.query({ source_id: "13" }).items[0].intentional_capture, false); assert.match(store.query().coverage.capture_cues_note, /continues/); cueReadFails = false;
assert.equal(validateAmbient({ items: [{ kind: "idea", quote: "ordinary useful idea", line: 0, intentional_capture: true }] }, [{ text: "ordinary useful idea", offset: 0 }])[0].intentional_capture, false, "model cannot forge cue evidence");
const retainedBeforeRepair = store.query({ source_id: "10" }).items[0], otherBeforeRepair = store.query({ source_id: "11" }).items[0];
assert.deepEqual(store.retrySource("bee", "does-not-exist"), { found: false, queued: 0 });
assert.deepEqual(store.retrySource("bee", "10"), { found: true, queued: 1 });
assert.equal(store.query({ source_id: "10" }).items.length, 0, "scoped retry removes obsolete projection immediately");
assert.equal(store.query({ mode: "transcript", source_id: "10" }).transcripts[0].text, retainedBeforeRepair.text, "scoped retry preserves raw evidence");
assert.equal(store.query({ source_id: "11" }).items[0].id, otherBeforeRepair.id, "other completed sources unchanged");
const callsBeforeRepair = calls; await store.run();
assert.equal(calls, callsBeforeRepair + 1, "only requested source reprocessed");
assert.equal(store.query({ source_id: "10" }).items[0].source_revision, retainedBeforeRepair.source_revision, "repair preserves authoritative source revision");
await store.ingest("bee", 14, conv(14, "Old response racing a requested repair", T + 15000));
store.extract = async (lines, previous) => { store.retrySource("bee", "14"); return extract(lines, previous); };
await store.run(); assert.equal(store.query({ source_id: "14" }).items.length, 0, "response begun before repair epoch cannot resurrect old projection");
assert.equal(store.query({ source_id: "14" }).coverage.queued, 1, "stale response cannot consume requested retry");
store.extract = extract; await store.run(); assert.equal(store.query({ source_id: "14" }).items.length, 1);
const originalFetch = globalThis.fetch, requests = [];
globalThis.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ choices: [{ message: { content: "not JSON" }, finish_reason: "stop" }], usage: { cost: 0.0001, prompt_tokens: 100, completion_tokens: 10 } }); };
try {
  const modelStore = new AmbientStore(host), lines = ambientLines(conv(90, "Remind me to buy groceries", T));
  await assert.rejects(modelStore.extract(lines, [{ id: "ambient:full-persistent-id-must-not-be-copied", text: "Previous grocery plan", owner: "wearer", kind: "task" }], { plan: "plus" }, { source: "bee", source_id: "90", hash: "retry-test", error: "Extraction waiting to retry (validate_evidence: model_evidence_invalid)" }));
  assert.equal(requests.length, 2, "invalid contract receives one bounded retry"); assert.equal(requests[0].body.provider.zdr, true); assert.equal(requests[0].body.model, "openai/gpt-6-luna");
  assert.equal(JSON.parse(requests[0].body.messages[1].content).lines[0].line, 0, "model receives explicit source line identifiers");
  assert.equal(JSON.parse(requests[0].body.messages[1].content).previous[0].id, "previous:0");
  assert.ok(!JSON.stringify(requests[0].body.messages).includes("ambient:full-persistent-id"), "historical refs cannot require copying long hashes");
  assert.match(JSON.stringify(requests[0].body.messages[0].content), /HISTORICAL REFERENCE ONLY/);
  assert.match(JSON.stringify(requests[0].body.messages[0].content), /BOTH BEFORE AND AFTER/);
  assert.match(JSON.stringify(requests[0].body.messages[0].content), /Apply retrospective clarification to the demonstrated utterance/);
  assert.match(JSON.stringify(requests[0].body.messages[0].content), /do not blanket-filter a tutorial conversation/);
  assert.match(JSON.stringify(requests[0].body.messages[0].content), /previous attempt was rejected/);
  const rid = reserved.at(-1)[0]; assert.equal(settled.filter(([id]) => id === rid).length, 1, "invalid JSON does not settle/refund twice"); assert.equal(settled.find(([id]) => id === rid)[1], 115000);
  assert.equal(modelStore.rows("SELECT COUNT(*) n FROM ambient_attempts")[0].n, 0);
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ kind: "reminder", quote: lines[0].text, line: 0 }] }) }, finish_reason: "stop" }], usage: { cost: 0.0001 } });
  await assert.rejects(modelStore.extract(lines, [], { plan: "plus" }), /missing speech_act/, "fresh model missing required speech act cannot create a confirmed task");
  allowSpend = false; const attempts = requests.length; await assert.rejects(modelStore.extract(lines, [], { plan: "plus" }), /spending paused/); assert.equal(requests.length, attempts, "daily limit stops dispatch");
} finally { globalThis.fetch = originalFetch; }
console.log("PASS ambient core: speaker attribution, full chunking, live and raw recall, version replacement, quote validation, unknown-owner review, completion provenance, deletion reversal, scoped paging, privacy, retries, generation race, read-only and disconnected indexing.");
