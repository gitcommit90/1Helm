import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { UsageLedger } from "../src/index.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(query, ...args) {
  if (!args.length && query.trim().split(";").filter(Boolean).length > 1) { db.exec(query); return { toArray: () => [] }; }
  const statement = db.prepare(query), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(query) ? statement.all(...args) : (statement.run(...args), []);
  return { toArray: () => rows };
} };
const ledger = new UsageLedger({ storage: { sql } }, { SELFHOST_DAILY_CAP_NANO: 1_000 });

assert.equal((await ledger.state()).granted_nano, 0);
assert.deepEqual(await ledger.reserve("first", 700), { ok: true });
assert.equal((await ledger.reserve("second", 400)).reason, "day_limit");
await ledger.settle("first", 500, [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]);
assert.equal((await ledger.state()).spent_nano, 500);
assert.equal((await ledger.reserve("first", 700)).ok, true); // retries cannot double charge
assert.deepEqual(await ledger.reserve("second", 400), { ok: true });
await ledger.settle("second", 400);
assert.equal((await ledger.reserve("third", 101)).reason, "day_limit");
assert.deepEqual((await ledger.history()).map((row) => ({ ...row })), [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]);
