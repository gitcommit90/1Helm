// node --import ./test/stubs/register.mjs test/design-mcp.test.mjs
// Design MCP Worker (design-mcp/): the four endpoints with fetch mocked (initialize, tools/list, tools/call, errors, the Better Design
// forward with its key and session id), the python client against the handler over a local HTTP server, and the guidance text that
// points agents at the sources. No network.
import assert from "node:assert";
import http from "node:http";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import worker from "../design-mcp/src/index.js";
import { clearRegistryCache } from "../design-mcp/src/registry.js";
import { readSkill } from "../src/skills/index.js";
import { FILES } from "../src/skills/bundle.js";
import { staticCore, render, SECTIONS } from "../src/prompt/index.js";
import { DESIGNED_WORK, HELPER_PROMPT } from "../src/helpers.js";

const ok = (name) => console.log("  ok", name);
const ORIGIN = "https://mcp.test";
const KEY = "test-key-123";

// ---- mocked upstreams ----
const MAGIC_REGISTRY = { items: [
  { name: "marquee", type: "registry:ui", title: "Marquee", description: "An infinite scrolling component for text, images or videos.", dependencies: ["motion"] },
  { name: "marquee-demo", type: "registry:example", description: "Marquee demo", registryDependencies: ["https://magicui.design/r/marquee.json"] },
  { name: "magic-card", type: "registry:ui", title: "Magic Card", description: "A spotlight effect that follows your cursor." },
  { name: "index", type: "registry:style" },
] };
const RB_REGISTRY = { items: [
  { name: "Aurora-JS-CSS", type: "registry:component", title: "Aurora", description: "A soft aurora background." },
  { name: "Aurora-TS-CSS", type: "registry:component", title: "Aurora", description: "A soft aurora background." },
] };
const CU_REGISTRY = { items: [
  { name: "ascii-object-vanilla", type: "registry:component", title: "AsciiObject (Vanilla)", description: "ASCII glyphs that trace a 3D object.", dependencies: ["three"] },
] };
const ITEM = (name, text) => ({ name, type: "registry:ui", files: [{ path: `${name}.tsx`, content: text }] });
const BODIES = {
  "https://magicui.design/registry.json": MAGIC_REGISTRY,
  "https://magicui.design/r/marquee.json": ITEM("marquee", "export function Marquee() {}"),
  "https://magicui.design/r/marquee-demo.json": { name: "marquee-demo", type: "registry:example", description: "Marquee demo", files: [{ path: "demo.tsx", content: "<Marquee/>" }] },
  "https://reactbits.dev/r/registry.json": RB_REGISTRY,
  "https://reactbits.dev/r/Aurora-JS-CSS.json": ITEM("Aurora-JS-CSS", "export default function Aurora() {}"),
  "https://canvasui.dev/r/registry.json": CU_REGISTRY,
  "https://canvasui.dev/r/ascii-object-vanilla.json": ITEM("ascii-object-vanilla", "export function ascii() {}"),
};
let calls = [];
const mockFetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  calls.push({ url, init });
  if (url === "https://better-design.com/api/mcp") {
    const h = new Headers(init.headers);
    const body = init.body ? JSON.parse(Buffer.from(init.body).toString()) : null;
    const out = { "content-type": "application/json", "set-cookie": "x=1", "x-secret-upstream": "no" };
    if (body && body.method === "initialize") out["mcp-session-id"] = "sess-42";
    if (h.get("accept") && /event-stream/.test(h.get("accept")) && body && body.method === "tools/list") {
      return new Response('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"get-ux-principle"}]}}\n\n', { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body && body.id, result: { echoAuth: h.get("authorization"), echoSession: h.get("mcp-session-id") } }), { headers: out });
  }
  if (url in BODIES) return new Response(JSON.stringify(BODIES[url]), { headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404, statusText: "Not Found" });
};
globalThis.fetch = mockFetch;

