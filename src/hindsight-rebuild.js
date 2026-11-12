import { conversationMessages } from "./message-origin.js";
// Hydrate (docs/configuration.md, "Memory"): make one channel's Mem0 memory from 1HC's own records. A resumable job in the channel's Resident, driven by its alarm, behind
// the added-only RPC method hsRebuild(cmd) with cmd start, pause, resume, status or estimate. It runs once, the first time the channel is used (hsHydrate in
// hindsight-writers.js), and the dev ops path can start it by hand.
//
// The order of work for one channel (state in the Resident's key value store, key hs_rb, saved before every step):
//   reset    mark the channel as rebuilding (writers queue into hs_outbox)
//   send     the source list, oldest first (notes, skills, task cards, files, conversations by day, live notes, Bee conversations, contacts, voice
//            inbox), in batches. The cursor (the place the batch starts) is saved before it is sent, so a resumed job sends the same batch again, and a
//            document written twice is replaced, never doubled
//   flush    the outbox (what was written while the channel rebuilt), then clear the rebuilding mark
//   verify   count the documents of every kind against what was sent. A document the extraction found no fact in (a bare task card, a one line chat) has no rows,
//            so each page also records which of its documents have none (sent.empty), and verify accepts in_memory + empty = sent
//   recount  only for a finished run whose report said mismatch (cmd "reconcile"): walks the source again with no extraction, counts the documents and the ones
//            with no rows from D1, then flush and verify give a new report
// The source is read live and only records up to the snapshot time are in it, so a record deleted during the rebuild just is not sent, and
// anything written after the snapshot arrives through the outbox. A delete that arrives mid rebuild also removes the queued writes of that
// document and goes through hs_forget (deletion.js), which deletes what was already sent. Pause stops after the current batch and resume
// goes on from the cursor.
import { retainV2, contentHash, hsOn, bankId, memoryCounts, docsWithFacts } from "./mem0.js";
import { speakerLabels } from "./hindsight-template.js";
import { hsEnvelope } from "./hs-flag.js";
import { withEnvelope, makeEnvelope } from "./memory-envelope.js";   // HS_ENVELOPE: a rebuilt conversation keeps the places its turns had
import { TURN_PLACE, REBUILD_VERSION } from "./hindsight-writers.js";
export { REBUILD_VERSION };
import { beeEnveloped } from "./adapters/bee.js";
// A rebuilt conversation document's envelope: the day's span, the latest place of its turns, and every place as an entity.
function rbEnvelope(g, item) {
  const base = { kind: g.kind || null, kind1hc: "message", modality: "text", when: { start: g.at, end: g.end, tzSource: "account", how: "capture" }, links: { session: g.session }, source: g.kind === "chat" ? "user" : "assistant" };
  if (!g.places || !g.places.length) return g.env ? withEnvelope(item, makeEnvelope(base)) : item;
  const last = g.places[g.places.length - 1], e = makeEnvelope({ ...base, where: { place: last.place, placeFrom: "geocoded", lat: last.lat, lng: last.lng, how: "device" } });
  const out = withEnvelope(item, e), have = new Set((out.entities || []).map((x) => x.text.toLowerCase()));
  for (const p of g.places) if (p.place && !have.has(p.place.toLowerCase())) { have.add(p.place.toLowerCase()); (out.entities ||= []).push({ text: p.place, type: "LOCATION" }); }
  return out;
}
import { sendBackfillSnapshot } from "./backfill-trace.js";
import { hsRetainBatchNano } from "./byok-meter.js";
import { EXTRACT_CHARS } from "./mem0-store.js";
import { memoryReply } from "./status-notes.js";
import { cardsToText } from "./genui.js";
import { hsWriters, DOC, docKind, STRATEGY, convEntries, convSession, dayKey, dayRange, sliceEntries, turnItem, noteItem, skillItem, taskItem, fileItem, liveEntries, liveItem, RAW_CHUNK_CHARS, beeEntries, beeItem, contactItem, inboxItem, ctxFor, rounds, itemChars, itemExtractChars } from "./hindsight-writers.js";

export const KINDS_GENERAL = ["notes", "skills", "tasks", "files", "conv", "live", "bee", "contacts", "inbox"];
export const KINDS_CHANNEL = ["notes", "skills", "tasks", "files", "conv", "live"];
export const kindsFor = (channel) => (channel === "main" ? KINDS_GENERAL : KINDS_CHANNEL);
export const BATCH_ITEMS = 4, STEP_MS = 20e3, STEP_UNITS = 12, MAX_TRIES = 8, STALL_MS = 45 * 60e3;   // a batch is a few extraction calls, so a step stays short
const jp = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const now = () => Date.now();
// Which kind of document an id is, in the words the report uses.
const KIND_OF_DOC = { conv: "conv", note: "notes", file: "files", live: "live", skill: "skills", task: "tasks", contact: "contacts", inbox: "inbox", bee: "bee" };
export const reportKind = (doc) => KIND_OF_DOC[docKind(doc)] || "other";
// Prefixes of each kind's document ids, for the counts.
const Q = { notes: "note:", skills: "skill:", tasks: "task:", files: "file:", conv: "conv:", live: "live:", bee: "bee:conv:", contacts: "contact:", inbox: "inbox:" };

