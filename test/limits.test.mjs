// node --import ./test/stubs/register.mjs test/limits.test.mjs
// The saved limits (src/limits.js, src/limits-read.js): starting values equal what the code used before, validation, saved settings from before the
// limits still loading, the one reader, saving and restoring through the real save path, the push (starting values stay out of it), the Live report and
// its comparison, the per job timeout, and the places that read the saved values (budgets, helpers, events, dispatch timeouts).
import assert from "node:assert/strict";
import "../src/resident.js";   // first, so the modules that import each other load in the order the Worker loads them
import { DatabaseSync } from "node:sqlite";
import { LIMIT_DEFS, LIMIT_KEYS, LIMIT_DEFAULTS, LIMIT_GROUPS, limitsProblem, compactLimits, limitValues, runtimeLimits, DEFAULT_RUNTIME_LIMITS, JOB_TIMEOUT_DEFAULTS, jobTimeoutDefault, timeoutProblem } from "../src/limits.js";
import { limitsFor, jobTimeoutFor } from "../src/ee/limits-read.js";
import { validateModelSettings, readModelSettings, saveModelSettings, restoreModelSettings } from "../src/ee/model-settings.js";
import { jobTimeoutMs, jobLimits, JOB_IDS } from "../src/ee/model-jobs.js";
import { jobFieldDefaults, JOB_FIELDS } from "../src/ee/model-seed.js";
import { pageHtml, drawerHtml, view as consoleView } from "../app-assets/app-static/models-console-core.js";
import { consoleState } from "../src/ee/models-console.js";
import { planBudget, planBudgetText } from "../src/stop.js";
import { turnBudget, dayLine, slotMaxOf, noticeText, commandLimitMs, TURN_SOFT, TURN_HARD, SOFT_MAX, HARD_MAX, UNATTENDED_SOFT, DAY_FACTOR, NOTICE_LEVELS, SLOT_MAX, TIMING } from "../src/spendguard.js";
import { HELPER_MAX_RUNNING_PER_SESSION, HELPER_MAX_PER_DAY, HELPER_MAX_STEPS, HELPER_MAX_CHARGE, HELPER_DEADLINE_MS, HELPER_GRACE_MS, HELPER_FORCE_MS, HELPER_REPORT_MAX, startRefusal, helperNextWake } from "../src/helpers.js";
import { EVENT_RUNS_PER_HOUR, EVENT_QUEUE_MAX, EVENT_MAX_STEPS } from "../src/ee/app-events.js";
import { MODEL_LIMITS } from "../src/model-limits.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { SEED, withSettings, seedSettings } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const origLog = console.log, origErr = console.error; const quiet = (fn) => async (...a) => { console.log = () => {}; console.error = () => {}; try { return await fn(...a); } finally { console.log = origLog; console.error = origErr; } };

