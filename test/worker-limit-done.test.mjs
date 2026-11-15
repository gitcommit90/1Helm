// node --import ./test/stubs/register.mjs test/worker-limit-done.test.mjs
// A worker out of steps keeps only the done tool on its last call (both engines), and a done call written as plain text still gives the report.
import assert from "node:assert"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { doneResponseFromMarkup, WORKER_LIMIT_ASK, DONE_ONLY } from "../src/step-warning.js";
let passed = 0; const ok = (n) => { passed++; console.log("  ok", n); };

// markup in a report
const dsml = '<｜DSML｜ calls><｜DSML｜ invoke name="done"><｜DSML｜ parameter name="response" string="true">Found 3 issues.\nSaved report.md.</｜DSML｜ parameter></｜DSML｜ invoke></｜DSML｜ calls>';
assert.equal(doneResponseFromMarkup(dsml), "Found 3 issues.\nSaved report.md.");
assert.equal(doneResponseFromMarkup('<｜DSML｜ calls><｜DSML｜ invoke name="done"><｜DSML｜ parameter name="response" string="true">Cut off report'), "Cut off report");
assert.equal(doneResponseFromMarkup('<function_calls><invoke name="done"><parameter name="response">All checked.</parameter></invoke></function_calls>'), "All checked.");
assert.equal(doneResponseFromMarkup("Plain report with no markup."), null);
assert.equal(doneResponseFromMarkup('<invoke name="run_command"><parameter name="response">x</parameter></invoke>'), null);
assert.equal(doneResponseFromMarkup(undefined), null);
ok("done markup gives the response text");

// the last call offers only done
const tool = (n) => ({ type: "function", function: { name: n } });
const fake = { modelToolsBase: () => [tool("run_command"), tool("done"), tool("share_file")] };
const names = (tc) => Resident.prototype.modelTools.call(fake, tc).map((t) => t.function.name);
assert.deepEqual(names({ kind: "helper" }), ["run_command", "done", "share_file"]);
assert.deepEqual(names({ kind: "helper", onlyTools: DONE_ONLY }), ["done"]);
assert.match(WORKER_LIMIT_ASK, /call done now with your final report/i);
ok("only done stays when onlyTools is set");

// both engines wire it for workers only
const res = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8"), pi = readFileSync(new URL("../src/pi-engine.js", import.meta.url), "utf8");
assert.match(res, /workerLast = !!tc\.helper\?\.dynamic_routing/); assert.match(res, /tc\.onlyTools = DONE_ONLY/); assert.match(res, /doneResponseFromMarkup\(r\.reply\)/);
assert.match(pi, /tools: \[doneTool\]/); assert.match(pi, /delete tc\.onlyTools/);
ok("both engines keep done for a worker");
console.log(`PASS worker-limit-done: ${passed} scenarios`); process.exit(0);
