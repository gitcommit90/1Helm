// A text the app sends to the person's phone from a task (text_person in a chat turn, a workflow run or a reminder, or a
// "task needs you" notice) is recorded here with the task it came from. Only a text that asks for an answer (expects_reply) captures
// the person's plain reply; the others (reports, "finished", "open it in the app") are context for the Texts task's helper and never
// reroute a text or trigger the numbered question. When the person answers by plain text (no use of the phone's
// reply feature, which photon-replies.js already follows), the answer goes to that task, quoted with the text it answers, so the helper
// that knows the work carries on without asking the person to repeat anything. Replies that use the phone's reply feature keep
// using photon-replies.js. Several open alerts from different tasks make the app ask one short numbered question by text.
import { textSend } from "./ee/index.js";

export const ALERT_WINDOW_MS = 48 * 36e5;   // a text that asks for an answer can be answered by plain text for two days (the Captain's case was about 10 hours)
export const NOTICE_WINDOW_MS = 48 * 36e5, NOTICE_COUNT = 3;   // texts that ask for nothing: the Texts task's helper reads the last few as context
export const FOCUS_MS = 2 * 36e5;           // after a reply is routed to a task, plain texts keep going to it for two hours
export const CHOICE_MS = 24 * 36e5;         // how long the app waits for the answer to its numbered question
const MAX_ASK = 5, KEEP_TEXT = 1600;
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const cut = (s, n) => { s = one(s); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

export function textAlertInit(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS text_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, session TEXT NOT NULL, turn TEXT, workflow_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, guid TEXT, state TEXT NOT NULL DEFAULT 'open', answered_at INTEGER, expects INTEGER NOT NULL DEFAULT 0)");
  try { sql.exec("ALTER TABLE text_alerts ADD COLUMN expects INTEGER NOT NULL DEFAULT 0"); } catch {}
  sql.exec("CREATE INDEX IF NOT EXISTS text_alerts_open ON text_alerts(state, at)");
}
export function dropTextAlerts(R, session) {
  const sql = R.sql ?? R; sql.exec("DELETE FROM text_alerts WHERE session=?", String(session));
  if (R.get) { try { if (JSON.parse(R.get("text_focus") || "null")?.session === String(session)) R.put("text_focus", ""); } catch {} }
}

const live = (R, id) => { const s = R.session(id); return !!s && !s.done; };
const inTextsThread = (R, session) => { try { return R.textsSessions?.().includes(session); } catch { return false; } };

// Called right after a text from a task reached the phone. kind: "alert" (the task told the person something or asked for something).
export function recordTextAlert(R, { session, turn = null, workflow_id = null, kind = "alert", text, guid = null, at = Date.now(), expects = false }) {
  try {
    if (!session || !String(text || "").trim() || !R.session(session) || inTextsThread(R, session)) return null;   // a reply in the Texts task already lands there
    textAlertInit(R.sql);
    R.sql.exec("INSERT INTO text_alerts (at,session,turn,workflow_id,kind,text,guid,expects) VALUES (?,?,?,?,?,?,?,?)", at, String(session), turn ? String(turn) : null, workflow_id ?? null, kind, String(text).slice(0, KEEP_TEXT), guid ? String(guid) : null, expects ? 1 : 0);
    return true;
  } catch (e) { console.log("text alert record", e.message); return null; }
}

