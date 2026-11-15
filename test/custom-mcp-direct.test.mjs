// node --import ./test/stubs/register.mjs test/custom-mcp-direct.test.mjs
// Custom MCP direct tool runs (src/custom-mcp-direct.js). A server added with an API key or no sign-in has its tool calls sent by 1Helm's own
// Worker over MCP Streamable HTTP, so a result keeps every content block (Composio keeps only the first). Composio is the harness fake
// (test/custom-mcp-harness.mjs) and the person's MCP server is an in-process fake below. App facts only: which requests the server received
// (and in which order, with which header), what the helper is told, what the Library save hook got, what D1 holds, and what is never shown.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { makeHarness, SERVER, API_KEY_SECRET, say } from "./custom-mcp-harness.mjs";
import { runAppTool } from "../src/ee/composio.js";
import { withCustomRows, hooks } from "../src/ee/custom-mcp.js";
import { DIRECT, openDirect, mcpNameFor, resultValue } from "../src/ee/custom-mcp-direct.js";

let n = 0; const ok = (name) => { n++; say(`ok ${n} - ${name}`); };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
const URL_KEY = "https://cameras.acme-demo.dev/mcp", URL_NONE = "https://open.acme-demo.dev/mcp", URL_OTHER = "https://evil.other-demo.io/mcp";
const TOOLS = [{ name: "live_snapshot", description: "A still from a camera.", props: { camera_id: { type: "string" } } }, { name: "echo", description: "Echo.", props: { text: { type: "string" } } },
  { name: "boom", description: "Fails." }, { name: "pdf_report", description: "Report." }];

const H = makeHarness(), { C, api, rows, d1, env, enable, REQ, logs } = H;
env.VAULT_KEY = randomBytes(32).toString("base64");
const composioFetch = globalThis.fetch;

// ---- the person's MCP server (fake) ----
const S = { reqs: [], mode: "json", redirect: false, bigHeader: false, bigBody: false, key: API_KEY_SECRET, needAuth: true, session: "sess-abc" };
const rpcReply = (m, result) => ({ jsonrpc: "2.0", id: m.id, result });
async function mcpFetch(u, init) {
  const m = JSON.parse(init.body), h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  S.reqs.push({ url: String(u), method: m.method, auth: h.authorization, session: h["mcp-session-id"], redirect: init.redirect, name: m.params?.name, args: m.params?.arguments, accept: h.accept });
  if (S.redirect) return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
  if (S.needAuth && h.authorization !== `Bearer ${S.key}`) return new Response("no", { status: 401 });
  if (m.id === undefined) return new Response(null, { status: 202 });
  let result;
  if (m.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } };
  else if (m.method === "tools/list") result = { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object" } })) };
  else if (m.method === "tools/call") {
    if (S.session && h["mcp-session-id"] !== S.session) return new Response("bad session", { status: 400 });
    const name = m.params.name;
    if (name === "live_snapshot") result = { content: [{ type: "text", text: `Latest image for ${m.params.arguments?.camera_id}` }, { type: "image", data: PNG, mimeType: "image/png" }] };
    else if (name === "echo") result = { content: [{ type: "text", text: `you said ${m.params.arguments?.text}` }] };
    else if (name === "boom") result = { isError: true, content: [{ type: "text", text: `bad input, key was ${S.key}` }] };
    else if (name === "pdf_report") result = { content: [{ type: "text", text: "report" }, { type: "resource", resource: { uri: "file:///r/report.png", mimeType: "image/png", blob: PNG } }], structuredContent: { pages: 1 } };
  }
  if (S.bigBody && m.method === "tools/call") return new Response(JSON.stringify(rpcReply(m, { content: [{ type: "text", text: "x".repeat(5000) }] })), { status: 200, headers: { "content-type": "application/json" } });
  const headers = { "content-type": S.mode === "sse" ? "text/event-stream" : "application/json", ...(m.method === "initialize" && S.session ? { "mcp-session-id": S.session } : {}) };
  if (S.bigHeader && m.method === "tools/call") headers["content-length"] = String(DIRECT.maxResponse + 1);
  const body = S.mode === "sse" ? `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${JSON.stringify(rpcReply(m, result))}\n\n` : JSON.stringify(rpcReply(m, result));
  return new Response(body, { status: 200, headers });
}
globalThis.fetch = (u, init = {}) => /acme-demo\.dev|other-demo\.io/.test(String(u)) ? mcpFetch(u, init) : composioFetch(u, init);
const reset = () => { S.reqs = []; S.mode = "json"; S.redirect = false; S.bigHeader = false; S.bigBody = false; S.key = API_KEY_SECRET; S.needAuth = true; hooks.resolve = async () => ({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }); };
reset();

