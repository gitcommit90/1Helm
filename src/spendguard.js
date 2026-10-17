// Spend guard (Captain 10-06: "my wife or my father, how would they have caught 'this is a runaway'?"). Protection that works for
// someone who never looks at usage: automatic, plain-spoken, and never a surprise bill. Money is nano$ (1e9 = $1) like the Ledger.
//
// 1. Per-turn budget, every turn (chat, plan-started tasks, follow-ups, scheduled runs; helpers keep their own $0.50 cap):
//      soft = TURN_SOFT ($0.15, about 3× a normal email turn of ~$0.05) → the helper PAUSES: tools off, a short plain report that
//      ends by asking whether to keep going; its card closes "paused" (stop.js's paused card) with Keep going / Stop here.
//      hard = TURN_HARD ($0.50): no model call is ever started that could plausibly cross it (2× the biggest step so far), so a
//      turn never runs past it without the person's tap. Keep going = stop.js's Continue (/stream continue=<card>): one more budget.
//      Both scale with the plan's monthly allowance (Personal $20 = 1×), capped. Unattended runs stop at 80% of hard with a report.
//    The step cap (60 for chat; stop.js writes the short report) and the plan-task budgets end the same way: a paused card.
// 2. Runaway signs pause early (same report + card), even under budget. Deterministic, counted over this turn's tool calls:
//      silent    ≥ 15 tool calls and nothing said to the person yet. Reading the playbook (read_skill, read_doc, bring_back) and to-do
//                bookkeeping (update_todos) don't count (eval 10-07: a docx/deck turn read 5-8 references and paused before any work,
//                while 05-writing-style.md tells it not to narrate). A react, or a to-do list the person can see, counts as telling them;
//      loop      the same tool with similar arguments 4 times (word overlap of the argument VALUES ≥ 0.7: a search loop); 7 when a
//                file was written or edited before every repeat (fix → rebuild);
//      accounts  one turn reaching into 4+ different connected accounts;
//      fast      ≥ 20 tool calls inside one minute (a normal turn is a handful; quiet calls don't count here either);
//      no progress  3 calls answered "you already have this" (appfirst.js: a repeated app search, a list brought back again, the
//                same page opened twice, the same saved result opened or brought back again) count as a loop;
//      recall run  12 calls in a row that only look back (work_log, bring_back, recall_history) and do nothing new: a loop (eval
//                run2 10-07: wide-research/small-list-inline made 32 such calls in a row and never made the table).
// 3. The day and the month (Ledger mixin below):
//      check-in: a day can burn about 2× its share of the plan (monthly allowance / 30 × 2) before the helper checks in with the same
//      card. Keep going raises today's line by another 2× share. The existing hard daily safety cap (DAY_CAP_PCT, ≥ $15) is unchanged.
//      Dev evals: /api/test/day-cap {checkin:false} turns the check-in off for an @example.com test account (TEST_MODE="1" only).
//      notices: crossing 50% and 80% of the month's allowance leaves ONE plain in-app notice (and a text when texting is set up).
//      100%: unchanged (the Ledger refuses the call); the reply is plain (OUT_OF_TIME_REPLY).
// 4. At most SLOT_MAX (3) task turns working at once per channel: extra plan-started tasks wait ("Waiting") and start, in order,
//    as one finishes. Stop / Stop all still reach them (they are live turns, just not started).
// 5. Usage the person can see: "This task: about $0.03" (sessionDetail.usage) and the month meter in Settings (boot account.month).
import { PLANS } from "./plans-def.js";
import { DEFAULT_RUNTIME_LIMITS } from "./limits.js";
import { limitsFor } from "./ee/index.js";
import { setStatus } from "./tracker.js";
import { textConnected, textSend } from "./ee/index.js";
import { ESCALATE_STALL } from "./ee/index.js";
import { PAUSE_FACTS, callKey } from "./ee/index.js";
import { loopWords } from "./ee/index.js";   // a live search: changing a real field (date, place) is a new search, not a loop
import { loadCheckins, normalizeCheckins } from "./agent-checkins.js";
import { SPEND_PAUSES_KEY, CHECKIN_PAUSES, spendPausesOn, checkinsOn, applySpendPreference, readSpendPreference } from './spend-preferences.js';

