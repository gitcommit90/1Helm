// node --import ./test/stubs/register.mjs test/run-limits.test.mjs
// No-progress limit (idle_max_minutes) for every turn and workflow run (with the spending switch off), schedule_workflow until/for_hours, the alarm not awaiting a workflow run,
// and an interrupted helper with no saved turn being marked handed so helperNextWake stops answering "now".
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { helperNextWake } from "../src/helpers.js";

// ---- fake clock ----
const realNow = Date.now.bind(Date); let NOW = Date.UTC(2026, 9, 18, 16, 0, 0);   // Mon Oct 5 2026, 9:00 AM Pacific
Date.now = () => NOW; const advance = (ms) => { NOW += ms; };
const MIN = 60e3, HOUR = 3600e3;

// ---- D1: tenants (billing status decides read-only) ----
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS texting \([\s\S]*?\n\);/)[0]);
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, status TEXT, past_due_since INTEGER); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','active',NULL);");
d1.exec("CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel))");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const setStatus = (st) => d1.prepare("UPDATE tenants SET status=? WHERE id='t1'").run(st);
// The real turn loop now consults the ledger before its scripted model runs.
const ledger = { reserve: async () => ({ ok: true }), settle: async () => ({}), state: async () => ({ balance_nano: 1e12 }), guardInfo: async () => ({}), dayInfo: async () => ({ spent_nano: 0, reserved_nano: 0, cap_nano: 1e15 }), dayCheckin: async () => ({}) };
// Scheduling advances the clock by hours; wall-time spend pauses have their own tests.
const env = { DB: D1, LEDGER: { idFromName: (id) => id, get: () => ledger }, WS: { get: async () => null, put: async () => {}, delete: async () => {} }, GATEWAY_HOST: "gateway.example.test", APP_HOST: "app.example.test", MEMORY: "off", GENUI: "off", WORKMEM: "off", SPENDGUARD: "off" };

