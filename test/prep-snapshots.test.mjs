import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PrepContainer, ready, TEMPLATE_SETUP } from "../src/prep-container.js";
import { prepJobAlarm, prepJobOn, prepIdlePolicy, PREP_IDLE_POLICIES, PREP_MARK, PREP_SETUP, PREP_STANDARD_NANO_PER_SEC, JOB_NANO_PER_SEC, prepSnapshotsOn } from "../src/sidecar.js";
import { templateVersion, templateUsable, claimSlotIn, releaseSlotIn, startFromTemplate, buildTemplate, withCurlRetry, ENTRYPOINT } from "../src/job-template.js";

const encoder = new TextEncoder();
function make() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query, ...args) { const statement = db.prepare(query); return { toArray: () => statement.all(...args) }; } };
  // SQLite statements must execute even when no rows are read.
  sql.exec = (query, ...args) => { const statement = db.prepare(query); let rows; try { rows = statement.all(...args); } catch { statement.run(...args); rows = []; } return { toArray: () => rows }; };
  let running = false; const starts = [], execs = [], pending = []; let snapshots = 0, rejectRestore = false;
  const container = {
    images: { base: "registry/base@sha256:abc" },
    get running() { return running; },
    start(options) { starts.push(options); if (rejectRestore && options.containerSnapshot) throw new Error("expired"); running = true; },
    async destroy() { running = false; },
    monitor() { return new Promise(() => {}); },
    async exec(command, options) { execs.push({ command, options }); return { output: async () => ({ exitCode: 0, stdout: encoder.encode("") }), kill() {} }; },
    async snapshotContainer() { snapshots++; return { id: `snapshot-${snapshots}`, size: 1000 }; },
  };
  const ctx = { id: { toString: () => "object-1" }, container, storage: { sql, async setAlarm() {} }, waitUntil(p) { pending.push(p); } };
  const env = { ENV_NAME: "dev", PREP_SNAPSHOTS: "on" };
  const instance = new PrepContainer(ctx, env);
  const objects = new Map([["dependencies:coordinator", instance]]);
  env.PREP_CONTAINER = { idFromName: n => n, get: n => objects.get(n) };
  return { instance, ctx, env, starts, execs, pending, objects, snapshots: () => snapshots, rejectRestore: () => { rejectRestore = true; } };
}
const b = make();
const [first, second] = await Promise.all([b.instance.dependencySnapshot(), b.instance.dependencySnapshot()]);
assert.equal(first.handle.id, second.handle.id); assert.equal(b.snapshots(), 1); assert.equal(b.ctx.container.running, false);
assert.equal(b.execs.filter(x => x.command[2] === TEMPLATE_SETUP).length, 2);
assert.ok(b.execs.every(x => !x.options?.stdin));
assert.equal(b.execs.find(x => x.command[2]?.includes("import indra_ocr"))?.options.env.HF_HUB_OFFLINE, "1");
await assert.rejects(b.instance.prepJob({}), /cannot process files/);
const c = make(); c.objects.set("dependencies:coordinator", b.instance);
const restored = await c.instance.prepStart(); assert.equal(restored.source, "snapshot");
assert.equal(c.starts[0].containerSnapshot.id, first.handle.id); assert.equal(c.starts[0].image, undefined);
const warm = await c.instance.prepStart(); assert.equal(warm.warm, true); assert.equal(warm.snapshot_id, first.handle.id);
await c.instance.prepBenchmarkReset(); c.rejectRestore();
const fallback = await c.instance.prepStart(); assert.equal(fallback.source, "fresh_fallback"); assert.equal(fallback.fallback, "restore_failed");
await Promise.all(c.pending);
assert.equal(await b.instance.peekDependencySnapshot(), null);
b.ctx.container.images.base = "registry/base@sha256:changed";
const changed = await b.instance.dependencySnapshot(); assert.notEqual(changed.version, first.version); assert.equal(b.snapshots(), 2);
for (const n of ["slot-2", "slot-3", "slot-4", "slot-5"]) assert.equal(await b.instance.claimSlot(n), true, "no executor cap");
await b.instance.releaseSlot("slot-2"); assert.equal(await b.instance.claimSlot("slot-6"), true);
let destroyed = false, alarm;
await prepJobAlarm({ _prepActive: true, ctx: { container: { running: true, destroy() { destroyed = true; } }, storage: { async setAlarm(value) { alarm = value; } } } });
assert.equal(destroyed, false); assert.ok(alarm > Date.now());
await assert.rejects(ready({ exec: async () => new Promise(() => {}) }, 10), /didn't start/);
assert.equal(JOB_NANO_PER_SEC, 8948); assert.equal(PREP_STANDARD_NANO_PER_SEC, 23644);
assert.equal(prepSnapshotsOn({ ENV_NAME: "live", PREP_CONTAINER: {} }), true, "on by default wherever the binding exists");
assert.equal(prepSnapshotsOn({ ENV_NAME: "dev", PREP_CONTAINER: {} }), true);
assert.equal(prepSnapshotsOn({ PREP_CONTAINER: {}, PREP_SNAPSHOTS: "off" }), false, "kill switch");
assert.equal(prepSnapshotsOn({ ENV_NAME: "dev", PREP_SNAPSHOTS: "on" }), false, "no binding: Computer path");
assert.equal(prepSnapshotsOn({}), false);
console.log("Snapshot isolation, deduplication, restoration, failure recovery, version changes, capacity, idle protection, bounded readiness and rates passed.");

const reset = make();
reset.instance.prepStart = async () => ({ source: "control", warm: true });
reset.env.WS = { get: async () => ({ body: new Blob(["synthetic"]).stream() }) };
const resetError = new Error("Durable Object reset because its code was updated.");
const oldExec = reset.ctx.container.exec;
reset.ctx.container.exec = async (...args) => { if (args[0][0] === "node") throw resetError; return oldExec(...args); };
await assert.rejects(reset.instance.prepJob({ r2key: "t/prepbench-reset/files/test.pdf", ext: "pdf", op: "md" }), error => error === resetError);

// ---- extracted module (src/job-template.js) ----
const kvStore = () => { const m = new Map(); return { get: k => m.get(k), put: (k, v) => m.set(k, String(v)) }; };
assert.equal(await templateVersion("img", "setup"), await (async () => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode("img\nsetup")))].map(x => x.toString(16).padStart(2, "0")).join(""))());
assert.notEqual(await templateVersion("img", "setup", "md-only"), await templateVersion("img", "setup"));
assert.equal(withCurlRetry("curl -fsSL x"), "curl --retry 3 --retry-delay 2 --retry-max-time 30 -fsSL x");
assert.equal(templateUsable({ version: "v", handle: { id: "h" }, created: 1000 }, "v", { now: 2000 }), true);
assert.equal(templateUsable({ version: "v", handle: { id: "h" }, created: 1000 }, "w", { now: 2000 }), false);
assert.equal(templateUsable({ version: "v", handle: { id: "h" }, created: 1000 }, "v", { now: 2000, invalidate: "h" }), false);
assert.equal(templateUsable({ version: "v", handle: { id: "h" }, created: 0 }, "v", { now: 30 * 86400000 }), false);
const store = kvStore();
assert.equal(claimSlotIn(store, "a", { max: 2 }), true); assert.equal(claimSlotIn(store, "b", { max: 2 }), true); assert.equal(claimSlotIn(store, "c", { max: 2 }), false);
releaseSlotIn(store, "a"); assert.equal(claimSlotIn(store, "c", { max: 2 }), true);
assert.equal(claimSlotIn(store, "d", { max: 2, now: Date.now() + 11 * 60000 }), true, "expired leases are dropped");
{ // buildTemplate always destroys, never passes input bytes, and runs the caller's steps only
  const log = []; let running = false;
  const container = { images: { base: "img" }, get running() { return running; }, start(o) { running = true; log.push(["start", o]); }, async destroy() { running = false; log.push(["destroy"]); }, monitor: () => new Promise(() => {}),
    async exec(cmd, o) { log.push(["exec", cmd, o]); return { output: async () => ({ exitCode: cmd[2] === "bad" ? 1 : 0 }), kill() {} }; }, async snapshotContainer(o) { log.push(["snap", o]); return { id: "s1", size: 5 }; } };
  const saved = await buildTemplate(container, { version: "v", name: "n", steps: [{ script: "ok", args: ["md"] }], verify: { command: "true" } });
  assert.equal(saved.handle.id, "s1"); assert.equal(running, false);
  assert.ok(log.some(l => l[0] === "exec" && l[1][2] === "rm -rf /root/.npm /root/.cache /tmp/*")); assert.ok(log.every(l => l[0] !== "exec" || !l[2]?.stdin));
  assert.ok(log.findIndex(l => l[0] === "exec" && l[1][2] === "rm -rf /root/.npm /root/.cache /tmp/*") < log.findIndex(l => l[0] === "snap"), "caches removed before capture");
  assert.deepEqual(log.find(l => l[0] === "start")[1].entrypoint, ENTRYPOINT);
  await assert.rejects(buildTemplate(container, { version: "v", name: "n", steps: [{ script: "bad" }] }), /setup failed/); assert.equal(running, false);
  const failed = []; let rejects = true;
  const c2 = { ...container, get running() { return running; }, start(o) { if (rejects && o.containerSnapshot) throw new Error("expired"); running = true; } };
  const out = await startFromTemplate(c2, { template: saved, version: "v", onRestoreFailed: id => failed.push(id) });
  assert.equal(out.source, "fresh_fallback"); assert.equal(out.fallback, "restore_failed"); assert.deepEqual(failed, ["s1"]);
  rejects = false; await c2.destroy(); const ok = await startFromTemplate(c2, { template: saved, version: "v" }); assert.equal(ok.source, "snapshot"); assert.ok(ok.ready_at >= ok.start_called_at);
  await c2.destroy(); assert.equal((await startFromTemplate(c2, { template: saved, version: "v", control: true })).source, "control");
}
// ---- md-only variant ----
{
  const m = make(); const full = await m.instance.dependencySnapshot(); const md = await m.instance.dependencySnapshotFor("md");
  assert.notEqual(full.version, md.version); assert.notEqual(full.handle.id, md.handle.id);
  const mdOps = m.execs.filter(x => x.command[2] === TEMPLATE_SETUP).map(x => x.command[4]); assert.deepEqual(mdOps, ["md", "ocr", "md"]);
  assert.equal((await m.instance.peekDependencySnapshotFor("md")).handle.id, md.handle.id); assert.equal((await m.instance.peekDependencySnapshot()).handle.id, full.handle.id);
  assert.equal(await m.instance.version(), full.version);
}
// ---- idle policies ----
const jobEnv = (extra = {}) => ({ WS: { get: async () => ({ body: new Blob(["synthetic"]).stream() }) }, ...extra });
function jobObject(env = {}, { owner = null } = {}) {
  const m = make(); Object.assign(m.env, jobEnv(env)); m.env.TEST_MODE = "1";
  const alarms = []; m.ctx.storage.setAlarm = async t => { alarms.push(t); };
  let destroys = 0, running = false; const startRun = m.ctx.container.start.bind(m.ctx.container);
  Object.defineProperty(m.ctx.container, "running", { get: () => running, configurable: true });
  m.ctx.container.start = o => { startRun(o); running = true; };
  m.ctx.container.destroy = async () => { running = false; destroys++; };
  const origExec = m.ctx.container.exec.bind(m.ctx.container);
  m.ctx.container.exec = async (cmd, o) => cmd[0] === "node" ? { output: async () => ({ exitCode: 0, stdout: encoder.encode(`${PREP_MARK}${JSON.stringify({ md: "# synthetic" })}\n`) }), kill() {} } : origExec(cmd, o);
  const coord = make(); m.objects.set("dependencies:coordinator", coord.instance); m.env.PREP_CONTAINER = { idFromName: n => n, get: n => m.objects.get(n) };
  return { ...m, alarms, destroys: () => destroys, running: () => running };
}
const job = { r2key: "t/prepbench-x/files/a.docx", ext: "docx", op: "md" };
assert.deepEqual(PREP_IDLE_POLICIES, { current: 60e3, "queue-empty": 0, grace10: 10e3 });
{ // current (chosen per request): the container stays up, alarm 60 s out, an alarm 30 s after the job keeps it, one after 61 s stops it
  const o = jobObject(); const r = await o.instance.prepJob({ ...job, idle: "current" });
  assert.equal(r.md, "# synthetic"); assert.equal(r.idle, "current"); assert.equal(o.running(), true); assert.equal(o.destroys(), 0);
  assert.ok(Math.abs(o.alarms.at(-1) - Date.now() - 60e3) < 2000);
  const t = r.timing; assert.ok(t.start_at <= t.ready_at && t.ready_at <= t.setup_done_at && t.setup_done_at <= t.process_done_at); assert.equal(t.stopped_at, null);
  o.instance.put("prep_last", String(Date.now() - 30e3)); await prepJobAlarm(o.instance); assert.equal(o.destroys(), 0);
  o.instance.put("prep_last", String(Date.now() - 61e3)); await prepJobAlarm(o.instance); assert.equal(o.destroys(), 1);
  assert.ok((await o.instance.prepBenchmarkStatus()).stopped_at > 0);
}
{ // queue-empty chosen per request: stops before returning, the stop time is in the result, and no alarm is armed
  const o = jobObject(); const r = await o.instance.prepJob({ ...job, idle: "queue-empty" });
  assert.equal(r.idle, "queue-empty"); assert.equal(o.running(), false); assert.equal(o.destroys(), 1); assert.ok(r.timing.stopped_at >= r.timing.process_done_at); assert.equal(o.alarms.length, 0);
  assert.equal((await o.instance.prepBenchmarkStatus()).idle, "queue-empty");
  // two jobs queued together share one container, and it stops only after the second
  const q = jobObject(); const [a, b2] = await Promise.all([q.instance.prepJob({ ...job, idle: "queue-empty" }), q.instance.prepJob({ ...job, idle: "queue-empty" })]);
  assert.equal(q.starts.length, 1); assert.equal(q.destroys(), 1); assert.equal(a.timing.stopped_at, null); assert.ok(b2.timing.stopped_at > 0);
}
{ // grace10: alarm 10 s out; stops by alarm after 10 s, not before, and a queued job defers it
  const o = jobObject(); const r = await o.instance.prepJob({ ...job, idle: "grace10" });
  assert.equal(o.running(), true); assert.ok(Math.abs(o.alarms.at(-1) - Date.now() - 10e3) < 2000);
  o.instance.put("prep_last", String(Date.now() - 5e3)); await prepJobAlarm(o.instance); assert.equal(o.destroys(), 0);
  o.instance.put("prep_last", String(Date.now() - 11e3)); await prepJobAlarm(o.instance); assert.equal(o.destroys(), 1);
  assert.ok(r.timing.process_done_at > 0);
}
{ // the PrepContainer path defaults to grace10; PREP_IDLE overrides it; a request overrides both; unknown values fall to the default; Computer (no prepStart) keeps 60 s
  assert.equal(prepIdlePolicy({ prepStart() {}, env: { PREP_CONTAINER: {} } }), "grace10");
  assert.equal(prepIdlePolicy({ prepStart() {}, env: { ENV_NAME: "live", PREP_CONTAINER: {} } }), "grace10");
  assert.equal(prepIdlePolicy({ prepStart() {}, env: { PREP_CONTAINER: {}, PREP_IDLE: "queue-empty" } }), "queue-empty");
  assert.equal(prepIdlePolicy({ prepStart() {}, env: { PREP_CONTAINER: {}, PREP_IDLE: "bogus" } }), "grace10");
  assert.equal(prepIdlePolicy({ env: { PREP_CONTAINER: {}, PREP_IDLE: "queue-empty" } }, "queue-empty"), "current");
  assert.equal(prepIdlePolicy({ env: {} }), "current");
  assert.equal(prepIdlePolicy({ prepStart() {}, env: {} }, "bogus"), "grace10");
  assert.equal(prepIdlePolicy({ prepStart() {}, env: { PREP_CONTAINER: {}, PREP_IDLE: "queue-empty" } }, "current"), "current", "a request overrides the env var");
  const d = jobObject(); const rd = await d.instance.prepJob(job);
  assert.equal(rd.idle, "grace10"); assert.equal(d.running(), true); assert.ok(Math.abs(d.alarms.at(-1) - Date.now() - 10e3) < 2000);
  const o = jobObject({ PREP_IDLE: "queue-empty" }); const r = await o.instance.prepJob(job);
  assert.equal(r.idle, "queue-empty"); assert.equal(o.running(), false);
}
console.log("Job template module, md-only variant, idle policies and timing fields passed.");
