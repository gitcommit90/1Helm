// node --import ./test/stubs/register.mjs test/stall-guard.test.mjs
// The no-progress guard (stall-guard.js): pure rules on tool calls, with the thresholds taken from the limits (limits.js).
import assert from "node:assert/strict";
import "../src/resident.js";
import { stallCheck, similarity, stallLimit, stallAsk } from "../src/stall-guard.js";
import { runtimeLimits, DEFAULT_RUNTIME_LIMITS, LIMIT_DEFAULTS } from "../src/limits.js";
import { reportAsk } from "../src/spendguard.js";

const L = DEFAULT_RUNTIME_LIMITS;
assert.deepEqual({ ...L.stall }, { helperCalls: 6, turnCalls: 10, similarity: 0.85 }, "the starting values");
assert.equal(LIMIT_DEFAULTS.helper_stall_calls, 6);
const R2 = runtimeLimits({ limits: { helper_stall_calls: 3, turn_stall_calls: 4, stall_similarity_percent: 60 } });
assert.deepEqual({ ...R2.stall }, { helperCalls: 3, turnCalls: 4, similarity: 0.6 }, "saved values apply");

const helperTc = () => ({ kind: "helper", helper: { id: 1 } }), chatTc = () => ({ kind: "chat", spendPauses: false });
assert.equal(stallLimit(helperTc(), L), 6); assert.equal(stallLimit(chatTc(), L), 10); assert.equal(stallLimit(chatTc(), null), 0); assert.equal(stallLimit({ kind: "chat", spendPauses: true }, L), 0, "the runaway watch covers a turn while the pauses are on");

// the alfred loop: the same command, only a number and the step title change, the same result
{
  const tc = helperTc(); let tripped = 0;
  for (let i = 1; i <= 6; i++) tripped = stallCheck(tc, "run_command", { step_title: `Check ${i}`, command: `python3 check.py # attempt ${i}` }, `READY len=${17900 + i} proceeding to app_run next`, L) ? i : tripped;
  assert.equal(tripped, 6, "trips on the sixth call, not before"); assert.equal(tc.abort, "soft"); assert.equal(tc.helperWhy, "no progress"); assert.equal(tc.stall.calls, 6);
  assert.match(reportAsk(tc, "LIMIT"), /nearly the same call to run_command/); assert.match(stallAsk(tc), /still not done/);
  assert.equal(stallCheck(tc, "run_command", { command: "x" }, "y", L), false, "trips once");
}
// a different result, a different tool or different words reset the count
for (const [name, vary] of [["result", (i) => ["run_command", { command: "ls" }, `file${String.fromCharCode(97 + i)}`]], ["tool", (i) => [i % 2 ? "read_file" : "run_command", { command: "ls" }, "same"]], ["words", (i) => ["run_command", { command: `cmd${String.fromCharCode(97 + i)} --flag${String.fromCharCode(97 + i)} ${String.fromCharCode(97 + i)}x` }, "same"]]]) {
  const tc = helperTc(); for (let i = 0; i < 26; i++) assert.equal(stallCheck(tc, ...vary(i), L), false, `${name} varies: no stop`);
  assert.equal(tc.abort, undefined);
}
// a main turn has its own, higher threshold and no helper reason
{ const tc = chatTc(); let n = 0; for (let i = 0; i < 9; i++) n += stallCheck(tc, "fetch_url", { url: "https://a.example/x" }, "same", L) ? 1 : 0; assert.equal(n, 0); assert.equal(stallCheck(tc, "fetch_url", { url: "https://a.example/x" }, "same", L), true); assert.equal(tc.helperWhy, undefined); assert.equal(tc.abort, "soft"); }
// the count survives a restart through tc.stallState (resume.js journals it)
{ const a = helperTc(); for (let i = 0; i < 4; i++) stallCheck(a, "run_command", { command: "same" }, "same", L); const b = helperTc(); b.stallState = JSON.parse(JSON.stringify(a.stallState)); assert.equal(stallCheck(b, "run_command", { command: "same" }, "same", L), false); assert.equal(stallCheck(b, "run_command", { command: "same" }, "same", L), true); }
// an existing soft stop is kept, and a threshold of 0 switches the guard off
{ const tc = helperTc(); tc.abort = "hard"; for (let i = 0; i < 6; i++) stallCheck(tc, "t", {}, "r", L); assert.equal(tc.abort, "hard"); }
{ const off = runtimeLimits({}); const tc = helperTc(); assert.equal(stallCheck(tc, "t", {}, "r", { stall: { helperCalls: 0 } }), false); }
assert.equal(similarity("a b c", "a b c"), 1); assert.equal(similarity("a b", "c d"), 0);
console.log("PASS stall guard");