// A state with defaults. status: idle | running | paused | failed | done.
const blank = () => ({ v: REBUILD_VERSION, status: "idle", phase: null, snapshot: 0, started: 0, updated: 0, finished: 0, kind: null, after: "", next: null, tries: 0, retry_at: 0, error: null,
  pause: false, step: null, sent: { docs: {}, empty: {}, items: 0, chars: 0, batches: 0 }, rd: null, reconciled: 0, outbox_flushed: 0, dropped: 0, report: null });

export const rebuildMethods = {
  hsRb() { const x = jp(this.get("hs_rb")); return x?.v === REBUILD_VERSION ? { ...blank(), ...x } : blank(); },   // the saved state of another version is the Hindsight rebuild: it means nothing here
  hsRbSave(s) { s.updated = now(); this.put("hs_rb", JSON.stringify(s)); this.ctx?.waitUntil?.(this.hsRbSync(s)); return s; },
  // A row in D1 (hs_rebuild_runs) so the dev ops path can see every bank's state and count how many run at once.
  async hsRbSync(s) {
    try {
      await this.env.DB.prepare("CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT)").run();
      // A change of status sends one snapshot of the counts to Langfuse (backfill-trace.js). The last status is kept in memory, and read from D1 after a restart.
      const before = this._rbStatus ?? (await this.env.DB.prepare("SELECT status FROM hs_rebuild_runs WHERE bank=?").bind(this.hsBankId()).first())?.status ?? null; this._rbStatus = s.status;
      await this.env.DB.prepare("INSERT INTO hs_rebuild_runs (bank, tenant, channel, status, phase, version, started_at, updated_at, summary) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(bank) DO UPDATE SET status=excluded.status, phase=excluded.phase, version=excluded.version, started_at=excluded.started_at, updated_at=excluded.updated_at, summary=excluded.summary")
        .bind(this.hsBankId(), this.get("tenant"), this.get("channel"), s.status, s.phase, REBUILD_VERSION, s.started || null, now(), JSON.stringify({ kind: s.kind, sent: s.sent.items, error: s.error, report: s.report && { ok: s.report.ok, counts: s.report.counts } })).run();
      if (before !== s.status && !(await this.hsTestOwner())) this.ctx?.waitUntil?.(sendBackfillSnapshot(this.env, { kind: "change" }));
    } catch (e) { console.log("hs rebuild row", String(e?.message || e).slice(0, 100)); }
  },
  // The next time the alarm should run this job (null when nothing is due).
  hsRebuildNext() { if (!hsWriters(this.env)) return null; const s = this.hsRb(); return s.status === "running" ? Math.max(s.retry_at || 0, now() + 500) : null; },
  async hsRebuildAlarm() {
    if (!this.hsW()) return null; const s0 = this.hsRb(); if (s0.status !== "running") return null;
    if (s0.retry_at && s0.retry_at > now()) return null;
    return this.hsRbStep();
  },
  // Hydrate: the first use of a channel makes its memory from its own records, once. A failed job (8 failed steps in a row) goes on from its saved cursor on the first use
  // after 10 minutes, so the batches already stored are not read or extracted again, and the sent counts keep growing. A test account's channel never starts by
  // itself, so an idle test account costs nothing; the dev ops path (hsRebuild "start") hydrates it on request.
  async hsHydrate() {
    const s = this.hsRb();
    // A run that finished before the empty documents were counted (report.ok false) is counted again once, from D1 and the source, with no extraction.
    const recount = s.status === "done" && s.report?.ok === false && !s.reconciled;
    if (!hsWriters(this.env) || !hsOn(this.env) || this.memoryMode() === "off" || !this.get("tenant") || !(s.status === "idle" || recount || (s.status === "failed" && now() - s.updated > 600e3))) return;
    if (!(await this.hsTestOwner())) await this.hsRebuild(recount ? "reconcile" : s.status === "failed" ? "resume" : "start");
  },
  // The RPC method. cmd: start | pause | resume | status | estimate. o: { force, live } for status (live reads the server), { force } for start.
  async hsRebuild(cmd = "status", o = {}) {
    if (!hsWriters(this.env)) return { error: "HS_WRITERS is off" };
    if (!hsOn(this.env)) return { error: "Memory is not configured" };
    if (!this.get("tenant")) return { error: "no such channel" };
    const s = this.hsRb();
    if (cmd === "status") return this.hsRbView(s, !!o.live);
    if (cmd === "estimate") return this.hsEstimate(o);
    if (cmd === "start") {
      if (s.status === "running" || s.status === "paused") return { error: `a rebuild is already ${s.status} (resume or wait)`, ...(await this.hsRbView(s)) };
      if (this.memoryMode() === "off") return { error: "memory is off for this channel" };
      const st = { ...blank(), status: "running", phase: "reset", snapshot: now(), started: now() };
      this.hsRbSave(st); await this.arm(); return { started: true, ...(await this.hsRbView(st)) };
    }
    if (cmd === "reconcile") {
      // No extraction: only the source is read again. Allowed for a finished run with a mismatch report (o.force: any finished run).
      if (s.status !== "done" || (!o.force && s.report?.ok !== false)) return { error: `nothing to reconcile (${s.status}${s.report ? `, ok ${s.report.ok}` : ""})`, ...(await this.hsRbView(s)) };
      if (this.memoryMode() === "off") return { error: "memory is off for this channel" };
      const st = { ...s, status: "running", phase: "recount", snapshot: now(), kind: kindsFor(this.get("channel"))[0], after: "", next: null, rd: null, tries: 0, retry_at: 0, error: null, pause: false, finished: 0,
        sent: { ...s.sent, docs: {}, empty: {} }, outbox_flushed: 0, dropped: 0, live_rewound: [], reconciled: now() };
      this.hsRbSave(st); await this.arm(); return { reconciling: true, ...(await this.hsRbView(st)) };
    }
    if (cmd === "pause") { if (s.status !== "running") return { error: `nothing to pause (${s.status})`, ...(await this.hsRbView(s)) }; s.pause = true; this.hsRbSave(s); return { pausing: true, ...(await this.hsRbView(s)) }; }
    if (cmd === "resume") {
      if (s.status !== "paused" && s.status !== "failed") return { error: `nothing to resume (${s.status})`, ...(await this.hsRbView(s)) };
      s.status = "running"; s.pause = false; s.error = null; s.tries = 0; s.retry_at = 0; this.hsRbSave(s); await this.arm(); return { resumed: true, ...(await this.hsRbView(s)) };
    }
    return { error: "cmd must be start, pause, resume, reconcile, status or estimate" };
  },
  async hsRbView(s, live = false) {
    const v = { status: s.status, phase: s.phase, kind: s.kind, after: s.after ? String(s.after).slice(0, 40) : "", started_at: s.started || null, updated_at: s.updated || null, finished_at: s.finished || null, snapshot: s.snapshot || null,
      sent: { items: s.sent.items, chars: s.sent.chars, batches: s.sent.batches, docs: s.sent.docs, empty: s.sent.empty || {} }, outbox: this.hsOutboxCount(), outbox_flushed: s.outbox_flushed, dropped_during: s.dropped, last_error: s.error, tries: s.tries, report: s.report, pause_requested: !!s.pause };
    if (live && hsOn(this.env)) { try { v.stored = await memoryCounts(this.env, this.hsBankId()); } catch (e) { v.stored = { error: String(e.message || e).slice(0, 120) }; } }
    return v;
  },

  // ---- one step of the job: bounded work, then the state is saved and the alarm armed again ----
  async hsRbStep() {
    const s = this.hsRb(), t0 = now(); let arm = true, units = 0;
    try {
      while (s.status === "running" && now() - t0 < STEP_MS && units++ < (this._rbUnits ?? STEP_UNITS)) {   // a step is bounded in time and in units of work (a batch, a poll), so an alarm stays short
        if (s.pause && s.phase !== "reset") { s.status = "paused"; s.pause = false; this.hsRbSave(s); arm = false; break; }
        const r = await this.hsRbPhase(s);
        if (r === "wait") break;     // the server is busy: look again at the next alarm
        if (r === "done") { arm = false; break; }
      }
      s.tries = 0; s.error = null; this.hsRbSave(s);
    } catch (e) {
      s.tries = (s.tries || 0) + 1; s.error = String(e?.message || e).slice(0, 300);
      if (s.tries >= MAX_TRIES) { s.status = "failed"; arm = false; }
      else s.retry_at = now() + Math.min(10 * 60e3, 15e3 * 2 ** (s.tries - 1));
      this.hsRbSave(s); console.log("memory rebuild step", s.phase, s.error);
    }
    if (arm) await this.arm().catch(() => {});
    return this.hsRbView(this.hsRb());
  },
  // One unit of the current phase. Returns "wait" to stop this step, "done" at the end, anything else to go on.
  async hsRbPhase(s) {
    if (s.phase === "reset") {
      // A live notes session that is running now already sent its earlier lines before this job began: its position goes back to the start, so the outbox gets all of its lines.
      if (!s.live_rewound) { s.live_rewound = []; try { for (const r of this.sql.exec("SELECT session, st FROM live_notes").toArray()) { const v = jp(r.st); if (!["live", "finalizing"].includes(v?.status)) continue; const x = await this.lnStub(r.session)?.hsLiveRewind?.(); if (x?.n) s.live_rewound.push(`${r.session}:${x.n}`); } } catch (e) { console.log("live rewind", String(e?.message || e).slice(0, 100)); } }
      this.put("hs_bank", this.hsBankId()); s.phase = "send"; s.kind = kindsFor(this.get("channel"))[0]; s.after = ""; this.hsRbSave(s);
      return "go";
    }
    if (s.phase === "send") return this.hsRbSend(s);
    if (s.phase === "recount") return this.hsRbRecount(s);
    if (s.phase === "flush") return this.hsRbFlush(s);
    if (s.phase === "verify") return this.hsRbVerify(s);
    throw new Error(`unknown phase ${s.phase}`);
  },
  async hsRbSend(s) {
    const env = this.env, bank = this.hsBankId(), kinds = kindsFor(this.get("channel"));
    // The batch starts at the saved cursor. Its end is saved before it is sent (inflight), so a resume sends the same batch again.
    const page = await this.hsSourcePage(s.kind, s.after, s.snapshot);
    s.next = { kind: page.done ? (kinds[kinds.indexOf(s.kind) + 1] || null) : s.kind, after: page.done ? "" : page.next }; this.hsRbSave(s);
    const items = page.items.filter((i) => itemChars(i) > 0), pageKey = `${s.kind}|${s.after}`;
    // A page that is sent again (a step failed after some of its rounds) sends every round again, which only replaces documents, but counts only the rounds it has not counted:
    // s.rd says how many rounds of this page are counted, and is saved with the counts.
    const counted = s.rd?.k === pageKey ? s.rd.n : 0, rs = rounds(items, BATCH_ITEMS);
    for (let n = 0; n < rs.length; n++) {
      const r = rs[n]; await retainV2(env, bank, r);
      if (n < counted) continue;
      s.sent.batches++; s.sent.items += r.length; s.sent.chars += r.reduce((x, i) => x + itemChars(i), 0);
      for (const i of r) if (i.update_mode !== "append") { const k = reportKind(i.document_id); s.sent.docs[k] = (s.sent.docs[k] || 0) + 1; }
      s.rd = { k: pageKey, n: n + 1 }; this.hsRbSave(s);
    }
    await this.hsRbEmpty(s, items);   // after the last round, because a document's appended lines may come in a later round of the page
    if (s.next.kind) { s.kind = s.next.kind; s.after = s.next.after; } else { s.phase = "flush"; s.kind = null; s.after = ""; }
    s.next = null; s.rd = null; this.hsRbSave(s);
    return "go";
  },
  // The documents of a page that have no fact in D1 (the extraction found none): counted once per kind, in the same save that moves the cursor past the page. No model call.
  async hsRbEmpty(s, items) {
    const docs = [...new Set(items.filter((i) => i.update_mode !== "append").map((i) => i.document_id))]; if (!docs.length) return;
    const have = await docsWithFacts(this.env, this.hsBankId(), docs); s.sent.empty ||= {};
    for (const d of docs) if (!have.has(d)) { const k = reportKind(d); s.sent.empty[k] = (s.sent.empty[k] || 0) + 1; }
  },
  // Reconcile (cmd "reconcile"): count the source again without extraction. The documents of each page are counted as sent, and the ones with no rows as empty.
  async hsRbRecount(s) {
    const kinds = kindsFor(this.get("channel")), page = await this.hsSourcePage(s.kind, s.after, s.snapshot);
    s.next = { kind: page.done ? (kinds[kinds.indexOf(s.kind) + 1] || null) : s.kind, after: page.done ? "" : page.next };
    const items = page.items.filter((i) => itemChars(i) > 0);
    for (const d of new Set(items.filter((i) => i.update_mode !== "append").map((i) => i.document_id))) { const k = reportKind(d); s.sent.docs[k] = (s.sent.docs[k] || 0) + 1; }
    await this.hsRbEmpty(s, items);
    if (s.next.kind) { s.kind = s.next.kind; s.after = s.next.after; } else { s.phase = "flush"; s.kind = null; s.after = ""; }
    s.next = null; this.hsRbSave(s); return "go";
  },
  async hsRbFlush(s) {
    // The outbox, oldest first. The rebuilding mark is cleared in the same step in which the outbox is seen empty (no await between), so a write can never slip past it.
    const n = await this.hsFlush({ max: 40, paid: false }); s.outbox_flushed += n.sent || 0;
    if (this.hsOutboxCount() > 0) { if (!n.sent) s.retry_at = now() + 5e3; this.hsRbSave(s); return n.sent ? "go" : "wait"; }
    s.retry_at = 0; s.phase = "verify"; this.hsRbSave(s); return "go";
  },
  async hsRbVerify(s) {
    const kinds = kindsFor(this.get("channel")), counts = {};
    for (const k of kinds) counts[k] = { sent: s.sent.docs[k] || 0, empty: s.sent.empty?.[k] || 0, in_memory: (await memoryCounts(this.env, this.hsBankId(), Q[k])).documents };
    const slack = s.dropped + s.outbox_flushed;   // documents deleted or added while the channel rebuilt explain a difference. A document with no fact (empty) counts as stored, a document missing for any other reason does not
    const mismatched = Object.entries(counts).filter(([, c]) => Math.abs(c.in_memory + c.empty - c.sent) > slack).map(([k]) => k);
    s.report = { ok: !mismatched.length, mismatched, counts, stored: await memoryCounts(this.env, this.hsBankId()), sent: { items: s.sent.items, chars: s.sent.chars, batches: s.sent.batches }, duration_ms: now() - s.started, ...(s.reconciled ? { reconciled: s.reconciled } : {}) };
    s.status = "done"; s.phase = "done"; s.finished = now(); this.hsRbSave(s); return "done";
  },
  // A document was deleted while the bank rebuilds: counted, so the verify step can explain the difference.
  hsRbDropped(n = 1) { const s = this.hsRb(); if (s.status === "running" || s.status === "paused") { s.dropped += n; this.hsRbSave(s); } },

  // ---------------------------------------------------------------- the source (DESIGN 5.2, step 3) ----------------------------------------------------------------
  // One page of the source of one kind, after the cursor `after`, with only records made by the snapshot time. → { items, next, done }.
  async hsSourcePage(kind, after = "", snap = now(), o = {}) {
    const lim = o.limit || BATCH_ITEMS, { names, tz, channel } = await this.hsLocal(), sql = this.sql;
    const k2 = (a, b) => `${String(Number(a) || 0).padStart(15, "0")}|${b}`;
    if (kind === "notes") {
      const r = await this.archive().noteRows(String(this.get("channel_id")), after, lim, snap);
      return { items: r.rows.map((row) => noteItem({ row, names, channel })), next: r.next, done: r.done };
    }
    if (kind === "skills") {
      let rows = []; try { rows = sql.exec("SELECT slug, description, body, created, updated FROM channel_skills ORDER BY created, slug").toArray(); } catch {}
      rows = rows.filter((r) => !after || k2(r.created, r.slug) > after); const page = rows.slice(0, lim);
      return { items: page.map((r) => skillItem({ slug: r.slug, description: r.description, body: r.body, at: r.updated, names, channel })), next: page.length ? k2(page.at(-1).created, page.at(-1).slug) : null, done: rows.length <= lim };
    }
    if (kind === "tasks") {
      const rows = sql.exec("SELECT id, title, created, updated FROM sessions ORDER BY created, id").toArray().filter((r) => Number(r.created) <= snap && (!after || k2(r.created, r.id) > after)), page = [], out = [];
      for (const r of rows) { if (page.length >= lim) break; page.push(r); const items = this.todoRow(r.id).items || [];
        out.push(taskItem({ session: r.id, title: r.title, created: r.created, updated: r.updated, items, names, channel })); }
      return { items: out, next: page.length ? k2(page.at(-1).created, page.at(-1).id) : null, done: rows.length <= lim };
    }
    if (kind === "files") {
      const rows = sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND hidden=0 AND at<=? ORDER BY at, id", snap).toArray().filter((r) => !after || k2(r.at, r.id) > after), page = rows.slice(0, lim), out = [];
      for (const f of page) { const r = await this.hsFileText(f); if (r) out.push(await this.hsFileEnrich(f, fileItem({ id: f.id, name: f.name, md: r.md, kind: r.kind, at: Number(f.at) || Date.now(), names, mime: f.mime, channel }))); }
      return { items: out, next: page.length ? k2(page.at(-1).at, page.at(-1).id) : null, done: rows.length <= lim };
    }
    if (kind === "conv") return this.hsConvPage(after, snap, { names, tz, channel });
    if (kind === "live") return this.hsLivePage(after, lim, { names, tz, channel });
    if (kind === "bee") {
      const B = this.env.BEE_SYNC?.get(this.env.BEE_SYNC.idFromName(this.get("tenant"))); if (!B) return { items: [], next: null, done: true };
      const r = await B.hsBeeSource(after, Math.min(lim, 10), snap), out = [];
      for (const c of r.items) { const entries = beeEntries(c.lines, { first: names.first, tz }); if (entries.length) { const it = beeItem({ id: c.id, entries, at: c.at, address: c.address, summary: c.summary, started: c.started, ended: c.ended, names }); out.push(hsEnvelope(this.env) ? beeEnveloped(it, c, { first: names.first }) : it); } }
      return { items: out, next: r.next, done: r.done };
    }
    if (kind === "contacts") {
      const all = (await this.archive().peopleList()).filter((p) => p?.name && Number(p.created || 0) <= snap).sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id))), rows = all.filter((p) => !after || k2(p.created, p.id) > after).slice(0, lim);
      return { items: rows.map((p) => contactItem({ p, names })), next: rows.length ? k2(rows.at(-1).created, rows.at(-1).id) : null, done: all.filter((p) => !after || k2(p.created, p.id) > after).length <= lim };
    }
    if (kind === "inbox") {
      const B = this.env.BEE_SYNC?.get(this.env.BEE_SYNC.idFromName(this.get("tenant"))); if (!B) return { items: [], next: null, done: true };
      const r = await B.hsInboxSource(after, Math.min(lim, 40));
      return { items: r.items.filter((it) => !it.source_at || it.source_at <= snap).map((it) => inboxItem({ it, names, tz })), next: r.next, done: r.done };
    }
    throw new Error(`unknown source kind ${kind}`);
  },
  // Conversations: one document per task and local day. The cursor is a day ("2026-10-14"): the page is every document of the next day with turns.
  async hsConvPage(after, snap, ctx) {
    const sql = this.sql, from = after ? dayRange(after, ctx.tz).end : 0;
    const first = sql.exec("SELECT MIN(at) a FROM turns WHERE at>=? AND at<=?", from, snap).toArray()[0]?.a;
    if (first == null) return { items: [], next: after || null, done: true };
    const day = dayKey(Number(first), ctx.tz), { start, end } = dayRange(day, ctx.tz), r = this.hsConvItems({ start, end: Math.min(end, snap + 1), ...ctx, day });
    const more = sql.exec("SELECT 1 FROM turns WHERE at>=? AND at<=? LIMIT 1", end, snap).toArray().length > 0;
    return { items: r.items, next: day, done: !more };
  },
  // The conversation documents of the turns in [start, end): { items }. only: a set of document ids to build (forget), exclude: turn ids left out.
  hsConvItems({ start, end, names, tz, channel, day, only = null, exclude = null }) {
    const sql = this.sql, L = speakerLabels(names), docs = new Map();
    let partial = new Map(); try { partial = new Map(sql.exec("SELECT turn, text FROM work_log_partial").toArray().map((r) => [String(r.turn), r.text])); } catch {}
    // A turn (or its unfinished work) that is waiting in the outbox is left out here: it is sent from there, and sending it twice would repeat its lines.
    let queued = new Set(); try { this.hsOutboxInit(); queued = new Set((only?.size ? sql.exec(`SELECT ref FROM hs_outbox WHERE ref IS NOT NULL AND doc IN (${[...only].map(()=>"?").join(",")})`, ...only) : sql.exec("SELECT ref FROM hs_outbox WHERE ref IS NOT NULL")).toArray().map((r) => r.ref)); } catch {}
    const env = hsEnvelope(this.env); let places = new Map();
    if (env) { try { sql.exec(TURN_PLACE); places = new Map(sql.exec("SELECT p.turn, p.place, p.lat, p.lng FROM hs_turn_place p JOIN turns t ON t.id=p.turn WHERE t.at>=? AND t.at<?", start, end).toArray().map((r) => [String(r.turn), r])); } catch {} }
    for (const t of sql.exec("SELECT id, at, kind, session, workflow_id, user_text, reply, notes, total_ms, error FROM turns WHERE at>=? AND at<? ORDER BY at, id LIMIT 5000", start, end).toArray()) {
      if (t.kind === "livenote" || t.kind === "helper" || exclude?.has(String(t.id)) || queued.has(String(t.id))) continue;
      const doc = DOC.conv(convSession(t.session, t.workflow_id), dayKey(Number(t.at), tz)); if (only && !only.has(doc)) continue;
      const part = queued.has(`p:${t.id}`) ? null : partial.get(String(t.id)), notes = part && t.notes === part ? null : t.notes;
      const entries = convEntries({ userText: t.user_text, reply: t.error ? "" : cardsToText(memoryReply(t.reply || "")), notes, partial: part, at: Number(t.at), endAt: Number(t.at) + (Number(t.total_ms) || 0), kind: t.kind || "chat", labels: L, tz, userMessages: conversationMessages(sql, t.id, { text: t.user_text, at: Number(t.at), kind: t.kind || "chat" }) });
      if (!entries.length) continue;
      const pl = places.get(String(t.id)); if (pl?.place) entries[0] = { ...entries[0], place: pl.place };
      const g = docs.get(doc) || { doc, session: convSession(t.session, t.workflow_id), day: dayKey(Number(t.at), tz), at: Number(t.at), end: Number(t.at), kind: t.kind || "chat", entries: [], places: [], env }; g.entries.push(...entries); g.end = Number(t.at); if (pl) g.places.push(pl); docs.set(doc, g);
    }
    const items = [];
    for (const g of docs.values()) sliceEntries(g.entries).forEach((slice, n) => items.push(rbEnvelope(g, turnItem({ doc: g.doc, entries: slice, at: g.at, context: ctxFor(g.kind === "chat" ? "chat" : "scheduled", names), channel, session: g.session, day: g.day, key: `rb${n}`, mode: n ? "append" : "replace" }))));
    return { items, docs: [...docs.keys()] };
  },
  // Live notes: the saved transcripts of sessions whose task still exists, oldest first by their upload time.
  async hsLivePage(after, lim, ctx) {
    const tid = this.get("tenant"), prefix = `t/${tid}/bee/live/${this.get("channel")}/`, all = [];
    let cursor; for (let i = 0; i < 5; i++) { const l = await this.env.WS.list({ prefix, cursor, limit: 1000 }); all.push(...(l.objects || [])); if (!l.truncated) break; cursor = l.cursor; }
    const key = (o) => `${String(new Date(o.uploaded).getTime() || 0).padStart(15, "0")}|${o.key}`, rows = all.map((o) => ({ o, k: key(o) })).filter((x) => /\/s\d+\.json$/.test(x.o.key)).sort((a, b) => (a.k < b.k ? -1 : 1)).filter((x) => !after || x.k > after), page = rows.slice(0, Math.min(lim, 5)), items = [];
    for (const x of page) {
      const m = x.o.key.match(/\/live\/[^/]+\/([^/]+)\/s(\d+)\.json$/); if (!m || !this.session(m[1])) continue;
      if ((this.hsRb().live_rewound || []).includes(`${m[1]}:${m[2]}`)) continue;   // sent from the outbox instead (its lines were rewound when the rebuild began)
      const o = await this.env.WS.get(x.o.key); if (!o) continue; let d; try { d = JSON.parse(await o.text()); } catch { continue; }
      const mic = d.source === "mic", entries = liveEntries((d.utterances || []).map((u) => ({ at: u.at, speaker: u.speaker, text: u.text })), { first: ctx.names.first, tz: ctx.tz, mic });
      sliceEntries(entries).forEach((slice, n) => items.push(liveItem({ task: m[1], n: Number(m[2]), entries: slice, at: Number(d.started_at) || Date.now(), names: ctx.names, channel: ctx.channel, key: `rb${n}`, mode: n ? "append" : "replace" })));
    }
    return { items, next: page.length ? page.at(-1).k : null, done: page.length < Math.min(lim, 5) };
  },
  // The documents of the turns that had to be taken out (forget, secrets sweep): the day's document is written again without them (a replace takes
  // the old facts out of the bank), and a document left with nothing is deleted. docs: conversation document ids. exclude: turn ids to leave out.
  async hsConvRewrite(docs, exclude = []) {
    if (!this.hsW()) return { skipped: "off" };
    const ids = [...new Set(docs.filter((d) => docKind(d) === "conv"))]; if (!ids.length) return { rewritten: 0, dropped: 0 };
    const { names, tz, channel } = await this.hsLocal(), ex = new Set(exclude.map(String)); let rewritten = 0, dropped = 0;
    for (const doc of ids) {
      const day = doc.slice(doc.lastIndexOf(":") + 1), { start, end } = dayRange(day, tz), r = this.hsConvItems({ start: start - 86400e3, end: end + 86400e3, names, tz, channel, day, only: new Set([doc]), exclude: ex });
      if (!r.items.length) { await this.hsDropDocs([doc]); dropped++; continue; }
      this.hsOutboxInit(); this.sql.exec("DELETE FROM hs_outbox WHERE doc=? AND del=0", doc);
      const out = await this.hsPut(r.items.map((i, n) => ({ ...i, key: `fg${Date.now()}.${n}` })), { rebuild: false });
      // Queued, dropped or skipped is not written: the caller deletes the document instead (forget.js rewriteOrDelete).
      if (out.queued || out.dropped || out.skipped) { this.hsOutboxInit(); this.sql.exec("DELETE FROM hs_outbox WHERE doc=? AND del=0", doc); throw new Error(`the conversation document could not be written again (${out.skipped || (out.dropped ? "refused" : "queued")})`); }
      rewritten++;
    }
    return { rewritten, dropped };
  },

  // ---------------------------------------------------------------- the estimate (dry run) ----------------------------------------------------------------
  // Counts characters per strategy over the whole source and prices the extraction with the meter in src/byok.js. Changes nothing. A Bee channel with many
  // recordings reads the first `bee_reads` and extrapolates.
  async hsEstimate(o = {}) {
    const snap = now(), kinds = kindsFor(this.get("channel")), per = {}, docs = {}, strat = { chat: 0, note: 0, ambient: 0, file: 0, reference: 0, [STRATEGY.rawTranscript]: 0, [STRATEGY.verbatim]: 0 };
    let calls = 0, chunks = 0, items = 0, retainNano = 0, partial = false;
    for (const kind of kinds) {
      let after = ""; docs[kind] = 0;
      for (let i = 0; i < 400; i++) {
        const page = await this.hsSourcePage(kind, after, snap, { limit: kind === "conv" ? 20 : 40 });
        retainNano += hsRetainBatchNano(page.items.map(itemExtractChars));
        for (const it of page.items) {
          const n = itemChars(it), sname = it.strategy || STRATEGY.chat; items++; strat[sname] = (strat[sname] || 0) + n;
          if (it.update_mode !== "append") docs[kind]++;
          if (itemExtractChars(it)) calls += Math.max(1, Math.ceil(n / EXTRACT_CHARS)); else chunks += Math.max(1, Math.ceil(n / (it.strategy === STRATEGY.rawTranscript ? RAW_CHUNK_CHARS : 3000)));
        }
        if (page.done || !page.next) break; after = page.next;
        if (kind === "bee" && i >= (o.bee_reads ?? 30)) { partial = true; break; }
      }
      per[kind] = docs[kind];
    }
    return { channel: this.get("channel"), documents: per, items, characters: strat, extraction_calls: calls, raw_chunks: chunks, extraction_nano: retainNano, extraction_usd: Number((retainNano / 1e9).toFixed(6)),
      note: "Dollars are the retain meter in src/byok.js (hsRetainBatchNano: one cold extraction call per send then cached ones, one call for every 12,000 characters), before the 15% markup. Compare with the AI Gateway log of mem_extract (kind memory-extract) after a real run.", ...(partial ? { partial: "the Bee conversations were cut short for speed" } : {}) };
  },
};
export const rebuildMix = (Cls) => Object.assign(Cls.prototype, rebuildMethods);

