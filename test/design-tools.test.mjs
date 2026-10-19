// node --import ./test/stubs/register.mjs test/design-tools.test.mjs
// The five design MCP servers (mcp.1helm.com) as real tools (src/design-tools.js). fetch is mocked; nothing here calls the network or a model for judgment.
//   1 the client: initialize + tools/list + tools/call, JSON and event-stream answers, Mcp-Session-Id, one session per server, a lost session retried once
//   2 names, schemas and descriptions; the cache; a failed refresh keeps the old list; Better Design's account-state tools are never offered
//   3 a call reaches the right server and returns its text inside the untrusted wrapper; bad arguments are not sent; errors and big results are bounded
//   4 the Primary's and a helper's tool list, in both engines (classic and pi), as stubs under context v2; Better Design follows the account switch
//   5 a real turn in each engine calls a design tool and the result reaches the model
//   6 the design skill and its references name tools that exist on the servers
import { world, assert } from "./deploy-harness.mjs";
import { Resident, untrusted } from "../src/resident.js";
import { DESIGN_SERVERS, designToolDefs, designToolCall, prepareDesignTools, resetDesignToolsCache, isDesignToolName, readRpc, RESULT_MAX, BD_NOT_OFFERED } from "../src/design-tools.js";
import { helperAllowed, helperExclude } from "../src/helpers.js";
import { toolClass } from "../src/resume.js";
import { readSkill } from "../src/skills/index.js";
import { staticCore } from "../src/prompt/index.js";
const ok = (m) => console.log("  ok", m);
const CFG = { DESIGN_MCP_URL: "https://mcp.1helm.com" };   // public edition: design tools exist only when this is set
// Names of the tools the five servers listed on 2026-10-19 (https://mcp.1helm.com/<server>/mcp, tools/list).
const REAL_NAMES = [
  "inspo: search_screens get_screen get_design_system find_similar compare find_by_color find_examples_for_macrostructure list_collections get_filters get_site_pages find_components get_collection find_reference_components recommend get_reference_jsx",
  "better-design: get-ui-principle get-ux-principle get-sales-principle get-motion-guide get-swiftui-guide get-review-rules plan-video cut-screen-recording render-video-frames get-widget-guide check-comprehension review-dashboard-structure finalize-dashboard-review find-icon-library find-icons install-icons detect-icon-library find-design-system get-design-system-kit create-design-system get-design-system-status preview-design-system get-design-config set-design-config get-jig-guide get-store-listing-guide make-sales-page make-social-image extract-design-system extract-from-url get-illustration-guide review-illustration inspect-spacing build-feature-map read-feature-map update-feature-map get-team-rules propose-team-rule set-team-rules get-inspiration send-feedback confirm-claim",
  "magicui: listRegistryItems getRegistryItem searchRegistryItems",
  "reactbits: listRegistryItems getRegistryItem searchRegistryItems",
  "canvasui: listRegistryItems getRegistryItem searchRegistryItems",
].join("\n");

