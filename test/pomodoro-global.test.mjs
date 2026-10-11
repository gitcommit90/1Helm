// node --import ./test/stubs/register.mjs test/pomodoro-global.test.mjs
// Global focus timer (pomodoro.js pomoGlobalMethods, lives in the tenant's Archive DO): not tied to a task, one at a time (replace needs
// replace:true), survives "reload" (state is stored), shared by every channel, and the helper's tool: scope task|global, asks when unclear.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { pomoGlobalMethods, POMODORO_TOOL, POMO_IDLE_MS } from "../src/pomodoro.js";

const MIN = 60e3, T0 = Date.UTC(2026, 9, 10, 15, 0, 0);
const D1 = { prepare: () => { const o = { bind: () => o, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return o; } };
const mkSql = () => { const db = new DatabaseSync(":memory:"); return { db, sql: { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; } const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } } }; };
// The Archive stand-in: the real methods over a real sqlite table. "Reload" = a second object over the same db.
function archive(db = mkSql()) { const A = { sql: db.sql, db, clock: T0, pgClock() { return A.clock; } }; for (const [k, v] of Object.entries(pomoGlobalMethods)) if (k !== "pgClock") A[k] = v; return A; }
function resident(A) {
  const db = mkSql(), alarms = [];
  const storage = { sql: db.sql, alarm: null, getAlarm: async () => storage.alarm, setAlarm: async (t) => { storage.alarm = t; alarms.push(t); }, deleteAlarm: async () => { storage.alarm = null; } };
  const R = new Resident({ storage, waitUntil: () => {} }, { DB: D1, GATEWAY_HOST: "owner.example.com", APP_HOST: "owner.example.com", MEMORY: "off", GENUI: "off", WORKMEM: "off" });
  R.clock = T0; R.pomoClock = () => R.clock; R.pomoPrefs = async () => ({ offers: "", streak: 0, last_decline: 0, suppressed_until: 0 }); R.pomoGlobalStub = () => A;
  return R;
}
const ctx = (s, text) => ({ kind: "chat", turn: "x", session: s, userText: text });
async function scenario(name, fn) { await fn(); console.log("  ok", name); }

