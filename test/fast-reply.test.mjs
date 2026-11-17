// node --import ./test/stubs/register.mjs test/fast-reply.test.mjs
// Time to the first model call of a chat turn (fast-reply): no lookup for a message with no typed text, the Mem0 engine warmed at start,
// the D1 reads of one search issued together, and the independent reads before the first model call running together.
import assert from "node:assert/strict"; import { test } from "node:test";
import { readFileSync } from "node:fs";
import { world } from "./deploy-harness.mjs";
import { useMethods } from "../src/memory-use.js";
import { warm } from "../src/mem0.js";
import { MemStore } from "../src/mem0-store.js";
import { memEnv } from "./helpers/mem0-fakes.mjs";

const sleep = (ms) => new Promise((z) => setTimeout(z, ms));

test("a message with no typed text starts no automatic lookup", () => {
  const { env } = memEnv({ HS_USE: "on", HS_FOUNDATIONS: "on" }), R = { env, get: () => "", memoryMode: () => "on", hsBankId: () => "dev-t-main", tz: () => "UTC", ...useMethods };
  for (const t of ["", "   \n", undefined]) assert.equal(R.memUseStart(t, { turn: "t" }), null, JSON.stringify(t));
  assert.ok(R.memUseStart("what is Mario planning", { turn: "t" }), "typed text still starts one");
});

test("the engine import starts when a Resident is built, and warm() never throws", async () => {
  assert.equal(warm(), undefined); assert.equal(warm(), undefined);
  assert.match(readFileSync(new URL("../src/resident.js", import.meta.url), "utf8"), /if \(hsOn\(this\.env\)\) warmMemory\(\)/);
});

test("the D1 reads of one vector search run together", async () => {
  let open = 0, peak = 0;
  const DB = { prepare: () => ({ bind: () => ({ all: async () => { peak = Math.max(peak, ++open); await sleep(30); open--; return { results: [] }; } }) }) };
  const MEMORY_INDEX = { query: async () => ({ matches: Array.from({ length: 150 }, (_, i) => ({ id: `m${i}`, score: 0.5 })) }) };
  const out = await new MemStore({ DB, MEMORY_INDEX }, "ns").search([0.1], 60, {});
  assert.deepEqual(out, []); assert.equal(peak, 2, "150 ids are two chunks of 90, read at the same time");
});

test("the reads before the first model call overlap instead of adding up", async () => {
  const firstModel = async (ms) => {
    const W = world(), R = W.R, wait = (v) => async () => { await sleep(ms); return v; }; let t0, first = null;
    R.placeNote = wait(""); R.lnNote = wait("");
    W.brain = () => { first ??= Date.now() - t0; return "Done."; }; t0 = Date.now();
    await R.runTurn("t1", "main", "1", "Hello there", null, { session: R.newSession("T") });
    return first;
  };
  await firstModel(0);   // loads the code, so the next two timings compare like with like
  const none = await firstModel(0), slow = await firstModel(300);
  console.log(`first model call: ${none} ms with no read delay, ${slow} ms with three reads of 300 ms`);
  assert.ok(slow - none < 700, `three 300 ms reads added ${slow - none} ms, not the 900 ms they add one after another`);
});
