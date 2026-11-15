// The Ledger kept its balance by adding up every spend row on each reserve, settle and state call, so reads grew with the account's history
// (billions of Durable Object rows read a month). The sums now live in the tot table, kept by triggers. Needs: node --import ./test/stubs/register.mjs
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import { Ledger } from "../src/index.js";
const log = [];
const mk = (db) => ({ exec: (q, ...a) => { log.push(q); if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });
const brute = (db) => { const n = (q) => Number(db.prepare(q).get().n);
  return { granted: n("SELECT COALESCE(SUM(nano),0) n FROM grants"), included: n("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind='included'"), spent: n("SELECT COALESCE(SUM(nano),0) n FROM spend"), reserved: n("SELECT COALESCE(SUM(nano),0) n FROM res"),
    included_all: n("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind IN ('included','included_expire')") }; };
const db = new DatabaseSync(":memory:");
// An existing object: the old tables with history in them and no tot table yet.
db.exec(`CREATE TABLE grants (key TEXT PRIMARY KEY, nano INTEGER NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE res (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL); CREATE TABLE spend (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL);`);
const T0 = Date.now() - 20 * 86400e3;
db.prepare("INSERT INTO grants VALUES ('plan1',20000000000,'included',?)").run(T0); db.prepare("INSERT INTO grants VALUES ('top1',5000000000,'topup',?)").run(T0 + 1);
db.exec("BEGIN"); for (let i = 0; i < 2000; i++) db.prepare("INSERT INTO spend VALUES (?,?,?)").run("old" + i, 1000 + i, T0 + i * 800000); db.exec("COMMIT");
db.prepare("INSERT INTO res (id,nano,at) VALUES ('open1',777,?)").run(Date.now());
const L = new Ledger({ storage: { sql: mk(db), transactionSync: (f) => f() } }, {});
const same = (why) => { const t = L.tot("granted", "included", "included_all", "spent", "reserved"), b = brute(db); assert.deepEqual(t, { granted: b.granted, included: b.included, included_all: b.included_all, spent: b.spent, reserved: b.reserved }, why); };
same("migration filled the sums from the existing rows");
// Every write path keeps the sums.
await L.grant("g2", 3e9, "topup"); same("grant"); await L.grant("g2", 3e9, "topup"); same("duplicate grant ignored");
assert.equal((await L.reserve("r1", 1e6)).ok, true); same("reserve"); await L.settle("r1", 400000, [{ role: "user", content: "x" }]); same("settle");
db.prepare("INSERT INTO res (id,nano,at) VALUES ('stale',900,?)").run(Date.now() - 20 * 60e3); await L.reserve("r2", 5); same("expire moved a stale reservation to spend");
await L.settle("r2", 0); same("settle zero"); await L.grantIncluded("plan2", 20e9); same("grantIncluded (expires the unused plan usage)");
await L.setBalance(1e9); same("setBalance"); await L.setBalance(9e9); same("setBalance up");
db.prepare("DELETE FROM spend WHERE id='old5'").run(); db.prepare("UPDATE spend SET nano=nano+1 WHERE id='old6'").run(); db.prepare("UPDATE grants SET nano=nano+7 WHERE key='top1'").run(); same("direct delete and update");
const t = L.totals(), b = brute(db); assert.equal(t.balance_nano, b.granted - b.spent - b.reserved);
// The usage meter's period sum equals the brute sum and follows new spend.
const gi = L.guardInfo(), start = L.guardPeriod(); assert.ok(start > 0);
const per = () => Number(db.prepare("SELECT COALESCE(SUM(nano),0) n FROM spend WHERE at>=?").get(start).n);
assert.equal(gi.period_spent_nano, per()); await L.reserve("r3", 10); await L.settle("r3", 10); assert.equal(L.guardInfo().period_spent_nano, per(), "period sum follows spend");
// Reads no longer add up history: no statement run by the hot paths is an unbounded SUM over spend or grants beyond the day and period ranges.
log.length = 0; await L.reserve("r4", 5); await L.settle("r4", 5); await L.state(); L.guardInfo();
const bad = log.filter((q) => /SUM\(nano\)/.test(q) && /FROM spend\b/.test(q) && !/WHERE at>=\?/.test(q));
assert.deepEqual(bad, [], "no whole-table SUM over spend");
const p = db.prepare("EXPLAIN QUERY PLAN SELECT COALESCE(SUM(nano),0) n FROM spend WHERE at>=? AND id NOT LIKE 'test-adjust:%'").all(1).map((r) => r.detail).join("|");
assert.ok(/spend_at/.test(p), p);
console.log("  ok do-rows ledger running totals");
