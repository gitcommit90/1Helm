// node --import ./test/stubs/register.mjs test/account-jobs.test.mjs
// Per-account scheduled work (src/account-jobs.js). With a queue bound, a listing sends one message per account (at most 100 per call, paged with a stored cursor) and the consumer
// runs one account per message. With no queue bound (the example config), the same job bodies run inside the listing, and one failing account does not hold up the others.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync } from "node:fs";
import { listJobs, listKind, accountJobsQueue, PAGE, PAGES } from "../src/account-jobs.js";
import { fakeQueue } from "./lib-account-jobs.mjs";

const ok = (m) => console.log("  ok", m);
const d1 = new DatabaseSync(":memory:");
for (const f of readdirSync(new URL("../db/migrations/", import.meta.url)).sort()) d1.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), "utf8"));
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x.map((v) => v === undefined ? null : v); return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; }, batch: (sts) => Promise.all(sts.map((s) => s.run())) };
const q = fakeQueue(), batches = [], send = q.sendBatch;
q.sendBatch = async (ms) => { batches.push(ms.length); return send(ms); };
const env = { DB, ACCOUNT_JOBS: q, ACCOUNT_JOBS_FAST: q };
const state = (kind) => d1.prepare("SELECT * FROM account_job_state WHERE kind=?").get(kind);
const NOW = Date.UTC(2026, 9, 6, 17, 0, 0);

// ---- with a queue: paging, batch size and the heartbeat row ----
{
  const rows = Array.from({ length: PAGE * PAGES + 1000 }, (_, i) => ({ k: String(i).padStart(6, "0"), tenant: `t${i}` }));
  const page = async (after, n) => rows.filter((r) => r.k > after).slice(0, n);
  let r = await listJobs(env, "x", page, NOW);
  assert.deepStrictEqual(r, { kind: "x", sent: PAGE * PAGES, done: false }); assert.ok(batches.every((n) => n <= 100), "at most 100 messages in one sendBatch");
  assert.strictEqual(state("x").cursor, rows[PAGE * PAGES - 1].k); assert.strictEqual(state("x").done_at, 0);
  assert.deepStrictEqual(q.sent[0], { kind: "x", tenant: "t0" }); q.sent.length = 0;
  r = await listJobs(env, "x", page, NOW + 60e3);
  assert.deepStrictEqual(r, { kind: "x", sent: 1000, done: true }); q.sent.length = 0;
  assert.strictEqual(state("x").cursor, ""); assert.strictEqual(state("x").done_count, PAGE * PAGES + 1000);
}
ok("with a queue: 500 accounts a page, at most 100 per call, 50 pages a run, then the stored cursor continues");

// ---- the consumer ----
{
  const ran = [], acks = [], retries = [];
  const batch = { queue: "account-jobs", messages: [{ kind: "reconcile", tenant: "a" }, { kind: "reconcile", tenant: "b" }, { kind: "reconcile", tenant: "c" }].map((body) => ({ body, attempts: 2, ack: () => acks.push(body.tenant), retry: (o) => retries.push([body.tenant, o.delaySeconds]) })) };
  await accountJobsQueue(batch, env, { reconcile: async (e, t) => { if (t === "b") throw new Error("stripe down"); ran.push(t); } });
  assert.deepStrictEqual(ran, ["a", "c"]); assert.deepStrictEqual(acks, ["a", "c"]); assert.deepStrictEqual(retries, [["b", 120]]);
}
ok("the consumer acks each account that worked and retries the one that failed with a delay, without holding up the others");

// ---- with no queue bound: the listing runs each job itself ----
const tenant = (id, sub) => d1.prepare("INSERT INTO tenants (id,slug,owner_user_id,status,stripe_subscription,created_at,updated_at,onboarding_completed) VALUES (?,?,?,?,?,?,?,1)").run(id, `s${id}`, `u${id}`, "active", sub, NOW, NOW);
tenant("a", "sub_a"); tenant("b", ""); tenant("c", "sub_c"); tenant("d", "sub_d");
{
  const bare = { DB }, ran = [], logs = [], log = console.log; console.log = (...a) => logs.push(a.join(" "));
  const d = { reconcile: async (e, t) => { if (t === "c") throw new Error("stripe down"); ran.push(t); } };
  let r; try { r = await listKind(bare, "reconcile", NOW, d); } finally { console.log = log; }
  assert.deepStrictEqual(r, { kind: "reconcile", sent: 3, done: true });
  assert.deepStrictEqual(ran, ["a", "d"], "every account with a subscription ran, the failing one did not stop the others");
  assert.ok(logs.some((l) => l.includes("account job failed reconcile c")));
  assert.strictEqual(state("reconcile").done_count, 3);
  d1.prepare("INSERT INTO resident_schedules (tenant_id,channel,channel_id,next_run,updated_at) VALUES (?,?,?,?,?)").run("a", "main", "ch1", NOW - 3 * 60e3, NOW);
  const poked = []; const res = { RESIDENT: { idFromName: (n) => n, get: (n) => ({ ensure: async (...a) => poked.push([n, ...a]) }) } };
  assert.deepStrictEqual(await listKind({ DB, ...res }, "watchdog", NOW, {}), { kind: "watchdog", sent: 1, done: true });
  assert.deepStrictEqual(poked, [["res:a:main", "a", "main", "ch1"]]);
}
ok("with no queue bound the jobs run inside the listing: a failing account is logged and the others still run, and an overdue resident is poked");

// ---- every listing query runs on the public schema ----
for (const kind of ["reconcile", "watchdog", "pastdue", "cancel", "bee", "storage", "meeting_poll", "meeting_alert", "billing_flag"]) {
  const r = await listKind({ DB, BEE_SYNC: {} }, kind, NOW, {}); assert.strictEqual(r.kind, kind); assert.strictEqual(r.done, true);
}
ok("each job kind's listing query runs against the schema built from db/migrations");
