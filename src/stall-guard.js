// No-progress guard. A run that makes several tool calls in a row with nearly the same input and the same result is going in a
// circle (a helper once re-read one file and printed its hash about 60 times and never made the call it was
// preparing). The run is stopped softly: tools off and one final report of what it is stuck on. The thresholds are limits
// (limits.js: helper_stall_calls, turn_stall_calls, stall_similarity_percent), changed on the Models page.
import { isHelperTurn, spendPausesOn } from "./spend-preferences.js";

const KEEP = 2000;   // characters of a call's input and result kept to compare with the next call
const fold = (s) => String(s ?? "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, KEEP);
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
const words = (s) => new Set(String(s).split(/[^A-Za-z0-9_#]+/).filter(Boolean));
// Share of words the two inputs have in common (1 = the same words).
export function similarity(a, b) {
  if (a === b) return 1;
  const x = words(a), y = words(b); if (!x.size && !y.size) return 1;
  let both = 0; for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}
// The threshold that applies to this turn: a helper has its own, every other turn shares one. 0 or less: off. While the account's
// "Pause to check spending" is on, a person's turn has the runaway watch instead (spendguard.js guardTools: pauses with Keep going
// and Stop here), so this guard covers a turn only when that watch is off.
export function stallLimit(tc, L) {
  if (isHelperTurn(tc)) return Number(L?.stall?.helperCalls) || 0;
  return spendPausesOn(tc) ? 0 : Number(L?.stall?.turnCalls) || 0;
}
// Called after each tool result. Returns true on the call that trips the guard (the run is then stopped softly).
export function stallCheck(tc, name, args, out, L) {
  const limit = stallLimit(tc, L); if (!tc || limit < 2 || tc.stall) return false;
  const cur = { name: String(name), input: inputOf(args), result: fold(out) }, prev = tc.stallState;
  const same = prev && prev.name === cur.name && prev.result === cur.result && similarity(prev.input, cur.input) >= (L?.stall?.similarity ?? 0.85);
  tc.stallState = { ...cur, n: same ? (prev.n || 1) + 1 : 1 };
  if (tc.stallState.n < limit) return false;
  tc.stall = { calls: tc.stallState.n, tool: cur.name };
  if (isHelperTurn(tc)) tc.helperWhy ||= "no progress";
  if (!tc.abort) tc.abort = "soft";
  return true;
}
export const stallAsk = (tc) => `(Stopped: your last ${tc?.stall?.calls || "several"} tool calls were nearly the same call to ${tc?.stall?.tool || "a tool"} and gave the same result, so the work was not moving. No more tools now. Write a short, plain report, facts only: what you were trying to do, the call that kept repeating and what it returned, what you think is blocking it, and what is still not done. Do not say the work is finished, and do not ask whether to continue.)`;
