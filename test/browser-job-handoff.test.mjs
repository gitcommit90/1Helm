// node --import ./test/stubs/register.mjs test/browser-job-handoff.test.mjs
// The result of a stopped or finished browser job is worded the same way for every status, and tells the follow-on
// assistant to continue the person's request if it is not finished, checking the page before repeating an uncertain action.
import assert from "node:assert/strict";
import { browserJobHandoff } from "../src/ee/browser-tasks.js";

for (const status of ["done", "stopped", "failed", "blocked", "uncertain"]) {
  const t = browserJobHandoff({ id: 7, status, url: "https://example.com/", last_step: 2, report: "r" });
  assert.match(t, /browser job #7/);
  assert.match(t, /continue it, and check the page before repeating an action whose outcome is uncertain/, status);
}
console.log("browser-job-handoff passed");
