// node --import ./test/stubs/register.mjs test/approval-decided-at.test.mjs
// A pending approval left over from a turn that ended no longer holds its task on "waiting" once the person can't act on it any more
// (an hour, the card's own expiry); a fresh one still does. Only app facts are judged.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const env = { MEMORY: "off", GENUI: "off", WORKMEM: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: () => { const q = { bind: () => q, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.arm = async () => {};


const sid = R.newSession("Commercial");
const add = (extra = {}) => { sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session,perm,what,cview) VALUES (?,?,?,?,?,?,?,?,?,?,?)", extra.at ?? Date.now() - 20 * 60e3, extra.perm ? "" : "docs.comfy.org", extra.perm ? "PERM" : "GET", "", 0, "[]", "turn1", sid, extra.perm || null, extra.what || null, extra.cview || null); return sql.exec("SELECT id FROM approvals ORDER BY id DESC LIMIT 1").toArray()[0].id; };
const row = (id) => sql.exec("SELECT * FROM approvals WHERE id=?", id).toArray()[0];
const near = (v, before) => typeof v === "number" && v >= before && v <= Date.now();

// a pending approval reports decided_at null
let id = add();
assert.equal(R.approvalView(row(id)).decided_at, null);
assert.ok("decided_at" in R.approvalView(row(id)));
// a stored decision time is sent as a number in ms
assert.equal(R.approvalView({ ...row(id), decided_at: "1700000000000" }).decided_at, 1700000000000);

// site approvals (decideApproval)
for (const [d, status] of [["once", "approved"], ["session", "approved"], ["deny", "denied"]]) {
  id = add(); const t0 = Date.now(); const r = await R.decideApproval(id, d);
  assert.equal(row(id).status, status); assert.ok(near(row(id).decided_at, t0), "site " + d); assert.ok(near(r.approval.decided_at, t0));
}
// permission cards (decidePerm)
for (const d of ["once", "deny"]) { id = add({ perm: "channels", what: "look" }); const t0 = Date.now(); const r = await R.decideApproval(id, d); assert.ok(near(row(id).decided_at, t0), "perm " + d); assert.ok(near(r.approval.decided_at, t0)); }
// confirm cards: confirm, cancel and expiry (decideConfirm)
for (const d of ["confirm", "cancel"]) { id = add({ perm: "confirm", what: "x", at: Date.now() - 60e3 }); const t0 = Date.now(); const r = await R.decideApproval(id, d); assert.ok(near(row(id).decided_at, t0), "confirm " + d); assert.ok(near(r.approval.decided_at, t0)); }
id = add({ perm: "confirm", what: "x", at: Date.now() - 24 * 3600e3 }); { const t0 = Date.now(); await R.decideApproval(id, "confirm"); assert.equal(row(id).status, "expired"); assert.ok(near(row(id).decided_at, t0), "confirm expiry"); }
// every statement in src that settles a pending approval (SSH deny, expiry, cancel included) writes decided_at
import { readFileSync, readdirSync } from "node:fs";
let seen = 0;
for (const f of readdirSync(new URL("../src/", import.meta.url)).filter((x) => x.endsWith(".js"))) {
  for (const m of readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").matchAll(/UPDATE approvals SET status=[^"`]*/g)) {
    if (/status IN \('pending'|status='pending'/.test(m[0]) || /decision=/.test(m[0])) { seen++; assert.match(m[0], /decided_at=/, `${f}: ${m[0]}`); }
  }
}
assert.ok(seen >= 8, "found the settle statements: " + seen);
console.log("approval-decided-at OK");
