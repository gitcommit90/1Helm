// Focus timer (pomodoro) bound to a task (session). The Captain: "Both the user and the main agent of a channel can do it. Bind it to
// a task. Make it fun, a nice UI, and helpful." Later: the helper may OFFER one, but only when the person brings up focus or time
// management, and not all the time.
// - At most one timer per task. Its state lives here in the Resident's SQLite (table pomodoro), so it survives reloads and reads
//   the same on every device. Phases: work → break (or the long break after the last round) → ready (the next round waits for
//   the person) … → done (after the long break). Pausing keeps the time left.
// - The state is deterministic: advance(st, now) gives the state at any time, so every read is exact and the app counts down
//   from the end time locally. The DO alarm (armNow/alarm) only wakes to save the transition and tell open tabs.
// - GLOBAL timer (Captain: "ask when you start if it's task specific or global"): one per person, not tied to any task or channel. It lives
//   in the tenant's Archive DO (table pomodoro_global, pomoGlobalMethods below), so every channel, device and reload sees the same one.
//   Same state machine; no DO alarm (every read advances it exactly, the app counts down locally). At most one global at a time:
//   starting over a running one needs replace:true (the app asks first). The task timer rules above are unchanged.
// - The helper's pomodoro tool: start/pause/resume/stop only on the person's quoted ask (person-asked.js); offer shows a card the
//   person answers (their tap is the consent), with server-side limits; status answers their question. Not for helpers.
// - Offer limits per tenant (D1 pomodoro_prefs, shared by all channels): "Don't suggest again" turns offers off; two "No thanks"
//   in a row within 14 days pause offers for 30 days unless the person brings timers up themselves.
import { personWords, checkQuote, QUOTE_MIN } from "./person-asked.js";

export const POMO_DEFAULTS = { work_min: 25, break_min: 5, long_min: 15, rounds: 4 };
const LIM = { work_min: [1, 180], break_min: [1, 60], long_min: [0, 120], rounds: [1, 12] };
export const POMO_IDLE_MS = 4 * 3600e3;            // a ready/done timer nobody restarts quietly ends
export const OFFER_TTL_MS = 2 * 3600e3;            // an unanswered offer card goes away
export const OFFER_PER_TASK_MS = 86400e3;          // at most one offer per task per day
export const DECLINE_WINDOW_MS = 14 * 86400e3;     // two No thanks in a row within this …
export const SUPPRESS_MS = 30 * 86400e3;           // … pause offers this long
const RUNNING = new Set(["work", "break", "long"]);
const MIN = 60e3;

export const POMO_DDL = [
  "CREATE TABLE IF NOT EXISTS pomodoro (session TEXT PRIMARY KEY, st TEXT NOT NULL, updated INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS pomodoro_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, at INTEGER NOT NULL, work_min INTEGER NOT NULL, break_min INTEGER NOT NULL, long_min INTEGER NOT NULL, rounds INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', decided_at INTEGER, never INTEGER NOT NULL DEFAULT 0, told INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS pomodoro_offers_s ON pomodoro_offers(session, at)",
];
export function pomoInit(sql) { for (const q of POMO_DDL) sql.exec(q); }

