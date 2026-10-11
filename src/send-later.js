// Send later (the iMessage "Send Later" for tasks). The person writes a message, picks a time, and at that time it goes into the
// task as THEIR message, exactly as if they had sent it then: a normal turn, or a steer when the helper is already working there.
// It's the person's own words, so the never-proactive rule isn't touched: the helper only answers what they sent.
//
// Stored per channel in the Resident's SQLite (table `later`), due time in UTC ms (the app shows it in the person's zone; DST-safe),
// and fired from the same Durable Object alarm as workflows / follow-ups / helper deadlines (resident.js armNow + alarm()).
// A message whose task was deleted goes to a new task. A read-only account at fire time: not sent, marked failed ("Couldn't send"
// with Retry). Files attached in the composer stay drafts held for the message (pending=2: out of the Library, never swept)
// until it's sent (pending=0) or canceled (back to pending=1, swept like any unsent draft).
//
// resident.js only hooks in: laterMix(Resident, titleFrom) after the class, laterInit() in the constructor, laterNext() in armNow,
// laterFireDue() in alarm(). index.js: the /api/res/<ch>/later routes, and boot lists each channel's pending ones.
import { validTz } from "./schedule.js";
import { replyOut, replyIn } from "./reply-to.js";
import { newAutoChat } from "./chat-titles.js";

export const LATER_MAX_PENDING = 100, LATER_MAX_AHEAD = 366 * 86400e3, LATER_STALE_MS = 120e3, LATER_TIMER_MS = 20 * 60e3;
export const LATER_PAST = "That time has already passed. Pick a later time.";
export const LATER_READ_ONLY = "read_only";

