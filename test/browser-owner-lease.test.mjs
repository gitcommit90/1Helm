// node --import ./test/stubs/register.mjs test/browser-owner-lease.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer } from "../src/channel-computer.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) {
    db.exec(q); return { toArray: () => [], one: () => undefined };
  }
  const stmt = db.prepare(q);
  const rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? stmt.all(...args) : (stmt.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const calls = [];
let fetchGate = null;
const container = { running: true, monitor: () => new Promise(() => {}), getTcpPort: () => ({ fetch: async (url) => {
  calls.push(url); if (fetchGate) await fetchGate;
  return Response.json({ ok: true, url: "https://example.com/", title: "Page" });
} }) };
const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, container, waitUntil: () => {} };
const make = () => { const c = new ChannelComputer(ctx, {}); c.ensureRunning = async () => ({ cold: false }); return c; };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const ownerA = "owner_A_0123456789abcdef0123456789abcd";
const ownerB = "owner_B_0123456789abcdef0123456789abcd";
let C = make();

assert.equal((await C.browser("navigate", { url: "https://example.com/" })).ok, true);
assert.equal(calls.length, 1, "ordinary browser calls still work without an owner");
assert.equal((await C.acquireBrowserOwner("short")).ok, false);
assert.equal((await C.acquireBrowserOwner(ownerA)).ok, true);
assert.equal((await C.exec("echo should-not-run")).browser_busy, true, "a shell cannot drive Chrome while a browser job owns it");
assert.equal((await C.exec("echo should-not-run")).code, 1, "the blocked shell gets a clear result");
assert.equal(calls.length, 1, "blocking shell commands does not touch Chrome");
assert.deepEqual(await C.browserOwnerState(), { owned: true, in_flight: false, human_controlled: false, lease_until: Number(C.get("browser_owner_until")) });
assert.equal((await C.acquireBrowserOwner(ownerB)).browser_busy, true);
for (const op of ["navigate", "snapshot", "act", "back", "screenshot"]) {
  assert.equal((await C.browser(op)).browser_busy, true, `${op} must not use a background job's tab`);
  assert.equal((await C.browser(op, {}, ownerB)).owner_lost, true, `${op} must check the owner token`);
}
assert.equal((await C.browser("status")).ok, true, "the person's live pane can still read tab status");
assert.equal((await C.browser("snapshot", {}, ownerA)).ok, true);
assert.equal((await C.renewBrowserOwner(ownerB)).owner_lost, true);
assert.equal((await C.renewBrowserOwner(ownerA)).ok, true);
assert.equal((await C.releaseBrowserOwner(ownerB)).owner_lost, true);

// SQL state survives a Durable Object restart, but the token never appears in public state.
C = make();
assert.equal((await C.browser("snapshot")).browser_busy, true);
assert.equal((await C.browser("snapshot", {}, ownerA)).ok, true);
assert.equal((await C.releaseBrowserOwner(ownerA)).ok, true);
assert.deepEqual(await C.browserOwnerState(), { owned: false, in_flight: false, human_controlled: false, lease_until: null });
assert.equal((await C.browser("snapshot")).ok, true);
// A shell command that reserved the computer before a cold wake blocks acquisition.
C.commandInFlight = 1;
assert.equal((await C.acquireBrowserOwner(ownerA)).browser_busy, true);
C.commandInFlight = 0;

// A browser call waiting for Chrome to start reserves the tab before its first await.
const wake = deferred(); C.ensureRunning = async () => { await wake.promise; return { cold: false }; };
const pendingOrdinary = C.browser("navigate", { url: "https://example.com/" });
assert.equal((await C.acquireBrowserOwner(ownerA)).browser_busy, true);
C = make();
assert.equal((await C.acquireBrowserOwner(ownerA)).browser_busy, true, "a reset cannot erase an ordinary browser reservation");
wake.resolve(); assert.equal((await pendingOrdinary).ok, true);
C.ensureRunning = async () => ({ cold: false });
assert.equal((await C.acquireBrowserOwner(ownerA)).ok, true);
assert.equal((await C.releaseBrowserOwner(ownerA)).ok, true);

// A shell command can reach Chrome without using the browser API. Its reservation survives the same reset.
const commandWake = deferred(); C.ensureRunning = async () => { await commandWake.promise; return { cold: false }; };
C.installSkills = async () => {}; C.loadStandins = async () => {}; C.sh = async () => ({ code: 0, out: "ok" });
const pendingCommand = C.exec("echo ok", { save: "none" });
C = make();
assert.equal((await C.acquireBrowserOwner(ownerA)).browser_busy, true, "a reset cannot erase a shell command reservation");
commandWake.resolve(); assert.equal((await pendingCommand).code, 0);
sql.exec("INSERT INTO computer_busy (id,kind,until) VALUES (?,?,?)", "expired-fixture", "command", Date.now() - 1);
assert.equal((await C.acquireBrowserOwner(ownerA)).ok, true);

