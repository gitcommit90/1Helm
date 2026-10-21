// node --import ./test/stubs/register.mjs test/hindsight-writers.test.mjs
// Memory Overhaul phase 3 (the design notes, flag HS_WRITERS), against the Mem0 memory (src/mem0.js): D1 and the index fake from
// test/helpers/mem0-fakes.mjs, and an extraction model that answers with the new messages as one fact. Checks:
//  A. Pure builders: the flag, document ids, local dates, the conversation entries, speaker names, strategies per kind, rounds.
//  B. retainV2 keeps secrets out of what the model sees and what is stored.
//  C. Append semantics on the real Resident: the turn lines are named, unfinished work joins the same document, memory off / a failed send (outbox, retry) behave.
//  D. The other writers on the real Resident: Notebook notes (add, edit, delete), files, skills, task cards, live notes, Bee conversations, contacts, voice inbox.
//  E. Deletion: note, task (chat), file, conversation rewrite and queued writes of a deleted document.
//  F. The rebuild: order, cursor saved before each batch, resume without duplicates, pause, outbox flushed, delete during a rebuild, the report.
//  G. The estimate and the admin path (dry run, two at a time, one account).
//  H to K. The secrets sweep, the Archive's notes, live notes cadence and Bee's inbox.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { FILE_MD_MAX, hsWriters, DOC, docKind, TAG, STRATEGY, dayKey, isoLocal, dayRange, convEntries, sliceEntries, convDocOf, ctxFor, ambientSpeaker, noteItem, fileItem, taskItem, skillItem, contactItem, liveEntries, liveItem, beeEntries, beeItem, itemsNano, inboxItem, inboxEligible, inboxText, rounds, itemExtractChars, hsNoteNotify, hsContactNotify } from "../src/hindsight-writers.js";
import { hsRetainBatchNano } from "../src/byok.js"; import { retainV2, scrubContent, bankId, listDocuments, memoriesList, documentText } from "../src/mem0.js";
import { readFileSync } from "node:fs"; import { fakeIndex, embedding, fakeExtraction } from "./helpers/mem0-fakes.mjs"; import { withSettings } from "./helpers/seed-settings.mjs";
import { speakerLabels } from "../src/hindsight-template.js";
import { hsRebuildAdmin, kindsFor, REBUILD_VERSION } from "../src/hindsight-rebuild.js";
import { Resident } from "../src/resident.js";
import { channelSkillsInit } from "../src/skills/channel.js";
import { Archive } from "../src/index.js";
import { LiveNotes } from "../src/ee/live-notes.js";
import { BeeSync, transcriptDoc, beeContentOf } from "../src/ee/bee-sync.js";
import { sweepSecretsLocal, rewriteOrDelete } from "../src/forget.js";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-40).join("\n")); });
const ok = (name) => console.log("  ok", name);
const names = { first: "Sam", helper: "Ollie", channel: "main" };

// ================= A. pure builders =================
{
  assert.equal(hsWriters({ HS_WRITERS: "on", HS_FOUNDATIONS: "on" }), true); assert.equal(hsWriters({ HS_WRITERS: "on" }), false, "needs the templates (strategies live in the bank template)");
  assert.equal(hsWriters({ HS_WRITERS: "off", HS_FOUNDATIONS: "on" }), false); assert.equal(hsWriters({}), false);
  assert.equal(DOC.conv("s1", "2026-10-14"), "conv:s1:2026-10-14"); assert.equal(DOC.live("t9", 2), "live:t9:s2"); assert.equal(DOC.bee(77), "bee:conv:77"); 
  assert.deepEqual(["conv:a:2026-10-14", "bee:conv:5", "note:n1", "file:f", "live:t:s1", "skill:x", "task:s", "contact:c", "inbox:i", "turn-9", "fact-m:1"].map(docKind), ["conv", "bee", "note", "file", "live", "skill", "task", "contact", "inbox", null, null]);
  assert.equal(dayKey(Date.UTC(2026, 9, 14, 3, 0), "America/Los_Angeles"), "2026-10-13"); assert.equal(isoLocal(Date.UTC(2026, 9, 14, 16, 2), "America/Los_Angeles"), "2026-10-14T09:02:00-07:00");
  assert.equal(isoLocal(Date.UTC(2026, 9, 14, 16, 2), "Asia/Kolkata"), "2026-10-14T21:32:00+05:30"); assert.equal(isoLocal(Date.UTC(2026, 9, 14, 16, 2), "Not/AZone"), "2026-10-14T16:02:00+00:00", "a bad zone is UTC");
  const dr = dayRange("2026-11-01", "America/Los_Angeles"); assert.equal((dr.end - dr.start) / 3600e3, 25, "the day the clocks go back"); assert.equal(dayKey(dr.start, "America/Los_Angeles"), "2026-11-01"); assert.equal(dayKey(dr.start - 1, "America/Los_Angeles"), "2026-10-31"); assert.equal(dayKey(dr.end, "America/Los_Angeles"), "2026-11-02");
  const L = speakerLabels(names), tz = "America/Los_Angeles", t0 = Date.UTC(2026, 9, 14, 16, 2);
  const e = convEntries({ userText: "I'm allergic to peanuts. my password is Tulip-2219", reply: "Noted.", notes: "- saved", at: t0, endAt: t0 + 20e3, labels: L, tz });
  assert.deepEqual(e.map((x) => x.speaker), ["Sam (user)", "Ollie (assistant)", "Ollie (assistant notes)"]); assert.equal(e[0].time, "2026-10-14T09:02:00-07:00"); assert.equal(e[1].time, "2026-10-14T09:02:20-07:00");
  assert.doesNotMatch(JSON.stringify(e), /Tulip-2219/, "secrets are scrubbed in the entries"); assert.match(e[0].text, /peanuts/);
  assert.equal(convEntries({ userText: "check", reply: "ok", at: t0, kind: "followup", labels: L, tz })[0].speaker, "Scheduled run prompt");
  const pe = convEntries({ partial: "Lookups done", at: t0, labels: L, tz }); assert.deepEqual(pe.map((x) => [x.speaker, x.text]), [["Ollie (assistant)", "(unfinished) Lookups done"]]);
  assert.deepEqual(convEntries({ userText: "", reply: "  ", at: t0, labels: L, tz }), [], "nothing to say, no entries");
  assert.deepEqual(convEntries({ notes: "- (1Helm: out of credits for the parts 1Helm runs, so this turn wasn't saved to memory.)\n- found three flights", at: t0, labels: L, tz }).map((x) => x.text), ["- found three flights"], "1Helm's own notices are not the helper's notes");
  assert.deepEqual(convEntries({ notes: "- (1Helm: a notice)", at: t0, labels: L, tz }), [], "only a notice: nothing");
  const big = Array.from({ length: 50 }, (_, i) => ({ speaker: "a", time: "t", text: "x".repeat(900 + i) })), sl = sliceEntries(big, 10000); assert.ok(sl.length > 3 && sl.every((s) => JSON.stringify(s).length <= 10000) && sl.flat().length === 50, "a long day is cut into ordered slices");
  assert.equal(convDocOf({ session: "s1", at: t0 }, tz), "conv:s1:2026-10-14"); assert.equal(convDocOf({ session: null, workflowId: 7, at: t0 }, tz), "conv:run-7:2026-10-14");
  // context strings: 300 characters at most, even with the longest names
  const long = { first: "F".repeat(90), helper: "H".repeat(90), channel: "c".repeat(90), section: "s".repeat(90), file: "f".repeat(300), name: "n".repeat(300), address: "a".repeat(300), summary: "u".repeat(300) };
  // No length limit (Captain 2026-10-14): long names and fields arrive whole.
  for (const k of ["chat", "note", "helper-note", "live", "bee", "skill", "task", "contact", "inbox"]) assert.ok(ctxFor(k, long).includes("F".repeat(90)), `${k}: the name is kept whole`);
  assert.ok(ctxFor("skill", long).includes("n".repeat(300)) && ctxFor("task", long).includes("n".repeat(300)) && ctxFor("file", long).includes("f".repeat(300)), "nothing is cut");
  assert.match(ctxFor("contact", names), /not words Sam said/); assert.match(ctxFor("bee", { ...names, address: "12 Elm St" }), /12 Elm St/);
  assert.equal(ambientSpeaker("Unknown", { first: "Sam" }), "Unknown speaker (not the user)"); assert.equal(ambientSpeaker(null, { first: "Sam", isUser: true }), "Sam (wearer, the user)"); assert.equal(ambientSpeaker("sam", { first: "Sam" }), "Sam (wearer, the user)");
  assert.equal(ambientSpeaker("Priya", { first: "Sam" }), "Priya (not the user)"); assert.equal(ambientSpeaker({ name: "Dan" }, { first: "Sam" }), "Dan (not the user)"); assert.equal(ambientSpeaker("Others", { first: "Sam" }), "Others (not the user)");
  // retain items: constant tag per kind, strategy per kind, shared observation scopes
  const note = noteItem({ row: { id: "n1", content: "Likes HTML", author_type: "human", sec: "how", created: 5, edited: 9 }, names, channel: "main" });
  assert.deepEqual([note.document_id, note.strategy, note.tags, note.update_mode, note.observation_scopes, note.at], ["note:n1", "note", ["source:note"], "replace", "shared", 9]); assert.match(note.context, /A note Sam wrote in their 1Helm Notebook, in the how to work together section/);
  assert.match(noteItem({ row: { id: "n2", content: "x", author_type: "agent", sec: "people", created: 5 }, names, channel: "main" }).context, /A note Ollie saved about Sam/);
  assert.equal(fileItem({ id: "f1", name: "a.docx", md: "x".repeat(FILE_MD_MAX), kind: "doc", at: 1, names, mime: "m", channel: "main" }).strategy, "file");
  assert.equal(fileItem({ id: "f1", name: "a.docx", md: "x".repeat(FILE_MD_MAX + 1), kind: "doc", at: 1, names, mime: "m", channel: "main" }).strategy, "reference", "above 60,000 characters: chunks, no model");
  assert.equal(fileItem({ id: "f2", name: "a.xlsx", md: "x", kind: "sheet", at: 1, names, mime: "m", channel: "main" }).strategy, "reference", "a spreadsheet is reference");
  assert.equal(fileItem({ id: "f2", name: "a.xlsx", md: "x", kind: "sheet", at: 1, names, mime: "m", channel: "main" }).strategy, "reference", "a spreadsheet is reference");
  assert.equal(itemExtractChars(fileItem({ id: "f2", name: "a.xlsx", md: "x".repeat(100), kind: "sheet", at: 1, names, mime: "m", channel: "main" })), 0, "reference has no extraction cost");
  const task = taskItem({ session: "s1", title: "Plan Japan", created: Date.UTC(2026, 9, 1), items: [{ id: "1", text: "Book flights", status: "done", by: "person" }, { id: "2", text: "Hotels", status: "todo", by: "helper" }], names, channel: "main" });
  assert.deepEqual([task.document_id, task.tags, task.strategy], ["task:s1", ["source:task"], "chat"]); assert.match(task.content, /\[done\] Book flights \(Sam changed it last\)/); assert.match(task.content, /\[todo\] Hotels \(Ollie changed it last\)/);
  assert.deepEqual([skillItem({ slug: "weekly", description: "Use when", body: "# W", at: 1, names, channel: "main" }).document_id, skillItem({ slug: "weekly", description: "d", body: "# W", at: 1, names, channel: "main" }).strategy], ["skill:weekly", "note"]);
  const contact = contactItem({ p: { id: "p1", name: "Dana Lee", rel: "Your sister", aka: ["Dani"], phone: "555-0100", email: "d@x.com", bday: "May 3", facts: [{ text: "Likes tea", src: "You added" }, { text: "secret channel fact", channel: "work" }], created: 1 }, names });
  assert.deepEqual([contact.document_id, contact.tags], ["contact:p1", ["source:contact"]]); assert.match(contact.content, /Dana Lee/); assert.match(contact.content, /Likes tea/); assert.doesNotMatch(contact.content, /secret channel fact/, "facts a channel learned stay out of the card");
  const le = liveEntries([{ at: t0, speaker: "Sam", text: "hello" }, { at: t0 + 1000, speaker: "Unknown", text: "hi" }, { at: t0 + 2000, speaker: null, text: "  " }], { first: "Sam", tz }); assert.deepEqual(le.map((x) => x.speaker), ["Sam (wearer, the user)", "Unknown speaker (not the user)"]);
  assert.equal(liveEntries([{ at: t0, text: "hello" }], { first: "Sam", tz, mic: true })[0].speaker, "Unlabeled speech (microphone)");
  const li = liveItem({ task: "t1", n: 2, entries: le, at: t0, names, channel: "main", key: "2:9" }); assert.deepEqual([li.document_id, li.strategy, li.tags, li.update_mode], ["live:t1:s2", "ambient", ["source:live"], "append"]);
  const rawE = beeEntries([{ at: t0, speaker: "wearer", is_user: true, text: "buy oat milk" }, { at: t0 + 60000, speaker: "Speaker 2", is_user: false, text: "ok" }], { first: "Sam", tz }), bi = beeItem({ id: 5, entries: rawE, at: t0, address: "Elm St", summary: "Errands", started: "a", ended: "b", names });
  assert.deepEqual([bi.document_id, bi.strategy, bi.tags, bi.update_mode, bi.observation_scopes], ["bee:conv:5", "raw-transcript", ["source:bee", "kind:raw"], "replace", "shared"], "the constant source:bee tag plus kind:raw, observation scopes shared");
  assert.equal(bi.content, `[${rawE[0].time}] Sam (wearer, the user): buy oat milk\n[${rawE[1].time}] Speaker 2 (not the user): ok`, "one line per utterance: the time and the speaker label exactly as the entries carry them, then the words");
  assert.equal(typeof bi.content, "string"); assert.equal(itemExtractChars(bi), 0, "chunks mode makes no model call, so no extraction characters are priced"); assert.equal(itemsNano([bi]), 0); assert.match(bi.context, /Summary: Errands/); assert.equal(bi.metadata.kind, "bee");
  const it = { id: "i1", kind: "task", text: "Buy milk", status: "open", confidence: "captured", needs_review: false, source_at: t0, source_id: "5", evidence: [{ quote: "buy milk tomorrow" }], attribution: { is_user: true } };
  assert.equal(inboxEligible(it), true); assert.equal(inboxEligible({ ...it, needs_review: true }), false); assert.equal(inboxEligible({ ...it, confidence: "unverified" }), false); assert.equal(inboxEligible({ ...it, confidence: "unverified", confirmed: true }), true);
  const ii = inboxItem({ it, names, tz }); assert.deepEqual([ii.document_id, ii.strategy, ii.tags], ["inbox:i1", "note", ["source:bee"]]); assert.match(ii.content, /Status: open/); assert.notEqual(inboxItem({ it: { ...it, status: "completed" }, names, tz }).content, ii.content, "a status change changes the document");
  // rounds: an append goes alone, a replace never repeats a document id in one request
  const mk = (d, mode = "replace") => ({ document_id: d, update_mode: mode }), rs = rounds([mk("a"), mk("b"), mk("a"), mk("c", "append"), mk("d"), mk("c", "append")]);
  assert.deepEqual(rs.map((r) => r.map((x) => `${x.document_id}${x.update_mode === "append" ? "+" : ""}`)), [["a", "b"], ["a"], ["c+"], ["d"], ["c+"]]);
  ok("A. builders: flag, ids, local dates, entries, contexts under 300 characters, speakers, strategies, rounds");
}