await test("every starting value is what the code used before", () => {
  const was = { chat_steps: 60, other_turn_steps: 12, workflow_steps: 24, model_first_response_seconds: 120, model_idle_seconds: 120, model_total_seconds: 300, turn_pause_minutes: 10, command_minutes: 4, command_max_minutes: 15, turn_stall_calls: 10, stall_similarity_percent: 85,
    helper_running: 6, helper_per_day: 200, helper_steps: 20, helper_charge: 0.5, helper_deadline_minutes: 15, helper_grace_minutes: 2, helper_force_minutes: 3, helper_stall_calls: 6, helper_report_chars: 6000,
    plan_task_steps: 20, plan_task_charge: 0.25, plan_task_minutes: 10, event_runs_per_hour: 10, event_queue_max: 3, event_steps: 16, browser_steps: 25,
    turn_soft_charge: 0.15, turn_hard_charge: 0.5, turn_soft_max: 0.6, turn_hard_max: 2, scheduled_soft_percent: 80, day_factor: 2, notice_first_percent: 50, notice_second_percent: 80, task_slots: 6 };
  assert.deepEqual({ ...LIMIT_DEFAULTS }, was);
  assert.equal(new Set(LIMIT_KEYS).size, LIMIT_KEYS.length);
  const groups = new Set(LIMIT_GROUPS.map((g) => g.id));
  for (const d of LIMIT_DEFS) {
    assert.ok(groups.has(d.group), d.key); assert.ok(d.label && d.description && d.unit, d.key);
    assert.ok(d.default >= d.min && d.default <= d.max, `${d.key} default is in its bounds`);
    assert.ok(!/[—–·]/.test(d.label + d.description), `${d.key} text has no dashes`);
  }
  assert.deepEqual(LIMIT_GROUPS.map((g) => g.title), ["Chat turns", "Helpers", "Tasks a plan starts", "App events", "Browser", "Spending"]);
  // the exported constants of the old places are these starting values
  assert.deepEqual([HELPER_MAX_RUNNING_PER_SESSION, HELPER_MAX_PER_DAY, HELPER_MAX_STEPS, HELPER_MAX_CHARGE, HELPER_DEADLINE_MS, HELPER_GRACE_MS, HELPER_FORCE_MS, HELPER_REPORT_MAX], [6, 200, 20, 5e8, 900000, 120000, 180000, 6000]);
  assert.deepEqual([EVENT_RUNS_PER_HOUR, EVENT_QUEUE_MAX, EVENT_MAX_STEPS], [10, 3, 16]);
  assert.deepEqual([TURN_SOFT, TURN_HARD, SOFT_MAX, HARD_MAX, UNATTENDED_SOFT, DAY_FACTOR, NOTICE_LEVELS, SLOT_MAX], [15e7, 5e8, 6e8, 2e9, 0.8, 2, [50, 80], 6]);
  assert.deepEqual({ ...TIMING }, { wallMs: 600000, cmdMs: 240000, cmdMaxMs: 900000, repeatN: 8 });
  assert.deepEqual({ ...MODEL_LIMITS }, { ...DEFAULT_RUNTIME_LIMITS.model });
  assert.deepEqual(planBudget(), { budget: true, soft_steps: 20, max_steps: 22, max_charge: 2.5e8, max_ms: 600000 });
  assert.match(planBudgetText(), /up to 20 steps, \$0\.25 or 10 minutes/);
  assert.deepEqual(turnBudget(0, "chat"), { soft: 15e7, hard: 5e8 }); assert.deepEqual(turnBudget(0, "workflow"), { soft: 4e8, hard: 5e8 });
  assert.deepEqual(turnBudget(160e9, "chat"), { soft: 6e8, hard: 2e9 });
  assert.equal(slotMaxOf("none"), 6); assert.equal(commandLimitMs("run_command", {}), 240000); assert.equal(commandLimitMs("run_command", { timeout_minutes: 99 }), 900000);
  assert.match(noticeText(50, 1e9, 2e9), /half/); assert.match(noticeText(80, 1e9, 2e9), /80%.*pauses/);
});

await test("the per job timeouts start where the code enforced them, and the other jobs start with none", () => {
  assert.deepEqual({ ...JOB_TIMEOUT_DEFAULTS }, { label: 30000, ambient_extract: 90000, ambient_review: 90000, decider: 4000, browser_decider: 20000, stt: 30000, stt_cloudflare: 30000, live_dictation: 6000, web_search: 12000,
    hs_retain: 120000, hs_consolidation: 120000, hs_reflect: 60000, hs_refresh: 120000, hs_rerank: 60000 });   // the memory server's own request timeouts
  for (const id of JOB_IDS) assert.equal(jobTimeoutMs(SEED, id), jobTimeoutDefault(id) ?? null, id);
  assert.equal(jobTimeoutMs(SEED, "notes"), null, "background-policy.js named 90 seconds for notes but nothing enforced it");
  assert.ok(JOB_FIELDS.includes("timeout_ms")); assert.equal(jobFieldDefaults("label").timeout_ms, 30000); assert.equal(jobLimits(SEED, "decider").timeout_ms, 4000);
});

await test("the browser's decisions are their own job: a copy of the request sorter, 20 second timeout, ", () => {
  const j = SEED.jobs.browser_decider, d = SEED.jobs.decider;
  assert.deepEqual({ model: j.model, effort: j.effort ?? null, fallbacks: j.fallbacks }, { model: d.model, effort: d.effort ?? null, fallbacks: d.fallbacks });
  assert.equal(jobTimeoutMs(SEED, "browser_decider"), 20000); assert.equal(jobTimeoutMs(SEED, "browser"), null, "the browser planner has no timeout today"); assert.equal(jobTimeoutMs(SEED, "decider"), 4000);
  // saved settings from before the job load and read the sorter's model
  const old = clone(SEED); delete old.jobs.browser_decider; const v = validateModelSettings(old);
  assert.equal(v.jobs.browser_decider.model, old.jobs.decider.model);
});

