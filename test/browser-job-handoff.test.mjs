// node --import ./test/stubs/register.mjs test/browser-job-handoff.test.mjs
// The result of a stopped or finished browser job is worded the same way for every status, and tells the follow-on
// assistant not to start another browser job on its own (that would hold the channel's browser again).
import assert from "node:assert/strict";
import { browserJobHandoff } from "../src/ee/browser-tasks.js";

for (const status of ["done", "stopped", "failed", "blocked", "uncertain"]) {
  const t = browserJobHandoff({ id: 7, status, url: "https://example.com/", last_step: 2, report: "r" });
  assert.match(t, /browser job #7/);
  assert.match(t, /Do not start another browser job unless the person asked/, status);
}
console.log("browser-job-handoff passed");
