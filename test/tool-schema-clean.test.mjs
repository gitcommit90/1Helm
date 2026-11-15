// node --import ./test/stubs/register.mjs test/tool-schema-clean.test.mjs
// The cleaner for schemas that come from outside 1Helm (src/tool-schema-clean.js), and the design tools path that uses it. No network, no model.
import { cleanToolSchema, safePattern } from "../src/tool-schema-clean.js";
import { designToolDefs, prepareDesignTools, resetDesignToolsCache } from "../src/design-tools.js";
import assert from "node:assert/strict";
const ok = (m) => console.log("  ok", m);
const BD = { type: "object", properties: { device: { type: "string", description: "device name", pattern: "^[\\p{L}\\p{N}][\\p{L}\\p{N} ._'\\u2019()-]{0,99}$", maxLength: 100 } }, required: ["device"] };
const c = cleanToolSchema(BD);
assert.equal("pattern" in c.properties.device, false); assert.deepEqual(c.properties.device, { type: "string", description: "device name", maxLength: 100 }); assert.deepEqual(c.required, ["device"]);
assert.ok("pattern" in BD.properties.device, "input not changed"); ok("Better Design device pattern dropped, rest intact");
for (const p of ["^[a-z]+$", "^\\d{4}-\\d{2}$", "^(?:a|b)+$", "^(?=a)b", "^[\\w.-]+@[\\w.-]+$"]) assert.ok(safePattern(p), p);
for (const p of ["\\p{L}", "\\P{N}", "(?<=a)b", "(?<!a)b", "(?<name>a)", "(a", "\\k<x>", "\\u{1F600}", "(?i)a", 5]) assert.ok(!safePattern(p), String(p));
ok("simple patterns kept, risky or broken patterns dropped");
const deep = { type: "object", properties: {
  a: { type: "array", items: { type: "string", pattern: "\\p{L}" } },
  b: { anyOf: [{ type: "string", pattern: "^ok$" }, { type: "string", pattern: "(?<=x)y" }] },
  c: { type: "object", additionalProperties: { type: "string", pattern: "\\p{N}" }, patternProperties: { "^\\p{L}+$": { type: "string" }, "^x": { type: "string", pattern: "^1$" } } },
  d: { type: "array", prefixItems: [{ type: "string", pattern: "\\P{L}" }], items: false },
  pattern: { type: "string", enum: ["\\p{L}"], default: "\\p{L}" } },
  $defs: { z: { type: "string", pattern: "\\p{Lu}" } }, allOf: [{ properties: { q: { pattern: "(a" } } }], oneOf: [{ not: { pattern: "\\p{L}" } }] };
const d = cleanToolSchema(deep);
assert.equal("pattern" in d.properties.a.items, false); assert.equal(d.properties.b.anyOf[0].pattern, "^ok$"); assert.equal("pattern" in d.properties.b.anyOf[1], false);
assert.equal("pattern" in d.properties.c.additionalProperties, false); assert.deepEqual(Object.keys(d.properties.c.patternProperties), ["^x"]); assert.equal(d.properties.c.patternProperties["^x"].pattern, "^1$");
assert.equal("pattern" in d.properties.d.prefixItems[0], false); assert.equal(d.properties.d.items, false);
assert.deepEqual(d.properties.pattern, deep.properties.pattern, "a property named pattern, its enum and default are untouched");
assert.equal("pattern" in d.$defs.z, false); assert.equal("pattern" in d.allOf[0].properties.q, false); assert.equal("pattern" in d.oneOf[0].not, false);
ok("nested properties, items, anyOf, additionalProperties, patternProperties, prefixItems, $defs, allOf, oneOf, not");
// the design tools path: a server list with the Better Design schema reaches the model cleaned; the stored schema (used to check arguments) is the server's own
resetDesignToolsCache();
const fetchImpl = async (url, init) => {
  const m = JSON.parse(init.body); const h = { "content-type": "application/json" };
  const r = m.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "x", version: "1" } } : m.method === "tools/list" ? { tools: [{ name: "use_device", description: "d", inputSchema: BD }] } : {};
  if (m.id === undefined) return new Response(null, { status: 202, headers: h });
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: r }), { status: 200, headers: h });
};
await prepareDesignTools({ DESIGN_MCP_URL: "https://design.example.test" }, { fetchImpl });
const defs = designToolDefs({ betterDesign: true }).filter((t) => t.function.name.endsWith("use_device"));
assert.ok(defs.length >= 1, "use_device offered");
for (const t of defs) assert.equal("pattern" in t.function.parameters.properties.device, false);
ok("design tools: every use_device definition sent to the model has no pattern");
console.log("PASS tool-schema-clean");
