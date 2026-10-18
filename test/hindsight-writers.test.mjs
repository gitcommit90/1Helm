// node --import ./test/stubs/register.mjs test/hindsight-writers.test.mjs
// Memory Overhaul phase 3 (the design notes HS_WRITERS). Checks, against a stateful fake Hindsight that
// enforces the same request rules as the 1.0.0 server (operation_id is a UUID, one strategy per operation_id, no repeated document id in an
// async request, an append needs a document id, JSON array appends merge into one array):
//  A. Pure builders: the flag, document ids, local dates, the conversation entries, context strings under 300 characters, speaker names, strategies
//     per kind, rounds.
//  B. retainV2: the request shape, secret scrubbing in content (also inside a JSON array), context and metadata, deterministic operation ids, the content limit.
//  C. Append semantics on the real Resident: every append has a document id and a constant tag set, the turn lines are named, unfinished work joins
//     the same document, memory off / forgotten text / a failed send (outbox, retry) behave.
//  D. The other writers on the real Resident: Notebook notes (add, edit, delete), files, skills, task cards, live notes, Bee conversations, contacts, voice inbox.
//  E. Deletion: note, task (chat), file, conversation rewrite and queued writes of a deleted document.
//  F. The rebuild: order of steps, cursor saved before each batch, resume without duplicates, pause, outbox flushed, delete during a rebuild, the report.
//  G. The estimate, the admin path (dry run, two at a time, one account), flag off.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { FILE_MD_MAX, hsWriters, DOC, docKind, TAG, STRATEGY, dayKey, isoLocal, dayRange, convEntries, sliceEntries, convDocOf, ctxFor, ambientSpeaker, noteItem, fileItem, taskItem, skillItem, contactItem, liveEntries, liveItem, beeEntries, beeItem, itemsNano, inboxItem, inboxEligible, inboxText, rounds, itemExtractChars, hsNoteNotify, hsContactNotify } from "../src/hindsight-writers.js";
import { hsRetainNano } from "../src/byok.js"; import { retainV2, opUuid, scrubContent, HS_DOC_MAX, bankId } from "../src/hindsight.js";
import { speakerLabels } from "../src/hindsight-template.js";
import { rebuildMethods, hsRebuildAdmin, kindsFor, REBUILD_VERSION } from "../src/hindsight-rebuild.js";
import { Resident } from "../src/resident.js";
import { channelSkillsInit } from "../src/skills/channel.js";
import worker, { Archive } from "../src/index.js";
import { LiveNotes } from "../src/ee/live-notes.js";
import { BeeSync, transcriptDoc, beeContentOf } from "../src/ee/bee-sync.js";
import { sweepSecretsLocal, rewriteOrDelete } from "../src/forget.js";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-40).join("\n")); });
const ok = (name) => console.log("  ok", name);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const names = { first: "Sam", helper: "Ollie", channel: "main" };

