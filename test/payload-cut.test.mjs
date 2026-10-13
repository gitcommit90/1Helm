import assert from "node:assert/strict";
import { Resident } from "../src/resident.js";
import { staticCore, familyGuidance } from "../src/prompt/index.js";
import { FAMILIES, guidanceFor, checkArgs, coerceArgs } from "../src/payload-cut.js";
import { EAGER_TOOLS } from "../src/context.js";
import { withStepTitles } from "../src/tracker.js";

const flags = { browser_task: true, apps: true, app_events: true, recall: true, compact: true, cards: true, context_v2: true };
const mk = (cut) => ({ env: { ONEHELM_EE: "1hc", COMPOSIO_KEY: "x", PAYLOAD_CUT: cut ? "on" : "off" }, get: () => "main", workmemOn: () => true, browserAgentOn: () => true, scOn: () => true, conns: async () => [],
  tools: Resident.prototype.tools, availableTools: Resident.prototype.availableTools });
const names = (l) => l.map((t) => t.function.name);

// Off: the core is unchanged and the task keeps every tool.
const off = mk(false), tcOff = { context: { version: 2 }, appendRuntime: true };
assert.equal(staticCore(flags), staticCore({ ...flags, lean_families: false }));
assert.ok(Resident.prototype.modelTools.call(off, tcOff).length > 70, "flag off: full tool list");
assert.ok(JSON.stringify(Resident.prototype.modelTools.call(off, tcOff)).includes("e.g. \\\"Searched memory"), "flag off: full step_title description");

// On: a lazy task sends every tool from turn 0; non-eager tools are stubs with loose parameters; step_title stays first and required.
const on = mk(true), tc = { context: { version: 2 }, appendRuntime: true, appendLazy: true };
const base = Resident.prototype.modelTools.call(on, tc), fullList = Resident.prototype.modelTools.call(off, tcOff);
assert.deepEqual(names(base), names(fullList), "same tools, same order");
const stub = base.find((t) => t.function.name === "schedule_workflow"), real = fullList.find((t) => t.function.name === "schedule_workflow");
assert.equal(stub.function.parameters.additionalProperties, true);
assert.ok(!JSON.stringify(stub.function.parameters).includes("description") || /"description":"Past tense/.test(JSON.stringify(stub.function.parameters)), "no per-field descriptions except the short step_title");
assert.equal(base.find((t) => t.function.name === "interview").function.parameters.properties.questions.type, "array", "array fields stay typed");
assert.ok(JSON.stringify(stub).length < JSON.stringify(real).length * 0.6, "stub is smaller");
assert.equal(JSON.stringify(base.find((t) => t.function.name === "run_command")), JSON.stringify(fullList.find((t) => t.function.name === "run_command")).replace(/"step_title":\{[^}]*\}/, (m) => JSON.stringify({ step_title: base[0].function.parameters.properties.step_title }).slice(1, -1)), "eager tools keep their full schema");
assert.ok(base.every((t) => t.function.parameters.required[0] === "step_title"));
assert.ok(JSON.stringify(base).length < JSON.stringify(fullList).length * 0.6, "list is much smaller");
// Loading does not change the list at all.
tc.appendTools = base; tc.loadedTools = new Set(["schedule_workflow", "buy_with_link"]);
assert.equal(Resident.prototype.modelTools.call(on, tc), base);

// Argument check against the real schema.
const sw = real.function.parameters;
assert.ok(checkArgs({ step_title: "x" }, sw).length > 0 || (sw.required || []).filter((k) => k !== "step_title").length === 0, "missing required fields are reported");
assert.deepEqual(checkArgs({ a: 1 }, { type: "object", properties: { a: { type: "string" } }, required: ["a"] }), ["a must be string"]);
assert.deepEqual(checkArgs({}, { type: "object", properties: { a: { type: "string" } }, required: ["a"] }), ["missing required field a"]);
assert.deepEqual(checkArgs({ a: "x", extra: 1 }, { type: "object", properties: { a: { type: "string", enum: ["x", "y"] } }, required: ["a"] }), []);
assert.deepEqual(checkArgs({ a: ["q"] }, { type: "object", properties: { a: { type: "array", items: { type: "integer" } } } }), ["a[0] must be integer"]);
assert.deepEqual(coerceArgs({ q: "[1,2]", s: "[x" }, { properties: { q: { type: "array" }, s: { type: "array" } } }), { q: [1, 2], s: "[x" });
assert.deepEqual(checkArgs({ a: 1 }, { type: "object", properties: { a: { oneOf: [{ type: "string" }] } } }), [], "unknown keywords are ignored");

// A task stored with the full list (made before the flag) ignores loads and stays exact.
const old = { context: { version: 2 }, appendRuntime: true, appendTools: Resident.prototype.modelTools.call(off, tcOff), loadedTools: new Set(["schedule_workflow"]) };
assert.equal(Resident.prototype.modelTools.call(on, old), old.appendTools);

// Core without family guidance, and the guidance comes back by family, once.
const lean = staticCore({ ...flags, lean_families: true }), full = staticCore(flags);
assert.ok(lean.length < full.length);
const g = familyGuidance(flags);
for (const f of FAMILIES) { assert.ok(g[f.id] && g[f.id].length > 100, `guidance for ${f.id}`); assert.ok(!lean.includes(g[f.id]), `${f.id} removed from the core`); assert.ok(full.includes(g[f.id]), `${f.id} present in the full core`); }
assert.ok(lean.includes("### Your computer") && lean.includes("### The browser") && lean.includes("### Connected apps"), "other subsections stay");
assert.equal(guidanceFor(["schedule_workflow"], new Set(), g).length, 1);
assert.equal(guidanceFor(["list_workflows"], new Set(["schedule_workflow"]), g).length, 0, "already delivered");
assert.equal(guidanceFor(["run_command"], new Set(), g).length, 0);
assert.equal(withStepTitles([{ type: "function", function: { name: "a", parameters: { type: "object", properties: {} } } }])[0].function.parameters.properties.step_title.description.includes("Searched memory"), true, "default stays full");
console.log("payload-cut ok");

// runTool: a stubbed call with wrong arguments, or the first call in a guidance family, is not run and returns the schema.
{
  const o = Object.assign(mk(true), { promptFlags: () => flags, genuiOn: () => true });
  const meta = []; const ctx = { context: { version: 2 }, appendRuntime: true, appendLazy: true, loadedTools: new Set(), transcript: { metadata: (m) => meta.push(m) } };
  const call = (name, args) => ({ id: "c1", function: { name, arguments: JSON.stringify(args) } });
  const bad = await Resident.prototype.runTool.call(o, call("pomodoro", { step_title: "x", minutes: "soon" }), ctx);
  assert.match(bad, /^error: this call was not run/); assert.match(bad, /"name":"pomodoro"/); assert.ok(meta.length === 1);
  const first = await Resident.prototype.runTool.call(o, call("schedule_followup", { step_title: "x" }), { ...ctx, loadedTools: new Set() });
  assert.match(first, /guidance/); assert.match(first, /not run/);
}
console.log("runTool stub ok");
