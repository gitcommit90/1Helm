// node --import ./test/stubs/register.mjs test/backfill-trace.test.mjs
// Mem0 backfill counts for Langfuse (src/backfill-trace.js): each channel counts once in one status, test accounts are left out, the payload holds numbers only,
// and nothing is read or sent without the token.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import { classifyRun, countBanks, buildSnapshot, listBanks, sendBackfillSnapshot, SERIES, BACKFILL_KEYS } from "../src/backfill-trace.js";
import { bankId } from "../src/mem0.js";
import { REBUILD_VERSION } from "../src/hindsight-writers.js";

const CANARY = "CANARY-slug-do-not-send";
const sum = (r) => JSON.stringify({ sent: r.sent ?? 0, report: r.ok === undefined ? null : { ok: r.ok } });
const run = (status, o = {}) => ({ bank: o.bank || "b", status, version: o.version ?? REBUILD_VERSION, summary: sum(o) });

// ---- classify: every status lands in exactly one series ----
assert.equal(classifyRun(null), "not_started");
assert.equal(classifyRun(run("idle")), "not_started");
assert.equal(classifyRun(run("done", { ok: true })), "done_ok");
assert.equal(classifyRun(run("done", { ok: false })), "done_mismatch");
assert.equal(classifyRun(run("done")), "done_mismatch", "a done row with no verify report is not ok");
assert.equal(classifyRun(run("running")), "running"); assert.equal(classifyRun(run("paused")), "paused"); assert.equal(classifyRun(run("failed")), "failed");
assert.equal(classifyRun(run("done", { ok: true, version: REBUILD_VERSION - 1 })), "not_started", "a row of the Hindsight rebuild is not the Mem0 backfill");
assert.equal(classifyRun({ bank: "x", status: "weird", version: REBUILD_VERSION, summary: "{bad" }), "not_started");

// ---- countBanks: each bank once, rows of banks outside the list ignored, sent summed ----
{
  const banks = ["a", "b", "c", "d", "e", "f", "g", "a"];   // a is listed twice and counts once
  const rows = [run("done", { bank: "a", ok: true, sent: 10 }), run("done", { bank: "b", ok: false, sent: 5 }), run("running", { bank: "c", sent: 3 }), run("failed", { bank: "d", sent: 2 }),
    run("paused", { bank: "e" }), run("idle", { bank: "f" }), run("done", { bank: "zzz", ok: true, sent: 999 })];   // g has no row; zzz is not a listed channel
  const c = countBanks(banks, rows);
  assert.deepEqual(c, { channels_total: 7, not_started: 2, running: 1, paused: 1, failed: 1, done_ok: 1, done_mismatch: 1, sent_total: 20, remaining: 5 });
  assert.equal(c.not_started + c.running + c.paused + c.failed + c.done_ok + c.done_mismatch, c.channels_total, "each channel is counted in one status");
  assert.equal(countBanks([], []).remaining, 0);
}

// ---- listBanks: test accounts and direct messages are left out ----
const env0 = { ENV_NAME: "dev" };
{
  const tenants = [{ id: "t1", email: "real@gmail.com" }, { id: "t2", email: "chk+1@example.com" }, { id: "t3", email: null }, { id: "t4", email: "late@gmail.com" }];
  const chans = { t1: [{ slug: "main", kind: "channel" }, { slug: "work", kind: "channel" }, { slug: "dm1", kind: "dm" }], t2: [{ slug: "main" }], t3: [{ slug: "main" }], t4: null };
  const r = await listBanks(env0, { fetchTenants: async () => tenants, channelsOf: async (id) => { if (!chans[id]) throw new Error("down"); return chans[id]; } });
  assert.deepEqual(r.banks.sort(), [bankId(env0, "t1", "main"), bankId(env0, "t1", "work"), bankId(env0, "t3", "main")].sort());
  assert.equal(r.tenants, 3, "the @example.com account is not counted"); assert.equal(r.unread, 1);
}

