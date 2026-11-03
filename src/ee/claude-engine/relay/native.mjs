// Request building, history replay, admission transforms and response translation for the Claude engine.
//
// Ported from the Nous Research Hermes plugin "claude-subscription-directsdk" (admission.py, directsdk.py, model_catalog.py, inert_mcp.py),
// https://github.com/NousResearch/hermes-official-plugins/tree/main/claude-subscription-directsdk, MIT License, Copyright (c) 2026 Nous Research
// and contributors. The full notice is in THIRD-PARTY-NOTICES.md. Changes from the original: JavaScript instead of Python, 1Helm's chat.completions
// request instead of Hermes' client kwargs, the tool name prefix "mcp__onehc__", and no Hermes host imports (the nullable-union schema cleanup and the
// effort clamp are written here).
//
// Pure functions only (no process, no network), so the Worker tests can load this file directly.

export const CARRIER = "1helm-claude-engine.native_assistant";
export const PREFIX = "mcp__onehc__";
export const MCP_SERVER = "onehc";
const UNCACHEABLE = ["thinking", "redacted_thinking"];
const LOOKBACK = 20, MAX_BREAKPOINTS = 4;

// ---------- small helpers ----------
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
export function deepEq(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  if (isObj(a)) { if (!isObj(b)) return false; const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => k in b && deepEq(a[k], b[k])); }
  return false;
}
const clone = (x) => structuredClone(x);
const plain = (b) => (isObj(b) ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== "cache_control")) : b);
const keysSubset = (b, allowed) => Object.keys(b).every((k) => allowed.includes(k));
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
export class BadRequest extends Error { constructor(m) { super(m); this.status = 400; } }
class QueriedTurnMismatch extends Error {}

