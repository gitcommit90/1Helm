// BeeContainer (src/bee-container.js), the BEE_SNAPSHOTS class selection and the BEE_IDLE policy (src/bee.js). Fake container, no network.
// Checks only 1Helm's own behavior: which class runs, when the container stops, what the builder may receive, and the restore fallback.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import "../src/ee/index.js";
import { BeeContainer, BEE_SLOTS, beeInstance, benchOptions, beeImageFor } from "../src/ee/bee-container.js";
import * as B from "../src/ee/bee.js";

const enc = new TextEncoder();
const mark = (o) => `\n${B.JOB_MARK}${JSON.stringify(o)}\n`;
function make({ env: extra = {}, answer = { status: 0, error: "bad path" } } = {}) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...a) { const st = db.prepare(q); let rows; try { rows = st.all(...a); } catch { st.run(...a); rows = []; } return { toArray: () => rows }; } };
  let running = false, snapshots = 0, rejectRestore = false, failInstance = null, alarm = null; const starts = [], execs = [], destroys = [], pending = [];
  const container = {
    images: { base: "registry/bee@sha256:abc", slim: "registry/bee-slim@sha256:def" },
    get running() { return running; },
    start(o) { starts.push(o); if (failInstance && o.instance === failInstance) throw new Error("internal error; reference = abc"); if (rejectRestore && o.containerSnapshot) throw new Error("expired"); running = true; },
    async destroy(why) { destroys.push(why); running = false; },
    monitor() { return new Promise(() => {}); },
    async exec(argv, o = {}) {
      const stdin = o.stdin ? await new Response(o.stdin).text() : null; execs.push({ argv, stdin });
      return { output: async () => ({ exitCode: 0, stdout: enc.encode(argv[0] === "node" && argv[1] === "-e" && argv[2]?.includes("MARK") ? mark(answer) : "") }), kill() {} };
    },
    async snapshotContainer() { snapshots++; return { id: `snap-${snapshots}`, size: 1000 }; },
  };
  const oid = "obj-" + Math.random(), ctx = { id: { toString: () => oid }, container, storage: { sql, async setAlarm(t) { alarm = t; } }, waitUntil(p) { pending.push(p); } };
  const env = { ENV_NAME: "dev", TEST_MODE: "1", ...extra };
  const obj = new BeeContainer(ctx, env);
  const objects = new Map([["dependencies:coordinator", obj]]);
  env.BEE_CONTAINER = { idFromName: (n) => n, get: (n) => { if (!objects.has(n)) { const c2 = make({ env: extra }); objects.set(n, c2.obj); } return objects.get(n); } };
  return { obj, ctx, env, starts, execs, destroys, pending, objects, alarm: () => alarm, snapshots: () => snapshots, rejectRestore: () => { rejectRestore = true; }, failInstance: (i) => { failInstance = i; } };
}
const tick = async (t) => { await Promise.all(t.pending.splice(0)); };

// ---- 1. class selection ----
{
  const COMPUTER = { get: (id) => ({ cls: "computer", id }), idFromName: (n) => n }, BEE = { get: (id) => ({ cls: "bee", id }), idFromName: (n) => n };
  assert.equal(B.beeJobStub({ COMPUTER, BEE_CONTAINER: BEE }, "t1").cls, "computer", "BEE_SNAPSHOTS unset = Computer");
  assert.equal(B.beeJobStub({ COMPUTER, BEE_CONTAINER: BEE, BEE_SNAPSHOTS: "off" }, "t1").cls, "computer");
  assert.equal(B.beeJobStub({ COMPUTER, BEE_SNAPSHOTS: "on" }, "t1").cls, "computer", "no binding (Live, self host) = Computer");
  const on = B.beeJobStub({ COMPUTER, BEE_CONTAINER: BEE, BEE_SNAPSHOTS: "on" }, "t1");
  assert.equal(on.cls, "bee"); assert.equal(on.id, "beejob:t1", "same object name");
  console.log("ok class selection: Computer unless BEE_SNAPSHOTS is on and the binding exists");
}

