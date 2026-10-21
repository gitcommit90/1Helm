// Deletion, inside the Durable Objects (the Captain, 10-06: "delete = delete. It really really really means delete.").
// The orchestration (D1, R2 prefixes, Hindsight, Stripe, Composio, Photon, the jobs that make it resumable) is src/deletion.js.
// This module only holds what has to run INSIDE an object, because only an object can touch its own storage:
//   - Resident (one channel): sessionInventory / deleteSessionData (one chat, everything tied to it), noteForget (a Notebook
//     note's memory copies), wipeChannel (the whole channel), syncRemovals (deleted files leave the channel computer too).
//   - Archive: channelRowAny / markChannelDeleting / deleteChannelRows (a channel's rows), wipeArchive (the account).
//   - ChannelComputer: wipe (container + every R2 layer + storage), compactNext (the next save is a full base, so deleted files'
//     bytes leave the old layers).
//   - Ledger, Computer (legacy per-tenant computer): wipe.
// Real deletion only: rows are DELETEd, objects are deleted, storage is deleteAll()'d. No soft-delete flags.
// The licensed routing, texting and agent memory cleanups come in as this.eeDeletion (resident.js sets it; importing the EE seam here would make an import cycle).
// Mixed in from resident.js (deletionMix) and index.js (archiveDeletionMix, wipeMix) / channel-computer.js (computerDeletionMix).

import { stDelete } from "./storage.js";
import { previewKeys, dropPreviewRows } from "./file-preview.js";   // the file viewer's hidden PDF previews go with their files
import { sidecarKeys, dropSidecarRows } from "./sidecar-rows.js";   // and so do their text sidecars
import { hsWriters, DOC, convDocOf } from "./hindsight-writers.js";   // HS_WRITERS: the documents a chat, a file or a note has in the channel's bank

const CHUNK = 90;                                   // Durable Object SQL allows 100 bound parameters per statement
const chunks = (a, n = CHUNK) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const ph = (a) => a.map(() => "?").join(",");
const jp = (s, d = []) => { try { const v = JSON.parse(s ?? ""); return v ?? d; } catch { return d; } };
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const has = (sql, t) => sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t).toArray().length > 0;
const count = (sql, t, where = "", ...a) => has(sql, t) ? Number(sql.exec(`SELECT COUNT(*) n FROM ${t}${where ? ` WHERE ${where}` : ""}`, ...a).toArray()[0]?.n || 0) : 0;
// DELETE FROM t WHERE col IN (ids), chunked; returns how many rows went.
function delIn(sql, t, col, ids) {
  if (!ids.length || !has(sql, t)) return 0; let n = 0;
  for (const c of chunks(ids)) { n += count(sql, t, `${col} IN (${ph(c)})`, ...c); sql.exec(`DELETE FROM ${t} WHERE ${col} IN (${ph(c)})`, ...c); }
  return n;
}
function delWhere(sql, t, where, ...a) { if (!has(sql, t)) return 0; const n = count(sql, t, where, ...a); if (n) sql.exec(`DELETE FROM ${t} WHERE ${where}`, ...a); return n; }
// R2 deletes take up to 1000 keys per call (stDelete batches them).
// Through storage.js so the account's storage counter goes down with them. Items: keys, or { key, size } when the size is known.
export async function r2DeleteKeys(env, keys) { return stDelete(env, keys.filter((k) => k && (typeof k === "string" || k.key))); }
// The object's whole storage (SQLite tables included) and its alarm, then a reset so the next call starts from an empty object. A container it runs is destroyed first, without saving.
export async function wipeStorage(self, why = "deleted") {
  try { if (self.ctx.container?.running) await self.ctx.container.destroy(why); } catch (e) { console.log("wipe destroy", e?.message); }
  try { await self.ctx.storage.deleteAlarm?.(); } catch {}
  await self.ctx.storage.deleteAll();
  // Start over in place: a fresh instance on the now-empty storage (its constructor recreates empty tables), so a call that
  // arrives right after (a new channel that reuses the slug) finds a clean object, never stale in-memory state or missing tables.
  try { const fresh = new self.constructor(self.ctx, self.env); for (const k of Object.keys(self)) if (!(k in fresh)) delete self[k]; Object.assign(self, fresh); }
  catch (e) { console.log("wipe reinit", e?.message); setTimeout(() => { try { self.ctx.abort?.(why); } catch {} }, 25); }
  return true;
}