// ---- the Resident on node:sqlite, alarm recorded ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
let ALARM = null;
const waits = []; const ctx = { storage: { sql, getAlarm: async () => ALARM, setAlarm: async (t) => { ALARM = t; }, deleteAlarm: async () => { ALARM = null; } }, waitUntil: (p) => waits.push(p) };
const R = new Resident(ctx, env);
R.laterTimer = () => {};   // the in-memory timer is real-time; the fake clock drives the alarm here (the timer has its own check below)
let script = [], calls = [];
R.systemPrompt = async () => "SYSTEM";
R.callModel = async function (messages, _w, onText, noTools, tc) {
  if (noTools && String(messages.at(-1)?.content).startsWith("(Turn finished")) return { content: "- notes", calls: [], inTok: 1, cached: 0, outTok: 1, charge: 0, finish: "stop" };
  calls.push({ messages: JSON.parse(JSON.stringify(messages)), kind: tc?.kind, session: tc?.session });
  let s = script.shift() ?? "Done.";
  while (s && s.wait) { await s.wait; s = s.then; }
  onText?.(s); return { content: s, calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" };
};
await R.bind("t1", "main", "1", "America/Los_Angeles");
const log0 = console.log; console.log = (...a) => { if (process.env.VERBOSE || /^ {2}ok /.test(a.join(" "))) log0(...a); };

const settle = async () => { await Promise.all(waits.splice(0)); await Promise.all(waits.splice(0)); };
// The 20 s turn interval is captured so the idle check can be driven by hand with the fake clock.
const beats = []; const si0 = globalThis.setInterval; globalThis.setInterval = (fn, ms, ...a) => { if (ms === 20e3) { const t = { fn }; beats.push(t); return t; } return si0(fn, ms, ...a); };
const ci0 = globalThis.clearInterval; globalThis.clearInterval = (t) => { const i = beats.indexOf(t); if (i >= 0) beats.splice(i, 1); else ci0(t); };
env.MODEL_SETTINGS = { limits: { idle_max_minutes: 20 } };
let release = () => {};
const hang = () => { script = [{ wait: new Promise((z) => { release = z; }) }]; };   // a call that never returns until the test lets it go
R.computer = () => ({ touch: async () => {} });
const beat = () => beats.forEach((t) => t.fn());
const tick = (ms) => { advance(ms); beat(); };   // time passes, the turn's 20 s check runs
const tcs = () => [...R.active.values()];
const start = async (f) => { f(); await settle(); for (let i = 0; i < 100 && !tcs().length; i++) await new Promise((r) => st0(r, 20)); };
const st0 = globalThis.setTimeout;

// 1. a chat turn with a call hung for 25 minutes is soft stopped at 20 and hard stopped at 22
{
  hang(); await start(() => R.runTurn("t1", "main", "1", "hello", null, { session: null }).catch(() => {}));
  const tc = tcs()[0]; assert.ok(tc, "the turn runs"); tc.touch = true;
  tick(19 * MIN); assert.ok(!tc.abort, "not yet at 19 minutes");
  tick(MIN); assert.equal(tc.abort, "soft"); assert.equal(tc.limitWhy, "time");
  tick(MIN); assert.equal(tc.abort, "soft", "not hard at 21 minutes");
  tick(MIN + 20e3); assert.equal(tc.abort, "hard"); assert.equal(tc.touch, false);
  release(); await settle(); await new Promise((r) => st0(r, 200)); console.log("  ok chat idle limit");
}
// 2. a turn that finishes a step every minute for 5 hours is never stopped
{
  R.active.clear(); beats.length = 0; hang(); await start(() => R.runTurn("t1", "main", "1", "long", null, { session: null }).catch(() => {}));
  const tc = tcs()[0];
  for (let i = 0; i < 300; i++) { tick(MIN); R.journalStep(tc, { step: i, phase: "model", stats: {}, said: [], saidMeta: [] }); }
  assert.ok(!tc.abort, "5 hours of steps: never stopped");
  tick(20 * MIN); assert.equal(tc.abort, "soft", "stops 20 minutes after its last step");
  release(); await settle(); await new Promise((r) => st0(r, 200));
  console.log("  ok long turn runs on");
}
// 2b. tool calls: the clock restarts at every tool result, and a call inside its own cap (command_max_minutes, 15) is never counted as idle
let cmdN = 0;
const runTool = async (gate) => { R.execComputerToolInner = () => gate; const done = R.execComputerToolRaw("run_command", { command: `work ${++cmdN}` }, tcs()[0]); await new Promise((r) => st0(r, 20)); return done; };   // the call starts after a few async gates
const gateOf = () => { let open; const p = new Promise((z) => { open = () => z({ code: 0, out: "ok" }); }); return { p, open }; };
{
  R.active.clear(); beats.length = 0; hang(); await start(() => R.runTurn("t1", "main", "1", "tools", null, { session: null }).catch(() => {}));
  const tc = tcs()[0];
  for (let i = 0; i < 3; i++) { const g = gateOf(), done = runTool(g.p); await new Promise((r) => st0(r, 30)); for (let m = 0; m < 8; m++) tick(MIN); assert.ok(!tc.abort, `command ${i + 1} of 8 minutes`); g.open(); await done; }
  assert.ok(!tc.abort, "3 commands of 8 minutes in one step are never stopped");
  { const g = gateOf(), done = runTool(g.p); await new Promise((r) => st0(r, 30)); for (let m = 0; m < 15; m++) tick(MIN); g.open(); await done; }
  for (let m = 0; m < 6; m++) tick(MIN);   // then a slow 6 minute model call
  assert.ok(!tc.abort, "a 15 minute command and a 6 minute model call are never stopped");
  { const g = gateOf(); runTool(g.p); await new Promise((r) => st0(r, 30)); for (let m = 0; m < 34; m++) tick(MIN); assert.ok(!tc.abort, "15 minute cap plus 19 minutes");
    for (let m = 0; m < 2; m++) tick(MIN); assert.equal(tc.abort, "soft", "a call hung past its cap plus 20 minutes is stopped"); }
  release(); await settle(); await new Promise((r) => st0(r, 200)); console.log("  ok tool calls");
}
// 3. limit 0 turns it off
{
  R.active.clear(); beats.length = 0; env.MODEL_SETTINGS = { limits: { idle_max_minutes: 0 } };
  hang(); await start(() => R.runTurn("t1", "main", "1", "off", null, { session: null }).catch(() => {}));
  const tc = tcs()[0]; tick(10 * HOUR); assert.ok(!tc.abort, "no limit"); release(); await settle(); await new Promise((r) => st0(r, 200));
  env.MODEL_SETTINGS = { limits: { idle_max_minutes: 20 } };
  console.log("  ok limit 0");
}
// 4. a workflow run uses the same limit and, once stuck, releases its lease
{
  R.active.clear(); beats.length = 0;
  const id = R.addWorkflow({ kind: "workflow", name: "guard", prompt: "p", interval_seconds: 1800, next_run: NOW, session: null });
  hang(); R.runWorkflow(R.wf(id)).catch(() => {}); await new Promise((r) => st0(r, 50));
  assert.ok(R.wf(id).lease_until > NOW, "the run holds its lease");
  tick(20 * MIN); assert.equal(tcs()[0].abort, "soft");
  tick(2 * MIN + 20e3);
  assert.equal(R.wf(id).lease_until, 0, "the stuck run gave the lease back");
  console.log("  ok workflow idle limit");
}
// 5. the alarm returns while a workflow run is still going
{
  R.active.clear(); R.sql.exec("DELETE FROM workflows; DELETE FROM turn_runs");
  const id = R.addWorkflow({ kind: "workflow", name: "slow", prompt: "p", interval_seconds: 1800, next_run: NOW - 1, session: null });
  hang(); ALARM = null;
  const done = await Promise.race([R.alarm().then(() => true), new Promise((r) => st0(() => r(false), 1000))]);
  assert.ok(done, "alarm() returned with the run still going"); assert.ok(R.wf(id).lease_until > NOW);
  console.log("  ok alarm does not wait");
}
// 6. until / for_hours: the tool stores the end time, and no run is scheduled after it
{
  R.sql.exec("DELETE FROM workflows");
  const out = await R.localToolInner("schedule_workflow", { name: "g", prompt: "check google", interval_seconds: 1800, for_hours: 1 }, {});
  assert.match(out, /scheduled/); const w = R.sql.exec("SELECT * FROM workflows").toArray()[0];
  assert.equal(w.until_at, NOW + 3600e3);
  R.sql.exec("UPDATE workflows SET until_at=? WHERE id=?", NOW + 10 * 60e3, w.id);
  script = ["Done."]; await R.runWorkflow(R.wf(w.id), { force: true });
  assert.equal(R.wf(w.id).status, "complete", "the last run before the end time completes the workflow");
  console.log("  ok until");
}
// 7. an interrupted helper with no saved turn is handed once, so the alarm stops waking for it
{
  const now = Date.now();
  R.sql.exec("INSERT INTO helpers (session,name,task,status,started,deadline,ended,handed) VALUES ('s','h','t','interrupted',?,?,?,0)", now - 60e3, now, now);
  const h = R.sql.exec("SELECT * FROM helpers").toArray()[0];
  assert.equal(helperNextWake(R.sql, Date.now()), Date.now(), "due before");
  await R.orchestrationFinish(h);
  assert.equal(R.sql.exec("SELECT handed FROM helpers WHERE id=?", h.id).one().handed, 1);
  assert.notEqual(helperNextWake(R.sql, Date.now()), Date.now(), "no longer due");
  console.log("  ok interrupted helper");
}
process.exit(0);