export const BASE_ALLOWANCE = 20e9;        // Personal plan usage ($20/month): the plan the per-turn numbers are tuned for
// The cost, day, notice and slot numbers below are the starting values of the saved limits (limits.js, edited on the Models page, read at the start of
// each turn by limits-read.js). The functions that use them take the saved values as an argument and default to these.
const SP = DEFAULT_RUNTIME_LIMITS.spend;
const limOf = (r) => r?.lim?.() || DEFAULT_RUNTIME_LIMITS;   // a Resident knows the limits of its last turn; a bare test object does not
export const TURN_SOFT = SP.turnSoft;             // $0.15 per turn before a pause
export const TURN_HARD = SP.turnHard;              // $0.50 per turn, never crossed without a tap
export const SOFT_MAX = SP.softMax, HARD_MAX = SP.hardMax;   // bigger plans scale up to $0.60 / $2.00
export const UNATTENDED_SOFT = SP.unattendedSoft;        // scheduled runs (nobody to tap): report at 80% of hard
export const DAY_FACTOR = SP.dayFactor;               // a day may use 2× its share before a check-in
export const NOTICE_LEVELS = [...SP.noticeLevels];
export const SLOT_MAX = SP.slotMax;                  // default; a plan may set its own with `slots` in src/plans-def.js (Captain 2026-10-17: 3 -> 6)
export const slotMaxOf = (plan, plans = PLANS, dflt = SLOT_MAX) => { const n = Math.floor(Number(plans?.[plan]?.slots)); return n >= 1 ? n : dflt; };
// silent and fast here are only the fallback when no account values are passed (tests). Accounts get theirs from agent-checkins.js.
export const RUNAWAY = { silent: 15, repeat: 4, repeatEdited: 7, similar: 0.7, accounts: 4, fast: 20, fastMs: 60e3, outLoops: 2, noProgress: 3, recallRun: 12 };
const LOOK_BACK = new Set(["work_log", "bring_back", "recall_history"]);   // calls that only look back at what's already known
// Time (live check 10-06: a retry loop written INSIDE one run_command sat "working" for 10+ minutes at 3 steps / $0.01):
//   wallMs   a turn working this long without its reply pauses (scheduled runs stop with a report); Keep going = another wallMs;
//   cmdMs    one run_command may run this long, then it's killed with everything it started (timeout_minutes raises it, ≤ cmdMaxMs);
//   repeatN  a command's output with the same line this many times (and ≥ a quarter of its lines) gets a "this is a loop" note.
const wallOf = (L) => L?.timingSaved?.wallMs ?? TIMING.wallMs;   // the saved turn check-in time, else the starting value
export const TIMING = { wallMs: DEFAULT_RUNTIME_LIMITS.wallMs, cmdMs: DEFAULT_RUNTIME_LIMITS.cmdMs, cmdMaxMs: DEFAULT_RUNTIME_LIMITS.cmdMaxMs, repeatN: 8 };   // the three times are starting values: the saved limits (limits.js) are in tc.limits
const NO_LOOP = new Set(["update_todos", "react", "remember", "mark_done"]);   // bookkeeping tools repeat by design
const EDITS = new Set(["write_file", "edit_file"]);   // a change to a file between two runs of the same command
// Quiet calls: reading the playbook and keeping the to-do list. They never count toward "silent", and a model step whose calls are
// all quiet doesn't count toward the per-turn SOFT budget (the hard ceiling still counts every cent): the pause is for work that
// ran long, not for reading how to do it (eval 10-07: a PDF task on the top model spent $0.25 reading 8 references, then paused).
export const QUIET = new Set(["read_skill", "read_doc", "bring_back", "update_todos"]);
const argsObj = (args) => { if (typeof args !== "string") return args || {}; try { return JSON.parse(args || "{}"); } catch { return {}; } };
// Calls the person sees as the helper talking to them: a reaction on their message, a to-do list with items in it.
export function speaks(name, args) {
  if (name === "react") return true;
  if (name === "update_todos") { const a = argsObj(args); return Array.isArray(a?.items) && a.items.length > 0; }
  return false;
}

export const usd = (n) => `$${(Math.max(0, Number(n) || 0) / 1e9).toFixed(2)}`;
export const about = (n) => (Number(n) || 0) < 5e6 ? "less than a cent" : `about ${usd(n)}`;
export const OUT_OF_TIME_REPLY = "You've used all of this month's helper time, so I stopped here. Nothing was lost. You can add more in Settings → General → Usage, and it refills when your plan renews.";
export const SPEND_CEILING = "spend_ceiling";

// ---- budgets ----
export function turnBudget(allowance = 0, kind = "chat", S = SP) {
  const k = allowance > 0 ? Math.max(1, allowance / BASE_ALLOWANCE) : 1;
  const hard = Math.min(S.hardMax, Math.round(S.turnHard * k));
  const soft = kind === "workflow" ? Math.round(hard * S.unattendedSoft) : Math.min(S.softMax, Math.round(S.turnSoft * k));
  return { soft, hard };
}
export const dayShare = (allowance) => Math.round((allowance > 0 ? allowance : BASE_ALLOWANCE) / 30);
export const dayLine = (allowance, okLevel = 0, factor = DAY_FACTOR) => Math.max(factor * dayShare(allowance), Number(okLevel) || 0);

