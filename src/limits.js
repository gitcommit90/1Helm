// Step, time and cost limits that used to be literals in the code. They are saved in the model settings document as a top level `limits` object
// (so History and Restore cover them), and edited on the Models page. Nothing here reads the environment or the network:
// the definitions, the starting values (today's values), the validation and the pure reader live in this file, and src/limits-read.js reads the saved settings.
//
// A saved `limits` object holds only the limits that were changed. A limit that is missing reads as its starting value, and a saved set without `limits`
// (everything saved before this release) reads as all starting values.
//
// The per job timeout (`timeout_ms` on a saved job) is defined at the bottom of this file, with the jobs that have one today.
export const LIMIT_GROUPS = [
  { id: "chat", title: "Chat turns", note: "How long and how far one reply may go before it stops." },
  { id: "helpers", title: "Helpers", note: "Helpers are background jobs that a chat message starts for a side job." },
  { id: "plan_tasks", title: "Tasks a plan starts", note: "The safety budget of each task that a plan or a delegated brief starts." },
  { id: "events", title: "App events", note: "Workflows that run when something happens in a connected app." },
  { id: "browser", title: "Browser", note: "" },
  { id: "spending", title: "Spending", note: "Per turn and per day checks. The turn checks apply only while an account has Pause to check spending turned on." },
];

// unit: steps, dollars, minutes, seconds, count, percent, times, characters. Dollars and times may have decimals, the rest are whole numbers.
const D = (key, group, label, description, unit, value, min, max) => Object.freeze({ key, group, label, description, unit, default: value, min, max, whole: !["dollars", "times"].includes(unit) });
export const LIMIT_DEFS = Object.freeze([
  D("chat_steps", "chat", "Steps in a chat turn", "The most model steps one chat turn takes before it stops and writes a report.", "steps", 60, 1, 1000),
  D("other_turn_steps", "chat", "Steps in other turns", "The most model steps in a turn that is not a chat turn, a scheduled workflow or a plan task, such as a follow-up.", "steps", 12, 1, 1000),
  D("workflow_steps", "chat", "Steps in a scheduled workflow", "The most model steps in one run of a scheduled workflow.", "steps", 24, 1, 1000),
  D("model_first_response_seconds", "chat", "Wait for the first reply", "How long the main chat model may take to start answering before the attempt is dropped.", "seconds", 120, 10, 3600),
  D("model_idle_seconds", "chat", "Wait while the reply is silent", "How long a streaming reply may send nothing before the attempt is dropped.", "seconds", 120, 10, 3600),
  D("model_total_seconds", "chat", "Time for one model reply", "The longest one main chat model call may run, from start to the last word.", "seconds", 300, 30, 7200),
  D("turn_pause_minutes", "chat", "Minutes before a turn checks in", "A turn that works this long without its reply pauses to ask the person.", "minutes", 10, 1, 240),
  D("command_minutes", "chat", "Minutes for a command", "How long one command on the computer may run before it is stopped.", "minutes", 4, 1, 60),
  D("command_max_minutes", "chat", "Most minutes a command may ask for", "The longest time a command may request for itself.", "minutes", 15, 1, 240),
  D("turn_stall_calls", "chat", "Repeated calls before a turn is stopped", "A turn that makes this many tool calls in a row with nearly the same input and the same result is stopped and asked to report what it is stuck on.", "calls", 10, 2, 100),
  D("stall_similarity_percent", "chat", "How alike repeated calls must be", "Two tool calls count as nearly the same when this share of the words in their input match and their results are the same.", "percent", 85, 50, 100),

  D("helper_running", "helpers", "Helpers working at once in a task", "The most helpers that may work in one task at the same time.", "count", 6, 1, 50),
  D("helper_per_day", "helpers", "Helpers started per day", "The most helpers started in one channel in a rolling 24 hours.", "count", 200, 1, 10000),
  D("helper_steps", "helpers", "Steps for a helper", "The most model steps one helper takes.", "steps", 20, 1, 1000),
  D("helper_charge", "helpers", "Cost target for a helper", "A helper stops once its cost reaches this amount. The call that crosses it can cost more.", "dollars", 0.5, 0.01, 100),
  D("helper_deadline_minutes", "helpers", "Minutes before a helper wraps up", "After this long a helper stops using tools and writes its report.", "minutes", 15, 1, 240),
  D("helper_grace_minutes", "helpers", "Minutes to write the report", "After the wrap up time a helper has this long before it is stopped.", "minutes", 2, 1, 60),
  D("helper_force_minutes", "helpers", "Minutes before a stuck helper is closed", "A helper still stuck in a tool this long after the report time is closed as stopped.", "minutes", 3, 1, 60),
  D("helper_stall_calls", "helpers", "Repeated calls before a helper is stopped", "A helper that makes this many tool calls in a row with nearly the same input and the same result is stopped and asked to report what it is stuck on.", "calls", 6, 2, 100),
  D("helper_report_chars", "helpers", "Length of a helper report", "The most characters of a helper's report that go back to the main helper.", "characters", 6000, 500, 100000),

  D("plan_task_steps", "plan_tasks", "Steps for a plan task", "A task a plan starts runs this many steps, then pauses with a short report.", "steps", 20, 1, 1000),
  D("plan_task_charge", "plan_tasks", "Cost target for a plan task", "A task a plan starts stops at this cost and reports.", "dollars", 0.25, 0.01, 100),
  D("plan_task_minutes", "plan_tasks", "Minutes for a plan task", "A task a plan starts stops after this long and reports.", "minutes", 10, 1, 240),

  D("event_runs_per_hour", "events", "Runs per hour", "The most runs of one workflow in an hour. More events are dropped with a note in its event log.", "count", 10, 1, 1000),
  D("event_queue_max", "events", "Events waiting", "The most events that may wait for one workflow to finish its current run.", "count", 3, 1, 100),
  D("event_steps", "events", "Steps for an event run", "The most model steps in one run started by an app event.", "steps", 16, 1, 1000),

  D("browser_steps", "browser", "Steps for a browser task", "The most steps the browser agent takes before it hands back.", "steps", 25, 1, 1000),

  D("turn_soft_charge", "spending", "Pause cost per turn", "A turn pauses to ask the person once it costs this much. Bigger plans scale it up to the largest value below.", "dollars", 0.15, 0.01, 100),
  D("turn_hard_charge", "spending", "Highest cost per turn", "No model call starts that could take a turn past this cost without the person's tap. Bigger plans scale it up to the largest value below.", "dollars", 0.5, 0.01, 100),
  D("turn_soft_max", "spending", "Largest pause cost per turn", "The most the pause cost grows to on a bigger plan.", "dollars", 0.6, 0.01, 100),
  D("turn_hard_max", "spending", "Largest highest cost per turn", "The most the highest cost grows to on a bigger plan.", "dollars", 2, 0.01, 100),
  D("scheduled_soft_percent", "spending", "Report point for scheduled runs", "A scheduled run, which has nobody to tap, reports at this share of the highest cost per turn.", "percent", 80, 1, 100),
  D("day_factor", "spending", "Busy day multiple", "A day may use this many times its share of the month before a check-in.", "times", 2, 1, 100),
  D("notice_first_percent", "spending", "First usage notice", "The share of the month's allowance that leaves the first notice.", "percent", 50, 1, 99),
  D("notice_second_percent", "spending", "Second usage notice", "The share of the month's allowance that leaves the second notice.", "percent", 80, 2, 100),
  D("task_slots", "spending", "Tasks at once in a channel", "The most plan tasks working at once in one channel. A plan may set its own number in code (plans-def.js), which wins.", "count", 6, 1, 50),
]);
export const LIMIT_KEYS = LIMIT_DEFS.map((d) => d.key);
const BY_KEY = Object.fromEntries(LIMIT_DEFS.map((d) => [d.key, d]));
export const LIMIT_DEFAULTS = Object.freeze(Object.fromEntries(LIMIT_DEFS.map((d) => [d.key, d.default])));
export const limitDef = (key) => BY_KEY[key] || null;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