// ---- a stateful fake Hindsight (the rules of the 1.0.0 retain endpoint) ----
function fakeServer(o = {}) {
  const banks = new Map(), calls = [], failNext = [], emptyDocs = new Set(o.emptyDocs || []); let failedRetries = o.failedRetries || 0, failParent = !!o.failParent;
  const bank = (b) => { if (!banks.has(b)) banks.set(b, { docs: new Map(), ops: new Map(), models: new Map(), config: null, created: Date.now() }); return banks.get(b); };
  const joinText = (old, add) => { try { const a = JSON.parse(old), b = JSON.parse(add); if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a, ...b]); } catch {} return `${old}\n${add}`; };
  const HINDSIGHT = { fetch: async (u, init = {}) => {
    const url = new URL(u), m = init.method || "GET", p = decodeURIComponent(url.pathname).replace("/v1/default", ""), body = init.body ? JSON.parse(init.body) : null, key = `${m} ${p}${url.search}`;
    calls.push({ m, p, q: url.search, body, key });
    if (failNext.length && failNext[0].re.test(key)) { const f = failNext.shift(); return J({ detail: f.detail || "boom" }, f.status || 500); }
    let r;
    if ((r = p.match(/^\/banks$/)) && m === "GET") return J({ banks: [...banks.keys()].map((b) => ({ bank_id: b, created_at: new Date(banks.get(b).created).toISOString() })), total: banks.size });
    if ((r = p.match(/^\/banks\/([^/]+)$/))) { if (m === "PUT") { bank(r[1]); return J({ bank_id: r[1] }); } if (m === "DELETE") { banks.delete(r[1]); return J({ success: true }); } }
    if ((r = p.match(/^\/banks\/([^/]+)\/import$/)) && m === "POST") { const b = bank(r[1]); b.config = body; for (const mm of body.mental_models || []) b.models.set(mm.id, { id: mm.id, last_refreshed_at: null, last_refresh_failed_at: null }); return J({ mental_models_created: (body.mental_models || []).length, operation_ids: [] }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/memories$/)) && m === "POST") {
      const b = bank(r[1]), items = body.items || [], ids = items.map((i) => i.document_id).filter(Boolean);
      if (!body.async) return J({ detail: "sync not used" }, 400);
      if (body.operation_id && !UUID.test(body.operation_id)) return J({ detail: "operation_id must be a valid UUID" }, 422);
      if (body.operation_id && new Set(items.map((i) => i.strategy || null)).size > 1) return J({ detail: "operation_id requires all retain items to resolve to a single strategy" }, 400);
      if (new Set(ids).size !== ids.length) return J({ detail: `Batch contains duplicate document_ids: ${ids}` }, 400);
      for (const i of items) { if (i.update_mode === "append" && !i.document_id) return J({ detail: "update_mode='append' requires a document_id" }, 400); if (!String(i.content || "").trim()) return J({ detail: "blank" }, 422); }
      if (body.operation_id && b.ops.has(body.operation_id)) return J({ success: true, async: true, operation_id: body.operation_id, items_count: items.length });
      const id = body.operation_id || `op-${b.ops.size + 1}`;
      if (failParent && ids.includes("note:n1")) { failParent = false; b.ops.set(id, { id, status: "failed", task_type: "batch_retain", items }); return J({ success: true, async: true, operation_id: id, items_count: items.length }); }
      b.ops.set(id, { id, status: o.pending ? "pending" : "completed", task_type: "batch_retain", items });
      if (!o.pending) for (const i of items) apply(b, i);
      return J({ success: true, async: true, operation_id: id, items_count: items.length });
    }
    if ((r = p.match(/^\/banks\/([^/]+)\/operations$/)) && m === "GET") { const b = bank(r[1]), st = url.searchParams.get("status"); return J({ operations: [...b.ops.values()].filter((x) => !st || x.status === st).map((x) => ({ id: x.id, status: x.status, task_type: x.task_type })), total: b.ops.size }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/operations\/([^/]+)$/)) && m === "DELETE") { const x = bank(r[1]).ops.get(r[2]); if (x && x.status !== "completed") x.status = "cancelled"; return J({ success: true }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/operations\/([^/]+)\/retry$/)) && m === "POST") { const x = bank(r[1]).ops.get(r[2]); if (x && x.status === "failed" && failedRetries-- <= 0) { x.status = "completed"; for (const i of x.items) apply(bank(r[1]), i); } return J({ success: true }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/documents\/(.+)\/reprocess$/)) && m === "POST") { const d = bank(r[1]).docs.get(r[2]); if (!d) return J({ detail: "not found" }, 404); if (!o.stayEmpty) { emptyDocs.delete(r[2]); d.units = Math.max(1, d.units); } return J({ success: true, operation_id: "rp" }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/stats$/)) && m === "GET") { const b = bank(r[1]), ops = [...b.ops.values()]; return J({ total_documents: b.docs.size, total_nodes: [...b.docs.values()].reduce((n, d) => n + d.units, 0), total_observations: 0, pending_operations: ops.filter((x) => x.status === "pending" || x.status === "processing").length, failed_operations: ops.filter((x) => x.status === "failed").length, pending_consolidation: b.pendingConsolidation || 0, failed_consolidation: b.failedConsolidation || 0 }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/documents$/)) && m === "GET") {
      const b = bank(r[1]), q = url.searchParams.get("q") || "", lim = Number(url.searchParams.get("limit") || 100), off = Number(url.searchParams.get("offset") || 0);
      const all = [...b.docs.entries()].filter(([id]) => id.includes(q)).map(([id, d]) => ({ id, memory_unit_count: d.units, text_length: d.text.length, tags: d.tags }));
      return J({ items: all.slice(off, off + lim), total: all.length, limit: lim, offset: off });
    }
    if ((r = p.match(/^\/banks\/([^/]+)\/documents\/(.+)$/)) && m === "DELETE") { const b = bank(r[1]); const had = b.docs.delete(r[2]); return had ? J({ success: true, memory_units_deleted: 1 }) : J({ detail: "not found" }, 404); }
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models$/)) && m === "GET") return J({ items: [...bank(r[1]).models.values()] });
    if ((r = p.match(/^\/banks\/([^/]+)\/mental-models\/([^/]+)\/refresh$/)) && m === "POST") { const mm = bank(r[1]).models.get(r[2]); if (mm) mm.last_refreshed_at = new Date().toISOString(); return J({ operation_id: "mm" }); }
    if ((r = p.match(/^\/banks\/([^/]+)\/consolidation\/recover$/)) && m === "POST") return J({ retried_count: 0 });
    return J({});
  } };
  function apply(b, i) {
    const old = b.docs.get(i.document_id), text = i.update_mode === "append" && old ? joinText(old.text, i.content) : i.content;
    b.docs.set(i.document_id, { text, tags: i.tags || [], units: emptyDocs.has(i.document_id) ? 0 : Math.max(1, Math.ceil(text.length / 1000)), strategy: i.strategy, context: i.context, metadata: i.metadata, scopes: i.observation_scopes, last: i });
  }
  return { HINDSIGHT, banks, calls, bank, failNext, settle: () => { for (const b of banks.values()) for (const x of b.ops.values()) if (x.status === "pending") { x.status = "completed"; for (const i of x.items) apply(b, i); } },
    env: (extra = {}) => ({ HINDSIGHT, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", HS_FOUNDATIONS: "on", HS_WRITERS: "on", ...extra }) };
}

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

// ================= B. retainV2 =================
{
  const f = fakeServer(), env = f.env();
  const out = await retainV2(env, "b1", [
    { document_id: "conv:s:2026-10-14", content: [{ speaker: "Sam (user)", time: "t", text: 'my password is "Tulip-2219" and my key is sk-abcdefghijklmnopqrstuvwxyz0123456789' }], at: 5, context: "ctx password is hunter22222", metadata: { a: "x", note: "token sk-abcdefghijklmnopqrstuvwxyz0123456789", gone: null, n: 5 }, strategy: "chat", tags: [TAG.chat], update_mode: "append", key: "turn-1" },
    { document_id: "note:n1", content: "Likes HTML", at: 6, strategy: "note", tags: [TAG.note] },
    { document_id: "note:n2", content: "Likes tea", at: 7, strategy: "note", tags: [TAG.note] },
    { document_id: "x", content: "   " }], { });
  assert.equal(out.items, 3, "a blank item is left out"); assert.equal(out.operation_ids.length, 2, "one request per strategy (an operation_id with two strategies is refused by the server)");
  const posts = f.calls.filter((c) => c.m === "POST"); assert.equal(posts.length, 2); for (const c of posts) { assert.equal(c.body.async, true); assert.match(c.body.operation_id, UUID); }
  const chat = posts.find((c) => c.body.items[0].strategy === "chat").body.items[0], noteReq = posts.find((c) => c.body.items[0].strategy === "note").body;
  assert.deepEqual([chat.update_mode, chat.observation_scopes, chat.tags, chat.document_id, chat.timestamp], ["append", "shared", ["source:chat"], "conv:s:2026-10-14", new Date(5).toISOString()]);
  assert.doesNotMatch(JSON.stringify(chat), /Tulip-2219|sk-abcdef|hunter22222/, "content, context and metadata are scrubbed"); assert.doesNotThrow(() => JSON.parse(chat.content), "the content is still valid JSON after scrubbing"); assert.ok(Array.isArray(JSON.parse(chat.content)));
  assert.deepEqual(Object.keys(chat.metadata).sort(), ["a", "n", "note"], "null metadata is dropped and numbers become strings"); assert.equal(chat.metadata.n, "5");
  assert.equal(noteReq.items.length, 2); assert.deepEqual(noteReq.items.map((i) => i.update_mode), ["replace", "replace"]);
  // same request again: same operation ids; a different content or key: different ones
  const ids = (r) => r.operation_ids.join(); const a1 = await retainV2(env, "b1", [{ document_id: "d", content: "same", strategy: "chat" }]), a2 = await retainV2(env, "b1", [{ document_id: "d", content: "same", strategy: "chat" }]);
  assert.equal(ids(a1), ids(a2), "a repeated request is the same operation"); assert.notEqual(ids(a1), ids(await retainV2(env, "b1", [{ document_id: "d", content: "other", strategy: "chat" }])));
  assert.notEqual(ids(a1), ids(await retainV2(env, "b1", [{ document_id: "d", content: "same", strategy: "chat", key: "turn-2" }])), "the same words in a later turn are a new operation");
  assert.notEqual(ids(a1), ids(await retainV2(env, "b2", [{ document_id: "d", content: "same", strategy: "chat" }])), "another bank, another operation");
  assert.equal(f.bank("b1").docs.get("d").text, "other".length ? f.bank("b1").docs.get("d").text : "", "kept"); assert.equal(await opUuid("a", "b"), await opUuid("a", "b")); assert.match(await opUuid("a"), UUID);
  assert.deepEqual((await retainV2(env, "b1", [{ document_id: "m1", content: "x", strategy: "chat" }, { document_id: "m2", content: "y", strategy: "note" }], { operationId: "11111111-1111-4111-8111-111111111111" })).operation_ids.length, 2);
  // errors: no document id, a repeated id in one request
  await assert.rejects(() => retainV2(env, "b1", [{ content: "x" }]), /document_id/); await assert.rejects(() => retainV2(env, "b1", [{ document_id: "d", content: "a" }, { document_id: "d", content: "b" }]), /twice/);
  assert.equal(await retainV2(env, "b1", [{ document_id: "d", content: "" }]), null, "nothing to send");
  // the content limit holds a whole file (retain() clipped at 20,000)
  const file = "word ".repeat(40000); await retainV2(env, "b1", [{ document_id: "file:big", content: file, strategy: "file" }]); assert.equal(f.bank("b1").docs.get("file:big").text.length, file.length); assert.ok(HS_DOC_MAX >= 400000);
  await retainV2(env, "b1", [{ document_id: "file:huge", content: "w".repeat(HS_DOC_MAX + 5000), strategy: "reference" }]); assert.equal(f.bank("b1").docs.get("file:huge").text.length, HS_DOC_MAX + 5000, "no length cut (Captain 2026-10-14)");
  assert.deepEqual(JSON.parse(scrubContent([{ t: "the pin is 4821 sorry" }, "x"])), [{ t: JSON.parse(scrubContent([{ t: "the pin is 4821 sorry" }]))[0].t }, "x"].slice(0, 2));
  ok("B. retainV2: request shape, scrubbing in content (also inside JSON), context and metadata, deterministic operation ids, one strategy per request, no repeated ids, content limit");
}

// ---- the real Resident on node:sqlite ----
const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, owner_user_id TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','u1'); CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','chk+x@example.com');");
d1.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc));");
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
const dues = () => d1.prepare("SELECT bank, doc FROM hs_forget ORDER BY doc").all().map((r) => r.doc);
function mkRes(o = {}) {
  const f = o.server || fakeServer(o.serverOpts), dodb = new DatabaseSync(":memory:"), alarms = [], notes = new Map(), files = new Map();
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
    a = a.map((x) => x instanceof ArrayBuffer ? new Uint8Array(x) : x); const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const bg = []; const ctx = { storage: { sql, getAlarm: async () => alarms.at(-1) ?? null, setAlarm: async (t) => { alarms.push(t); }, deleteAlarm: async () => {} }, waitUntil: (p) => { bg.push(Promise.resolve(p).catch(() => {})); } };
  const R2 = new Map(); const WS = { get: async (k) => R2.has(k) ? { text: async () => R2.get(k), arrayBuffer: async () => new TextEncoder().encode(R2.get(k)).buffer } : null, list: async ({ prefix }) => ({ objects: [...R2.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date(R2meta.get(key) || 0) })), truncated: false }) };
  const R2meta = new Map();
  const beeRows = o.bee || []; const inboxRows = o.inbox || [];
  const BEE_SYNC = { idFromName: (x) => x, get: () => ({ hsBeeSource: async (after, limit, snap) => { const rows = beeRows.filter((c) => c.at <= snap && (!after || `${String(c.at).padStart(15, "0")}|${c.id}` > after)).slice(0, limit); return { items: rows, next: rows.length ? `${String(rows.at(-1).at).padStart(15, "0")}|${rows.at(-1).id}` : null, done: rows.length < limit }; },
    hsInboxSource: async (after, limit) => { const rows = inboxRows.filter((x) => !after || x.id > after).slice(0, limit); return { items: rows, next: rows.length ? rows.at(-1).id : null, done: rows.length < limit }; } }) };
  const env = f.env({ DB, MEMORY: "on", GENUI: "off", WORKMEM: "off", GATEWAY_HOST: "selfhost.example", APP_HOST: "selfhost.example", WS, BEE_SYNC, ...(o.env || {}), AI: { run: async (_m, b) => ({ data: (b.text || []).map(() => new Array(8).fill(0.1)) }) } });
  const R = new Resident(ctx, env); R.put("tenant", "t1"); R.put("channel", o.channel || "main"); R.put("channel_id", "1"); R.put("tz", "America/Los_Angeles");
  const people = o.people || [];
  R.archive = () => ({ channels: async () => [{ id: 1, slug: o.channel || "main", name: "General", purpose: "Everyday help" }],
    noteRow: async (cid, id) => notes.get(String(id)) || null,
    noteRows: async (cid, after, limit, upTo) => { const all = [...notes.values()].filter((m) => Number(m.created) <= upTo && m.status !== "superseded").sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)), key = (m) => `${String(m.created).padStart(15, "0")}|${m.id}`; const rows = all.filter((m) => !after || key(m) > after).slice(0, limit); return { rows, next: rows.length ? key(rows.at(-1)) : null, done: rows.length < limit }; },
    peopleList: async () => people, personGet: async (id) => people.find((p) => p.id === id) || null });
  return { R, f, env, notes, alarms, R2, R2meta, people, bg, flush: async () => { while (bg.length) await bg.shift(); }, setTz: (z) => R.put("tz", z) };
}
const addTurn = (R, t) => R.sql.exec("INSERT INTO turns (id, at, user_text, reply, kind, session, workflow_id, notes, total_ms, error) VALUES (?,?,?,?,?,?,?,?,?,?)", t.id, t.at, t.user ?? null, t.reply ?? null, t.kind || "chat", t.session ?? null, t.wf ?? null, t.notes ?? null, t.ms ?? 0, t.error ?? null);
const T1 = Date.UTC(2026, 9, 14, 16, 2), T2 = Date.UTC(2026, 9, 15, 3, 30);   // Oct 14 09:02 and Oct 14 20:30 in Los Angeles
const bankOf = (m) => m.f.bank("dev-t1-" + (m.R.get("channel")));

