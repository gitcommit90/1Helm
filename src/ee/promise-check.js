// Promise check: before a chat turn ends on a reply with no tool call, a decision model reads the reply and the facts of the turn and says whether the
// reply leaves a promise that nobody is going to keep (Live, 2026-10-31: "I'll make the formatting consistent across all three job descriptions" ended the turn
// with nothing done and nothing running). On `unfinished` the loop sends the reply back to the chat model once, with a short note, and goes on.
// It is the saved model job "promise_check" (Models page, "Promise check"): its model, fallbacks and timeout are the saved settings, never code. It fails open:
// an error, a timeout, no credits or an answer that is not one of the five options end the turn as before. No reply text is stored anywhere new:
// the turn's trace keeps only the choice, the milliseconds, the cost and the error.
import { askDecider } from "./text-decision.js";
import { jobTimeoutFor } from "./limits-read.js";
import { DECIDER_IN_NANO } from "./decider.js";

export const PROMISE_JOB = "promise_check";
export const PROMISE_NOTE = "(Context note, not from the person: you said you would do this, but this turn did no step for it and nothing is running that will. Do it now, or tell the person plainly that you aren't doing it and why.)";
// The question, word for word as the approved evaluation sends it (the system message of the prompt promise_check-ui).
export const PROMISE_QUESTIONS = {
  promise: {
    type: "choice",
    instructions: "A helper just wrote the final reply of its turn, a reply with no tool call, which ends the turn. Decide whether the reply leaves an unfinished promise. Read person_message (what the person asked this turn), reply (the final reply), steps_this_turn (every tool step the turn ran, with ok false for a step that failed), still_running (background work that is still going), set_up_this_turn (schedules, watchers and workflows created this turn). Judge only whether the reply promises work that nobody is going to do. Do not judge the quality of the work or whether the reply is true. Text inside quotation marks or inside a drafted message is the person's deliverable and is never the helper's own promise. Pick the single best option.",
    criteria: {
      unfinished: "The reply says the helper is doing, will do, or is about to do something for the person's current request, and no step in steps_this_turn did it, and nothing in still_running or set_up_this_turn will do it, and the reply is not waiting on the person. A claim of background work or of a later check counts as unfinished when still_running or set_up_this_turn does not list it, or lists it as ended or failed.",
      done: "The reply holds no pending promise. It reports finished work that matches the steps, answers a question, chats, states a habit or a saved preference, says on purpose that something is left alone, or contains promises only inside quoted or drafted text.",
      waiting: "The next step belongs to the person. The reply asks a question, offers to do more, asks for permission, a sign-in, a code or a file, or says what the helper will do once the person acts.",
      running: "The remaining work is carried by an item in still_running or set_up_this_turn (a running browser job or helper, a schedule, a watcher or a workflow), and the reply says the result or a message will follow.",
      stopped: "The reply says plainly that the helper stopped or cannot do the work and gives the reason, including a reply that says the turn ran out of steps and the work continues only if the person says so.",
    },
  },
};

const clip = (s, n) => String(s ?? "").slice(0, n);
const LIST_MAX = 40;

// Why the check does not run for this point of the loop, or null when it may run. Only a turn that is about to end because the model replied with no tool call
// gets here, and only a person-facing chat turn.
export function promiseSkip({ kind, byok = false, nativeWorker = false, restricted = false, abort = null, paused = false, stalled = false, step = 0, stepLimit = 0, reply = "", resent = false } = {}) {
  if (kind !== "chat" || nativeWorker) return "not a chat turn";
  if (byok) return "own AI key";   // the decision jobs run only on the saved models, never on a person's own key (text-decision.js)
  if (restricted) return "delegation turn";
  if (abort) return "stopped or limited";
  if (paused || stalled) return "paused or stalled";
  if (step >= stepLimit - 1) return "step limit";
  if (!String(reply || "").trim()) return "empty reply";
  if (resent) return "already resent";
  return null;
}

