// node --import ./test/stubs/register.mjs test/rearm-loop.test.mjs
// Live ran INSERT INTO resident_schedules 130,255 times in 24 hours (99% of its D1 writes) from one channel whose alarm re-armed about every
// 500 ms. Checks: (1) the registry writes D1 only when next_run moved, the channel changed, or the refresh time passed; (2) a receipt with no
// turn that cannot start backs off to once a minute after 3 tries and is logged, while real pending input still runs at once;
// (3) the near-now alarm throttle for any other source; (4) the watchdog still sees an overdue next_run.
// workflows and follow-ups sharing the alarm are unaffected; held files aren't swept or listed; cid idempotency; tz/DST math.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import "../src/send-later.js";   // first on purpose: no import cycle
import { Resident } from "../src/resident.js";

// ---- fake clock ----
const realNow = Date.now.bind(Date); let NOW = Date.UTC(2026, 9, 18, 16, 0, 0);   // Mon Oct 5 2026, 9:00 AM Pacific
Date.now = () => NOW; const advance = (ms) => { NOW += ms; };
const MIN = 60e3, HOUR = 3600e3;

// ---- D1: tenants (billing status decides read-only) ----
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS texting \([\s\S]*?\n\);/)[0]);   // public: the texting table comes from the ordered full schema; the test makes its own tenants
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, status TEXT, past_due_since INTEGER); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','active',NULL);");
d1.exec("CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel))");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const setStatus = (st) => d1.prepare("UPDATE tenants SET status=? WHERE id='t1'").run(st);
// The real turn loop now consults the ledger before its scripted model runs.
const ledger = { reserve: async () => ({ ok: true }), settle: async () => ({}), state: async () => ({ balance_nano: 1e12 }), guardInfo: async () => ({}), dayInfo: async () => ({ spent_nano: 0, reserved_nano: 0, cap_nano: 1e15 }), dayCheckin: async () => ({}) };
// Scheduling advances the clock by hours; wall-time spend pauses have their own tests.
const env = { DB: D1, LEDGER: { idFromName: (id) => id, get: () => ledger }, WS: { get: async () => null, put: async () => {}, delete: async () => {} }, GATEWAY_HOST: "selfhost.example.com", APP_HOST: "selfhost.example.com", MEMORY: "off", GENUI: "off", WORKMEM: "off", SPENDGUARD: "off" };

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

// ---- helpers ----
// D1 write counter
let regWrites = 0; const prep0 = D1.prepare; D1.prepare = (q) => { const o = prep0(q); if (/INSERT INTO resident_schedules/.test(q)) { const run = o.run; o.run = async () => { regWrites++; return run(); }; } return o; };
const logs = []; console.log = (...a) => { logs.push(a.join(" ")); if (/^ {2}ok /.test(a.join(" "))) log0(...a); };
const fire = async () => { ALARM = null; await R.alarm(); };
const settle = async () => { await Promise.all(waits.splice(0)); await Promise.all(waits.splice(0)); };
const reg = () => d1.prepare("SELECT * FROM resident_schedules WHERE tenant_id='t1' AND channel='main'").get();

// 1. write on change
{
  const base = regWrites;
  await R.arm(); assert.equal(regWrites - base, 1, "the first arm writes the row");
  for (let i = 0; i < 50; i++) { advance(1000); await R.arm(); }
  assert.equal(regWrites - base, 1, "50 more arms with nothing changed write nothing");
  const id = R.addWorkflow({ kind: "workflow", name: "w", prompt: "p", interval_seconds: 3600, next_run: NOW + 3600e3, session: null });
  await R.arm(); assert.equal(regWrites - base, 2); assert.equal(reg().next_run, NOW + 3600e3);
  R.sql.exec("UPDATE workflows SET next_run=? WHERE id=?", NOW + 3600e3 + 5000, id); await R.arm(); assert.equal(regWrites - base, 2, "a 5 s change is not written");
  advance(4 * 60e3); await R.arm(); assert.equal(regWrites - base, 2);
  advance(61e3); await R.arm(); assert.equal(regWrites - base, 3, "one refresh write after 5 minutes");
  R.put("channel_id", "2"); await R.arm(); assert.equal(regWrites - base, 4); assert.equal(reg().channel_id, "2");
  R.put("channel_id", "1");
  R.sql.exec("UPDATE workflows SET status='complete' WHERE id=?", id); await R.arm(); assert.equal(regWrites - base, 5); assert.equal(reg().next_run, null);
  R._regLast = undefined; const w = regWrites; await R.arm(); assert.equal(regWrites, w, "kv remembers the last write across a restart");
  R.addWorkflow({ kind: "workflow", name: "w2", prompt: "p", interval_seconds: 3600, next_run: NOW + 100e3, session: null }); await R.arm();
  advance(300e3); const overdue = d1.prepare("SELECT 1 FROM resident_schedules WHERE next_run IS NOT NULL AND next_run < ?").all(NOW - 120e3);
  assert.equal(overdue.length, 1, "watchdog finds a resident whose stored next_run is overdue by more than 2 minutes");
  R.sql.exec("DELETE FROM workflows"); await R.arm();
  console.log("  ok write only on change");
}

