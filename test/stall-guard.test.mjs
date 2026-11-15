// node --import ./test/stubs/register.mjs test/stall-guard.test.mjs
// The no-progress guard (stall-guard.js): pure rules on tool calls, with the thresholds taken from the limits (limits.js).
import assert from "node:assert/strict";
import "../src/resident.js";
import { stallCheck, stallLimit, stallAsk } from "../src/stall-guard.js";
import { runtimeLimits, DEFAULT_RUNTIME_LIMITS, LIMIT_DEFAULTS } from "../src/limits.js";
import { reportAsk } from "../src/spendguard.js";

const L = DEFAULT_RUNTIME_LIMITS;
assert.deepEqual({ ...L.stall }, { helperCalls: 6, turnCalls: 10 }, "the starting values");
assert.equal(LIMIT_DEFAULTS.helper_stall_calls, 6);
const R2 = runtimeLimits({ limits: { helper_stall_calls: 3, turn_stall_calls: 4 } });
assert.deepEqual({ ...R2.stall }, { helperCalls: 3, turnCalls: 4 }, "saved values apply");

const helperTc = () => ({ kind: "helper", helper: { id: 1 } }), chatTc = () => ({ kind: "chat", spendPauses: false });
assert.equal(stallLimit(helperTc(), L), 6); assert.equal(stallLimit(chatTc(), L), 10); assert.equal(stallLimit(chatTc(), null), 0); assert.equal(stallLimit({ kind: "chat", spendPauses: true }, L), 0, "the runaway watch covers a turn while the pauses are on");

// the loop: the same command, only the step title changes, the same result
{
  const tc = helperTc(); let tripped = 0;
  for (let i = 1; i <= 6; i++) tripped = stallCheck(tc, "run_command", { step_title: `Check ${i}`, command: "python3 check.py" }, "READY len=17900 proceeding to app_run next", L) ? i : tripped;
  assert.equal(tripped, 6, "trips on the sixth call, not before"); assert.equal(tc.abort, "soft"); assert.equal(tc.helperWhy, "no progress"); assert.equal(tc.stall.calls, 6);
  assert.match(reportAsk(tc, "LIMIT"), /nearly the same call to run_command/); assert.match(stallAsk(tc), /still not done/);
  assert.equal(stallCheck(tc, "run_command", { command: "x" }, "y", L), false, "trips once");
}
// a different result or different words reset the count (alternating tools with the same input and result is a repeat: see the interleaved cases below)
for (const [name, vary] of [["result", (i) => ["run_command", { command: "ls" }, `file${String.fromCharCode(97 + i)}`]], ["words", (i) => ["run_command", { command: `cmd${String.fromCharCode(97 + i)} --flag${String.fromCharCode(97 + i)} ${String.fromCharCode(97 + i)}x` }, "same"]]]) {
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

// interleaved failing calls: different tools in turn, the same errors, never an unbroken run
const E1 = "error: no matching open worker in this task.", E2 = "error: A routed sub-agent is required.";
const liveSeq = () => { const o = [["search_agent_bank", { q: "arcade" }, "none found"], ["read_log", { id: 11 }, E1], ["file_text", { name: "x.html" }, E2]];
  for (let i = 0; i < 11; i++) o.push(["approve_subagent", { id: 11, files: ["Open Arcade prototype.html"] }, E1], ["read_log", { id: 11 }, E1], ["message_subagent", { id: 11, message: `Please revise the part number ${i} with words ${"abcdefghijk"[i]}${i * 7} and more` }, E1]); return o; };
for (const [label, seq, make] of [["live", liveSeq, chatTc], ["live, pauses on", liveSeq, () => ({ kind: "chat", spendPauses: true })]]) {
  const tc = make(); let at = 0; seq().forEach(([n, a, r], i) => { if (stallCheck(tc, n, a, r, L) && !at) at = i + 1; });
  assert.ok(at > 0 && at <= 40, `${label}: trips (call ${at})`); assert.equal(tc.abort, "soft"); assert.match(stallAsk(tc), /Stopped/);
}
// legitimate repeats: same call, different result (polling a job, paging) never trips, with or without other calls between
for (const mk of [chatTc, () => ({ kind: "chat", spendPauses: true }), helperTc]) {
  const tc = mk(); for (let i = 0; i < 40; i++) { assert.equal(stallCheck(tc, "job_status", { id: 5 }, `running ${i * 3}% step ${"abcdefghij"[i % 10]}${"klmnopqrst"[i % 7]}`, L), false); assert.equal(stallCheck(tc, "read_file", { path: "a.txt", page: i }, `page ${String.fromCharCode(97 + (i % 26))}${i} text`, L), false); }
  assert.equal(tc.abort, undefined);
}
// the same successful call with the same result only counts when the repeats are back to back (a call in between resets the count)
{ const tc = chatTc(); for (let i = 0; i < 24; i++) { stallCheck(tc, "fetch_url", { url: "https://a.example/x" }, "same", L); stallCheck(tc, "list", { i: String.fromCharCode(97 + i) + "zz" }, `r${String.fromCharCode(97 + i)}`, L); } assert.equal(tc.abort, undefined); }
// False stops: six different raw inputs with the same result never stop a run, a real loop does
{
  const years = [2021, 2022, 2023, 2024, 2025, 2026].map((y) => ["fetch_url", { url: `https://huskers.com/sports/football/schedule/season/${y}` }, "Nebraska football schedule: Aug 30 vs Illinois, Sep 6 ..."]);
  const frames = [5, 18, 30, 42, 55, 10].map((n) => ["read_file", { path: `/work/frames/frame-${n}.png` }, "the picture follows in the next message (84 KB)"]);
  const words = ["dental", "sunscreen", "tampon", "Walmart", "HSA", "reimb"].map((q) => ["search_transactions", { query: q, limit: 50 }, "0 transactions\nNo matches found for the filters."]);
  for (const [label, calls] of [["years", years], ["frames", frames], ["empty searches", words]]) {
    for (const mk of [helperTc, chatTc]) { const tc = mk(); for (const [n, a, r] of [...calls, ...calls, ...calls]) assert.equal(stallCheck(tc, n, a, r, L), false, label); assert.equal(tc.abort, undefined); }
  }
  const tc = helperTc(); let at = 0; for (let i = 0; i < 6; i++) if (stallCheck(tc, "fetch_url", { step_title: `Try ${i}`, url: "https://a.example/x" }, "same", L)) at = i + 1; assert.equal(at, 6, "the same raw input six times in a row stops");
}
{ const tc = { kind: "chat", spendPauses: true }; for (let i = 0; i < 24; i++) stallCheck(tc, "fetch_url", { url: "https://a.example/x" }, "same", L); assert.equal(tc.abort, undefined); }
// a turn the spend watch already paused is not stopped a second time
{ const tc = { kind: "chat", spendPauses: true, pause: { reason: "loop" }, abort: "soft" }; for (let i = 0; i < 15; i++) stallCheck(tc, "t", {}, "error: x", L); assert.equal(tc.stall, undefined); }
// a long turn of distinct calls keeps the saved state small
{ const tc = chatTc(); for (let i = 0; i < 200; i++) stallCheck(tc, `tool${i % 7}`, { q: `${"word ".repeat(300)}${i}x${i * 31}` }, `error: ${"w".repeat(1500)} kind${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i >> 3) % 26))}`, L); assert.ok(JSON.stringify(tc.stallState).length < 8000, `state ${JSON.stringify(tc.stallState).length}`); }
console.log("PASS stall guard");
