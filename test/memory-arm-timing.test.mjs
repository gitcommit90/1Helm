// node --import ./test/stubs/register.mjs test/memory-arm-timing.test.mjs
// The timing of the automatic memory lookup (recall-timeout, release 52). A fake clock and a slow, hung or failing vector index check that a recall taking 2.5 s lands in the first
// model step (the old 1.5 s cap dropped it), that a lookup which never answers cannot hold a turn past the cap, that a lookup started earlier is waited for only
// for what is left of the cap, and that a fast lookup adds only its own time. memUseStart and memUseJoin run on a minimal fake Resident.
import assert from "node:assert/strict"; import { mock, test } from "node:test";
import { useMethods, ARM_DEADLINE_MS, armDeadline } from "../src/memory-use.js";
import { retainV2 } from "../src/mem0.js";
import { memEnv } from "./helpers/mem0-fakes.mjs";

// An env whose index holds one fact; `query(go)` decides what a search of the index does (go() is the real answer).
async function env(query, extra = {}) {
  const { env: e, index } = memEnv({ HS_USE: "on", HS_FOUNDATIONS: "on", ...extra });
  await retainV2(e, "dev-t-main", [{ document_id: "note:1", content: "Mario, a neighbor, plans a 5 to 10 acre property.", strategy: "verbatim", at: Date.parse("2026-10-20T15:19:00Z"), metadata: { category: "person" } }]);
  const real = index.query.bind(index); index.query = (v, o) => /_entities$/.test(o.namespace) ? real(v, o) : query(() => real(v, o)); return e;   // the entity lookup of one search is not delayed again
}
const fake = (e) => { const receipts = []; return { env: e, get: () => "", memoryMode: () => "on", hsBankId: () => "dev-t-main", tz: () => "UTC", mem: { receipt: (r) => receipts.push(r) }, receipts, memUseStart: useMethods.memUseStart, memUseJoin: useMethods.memUseJoin }; };
const realTimeout = globalThis.setTimeout;   // the fake clock stops setTimeout, but hashing and the stores need a little real time
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((z) => realTimeout(z, 3)); };
// Starts a lookup, advances the fake clock to each time in `at`, then joins. → { out, joinedAt, elapsed } with times counted on the fake clock.
async function run(query, { joinAt = 0, env: ex = {} } = {}) {
  const e = await env(query, ex);
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    const R = fake(e), t0 = Date.now(), h = R.memUseStart("what is Mario planning for the acre property", { turn: "t", session: "s" });
    assert.ok(h, "the lookup starts");
    if (joinAt) { await flush(); mock.timers.tick(joinAt); await flush(); }   // the search reaches the index before the clock moves
    const joinStart = Date.now(), p = R.memUseJoin(h, { turn: "t", session: "s" });
    let out = null, done = false; p.then((x) => { out = x; done = true; });
    for (let i = 0; i < 60 && !done; i++) { await flush(); if (!done) mock.timers.tick(100); }
    await flush();
    return { out, done, waited: Date.now() - joinStart, total: Date.now() - t0, R };
  } finally { mock.timers.reset(); }
}
const slow = (ms) => (go) => new Promise((z) => setTimeout(() => z(go()), ms));

test("the cap is 5000 ms and HS_USE_DEADLINE_MS can still change it", () => {
  assert.equal(ARM_DEADLINE_MS, 5000); assert.equal(armDeadline({}), 5000); assert.equal(armDeadline({ HS_USE_DEADLINE_MS: "900" }), 900); assert.equal(armDeadline({ HS_USE_DEADLINE_MS: "9000" }), 5000);
});
test("a recall that takes 2.5 s lands in the first step", async () => {
  const r = await run(slow(2500));
  assert.ok(r.done); assert.ok(r.out.block.includes("Mario"), "memory is in the turn context"); assert.equal(r.out.info.n, 1); assert.ok(!r.out.info.error);
  assert.ok(r.total >= 2500 && r.total <= 2700, `the turn waited for the recall only (${r.total} ms)`);
  assert.equal(r.R.receipts[0].mode, "on:memory");
});
test("a recall that takes 4.2 s lands in the first step", async () => {
  const r = await run(slow(4200)); assert.ok(r.out.block.includes("Mario")); assert.ok(r.total >= 4200 && r.total <= 4400, `${r.total} ms`);
});
test("a fast recall adds only its own time", async () => {
  const r = await run(slow(300)); assert.ok(r.out.block.includes("Mario")); assert.ok(r.total <= 500, `${r.total} ms`);
});
test("a lookup started earlier is waited for only for what is left", async () => {
  const r = await run(slow(2500), { joinAt: 2000 }); assert.ok(r.out.block.includes("Mario")); assert.ok(r.waited <= 600, `waited ${r.waited} ms after 2000 ms of setup`);
});
test("a recall that never answers cannot hold the turn past the cap", async () => {
  const r = await run(() => new Promise(() => {}));
  assert.ok(r.done, "the join ended"); assert.equal(r.out.block, ""); assert.ok(r.out.info.error); assert.ok(r.total >= 5000 && r.total <= 5200, `held ${r.total} ms`);
  assert.equal(r.R.receipts[0].mode, "on:memory-unavailable");
});
test("a hung recall joined at 4.5 s waits for the rest of the cap only", async () => {
  const r = await run(() => new Promise(() => {}), { joinAt: 4500 }); assert.ok(r.done); assert.ok(r.total <= 5200, `${r.total} ms in all`);
});
test("a recall that answers after 5 s is left out", async () => {
  const r = await run(slow(5600)); assert.equal(r.out.block, ""); assert.ok(r.total <= 5200);
});
test("a server that fails at once adds no wait", async () => {
  const r = await run(async () => { throw new Error("down"); }); assert.ok(r.total <= 300); assert.ok(r.out.block.includes("unavailable") || r.out.info.unavailable);
});
