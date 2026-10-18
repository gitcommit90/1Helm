// Resumable chat turns (deploy-safe agents Phase 1, notes/2026-10-08-deploy-safe-agents.md §3.1–3.3, §3.5–3.6).
// A deploy resets the Resident with no warning. Every step of a turn is already saved (msgs, card steps); this adds the rest of what a
// fresh object needs to carry the SAME turn on, in the same card, with the same budget and cost:
//   turn_runs     one row per chat turn while it runs: its input, options, engine, step, stats (charge so far), spend-guard state,
//                 what it said, its route, a heartbeat. Written before the first model call and at every step; deleted at the end.
//   turn_effects  one row per tool call, written BEFORE the call runs (status started) and closed with its result (done).
// Waking up: while a turn runs, the alarm is armed at heartbeat + 90 s (armNow), so a reset object wakes on the new code by itself;
// opening the task (attach) wakes it sooner. The constructor (recoverTurns) marks journaled cards "resuming" (never "interrupted") and
// the alarm (resumeDue) resumes them, never inside the constructor.
// Resume (Resident.runTurn with opts.resume): fresh system prompt and history, the turn's own saved input, then its saved messages
// (from its last context checkpoint when it had one). The tool calls the kill left open are closed by type:
//   done in the journal → its saved result · never started → run now, through every normal gate · read → run again ·
//   exec (run_command, write_file, edit_file) → "may have finished or been cut off, check its effects" ·
//   write / send / act → NEVER run again: "may or may not have gone through, check first" (a confirm token it used stays used, so
//   doing it again needs a new confirm card and a new tap) · a confirm card still waiting for the tap → "waiting for confirm" ·
//   start_helper / schedules → the helper or schedule it made, if any; else run again (nothing was made).
// Then one context note ("1Helm was updated while you were working on this…") and the normal loop continues from the next step.
// Unread steers go back on the card (and new messages join it while it's resuming); queued cards of the task run after it, in order;
// a texted turn still texts its one reply. At most RESUME_MAX resumes per turn, and a resume on the same code within 60 s of the last
// one is a crash loop, not a deploy: either way the card ends "interrupted" (the app's plain "send it again").
// Both engines: classic (resident.js runTurnInner) and pi (pi-engine.js runTurnPi) journal the same way and resume from the same rebuild.
// Model-agnostic: nothing here depends on which model runs the turn.
import { READ_ACT } from "./worklog.js";
import { CONFIRM, CONFIRM_TOOLS } from "./confirm.js";
import { codeV } from "./do-stub.js";
import { recoverCards, cardView, setStatus, stepBegin, stepEnd, commitCard } from "./tracker.js";
import { STOPPED_REPLY } from "./stop.js";
import { commandLimitMs } from "./spendguard.js";
import { originInput } from "./message-origin.js";
import { replyIn } from "./reply-to.js";   // a resumed card's unread steers keep the message each one replies to
const RUN_TIMED_OUT = "[1Helm: this command was still running after its time limit, so it was stopped.]";

export const RESUME_MAX = 3, BEAT_MS = 90e3, CRASH_LOOP_MS = 60e3, BACKSTOP_MS = 120e3;
// The turns that are journaled and resume: chat (incl. handoffs, follow-ups, plan tasks), scheduled runs (workflow / follow-up /
// app event, their bookkeeping finishes after the resume: workflowFinish / eventFinish) and background helpers (helperRun).
export const JOURNALED = new Set(["chat", "workflow", "followup", "helper"]);
// A computer tool call's run id (ChannelComputer.sh/reattach): its card and call id, safe in a file name.
export const runIdOf = (card, callId) => `${String(card).replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}_${String(callId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
const COMPUTER_EXEC = new Set(["run_command", "write_file", "edit_file"]);
const jk = (tc) => JOURNALED.has(tc?.kind) && !!tc?.turn;
export const RESUME_NOTE = "(Context note, not from the person: 1Helm was updated while you were working on this. You're continuing the same request; everything above already happened. Don't repeat finished steps.)";
export const MAYBE_DONE = "(1Helm was updated at the moment this ran. It may or may not have gone through. Check first (e.g. the Sent folder, or the item itself) before doing it again. If you do redo it and it needs the person's confirm, they'll be asked again; don't ask them yourself unless it clearly didn't happen.)";
export const MAYBE_RAN = "(1Helm was updated while this command was running. It may have finished or been cut off. Check its effects (e.g. the files it writes) before running it again.)";
export const WAITING_CONFIRM = (title) => `WAITING FOR CONFIRM: 1Helm was updated while this waited for the person's tap on its confirm card (${title}). Nothing was done yet, and the card is still there for them. End your turn now with one short line, e.g. "It's ready: tap Confirm to send it." Don't ask again in your own words.`;

// ---- what kind of call (§3.3.2) ----
const READ = new Set(["web_search", "search_web_vertical", "fetch_url", "read_file", "search_files", "calendar_events", "gmail_search", "gmail_read", "work_log", "bring_back", "recall_history",
  "read_skill", "read_doc", "load_tools", "read_context", "recall_memory", "ambient_query", "location_query", "list_channels", "list_tasks", "read_task", "browser_snapshot", "browser_screenshot", "browser_navigate", "list_workflows", "app_actions", "app_events", "find_app", "memory_explain", "check_purchase", "ping"]);