C.servers[URL_KEY] = { ...SERVER("api_key", API_KEY_SECRET), tools: TOOLS }; C.servers[URL_NONE] = { auth: "none", tools: TOOLS };
let saves = [];
const files = { save: async (f) => { saves.push(f); return { file: { id: `lib_${saves.length}`, name: f.name, bytes: f.bytes.byteLength } }; } };
const conns = async (t) => withCustomRows(env, t, []);
const run = async (slug, args = {}, t = "t1") => runAppTool(env, t, "app_run", { action: slug, arguments: args }, await conns(t), { files, confirm: async () => null });
const mk = async (who, url, auth) => { const r = await api(who, "POST", "/servers", { client_request_id: REQ(), name: "Cam", url, auth }); assert.equal(r.status, 200, r.text); return r.json.server; };
const rowOf = (id) => rows().find((r) => r.id === id);
const methods = () => S.reqs.map((r) => r.method);
const allText = () => JSON.stringify({ d1: rows().map(({ direct_sealed, ...r }) => r), logs });

await enable(1); await enable(2);
const sk = await mk(1, URL_KEY, { type: "api_key", key: API_KEY_SECRET }), sn = await mk(1, URL_NONE, { type: "none" });
const SK = rowOf(sk.id).slug, SN = rowOf(sn.id).slug;

// ---------- storage ----------
{
  const r = rowOf(sk.id); assert.ok(r.direct_sealed, "the key is saved for direct runs");
  assert.ok(!JSON.stringify(rows()).includes(API_KEY_SECRET), "D1 never holds the key in the clear");
  assert.ok(!r.direct_sealed.includes(API_KEY_SECRET) && !Buffer.from(r.direct_sealed.split(".")[1], "base64").toString("latin1").includes(API_KEY_SECRET), "sealed, not just encoded");
  assert.deepEqual(await openDirect(env, r), { header: "Authorization", value: `Bearer ${API_KEY_SECRET}` });
  assert.deepEqual(await openDirect(env, rowOf(sn.id)), { header: null, value: null });
  assert.equal(await openDirect(env, { ...r, id: rowOf(sn.id).id }), null, "a sealed value copied to another row is refused");
  assert.equal(await openDirect(env, { ...r, endpoint: "https://evil.other-demo.io/mcp" }), null, "a row whose address was changed is refused");
  assert.equal(await openDirect({ ...env, VAULT_KEY: randomBytes(32).toString("base64") }, r), null, "another vault key can't open it");
  const view = (await api(1, "GET", "")).text + (await api(1, "GET", `/servers/${sk.id}`)).text;
  assert.ok(!view.includes("direct_sealed") && !view.includes(API_KEY_SECRET), "the browser never gets the key or the sealed value");
  ok("an API-key server's address and header are saved sealed with the vault key, bound to the row and address, and never returned");
}

// ---------- the call: text + image, JSON and SSE ----------
for (const mode of ["json", "sse"]) {
  reset(); S.mode = mode; saves = []; const before = C.executed.length;
  const out = await run(`${SK}_LIVE_SNAPSHOT`, { camera_id: "studio" });
  assert.deepEqual(methods(), ["initialize", "notifications/initialized", "tools/list", "tools/call"], mode);
  assert.ok(S.reqs.every((r) => r.auth === `Bearer ${API_KEY_SECRET}` && r.redirect === "manual" && r.url === URL_KEY && /text\/event-stream/.test(r.accept)), "key header, redirects refused, same address");
  assert.equal(S.reqs[3].name, "live_snapshot", "the server's own tool name, not Composio's slug"); assert.deepEqual(S.reqs[3].args, { camera_id: "studio" }); assert.equal(S.reqs[3].session, "sess-abc", "the session id is sent back");
  assert.equal(C.executed.length, before, "nothing went through Composio's execute");
  assert.equal(saves.length, 1); assert.deepEqual(saves[0].bytes, pngBytes); assert.equal(saves[0].mime, "image/png");
  assert.match(out, /Saved "[^"]+\.png"/); assert.match(out, /read_file/); assert.match(out, /Latest image for studio/); assert.ok(!out.includes(PNG), "no Base64 left for the helper");
  assert.ok(!out.includes(API_KEY_SECRET) && !allText().includes(API_KEY_SECRET), `the key is in no result, row field or log (${mode})`);
}
ok("app_run on an API-key server: initialize, initialized, tools/list, tools/call in order with the key header, the server's own tool name and session id; text and image arrive, the PNG is saved to the Library; JSON and event-stream replies both work");