// ---- 2. idle policies ----
{
  assert.deepEqual(B.beeIdlePolicy(undefined), { mode: "tail", graceMs: B.JOB_IDLE_MS });
  assert.deepEqual(B.beeIdlePolicy("tail"), { mode: "tail", graceMs: B.JOB_IDLE_MS });
  assert.deepEqual(B.beeIdlePolicy("queue"), { mode: "queue", graceMs: 0 });
  assert.deepEqual(B.beeIdlePolicy("queue:10"), { mode: "queue", graceMs: 10000 });
  assert.deepEqual(B.beeIdlePolicy("junk"), { mode: "tail", graceMs: B.JOB_IDLE_MS }, "unknown value = today's behavior");
  const run = async (idle, input = { path: "/v1/me" }) => {
    const t = make({ env: idle ? { BEE_IDLE: idle } : {} });
    const r = await t.obj.beeJob(input); await tick(t); return { t, r };
  };
  let { t, r } = await run(undefined);
  assert.equal(t.destroys.length, 0, "default: stays up after the job"); assert.ok(t.alarm() > Date.now() + B.JOB_IDLE_MS - 2000 && t.alarm() <= Date.now() + B.JOB_IDLE_MS, "30 s tail"); assert.equal(r.stopped, false);
  ({ t, r } = await run(undefined, { path: "/v1/me", stop: true })); assert.equal(r.stopped, true, "default: stop flag still stops at once"); assert.equal(t.destroys.length, 1);
  ({ t, r } = await run("queue")); assert.equal(r.stopped, true, "queue policy: stops as soon as nothing is queued"); assert.equal(t.alarm(), null);
  ({ t, r } = await run("queue:10")); assert.equal(r.stopped, false); assert.ok(t.alarm() <= Date.now() + 10000 && t.alarm() > Date.now() + 8000, "grace of 10 s");
  // queue policy: a second job queued behind the first keeps the container up under the first
  t = make({ env: { BEE_IDLE: "queue" } });
  const [a, b] = await Promise.all([t.obj.beeJob({ path: "/v1/me" }), t.obj.beeJob({ path: "/v1/me" })]);
  assert.equal(a.stopped, false, "queued job keeps the container"); assert.equal(b.stopped, true); assert.equal(t.starts.length, 1);
  // the alarm stops an idle container after the grace under queue:10 and never mid-queue
  t = make({ env: { BEE_IDLE: "queue:10" } }); await t.obj.beeJob({ path: "/v1/me" });
  await t.obj.alarm(); assert.equal(t.destroys.length, 0, "not idle yet");
  t.obj.put("bee_last", Date.now() - 11000); await t.obj.alarm(); assert.equal(t.destroys.length, 1);
  console.log("ok idle policies: unset keeps the 30 s tail and the stop flag; queue and queue:10 stop as set");
}

// ---- 3. Live notes keeps its container ----
{
  const t = make({ env: { BEE_IDLE: "queue" } });
  const stream = new ReadableStream({ start(c) { c.enqueue(enc.encode(mark({ t: "end", why: "ended" }))); c.close(); } });
  t.ctx.container.exec = async (argv) => argv[0] === "true" ? { output: async () => ({ exitCode: 0 }) } : { stdout: stream, kill() {} };
  const stub = { livePush: async () => ({ go: true }) };
  await B.beeLiveOn(t.obj, { run: "r1", ln: "x", max_ms: 1000 }, { ln: () => stub });
  assert.equal(t.destroys.length, 0, "a Live chunk end does not stop the container under queue");
  assert.ok(t.alarm() >= Date.now() + B.JOB_IDLE_MS - 2000, "the 30 s tail stays for Live");
  console.log("ok live notes keeps its container between chunks under the queue policy");
}

