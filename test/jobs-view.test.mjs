// The boot/poll jobs list: active/paused jobs and active follow-ups are unchanged; recently ended ones follow with ended + why, bounded.
import test from "node:test";
import assert from "node:assert/strict";
import { jobsView, endedWhy, PAST_MAX, PAST_DAYS } from "../src/jobs-view.js";

const NOW = Date.UTC(2026, 9, 22), D = 86400e3;
const w = (o) => ({ id: 1, kind: "workflow", name: "n", interval_seconds: 3600, next_run: NOW + 1000, run_count: 0, max_runs: 0, status: "active", last_error: "", session: null, updated: NOW - D, ...o });

test("active and paused jobs and active follow-ups keep their shape and order", () => {
  const out = jobsView([w({ id: 1 }), w({ id: 2, status: "paused" }), w({ id: 3, kind: "followup", max_runs: 1 })], NOW);
  assert.deepEqual(out.map((j) => [j.id, j.status]), [[1, "active"], [2, "paused"], [3, "active"]]);
  assert.ok(out.every((j) => !("ended" in j) && !("why" in j)));
  assert.deepEqual(Object.keys(out[0]).sort(), ["every", "id", "kind", "name", "next", "runs", "session", "status", "when"]);
});

test("every way a job ends lands in the list with an ended time and a reason", () => {
  const rows = [
    w({ id: 1, status: "complete", run_count: 4 }),
    w({ id: 2, status: "complete", max_runs: 3, run_count: 3 }),
    w({ id: 3, status: "failed", last_error: "boom" }),
    w({ id: 4, kind: "followup", status: "complete", max_runs: 1, run_count: 0 }),
    w({ id: 5, kind: "followup", status: "complete", max_runs: 1, run_count: 1 }),
    w({ id: 6, status: "complete", last_error: "stopped: its app event was removed" }),
  ];
  const out = jobsView(rows, NOW);
  assert.deepEqual(out.map((j) => j.why), ["Stopped by you", "Finished", "Stopped after errors", "Canceled", "Finished", "Its app event was removed"]);
  assert.ok(out.every((j) => j.ended === NOW - D && j.next === null));
  assert.equal(out[0].runs, 4);
});

test("ended jobs are bounded by age and count, newest first", () => {
  const old = w({ id: 99, status: "complete", updated: NOW - (PAST_DAYS + 1) * D });
  const many = Array.from({ length: PAST_MAX + 5 }, (_, i) => w({ id: i + 1, status: "complete", updated: NOW - (i + 1) * 1000 }));
  const out = jobsView([old, ...many, w({ id: 200 })], NOW);
  assert.equal(out.filter((j) => j.ended).length, PAST_MAX);
  assert.equal(out.find((j) => j.id === 99), undefined);
  assert.equal(out[0].id, 200);
  assert.deepEqual(out.slice(1, 4).map((j) => j.id), [1, 2, 3]);
});

test("an ended app-event job keeps its event words and the reason for a failed set up", () => {
  const out = jobsView([w({ status: "complete", event: { label: "a new email arrives", account: "a@b.c" } })], NOW);
  assert.equal(out[0].on, "a new email arrives");
  assert.equal(endedWhy(w({ status: "complete", last_error: "couldn't be set up" })), "Couldn't be set up");
});
