// Stop (Captain 10-06, the brain-dump demo: tasks a plan started kept running and he couldn't stop them).
// The person's explicit Stop on a working task, or Stop all for a channel / the whole workspace. Owner-only routes in index.js:
//   POST /api/res/<ch>/sessions/<id>/stop · POST /api/res/<ch>/stop-all · POST /api/stop-all (every channel).
// How a stop propagates (tc = the running turn's context, resident.js runTurn):
//   - tc.abort = "hard": both engines end the turn at the next step boundary and make no further model call;
//   - tc.ac (callModel's AbortController) is aborted: an in-flight model call ends now (the OpenRouter fetch / stream is cancelled);
//   - tc.stopWake(): a tool the turn is waiting on is let go at once (untilStopped), and a running channel-computer command
//     is killed (ChannelComputer.cancel(tag), the process tree started for this turn);
//   - unread steers on its card are dropped (never answered), turns queued behind it in the task stop before they start,
//     and the task's background helpers stop (helperStop, no handoff).
// The card closes as "stopped", the reply is "Stopped." (no model call), and everything already done stays.
// Plan-started tasks also run under a safety budget (PLAN_TASK_* below): a soft stop with a final short report.
import { cardView } from "./tracker.js";
import { PAUSE_FACTS } from "./ee/index.js";   // facts only, no new plan (shared with spendguard.js; a leaf module, no import cycle)
import { DEFAULT_RUNTIME_LIMITS } from "./limits.js";

export const STOPPED_REPLY = "Stopped.";
export const STOPPED_TOOL_TEXT = "(Stopped by the person before this finished.)";
// A task a plan started: its first run gets this budget (like a helper's), then tools go off and it writes a short report of what
// it found and what's left. Its card closes as "paused" ("Paused: hit its budget. Continue?"); Continue grants one more budget.
// (Diagnosis 10-06: runaway plan tasks ran ~36 steps / ~88 tool calls / ~$0.65 in 6 minutes; a normal email turn is ~4–7 steps / ~$0.05.)
// The budget is the saved plan task limits (limits.js, edited on the Models page: 20 steps, $0.25 and 10 minutes to start with). Callers read them with
// limitsFor(env) (limits-read.js) and pass `.planTask`; without one the starting values are used.
const PT = DEFAULT_RUNTIME_LIMITS.planTask;
export const PLAN_TASK_MAX_STEPS = PT.steps;
export const PLAN_TASK_MAX_CHARGE = PT.charge;          // nano$
export const PLAN_TASK_MAX_MS = PT.ms;
export const planBudget = (L = PT) => ({ budget: true, soft_steps: L.steps, max_steps: L.steps + 2, max_charge: L.charge, max_ms: L.ms });
export const planBudgetText = (L = PT) => `each started task runs on a safety budget (up to ${L.steps} steps, $${(L.charge / 1e9).toFixed(2)} or ${L.ms / 60e3} minutes), then pauses with a short report of what it found and what's left, and they can tap Continue`;
// A chat turn that used all its steps: one tools-off call for a short report, never a bare "I stopped".
export const STEP_LIMIT_CHAT_ASK = `(You've used this turn's step limit. No more tools. Write a short report for the person now, facts only: what you found or did so far (exact values, file paths), and what's left. ${PAUSE_FACTS} Plain text only: no cards, no buttons, and don't ask whether to keep going (the app shows its own Keep going / Stop here buttons under your message).)`;
export const stopError = () => Object.assign(new Error("stopped"), { stopped: true });

// Wait for p, unless the turn is stopped first (then `fallback` at once; p keeps running and its result is ignored).
export function untilStopped(tc, p, fallback) {
  if (!tc?.stopped) return p;
  return Promise.race([p, tc.stopped.then(() => fallback)]);
}