// A lease that expires while an action is already running must not admit another action.
const action = deferred(); fetchGate = action.promise;
const pendingOwner = C.browser("act", { actions: [] }, ownerA);
assert.equal((await C.releaseBrowserOwner(ownerA)).browser_busy, true);
assert.equal((await make().browser("snapshot", {}, ownerA)).browser_busy, true, "a reset cannot start a second owner action");
C.put("browser_owner_until", Date.now() - 1);
assert.equal((await C.browser("navigate")).browser_busy, true);
assert.equal((await C.exec("echo should-not-run")).browser_busy, true, "an in-flight action blocks shell even after lease expiry");
assert.equal((await C.browserOwnerState()).in_flight, true);
assert.equal((await C.acquireBrowserOwner(ownerB)).browser_busy, true);
const reconstructedOwner = make();
assert.equal((await reconstructedOwner.browserOwnerState()).in_flight, true, "an owner action remains visible after reset");
assert.equal((await reconstructedOwner.acquireBrowserOwner(ownerB)).browser_busy, true);
action.resolve();
const expiredResult = await pendingOwner;
assert.equal(expiredResult.owner_lost, true);
assert.equal(expiredResult.operation_may_have_completed, true);
fetchGate = null;
assert.equal((await C.browser("navigate")).ok, true);
assert.equal((await C.browser("navigate", {}, ownerA)).owner_lost, true);
assert.equal((await C.acquireBrowserOwner(ownerB)).ok, true, "an expired lease can be recovered by a new job");

// Take control revokes the owner while it waits for a cold start. It cannot send its next operation.
const slowWake = deferred(); C.ensureRunning = async () => { await slowWake.promise; return { cold: false }; };
const pendingTakeover = C.browser("navigate", { url: "https://example.com/" }, ownerB);
assert.equal((await C.takeControl("person")).ok, true);
assert.equal((await C.browserOwnerState()).human_controlled, true);
slowWake.resolve(); assert.equal((await pendingTakeover).taken_over, true);
assert.equal((await C.renewBrowserOwner(ownerB)).owner_lost, true);
assert.equal((await C.browser("snapshot", {}, ownerB)).taken_over, true);
assert.equal((await C.browser("snapshot")).taken_over, true);
await C.releaseControl(); C.ensureRunning = async () => ({ cold: false });
assert.equal((await C.browser("snapshot")).ok, true);

assert.equal((await C.acquireBrowserOwner(ownerB)).ok, true);
const midAction = deferred(); fetchGate = midAction.promise;
const callCount = calls.length;
const pendingMidAction = C.browser("act", { actions: [] }, ownerB);
for (let i = 0; i < 10 && calls.length === callCount; i++) await Promise.resolve();
assert.equal(calls.length, callCount + 1, "the action reached the browser service");
assert.equal((await C.takeControl("person")).ok, true);
midAction.resolve();
const midResult = await pendingMidAction;
assert.deepEqual({ taken_over: midResult.taken_over, operation_may_have_completed: midResult.operation_may_have_completed }, { taken_over: true, operation_may_have_completed: true });
fetchGate = null; await C.releaseControl();

// A failed browser connection must check ownership again before its next send.
assert.equal((await C.acquireBrowserOwner(ownerB)).ok, true);
const originalPort = container.getTcpPort, firstFailure = deferred(); let retryCalls = 0;
container.getTcpPort = () => ({ fetch: async () => { retryCalls++; firstFailure.resolve(); throw new Error("connection failed"); } });
const pendingRetry = C.browser("act", { actions: [] }, ownerB);
await firstFailure.promise;
assert.equal((await C.takeControl("person")).ok, true);
assert.equal((await pendingRetry).taken_over, true);
assert.equal(retryCalls, 1, "the owner must not send a second request after takeover");
container.getTcpPort = originalPort; await C.releaseControl();

assert.equal((await C.acquireBrowserOwner(ownerA)).ok, true);
C.save = async () => ({ ok: true });
container.destroy = async () => { container.running = false; };
assert.equal((await C.stop("user requested sleep")).stopped, true);
assert.equal((await C.browserOwnerState()).owned, false, "explicit sleep revokes the background task");

console.log("browser-owner-lease: persisted ownership, admission, expiry, takeover and sleep passed");