// ---- the Mem0 memory behind the real Resident: the migration in a D1 on node:sqlite, the index fake, the embedding fake and an extraction model that answers with the new messages as one fact ----
const echo = (p) => [{ text: p.split("## New Messages").pop().split("## Observation Date")[0].trim(), category: "other" }];
const X = fakeExtraction(echo);
process.on("exit", () => X.done());
const seen = (re) => X.calls.some((c) => re.test(JSON.stringify(c.messages)));   // what the extraction model was told, for the context of an item
const MEMORY_SQL = readFileSync(new URL("../db/migrations/0063_memory.sql", import.meta.url), "utf8");
const wrapD1 = (db) => ({ batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; },
  prepare: (q) => { const st = db.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } });

// ---- a D1 for the admin path, the Archive, live notes and Bee below ----
const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, owner_user_id TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','u1'); CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','chk+x@example.com');");
d1.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc));");
const DB = wrapD1(d1);
function mkRes(o = {}) {
  const db = new DatabaseSync(":memory:"); db.exec(MEMORY_SQL);
  db.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, owner_user_id TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','u1'); CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','chk+x@example.com');");
  db.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc));");
  const index = fakeIndex(), dodb = new DatabaseSync(":memory:"), alarms = [], notes = new Map();
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
    a = a.map((x) => x instanceof ArrayBuffer ? new Uint8Array(x) : x); const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const bg = []; const ctx = { storage: { sql, getAlarm: async () => alarms.at(-1) ?? null, setAlarm: async (t) => { alarms.push(t); }, deleteAlarm: async () => {} }, waitUntil: (p) => { bg.push(Promise.resolve(p).catch(() => {})); } };
  const R2 = new Map(); const WS = { get: async (k) => R2.has(k) ? { text: async () => R2.get(k), arrayBuffer: async () => new TextEncoder().encode(R2.get(k)).buffer } : null, list: async ({ prefix }) => ({ objects: [...R2.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date(R2meta.get(key) || 0) })), truncated: false }) };
  const R2meta = new Map();
  const beeRows = o.bee || []; const inboxRows = o.inbox || [];
  const BEE_SYNC = { idFromName: (x) => x, get: () => ({ hsBeeSource: async (after, limit, snap) => { const rows = beeRows.filter((c) => c.at <= snap && (!after || `${String(c.at).padStart(15, "0")}|${c.id}` > after)).slice(0, limit); return { items: rows, next: rows.length ? `${String(rows.at(-1).at).padStart(15, "0")}|${rows.at(-1).id}` : null, done: rows.length < limit }; },
    hsInboxSource: async (after, limit) => { const rows = inboxRows.filter((x) => !after || x.id > after).slice(0, limit); return { items: rows, next: rows.length ? rows.at(-1).id : null, done: rows.length < limit }; } }) };
  const env = withSettings({ ENV_NAME: "dev", HS_FOUNDATIONS: "on", HS_WRITERS: "on", OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off", CF_ACCOUNT_ID: "a", AIG_ID: "g", AIG_TOKEN: "t", DB: wrapD1(db), MEMORY_INDEX: index, AI: { run: async (_m, b) => ({ data: b.text.map(embedding), usage: {} }) },
    MEMORY: "on", GENUI: "off", WORKMEM: "off", GATEWAY_HOST: "selfhost.example", APP_HOST: "selfhost.example", WS, BEE_SYNC, ...(o.env || {}) });
  const R = new Resident(ctx, env); R.put("tenant", "t1"); R.put("channel", o.channel || "main"); R.put("channel_id", "1"); R.put("tz", "America/Los_Angeles");
  const people = o.people || [];
  R.archive = () => ({ channels: async () => [{ id: 1, slug: o.channel || "main", name: "General", purpose: "Everyday help" }],
    noteRow: async (cid, id) => notes.get(String(id)) || null,
    noteRows: async (cid, after, limit, upTo) => { const all = [...notes.values()].filter((m) => Number(m.created) <= upTo && m.status !== "superseded").sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)), key = (m) => `${String(m.created).padStart(15, "0")}|${m.id}`; const rows = all.filter((m) => !after || key(m) > after).slice(0, limit); return { rows, next: rows.length ? key(rows.at(-1)) : null, done: rows.length < limit }; },
    peopleList: async () => people, personGet: async (id) => people.find((p) => p.id === id) || null });
  // fail(status): the embedding model answers with that status (every call until heal(), or only the next one)
  const run = env.AI.run, fail = (status, once = true) => { env.AI.run = async () => { if (once) env.AI.run = run; throw Object.assign(new Error(`memory ${status}`), { status }); }; };
  return { R, env, index, d1: db, bank: bankId(env, "t1", o.channel || "main"), notes, alarms, R2, R2meta, people, bg, flush: async () => { while (bg.length) await bg.shift(); }, setTz: (z) => R.put("tz", z), fail, heal: () => { env.AI.run = run; }, dues: () => db.prepare("SELECT doc FROM hs_forget ORDER BY doc").all().map((r) => r.doc) };
}
const addTurn = (R, t) => R.sql.exec("INSERT INTO turns (id, at, user_text, reply, kind, session, workflow_id, notes, total_ms, error) VALUES (?,?,?,?,?,?,?,?,?,?)", t.id, t.at, t.user ?? null, t.reply ?? null, t.kind || "chat", t.session ?? null, t.wf ?? null, t.notes ?? null, t.ms ?? 0, t.error ?? null);
const T1 = Date.UTC(2026, 9, 14, 16, 2), T2 = Date.UTC(2026, 9, 15, 3, 30);   // Oct 14 09:02 and Oct 14 20:30 in Los Angeles
// What the memory holds: the documents (with a prefix), whether one exists, the text of a document (the facts it was made into, or its chunks)
const ids = async (m, q = "") => (await listDocuments(m.env, m.bank, { q, limit: 500 })).map((d) => d.id);
const has = async (m, id) => (await ids(m, id)).includes(id);
const txt = async (m, id) => (await memoriesList(m.env, m.bank, { doc: id, limit: 200 })).items.map((i) => i.text).join("\n");
const facts = async (m, id) => (await listDocuments(m.env, m.bank, { q: id })).find((d) => d.id === id)?.facts ?? 0;
const rowDocs = (m) => m.d1.prepare("SELECT doc FROM mem WHERE doc IS NOT NULL ORDER BY rowid").all().map((r) => r.doc);   // the documents in the order their facts were written

// ================= B. retainV2 keeps secrets out =================
{
  const m = mkRes();
  await retainV2(m.env, m.bank, [{ document_id: "conv:s:2026-10-14", content: [{ speaker: "Sam (user)", time: "t", text: 'my password is "Tulip-2219" and my key is sk-abcdefghijklmnopqrstuvwxyz0123456789' }], at: 5, context: "ctx password is hunter22222", metadata: { note: "token sk-abcdefghijklmnopqrstuvwxyz0123456789" }, strategy: "chat", tags: [TAG.chat], update_mode: "append" },
    { document_id: "ref:1", content: "the pin is Tulip-2219 here", at: 6, strategy: "reference", metadata: { note: "key sk-abcdefghijklmnopqrstuvwxyz0123456789" } }]);
  assert.ok(X.calls.length >= 1); assert.doesNotMatch(JSON.stringify(X.calls), /Tulip-2219|sk-abcdef|hunter22222/, "the extraction model never sees a secret (content, context, metadata)");
  assert.doesNotMatch(JSON.stringify(m.d1.prepare("SELECT payload FROM mem").all()), /Tulip-2219|sk-abcdef|hunter22222/, "and none is stored");
  assert.equal(await retainV2(m.env, m.bank, [{ document_id: "d", content: "  " }]), null, "nothing to send"); await assert.rejects(() => retainV2(m.env, m.bank, [{ content: "x" }]), /document_id/);
  assert.deepEqual(JSON.parse(scrubContent([{ t: "the pin is 4821 sorry" }, "x"])).slice(1), ["x"]);
  ok("B. retainV2: secrets are scrubbed from content (also inside JSON), context and metadata before the model sees them and before anything is stored");
}


