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
// Repeats that are not back to back (a model that alternates between two or three failing tools never has an unbroken run). Every call
// is filed under its tool and folded result. A failing result ("error: ...") counts by tool and result alone, because a model that
// keeps rewording the input of a call that keeps failing is as stuck as one that repeats it. Any other result counts only when the
// input is similar too, so polling a job or paging through results (different results) never adds up.
// tc.stallState is saved with the turn on every step (resume.js), so the history stays small: keys are short hashes of tool and
// result, each input is cut to its first SEEN_INPUT characters, and the oldest keys go first once the saved map passes SEEN_BYTES.
const MAX_INPUTS = 4, SEEN_INPUT = 120, SEEN_BYTES = 16000;
const failed = (r) => /^error:/i.test(r);
const hash = (s) => { let h = 2166136261, g = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ c, 16777619); g = Math.imul(g, 33) ^ c; } return (h >>> 0).toString(36) + (g >>> 0).toString(36); };
function seenCount(seen, cur, sim) {
  const key = hash(`${cur.name}\u0001${cur.result}`), input = cur.input.slice(0, SEEN_INPUT), list = seen[key] || [];
  delete seen[key]; seen[key] = list;   // newest last
  let e = failed(cur.result) ? list[0] : list.find((x) => similarity(x.input, input) >= sim);
  if (!e) { if (list.length >= MAX_INPUTS) list.shift(); e = { input, n: 0 }; list.push(e); }
  e.n++;
  const n = e.n;
  for (const k of Object.keys(seen)) { if (k === key || JSON.stringify(seen).length <= SEEN_BYTES) break; delete seen[k]; }
  return n;
}
// Called after each tool result. Returns true on the call that trips the guard (the run is then stopped softly).
// While "Pause to check spending" is on for a person's turn, the spend watch handles back to back repeats, and this guard only
// counts failing repeats; if the watch already paused the turn, this guard stays out so the turn is not stopped twice.
export function stallCheck(tc, name, args, out, L) {
  if (!tc || tc.stall || tc.pause) return false;
  const pauses = spendPausesOn(tc) && !isHelperTurn(tc);
  const limit = pauses ? Number(L?.stall?.turnCalls) || 0 : stallLimit(tc, L); if (limit < 2) return false;
  const sim = L?.stall?.similarity ?? 0.85;
  const cur = { name: String(name), input: inputOf(args), result: fold(out) }, prev = tc.stallState;
  const same = prev && prev.name === cur.name && prev.result === cur.result && similarity(prev.input, cur.input) >= sim;
  const run = same ? (prev.n || 1) + 1 : 1;
  const seen = prev?.seen || {}, total = seenCount(seen, cur, sim);
  tc.stallState = { ...cur, n: run, seen };
  const calls = pauses ? (failed(cur.result) ? Math.max(run, total) : 0) : Math.max(run, total);
  if (calls < limit) return false;
  tc.stall = { calls, tool: cur.name };
  if (isHelperTurn(tc)) tc.helperWhy ||= "no progress";
  if (!tc.abort) tc.abort = "soft";
  return true;
}
export const stallAsk = (tc) => `(Stopped: your last ${tc?.stall?.calls || "several"} tool calls were nearly the same call to ${tc?.stall?.tool || "a tool"} and gave the same result, so the work was not moving. No more tools now. Write a short, plain report, facts only: what you were trying to do, the call that kept repeating and what it returned, what you think is blocking it, and what is still not done. Do not say the work is finished, and do not ask whether to continue.)`;