// ---- the runaway detector (pure; a watch per turn) ----
export const newWatch = () => ({ calls: [], said: false });
function leaves(v, out = []) {
  if (v == null) return out;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") { out.push(String(v)); return out; }
  if (Array.isArray(v)) { for (const x of v) leaves(x, out); return out; }
  if (typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "step_title") leaves(x, out);
  return out;
}
export function argWords(args) {
  let a = args; if (typeof a === "string") { try { a = JSON.parse(a || "{}"); } catch { a = { raw: a }; } }
  return new Set(leaves(a).join(" ").toLowerCase().split(/[^a-z0-9@._-]+/).filter(Boolean));
}
export function similar(A, B) {
  if (!A.size && !B.size) return 0;   // no arguments at all (e.g. a snapshot): never counted as a loop
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
const accountOf = (args) => { let a = args; if (typeof a === "string") { try { a = JSON.parse(a || "{}"); } catch { return ""; } } return a && typeof a === "object" && a.account ? `${a.app || ""}:${String(a.account).toLowerCase()}` : ""; };
export function noteCalls(w, calls, at = Date.now()) {
  for (const [name, args] of calls) {
    if (speaks(String(name), args)) w.said = true;
    w.calls.push({ name: String(name), words: String(name) === "search_web_vertical" ? loopWords(args) : argWords(args), account: accountOf(args), at, quiet: QUIET.has(String(name)) });
  }
}
// The two agent check-in signs alone (agent-checkins.js), for a turn whose spending pauses are off. enabled false looks for nothing.
export function checkinSign(w, now = Date.now(), checkins = RUNAWAY) {
  if (checkins.enabled === false) return null;
  const c = w.calls.filter((x) => !x.quiet);
  if (!w.said && c.length >= checkins.silent) return { reason: "silent" };
  if (c.filter((x) => now - x.at <= RUNAWAY.fastMs).length >= checkins.fast) return { reason: "fast" };
  return null;
}
// → null, or { reason } for the first sign found (in this order).
export function runawaySign(w, now = Date.now(), checkins = RUNAWAY) {
  const c = w.calls, n = c.length; if (!n) return (w.outLoops || 0) >= RUNAWAY.outLoops ? { reason: "loop" } : null;
  if (checkins.enabled !== false && !w.said && c.filter((x) => !x.quiet).length >= checkins.silent) return { reason: "silent" };
  const last = c[n - 1];
  if (!NO_LOOP.has(last.name) && last.words.size) {
    const idx = c.map((x, i) => (x.name === last.name && similar(x.words, last.words) >= RUNAWAY.similar ? i : -1)).filter((i) => i >= 0);
    // Fix → rebuild is progress, not a loop: the same build command with a file edit before every re-run may run up to repeatEdited
    // times (dev 10-07: make_docx.sh ×4 with an edit_file between each paused as "loop" right as the 4th run passed).
    const edited = idx.length > 1 && idx.slice(1).every((i, k) => c.slice(idx[k] + 1, i).some((x) => EDITS.has(x.name)));
    if (idx.length >= (edited ? RUNAWAY.repeatEdited : RUNAWAY.repeat)) return { reason: "loop", tool: last.name };
  }
  { let run = 0; for (let i = n - 1; i >= 0 && LOOK_BACK.has(c[i].name); i--) run++; if (run >= RUNAWAY.recallRun) return { reason: "loop", tool: last.name }; }
  if (new Set(c.map((x) => x.account).filter(Boolean)).size >= RUNAWAY.accounts) return { reason: "accounts" };
  if (checkins.enabled !== false && c.filter((x) => !x.quiet && now - x.at <= RUNAWAY.fastMs).length >= checkins.fast) return { reason: "fast" };   // reads are quick by nature
  if ((w.outLoops || 0) >= RUNAWAY.outLoops) return { reason: "loop" };   // commands whose output kept repeating one line
  if ((w.noProgress || 0) >= RUNAWAY.noProgress) return { reason: "loop" };   // appfirst.js: "you already have this" again and again
  return null;
}

// ---- what the person and the model read ----
const TITLES = {
  budget: "This is taking longer than usual", hard: "This is taking longer than usual", steps: "This is taking a lot of steps",
  silent: "Checking in before going further", loop: "This looked like it was going in circles", time: "This is taking a long time", accounts: "Checking in before going further",
  fast: "Checking in before going further", day: "A busy day",
};
export function pauseLine(reason, helper = "Your helper", spent = 0, wallMs = TIMING.wallMs) {
  if (reason === "day") return `You've used about twice a normal day's helper time today. That can be fine on a busy day. Keep going lets ${helper} carry on.`;
  const why = reason === "loop" ? `${helper} kept trying the same thing and paused to check with you.` : reason === "accounts" ? `${helper} was reaching into a lot of your accounts and paused to check with you.`
    : reason === "time" ? `${helper} has been working on this for over ${Math.round(wallMs / 60e3)} minutes and paused to check with you.`
    : reason === "silent" || reason === "fast" ? `${helper} did a lot without checking in and paused to ask you.` : reason === "steps" ? `${helper} has taken a lot of steps on this and paused to check with you.` : `This is using more than a task usually does, so ${helper} paused to check with you.`;
  return `${why} This task so far: ${about(spent)}.`;
}
// The tools-off ask at a pause (a person will read it). Facts only (opsread 10-06: the pause report repeated a wrong plan, "you need
// to sign in", for an app that was already connected): no new plan unless a tool result showed it works.
export function pauseAsk(reason) {
  const why = reason === "loop" ? "You were repeating the same kind of step." : reason === "time" ? "This has been running for a long time." : reason === "accounts" ? "You were reaching into many accounts." : reason === "silent" || reason === "fast" ? "You were doing many steps without telling the person anything." : reason === "steps" ? "You've used the most steps one turn can take." : "This has taken longer than a task usually does.";
  return `(Pause: ${why} No more tools now. Write a short, plain report for the person, facts only: what you actually did or found so far (exact names, values, links) and what's still left of what they asked, said as what isn't done yet ("the event isn't added yet"). ${PAUSE_FACTS} Plain text only: no cards, no buttons, and don't ask whether to keep going (the app shows its own Keep going / Stop here buttons under your message). No jargon, no talk of budgets, steps or costs.)`;
}
export const pauseFallback = (said = "") => `${String(said || "").trim() ? `${String(said).trim()}\n\n` : ""}This is taking longer than usual, so I paused here. Nothing was lost. Want me to keep going?`;
export const DAY_PAUSE_REPLY = "I've already done a lot for you today, about twice a normal day's worth, so I'm checking in before I start on this. Want me to go ahead?";
export function noticeText(level, used, allowance, helper = "Your helper", second = NOTICE_LEVELS[1]) {
  return level >= second
    ? `You've used ${level}% of this month's helper time (${usd(used)} of ${usd(allowance)}). When it runs out, ${helper} pauses until it refills or you add more in Settings → General → Usage.`
    : `You've used ${level === 50 ? "half" : `${level}%`} of this month's helper time (${usd(used)} of ${usd(allowance)}). Nothing to do; this is just so you know. It refills when your plan renews.`;
}

// ---- per-turn checks (tc.guard is set by spendStart; a turn without one is unguarded, e.g. helpers) ----
function pauseAt(tc, reason) { if (tc.abort || tc.pause || !(spendPausesOn(tc) || (checkinsOn(tc) && CHECKIN_PAUSES.includes(reason)))) return false; tc.pause = { reason }; tc.abort = "soft"; return true; }
const spentOf = (tc, stats) => (stats?.charge || 0) + (tc.extraCharge || 0);
// After each model call: the turn's budget, and today's check-in line. names: the tools this step calls (a step that only reads the
// playbook or updates the to-do list is left out of the soft budget: g.reading).
export function guardModel(tc, stats, content = "", more = true, names = []) {
  const g = tc?.guard; if (!g) return null;
  if (String(content || "").trim()) g.watch.said = true;
  const spent = spentOf(tc, stats), step = spent - (g.lastSpent || 0); g.lastSpent = spent;
  if (!spendPausesOn(tc)) return null;
  if (!more) return null;   // this step is the answer: the turn ends anyway
  if (names.length && names.every((n) => QUIET.has(String(n)))) g.reading = (g.reading || 0) + Math.max(0, step);
  if (spent - (g.reading || 0) >= g.soft) return pauseAt(tc, "budget") ? tc.pause : null;
  if (g.dayLine && g.dayBase + spent >= g.dayLine) return pauseAt(tc, "day") ? tc.pause : null;
  return null;
}
// After a round of tool calls: [[name, args], …].
export function guardTools(tc, calls, now = Date.now()) {
  const g = tc?.guard; if (!g || !(spendPausesOn(tc) || checkinsOn(tc))) return null;
  // integration-hint.js marks a call it answered without running (tc.unrun): skipped, so a one-time nudge and its retry never add up to a loop.
  if (tc.unrun?.length) calls = calls.filter(([n, a]) => { const i = tc.unrun.indexOf(callKey(String(n), a)); if (i < 0) return true; tc.unrun.splice(i, 1); return false; });
  noteCalls(g.watch, calls, now);
  const ck = normalizeCheckins(g.checkins);
  const s = spendPausesOn(tc) ? runawaySign(g.watch, now, ck) : checkinSign(g.watch, now, ck);   // spending pauses off: only the check-in signs
  if (s?.reason === "loop" && escalatingNext(tc)) return null;   // the fast model repeating itself: route2 hands the next step to the stronger one first
  return s && pauseAt(tc, s.reason) ? tc.pause : null;
}
// ---- run_command: its time limit, and notes on what came back ----
export function commandLimitMs(name, a = {}, saved = null) {
  const T = saved ? { ...TIMING, ...saved } : TIMING;   // saved: the times changed on the Models page (limits.js timingSaved)
  if (name !== "run_command") return T.cmdMs;
  const m = Math.round(Number(a.timeout_minutes) || 0);
  return m > 0 ? Math.min(m * 60e3, T.cmdMaxMs) : T.cmdMs;
}
// The line a loop inside one command keeps printing: digits fold (timestamps, counters), → { line, n } or null.
export function repeatedLine(out) {
  const lines = String(out || "").split("\n").map((l) => l.trim()).filter(Boolean); if (lines.length < TIMING.repeatN) return null;
  const n = new Map(); let best = null;
  for (const l of lines) { const k = l.replace(/\d+/g, "#").replace(/\s+/g, " ").slice(0, 300); const c = (n.get(k) || 0) + 1; n.set(k, c); if (!best || c > best.n) best = { line: l, n: c }; }
  return best.n >= TIMING.repeatN && best.n * 4 >= lines.length ? best : null;
}
export function commandNotes(r, tc = null) {
  if (!r || typeof r.out !== "string") return r;
  const notes = [], rep = repeatedLine(r.out);
  if (r.timed_out) notes.push(`[1Helm: this command was still running after ${Math.round((r.limit_ms || TIMING.cmdMs) / 60e3)} minutes, so it was stopped, with everything it started. If the person asked for a long job, run it again with timeout_minutes (up to ${TIMING.cmdMaxMs / 60e3}). Otherwise don't retry it the same way: tell the person what happened.]`);
  if (rep) notes.push(`[1Helm: the same line came up ${rep.n} times in this output ("${rep.line.slice(0, 120)}"). That looks like a loop that isn't getting anywhere: don't run it again the same way. Tell the person what you found and ask before trying more.]`);
  if (rep && tc?.guard) tc.guard.watch.outLoops = (tc.guard.watch.outLoops || 0) + 1;
  return notes.length ? { ...r, out: `${r.out.replace(/\n*$/, "")}\n${notes.join("\n")}` } : r;
}
// Two-model router (route2.js): a Luna turn whose every call just now repeated an earlier one is about to escalate ("stalled").
// The stronger model gets that one step; if it repeats too, the loop pauses on its next round.
function escalatingNext(tc) {
  const e = tc?.esc; if (!e || e.done || !tc.route?.two) return false;
  return e.pending.length > 0 && e.pending.every((p) => p.repeat) && e.stall + 1 >= ESCALATE_STALL;
}
// Before every model call of a guarded turn: never start one that could cross the hard ceiling.
export function guardCall(tc) {
  const g = tc?.guard; if (!g || !spendPausesOn(tc)) return;
  const est = Math.max(2 * (g.biggest || 0), 1e7);   // 2× the biggest step so far (at least $0.01): conservative on purpose
  if ((tc.charged || 0) + (tc.extraCharge || 0) + est > g.hard) {
    tc.pause ||= { reason: "hard" }; tc.budgetHit = true;
    throw Object.assign(new Error(SPEND_CEILING), { budget: true });
  }
}
// A model step stopped for repeating itself (repeat-guard.js, Resident.callModel): counted on the turn and as a loop sign, like a
// command whose output kept repeating one line (two in one turn → the "loop" pause at the next round of tools).
export function noteRepeat(tc, rep = null) {
  if (!tc) return;
  tc.repeats = (tc.repeats || 0) + 1;
  if (tc.guard) tc.guard.watch.outLoops = (tc.guard.watch.outLoops || 0) + 1;
}
// resume.js: a resumed turn keeps its guard (budget, runaway watch, what it spent); only its wall clock is set again, for what's left.
export function guardResume(tc, startedAt) {
  if (!tc?.guard) return;
  tc.guard.checkins = normalizeCheckins(tc.guard.checkins);
  tc.guard.started = Number(startedAt || Date.now());
  if (spendPausesOn(tc)) tc.guard.wallT = setTimeout(async () => { await tc.refreshSpend?.(); if (!tc.finished && !tc.committed) pauseAt(tc, "time"); }, Math.max(1000, wallOf(tc.limits) - (Date.now() - tc.guard.started)));
}
export function noteCharge(tc, charge) { if (!tc) return; tc.charged = (tc.charged || 0) + charge; if (tc.guard) tc.guard.biggest = Math.max(tc.guard.biggest || 0, charge); }
export const reportAsk = (tc, limitAsk) => tc?.pause && tc.kind !== "workflow" ? pauseAsk(tc.pause.reason) : limitAsk;

// ---- the Resident side ----
// One pause system with stop.js: a paused turn's card closes as "paused" ("Paused … Continue?"); Continue is the app's
// "Keep going." sent with continue=<card> (Resident.chatStream), which grants one more budget. This table only remembers WHY a
// card paused (its line in the app, and whether Continue is a day check-in) and the person's Stop here.
export const SPEND_DDL = [
  "CREATE TABLE IF NOT EXISTS spend_pauses (card TEXT PRIMARY KEY, session TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL, spent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'paused', decided_at INTEGER)",
  "CREATE INDEX IF NOT EXISTS spend_pauses_session ON spend_pauses(session, at)",
];
export function spendInit(sql) { for (const q of SPEND_DDL) sql.exec(q); }
const guardOff = (env) => env?.SPENDGUARD === "off";
async function helperName(res) { try { return (await res.env.DB.prepare("SELECT helper_name FROM tenants WHERE id=?").bind(res.get("tenant")).first())?.helper_name || "Your helper"; } catch { return "Your helper"; } }
export function pauseView(row, helper = "Your helper", wallMs = TIMING.wallMs) {
  if (!row) return null;
  return { card: row.card, session: row.session, reason: row.reason, status: row.status, at: row.at, spent: about(row.spent),
    title: TITLES[row.reason] || TITLES.budget, line: pauseLine(row.reason, helper, row.spent, wallMs) };
}
// stop.js / plans budgets say why with tc.limitWhy ("cost" | "steps" | "time"); the guard with tc.pause.reason.
const reasonOf = (tc) => tc.pause?.reason || (tc.limitWhy === "cost" ? "budget" : tc.limitWhy) || "budget";

export function spendMix(Resident) { return Object.assign(Resident.prototype, {
  async spendRefresh(tc, opts = tc.spendOptions || {}) {
    tc.spendOptions = opts;
    tc.refreshSpend = () => this.spendRefresh(tc, opts);
    let L = null; try { L = this.ledger(); } catch { L = null; }   // no Ledger binding (old stub/test env): same as an unreadable preference, the ON policy
    const enabled = await readSpendPreference(L);
    applySpendPreference(tc, enabled);
    if (enabled && tc.abort !== 'hard' && !tc.finished && !tc.committed) {
      if (tc.guard && Date.now() - (tc.guard.started || tc.t0 || Date.now()) >= wallOf(tc.limits)) pauseAt(tc, 'time');
      if (opts.max_ms && Date.now() - (opts.resume?.started || tc.t0 || Date.now()) >= opts.max_ms && !tc.abort) { tc.limitWhy = 'time'; tc.abort = 'soft'; }
      if (tc.helper?.deadline && Date.now() >= tc.helper.deadline && !tc.abort) { tc.helperWhy = 'time limit'; tc.abort = 'soft'; }
    }
    return enabled;
  },
  // Durable source for task/list status; a guard pause is a question, not a finished result.
  spendWaiting(session) {
    return !!this.sql.exec("SELECT card FROM spend_pauses WHERE session=? AND status='paused' AND reason IN ('silent','fast') LIMIT 1", String(session)).toArray()[0];
  },
  // Turn start: its budget, today's check-in line, a fresh runaway watch. A check-in that's already due pauses before any work.
  async spendStart(tc, opts = {}) {
    await this.spendRefresh(tc, opts);
    if (guardOff(this.env) || tc.kind === "helper") return;
    let info = null; try { const L = this.ledger(); if (typeof L.guardInfo === "function") info = await L.guardInfo(); } catch (e) { console.log("spend guard info", e.message); }
    const allowance = Number(info?.allowance_nano) || 0, SL = tc.limits || limOf(this), b = turnBudget(allowance, tc.kind, SL.spend);
    const person = tc.kind === "chat" || tc.kind === "followup";
    const checkinOff = !!info?.checkin_off && testModeOn(this.env);   // dev evals on a test account (Ledger.setCheckinTest)
    tc.guard = { ...b, watch: newWatch(), biggest: 0, dayBase: Number(info?.day_spent_nano) || 0, dayLine: person && info && !checkinOff ? dayLine(allowance, info.day_ok_nano, SL.spend.dayFactor) : 0 };
    // Snapshot for this turn; resume.js persists it alongside counters, so a restart cannot reset or silently retune it.
    // A saved change applies to the next turn, including Keep going after a pause.
    tc.guard.checkins = await loadCheckins(this.env, this.get("tenant"));
    // Wall clock: working this long without its reply → pause at the next step (a running command ends by its own limit first).
    tc.guard.started = tc.t0 || Date.now();
    tc.guard.wallT = setTimeout(async () => { await this.spendRefresh(tc, opts); if (!tc.finished && !tc.committed) pauseAt(tc, "time"); }, wallOf(tc.limits));
    // Over today's line already: the check-in comes first (not for a helper's result coming back, nor right after a Continue).
    const fresh = opts.taskKickoff || !opts.handoff || opts.handoff?.type === "plan";
    if (spendPausesOn(tc) && tc.guard.dayLine && tc.guard.dayBase >= tc.guard.dayLine && fresh && !opts.spendContinue) { tc.pause = { reason: "day" }; tc.guard.pre = true; }
  },
  // Explicitly delegated tasks: at most SLOT_MAX task turns work at once in this channel; the rest wait in order.
  spendWorking(except = null) { return [...this.active.values()].filter((t) => t !== except && !t.finished && !t.slotWait && t.kind === "chat").length; },
  async spendSlot(tc, opts = {}) {
    if (guardOff(this.env) || (!opts.taskKickoff && opts.handoff?.type !== "plan") || this.spendWorking(tc) < await this.spendSlotMax()) return;
    tc.slotWait = true; tc.line = "waiting to start";
    try { setStatus(this.sql, tc, tc.turn, "queued"); } catch {}
    tc.emit?.({ t: "queued", why: "slots" });
    let wake; const p = new Promise((z) => { wake = z; });
    (this.slotQ ||= []).push({ tc, wake });
    await Promise.race([p, tc.stopped]);
    this.slotQ = this.slotQ.filter((x) => x.tc !== tc);
    tc.slotWait = false; tc.line = "";
    if (tc.abort !== "hard") { try { setStatus(this.sql, tc, tc.turn, "working"); } catch {} }
  },
  // This workspace's limit: its plan's `slots`, else SLOT_MAX. Read from D1 when a task starts and kept for spendWake.
  async spendSlotMax() {
    let plan = ""; try { plan = (await this.env.DB.prepare("SELECT plan FROM tenants WHERE id=?").bind(this.get("tenant")).first())?.plan || ""; } catch {}
    return (this.slotLimit = slotMaxOf(plan, undefined, (await limitsFor(this.env)).spend.slotMax));
  },
  spendDone(tc) { if (tc?.guard?.wallT) clearTimeout(tc.guard.wallT); this.spendWake(); },
  spendWake() {
    while ((this.slotQ || []).length && this.spendWorking() < (this.slotLimit || limOf(this).spend.slotMax)) { const x = this.slotQ.shift(); x.tc.slotWait = false; x.wake(); }
  },
  // The turn closes as "paused": remember why (its line under the report), → the view streamed as {t:"spend_pause"}.
  async spendPaused(tc, stats) {
    if (!tc.session || !tc.turn) return null;
    this._helperName ||= await helperName(this);
    this.sql.exec("INSERT OR REPLACE INTO spend_pauses (card, session, at, reason, spent) VALUES (?,?,?,?,?)", tc.turn, tc.session, Date.now(), reasonOf(tc), Math.round(spentOf(tc, stats)));
    return pauseView(this.sql.exec("SELECT * FROM spend_pauses WHERE card=?", tc.turn).toArray()[0], this._helperName || "Your helper", wallOf(limOf(this)));
  },
  async spendPauses(session) {
    const helper = await helperName(this); this._helperName = helper;
    return this.sql.exec("SELECT * FROM spend_pauses WHERE session=? ORDER BY at DESC LIMIT 30", String(session)).toArray().reverse().map((r) => pauseView(r, helper, wallOf(limOf(this))));
  },
  // Continue (chatStream, continue=<card>): a day check-in's Continue also raises today's line by another 2× share.
  async spendContinued(card) {
    const row = this.sql.exec("SELECT * FROM spend_pauses WHERE card=?", String(card)).toArray()[0]; if (!row) return null;
    this.sql.exec("UPDATE spend_pauses SET status='continued', decided_at=? WHERE card=?", Date.now(), row.card);
    this.sql.exec("UPDATE sessions SET updated=? WHERE id=?", Date.now(), row.session);
    if (row.reason === "day") { try { const L = this.ledger(); if (typeof L.dayCheckin === "function") await L.dayCheckin((await limitsFor(this.env)).spend.dayFactor); } catch (e) { console.log("day checkin", e.message); } }
    return row;
  },
  // Stop here: the card stops offering Continue (what's done stays).
  async spendStopHere(card) {
    const c = this.sql.exec("SELECT id, session, status FROM cards WHERE id=?", String(card)).toArray()[0];
    if (!c) return { error: "That card is gone.", status: 404 };
    if (c.status === "paused") this.sql.exec("UPDATE cards SET status='complete' WHERE id=?", c.id);
    this.sql.exec("UPDATE spend_pauses SET status='stopped', decided_at=? WHERE card=? AND status='paused'", Date.now(), c.id);
    this.sql.exec("UPDATE sessions SET updated=? WHERE id=?", Date.now(), c.session);
    const row = this.sql.exec("SELECT * FROM spend_pauses WHERE card=?", c.id).toArray()[0];
    return { ok: true, card: c.id, pause: row ? pauseView(row, await helperName(this), wallOf(limOf(this))) : null, session: this.sessionView(this.session(c.session)) };
  },
  // "This task: about $0.03": every turn of the task, its background helpers included.
  spendTaskUsage(session) {
    const n = Number(this.sql.exec("SELECT COALESCE(SUM(charge_nano),0) n FROM turns WHERE session=?", String(session)).toArray()[0]?.n) || 0;
    return { nano: n, line: `This task: ${about(n)}` };
  },
  // After every turn that cost something: the 50% / 80% notices (once each per month), with a text when texting is set up.
  async spendAfterTurn(charge) {
    if (guardOff(this.env) || !(charge > 0)) return null;
    let n = null; try { const L = this.ledger(); if (typeof L.usageNotice !== "function") return null; n = await L.usageNotice(await helperName(this), (await limitsFor(this.env)).spend.noticeLevels); } catch (e) { console.log("usage notice", e.message); return null; }
    if (!n?.level) return null;
    try {
      if (await textConnected(this.env, this.get("tenant"))) await textSend(this.env, this.get("tenant"), n.text);
    } catch (e) { console.log("usage notice text", e.message); }
    return n;
  },
}); }

// ---- the Ledger side (mixed into the per-tenant Ledger in index.js; its own sql, dayInfo, dayStart) ----
export const CHECKIN_TEST_KEY = "day_checkin_test";
export const testModeOn = (env) => String(env?.TEST_MODE ?? "") === "1";
export const checkinOffTest = (env, v) => testModeOn(env) && v === "off";
// The dev test routes that loosen the day guards are for reserved test addresses only (they never get real mail either).
export const isTestAccount = (email) => /^[^@\s]+@example\.com$/i.test(String(email || "").trim());


// ---- Making a file (deckflow4, dev 10-07): steps that do no work, said where the helper reads it ----
// A file from a brief should take 10 to 20 steps. Live runs spent 5 to 7 steps a turn on to-do updates sent alone, and 6 to 8 on
// research the artifacts skill says a planning file doesn't need. Notes go on the tool result, once or twice a turn, never block.
export const FILE_NOTES = { todoAlone: 2, searches: 1, pages: 2 };
const BOOKKEEPING_ONLY = new Set(["update_todos", "react"]), RESEARCH = new Set(["web_search", "fetch_url", "work_log", "recall_history"]);
export function stepNotes(tc, name, calls, out, args = {}) {
  if (!tc || typeof out !== "string") return out;
  const n = (tc.fileNotes = tc.fileNotes || { todo: 0, search: 0, page: 0, said: 0 });
  if (name === "read_skill" && args?.slug === "artifacts") tc.fileTask = true;
  if (name === "update_todos" && calls.length && calls.every((c) => BOOKKEEPING_ONLY.has(c.function?.name)) && n.todo < FILE_NOTES.todoAlone) {
    n.todo++;
    return `${out}\n[1Helm: this step only updated the to-do list, and every step is a full model call. Send to-do updates together with real work (the next command, the share), never on their own; the list doesn't need an update for every phase.]`;
  }
  if (!tc.fileTask || !RESEARCH.has(name)) return out;
  if (name === "web_search") n.search++; else n.page++;
  if (n.search > FILE_NOTES.searches || n.page > FILE_NOTES.pages) {
    if (n.said >= 2) return out; n.said++;
    return `${out}\n[1Helm: you're making a file from a brief, and that's past its research budget (one search, two pages). The artifacts skill: well-known facts need no source; build now with what you have.]`;
  }
  return out;
}