// ================= C. append semantics on the real Resident =================
{
  const m = mkRes(); const { R } = m; await R.hsNames();
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','Plan Japan',1,1,1)"); addTurn(R, { id: "t1", at: T1, user: "I'm allergic to peanuts", reply: "Noted.", session: "s1" });
  await R.hsTurnWrite({ turn: "t1", session: "s1", at: T1, userText: "I'm allergic to peanuts", reply: "Noted.", notes: null, endAt: T1 + 5000 });
  await R.hsTurnWrite({ turn: "t2", session: "s1", at: T1 + 600e3, userText: "Book flights to Tokyo", reply: "On it.", notes: "- searched flights", endAt: T1 + 650e3 });
  await R.hsTurnWrite({ turn: "t3", session: "s1", at: T2, userText: "evening question", reply: "answer", endAt: T2 + 3000 });   // the same evening: the same local day
  await R.hsTurnWrite({ turn: "t4", session: "s1", at: T2 + 86400e3, userText: "next day", reply: "yes", endAt: T2 + 86400e3 + 1000 });
  assert.deepEqual(await ids(m, "conv:"), ["conv:s1:2026-10-14", "conv:s1:2026-10-15"], "one document per task and local day");
  const day1 = await txt(m, "conv:s1:2026-10-14");
  for (const re of [/Sam \(user\)/, /Ollie \(assistant\)/, /Ollie \(assistant notes\)/, /peanuts/, /Tokyo/, /searched flights/, /evening question/, /2026-10-14T09:02:00-07:00/]) assert.match(day1, re, `the day's document holds ${re}`);
  assert.doesNotMatch(day1, /next day/, "the next local day is another document"); assert.equal(await facts(m, "conv:s1:2026-10-14"), 3, "each turn was added to the day's document, none replaced another");
  assert.ok(seen(/between Sam \(the user\) and Ollie/), "the model is told who is talking");
  // the task card follows the turn
  await m.flush(); assert.ok(await has(m, "task:s1"), "every task has a card, with or without a checklist");
  R.todoSave("s1", [{ id: "1", text: "Pack", status: "todo", by: "helper", at: 1 }], 1, 0, 2); await m.flush(); assert.match(await txt(m, "task:s1"), /Pack/, "a checklist is added to the card");
  // unfinished work joins the same document
  R.sql.exec("CREATE TABLE IF NOT EXISTS work_log_partial (turn TEXT PRIMARY KEY, at INTEGER, session TEXT, text TEXT)"); addTurn(R, { id: "t5", at: T1 + 900e3, user: "look up trains", session: "s1", error: "stopped" });
  await R.hsPartialWrite({ session: "s1", turn: "t5", at: T1 + 900e3, text: "Unfinished work (stopped). Lookups: trains" });
  assert.match(await txt(m, "conv:s1:2026-10-14"), /\(unfinished\)/); assert.equal(await facts(m, "conv:s1:2026-10-14"), 4);
  assert.ok(!(await ids(m)).some((d) => d.startsWith("partial-") || d.startsWith("turn-")), "no partial-<turn> or turn-<id> document");
  // a scheduled run without a task has its own document and the scheduled context
  await R.hsTurnWrite({ turn: "w1", session: null, workflowId: 7, kind: "workflow", at: T1, userText: "weather report", reply: "Sunny" });
  assert.match(await txt(m, "conv:run-7:2026-10-14"), /Scheduled run prompt/); assert.ok(seen(/Scheduled run of a Ollie workflow/));
  // memory off: nothing is sent
  const calls0 = X.calls.length, docs0 = (await ids(m)).length; R.put("memory_mode", "off"); const off = await R.hsTurnWrite({ turn: "t9", session: "s1", at: T1, userText: "x", reply: "y" }); assert.deepEqual(off, { skipped: "memory off" }); assert.equal(X.calls.length, calls0); assert.equal((await ids(m)).length, docs0); R.put("memory_mode", "on");
  // flag off: nothing is sent
  const offR = mkRes({ env: { HS_WRITERS: "off" } }); assert.deepEqual(await offR.R.hsTurnWrite({ turn: "t1", session: "s", at: 1, userText: "x", reply: "y" }), { skipped: "off" }); assert.equal(X.calls.length, calls0); assert.deepEqual(await ids(offR), []);
  assert.equal(offR.R.hsW(), false); assert.deepEqual(await offR.R.hsRebuild("status"), { error: "HS_WRITERS is off" });
  ok("C. appends: one document per task and day, every turn added to it, named speakers, unfinished work in the same document, memory off, flag off");
}

// ================= C2. credit holds, failed sends, the outbox =================
{
  const m = mkRes(); const { R } = m; await R.hsNames(); R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','T',1,1,1)");
  const holds = []; R.env.BYOK = "1"; R.byokHold = async (kind, nano) => { holds.push([kind, nano]); return { done: async (n) => n }; };
  await R.hsTurnWrite({ turn: "t1", session: "s1", at: T1, userText: "x".repeat(250), reply: "y".repeat(250) });
  const turnHold = holds.find((h) => h[0] === "hs-retain"); assert.ok(turnHold && turnHold[1] > 0, "a normal write keeps its hold before the retain");
  holds.length = 0; await R.hsRetainHold([100, 200]); assert.deepEqual(holds, [["hs-retain", hsRetainBatchNano([100, 200])]], "priced by the meter in src/byok.js, on the characters sent");
  // no credits: skipped, nothing sent
  R.byokHold = async () => null; R.byokRetainSkipped = () => { holds.push(["skipped"]); }; const n0 = X.calls.length;
  const r = await R.hsTurnWrite({ turn: "t2", session: "s1", at: T1 + 1, userText: "more", reply: "ok" }); assert.equal(r.skipped, 1); assert.equal(X.calls.length, n0, "out of credits: not saved"); assert.ok(holds.some((h) => h[0] === "skipped"));
  R.byokHold = async () => ({ done: async () => 0 });
  // a server error: the item goes to the outbox and the alarm sends it again
  m.fail(503); const rq = await R.hsTurnWrite({ turn: "t3", session: "s1", at: T1 + 2, userText: "retry me", reply: "ok" }); assert.equal(rq.queued, 1); assert.equal(R.hsOutboxCount(), 1);
  assert.ok(R.hsOutboxNext() > Date.now(), "the alarm is asked to come back"); const fl = await R.hsFlush({ max: 10, paid: true }); assert.equal(fl.sent, 1); assert.equal(R.hsOutboxCount(), 0);
  assert.match(await txt(m, "conv:s1:2026-10-14"), /retry me/, "the queued turn arrived");
  // a client error is dropped, not retried forever
  m.fail(400); const bad = await R.hsTurnWrite({ turn: "t4", session: "s1", at: T1 + 3, userText: "bad", reply: "ok" }); assert.equal(bad.dropped, 1); assert.equal(R.hsOutboxCount(), 0);
  // a secret never reaches the memory
  await R.hsTurnWrite({ turn: "t5", session: "s1", at: T1 + 4, userText: "my password is Tulip-2219", reply: "ok" }); assert.doesNotMatch(await txt(m, "conv:s1:2026-10-14"), /Tulip-2219/);
  ok("C2. credit holds before each retain (priced by the meter), out of credits skips, a failed send is queued and retried, a client error is dropped, secrets stay out");
}