// ---- 4. builder role guard, and what the builder is given ----
{
  const t = make();
  const made = await t.obj.dependencySnapshot();
  assert.equal(made.handle.id, "snap-1"); assert.equal(t.destroys.length, 1, "builder container destroyed");
  const text = JSON.stringify(t.execs); assert.ok(!/token|tenant|beejob|stdin":"/.test(text), "no token, tenant id or input reaches the builder");
  assert.deepEqual(t.execs.filter((e) => e.argv[0] === "bash").map((e) => e.argv[2].slice(0, 8)), ["mkdir -p", "node -e ", "rm -rf /"], "only setup, verify and cleanup run");
  assert.equal(t.execs.every((e) => e.stdin === null), true, "no stdin ever");
  await assert.rejects(t.obj.beeJob({ path: "/v1/me" }), /template object cannot run Bee jobs/, "builder cannot run a job");
  const j = make(); await j.obj.beeJob({ path: "/v1/me" });
  await assert.rejects(j.obj.dependencySnapshot(), /job container cannot become a template/, "a job container cannot become a template");
  assert.equal(j.snapshots(), 0);
  // same version returns the saved template without a second build
  const again = await t.obj.dependencySnapshot(); assert.equal(again.handle.id, "snap-1"); assert.equal(t.snapshots(), 1);
  assert.equal((await t.obj.peekDependencySnapshot()).handle.id, "snap-1");
  console.log("ok builder: trivial steps only, no token or tenant, role guards both ways");
}

// ---- 5. restore, instance size and fallback ----
{
  const t = make(), builder = t.objects.get("dependencies:coordinator");
  // coordinator is this same object here; use a job object that looks it up
  const job = make(); job.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  await builder.dependencySnapshot(); const slim = await builder.dependencySnapshotFor("slim");   // lite starts the slim image
  let r = await job.obj.beeBenchJob({ path: "/v1/me" }); await job.obj.beeBenchmarkReset();
  assert.equal(r.source, "snapshot"); assert.equal(r.snapshot_id, slim.handle.id); assert.equal(job.starts[0].containerSnapshot.id, slim.handle.id); assert.equal(r.image, "slim");
  assert.equal(job.starts[0].instance, "lite", "default instance is lite"); assert.equal(r.start.fallback, null); assert.ok(r.start.t_ready >= r.start.t_start);
  assert.equal(job.starts[0].enableInternet, true);
  // per-request instance (dev with TEST_MODE only)
  const j2 = make(); j2.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  r = await j2.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "standard-1" } }); await j2.obj.beeBenchmarkReset(); assert.equal(j2.starts[0].instance, "standard-1"); assert.equal(r.instance, "standard-1");
  const prod = make({ env: { ENV_NAME: "prod", TEST_MODE: "0" } }); prod.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  await prod.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "standard-4", snapshot: "bypass", idle: "queue" } }); await prod.obj.beeBenchmarkReset();
  assert.equal(prod.starts[0].instance, "lite", "bench options ignored outside dev TEST_MODE"); assert.ok(prod.starts[0].containerSnapshot, "still restored");
  assert.equal(benchOptions({ ENV_NAME: "dev", TEST_MODE: "1" }, { bench: { instance: "basic" } }).instance, undefined, "basic is not allowed under this policy");
  assert.equal(beeInstance({ BEE_INSTANCE: "standard-1" }, null), "standard-1"); assert.equal(beeInstance({ BEE_INSTANCE: "basic" }, null), "lite");
  // control starts from the plain image
  const j3 = make(); j3.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  r = await j3.obj.beeBenchJob({ path: "/v1/me", bench: { snapshot: "bypass" } }); await j3.obj.beeBenchmarkReset(); assert.equal(r.source, "control"); assert.equal(j3.starts[0].containerSnapshot, undefined); assert.equal(j3.starts[0].image, "registry/bee-slim@sha256:def");
  // restore failure: fresh start, marked, the exact handle invalidated
  const j4 = make(); j4.env.BEE_CONTAINER = t.env.BEE_CONTAINER; j4.rejectRestore();
  r = await j4.obj.beeBenchJob({ path: "/v1/me" }); await j4.obj.beeBenchmarkReset(); await tick(j4);
  assert.equal(r.source, "fresh_fallback"); assert.equal(r.start.fallback, "restore_failed"); assert.equal(j4.starts.length, 2); assert.equal(j4.starts[1].containerSnapshot, undefined);
  assert.equal(r.result.error, "bad path", "the job still ran");
  assert.equal(await builder.peekDependencySnapshotFor("slim"), null, "the failed handle was invalidated");
  // no template yet: fresh start, marked template_missing, a build is requested
  const j5 = make(); j5.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  r = await j5.obj.beeBenchJob({ path: "/v1/me" }); await j5.obj.beeBenchmarkReset(); await tick(j5);
  assert.equal(r.source, "fresh_fallback"); assert.equal(r.start.fallback, "template_missing"); assert.ok((await builder.peekDependencySnapshotFor("slim")), "a rebuild was started");
  console.log("ok restore: lite default, benchmark options gated, control from plain image, failed restore falls back and invalidates");
}