await test("validation: known keys, bounds, whole numbers, and the pairs that must stay in order", () => {
  assert.equal(limitsProblem({}), null); assert.equal(limitsProblem({ chat_steps: 80, helper_charge: 0.75 }), null);
  assert.match(limitsProblem({ nope: 1 }), /Unknown limit/); assert.match(limitsProblem({ chat_steps: 0 }), /from 1 to/); assert.match(limitsProblem({ chat_steps: 1001 }), /from 1 to 1000/);
  assert.match(limitsProblem({ chat_steps: 2.5 }), /whole number/); assert.match(limitsProblem({ chat_steps: "7" }), /enter a number/); assert.match(limitsProblem({ chat_steps: NaN }), /enter a number/);
  assert.match(limitsProblem([]), /object/); assert.match(limitsProblem(null), /object/);
  assert.match(limitsProblem({ turn_soft_charge: 0.55 }), /can't be above/); assert.match(limitsProblem({ turn_hard_charge: 0.1 }), /can't be above/);
  assert.match(limitsProblem({ notice_first_percent: 90 }), /first usage notice/); assert.match(limitsProblem({ command_minutes: 20 }), /can't be above/);
  assert.equal(limitsProblem({ day_factor: 1.5 }), null, "times may have decimals");
  assert.equal(timeoutProblem(null), null); assert.equal(timeoutProblem(1000), null); assert.match(timeoutProblem(999), /from 1000/); assert.match(timeoutProblem(1.5), /whole number/); assert.match(timeoutProblem("5"), /whole number/);
  assert.deepEqual(compactLimits({ chat_steps: 60, helper_steps: 25, bogus: 1 }), { helper_steps: 25 });
});

await test("saved settings without limits load and read as the starting values", () => {
  assert.equal("limits" in SEED, false);
  assert.deepEqual(limitValues(SEED), { ...LIMIT_DEFAULTS }); assert.deepEqual(limitValues(null), { ...LIMIT_DEFAULTS });
  const ok = validateModelSettings({ ...clone(SEED), limits: { chat_steps: 80 } });
  assert.equal(limitValues(ok).chat_steps, 80); assert.equal(limitValues(ok).helper_steps, 20);
  assert.throws(() => validateModelSettings({ ...clone(SEED), limits: { chat_steps: 5000 } }), (e) => e.status === 400 && /from 1 to 1000/.test(e.message));
  assert.throws(() => validateModelSettings({ ...clone(SEED), limits: { evil: 1 } }), (e) => e.status === 400);
  assert.throws(() => validateModelSettings({ ...clone(SEED), extra: 1 }), (e) => e.status === 400);
  const c = clone(SEED); c.jobs.label.timeout_ms = 45000; c.jobs.notes.timeout_ms = null; assert.equal(jobTimeoutMs(validateModelSettings(c), "label"), 45000);
  const d = clone(SEED); d.jobs.label.timeout_ms = 10; assert.throws(() => validateModelSettings(d), (e) => /timeout must be/.test(e.message));
  const e = clone(SEED); e.jobs.label.fallbacks[0].timeout_ms = 5000; assert.throws(() => validateModelSettings(e), (x) => x.status === 400, "a fallback entry carries no timeout");
});

await test("the reader turns the saved values into the units the code uses", () => {
  const r = runtimeLimits({ limits: { chat_steps: 80, helper_charge: 0.75, helper_deadline_minutes: 20, plan_task_charge: 0.4, scheduled_soft_percent: 50, notice_first_percent: 40, model_total_seconds: 60 } });
  assert.equal(r.chatSteps, 80); assert.equal(r.helper.charge, 7.5e8); assert.equal(r.helper.deadlineMs, 1200000); assert.equal(r.planTask.charge, 4e8); assert.equal(r.spend.unattendedSoft, 0.5);
  assert.deepEqual([...r.spend.noticeLevels], [40, 80]); assert.equal(r.model.totalMs, 60000); assert.equal(r.values.chat_steps, 80);
  assert.equal(runtimeLimits(null).chatSteps, 60);
  assert.deepEqual({ ...runtimeLimits(null).modelSaved }, {}); assert.deepEqual({ ...runtimeLimits(null).timingSaved }, {}); assert.deepEqual({ ...r.modelSaved }, { totalMs: 60000 }); assert.deepEqual({ ...runtimeLimits({ limits: { turn_pause_minutes: 5 } }).timingSaved }, { wallMs: 300000 });
  assert.equal(planBudget(r.planTask).max_charge, 4e8); assert.match(planBudgetText(r.planTask), /\$0\.40/);
  assert.deepEqual(turnBudget(0, "workflow", runtimeLimits({ limits: { scheduled_soft_percent: 50 } }).spend), { soft: 25e7, hard: 5e8 });
  assert.equal(dayLine(20e9, 0, 3), 3 * Math.round(20e9 / 30)); assert.equal(slotMaxOf("x", {}, 9), 9); assert.equal(slotMaxOf("p", { p: { slots: 4 } }, 9), 4);
  assert.equal(commandLimitMs("run_command", { timeout_minutes: 30 }, runtimeLimits({ limits: { command_max_minutes: 40 } })), 1800000);
  assert.match(noticeText(40, 1e9, 2e9, "Zed", 90), /40%/); assert.doesNotMatch(noticeText(40, 1e9, 2e9, "Zed", 90), /pauses until/);
});

await test("limitsFor reads the saved settings of the env, and falls back to the starting values when they can't be read", quiet(async () => {
  assert.equal((await limitsFor(withSettings({}, { ...clone(SEED), limits: { chat_steps: 99 } }))).chatSteps, 99);
  assert.equal((await limitsFor({})).chatSteps, 60, "no settings storage: the starting values, never a missing limit");
  assert.equal(await jobTimeoutFor(withSettings({}), "label"), 30000); assert.equal(await jobTimeoutFor({}, "label"), 30000); assert.equal(await jobTimeoutFor({}, "notes"), null);
  const s = clone(SEED); s.jobs.label.timeout_ms = null; assert.equal(await jobTimeoutFor(withSettings({}, s), "label"), null);
}));

// ---- the real save path: History, Restore and the page's view ----
const sql = new DatabaseSync(":memory:"); sql.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,ai_privacy TEXT)");
const DB = { withSession() { return this; }, prepare(q) { const s = sql.prepare(q); let a = []; const o = { bind(...v) { a = v; return o; }, first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }) }; return o; } };
const env = { ONEHELM_EE: "1hc", DB, ENV_NAME: "dev", OPENROUTER_API_KEY: "unit-key" };
await test("save keeps only changed limits, History and Restore cover them, and a save with no limits keeps the saved ones", quiet(async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("offline"); };   // the catalog check of a restored model reads nothing, so nothing is flagged
  try {
  let cur = await readModelSettings(env); assert.equal("limits" in cur.config, false);
  const base = { version: cur.config.version, jobs: clone(cur.config.jobs), ...(cur.config.routing ? { routing: cur.config.routing } : {}) };
  let v = await saveModelSettings(env, { revision: cur.revision, config: { ...base, limits: { chat_steps: 80, helper_steps: 20, helper_charge: 0.75 } } }, "unit@example.com");
  assert.deepEqual(v.config.limits, { chat_steps: 80, helper_charge: 0.75 }, "a value equal to its starting value is not stored");
  assert.equal(v.dashboard === undefined, true);   // the view is built by the page, not by the settings module
  assert.deepEqual(limitValues(v.config).chat_steps, 80);
  const dash = { limits: { values: limitValues(v.config), defs: LIMIT_DEFS } }; assert.equal(dash.limits.values.helper_charge, 0.75); assert.equal(dash.limits.defs.length, LIMIT_DEFS.length);
  // a job edit that sends no limits leaves the saved limits alone
  const edited = clone(base); edited.jobs.label.timeout_ms = 20000;
  v = await saveModelSettings(env, { revision: v.revision, config: edited }, "unit@example.com");
  assert.deepEqual(v.config.limits, { chat_steps: 80, helper_charge: 0.75 }); assert.equal(jobTimeoutMs(v.config, "label"), 20000);
  // an invalid limit is refused and nothing changes
  await assert.rejects(saveModelSettings(env, { revision: v.revision, config: { ...edited, limits: { chat_steps: 0 } } }, "u"), (e) => e.status === 400);
  await assert.rejects(saveModelSettings(env, { revision: v.revision, config: { ...edited, limits: { turn_soft_charge: 0.9 } } }, "u"), (e) => e.status === 400);
  assert.equal((await readModelSettings(env)).revision, v.revision);
  // sending an empty set resets every limit
  const withTimeout = v.revision;
  v = await saveModelSettings(env, { revision: v.revision, config: { ...edited, limits: {} } }, "unit@example.com");
  assert.equal("limits" in v.config, false); assert.equal(jobTimeoutMs(v.config, "label"), 20000);
  // Restore brings the older limits back, and restoring a version that had none clears them
  v = await restoreModelSettings(env, { revision: v.revision, restore_revision: withTimeout }, "unit@example.com");
  assert.deepEqual(v.config.limits, { chat_steps: 80, helper_charge: 0.75 });
  v = await restoreModelSettings(env, { revision: v.revision, restore_revision: 1 }, "unit@example.com");
  assert.equal("limits" in v.config, false); assert.equal(jobTimeoutMs(v.config, "label"), 30000);
  } finally { globalThis.fetch = realFetch; }
}));

