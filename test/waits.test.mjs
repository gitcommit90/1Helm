// node --import ./test/stubs/register.mjs test/waits.test.mjs
// Deadlines on waits (limits.js): the capped helper, the saved job timeouts, and a hung Workers AI embedding that returns an error in time.
import assert from "node:assert/strict";
import "../src/resident.js";
import { capped, jobTimeoutDefault } from "../src/limits.js";
import { dispatch } from "../src/ee/model-dispatch.js";
import { withSettings, SEED } from "./helpers/seed-settings.mjs";

let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };

await test("capped returns the result of a call that answers in time", async () => {
  assert.equal(await capped(Promise.resolve(7), 1000), 7);
});
await test("capped rejects a call that never returns, and passes on its own error", async () => {
  const t0 = Date.now();
  await assert.rejects(capped(new Promise(() => {}), 50, "step"), /step timed out after 0 s/);
  assert.ok(Date.now() - t0 < 500);
  await assert.rejects(capped(Promise.reject(new Error("boom")), 1000), /boom/);
});
await test("the memory, file and picture jobs have starting timeouts", () => {
  assert.deepEqual(["mem_embed", "embed_files", "sidecar_card", "vision_files"].map(jobTimeoutDefault), [15000, 30000, 240000, 120000]);
});
await test("a Workers AI embedding that never answers fails within the job timeout", async () => {
  const s = JSON.parse(JSON.stringify(SEED)); s.jobs.mem_embed.timeout_ms = 1000;
  const env = withSettings({ AI: { run: () => new Promise(() => {}) }, AIG_ID: "g" }, s);
  const keep = setTimeout(() => {}, 10000), t0 = Date.now();   // AbortSignal.timeout does not keep node alive
  await assert.rejects(dispatch(env, "mem_embed", { input: ["hello"] }, { meta: { tenant: "t", kind: "x" }, level: "zdr" }));
  clearTimeout(keep);
  assert.ok(Date.now() - t0 < 4000, "returned within the timeout, not hung");
});
console.log(`${n} tests passed`);
