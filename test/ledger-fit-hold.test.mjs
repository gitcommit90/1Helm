// A model call's hold is capped at what is left (reserve with opts.fit) and charged at its real cost afterwards. Needs: node --import ./test/stubs/register.mjs
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { Ledger } from "../src/index.js";
const mk = () => { const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...a) { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
  return { db, L: new Ledger({ storage: { sql, transactionSync: (f) => f() } }, {}) }; };
const spent = (db, id) => db.prepare("SELECT nano FROM spend WHERE id=?").get(id)?.nano;
// Full hold when the balance is enough: identical to before.
{ const { L, db } = mk(); await L.grant("g", 10e9, "topup");
  assert.deepEqual(await L.reserve("a", 3e9, { fit: true }), { ok: true }); assert.equal(L.totals().reserved_nano, 3e9);
  assert.equal(db.prepare("SELECT capped FROM res WHERE id='a'").get().capped, null);
  await L.settle("a", 5e9); assert.equal(spent(db, "a"), 3e9, "an uncapped hold charges at most what was held"); }
// Capped hold when the balance is between 0 and the hold, and the real cost is charged on settle (balance may go below zero by the overrun).
{ const { L, db } = mk(); await L.grant("g", 1e9, "topup");
  const r = await L.reserve("b", 3e9, { fit: true }); assert.deepEqual(r, { ok: true, nano: 1e9, capped: true });
  assert.equal(L.totals().reserved_nano, 1e9); assert.equal(L.totals().balance_nano, 0);
  assert.equal((await L.reserve("c", 5, { fit: true })).reason, "out_of_credits", "nothing left: refused");
  assert.equal((await L.reserve("c", 5)).reason, "out_of_credits");
  await L.settle("b", 1.4e9); assert.equal(spent(db, "b"), 1.4e9, "a capped hold charges the real cost");
  assert.equal(L.totals().balance_nano, -0.4e9);
  assert.equal((await L.reserve("d", 1e9, { fit: true })).reason, "out_of_credits", "refuses at a balance below zero"); }
// A capped hold settled for less than it held charges the real, smaller cost.
{ const { L, db } = mk(); await L.grant("g", 1e9, "topup"); await L.reserve("e", 3e9, { fit: true }); await L.settle("e", 2e8); assert.equal(spent(db, "e"), 2e8); assert.equal(L.totals().balance_nano, 8e8); }
// Without fit nothing changes.
{ const { L } = mk(); await L.grant("g", 1e9, "topup"); assert.equal((await L.reserve("f", 3e9)).reason, "out_of_credits"); }
// The day cap check uses the amount actually held.
{ const { L } = mk(); await L.grant("g", 20e9, "included"); L.setSpendPreferences(true); await L.setDayCapTest(2e9);
  await L.settle("pre", 0); assert.equal((await L.reserve("h", 3e9)).reason, "day_limit");
  await L.setBalance(1.5e9); const r = await L.reserve("i", 3e9, { fit: true }); assert.deepEqual(r, { ok: true, nano: 1.5e9, capped: true }, "1.5e9 held is under the 2e9 day cap"); }
{ const { L } = mk(); await L.grant("g", 20e9, "included"); L.setSpendPreferences(true); await L.setDayCapTest(1e9); await L.setBalance(1.5e9);
  assert.equal((await L.reserve("j", 3e9, { fit: true })).reason, "day_limit", "1.5e9 held is over the 1e9 day cap"); }
// An unsettled capped hold older than 10 minutes is charged the held amount.
{ const { L, db } = mk(); await L.grant("g", 1e9, "topup"); await L.reserve("k", 3e9, { fit: true });
  db.prepare("UPDATE res SET at=? WHERE id='k'").run(Date.now() - 20 * 60e3); await L.state(); assert.equal(spent(db, "k"), 1e9); assert.equal(L.totals().reserved_nano, 0); }
// An old object whose res table has no capped column gets it, and keeps its open reservations.
{ const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE grants (key TEXT PRIMARY KEY, nano INTEGER NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL); CREATE TABLE res (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL); CREATE TABLE spend (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL);");
  db.prepare("INSERT INTO res VALUES ('old',5,?)").run(Date.now());
  const sql = { exec(q, ...a) { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
  const L = new Ledger({ storage: { sql, transactionSync: (f) => f() } }, {}); await L.settle("old", 9); assert.equal(spent(db, "old"), 5); }
console.log("  ok ledger fit hold");