export function stopMix(Resident) { return Object.assign(Resident.prototype, {
  // One turn: the hard stop, its in-flight model call, its running command, its unread steers.
  hardStop(tc, by = "person") {
    if (!tc || tc.finished || tc.committed) return false;   // committed: its reply already closed the card
    tc.abort = "hard"; tc.stoppedBy ||= by;
    if (this.nativeCancel) this.ctx.waitUntil?.(this.nativeCancel(tc.session, 'Task stopped').catch(() => {}));
    const p = tc.pend; if (p && p.next < p.items.length) p.next = p.items.length;   // unread steers: dropped, never answered
    try { tc.ac?.abort(stopError()); } catch {}
    if (tc.inTool > 0) { try { Promise.resolve(this.computer().cancel?.(tc.key)).catch(() => {}); } catch {} }
    try { tc.stopWake?.(); } catch {}
    tc.emit?.({ t: "stopping", by });
    return true;
  },
  // Running and queued turns of one task (session) or of the whole channel (session = null).
  liveTurnsOf(session = null) {
    return [...this.active.values(), ...(this.queuedTc || [])].filter((t) => !t.finished && (session == null || t.session === session));
  },
  async stopRuns(session = null, by = "person") {
    // Helpers first (marked stopped by the person, so their run never hands a "limit" result back), then every turn.
    let helpers = 0, rows = [];
    try { rows = session == null ? this.sql.exec("SELECT id, session FROM helpers WHERE status IN ('running','waiting_input')").toArray()
      : this.sql.exec("SELECT id, session FROM helpers WHERE session=? AND status IN ('running','waiting_input')", String(session)).toArray(); }
    catch (e) { if (!/no such table/.test(e.message)) console.log("stop helpers", e.message); }
    const done = rows.map((h) => this.helperStop(h.session, h.id, by).then((r) => { if (r?.ok) helpers++; }, (e) => console.log("stop helper", h.id, e.message)));
    const turns = this.liveTurnsOf(session);
    for (const tc of turns) this.hardStop(tc, by);
    await this.nativeCancel?.(session, 'Task stopped');
    const parked = this.stopJournaled ? this.stopJournaled(session) : [];   // resume.js: a turn waiting to carry on after an update ends stopped too
    await Promise.all(done);
    try {
      if(session==null) {this.sql.exec("UPDATE user_questions SET status='cancelled' WHERE status='pending'");this.sql.exec("UPDATE sessions SET waiting=NULL WHERE waiting='answer'");}
      else {this.sql.exec("UPDATE user_questions SET status='cancelled' WHERE session=? AND status='pending'",String(session));this.sql.exec("UPDATE sessions SET waiting=NULL WHERE id=? AND waiting='answer'",String(session));}
    }catch(e){if(!/no such table/.test(e.message))throw e;}
    // The response carries the closed cards: give the turns a moment to reach their step boundary (bounded).
    const t0 = Date.now();
    while (turns.some((t) => !t.finished) && Date.now() - t0 < 4000) await new Promise((z) => setTimeout(z, 25));
    const cards = [...new Set([...turns.map((t) => t.turn), ...parked.map((p) => p.turn)].filter(Boolean))].map((id) => cardView(this.sql, id)).filter(Boolean);
    return { turns: [...turns, ...parked], helpers, cards };
  },
  // POST …/sessions/<id>/stop
  async stopSession(session, by = "person") {
    const s = this.session(session); if (!s) return { error: "No such task in this channel." };
    const r = await this.stopRuns(String(session), by);
    const card = r.cards.find((c) => c.kind === "chat" || c.kind === "handoff") || r.cards[0] || null;
    return { ok: true, stopped: r.turns.length, helpers: r.helpers, card, cards: r.cards, session: this.sessionView(this.session(session)) };
  },
  // POST …/stop-all (channel) — the workspace route calls it on every channel.
  async stopAll(by = "person") {
    const r = await this.stopRuns(null, by);
    const ids = [...new Set(r.turns.map((t) => t.session).filter(Boolean))];
    return { ok: true, stopped: r.turns.length, helpers: r.helpers, cards: r.cards, sessions: ids.map((id) => this.session(id)).filter(Boolean).map((s) => this.sessionView(s)) };
  },
  // Tasks working right now in this channel (for the workspace "N tasks working" pill).
  workingNow() {
    const ids = new Set(this.liveTurnsOf(null).filter((t) => t.kind !== "helper").map((t) => t.session).filter(Boolean));
    return { sessions: [...ids] };
  },
}); }
