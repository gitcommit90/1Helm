// node --import ./test/stubs/register.mjs test/design-mcp.test.mjs
// Design MCP Worker (design-mcp/): the endpoints with fetch mocked (initialize, tools/list, tools/call, errors, the Better Design
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
import { DESIGNED_WORK, DESIGNED_WORK_NO_BD, HELPER_PROMPT } from "../src/helpers.js";

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
  for (const p of ["/magicui/mcp", "/reactbits/mcp", "/canvasui/mcp", "/better-design/mcp", "/inspo/mcp", "/brief/mcp"]) assert.ok(t.includes(p), `index lists ${p}`);
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

const BD_ON = { better_design: true };   // an account where Better Design is on (src/better-design.js)
// 6. Guidance text names the sources, the script and the real tool names, and says to use them quietly.
{
  const script = "/opt/1hc/skills/artifacts/scripts/design_mcp.py";
  assert.ok(FILES["artifacts/scripts/design_mcp.py"], "the script is bundled");
  for (const [name, t] of [["web-page", readSkill({ slug: "artifacts", ref: "web-page" }, BD_ON)], ["pdf-design", readSkill({ slug: "artifacts", ref: "pdf-design" }, BD_ON)]]) {
    assert.match(t, /artifacts skill/, `${name} points at the list in the artifacts skill`);
    assert.match(t, /Better Design/); assert.match(t, /better_design_find_design_system/); assert.match(t, /better_design_get_review_rules/);
  }
  const list = readSkill({ slug: "artifacts" }, { apps: true, better_design: true });
  assert.ok(!list.includes(script), "the artifacts skill no longer names the script");
  assert.match(list, /better_design_/); assert.match(list, /without mentioning them to the person/); assert.match(list, /go on without it/);
  for (const w of ["Inspo", "Better Design", "Magic UI", "React Bits", "Canvas UI", "Use for:"]) assert.ok(list.includes(w), `the list has ${w}`);
  assert.equal((list.match(/Use for:/g) || []).length, 5, "each of the five sources says what to use it for");
  const web = readSkill({ slug: "artifacts", ref: "web-page" }, BD_ON);
  for (const w of ["better_design_get_motion_guide", "better_design_get_ux_principle", "better_design_find_icons"]) assert.ok(web.includes(w), `web-page names ${w}`);
  for (const w of ["magicui", "reactbits", "canvasui", "searchRegistryItems", "getRegistryItem", "get_design_system_kit", "extract_from_url", "-JS-CSS", "-vanilla"]) assert.ok(list.includes(w), `the list names ${w}`);
  const BD = ["find-design-system", "get-design-system-kit", "get-ux-principle", "get-ui-principle", "get-motion-guide", "find-icons", "get-review-rules"];
  for (const n of BD) assert.ok(/^[a-z]+(-[a-z]+)+$/.test(n));
    assert.match(readFileSync(new URL("../src/skills/business-setup/SKILL.md", import.meta.url), "utf8"), /artifacts skill's list/);
  assert.match(readFileSync(new URL("../src/prompt/07-tools.md", import.meta.url), "utf8"), /\{\{designed_work\}\}/);
  ok("guidance points at the design sources with the script and real tool names, quietly, with a fall-through");
}

// 7. The designed-work line reaches every prompt: full, lean, layered, the native worker's own prompt, and the start_helper guidance.
{
  const base = { apps: true, compact: true, recall: true, cards: true, better_design: true };
  const sets = { full: base, lean: { ...base, append: true, lean_families: true }, layered: { ...base, context_v2: true }, "layered lean": { ...base, context_v2: true, append: true, lean_families: true }, "no apps": { compact: true, better_design: true } };
  for (const [name, f] of Object.entries(sets)) {
    const core = staticCore(f);
    assert.ok(core.includes(DESIGNED_WORK), `the ${name} prompt contains the designed-work line`);
    assert.equal(core.split(DESIGNED_WORK).length, 2, `the ${name} prompt has it once`);
  }
  for (const w of ["Inspo", "Better Design", "Magic UI", "React Bits", "Canvas UI", "read_skill", "artifacts skill", "inspo_search_screens", "better_design_find_design_system", "better_design_get_design_system_kit", "magicui_", "reactbits_", "canvasui_", "searchRegistryItems", "getRegistryItem", ":root", "first .html file written in a task"]) assert.ok(DESIGNED_WORK.includes(w), `the line names ${w}`);
  assert.ok(DESIGNED_WORK.length < 900, "the line stays short");
  assert.ok(!/design_mcp/.test(DESIGNED_WORK) && !/design_mcp/.test(DESIGNED_WORK_NO_BD), "the designed-work lines never tell the model to run design_mcp.py");
  assert.ok(/inspo_/.test(DESIGNED_WORK_NO_BD) && /magicui_/.test(DESIGNED_WORK_NO_BD) && !/better_design|Better Design/.test(DESIGNED_WORK_NO_BD), "without Better Design the line names the other design tools and no better_design_ tool");
  const resident = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(resident, /A plain response does not end the job\. " \+ \(this\._betterDesign \? DESIGNED_WORK : DESIGNED_WORK_NO_BD\)/, "the native worker's own prompt ends with the designed-work line");
  const helpers = render(SECTIONS.find(([n]) => n === "08-background-helpers")[1], base);
  for (const t of [HELPER_PROMPT, helpers]) {
    assert.match(t, /web page or site, the brief tells the helper to read the artifacts skill first and follow its design-sources step/);
    assert.match(t, /1Helm adds the design brief to the first \.html file a helper writes/);
    assert.ok(!t.includes("design_mcp") && t.includes("inspo_search_screens"), "Primary's helper rule names design tools, not the script");
  }
  ok("the designed-work line is in the full, lean and layered prompts and the native worker prompt; start_helper guidance says to put the rule in the brief");
}

// 8. Inspo through our server and the design brief (fetch mocked: Inspo's public MCP, Better Design with its key, the registries).
{
  const INSPO = "https://inspomcp.dev/api/mcp";
  const REC = { brief: "x", pick: { macrostructure: { slug: "marquee-hero", label: "Marquee Hero" } }, shortlist: [{ slug: "marquee-hero", label: "Marquee Hero" }, { slug: "feature-stack", label: "Feature Stack" }],
    evidence: { paperBand: { consensus: "light" }, displayClass: { consensus: "grotesk-sans" } }, images: "https://img.test/captures/<slug>/hero.1440.webp (also full.1440)",
    heroGuidance: "Fit the first viewport.", spacingGuidance: "80 to 160px between sections.", paletteSuggestion: ["#b4fc04", "#2b749c", "#9becfb"],
    exemplars: [1, 2, 3, 4, 5, 6].map((i) => ({ slug: `site-${i}`, title: `Site ${i}`, northstar: `North star ${i}`, palette: ["#111111", "#eeeeee"], fonts: ["Fraunces"], mode: "light", tags: "playful" })) };
  const FILTERS = { industry: ["agency", "fintech", "food-beverage", "saas"], vibe: ["calm", "playful", "serious"], style: ["minimalism", "playful"], color: ["warm", "cool"], pageType: ["landing", "pricing"] };
  const CATALOG = "# Catalog matches\n\nRequired, in this order, before you present any UI:\n1. Design system: keep the product's own design.\n\n---\n\n### [Terminal pro](https://better-design.com/design-systems/terminal-pro)\nDeveloper console for dashboards, analytics and API docs: dark panels, mono type\n_dark, technical, developer-tools_ \u00b7 id: `terminal-pro`\n\n### [Warm Playful](https://better-design.com/design-systems/warm-playful)\nWarm editorial system for restaurants and food brands: cream paper, friendly rounded type, colorful poster accents\n_light, playful, warm, editorial, friendly_ \u00b7 id: `warm-playful`\n\n### [Desktop toy](https://better-design.com/design-systems/desktop-toy)\nDesktop-toy landing page with macOS window chrome\n_light, playful, glossy_ \u00b7 id: `desktop-toy`\n";
  const KIT_IMPORT = '@import url("https://fonts.googleapis.com/css2?family=Archivo:wght@400;700&family=Segoe+UI:wght@400&family=Helvetica+Neue:wght@400&display=swap");';
  const KIT = KIT_IMPORT + ":root{\n  --bd-bg: #fff7ec;\n  --bd-ink: #1b1b1b;\n  --bd-accent: #ff5a36;\n}\nbody{font-family:'Fraunces', serif}";
  const BD_TOOLS = [
    { name: "find-design-system", description: "find", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "get-design-system-kit", description: "kit", inputSchema: { type: "object", properties: { target: { type: "string", enum: ["react", "html"] }, designSystemId: { type: "string" }, projectId: { type: "string" } }, required: ["target"] } },
    { name: "get-ui-principle", description: "ui", inputSchema: { type: "object", properties: { topic: { type: "string" }, query: { type: "string" } } } },
  ];
  let seen = [], searchEmpty = false, inspoDown = false, bdDown = false, regDown = false, slow = false;
  const reply = (id, result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json", "mcp-session-id": "s-1" } });
  const brief_fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const body = init.body ? JSON.parse(Buffer.from(init.body).toString()) : null;
    seen.push({ url, method: body && body.method, name: body && body.params && body.params.name, args: body && body.params && body.params.arguments, auth: new Headers(init.headers).get("authorization") });
    if (url === INSPO || url === "https://better-design.com/api/mcp") {
      if (slow) return new Promise((_, rej) => init.signal && init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
      if (body.method === "initialize") return reply(body.id, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "up" } });
      if (!body.id) return new Response(null, { status: 202 });
      const txt = (t) => reply(body.id, { content: [{ type: "text", text: t }] });
      if (url === INSPO) {
        if (inspoDown) return new Response("down", { status: 503 });
        if (body.method === "tools/list") return reply(body.id, { tools: [{ name: "recommend" }] });
        if (body.params.name === "recommend") return txt(JSON.stringify(REC));
        if (body.params.name === "get_filters") return txt(JSON.stringify(FILTERS));
        if (body.params.name === "search_screens") {
          const a = body.params.arguments;
          if (searchEmpty) return txt(JSON.stringify({ results: [] }));
          const kind = a.industry === "food-beverage" ? "Food" : "Any";
          return txt(JSON.stringify({ count: 5, results: [1, 2, 3, 4, 5].map((i) => ({ slug: `${kind.toLowerCase()}-${i}`, title: `${kind} ${i}`, northstar: `${kind} north star ${i}`, palette: ["#aa0000", "#ffeecc", "#220000"], fonts: ["Fraunces"], mode: "light", tags: kind })) }));
        }
        if (body.params.name === "get_screen") { const slug = body.params.arguments.slug; return txt(JSON.stringify({ slug, sourceUrl: `https://${slug}.example`, image: `https://img.test/captures/${slug}/hero.1440.webp?v=9` })); }
      } else {
        if (bdDown) return new Response("down", { status: 503 });
        if (new Headers(init.headers).get("authorization") !== `Bearer ${KEY}`) return new Response("{}", { status: 401 });
        if (body.method === "tools/list") return reply(body.id, { tools: BD_TOOLS });
        const n = body.params.name;
        if (n === "find-design-system") return txt(CATALOG);
        if (n === "get-design-system-kit") { const a = body.params.arguments; if ("projectId" in a) return txt(`Could not load tokens for project "${a.projectId}".`); return txt(a.designSystemId === "warm-playful" ? KIT : "Could not load tokens."); }
        if (n === "get-ui-principle") {
          const a = body.params.arguments;
          if ("topic" in a && "query" in a) return txt("Pass either 'topic' or 'query' to get-ui-principle, not both.");
          return txt(`# ${a.topic}\n\nTopic: ${a.topic}\nAliases: a, b\n\n## Rules\n- **Use one clear focal point** per section and make the next most important thing half as loud.\n- Keep body text at a comfortable size and a steady rhythm of spacing.\n- You have loaded design guidance in this session and not reviewed the result yet. When the screen exists, call get-review-rules.`);
        }
      }
    }
    if (regDown && /magicui|reactbits|canvasui/.test(url)) return new Response("down", { status: 500 });
    return mockFetch(input, init);
  };
  const call = async (description, env = { BETTER_DESIGN_KEY: KEY }, path = "/brief/mcp") => { const r = await send(path, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "design_brief", arguments: description === undefined ? {} : { description } } }, {}, env); return r.json(); };
  globalThis.fetch = brief_fetch;

  // /inspo/mcp forwards to Inspo's public server with no key and no Authorization header.
  seen = [];
  const ir = await send("/inspo/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "recommend", arguments: { brief: "x" } } }, { authorization: "Bearer caller" }, {});
  assert.equal(ir.status, 200); assert.equal(JSON.parse((await ir.json()).result.content[0].text).pick.macrostructure.slug, "marquee-hero");
  assert.equal(seen.length, 1); assert.equal(seen[0].url, INSPO); assert.equal(seen[0].auth, null, "no Authorization header goes upstream: not the caller's, and the Worker adds none");
  inspoDown = true; assert.equal((await send("/inspo/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, {}, {})).status, 503, "an upstream status passes through"); inspoDown = false;

  // The brief tool: list, one call, fan out, content.
  const list = await rpc("/brief/mcp", "tools/list");
  assert.deepEqual(list.result.tools.map((t) => t.name), ["design_brief"]); assert.deepEqual(list.result.tools[0].inputSchema.required, ["description"]);
  seen = [];
  let out = await call("a playful single-page site for a sushi restaurant run by two fish");
  assert.ok(!out.result.isError, JSON.stringify(out)); const t = out.result.content[0].text;
  assert.ok(t.length <= 8000, `bounded (${t.length})`); assert.ok(t.startsWith("DESIGN BRIEF for: a playful single-page site"), "plain text, not JSON");
  assert.equal((t.match(/^\d\. Food \d/gm) || []).length, 5, "five Inspo references, from the food-beverage search");
  assert.match(t, /https:\/\/food-1\.example/); assert.match(t, /screenshot: https:\/\/img\.test\/captures\/food-1\/hero\.1440\.webp\n/); assert.match(t, /Layout: Marquee Hero/); assert.match(t, /References are food-beverage sites with a playful feel/);
  assert.match(t, /DESIGN SYSTEM TOKENS \(Warm Playful; fonts: Archivo\)[^\n]*\n:root\{\n  --bd-bg: #fff7ec;/, "the ready-to-paste :root block and fonts");
  assert.match(t, /Load the fonts with: <link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Archivo:wght@400;700&display=swap">/, "system fonts are left out of the link");
  assert.ok(!/Segoe|Helvetica/.test(t));
  assert.match(t, /RULES\n- Use one clear focal point/);
  assert.ok(!/session|loaded design guidance|Pass either/i.test(t), "Better Design's own session and error lines are not in the brief");
  assert.equal((t.match(/Use one clear focal point/g) || []).length, 1, "a rule that both principle calls return appears once"); assert.match(t, /COMPONENTS/);
  const comp = [...t.matchAll(/^- (Magic UI|React Bits|Canvas UI) (\S+): .+\n  python3 \/opt\/1hc\/skills\/artifacts\/scripts\/design_mcp\.py (\w+) getRegistryItem '\{"name":"\2","includeSource":true\}'$/gm)];
  assert.ok(comp.length >= 3 && comp.length <= 6, `3 to 6 components (${comp.length})`); assert.ok(comp.some((m) => m[1] === "React Bits" && /-JS-CSS$/.test(m[2])), "React Bits uses the plain-HTML variant"); assert.ok(comp.some((m) => m[1] === "Canvas UI" && /-vanilla$/.test(m[2])));
  assert.deepEqual([...new Set(seen.filter((c) => c.url === INSPO && c.name).map((c) => c.name))].sort(), ["get_filters", "get_screen", "recommend", "search_screens"], "Inspo: filters, search, recommend for the direction, then screens for the links");
  const first = seen.find((c) => c.name === "search_screens").args;
  assert.equal(first.industry, "food-beverage", "the filter value comes from get_filters and the subject (sushi restaurant)"); assert.equal(first.vibe, "playful"); assert.equal(first.pageType, "landing"); assert.match(first.query, /sushi/);
  for (const c of seen.filter((c) => c.name === "get-ui-principle")) assert.ok(("topic" in c.args) !== ("query" in c.args), `get-ui-principle gets topic or query, never both: ${JSON.stringify(c.args)}`);
  const bd = seen.filter((c) => c.url.includes("better-design") && c.name).map((c) => c.name).sort(); assert.deepEqual(bd, ["find-design-system", "get-design-system-kit", "get-ui-principle", "get-ui-principle"]);
  assert.ok(seen.filter((c) => c.url.includes("better-design")).every((c) => c.auth === `Bearer ${KEY}`), "Better Design gets the key");
  assert.deepEqual(seen.find((c) => c.name === "get-design-system-kit").args, { target: "html", designSystemId: "warm-playful" }, "the kit is asked for with target html and the found id");
  assert.deepEqual(seen.find((c) => c.name === "find-design-system").args, { query: "a playful single-page site for a sushi restaurant run by two fish" }, "arguments follow the tool's own schema");

  // A source that fails is skipped silently; the rest still come back.
  inspoDown = true; out = await call("sushi"); let t2 = out.result.content[0].text; inspoDown = false;
  assert.ok(!out.result.isError); assert.ok(!/REFERENCES/.test(t2) && /DESIGN SYSTEM TOKENS/.test(t2) && /COMPONENTS/.test(t2), "no Inspo: tokens and components remain");
  out = await call("sushi", {}); t2 = out.result.content[0].text;
  assert.ok(/REFERENCES/.test(t2) && !/DESIGN SYSTEM TOKENS/.test(t2) && /STARTING TOKENS[^\n]*\n:root\{\n  --color-1: #aa0000;/.test(t2), "no Better Design key: Inspo's palette becomes the :root block");
  bdDown = true; t2 = (await call("sushi")).result.content[0].text; bdDown = false; assert.match(t2, /STARTING TOKENS/);
  regDown = true; clearRegistryCache(); t2 = (await call("sushi")).result.content[0].text; regDown = false; clearRegistryCache(); assert.ok(!/COMPONENTS/.test(t2) && /REFERENCES/.test(t2), "registries down: no components, nothing else lost");
  inspoDown = bdDown = regDown = true; clearRegistryCache(); out = await call("sushi"); inspoDown = bdDown = regDown = false; clearRegistryCache();
  assert.equal(out.result.isError, true, "every source down: an error result, which the caller skips");
  slow = true; const t0 = Date.now(); out = await call("sushi"); slow = false;
  assert.ok(Date.now() - t0 < 9000, "slow upstreams are cut off by the per-source time limit"); assert.ok(!out.result.isError && /COMPONENTS/.test(out.result.content[0].text), "slow Inspo and Better Design are skipped, components stay");
  out = await call(undefined); assert.equal(out.result.isError, true, "a description is required");

  // The filter path: a subject with no matching industry searches by words only; a search that finds nothing falls back to recommend's exemplars.
  seen = []; out = await call("a quarterly report for accountants"); t2 = out.result.content[0].text;
  const s1 = seen.filter((c) => c.name === "search_screens").map((c) => c.args);
  assert.ok(s1.length >= 1 && s1.every((a) => !("industry" in a)), "no industry in the description, so no industry filter is sent"); assert.match(t2, /^1\. Any 1/m);
  seen = []; searchEmpty = true; out = await call("a playful sushi restaurant"); t2 = out.result.content[0].text; searchEmpty = false;
  const s2 = seen.filter((c) => c.name === "search_screens").map((c) => c.args);
  assert.ok(s2.length >= 3 && s2[0].industry === "food-beverage" && !("industry" in s2[s2.length - 1]), "an empty search relaxes the filters step by step");
  assert.match(t2, /^1\. Site 1/m, "nothing found by search: recommend's exemplars are the references");
  const { inspoFilters, ruleLines } = await import("../design-mcp/src/brief.js");
  assert.deepEqual(inspoFilters("a sushi bar menu", FILTERS), { industry: "food-beverage" });
  assert.deepEqual(inspoFilters("playful bakery site, warm", FILTERS), { industry: "food-beverage", vibe: "playful", style: "playful", color: "warm" });
  assert.deepEqual(inspoFilters("sushi", { industry: ["saas"] }), {}, "a value Inspo does not list is never sent");
  assert.deepEqual(ruleLines("- You have loaded design guidance in this session and not reviewed the result yet.\n- Pass either 'topic' or 'query' to get-ui-principle, not both.\n- Keep one focal point in every section of the page.\n- Keep one focal point in every section of the page.", 5), ["- Keep one focal point in every section of the page."]);

  out = await call("a playful sushi restaurant"); assert.ok(!/DEBUG/.test(out.result.content[0].text), "no debug section unless asked");
  out = (await (await send("/brief/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "design_brief", arguments: { description: "a playful sushi restaurant", debug: true } } }, {}, { BETTER_DESIGN_KEY: KEY })).json());
  assert.match(out.result.content[0].text, /DEBUG \(Better Design calls\)\nfind-design-system \{"query":"a playful sushi restaurant"\} -> ok/);
  // Choosing the catalog match, reading the kit, and cleaning rules.
  const { catalogMatches, pickSystem, fontsIn } = await import("../design-mcp/src/brief.js");
  const ms = catalogMatches(CATALOG);
  assert.deepEqual(ms.map((x) => x.id), ["terminal-pro", "warm-playful", "desktop-toy"]); assert.equal(ms[1].name, "Warm Playful"); assert.match(ms[1].tags, /editorial/);
  assert.equal(pickSystem(ms, "a playful single-page site for a sushi restaurant").id, "warm-playful", "not the first listed: a developer console and a desktop toy fit worse");
  assert.equal(pickSystem(ms, "an analytics dashboard for developers with api docs").id, "terminal-pro", "a technical request keeps the technical system");
  assert.equal(pickSystem([], "x"), null);
  assert.deepEqual(fontsIn('@import url("https://fonts.googleapis.com/css2?family=Archivo:wght@400;700&family=Segoe+UI:wght@400&family=Fraunces:ital,wght@0,400&display=swap"); a{font-family:Roboto, Noto Color Emoji}'), { names: ["Archivo", "Fraunces"], link: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;700&family=Fraunces:ital,wght@0,400&display=swap" });
  assert.deepEqual(fontsIn("a{font-family: 'DM Serif Display', Georgia, serif}").names, ["DM Serif Display"]);
  assert.deepEqual(ruleLines("# Visual Hierarchy\n\nTopic: hierarchy\nAliases: visual hierarchy, emphasis, priority\n\n## Size\n- **Don't rely solely on font size** for hierarchy\n- HSL = Hue, Saturation, Lightness for the colors\n1. Use font weight and color to create hierarchy", 5), ["- Don't rely solely on font size for hierarchy", "- Use font weight and color to create hierarchy"], "headings, Topic and Aliases lines, stray ** and definitions are not rules");
  const kitCall = seen.filter((c) => c.name === "get-design-system-kit"); assert.ok(kitCall.length && kitCall.every((c) => !("projectId" in c.args)), "the kit is asked for with the catalog id only, never projectId");

  // Size bound: very long upstream text is clipped to 8 KB, with the tokens kept.
  const bigRec = { ...REC, heroGuidance: "h".repeat(9000), spacingGuidance: "s".repeat(9000), exemplars: REC.exemplars.map((e) => ({ ...e, northstar: "n".repeat(5000), palette: Array(40).fill("#abcdef"), fonts: Array(40).fill("Font") })) };
  const keep = REC; Object.assign(REC, bigRec); out = await call("sushi"); Object.assign(REC, keep);
  assert.ok(out.result.content[0].text.length <= 8000, "bounded at 8000 characters"); assert.match(out.result.content[0].text, /:root\{/);
  globalThis.fetch = mockFetch; clearRegistryCache();
  ok("/inspo/mcp forwards with no key; design_brief fans out, returns one bounded text answer with tokens, rules and components; failing and slow sources are skipped");
}

// 9. The script's brief subcommand against a local server running the Worker (Inspo and Better Design answer 404 from the mock, the registries answer).
{
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`http://x${req.url}`, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = new URL("../src/skills/artifacts/scripts/design_mcp.py", import.meta.url).pathname;
  const py = (...args) => new Promise((resolve) => execFile("python3", ["-I", script, ...args], { env: { ...process.env, DESIGN_MCP_URL: base } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
  try {
    clearRegistryCache();
    let r = await py("brief", "a card marquee site for a bakery");
    assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^DESIGN BRIEF for: a card marquee site for a bakery/); assert.match(r.stdout, /COMPONENTS/); assert.match(r.stdout, /design_mcp\.py magicui getRegistryItem/);
    r = await py("brief"); assert.equal(r.code, 1); assert.match(r.stderr, /usage: design_mcp\.py brief/);
    r = await py("brief", "a", "b", "c"); assert.equal(r.code, 0, "words after brief are joined into one description"); assert.match(r.stdout, /^DESIGN BRIEF for: a b c/);
    r = await py("inspo", "tools"); assert.equal(r.code, 1, "inspo is a known server name (its upstream is not mocked here, so it fails on the network, not on usage)"); assert.ok(!/usage/.test(r.stderr));
    // Not configured: DESIGN_MCP_URL unset or empty prints one line, exits 0 and makes no network call (nothing listens at the default hosted address here).
    for (const v of [undefined, ""]) {
      const env = { ...process.env }; delete env.DESIGN_MCP_URL; if (v !== undefined) env.DESIGN_MCP_URL = v;
      const run = (...args) => new Promise((resolve) => execFile("python3", ["-I", script, ...args], { env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
      for (const args of [["brief", "a bakery site"], ["magicui", "tools"]]) {
        const n = await run(...args); assert.equal(n.code, 0, n.stderr); assert.equal(n.stdout.trim().split("\n").length, 1); assert.match(n.stdout, /not configured/); assert.equal(n.stderr, "");
      }
    }
    r = await py("--help"); assert.match(r.stdout, /design_mcp\.py brief/); assert.match(r.stdout, /inspo/);
  } finally { server.close(); }
  ok("design_mcp.py brief: prints the brief, joins words, usage on no description, inspo accepted as a server");
}
console.log("design-mcp.test.mjs: all ok");