// ---------------------------------------------------------------- Resident ----------------------------------------------------------------
export const residentDeletion = {
  // Every turn/card that belongs to the chat: its own turns and cards (chat, helpers, handoffs), and the runs of workflows and
  // follow-ups bound to it. A card's id is its turn's id.
  sessionTurnIds(sid) {
    const ids = new Set(), sql = this.sql;
    for (const r of sql.exec("SELECT id FROM turns WHERE session=?", sid).toArray()) ids.add(r.id);
    if (has(sql, "cards")) for (const r of sql.exec("SELECT id FROM cards WHERE session=?", sid).toArray()) ids.add(r.id);
    const workflows = sql.exec("SELECT id FROM workflows WHERE session=?", sid).toArray().map((r) => r.id);
    for (const c of chunks(workflows)) for (const r of sql.exec(`SELECT id FROM turns WHERE workflow_id IN (${ph(c)})`, ...c).toArray()) ids.add(r.id);
    if (has(sql, "helpers")) for (const r of sql.exec("SELECT card, result_card FROM helpers WHERE session=?", sid).toArray()) { if (r.card) ids.add(r.card); if (r.result_card) ids.add(r.result_card); }
    return { turns: [...ids], workflows };
  },
  liveIn(sid) { return [...(this.active?.values() || [])].filter((t) => t.session === sid && !t.finished).length; },
  // What the Worker needs BEFORE the rows go (so a crash never loses them): the turn ids (Hindsight items "turn-<id>"), the
  // approval ids (texted approval cards in D1), and whether it was the texting thread / the default chat.
  async sessionInventory(sid) {
    sid = String(sid);
    const { turns } = this.sessionTurnIds(sid);
    const approvals = this.sql.exec("SELECT id FROM approvals WHERE session=?", sid).toArray().map((r) => r.id);
    for (const c of chunks(turns)) for (const r of this.sql.exec(`SELECT id FROM approvals WHERE turn IN (${ph(c)})`, ...c).toArray()) if (!approvals.includes(r.id)) approvals.push(r.id);
    const plans = has(this.sql, "plans") ? this.sql.exec("SELECT id, created FROM plans WHERE session=?", sid).toArray().map((r) => ({ id: r.id, created: r.created })) : [];
    const interviews = has(this.sql, "chat_interviews") ? this.sql.exec("SELECT id FROM chat_interviews WHERE session=?", sid).toArray().map((r) => r.id) : [];
    // Facts the background memory upkeep drew from this chat (memjobs.js) are Hindsight documents "fact-u:…" too.
    const mj = has(this.sql, "mj_cites") ? this.sql.exec("SELECT ref FROM mj_cites WHERE session=? AND job='upkeep'", sid).toArray().map((r) => `fact-${r.ref}`) : [];
    // HS_WRITERS: the chat's conversation documents (one per local day, a day either side in case the time zone changed) and its task card.
    const wd = [];
    if (hsWriters(this.env)) {
      const tz = this.tz?.() || "UTC", add = (x) => { if (x) wd.push(x); };
      for (const c of chunks(turns)) for (const r of this.sql.exec(`SELECT at, session, workflow_id FROM turns WHERE id IN (${ph(c)})`, ...c).toArray()) for (const d of [-1, 0, 1]) add(convDocOf({ session: r.session, workflowId: r.workflow_id, at: Number(r.at) + d * 86400e3 }, tz));
      add(DOC.task(sid)); if (has(this.sql, "hs_outbox")) for (const d of new Set(wd)) this.sql.exec("DELETE FROM hs_outbox WHERE doc=? AND del=0", d);   // a queued write for the deleted chat never lands
    }
    // The task's live notes transcripts in memory: live:<task>:s<n> for every session number it ever had (the Worker adds the ones the LiveNotes object and R2 know).
    const lv = this.lnView?.(sid), lnN = Math.min(2000, Math.max(0, Number(lv?.n || 0), ...(lv?.sessions || []).map((x) => Number(x.n) || 0), this.lnx?.(sid).floor || 0));
    for (let i = 1; i <= lnN; i++) wd.push(`live:${sid}:s${i}`);
    return { exists: !!this.session(sid), turns, approvals, plans, interviews, agentMemory: this.eeDeletion.agentSessionInventory(this,sid), hsDocs: [...turns.map((t) => `turn-${t}`), ...mj, ...new Set(wd)], texts: this.textsSessions().includes(sid), default: this.getRaw("default_session") === sid, live: this.liveIn(sid), bank: this.hsBankId?.() || null };
  },
  // Is this file used outside the chat being deleted? (attached to a message in another chat, or held for a scheduled message
  // that isn't this chat's). Returns where, so the file can move there; null = only this chat used it.
  fileUseElsewhere(id, sid, cards) {
    const like = `%"${id}"%`, sql = this.sql;
    const t = sql.exec("SELECT id, session FROM turns WHERE files LIKE ? AND (session IS NULL OR session<>?) LIMIT 1", like, sid).toArray()[0];
    if (t) return { session: t.session || null, turn: t.id };
    if (has(sql, "card_events")) {
      const e = sql.exec("SELECT e.card, c.session FROM card_events e JOIN cards c ON c.id=e.card WHERE e.files LIKE ? AND c.session<>? LIMIT 1", like, sid).toArray()[0];
      if (e && !cards.has(e.card)) return { session: e.session || null, turn: e.card };
    }
    if (has(sql, "later")) {
      const l = sql.exec("SELECT session FROM later WHERE files LIKE ? AND status IN ('pending','sending','failed') AND (session IS NULL OR session<>?) AND (sent_session IS NULL OR sent_session<>?) LIMIT 1", like, sid, sid).toArray()[0];
      if (l) return { session: l.session || null, turn: null };
    }
    return null;
  },
  // Delete one chat and everything tied to it. Safe to run again (each step deletes whatever is still there).
  // → { ok, existed, counts, kept: [file names used elsewhere, which stay], live: turns still finishing (the job re-runs) }.
  async deleteSessionData(sid, { waitMs = 20000 } = {}) {
    sid = String(sid); const sql = this.sql, counts = {};
    const phoneFiles = this.eeDeletion.dropPhoneFiles(this,sid);
    const existed = !!this.session(sid);
    // 1. Stop it: the running turn(s) stop at their next step, its helpers stop (no handoff), unread inputs are dropped.
    for (const tc of this.active?.values() || []) if (tc.session === sid && !tc.finished) tc.abort = "hard";
    await phoneFiles;
    await this.eeDeletion.dropNativePolls(this,sid);
    await this.nativeCancel?.(sid, 'Task deleted');
    delWhere(sql, 'native_sessions', 'task=?', sid);
    if (has(sql, "helpers")) for (const h of sql.exec("SELECT id FROM helpers WHERE session=? AND status IN ('running','waiting_input')", sid).toArray()) { try { await this.helperStop(sid, h.id, "person"); } catch {} }
    this.inputs?.delete(sid);
    // 2. The chat row first: from here no new message, handoff or follow-up can land in it ("No such task" / "gone").
    counts.sessions = delWhere(sql, "sessions", "id=?", sid);
    if (this.getRaw("default_session") === sid) this.put("default_session", "");
    const texts = this.textsSessions();
    if (texts.includes(sid)) { this.put("texts_sessions", JSON.stringify(texts.filter((x) => x !== sid))); if (this.getRaw("texts_session") === sid) this.put("texts_session", ""); }
    delIn(sql, "kv", "k", [`own_inc:${sid}`, `jev_failed:${sid}`]); sql.exec("DELETE FROM kv WHERE k LIKE ? OR k LIKE ? OR k=?", `lnt:${sid}:%`, `lnx:${sid}`, `lnx:${sid}`); delWhere(sql, "live_notes", "session=?", sid);   // live notes: the hidden transcript files' ids, the record of deleted notes, the mirror
    const until = Date.now() + waitMs; while (this.liveIn(sid) && Date.now() < until) await sleep(200);
    const { turns, workflows } = this.sessionTurnIds(sid), cards = new Set(turns);
    // 3. Files made or attached only in this chat: bytes out of R2 first, then the rows (a crash in between re-runs cleanly).
    const files = sql.exec("SELECT * FROM files WHERE session=?", sid).toArray();
    if (has(sql, "later")) for (const l of sql.exec("SELECT files FROM later WHERE session=? OR sent_session=?", sid, sid).toArray())
      for (const id of jp(l.files)) { const f = sql.exec("SELECT * FROM files WHERE id=? AND pending>0", String(id)).toArray()[0]; if (f && !files.some((x) => x.id === f.id)) files.push(f); }
    const kept = [], gone = [];
    for (const f of files) {
      const use = f.hidden ? null : this.fileUseElsewhere(f.id, sid, cards);   // a hidden live notes transcript goes with its task
      if (use) { sql.exec("UPDATE files SET session=?, turn=? WHERE id=?", use.session, use.turn, f.id); kept.push(f.name); } else gone.push(f);
    }
    const shots = sql.exec("SELECT id, r2key FROM shots WHERE session=?", sid).toArray();
    for (const c of chunks(turns)) for (const s of sql.exec(`SELECT id, r2key FROM shots WHERE turn IN (${ph(c)})`, ...c).toArray()) if (!shots.some((x) => x.id === s.id)) shots.push(s);
    counts.r2_objects = await r2DeleteKeys(this.env, [...gone.flatMap((f) => [{ key: f.r2key, size: f.bytes }, f.view_key, f.prev_key && { key: f.prev_key, size: f.prev_bytes ?? null }, f.orig_key && f.orig_key !== f.prev_key && f.orig_key !== f.r2key && { key: f.orig_key, size: f.orig_bytes ?? null }]), ...previewKeys(sql, gone.map((f) => f.id)), ...sidecarKeys(sql, gone.map((f) => f.id)), ...shots.map((s) => s.r2key), ...routingArtifactKeys(sql,sid)]);
    this.eeDeletion.dropRoutingArtifacts(sql,sid);
    const rm = gone.filter((f) => Number(f.synced) !== 0).map((f) => `files/${f.name}`);   // copies on the channel computer
    // Their share links die with them (share.js keeps them in D1, keyed by file).
    const tid = this.get("tenant");
    if (tid && gone.length && this.env.DB) for (const c of chunks(gone.map((f) => f.id), 50)) { try { const r = await this.env.DB.prepare(`DELETE FROM share_links WHERE tenant_id=? AND file_id IN (${ph(c)})`).bind(tid, ...c).run(); counts.share_links = (counts.share_links || 0) + Number(r?.meta?.changes || 0); } catch (e) { if (!/no such table/.test(e.message)) throw e; } }
    counts.files = delIn(sql, "files", "id", gone.map((f) => f.id));
    dropPreviewRows(sql, gone.map((f) => f.id)); dropSidecarRows(sql, gone.map((f) => f.id));
    counts.shots = delIn(sql, "shots", "id", shots.map((s) => s.id));
    // 4. Memory derived from it: the ledger rows (its messages, tool results, notes, summaries) and their search index.
    const memIds = has(sql, "mem_rows") ? sql.exec("SELECT id FROM mem_rows WHERE session=? OR id LIKE ?", sid, `s:${sid}:%`).toArray().map((r) => r.id) : [];
    if (has(sql, "mem_rows")) for (const c of chunks(turns, 45)) for (const r of sql.exec(`SELECT id FROM mem_rows WHERE ${c.map(() => "id LIKE ?").join(" OR ")}`, ...c.map((t) => `t:${t}:%`)).toArray()) if (!memIds.includes(r.id)) memIds.push(r.id);
    counts.memory_rows = delIn(sql, "mem_rows", "id", memIds);
    delIn(sql, "mem_fts", "id", memIds);
    if (has(sql, "mem_rows")) for (const c of chunks(memIds)) sql.exec(`UPDATE mem_rows SET superseded_by=NULL WHERE superseded_by IN (${ph(c)})`, ...c);   // other rows it had replaced count again
    counts.memory_segments = delWhere(sql, "mem_segments", "session=?", sid);
    counts.memory_job_evidence = delWhere(sql, "mj_cites", "session=?", sid);   // the person's quoted words behind background facts (memjobs.js)
    counts.memory_receipts = delWhere(sql, "mem_receipts", "session=?", sid) + delIn(sql, "mem_receipts", "turn", turns);
    delIn(sql, "clef_doors", "turn", turns);
    // 5. Everything else keyed to the chat or its turns.
    counts.msgs = delIn(sql, "msgs", "turn", turns);
    counts.card_events = delIn(sql, "card_events", "card", turns);
    counts.cards = delWhere(sql, "cards", "session=?", sid) + delIn(sql, "cards", "id", turns);
    counts.turns = delWhere(sql, "turns", "session=?", sid) + delIn(sql, "turns", "id", turns);
    counts.todos = delWhere(sql, "todos", "session=?", sid);
    counts.reactions = delWhere(sql, "reactions", "session=?", sid) + delIn(sql, "reactions", "turn", turns);
    counts.later = delWhere(sql, "later", "session=? OR sent_session=?", sid, sid);
    // Queue references and round/message histories go before their owning helper rows.
    this.eeDeletion.purgeAgentSession(this,sid);
    const helperIds=has(sql,"helpers")?sql.exec("SELECT id FROM helpers WHERE session=?",sid).toArray().map(h=>h.id):[];
    counts.helper_rounds=delIn(sql,"helper_rounds","helper_id",helperIds);
    counts.helper_messages=delIn(sql,"helper_messages","helper_id",helperIds);
    counts.helpers = delWhere(sql, "helpers", "session=?", sid);
    counts.approvals = delWhere(sql, "approvals", "session=?", sid) + delIn(sql, "approvals", "turn", turns);
    counts.grants = delWhere(sql, "grants", "session=?", sid);
    counts.plans = delWhere(sql, "plans", "session=?", sid);
    counts.plan_origin = delWhere(sql, "plan_origin", "session=?", sid);
    this.forgetOrigin(sid);
    counts.connect_offers = delWhere(sql, "connect_offers", "session=?", sid);
    counts.chat_interviews = delWhere(sql, "chat_interviews", "session=?", sid);
    counts.user_input_receipts = delWhere(sql, "user_input_receipts", "session=?", sid);
    counts.user_questions = delWhere(sql, "user_questions", "session=?", sid);
    counts.photon_reply_sources = delWhere(sql, "photon_reply_sources", "session=?", sid);
    if(this.getRaw("last_text_question_session")===sid)this.put("last_text_question_session","");
    counts.pomodoro = delWhere(sql, "pomodoro", "session=?", sid) + delWhere(sql, "pomodoro_offers", "session=?", sid);
    delWhere(sql, "notif_state", "session=?", sid);   // notify.js: the last thing a push told them about this task
    counts.outbox = delIn(sql, "outbox", "turn", turns) + delIn(sql, "outbox", "workflow_id", workflows);
    delIn(sql, "gate_runs", "workflow_id", workflows);
    counts.workflows = delIn(sql, "workflows", "id", workflows);
    // 6. Its files leave the channel computer too (on its next use, or now in the background), and the next save is a full base.
    if (rm.length) { this.put("rm_paths", JSON.stringify([...new Set([...jp(this.getRaw("rm_paths")), ...rm])])); this.ctx.waitUntil?.(this.syncRemovals().catch((e) => console.log("file removal", e.message))); }
    try { await this.arm(); } catch {}
    // The cancellation fences set at the start (phone file delivery, conversation memory refresh) only matter while the chat or a turn of it exists. Once nothing of it is
    // running they are the last trace of the chat id, so they go too (a turn still finishing makes the job run this again).
    if (!this.liveIn(sid)) delIn(sql, "kv", "k", [`phone_files_cutoff:${sid}`, `hs_origin_block:${sid}`]);
    return { ok: true, existed, counts, kept, removed_from_computer: rm.length, live: this.liveIn(sid), hsFileDocs: gone.map((f) => DOC.file(f.id)) };
  },
  // A task started from a plan in the deleted chat keeps living (it's its own chat), but loses the excerpt of the deleted one
  // and its link back to it. Called here and, by the Worker, on every other channel's Resident.
  forgetOrigin(sid) {
    if (!has(this.sql, "plan_origin")) return 0; const n = count(this.sql, "plan_origin", "from_session=?", String(sid));
    if (n) this.sql.exec("UPDATE plan_origin SET excerpt=NULL, from_session=NULL WHERE from_session=?", String(sid)); return n;
  },
  async forgetOriginOf(sid) { return this.forgetOrigin(sid); },
  // Files deleted with a chat, still on the channel computer: remove them, then save as a full base (old layers dropped).
  async syncRemovals() {
    const l = jp(this.getRaw("rm_paths")); if (!l.length || !this.get("tenant")) return 0;
    const C = this.computer(); let left = [...l];
    for (const p of l) { try { const r = await C.rmFile(p); if (r?.ok || r?.error === "bad path") left = left.filter((x) => x !== p); } catch (e) { console.log("rmFile", e.message); break; } }
    this.put("rm_paths", JSON.stringify(left));
    if (left.length < l.length) { try { await C.compactNext(); await C.save("deleted"); } catch (e) { console.log("compact after delete", e.message); } }
    return l.length - left.length;
  },
  // A Notebook note was deleted: its copies in this channel's memory go too (the Notebook mirror m:<id>, its edits m:<id>@<at>,
  // and the pre-Notebook copy r:… it replaced). Rows it had superseded count again. → Hindsight document ids to delete.
  async noteForget(noteId) {
    const sql = this.sql, id = `m:${String(noteId)}`;
    if (!has(sql, "mem_rows")) return { rows: 0, hsDocs: [`fact-${id}`, DOC.note(noteId)] };
    const mine = sql.exec("SELECT id FROM mem_rows WHERE id=? OR id LIKE ?", id, `${id}@%`).toArray().map((r) => r.id);
    const copies = mine.length ? sql.exec(`SELECT id FROM mem_rows WHERE id LIKE 'r:%' AND superseded_by IN (${ph(mine)})`, ...mine).toArray().map((r) => r.id) : [];
    const all = [...mine, ...copies];
    const n = delIn(sql, "mem_rows", "id", all); delIn(sql, "mem_fts", "id", all);
    for (const c of chunks(all)) sql.exec(`UPDATE mem_rows SET superseded_by=NULL WHERE superseded_by IN (${ph(c)})`, ...c);
    if (has(sql, "hs_outbox")) sql.exec("DELETE FROM hs_outbox WHERE doc=? AND del=0", DOC.note(noteId));   // HS_WRITERS: a queued write of the deleted note never lands
    return { rows: n, hsDocs: [...new Set([`fact-${id}`, DOC.note(noteId), ...all.map((x) => `fact-${x}`)])], bank: this.hsBankId?.() || null };
  },
  // The whole channel: stop everything, delete every R2 object this object knows (files, views, screenshots), then the storage.
  async wipeChannel() {
    const phoneFiles = this.eeDeletion.dropPhoneFiles(this);
    const sql = this.sql;
    for (const tc of this.active?.values() || []) tc.abort = "hard";
    await phoneFiles;
    await this.eeDeletion.dropNativePolls(this);
    await this.nativeCancel?.(null, 'Channel deleted');
    this.inputs?.clear?.();
    const counts = {};
    for (const t of ["sessions", "turns", "msgs", "cards", "card_events", "files", "shots", "todos", "reactions", "later", "helpers", "approvals", "grants", "workflows", "outbox", "mem_rows", "mem_segments", "plans", "plan_origin", "connect_offers", "chat_interviews", "user_questions", "user_input_receipts", "pomodoro", "pomodoro_offers"]) counts[t] = count(sql, t);
    const keys = [...sql.exec("SELECT r2key, view_key FROM files").toArray().flatMap((f) => [f.r2key, f.view_key]), ...sql.exec("SELECT r2key FROM shots").toArray().map((s) => s.r2key), ...previewKeys(sql), ...sidecarKeys(sql), ...routingArtifactKeys(sql)];
    counts.r2_objects = await r2DeleteKeys(this.env, keys);
    await wipeStorage(this, "channel deleted");
    return counts;
  },
};
export function deletionMix(Cls) { for (const [k, v] of Object.entries(residentDeletion)) Cls.prototype[k] = v; }