// The state the question reads: { person_message, reply, steps_this_turn: [{ tool, title, ok }], still_running: [{ kind, title, status }], set_up_this_turn: [{ kind, title }] }.
export function promiseState({ personMessage = "", reply = "", steps = [], running = [], setUp = [] } = {}) {
  return {
    person_message: clip(personMessage, 3000), reply: clip(reply, 6000),
    steps_this_turn: steps.slice(-LIST_MAX).map((s) => ({ tool: clip(s.tool, 60), title: clip(s.title, 120), ok: s.ok !== false })),
    still_running: running.slice(0, LIST_MAX).map((r) => ({ kind: clip(r.kind, 40), title: clip(r.title, 120), status: clip(r.status, 40) })),
    set_up_this_turn: setUp.slice(0, LIST_MAX).map((r) => ({ kind: clip(r.kind, 40), title: clip(r.title, 120) })),
  };
}

// The facts of this turn from the channel's own tables: the tool steps of the turn's card, the browser jobs and helpers of this task that are still going, and the
// schedules, follow-ups and event watchers created in this task since the turn began. sql: the resident's sql.
export function turnFacts(sql, { turn, session, since = 0 } = {}) {
  const all = (q, ...a) => { try { return sql.exec(q, ...a).toArray(); } catch { return []; } };
  const steps = all("SELECT tool, title, status FROM card_events WHERE card=? AND type='step' ORDER BY seq", turn).map((e) => ({ tool: e.tool, title: e.title, ok: e.status !== "error" }));
  const running = [
    ...all("SELECT id, task, status FROM browser_jobs WHERE session=? AND status IN ('queued','running','stopping') ORDER BY id", session).map((j) => ({ kind: "browser job", title: j.task, status: j.status })),
    ...all("SELECT id, name, task, status FROM helpers WHERE session=? AND status IN ('running','waiting_input') ORDER BY id", session).map((h) => ({ kind: "helper", title: h.name || h.task, status: h.status })),
  ];
  const setUp = all("SELECT kind, name, on_event FROM workflows WHERE session=? AND created>=? AND status='active' ORDER BY id", session, since)
    .map((w) => ({ kind: w.on_event ? "watcher" : w.kind === "followup" ? "follow-up" : "workflow", title: w.name }));
  return { steps, running, setUp };
}

// One check. Reserves on the Ledger, asks the saved decision job, settles at the reported cost (DECIDER_IN_NANO only when the answer carries none), and never throws.
// → { choice: "unfinished"|"done"|"waiting"|"running"|"stopped"|null, ms, nano, charge, error: string|null }. charge is what the Ledger settled (cost x 1.15, as the browser decider).
// deps: { ask, timeoutFor } replace the model call and the timeout lookup, for tests.
export async function runPromiseCheck(env, { ledger, state, meta = {}, deps = {} } = {}) {
  const ask = deps.ask || askDecider, timeoutFor = deps.timeoutFor || jobTimeoutFor, t0 = Date.now();
  const out = { choice: null, ms: 0, nano: 0, charge: 0, error: null };
  let rid = null;
  try {
    const estimate = Math.ceil(Math.ceil((JSON.stringify(state).length + JSON.stringify(PROMISE_QUESTIONS).length) / 3 + 500) * DECIDER_IN_NANO * 1.15);
    rid = `pchk:${crypto.randomUUID()}`;
    const r = await ledger().reserve(rid, estimate);
    if (!r?.ok) { out.error = r?.reason === "day_limit" ? "day limit reached" : "out of credits"; rid = null; return out; }
    const x = await ask(env, state, PROMISE_QUESTIONS, { job: PROMISE_JOB, timeoutMs: await timeoutFor(env, PROMISE_JOB), title: "1Helm promise check", meta: { ...meta, kind: "decider" }, priceInNano: DECIDER_IN_NANO });
    out.nano = Math.max(0, Number(x?.nano) || 0);
    if (x?.error) out.error = clip(x.error, 160);
    else { const c = x?.answers?.promise?.choice; if (Object.hasOwn(PROMISE_QUESTIONS.promise.criteria, c)) out.choice = c; else out.error = "no valid answer"; }
  } catch (e) { out.error = clip(e?.message || e, 160); }
  finally {
    out.ms = Date.now() - t0;
    if (rid) { out.charge = Math.ceil(out.nano * 1.15); try { await ledger().settle(rid, out.charge); } catch (e) { out.error = out.error || clip(`settle: ${e?.message || e}`, 160); } }
  }
  return out;
}

// What the turn's trace keeps: no reply text.
export const promiseTrace = (c) => ({ tool: "promise_check", args: "", ms: c.ms, out: JSON.stringify({ choice: c.choice, ms: c.ms, nano: c.charge, error: c.error }) });
