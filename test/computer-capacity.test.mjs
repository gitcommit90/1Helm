// node --import ./test/stubs/register.mjs test/computer-capacity.test.mjs
// When the channel computer class is at max_instances the platform refuses the start ("no container instance ...").
// The start must stop after a short bound and throw the plain message the app and the helper's tool result show.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer } from "../src/channel-computer.js";
import { COMPUTER_BUSY_MSG, isCapacityError, isComputerBusy, computerBusyError, retryWhileBusy, busyReply, BUSY_WAITING, BUSY_GIVEUP_MSG, BUSY_WAIT_MAX_MS } from "../src/computer-capacity.js";
import { claudeChat } from "../src/ee/index.js";
import { plainError } from "../src/helpers.js";

assert.equal(COMPUTER_BUSY_MSG, "All computers are busy right now. Try again in a minute.");
for (const t of ["no container instance available", "Error: No container instance is available to start", "max_instances reached", "container instances limit exceeded", "at capacity", "not enough capacity"]) assert.ok(isCapacityError(t), t);
for (const t of ["", "exec timed out", "workspace mount failed", "out_of_credits", null, undefined]) assert.ok(!isCapacityError(t), String(t));
const be = computerBusyError();
assert.equal(be.message, COMPUTER_BUSY_MSG); assert.equal(be.status, 503); assert.equal(be.code, "computers_busy");
assert.ok(isComputerBusy(be)); assert.ok(isComputerBusy(`Something: ${COMPUTER_BUSY_MSG}`)); assert.ok(!isComputerBusy("out_of_credits"));
assert.equal(plainError(`Error: ${COMPUTER_BUSY_MSG}`), COMPUTER_BUSY_MSG);
assert.equal(plainError("out_of_credits"), "out of credits");

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
// A fast clock: every start attempt moves time forward 4 s, so the bound is crossed without real waiting.
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
function make(startError) {
  let starts = 0;
  const container = { running: false, monitor: () => new Promise(() => {}), start() { starts++; skew += 4000; if (startError) throw new Error(startError); },
    interceptOutboundHttp: async () => {}, interceptOutboundHttps: async () => {}, interceptAllOutboundHttp: async () => {}, destroy: async () => {} };
  const ctx = { id: { toString: () => "id" }, exports: { ComputerLink: () => ({}), Sentinel: () => ({}) }, storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, container, waitUntil: () => {} };
  const c = new ChannelComputer(ctx, {});
  c.prepayMinute = async () => true; c.sentinelOn = () => false; c.sh = async () => { throw new Error("down"); };
  c.put("gap_override", "0");
  return { c, starts: () => starts };
}
try {
  const a = make("no container instance available");
  const t0 = realNow();
  await assert.rejects(a.c.ensureRunning(), (e) => { assert.equal(e.message, COMPUTER_BUSY_MSG); assert.equal(e.status, 503); return true; });
  assert.ok(a.starts() >= 2 && a.starts() <= 5, `a few quick retries, then stop (${a.starts()})`);
  assert.ok(realNow() - t0 < 10000, "the refusal returns quickly");
  assert.deepEqual(await a.c.warm(), { ok: false, error: COMPUTER_BUSY_MSG }, "warm() reports the plain message");

  // Another failure keeps the old behaviour: it retries for the full bound and reports the platform text.
  skew = 0; const b = make("boom");
  await assert.rejects(b.c.ensureRunning(), (e) => { assert.match(e.message, /^computer did not start \(\d+ attempts/); assert.ok(!isComputerBusy(e)); return true; });
} finally { Date.now = realNow; }

// Waiting and retrying (retryWhileBusy): a fake sleep moves the clock, so no real time passes.
{
  let clock = 0; const real = Date.now; Date.now = () => clock;
  const sleep = async (ms) => { clock += ms; };
  const mk = () => { const events = []; return { events, emit: (e) => events.push(e), line: "Running a command" }; };
  try {
    // A refusal followed by a free computer: the same call runs again, once per attempt, with the status line then the old line back.
    let calls = 0, tc = mk(); clock = 0;
    assert.equal(await retryWhileBusy(async () => { if (++calls < 3) throw computerBusyError(); return "ok"; }, tc, { sleep }), "ok");
    assert.equal(calls, 3);
    assert.deepEqual(tc.events.map((e) => e.line), [BUSY_WAITING, BUSY_WAITING, "Running a command"]);
    // The first attempt behaves as before: no wait, no status event.
    tc = mk(); assert.equal(await retryWhileBusy(async () => 1, tc, { sleep }), 1); assert.equal(tc.events.length, 0);
    // The pauses grow 15 s, 30 s, 60 s, then 60 s each; the wait ends after 15 minutes with the new message.
    const pauses = []; clock = 0; calls = 0;
    await assert.rejects(retryWhileBusy(async () => { calls++; throw computerBusyError(); }, mk(), { sleep: async (ms) => { pauses.push(ms); clock += ms; } }), (e) => { assert.equal(e.message, BUSY_GIVEUP_MSG); assert.equal(e.status, 503); return true; });
    assert.deepEqual(pauses.slice(0, 5), [15e3, 30e3, 60e3, 60e3, 60e3]); assert.ok(clock <= BUSY_WAIT_MAX_MS && clock > BUSY_WAIT_MAX_MS - 60e3);
    assert.equal(calls, pauses.length + 1);
    assert.equal(busyReply(BUSY_GIVEUP_MSG), BUSY_GIVEUP_MSG); assert.equal(busyReply(computerBusyError()), COMPUTER_BUSY_MSG); assert.equal(busyReply("out_of_credits"), null);
    assert.equal(plainError(`Error: ${BUSY_GIVEUP_MSG}`), BUSY_GIVEUP_MSG);
    // Other errors (a reset by a deploy, no credits) pass through at once and are not retried.
    calls = 0; await assert.rejects(retryWhileBusy(async () => { calls++; throw new Error("Durable Object reset because its code was updated."); }, mk(), { sleep }), /reset/); assert.equal(calls, 1);
    // Stop during the wait: the long sleep is let go at once and the busy error ends the step without another attempt.
    let stop; tc = mk(); tc.stopped = new Promise((z) => { stop = z; }); calls = 0;
    const p = retryWhileBusy(async () => { calls++; throw computerBusyError(); }, tc, { sleep: () => new Promise(() => {}) });
    await new Promise((z) => setImmediate(z)); tc.abort = "hard"; stop();
    await assert.rejects(p, (e) => isComputerBusy(e)); assert.equal(calls, 1);
    // The Claude engine path: a refused start is retried inside claudeChat, and the model call happens once, after a computer is free.
    let tries = 0; const engine = { complete: async () => { if (++tries < 3) throw computerBusyError(); return { choices: [{ message: { content: "hi" } }], usage: {} }; } };
    const env = { CLAUDE_ENGINE: { idFromName: () => "i", get: () => engine } };
    tc = mk(); clock = 0;
    const realSet = globalThis.setTimeout; globalThis.setTimeout = (f) => realSet(f, 0);
    try { const r = await claudeChat({ ccHandle: { env, tid: "t" } }, { messages: [] }, { model: "sonnet", ctx: tc }); assert.equal((await r.json()).choices[0].message.content, "hi"); } finally { globalThis.setTimeout = realSet; }
    assert.equal(tries, 3); assert.equal(tc.events[0].line, BUSY_WAITING);
  } finally { Date.now = real; }
}
console.log("computer-capacity ok");