// ---------------------------------------------------------------- Archive ----------------------------------------------------------------
export const archiveDeletion = {
  // A channel row by id or slug, including one already marked for deletion (channels() hides those).
  async channelRowAny(ref) {
    for (const r of this.sql.exec("SELECT id, data FROM rows WHERE tbl='channels'").toArray()) {
      const c = jp(r.data, null); if (!c) continue;
      if (String(r.id) === String(ref) || String(c.id) === String(ref) || (c.slug || c.name) === ref) return { ...c, rid: String(r.id) };
    }
    return null;
  },
  // Hidden at once (every route, the app and General's cross-channel reads list channels() and stop seeing it); the row
  // itself goes last, so its slug can't be taken by a new channel until everything under it is gone.
  async markChannelDeleting(cid) {
    const r = this.sql.exec("SELECT data FROM rows WHERE tbl='channels' AND id=?", String(cid)).toArray()[0]; if (!r) return false;
    this.sql.exec("UPDATE rows SET data=? WHERE tbl='channels' AND id=?", JSON.stringify({ ...jp(r.data, {}), deleting: Date.now() }), String(cid)); return true;
  },
  async deleteChannelRows(cid) {
    // HS_WALLS: the channel's "people seen here" rows go with it (walls.js).
    if (has(this.sql, "people_seen")) { const r = this.sql.exec("SELECT data FROM rows WHERE tbl='channels' AND id=?", String(cid)).toArray()[0], c = r ? jp(r.data, null) : null; if (c) this.sql.exec("DELETE FROM people_seen WHERE channel=?", String(c.slug || c.name)); }
    const counts = Object.fromEntries(this.sql.exec("SELECT tbl, COUNT(*) n FROM rows WHERE channel_id=? GROUP BY tbl", String(cid)).toArray().map((r) => [r.tbl, r.n]));
    this.sql.exec("DELETE FROM rows WHERE channel_id=?", String(cid));
    counts.channels = count(this.sql, "rows", "tbl='channels' AND id=?", String(cid));
    this.sql.exec("DELETE FROM rows WHERE tbl='channels' AND id=?", String(cid));
    return counts;
  },
  async wipeArchive() {
    const counts = Object.fromEntries(this.sql.exec("SELECT tbl, COUNT(*) n FROM rows GROUP BY tbl").toArray().map((r) => [r.tbl, r.n]));
    counts.people = count(this.sql, "people"); counts.people_facts = count(this.sql, "people_facts"); counts.people_photos = count(this.sql, "people_photos"); counts.people_keys = count(this.sql, "people_keys"); counts.ws_memory_rows = count(this.sql, "mem_rows");
    // Unfinished import uploads aren't listed by R2: abort them so their parts are deleted too.
    for (const o of this.sql.exec("SELECT key, upload_id FROM objects WHERE done=0").toArray()) { try { await this.env.WS.resumeMultipartUpload(o.key, o.upload_id).abort(); } catch {} }
    await wipeStorage(this, "account deleted");
    return counts;
  },
};
export function archiveDeletionMix(Cls) { for (const [k, v] of Object.entries(archiveDeletion)) Cls.prototype[k] = v; }

// ---------------------------------------------------------------- Channel computer ----------------------------------------------------------------
export const computerDeletion = {
  async wipe() {
    this.put("ready", "0");
    for (const end of [...(this.live || [])]) { try { end(4000, "deleted"); } catch {} }
    try { if (this.ctx.container?.running) await this.ctx.container.destroy("channel deleted"); } catch {}
    try { await this.refundUnused?.(); } catch {}
    const keys = this.sql.exec("SELECT key, bytes FROM layers").toArray().map((r) => ({ key: r.key, size: r.bytes }));
    const n = await r2DeleteKeys(this.env, keys);
    await wipeStorage(this, "channel deleted");
    return { layers: n };
  },
  async compactNext() { this.put("force_base", "1"); return { ok: true }; },
};
export function computerDeletionMix(Cls) { for (const [k, v] of Object.entries(computerDeletion)) Cls.prototype[k] = v; }

// Ledger and the legacy per-tenant Computer: everything goes.
export function wipeMix(Cls) { Cls.prototype.wipe = async function () { await wipeStorage(this, "account deleted"); return { ok: true }; }; }
