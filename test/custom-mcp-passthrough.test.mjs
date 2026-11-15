// node --import ./test/stubs/register.mjs test/custom-mcp-passthrough.test.mjs
// Custom MCP calls are a direct pass-through (no schema checks of ours); Composio apps keep a nullable-aware "required" check.
import assert from "node:assert/strict";
import { makeHarness, SERVER, say } from "./custom-mcp-harness.mjs";
import { runAppTool } from "../src/ee/composio.js";
import { withCustomRows } from "../src/ee/custom-mcp.js";
import { lackingInputs } from "../src/ee/composio-schema.js";

let n = 0; const ok = (name) => { n++; say(`ok ${n} - ${name}`); };
const URL1 = "https://courts.acme-demo.dev/mcp";
const NUL = (type) => ({ anyOf: [{ type }, { type: "null" }] });
const props = { action: { type: "string" }, limit: NUL("integer"), query: NUL("string"), database_id: { oneOf: [{ type: "integer" }, { type: "null" }] } };
const TOOLS = [{ name: "browse_data", description: "Browse.", props, required: ["action", "limit", "query", "database_id"] }];

const H = makeHarness({ latest: true }), { C, api, env, rows, enable, REQ } = H;
C.servers[URL1] = { auth: "none", tools: TOOLS };
await enable(1); await enable(2);
const mk = async (who) => (await api(who, "POST", "/servers", { client_request_id: REQ(), name: "Courts", url: URL1, auth: { type: "none" } })).json.server;
const s1 = await mk(1); assert.equal(s1.status, "connected");
const SLUG = rows().find((r) => r.id === s1.id).slug;
const conns = async (t) => withCustomRows(env, t, []);
const run = async (t, a) => runAppTool(env, t, "app_run", a, await conns(t), { confirm: async () => null });
const ran = () => C.executed.filter((x) => /^CUSTOM_/.test(x.slug || ""));

// omitted and null "required" nullable fields go out exactly as written
let out = await run("t1", { action: `${SLUG}_BROWSE_DATA`, arguments: { action: "list_databases", limit: 10 } });
assert.match(out, /ok/, out); assert.deepEqual(ran().at(-1).args, { action: "list_databases", limit: 10 }); ok("omitted required nullable fields are sent unchanged");
out = await run("t1", { action: `${SLUG}_BROWSE_DATA`, arguments: { action: "x", limit: null, query: "", database_id: null } });
assert.match(out, /ok/, out); assert.deepEqual(ran().at(-1).args, { action: "x", limit: null, query: "", database_id: null }); ok("null and empty values are sent unchanged");
// an input name the schema doesn't have goes through too
out = await run("t1", { action: `${SLUG}_BROWSE_DATA`, arguments: { action: "x", surprise: 1 } });
assert.match(out, /ok/, out); assert.deepEqual(ran().at(-1).args, { action: "x", surprise: 1 }); ok("an unknown input name is sent unchanged");
// a path-looking string in a content-like input is not blocked
out = await run("t1", { action: `${SLUG}_BROWSE_DATA`, arguments: { action: "x", text: "/workspace/a.txt" } });
assert.match(out, /ok/, out); assert.equal(ran().at(-1).args.text, "/workspace/a.txt"); ok("ordinary strings are not rewritten or blocked");
// ownership still denied
const before = ran().length;
out = await run("t2", { action: `${SLUG}_BROWSE_DATA`, arguments: { action: "x" } });
assert.doesNotMatch(out, /\bok\b/, out); assert.equal(ran().length, before); ok("another workspace is still denied");

// Composio rule
const schema = { type: "object", properties: { a: { type: "string" }, b: NUL("string"), c: { type: ["integer", "null"] }, d: { type: "string", nullable: true }, e: { type: "integer" } }, required: ["a", "b", "c", "d", "e"] };
assert.deepEqual(lackingInputs(schema, { a: "x", b: null, c: null, d: null, e: 1 }), []); ok("null is allowed when the schema allows null");
assert.deepEqual(lackingInputs(schema, { a: null, b: "x", c: 1, d: "y", e: null }), ["a", "e"]); ok("null is refused when the schema doesn't allow it");
assert.deepEqual(lackingInputs(schema, { a: "", b: "", c: 1, d: "", e: 2 }), []); ok("an empty string is allowed for a string");
assert.deepEqual(lackingInputs(schema, { a: "x", c: 1, d: "y", e: "" }), ["b", "e"]); ok("omitted inputs and an empty string for a number are refused");
say(`${n} passed`);