await scenario("global: start, pause, resume, skip, stop; not tied to any task", async () => {
  const A = archive(); assert.equal((await A.pomoGlobalAction({ action: "get" })).pomodoro, null);
  let r = await A.pomoGlobalAction({ action: "start", work_min: 50, break_min: 10 });
  assert.deepEqual([r.pomodoro.timer.phase, r.pomodoro.timer.work_min, r.pomodoro.timer.ends], ["work", 50, T0 + 50 * MIN]); assert.equal(r.pomodoro.timer.now, T0);
  A.clock = T0 + 10 * MIN; r = await A.pomoGlobalAction({ action: "pause" }); assert.equal(r.pomodoro.timer.left, 40 * MIN);
  A.clock += 30 * MIN; r = await A.pomoGlobalAction({ action: "resume" }); assert.equal(r.pomodoro.timer.ends, A.clock + 40 * MIN);
  r = await A.pomoGlobalAction({ action: "skip" }); assert.equal(r.pomodoro.timer.phase, "break");
  r = await A.pomoGlobalAction({ action: "stop" }); assert.equal(r.pomodoro, null);
  assert.match((await A.pomoGlobalAction({ action: "pause" })).error, /no focus timer/); assert.match((await A.pomoGlobalAction({ action: "start", work_min: 999 })).error, /work_min must be/);
  assert.match((await A.pomoGlobalAction({ action: "bogus" })).error, /action must be/);
});
await scenario("global: survives reload, phases advance by the clock, idles out like a task timer", async () => {
  const db = mkSql(), A = archive(db); await A.pomoGlobalAction({ action: "start" });
  const B = archive(db); B.clock = T0 + 26 * MIN; const v = await B.pomoGlobalView(); assert.equal(v.timer.phase, "break"); assert.equal(v.timer.round, 1);   // a fresh object over the same storage
  B.clock = T0 + 31 * MIN; assert.equal((await B.pomoGlobalView()).timer.phase, "ready");
  B.clock = T0 + 31 * MIN + POMO_IDLE_MS; assert.equal(await B.pomoGlobalView(), null);
});
await scenario("global: one at a time. A second start must say replace:true; a finished set needs no replace", async () => {
  const A = archive(); await A.pomoGlobalAction({ action: "start", work_min: 25 });
  let r = await A.pomoGlobalAction({ action: "start", work_min: 45 }); assert.equal(r.code, "running"); assert.match(r.error, /Replace it/); assert.equal(r.pomodoro.timer.work_min, 25, "the running one is untouched");
  r = await A.pomoGlobalAction({ action: "start", work_min: 45, replace: true }); assert.equal(r.pomodoro.timer.work_min, 45); assert.equal(r.pomodoro.timer.done_rounds, 0);
  const one = archive(); await one.pomoGlobalAction({ action: "start", rounds: 1, long_min: 0 }); one.clock = T0 + 25 * MIN; assert.equal((await one.pomoGlobalView()).timer.phase, "done");
  r = await one.pomoGlobalAction({ action: "start" }); assert.ok(!r.error, "a finished set is replaced without asking");
});
await scenario("tool: the schema has scope + replace; start in a task without scope asks; outside a task it is global", async () => {
  const p = POMODORO_TOOL.function.parameters.properties; assert.deepEqual(p.scope.enum, ["task", "global"]); assert.ok(p.replace);
  const A = archive(), R = resident(A), s = (await R.createSession("Taxes")).id;
  const out = await R.localTool("pomodoro", { action: "start", person_asked: "start a pomodoro" }, ctx(s, "start a pomodoro"));
  assert.match(out, /^error: ask the person first: "For this task, or everything \(global\)\?"/); assert.equal(R.pomoView(s), null); assert.equal(await A.pomoGlobalView(), null);
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "nope", person_asked: "start a pomodoro" }, ctx(s, "start a pomodoro")), /scope must be/);
  const g = await R.localTool("pomodoro", { action: "start", person_asked: "start a pomodoro" }, { kind: "chat", turn: "x", userText: "start a pomodoro" });
  assert.match(g, /^Started a GLOBAL focus timer/); assert.equal((await A.pomoGlobalView()).timer.phase, "work");
});
await scenario("tool: scope task keeps today's behavior; scope global starts the global one and leaves the task alone", async () => {
  const A = archive(), R = resident(A), s = (await R.createSession("Taxes")).id, say = "start a 50 minute pomodoro";
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "task", work_min: 50, person_asked: say }, ctx(s, say)), /^Started a focus timer in this task: 50 min work/);
  assert.equal(R.pomoView(s).timer.work_min, 50); assert.equal(await A.pomoGlobalView(), null);
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "global", work_min: 30, person_asked: say }, ctx(s, say)), /^Started a GLOBAL focus timer.*30 min work/);
  assert.equal((await A.pomoGlobalView()).timer.work_min, 30); assert.equal(R.pomoView(s).timer.work_min, 50, "the task timer is untouched");
  // replace needs the person's yes
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "global", person_asked: say }, ctx(s, say)), /already running.*replace true/);
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "global", replace: true, work_min: 20, person_asked: say }, ctx(s, say)), /replaced the one that was running/);
  assert.equal((await A.pomoGlobalView()).timer.work_min, 20);
});
await scenario("tool: pause/resume/stop/status pick the timer that exists, ask when both do, honor scope", async () => {
  const A = archive(), R = resident(A), s = (await R.createSession("Taxes")).id, say = "pause the timer";
  const T = (a) => R.localTool("pomodoro", { person_asked: say, ...a }, ctx(s, say));
  await A.pomoGlobalAction({ action: "start" });
  assert.match(await T({ action: "pause" }), /paused|Global focus timer/); assert.equal((await A.pomoGlobalView()).timer.paused, true, "only a global exists: it is the one paused");
  await R.pomoAction(s, { action: "start" });
  assert.match(await T({ action: "stop" }), /Ask the person which one/); assert.equal(R.pomoView(s).timer.phase, "work");
  assert.match(await T({ action: "stop", scope: "task" }), /^Stopped the focus timer/); assert.equal(R.pomoView(s), null); assert.ok(await A.pomoGlobalView());
  const st = await R.localTool("pomodoro", { action: "status" }, ctx(s, "how long is left"));   // no quote needed
  assert.match(st, /Global focus timer \(not tied to a task\)/);
  assert.match(await T({ action: "stop", scope: "global" }), /^Stopped the global focus timer/); assert.equal(await A.pomoGlobalView(), null);
  assert.match(await R.localTool("pomodoro", { action: "status", scope: "global" }, ctx(s, "x")), /no global focus timer/);
});
await scenario("tool: helpers and runs without the person's words still can't start a global timer", async () => {
  const A = archive(), R = resident(A), s = (await R.createSession("x")).id;
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "global", person_asked: "start a pomodoro" }, { kind: "helper", turn: "h", session: s, userText: "start a pomodoro" }), /isn't available to a helper/);
  assert.match(await R.localTool("pomodoro", { action: "start", scope: "global", person_asked: "start a pomodoro" }, { kind: "chat", turn: "x", session: s, handoff: true, userText: "start a pomodoro" }), /no message from the person/);
  assert.equal(await A.pomoGlobalView(), null);
});
await scenario("wiring: the real Archive and Ledger classes carry the global timer and still carry the deletion mixins", async () => {
  const { Archive, Ledger } = await import("../src/index.js");
  for (const m of ["pomoGlobalAction", "pomoGlobalView", "pgGet"]) assert.equal(typeof Archive.prototype[m], "function", m);
  assert.equal(typeof Ledger.prototype.wipe, "function", "wipeMix(Ledger) still runs"); assert.equal(typeof Archive.prototype.wipeArchive, "function");
});
console.log("pomodoro-global: all ok");