const EXEC = new Set(["run_command", "write_file", "edit_file"]);
const ONCE = new Set(["start_helper", "schedule_followup", "schedule_workflow"]);
const LOCAL = new Set(["update_todos", "react", "set_workflow_gate", "save_run_notes", "ask_user", "request_input", "interview", "send_poll"]);   // own rows, or send_poll with its durable provider idempotency key
export function toolClass(name, a = {}) {
  const n = String(name || "");
  if (n === "update_todos" && (a?.channel || a?.task)) return "write";   // a targeted replacement may already have reached another task
  if (n === "app_run") return READ_ACT.test(String(a?.action || "").toUpperCase()) ? "read" : "write";
  if (n === "app_proxy") return String(a?.method || "GET").toUpperCase() === "GET" ? "read" : "write";
  return READ.has(n) ? "read" : EXEC.has(n) ? "exec" : ONCE.has(n) ? "once" : LOCAL.has(n) ? "local" : "write";   // anything else: never repeated blindly
}

export function resumeInit(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS turn_runs (card TEXT PRIMARY KEY, session TEXT, kind TEXT NOT NULL, engine TEXT, text TEXT, user_text TEXT, opts TEXT,
      status TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, phase TEXT, resumes INTEGER NOT NULL DEFAULT 0, code_v TEXT, last_resume INTEGER,
      stats TEXT, guard TEXT, said TEXT, route TEXT, extra TEXT, started INTEGER NOT NULL, beat INTEGER NOT NULL, resume_at INTEGER, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS turn_effects (card TEXT NOT NULL, call_id TEXT NOT NULL, tool TEXT, cls TEXT, status TEXT NOT NULL, result TEXT, at INTEGER NOT NULL, done_at INTEGER,
      PRIMARY KEY (card, call_id));`);
}
const J = (x, d = null) => { try { return x == null ? d : JSON.parse(x); } catch { return d; } };
// The spend guard's state as JSON (its runaway watch keeps word Sets; its wall timer is not state).
export function guardOut(g) {
  if (!g) return null;
  const { wallT, ...rest } = g;
  return JSON.stringify(rest, (k, v) => (v instanceof Set ? { __set: [...v] } : v));
}
export function guardIn(s) { return s ? JSON.parse(s, (k, v) => (v && typeof v === "object" && Array.isArray(v.__set) ? new Set(v.__set) : v)) : null; }
// opts that can be stored (no functions, no stream); the resume flag itself is never stored.
const optsOut = (o = {}) => JSON.stringify(o, (k, v) => (typeof v === "function" || k === "resume" ? undefined : v));

export function resumeMix(Resident) { return Object.assign(Resident.prototype, {
  // ---- the journal (sync SQL: durable before anything leaves this object) ----
  journalStart(tc, text, opts, queued) {
    if (!jk(tc)) return;
    const now = Date.now();
    try {
      if (opts.resume) { this.sql.exec("UPDATE turn_runs SET status='running', beat=?, updated=? WHERE card=?", now, now, tc.turn); return; }
      this.sql.exec("INSERT OR REPLACE INTO turn_runs (card,session,kind,text,opts,status,started,beat,updated,code_v) VALUES (?,?,?,?,?,?,?,?,?,?)",
        tc.turn, tc.session, tc.kind, String(text ?? ""), optsOut(opts), queued ? "queued" : "running", now, now, now, codeV(this.env));
    } catch (e) { console.log("journal start", e.message); }
  },
  journalRunning(tc) { if (jk(tc)) { try { this.sql.exec("UPDATE turn_runs SET status='running', beat=?, updated=? WHERE card=? AND status='queued'", Date.now(), Date.now(), tc.turn); } catch {} } },
  // Once the turn's input is built (and whenever the engine is known): what a resume needs to rebuild the same first message.
  journalInput(tc, { userText, engine, ctxMode }) {
    if (!jk(tc)) return;
    try { this.sql.exec("UPDATE turn_runs SET user_text=?, engine=?, route=?, extra=?, updated=? WHERE card=?", typeof userText === "string" ? userText : JSON.stringify(userText), engine, tc.route ? JSON.stringify(tc.route) : null,
      JSON.stringify({ ctx: ctxMode, audioWait: tc.audioWait || null, audioSources: tc.audioSources || null, appendRuntime: !!tc.appendRuntime, handoff: !!tc.handoff, handoffFrom: tc.handoffFrom || null, userText0: tc.userText, hint: tc.hint || null, outputLimitRetries: tc.outputLimitRetries || 0, modelFailure: tc.modelFailure || null, failedModelUsage: tc.failedModelUsage || null, ...(tc.context ? { context: tc.appendRuntime ? { version: 2, core: "", developer: "", standing: {}, turn: {} } : tc.context } : {}) }), Date.now(), tc.turn); } catch (e) { console.log("journal input", e.message); }
  },
  // A local routing mutation can finish before the next model-step checkpoint.
  // Save its typed outcome before yielding, so recovery never repeats a send or
  // approval based on missing live flags. No tool-result prose is interpreted.
  journalDelegation(tc, action, result) {
    if (!jk(tc) || !tc.orchestration || !tc.callId) return;
    const keys = ["steer", "review", "started", "sent", "approved", "waitingInput", "requiredDelegation", "clarifying"];
    const state = Object.fromEntries(keys.map(k => [k, tc.orchestration[k] ?? null]));
    const id = ["ask_user","interview","send_poll"].includes(action) ? tc.inputRequest?.helper_id : state.approved || state.review || state.steer || state.started;
    const h = id ? this.sql.exec("SELECT id,session,round FROM helpers WHERE id=?", Number(id)).toArray()[0] : null;
    const outcome = { turn: tc.turn, session: tc.session, call_id: tc.callId, action, state, helper_id: h?.id || null, round: h?.round || null, question_id: tc.inputRequest?.question_id || null };
    const effect = this.sql.exec("SELECT tool FROM turn_effects WHERE card=? AND call_id=?", tc.turn, tc.callId).toArray()[0];
    if (effect?.tool !== action) throw new Error("Missing delegation call identity");
    const write = () => {
      const written = this.sql.exec("UPDATE turn_runs SET extra=json_set(COALESCE(extra,'{}'),'$.delegationOutcome',json(?)) WHERE card=? AND session=? RETURNING card", JSON.stringify(outcome), tc.turn, tc.session).toArray();
      if (!written.length) throw new Error("Missing delegation turn journal");
      this.sql.exec("UPDATE turn_effects SET status='done',result=?,done_at=? WHERE card=? AND call_id=?", String(result ?? ""), Date.now(), tc.turn, tc.callId);
    };
    this.ctx.storage.transactionSync(write);
  },
  restoreDelegation(tc) {
    if (!jk(tc) || !tc.taskProfile?.dynamicRouting || tc.helper) return;
    const row = this.sql.exec("SELECT extra FROM turn_runs WHERE card=? AND session=?", tc.turn, tc.session).toArray()[0];
    const saved = J(row?.extra, {}).delegationOutcome;
    if (saved?.turn === tc.turn && saved.session === tc.session && saved.call_id && saved.state) {
      const effect = this.sql.exec("SELECT tool,status FROM turn_effects WHERE card=? AND call_id=?", tc.turn, saved.call_id).toArray()[0];
      const h = saved.helper_id ? this.sql.exec("SELECT session,round FROM helpers WHERE id=?", saved.helper_id).toArray()[0] : null;
      const action = ["start_helper", "message_subagent", "approve_subagent", "ask_user", "interview", "send_poll"].includes(saved.action) && effect?.tool === saved.action && effect.status === "done";
      // A recorded send remains sent when its worker later advances rounds.
      const worker = !saved.helper_id || h?.session === tc.session && Number.isInteger(saved.round) && saved.round > 0 && Number(h.round) >= saved.round;
      const q = saved.question_id ? this.sql.exec("SELECT session,source_turn,helper_id,round FROM user_questions WHERE id=?", saved.question_id).toArray()[0] : null;
      const question = !saved.state.waitingInput || q?.session === tc.session && q.source_turn === tc.turn && (!saved.helper_id || q.helper_id === saved.helper_id && q.round === saved.round);
      if (action && worker && question) { tc.orchestration = { ...tc.orchestration, ...saved.state }; tc.delegationUncertain = false; }
      else tc.delegationUncertain = true;
      return;
    }
    // Old builds have no typed outcome. An exact spawn identity can safely
    // restore a start. Other possibly completed control writes must not run
    // again or be described as successful without an authoritative outcome.
    const effects = this.sql.exec("SELECT call_id,tool FROM turn_effects WHERE card=? AND tool IN ('start_helper','message_subagent','approve_subagent')", tc.turn).toArray();
    for (const effect of effects) {
      if (effect.tool === "start_helper") {
        const h = this.sql.exec("SELECT id FROM helpers WHERE parent_card=? AND spawn_call_id=? AND session=?", tc.turn, effect.call_id, tc.session).toArray()[0];
        if (h) { tc.orchestration ||= {}; tc.orchestration.started = h.id; if (tc.orchestration.requiredDelegation) tc.orchestration.sent = true; }
      } else tc.delegationUncertain = true;
    }
  },
  // Every step: where the loop is, what it has spent, its guard, what it said. phase "model" = before step's model call, "tools" = after it.
  journalStep(tc, { step, phase = "model", stats, said, saidMeta, checkpoints = 0 }) {
    const hid = tc?.helper?.id ?? tc?.helperId;   // a running helper's use so far, for its card, the person and the limits' accounting
    if (hid != null && stats) { try { this.sql.exec("UPDATE helpers SET live_tool_calls=?, live_model_steps=?, live_charge_nano=? WHERE id=? AND status='running'", Number(stats.tool_calls) || 0, Number(stats.steps) || 0, Math.round(Number(stats.charge) || 0), Number(hid)); } catch {} }
    if (!jk(tc)) return;
    if (tc.context) this.sql.exec("UPDATE turn_runs SET extra=json_set(COALESCE(extra,'{}'),'$.loadedTools',json(?)) WHERE card=?", JSON.stringify([...(tc.loadedTools || [])]), tc.turn);
    if (Array.isArray(saidMeta)) this.sql.exec("UPDATE turn_runs SET extra=json_set(COALESCE(extra,'{}'),'$.saidMeta',json(?),'$.progressOmitted',?) WHERE card=?", JSON.stringify(saidMeta), tc.progressOmitted || 0, tc.turn);
    try { this.sql.exec("UPDATE turn_runs SET step=?, phase=?, stats=?, guard=?, said=?, route=?, extra=json_set(COALESCE(extra,'{}'),'$.checkpoints',?,'$.charged',?,'$.limitWhy',?,'$.pause',json(?),'$.stall',json(?)), beat=?, updated=? WHERE card=?",
      step, phase, JSON.stringify(stats || {}), guardOut(tc.guard), JSON.stringify(said || []), tc.route ? JSON.stringify(tc.route) : null, checkpoints, tc.charged || 0, tc.limitWhy || null, tc.pause ? JSON.stringify(tc.pause) : "null", tc.stallState ? JSON.stringify(tc.stallState) : "null", Date.now(), Date.now(), tc.turn); }
    catch (e) { console.log("journal step", e.message); }
  },
  journalBeat(tc) {
    if (!jk(tc)) return;
    try { this.sql.exec("UPDATE turn_runs SET beat=? WHERE card=?", Date.now(), tc.turn);
      // a scheduled run that's alive keeps its workflow's lease, so a long run (or one being resumed) is never started a second time
      if (tc.workflow_id != null) this.sql.exec("UPDATE workflows SET lease_until=MAX(lease_until, ?) WHERE id=? AND lease_until>0", Date.now() + 14 * 60e3, tc.workflow_id); } catch {}
  },
  journalModelRecovery(tc) {
    if (!jk(tc)) return;
    // Do not swallow a failed write: retrying without its durable allowance
    // could grant another recovery attempt after every deployment.
    this.sql.exec("UPDATE turn_runs SET extra=json_set(COALESCE(extra,'{}'),'$.outputLimitRetries',?,'$.modelFailure',json(?),'$.failedModelUsage',json(?)) WHERE card=?",
      tc.outputLimitRetries || 0, JSON.stringify(tc.modelFailure || null), JSON.stringify(tc.failedModelUsage || null), tc.turn);
  },
  journalDone(tc) { if (tc.turn) { try { this.sql.exec("DELETE FROM turn_runs WHERE card=?", tc.turn); this.sql.exec("DELETE FROM turn_effects WHERE card=?", tc.turn); } catch {} } if (tc.kind === "chat") this._resuming?.delete?.(tc.session); },
  effectStart(tc, callId, name, args) {
    if (!jk(tc) || !callId) return;
    try { this.sql.exec("INSERT OR REPLACE INTO turn_effects (card,call_id,tool,cls,status,at) VALUES (?,?,?,?,'started',?)", tc.turn, String(callId), String(name), toolClass(name, args), Date.now()); } catch (e) { console.log("effect start", e.message); }
  },
  effectDone(tc, callId, out) {
    if (!jk(tc) || !callId) return;
    try { this.sql.exec("UPDATE turn_effects SET status='done', result=?, done_at=? WHERE card=? AND call_id=?", String(out ?? "").slice(0, 20000), Date.now(), tc.turn, String(callId)); } catch {}
  },
  // A running turn: make sure the alarm fires by its heartbeat + 90 s (only moves an alarm earlier, never touches the other schedules).
  armBeat() {
    const t = Date.now() + BEAT_MS;
    this.ctx.waitUntil?.(this.ctx.storage.getAlarm().then((a) => { if (a == null || a > t) { this._beatAt = t; return this.ctx.storage.setAlarm(t); } }).catch((e) => console.log("beat alarm", e.message)));
  },
  // Inside alarm(): the alarm that's running is already used up, and a deploy that cuts this handler off doesn't retry it (measured on
  // dev 10-08). So while any turn is journaled, a wake-up at heartbeat + 90 s is stored again right away, before the handler's long work.
  // Not only for turns: whatever this handler is doing (a workflow run, a text batch, a resume), a deploy that cuts it off leaves a wake-up
  // in BACKSTOP_MS (or the heartbeat window when a turn is journaled), and the handler's own arm() at the end replaces it.
  armBackstop() {
    let n = 0; try { n = this.sql.exec("SELECT COUNT(*) n FROM turn_runs WHERE status IN ('running','resuming','queued')").one().n; } catch {}
    const t = Date.now() + (n ? BEAT_MS : BACKSTOP_MS);
    this.ctx.waitUntil?.(this.ctx.storage.getAlarm().then((a) => { if (a == null || a > t) { this._beatAt = t; return this.ctx.storage.setAlarm(t); } }).catch((e) => console.log("backstop alarm", e.message)));
  },
  // A workflow (or app event) whose run is journaled: never started a second time while that run can still resume.
  journaledWorkflows() {
    try { return new Set(this.sql.exec("SELECT json_extract(opts,'$.workflow_id') w FROM turn_runs WHERE json_extract(opts,'$.workflow_id') IS NOT NULL").toArray().map((x) => Number(x.w))); } catch { return new Set(); }
  },
  // The turn ended: when the alarm set is only its heartbeat and nothing else of the journal runs, put the alarm back to what's due
  // (outside alarm(), which re-arms itself when it's done).
  beatDone() {
    if (this._inAlarm || this._beatAt == null) return;
    try { if (this.sql.exec("SELECT COUNT(*) n FROM turn_runs").one().n) return; } catch { return; }
    this.ctx.waitUntil?.(this.ctx.storage.getAlarm().then((a) => (a === this._beatAt ? this.arm() : null)).catch(() => {}));
  },
  // When the alarm must wake for journaled turns: a resume that's due, or a running turn's heartbeat + 90 s (it died if nobody beat).
  journalNext() {
    try { const r = this.sql.exec("SELECT MIN(CASE WHEN status='running' THEN beat + ? ELSE resume_at END) t FROM turn_runs WHERE status='running' OR resume_at IS NOT NULL", BEAT_MS).one(); return r?.t ?? null; } catch { return null; }
  },

  // ---- a fresh object (constructor): journaled cards resume instead of being interrupted. → the card ids left for recoverCards to skip ----
  recoverTurns() {
    const now = Date.now(), keep = new Set(); let rows = [];
    try { rows = this.sql.exec("SELECT * FROM turn_runs ORDER BY started").toArray(); } catch { return keep; }
    let wake = null; const at = new Map();   // session → when its resumed turn starts (its queued cards start right behind it)
    for (const r of rows) {
      const c = this.sql.exec("SELECT status FROM cards WHERE id=?", r.card).toArray()[0];
      if (!c || !["working", "queued", "resuming"].includes(c.status)) { this.sql.exec("DELETE FROM turn_runs WHERE card=?", r.card); this.sql.exec("DELETE FROM turn_effects WHERE card=?", r.card); continue; }
      if (r.status === "queued") { const t = at.get(r.session) ?? now + Number(this.env.RESUME_DELAY_MS ?? 1000); keep.add(r.card); this.sql.exec("UPDATE turn_runs SET resume_at=? WHERE card=?", t, r.card); wake = Math.min(wake ?? Infinity, t); (this._resuming ||= new Set()).add(r.session); continue; }
      // A crash loop (the same code resumed again within a minute) or too many resumes: give up, the card ends interrupted.
      const loop = r.last_resume && r.code_v === codeV(this.env) && now - r.last_resume < CRASH_LOOP_MS;
      if (r.resumes >= RESUME_MAX || loop) { console.log("resume: giving up", r.card, loop ? "crash loop" : `${r.resumes} resumes`); this.sql.exec("DELETE FROM turn_runs WHERE card=?", r.card); this.sql.exec("DELETE FROM turn_effects WHERE card=?", r.card); continue; }
      // An unfinished write/exec: the old instance may still be finishing that call; give it a moment to land before we look.
      const open = this.sql.exec("SELECT cls FROM turn_effects WHERE card=? AND status='started'", r.card).toArray();
      const delay = open.some((x) => x.cls === "write" || x.cls === "once") ? Number(this.env.RESUME_WRITE_DELAY_MS ?? 20e3) : Number(this.env.RESUME_DELAY_MS ?? 1000);
      this.sql.exec("UPDATE turn_runs SET status='resuming', resume_at=? WHERE card=?", now + delay, r.card);
      this.sql.exec("UPDATE cards SET status='resuming' WHERE id=?", r.card);
      keep.add(r.card); wake = Math.min(wake ?? Infinity, now + delay);
      if (r.kind === "chat") {
        (this._resuming ||= new Set()).add(r.session); if (!at.has(r.session)) at.set(r.session, now + delay);
        // New messages that arrive while it's resuming join this card (steers), never a second turn beside it.
        if (r.session && !this.inputs.has(r.session)) this.inputs.set(r.session, this.pendOf(r.card, r.session));
      }
    }
    if (wake != null) this.ctx.waitUntil?.(this.ctx.storage.getAlarm().then((a) => (a == null || a > wake ? this.ctx.storage.setAlarm(wake) : null)).catch((e) => console.log("resume alarm", e.message)));
    return keep;
  },
  // The card's inputs the helper hasn't read yet (consumed IS NULL, after the first), as a live pend for steerOrOpen/takeSteers.
  pendOf(card, session) {
    const ev = this.sql.exec("SELECT * FROM card_events WHERE card=? AND type IN ('msg','handoff') ORDER BY seq", card).toArray();
    const items = ev.filter((e) => e.seq !== 1 && e.consumed == null).map((e) => ({ seq: e.seq, id: e.msg_id, type: e.type, text: e.text || "", files: J(e.files, []), from: e.type === "handoff" ? J(e.input, null) : null, via: e.via || "app", ...originInput(J(e.input, {})), ...(e.type === "msg" && e.via === "text" ? J(e.input, {}) : {}), reply: replyIn(e.reply) }));
    return { id: card, session, items, next: 0, committed: false, tc: null, count: ev.filter((e) => e.type === "msg").length || 1, first: { type: ev[0]?.type || "msg", text: ev[0]?.text || "" } };
  },
  // ---- the alarm (and attach): start every resume that's due. Never awaits the turns (they run like handoff()) ----
  resumeDue({ force = false } = {}) {
    const now = Date.now(); let rows = [];
    try {
      // a running row whose turn isn't in this object and hasn't beaten for a while: it died here without a restart (rare)
      for (const r of this.sql.exec("SELECT card FROM turn_runs WHERE status='running' AND beat<?", now - BEAT_MS).toArray())
        if (![...this.active.values()].some((t) => t.turn === r.card)) this.sql.exec("UPDATE turn_runs SET status='resuming', resume_at=? WHERE card=?", now, r.card);
      rows = this.sql.exec("SELECT * FROM turn_runs WHERE status IN ('resuming','queued') AND (? OR resume_at<=?) ORDER BY started", force ? 1 : 0, now).toArray();
    } catch (e) { console.log("resume due", e.message); return []; }
    const runs = [];
    for (const r of rows) {
      if ([...this.active.values(), ...(this.queuedTc || [])].some((t) => t.turn === r.card)) continue;
      if (r.status === "resuming" && r.resumes >= RESUME_MAX) { this.abandonTurn(r); continue; }   // parked again and again in this object: give up
      const p = this.resumeTurn(r); if (p) runs.push(p);
    }
    return runs;
  },
  // One journaled turn, carried on (status resuming) or started (queued). Sync up to runTurn's own registration, so turns of one task
  // queue behind each other in their original order.
  resumeTurn(r) {
    const opts = { ...J(r.opts, {}), card: r.card, session: r.session };
    const fresh = r.status === "queued";
    const now = Date.now();
    if (!fresh) {
      this.sql.exec("UPDATE turn_runs SET status='running', resumes=resumes+1, last_resume=?, code_v=?, beat=?, resume_at=NULL, updated=? WHERE card=?", now, codeV(this.env), now, now, r.card);
      this.sql.exec("UPDATE cards SET status='working' WHERE id=? AND status IN ('resuming','queued','working')", r.card);
      opts.resume = { ...r, resumes: r.resumes + 1 };
    } else this.sql.exec("UPDATE turn_runs SET status='queued', resume_at=NULL, beat=?, updated=? WHERE card=?", now, now, r.card);
    if (fresh && this.sql.exec("SELECT status FROM cards WHERE id=?", r.card).toArray()[0]?.status === "resuming") this.sql.exec("UPDATE cards SET status='queued' WHERE id=?", r.card);
    if (!fresh && r.kind === "chat" && r.session && !this.inputs.has(r.session)) this.inputs.set(r.session, this.pendOf(r.card, r.session));
    console.log(fresh ? "resume: starting a queued turn" : "resume: carrying on", r.kind, r.card, `resume ${r.resumes + (fresh ? 0 : 1)}`);
    const tenant = this.get("tenant"), channel = this.get("channel"), cid = this.get("channel_id");
    // A helper carries on through its own runner (deadline timers, approvals forwarding, its result handed back to the task).
    if (r.kind === "helper" && opts.helper?.id != null) {
      const h = this.sql.exec("SELECT * FROM helpers WHERE id=?", opts.helper.id).toArray()[0];
      if (h && h.status === "running") { const run = this.helperRun(h, { resume: opts.resume, card: r.card, phase: opts.coordinator_phase || null }).catch((e) => console.log("resumed helper", e.message)); this.ctx.waitUntil?.(run); (this._resumeRuns ||= []).push(run); return run; }
      // A Stop may have landed just before the deployment. Never restart a
      // terminal helper's saved turn or leave its journal waking the alarm.
      this.sql.exec("DELETE FROM turn_runs WHERE card=?", r.card); this.sql.exec("DELETE FROM turn_effects WHERE card=?", r.card);
      commitCard(this.sql, null, r.card, { status: h?.status === "done" ? "complete" : h?.status === "failed" ? "failed" : "stopped" });
      return null;
    }
    const run = (async () => {
      let res;
      try { res = await this.runTurn(tenant, channel, cid, r.text, null, opts); }
      catch (e) { if (e?.objectReset) return null; res = opts.viaText ? await this.textFailureResult(tenant, e, r.card) : {reply:"",error:e.message}; console.log("resumed turn", e.message); }   // reset again: the next object carries on
      // A texted turn texts its one reply (the text path's own delivery died with the old object).
      if (opts.viaText && res) { try { await this.deliverTextReply(tenant, channel, res); } catch (e) { console.log("resumed text", e.message); } }
      // A scheduled run's bookkeeping (run count, next run, notes, the gate's saved output, the app event row) finishes here.
      try { if (opts.wfRun) await this.workflowFinish(opts.wfRun, res); else if (opts.evRun) await this.eventFinish(opts.evRun, res); } catch (e) { console.log("resumed run finish", e.message); }
      if (opts.wfRun || opts.evRun) await this.arm().catch(() => {});
      return res;
    })();
    this.ctx.waitUntil?.(run); (this._resumeRuns ||= []).push(run);
    return run;
  },
  // Give up on a journaled turn (its resumes are used up): the card ends interrupted, like recoverCards does at a start.
  abandonTurn(r) {
    if (this.nativeCancel) this.ctx.waitUntil?.(this.nativeCancel(r.session, 'Task abandoned').catch(() => {}));
    console.log("resume: giving up", r.card, `${r.resumes} resumes`);
    this.sql.exec("DELETE FROM turn_runs WHERE card=?", r.card); this.sql.exec("DELETE FROM turn_effects WHERE card=?", r.card);
    recoverCards(this.sql, { skip: new Set(this.sql.exec("SELECT id FROM cards WHERE status IN ('queued','working','resuming') AND id<>?", r.card).toArray().map((x) => x.id)) });
    if (r.kind === "chat") { this._resuming?.delete(r.session); const p = this.inputs.get(r.session); if (p?.id === r.card) this.inputs.delete(r.session); }
  },
  resumingIn(session) { return !!session && !!this._resuming?.has(session); },
  // Stop on a task whose turn is waiting to resume (nothing live to stop): it ends stopped, and it won't resume.
  stopJournaled(session) {
    let rows = []; try { rows = this.sql.exec("SELECT * FROM turn_runs WHERE status IN ('resuming','queued') AND (? IS NULL OR session=?)", session, session).toArray(); } catch { return []; }
    const out = [];
    for (const r of rows) {
      if ([...this.active.values(), ...(this.queuedTc || [])].some((t) => t.turn === r.card)) continue;
      this.sql.exec("DELETE FROM turn_runs WHERE card=?", r.card); this.sql.exec("DELETE FROM turn_effects WHERE card=?", r.card);
      commitCard(this.sql, null, r.card, { status: "stopped" });
      try { this.sql.exec("INSERT OR IGNORE INTO turns (id,at,user_text,reply,steps,tool_calls,total_ms,charge_nano,error,kind,session) VALUES (?,?,?,?,?,?,?,?,?,?,?)", r.card, r.started, r.text, STOPPED_REPLY, r.step || 0, 0, Date.now() - r.started, J(r.stats, {}).charge || 0, null, "chat", r.session); } catch {}
      const p = this.inputs.get(r.session); if (p?.id === r.card) this.inputs.delete(r.session);
      this._resuming?.delete(r.session); out.push({ turn: r.card, session: r.session });
    }
    return out;
  },

  // ---- rebuilding the turn (both engines) ----
  // The turn's saved messages after its first input, from its last checkpoint when it had one (the loop had restarted from there).
  // → { prior: OpenAI-shaped messages, checkpoints }
  resumePrior(card, hist, userMsg) {
    const rows = this.sql.exec("SELECT role, content, tool_calls, tool_call_id FROM msgs WHERE turn=? ORDER BY seq", card).toArray()
      .map((m) => ({ role: m.role, content: m.content ?? "", ...(m.tool_calls ? { tool_calls: J(m.tool_calls, []) } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) }));
    let i0 = rows[0]?.role === "user" ? 1 : 0, checkpoints = 0, lastCp = -1;
    for (let i = i0; i < rows.length; i++) if (rows[i].role === "user" && /^\(Context checkpoint\./.test(rows[i].content) && rows[i + 1]?.role === "assistant") { lastCp = i; checkpoints++; }
    let prior;
    if (lastCp >= 0) {
      const steers = rows.slice(i0, lastCp).filter((m) => m.role === "user" && /while you were working|handed back|came back/i.test(m.content));
      const lastTool = [...rows.slice(i0, lastCp)].reverse().find((m) => m.role === "tool");
      const note = { role: "user", content: `[Checkpoint ${checkpoints}: your own working notes so far on this request]\n${rows[lastCp + 1].content}\n\n[Most recent tool result]\n${String(lastTool?.content || "").slice(0, 4000)}\n\nContinue the task from here. Earlier raw steps are searchable with recall_history.` };
      prior = [...steers, note, ...rows.slice(lastCp + 2)];
    } else prior = rows.slice(i0);
    return { prior, checkpoints };
  },
  // The tool calls the kill left open (the last assistant message's calls with no result yet), each closed by its type. Results are
  // saved like any tool result, and the card's step rows are finished. → [{ role: "tool", tool_call_id, content }]
  async resumeClose(tc, prior) {
    const turn = tc.turn, out = [];
    const ai = prior.map((m, i) => [m, i]).filter(([m]) => m.role === "assistant").at(-1);
    if (!ai || !ai[0].tool_calls?.length) return out;
    const answered = new Set(prior.slice(ai[1] + 1).filter((m) => m.role === "tool").map((m) => m.tool_call_id));
    for (const call of ai[0].tool_calls) {
      if (answered.has(call.id)) continue;
      const name = call.function?.name; let a = {}; try { a = JSON.parse(call.function?.arguments || "{}"); } catch {}
      const eff = this.sql.exec("SELECT * FROM turn_effects WHERE card=? AND call_id=?", turn, String(call.id)).toArray()[0];
      const step = this.sql.exec("SELECT seq FROM card_events WHERE card=? AND call_id=? AND type='step' ORDER BY seq DESC LIMIT 1", turn, String(call.id)).toArray()[0];
      let text, rerun = false;
      if (eff?.status === "done") text = eff.result ?? "";
      else if (!eff) rerun = true;   // never started: nothing happened yet, so it runs now like any call (every gate applies)
      else if (eff.cls === "read" || eff.cls === "local") rerun = true;
      else if (eff.cls === "exec") {
        // The command kept running in the computer through the deploy: wait for it (what's left of its time limit) and take its real result.
        let r = null;
        if (COMPUTER_EXEC.has(name)) { try { r = await this.computer().reattach(runIdOf(turn, call.id), { timeoutMs: Math.max(5e3, commandLimitMs(name, a, this._limits?.timingSaved) - (Date.now() - eff.at)) }); } catch (e) { console.log("reattach", e.message); } }
        text = r && !r.lost ? `exit ${r.code}\n${String(r.out ?? "")}`.slice(-20000) + (r.timed_out ? `\n${RUN_TIMED_OUT}` : "") : MAYBE_RAN;
        if (r && !r.lost) tc.reattached = (tc.reattached || 0) + 1;
      }
      else if (eff.cls === "once") {
        const h = name === "start_helper" ? this.sql.exec("SELECT id, name FROM helpers WHERE parent_card=? AND spawn_call_id=? LIMIT 1", turn, String(call.id)).toArray()[0] ||
          this.sql.exec("SELECT id, name FROM helpers WHERE parent_card=? AND spawn_call_id IS NULL AND started>=? ORDER BY id LIMIT 1", turn, eff.at).toArray()[0] : null;
        const w = name !== "start_helper" ? this.sql.exec("SELECT id, name FROM workflows WHERE COALESCE(session,'')=? AND created>=? ORDER BY id LIMIT 1", tc.session || "", eff.at).toArray()[0] : null;
        if (h) text = `Helper #${h.id} "${h.name}" was already started (1Helm was updated just after). It's still yours: don't start it again.`;
        else if (w) text = `Already scheduled as #${w.id} "${w.name}" (1Helm was updated just after). Don't schedule it again.`;
        else rerun = true;   // nothing was made: safe to run
      } else {
        // a confirm card this call showed, still waiting for the tap: nothing was done
        const pend = CONFIRM_TOOLS.has(name) ? this.sql.exec("SELECT what FROM approvals WHERE perm=? AND turn=? AND status='pending' AND at>=? ORDER BY id DESC LIMIT 1", CONFIRM, turn, eff.at).toArray()[0] : null;
        text = pend ? WAITING_CONFIRM(pend.what || "") : MAYBE_DONE;
      }
      if (rerun) {
        const sv = step ? { seq: step.seq } : stepBegin(this.sql, tc, { tool: name, args: a, call_id: call.id }), s0 = Date.now();
        this.effectStart(tc, call.id, name, a);
        try { text = await this.runTool(call, tc); } catch (e) { text = `error: ${e.message}`; }
        if (sv?.seq != null) stepEnd(this.sql, tc, sv.seq, { out: text, ms: Date.now() - s0 });
        tc.resumeRan = (tc.resumeRan || 0) + 1;
      } else if (step) stepEnd(this.sql, tc, step.seq, { out: text, ms: 0, ...(text === MAYBE_DONE || text === MAYBE_RAN ? { status: "error" } : {}) });
      this.effectDone(tc, call.id, text);
      const m = { role: "tool", tool_call_id: call.id, content: String(text) };
      this.save(turn, m); out.push(m);
    }
    return out;
  },
  // Everything a resumed turn needs, in one place (runTurnInner calls it). → { prior (closed and noted), stats, said, step, phase, checkpoints }
  async resumeState(tc, r, hist, userMsg) {
    const ex = J(r.extra, {});
    const { prior, checkpoints } = tc.appendRuntime ? { prior: tc.transcript.messages(), checkpoints: tc.transcript.state().compactions } : this.resumePrior(tc.turn, hist, userMsg);
    tc.contextOverflowRetried = !!ex.contextOverflowRetried;
    const closed = await this.resumeClose(tc, prior);
    const note = { role: "user", content: RESUME_NOTE };
    this.save(tc.turn, note);
    tc.charged = ex.charged || 0; if (ex.limitWhy) tc.limitWhy = ex.limitWhy; if (ex.pause) tc.pause = ex.pause;
    if (ex.stall) tc.stallState = ex.stall;   // the no-progress count carries on after a restart (stall-guard.js)
    tc.progressOmitted = Number(ex.progressOmitted) || 0;
    tc.handoff = tc.handoff || !!ex.handoff; tc.handoffFrom = tc.handoffFrom || ex.handoffFrom || null;
    if (ex.userText0 != null) tc.userText = ex.userText0; if (ex.hint) tc.hint = ex.hint;
    if (r.route && !tc.appendRuntime) { try { tc.route = JSON.parse(r.route); } catch {} }
    // a text that joined this (app-started) turn gets its reply by text too
    if (this.sql.exec("SELECT 1 x FROM card_events WHERE card=? AND type='msg' AND via='text' AND seq>1 LIMIT 1", tc.turn).toArray().length) tc.textSteered = true;
    tc.emit?.({ t: "resumed", card: cardView(this.sql, tc.turn) });
    const lastCalls = prior.filter((m) => m.role === "assistant").at(-1)?.tool_calls?.length || 0;
    const said = J(r.said, []), saidMeta = Array.isArray(ex.saidMeta) && ex.saidMeta.length === said.length ? ex.saidMeta.map((m, i) => m && m.text === said[i] && Array.isArray(m.calls) && m.calls.every(x => typeof x === 'string') && Array.isArray(m.later) && m.later.every(x => typeof x === 'string') ? m : null) : said.map(() => null);
    return { prior: [...prior, ...closed, note], stats: J(r.stats, null), said, saidMeta, step: r.step || 0, phase: r.phase || "model", checkpoints: ex.checkpoints ?? checkpoints, closedN: closed.length, lastCalls };
  },
}); }
