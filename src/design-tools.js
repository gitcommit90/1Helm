// Design MCP servers as real tools (Captain 2026-10-19: "The agent already loads up the design skill, we just gotta expose these tools so they can
// actually use them"). Four servers are hosted at https://mcp.1helm.com (design-mcp/src/index.js, streamable HTTP): /better-design/mcp,
// /magicui/mcp, /reactbits/mcp and /canvasui/mcp. Inspo is called at its own public endpoint, https://inspomcp.dev/api/mcp (no key, no Authorization header). This file is a small MCP client for them and the tool definitions the Resident offers.
//   * Names: <prefix>_<server tool name with every character outside A-Z a-z 0-9 _ turned into _>, e.g. inspo_search_screens,
//     better_design_get_design_system_kit, magicui_getRegistryItem. Descriptions and input schemas are the server's own.
//   * tools/list is cached in this isolate (TTL below, stale copy kept when a refresh fails) and is read once at the start of a turn
//     (Resident.runTurnInner calls prepareDesignTools next to betterDesignOn), so availableTools() stays synchronous and no turn waits on it again.
//   * Better Design's tools are offered only while the account's Better Design switch is on (better-design.js), and are checked again at call time.
//   * Better Design is one shared key for every 1Helm account, so the tools that read or change the key's own account state (team rules, design
//     config, feedback, claim link) are not offered: BD_NOT_OFFERED.
//   * Results are untrusted data (resident.js untrusted wrapper) and are cut to RESULT_MAX characters with a note on how to ask for less.
import { coerceArgs, checkArgs } from "./payload-cut.js";

// Public edition: nothing here runs unless the admin sets DESIGN_MCP_URL (for example https://mcp.1helm.com, or their own deploy of design-mcp/).
// That base serves the four hosted servers. Inspo is called at its own public endpoint, but only under the same opt-in, so a self-hosted install
// makes no outbound design call and offers no design tool until it is configured.
let BASE = "";
export const designBase = (env) => String(env?.DESIGN_MCP_URL || "").trim().replace(/\/+$/, "");
const setBase = (env) => (BASE = designBase(env));
export const DESIGN_SERVERS = [
  { id: "inspo", prefix: "inspo", path: "/inspo/mcp", url: "https://inspomcp.dev/api/mcp", label: "Inspo" },
  { id: "better-design", prefix: "better_design", path: "/better-design/mcp", label: "Better Design", betterDesign: true },
  { id: "magicui", prefix: "magicui", path: "/magicui/mcp", label: "Magic UI" },
  { id: "reactbits", prefix: "reactbits", path: "/reactbits/mcp", label: "React Bits" },
  { id: "canvasui", prefix: "canvasui", path: "/canvasui/mcp", label: "Canvas UI" },
];
export const BD_NOT_OFFERED = new Set(["get-team-rules", "propose-team-rule", "set-team-rules", "get-design-config", "set-design-config", "send-feedback", "confirm-claim"]);
export const LIST_TTL_MS = 6 * 3600e3, FAIL_RETRY_MS = 60e3, CALL_TIMEOUT_MS = 25e3, LIST_TIMEOUT_MS = 6e3, RESULT_MAX = 24000, NAME_MAX = 64;
const PROTOCOL = "2025-06-18";

