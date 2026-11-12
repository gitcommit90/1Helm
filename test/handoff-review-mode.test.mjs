// A helper's report puts Primary in answer mode only for a routed worker of this task that is paused with a question. A returned worker has no review.
// Deterministic: rows, helper texts and source wiring; no model calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewableWorker, handoffSteerText, handoffAwayText } from "../src/helpers.js";

const row = (o) => ({ id: 11, session: "s1", name: "Worker", dynamic_routing: 0, status: "done", error: null, report: "Report body", ...o });

// A classic helper, done.
assert.equal(reviewableWorker(row({ dynamic_routing: 0, status: "done" }), "s1"), false, "classic helper is never reviewed");
// Observed on dev: a routed worker that failed or was stopped.
assert.equal(reviewableWorker(row({ dynamic_routing: 1, status: "failed", error: "cut off" }), "s1"), false);
assert.equal(reviewableWorker(row({ dynamic_routing: 1, status: "stopped" }), "s1"), false);
assert.equal(reviewableWorker(row({ dynamic_routing: 1, status: "running" }), "s1"), false);
// Missing helper or another task's helper.
assert.equal(reviewableWorker(undefined, "s1"), false);
assert.equal(reviewableWorker(row({ dynamic_routing: 1, status: "awaiting_review", session: "other" }), "s1"), false);
// A routed worker that returned (awaiting_review) is open for a follow-up but has no review; one paused for input still enters answer mode.
assert.equal(reviewableWorker(row({ dynamic_routing: 1, status: "awaiting_review" }), "s1"), false);
assert.equal(reviewableWorker(row({ dynamic_routing: 1, status: "waiting_input" }), "s1"), true);

// The note for a failed routed worker says it failed, with the error, and that it cannot be approved.
const failed = row({ dynamic_routing: 1, status: "failed", error: "model call cut off" });
for (const t of [handoffSteerText(failed), handoffAwayText(failed)]) {
  assert(t.includes("failed") && t.includes("model call cut off"), t);
  assert(t.includes("cannot be sent a follow-up"), t);
  assert(!/review|approve/i.test(t), t);
}
// A classic helper's note is unchanged.
assert(!handoffSteerText(row({})).includes("cannot be sent a follow-up"));

// Wiring in resident.js: review id, browser-hold check and the own-key sorter all depend on the helper row.
const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
assert(src.includes('opts.handoff?.type === "helper" && reviewableWorker(handedWorker, tc.session) ? Number(opts.handoff.id) : null'));
assert(src.includes("if (reviewableWorker(returned, tc.session)) tc.routingReviewHelper = returned.id;"));
assert(src.includes("skipSort: !!handedWorker ||"), "every helper handoff skips the own-key sorter");
assert(src.includes('if (opts.handoff?.type === "helper" && !reviewId) tc.orchestration = { ...tc.orchestration, review: null, steer: null, requiredDelegation: false };'));
console.log("handoff-review-mode ok");
