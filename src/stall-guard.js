// No-progress guard. A run that makes several tool calls in a row with the same input and the same result, or fails again and again with the same error, is going in a
// circle (e.g. re-reading one file and printing its hash about 60 times without making the call it was
// preparing). The run is stopped softly: tools off and one final report of what it is stuck on. The thresholds are limits
// (limits.js: helper_stall_calls, turn_stall_calls), changed on the Models page.
import { isHelperTurn, spendPausesOn } from "./spend-preferences.js";

const KEEP = 2000;   // characters of a call's input and result kept to compare with the next call
const fold = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, KEEP);
// The call's arguments without the step title (the model rewords it every call), with keys in order.
function canonical(v) {
  if (!v || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}
const inputOf = (args) => {
  let a = args;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch { return fold(a); } }
  if (a && typeof a === "object" && !Array.isArray(a)) { const { step_title, ...rest } = a; a = rest; }
  return fold(canonical(a));
};
// The threshold that applies to this turn: a helper has its own, every other turn shares one. 0 or less: off. While the account's
// "Pause to check spending" is on, a person's turn has the runaway watch instead (spendguard.js guardTools: pauses with Keep going
// and Stop here), so this guard covers a turn only when that watch is off.
export function stallLimit(tc, L) {
  if (isHelperTurn(tc)) return Number(L?.stall?.helperCalls) || 0;
  return spendPausesOn(tc) ? 0 : Number(L?.stall?.turnCalls) || 0;
}
const failed = (r) => /^error:/i.test(r);
// Called after each tool result. Returns true on the call that trips the guard (the run is then stopped softly).
// While "Pause to check spending" is on for a person's turn, the spend watch handles back to back repeats, and this guard only
// counts failing repeats; if the watch already paused the turn, this guard stays out so the turn is not stopped twice.
export function stallCheck(tc, name, args, out, L) {
  if (!tc || tc.stall || tc.pause) return false;
  const pauses = spendPausesOn(tc) && !isHelperTurn(tc);
  const limit = pauses ? Number(L?.stall?.turnCalls) || 0 : stallLimit(tc, L); if (limit < 2) return false;
  const cur = { name: String(name), input: inputOf(args), result: fold(out) }, prev = tc.stallState;
  const same = prev && prev.name === cur.name && prev.result === cur.result && prev.input === cur.input;
  const run = same ? (prev.n || 1) + 1 : 1;
  // Calls in a row that fail with the same error text, whatever the tool: a model that rewords a failing call is as stuck as one that repeats it.
  const total = failed(cur.result) ? (prev && prev.result === cur.result ? (prev.fails || 1) + 1 : 1) : 0;
  tc.stallState = { ...cur, n: run, fails: total };
  const calls = pauses ? (failed(cur.result) ? Math.max(run, total) : 0) : Math.max(run, total);
  if (calls < limit) return false;
  tc.stall = { calls, tool: cur.name };
  if (isHelperTurn(tc)) tc.helperWhy ||= "no progress";
  if (!tc.abort) tc.abort = "soft";
  return true;
}
export const stallAsk = (tc) => `(Stopped: your last ${tc?.stall?.calls || "several"} tool calls were nearly the same call to ${tc?.stall?.tool || "a tool"} and gave the same result, so the work was not moving. No more tools now. Write a short, plain report, facts only: what you were trying to do, the call that kept repeating and what it returned, what you think is blocking it, and what is still not done. Do not say the work is finished, and do not ask whether to continue.)`;