// ---- 6. slot limit and release ----
{
  const coord = make(); const objs = [];
  for (let i = 0; i < BEE_SLOTS + 1; i++) { const o = make(); o.env.BEE_CONTAINER = coord.env.BEE_CONTAINER; objs.push(o); }
  for (let i = 0; i < BEE_SLOTS; i++) await objs[i].obj.beeJob({ path: "/v1/me" });
  await assert.rejects(objs[BEE_SLOTS].obj.beeJob({ path: "/v1/me" }), /capacity reached/);
  assert.equal(objs[BEE_SLOTS].starts.length, 0, "no container started without a slot");
  await objs[0].obj.beeBenchmarkReset(); await objs[BEE_SLOTS].obj.beeJob({ path: "/v1/me" });
  assert.equal(objs[BEE_SLOTS].starts.length, 1, "a released slot is reusable");
  console.log("ok slot limit of " + BEE_SLOTS + " with release on reset");
}

// ---- 7. raw stdin is for dev benchmark runs only; adapter input ----
{
  const t = make({ answer: { status: 0, error: "bad input" } });
  await t.obj.beeJob({ kind: "sync", bench: { stdin: "not json" } });
  assert.equal(t.execs.find((e) => e.argv[0] === "node").stdin, "not json");
  const p = make({ env: { ENV_NAME: "prod", TEST_MODE: "0" } });
  await p.obj.beeJob({ kind: "sync", token: "secret", bench: { stdin: "not json" } });
  const sent = p.execs.find((e) => e.argv[0] === "node").stdin; assert.notEqual(sent, "not json"); assert.ok(!sent.includes("bench"), "bench is never passed to the script");
  console.log("ok raw stdin gated to dev TEST_MODE");
}

// ---- 8. a start that fails for the instance type must not invalidate the saved template (lite failures on dev did) ----
{
  const t = make(), builder = t.objects.get("dependencies:coordinator");
  await builder.dependencySnapshot(); const saved = (await builder.peekDependencySnapshot()).handle.id; await builder.dependencySnapshotFor("slim"); const savedSlim = (await builder.peekDependencySnapshotFor("slim")).handle.id;
  const lite = make(); lite.env.BEE_CONTAINER = t.env.BEE_CONTAINER; lite.failInstance("lite");
  await assert.rejects(lite.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "lite", snapshot: "restore" } }), /bee container start failed \(restore then plain image, instance lite, image slim\): internal error/, "the platform's message and the stage are kept");
  await tick(lite);
  assert.equal(lite.starts.length, 2, "restore tried, then the plain image"); assert.equal((await builder.peekDependencySnapshotFor("slim")).handle.id, savedSlim, "the template is still valid"); assert.equal((await builder.peekDependencySnapshot()).handle.id, saved);
  assert.equal(lite.destroys.length >= 1, true); assert.equal((await lite.obj.beeBenchmarkStatus()).running, false);
  const ctl = make(); ctl.env.BEE_CONTAINER = t.env.BEE_CONTAINER; ctl.failInstance("lite");
  await assert.rejects(ctl.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "lite", snapshot: "bypass" } }), /\(plain image, instance lite, image slim\)/);
  // the next standard-1 restore finds the template (it was reported template_missing before the fix)
  const std = make(); std.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  const r = await std.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "standard-1", snapshot: "restore" } });
  assert.equal(r.source, "snapshot"); assert.equal(r.snapshot_id, saved); assert.equal(r.start.fallback, null);
  // a restore that fails while the plain start works still invalidates that exact handle
  const bad = make(); bad.env.BEE_CONTAINER = t.env.BEE_CONTAINER; bad.rejectRestore();
  await bad.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "standard-1", snapshot: "restore" } }); await tick(bad);
  assert.equal(await builder.peekDependencySnapshot(), null);
  console.log("ok an instance start failure keeps the template; a bad handle is still invalidated");
}