await test("the console shows the Limits view, and the Timeout field", async () => {
  const view = { revision: 3, environment: "dev", dynamicRouting: false, config: SEED, history: [], options: { choices: {} } };
  const state = await consoleState(view, { ENV_NAME: "dev" }), ui = { view: "limits", q: "", sel: null, level: "unrestricted", env: "dev", live: null };
  assert.equal(state.limits.defs.length, LIMIT_DEFS.length); assert.equal(state.limits.values.chat_steps, 60);
  const html = pageHtml(state, ui, Date.now()).toString();
  for (const d of LIMIT_DEFS) assert.ok(html.includes(`data-lim="${d.key}"`), d.key);
  const label = pageHtml(state, { ...ui, view: "all" }, Date.now()).toString(); assert.match(label, /data-f="timeout"[^>]*value="30"/);
  assert.match(drawerHtml(state, { ...ui, view: "all", sel: "label" }, consoleView(state, { ...ui, view: "all", sel: "label" }), Date.now()).toString(), /Timeout, seconds/);
});

// ---- the places that read the saved values ----
const fakeSql = (rows) => ({ exec: (q, ...a) => ({ toArray: () => (/COUNT/.test(q) ? [{ n: rows.today }] : /status IN \('running','waiting_input'\)/.test(q) ? Array(rows.running).fill({ id: 1 }) : /SELECT deadline/.test(q) ? rows.deadlines : []) }) });
await test("helper limits come from the saved values", () => {
  const L = runtimeLimits({ limits: { helper_running: 2, helper_per_day: 5 } }).helper;
  assert.match(startRefusal(fakeSql({ running: 2, today: 0 }), "s", Date.now(), L), /2 helpers are already working/);
  assert.equal(startRefusal(fakeSql({ running: 2, today: 0 }), "s"), null, "the starting limit is 6");
  assert.match(startRefusal(fakeSql({ running: 0, today: 5 }), "s", Date.now(), L), /5 helpers have been started/);
  const wake = (limits) => helperNextWake({ exec: (q) => ({ toArray: () => (/status='running'/.test(q) && /SELECT deadline/.test(q) ? [{ deadline: 1000 }] : [{ id: 0 }].slice(1)) }) }, 1500, limits);
  assert.equal(wake(), 1000 + 120000);   // the first step still in the future is the grace end
  assert.equal(wake(runtimeLimits({ limits: { helper_grace_minutes: 5 } }).helper), 1000 + 300000);
});

