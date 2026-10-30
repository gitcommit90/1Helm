// node --import ./test/stubs/register.mjs test/browser-record.test.mjs
// browser_record: tool schema, dispatch to the browser server's record op, the stop-result wording (empty, very short, good, auto stop, restart),
// and that the tool is wired like the other browser tools (tool sets, channel computer op list, browser server op).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Resident, recordingStopText } from "../src/resident.js";
import { WORKER_DENIED } from "../src/ee/orchestrator.js";
import { SEED } from "./helpers/seed-settings.mjs";

const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const s = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? s.all(...args) : (s.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true, WS: { put: async () => {}, get: async () => null, delete: async () => {} } };
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.arm = async () => {};
const ops = []; let reply = { ok: true };
R.computer = () => ({ browser: async (op, body) => { ops.push([op, body]); return reply; } });
const tc = () => ({ kind: "chat", session: "s1", turn: "t1", emit() {}, inTool: 1, extraCharge: 0 });
const ok = (m) => console.log("ok -", m);
const good = { ok: true, name: "demo", path: "/workspace/recordings/demo.mp4", stopped_by: "stop", max_seconds: 180, duration_s: 42.5, bytes: 3145728, frames: 640, fps: 15, width: 1280, height: 800, codec: "h264 yuv420p" };

// 1. Schema: action is required and is start or stop; name is optional; every helper kind gets it (it is in the shared tool sets, not denied anywhere).
{
  const t = Object.fromEntries(R.tools().map((x) => [x.function.name, x.function]));
  const f = t.browser_record; assert.ok(f, "browser_record is offered");
  assert.deepEqual(f.parameters.required, ["action"]); assert.deepEqual(f.parameters.properties.action.enum, ["start", "stop"]); assert.ok(f.parameters.properties.name);
  assert.match(f.description, /share_file/); assert.match(f.description, /empty or very short/); assert.match(f.description, /3 minutes/);
  const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(src, /const COMPUTER_TOOLS = new Set\([^)]*"browser_record"/); assert.match(src, /const BROWSER_TOOLS = new Set\([^)]*"browser_record"/);
  assert.ok(!WORKER_DENIED.has("browser_record"), "a routed worker may record");
  ok("schema and tool sets");
}

// 2. Dispatch: start and stop go to the browser server's record op; bad input never reaches it; errors and an old image are explained.
{
  ops.length = 0; reply = { ok: true, recording: true, will_save_as: "/workspace/recordings/demo.mp4", max_seconds: 180 };
  const a = await R.execComputerToolInner("browser_record", { action: "start", name: "demo" }, tc());
  assert.equal(a.code, 0); assert.deepEqual(ops[0], ["record", { action: "start", name: "demo" }]);
  assert.match(a.out, /\/workspace\/recordings\/demo\.mp4/); assert.match(a.out, /180 s/); assert.match(a.out, /action "stop"/);
  reply = good; const b = await R.execComputerToolInner("browser_record", { action: "STOP" }, tc());
  assert.deepEqual(ops[1], ["record", { action: "stop" }]); assert.equal(b.code, 0); assert.match(b.out, /share_file/);
  const n = ops.length; const bad = await R.execComputerToolInner("browser_record", { action: "pause" }, tc()); assert.equal(bad.code, 2); assert.equal(ops.length, n);
  reply = { ok: false, error: "Already recording (started 3 s ago). Call browser_record stop first." };
  const dup = await R.execComputerToolInner("browser_record", { action: "start" }, tc()); assert.equal(dup.code, 1); assert.match(dup.out, /Already recording/);
  reply = { ok: false, error: "not found" }; const old = await R.execComputerToolInner("browser_record", { action: "start" }, tc());
  assert.equal(old.code, 1); assert.match(old.out, /not available on this computer yet/); assert.match(old.out, /Do not install/);
  ok("dispatch");
}

// 3. Stop wording: a good recording, a very short one, an empty one, an auto stop and a restart are told apart.
{
  const g = recordingStopText(good); assert.equal(g.code, 0);
  assert.match(g.out, /^Recording saved: \/workspace\/recordings\/demo\.mp4 \(42\.5 s, 3\.0 MB, 640 frames, 1280x800 H\.264 mp4\)/); assert.doesNotMatch(g.out, /EMPTY|VERY SHORT/);
  const sh = recordingStopText({ ...good, duration_s: 0.8, frames: 12, bytes: 20000 }); assert.equal(sh.code, 0); assert.match(sh.out, /^The recording is VERY SHORT/); assert.match(sh.out, /do not share it as the finished video/);
  const sh2 = recordingStopText({ ...good, duration_s: 9, frames: 10 }); assert.match(sh2.out, /VERY SHORT/);
  for (const e of [{ path: null, duration_s: 0, bytes: 0, frames: 0, stopped_by: "stop" }, { ...good, frames: 0 }, { ...good, bytes: 0 }, { path: null, error: "no ffmpeg to finish the file", frames: 0, bytes: 0 }]) {
    const r = recordingStopText(e); assert.equal(r.code, 1); assert.match(r.out, /^The recording is EMPTY: no video was saved/); assert.match(r.out, /Do not share it/);
  }
  assert.match(recordingStopText({ ...good, stopped_by: "time limit" }).out, /stopped by itself at the 180 s limit/);
  assert.match(recordingStopText({ ...good, stopped_by: "restart" }).out, /restarted during the recording/);
  assert.match(recordingStopText({ ...good, stopped_by: "recorder error", recorder_error: "X server died" }).out, /recorder stopped early \(X server died\)/);
  assert.match(recordingStopText({ path: null, frames: 0, bytes: 0, stopped_by: "restart" }).out, /EMPTY[\s\S]*restarted/);
  assert.doesNotMatch(JSON.stringify([g, sh]), /—|–/);
  reply = { ...good, path: null, duration_s: 0, bytes: 0, frames: 0 };
  const viaTool = await R.execComputerToolInner("browser_record", { action: "stop" }, tc()); assert.equal(viaTool.code, 1); assert.match(viaTool.out, /EMPTY/);
  ok("stop wording");
}

// 4. Wiring outside resident.js: the channel computer passes the op, and the browser server answers it, ends by itself and can finish after a restart.
{
  assert.match(readFileSync(new URL("../src/channel-computer.js", import.meta.url), "utf8"), /\^\(navigate\|snapshot\|act\|back\|screenshot\|status\|record\|activate\|closetab\)\$/);
  const srv = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  for (const re of [/m\[1\] === "record"/, /x11grab/, /libx264/, /yuv420p/, /"-t", String\(REC_MAX_S\)/, /REC_STATE/, /faststart/, /async function recStop/, /async function recStart/]) assert.match(srv, re, String(re));
  const labels = readFileSync(new URL("../src/tracker.js", import.meta.url), "utf8"); assert.match(labels, /browser_record:/);
  ok("channel computer op list, browser server record op, step labels");
}
console.log("browser-record: all ok");