// ---- a fake mcp.1helm.com ----
const obj = (props, required = []) => ({ type: "object", properties: props, required, $schema: "http://json-schema.org/draft-07/schema#" });
const SERVER_TOOLS = {
  "/inspo/mcp": [
    { name: "search_screens", description: "Search the archive of real website screenshots.", inputSchema: obj({ query: { type: "string" }, style: { type: "string", enum: ["minimalism", "editorial"] } }) },
    { name: "recommend", description: "Recommend references for a brief.", inputSchema: obj({ brief: { type: "string" } }, ["brief"]) },
  ],
  "/better-design/mcp": [
    { name: "get-design-system-kit", description: "Return the build kit for a design system.", inputSchema: obj({ id: { type: "string" }, target: { type: "string" } }, ["id"]) },
    { name: "find-design-system", description: "Find design systems.", inputSchema: obj({ query: { type: "string" } }) },
    { name: "set-team-rules", description: "Save team rules.", inputSchema: obj({ rules: { type: "string" } }) },
    { name: "send-feedback", description: "Tell Better Design.", inputSchema: obj({ text: { type: "string" } }) },
  ],
  "/magicui/mcp": [{ name: "getRegistryItem", description: "One registry item.", inputSchema: obj({ name: { type: "string" }, includeSource: { type: "boolean" } }, ["name"]) }, { name: "searchRegistryItems", description: "Search items.", inputSchema: obj({ query: { type: "string" } }, ["query"]) }],
  "/reactbits/mcp": [{ name: "getRegistryItem", description: "One registry item.", inputSchema: obj({ name: { type: "string" } }, ["name"]) }],
  "/canvasui/mcp": [{ name: "getRegistryItem", description: "One registry item.", inputSchema: obj({ name: { type: "string" } }, ["name"]) }],
};
function fakeServers({ sse = new Set(["/inspo/mcp"]), sessionPaths = new Set(["/inspo/mcp"]) } = {}) {
  const f = { log: [], failList: new Set(), expire: new Set(), replyFor: null, inits: {} };
  f.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); let path = u.pathname; if (u.origin === "https://inspomcp.dev") { assert.equal(path, "/api/mcp"); assert.ok(!Object.keys(init?.headers || {}).some((h) => /^authorization$/i.test(h)), "no Authorization header to Inspo"); path = "/inspo/mcp"; } else assert.equal(u.origin, "https://mcp.1helm.com");
    const body = JSON.parse(init.body), sid = init.headers?.["mcp-session-id"] || null;
    f.log.push({ path, method: body.method, params: body.params, sid, accept: init.headers?.accept });
    assert.ok(SERVER_TOOLS[path], "known server");
    if (body.method === "initialize") { f.inits[path] = (f.inits[path] || 0) + 1; return reply(path, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "x" } } }, sessionPaths.has(path) ? { "mcp-session-id": `S-${path}-${f.inits[path]}` } : {}); }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (sessionPaths.has(path) && (f.expire.has(path) || sid !== `S-${path}-${f.inits[path]}`)) { f.expire.delete(path); return new Response("Session not found", { status: 404 }); }
    if (body.method === "tools/list") { if (f.failList.has(path)) return new Response("boom", { status: 500 }); return reply(path, { jsonrpc: "2.0", id: body.id, result: { tools: SERVER_TOOLS[path] } }); }
    if (body.method === "tools/call") { const r = f.replyFor ? f.replyFor(path, body.params) : { content: [{ type: "text", text: `${path} ran ${body.params.name} ${JSON.stringify(body.params.arguments)}` }] }; return reply(path, { jsonrpc: "2.0", id: body.id, result: r }); }
    throw new Error("unexpected " + body.method);
  };
  const reply = (path, msg, headers = {}) => sse.has(path)
    ? new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: {} })}\n\nevent: message\ndata: ${JSON.stringify(msg)}\n\n`, { headers: { "content-type": "text/event-stream", ...headers } })
    : new Response(JSON.stringify(msg), { headers: { "content-type": "application/json", ...headers } });
  return f;
}
const names = (defs) => defs.map((t) => t.function.name);

// ---- 1 + 2: the client, names, schemas, cache ----
{
  resetDesignToolsCache();
  const f = fakeServers();
  await prepareDesignTools(CFG, { fetchImpl: f.fetch });
  const on = designToolDefs({ betterDesign: true }), off = designToolDefs({ betterDesign: false });
  assert.deepEqual(names(on), ["inspo_search_screens", "inspo_recommend", "better_design_get_design_system_kit", "better_design_find_design_system", "magicui_getRegistryItem", "magicui_searchRegistryItems", "reactbits_getRegistryItem", "canvasui_getRegistryItem"]);
  assert.ok(names(on).every((n) => /^[A-Za-z0-9_]{1,64}$/.test(n) && isDesignToolName(n)), "valid tool names");
  assert.ok(!names(off).some((n) => n.startsWith("better_design_")), "Better Design tools are absent when the switch is off");
  assert.equal(off.length, on.length - 2);
  for (const n of BD_NOT_OFFERED) assert.ok(!names(on).includes("better_design_" + n.replace(/-/g, "_")), `${n} is never offered`);
  const t = on.find((x) => x.function.name === "inspo_search_screens").function;
  assert.match(t.description, /^\[Inspo\] Search the archive of real website screenshots\./, "the server's own description");
  assert.deepEqual(t.parameters.properties.style.enum, ["minimalism", "editorial"], "the server's own schema");
  assert.equal(t.parameters.$schema, undefined, "$schema is dropped"); assert.equal(on.find((x) => x.function.name === "inspo_recommend").function.parameters.required[0], "brief");
  assert.equal(DESIGN_SERVERS.find((s) => s.id === "inspo").url, "https://inspomcp.dev/api/mcp", "the inspo server is Inspo's own public endpoint");
  ok("names, schemas and descriptions come from the servers; account-state tools and the switch");
  // initialize happens once per server, JSON and event-stream answers both parse, and the session id is followed
  assert.deepEqual(Object.values(f.inits), [1, 1, 1, 1, 1]);
  const insp = f.log.filter((l) => l.path === "/inspo/mcp");
  assert.equal(insp.find((l) => l.method === "tools/list").sid, "S-/inspo/mcp-1", "Mcp-Session-Id is sent back"); assert.match(insp[0].accept, /text\/event-stream/);
  // cached: a second turn makes no request
  const n0 = f.log.length; await prepareDesignTools(CFG, { fetchImpl: f.fetch }); assert.equal(f.log.length, n0, "tools/list is cached");
  // a refresh that fails keeps the old list
  await prepareDesignTools(CFG, { fetchImpl: f.fetch, now: Date.now() + 7 * 3600e3 + 1 });
  assert.equal(f.log.filter((l) => l.method === "tools/list").length, 10, "after the TTL it asks again");
  f.failList.add("/magicui/mcp"); await prepareDesignTools(CFG, { fetchImpl: f.fetch, now: Date.now() + 14 * 3600e3 });
  assert.ok(names(designToolDefs({ betterDesign: true })).includes("magicui_getRegistryItem"), "a failed refresh keeps the cached list");
  const before = f.log.length; await prepareDesignTools(CFG, { fetchImpl: f.fetch, now: Date.now() + 14 * 3600e3 + 1000 }); assert.equal(f.log.length, before, "a failure is not retried at once");
  ok("cache: one tools/list per TTL, stale list kept on failure");
  // a server that is down at first gives no tools, and the others still work
  resetDesignToolsCache(); const g = fakeServers(); g.failList.add("/inspo/mcp");
  await prepareDesignTools(CFG, { fetchImpl: g.fetch }); assert.ok(!names(designToolDefs({ betterDesign: true })).some((n) => n.startsWith("inspo_")) && names(designToolDefs({ betterDesign: true })).length === 6);
  const r = await readRpc(new Response("event: message\ndata: {\"id\":7,\"result\":{\"a\":1}}\n\n", { headers: { "content-type": "text/event-stream" } }), 7); assert.equal(r.result.a, 1);
  assert.equal(await readRpc(new Response(""), 1), null);
  ok("one server down leaves the rest; readRpc parses event streams");
}

// ---- 3: calls ----
{
  resetDesignToolsCache();
  const f = fakeServers(); await prepareDesignTools(CFG, { fetchImpl: f.fetch });
  const call = (n, a, o = {}) => designToolCall(CFG, n, a, { fetchImpl: f.fetch, betterDesign: true, wrap: untrusted, ...o });
  let out = await call("inspo_recommend", { brief: "a bakery" });
  const c = f.log.filter((l) => l.method === "tools/call").at(-1);
  assert.equal(c.path, "/inspo/mcp"); assert.deepEqual(c.params, { name: "recommend", arguments: { brief: "a bakery" } }, "the server's own tool name, not the prefixed one");
  assert.match(out, /^\[UNTRUSTED CONTENT from the Inspo design tool recommend\./); assert.match(out, /\/inspo\/mcp ran recommend \{"brief":"a bakery"\}/); assert.match(out, /\[END UNTRUSTED CONTENT/);
  out = await call("better_design_get_design_system_kit", { id: "ds1", target: "html" }); assert.equal(f.log.at(-1).path, "/better-design/mcp"); assert.equal(f.log.at(-1).params.name, "get-design-system-kit"); assert.match(out, /get-design-system-kit/);
  for (const [n, p] of [["magicui_getRegistryItem", "/magicui/mcp"], ["reactbits_getRegistryItem", "/reactbits/mcp"], ["canvasui_getRegistryItem", "/canvasui/mcp"]]) { await call(n, { name: "x" }); assert.equal(f.log.at(-1).path, p); }
  ok("each tool reaches its own server and the text comes back as untrusted data");
  // the session is reused; a lost session starts a new one and the call is retried once
  const inits = f.inits["/inspo/mcp"]; await call("inspo_recommend", { brief: "again" }); assert.equal(f.inits["/inspo/mcp"], inits, "one session per server");
  f.expire.add("/inspo/mcp"); out = await call("inspo_recommend", { brief: "after expiry" }); assert.match(out, /after expiry/); assert.equal(f.inits["/inspo/mcp"], inits + 1);
  // bad arguments are not sent and the schema comes back
  const n = f.log.length; out = await call("magicui_searchRegistryItems", {}); assert.match(out, /^error: this call was not run.*missing required field query/s); assert.match(out, /"parameters"/); assert.equal(f.log.length, n);
  out = await call("magicui_getRegistryItem", { name: "x", includeSource: "true" }); assert.match(out, /ran getRegistryItem \{"name":"x","includeSource":"true"\}|must be boolean/);
  // Better Design off at call time (the switch changed after the tool list was built)
  const m0 = f.log.length; out = await call("better_design_find_design_system", { query: "x" }, { betterDesign: false }); assert.match(out, /^error: Better Design is switched off/); assert.equal(f.log.length, m0, "nothing sent");
  assert.match(await call("nope_tool", {}), /^error: unknown tool/);
  // errors and size
  f.replyFor = () => ({ isError: true, content: [{ type: "text", text: "no such item" }] }); out = await call("magicui_getRegistryItem", { name: "zz" }); assert.match(out, /^error: Magic UI reported an error\.\n\[UNTRUSTED CONTENT[\s\S]*no such item/);
  f.replyFor = () => ({ content: [{ type: "text", text: "x".repeat(RESULT_MAX + 5000) }] }); out = await call("magicui_getRegistryItem", { name: "big" });
  assert.ok(out.length < RESULT_MAX + 1000 && /Cut at 24000 of 29000 characters/.test(out), "a big result is cut with a note");
  f.replyFor = () => ({ content: [{ type: "image", data: "AAAA" }, { type: "text", text: "caption" }] }); out = await call("magicui_getRegistryItem", { name: "img" }); assert.match(out, /\[image omitted\]\ncaption/);
  const down = async () => { throw new Error("network down"); }; assert.match(await designToolCall(CFG, "magicui_getRegistryItem", { name: "x" }, { fetchImpl: down }), /^error: Magic UI did not answer: network down/);
  ok("bad arguments, switch off at call time, tool errors, big results and a down server are all handled");
}

// ---- 4 + 5: the Resident in both engines ----
const text = (m) => typeof m.content === "string" ? m.content : m.content?.filter((p) => p.type === "text").map((p) => p.text).join("");
for (const engine of ["classic", "pi"]) {
  resetDesignToolsCache();
  const f = fakeServers(), realFetch = globalThis.fetch;
  globalThis.fetch = (u, i) => /^https:\/\/(mcp\.1helm\.com|inspomcp\.dev)\//.test(String(u)) ? f.fetch(u, i) : realFetch(u, i);
  try {
    const W = world({ engine, env: { DESIGN_MCP_URL: "https://mcp.1helm.com", CONTEXT_LAYOUT: "v2", GENUI: "on", RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0 } }), R = W.R;
    W.d1.exec("ALTER TABLE tenants ADD COLUMN helper_tone INTEGER; CREATE TABLE vault (tenant_id TEXT,name TEXT,hosts TEXT); CREATE TABLE logins (tenant_id TEXT,site TEXT,username TEXT);");
    W.env.ARCHIVE = { idFromName: (n) => n, get: () => ({ channel: async () => ({ channel: { name: "main", purpose: "" }, memory: [], messages: [] }) }) };
    R.systemPrompt = Resident.prototype.systemPrompt; R.conns = async () => []; R.notebookBackfillOnce = async () => 0; R.mem.syncCurated = () => {}; R.memoryBackfill = () => {};
    let bd = false; R.betterDesignOn = async () => { R._betterDesign = bd; return bd; };
    await R.betterDesignOn(); await prepareDesignTools(W.env, { fetchImpl: f.fetch });
    const primary = R.availableTools({ context: { version: 2 } }).map((t) => t.function.name);
    assert.ok(primary.includes("inspo_search_screens") && primary.includes("magicui_getRegistryItem") && primary.includes("canvasui_getRegistryItem"), "Primary has the design tools");
    assert.ok(!primary.some((n) => n.startsWith("better_design_")), "switch off: no Better Design tools");
    const helper = R.availableTools({ context: { version: 2 }, kind: "helper" }).map((t) => t.function.name);
    assert.ok(helper.includes("inspo_recommend") && helper.includes("reactbits_getRegistryItem") && helper.every((n) => helperAllowed(n)), "a helper has them too");
    assert.ok(R.availableTools({ context: { version: 2 }, kind: "helper", helper: { dynamic_routing: true } }).some((t) => t.function.name === "magicui_searchRegistryItems"), "native workers too");
    assert.ok(!helperExclude(R.tools()).includes("inspo_recommend"), "the helper exclusion list leaves them out of the denials");
    assert.equal(toolClass("inspo_recommend"), "read");
    bd = true; await R.betterDesignOn();
    assert.ok(R.availableTools({ context: { version: 2 } }).some((t) => t.function.name === "better_design_get_design_system_kit"), "switch on: Better Design tools are offered");
    assert.ok(!R.availableTools({ context: { version: 2 } }).some((t) => /team_rules|feedback/.test(t.function.name)));
    // stubs while load_tools exists; full schemas through load_tools
    const model = R.modelTools({ context: { version: 2 } }), stub = model.find((t) => t.function.name === "better_design_get_design_system_kit").function;
    assert.ok(!/\[Better Design\] Return the build kit for a design system\. .+/.test(stub.description) && stub.parameters.properties.id.description === undefined, "stub: first sentence and field names only");
    const full = JSON.parse(await R.localToolInner("load_tools", { names: ["better_design_get_design_system_kit", "inspo_recommend"] }, { context: { version: 2 } })).tools;
    assert.equal(full[0].function.parameters.required[0], "id"); assert.deepEqual(full.map((t) => t.function.name), ["better_design_get_design_system_kit", "inspo_recommend"]);
    assert.ok(R.modelTools(null).find((t) => t.function.name === "inspo_recommend").function.description.length > 20, "without context v2 the list is not stubbed");
    bd = false; await R.betterDesignOn();
    // a real turn: the model calls a design tool, the result reaches it, and the right server was asked
    const s = R.newSession("Design"); const start = f.log.length;
    W.brain = ({ n }) => n === 1 ? { calls: [["inspo_search_screens", { query: "bakery landing page", style: "editorial", step_title: "Look at references" }]] } : "Done.";
    const r = await R.runTurn("t1", "main", "1", "Make a bakery page.", null, { session: s });
    assert.ok(!r.error, r.error);
    const second = W.calls.filter((c) => c.who === "main")[1]; assert.ok(second, "a second model call carried the tool result");
    const toolMsg = second.messages.filter((m) => m.role === "tool").map(text).join("\n");
    assert.match(toolMsg, /UNTRUSTED CONTENT from the Inspo design tool search_screens/); assert.match(toolMsg, /"query":"bakery landing page"/);
    const calls = f.log.slice(start).filter((l) => l.method === "tools/call"); assert.equal(calls.length, 1); assert.equal(calls[0].path, "/inspo/mcp"); assert.equal(calls[0].params.name, "search_screens");
    assert.ok(W.calls.find((c) => c.who === "main").tools.includes("inspo_search_screens"), `${engine}: the model was offered the tool`);
    ok(`${engine}: Primary, helper and native worker lists, stubs and load_tools, Better Design switch, and a real turn`);
  } finally { globalThis.fetch = realFetch; }
}

// ---- 6: the skill names the tools ----
{
  const REAL = Object.fromEntries(REAL_NAMES.split("\n").map((l) => { const [k, v] = l.split(": "); return [k, v.split(" ")]; }));
  const prefix = { inspo: "inspo", "better-design": "better_design", magicui: "magicui", reactbits: "reactbits", canvasui: "canvasui" };
  const exists = new Set(Object.entries(REAL).flatMap(([k, ts]) => ts.map((t) => `${prefix[k]}_${t.replace(/[^A-Za-z0-9_]/g, "_")}`)));
  const refs = ["web-page", "presentation", "pdf-design"];
  for (const flags of [{ better_design: true }, { better_design: false }]) {
    const all = [readSkill({ slug: "artifacts" }, flags), ...refs.map((ref) => readSkill({ slug: "artifacts", ref }, flags)), staticCore({ better_design: !!flags.better_design })].join("\n");
    const named = [...all.matchAll(/`((?:inspo|better_design|magicui|reactbits|canvasui)_[A-Za-z0-9_]+)`/g)].map((m) => m[1]);
    assert.ok(named.length >= (flags.better_design ? 25 : 14), `the skill names the tools (${named.length})`);
    for (const n of named) assert.ok(exists.has(n), `${n} is a real tool on its server`);
    if (!flags.better_design) assert.ok(!/better_design_/.test(all), "no Better Design tool names when the switch is off");
    for (const n of ["inspo_recommend", "magicui_searchRegistryItems", "magicui_getRegistryItem", "reactbits_getRegistryItem", "canvasui_getRegistryItem"]) assert.ok(all.includes(`\`${n}\``), `${n} is named`);
    if (flags.better_design) for (const n of ["better_design_find_design_system", "better_design_get_design_system_kit", "better_design_get_review_rules", "better_design_extract_from_url"]) assert.ok(all.includes(`\`${n}\``), `${n} is named`);
    assert.match(readSkill({ slug: "artifacts" }, flags), /real tools in your tool list/);
  }
  ok("the skill, its references and the tools line name tools that exist (names checked against the live tools/list)");
}
// ---- 7 (public edition): the design tools exist only when DESIGN_MCP_URL is set and not empty ----
{
  for (const [label, env] of [["unset", {}], ["empty", { DESIGN_MCP_URL: "" }], ["blank", { DESIGN_MCP_URL: "  " }]]) {
    resetDesignToolsCache(); const f = fakeServers();
    await prepareDesignTools(env, { fetchImpl: f.fetch });
    assert.equal(f.log.length, 0, `${label}: no request to any design server, Inspo included`);
    assert.deepEqual(designToolDefs({ betterDesign: true }), [], `${label}: no design tools are offered`);
    assert.match(await designToolCall(env, "inspo_recommend", { brief: "x" }, { fetchImpl: f.fetch }), /not configured/); assert.equal(f.log.length, 0);
  }
  resetDesignToolsCache(); const f = fakeServers();
  const seen = []; const spy = (u, i) => { seen.push(String(u)); return f.fetch(u, i); };
  await prepareDesignTools({ DESIGN_MCP_URL: "https://mcp.1helm.com/" }, { fetchImpl: spy });
  assert.ok(seen.some((u) => u === "https://mcp.1helm.com/magicui/mcp") && seen.some((u) => u === "https://inspomcp.dev/api/mcp"), "set: the hosted servers use the base and Inspo its own endpoint");
  ok("DESIGN_MCP_URL unset, empty or blank: no request and no design tool; set: base for the hosted servers, Inspo direct under the same opt-in");
}

console.log("PASS design tools");