// ---- validation: returns the plain message of the first problem, or null ----
const valueProblem = (def, v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${def.label}: enter a number.`;
  if (def.whole && !Number.isSafeInteger(v)) return `${def.label}: enter a whole number of ${def.unit}.`;
  if (v < def.min || v > def.max) return `${def.label}: enter ${def.unit} from ${def.min} to ${def.max}.`;
  return null;
};
export function limitsProblem(limits) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) return "Limits must be an object.";
  for (const [k, v] of Object.entries(limits)) {
    const def = BY_KEY[k];
    if (!def) return `Unknown limit "${String(k).slice(0, 60)}".`;
    const p = valueProblem(def, v); if (p) return p;
  }
  const all = { ...LIMIT_DEFAULTS, ...limits };
  if (all.turn_soft_charge > all.turn_hard_charge) return "Pause cost per turn can't be above the highest cost per turn.";
  if (all.turn_soft_max > all.turn_hard_max) return "Largest pause cost per turn can't be above the largest highest cost per turn.";
  if (all.turn_soft_charge > all.turn_soft_max || all.turn_hard_charge > all.turn_hard_max) return "A per turn cost can't be above its largest value.";
  if (all.notice_first_percent >= all.notice_second_percent) return "The first usage notice must come before the second.";
  if (all.command_minutes > all.command_max_minutes) return "Minutes for a command can't be above the most a command may ask for.";
  return null;
}
// What is stored: only values that differ from the starting value (a limit set back to its starting value is removed), or nothing at all.
export function compactLimits(limits) {
  const out = {};
  for (const k of LIMIT_KEYS) if (limits && own(limits, k) && limits[k] !== LIMIT_DEFAULTS[k]) out[k] = limits[k];
  return out;
}

// ---- the reader: saved values over the starting values. Accepts the settings object (or nothing). Values are in the units above. ----
export const limitValues = (settings) => {
  const saved = settings?.limits && typeof settings.limits === "object" && !Array.isArray(settings.limits) ? settings.limits : {};
  const out = { ...LIMIT_DEFAULTS };
  for (const k of LIMIT_KEYS) if (own(saved, k) && typeof saved[k] === "number" && Number.isFinite(saved[k])) out[k] = saved[k];
  return out;
};
const nano = (dollars) => Math.round(dollars * 1e9), minutes = (m) => Math.round(m * 60e3), seconds = (s) => Math.round(s * 1e3);
// The same limits in the units the code uses (nano dollars, milliseconds, fractions). `values` keeps the saved units.
export function runtimeLimits(settings) {
  const v = limitValues(settings);
  return Object.freeze({
    values: v,
    chatSteps: v.chat_steps, otherTurnSteps: v.other_turn_steps, workflowSteps: v.workflow_steps,
    model: Object.freeze({ headersMs: seconds(v.model_first_response_seconds), idleMs: seconds(v.model_idle_seconds), totalMs: seconds(v.model_total_seconds) }),
    // Only the waits that were saved, so the turn loop applies them over the starting values in model-limits.js (MODEL_LIMITS) and nothing else changes.
    modelSaved: Object.freeze(Object.fromEntries([["model_first_response_seconds", "headersMs"], ["model_idle_seconds", "idleMs"], ["model_total_seconds", "totalMs"]].filter(([k]) => own(settings?.limits, k) && Number.isFinite(settings.limits[k])).map(([k, f]) => [f, seconds(settings.limits[k])]))),
    wallMs: minutes(v.turn_pause_minutes), cmdMs: minutes(v.command_minutes), cmdMaxMs: minutes(v.command_max_minutes),
    // Only the times that were saved; spendguard.js applies them over its starting values (TIMING).
    timingSaved: Object.freeze(Object.fromEntries([["turn_pause_minutes", "wallMs"], ["command_minutes", "cmdMs"], ["command_max_minutes", "cmdMaxMs"]].filter(([k]) => own(settings?.limits, k) && Number.isFinite(settings.limits[k])).map(([k, f]) => [f, minutes(settings.limits[k])]))),
    helper: Object.freeze({ running: v.helper_running, perDay: v.helper_per_day, steps: v.helper_steps, charge: nano(v.helper_charge), deadlineMs: minutes(v.helper_deadline_minutes), graceMs: minutes(v.helper_grace_minutes), forceMs: minutes(v.helper_force_minutes), reportMax: v.helper_report_chars }),
    stall: Object.freeze({ helperCalls: v.helper_stall_calls, turnCalls: v.turn_stall_calls, similarity: v.stall_similarity_percent / 100 }),
    planTask: Object.freeze({ steps: v.plan_task_steps, charge: nano(v.plan_task_charge), ms: minutes(v.plan_task_minutes) }),
    events: Object.freeze({ runsPerHour: v.event_runs_per_hour, queueMax: v.event_queue_max, steps: v.event_steps }),
    browserSteps: v.browser_steps,
    spend: Object.freeze({ turnSoft: nano(v.turn_soft_charge), turnHard: nano(v.turn_hard_charge), softMax: nano(v.turn_soft_max), hardMax: nano(v.turn_hard_max), unattendedSoft: v.scheduled_soft_percent / 100, dayFactor: v.day_factor, noticeLevels: Object.freeze([v.notice_first_percent, v.notice_second_percent]), slotMax: v.task_slots }),
  });
}
export const DEFAULT_RUNTIME_LIMITS = runtimeLimits(null);

// ---- per job timeout (the saved job field `timeout_ms`; null means no timeout) ----
// A timeout is for one model attempt. A fallback model gets a fresh one. Starting values are what the code enforced before: the label job's 30 seconds
// (tracker.js), the ambient jobs' 90 seconds (ambient.js), the request sorter's 4 seconds (route2.js), the browser decisions job 20 seconds (browser-agent.js), the speech jobs' per attempt limits
// (transcribe.js and transcribe-chunks) and web search's 12 seconds (websearch.js). background-policy.js named 90 seconds for the other background jobs but
// nothing enforced it, so they start with no timeout.
export const JOB_TIMEOUT_DEFAULTS = Object.freeze({
  label: 30000, chat_title: 30000, ambient_extract: 90000, ambient_review: 90000, decider: 4000, browser_decider: 20000, stt: 30000, stt_cloudflare: 30000, live_dictation: 6000, web_search: 12000,
  // The memory server's own request timeouts (Hindsight's settings on 2026-10-18): its default of 120 seconds for retain, consolidation and refresh, 60 seconds for reflect and for the reranker.
  mem_extract: 120000, hs_retain: 120000, hs_consolidation: 120000, hs_reflect: 60000, hs_refresh: 120000, hs_rerank: 60000,
});
export const jobTimeoutDefault = (id) => JOB_TIMEOUT_DEFAULTS[id] ?? null;
export const TIMEOUT_MIN_MS = 1000, TIMEOUT_MAX_MS = 3600000;
export const timeoutProblem = (v) => v === null || (Number.isSafeInteger(v) && v >= TIMEOUT_MIN_MS && v <= TIMEOUT_MAX_MS) ? null : `timeout must be a whole number of milliseconds from ${TIMEOUT_MIN_MS} to ${TIMEOUT_MAX_MS}, or empty for no timeout.`;
