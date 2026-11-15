// Custom MCP, direct tool runs. A custom MCP server that a person added with an API key (or with no sign-in) is registered and listed
// through Composio (custom-mcp.js), but its tool calls are sent by this Worker straight to the person's server over MCP Streamable HTTP.
// Why: Composio's /tools/execute keeps only the first content block of an MCP tools/call result, so a server that returns text and then an
// image loses the image. Calling the server ourselves gives 1Helm the whole content[] (composio-files.js saveOutputs then saves images and
// files to the Library).
//
// What is stored: custom_mcp_server.direct_sealed holds { v, id, endpoint, header, value } as JSON, AES-GCM sealed with the platform VAULT_KEY by
// sealSecret() (sentinel.js, the same helper that seals saved logins and Composio Self-managed tokens). `value` is the full header value
// (for example "Bearer <key>"). The row id and endpoint inside the sealed text are checked when it is opened, so a sealed value copied to
// another row, or a row whose endpoint was changed, is refused and never sent anywhere. The value is opened only here, inside callDirect(),
// is sent only to row.endpoint, and is never logged, returned to the browser, put in a tool result or put in an error (errors are scrubbed).
// The row, and with it the sealed value, is deleted when the server is disconnected (removeServer clears it first).
//
// Safety of the backend fetch (the address is typed by a person): checkPublicUrl() and dnsCheck({ strict: true }) run before EVERY request
// (custom-mcp-url.js), redirects are refused (redirect: "manual"), each request has a timeout, and a response is cut off at MAX_RESPONSE bytes
// (a file inside it is at most APP_FILE_BUFFER_MAX once decoded). OAuth servers have no stored value here and keep going through Composio.
import { sealSecret, openSecret } from "../sentinel.js";
import { checkPublicUrl, dnsCheck, UrlError } from "./custom-mcp-url.js";
import { APP_FILE_BUFFER_MAX } from "./composio-files.js";

export const DIRECT = {
  protocol: "2025-06-18", setupMs: 20000, callMs: 60000,
  maxSmall: 1024 * 1024,                                       // initialize, tools/list and notification responses
  maxResponse: Math.ceil(APP_FILE_BUFFER_MAX * 4 / 3) + 1024 * 1024,   // a tools/call response: a file of APP_FILE_BUFFER_MAX as Base64, plus its JSON
  listPages: 5, textMax: 8000,
};
export class DirectError extends Error { constructor(message, code = "direct_failed") { super(message); this.code = code; } }

// ---------------- sealing ----------------
// → the sealed text, or null when this Worker has no VAULT_KEY (then the server keeps using Composio).
export async function sealDirect(env, row, { header = null, value = null } = {}) {
  if (!env?.VAULT_KEY) return null;
  return sealSecret(env, JSON.stringify({ v: 1, id: row.id, endpoint: row.endpoint, header, value }));
}
// → { header, value } (both null for a server with no sign-in) or null when it can't be opened or isn't this row's.
export async function openDirect(env, row) {
  if (!row?.direct_sealed || !env?.VAULT_KEY) return null;
  try {
    const o = JSON.parse(await openSecret(env, row.direct_sealed));
    if (o?.v !== 1 || o.id !== row.id || o.endpoint !== row.endpoint) return null;
    if (o.header != null && !/^[A-Za-z0-9-]{1,64}$/.test(String(o.header))) return null;
    return { header: o.header ?? null, value: o.value ?? null };
  } catch { return null; }
}
export const hasDirect = (row) => !!row?.direct_sealed;