// ---------- model catalog ----------
export const CONTEXT_WINDOWS = {
  "claude-sonnet-5-5": 1e6, "claude-sonnet-5": 1e6, "claude-haiku-5-5": 1e6, "claude-haiku-4-5-20251001": 2e5,
  "claude-opus-5-5": 1e6, "claude-opus-5": 1e6, "claude-opus-4-8": 1e6, "claude-fable-5-1": 1e6,
};
const MANDATORY_THINKING = ["claude-fable", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const ALIASES = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", "claude-haiku-4-5": "claude-haiku-4-5-20251001", opus: "claude-opus-5-5", fable: "claude-fable-5-1" };
const NO_ADAPTIVE_THINKING = ["claude-haiku-4-5-20251001"];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function routeBase(base) {
  if (has(ALIASES, base) || has(CONTEXT_WINDOWS, base)) return base;
  const dotted = base.replaceAll(".", "-"); if (dotted !== base) return routeBase(dotted);
  const bare = base.startsWith("claude-") ? base.slice(7) : base;
  if (has(CONTEXT_WINDOWS, "claude-" + bare) || has(ALIASES, "claude-" + bare)) return "claude-" + bare;
  return base;
}
const stripWindow = (m) => (m.endsWith("[1m]") ? m.slice(0, -4) : m);
export function nativeModel(model) {
  const base = routeBase(stripWindow(model)), canonical = has(ALIASES, base) ? ALIASES[base] : base, window = CONTEXT_WINDOWS[canonical];
  if (window === 1e6) return canonical + "[1m]";
  if (window === 2e5) { if (model.endsWith("[1m]")) throw new BadRequest("Haiku 4.5 does not support a 1M context window"); return canonical; }
  return model;
}
const canonicalOf = (model) => { const base = typeof model === "string" ? routeBase(stripWindow(model)) : ""; return has(ALIASES, base) ? ALIASES[base] : base; };
export const acceptsThinkingDisable = (model) => !MANDATORY_THINKING.some((p) => canonicalOf(model).startsWith(p));
export const supportsAdaptiveThinking = (model) => !NO_ADAPTIVE_THINKING.includes(canonicalOf(model));

// ---------- history: chat.completions messages -> native frames ----------
// Assistant content is a string, or an array of text parts once a cache mark was put on it (withCacheBreakpoints); both read as the same visible text.
const visibleText = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => isObj(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("") : "";
export function projection(message) {
  const calls = (message.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function.name, input: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments }));
  return { content: visibleText(message.content).trim(), tool_calls: calls };
}
export function contentBlocks(content) {
  if (content == null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const out = [];
  for (const block of content) {
    const kind = block.type;
    if (kind === "text") out.push(clone(block));
    else if (kind === "image_url") {
      const url = block.image_url.url;
      if (/^https?:\/\//i.test(url)) { out.push({ type: "text", text: `[Image not attached: remote URL ${url}. Fetch it with a tool to see it.]` }); continue; }
      if (!url.startsWith("data:") || !url.includes(";base64,")) throw new BadRequest("Only base64 data image_url inputs are supported");
      const [media, data] = [url.slice(5, url.indexOf(";base64,")), url.slice(url.indexOf(";base64,") + 8)];
      out.push({ type: "image", source: { type: "base64", media_type: media, data } });
    } else if (["image", "document", "tool_result"].includes(kind)) out.push(clone(block));
    else throw new BadRequest(`Unsupported content block: ${kind}`);
  }
  return out;
}
// One native session id for every request of one conversation (system prompt plus first frame), so the cache prefix holds.
export async function conversationSessionId(system, frames) {
  const first = frames.length ? frames[0].message : null;
  const h = await sha256hex(JSON.stringify([system, first]));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function prepareHistory(messages, names = null) {
  const system = [], frames = [];
  for (const message of messages) {
    let role = message.role, blocks;
    if (role === "system" || role === "developer") {
      if (frames.length) throw new BadRequest("System/developer messages must precede conversation history");
      const c = message.content;
      if (Array.isArray(c) && c.every((b) => b?.type === "text")) system.push(c.map((b) => b.text).join("\n"));
      else if (typeof c === "string") system.push(c); else throw new BadRequest("System content must be text");
      continue;
    }
    if (role === "assistant") {
      const carriers = (message.reasoning_details || []).filter((d) => isObj(d) && d.type === CARRIER);
      if (carriers.length) {
        if (carriers.length !== 1 || carriers[0].version !== 1) throw new BadRequest("Unsupported native assistant carrier version");
        const carrier = carriers[0], expected = { ...carrier.projection, content: carrier.projection.content.trim() };
        if (deepEq(projection(message), expected)) {
          for (let native of carrier.messages) { native = clone(native); delete native.usage; frames.push({ type: "assistant", message: native }); }
          // A cache mark on the visible reply stays on the restored native frame, on its last block that can carry one (never thinking).
          const mark = Array.isArray(message.content) ? message.content.findLast((b) => isObj(b) && b.cache_control)?.cache_control : undefined;
          const blocks = mark ? frames.at(-1).message.content : null, at = blocks ? blocks.findLastIndex((b) => isObj(b) && !UNCACHEABLE.includes(b.type)) : -1;
          if (at >= 0 && !("cache_control" in blocks[at])) blocks[at].cache_control = clone(mark);
          continue;
        }
        // The host edited the visible history (compaction, hooks): never restore stale blocks or attach their signatures to rewritten content.
      }
      blocks = contentBlocks(message.content);
      for (const call of projection(message).tool_calls) {
        let name = call.name;
        if (names === null || has(names, name)) name = PREFIX + (names ? names[name] : name);
        blocks.push({ type: "tool_use", id: call.id, name, input: call.input });
      }
    } else if (role === "tool") {
      role = "user";
      const b = { type: "tool_result", tool_use_id: message.tool_call_id, content: typeof message.content === "string" ? message.content : contentBlocks(message.content) };
      // A prompt-cache mark on the text inside a tool message belongs on the tool_result block itself (the place Anthropic takes it), so it moves up.
      if (Array.isArray(b.content)) { const at = b.content.findLastIndex((x) => isObj(x) && "cache_control" in x); if (at >= 0) { b.cache_control = b.content[at].cache_control; for (const x of b.content) if (isObj(x)) delete x.cache_control; } }
      if (message.is_error != null) b.is_error = !!message.is_error;
      blocks = [b];
    } else if (role === "user") blocks = contentBlocks(message.content);
    else throw new BadRequest(`Unsupported message role: ${role}`);
    const last = frames.at(-1);
    if (last && last.type === role && role === "user") last.message.content.push(...blocks);
    else frames.push({ type: role, message: { role, content: blocks } });
  }
  const last = frames.at(-1);
  if (!last || last.type !== "user" || !last.message.content.length) throw new BadRequest("History must end in a nonempty user or tool result message; assistant prefill is unsupported");
  return { system: system.join("\n\n"), frames };
}

// ---------- request body (the CLI's extra body) ----------
// Anthropic 400s on top-level oneOf/allOf/anyOf and on the null branch of a nullable union.
function stripNullableUnions(node) {
  if (Array.isArray(node)) return node.map(stripNullableUnions);
  if (!isObj(node)) return node;
  let out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, stripNullableUnions(v)]));
  for (const key of ["anyOf", "oneOf"]) {
    if (Array.isArray(out[key]) && out[key].some((b) => isObj(b) && b.type === "null")) {
      const rest = out[key].filter((b) => !(isObj(b) && b.type === "null"));
      const { [key]: _, ...others } = out;
      out = rest.length === 1 && isObj(rest[0]) ? { ...others, ...rest[0] } : rest.length ? { ...others, [key]: rest } : others;
    }
  }
  if (Array.isArray(out.type) && out.type.includes("null")) { const t = out.type.filter((x) => x !== "null"); out.type = t.length === 1 ? t[0] : t; }
  return out;
}
export function normalizeInputSchema(schema) {
  let n = stripNullableUnions(schema);
  if (["oneOf", "allOf", "anyOf"].some((k) => k in n)) { n = Object.fromEntries(Object.entries(n).filter(([k]) => !["oneOf", "allOf", "anyOf"].includes(k))); if (!("type" in n)) n.type = "object"; }
  if (n.type === "object" && !isObj(n.properties)) n = { ...n, properties: {} };
  return n;
}
const NUMERIC_BOUNDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"];
const UNSUPPORTED_FORMAT_KEYS = { integer: NUMERIC_BOUNDS, number: NUMERIC_BOUNDS, array: ["maxItems", "uniqueItems"], object: ["minProperties", "maxProperties"] };
export function nativeFormatSchema(node) {
  if (Array.isArray(node)) return node.map(nativeFormatSchema);
  if (!isObj(node)) return node;
  const declared = node.type, kinds = Array.isArray(declared) ? declared : [declared];
  const dropped = new Set(kinds.filter((k) => typeof k === "string").flatMap((k) => UNSUPPORTED_FORMAT_KEYS[k] || []));
  if (Array.isArray(declared) && "enum" in node) dropped.add("type");
  const out = Object.fromEntries(Object.entries(node).filter(([k]) => !dropped.has(k)).map(([k, v]) => [k, nativeFormatSchema(v)]));
  if (kinds.includes("array") && Number.isInteger(out.minItems) && out.minItems > 1) out.minItems = 1;
  return out;
}
const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
function clampEffort(e) { if (e == null) return null; const v = String(e).toLowerCase(); if (v === "minimal") return "low"; return EFFORTS.includes(v) ? v : null; }