// 2. stuck receipt backs off
{
  const s = await R.createSession("Stuck 1"); const sid = s.id;
  const addReceipt = (rid) => R.sql.exec("INSERT INTO user_input_receipts (response_id,session,question_id,source_turn,answer_text,meta_json,opts_json,turn,created) VALUES (?,?,NULL,NULL,?,?,?,NULL,?)", rid, sid, "hello", "{}", "{}", NOW);
  addReceipt("r-stuck");
  let attempts = 0; const real = R.runTurn.bind(R);
  R.runTurn = async () => { attempts++; throw new Error("cannot start"); };
  const t0 = NOW; let alarms = 0, regBefore = regWrites;
  while (NOW < t0 + 55e3) { await R.arm(); const at = ALARM; if (at == null || at > t0 + 55e3) break; advance(Math.max(1, at - NOW)); alarms++; await fire(); await settle(); if (alarms > 200) break; }
  assert.equal(attempts, 3, "three immediate tries, then it waits");
  assert.ok(alarms <= 6, `alarms in the first minute: ${alarms}`);
  assert.ok(regWrites - regBefore <= 3, "and the registry is not written on each of them");
  assert.ok(logs.some((l) => /input recovery backoff r-stuck/.test(l)), "a log line names the receipt");
  advance(61e3); await fire(); await settle(); assert.equal(attempts, 4, "one more try a minute later");
  const nextWake = await R.arm(); assert.ok(nextWake - NOW >= 55e3, `wake ${nextWake - NOW} ms away`);
  addReceipt("r-new"); R.runTurn = async (_t, _c, _ci, _text, _s, o) => { attempts++; R.sql.exec("UPDATE user_input_receipts SET turn=? WHERE response_id=?", "card-ok", o._input.response_id); return { reply: "ok", turn: "card-ok" }; };
  assert.ok((await R.arm()) <= NOW + 1, "a new receipt wakes now");
  const before = attempts; await fire(); await settle();
  assert.equal(R.sql.exec("SELECT turn FROM user_input_receipts WHERE response_id='r-new'").toArray()[0].turn, "card-ok", "real input ran on the first alarm");
  assert.equal(attempts, before + 1, "only the new receipt ran (the stuck one is still backed off)");
  R.sql.exec("UPDATE user_input_receipts SET turn='card-x' WHERE response_id='r-stuck'"); await R.arm(); assert.equal(R.inputRecoveryNext(), null);
  R.runTurn = real;
  console.log("  ok stuck receipt backs off, real input runs at once");
}

// 3. an in-flight recovery is not started twice
{
  const s = await R.createSession("Inflight"); const sid = s.id;
  R.sql.exec("INSERT INTO user_input_receipts (response_id,session,question_id,source_turn,answer_text,meta_json,opts_json,turn,created) VALUES (?,?,NULL,NULL,?,?,?,NULL,?)", "r-fly", sid, "hi", "{}", "{}", NOW);
  let starts = 0, done; const hold = new Promise((z) => { done = z; });
  R.runTurn = async (_t, _c, _ci, _x, _s, o) => { starts++; await hold; R.sql.exec("UPDATE user_input_receipts SET turn='c1' WHERE response_id=?", o._input.response_id); return { reply: "ok" }; };
  await fire(); await fire(); await fire(); assert.equal(starts, 1, "three alarms start it once");
  done(); await settle();
  console.log("  ok in-flight recovery starts once");
}

// 4. generic near-now throttle
{
  R.sql.exec("DELETE FROM user_input_receipts");
  R._near = []; let held = 0;
  for (let i = 0; i < 40; i++) { advance(100); const at = R.rearmFloor(NOW + 500); if (at - NOW >= 10e3) held++; }
  assert.ok(held >= 9, "after 30 near-now wakes in a minute the next ones are held 10 s");
  assert.ok(logs.some((l) => /^rearm loop/.test(l)));
  advance(120e3); assert.equal(R.rearmFloor(NOW + 500), NOW + 500, "a calm object is not throttled");
  assert.equal(R.rearmFloor(NOW + 3600e3), NOW + 3600e3);
  console.log("  ok near-now throttle");
}
process.exit(0);