// ---------------- tool names ----------------
// Composio names a custom tool <TOOLKIT SLUG>_<the server's tool name, upper-cased with other characters as _> (CUSTOM_HP_X_LIVE_SNAPSHOT for
// live_snapshot, "Live snapshot" being only its display title). The server's own name is found by listing the server's tools and matching that
// suffix; no stored table can go out of date. Zero or several matches → null (the call then goes through Composio, nothing has run yet).
const plainNorm = (n) => String(n).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
const camelNorm = (n) => plainNorm(String(n).replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
export function mcpNameFor(slug, toolkitSlug, names) {
  const up = String(slug || "").toUpperCase(), pre = `${String(toolkitSlug).toUpperCase()}_`;
  if (!up.startsWith(pre)) return null;
  const suffix = up.slice(pre.length);
  const exact = names.filter((n) => plainNorm(n) === suffix);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const camel = names.filter((n) => camelNorm(n) === suffix);
  return camel.length === 1 ? camel[0] : null;
}

// ---------------- the HTTP exchange ----------------
const scrub = (text, secrets) => {
  let t = String(text ?? "");
  for (const s of secrets) if (s) t = t.split(s).join("[hidden]");
  return t;
};
const plain = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// Reads a response body, at most `max` bytes (the content-length header is checked first, then the stream is cut off).
async function readCapped(res, max) {
  const len = Number(res.headers.get("content-length") || 0);
  if (len > max) { try { await res.body?.cancel(); } catch {} throw new DirectError("The server's answer is too large, so it was not read.", "too_large"); }
  if (!res.body?.getReader) { const b = new Uint8Array(await res.arrayBuffer()); if (b.byteLength > max) throw new DirectError("The server's answer is too large, so it was not read.", "too_large"); return new TextDecoder().decode(b); }
  const rd = res.body.getReader(), parts = []; let got = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    got += value.byteLength; if (got > max) { try { await rd.cancel(); } catch {} throw new DirectError("The server's answer is too large, so it was not read.", "too_large"); }
    parts.push(value);
  }
  const all = new Uint8Array(got); let o = 0; for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}
// A text/event-stream body: events are read as they arrive and reading stops at the JSON-RPC message with this id (a server may keep the
// stream open afterwards). Other messages (notifications, requests from the server) are ignored. Capped like any other body.
async function readSse(res, id, max) {
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "", got = 0;
  const take = (ev) => {
    const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return undefined;
    let m; try { m = JSON.parse(data); } catch { return undefined; }
    return m && m.id === id && (m.result !== undefined || m.error !== undefined) ? m : undefined;
  };
  try {
    for (;;) {
      const { done, value } = await rd.read();
      if (value) { got += value.byteLength; if (got > max) throw new DirectError("The server's answer is too large, so it was not read.", "too_large"); buf += dec.decode(value, { stream: !done }); }
      for (let i; (i = buf.search(/\r?\n\r?\n/)) >= 0;) { const ev = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, ""); const m = take(ev); if (m) return m; }
      if (done) { const m = buf.trim() ? take(buf) : undefined; if (m) return m; throw new DirectError("The server ended its answer without a reply to the request.", "bad_reply"); }
    }
  } finally { try { await rd.cancel(); } catch {} }
}

// One JSON-RPC exchange. notify: no id, no reply is read. → the parsed JSON-RPC message ({ result } or { error }).
async function rpc(ctx, method, params, { notify = false, ms = DIRECT.setupMs, max = DIRECT.maxSmall } = {}) {
  // Every request: the same checks as when the address was registered, with the DNS answer required.
  let u;
  try { u = checkPublicUrl(ctx.endpoint); await dnsCheck(u.host, { resolve: ctx.resolve, strict: true }); }
  catch (e) { if (e instanceof UrlError) throw new DirectError(e.message, "private_url"); throw e; }
  const id = notify ? undefined : ++ctx.seq;
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (ctx.auth?.header && ctx.auth.value != null) headers[ctx.auth.header] = ctx.auth.value;
  if (ctx.protocol) headers["mcp-protocol-version"] = ctx.protocol;
  if (ctx.session) headers["mcp-session-id"] = ctx.session;
  let res;
  try {
    res = await (ctx.fetch || globalThis.fetch)(u.endpoint, { method: "POST", redirect: "manual", headers, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }) });
  } catch (e) {
    if (/timeout|timed out|aborted/i.test(`${e?.name} ${e?.message}`)) throw new DirectError("The server didn't answer in time.", "timeout");
    throw new DirectError("The server couldn't be reached.", "unreachable");
  }
  if (res.status >= 300 && res.status < 400) { try { await res.body?.cancel(); } catch {} throw new DirectError("The server answered with a redirect, which isn't followed, so nothing more was sent.", "redirect"); }
  if (res.status === 401 || res.status === 403) { try { await res.body?.cancel(); } catch {} throw new DirectError(`The server refused the saved sign-in (HTTP ${res.status}). Use Update key on this server in Settings → Advanced.`, "auth"); }
  const sid = res.headers.get("mcp-session-id"); if (sid && method === "initialize") ctx.session = sid;
  if (notify) { try { await res.body?.cancel(); } catch {} if (res.status >= 400) throw new DirectError(`The server answered HTTP ${res.status}.`, "http"); return null; }
  const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  let msg;
  if (res.ok && type === "text/event-stream" && res.body?.getReader) msg = await readSse(res, id, max);
  else {
    const text = await readCapped(res, max);
    try { msg = JSON.parse(text); } catch { msg = null; }
    if (Array.isArray(msg)) msg = msg.find((m) => m?.id === id) || null;   // a batch reply
    if (!res.ok && !msg?.error) throw new DirectError(`The server answered HTTP ${res.status}.`, "http");
    if (!msg || typeof msg !== "object") throw new DirectError("The server's answer wasn't a valid MCP reply.", "bad_reply");
  }
  if (msg.error) throw new DirectError(`The server said: ${plain(scrub(msg.error?.message || "error", ctx.secrets), 300)}`, "server_error");
  return msg;
}