// The chat.completions request the engine accepts. Known extra fields (stream, stream_options, user, metadata, ...) are ignored on purpose; a field that
// would change what the model does and cannot be honored is refused.
export function toKwargs(req, { model, effort } = {}) {
  if (!isObj(req)) throw new BadRequest("body must be an object");
  if ((req.n ?? 1) !== 1) throw new BadRequest("Only n=1 is supported");
  const tc = req.tool_choice ?? "auto"; if (tc !== "auto") throw new BadRequest("Only tool_choice=auto is supported");
  if (req.parallel_tool_calls === false) throw new BadRequest("parallel_tool_calls=false is unsupported");
  const kw = { model: model || req.model, messages: req.messages, tools: req.tools, max_tokens: req.max_tokens, max_completion_tokens: req.max_completion_tokens, stop: req.stop, response_format: req.response_format, temperature: req.temperature, top_p: req.top_p };
  const r = req.reasoning ?? (req.reasoning_effort ? { effort: req.reasoning_effort } : null);
  const eff = effort || r?.effort;
  if (eff || r) kw.extra_body = { reasoning: { ...(r && "enabled" in r ? { enabled: r.enabled } : { enabled: eff !== "none" }), ...(eff ? { effort: eff } : {}) } };
  return kw;
}
export function requestBody(kwargs) {
  const extra = kwargs.extra_body || {}, body = {};
  const reasoning = extra.reasoning;
  if (reasoning != null) {
    if (!isObj(reasoning) || Object.keys(reasoning).some((k) => !["enabled", "effort"].includes(k))) throw new BadRequest("reasoning supports enabled and effort only");
    if ("enabled" in reasoning && typeof reasoning.enabled !== "boolean") throw new BadRequest("reasoning.enabled must be boolean");
    const effort = clampEffort(reasoning.effort);
    if (reasoning.effort != null && effort === null) throw new BadRequest("Unsupported native reasoning effort");
    if (reasoning.enabled === false || effort === "none") {
      if (acceptsThinkingDisable(kwargs.model)) { body.thinking = { type: "disabled" }; body.context_management = { edits: [] }; }
      else body.output_config = { effort: "low" };
    } else {
      if (reasoning.enabled === true && supportsAdaptiveThinking(kwargs.model)) body.thinking = { type: "adaptive", display: "summarized" };
      if (effort) body.output_config = { effort };
    }
  }
  const rf = kwargs.response_format;
  if (rf && rf.type !== "text") {
    if (rf.type !== "json_schema") throw new BadRequest("Only json_schema structured output is supported");
    const schema = rf.json_schema?.schema;
    if (!isObj(schema)) throw new BadRequest("response_format requires a JSON Schema object");
    (body.output_config ||= {}).format = { type: "json_schema", schema: nativeFormatSchema(schema) };
  }
  if (kwargs.max_tokens != null) body.max_tokens = kwargs.max_tokens;
  if (kwargs.max_completion_tokens != null) { if ("max_tokens" in body) throw new BadRequest("Specify only one output-token limit"); body.max_tokens = kwargs.max_completion_tokens; }
  if (kwargs.stop != null) body.stop_sequences = typeof kwargs.stop === "string" ? [kwargs.stop] : kwargs.stop;
  // Subscription models reject sampling controls: temperature and top_p are validated and dropped.
  for (const k of ["temperature", "top_p"]) if (kwargs[k] != null && (typeof kwargs[k] !== "number" || !Number.isFinite(kwargs[k]) || kwargs[k] < 0 || kwargs[k] > 1)) throw new BadRequest(`${k} must be finite and between zero and one`);
  if ("max_tokens" in body && !(Number.isInteger(body.max_tokens) && body.max_tokens >= 1)) throw new BadRequest("max_tokens must be a positive integer");
  if ("stop_sequences" in body && !(Array.isArray(body.stop_sequences) && body.stop_sequences.every((x) => typeof x === "string" && x))) throw new BadRequest("stop_sequences must be a list of nonempty strings");
  const manifest = [], tools = [], names = {}, nativeNames = {};
  for (const tool of kwargs.tools || []) {
    if (tool.type !== "function") throw new BadRequest("Only function tools are supported");
    const f = tool.function, name = f.name;
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(name) || has(names, name)) throw new BadRequest("Tool names must be unique ASCII identifiers of at most 64 characters");
    if (f.strict) throw new BadRequest("Strict function schemas are unsupported");
    const nativeName = name.length <= 50 ? name : name.slice(0, 41) + "_" + shortHash(name);
    if (has(nativeNames, nativeName)) throw new BadRequest(`Tool name collision: ${name} and ${nativeNames[nativeName]}`);
    names[name] = nativeName; nativeNames[nativeName] = name;
    const description = f.description ?? "", raw = f.parameters ?? { type: "object" };
    if (!isObj(raw) || typeof description !== "string") throw new BadRequest("Tool schema must be an object and description a string");
    const schema = normalizeInputSchema(raw);
    manifest.push({ name: nativeName, description, inputSchema: schema });
    tools.push({ name: PREFIX + nativeName, description, input_schema: schema });
  }
  body.tools = tools;
  return { encoded: JSON.stringify(body), manifest, names };
}
// A short stable hash for a long tool name (not security relevant).
function shortHash(s) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(s)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }

