import assert from "node:assert/strict";
import test from "node:test";

import {
  clearProgressState,
  progressOpenByMessage,
  progressStepOpen,
  progressTimelineItems,
  progressTimelineScroll,
} from "../src/client/progress-state.ts";

test("deleted message ids cannot retain work-log state when SQLite reuses them", () => {
  progressOpenByMessage.set(1587, true);
  progressStepOpen.set("1587:9985", true);
  progressStepOpen.set("1588:9986", true);
  progressTimelineItems.set(1587, [{ id: 9985, kind: "tool", body: "stale Random call", status: "complete", created: 1, updated: 1 }]);
  progressTimelineScroll.set(1587, { top: 42, stick: false });

  clearProgressState([1587]);

  assert.equal(progressOpenByMessage.has(1587), false);
  assert.equal(progressStepOpen.has("1587:9985"), false);
  assert.equal(progressTimelineItems.has(1587), false);
  assert.equal(progressTimelineScroll.has(1587), false);
  assert.equal(progressStepOpen.get("1588:9986"), true);
  clearProgressState();
});