// Opens a session with the server: initialize, then notifications/initialized. → ctx for the later calls.
async function open(env, row, { fetchImpl, resolve } = {}) {
  const auth = await openDirect(env, row);
  if (!auth) throw new DirectError("The saved sign-in for this server couldn't be read. Use Update key on this server in Settings → Advanced.", "no_credentials");
  const secrets = [auth.value, ...String(auth.value || "").split(/\s+/).filter((t) => t.length >= 6)];
  const ctx = { endpoint: row.endpoint, auth, secrets, seq: 0, session: null, protocol: null, fetch: fetchImpl, resolve };
  const init = await rpc(ctx, "initialize", { protocolVersion: DIRECT.protocol, capabilities: {}, clientInfo: { name: "1Helm", version: "1" } });
  ctx.protocol = /^\d{4}-\d{2}-\d{2}$/.test(String(init.result?.protocolVersion || "")) ? init.result.protocolVersion : DIRECT.protocol;
  await rpc(ctx, "notifications/initialized", null, { notify: true });
  return ctx;
}
async function listNames(ctx) {
  const names = []; let cursor;
  for (let i = 0; i < DIRECT.listPages; i++) {
    const r = (await rpc(ctx, "tools/list", cursor ? { cursor } : {})).result;
    for (const t of r?.tools || []) if (t && typeof t.name === "string") names.push(t.name);
    cursor = r?.nextCursor; if (!cursor) break;
  }
  return names;
}

// ---------------- result → what the helper sees ----------------
// A result with only text blocks becomes plain text (as it was through Composio). Anything else becomes an object that keeps every block, so
// composio-files.js saveOutputs finds the image / audio / file blocks and saves them to the Library: { text?, content: [non-text blocks],
// structuredContent? }. isError → a thrown tool error (runAppTool shows it as "error: ...").
export function resultValue(result, secrets = []) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const texts = [], rest = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "resource" && b.resource && typeof b.resource === "object") {
      const r = b.resource;
      if (typeof r.text === "string") texts.push(r.text);
      else if (typeof r.blob === "string") rest.push({ type: "file", name: String(r.uri || "").split(/[?#]/)[0].split("/").pop() || undefined, mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined, data: r.blob });
    } else rest.push(b);
  }
  const structured = result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : null;
  if (result?.isError) {
    const why = plain(scrub(texts.join("\n") || (structured ? JSON.stringify(structured) : "the tool reported an error"), secrets), DIRECT.textMax);
    throw new DirectError(`the server's tool reported an error: ${why}`, "tool_error");
  }
  if (!rest.length && !structured) return texts.length ? texts.join("\n") : "(the server returned no content)";
  return { ...(texts.length ? { text: texts.join("\n") } : {}), ...(rest.length ? { content: rest } : {}), ...(structured ? { structuredContent: structured } : {}) };
}

// ---------------- the call ----------------
// row: the workspace's own usable custom_mcp_server row (the caller has checked ownership). slug: the Composio tool slug.
// → { value } | { fallback: "unmapped" } (nothing was sent as a tool call: use Composio). Throws DirectError for everything else.
export async function callDirect(env, row, slug, args, { fetchImpl = null, resolve = null } = {}) {
  const ctx = await open(env, row, { fetchImpl, resolve });
  const name = mcpNameFor(slug, row.slug, await listNames(ctx));
  if (!name) return { fallback: "unmapped" };
  const r = await rpc(ctx, "tools/call", { name, arguments: args && typeof args === "object" ? args : {} }, { ms: DIRECT.callMs, max: DIRECT.maxResponse });
  return { value: resultValue(r.result, ctx.secrets) };
}
// A check that a key is accepted by the server (initialize and tools/list). Throws DirectError when it is not. → the tool count.
export async function probeDirect(env, row, { fetchImpl = null, resolve = null } = {}) {
  const ctx = await open(env, row, { fetchImpl, resolve });
  return (await listNames(ctx)).length;
}