// ---------------------------------------------------------------- the dev admin path (POST /_ops/hs-rebuild) ----------------------------------------------------------------
// action=estimate | start | status | pause | resume. dry (start only, default 1): report what would start. slug: one account. channel: one channel of it.
// limit: how many banks this call touches (start: at most 2 run at a time in total). offset pages through the list. only_test=1: accounts whose email ends in @example.com.
export const MAX_RUNNING = 2, STALE_RUN_MS = 30 * 60e3;   // a row that says running but has not changed for 30 minutes is a job that died, and does not use a slot
const live = (r) => r.status === "running" && Number(r.updated_at) > now() - STALE_RUN_MS;
const archiveOf = (env, tid) => env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tid}`)), residentOf = (env, tid, slug) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:${slug}`));
export const ADMIN_BUDGET_MS = 25e3, ADMIN_MAX_TENANTS = 5;
const parseJ = (x) => { try { return JSON.parse(x); } catch { return null; } };
const short = (b) => `${b.slice(0, 4)}..${b.slice(-6)}`;
const raceMs = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timed out")), Math.max(1, ms)); })]).finally(() => clearTimeout(t)); };
// Every call does a bounded amount of work and answers within ADMIN_BUDGET_MS. It pages by tenant: offset and limit count accounts (at most
// ADMIN_MAX_TENANTS per call), never banks, and the Archive of an account is asked for its channels only when that account is reached.
// status reads D1 (hs_rebuild_runs) only, unless live=1 asks the channel's Resident for its own view (one channel, needs slug and channel).
export async function hsRebuildAdmin(env, action, { dry = true, slug = "", channel = "", limit = 2, offset = 0, onlyTest = false, live: wantLive = false, now: clock = Date.now, budgetMs = ADMIN_BUDGET_MS } = {}) {
  if (!hsWriters(env)) return { error: "HS_WRITERS is off" };
  if (!["estimate", "start", "status", "pause", "resume", "reconcile"].includes(action)) return { error: "action must be estimate, start, status, pause, resume or reconcile" };
  if (env.ENV_NAME !== "dev") return { error: "dev only" };
  const t0 = clock(), left = () => budgetMs - (clock() - t0);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT)").run().catch(() => {});
  const runs = (await env.DB.prepare("SELECT * FROM hs_rebuild_runs").all().catch(() => ({ results: [] }))).results || [], byBank = new Map(runs.map((r) => [r.bank, r]));
  const runningNow = runs.filter(live).length;
  const row0 = (r) => ({ bank: short(r.bank), channel: r.channel, status: r.status, phase: r.phase, updated_at: r.updated_at, summary: parseJ(r.summary) });
  limit = Math.min(ADMIN_MAX_TENANTS, Math.max(1, limit | 0 || 2)); offset = Math.max(0, offset | 0);
  let tenantRow = null;
  if (slug) { tenantRow = await env.DB.prepare("SELECT id, slug FROM tenants WHERE slug=?").bind(slug).first(); if (!tenantRow) return { error: "no such workspace" }; }
  if (action === "status" && !wantLive) {
    const mine = tenantRow ? runs.filter((r) => r.tenant === tenantRow.id && (!channel || r.channel === channel)) : runs, by = {}; for (const r of mine) by[r.status] = (by[r.status] || 0) + 1;
    return { counts: by, running: runningNow, max_running: MAX_RUNNING, banks: mine.sort((a, b) => b.updated_at - a.updated_at).slice(0, 100).map(row0) };
  }
  if (action === "status" && !(slug && channel)) return { error: "live=1 needs slug and channel (one Resident is asked)" };
  // the accounts of this page: one SQL page, never every account
  const q = ["SELECT t.id, t.slug FROM tenants t"], args = [];
  if (tenantRow) { q.push("WHERE t.slug=?"); args.push(slug); } else if (onlyTest) q.push("JOIN users u ON u.id=t.owner_user_id WHERE u.email LIKE '%@example.com'");
  const tenants = (await env.DB.prepare(`${q.join(" ")} ORDER BY t.slug LIMIT ? OFFSET ?`).bind(...args, limit + 1, offset).all()).results || [];
  const more = tenants.length > limit, page = tenants.slice(0, limit), results = [];
  let started = 0, done = 0, cut = false;
  const mkBank = (t, ch) => bankId(env, t.id, ch);
  for (const t of page) {
    if (left() < Math.min(4000, budgetMs / 4) || (action === "start" && !dry && runningNow + started >= MAX_RUNNING && done)) { cut = left() < Math.min(4000, budgetMs / 4); break; }
    let chans = []; try { chans = await raceMs(archiveOf(env, t.id).channels(), left()); } catch { results.push({ slug: t.slug, status: "error", error: "channels not read in time" }); done++; continue; }
    for (const c of chans) {
      const ch = c.slug || c.name; if ((channel && ch !== channel) || c.kind === "dm") continue;
      const bank = mkBank(t, ch), row = { slug: t.slug, channel: ch, bank: short(bank) }, cur = byBank.get(bank);
      if (action === "start" && cur?.status === "done" && Number(cur.version) >= REBUILD_VERSION) { row.status = "already done"; results.push(row); continue; }
      if (left() < Math.min(3000, budgetMs / 5)) { cut = true; row.status = "not reached (time budget)"; results.push(row); continue; }
      try {
        const R = residentOf(env, t.id, ch);
        if (action === "start") {
          if (cur?.status === "running" || cur?.status === "paused") { row.status = `already ${cur.status}`; results.push(row); continue; }
          if (!dry && runningNow + started >= MAX_RUNNING) { row.status = "waiting: two banks are already rebuilding"; results.push(row); continue; }
          await raceMs(R.bind(t.id, ch, String(c.id)), left());
          if (dry) { row.status = "would start"; }   // a dry run does not walk the source: use action=estimate for the numbers
          else { const r = await raceMs(R.hsRebuild("start"), left()); row.status = r.started ? "started" : r.error || "not started"; if (r.started) started++; }
        } else if (action === "estimate") { await raceMs(R.bind(t.id, ch, String(c.id)), left()); row.estimate = await raceMs(R.hsRebuild("estimate"), left()); }
        else { await raceMs(R.bind(t.id, ch, String(c.id)), left()); row.state = await raceMs(R.hsRebuild(action, { live: wantLive }), left()); }
      } catch (e) { row.status = "error"; row.error = String(e.message || e).slice(0, 160); if (/timed out/.test(row.error)) cut = true; }
      results.push(row);
    }
    done++;
  }
  const nextOffset = done < page.length || more ? offset + done : null;
  const total = action === "estimate" ? results.reduce((n, r) => n + (r.estimate?.extraction_usd || 0), 0) : null;
  return { action, dry: action === "start" ? dry : undefined, accounts_processed: done, offset, running_now: runningNow + started, max_running: MAX_RUNNING, next_offset: done === 0 && !more ? null : nextOffset,
    ...(cut ? { partial: "the time budget ran out; call again with next_offset" } : {}), ...(total != null ? { extraction_usd_this_page: Number(total.toFixed(6)) } : {}), results };
}