// ---------- other content blocks ----------
{
  reset(); saves = []; const out = await run(`${SK}_PDF_REPORT`, {});
  assert.equal(saves.length, 1, "an embedded resource blob is saved"); assert.equal(saves[0].name, "report.png"); assert.match(out, /report/); assert.match(out, /"pages":1/, "structuredContent is kept");
  reset(); saves = []; const e = await run(`${SK}_ECHO`, { text: "hi" }); assert.match(e, /you said hi/); assert.equal(saves.length, 0);
  assert.equal(resultValue({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "a\nb", "text blocks are joined");
  assert.deepEqual(resultValue({ content: [{ type: "image", data: PNG, mimeType: "image/png" }] }), { content: [{ type: "image", data: PNG, mimeType: "image/png" }] });
  ok("embedded resource blobs are saved, structuredContent is kept, text blocks are joined");
}

// ---------- tool error ----------
{
  reset(); const out = await run(`${SK}_BOOM`, {});
  assert.match(out, /^error: .*the server's tool reported an error: bad input/); assert.ok(!out.includes(API_KEY_SECRET), "a server that echoes the key doesn't leak it"); assert.match(out, /\[hidden\]/);
  ok("isError becomes a tool error and the key is scrubbed out of the server's message");
}

// ---------- no sign-in server ----------
{
  reset(); S.needAuth = false; const out = await run(`${SN}_ECHO`, { text: "open" });
  assert.match(out, /you said open/); assert.ok(S.reqs.every((r) => r.auth === undefined), "no header is sent when the server has no sign-in");
  ok("a server with no sign-in is called directly without any auth header");
}

// ---------- refusals ----------
{
  reset(); S.redirect = true; let out = await run(`${SK}_ECHO`, { text: "x" });
  assert.match(out, /^error: .*redirect/); assert.equal(S.reqs.length, 1, "the redirect was not followed and nothing more was sent"); assert.ok(!S.reqs.some((r) => /169\.254/.test(r.url)));
  reset(); hooks.resolve = async () => ({ Status: 0, Answer: [{ type: 1, data: "10.0.0.7" }] }); out = await run(`${SK}_ECHO`, { text: "x" });
  assert.match(out, /^error: .*private or internal/); assert.equal(S.reqs.length, 0, "a name that points at a private address is never contacted");
  reset(); hooks.resolve = async () => { throw new Error("doh down"); }; out = await run(`${SK}_ECHO`, { text: "x" });
  assert.match(out, /^error: .*couldn't be checked/); assert.equal(S.reqs.length, 0, "when the address can't be checked, nothing is sent");
  reset(); d1.prepare("UPDATE custom_mcp_server SET endpoint=? WHERE id=?").run("https://10.0.0.1/mcp", sk.id); out = await run(`${SK}_ECHO`, { text: "x" });
  assert.equal(S.reqs.length, 0, "a tampered row is never contacted"); assert.match(out, /^error: /);
  d1.prepare("UPDATE custom_mcp_server SET endpoint=? WHERE id=?").run(URL_KEY, sk.id);
  reset(); S.key = "another-key"; out = await run(`${SK}_ECHO`, { text: "x" });
  assert.match(out, /^error: .*Update key/); assert.ok(!out.includes(API_KEY_SECRET));
  ok("a redirect, a private address, an unverifiable address, a tampered row and a rejected key are all refused with nothing leaked or followed");
}
{
  const keep = DIRECT.maxResponse; DIRECT.maxResponse = 2000;
  reset(); S.bigHeader = true; let out = await run(`${SK}_ECHO`, { text: "x" }); assert.match(out, /^error: .*too large/);
  reset(); S.bigBody = true; out = await run(`${SK}_ECHO`, { text: "x" }); assert.match(out, /^error: .*too large/);
  DIRECT.maxResponse = keep; assert.ok(DIRECT.maxResponse >= 25 * 1024 * 1024 * 4 / 3 && DIRECT.maxResponse < 40 * 1024 * 1024, "the cap fits a 25 MB file as Base64 and stays below 250 MB (it is held in memory)");
  ok("an oversize answer is refused whether its length is announced or only found while reading");
}

// ---------- isolation ----------
{
  reset(); const out = await run(`${SK}_ECHO`, { text: "x" }, "t2");
  assert.match(out, /NOT AVAILABLE/); assert.equal(S.reqs.length, 0, "another workspace can't make 1Helm call this person's server");
  ok("another workspace can't run a server it doesn't own");
}

// ---------- name matching ----------
{
  assert.equal(mcpNameFor("CUSTOM_HC_AAA_LIVE_SNAPSHOT", "CUSTOM_HC_AAA", ["live_snapshot", "echo"]), "live_snapshot");
  assert.equal(mcpNameFor("CUSTOM_HC_AAA_LIVE_SNAPSHOT", "CUSTOM_HC_AAA", ["liveSnapshot"]), "liveSnapshot");
  assert.equal(mcpNameFor("CUSTOM_HC_AAA_LIVE_SNAPSHOT", "CUSTOM_HC_AAA", ["live-snapshot", "live_snapshot"]), null, "two matches are not guessed");
  assert.equal(mcpNameFor("CUSTOM_HC_AAA_LIVE_SNAPSHOT", "CUSTOM_HC_AAA", ["other"]), null);
  assert.equal(mcpNameFor("CUSTOM_HC_BBB_LIVE_SNAPSHOT", "CUSTOM_HC_AAA", ["live_snapshot"]), null);
  reset(); const before = C.executed.length; TOOLS.push({ name: "twin-tool" }, { name: "twin_tool" });
  C.toolkits.get(SK).tools.push({ slug: `${SK}_TWIN_TOOL`, name: "twin", description: "d", version: "v", tags: [], toolkit: { slug: SK }, input_parameters: { type: "object", properties: {}, required: [] } });
  const out = await run(`${SK}_TWIN_TOOL`, {}); TOOLS.pop(); TOOLS.pop();
  assert.ok(!S.reqs.some((r) => r.method === "tools/call"), "no tools/call was sent for an ambiguous name"); assert.equal(C.executed.length, before + 1, "it went through Composio instead");
  ok("the server's tool name is found from the Composio slug; an ambiguous or unmatched name falls back to Composio before anything runs");
}

// ---------- fallback without a stored key, and OAuth ----------
{
  const noVault = { ...env }; delete noVault.VAULT_KEY;
  // A server added when no key could be saved (as before this change): created with the vault off.
  const saved = env.VAULT_KEY; delete env.VAULT_KEY;
  C.servers["https://legacy.acme-demo.dev/mcp"] = { ...SERVER("api_key", API_KEY_SECRET), tools: TOOLS };
  const old = await mk(1, "https://legacy.acme-demo.dev/mcp", { type: "api_key", key: API_KEY_SECRET }); env.VAULT_KEY = saved;
  assert.equal(rowOf(old.id).direct_sealed, null);
  reset(); const before = C.executed.length; const out = await run(`${rowOf(old.id).slug}_ECHO`, { text: "legacy" });
  assert.equal(S.reqs.length, 0, "no direct call without a stored key"); assert.equal(C.executed.length, before + 1, "Composio ran it as before"); assert.match(out, /ok/);
  const oa = await api(1, "POST", "/servers", { client_request_id: REQ(), name: "OA", url: "https://oauth.acme-demo.dev/mcp", auth: { type: "oauth" } });
  assert.equal(rowOf(oa.json.server.id).direct_sealed, null, "an OAuth server has nothing saved: Composio holds its token");
  ok("a server with no stored key (added earlier) and an OAuth server keep running through Composio");

  // ---------- Update key ----------
  const slug = rowOf(old.id).slug, accBefore = rowOf(old.id).account_id;
  reset(); let r = await api(1, "POST", `/servers/${old.id}/key`, { key: "wrong-key" });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, "key_rejected"); assert.equal(rowOf(old.id).direct_sealed, null, "a rejected key is not saved"); assert.ok(!r.text.includes("wrong-key"));
  reset(); S.key = "new-key-456"; C.servers["https://legacy.acme-demo.dev/mcp"].key = "new-key-456";
  r = await api(1, "POST", `/servers/${old.id}/key`, { key: "new-key-456" });
  assert.equal(r.status, 200, r.text); assert.ok(!r.text.includes("new-key-456")); assert.ok(rowOf(old.id).direct_sealed);
  assert.notEqual(rowOf(old.id).account_id, accBefore, "Composio's copy of the key was replaced"); assert.ok(!C.accounts.some((a) => a.id === accBefore), "the old Composio account was deleted");
  assert.equal(C.accounts.find((a) => a.id === rowOf(old.id).account_id).key, "new-key-456");
  const out2 = await run(`${slug}_ECHO`, { text: "after" }); assert.match(out2, /you said after/); assert.ok(S.reqs.some((q) => q.method === "tools/call"), "now run directly");
  assert.ok(!allText().includes("new-key-456"));
  r = await api(2, "POST", `/servers/${old.id}/key`, { key: "x" }); assert.equal(r.status, 404, "another workspace can't change this key");
  r = await api(1, "POST", `/servers/${oa.json.server.id}/key`, { key: "x" }); assert.equal(r.json.error.code, "unsupported_auth");
  ok("Update key: tried on the server first, saved sealed, Composio's copy replaced, then tools run directly; another workspace and OAuth servers are refused");
}

// ---------- disconnect ----------
{
  const id = sk.id; const r = await api(1, "DELETE", `/servers/${id}`); assert.equal(r.status, 200);
  assert.equal(rows().find((x) => x.id === id), undefined, "the row, and the sealed key with it, is gone");
  reset(); const out = await run(`${SK}_ECHO`, { text: "x" }); assert.match(out, /NOT AVAILABLE/); assert.equal(S.reqs.length, 0);
  ok("disconnecting deletes the saved key with the row and the server can no longer be called");
}
console.log(`${n} passed`);
process.exit(0);
