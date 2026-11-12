// 1helm-design-mcp: one Worker, six MCP endpoints (streamable HTTP, stateless JSON responses). All data is public, so there is no sign-in.
//   /magicui/mcp       Magic UI registry tools (port of @magicuidesign/mcp)
//   /reactbits/mcp     React Bits registry tools
//   /canvasui/mcp      Canvas UI registry tools
//   /better-design/mcp forwards to https://better-design.com/api/mcp with the Bearer key from the BETTER_DESIGN_KEY secret
//   /inspo/mcp         forwards to Inspo's public MCP server https://inspomcp.dev/api/mcp (no key)
//   /brief/mcp         one tool, design_brief: fans out to all of the above and answers with one compact text brief
import { registryTools } from "./registry.js";
import { briefTools } from "./brief.js";

const BETTER_DESIGN_URL = "https://better-design.com/api/mcp";
const INSPO_URL = "https://inspomcp.dev/api/mcp";
const LATEST = "2025-06-18";
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CORS = {
 "access-control-allow-origin": "*",
 "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
 "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
 "access-control-expose-headers": "mcp-session-id",
};

const ENDPOINTS = [
 ["/magicui/mcp", "Magic UI: animated React components (listRegistryItems, searchRegistryItems, getRegistryItem)"],
 ["/reactbits/mcp", "React Bits: animated backgrounds, text effects and components (same three tools)"],
 ["/canvasui/mcp", "Canvas UI: canvas, WebGL and 3D components (same three tools)"],
 ["/better-design/mcp", "Better Design: design systems, UX principles, motion, icons, review rules (forwarded with a key held here)"],
 ["/inspo/mcp", "Inspo: references captured from real production websites (screens, palettes, type, components; forwarded, no key)"],
 ["/brief/mcp", "Design brief: one tool, design_brief, returns references, design tokens, rules and component suggestions in one text answer"],
];

function json(body, status = 200, extra = {}) {
 return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleRpc(msg, serverId, tools, env) {
 if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "Invalid request");
 const isNotification = msg.id === undefined || msg.id === null;
 const { method, params = {} } = msg;
 if (isNotification) return null;
 if (method === "initialize") {
  const asked = params && params.protocolVersion;
  return { jsonrpc: "2.0", id: msg.id, result: {
   protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
   capabilities: { tools: {} },
   serverInfo: { name: `1helm-design-${serverId}`, version: "1.0.0" },
  } };
 }
 if (method === "ping") return { jsonrpc: "2.0", id: msg.id, result: {} };
 if (method === "tools/list") {
  return { jsonrpc: "2.0", id: msg.id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
 }
 if (method === "tools/call") {
  const tool = tools.find((t) => t.name === params.name);
  if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  try {
   const out = await tool.call(args, env);
   return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: tool.text ? String(out) : JSON.stringify(out, null, 2) }] } };
  } catch (e) {
   const why = e instanceof Error ? e.message : String(e);
   return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `${tool.failure || "Error"}: ${why}` }], isError: true } };
  }
 }
 return rpcError(msg.id, -32601, `Method not found: ${method}`);
}

async function serveRegistry(request, serverId, env) {
 if (request.method !== "POST") return json(rpcError(null, -32000, "Method not allowed. POST JSON-RPC messages to this URL."), 405, { allow: "POST, OPTIONS" });
 let body;
 try {
  body = await request.json();
 } catch {
  return json(rpcError(null, -32700, "Parse error"), 400);
 }
 const tools = serverId === "brief" ? briefTools : registryTools(serverId);
 if (Array.isArray(body)) {
  const out = (await Promise.all(body.map((m) => handleRpc(m, serverId, tools, env)))).filter(Boolean);
  return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
 }
 const out = await handleRpc(body, serverId, tools, env);
 return out ? json(out) : new Response(null, { status: 202, headers: CORS });
}

async function forwardBetterDesign(request, env) {
 const key = env && env.BETTER_DESIGN_KEY;
 if (!key) return json(rpcError(null, -32000, "Better Design is not configured on this server (BETTER_DESIGN_KEY is not set)."), 503);
 return forward(request, BETTER_DESIGN_URL, key, "Better Design");
}

async function forward(request, target, key, label) {
 const headers = new Headers();
 for (const h of ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"]) {
  const v = request.headers.get(h);
  if (v) headers.set(h, v);
 }
 if (key) headers.set("authorization", `Bearer ${key}`);
 const init = { method: request.method, headers };
 if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
 let upstream;
 try {
  upstream = await fetch(target, init);
 } catch (e) {
  return json(rpcError(null, -32000, `Could not reach ${label}.`), 502);
 }
 const out = new Headers(CORS);
 for (const h of ["content-type", "mcp-session-id", "cache-control", "www-authenticate"]) {
  const v = upstream.headers.get(h);
  if (v) out.set(h, v);
 }
 return new Response(upstream.body, { status: upstream.status, headers: out });
}

function indexText(origin) {
 return ["1Helm design MCP servers (streamable HTTP, public design sources):", "", ...ENDPOINTS.map(([p, d]) => `${origin}${p}\n  ${d}`), ""].join("\n");
}

export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (path === "/") return new Response(indexText(url.origin), { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
  if (path === "/magicui/mcp") return serveRegistry(request, "magicui", env);
  if (path === "/reactbits/mcp") return serveRegistry(request, "reactbits", env);
  if (path === "/canvasui/mcp") return serveRegistry(request, "canvasui", env);
  if (path === "/brief/mcp") return serveRegistry(request, "brief", env);
  if (path === "/inspo/mcp") return forward(request, INSPO_URL, null, "Inspo");
  if (path === "/better-design/mcp") return forwardBetterDesign(request, env);
  return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain", ...CORS } });
 },
};
