// node --import ./test/stubs/register.mjs test/watch-idle.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer } from "../src/channel-computer.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const stmt = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? stmt.all(...args) : (stmt.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
let alarm = null;
const ctx = { storage: { sql, getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; } }, container: { running: true, monitor: () => new Promise(() => {}), destroy: async () => {} }, waitUntil: () => {} };
const make = () => { const c = new ChannelComputer(ctx, {}); c.put("ready", "1"); c.save = async () => ({ ok: true }); c.refundUnused = async () => 0; c.prepayMinute = async () => true; return c; };

// A turn ended long ago, a watch pane is open and just pinged: the idle timeout still stops the computer.
let C = make(); C.viewers = 1; C.put("last_activity", Date.now() - 120e3); C.put("human_at", Date.now());
await C.alarm();
assert.equal(C.get("last_stop"), "idle (browser open, no activity)", "an open watch pane must not keep the computer awake");

// The person has taken control and is active: it stays awake.
db.exec("DELETE FROM kv"); C = make(); C.viewers = 1; C.put("last_activity", Date.now() - 120e3); C.put("human_at", Date.now());
assert.equal((await C.takeControl("me")).ok, true); C.put("last_activity", Date.now() - 120e3);
await C.alarm();
assert.notEqual(C.get("last_stop"), "idle (browser open, no activity)", "Take control keeps it awake");
assert.equal(C.get("ready"), "1");
console.log("ok");