// ---------- admission transforms (what the relay does to the one request the CLI sends) ----------
function frameFirst(messages, queried) {
  if (messages.some((m) => m.role === "assistant")) return false;
  const first = messages.find((m) => m.role === "user") || {}, content = first.content;
  if (!Array.isArray(content) || !queried || content.length <= queried.length) return false;
  const want = queried.map(plain), starts = [];
  for (let k = 0; k <= content.length - queried.length; k++) if (deepEq(content.slice(k, k + queried.length).map(plain), want)) starts.push(k);
  if (starts.length !== 1 || starts[0] === 0) return false;
  const k = starts[0];
  if (!content.slice(0, k).every((b) => isObj(b) && b.type === "text" && keysSubset(b, ["type", "text", "cache_control"]))) return false;
  const mark = content.slice(0, k).find((b) => "cache_control" in b)?.cache_control;
  content.splice(0, k);
  if (mark !== undefined && !("cache_control" in content[0])) content[0].cache_control = mark;
  return true;
}
const DATE_LINE = /^Today's date is \d{4}-\d{2}-\d{2}\.$/;
export function stableRequestContext(payload, queried) {
  try {
    const body = JSON.parse(payload), messages = body.messages;
    if (!Array.isArray(messages) || !messages.every(isObj)) return payload;
    for (const m of messages) {
      const c = m.content;
      if (!["system", "user", "assistant"].includes(m.role) || !(typeof c === "string" || Array.isArray(c))) return payload;
      if (Array.isArray(c) && c.some((b) => !isObj(b) || typeof b.type !== "string" || (b.type === "text" && typeof b.text !== "string"))) return payload;
    }
    if (queried != null && (!Array.isArray(queried) || queried.some((b) => !isObj(b)))) return payload;
    let changed = false;
    const last = messages.at(-1) || {}, env = messages.slice(0, -1).find((m) => m.role === "system"), content = last.content;
    const tail = typeof content === "string" ? { type: "text", text: content } : (Array.isArray(content) && content.length === 1 ? content[0] : {});
    if (last.role === "system" && env && tail.type === "text" && DATE_LINE.test(tail.text || "")) {
      const original = env.content, line = "\n\n" + tail.text;
      const target = typeof original === "string" ? { type: "text", text: original } : (original.at(-1) || {});
      if (target.type === "text" && !target.text.endsWith(tail.text)) {
        if (typeof original === "string") env.content = original + line; else target.text += line;
        const mark = tail.cache_control ?? last.cache_control;
        messages.pop();
        const previous = messages.at(-1).content;
        if (mark !== undefined && Array.isArray(previous) && previous.length && !("cache_control" in previous.at(-1))) previous.at(-1).cache_control = mark;
        changed = true;
      }
    }
    const newest = [...messages].reverse().find((m) => m.role === "user") || {}, blocks = newest.content;
    if (queried?.length && queried.some((b) => b.type !== "tool_result") && Array.isArray(blocks) && messages.some((m) => m.role === "assistant")) {
      const frame = queried.map(plain), hits = [];
      for (let i = 0; i <= blocks.length - frame.length; i++) if (deepEq(blocks.slice(i, i + frame.length).map(plain), frame)) hits.push(i);
      const k = hits.length === 1 ? hits[0] : null;
      if (k && blocks.slice(0, k).every((b) => b.type === "text" && keysSubset(b, ["type", "text", "cache_control"]))) {
        const mark = blocks.slice(0, k).find((b) => "cache_control" in b)?.cache_control;
        blocks.splice(0, k);
        if (mark !== undefined && !("cache_control" in blocks[0])) blocks[0].cache_control = mark;
        changed = true;
      }
    }
    return changed ? JSON.stringify(body) : payload;
  } catch { return payload; }
}
const opensTurn = (m) => m.role === "user" && (typeof m.content === "string" || (m.content || []).some((b) => !isObj(b) || b.type !== "tool_result"));
function countBreakpoints(value) {
  let n = 0; const pending = [value];
  while (pending.length) { const node = pending.pop(); if (Array.isArray(node)) pending.push(...node); else if (isObj(node)) for (const [k, v] of Object.entries(node)) { if (k === "cache_control") n++; else pending.push(v); } }
  return n;
}
function keepTurnMark(body, messages, last, target) {
  let opening = null; for (let i = 0; i < last; i++) if (opensTurn(messages[i])) opening = i;
  if (opening === null) return false;
  let thought = null;
  for (let i = opening + 1; i <= last; i++) if (messages[i].role === "assistant" && Array.isArray(messages[i].content) && messages[i].content.some((b) => isObj(b) && UNCACHEABLE.includes(b.type))) { thought = i; break; }
  if (thought === null) return false;
  let frame = opening; for (let i = thought - 1; i > opening; i--) if (messages[i].role === "user") { frame = i; break; }
  const content = messages[frame].content; if (!Array.isArray(content)) return false;
  let j = null; for (let k = content.length - 1; k >= 0; k--) if (isObj(content[k]) && !UNCACHEABLE.includes(content[k].type)) { j = k; break; }
  if (j === null || "cache_control" in content[j] || cmp([frame, j], [target[0], target[1]]) >= 0) return false;
  const span = messages.slice(frame, target[0]).reduce((s, m) => s + (Array.isArray(m.content) ? m.content.length : 1), 0);
  if (span - j + target[1] + 1 <= LOOKBACK) return false;
  const marks = []; messages.forEach((m, i) => { if (Array.isArray(m.content)) m.content.forEach((b, k) => { if (isObj(b) && "cache_control" in b) marks.push([i, k, b]); }); });
  const later = marks.filter(([i, k]) => cmp([frame, j], [i, k]) < 0);
  if (!later.length) return false;
  if (countBreakpoints(body) < MAX_BREAKPOINTS) { content[j].cache_control = clone(later[0][2].cache_control); return true; }
  const spare = later.find(([i, k]) => cmp([i, k], [target[0], target[1]]) < 0)?.[2];
  if (!spare || !("cache_control" in target[2])) return false;
  content[j].cache_control = spare.cache_control; delete spare.cache_control; return true;
}
export function pinMessageBreakpoint(payload, queried) {
  if (!queried || !queried.length) return payload;
  try {
    const body = JSON.parse(payload), messages = body.messages, reordered = frameFirst(messages, queried);
    const blocks = []; messages.forEach((m, i) => { if (Array.isArray(m.content)) m.content.forEach((b, j) => blocks.push([i, j, b])); });
    const marked = blocks.filter(([, , b]) => isObj(b) && "cache_control" in b);
    if (!marked.length && !reordered) return payload;
    let last = -1; messages.forEach((m, i) => { if (m.role === "assistant") last = i; });
    let stable = blocks.filter(([i]) => i <= last);
    const newest = last + 1 < messages.length ? messages[last + 1] : {};
    if (newest.role === "user" && Array.isArray(newest.content)) {
      const prefix = [];
      for (let j = 0; j < Math.min(newest.content.length, queried.length); j++) { if (!deepEq(plain(newest.content[j]), plain(queried[j]))) break; prefix.push([last + 1, j, newest.content[j]]); }
      const rest = newest.content.slice(prefix.length);
      if (!(rest.length && isObj(rest[0]) && rest[0].type === "tool_result")) stable = stable.concat(prefix);
    }
    const target = [...stable].reverse().find(([, , b]) => isObj(b) && !UNCACHEABLE.includes(b.type));
    const after = target ? marked.filter(([i, j]) => cmp([target[0], target[1]], [i, j]) < 0).map(([, , b]) => b) : [];
    const folded = !!target && after.length > 0;
    if (folded) { const moved = after.map((b) => { const c = b.cache_control; delete b.cache_control; return c; })[0]; if (!("cache_control" in target[2])) target[2].cache_control = moved; }
    const turn = !!target && keepTurnMark(body, messages, last, target);
    if (!(reordered || folded || turn)) return payload;
    return JSON.stringify(body);
  } catch { return payload; }
}
// Anthropic refuses a request with more than four cache marks. The CLI adds its own (system, tools, newest message) to the ones 1Helm's history carries, so after the other transforms the
// request is cut to four: tools and system first (they render first and are the most reused), then the latest message marks. The earliest message marks are the ones removed.
export function limitBreakpoints(payload) {
  try {
    const body = JSON.parse(payload); if (countBreakpoints(body) <= MAX_BREAKPOINTS) return payload;
    const marked = (b) => isObj(b) && "cache_control" in b, front = [], later = [];   // marks in the order Anthropic renders them: tools and system, then messages
    (body.tools || []).forEach((b) => marked(b) && front.push(b)); (Array.isArray(body.system) ? body.system : []).forEach((b) => marked(b) && front.push(b));
    for (const m of body.messages || []) if (Array.isArray(m.content)) for (const b of m.content) { if (marked(b)) later.push(b); if (isObj(b) && Array.isArray(b.content)) b.content.forEach((x) => marked(x) && later.push(x)); }
    let extra = front.length + later.length - MAX_BREAKPOINTS;
    for (const b of [...later, ...front]) { if (extra <= 0) break; delete b.cache_control; extra--; }
    return JSON.stringify(body);
  } catch { return payload; }
}
export function dropMessageBreakpoints(payload) {
  try {
    const body = JSON.parse(payload); let dropped = false;
    for (const m of body.messages) if (Array.isArray(m.content)) for (const b of m.content) if (isObj(b) && "cache_control" in b) { delete b.cache_control; dropped = true; }
    return dropped ? JSON.stringify(body) : payload;
  } catch { return payload; }
}
export function streamToolInput(payload) {
  try {
    const body = JSON.parse(payload), tools = (body.tools || []).filter((t) => isObj(t) && !("eager_input_streaming" in t));
    if (!tools.length) return payload;
    for (const t of tools) t.eager_input_streaming = true;
    return JSON.stringify(body);
  } catch { return payload; }
}
const bareText = (b) => isObj(b) && Object.keys(b).length === 2 && b.type === "text" && typeof b.text === "string";
// Restore the host's tool-result frame exactly; a frame it cannot prove lossless throws, and the caller forwards the request as native built it.
export function restoreQueriedTurn(payload, queried) {
  if (!Array.isArray(queried) || !queried.length) return payload;
  if (!queried.some((b) => isObj(b) && b.type === "tool_result")) return payload;
  const unmatched = () => { throw new QueriedTurnMismatch("Native request does not uniquely match the host's tool results"); };
  const restoreContent = (sent, host) => {
    if (typeof host === "string" || typeof sent === "string") {
      const text = (v) => (typeof v === "string" ? v : Array.isArray(v) && v.every(bareText) ? v.map((b) => b.text).join("") : null);
      const l = text(sent), r = text(host);
      if (l === null || r === null || !l.startsWith(r)) return unmatched();
      return clone(host);
    }
    if (Array.isArray(sent) && Array.isArray(host)) return restoreSequence(sent, host);
    if (!deepEq(sent, host)) return unmatched();
    return clone(host);
  };
  const restoreBlock = (sent, host) => {
    if (!isObj(sent) || !isObj(host)) return unmatched();
    const restored = clone(host);
    if (host.type === "tool_result") {
      const le = sent.is_error ?? false, re = host.is_error ?? false;
      if (typeof le !== "boolean" || typeof re !== "boolean" || le !== re) return unmatched();
      const ign = ["content", "is_error", "cache_control"], rest = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !ign.includes(k)));
      if (!deepEq(rest(sent), rest(host))) return unmatched();
      if (("content" in sent) !== ("content" in host)) return unmatched();
      if ("content" in host) restored.content = restoreContent(sent.content, host.content);
    } else if (!deepEq(plain(sent), plain(host))) return unmatched();
    if ("cache_control" in sent) {
      if ("cache_control" in host && !deepEq(sent.cache_control, host.cache_control)) return unmatched();
      restored.cache_control = clone(sent.cache_control);
    }
    return restored;
  };
  function restoreSequence(sent, host) {
    const restored = []; let i = 0, j = 0;
    while (i < host.length) {
      if (j >= sent.length) return unmatched();
      if (bareText(host[i]) && bareText(sent[j])) {
        let he = i + 1, se = j + 1;
        while (he < host.length && bareText(host[he])) he++;
        while (se < sent.length && bareText(sent[se])) se++;
        const original = host.slice(i, he).map((b) => b.text).join(""), actual = sent.slice(j, se).map((b) => b.text).join("");
        if (!(he === host.length ? actual.startsWith(original) : actual === original)) return unmatched();
        restored.push(...clone(host.slice(i, he))); i = he; j = se;
      } else { restored.push(restoreBlock(sent[j], host[i])); i++; j++; }
    }
    if (sent.slice(j).some((b) => !bareText(b))) return unmatched();
    return restored;
  }
  try {
    const body = JSON.parse(payload), messages = body.messages;
    let la = -1; messages.forEach((m, i) => { if (m.role === "assistant") la = i; });
    const newest = la + 1 < messages.length ? messages[la + 1] : {}, native = newest.role === "user" ? newest.content : null;
    if (!Array.isArray(native)) return unmatched();
    const ids = queried.filter((b) => isObj(b) && b.type === "tool_result").map((b) => b.tool_use_id);
    if (ids.some((x) => typeof x !== "string" || !x) || new Set(ids).size !== ids.length) return unmatched();
    const nativeIds = native.filter((b) => isObj(b) && b.type === "tool_result").map((b) => b.tool_use_id);
    if (!deepEq(ids, nativeIds)) return unmatched();
    const restored = restoreSequence(native, queried);
    if (deepEq(native, restored)) return payload;
    newest.content = restored;
    return JSON.stringify(body);
  } catch (e) { if (e instanceof QueriedTurnMismatch) throw e; return unmatched(); }
}
export { QueriedTurnMismatch };
// The whole transform the relay applies to the one admitted request.
export function transformAdmitted(payload, { queried, oneShot = false } = {}) {
  let unrestored = null;
  if (oneShot) payload = dropMessageBreakpoints(payload);
  try { payload = restoreQueriedTurn(payload, queried); } catch (e) { if (!(e instanceof QueriedTurnMismatch)) throw e; unrestored = e.message; }
  payload = stableRequestContext(payload, queried);
  payload = pinMessageBreakpoint(payload, queried);
  payload = limitBreakpoints(payload);
  payload = streamToolInput(payload);
  return { payload, unrestored };
}

