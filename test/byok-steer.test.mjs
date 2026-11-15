// node --import ./test/stubs/register.mjs test/byok-steer.test.mjs
// An own-key account sends a second message while its first turn is running (e.g. "I'm done in the browser. Please continue." then "fill out the rest").
// The queued message used to be sorted with the managed request sorter (steerMessage -> routeTwoTurn), which has no routing lists on an own key,
// so the whole running turn failed with "No saved routing models for this category. Open Models and set them. Nothing was sent."
import assert from "node:assert";
import { test } from "node:test";
import { Resident } from "../src/resident.js";
import { ensureTaskRuntime, TaskAffinityBlocked } from "../src/ee/task-profile.js";
import { withSettings } from "./helpers/seed-settings.mjs";

const byokEnv = { ONEHELM_EE: "1hc", DYNAMIC_ROUTING: "on", ENV_NAME: "test", BYOK: { base: "https://llm.example-ai.com/v1", host: "llm.example-ai.com", model: "main-1" } };
const inputs = [{ type: "msg", text: "I'm done in the browser. Please continue." }, { type: "msg", text: "fill out the rest" }];

test("steerMessage on an own key does not ask the managed routing lists", async () => {
  const self = { env: byokEnv, tz: () => "UTC", attachParts: async () => ({ pics: [], note: "", body: "" }), compactHistory: () => [],
    get: () => "t1", sql: { exec: () => ({ toArray: () => [], one: () => ({}) }) } };
  const tc = { session: "s1", kind: "chat", turn: "t" };
  const r = await Resident.prototype.steerMessage.call(self, tc, inputs, {});
  assert.ok(r.text.includes("fill out the rest"));
  assert.ok(!tc.orchestration?.steer);
});

test("ensureTaskRuntime on an own key stops with the own-key message, not the routing-list error", async () => {
  const R = { env: withSettings({ ...byokEnv }), get: () => "t1", put() {}, compactHistory: () => [], sql: { exec: () => ({ toArray: () => [] }) } };
  await assert.rejects(() => ensureTaskRuntime(R, { session: "s1", turn: "t" }, { kind: "chat", text: "hi" }), (e) => e instanceof TaskAffinityBlocked && e.reason === "byok-legacy");
});