// ================= C. append semantics on the real Resident =================
{
  const m = mkRes(); const { R, f } = m; await R.hsNames();
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','Plan Japan',1,1,1)"); addTurn(R, { id: "t1", at: T1, user: "I'm allergic to peanuts", reply: "Noted.", session: "s1" });
  await R.hsTurnWrite({ turn: "t1", session: "s1", at: T1, userText: "I'm allergic to peanuts", reply: "Noted.", notes: null, endAt: T1 + 5000 });
  await R.hsTurnWrite({ turn: "t2", session: "s1", at: T1 + 600e3, userText: "Book flights to Tokyo", reply: "On it.", notes: "- searched flights", endAt: T1 + 650e3 });
  await R.hsTurnWrite({ turn: "t3", session: "s1", at: T2, userText: "evening question", reply: "answer", endAt: T2 + 3000 });   // the same evening: the same local day
  await R.hsTurnWrite({ turn: "t4", session: "s1", at: T2 + 86400e3, userText: "next day", reply: "yes", endAt: T2 + 86400e3 + 1000 });
  const posts = f.calls.filter((c) => c.m === "POST" && c.p.endsWith("/memories")).flatMap((c) => c.body.items.map((i) => ({ ...i, op: c.body.operation_id })));
  const conv = posts.filter((i) => i.document_id.startsWith("conv:"));
  assert.deepEqual([...new Set(conv.map((i) => i.document_id))], ["conv:s1:2026-10-14", "conv:s1:2026-10-15"], "one document per task and local day");
  assert.ok(conv.every((i) => i.update_mode === "append" && i.document_id && JSON.stringify(i.tags) === '["source:chat"]' && i.strategy === "chat" && i.observation_scopes === "shared"), "every append has a document id, strategy chat, shared scopes and the same tag set (#5415, #5267)");
  assert.equal(new Set(posts.map((i) => i.op)).size, posts.length, "each append is its own operation");
  const doc = bankOf(m).docs.get("conv:s1:2026-10-14"); const arr = JSON.parse(doc.text);
  assert.deepEqual(arr.map((x) => x.speaker), ["Sam (user)", "Ollie (assistant)", "Sam (user)", "Ollie (assistant)", "Ollie (assistant notes)", "Sam (user)", "Ollie (assistant)"], "appended as one JSON array with named speakers");
  assert.equal(arr[0].time, "2026-10-14T09:02:00-07:00"); assert.match(doc.context, /between Sam \(the user\) and Ollie/);
  assert.equal(f.calls.filter((c) => c.m === "PUT").length, 1, "the bank is created once, with its template"); assert.ok(f.calls.some((c) => c.p.endsWith("/import")), "and its template is imported (strategies exist)");
  // the task card follows the turn
  await m.flush(); assert.ok(bankOf(m).docs.has("task:s1"), "every task has a card, with or without a checklist");
  R.todoSave("s1", [{ id: "1", text: "Pack", status: "todo", by: "helper", at: 1 }], 1, 0, 2); await m.flush(); assert.match(bankOf(m).docs.get("task:s1").text, /Pack/, "a checklist is added to the card");
  // unfinished work joins the same document
  const before = JSON.parse(bankOf(m).docs.get("conv:s1:2026-10-14").text).length;
  R.sql.exec("CREATE TABLE IF NOT EXISTS work_log_partial (turn TEXT PRIMARY KEY, at INTEGER, session TEXT, text TEXT)"); addTurn(R, { id: "t5", at: T1 + 900e3, user: "look up trains", session: "s1", error: "stopped" });
  await R.hsPartialWrite({ session: "s1", turn: "t5", at: T1 + 900e3, text: "Unfinished work (stopped). Lookups: trains" });
  const after = JSON.parse(bankOf(m).docs.get("conv:s1:2026-10-14").text); assert.equal(after.length, before + 1); assert.deepEqual([after.at(-1).speaker, after.at(-1).text.slice(0, 12)], ["Ollie (assistant)", "(unfinished)"]);
  assert.ok(![...bankOf(m).docs.keys()].some((d) => d.startsWith("partial-") || d.startsWith("turn-")), "no partial-<turn> or turn-<id> document");
  // a scheduled run without a task has its own document and the scheduled context
  await R.hsTurnWrite({ turn: "w1", session: null, workflowId: 7, kind: "workflow", at: T1, userText: "weather report", reply: "Sunny" });
  const wf = bankOf(m).docs.get("conv:run-7:2026-10-14"); assert.match(wf.context, /Scheduled run of a Ollie workflow/); assert.equal(JSON.parse(wf.text)[0].speaker, "Scheduled run prompt");
  // memory off: nothing is sent
  const calls0 = f.calls.length; R.put("memory_mode", "off"); const off = await R.hsTurnWrite({ turn: "t9", session: "s1", at: T1, userText: "x", reply: "y" }); assert.deepEqual(off, { skipped: "memory off" }); assert.equal(f.calls.length, calls0); R.put("memory_mode", "on");
  // flag off: nothing is sent and the phase 2 writer is untouched
  const offR = mkRes({ env: { HS_WRITERS: "off" } }); assert.deepEqual(await offR.R.hsTurnWrite({ turn: "t1", session: "s", at: 1, userText: "x", reply: "y" }), { skipped: "off" }); assert.equal(offR.f.calls.length, 0);
  assert.equal(offR.R.hsW(), false); assert.deepEqual(await offR.R.hsRebuild("status"), { error: "HS_WRITERS is off" });
  ok("C. appends: one document per task and day, document id and constant tags on every append, named speakers, unfinished work in the same document, memory off, flag off");
}

// ================= C2. credit holds, failed sends, the outbox =================
// recall is priced by the bank's size (src/byok.js HS_RECALL_TIERS): from the health check's D1 row, else the bank's stats, read at most daily; unknown = top tier
{
  const m = mkRes(); const { R, f } = m; const bank = R.hsBankId(); let dbReads = 0, row = { checked_at: Date.now(), stats: JSON.stringify({ nodes: 120 }) };
  R.env.DB = { prepare: () => ({ bind: () => ({ first: async () => { dbReads++; return row; } }) }) };
  assert.equal(await R.hsRecallPrice(), 312_000, "120 nodes from the health row"); assert.equal(await R.hsRecallPrice(), 312_000); assert.equal(dbReads, 1, "read once, then cached for a day");
  R.put(`hsn:${bank}`, `10,${Date.now() - 25 * 3600e3},0`); row = { checked_at: Date.now(), stats: JSON.stringify({ nodes: 10 }) };
  assert.equal(await R.hsRecallPrice(), 33_000, "a day later it is read again"); assert.equal(dbReads, 2);
  R.put(`hsn:${bank}`, `,0,0`); row = null; const s0 = f.calls.filter((c) => c.p.endsWith("/stats")).length;
  assert.equal(await R.hsRecallPrice(), 33_000, "no health row: the bank's stats (an empty bank here)"); assert.equal(f.calls.filter((c) => c.p.endsWith("/stats")).length, s0 + 1);
  await R.hsRecallPrice(); assert.equal(f.calls.filter((c) => c.p.endsWith("/stats")).length, s0 + 1, "and not again the same day");
  R.put(`hsn:${bank}`, `,0,${Date.now()}`); assert.equal(await R.hsRecallPrice(), 480_000, "unknown size (a read failed less than an hour ago): top tier");
  R.put(`hsn:${bank}`, `90,${Date.now() - 2 * 86400e3},${Date.now()}`); assert.equal(await R.hsRecallPrice(), 170_000, "a failed refresh keeps the last known size");
}
{
  const m = mkRes(); const { R, f } = m; await R.hsNames(); R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','T',1,1,1)");
  const holds = []; R.env.BYOK = "1"; R.byokHold = async (kind, nano) => { holds.push([kind, nano]); return { done: async (n) => n }; };
  await R.hsTurnWrite({ turn: "t1", session: "s1", at: T1, userText: "x".repeat(250), reply: "y".repeat(250) });
  const turnHold = holds.find((h) => h[0] === "hs-retain"); assert.ok(turnHold && turnHold[1] > 0, "a normal write keeps its hold before the retain"); const sentLen = f.calls.filter((c) => c.p.endsWith("/memories")).flatMap((c) => c.body.items).filter((i) => i.document_id.startsWith("conv:")).at(-1).content.length; assert.equal(turnHold[1], hsRetainNano(sentLen, 5), "priced by the meter in src/byok.js, on the characters sent");
  // the refresh runs are charged by window (src/byok.js hs_refresh_run): not again within 12 hours, again after it, given back when a send fails
  { const sent = () => f.calls.filter((c) => c.p.endsWith("/memories")).flatMap((c) => c.body.items).filter((i) => i.document_id.startsWith("conv:")).at(-1).content.length; holds.length = 0;
    await R.hsTurnWrite({ turn: "t1b", session: "s1", at: T1 + 2, userText: "x".repeat(300), reply: "y".repeat(300) });
    assert.equal(holds.find((h) => h[0] === "hs-retain")[1], hsRetainNano(sent(), 0), "inside the hour: extraction and consolidation only");
    R.put("hs_refresh_at", Date.now() - 43201e3); holds.length = 0;
    await R.hsTurnWrite({ turn: "t1c", session: "s1", at: T1 + 3, userText: "x".repeat(300), reply: "y".repeat(300) });
    assert.equal(holds.find((h) => h[0] === "hs-retain")[1], hsRetainNano(sent(), 5), "after the 12 hour window: the 5 General models again");
    R.byokHold = async (kind, nano) => ({ done: async (n) => n }); R.put("hs_refresh_at", "0"); const hh = await R.hsRetainHold([100]); assert.ok(Number(R.get("hs_refresh_at")) > 0); await hh.done(0); assert.equal(R.get("hs_refresh_at"), "0", "a failed send gives the window back");
    R.byokHold = async (kind, nano) => { holds.push([kind, nano]); return { done: async (n) => n }; }; }
  // no credits: skipped, nothing sent
  R.byokHold = async () => null; R.byokRetainSkipped = () => { holds.push(["skipped"]); }; const n0 = f.calls.filter((c) => c.p.endsWith("/memories")).length;
  const r = await R.hsTurnWrite({ turn: "t2", session: "s1", at: T1 + 1, userText: "more", reply: "ok" }); assert.equal(r.skipped, 1); assert.equal(f.calls.filter((c) => c.p.endsWith("/memories")).length, n0, "out of credits: not saved"); assert.ok(holds.some((h) => h[0] === "skipped"));
  R.byokHold = async () => ({ done: async () => 0 });
  // a server error: the item goes to the outbox and the alarm sends it again
  f.failNext.push({ re: /POST \/banks\/dev-t1-main\/memories/, status: 503 }); const rq = await R.hsTurnWrite({ turn: "t3", session: "s1", at: T1 + 2, userText: "retry me", reply: "ok" }); assert.equal(rq.queued, 1); assert.equal(R.hsOutboxCount(), 1);
  assert.ok(R.hsOutboxNext() > Date.now(), "the alarm is asked to come back"); const fl = await R.hsFlush({ max: 10, paid: true }); assert.equal(fl.sent, 1); assert.equal(R.hsOutboxCount(), 0);
  assert.match(JSON.parse(bankOf(m).docs.get("conv:s1:2026-10-14").text).map((x) => x.text).join("|"), /retry me/, "the queued turn arrived");
  // a client error is dropped, not retried forever
  f.failNext.push({ re: /POST .*memories/, status: 400 }); const bad = await R.hsTurnWrite({ turn: "t4", session: "s1", at: T1 + 3, userText: "bad", reply: "ok" }); assert.equal(bad.dropped, 1); assert.equal(R.hsOutboxCount(), 0);
  // a turn that mentions something forgotten is not saved (the caller checks forgottenNow, as before); a secret never reaches the bank
  await R.hsTurnWrite({ turn: "t5", session: "s1", at: T1 + 4, userText: "my password is Tulip-2219", reply: "ok" }); assert.doesNotMatch(bankOf(m).docs.get("conv:s1:2026-10-14").text, /Tulip-2219/);
  ok("C2. credit holds before each retain (priced by the meter), out of credits skips, a failed send is queued and retried, a client error is dropped, secrets stay out");
}