await test("dispatch gives each attempt of a job its saved timeout, and none when the saved timeout is empty", quiet(async () => {
  const seen = [];
  const mk = (timeout) => { const s = clone(SEED); s.jobs.label.timeout_ms = timeout; return withSettings({ OPENROUTER_API_KEY: "k", AIG_ID: "g" }, s); };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(init?.signal || null); return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { cost: 0 } }); };
  try {
    await dispatch(mk(20000), "label", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t", kind: "x" }, level: "zdr" });
    await dispatch(mk(null), "label", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t", kind: "x" }, level: "zdr" });
    await dispatch(mk(1000), "label", { messages: [{ role: "user", content: "hi" }] }, { meta: { tenant: "t", kind: "x" }, level: "zdr" });
  } finally { globalThis.fetch = realFetch; }
  assert.ok(seen[0] instanceof AbortSignal && !seen[0].aborted, "a 20 second timeout gives the call a signal that has not fired");
  assert.ok(seen[1] == null || (seen[1] instanceof AbortSignal && !seen[1].aborted), "no timeout: no timer");
  assert.ok(seen[2] instanceof AbortSignal);
  await new Promise((r) => setTimeout(r, 1100)); assert.equal(seen[2].aborted, true, "a 1 second timeout fires"); assert.equal(seen[2].reason?.name, "TimeoutError"); assert.equal(seen[0].aborted, false);
}));

console.log(`${n} tests passed`);