export function laterInit(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS later (id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, text TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]',
      due INTEGER NOT NULL, tz TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT, cid TEXT, title TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL,
      sent_at INTEGER, sent_session TEXT, sent_card TEXT);
    CREATE INDEX IF NOT EXISTS later_due ON later(status, due);
    CREATE UNIQUE INDEX IF NOT EXISTS later_cid ON later(cid) WHERE cid IS NOT NULL;`);
  try { sql.exec("ALTER TABLE later ADD COLUMN reply TEXT"); } catch {}   // the message it replies to (reply-to.js), sent with it
}
// The next time the alarm must wake for a scheduled message (a claim left by a crash is retried after LATER_STALE_MS).
export function laterNext(sql) {
  const a = sql.exec("SELECT MIN(due) t FROM later WHERE status='pending'").one()?.t ?? null;
  const b = sql.exec("SELECT MIN(updated) t FROM later WHERE status='sending'").one()?.t ?? null;
  const bt = b == null ? null : b + LATER_STALE_MS;
  return a == null ? bt : bt == null ? a : Math.min(a, bt);
}
// Wall-clock time in an IANA zone → the UTC instant. DST-safe: a time skipped by spring-forward moves forward by the gap
// (2:30 → 3:30, like the clocks and JS Date); a time that happens twice (fall-back) is its first occurrence. The app's picker uses the same rule (send-later.ts).
export function wallToUtc(y, mo, d, h, mi, tz) {
  const want = Date.UTC(y, mo, d, h, mi);
  const off = (t) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t; };
  const t1 = want - off(want), t2 = want - off(t1);
  const cands = [...new Set([t1, t2, want - off(want - 864e5), want - off(want + 864e5)])].filter((t) => t + off(t) === want).sort((a, b) => a - b);
  if (cands.length) return cands[0];
  // Skipped (spring-forward gap): the instant the clocks jump to, i.e. the wall time shifted by the gap.
  return Math.max(t1, t2);
}
export const laterLocal = (ms, tz) => { try { return new Date(ms).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return new Date(ms).toISOString(); } };
const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// Methods mixed into the Resident (this = the channel's Durable Object). titleFrom (resident.js) comes in through laterMix, so
// there's no import cycle.
let titleFrom = (t) => String(t || "").trim().slice(0, 60) || "New task";
export function laterMix(Cls, title) { if (title) titleFrom = title; Object.assign(Cls.prototype, laterMethods); }
export const laterMethods = {
  laterRow(id) { return this.sql.exec("SELECT * FROM later WHERE id=?", Number(id)).toArray()[0]; },
  laterView(r) {
    if (!r) return null;
    const ids = jp(r.files, []), files = ids.map((id) => this.sql.exec("SELECT * FROM files WHERE id=?", String(id)).toArray()[0]).filter(Boolean).map((f) => this.fileView(f));
    const s = r.session ? this.session(r.session) : null, tz = r.tz && validTz(r.tz) ? r.tz : this.tz();
    return { id: r.id, session: s ? s.id : null, task: s ? s.title : r.title || "New task", new_task: !s, text: r.text, files, due: r.due, tz, local: laterLocal(r.due, tz),
      status: r.status === "sending" ? "pending" : r.status, error: r.error || null, created: r.created, ...(r.sent_session ? { sent_session: r.sent_session } : {}) };
  },
  // Pending and failed ones, soonest first (what the app shows as bubbles and in the Scheduled list).
  async laterList(session = null) {
    const rows = this.sql.exec(`SELECT * FROM later WHERE status IN ('pending','sending','failed')${session ? " AND session=?" : ""} ORDER BY due, id`, ...(session ? [String(session)] : [])).toArray();
    return rows.map((r) => this.laterView(r));
  },
  laterCheckDue(due, now = Date.now()) {
    const t = Number(due);
    if (!Number.isFinite(t) || t <= 0) return "Pick a date and time.";
    if (t <= now) return LATER_PAST;
    if (t > now + LATER_MAX_AHEAD) return "Pick a time within the next year.";
    return null;
  },
  // b = { session: id | "new" | null, text, files: [ids], due (UTC ms), tz, cid, reply: { id, role, text } (Reply on a bubble, optional) }
  async laterAdd(tenant, channel, channelId, b = {}) {
    if (tenant) { this.put("tenant", tenant); this.put("channel", channel); this.put("channel_id", channelId); }
    const now = Date.now(), text = String(b.text ?? "").trim();
    const cid = b.cid ? String(b.cid).slice(0, 64) : null;
    if (cid) { const have = this.sql.exec("SELECT * FROM later WHERE cid=?", cid).toArray()[0]; if (have) return { item: this.laterView(have), dup: true }; }
    if (text.length > 20000) return { error: "That message is too long (20,000 characters at most)." };
    const want = (Array.isArray(b.files) ? b.files : []).map(String).slice(0, 10);
    const files = want.filter((id) => this.sql.exec("SELECT id FROM files WHERE id=? AND deleted=0", id).toArray().length);
    if (want.length !== files.length) return { error: "One of the attached files is gone. Remove it and try again." };
    if (!text && !files.length) return { error: "Write a message or attach a file first." };
    const bad = this.laterCheckDue(b.due, now); if (bad) return { error: bad, past: bad === LATER_PAST };
    let session = b.session && b.session !== "new" ? String(b.session) : null;
    if (session && !this.session(session)) return { error: "No such task in this channel." };
    const n = this.sql.exec("SELECT COUNT(*) n FROM later WHERE status IN ('pending','sending','failed')").one().n;
    if (n >= LATER_MAX_PENDING) return { error: `You already have ${LATER_MAX_PENDING} scheduled messages here. Send or cancel some first.` };
    const tz = b.tz && validTz(String(b.tz)) ? String(b.tz) : this.tz();
    const title = session ? null : titleFrom(text || this.fileTitle(files));
    this.sql.exec("INSERT INTO later (session,text,files,due,tz,status,cid,title,created,updated,reply) VALUES (?,?,?,?,?,'pending',?,?,?,?,?)",
      session, text, JSON.stringify(files), Math.round(Number(b.due)), tz, cid, title, now, now, session ? replyOut(b.reply) : null);
    const id = this.sql.exec("SELECT last_insert_rowid() id").one().id;
    if (files.length) this.sql.exec(`UPDATE files SET pending=2 WHERE pending=1 AND id IN (${files.map(() => "?").join(",")})`, ...files);   // held for this message
    await this.arm();
    return { item: this.laterView(this.laterRow(id)) };
  },
  async laterEdit(id, due) {
    const r = this.laterRow(id); if (!r || !["pending", "failed"].includes(r.status)) return { error: "That message isn't scheduled anymore.", status: 404 };
    const bad = this.laterCheckDue(due); if (bad) return { error: bad, past: bad === LATER_PAST };
    this.sql.exec("UPDATE later SET due=?, status='pending', error=NULL, updated=? WHERE id=?", Math.round(Number(due)), Date.now(), r.id);
    await this.arm();
    return { item: this.laterView(this.laterRow(r.id)) };
  },
  async laterCancel(id) {
    const r = this.laterRow(id); if (!r || !["pending", "failed"].includes(r.status)) return { error: "That message isn't scheduled anymore.", status: 404 };
    this.sql.exec("UPDATE later SET status='canceled', updated=? WHERE id=?", Date.now(), r.id);
    const files = jp(r.files, []); if (files.length) this.sql.exec(`UPDATE files SET pending=1, at=? WHERE pending=2 AND id IN (${files.map(() => "?").join(",")})`, Date.now(), ...files);
    await this.arm();
    return { ok: true, id: r.id };
  },
  // "Send now" and "Retry": the same send the alarm does, right away.
  async laterSend(id) {
    const r = this.laterRow(id); if (!r || !["pending", "failed"].includes(r.status)) return { error: "That message isn't scheduled anymore.", status: 404 };
    const out = await this.laterFire(r, { manual: true });
    await this.arm();
    return out;
  },
  // From the alarm (and the in-memory timer): every message that's due, oldest first.
  async laterFireDue() {
    const now = Date.now();
    this.sql.exec("UPDATE later SET status='pending' WHERE status='sending' AND updated<?", now - LATER_STALE_MS);   // a claim left by a crash
    const due = this.sql.exec("SELECT * FROM later WHERE status='pending' AND due<=? ORDER BY due, id LIMIT 25", now + 1000).toArray();
    const out = [];
    for (const r of due) { try { out.push(await this.laterFire(r)); } catch (e) { console.log("send later", r.id, e.message); } }
    this.sql.exec("DELETE FROM later WHERE status IN ('sent','canceled') AND updated<?", now - 30 * 86400e3);
    return out;
  },
  async laterFire(r0, { manual = false } = {}) {
    // Claim (no await between the check and the claim, so the alarm, the timer and "Send now" can't send it twice;
    // the message's cid is a second guard: steerOrOpen treats a repeat as a dup).
    const r = this.laterRow(r0.id); if (!r || !(r.status === "pending" || (manual && r.status === "failed"))) return { error: "That message isn't scheduled anymore.", status: 404 };
    const now = Date.now();
    this.sql.exec("UPDATE later SET status='sending', updated=? WHERE id=?", now, r.id);
    const access = await this.accessNow();
    if (access.mode !== "full") {
      this.sql.exec("UPDATE later SET status='failed', error=?, updated=? WHERE id=?", LATER_READ_ONLY, Date.now(), r.id);
      return { error: LATER_READ_ONLY, status: 402, item: this.laterView(this.laterRow(r.id)) };
    }
    const files = jp(r.files, []);
    // Its task, else (deleted) a new one. A new task's id is saved before the send, so a crash retry reuses it.
    let sid = [r.sent_session, r.session].find((x) => x && this.session(x)) || null;
    if (!sid) { sid = newAutoChat(this, r.text || this.fileTitle(files)); this.sql.exec("UPDATE later SET sent_session=? WHERE id=?", sid, r.id); }
    const reply = sid === r.session ? replyIn(r.reply) : null;   // its own task only: a quote means nothing in a new one
    const input = { type: "msg", text: r.text, files, cid: `later:${r.id}`, via: "app", reply };
    const so = this.steerOrOpen(sid, input, { overflow: "open" });
    if (files.length) this.sql.exec(`UPDATE files SET pending=0 WHERE id IN (${files.map(() => "?").join(",")})`, ...files);   // sent: now it's a Library file
    this.sql.exec("UPDATE later SET status='sent', error=NULL, sent_at=?, sent_session=?, sent_card=?, updated=? WHERE id=?", Date.now(), sid, so.card?.id || null, Date.now(), r.id);
    if (so.mode === "open") {
      const run = this.runTurn(this.get("tenant"), this.get("channel"), this.get("channel_id"), r.text, null, { session: sid, files, card: so.card.id, ...(reply ? { reply } : {}) })
        .catch((e) => console.log("send later turn", r.id, e.message));
      this.ctx.waitUntil?.(run); this._lastLater = run;
    } else this.sql.exec("UPDATE sessions SET updated=? WHERE id=?", Date.now(), sid);   // a steer: the task still moves up its list
    return { ok: true, id: r.id, mode: so.mode, session: this.sessionView(this.session(sid)), card: so.card?.id || null, moved: !!r.session && sid !== r.session };
  },
  // Best effort on top of the alarm: while this object is awake (a long workflow run holds the alarm), a timer sends on time.
  laterTimer(next) {
    clearTimeout(this._laterT); this._laterT = null;
    if (next == null) return;
    const wait = next - Date.now(); if (wait > LATER_TIMER_MS) return;
    this._laterT = setTimeout(() => { this._laterT = null; this.laterFireDue().then(() => this.arm()).catch((e) => console.log("send later timer", e.message)); }, Math.max(0, wait) + 50);
    this._laterT?.unref?.();
  },
};
