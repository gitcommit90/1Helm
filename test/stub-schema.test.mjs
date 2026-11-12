// Short tool stubs (src/payload-cut.js) must be valid for every provider family, for every tool, at any nesting depth.
// Found on dev 2026-10-15: google/gemini-4-argon answered 400 "function_declarations[28] ... items: missing field" for interview
// (questions[].options was an array with no items) and for propose_plan (questions[].items), because the stub stopped at depth 3.
import assert from "node:assert/strict";
import { Resident } from "../src/resident.js";
import { stubTool } from "../src/payload-cut.js";
import { withStepTitles } from "../src/tracker.js";

// Rules that every provider shares (Google, OpenAI style, Anthropic, MiMo, DeepSeek), checked on one parameters schema.
// Returns a list of problems with the path of each.
function problems(s, path = "parameters", top = true) {
  const out = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return [`${path}: schema must be an object`];
  if (top && s.type !== "object") out.push(`${path}: top level type must be object`);
  if (s.type === "array" && !(s.items && typeof s.items === "object" && !Array.isArray(s.items))) out.push(`${path}: array without items`);
  if (s.properties !== undefined) {
    if (s.type !== "object") out.push(`${path}: properties without type object`);
    if (!s.properties || typeof s.properties !== "object" || Array.isArray(s.properties)) out.push(`${path}: properties must be an object`);
  }
  if (s.required !== undefined) {
    if (!Array.isArray(s.required) || s.required.some((k) => typeof k !== "string")) out.push(`${path}: required must be a list of names`);
    else for (const k of s.required) if (!s.properties || !Object.hasOwn(s.properties, k)) out.push(`${path}: required name ${k} is not in properties`);
  }
  if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) out.push(`${path}: enum must be a non-empty list`);
  for (const k of ["$ref", "oneOf", "anyOf", "allOf", "not", "patternProperties", "$defs", "definitions"]) if (k in s) out.push(`${path}: keyword ${k} is not accepted by Google`);
  // Google: every nested schema needs a type, and an enum only goes with a string type.
  if (!top && s.type === undefined && !(path.endsWith(".items") && Object.keys(s).length === 0)) out.push(`${path}: nested schema without type`);
  if (s.enum && s.type !== "string" && s.type !== undefined && !s.enum.every((v) => typeof v === "string")) out.push(`${path}: Google accepts enum only for strings`);
  for (const [k, v] of Object.entries(s.properties || {})) out.push(...problems(v, `${path}.properties[${k}]`, false));
  if (s.items && typeof s.items === "object") out.push(...problems(s.items, `${path}.items`, false));
  return out;
}
const toolProblems = (list) => list.flatMap((t, i) => {
  const f = t.function, p = [];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(f.name || "")) p.push("bad name");
  if (typeof f.description !== "string") p.push("description must be a string");
  p.push(...problems(f.parameters));
  return p.map((m) => `[${i}] ${f.name}: ${m}`);
});

const mk = (channel) => ({ env: { ONEHELM_EE: "1hc", COMPOSIO_KEY: "x", PAYLOAD_CUT: "on" }, get: () => channel, workmemOn: () => true, browserAgentOn: () => true, scOn: () => true, conns: async () => [],
  tools: Resident.prototype.tools, availableTools: Resident.prototype.availableTools });
const lists = {};
for (const [label, channel] of [["main", "main"], ["other", "side"]]) {
  lists[label] = Resident.prototype.modelTools.call(mk(channel), { context: { version: 2 }, appendRuntime: true, appendLazy: true });
  assert.ok(lists[label].length >= 70, `${label}: every tool is in the list (${lists[label].length})`);
  assert.deepEqual(toolProblems(lists[label]), [], `${label}: stub list is valid for every provider`);
}
// Every non-eager tool really is a stub here, and the two tools that failed on Google keep items at every array.
const byName = (l, n) => l.find((t) => t.function.name === n).function.parameters;
const interview = byName(lists.main, "interview").properties.questions;
assert.equal(interview.type, "array");
assert.equal(interview.items.properties.options.type, "array");
assert.ok(interview.items.properties.options.items, "interview questions[].options keeps items");
const plan = byName(lists.main, "propose_plan");
const arrays = []; (function w(s, p) { if (!s || typeof s !== "object") return; if (s.type === "array") arrays.push(p); for (const [k, v] of Object.entries(s.properties || {})) w(v, p + "." + k); if (s.items) w(s.items, p + "[]"); })(plan, "");
assert.ok(arrays.length > 0 && toolProblems([{ function: { name: "propose_plan", description: "", parameters: plan } }]).length === 0, "propose_plan arrays keep items");

// A stub never needs more than the real schema had: same tool names, and full tools stay valid too.
const full = Resident.prototype.modelTools.call({ ...mk("main"), env: { ONEHELM_EE: "1hc", COMPOSIO_KEY: "x", PAYLOAD_CUT: "off" } }, { context: { version: 2 }, appendRuntime: true });
assert.deepEqual(toolProblems(full), [], "full tools are valid for every provider");
assert.deepEqual(lists.main.map((t) => t.function.name), full.map((t) => t.function.name));

// Every stub of every real tool, with the reproduction of the old depth cut to show the validator catches it.
const oldSkeleton = (x, depth = 0) => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return x;
  const o = {};
  for (const k of ["type", "enum", "required"]) if (x[k] !== undefined) o[k] = x[k];
  if (x.properties && depth < 3) o.properties = Object.fromEntries(Object.entries(x.properties).map(([k, v]) => [k, oldSkeleton(v, depth + 1)]));
  if (x.items && depth < 3) o.items = oldSkeleton(x.items, depth + 1);
  return o;
};
const oldList = full.map((t) => ({ function: { ...t.function, parameters: oldSkeleton(t.function.parameters) } }));
const oldBad = toolProblems(oldList).filter((m) => /array without items/.test(m));
assert.ok(oldBad.some((m) => /interview/.test(m)) && oldBad.some((m) => /propose_plan/.test(m)), "validator flags the old skeleton for interview and propose_plan");

// Edge cases. An empty items schema was accepted by google/gemini-4-argon in a real call (2026-10-15).
const edge = stubTool({ function: { name: "t", description: "A. B.", parameters: { type: "object", properties: { a: { type: "array" }, b: { type: "array", items: { type: "array", items: { type: "array", items: { type: "array", items: { type: "object", properties: { c: { type: "array", items: { type: "string" } } }, required: ["c", "zz"] } } } } } }, required: ["a", "gone"] } } });
assert.deepEqual(problems(edge.function.parameters), []);
assert.deepEqual(edge.function.parameters.required, ["a"]);
assert.equal(edge.function.description, "A.");
console.log("stub-schema ok");