// ---- 9. image variants keep separate templates ----
{
  const t = make(), builder = t.objects.get("dependencies:coordinator");
  const a = await builder.dependencySnapshotFor("base"), b = await builder.dependencySnapshotFor("slim");
  assert.notEqual(a.version, b.version); assert.notEqual(a.handle.id, b.handle.id); assert.equal(b.image, "registry/bee-slim@sha256:def");
  assert.equal((await builder.peekDependencySnapshotFor("base")).handle.id, a.handle.id); assert.equal((await builder.peekDependencySnapshot()).handle.id, a.handle.id, "the old RPC still means base");
  const j = make(); j.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  const r = await j.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "lite", image: "slim" } });
  assert.equal(r.source, "snapshot"); assert.equal(r.snapshot_id, b.handle.id); assert.equal(r.image, "slim"); assert.equal(j.starts[0].containerSnapshot.id, b.handle.id);
  const ctl = make(); ctl.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  await ctl.obj.beeBenchJob({ path: "/v1/me", bench: { instance: "lite", image: "slim", snapshot: "bypass" } }); assert.equal(ctl.starts[0].image, "registry/bee-slim@sha256:def");
  const prod = make({ env: { ENV_NAME: "prod", TEST_MODE: "0" } }); prod.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  await j.obj.beeBenchmarkReset(); await ctl.obj.beeBenchmarkReset();
  await prod.obj.beeBenchJob({ path: "/v1/me", bench: { image: "slim" } }); assert.equal(prod.starts[0].containerSnapshot.id, b.handle.id, "lite starts slim on its own; a forced image is ignored outside dev TEST_MODE");
  const prodStd = make({ env: { ENV_NAME: "prod", TEST_MODE: "0", BEE_INSTANCE: "standard-1" } }); prodStd.env.BEE_CONTAINER = t.env.BEE_CONTAINER;
  await prodStd.obj.beeBenchJob({ path: "/v1/me", bench: { image: "slim" } }); assert.equal(prodStd.starts[0].containerSnapshot.id, a.handle.id, "standard-1 starts base"); await prodStd.obj.beeBenchmarkReset();
  console.log("ok image variants: separate versions and templates, dev benchmark only");
}

// ---- 10. the image rule: lite starts slim, standard-1 and larger start base, each with its own template ----
{
  assert.equal(beeImageFor("lite"), "slim"); for (const i of ["standard-1", "standard-2", "standard-3", "standard-4"]) assert.equal(beeImageFor(i), "base");
  assert.equal(beeImageFor("standard-1", "slim"), "slim", "a dev benchmark may force a variant"); assert.equal(beeImageFor("lite", "base"), "base"); assert.equal(beeImageFor("lite", "other"), "slim");
  const t = make(), builder = t.objects.get("dependencies:coordinator");
  const base = await builder.dependencySnapshotFor("base"), slim = await builder.dependencySnapshotFor("slim");
  assert.notEqual(builder.get("template"), undefined); assert.notEqual(builder.get("template:slim"), undefined);
  assert.notEqual(JSON.parse(builder.get("template")).image, JSON.parse(builder.get("template:slim")).image, "two storage keys, two images");
  const run = async (bench, env = {}) => { const j = make({ env }); j.env.BEE_CONTAINER = t.env.BEE_CONTAINER; const r = await j.obj.beeBenchJob({ path: "/v1/me", bench }); await j.obj.beeBenchmarkReset(); return { j, r }; };
  let x = await run({ instance: "lite" }); assert.equal(x.r.image, "slim"); assert.equal(x.r.snapshot_id, slim.handle.id);
  x = await run({}); assert.equal(x.r.image, "slim", "no option at all: lite default, slim");
  x = await run({ instance: "standard-1" }); assert.equal(x.r.image, "base"); assert.equal(x.r.snapshot_id, base.handle.id);
  x = await run({ instance: "standard-1", snapshot: "bypass" }); assert.equal(x.j.starts[0].image, "registry/bee@sha256:abc");
  x = await run({ instance: "lite", snapshot: "bypass" }); assert.equal(x.j.starts[0].image, "registry/bee-slim@sha256:def", "control on lite uses slim too");
  x = await run({}, { BEE_INSTANCE: "standard-2" }); assert.equal(x.r.image, "base", "BEE_INSTANCE picks the image the same way for the product path");
  console.log("ok image rule: lite starts slim, standard-1 and larger start base, templates stored per image");
}