// ---------- the single admission rule ----------
// A gate for one request: the first POST to the secret route is let through, every later one (and any after cancel) is refused locally.
export class Gate {
  constructor() { this.used = false; this.cancelled = false; this.denied = 0; }
  admit() { if (this.cancelled || this.used) { this.denied++; return false; } this.used = true; return true; }
}
export const CONSUMED_BODY = '{"type":"error","error":{"type":"invalid_request_error","message":"ONEHC_MODEL_ADMISSION_CONSUMED"}}';

// ---------- reading the upstream stream ----------
export class Capture {
  constructor() { this.message = null; this.complete = false; this.pending = ""; this.arguments = {}; this.unparsed = []; this.decoder = new TextDecoder(); }
  feed(chunk) {
    this.pending += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    let m; while ((m = /\r?\n\r?\n/.exec(this.pending))) {
      const frame = this.pending.slice(0, m.index); this.pending = this.pending.slice(m.index + m[0].length);
      const data = frame.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ +/, "")).join("\n");
      if (data) this.event(JSON.parse(data));
    }
  }
  event(e) {
    const h = { message_start: () => { this.message = clone(e.message); }, content_block_start: () => { this.message.content.push(clone(e.content_block)); },
      content_block_delta: () => this.blockDelta(e), content_block_stop: () => this.blockStop(e),
      message_delta: () => { Object.assign(this.message, e.delta || {}); Object.assign(this.message.usage, e.usage || {}); }, message_stop: () => this.stop() }[e.type];
    if (h) h();
  }
  blockDelta(e) {
    const d = e.delta, block = this.message.content[e.index], field = { text_delta: "text", thinking_delta: "thinking", signature_delta: "signature" }[d.type];
    if (field) block[field] = (block[field] || "") + d[field];
    else if (d.type === "input_json_delta") this.arguments[e.index] = (this.arguments[e.index] || "") + d.partial_json;
    else if (d.type === "citations_delta") (block.citations ||= []).push(clone(d.citation));
  }
  blockStop(e) {
    const i = e.index; if (!(i in this.arguments)) return;
    const raw = this.arguments[i]; delete this.arguments[i];
    try { this.message.content[i].input = raw.trim() ? JSON.parse(raw) : {}; } catch { this.unparsed.push(i); }   // cut off at max_tokens: the call is dropped, never run with guessed arguments
  }
  stop() {
    for (const i of [...this.unparsed].sort((a, b) => b - a)) this.message.content.splice(i, 1);
    this.complete = !!(this.message && this.message.stop_reason && !Object.keys(this.arguments).length);
  }
}