const nameOf = (s, toolName) => `${s.prefix}_${String(toolName).replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, NAME_MAX);
const PREFIX_RE = new RegExp(`^(${DESIGN_SERVERS.map((s) => s.prefix).join("|")})_`);
export const isDesignToolName = (name) => PREFIX_RE.test(String(name || ""));

// ---- the cache (per isolate) ----
const lists = new Map();      // server id -> { at, tools: [{ name, full, remote, description, inputSchema }], failedAt }
const inflight = new Map();   // server id -> promise
const sessions = new Map();   // server id -> { sid } once initialized
export function resetDesignToolsCache() { lists.clear(); inflight.clear(); sessions.clear(); BASE = ""; }

// ---- JSON-RPC over HTTP ----
const withTimeout = (ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };
// The reply is JSON, or an event stream whose "data:" events are JSON-RPC messages (the one with our id is the answer).
export async function readRpc(resp, id) {
  const text = await resp.text(), type = String(resp.headers?.get?.("content-type") || "");
  if (!text.trim()) return null;
  if (/text\/event-stream/i.test(type) || /^\s*(event|data):/.test(text)) {
    let last = null;
    for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      let m; try { m = JSON.parse(data); } catch { continue; }
      if (m && (m.id === id || (m.id == null && !last))) last = m;
      if (m && m.id === id) break;
    }
    return last;
  }
  try { return JSON.parse(text); } catch { return null; }
}
async function post(fetchImpl, server, body, { sid = null, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const t = withTimeout(timeoutMs);
  try {
    return await fetchImpl(server.url || BASE + server.path, { method: "POST", signal: t.signal,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL, ...(sid ? { "mcp-session-id": sid } : {}) },
      body: JSON.stringify(body) });
  } finally { t.done(); }
}
let seq = 0;
const nextId = () => ++seq;
// initialize (+ the initialized notification); follows Mcp-Session-Id when the server returns one.
async function session(fetchImpl, server, { fresh = false, timeoutMs } = {}) {
  if (!fresh && sessions.has(server.id)) return sessions.get(server.id);
  const id = nextId(), r = await post(fetchImpl, server, { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "1helm", version: "1.0.0" } } }, { timeoutMs });
  if (!r.ok) throw new Error(`${server.label} answered ${r.status} to initialize`);
  const m = await readRpc(r, id); if (m?.error) throw new Error(`${server.label}: ${m.error.message || "initialize failed"}`);
  const s = { sid: r.headers?.get?.("mcp-session-id") || null };
  try { await post(fetchImpl, server, { jsonrpc: "2.0", method: "notifications/initialized" }, { sid: s.sid, timeoutMs }); } catch {}
  sessions.set(server.id, s); return s;
}
// One request/response; one retry with a fresh session when the server says the session is gone (404 or 400 with a session in use).
async function rpc(fetchImpl, server, method, params, { timeoutMs } = {}) {
  for (let attempt = 0; ; attempt++) {
    const s = await session(fetchImpl, server, { fresh: attempt > 0, timeoutMs }), id = nextId();
    const r = await post(fetchImpl, server, { jsonrpc: "2.0", id, method, params }, { sid: s.sid, timeoutMs });
    if (!r.ok && attempt === 0 && (r.status === 404 || r.status === 400) && s.sid) { sessions.delete(server.id); continue; }
    if (!r.ok) throw new Error(`${server.label} answered ${r.status}`);
    const m = await readRpc(r, id);
    if (!m) throw new Error(`${server.label} sent no answer`);
    if (m.error) throw new Error(String(m.error.message || "request failed").slice(0, 300));
    return m.result;
  }
}

// ---- tools/list, cached ----
async function listOne(fetchImpl, server) {
  const result = await rpc(fetchImpl, server, "tools/list", {}, { timeoutMs: LIST_TIMEOUT_MS });
  const seen = new Set(), tools = [];
  for (const t of result?.tools || []) {
    if (!t || typeof t.name !== "string" || (server.betterDesign && BD_NOT_OFFERED.has(t.name))) continue;
    const full = nameOf(server, t.name); if (seen.has(full)) continue; seen.add(full);
    const schema = t.inputSchema && typeof t.inputSchema === "object" ? { ...t.inputSchema } : { type: "object", properties: {} };
    delete schema.$schema; if (!schema.type) schema.type = "object"; if (schema.type === "object" && !schema.properties) schema.properties = {};
    tools.push({ name: t.name, full, description: String(t.description || t.name), inputSchema: schema });
  }
  return tools;
}
export async function prepareDesignTools(env, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!setBase(env)) return;   // not configured: no request and no tools
  await Promise.all(DESIGN_SERVERS.map(async (s) => {
    const cur = lists.get(s.id);
    if (cur && ((cur.tools && now - cur.at < LIST_TTL_MS) || (cur.failedAt && now - cur.failedAt < FAIL_RETRY_MS))) return;
    if (!inflight.has(s.id)) inflight.set(s.id, listOne(fetchImpl, s).then((tools) => { lists.set(s.id, { at: now, tools }); }, (e) => {
      console.log("design tools list failed", s.id, String(e?.message || e).slice(0, 120));
      lists.set(s.id, { at: cur?.at || 0, tools: cur?.tools || null, failedAt: now }); }).finally(() => inflight.delete(s.id)));
    await inflight.get(s.id);
  }));
}
// The tool definitions (the shape of every tool in Resident.tools()). betterDesign false: Better Design's tools are left out.
export function designToolDefs({ betterDesign = false } = {}) {
  if (!BASE) return [];   // not configured (prepareDesignTools sets the base)
  const out = [];
  for (const s of DESIGN_SERVERS) {
    if (s.betterDesign && !betterDesign) continue;
    for (const t of lists.get(s.id)?.tools || []) {
      out.push({ type: "function", function: { name: t.full, description: `[${s.label}] ${t.description}`, parameters: t.inputSchema } });
    }
  }
  return out;
}
const find = (full) => { for (const s of DESIGN_SERVERS) for (const t of lists.get(s.id)?.tools || []) if (t.full === full) return { s, t }; return null; };

// Run one design tool. Returns text for the model (never throws). betterDesign: the account's switch right now.
export async function designToolCall(env, fullName, args, { betterDesign = false, fetchImpl = globalThis.fetch, wrap = (src, body) => body } = {}) {
  if (!setBase(env)) return "error: the design sources are not configured on this install (DESIGN_MCP_URL is not set).";
  const hit = find(fullName);
  if (!hit) return `error: unknown tool ${fullName}`;
  const { s, t } = hit;
  if (s.betterDesign && !betterDesign) return "error: Better Design is switched off for this account (Settings), so its tools are not available. Use Inspo, Magic UI, React Bits and Canvas UI.";
  const a = coerceArgs(args && typeof args === "object" && !Array.isArray(args) ? args : {}, t.inputSchema), problems = checkArgs(a, t.inputSchema);
  if (problems.length) return `error: this call was not run because its arguments do not match the tool: ${problems.join("; ")}. Call it again with correct arguments.\n${JSON.stringify({ tool: { name: t.full, description: t.description, parameters: t.inputSchema } })}`;
  let result;
  try { result = await rpc(fetchImpl, s, "tools/call", { name: t.name, arguments: a }); }
  catch (e) { return `error: ${s.label} did not answer: ${String(e?.name === "AbortError" ? "timed out" : e?.message || e).slice(0, 200)}`; }
  const parts = Array.isArray(result?.content) ? result.content : [];
  let text = parts.map((p) => p?.type === "text" ? String(p.text ?? "") : p?.type === "image" ? "[image omitted]" : p?.type === "resource" ? String(p.resource?.text ?? "") : "").filter(Boolean).join("\n");
  if (!text && result?.structuredContent) text = JSON.stringify(result.structuredContent);
  if (!text) text = "(the tool returned no text)";
  if (text.length > RESULT_MAX) text = `${text.slice(0, RESULT_MAX)}\n[Cut at ${RESULT_MAX} of ${text.length} characters. Ask for less (a narrower query, fewer items, a more specific id) to see the rest.]`;
  const body = wrap(`the ${s.label} design tool ${t.name}`, text);
  return result?.isError ? `error: ${s.label} reported an error.\n${body}` : body;
}
