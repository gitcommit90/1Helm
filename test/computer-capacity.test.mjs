// node --import ./test/stubs/register.mjs test/computer-capacity.test.mjs
// When the channel computer class is at max_instances the platform refuses the start ("no container instance ...").
// The start must stop after a short bound and throw the plain message the app and the helper's tool result show.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer } from "../src/channel-computer.js";
import { COMPUTER_BUSY_MSG, isCapacityError, isComputerBusy, computerBusyError } from "../src/computer-capacity.js";
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
console.log("computer-capacity ok");