const send = (path, body, headers = {}, env = { BETTER_DESIGN_KEY: KEY }) =>
  worker.fetch(new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
const rpc = async (path, method, params, id = 1) => (await send(path, { jsonrpc: "2.0", id, method, params })).json();
const text = (r) => r.result.content[0].text;

// 1. The index lists the four endpoints; unknown paths are 404; GET on an endpoint is 405.
{
  const r = await worker.fetch(new Request(ORIGIN + "/"), {});
  const t = await r.text();
  for (const p of ["/magicui/mcp", "/reactbits/mcp", "/canvasui/mcp", "/better-design/mcp"]) assert.ok(t.includes(p), `index lists ${p}`);
  assert.equal((await worker.fetch(new Request(ORIGIN + "/nope"), {})).status, 404);
  assert.equal((await worker.fetch(new Request(ORIGIN + "/magicui/mcp"), {})).status, 405);
  assert.equal((await worker.fetch(new Request(ORIGIN + "/magicui/mcp/", { method: "POST", body: "{" }), {})).status, 400);
  assert.equal((await worker.fetch(new Request(ORIGIN + "/magicui/mcp", { method: "OPTIONS" }), {})).status, 204);
  ok("index text lists the endpoints; 404, 405, 400 and CORS preflight");
}

// 2. Registry servers: initialize, notification, tools/list, ping, unknown method.
for (const s of ["magicui", "reactbits", "canvasui"]) {
  const path = `/${s}/mcp`;
  const init = await rpc(path, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.match(init.result.serverInfo.name, new RegExp(s));
  assert.equal((await rpc(path, "initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, "2025-06-18", "unknown version gets the latest");
  const note = await send(path, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  const list = await rpc(path, "tools/list");
  assert.deepEqual(list.result.tools.map((t) => t.name), ["listRegistryItems", "getRegistryItem", "searchRegistryItems"]);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, "object");
  assert.deepEqual((await rpc(path, "ping")).result, {});
  assert.equal((await rpc(path, "nope")).error.code, -32601);
  assert.equal((await rpc(path, "tools/call", { name: "nope", arguments: {} })).error.code, -32602);
}
assert.match(JSON.stringify((await rpc("/reactbits/mcp", "tools/list")).result), /JS-CSS/);
assert.match(JSON.stringify((await rpc("/canvasui/mcp", "tools/list")).result), /vanilla/);
ok("registry servers: initialize, initialized notification, tools/list (same three tools), ping, errors");

// 3. Registry tool calls with fetch mocked.
{
  clearRegistryCache(); calls = [];
  let r = await rpc("/magicui/mcp", "tools/call", { name: "searchRegistryItems", arguments: { query: "marquee", limit: 5 } });
  let out = JSON.parse(text(r));
  assert.equal(out.items[0].name, "marquee");
  assert.deepEqual(out.availableKinds, ["component", "example", "style"]);
  r = await rpc("/magicui/mcp", "tools/call", { name: "listRegistryItems", arguments: { kind: "component" } });
  out = JSON.parse(text(r));
  assert.deepEqual(out.items.map((i) => i.name), ["magic-card", "marquee"]);
  assert.equal(out.total, 2); assert.equal(out.hasMore, false);
  assert.equal(calls.filter((c) => c.url.endsWith("registry.json")).length, 1, "the registry is fetched once and cached");
  r = await rpc("/magicui/mcp", "tools/call", { name: "getRegistryItem", arguments: { name: "marquee", includeSource: true, includeExamples: true, includeRelated: true } });
  out = JSON.parse(text(r));
  assert.equal(out.install.registryUrl, "https://magicui.design/r/marquee.json");
  assert.equal(out.install.command, 'npx shadcn@latest add "https://magicui.design/r/marquee.json"');
  assert.deepEqual(out.dependencies, ["motion"]);
  assert.match(out.source, /import \{ Marquee \} from "@\/components\/ui\/marquee";\/\/ File: marquee\.tsx\nexport function Marquee/);
  assert.equal(out.examples[0].name, "marquee-demo"); assert.equal(out.relatedItems[0].name, "marquee-demo");
  r = await rpc("/magicui/mcp", "tools/call", { name: "getRegistryItem", arguments: { name: "missing" } });
  assert.equal(r.result.isError, true); assert.match(text(r), /Failed to fetch registry item: Registry item "missing" was not found/);
  r = await rpc("/magicui/mcp", "tools/call", { name: "searchRegistryItems", arguments: {} });
  assert.equal(r.result.isError, true);
  r = await rpc("/reactbits/mcp", "tools/call", { name: "searchRegistryItems", arguments: { query: "aurora" } });
  assert.deepEqual(JSON.parse(text(r)).items.map((i) => i.name), ["Aurora-JS-CSS", "Aurora-TS-CSS"]);
  r = await rpc("/reactbits/mcp", "tools/call", { name: "getRegistryItem", arguments: { name: "Aurora-JS-CSS", includeSource: true } });
  out = JSON.parse(text(r));
  assert.equal(out.install.registryUrl, "https://reactbits.dev/r/Aurora-JS-CSS.json"); assert.match(out.source, /^\/\/ File: Aurora-JS-CSS\.tsx\nexport default function Aurora/);
  r = await rpc("/canvasui/mcp", "tools/call", { name: "getRegistryItem", arguments: { name: "ascii-object-vanilla", includeSource: true } });
  out = JSON.parse(text(r));
  assert.deepEqual(out.dependencies, ["three"]); assert.match(out.source, /function ascii/);
  const batch = await (await send("/canvasui/mcp", [{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }])).json();
  assert.equal(batch.length, 2);
  clearRegistryCache();
  globalThis.fetch = async () => new Response("", { status: 500, statusText: "Server Error" });
  r = await rpc("/magicui/mcp", "tools/call", { name: "listRegistryItems", arguments: {} });
  assert.equal(r.result.isError, true); assert.match(text(r), /Failed to list registry items: Failed to fetch registry\.json: Server Error \(Status: 500\)/);
  globalThis.fetch = mockFetch;
  clearRegistryCache();
  ok("registry tools: search, list, get with source/examples/related, errors, cache, paging fields, batch, upstream failure");
}

// 4. Better Design: forwarded with the Bearer key, the session id passes both ways, the body and status come back unchanged.
{
  calls = [];
  const init = { jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-03-26" } };
  const r = await send("/better-design/mcp", init, { authorization: "Bearer caller-sent-this", "mcp-session-id": "from-client", "mcp-protocol-version": "2025-03-26" });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("mcp-session-id"), "sess-42", "the upstream session id comes back");
  assert.equal(r.headers.get("set-cookie"), null); assert.equal(r.headers.get("x-secret-upstream"), null);
  assert.equal(body.result.echoAuth, `Bearer ${KEY}`, "our key replaces whatever the caller sent");
  assert.equal(body.result.echoSession, "from-client", "the caller's session id goes upstream");
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://better-design.com/api/mcp"); assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].init.body).toString()), init, "the request body is forwarded unchanged");
  const sse = await send("/better-design/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, { accept: "application/json, text/event-stream" });
  assert.equal(sse.headers.get("content-type"), "text/event-stream");
  assert.match(await sse.text(), /get-ux-principle/);
  const none = await send("/better-design/mcp", init, {}, {});
  assert.equal(none.status, 503); assert.match((await none.json()).error.message, /BETTER_DESIGN_KEY/);
  assert.equal(calls.length, 2, "no upstream call without a key");
  ok("better-design: Bearer key added, session id both ways, SSE passes through, body unchanged, 503 without a key");
}

// 5. The python client against the handler over a local HTTP server (the same script the agent runs).
{
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`http://x${req.url}`, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), { BETTER_DESIGN_KEY: KEY });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = new URL("../src/skills/artifacts/scripts/design_mcp.py", import.meta.url).pathname;
  const py = (...args) => new Promise((resolve) => execFile("python3", ["-I", script, ...args], { env: { ...process.env, DESIGN_MCP_URL: base } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
  try {
    clearRegistryCache();
    let r = await py("magicui", "tools");
    assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^listRegistryItems: /m); assert.match(r.stdout, /name \(string, required\)/);
    r = await py("magicui", "searchRegistryItems", '{"query":"card"}');
    assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).items[0].name, "magic-card");
    r = await py("reactbits", "getRegistryItem", '{"name":"Aurora-JS-CSS","includeSource":true}');
    assert.equal(r.code, 0, r.stderr); assert.match(JSON.parse(r.stdout).source, /Aurora/);
    r = await py("canvasui", "listRegistryItems");
    assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).total, 1);
    r = await py("magicui", "getRegistryItem", '{"name":"missing"}');
    assert.equal(r.code, 1); assert.match(r.stderr, /was not found/); assert.equal(r.stdout, "");
    r = await py("magicui", "searchRegistryItems", "{bad");
    assert.equal(r.code, 1); assert.match(r.stderr, /not valid JSON/);
    r = await py("nope", "tools");
    assert.equal(r.code, 1); assert.match(r.stderr, /usage/);
    calls = [];
    r = await py("better-design", "anything", "{}");
    assert.equal(r.code, 0, r.stderr);
    const bd = calls.filter((c) => c.url === "https://better-design.com/api/mcp").map((c) => JSON.parse(Buffer.from(c.init.body).toString()).method);
    assert.deepEqual(bd, ["initialize", "notifications/initialized", "tools/call"], "initialize first, then the initialized notification, then the call");
    const sessions = calls.filter((c) => c.url === "https://better-design.com/api/mcp").map((c) => new Headers(c.init.headers).get("mcp-session-id"));
    assert.deepEqual(sessions, [null, "sess-42", "sess-42"], "the client carries the session id the server returned");
  } finally { server.close(); }
  ok("design_mcp.py: tools listing, calls on every registry server, errors exit 1 on stderr, initialize first and session id carried");
}

// 6. Guidance text names the sources, the script and the real tool names, and says to use them quietly.
{
  const script = "/opt/1hc/skills/artifacts/scripts/design_mcp.py";
  assert.ok(FILES["artifacts/scripts/design_mcp.py"], "the script is bundled");
  for (const [name, t] of [["web-page", readSkill({ slug: "artifacts", ref: "web-page" }, {})], ["presentation", readSkill({ slug: "artifacts", ref: "presentation" }, {})], ["pdf-design", readSkill({ slug: "artifacts", ref: "pdf-design" }, {})]]) {
    assert.match(t, /artifacts skill/, `${name} points at the list in the artifacts skill`);
    assert.match(t, /Better Design/); assert.match(t, /find-design-system/); assert.match(t, /get-review-rules/);
  }
  const list = readSkill({ slug: "artifacts" }, { apps: true });
  assert.ok(list.includes(script), "the artifacts skill shows the script");
  assert.match(list, /better-design/); assert.match(list, /without mentioning them to the person/); assert.match(list, /go on without it/);
  for (const w of ["Inspo", "Better Design", "Magic UI", "React Bits", "Canvas UI", "Use for:"]) assert.ok(list.includes(w), `the list has ${w}`);
  assert.equal((list.match(/Use for:/g) || []).length, 5, "each of the five sources says what to use it for");
  const web = readSkill({ slug: "artifacts", ref: "web-page" }, {});
  for (const w of ["get-motion-guide", "get-ux-principle", "find-icons"]) assert.ok(web.includes(w), `web-page names ${w}`);
  for (const w of ["magicui", "reactbits", "canvasui", "searchRegistryItems", "getRegistryItem", "get-design-system-kit", "extract-from-url", "-JS-CSS", "-vanilla"]) assert.ok(list.includes(w), `the list names ${w}`);
  const BD = ["find-design-system", "get-design-system-kit", "get-ux-principle", "get-ui-principle", "get-motion-guide", "find-icons", "get-review-rules"];
  for (const n of BD) assert.ok(/^[a-z]+(-[a-z]+)+$/.test(n));
    assert.match(readFileSync(new URL("../src/skills/business-setup/SKILL.md", import.meta.url), "utf8"), /artifacts skill's list/);
  assert.match(readFileSync(new URL("../src/prompt/07-tools.md", import.meta.url), "utf8"), /\{\{designed_work\}\}/);
  ok("guidance points at the design sources with the script and real tool names, quietly, with a fall-through");
}

// 7. The designed-work line reaches every prompt: full, lean, layered, the native worker's own prompt, and the start_helper guidance.
{
  const base = { apps: true, compact: true, recall: true, cards: true };
  const sets = { full: base, lean: { ...base, append: true, lean_families: true }, layered: { ...base, context_v2: true }, "layered lean": { ...base, context_v2: true, append: true, lean_families: true }, "no apps": { compact: true } };
  for (const [name, f] of Object.entries(sets)) {
    const core = staticCore(f);
    assert.ok(core.includes(DESIGNED_WORK), `the ${name} prompt contains the designed-work line`);
    assert.equal(core.split(DESIGNED_WORK).length, 2, `the ${name} prompt has it once`);
  }
  for (const w of ["Inspo", "Better Design", "Magic UI", "React Bits", "Canvas UI", "read_skill", "artifacts skill"]) assert.ok(DESIGNED_WORK.includes(w), `the line names ${w}`);
  const resident = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(resident, /A plain response does not end the job\. " \+ DESIGNED_WORK/, "the native worker's own prompt ends with the designed-work line");
  const helpers = render(SECTIONS.find(([n]) => n === "08-background-helpers")[1], base);
  for (const t of [HELPER_PROMPT, helpers]) {
    assert.match(t, /web page, site, deck or designed PDF, the brief tells the helper to read the artifacts skill first and follow its design-sources step/);
    assert.match(t, /A helper can't run Inspo/);
  }
  ok("the designed-work line is in the full, lean and layered prompts and the native worker prompt; start_helper guidance says to put the rule in the brief");
}
console.log("design-mcp.test.mjs: all ok");