// ---------- native events -> chat.completions ----------
export const NATIVE_ERROR_STATUS = { rate_limit: 429, billing_error: 402, authentication_failed: 401, overloaded: 529, server_error: 503 };
export class EngineError extends Error { constructor(m, status = null, code = null) { super(m); this.status = status; this.code = code; } }
export const chunkOf = (model, delta, finish = null, usage = null) => ({ id: "claude-native", model, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: null, tool_calls: null, reasoning_details: null, ...delta }, finish_reason: finish }], ...(usage ? { usage } : {}) });
// The text delta chunk a native stream_event makes, or null.
export function deltaChunk(model, nativeEvent) {
  const d = nativeEvent.delta || {};
  if (d.type === "text_delta") return chunkOf(model, { content: d.text });
  if (d.type === "thinking_delta") return chunkOf(model, { reasoning_content: d.thinking });
  return null;
}
// Everything after the native process ended: the final chunk and the full response. `st` carries what the loop saw.
export function assemble({ model, names, gate, capture, requestId, status, failure, error, unrestored, assistants, results, stopped, emitted, nativeError, nativeErrorCode, fast, exitCode, stderrTail = "" }) {
  const hermesNames = Object.fromEntries(Object.entries(names).map(([h, n]) => [n, h]));
  const extra = [];
  if (gate.used) {
    if (status !== 200 || !capture.complete) {
      let first = `first upstream attempt: status ${status}, capture ${capture.complete ? "complete" : "incomplete"}${failure ? `, relay failure ${failure}` : ""}, native retries denied: ${gate.denied}`;
      if (error) first += ", upstream said: " + error.slice(0, 500);
      throw new EngineError(`Incomplete upstream response (${first})` + (nativeError ? ": " + nativeError : ""), Number.isInteger(status) && status >= 400 ? status : null);
    }
    assistants = [capture.message]; stopped = true;
  }
  const handled = gate.denied || (gate.used && assistants[0]?.stop_reason === "refusal");
  if (nativeError && !handled) {
    if (nativeErrorCode === "authentication_failed" && !gate.used) throw new EngineError(`Claude is signed out on this account. Sign in again under Settings, AI services. (native: ${nativeError})${stderrTail}`, 401, "not_signed_in");
    throw new EngineError("Native API error: " + nativeError, NATIVE_ERROR_STATUS[String(nativeErrorCode)] ?? null, nativeErrorCode ? String(nativeErrorCode) : null);
  }
  if (results.length !== 1 || !assistants.length || !stopped) throw new EngineError("Incomplete native response: assistant, message_stop and one result required");
  const final = results[0], blocks = assistants.flatMap((a) => a.content), calls = [];
  for (const block of blocks) {
    if (block.type !== "tool_use") continue;
    if (has(hermesNames, block.name)) block.name = PREFIX + block.name;   // native sometimes drops the prefix on a tool it was offered
    let name = block.name.startsWith(PREFIX) ? block.name.slice(PREFIX.length) : block.name;
    name = has(hermesNames, name) ? hermesNames[name] : name;
    calls.push({ id: block.id, type: "function", function: { name, arguments: JSON.stringify(block.input) } });
  }
  const boundary = calls.length > 0 && final.subtype === "error_max_turns" && (fast || exitCode === 1);
  if (!boundary && !handled && ((!fast && exitCode !== 0) || final.is_error || final.subtype !== "success")) throw new EngineError("Native request failed: " + final.subtype + stderrTail);
  const usage = gate.used ? assistants[0].usage : final.usage;
  if (!isObj(usage) || !["input_tokens", "output_tokens"].every((k) => typeof usage[k] === "number")) throw new EngineError("Native result missing complete token usage");
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  if (emitted !== text) { if (text.startsWith(emitted)) extra.push(chunkOf(model, { content: text.slice(emitted.length) })); else throw new EngineError("Native final text differs from incremental stream"); }
  const thinking = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking || "").join("") || null;
  const message = { role: "assistant", content: text || null, tool_calls: calls.length ? calls : null, reasoning_content: text || calls.length ? thinking : null };
  // The carrier keeps native's own assistant messages (signed thinking included) so the next request replays them exactly.
  const carrier = { type: CARRIER, version: 1, messages: assistants, projection: projection(message) };
  message.reasoning_details = [carrier];
  const refused = assistants.some((a) => a.stop_reason === "refusal");
  let tcalls = calls;
  if (refused) {
    const det = assistants.find((a) => isObj(a.stop_details))?.stop_details || {};
    message.refusal = typeof det.explanation === "string" && det.explanation.trim() ? det.explanation.trim() : typeof det.category === "string" && det.category ? `provider refusal category: ${det.category}` : null;
    message.tool_calls = null; tcalls = [];
  }
  const inp = usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const normalized = { prompt_tokens: inp, completion_tokens: usage.output_tokens, total_tokens: inp + usage.output_tokens, prompt_tokens_details: { cached_tokens: usage.cache_read_input_tokens || 0, cache_write_tokens: usage.cache_creation_input_tokens || 0 }, cache_creation_input_tokens: usage.cache_creation_input_tokens || 0, native_usage: usage,
    completion_tokens_details: { reasoning_tokens: usage.output_tokens_details?.thinking_tokens || 0 }, native_cost: { total_cost_usd: final.total_cost_usd ?? null, modelUsage: final.modelUsage ?? null },
    native_admission: { upstream_requests: gate.used ? 1 : 0, blocked_requests: gate.denied, request_id: requestId ?? null, ...(unrestored ? { unrestored } : {}) } };
  const finish = refused ? "content_filter" : tcalls.length ? "tool_calls" : assistants.some((a) => ["max_tokens", "model_context_window_exceeded"].includes(a.stop_reason)) ? "length" : "stop";
  const response = { id: assistants.at(-1).id || "claude-native", model, object: "chat.completion", created: Math.floor(Date.now() / 1000), choices: [{ index: 0, finish_reason: finish, message }], usage: normalized };
  const last = chunkOf(model, { content: null, tool_calls: tcalls.length ? tcalls.map((tc, index) => ({ ...tc, index })) : null, reasoning_details: [carrier], ...(refused ? { refusal: message.refusal } : {}) }, finish, normalized);
  return { chunks: [...extra, last], response };
}
// A clean admitted answer returns at native's result event; its exit code and later output are never read.
export function fastEligible(result, gate, status, capture, stopped, nativeError) {
  return gate.used && status === 200 && capture.complete && stopped && nativeError == null && gate.denied === 0 && capture.message.stop_reason !== "refusal"
    && ((result.subtype === "success" && !result.is_error) || (result.subtype === "error_max_turns" && capture.message.content.some((b) => b.type === "tool_use")));
}
