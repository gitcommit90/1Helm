import assert from "node:assert/strict";
import test from "node:test";

import { channelMetaView } from "../src/server/bootstrap-view.ts";
import {
  SKIPPER_CALL_APPROVE_ONCE,
  SKIPPER_CALL_APPROVE_THREAD,
  SKIPPER_CALL_DENY,
  skipperCallApprovalPayload,
} from "../src/server/bot-output.ts";

const rules = {
  canManageChannel: () => true,
  channelUnreadCount: () => 0,
  detailedAgent: () => null,
  computer: () => null,
  agentForChannel: () => undefined,
  resolvedModel: () => "",
  q: () => [],
  q1: () => undefined,
};

test("resident channels keep direct Skipper calls enabled by default", () => {
  const base = { id: 2, name: "work", kind: "channel", topic: "", purpose: "", status: "active", slug: "work" };
  assert.equal(channelMetaView(base, null, false, rules).call_skipper_without_confirmation, true);
  assert.equal(channelMetaView({ ...base, call_skipper_without_confirmation: 0 }, null, false, rules).call_skipper_without_confirmation, false);
});

test("Skipper approval presents exactly the three requested choices", () => {
  const payload = skipperCallApprovalPayload("Needs host access", 12, 34);
  assert.deepEqual(payload.questions[0].options.map((option) => option.label), [
    SKIPPER_CALL_APPROVE_ONCE,
    SKIPPER_CALL_APPROVE_THREAD,
    SKIPPER_CALL_DENY,
  ]);
  assert.equal(payload.reason, "Needs host access");
  assert.equal(payload.action_id, 12);
  assert.equal(payload.progress_id, 34);
});