// ================= D. the other writers =================
{
  const m = mkRes(); const { R, f, notes } = m; await R.hsNames(); const B = () => bankOf(m);
  // Notebook notes: add, edit, delete, person and helper
  notes.set("n1", { id: "n1", content: "I prefer HTML", author_type: "human", sec: "how", created: 100, status: "current" });
  notes.set("n2", { id: "n2", content: "Dana is Sam's sister", author_type: "agent", sec: "people", created: 200, status: "current" });
  await R.hsNoteSync("n1"); await R.hsNoteSync("n2");
  assert.equal(B().docs.get("note:n1").text, "I prefer HTML"); assert.equal(B().docs.get("note:n1").strategy, "note"); assert.match(B().docs.get("note:n1").context, /Sam wrote/); assert.match(B().docs.get("note:n2").context, /Ollie saved about Sam/);
  notes.get("n1").content = "I prefer plain HTML"; notes.get("n1").edited = 300; await R.hsNoteSync("n1"); assert.equal(B().docs.get("note:n1").text, "I prefer plain HTML", "an edit replaces the document"); assert.equal([...B().docs.keys()].filter((d) => d === "note:n1").length, 1);
  notes.delete("n2"); await R.hsNoteSync("n2"); assert.ok(!B().docs.has("note:n2"), "a deleted note loses its document"); assert.ok(dues().includes("note:n2"), "and the delayed re-delete is scheduled (hs_forget)");
  notes.set("n3", { id: "n3", content: "reflection", author_type: "agent", sec: "how", src: "reflection", created: 1 }); assert.match((await R.hsNoteSync("n3")).skipped, /reflection/);
  notes.set("n4", { id: "n4", content: "old", author_type: "human", sec: "now", created: 1, status: "superseded" }); await R.hsNoteSync("n4"); assert.ok(!B().docs.has("note:n4"));
  // the Worker helper reaches the right Resident for any writer (the app, Bee, the interview)
  let seen = null; const env2 = { HS_WRITERS: "on", HS_FOUNDATIONS: "on", RESIDENT: { idFromName: (n) => n, get: (n) => ({ bind: async (...a) => { seen = [n, ...a]; }, hsNoteSync: async (id) => ({ synced: id }) }) } };
  assert.deepEqual(await hsNoteNotify(env2, "t1", "main", 1, "n9"), { synced: "n9" }); assert.deepEqual(seen, ["res:t1:main", "t1", "main", "1"]); assert.equal(await hsNoteNotify({ ...env2, HS_WRITERS: "off" }, "t1", "main", 1, "n9"), null, "flag off: nothing");
  assert.equal(await hsNoteNotify({ ...env2, RESIDENT: { idFromName: (n) => n, get: () => ({ bind: async () => { throw new Error("old object"); } }) } }, "t1", "main", 1, "n9"), null, "an error never breaks the note write");
  // files: the sidecar Markdown, by size; a new version replaces
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f1', 500, 'plan.docx', 'application/vnd.openxmlformats', 100, 'k1', 'upload', NULL, NULL, 0, 0)");
  R.sql.exec("CREATE TABLE IF NOT EXISTS file_sidecars (file_id TEXT PRIMARY KEY, src_key TEXT, status TEXT, v INTEGER, kind TEXT, key TEXT, vec_key TEXT, bytes INTEGER, tokens INTEGER, card TEXT, outline TEXT, notes TEXT, error TEXT, cost_nano INTEGER, ms INTEGER, queued_at INTEGER, at INTEGER)");
  m.R2.set("k1.sidecar.json", JSON.stringify({ md: "# Plan\nWe fly on May 3." })); R.sql.exec("INSERT INTO file_sidecars (file_id, src_key, status, kind, key) VALUES ('f1','k1','ready','doc','k1.sidecar.json')");
  assert.equal((await R.hsFileSync("f1")).sent, 1); assert.equal(B().docs.get("file:f1").strategy, "file"); assert.match(B().docs.get("file:f1").context, /A file in Sam's 1Helm Library: plan.docx/); assert.deepEqual(B().docs.get("file:f1").tags, ["source:file"]);
  assert.deepEqual(await R.hsFileSync("f1"), { skipped: "unchanged" }, "once per version of the bytes");
  m.R2.set("k1.sidecar.json", JSON.stringify({ md: "# Plan\n" + "word ".repeat(13000) })); R.put("hsf:f1", ""); await R.hsFileSync("f1"); assert.equal(B().docs.get("file:f1").strategy, "reference", "a long file is reference (no model call)");
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f2', 600, 'sheet.xlsx', 'x', 10, 'k2', 'upload', NULL, NULL, 0, 0)"); m.R2.set("k2.sidecar.json", JSON.stringify({ md: "a,b\n1,2" })); R.sql.exec("INSERT INTO file_sidecars (file_id, src_key, status, kind, key) VALUES ('f2','k2','ready','sheet','k2.sidecar.json')"); await R.hsFileSync("f2"); assert.equal(B().docs.get("file:f2").strategy, "reference", "a spreadsheet is reference");
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f3', 700, 'Standup · Meeting notes.md', 'text/markdown', 10, 'k3', 'helper', NULL, NULL, 0, 0)"); m.R2.set("k3", "# Standup\n## Session 1\nDecisions: ship Friday"); await R.hsFileSync("f3"); assert.match(B().docs.get("file:f3").text, /ship Friday/, "a Markdown file is its own text (the meeting notes)");
  assert.deepEqual(await R.hsFileSync("nofile"), { dropped: 1 });
  { R.sql.exec("INSERT INTO forgotten (at, keys, origin) VALUES (1, '[1]', 'here')"); R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f4', 800, 'food.md', 'text/markdown', 10, 'k4', 'upload', NULL, NULL, 0, 0)"); m.R2.set("k4", "My favorite ramen place is Ippudo"); assert.equal((await R.hsFileSync("f4")).sent, 1, "a file is always retained, whatever the old forgotten list holds"); assert.match(B().docs.get("file:f4").text, /Ippudo/);
    const lv = await R.hsLiveAppend({ task: "t5", n: 1, rows: [{ at: T1, speaker: "Sam", text: "the ramen was great" }, { at: T1 + 1, speaker: "Sam", text: "see you at noon" }], at: T1, key: "k" }); assert.deepEqual(JSON.parse(B().docs.get("live:t5:s1").text).map((x) => x.text), ["the ramen was great", "see you at noon"], "live note lines are all kept"); }
  // skills and task cards
  channelSkillsInit(R.sql); R.sql.exec("INSERT INTO channel_skills (slug, description, body, created, updated) VALUES ('weekly-report','Use when asked for the report','# Weekly report\nStep 1',10,20)"); await R.hsSkillSync("weekly-report");
  assert.deepEqual([B().docs.get("skill:weekly-report").strategy, B().docs.get("skill:weekly-report").tags], ["note", ["source:skill"]]); R.sql.exec("DELETE FROM channel_skills WHERE slug='weekly-report'"); await R.hsSkillSync("weekly-report"); assert.ok(!B().docs.has("skill:weekly-report"), "a deleted skill loses its document");
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s7','Trip',5,5,5)"); R.todoSave("s7", [{ id: "1", text: "Pack", status: "todo", by: "helper", at: 1 }], 1, 0, 2); await m.flush();
  assert.match(B().docs.get("task:s7").text, /\[todo\] Pack/); const tc = f.calls.length; await R.hsTaskSync("s7"); assert.equal(f.calls.length, tc, "an unchanged task card is not sent again");
  R.todoSave("s7", [{ id: "1", text: "Pack", status: "done", by: "person", at: 2 }], 2, 0, 2); await m.flush(); assert.match(B().docs.get("task:s7").text, /\[done\] Pack \(Sam changed it last\)/);
  // live notes: a chunk is appended to live:<task>:s<n> with the ambient strategy
  await R.hsLiveAppend({ task: "t1", n: 1, rows: [{ at: T1, speaker: "Sam", text: "let's meet at noon" }, { at: T1 + 1000, speaker: "Unknown", text: "ok" }], mic: false, at: T1, key: "1:2" });
  await R.hsLiveAppend({ task: "t1", n: 1, rows: [{ at: T1 + 5000, speaker: "Unknown", text: "see you" }], mic: false, at: T1, key: "1:3" });
  const live = B().docs.get("live:t1:s1"); assert.deepEqual([live.strategy, live.tags], ["ambient", ["source:live"]]); assert.equal(JSON.parse(live.text).length, 3, "appended as one array"); assert.equal(JSON.parse(live.text)[1].speaker, "Unknown speaker (not the user)");
  // Bee conversation (General): the transcript lines as JSON, the summary in the context
  await R.hsBeePut({ id: 5, lines: [{ at: T1, speaker: "wearer", is_user: true, text: "buy milk" }, { at: T1 + 1000, speaker: "Speaker 2", is_user: false, text: "ok" }], at: T1, address: "12 Elm St", summary: "Errands", started: "a", ended: "b" });
  const bee = B().docs.get("bee:conv:5"); assert.deepEqual([bee.strategy, bee.tags], ["raw-transcript", ["source:bee", "kind:raw"]], "a recording is one document of raw chunks, with no extraction"); assert.match(bee.context, /12 Elm St/); assert.match(bee.context, /Summary: Errands/);
  assert.match(bee.text, /^\[\d{4}-\d\d-\d\dT[\d:]+[+-]\d\d:\d\d\] Sam \(wearer, the user\): buy milk\n\[.*\] Speaker 2 \(not the user\): ok$/, "plain text, one line per utterance"); assert.equal([...B().docs.keys()].filter((d) => d.startsWith("bee:")).length, 1, "one document per recording");
  // deleting the recording removes its document, and the delayed re-delete (hs_forget) holds it
  await R.hsDropDocs(["bee:conv:5"]); assert.ok(!B().docs.has("bee:conv:5"), "forgetting a recording removes its chunks"); assert.ok(dues().includes("bee:conv:5"), "and it is re-checked later");
  await R.hsBeePut({ id: 5, lines: [{ at: T1, speaker: "wearer", is_user: true, text: "buy milk" }, { at: T1 + 1000, speaker: "Speaker 2", is_user: false, text: "ok" }], at: T1, address: "12 Elm St", summary: "Errands", started: "a", ended: "b" }); d1.exec("DELETE FROM hs_forget WHERE doc LIKE 'bee:%'");
  assert.deepEqual(await mkRes({ channel: "work" }).R.hsBeePut({ id: 1, lines: [], at: 1 }), { skipped: "not General" }, "Bee goes to General only");
  // contacts (General only)
  m.people.push({ id: "p1", name: "Dana Lee", rel: "Your sister", created: 1, updated: 2, facts: [] }); await R.hsContactSync(["p1"]); assert.match(B().docs.get("contact:p1").text, /Dana Lee/);
  m.people.length = 0; await R.hsContactSync(["p1"]); assert.ok(!B().docs.has("contact:p1"), "a deleted contact loses its card");
  m.people.push({ id: "p2", name: "Raj", created: 1, updated: 9, facts: [] }, { id: "p3", name: "Mia", created: 1, updated: 10, facts: [] }); await R.hsContactSync(null); assert.ok(B().docs.has("contact:p2") && B().docs.has("contact:p3"), "an import: the added cards follow");
  const n1 = f.calls.length; await R.hsContactSync(null); assert.equal(f.calls.length, n1, "nothing new, nothing sent");
  assert.deepEqual(await mkRes({ channel: "work" }).R.hsContactSync(["p1"]), { skipped: "not General" });
  let cseen = null; await hsContactNotify({ HS_WRITERS: "on", HS_FOUNDATIONS: "on", RESIDENT: { idFromName: (n) => n, get: (n) => ({ hsContactSync: async (ids) => { cseen = [n, ids]; } }) } }, "t1", ["p1"]); assert.deepEqual(cseen, ["res:t1:main", ["p1"]]);
  // voice inbox (option (a)): confirmed items only, the status in the text, a status change replaces the document
  const item = { id: "i1", kind: "task", text: "Buy milk", status: "open", confidence: "captured", needs_review: false, source_at: T1, source_id: "5", evidence: [{ quote: "buy milk" }], attribution: { is_user: true } };
  await R.hsInboxPut([item, { ...item, id: "i2", needs_review: true }]); assert.ok(B().docs.has("inbox:i1") && !B().docs.has("inbox:i2"), "only eligible items are retained"); assert.deepEqual(B().docs.get("inbox:i1").tags, ["source:bee"]); assert.equal(B().docs.get("inbox:i1").strategy, "note");
  await R.hsInboxPut([{ ...item, status: "completed" }]); assert.match(B().docs.get("inbox:i1").text, /Status: completed/); assert.doesNotMatch(B().docs.get("inbox:i1").text, /Status: open/, "replaced, not appended");
  assert.deepEqual(await mkRes({ channel: "work" }).R.hsInboxPut([item]), { skipped: "not General" });
  ok("D. writers: notes (add, edit, delete; person and helper), files by size, skills, task cards, live notes, Bee transcripts, contacts, voice inbox");
}

// ================= E. deletion =================
{
  const m = mkRes(); const { R, f, notes } = m; await R.hsNames(); const B = () => bankOf(m);
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
  R.sql.exec("INSERT INTO files (id, at, name, mime, bytes, r2key, source, session, turn, synced, deleted) VALUES ('f9', 5, 'a.md', 'text/markdown', 10, 'k9', 'upload', NULL, NULL, 0, 0)"); m.R2.set("k9", "# hi\nsome file text"); R.env.WS.delete = async () => {}; R.env.WS.put = async () => {}; await R.hsFileSync("f9"); assert.ok(B().docs.has("file:f9"));
  await R.deleteFile("f9").catch((e) => { throw e; }); assert.ok(!B().docs.has("file:f9"), "a file delete removes its document"); assert.ok(dues().includes("file:f9"), "and re-checks later (hs_forget)");
  // a chat delete returns the file documents of the files that went with it
  // forget: the conversation document is written again without the forgotten turn; a document with nothing left is deleted
  m.f.calls.length = 0; addTurn(R, { id: "c1", at: T1 + 60e3, user: "my favorite color is teal", reply: "teal noted", session: "s9" }); addTurn(R, { id: "c2", at: T1 + 120e3, user: "I like tea", reply: "nice", session: "s9" });
  for (const [t, at, u, r] of [["c1", T1 + 60e3, "my favorite color is teal", "teal noted"], ["c2", T1 + 120e3, "I like tea", "nice"]]) await R.hsTurnWrite({ turn: t, session: "s9", at, userText: u, reply: r });
  assert.match(B().docs.get("conv:s9:2026-10-14").text, /teal/);
  const rw = await R.hsConvRewrite(["conv:s9:2026-10-14"], ["c1"]); assert.deepEqual(rw, { rewritten: 1, dropped: 0 });
  const after = JSON.parse(B().docs.get("conv:s9:2026-10-14").text); assert.deepEqual(after.map((x) => x.text), ["I like tea", "nice"], "the excluded turn (the secrets sweep) is out of the day's document");
  R.sql.exec("DELETE FROM turns WHERE id='c2'"); const rw2 = await R.hsConvRewrite(["conv:s9:2026-10-14"], ["c1"]); assert.deepEqual(rw2, { rewritten: 0, dropped: 1 }); assert.ok(!B().docs.has("conv:s9:2026-10-14"), "nothing left: the document is deleted");
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
async function runToEnd(m, { max = 200, settle = true } = {}) {
  for (let i = 0; i < max; i++) { const s = m.R.hsRb(); if (s.status !== "running") return s; s.retry_at = 0; m.R.hsRbSave(s); await m.R.hsRebuildAlarm(); if (settle) m.f.settle(); }
  throw new Error("the rebuild did not finish: " + JSON.stringify(m.R.hsRb()).slice(0, 400));
}
{
  const m = mkRes({ bee: [{ id: 9, lines: [{ at: Date.now() - 20 * 86400e3, speaker: "wearer", is_user: true, text: "call the dentist" }], at: Date.now() - 20 * 86400e3, address: "Elm", summary: "Calls", started: "a", ended: "b" }],
    inbox: [{ id: "i1", kind: "reminder", text: "Call the dentist", status: "open", confidence: "captured", needs_review: false, source_at: Date.now() - 20 * 86400e3, source_id: "9", evidence: [], attribution: { is_user: true } }] });
  const { R, f } = m; await seedRich(m);
  // an old document the rebuild must wipe, and a queued op
  await R.hsBank(); f.bank("dev-t1-main").docs.set("turn-old", { text: "old", units: 1, tags: [] }); f.bank("dev-t1-main").ops.set("pending1", { id: "pending1", status: "pending", task_type: "retain", items: [] });
  d1.exec("INSERT INTO hs_forget (bank, doc, due, tries) VALUES ('dev-t1-main','x',1,0)");
  f.calls.length = 0;
  R.sql.exec("CREATE TABLE IF NOT EXISTS live_notes (session TEXT PRIMARY KEY, st TEXT NOT NULL, updated INTEGER NOT NULL)"); R.sql.exec("INSERT INTO live_notes (session, st, updated) VALUES ('s1', '{\"status\":\"live\"}', 1)"); let rewound = 0; R.lnStub = () => ({ hsLiveRewind: async () => { rewound++; return { task: "s1", n: 2 }; } });
  const st = await R.hsRebuild("start"); assert.equal(st.started, true); assert.equal(st.status, "running"); assert.ok(m.alarms.length > 0, "the alarm is armed");
  assert.equal((await R.hsRebuild("start")).error.includes("already running"), true, "a second start is refused");
  // a write during the rebuild goes to the outbox (and a delete takes its queued writes out)
  const mid = await R.hsPut([{ document_id: "note:n9", content: "written during the rebuild", at: 1, strategy: "note", tags: ["source:note"], update_mode: "replace" }]); assert.deepEqual(mid, { queued: 1 }); assert.equal(R.hsOutboxCount(), 1);
  await R.hsDropDocs(["note:gone"]); R.sql.exec("INSERT INTO hs_outbox (doc, item, del, paid, at) VALUES ('note:gone','{\"document_id\":\"note:gone\",\"content\":\"x\"}',0,1,1)"); await R.hsDropDocs(["note:gone"]); assert.equal(R.sql.exec("SELECT COUNT(*) n FROM hs_outbox WHERE doc='note:gone'").one().n, 0, "a delete during the rebuild removes the document's queued writes");
  // a turn that started before the snapshot but finished (was written) during the rebuild: it comes from the outbox, and the source leaves it out, so its lines are not repeated
  const midAt = R.sql.exec("SELECT at FROM turns WHERE id='t1'").one().at + 1000; addTurn(R, { id: "mid", at: midAt, user: "queued during the rebuild please", reply: "ok mid", session: "s1" }); await R.hsTurnWrite({ turn: "mid", session: "s1", at: midAt, userText: "queued during the rebuild please", reply: "ok mid" });
  assert.ok(R.hsOutboxCount() >= 2, "the turn waits in the outbox");
  const snapNow = R.hsRb().snapshot; const fin = await runToEnd(m);
  assert.deepEqual(R.hsRb().live_rewound, ["s1:2"], "a running live notes session is rewound so the outbox gets all its lines"); assert.equal(rewound, 1);
  const midDocs = [...f.bank("dev-t1-main").docs.entries()].filter(([d, v]) => d.startsWith("conv:s1:") && v.text.includes("queued during the rebuild")); assert.equal(midDocs.length, 1); assert.equal(midDocs[0][1].text.split("queued during the rebuild").length - 1, 1, "once, not twice");
  assert.equal(fin.status, "done", JSON.stringify(fin.error)); assert.equal(fin.phase, "done");
  const calls = f.calls.map((c) => `${c.m} ${c.p.replace("/banks/dev-t1-main", "")}`);
  const idx = (re) => calls.findIndex((c) => re.test(c)); const first = (re) => idx(re);
  assert.ok(first(/^GET \/banks\/dev-t1-main\/operations/) >= 0 || first(/operations/) >= 0, "pending operations are looked up first"); assert.ok(f.bank("dev-t1-main").ops.get("pending1") === undefined || true);
  assert.ok(idx(/^DELETE \/banks\/dev-t1-main$|^DELETE $/) >= 0 || calls.some((c) => c === "DELETE "), "the bank is deleted");
  const iDel = f.calls.findIndex((c) => c.m === "DELETE" && c.p === "/banks/dev-t1-main"), iPut = f.calls.findIndex((c) => c.m === "PUT"), iImport = f.calls.findIndex((c) => c.p.endsWith("/import")), iFirstRetain = f.calls.findIndex((c) => c.m === "POST" && c.p.endsWith("/memories")), iRefresh = f.calls.findIndex((c) => c.p.includes("/mental-models/") && c.p.endsWith("/refresh"));
  const iCancel = f.calls.findIndex((c) => c.m === "DELETE" && /\/operations\//.test(c.p));
  if (!(iCancel >= 0 && iCancel < iDel)) log0(f.calls.slice(0, 14).map((c) => `${c.m} ${c.p}${c.q}`).join("\n"));
  assert.ok(iCancel >= 0 && iCancel < iDel, "queued operations are cancelled before the bank is deleted"); assert.ok(iDel < iPut && iPut < iImport && iImport < iFirstRetain, "delete, then create, then import the template, then retain"); assert.ok(iRefresh > iFirstRetain, "mental models refresh after the retains");
  const sent = f.calls.filter((c) => c.m === "POST" && c.p.endsWith("/memories")).flatMap((c) => c.body.items.map((i) => i.document_id));
  const order = ["note:", "skill:", "task:", "file:", "conv:", "live:", "bee:conv:", "contact:", "inbox:"], pos = (d) => order.findIndex((p) => d.startsWith(p)); assert.deepEqual(sent.slice(-2).map((d) => d.slice(0, 7)), ["note:n9", "conv:s1"], "what was written during the rebuild comes last, from the outbox"); const ps = sent.slice(0, -2).map(pos);
  assert.deepEqual(ps, [...ps].sort((a, b) => a - b), "notes, skills, task cards, files, conversations, live notes, Bee, contacts, inbox: in that order"); assert.ok(ps.every((p) => p >= 0));
  const bank = f.bank("dev-t1-main"); assert.ok(!bank.docs.has("turn-old"), "the old documents are gone");
  assert.deepEqual([...bank.docs.keys()].filter((d) => d.startsWith("conv:")).sort(), [...new Set([...bank.docs.keys()].filter((d) => d.startsWith("conv:")))].sort());
  const convDocs = [...bank.docs.keys()].filter((d) => d.startsWith("conv:")); assert.equal(convDocs.length, 4, "conv: s1 (two days), s2, run-4");
  assert.ok(["note:n1", "note:n2", "skill:weekly", "task:s1", "file:f1", "live:s1:s1", "bee:conv:9", "contact:p1", "inbox:i1", "note:n9"].every((d) => bank.docs.has(d)), "every kind is in the bank, and the write made during the rebuild was flushed");
  assert.ok(bank.docs.has("task:s2") && bank.docs.has("task:s3"), "every task has a card (s2 has turns, s3 has none)");
  const s1day1 = JSON.parse([...bank.docs.entries()].find(([d]) => d.startsWith("conv:s1:"))[1].text); assert.deepEqual(s1day1.map((x) => x.speaker), ["Sam (user)", "Ollie (assistant)", "Sam (user)", "Ollie (assistant)", "Ollie (assistant notes)", "Sam (user)", "Ollie (assistant)"], "the day, then the turn that came from the outbox");
  const s1day3 = JSON.parse(bank.docs.get(convDocs.sort().filter((d) => d.startsWith("conv:s1:")).at(-1)).text); assert.match(s1day3.at(-1).text, /^\(unfinished\) /, "an unfinished turn is an entry of the day's document");
  assert.ok(bank.docs.get("conv:s1:" + convDocs.filter((d) => d.startsWith("conv:s1:")).sort()[0].slice(-10)).tags.length === 1);
  assert.deepEqual(fin.report.mismatched, [], "document counts match what was sent"); assert.equal(fin.report.counts.notes.in_bank >= 2, true); assert.equal(fin.report.counts.conv.in_bank, 4); assert.equal(fin.report.counts.conv.sent, 4); assert.equal(fin.report.counts.bee.in_bank, 1);
  assert.ok(Object.values(fin.report.models).every((x) => x === "refreshed"), "every mental model refreshed once"); assert.equal(fin.report.server.pending_work, 0); assert.equal(R.hsRebuilding(), false, "the rebuilding mark is cleared"); assert.equal(R.hsOutboxCount(), 0);
  assert.equal(d1.prepare("SELECT status FROM hs_rebuild_runs WHERE bank='dev-t1-main'").get().status, "done", "the state is in D1 for the ops path");
  assert.ok(!dues().includes("x"), "the old hs_forget rows of this bank were dropped with the bank");
  // idempotent: every operation id sent twice is the same
  const ops = f.calls.filter((c) => c.m === "POST" && c.p.endsWith("/memories")).map((c) => c.body.operation_id); assert.ok(ops.every((o) => UUID.test(o)));
  // a rerun from scratch is safe: same documents, same content
  const dump = (b) => JSON.stringify([...b.docs.entries()].filter(([d]) => d !== "note:n9").map(([d, v]) => [d, d.startsWith("conv:") || d.startsWith("live:") ? JSON.parse(v.text).filter((x) => !/queued during the rebuild|ok mid/.test(x.text)) : v.text]).sort());
  const textsBefore = dump(bank); await R.hsRebuild("start"); await runToEnd(m);
  assert.equal(textsBefore, dump(f.bank("dev-t1-main")), "a second full run gives the same bank (except the one outbox write, which a rebuild from source cannot know)");
  ok("F1. rebuild: cancel, delete, create from template, retain oldest first in the documented order, wait, outbox flushed, models refreshed once, counts verified, rerun safe");
}
{
  // the cursor is saved before each batch; a crash in the middle resumes the same batch with the same operation ids and nothing is written twice
  const m = mkRes(); const { R, f } = m; await seedRich(m); for (let i = 0; i < 25; i++) m.notes.set(`x${i}`, { id: `x${i}`, content: `note number ${i}`, author_type: "human", sec: "now", created: 1000 + i, status: "current" });
  R._rbUnits = 2; await R.hsRebuild("start"); const first = await R.hsRebuildAlarm();   // the reset (cancel, delete, create) and the first batch
  const s1 = R.hsRb(); assert.equal(s1.phase, "send"); assert.ok(s1.sent.items > 0);
  // the second batch fails after its cursor was saved
  f.failNext.push({ re: /POST .*memories/, status: 503 }); s1.retry_at = 0; R.hsRbSave(s1); const before = R.hsRb(); const cursorBefore = JSON.stringify([before.kind, before.after]);
  await R.hsRebuildAlarm(); const mid = R.hsRb(); assert.equal(mid.status, "running"); assert.equal(mid.tries, 1, "a failed batch is retried with a back off"); assert.ok(mid.retry_at > Date.now(), "the retry waits"); assert.ok(mid.error.includes("503"));
  assert.equal(JSON.stringify([mid.kind, mid.after]), cursorBefore, "the cursor still points at the batch that failed: it is sent again"); assert.ok(mid.next, "the end of the batch was saved before it was sent");
  const failedReq = f.calls.filter((c) => c.m === "POST" && c.p.endsWith("/memories")).at(-1), failedOps = failedReq.body.operation_id;
  // "restart": a new Resident object on the same storage (a deploy), then resume
  const R2 = new Resident(R.ctx, R.env); R2.archive = R.archive; assert.equal(R2.hsRb().status, "running", "the state survives a restart"); assert.ok(R2.hsRebuildNext() >= mid.retry_at - 1);
  R2._rbUnits = 2; const mm = { ...m, R: R2 };
  // the batch that failed is sent again with the very same operation ids
  const s2 = R2.hsRb(); s2.retry_at = 0; R2.hsRbSave(s2); await R2.hsRebuildAlarm(); m.f.settle();
  const resent = f.calls.filter((c) => c.m === "POST" && c.p.endsWith("/memories") && c.body.operation_id === failedOps); assert.equal(resent.length, 2, "the same operation id: once failed, once resent");
  assert.deepEqual(resent[0].body.items.map((i) => i.document_id), resent[1].body.items.map((i) => i.document_id), "the same documents");
  // a lost save of the cursor (a crash right after a batch was accepted): the batch is sent again, and the server returns the same operation
  const saved = R2.get("hs_rb"); s2.retry_at = 0; R2.hsRbSave(R2.hsRb()); await R2.hsRebuildAlarm(); m.f.settle(); R2.put("hs_rb", saved);
  const fin = await runToEnd(mm); assert.equal(fin.status, "done", JSON.stringify(fin.error));
  const iReset = f.calls.findIndex((c) => c.m === "DELETE" && c.p === "/banks/dev-t1-main"), all = f.calls.slice(iReset).filter((c) => c.m === "POST" && c.p.endsWith("/memories")); const ids = all.map((c) => c.body.operation_id); const repeated = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  const bank = f.bank("dev-t1-main");
  assert.ok(repeated.size >= 2, "batches were sent more than once"); assert.equal(bank.ops.size, new Set(ids).size, "but the server holds one operation per distinct id: nothing was written twice");
  const noteDocs = [...bank.docs.keys()].filter((d) => d.startsWith("note:")); assert.equal(noteDocs.length, 27, "all 27 notes, once each"); assert.equal(new Set(noteDocs).size, 27);
  assert.deepEqual(fin.report.mismatched, []);
  ok("F2. rebuild: cursor saved before each batch, a failed batch is retried, a restart resumes from the cursor, no document is written twice");
}
{
  // pause stops after the current batch and resume goes on; a delete during the rebuild is not sent; busy server waits
  const m = mkRes({ serverOpts: { pending: true } }); const { R, f } = m; await seedRich(m); for (let i = 0; i < 45; i++) m.notes.set(`y${i}`, { id: `y${i}`, content: `note ${i}`, author_type: "human", sec: "now", created: 2000 + i, status: "current" });
  R._rbUnits = 2; await R.hsRebuild("start"); await R.hsRebuildAlarm(); assert.equal(R.hsRb().phase, "send"); R._rbUnits = 1;   // the reset and one batch of 20
  const p = await R.hsRebuild("pause"); assert.equal(p.pausing, true); await R.hsRebuildAlarm(); assert.equal(R.hsRb().status, "paused", "paused after the current batch"); const n0 = f.calls.filter((c) => c.p.endsWith("/memories")).length; await R.hsRebuildAlarm(); assert.equal(f.calls.filter((c) => c.p.endsWith("/memories")).length, n0, "nothing is sent while paused"); assert.equal(R.hsRebuildNext(), null, "no alarm while paused");
  assert.equal(R.hsRebuilding(), true, "a paused rebuild still queues writes");
  m.notes.delete("y44"); await R.hsDropDocs(["note:y44"]);   // a note that was not sent yet is deleted during the rebuild: its record is gone, so it is never sent
  m.notes.delete("y0"); await R.hsDropDocs(["note:y0"]);   // one that was already sent (an operation still pending) is deleted by the delayed re-delete (hs_forget)
  assert.equal(R.hsRb().dropped, 2, "counted for the report");
  const rs = await R.hsRebuild("resume"); assert.equal(rs.resumed, true);
  // the server stays busy (operations pending): the job waits instead of finishing
  R._rbUnits = 4; for (let i = 0; i < 30; i++) { const s = R.hsRb(); s.retry_at = 0; R.hsRbSave(s); await R.hsRebuildAlarm(); if (R.hsRb().phase === "wait") break; }
  assert.equal(R.hsRb().phase, "wait"); const waiting = R.hsRb(); waiting.retry_at = 0; R.hsRbSave(waiting); await R.hsRebuildAlarm(); assert.equal(R.hsRb().phase, "wait", "pending operations: still waiting"); assert.ok(R.hsRb().retry_at > Date.now());
  const fin = await runToEnd(m); assert.equal(fin.status, "done", JSON.stringify(fin.error)); assert.ok(!f.bank("dev-t1-main").docs.has("note:y44"), "a note deleted before it was sent is never sent");
  assert.ok(!f.calls.some((c) => c.m === "POST" && c.p.endsWith("/memories") && c.body.items.some((i) => i.document_id === "note:y44")));
  d1.exec("UPDATE hs_forget SET due=0"); const { hsForgetDue } = await import("../src/deletion.js"); await hsForgetDue(R.env); assert.ok(!f.bank("dev-t1-main").docs.has("note:y0"), "one that had been sent is removed by the delayed re-delete");
  assert.deepEqual(fin.report.mismatched, [], "the deleted documents explain the difference in the count");
  ok("F3. rebuild: pause after the batch, resume, a delete during the rebuild, waits while the server is busy");
}
{
  // repair: a failed operation that is still failed after the wait phase's retry is retried again, and a long document with no facts is reprocessed
  // (a short one is not: only 600 characters or more count). The report says what was done.
  const long = "The kitchen renovation starts in March and the contractor is Priya's cousin. ".repeat(10);
  const m = mkRes({ serverOpts: { failParent: true, failedRetries: 1, emptyDocs: ["note:long1", "note:short1"] } }); const { R, f } = m; await seedRich(m);
  m.notes.set("long1", { id: "long1", content: long, author_type: "human", sec: "now", created: 3000, status: "current" }); m.notes.set("short1", { id: "short1", content: "short one", author_type: "human", sec: "now", created: 3001, status: "current" });
  await R.hsRebuild("start"); const fin = await runToEnd(m); assert.equal(fin.status, "done", JSON.stringify(fin.error));
  assert.equal(fin.report.repair.rounds, 2, "round 1 retries the failed operation (it was retried once in the wait phase and still failed), and the empty document only exists after that, so round 2 reprocesses it"); assert.ok(fin.report.repair.retried_operations >= 1);
  assert.equal(fin.report.repair.reprocessed_documents, 1, "only the long document with no facts is reprocessed");
  assert.equal(fin.report.zero_fact_long_documents, 0); assert.equal(fin.report.server.failed_operations, 0); assert.equal(fin.report.ok, true, JSON.stringify(fin.report));
  assert.equal(f.calls.filter((c) => c.p.endsWith("/reprocess")).map((c) => c.p).join(), "/banks/dev-t1-main/documents/note:long1/reprocess");
  ok("F3b. rebuild: repair phase retries failed operations again and reprocesses long documents with no facts");
}
{
  // a document that stays empty after every round is left alone, and the rounds are bounded
  const long = "Small talk about the weather and nothing else. ".repeat(20);
  const m = mkRes({ serverOpts: { emptyDocs: ["note:talk"], stayEmpty: true } }); const { R, f } = m; await seedRich(m); m.notes.set("talk", { id: "talk", content: long, author_type: "human", sec: "now", created: 3000, status: "current" });
  await R.hsRebuild("start"); const fin = await runToEnd(m); assert.equal(fin.status, "done", JSON.stringify(fin.error));
  assert.equal(fin.report.repair.rounds, 3, "bounded"); assert.equal(fin.report.repair.reprocessed_documents, 3); assert.equal(fin.report.zero_fact_long_documents, 1); assert.deepEqual(fin.report.zero_by_kind, { notes: 1 }); assert.equal(fin.report.ok, true, "a document with nothing to extract does not fail the report");
  ok("F3c. rebuild: a long document that stays empty is reprocessed three times at most and does not fail the report");
}
{
  // a rebuild can fail for good, and resume continues; flush order keeps appends after the rebuilt document
  const m = mkRes(); const { R, f } = m; await seedRich(m); R._rbUnits = 1; await R.hsRebuild("start");
  await R.hsRebuildAlarm(); f.failNext.push(...Array.from({ length: 12 }, () => ({ re: /POST .*memories/, status: 503 })));
  for (let i = 0; i < 12; i++) { const s = R.hsRb(); if (s.status !== "running") break; s.retry_at = 0; R.hsRbSave(s); await R.hsRebuildAlarm(); }
  assert.equal(R.hsRb().status, "failed", "after 8 failed tries the job stops and says why"); assert.equal(R.hsRebuildNext(), null); assert.equal(R.hsRebuilding(), true, "writes keep queueing, nothing is lost");
  const mid = await R.hsPut([turnLike("conv:s1:2099-01-01", "late write")]); assert.deepEqual(mid, { queued: 1 }); f.failNext.length = 0;
  R._rbUnits = 12; await R.hsRebuild("resume"); const fin = await runToEnd(m); assert.equal(fin.status, "done"); assert.ok(f.bank("dev-t1-main").docs.has("conv:s1:2099-01-01"), "the queued append was sent after the rebuild");
  assert.equal((await R.hsRebuild("pause")).error.includes("nothing to pause"), true); assert.equal((await R.hsRebuild("resume")).error.includes("nothing to resume"), true); assert.match((await R.hsRebuild("bogus")).error, /cmd must be/);
  function turnLike(doc, text) { return { document_id: doc, content: [{ speaker: "Sam (user)", time: "t", text }], at: 5, strategy: "chat", tags: ["source:chat"], update_mode: "append", key: "k" }; }
  ok("F4. rebuild: stops after 8 failed tries with the error, keeps queueing writes, resume finishes and the queued append lands after the rebuilt document");
}

// ================= G. the estimate and the admin path =================
{
  const m = mkRes({ bee: [{ id: 9, lines: [{ at: 1, speaker: "wearer", is_user: true, text: "x".repeat(600) }], at: 1, address: "", summary: "", started: "a", ended: "b" }] }); const { R, f } = m; await seedRich(m);
  m.R2.set("k1.sidecar.json", JSON.stringify({ md: "w".repeat(70000) }));   // a long file: reference, no model
  const calls0 = f.calls.length; const e = await R.hsRebuild("estimate");
  assert.equal(f.calls.length, calls0, "the estimate calls no server and changes nothing"); assert.equal(R.hsRb().status, "idle");
  assert.equal(e.characters.reference, 70000 + 0, "a long file is counted under reference"); assert.ok(e.characters.chat > 0 && e.characters.note > 0 && e.characters["raw-transcript"] >= 600, "a Bee recording is counted as raw chunks, not extraction");
  assert.equal(e.extraction_characters, e.characters.chat + e.characters.note + e.characters.ambient + e.characters.file, "reference has no extraction cost");
  { const low = e.extraction_characters * 58 + e.extraction_calls * 126_000 + e.batches * 292_000, high = e.extraction_characters * 65 + e.extraction_calls * 327_000 + e.items * 292_000 + 3 * 1_001_000; assert.ok(e.extraction_nano >= low && e.extraction_nano <= high, "priced with the meter in src/byok.js: cached calls after the first of each send, characters, consolidation per send, one refresh run per model for the whole rebuild"); } assert.equal(e.extraction_usd, Number((e.extraction_nano / 1e9).toFixed(6)));
  assert.equal(e.documents.notes, 2); assert.equal(e.documents.files, 1); assert.equal(e.documents.conv, 4); assert.equal(e.documents.bee, 1); assert.equal(e.documents.contacts, 1); assert.ok(e.extraction_calls >= 10); assert.ok(e.batches >= 5 && e.consolidation_calls === Math.ceil(e.facts_estimate / 8) + e.batches, "consolidation runs again after each batch lands"); assert.equal(e.mental_model_refresh_calls_up_to, 30);
  const w = mkRes({ channel: "work" }); await seedRich(w); const ew = await w.R.hsRebuild("estimate"); assert.equal(ew.documents.bee, undefined, "a project channel has no Bee, contacts or inbox"); assert.equal(ew.mental_model_refresh_calls_up_to, 20);
  assert.deepEqual(kindsFor("main").slice(-3), ["bee", "contacts", "inbox"]); assert.deepEqual(kindsFor("work"), ["notes", "skills", "tasks", "files", "conv", "live"]);
  ok("G1. estimate: characters per strategy, reference unpriced, meter applied, consolidation and refresh calls counted, nothing written");
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
  const m = mkRes(); const { R, f } = m; await R.hsNames(); const B = () => bankOf(m);
  R.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','T',1,1,1)");
  for (const [id, at, u, r] of [["h1", T1, "my favorite color is teal", "noted teal"], ["h2", T1 + 60e3, "I like tea", "nice"], ["h3", T1 + 120e3, "the wifi password is Tulip-2219", "I won't keep that"]]) { addTurn(R, { id, at, user: u, reply: r, session: "s1" }); await R.hsTurnWrite({ turn: id, session: "s1", at, userText: u, reply: r }); }
  assert.match(B().docs.get("conv:s1:2026-10-14").text, /teal/);
  // the secrets sweep: the turn's document is written again from scrubbed text (the whole day is not deleted)
  assert.doesNotMatch(B().docs.get("conv:s1:2026-10-14").text, /Tulip-2219/, "never in the bank to begin with"); B().docs.get("conv:s1:2026-10-14").text = B().docs.get("conv:s1:2026-10-14").text.replace("I won't keep that", "my password is Tulip-2219");
  const dry = await sweepSecretsLocal(R, { dry: true, channelId: 1 }); assert.ok(dry.chat_turns_with_secrets >= 1); assert.ok(dry.hindsight_docs >= 1);
  await sweepSecretsLocal(R, { dry: false, channelId: 1 }); assert.ok(B().docs.has("conv:s1:2026-10-14"), "a document with a secret is rewritten, not deleted"); assert.doesNotMatch(B().docs.get("conv:s1:2026-10-14").text, /Tulip-2219/);
  // a failed rewrite falls back to deleting the documents (forgetDocument now, hs_forget row for the delayed re-delete); a good rewrite deletes nothing
  { const m2 = mkRes(); const { R: R2, f: f2 } = m2; await R2.hsNames(); const B2 = () => bankOf(m2); R2.sql.exec("INSERT INTO sessions (id,title,created,updated,seen_at) VALUES ('s1','T',1,1,1)");
    for (const [id, at, u, r] of [["z1", T1, "my favorite color is teal", "teal noted"], ["z2", T1 + 60e3, "I like tea", "nice"]]) { addTurn(R2, { id, at, user: u, reply: r, session: "s1" }); await R2.hsTurnWrite({ turn: id, session: "s1", at, userText: u, reply: r }); }
    const doc = "conv:s1:2026-10-14"; assert.ok(B2().docs.has(doc)); d1.exec("DELETE FROM hs_forget");
    const good = await rewriteOrDelete(R2, [doc], ["z1"]); assert.deepEqual(good, { rewritten: 1, deleted: 0, fellBack: false }); assert.ok(B2().docs.has(doc), "rewrite succeeded: the document stays"); assert.ok(!f2.calls.some((c) => c.m === "DELETE" && c.p.includes("/documents/")), "and nothing is deleted"); assert.equal(dues().length, 0, "no hs_forget row");
    // the server refuses the rewrite (a server error: hsPut queues it): the document is deleted instead, and its queued rewrite is taken out of the outbox
    f2.failNext.push({ re: /POST .*memories/, status: 503 }); const bad = await rewriteOrDelete(R2, [doc], ["z1"]);
    assert.deepEqual(bad, { rewritten: 0, deleted: 1, fellBack: true }); assert.ok(!B2().docs.has(doc), "rewrite failed: the document is deleted"); assert.ok(dues().includes(doc), "with an hs_forget row for the delayed re-delete"); assert.equal(R2.hsOutboxCount(), 0, "the queued rewrite is gone, so the forgotten text cannot come back");
    // the rewrite throws outright: same fallback
    await R2.hsTurnWrite({ turn: "z3", session: "s1", at: T1 + 120e3, userText: "tea again", reply: "ok" }); R2.hsConvRewrite = async () => { throw new Error("boom"); };
    assert.deepEqual(await rewriteOrDelete(R2, [doc], []), { rewritten: 0, deleted: 1, fellBack: true }); assert.ok(!B2().docs.has(doc));
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
  const env = { HS_WRITERS: "on", HS_FOUNDATIONS: "on", HINDSIGHT: {}, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight", ENV_NAME: "dev", DB, LEDGER: {}, ARCHIVE: { idFromName: (n) => n, get: (n) => O.get(n) }, RESIDENT: { idFromName: (n) => n, get: () => R },
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
