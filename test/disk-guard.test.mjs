// node --import ./test/stubs/register.mjs test/disk-guard.test.mjs
// Worker side of the computer disk guard: the /disk report, the helper note and the person's card, an idle stop that keeps the
// computer when its save fails for lack of space, and a wake that fails on the failed file stopping the computer with the reason.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer, linkFetch } from "../src/channel-computer.js";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const stmt = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? stmt.all(...args) : (stmt.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
let alarm = null, destroyed = [];
const ctx = { id: { toString: () => "id" }, exports: { ComputerLink: () => ({}), Sentinel: () => ({}) }, storage: { sql, getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; } },
  container: { running: true, monitor: () => new Promise(() => {}), destroy: async (r) => { destroyed.push(r); ctx.container.running = false; }, start() {}, interceptOutboundHttp: async () => {}, interceptOutboundHttps: async () => {}, interceptAllOutboundHttp: async () => {} }, waitUntil: () => {} };
const make = () => { destroyed = []; ctx.container.running = true; alarm = null; const c = new ChannelComputer(ctx, {}); db.exec("DELETE FROM kv"); c.put("ready", "1"); c.refundUnused = async () => 0; c.prepayMinute = async () => true; return c; };
const rep = (level, used, extra = {}) => ({ used, total: 15.4e9, free: 15.4e9 - used, level, cleared: 0, ...extra });

// The container link's /disk path hands the posted JSON to the object.
let got = null; const stub = { diskReport: async (r) => { got = r; return { ok: true }; } };
const env = { CHANNEL_COMPUTER: { idFromString: (x) => x, get: () => stub } };
const res = await linkFetch(env, "id", new Request("http://computer.internal/disk", { method: "POST", body: JSON.stringify(rep("low", 13.5e9)) }));
assert.equal(res.status, 200); assert.equal(got.level, "low");
assert.equal((await linkFetch(env, "id", new Request("http://computer.internal/disk"))).status, 405);

// A report is stored and shown by status(); a level change queues one card and one helper note, then neither repeats.
let C = make();
await C.diskReport(rep("ok", 5e9));
assert.deepEqual(C.diskNotes(), {}, "no note while ok");
await C.diskReport(rep("low", 14e9, { cleared: 5e8 }));
const st = await C.status(); assert.equal(st.disk.level, "low"); assert.equal(st.disk.used, 14e9);
let n = C.diskNotes();
assert.match(n.disk_note, /91 percent full \(14\.0 of 15\.4 GB\)\. Caches were cleared automatically\./);
assert.equal(n.disk_card, "This channel's computer disk is almost full (14.0 of 15.4 GB). 1Helm cleared its caches. Delete files you no longer need or move them to the Library.");
assert.deepEqual(C.diskNotes(), {}, "the note comes at most once every 10 minutes and the card once per level change");
await C.diskReport(rep("low", 14e9)); assert.equal(C.diskNotes().disk_card, undefined, "the same level again makes no card");
C.put("disk_told", Date.now() - 11 * 60e3); assert.ok(C.diskNotes().disk_note, "the note is due again after 10 minutes");
await C.diskReport(rep("full", 15.3e9));
assert.match(C.diskNotes().disk_card, /^This channel's computer disk is full, so new work can't be saved\. The computer stays on until space is freed\./);
await C.diskReport(rep("full", 15.3e9)); await C.diskReport(rep("ok", 6e9)); assert.deepEqual(C.diskNotes(), {}, "back to ok: nothing");

// A change to low with unsaved changes asks for a save now through the alarm; without unsaved changes it does not.
C = make(); C.put("dirty", "1"); C.put("save_due", Date.now() + 60e3); await C.diskReport(rep("low", 14e9));
assert.ok(Number(C.get("save_due")) <= Date.now() && alarm !== null, "save requested"); 
C = make(); C.put("save_due", 5); await C.diskReport(rep("low", 14e9)); assert.equal(C.get("save_due"), "5", "nothing unsaved, no save");

// An idle stop whose save fails for lack of disk keeps the computer up and does not retry until the hold ends.
C = make(); C.put("last_activity", Date.now() - 3600e3);
let saves = 0, outcome = { ok: false, disk_full: true, error: "No space left on device" }; C.save = async () => { saves++; return outcome; };
let r = await C.stop("idle");
assert.equal(r.held, true); assert.equal(r.stopped, false); assert.equal(destroyed.length, 0); assert.equal(C.get("ready"), "1"); assert.equal(C.get("stopping"), "0");
await C.alarm(); assert.equal(saves, 1, "the alarm does not stop it again during the hold"); assert.equal(destroyed.length, 0);
C.put("disk_hold_until", Date.now() - 1); outcome = { ok: true, kind: "delta" }; await C.alarm();
assert.equal(saves, 2); assert.equal(destroyed.length, 1, "after the hold, a save that works lets it sleep");

// Other stops keep their behavior: a stop whose save failed leaves the container running (a failed save never loses files), for a person's sleep and a balance stop too.
for (const why of ["user requested sleep", "out of credits"]) {
  C = make(); C.save = async () => ({ ok: false, disk_full: true }); const before = destroyed.length; r = await C.stop(why, { cancellable: false });
  assert.equal(r.stopped, false, why); assert.equal(destroyed.length, before, why);
}

// A wake that fails on the failed file stops the computer (it would stay up with ready=0) and the error carries the reason.
C = make(); ctx.container.running = false; C.put("gap_override", "0");
const reason = "the saved files of this channel (15.1 GB) no longer fit on the computer's disk";
C.sh = async (cmd) => cmd.startsWith("true") ? { code: 0, out: "" } : cmd.includes("/var/1hc/ready") ? { code: 0, out: reason + "\nFAILED\n" } : { code: 0, out: "" };
C.save = async () => ({ ok: true, skipped: true });
let stops = []; const realStop = C.stop.bind(C); C.stop = async (why, o) => { stops.push(why); return realStop(why, o); };
await assert.rejects(C.ensureRunning(), (e) => { assert.equal(e.message, "workspace mount failed: " + reason); return true; });
assert.deepEqual(stops, ["workspace mount failed"]); assert.equal(C.get("ready"), "0");
console.log("disk-guard ok");