const rows = (R, q, ...a) => R.sql.exec(q, ...a).toArray();
// The open alerts that can still be answered: newest alert of each live task, newest first. An alert of a task that was deleted or
// marked done is closed here ("gone") and returned so the Texts task can tell the helper about it.
export function openAlerts(R, now = Date.now()) {
  textAlertInit(R.sql);
  R.sql.exec("UPDATE text_alerts SET state='expired' WHERE state='open' AND at<?", now - ALERT_WINDOW_MS);
  const all = rows(R, "SELECT * FROM text_alerts WHERE state='open' AND expects=1 ORDER BY at DESC, id DESC"), seen = new Set(), open = [], gone = [];
  for (const a of all) {
    if (!live(R, a.session)) { R.sql.exec("UPDATE text_alerts SET state='gone' WHERE id=?", a.id); gone.push(a); continue; }
    if (seen.has(a.session)) continue;
    seen.add(a.session); open.push(a);
  }
  return { open, gone };
}
// A person's pending text question (user-input.js) that was asked after the newest alert keeps its existing routing.
function questionIsNewer(R, open) {
  try { const q = rows(R, "SELECT MAX(created) c FROM user_questions WHERE status='pending' AND via='text'")[0]?.c; return !!q && (!open.length || q > Math.max(...open.map((a) => a.at))); } catch { return false; }
}
const answered = (R, session, now) => R.sql.exec("UPDATE text_alerts SET state='answered', answered_at=? WHERE session=? AND state='open'", now, String(session));
const setFocus = (R, session, now) => R.put("text_focus", JSON.stringify({ session, at: now }));
const readJson = (R, k) => { try { return JSON.parse(R.get(k) || "null"); } catch { return null; } };
const when = (at, tz) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", dateStyle: "medium", timeStyle: "short" }).format(at); } catch { return new Date(at).toISOString(); } };

// What the helper in the source task reads (a helper-only line, never shown as the person's words).
export function alertNote(R, alert, now) {
  const task = R.session(alert.session)?.title || "this task";
  return `The person's text below is their answer to a text you sent them from this task ("${cut(task, 80)}") on ${when(alert.at, R.tz?.())}: "${cut(alert.text, 900)}" They did not use the phone's reply feature, so the link comes from timing and the task. Carry on the work of this task using what you already know here, and do not ask them to repeat it. If the message is clearly about something unrelated, handle it as a separate new request (for example with start_task) and say so in one short sentence.`;
}
const focusNote = (R, session) => `The person is still texting about this task ("${cut(R.session(session)?.title || "", 80)}"): their latest text continues that conversation.`;
const noticesNote = (R, now) => {
  const l = rows(R, "SELECT * FROM text_alerts WHERE expects=0 AND at>? ORDER BY at DESC, id DESC LIMIT ?", now - NOTICE_WINDOW_MS, NOTICE_COUNT).reverse().filter((a) => R.session(a.session));
  return l.length ? `Recent texts you sent them that did not ask for an answer (a short reply like "thanks, do it" may refer to one): ${l.map((a) => `${when(a.at, R.tz?.())} from task "${cut(R.session(a.session)?.title || "", 60)}": "${cut(a.text, 300)}"`).join(" | ")}` : "";
};
const goneNote = (gone) => gone.length ? `Texts you sent them earlier from tasks that are now deleted or finished (their answer may be about one): ${gone.slice(0, 3).map((a) => `"${cut(a.text, 300)}"`).join("; ")}` : "";