// ---- payload: numbers only, allowlisted keys, one span per series with its count as the duration ----
{
  const counts = countBanks(["a", "b"], [run("done", { bank: "a", ok: true, sent: 4 })]);
  const body = buildSnapshot(counts, { now: 1_800_000_000_000, kind: "change", tenants: 1, unread: 0, traceId: "a".repeat(32) });
  const spans = body.resourceSpans[0].scopeSpans[0].spans, root = spans.find((s) => !s.parentSpanId);
  assert.equal(spans.length, 1 + SERIES.length); assert.equal(root.name, "backfill snapshot");
  const dur = (s) => Number((BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1000000n);
  for (const [k, v] of Object.entries(counts)) assert.equal(dur(spans.find((s) => s.name === `backfill ${k}`)), v, k);
  const get = (s, k) => s.attributes.find((a) => a.key === k)?.value;
  assert.equal(get(root, "langfuse.trace.metadata.channels_total").intValue, "2"); assert.equal(get(root, "langfuse.trace.metadata.done_ok").intValue, "1");
  assert.equal(get(root, "langfuse.trace.metadata.not_started").intValue, "1"); assert.equal(get(root, "langfuse.trace.metadata.sent_total").intValue, "4");
  for (const s of spans) for (const a of s.attributes) assert.ok(BACKFILL_KEYS.has(a.key), a.key);
  assert.ok(!spans.some((s) => get(s, "langfuse.user.id")), "no user id");
  // every value is a number, or one of a few fixed words
  const strings = spans.flatMap((s) => s.attributes.map((a) => a.value.stringValue).filter((v) => v != null));
  assert.deepEqual([...new Set(strings)].sort(), ["backfill", "backfill snapshot", "change", "span"]);
}

// ---- send: a D1 stand-in, the saved list of banks, a stubbed fetch ----
const mk = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT)");
  const DB = { prepare: (q) => { const st = d.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => { st.run(...a); return {}; } }; return o; } };
  return { d, DB };
};
{
  const { d, DB } = mk(), calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, body: null }; };
  const insert = (bank, status, ok, sent) => d.prepare("INSERT INTO hs_rebuild_runs VALUES (?,?,?,?,?,?,?,?,?)").run(bank, "t", "c", status, null, REBUILD_VERSION, 1, 1, JSON.stringify({ sent, report: { ok } }));
  const deps = { fetchTenants: async () => [{ id: "t1", email: "real@gmail.com" }, { id: "t2", email: "x@example.com" }], channelsOf: async (id) => [{ slug: "main" }, { slug: CANARY }] };
  const b1 = bankId({ ENV_NAME: "live" }, "t1", "main"), b2 = bankId({ ENV_NAME: "live" }, "t1", CANARY);
  insert(b1, "done", true, 12); insert(bankId({ ENV_NAME: "live" }, "t2", "main"), "done", true, 500);   // the test account's row is in D1 but in no count

  // no token: nothing is read and nothing is sent
  let r = await sendBackfillSnapshot({ ENV_NAME: "live", DB, APP_OTEL_URL: "https://x/app/live/v1/traces" }, { fetchImpl, deps });
  assert.deepEqual(r, { skipped: "no token" }); assert.equal(calls.length, 0);
  r = await sendBackfillSnapshot({ ENV_NAME: "live", DB, APP_OTEL_TOKEN: "tok" }, { fetchImpl, deps }); assert.deepEqual(r, { skipped: "no token" });
  assert.equal(d.prepare("SELECT name FROM sqlite_master WHERE name='backfill_trace'").all().length, 0, "no table was made without a token");

  // hourly run: asks the accounts, saves the list, sends one POST with the bearer token
  const env = { ENV_NAME: "live", DB, APP_OTEL_URL: "https://x/app/live/v1/traces", APP_OTEL_TOKEN: "tok" };
  r = await sendBackfillSnapshot(env, { kind: "cron", now: 1_000_000, fetchImpl, deps });
  assert.equal(r.sent, true); assert.deepEqual(r.counts, { channels_total: 2, not_started: 1, running: 0, paused: 0, failed: 0, done_ok: 1, done_mismatch: 0, sent_total: 12, remaining: 1 });
  assert.equal(calls.length, 1); assert.equal(calls[0].init.headers.authorization, "Bearer tok"); assert.equal(calls[0].url, env.APP_OTEL_URL);
  assert.ok(!calls[0].init.body.includes(CANARY), "no channel name in the payload"); assert.ok(!calls[0].init.body.includes("real@gmail.com"));

  // a change soon after is not sent again, a later one counts from the saved list without asking the accounts
  insert(b2, "running", undefined, 1);
  r = await sendBackfillSnapshot(env, { kind: "change", now: 1_010_000, fetchImpl, deps }); assert.deepEqual(r, { skipped: "sent a moment ago" }); assert.equal(calls.length, 1);
  const noAsk = { fetchTenants: async () => { throw new Error("must not ask the accounts"); } };
  r = await sendBackfillSnapshot(env, { kind: "change", now: 1_100_000, fetchImpl, deps: noAsk });
  assert.equal(r.sent, true); assert.equal(r.counts.running, 1); assert.equal(r.counts.channels_total, 2); assert.equal(calls.length, 2);
  // a failed send never throws
  r = await sendBackfillSnapshot(env, { kind: "cron", now: 2_000_000, fetchImpl: async () => { throw new Error("down"); }, deps }); assert.equal(r.sent, false);
}
console.log("PASS backfill-trace");