// ================= D. the other writers =================
{
  const m = mkRes(); const { R, notes } = m; await R.hsNames();
  // Notebook notes: add, edit, delete, person and helper
  notes.set("n1", { id: "n1", content: "I prefer HTML", author_type: "human", sec: "how", created: 100, status: "current" });
  notes.set("n2", { id: "n2", content: "Dana is Sam's sister", author_type: "agent", sec: "people", created: 200, status: "current" });
  await R.hsNoteSync("n1"); await R.hsNoteSync("n2");
  assert.match(await txt(m, "note:n1"), /I prefer HTML/); assert.ok(seen(/Sam wrote/), "the model is told who wrote the person's note"); const n2 = (await memoriesList(m.env, m.bank, { doc: "note:n2" })).items; assert.deepEqual(n2.map((i) => [i.text, i.type]), [["Dana is Sam's sister", "person"]], "what the helper saved is kept as written, in the category of its section");
  notes.get("n1").content = "I prefer plain HTML"; notes.get("n1").edited = 300; await R.hsNoteSync("n1"); assert.match(await txt(m, "note:n1"), /plain HTML/); assert.doesNotMatch(await txt(m, "note:n1"), /prefer HTML/, "an edit replaces the document"); assert.equal(await facts(m, "note:n1"), 1);
  notes.delete("n2"); await R.hsNoteSync("n2"); assert.ok(!(await has(m, "note:n2")), "a deleted note loses its document"); assert.ok(m.dues().includes("note:n2"), "and the delayed re-delete is scheduled (hs_forget)");
  notes.set("n3", { id: "n3", content: "reflection", author_type: "agent", sec: "how", src: "reflection", created: 1 }); assert.match((await R.hsNoteSync("n3")).skipped, /reflection/);
  notes.set("n4", { id: "n4", content: "old", author_type: "human", sec: "now", created: 1, status: "superseded" }); await R.hsNoteSync("n4"); assert.ok(!(await has(m, "note:n4")));
  // the Worker helper reaches the right Resident for any writer (the app, Bee, the interview)
  let seenRes = null; const env2 = { HS_WRITERS: "on", HS_FOUNDATIONS: "on", RESIDENT: { idFromName: (n) => n, get: (n) => ({ bind: async (...a) => { seenRes = [n, ...a]; }, hsNoteSync: async (id) => ({ synced: id }) }) } };
  assert.deepEqual(await hsNoteNotify(env2, "t1", "main", 1, "n9"), { synced: "n9" }); assert.deepEqual(seenRes, ["res:t1:main", "t1", "main", "1"]); assert.equal(await hsNoteNotify({ ...env2, HS_WRITERS: "off" }, "t1", "main", 1, "n9"), null, "flag off: nothing");
  assert.equal(await hsNoteNotify({ ...env2, RESIDENT: { idFromName: (n) => n, get: () => ({ bind: async () => { throw new Error("old object"); } }) } }, "t1", "main", 1, "n9"), null, "an error never breaks the note write");
  // files: the sidecar Markdown, by size; a new version replaces
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f1', 500, 'plan.docx', 'application/vnd.openxmlformats', 100, 'k1', 'upload', NULL, NULL, 0, 0)");
  R.sql.exec("CREATE TABLE IF NOT EXISTS file_sidecars (file_id TEXT PRIMARY KEY, src_key TEXT, status TEXT, v INTEGER, kind TEXT, key TEXT, vec_key TEXT, bytes INTEGER, tokens INTEGER, card TEXT, outline TEXT, notes TEXT, error TEXT, cost_nano INTEGER, ms INTEGER, queued_at INTEGER, at INTEGER)");
  m.R2.set("k1.sidecar.json", JSON.stringify({ md: "# Plan\nWe fly on May 3." })); R.sql.exec("INSERT INTO file_sidecars (file_id, src_key, status, kind, key) VALUES ('f1','k1','ready','doc','k1.sidecar.json')");
  assert.equal((await R.hsFileSync("f1")).sent, 1); assert.match(await txt(m, "file:f1"), /fly on May 3/); assert.ok(seen(/A file in Sam's 1Helm Library: plan.docx/));
  assert.deepEqual(await R.hsFileSync("f1"), { skipped: "unchanged" }, "once per version of the bytes");
  let c0 = X.calls.length; m.R2.set("k1.sidecar.json", JSON.stringify({ md: "# Plan\n" + "word ".repeat(13000) })); R.put("hsf:f1", ""); await R.hsFileSync("f1"); assert.equal(X.calls.length, c0, "a long file is kept as chunks with no model call"); assert.ok(await facts(m, "file:f1") > 1);
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f2', 600, 'sheet.xlsx', 'x', 10, 'k2', 'upload', NULL, NULL, 0, 0)"); m.R2.set("k2.sidecar.json", JSON.stringify({ md: "a,b\n1,2" })); R.sql.exec("INSERT INTO file_sidecars (file_id, src_key, status, kind, key) VALUES ('f2','k2','ready','sheet','k2.sidecar.json')"); await R.hsFileSync("f2"); assert.equal(X.calls.length, c0, "a spreadsheet is kept as chunks with no model call"); assert.ok(await has(m, "file:f2"));
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f3', 700, 'Standup · Meeting notes.md', 'text/markdown', 10, 'k3', 'helper', NULL, NULL, 0, 0)"); m.R2.set("k3", "# Standup\n## Session 1\nDecisions: ship Friday"); await R.hsFileSync("f3"); assert.match(await txt(m, "file:f3"), /ship Friday/, "a Markdown file is its own text (the meeting notes)");
  assert.deepEqual(await R.hsFileSync("nofile"), { dropped: 1 });
  { R.sql.exec("INSERT INTO forgotten (at, keys, origin) VALUES (1, '[1]', 'here')"); R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f4', 800, 'food.md', 'text/markdown', 10, 'k4', 'upload', NULL, NULL, 0, 0)"); m.R2.set("k4", "My favorite ramen place is Ippudo"); assert.equal((await R.hsFileSync("f4")).sent, 1, "a file is always retained, whatever the old forgotten list holds"); assert.match(await txt(m, "file:f4"), /Ippudo/);
    await R.hsLiveAppend({ task: "t5", n: 1, rows: [{ at: T1, speaker: "Sam", text: "the ramen was great" }, { at: T1 + 1, speaker: "Sam", text: "see you at noon" }], at: T1, key: "k" }); const lv = await txt(m, "live:t5:s1"); assert.match(lv, /the ramen was great/); assert.match(lv, /see you at noon/, "live note lines are all kept"); }
  // skills and task cards
  channelSkillsInit(R.sql); R.sql.exec("INSERT INTO channel_skills (slug, description, body, created, updated) VALUES ('weekly-report','Use when asked for the report','# Weekly report\nStep 1',10,20)"); await R.hsSkillSync("weekly-report");
  assert.match(await txt(m, "skill:weekly-report"), /Weekly report/); R.sql.exec("DELETE FROM channel_skills WHERE slug='weekly-report'"); await R.hsSkillSync("weekly-report"); assert.ok(!(await has(m, "skill:weekly-report")), "a deleted skill loses its document");
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s7','Trip',5,5,5)"); R.todoSave("s7", [{ id: "1", text: "Pack", status: "todo", by: "helper", at: 1 }], 1, 0, 2); await m.flush();
  assert.match(await txt(m, "task:s7"), /\[todo\] Pack/); c0 = X.calls.length; await R.hsTaskSync("s7"); assert.equal(X.calls.length, c0, "an unchanged task card is not sent again");
  R.todoSave("s7", [{ id: "1", text: "Pack", status: "done", by: "person", at: 2 }], 2, 0, 2); await m.flush(); assert.match(await txt(m, "task:s7"), /\[done\] Pack \(Sam changed it last\)/);
  // live notes: a chunk is appended to live:<task>:s<n>
  await R.hsLiveAppend({ task: "t1", n: 1, rows: [{ at: T1, speaker: "Sam", text: "let's meet at noon" }, { at: T1 + 1000, speaker: "Unknown", text: "ok" }], mic: false, at: T1, key: "1:2" });
  await R.hsLiveAppend({ task: "t1", n: 1, rows: [{ at: T1 + 5000, speaker: "Unknown", text: "see you" }], mic: false, at: T1, key: "1:3" });
  const live = await txt(m, "live:t1:s1"); assert.match(live, /let's meet at noon/); assert.match(live, /see you/); assert.match(live, /Unknown speaker \(not the user\)/); assert.equal(await facts(m, "live:t1:s1"), 2, "each chunk was added");
  // Bee conversation (General): the transcript lines as chunks, with no model call
  c0 = X.calls.length; await R.hsBeePut({ id: 5, lines: [{ at: T1, speaker: "wearer", is_user: true, text: "buy milk" }, { at: T1 + 1000, speaker: "Speaker 2", is_user: false, text: "ok" }], at: T1, address: "12 Elm St", summary: "Errands", started: "a", ended: "b" });
  assert.equal(X.calls.length, c0, "a recording is kept as chunks, with no extraction"); assert.match(await documentText(m.env, m.bank, "bee:conv:5"), /^\[\d{4}-\d\d-\d\dT[\d:]+[+-]\d\d:\d\d\] Sam \(wearer, the user\): buy milk\n\[.*\] Speaker 2 \(not the user\): ok$/, "plain text, one line per utterance"); assert.equal((await ids(m, "bee:")).length, 1, "one document per recording");
  // deleting the recording removes its document, and the delayed re-delete (hs_forget) holds it
  await R.hsDropDocs(["bee:conv:5"]); assert.ok(!(await has(m, "bee:conv:5")), "forgetting a recording removes its chunks"); assert.ok(m.dues().includes("bee:conv:5"), "and it is re-checked later");
  assert.deepEqual(await mkRes({ channel: "work" }).R.hsBeePut({ id: 1, lines: [], at: 1 }), { skipped: "not General" }, "Bee goes to General only");
  // contacts (General only)
  m.people.push({ id: "p1", name: "Dana Lee", rel: "Your sister", created: 1, updated: 2, facts: [] }); await R.hsContactSync(["p1"]); assert.match(await txt(m, "contact:p1"), /Dana Lee/);
  m.people.length = 0; await R.hsContactSync(["p1"]); assert.ok(!(await has(m, "contact:p1")), "a deleted contact loses its card");
  m.people.push({ id: "p2", name: "Raj", created: 1, updated: 9, facts: [] }, { id: "p3", name: "Mia", created: 1, updated: 10, facts: [] }); await R.hsContactSync(null); assert.ok((await has(m, "contact:p2")) && (await has(m, "contact:p3")), "an import: the added cards follow");
  c0 = X.calls.length; await R.hsContactSync(null); assert.equal(X.calls.length, c0, "nothing new, nothing sent");
  assert.deepEqual(await mkRes({ channel: "work" }).R.hsContactSync(["p1"]), { skipped: "not General" });
  let cseen = null; await hsContactNotify({ HS_WRITERS: "on", HS_FOUNDATIONS: "on", RESIDENT: { idFromName: (n) => n, get: (n) => ({ hsContactSync: async (ids) => { cseen = [n, ids]; } }) } }, "t1", ["p1"]); assert.deepEqual(cseen, ["res:t1:main", ["p1"]]);
  // voice inbox (option (a)): confirmed items only, the status in the text, a status change replaces the document
  const item = { id: "i1", kind: "task", text: "Buy milk", status: "open", confidence: "captured", needs_review: false, source_at: T1, source_id: "5", evidence: [{ quote: "buy milk" }], attribution: { is_user: true } };
  await R.hsInboxPut([item, { ...item, id: "i2", needs_review: true }]); assert.ok((await has(m, "inbox:i1")) && !(await has(m, "inbox:i2")), "only eligible items are retained");
  await R.hsInboxPut([{ ...item, status: "completed" }]); assert.match(await txt(m, "inbox:i1"), /Status: completed/); assert.doesNotMatch(await txt(m, "inbox:i1"), /Status: open/, "replaced, not added to");
  assert.deepEqual(await mkRes({ channel: "work" }).R.hsInboxPut([item]), { skipped: "not General" });
  ok("D. writers: notes (add, edit, delete; person and helper), files by size, skills, task cards, live notes, Bee transcripts, contacts, voice inbox");
}

// ================= E. deletion =================
{
  const m = mkRes(); const { R } = m; await R.hsNames();
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','Trip',1,1,1)"); R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s2','Other',1,1,1)");
  addTurn(R, { id: "a1", at: T1, user: "hello", reply: "hi", session: "s1" }); addTurn(R, { id: "a2", at: T2, user: "later", reply: "yes", session: "s1" }); addTurn(R, { id: "b1", at: T1, user: "keep me", reply: "ok", session: "s2" }); addTurn(R, { id: "w1", at: T1, user: "wf", reply: "ok", session: null, wf: 3, kind: "workflow" });
  for (const t of ["a1", "a2"]) await R.hsTurnWrite({ turn: t, session: "s1", at: t === "a1" ? T1 : T2, userText: "x", reply: "y" }); await R.hsTurnWrite({ turn: "b1", session: "s2", at: T1, userText: "keep me", reply: "ok" });
  R.todoSave("s1", [{ id: "1", text: "a", status: "todo", by: "helper", at: 1 }], 1, 0, 2); await m.flush();
  // a queued write of the chat is taken out when the chat is deleted
  R.hsOutboxInit(); R.sql.exec("INSERT INTO hs_outbox (doc, item, del, paid, at) VALUES ('conv:s1:2026-10-14', '{}', 0, 0, 1)");
  const inv = await R.sessionInventory("s1"); const docs = inv.hsDocs.filter((d) => docKind(d));
  assert.ok(docs.includes("conv:s1:2026-10-14") && docs.includes("task:s1"), "a chat delete lists its conversation documents and its task card"); assert.ok(!docs.some((d) => d.startsWith("conv:s2")), "not another chat's"); assert.ok(inv.hsDocs.includes("turn-a1"), "the old turn documents are still listed");
  assert.equal(R.sql.exec("SELECT COUNT(*) n FROM hs_outbox").one().n, 0, "its queued writes are gone");
  const wfInv = await R.sessionInventory("none"); assert.ok(!wfInv.hsDocs.some((d) => d.startsWith("conv:s1")));
  // note delete: the document list carries note:<id>
  const nf = await R.noteForget("n7"); assert.ok(nf.hsDocs.includes("note:n7") && nf.hsDocs.includes("fact-m:n7"), "note delete removes note:<id> (and the old fact document)");
  // file delete: the document goes
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f9', 5, 'a.md', 'text/markdown', 10, 'k9', 'upload', NULL, NULL, 0, 0)"); m.R2.set("k9", "# hi\nsome file text"); R.env.WS.delete = async () => {}; R.env.WS.put = async () => {}; await R.hsFileSync("f9"); assert.ok(await has(m, "file:f9"));
  await R.deleteFile("f9"); assert.ok(!(await has(m, "file:f9")), "a file delete removes its document"); assert.ok(m.dues().includes("file:f9"), "and re-checks later (hs_forget)");
  // forget: the conversation document is written again without the forgotten turn; a document with nothing left is deleted
  addTurn(R, { id: "c1", at: T1 + 60e3, user: "my favorite color is teal", reply: "teal noted", session: "s9" }); addTurn(R, { id: "c2", at: T1 + 120e3, user: "I like tea", reply: "nice", session: "s9" });
  for (const [t, at, u, r] of [["c1", T1 + 60e3, "my favorite color is teal", "teal noted"], ["c2", T1 + 120e3, "I like tea", "nice"]]) await R.hsTurnWrite({ turn: t, session: "s9", at, userText: u, reply: r });
  assert.match(await txt(m, "conv:s9:2026-10-14"), /teal/);
  const rw = await R.hsConvRewrite(["conv:s9:2026-10-14"], ["c1"]); assert.deepEqual(rw, { rewritten: 1, dropped: 0 });
  const after = await txt(m, "conv:s9:2026-10-14"); assert.match(after, /I like tea/); assert.doesNotMatch(after, /teal/, "the excluded turn (the secrets sweep) is out of the day's document");
  R.sql.exec("DELETE FROM turns WHERE id='c2'"); const rw2 = await R.hsConvRewrite(["conv:s9:2026-10-14"], ["c1"]); assert.deepEqual(rw2, { rewritten: 0, dropped: 1 }); assert.ok(!(await has(m, "conv:s9:2026-10-14")), "nothing left: the document is deleted");
  ok("E. deletion: chat (conversation documents and task card, queued writes), note, file, a rewrite of the day's document, an empty one is deleted");
}

// ================= F. the rebuild =================
async function seedRich(m) {
  const { R } = m; await R.hsNames();
  m.notes.set("n1", { id: "n1", content: "I prefer HTML", author_type: "human", sec: "how", created: 100, status: "current" }); m.notes.set("n2", { id: "n2", content: "Dana is my sister", author_type: "agent", sec: "people", created: 200, status: "current" });
  channelSkillsInit(R.sql); R.sql.exec("INSERT INTO channel_skills (slug, description, body, created, updated) VALUES ('weekly','Use when asked','# W\nstep',10,20)");
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','Trip',50,50,1)"); R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s2','Empty',60,60,1)");
  R.todoSave("s1", [{ id: "1", text: "Pack", status: "todo", by: "helper", at: 1 }], 1, 0, 2);
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f1', 500, 'plan.docx', 'x', 100, 'k1', 'upload', NULL, NULL, 0, 0)");
  R.sql.exec("CREATE TABLE IF NOT EXISTS file_sidecars (file_id TEXT PRIMARY KEY, src_key TEXT, status TEXT, v INTEGER, kind TEXT, key TEXT, vec_key TEXT, bytes INTEGER, tokens INTEGER, card TEXT, outline TEXT, notes TEXT, error TEXT, cost_nano INTEGER, ms INTEGER, queued_at INTEGER, at INTEGER)");
  m.R2.set("k1.sidecar.json", JSON.stringify({ md: "# Plan\nWe fly May 3." })); R.sql.exec("INSERT INTO file_sidecars (file_id, src_key, status, kind, key) VALUES ('f1','k1','ready','doc','k1.sidecar.json')");
  // The fixture turns must not depend on the time of day the test runs. A conversation document is one per task and local day, and t2 is an hour after t1, so a base
  // taken from the clock fell on the other side of local midnight when the test ran between 23:00 and 24:00 in Los Angeles (06:00 to 07:00 UTC) and s1 got three
  // documents instead of two. The base is now noon in the person's zone, 30 days back, so t1, t2 and the turn added during the rebuild share one local day.
  const base = dayRange(dayKey(Date.now() - 30 * 86400e3, "America/Los_Angeles"), "America/Los_Angeles").start + 12 * 3600e3; addTurn(R, { id: "t1", at: base, user: "I'm allergic to peanuts", reply: "Noted.", session: "s1", ms: 4000 }); addTurn(R, { id: "t2", at: base + 3600e3, user: "Book flights", reply: "On it", session: "s1", notes: "- searched" });
  addTurn(R, { id: "t3", at: base + 2 * 86400e3, user: "next day question", reply: "answer", session: "s1" }); addTurn(R, { id: "t4", at: base, user: "other chat", reply: "ok", session: "s2" }); addTurn(R, { id: "t5", at: base, user: "weekly", reply: "done", session: null, wf: 4, kind: "workflow" });
  R.sql.exec("CREATE TABLE IF NOT EXISTS work_log_partial (turn TEXT PRIMARY KEY, at INTEGER, session TEXT, text TEXT)"); R.sql.exec("INSERT INTO work_log_partial (turn, at, session, text) VALUES ('t3', 1, 's1', 'Unfinished work: lookups')");
  m.R2.set("t/t1/bee/live/main/s1/s1.json", JSON.stringify({ source: "bee", task: "s1", session: 1, started_at: base, utterances: [{ at: base, speaker: "Sam", text: "standup start" }, { at: base + 1000, speaker: "Unknown", text: "ok" }] })); m.R2meta.set("t/t1/bee/live/main/s1/s1.json", base + 5);
  m.people.push({ id: "p1", name: "Dana Lee", rel: "Your sister", created: 1, updated: 2, facts: [] });
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s3','Nothing yet',70,70,1)"); await m.flush();
}
async function runToEnd(m, { max = 200 } = {}) {
  for (let i = 0; i < max; i++) { const s = m.R.hsRb(); if (s.status !== "running") return s; s.retry_at = 0; m.R.hsRbSave(s); await m.R.hsRebuildAlarm(); }
  throw new Error("the rebuild did not finish: " + JSON.stringify(m.R.hsRb()).slice(0, 400));
}
{
  const m = mkRes({ bee: [{ id: 9, lines: [{ at: Date.now() - 20 * 86400e3, speaker: "wearer", is_user: true, text: "call the dentist" }], at: Date.now() - 20 * 86400e3, address: "Elm", summary: "Calls", started: "a", ended: "b" }],
    inbox: [{ id: "i1", kind: "reminder", text: "Call the dentist", status: "open", confidence: "captured", needs_review: false, source_at: Date.now() - 20 * 86400e3, source_id: "9", evidence: [], attribution: { is_user: true } }] });
  const { R } = m; await seedRich(m);
  R.sql.exec("CREATE TABLE IF NOT EXISTS live_notes (session TEXT PRIMARY KEY, st TEXT NOT NULL, updated INTEGER NOT NULL)"); R.sql.exec("INSERT INTO live_notes (session, st, updated) VALUES ('s1', '{\"status\":\"live\"}', 1)"); let rewound = 0; R.lnStub = () => ({ hsLiveRewind: async () => { rewound++; return { task: "s1", n: 2 }; } });
  const st = await R.hsRebuild("start"); assert.equal(st.started, true); assert.equal(st.status, "running"); assert.ok(m.alarms.length > 0, "the alarm is armed");
  assert.equal((await R.hsRebuild("start")).error.includes("already running"), true, "a second start is refused");
  // a write during the rebuild goes to the outbox (and a delete takes its queued writes out)
  const mid = await R.hsPut([{ document_id: "note:n9", content: "written during the rebuild", at: 1, strategy: "note", tags: ["source:note"], update_mode: "replace" }]); assert.deepEqual(mid, { queued: 1 }); assert.equal(R.hsOutboxCount(), 1);
  await R.hsDropDocs(["note:gone"]); R.sql.exec("INSERT INTO hs_outbox (doc, item, del, paid, at) VALUES ('note:gone','{\"document_id\":\"note:gone\",\"content\":\"x\"}',0,1,1)"); await R.hsDropDocs(["note:gone"]); assert.equal(R.sql.exec("SELECT COUNT(*) n FROM hs_outbox WHERE doc='note:gone'").one().n, 0, "a delete during the rebuild removes the document's queued writes");
  // a turn that started before the snapshot but finished (was written) during the rebuild: it comes from the outbox, and the source leaves it out, so its lines are not repeated
  const midAt = R.sql.exec("SELECT at FROM turns WHERE id='t1'").one().at + 1000; addTurn(R, { id: "mid", at: midAt, user: "queued during the rebuild please", reply: "ok mid", session: "s1" }); await R.hsTurnWrite({ turn: "mid", session: "s1", at: midAt, userText: "queued during the rebuild please", reply: "ok mid" });
  assert.ok(R.hsOutboxCount() >= 2, "the turn waits in the outbox"); assert.deepEqual(await ids(m, "conv:"), [], "and the turn is not stored yet");
  const fin = await runToEnd(m);
  assert.deepEqual(R.hsRb().live_rewound, ["s1:2"], "a running live notes session is rewound so the outbox gets all its lines"); assert.equal(rewound, 1);
  const all = await ids(m), convDocs = all.filter((d) => d.startsWith("conv:"));
  const midDocs = []; for (const d of convDocs) if ((await txt(m, d)).includes("queued during the rebuild")) midDocs.push(d); assert.equal(midDocs.length, 1); assert.equal((await txt(m, midDocs[0])).split("queued during the rebuild").length - 1, 1, "once, not twice");
  assert.equal(fin.status, "done", JSON.stringify(fin.error)); assert.equal(fin.phase, "done");
  const rows = rowDocs(m), last2 = rows.slice(-2).map((d) => d.slice(0, 7)); assert.deepEqual(last2, ["note:n9", "conv:s1"], "what was written during the rebuild comes last, from the outbox");
  const order = ["note:", "skill:", "task:", "file:", "conv:", "live:", "bee:conv:", "contact:", "inbox:"], pos = (d) => order.findIndex((p) => d.startsWith(p)), firsts = [...new Set(rows.slice(0, -2))].map(pos);
  assert.deepEqual(firsts, [...firsts].sort((a, b) => a - b), "notes, skills, task cards, files, conversations, live notes, Bee, contacts, inbox: in that order"); assert.ok(firsts.every((p) => p >= 0));
  assert.equal(convDocs.length, 4, "conv: s1 (two days), s2, run-4");
  assert.ok((await Promise.all(["note:n1", "note:n2", "skill:weekly", "task:s1", "file:f1", "live:s1:s1", "bee:conv:9", "contact:p1", "inbox:i1", "note:n9"].map((d) => has(m, d)))).every(Boolean), "every kind is in the memory, and the write made during the rebuild was flushed");
  assert.ok((await has(m, "task:s2")) && (await has(m, "task:s3")), "every task has a card (s2 has turns, s3 has none)");
  const s1 = convDocs.filter((d) => d.startsWith("conv:s1:")).sort(), day1 = await txt(m, s1[0]); assert.match(day1, /peanuts/); assert.match(day1, /ok mid/, "the day, then the turn that came from the outbox");
  assert.match(await txt(m, s1.at(-1)), /\(unfinished\)/, "an unfinished turn is an entry of the day's document");
  assert.deepEqual(fin.report.mismatched, [], "document counts match what was sent"); assert.equal(fin.report.counts.notes.in_memory >= 2, true); assert.equal(fin.report.counts.conv.in_memory, 4); assert.equal(fin.report.counts.conv.sent, 4); assert.equal(fin.report.counts.bee.in_memory, 1);
  assert.equal(R.hsRebuilding(), false, "the rebuilding mark is cleared"); assert.equal(R.hsOutboxCount(), 0);
  assert.equal(m.d1.prepare("SELECT status FROM hs_rebuild_runs WHERE bank=?").get(m.bank).status, "done", "the state is in D1 for the ops path");
  // a rerun from scratch is safe: the same documents, and no turn twice
  const before = new Map(await Promise.all(all.filter((d) => !d.startsWith("conv:") && d !== "note:n9").map(async (d) => [d, await txt(m, d)])));
  await R.hsRebuild("start"); await runToEnd(m);
  assert.deepEqual((await ids(m)).sort(), all.sort(), "a second full run gives the same documents");
  for (const [d, t] of before) assert.equal(await txt(m, d), t, `${d} is the same after the second run`);
  const again = []; for (const d of (await ids(m, "conv:s1:"))) again.push((await txt(m, d)).split("queued during the rebuild").length - 1); assert.equal(again.reduce((a, b) => a + b, 0), 1, "the turn is in the memory once");
  ok("F1. rebuild: oldest first in the documented order, a write made meanwhile waits and is flushed last, counts verified, rerun safe");
}
{
  // the cursor is saved before each batch; a crash in the middle resumes the same batch and nothing is stored twice
  const m = mkRes(); const { R } = m; await seedRich(m); for (let i = 0; i < 25; i++) m.notes.set(`x${i}`, { id: `x${i}`, content: `note number ${i}`, author_type: "human", sec: "now", created: 1000 + i, status: "current" });
  R._rbUnits = 2; await R.hsRebuild("start"); await R.hsRebuildAlarm();   // the reset and the first batch
  const s1 = R.hsRb(); assert.equal(s1.phase, "send"); assert.ok(s1.sent.items > 0);
  // the second batch fails after its cursor was saved
  m.fail(503); s1.retry_at = 0; R.hsRbSave(s1); const before = R.hsRb(); const cursorBefore = JSON.stringify([before.kind, before.after]);
  await R.hsRebuildAlarm(); const mid = R.hsRb(); assert.equal(mid.status, "running"); assert.equal(mid.tries, 1, "a failed batch is retried with a back off"); assert.ok(mid.retry_at > Date.now(), "the retry waits"); assert.ok(mid.error.includes("503"));
  assert.equal(JSON.stringify([mid.kind, mid.after]), cursorBefore, "the cursor still points at the batch that failed: it is sent again"); assert.ok(mid.next, "the end of the batch was saved before it was sent");
  // "restart": a new Resident object on the same storage (a deploy), then resume
  const R2 = new Resident(R.ctx, R.env); R2.archive = R.archive; assert.equal(R2.hsRb().status, "running", "the state survives a restart"); assert.ok(R2.hsRebuildNext() >= mid.retry_at - 1);
  R2._rbUnits = 2; const mm = { ...m, R: R2 };
  const s2 = R2.hsRb(); s2.retry_at = 0; R2.hsRbSave(s2); await R2.hsRebuildAlarm();
  // a lost save of the cursor (a crash right after a batch was stored): the batch is sent again, and nothing doubles
  const saved = R2.get("hs_rb"); R2.hsRbSave(R2.hsRb()); await R2.hsRebuildAlarm(); R2.put("hs_rb", saved);
  const fin = await runToEnd(mm); assert.equal(fin.status, "done", JSON.stringify(fin.error));
  const noteDocs = await ids(m, "note:"); assert.equal(noteDocs.length, 27, "all 27 notes, once each"); assert.ok((await Promise.all(noteDocs.map((d) => facts(m, d)))).every((n) => n === 1), "one fact each");
  assert.deepEqual(fin.report.mismatched, []);
  ok("F2. rebuild: cursor saved before each batch, a failed batch is retried, a restart resumes from the cursor, no document is stored twice");
}
{
  // pause stops after the current batch and resume goes on; a delete during the rebuild is not sent
  const m = mkRes(); const { R } = m; await seedRich(m); for (let i = 0; i < 45; i++) m.notes.set(`y${i}`, { id: `y${i}`, content: `note ${i}`, author_type: "human", sec: "now", created: 2000 + i, status: "current" });
  R._rbUnits = 2; await R.hsRebuild("start"); await R.hsRebuildAlarm(); assert.equal(R.hsRb().phase, "send"); R._rbUnits = 1;   // the reset and one batch
  const p = await R.hsRebuild("pause"); assert.equal(p.pausing, true); await R.hsRebuildAlarm(); assert.equal(R.hsRb().status, "paused", "paused after the current batch"); const n0 = X.calls.length; await R.hsRebuildAlarm(); assert.equal(X.calls.length, n0, "nothing is sent while paused"); assert.equal(R.hsRebuildNext(), null, "no alarm while paused");
  assert.equal(R.hsRebuilding(), true, "a paused rebuild still queues writes");
  m.notes.delete("y44"); await R.hsDropDocs(["note:y44"]);   // a note that was not sent yet is deleted during the rebuild: its record is gone, so it is never sent
  m.notes.delete("y0"); await R.hsDropDocs(["note:y0"]);   // one that was already sent is deleted by the delayed re-delete (hs_forget)
  assert.equal(R.hsRb().dropped, 2, "counted for the report");
  const rs = await R.hsRebuild("resume"); assert.equal(rs.resumed, true);
  R._rbUnits = 4; const fin = await runToEnd(m); assert.equal(fin.status, "done", JSON.stringify(fin.error)); assert.ok(!(await has(m, "note:y44")), "a note deleted before it was sent is never stored");
  m.d1.exec("UPDATE hs_forget SET due=0"); const { hsForgetDue } = await import("../src/deletion.js"); await hsForgetDue(R.env); assert.ok(!(await has(m, "note:y0")), "one that had been stored is removed by the delayed re-delete");
  assert.deepEqual(fin.report.mismatched, [], "the deleted documents explain the difference in the count");
  ok("F3. rebuild: pause after the batch, resume, a delete during the rebuild");
}
{
  // a rebuild can fail for good, and resume continues; flush order keeps appends after the rebuilt document
  const m = mkRes(); const { R } = m; await seedRich(m); R._rbUnits = 1; await R.hsRebuild("start");
  await R.hsRebuildAlarm(); m.fail(503, false);
  for (let i = 0; i < 12; i++) { const s = R.hsRb(); if (s.status !== "running") break; s.retry_at = 0; R.hsRbSave(s); await R.hsRebuildAlarm(); }
  assert.equal(R.hsRb().status, "failed", "after 8 failed tries the job stops and says why"); assert.equal(R.hsRebuildNext(), null); assert.equal(R.hsRebuilding(), true, "writes keep queueing, nothing is lost");
  const mid = await R.hsPut([turnLike("conv:s1:2099-01-01", "late write")]); assert.deepEqual(mid, { queued: 1 }); m.heal();
  R._rbUnits = 12; await R.hsRebuild("resume"); const fin = await runToEnd(m); assert.equal(fin.status, "done"); assert.match(await txt(m, "conv:s1:2099-01-01"), /late write/, "the queued append was stored after the rebuild");
  assert.equal((await R.hsRebuild("pause")).error.includes("nothing to pause"), true); assert.equal((await R.hsRebuild("resume")).error.includes("nothing to resume"), true); assert.match((await R.hsRebuild("bogus")).error, /cmd must be/);
  function turnLike(doc, text) { return { document_id: doc, content: [{ speaker: "Sam (user)", time: "t", text }], at: 5, strategy: "chat", tags: ["source:chat"], update_mode: "append", key: "k" }; }
  ok("F4. rebuild: stops after 8 failed tries with the error, keeps queueing writes, resume finishes and the queued append lands after the rebuilt document");
}

// ================= G. the estimate and the admin path =================
{
  const m = mkRes({ bee: [{ id: 9, lines: [{ at: 1, speaker: "wearer", is_user: true, text: "x".repeat(600) }], at: 1, address: "", summary: "", started: "a", ended: "b" }] }); const { R } = m; await seedRich(m);
  m.R2.set("k1.sidecar.json", JSON.stringify({ md: "w".repeat(70000) }));   // a long file: reference, no model
  const calls0 = X.calls.length, docs0 = await ids(m); const e = await R.hsRebuild("estimate");
  assert.equal(X.calls.length, calls0, "the estimate calls no model"); assert.deepEqual(await ids(m), docs0, "and stores nothing"); assert.equal(R.hsRb().status, "idle");
  assert.equal(e.characters.reference, 70000 + 0, "a long file is counted under reference"); assert.ok(e.characters.chat > 0 && e.characters.note > 0 && e.characters["raw-transcript"] >= 600, "a Bee recording is counted as raw chunks, not extraction");
  assert.ok(e.extraction_nano > 0); assert.equal(e.extraction_usd, Number((e.extraction_nano / 1e9).toFixed(6)));
  assert.equal(e.documents.notes, 2); assert.equal(e.documents.files, 1); assert.equal(e.documents.conv, 4); assert.equal(e.documents.bee, 1); assert.equal(e.documents.contacts, 1); assert.ok(e.extraction_calls >= 10);
  const w = mkRes({ channel: "work" }); await seedRich(w); const ew = await w.R.hsRebuild("estimate"); assert.equal(ew.documents.bee, undefined, "a project channel has no Bee, contacts or inbox");
  assert.deepEqual(kindsFor("main").slice(-3), ["bee", "contacts", "inbox"]); assert.deepEqual(kindsFor("work"), ["notes", "skills", "tasks", "files", "conv", "live"]);
  ok("G1. estimate: characters per strategy, reference unpriced, meter applied, nothing written");
}

{
  // the admin path: dry run is the default, two at a time, one account by slug, ops key and dev only
  const stubs = new Map(), starts = [];
  const env = { ENV_NAME: "dev", HS_WRITERS: "on", HS_FOUNDATIONS: "on", DB,
    ARCHIVE: { idFromName: (n) => n, get: (n) => ({ channels: async () => ["main", "work", "home", "dm1"].map((s, i) => ({ id: i + 1, slug: s, name: s, kind: s === "dm1" ? "dm" : "channel" })) }) },
    RESIDENT: { idFromName: (n) => n, get: (n) => ({ bind: async () => true, hsRebuild: async (cmd) => { if (cmd === "estimate") return { documents: { notes: 1 }, extraction_usd: 0.001, extraction_calls: 2 }; if (cmd === "start") { starts.push(n); d1.prepare("INSERT OR REPLACE INTO hs_rebuild_runs (bank, tenant, channel, status, updated_at) VALUES (?,?,?,?,?)").run(`dev-t1-${n.split(":")[2]}`, "t1", n.split(":")[2], "running", Date.now()); return { started: true }; } return { status: "running", cmd }; } }) } };
  d1.exec("CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT); DELETE FROM hs_rebuild_runs;");
  const dry = await hsRebuildAdmin(env, "start", { slug: "ck1" }); assert.equal(dry.dry, true); assert.ok(dry.results.every((r) => r.status === "would start"), "dry run by default"); assert.equal(starts.length, 0); assert.deepEqual(dry.results.map((r) => r.channel), ["main", "work", "home"], "direct messages are left out");
  const go = await hsRebuildAdmin(env, "start", { slug: "ck1", dry: false, limit: 10 }); assert.deepEqual(go.results.map((r) => r.status), ["started", "started", "waiting: two banks are already rebuilding"], "at most two at a time"); assert.equal(starts.length, 2); assert.equal(go.running_now, 2);
  const again = await hsRebuildAdmin(env, "start", { slug: "ck1", dry: false }); assert.equal(again.results.filter((r) => r.status === "started").length, 0, "two are running: nothing more starts"); assert.ok(again.results.some((r) => /already running/.test(r.status)));
  d1.prepare("UPDATE hs_rebuild_runs SET status='done', version=? WHERE channel='main'").run(REBUILD_VERSION); const next = await hsRebuildAdmin(env, "start", { slug: "ck1", dry: false }); assert.deepEqual(next.results.map((r) => [r.channel, r.status]), [["main", "already done"], ["work", "already running"], ["home", "started"]], "a finished bank is not started again, a slot is free");
  d1.prepare("INSERT OR REPLACE INTO hs_rebuild_runs (bank, tenant, channel, status, updated_at) VALUES ('dev-t1-old','t1','old','running',?)").run(1); assert.equal((await hsRebuildAdmin(env, "status", {})).running, 2, "a row that says running but is hours old is a dead job and does not use a slot"); d1.prepare("DELETE FROM hs_rebuild_runs WHERE bank='dev-t1-old'").run();
  const stat = await hsRebuildAdmin(env, "status", {}); assert.equal(stat.running, 2); assert.ok(stat.banks.every((b) => !b.bank.includes("t1")), "bank ids are shown in the short form");
  const est = await hsRebuildAdmin(env, "estimate", { slug: "ck1", limit: 2 }); assert.equal(est.results.length, 3); assert.equal(est.next_offset, null, "one account, all its channels"); assert.equal(est.extraction_usd_this_page, 0.003);
  assert.match((await hsRebuildAdmin(env, "estimate", { slug: "nobody" })).error, /no such workspace/); assert.match((await hsRebuildAdmin(env, "zap", {})).error, /action must be/); assert.deepEqual(await hsRebuildAdmin({ ...env, HS_WRITERS: "off" }, "start", {}), { error: "HS_WRITERS is off" }); assert.equal((await hsRebuildAdmin({ ...env, ENV_NAME: "live" }, "start", {})).error, "dev only");
  const test = await hsRebuildAdmin(env, "estimate", { onlyTest: true, limit: 1 }); assert.equal(test.accounts_processed, 1, "only_test picks accounts with an @example.com owner");
  // every call does a bounded amount of work: accounts are paged, status reads D1 only, a slow Resident cannot stall the call
  { const d2 = new DatabaseSync(":memory:"); d2.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT); CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT);");
    for (let i = 0; i < 60; i++) { d2.prepare("INSERT INTO tenants VALUES (?,?,?)").run(`t${String(i).padStart(2, "0")}`, `ck${String(i).padStart(2, "0")}`, `u${i}`); d2.prepare("INSERT INTO users VALUES (?,?)").run(`u${i}`, i < 50 ? `chk+${i}@example.com` : `real${i}@x.com`); }
    d2.prepare("INSERT INTO hs_rebuild_runs (bank, tenant, channel, status, phase, updated_at, summary) VALUES ('dev-t00-main','t00','main','running','send',?,'{\"sent\":5}')").run(Date.now());
    const DB2 = { prepare: (q) => { const st = d2.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
    const cnt = { archive: 0, resident: 0, rbCalls: [] }; let slow = false;
    const env3 = { ENV_NAME: "dev", HS_WRITERS: "on", HS_FOUNDATIONS: "on", DB: DB2, ARCHIVE: { idFromName: (n) => n, get: () => ({ channels: async () => { cnt.archive++; return ["main", "work", "home"].map((s, i) => ({ id: i, slug: s, name: s })); } }) },
      RESIDENT: { idFromName: (n) => n, get: () => { cnt.resident++; return { bind: async () => true, hsRebuild: async (cmd) => { cnt.rbCalls.push(cmd); if (slow) return new Promise(() => {}); return cmd === "estimate" ? { documents: {}, extraction_usd: 0.001 } : cmd === "start" ? { started: true } : { status: cmd }; } }; } } };
    const big = await hsRebuildAdmin(env3, "estimate", { onlyTest: true, limit: 1000 }); assert.equal(big.accounts_processed, 5, "at most 5 accounts per call, whatever limit asks for"); assert.equal(cnt.archive, 5); assert.equal(big.next_offset, 5, "paged by account"); assert.equal(big.results.length, 15);
    const pg2 = await hsRebuildAdmin(env3, "estimate", { onlyTest: true, limit: 5, offset: big.next_offset }); assert.equal(pg2.results[0].slug, "ck05", "the next page starts where the last ended"); assert.equal(cnt.archive, 10);
    let last = await hsRebuildAdmin(env3, "estimate", { onlyTest: true, limit: 5, offset: 45 }); assert.equal(last.next_offset, null, "the last page of 50 test accounts"); assert.equal(last.accounts_processed, 5);
    cnt.archive = cnt.resident = 0; cnt.rbCalls.length = 0;
    const st = await hsRebuildAdmin(env3, "status", {}); assert.equal(st.running, 1); assert.equal(st.banks[0].summary.sent, 5); assert.deepEqual([cnt.archive, cnt.resident], [0, 0], "status without a slug reads D1 only");
    const st1 = await hsRebuildAdmin(env3, "status", { slug: "ck00", channel: "main" }); assert.equal(st1.banks.length, 1); assert.deepEqual([cnt.archive, cnt.resident], [0, 0], "status for one bank reads D1 only too");
    assert.match((await hsRebuildAdmin(env3, "status", { live: true })).error, /needs slug and channel/);
    const stl = await hsRebuildAdmin(env3, "status", { slug: "ck00", channel: "main", live: true }); assert.equal(stl.results.length, 1, "live=1 asks one Resident"); assert.equal(cnt.resident, 1);
    cnt.archive = cnt.resident = 0; cnt.rbCalls.length = 0;
    const s2 = await hsRebuildAdmin(env3, "start", { onlyTest: true, limit: 2, dry: false }); assert.equal(cnt.rbCalls.filter((c) => c === "start").length, 1, "one slot is free (one runs): one start"); assert.equal(cnt.rbCalls.includes("estimate"), false, "start never walks a source"); assert.ok(cnt.archive <= 2 && cnt.resident <= 6);
    // a Resident that never answers cannot stall the call
    slow = true; const t0 = Date.now(), sl = await hsRebuildAdmin(env3, "estimate", { onlyTest: true, limit: 5, budgetMs: 400 }); assert.ok(Date.now() - t0 < 2500, "answers within the budget even when a Resident hangs"); assert.ok(sl.partial && sl.next_offset != null, "and says where to continue"); assert.ok(sl.results.some((r) => r.status === "error" || /not reached/.test(r.status)));
    const clock = (() => { let t = 0; return () => (t += 9000); })(); const ck = await hsRebuildAdmin(env3, "estimate", { onlyTest: true, limit: 5, now: clock, budgetMs: 25000 }); assert.ok(ck.accounts_processed < 5 && ck.partial, "the time budget stops the walk between accounts");
  }
  ok("G2. admin path: dry run by default, direct messages skipped, two banks at a time, finished banks skipped, one account by slug, short bank ids");
}


// ================= H. the secrets sweep rewrites conversation documents =================
{
  const m = mkRes(); const { R } = m; await R.hsNames();
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','T',1,1,1)");
  for (const [id, at, u, r] of [["h1", T1, "my favorite color is teal", "noted teal"], ["h2", T1 + 60e3, "I like tea", "nice"], ["h3", T1 + 120e3, "the wifi password is Tulip-2219", "I won't keep that"]]) { addTurn(R, { id, at, user: u, reply: r, session: "s1" }); await R.hsTurnWrite({ turn: id, session: "s1", at, userText: u, reply: r }); }
  assert.match(await txt(m, "conv:s1:2026-10-14"), /teal/);
  // the secrets sweep: the turn's document is written again from scrubbed text (the whole day is not deleted)
  assert.doesNotMatch(await txt(m, "conv:s1:2026-10-14"), /Tulip-2219/, "never in the memory to begin with"); m.d1.exec("UPDATE mem SET payload=replace(payload,'I won''t keep that','my password is Tulip-2219') WHERE doc='conv:s1:2026-10-14'");
  const dry = await sweepSecretsLocal(R, { dry: true, channelId: 1 }); assert.ok(dry.chat_turns_with_secrets >= 1); assert.ok(dry.memory_docs >= 1);
  await sweepSecretsLocal(R, { dry: false, channelId: 1 }); assert.ok(await has(m, "conv:s1:2026-10-14"), "a document with a secret is rewritten, not deleted"); assert.doesNotMatch(await txt(m, "conv:s1:2026-10-14"), /Tulip-2219/);
  // a failed rewrite falls back to deleting the documents (forgetDocument now, hs_forget row for the delayed re-delete); a good rewrite deletes nothing
  { const m2 = mkRes(); const { R: R2 } = m2; await R2.hsNames(); R2.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','T',1,1,1)");
    for (const [id, at, u, r] of [["z1", T1, "my favorite color is teal", "teal noted"], ["z2", T1 + 60e3, "I like tea", "nice"]]) { addTurn(R2, { id, at, user: u, reply: r, session: "s1" }); await R2.hsTurnWrite({ turn: id, session: "s1", at, userText: u, reply: r }); }
    const doc = "conv:s1:2026-10-14"; assert.ok(await has(m2, doc)); m2.d1.exec("DELETE FROM hs_forget");
    const good = await rewriteOrDelete(R2, [doc], ["z1"]); assert.deepEqual(good, { rewritten: 1, deleted: 0, fellBack: false }); assert.ok(await has(m2, doc), "rewrite succeeded: the document stays"); assert.equal(m2.dues().length, 0, "no hs_forget row");
    // the memory refuses the rewrite (a server error: hsPut queues it): the document is deleted instead, and its queued rewrite is taken out of the outbox
    m2.fail(503); const bad = await rewriteOrDelete(R2, [doc], ["z1"]);
    assert.deepEqual(bad, { rewritten: 0, deleted: 1, fellBack: true }); assert.ok(!(await has(m2, doc)), "rewrite failed: the document is deleted"); assert.ok(m2.dues().includes(doc), "with an hs_forget row for the delayed re-delete"); assert.equal(R2.hsOutboxCount(), 0, "the queued rewrite is gone, so the forgotten text cannot come back");
    // the rewrite throws outright: same fallback
    await R2.hsTurnWrite({ turn: "z3", session: "s1", at: T1 + 120e3, userText: "tea again", reply: "ok" }); R2.hsConvRewrite = async () => { throw new Error("boom"); };
    assert.deepEqual(await rewriteOrDelete(R2, [doc], []), { rewritten: 0, deleted: 1, fellBack: true }); assert.ok(!(await has(m2, doc)));
    // and when the delete fails too the error is returned, not hidden
    R2.hsDropDocs = async () => { throw new Error("down"); }; assert.equal((await rewriteOrDelete(R2, [doc], [])).error, "down"); }
  ok("H. the secrets sweep: the day's conversation document is written again without the secret");
}

// ================= I. the Archive: noteRow and noteRows (read by the writers and the rebuild) =================
{
  const db = new DatabaseSync(":memory:"), mk = (dbx) => ({ exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dbx.exec(q); return { toArray: () => [], one: () => undefined }; } const st = dbx.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });
  const A = new Archive({ storage: { sql: mk(db), transactionSync: (f) => f() } }, { DB });
  await A.provisionFresh(); const ids = []; for (let i = 0; i < 5; i++) { const r = await A.noteAdd("1", "now", `note ${i}`, i % 2 ? "agent" : "human"); ids.push(r.id); await new Promise((z) => setTimeout(z, 3)); }
  assert.equal((await A.noteRow("1", ids[2])).content, "note 2"); assert.equal(await A.noteRow("2", ids[2]), null, "another channel's id is not there"); assert.equal(await A.noteRow("1", "nope"), null);
  await A.noteEdit("1", ids[1], "edited"); assert.equal((await A.noteRow("1", ids[1])).content, "edited");
  const p1 = await A.noteRows("1", "", 2); assert.deepEqual(p1.rows.map((r) => r.content), ["note 0", "edited"]); assert.equal(p1.done, false);
  const p2 = await A.noteRows("1", p1.next, 2); assert.deepEqual(p2.rows.map((r) => r.content), ["note 2", "note 3"]); const p3 = await A.noteRows("1", p2.next, 2); assert.deepEqual(p3.rows.map((r) => r.content), ["note 4"]); assert.equal(p3.done, true);
  assert.equal((await A.noteRows("1", "", 50, 0)).rows.length, 0, "records after the snapshot are not in the source");
  await A.reflectionSet("How to work with Sam"); assert.ok(!(await A.noteRows("1", "", 50)).rows.some((r) => r.src === "reflection"), "the nightly reflection is not a source");
  await A.noteDelete("1", ids[0]); assert.equal(await A.noteRow("1", ids[0]), null);
  ok("I. Archive: noteRow and noteRows (paged oldest first, snapshot cut, the nightly reflection and deleted notes left out)");
}

