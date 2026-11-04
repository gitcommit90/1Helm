// node --import ./test/stubs/register.mjs test/stale-approvals.test.mjs
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
const view = () => R.sessionView(R.session(sid));
const add = (at, extra = {}) => sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session,perm,what) VALUES (?,?,?,?,?,?,?,?,?,?)", at, extra.perm ? "" : "docs.comfy.org", extra.perm ? "PERM" : "GET", "", 0, "[]", "turn1", sid, extra.perm || null, extra.what || null);

assert.equal(view().state, "ready");
// a fresh request still holds the task
add(Date.now() - 60e3);
assert.equal(view().state, "waiting"); assert.equal(view().waiting, "approval");
// a request from a turn that ended hours ago does not, 
sql.exec("DELETE FROM approvals");
add(Date.now() - 20 * 3600e3); add(Date.now() - 20 * 3600e3, { perm: "channels", what: "look" });
assert.equal(view().state, "ready"); assert.equal(view().waiting, null);
// the list path (listSessions) agrees
sql.exec("DELETE FROM approvals"); add(Date.now() - 20 * 3600e3);
assert.equal((await R.listSessions()).find((x) => x.id === sid).state, "ready");
// a fresh approval (what a turn paused on a held request leaves) still holds the task in the list
sql.exec("DELETE FROM approvals"); add(Date.now() - 1000);
assert.equal((await R.listSessions()).find((x) => x.id === sid).waiting, "approval");
console.log("stale-approvals OK");