// ---- pure state ----
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; };
// Settings from tool/route input (missing → defaults). → { work_min, break_min, long_min, rounds } or { error }.
export function pomoSettings(a = {}, base = POMO_DEFAULTS) {
  const out = {};
  for (const k of Object.keys(LIM)) {
    const raw = a[k] ?? (k === "long_min" ? a.long_break_min : undefined);
    if (raw == null || raw === "") { out[k] = base[k] ?? POMO_DEFAULTS[k]; continue; }
    const n = int(raw), [lo, hi] = LIM[k];
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: `error: ${k === "long_min" ? "long_break_min" : k} must be a whole number from ${lo} to ${hi}.` };
    out[k] = n;
  }
  return out;
}
const ms = (st, phase) => (phase === "work" ? st.work_min : phase === "break" ? st.break_min : st.long_min) * MIN;
export function startState(set, now, by = "person") {
  return { v: 1, ...set, phase: "work", round: 1, done_rounds: 0, focused: 0, started: now, since: now, ends: now + set.work_min * MIN, paused: false, left: null, by };
}
// After a work round ends at t: a break, or after the last round the long break (or straight to done without one).
function afterWork(st, t) {
  st.done_rounds++;
  if (st.round < st.rounds) { st.phase = "break"; st.since = t; st.ends = t + ms(st, "break"); }
  else if (st.long_min > 0) { st.phase = "long"; st.since = t; st.ends = t + ms(st, "long"); }
  else { st.phase = "done"; st.since = t; st.ends = null; }
}
function workRound(st, round, now) { Object.assign(st, { phase: "work", round, since: now, ends: now + ms(st, "work"), paused: false, left: null }); }
function newSet(st, now) { Object.assign(st, { done_rounds: 0, focused: 0, started: now }); workRound(st, 1, now); }
// The state at `now`. → { st (null once a waiting timer idled out), events: [{ kind, at, round }] }.
export function advance(st0, now) {
  if (!st0) return { st: null, events: [] };
  const st = { ...st0 }, events = [];
  for (let i = 0; i < 100 && RUNNING.has(st.phase) && !st.paused && st.ends != null && st.ends <= now; i++) {
    const t = st.ends;
    if (st.phase === "work") { st.focused += ms(st, "work"); afterWork(st, t); events.push({ kind: st.phase === "break" ? "work_end" : "set_done", at: t, round: st.round }); }
    else if (st.phase === "break") { st.phase = "ready"; st.round++; st.since = t; st.ends = null; events.push({ kind: "break_end", at: t, round: st.round }); }
    else { st.phase = "done"; st.since = t; st.ends = null; events.push({ kind: "long_end", at: t, round: st.round }); }
  }
  if ((st.phase === "ready" || st.phase === "done") && now - st.since >= POMO_IDLE_MS) { events.push({ kind: "expired", at: st.since + POMO_IDLE_MS }); return { st: null, events }; }
  return { st, events };
}
// A control on the current (already advanced) state. → { st } (st null = stopped) or { error }.
export function applyAction(st0, action, now, set = null, by = "person") {
  if (action === "start") return { st: startState(set || POMO_DEFAULTS, now, by) };
  if (!st0) return { error: "error: there's no focus timer in this task." };
  const st = { ...st0 };
  if (action === "stop") return { st: null };
  if (action === "pause") {
    if (!RUNNING.has(st.phase)) return { error: `error: the timer isn't counting down (${phaseWords(st)}), so there's nothing to pause.` };
    if (st.paused) return { error: "error: the timer is already paused." };
    Object.assign(st, { paused: true, left: Math.max(0, st.ends - now), ends: null }); return { st };
  }
  if (action === "resume") {
    if (st.paused) { Object.assign(st, { paused: false, ends: now + st.left, left: null }); return { st }; }
    if (st.phase === "ready") { workRound(st, st.round, now); return { st }; }
    if (st.phase === "done") { newSet(st, now); return { st }; }
    return { error: "error: the timer is already running." };
  }
  if (action === "skip") {
    const left = st.paused ? st.left : Math.max(0, (st.ends ?? now) - now);
    if (st.phase === "work") { st.focused += Math.max(0, ms(st, "work") - left); st.paused = false; st.left = null; afterWork(st, now); return { st }; }
    if (st.phase === "break") { workRound(st, st.round + 1, now); return { st }; }
    if (st.phase === "ready") { workRound(st, st.round, now); return { st }; }
    newSet(st, now); return { st };   // long break or done: a fresh set
  }
  return { error: `error: unknown action "${action}".` };
}
// Time left in the current phase (ms), or null.
export const timeLeft = (st, now) => !st ? null : st.paused ? st.left : st.ends != null ? Math.max(0, st.ends - now) : null;
const mins = (m) => { const n = Math.max(0, Math.ceil(m / MIN)); return n === 1 ? "1 min" : `${n} min`; };
export const focusWords = (msF) => { const m = Math.round(msF / MIN), h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`; };
export function phaseWords(st) {
  if (!st) return "no timer";
  const p = st.phase === "work" ? `work round ${st.round}/${st.rounds}` : st.phase === "break" ? `short break after round ${st.round}/${st.rounds}` : st.phase === "long" ? "long break (set done)" : st.phase === "ready" ? `waiting for the person to start round ${st.round}/${st.rounds}` : "set done";
  return st.paused ? `${p}, paused` : p;
}
const setWords = (s) => `${s.work_min} min work / ${s.break_min} min break, ${s.long_min ? `${s.long_min} min long break` : "no long break"} after ${s.rounds} round${s.rounds === 1 ? "" : "s"}`;
export function statusText(st, now) {
  if (!st) return "There's no focus timer in this task.";
  const l = timeLeft(st, now);
  return `Focus timer in this task: ${phaseWords(st)}${l != null ? `, ${mins(l)} left` : ""}. Settings: ${setWords(st)}. ${st.done_rounds} round${st.done_rounds === 1 ? "" : "s"} done so far (${focusWords(st.focused)} focused).`;
}
// What the app gets (sessionView / routes / stream). now = the server's clock, so the app can correct for its own.
export function pomoPublic(st, now) {
  if (!st) return null;
  const { phase, round, rounds, ends, left, paused, since, started, work_min, break_min, long_min, focused, done_rounds, by } = st;
  return { phase, round, rounds, ends, left, paused: !!paused, since, started, work_min, break_min, long_min, focused, done_rounds, by, now };
}
export const offerPublic = (o) => !o ? null : { id: o.id, at: o.at, work_min: o.work_min, break_min: o.break_min, long_min: o.long_min, rounds: o.rounds };
// The per-turn fact for the helper (in the user message, never the system prompt): only while a timer counts down.
export function pomoContextNote(st, now) {
  if (!st || !RUNNING.has(st.phase) || st.paused) return "";
  const l = mins(timeLeft(st, now));
  const what = st.phase === "work" ? `work round ${st.round}/${st.rounds}, ${l} left` : st.phase === "break" ? `short break, ${l} left (then round ${st.round + 1}/${st.rounds})` : `long break after the set, ${l} left`;
  return `\n\n(Context note, not from the person: a focus timer is running in this task: ${what}. Keep replies to the point; don't bring the timer up unless they ask.)`;
}
export const offerNoteText = (o) => `\n\n(Context note, not from the person: they tapped No thanks on your focus-timer offer${o.never ? " and asked not to be offered timers again" : ""}. Don't offer one again${o.never ? "" : " in this task"}; start one only if they ask.)`;
// The person brought timers up themselves (lifts a paused-offers spell).
export const mentionsTimer = (words) => words.some((w) => /\b(pomodoros?|timers?|tomato|focus (session|block|sprint)s?)\b/i.test(String(w)));

// ---- the helper's tool ----
export const POMODORO_TOOL = { type: "function", function: { name: "pomodoro",
  description: "The focus timer (pomodoro): either of THIS task (scope \"task\") or the person's one GLOBAL timer (scope \"global\", not tied to any task or channel; it stays visible as they move around). When the person asks to START one and hasn't said which, DON'T guess: ask \"For this task, or everything (global)?\" and wait for their answer, then call with scope. Outside a task (no task open) it is always global. The task timer: The person sees it in the task header; when a work round ends the task shows a break overlay with a countdown, then asks them to start the next round. Defaults: 25 min work, 5 min break, a 15 min long break after 4 rounds. "
    + "start / pause / resume / stop: ONLY when the person asks you to in this conversation; pass their own words in person_asked (refused without a matching quote, and in scheduled runs, follow-ups and helpers). start replaces a running timer (use it to change the minutes); resume also starts the next round when one is waiting. "
    + "offer: shows a small card in the task (\"Want a focus timer?\") with Start / No thanks; their tap decides, so it needs no quote. Offer ONLY when the person brings up focus, procrastination, a pile of work, feeling overwhelmed or managing their time in this task (e.g. \"I keep procrastinating\", \"I need to focus for the next hour\", \"I'm overwhelmed with work today\"). Never as a generic add-on, never in unrelated tasks, never again after they said no. At most one offer per task per day and none while a timer runs; when the result says an offer isn't allowed, accept it and don't mention timers. "
    + "status: no quote needed; use it only to answer the person's own question (e.g. how long is left). "
    + "If the person tells you how they feel about timer offers (\"you ask too much\", \"stop suggesting timers\", \"I like when you suggest it\"), save that with remember (e.g. \"Don't offer focus timers unless I ask\") and follow it.",
  parameters: { type: "object", properties: {
    action: { type: "string", enum: ["start", "pause", "resume", "stop", "status", "offer"] },
    work_min: { type: "integer", description: "Work minutes per round (start or offer; default 25)" },
    break_min: { type: "integer", description: "Short break minutes (default 5)" },
    long_break_min: { type: "integer", description: "Long break minutes after the last round (default 15; 0 = none)" },
    rounds: { type: "integer", description: "Work rounds in a set (default 4)" },
    scope: { type: "string", enum: ["task", "global"], description: "start: required when you're in a task (the person's answer to task or global; ask if unclear). pause/resume/stop/status: which timer, if both exist (default: the one that exists)." },
    replace: { type: "boolean", description: "start with scope global while a global timer already runs: true only after the person agreed to replace it." },
    person_asked: { type: "string", description: "For start, pause, resume and stop: a short exact quote of the person's words asking for it, e.g. 'start a 50 minute timer'. Not needed for status or offer." } }, required: ["action"] } } };

// Quote check with timer wording (person-asked.js matches; the texts there are about marking done).
export function timerQuote(quote, words) {
  if (!words.length) return { ok: false, error: "error: there's no message from the person in this run, so the timer can't be changed. Only the person starts, pauses or stops it." };
  const q = String(quote ?? "").trim();
  if (!q) return { ok: false, error: "error: person_asked is required for this: quote the person's own words asking for it. If they didn't ask, leave the timer alone (you may offer one with action \"offer\" only when they bring up focus or time management)." };
  if (q.replace(/^["'`]+|["'`]+$/g, "").trim().length < QUOTE_MIN) return { ok: false, error: `error: person_asked "${q.slice(0, 40)}" is too short to show they asked. Quote their whole request (e.g. "start a pomodoro").` };
  const r = checkQuote(q, words);
  return r.ok ? r : { ok: false, error: `error: "${q.slice(0, 120)}" isn't in anything the person said in this conversation turn. Only change the timer when the person asks, quoting their exact words.` };
}
export { personWords };

// ---- Resident methods (mixed into Resident.prototype). The clock is pomoClock() so tests can fake it. ----
export const pomoMethods = {
  pomoClock() { return Date.now(); },
  pomoRaw(session) { const r = session ? this.sql.exec("SELECT st FROM pomodoro WHERE session=?", String(session)).toArray()[0] : null; if (!r) return null; try { return JSON.parse(r.st); } catch { return null; } },
  pomoSave(session, st) {
    if (!st) this.sql.exec("DELETE FROM pomodoro WHERE session=?", String(session));
    else this.sql.exec("INSERT INTO pomodoro (session,st,updated) VALUES (?,?,?) ON CONFLICT(session) DO UPDATE SET st=excluded.st, updated=excluded.updated", String(session), JSON.stringify(st), this.pomoClock());
  },
  // The timer as of now (a due transition is saved on read). → { st, events }.
  pomoGet(session, now = this.pomoClock()) {
    const raw = this.pomoRaw(session); if (!raw) return { st: null, events: [] };
    const r = advance(raw, now); if (r.events.length) this.pomoSave(session, r.st); return r;
  },
  pomoOffer(session, now = this.pomoClock()) {
    return session ? this.sql.exec("SELECT * FROM pomodoro_offers WHERE session=? AND status='open' AND at>? ORDER BY id DESC LIMIT 1", String(session), now - OFFER_TTL_MS).toArray()[0] || null : null;
  },
  // For sessionView: { timer, offer } or null.
  pomoView(session) {
    const now = this.pomoClock(), { st } = this.pomoGet(session, now), o = this.pomoOffer(session, now);
    return st || o ? { timer: pomoPublic(st, now), offer: offerPublic(o) } : null;
  },
  pomoField(session) { const v = this.pomoView(session); return v ? { pomodoro: v } : {}; },
  pomoEmit(session) { const v = this.pomoView(session); try { this.liveTurn?.(session)?.emit?.({ t: "pomodoro", session, pomodoro: v }); } catch {} return v; },
  // Next alarm time for timers: the soonest phase end, or a waiting timer's idle end.
  pomoNext(now = this.pomoClock()) {
    let t = null;
    for (const r of this.sql.exec("SELECT st FROM pomodoro").toArray()) {
      let st; try { st = JSON.parse(r.st); } catch { continue; }
      const x = RUNNING.has(st.phase) && !st.paused ? st.ends : (st.phase === "ready" || st.phase === "done") ? st.since + POMO_IDLE_MS : null;
      if (x != null && (t == null || x < t)) t = x;
    }
    return t;
  },
  // From the alarm: save every due transition and tell the task's open tab (the others see it on their next poll).
  async pomoAlarm(now = this.pomoClock()) {
    const out = [];
    for (const r of this.sql.exec("SELECT session FROM pomodoro").toArray()) { const g = this.pomoGet(r.session, now); if (g.events.length) { out.push({ session: r.session, events: g.events }); this.pomoEmit(r.session); } }
    return out;
  },
  // Tenant-wide offer preferences (D1, all channels). Missing table or row → defaults.
  async pomoPrefs() {
    const d = { offers: "", streak: 0, last_decline: 0, suppressed_until: 0 };
    try { const r = await this.env.DB.prepare("SELECT offers, streak, last_decline, suppressed_until FROM pomodoro_prefs WHERE tenant_id=?").bind(this.get("tenant")).first(); return r ? { ...d, ...r } : d; } catch { return d; }
  },
  async pomoPrefsSave(p) {
    try { await this.env.DB.prepare("INSERT INTO pomodoro_prefs (tenant_id,offers,streak,last_decline,suppressed_until,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET offers=excluded.offers, streak=excluded.streak, last_decline=excluded.last_decline, suppressed_until=excluded.suppressed_until, updated_at=excluded.updated_at")
      .bind(this.get("tenant"), p.offers || "", p.streak | 0, p.last_decline || 0, p.suppressed_until || 0, this.pomoClock()).run(); } catch (e) { console.log("pomodoro prefs", e.message); }
  },
  // The app's controls (POST /sessions/<id>/pomodoro). by = "person". → { pomodoro, prefs? } or { error }.
  async pomoAction(session, b = {}, by = "person") {
    if (!this.session(session)) return { error: "No such task in this channel." };
    const now = this.pomoClock(), action = String(b.action || "");
    if (action === "get") return { pomodoro: this.pomoView(session), prefs: await this.pomoPrefsPublic() };
    if (action === "offers_on") { const p = await this.pomoPrefs(); await this.pomoPrefsSave({ ...p, offers: "", streak: 0, suppressed_until: 0 }); return { pomodoro: this.pomoView(session), prefs: await this.pomoPrefsPublic() }; }
    if (action === "offer_accept" || action === "offer_decline") {
      const o = this.sql.exec("SELECT * FROM pomodoro_offers WHERE id=? AND session=?", Number(b.offer), String(session)).toArray()[0];
      if (!o || o.status !== "open" || o.at <= now - OFFER_TTL_MS) return { error: "That offer isn't open anymore.", pomodoro: this.pomoView(session) };
      const p = await this.pomoPrefs();
      if (action === "offer_decline") {
        const never = !!b.never;
        this.sql.exec("UPDATE pomodoro_offers SET status='declined', decided_at=?, never=?, told=0 WHERE id=?", now, never ? 1 : 0, o.id);
        const streak = p.streak >= 1 && now - p.last_decline <= DECLINE_WINDOW_MS ? p.streak + 1 : 1;
        await this.pomoPrefsSave({ ...p, offers: never ? "off" : p.offers, streak, last_decline: now, suppressed_until: streak >= 2 ? now + SUPPRESS_MS : p.suppressed_until });
        return { pomodoro: this.pomoEmit(session), prefs: await this.pomoPrefsPublic() };
      }
      this.sql.exec("UPDATE pomodoro_offers SET status='accepted', decided_at=?, told=1 WHERE id=?", now, o.id);
      await this.pomoPrefsSave({ ...p, streak: 0 });
      const { st } = this.pomoGet(session, now);
      if (!st || st.phase === "done") { this.pomoSave(session, startState({ work_min: o.work_min, break_min: o.break_min, long_min: o.long_min, rounds: o.rounds }, now, "person")); await this.arm?.(); }
      return { pomodoro: this.pomoEmit(session) };
    }
    if (!["start", "pause", "resume", "skip", "stop"].includes(action)) return { error: "action must be start, pause, resume, skip, stop, offer_accept, offer_decline or offers_on" };
    let set = null; if (action === "start") { set = pomoSettings(b); if (set.error) return { error: set.error.replace(/^error: /, "") }; }
    const { st } = this.pomoGet(session, now), r = applyAction(st, action, now, set, by);
    if (r.error) return { error: r.error.replace(/^error: /, ""), pomodoro: this.pomoView(session) };
    this.pomoSave(session, r.st);
    if (action === "start") this.sql.exec("UPDATE pomodoro_offers SET status='closed', decided_at=? WHERE session=? AND status='open'", now, String(session));
    await this.arm?.();
    return { pomodoro: this.pomoEmit(session) };
  },
  async pomoPrefsPublic() { const p = await this.pomoPrefs(), now = this.pomoClock(); return { offers: p.offers === "off" ? "off" : now < p.suppressed_until ? "paused" : "on" }; },
  // The tenant's global timer lives in the Archive DO (tests replace pomoGlobalStub with a fake).
  pomoGlobalStub() { return this.env.ARCHIVE.get(this.env.ARCHIVE.idFromName(`archive:${this.get("tenant")}`)); },
  async pomoGlobalPeek() { try { return await this.pomoGlobalStub().pomoGlobalView(); } catch { return null; } },
  async pomoGlobalTool(action, a, now, session = null) {
    const G = this.pomoGlobalStub();
    if (action === "status") { const v = await this.pomoGlobalPeek(); return globalStatusText(v ? { ...v.timer } : null, now); }
    let set = null; if (action === "start") { set = pomoSettings({ work_min: a.work_min, break_min: a.break_min, long_break_min: a.long_break_min, long_min: a.long_min, rounds: a.rounds }); if (set.error) return set.error; }
    const prevView = await this.pomoGlobalPeek(), prev = prevView?.timer || null;
    if (action === "start" && prev && prev.phase !== "done" && !a.replace) return `error: a global focus timer is already running (${phaseWords(prev)}). Ask the person whether to replace it; if yes, call start again with replace true.`;
    const r = await G.pomoGlobalAction({ action, ...(set || {}), replace: !!a.replace }, "helper");
    if (r.error) return `error: ${r.error}`;
    this.pomoEmitGlobal(r.pomodoro, session);
    const st = r.pomodoro?.timer || null;
    if (action === "stop") return `Stopped the global focus timer (${prev?.done_rounds ?? 0} round${prev?.done_rounds === 1 ? "" : "s"} done). It's gone from the person's screen.`;
    if (action === "start") return `Started a GLOBAL focus timer (not tied to any task; it stays on the person's screen as they move around): ${setWords(st)}. Round 1 ends in ${mins(st.work_min * MIN)}.${prev && prev.phase !== "done" ? " It replaced the one that was running." : ""}`;
    return globalStatusText(st, now);
  },
  pomoEmitGlobal(v, session) { try { if (session) this.liveTurn?.(session)?.emit?.({ t: "pomodoro_global", pomodoro: v }); } catch {} },
  // The helper's pomodoro tool: the current task's timer, or the person's global one (scope).
  async pomoTool(ctx = {}, a = {}) {
    const action = String(a.action || "").trim().toLowerCase(), session = ctx.session, now = this.pomoClock();
    let scope = String(a.scope || "").trim().toLowerCase(); if (scope && scope !== "task" && scope !== "global") return 'error: scope must be "task" or "global".';
    if (!session) { if (scope === "task") return "error: this run isn't in a task, so there's no task timer. Use scope global."; if (action === "offer") return "error: this run isn't in a task, so there's no timer to offer."; scope = "global"; }
    if (action === "status") {
      if (scope === "global") return this.pomoGlobalTool("status", a, now, session);
      const t = statusText(this.pomoGet(session, now).st, now), g = scope ? "" : await this.pomoGlobalTool("status", a, now).catch(() => "");
      return g && !g.startsWith("There's no") ? `${t} ${g}` : t;
    }
    const words = personWords(ctx);
    if (action === "offer") {
      if (!words.length) return "error: offers are only for a conversation with the person (not scheduled runs or handed-back results). Don't mention timers.";
      const p = await this.pomoPrefs();
      if (p.offers === "off") return "error: the person asked not to be offered timers. Don't offer or mention one; start one only if they ask.";
      const { st } = this.pomoGet(session, now);
      if (st && st.phase !== "done") return `error: a focus timer is already going in this task (${phaseWords(st)}), so there's nothing to offer.`;
      const recent = this.sql.exec("SELECT COUNT(*) n FROM pomodoro_offers WHERE session=? AND at>?", String(session), now - OFFER_PER_TASK_MS).one().n;
      if (recent) return "error: you already offered a focus timer in this task today. Don't offer it again or bring it up.";
      if (now < p.suppressed_until && !mentionsTimer(words)) return "error: the person turned down timer offers recently, so offers are paused for now. Don't offer or mention timers unless they bring them up.";
      const set = pomoSettings({ work_min: a.work_min, break_min: a.break_min, long_min: a.long_break_min ?? a.long_min, rounds: a.rounds }); if (set.error) return set.error;
      this.sql.exec("INSERT INTO pomodoro_offers (session,at,work_min,break_min,long_min,rounds) VALUES (?,?,?,?,?,?)", String(session), now, set.work_min, set.break_min, set.long_min, set.rounds);
      this.pomoEmit(session);
      return `Offered a focus timer (${set.work_min} min work / ${set.break_min} min break): a card in the task asks them, with Start / No thanks, and their tap decides. Mention it in a few words at most, then carry on with what they asked.`;
    }
    if (!["start", "pause", "resume", "stop"].includes(action)) return "error: action must be start, pause, resume, stop, status or offer.";
    const q = timerQuote(a.person_asked, words); if (!q.ok) return q.error;
    if (action === "start" && !scope) return 'error: ask the person first: "For this task, or everything (global)?" A task timer belongs to this task; a global one stays on their screen across all tasks and channels. Then call start again with scope task or global.';
    if (!scope) {   // pause / resume / stop without a scope: the one that exists
      const hasTask = !!this.pomoGet(session, now).st, hasGlobal = !!(await this.pomoGlobalPeek());
      if (hasTask && hasGlobal) return "error: there's a timer in this task and a global one. Ask the person which one, then call again with scope task or global.";
      scope = hasGlobal && !hasTask ? "global" : "task";
    }
    if (scope === "global") return this.pomoGlobalTool(action, a, now, session);
    let set = null; if (action === "start") { set = pomoSettings({ work_min: a.work_min, break_min: a.break_min, long_min: a.long_break_min ?? a.long_min, rounds: a.rounds }); if (set.error) return set.error; }
    const prev = this.pomoGet(session, now).st, r = applyAction(prev, action, now, set, "helper"); if (r.error) return r.error;
    this.pomoSave(session, r.st);
    if (action === "start") this.sql.exec("UPDATE pomodoro_offers SET status='closed', decided_at=? WHERE session=? AND status='open'", now, String(session));
    await this.arm?.(); this.pomoEmit(session);
    if (action === "stop") return `Stopped the focus timer (${prev.done_rounds} round${prev.done_rounds === 1 ? "" : "s"} done, ${focusWords(prev.focused + (prev.phase === "work" ? Math.max(0, ms(prev, "work") - timeLeft(prev, now)) : 0))} focused). It's gone from the task header.`;
    if (action === "start") return `Started a focus timer in this task${prev && prev.phase !== "done" ? " (it replaced the one that was running)" : ""}: ${setWords(r.st)}. Round 1 ends in ${mins(r.st.work_min * MIN)}. The person sees it in the task header and gets a break overlay when the round ends.`;
    return statusText(r.st, now);
  },
  // Per-turn context: the running timer (compact), plus a declined offer the helper hasn't heard about yet (said once).
  pomoNote(session) {
    if (!session) return "";
    const now = this.pomoClock(), note = pomoContextNote(this.pomoGet(session, now).st, now);
    const o = this.sql.exec("SELECT * FROM pomodoro_offers WHERE session=? AND status='declined' AND told=0 ORDER BY id DESC LIMIT 1", String(session)).toArray()[0];
    if (o) this.sql.exec("UPDATE pomodoro_offers SET told=1 WHERE session=? AND status='declined'", String(session));
    return note + (o ? offerNoteText(o) : "");
  },
};

// ---- the global timer (tenant-level; lives in the Archive DO, which is one per person) ----
export const POMO_GLOBAL_DDL = "CREATE TABLE IF NOT EXISTS pomodoro_global (k TEXT PRIMARY KEY, st TEXT NOT NULL, updated INTEGER NOT NULL)";
export const pomoGlobalMethods = {
  pgClock() { return Date.now(); },
  pgRaw() { this.sql.exec(POMO_GLOBAL_DDL); const r = this.sql.exec("SELECT st FROM pomodoro_global WHERE k='g'").toArray()[0]; if (!r) return null; try { return JSON.parse(r.st); } catch { return null; } },
  pgSave(st) {
    this.sql.exec(POMO_GLOBAL_DDL);
    if (!st) this.sql.exec("DELETE FROM pomodoro_global WHERE k='g'");
    else this.sql.exec("INSERT INTO pomodoro_global (k,st,updated) VALUES ('g',?,?) ON CONFLICT(k) DO UPDATE SET st=excluded.st, updated=excluded.updated", JSON.stringify(st), this.pgClock());
  },
  // The global timer as of now (a due transition or idle expiry is saved on read). → { st, events }.
  pgGet(now = this.pgClock()) { const raw = this.pgRaw(); if (!raw) return { st: null, events: [] }; const r = advance(raw, now); if (r.events.length) this.pgSave(r.st); return r; },
  async pomoGlobalView() { const now = this.pgClock(), { st } = this.pgGet(now); return st ? { timer: pomoPublic(st, now), offer: null } : null; },
  // b: { action: get | start | pause | resume | skip | stop, replace?, work_min… }. → { pomodoro } or { error, code?, pomodoro }.
  async pomoGlobalAction(b = {}, by = "person") {
    const now = this.pgClock(), action = String(b.action || "get");
    if (action === "get") return { pomodoro: await this.pomoGlobalView() };
    if (!["start", "pause", "resume", "skip", "stop"].includes(action)) return { error: "action must be start, pause, resume, skip, stop or get" };
    const { st } = this.pgGet(now);
    let set = null;
    if (action === "start") {
      set = pomoSettings(b); if (set.error) return { error: set.error.replace(/^error: /, "") };
      if (st && st.phase !== "done" && !b.replace) return { error: "A global timer is already running. Replace it?", code: "running", pomodoro: await this.pomoGlobalView() };
    }
    const r = applyAction(st, action, now, set, by);
    if (r.error) return { error: r.error.replace(/^error: /, "").replace("in this task", "that's global"), pomodoro: await this.pomoGlobalView() };
    this.pgSave(r.st);
    return { pomodoro: await this.pomoGlobalView() };
  },
};
export const globalStatusText = (st, now) => !st ? "There's no global focus timer." : statusText(st, now).replace("Focus timer in this task:", "Global focus timer (not tied to a task):");