// ================= J. live notes: the transcript goes out on its own cadence and a deploy never writes twice =================
{
  const db = new DatabaseSync(":memory:"), sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; } const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const sent = []; let failNext = false;
  const env = { HS_WRITERS: "on", HS_FOUNDATIONS: "on", DB, LEDGER: {}, RESIDENT: {} }, ln = new LiveNotes({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} } }, env);
  ln.put("tenant", "t1"); ln.put("channel", "main"); ln.put("task", "s1"); ln.put("n", "1"); ln.setS(1, { n: 1, started_at: T1, source: "bee" });
  ln.res = () => ({ hsLiveAppend: async (x) => { if (failNext) { failNext = false; throw new Error("resident reset"); } sent.push(x); return { sent: 1 }; } });
  const add = (n, text, at) => sql.exec("INSERT INTO utts (n, conv, uid, at, speaker, text) VALUES (?,?,?,?,?,?)", n, 1, `u${at}`, at, "Sam", text);
  add(1, "short line", T1 + 1000); assert.equal(await ln.hsLivePush(1), 0, "a few words wait (under 240 characters)");
  add(1, "w".repeat(260), T1 + 2000); assert.equal(await ln.hsLivePush(1), 2, "240 characters and 60 seconds since the last send: sent"); assert.equal(sent.length, 1); assert.equal(sent[0].rows.length, 2); assert.equal(sent[0].key, "1:2");
  add(1, "another", T1 + 3000); assert.equal(await ln.hsLivePush(1), 0, "nothing again within 60 seconds");
  add(1, "z".repeat(1300), T1 + 4000); failNext = true; await assert.rejects(() => ln.hsLivePush(1), /resident reset/); assert.equal(ln.get("hs_to_1"), "4", "the range is saved before the send"); add(1, "late line", T1 + 5000);
  assert.equal(await ln.hsLivePush(1), 2, "the same range is sent again (rows 3 and 4), not a newer one"); assert.equal(sent.at(-1).key, "1:4", "so the operation id is the same"); assert.equal(await ln.hsLivePush(1, { final: true }), 1, "the end of the session sends everything left"); assert.equal(sent.at(-1).rows[0].text, "late line");
  assert.equal(await ln.hsLivePush(1, { final: true }), 0, "and then nothing is left");
  assert.equal(await ln.hsLiveRewind(), null, "not live: nothing to rewind"); ln.put("status", "live"); assert.deepEqual(await ln.hsLiveRewind(), { task: "s1", n: 1 }); const rb = sent.length; assert.equal(await ln.hsLivePush(1, { final: true }), 5, "after a rewind every line is sent again (the rebuild deleted the bank they were in)"); assert.equal(sent.length, rb + 1);
  const off = new LiveNotes({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} } }, { ...env, HS_WRITERS: "off" }); assert.equal(await off.hsLivePush(1, { final: true }), 0, "flag off: nothing");
  ok("J. live notes: chunks on a cadence, the range saved before the send, a failed send sends the same range again, a final flush, flag off");
}