function choiceReply(text) {
  const t = one(text); let m = t.match(/^(\d{1,2})[.)]?$/); if (m) return Number(m[1]);
  return /^(none|new|something new|other|neither)\.?$/i.test(t) ? 0 : null;
}
// Routes one incoming plain text. Returns:
//   { action: "pass" }                          ordinary Texts task handling, nothing known to add (options unchanged)
//   { action: "route", text?, messageAt? }      options now name the task (and quote and note), text replaces the incoming one when set
//   { action: "asked" }                         the app asked which task this belongs to and holds the text
// opts is the textInbound options object; it is changed in place.
export async function routeInboundText(R, { text, hasFiles = false, options, now = Date.now(), messageAt = null }) {
  textAlertInit(R.sql);
  const add = (n) => { if (n) options.note = [options.note, n].filter(Boolean).join("\n"); };
  const pass = (x = {}) => { add(noticesNote(R, now)); return { action: "pass", ...x }; };
  const quote = (a) => { options.reply = { id: a.turn || `alert-${a.id}`, role: "agent", text: a.text }; };
  const toAlert = (a) => { options.session = a.session; quote(a); add(alertNote(R, a, now)); answered(R, a.session, now); setFocus(R, a.session, now); };
  // 1. The answer to the question the app asked.
  const held = readJson(R, "text_choice");
  if (held) {
    R.put("text_choice", "");
    if (now - held.at <= CHOICE_MS) {
      const n = hasFiles ? null : choiceReply(text);
      if (n !== null) {
        const pick = n >= 1 ? rows(R, "SELECT * FROM text_alerts WHERE id=? AND state='open'", held.ids[n - 1] ?? -1)[0] : null;
        if (pick && live(R, pick.session)) { toAlert(pick); return { action: "route", text: held.text, messageAt: held.at }; }
        if (n === 0) R.sql.exec("UPDATE text_alerts SET state='moved_on' WHERE state='open'");
        return pass({ text: held.text, messageAt: held.at });
      }
      // Not a number: they went on to something else. Both texts go to the Texts task, and the unanswered alerts are closed so the same question is not asked again.
      const was = rows(R, "SELECT * FROM text_alerts WHERE id IN (" + held.ids.map(() => "?").join(",") + ")", ...held.ids);
      R.sql.exec("UPDATE text_alerts SET state='moved_on' WHERE state='open'");
      add(`Earlier they texted "${cut(held.text, 300)}" and the app asked which of your earlier texts it answered (${was.map((a) => `"${cut(a.text, 160)}"`).join("; ")}), but they sent this instead of choosing.`);
      return pass();
    }
  }
  // 2. Still talking about the task a reply was just routed to.
  const { open, gone } = openAlerts(R, now);
  const focus = readJson(R, "text_focus");
  if (focus && now - focus.at <= FOCUS_MS && live(R, focus.session) && !questionIsNewer(R, open)) {
    options.session = focus.session; add(focusNote(R, focus.session)); setFocus(R, focus.session, now);
    answered(R, focus.session, now);
    return { action: "route" };
  }
  // 3. An open alert.
  if (questionIsNewer(R, open)) return pass();
  if (!open.length) { add(goneNote(gone)); return pass(); }
  if (open.length === 1) { toAlert(open[0]); return { action: "route" }; }
  const list = open.slice(0, MAX_ASK);
  const ask = `Which one is this about? Reply with its number.\n${list.map((a, i) => `${i + 1}. ${cut(R.session(a.session)?.title || "Task", 50)}: "${cut(a.text, 70)}"`).join("\n")}\n0. Something new`;
  if (hasFiles) { add(`Several of your earlier texts are still unanswered: ${list.map((a) => `"${cut(a.text, 200)}" (task "${cut(R.session(a.session)?.title || "", 60)}")`).join("; ")}. Ask which one they mean before acting on a task.`); return pass(); }
  let d; try { d = await textSend(R.env, R.get("tenant"), ask); } catch (e) { d = { ok: false, reason: String(e.message || e).slice(0, 120) }; }
  if (!d?.ok) { add(`Several of your earlier texts are still unanswered: ${list.map((a) => `"${cut(a.text, 200)}"`).join("; ")}.`); return pass(); }
  await showInTextsTask(R, ask);
  R.put("text_choice", JSON.stringify({ ids: list.map((a) => a.id), text: String(text), at: messageAt || now }));
  return { action: "asked" };
}

// The numbered question also goes into the Texts task (a system line the helper reads too), so the phone thread and the app read the same.
async function showInTextsTask(R, text) {
  try {
    let sid = R.get("texts_session");
    if (!sid || !live(R, sid)) {
      sid = R.newSession(await R.textsTitle(R.get("tenant")));
      R.put("texts_sessions", JSON.stringify([...R.textsSessions().filter((x) => x !== sid), sid].slice(-500))); R.put("texts_session", sid);
    }
    await R.lnSysNote(sid, `You texted: ${text}`, { text_question: true });
  } catch (e) { console.log("text question line", String(e.message || e).slice(0, 120)); }
}