// ================= K. Bee: the voice inbox reconcile, the conversation write, the source for the rebuild =================
{
  const db = new DatabaseSync(":memory:"), sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; } const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const calls = [], R = { bind: async () => true, hsInboxPut: async (items) => { calls.push(["put", items.map((i) => `${i.id}:${i.status}`)]); return { sent: items.length }; }, hsDrop: async (docs) => { calls.push(["drop", docs]); return docs.length; }, hsBeePut: async (x) => { calls.push(["bee", x.id, x.lines.length, x.summary]); return { sent: 1 }; } };
  const O = new Map([["archive:t1", { channels: async () => [{ id: 7, slug: "main" }] }]]), WS = new Map();
  const env = { HS_WRITERS: "on", HS_FOUNDATIONS: "on", MEMORY_INDEX: {}, AI: {}, ENV_NAME: "dev", DB, LEDGER: {}, ARCHIVE: { idFromName: (n) => n, get: (n) => O.get(n) }, RESIDENT: { idFromName: (n) => n, get: () => R },
    WS: { put: async (k, v) => { WS.set(k, typeof v === "string" ? v : new TextDecoder().decode(v)); }, get: async (k) => WS.has(k) ? { text: async () => WS.get(k) } : null, head: async () => null, delete: async () => {} } };
  const bs = new BeeSync({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} } }, env); bs.put("tenant", "t1"); bs.put("status", "active");
  const ins = (id, source_id, data, { src = source_id } = {}) => { db.prepare("INSERT OR IGNORE INTO ambient_sources (source, source_id, revision, source_at, live, ingested_at, chunks) VALUES ('bee',?,?,?,0,1,1)").run(src, "r1", T1); db.prepare("INSERT OR IGNORE INTO ambient_chunks (source, source_id, hash, ordinal, active, lines, state) VALUES ('bee',?,'h1',0,1,'[]','done')").run(src);
    db.prepare("INSERT INTO ambient_items (id, source, source_id, chunk_hash, source_at, data) VALUES (?,?,?,?,?,?)").run(id, "bee", src, "h1", T1, JSON.stringify({ id, ...data, search_text: "x" })); };
  ins("i1", "9", { kind: "task", text: "Buy milk", status: "open", confidence: "captured", needs_review: false, attribution: { is_user: true } });
  ins("i2", "9", { kind: "task", text: "Maybe call Bob", status: "open", confidence: "captured", needs_review: true });
  ins("i3", "9", { kind: "idea", text: "Learn piano", status: "open", confidence: "unverified", needs_review: false });
  const rows = bs.ambient.inboxRows("", 10).rows; assert.deepEqual(rows.map((r) => r.id), ["i1", "i2", "i3"]); assert.ok(!("search_text" in rows[0]), "the search text is not part of the item"); assert.equal(rows[0].source_id, "9");
  assert.deepEqual(bs.ambient.inboxRows("i1", 1).rows.map((r) => r.id), ["i2"], "paged by id");
  const r1 = await bs.hsInboxSync(); assert.deepEqual(r1, { sent: 1, dropped: 0 }); assert.deepEqual(calls.at(-1), ["put", ["i1:open"]], "only the confirmed item goes");
  assert.equal(await bs.hsInboxSync(), null, "nothing changed since the last pass");
  bs.put("ambient_revision", "2"); assert.deepEqual(await bs.hsInboxSync(), { sent: 0, dropped: 0 }, "a new revision with the same items sends nothing");
  db.prepare("UPDATE ambient_items SET data=? WHERE id='i1'").run(JSON.stringify({ id: "i1", kind: "task", text: "Buy milk", status: "completed", confidence: "captured", needs_review: false, attribution: { is_user: true } })); bs.put("ambient_revision", "3");
  assert.deepEqual(await bs.hsInboxSync(), { sent: 1, dropped: 0 }); assert.deepEqual(calls.at(-1), ["put", ["i1:completed"]], "a status change sends the item again (the document is replaced)");
  db.prepare("DELETE FROM ambient_items WHERE id='i1'").run(); bs.put("ambient_revision", "4"); assert.deepEqual(await bs.hsInboxSync(), { sent: 0, dropped: 1 }); assert.deepEqual(calls.at(-1), ["drop", ["inbox:i1"]], "an item that is gone loses its document");
  ins("i4", "9", { kind: "reminder", text: "Call the dentist", status: "open", confidence: "captured", needs_review: false }); bs.put("ambient_revision", "5"); await bs.hsInboxSync();
  assert.equal(await bs.hsInboxClear(), 1); assert.deepEqual(calls.at(-1), ["drop", ["inbox:i4"]], "Disconnect with the memories removed drops every inbox document");
  // a Bee conversation: the transcript lines as one document through General's Resident, the summary kept with the transcript for a rebuild
  const conv = { id: 5, start_time: T1, end_time: T1 + 600e3, short_summary: "Errands", summary: "Long summary", updated_at: 3, transcriptions: [{ realtime: false, utterances: [{ id: 1, spoken_at: T1, speaker: { is_user: true }, text: "buy milk" }, { id: 2, spoken_at: T1 + 1000, speaker: "Speaker 2", text: "ok" }] }] };
  assert.equal(beeContentOf(env, conv), "buy milk\nok", "with the flag on the content is the transcript"); assert.equal(beeContentOf({ ...env, HS_WRITERS: "off" }, conv), "", "with it off nothing is retained");
  await bs.hsBeePut(conv); assert.deepEqual(calls.at(-1), ["bee", 5, 2, "Errands"]);
  const doc = transcriptDoc(conv, true); assert.equal(doc.short_summary, "Errands"); assert.equal(transcriptDoc(conv).short_summary, undefined, "flag off: the saved transcript is as before");
  WS.set("t/t1/bee/conv/5.json", JSON.stringify(doc)); bs.sql.exec("INSERT OR REPLACE INTO convs (id, start_time, r2_key, at) VALUES (5, ?, 't/t1/bee/conv/5.json', 1)", T1); bs.sql.exec("INSERT OR REPLACE INTO convs (id, start_time, r2_key, at) VALUES (6, ?, 't/t1/bee/conv/6.json', 1)", T1 + 1);
  const src = await bs.hsBeeSource("", 10, Infinity); assert.equal(src.items.length, 1, "a conversation with no saved transcript is skipped"); assert.equal(src.items[0].summary, "Errands"); assert.equal(src.items[0].lines.length, 2); assert.equal((await bs.hsBeeSource("", 10, T1 - 1)).items.length, 0, "snapshot cut");
  ok("K. Bee: the inbox reconcile (eligible only, a status change replaces, a gone item drops, clear), the transcript write and the rebuild source");
}
console.log("  ok all");
log0("hindsight-writers: all checks passed");
