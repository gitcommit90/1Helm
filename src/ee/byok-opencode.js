// OpenCode inference as an own-key connection (https://opencode.ai/v2/docs/console/api/inference). It is a sibling of byok-chatgpt.js: byokChat (byok.js) hands a call to
// opencodeChat below with a chat/completions body and gets back a chat/completions-shaped answer (SSE chunks when body.stream, else JSON), so nothing else in 1Helm changes.
// The credential is the person's OpenCode API key (cfg.key, sent as a Bearer token and never logged or echoed). OpenCode serves every model from exactly one API family:
//   chat-completions  open models; passed through (reasoning_content is handed on as `reasoning`)
//   responses         GPT models; the Responses translation of byok-chatgpt.js is reused
//   messages          Claude and Qwen; Anthropic Messages (system, tool_use / tool_result blocks, max_tokens)
//   generate-content  Gemini; contents / parts, functionDeclarations, systemInstruction, :streamGenerateContent
// The public model list (GET /inference/v1/models, no key) names the family, base URL, limits and reasoning efforts of each model. Free models answer 403 outside OpenCode, so they
// are left out. Every answer's usage keeps OpenCode's `cost` and `opencode` (billing_source, list_cost, tokens…) when it sent them.
import { ByokError, fail, redact, readCapped, errorDetail, guardStream, firstEventOk, byokBody } from "../byok.js";
import { limitText } from "./byok-usage.js";
import { withCacheBreakpoints } from "../model.js";
import { translateStream as responsesStream, responsesBody, collect, sseLines } from "./byok-chatgpt.js";

export const OC_SOURCE = "opencode";
export const OC_BASE = "https://opencode.ai/inference";
export const OC_FAMILIES = ["chat-completions", "responses", "messages", "generate-content"];
export const OC_CONSOLE = "https://opencode.ai/console/account";   // where the person makes a personal API key
// The two plans are served from different base URLs (https://opencode.ai/v2/docs/console/harnesses/). Go: the person's OpenCode Go subscription; Pay as you go: their OpenCode balance.
export const OC_GO_BASE = `${OC_BASE}/go`;
export const OC_PLANS = ["go", "payg"];
export const ocPlan = (x) => (x === "payg" ? "payg" : "go");   // anything else, including no value, is Go
export const ocBase = (plan) => (ocPlan(plan) === "go" ? OC_GO_BASE : OC_BASE);
export const OC_AGENT = "1Helm/1.0";
const LIST_MS = 15e3, LIST_BYTES = 4 << 20, LIST_TTL = 10 * 60e3, FIRST_MS = 120e3;
const CAP_OUT = 32000, DEFAULT_OUT = 8192;

// ---- the model list ----
const num = (x) => (Number.isFinite(Number(x)) && x !== null && x !== "" ? Number(x) : null);
export const isFreeModel = (m) => {
  const id = String(m?.id || "");
  if (m?.free === true || /-free$/.test(id) || id === "big-pickle") return true;
  const t = m?.cost?.text; return !!t && t.input?.price === 0 && t.output?.price === 0;
};
// One entry of OpenCode's list → what routing needs, or null (free, not a chat model, or no family 1Helm speaks).
// Go lists its own free models and serves them to Go keys, so they stay for Go (go: true).
export function ocRecord(m, { go = false } = {}) {
  if (!m || typeof m.id !== "string" || !m.id || (!go && isFreeModel(m)) || (m.type && m.type !== "chat")) return null;
  let family = "", base = "";
  if (typeof m.api === "string") { family = m.api; base = String(m.base_url || ""); }
  else if (m.api && typeof m.api === "object") { family = OC_FAMILIES.find((f) => m.api[f]) || ""; base = String(m.api[family]?.base_url || ""); }
  if (!OC_FAMILIES.includes(family)) return null;
  const r = m.capabilities?.reasoning || {};
  return { id: m.id, name: String(m.name || m.id), context_length: num(m.limit?.context) ?? undefined, family, base_url: base.replace(/\/+$/, ""),
    max_output: num(m.limit?.output), supported_reasoning_efforts: Array.isArray(r.effort) ? r.effort.filter((x) => typeof x === "string") : [], reasoning: !!r.supported, reasoning_budget_min: num(r.budget?.min),
    tools: m.capabilities?.tools?.supported !== false, temperature: m.capabilities?.temperature !== false, images: Array.isArray(m.modalities?.input) && m.modalities.input.includes("image"),
    reasoning_field: m.api?.[family]?.compatibility?.reasoning_field || "" };
}
async function fetchList(cfg, { fetchImpl, signal }) {
  const ac = new AbortController(), onAbort = () => ac.abort(signal?.reason);
  if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener("abort", onAbort, { once: true }); }
  const timer = setTimeout(() => ac.abort(new Error("timeout")), LIST_MS);
  try {
    let r;
    try { r = await fetchImpl(`${ocBase(cfg?.plan)}/v1/models`, { method: "GET", redirect: "manual", signal: ac.signal, headers: { accept: "application/json", "user-agent": OC_AGENT } }); }   // public: no key is sent
    catch (e) { if (signal?.aborted) throw e; throw fail(cfg, ac.signal.aborted ? `no model list within ${Math.round(LIST_MS / 1000)} seconds` : `couldn't connect${e?.message ? `: ${redact(e.message, cfg?.key, 100)}` : ""}`); }
    if (!r.ok) { const { detail } = await errorDetail(cfg || {}, r); throw ocFail(cfg, ocDetail(r.status, detail, ocPlan(cfg?.plan)), r.status); }
    const text = await readCapped(cfg || {}, r.body, LIST_BYTES, "model list");
    let j; try { j = JSON.parse(text); } catch { throw fail(cfg, "the model list wasn't JSON"); }
    return (Array.isArray(j?.data) ? j.data : []).map((m) => ocRecord(m, { go: ocPlan(cfg?.plan) === "go" })).filter(Boolean);
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
}
const LISTS = new Map();   // one list per plan: Go and Pay as you go serve different models
export const _resetOpencode = () => { LISTS.clear(); toolLimits.clear(); };
async function recordsOf(cfg, { fetchImpl, signal, fresh = false }) {
  const plan = ocPlan(cfg?.plan), hit = LISTS.get(plan);
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL) return hit.data;
  const data = await fetchList(cfg, { fetchImpl, signal }); LISTS.set(plan, { at: Date.now(), data }); return data;
}
// Same shape as chatgptModelsJson: { data: [{ id, name, context_length, supported_reasoning_efforts, family, … }] }, without the free models.
export async function opencodeModelsJson(cfg, { fetchImpl = globalThis.fetch, signal = null } = {}) {
  return { data: await recordsOf(cfg, { fetchImpl, signal, fresh: true }) };
}

// ---- errors ----
// The plain words for an HTTP error from OpenCode (they follow "Your AI service (…) didn't work (" in failText). No key goes into it.
export function ocDetail(status, detail = "", plan = "payg") {
  const d = redact(detail, "", 120), s = Number(status) || 0, go = plan === "go";
  if (s === 401) return "OpenCode refused your key. Check or replace the OpenCode API key";
  if (go && (s === 402 || /insufficient|out of (balance|credit)|no (balance|credit)|add (funds|credit)/i.test(d))) return `your OpenCode Go plan didn't cover this request${d && !/insufficient|funds|balance|credit/i.test(d) ? ` (${d})` : ""}. Check your Go usage in the OpenCode console, or switch this connection to pay as you go in Settings → AI services`;
  if (s === 402 || /insufficient|out of (balance|credit)|balance (is )?(too low|empty|exhausted)|no (balance|credit)|add (funds|credit)/i.test(d)) return "your OpenCode balance is too low. Add funds in the OpenCode console, or connect OpenCode with your Go plan in Settings → AI services";
  if (/\b(go|usage|monthly|weekly|5-hour|rolling)\b.*\blimit|limit.*\b(reached|exceeded)|reached.*limit/i.test(d)) return `you've reached your OpenCode Go usage limit${d ? ` (${d})` : ""}`;
  if (s === 429) return "OpenCode is limiting requests right now. Try again in a little while";
  if (s === 403) return "OpenCode didn't allow this model with your key (free models only work inside OpenCode)";
  if (s === 404) return `error 404: OpenCode doesn't have that model${d ? ` (${d})` : ""}`;
  if (s === 503 || s === 529) return "OpenCode isn't available right now. Try again in a little while";
  return `error ${s}${d ? `: ${d}` : ""}`;
}
// A Go plan limit gets its own reply (which limit, a Manage usage link); every other error keeps ocDetail's words. The chain falls back as before: it is the same kind of error.
export function ocFail(cfg, detail, http = 0) {
  if (ocPlan(cfg?.plan) === "go" && /^you've reached your OpenCode Go usage limit|^your OpenCode Go plan didn't cover this request/.test(detail)) return Object.assign(new ByokError(limitText("opencode", { host: "OpenCode" }), http, detail), { limit: true });
  return fail(cfg, detail, http);
}
const STATUS_OF = { authentication_error: 401, permission_error: 403, not_found_error: 404, rate_limit_error: 429, overloaded_error: 529, billing_error: 402, invalid_request_error: 400 };

// ---- shared pieces ----
const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p?.type === "text" || p?.type === "input_text" ? p.text || "" : "")).join("") : c == null ? "" : String(c));
const parseArgs = (s) => { if (s && typeof s === "object") return s; try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const imageUrl = (p) => (typeof p?.image_url === "string" ? p.image_url : p?.image_url?.url || "");
const dataUrl = (u) => { const m = /^data:([^;,]+);base64,(.*)$/s.exec(u); return m ? { mime: m[1], data: m[2] } : null; };
const extras = (raw) => ({ ...(raw && raw.cost !== undefined && raw.cost !== null ? { cost: raw.cost } : {}), ...(raw?.opencode ? { opencode: raw.opencode } : {}) });
const usageOf = (input, output, cached, reasoning, raw, written = 0) => ({ prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_tokens_details: { cached_tokens: cached, ...(written ? { cache_write_tokens: written } : {}) }, completion_tokens_details: { reasoning_tokens: reasoning }, ...extras(raw) });
const efforts = (rec) => rec.supported_reasoning_efforts || [];
const effortOk = (rec, effort) => !!effort && effort !== "default" && efforts(rec).includes(effort);
const BUDGET = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 31999 };
const outCap = (rec, body) => { const lim = rec.max_output || DEFAULT_OUT; const want = Number(body.max_tokens) || Math.min(lim, CAP_OUT); return Math.max(1, Math.min(want, lim)); };

// Builds a chat/completions chunk stream from provider events. onEvent(e, chunk) and onEof(chunk) return { out: [bytes], end } (or throw ByokError).
function chunkStream(cfg, body, model, { onEvent, onEof }) {
  const ev = sseLines(body), enc = new TextEncoder(); let done = false;
  const chunk = (delta, finish = null, extra = {}) => enc.encode(`data: ${JSON.stringify({ object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  return new ReadableStream({
    async pull(c) {
      if (done) { c.close(); return; }
      for (;;) {
        const e = await ev.next();
        const { out, end } = e ? onEvent(e, chunk) : onEof(chunk);
        for (const o of out) c.enqueue(o);
        if (end) { done = true; c.enqueue(enc.encode("data: [DONE]\n\n")); return; }
        if (out.length) return;
      }
    },
    cancel(x) { return ev.cancel(x); },
  });
}
const STOPPED = "it stopped sending in the middle of the answer";

// ---- Anthropic Messages ----
const aImage = (p) => { const u = imageUrl(p), d = dataUrl(u); return u ? { type: "image", source: d ? { type: "base64", media_type: d.mime, data: d.data } : { type: "url", url: u } } : null; };
// Prompt caching marks (model.js withCacheBreakpoints) ride along in the Anthropic format as cache_control on the same blocks: the last tool, the system text, and a text block of a message.
// A mark on a tool message goes on its tool_result block, where Anthropic takes it.
const markOf = (c) => (Array.isArray(c) ? c.findLast((p) => p && typeof p === "object" && p.cache_control)?.cache_control : undefined);
const withMark = (blk, c) => { const m = markOf(c); return m && blk ? { ...blk, cache_control: m } : blk; };
export function messagesBody(body, rec, model, { effort = null } = {}) {
  const sys = [], msgs = []; let sysMark;
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content.push(...blocks); else msgs.push({ role, content: blocks });
  };
  for (const m of body.messages || []) {
    if (m.role === "system" || m.role === "developer") { const t = text(m.content); if (t) { sys.push(t); sysMark = markOf(m.content) || sysMark; } }
    else if (m.role === "user") {
      const blocks = Array.isArray(m.content) ? m.content.map((p) => (p?.type === "image_url" ? aImage(p) : text([p]) ? withMark({ type: "text", text: text([p]) }, [p]) : null)).filter(Boolean) : text(m.content) ? [{ type: "text", text: text(m.content) }] : [];
      push("user", blocks);
    } else if (m.role === "assistant") {
      const blocks = []; const t = text(m.content); if (t) blocks.push(withMark({ type: "text", text: t }, m.content));
      for (const c of m.tool_calls || []) blocks.push({ type: "tool_use", id: String(c.id ?? "call").slice(0, 64), name: c.function?.name, input: parseArgs(c.function?.arguments) });
      push("assistant", blocks);
    } else if (m.role === "tool") {
      const last = msgs[msgs.length - 1], blk = withMark({ type: "tool_result", tool_use_id: String(m.tool_call_id ?? "call").slice(0, 64), content: text(m.content) }, m.content);
      if (last?.role === "user") { const at = last.content.findIndex((b) => b.type !== "tool_result"); last.content.splice(at < 0 ? last.content.length : at, 0, blk); } else push("user", [blk]);
    }
  }
  if (!msgs.length) msgs.push({ role: "user", content: [{ type: "text", text: "." }] });
  const out = { model, max_tokens: outCap(rec, body), messages: msgs, stream: true };
  if (sys.length) out.system = sysMark ? [{ type: "text", text: sys.join("\n\n"), cache_control: sysMark }] : sys.join("\n\n");
  const tools = (body.tools || []).filter((t) => t?.type === "function" && t.function?.name).map((t) => ({ name: t.function.name, description: t.function.description || "", input_schema: t.function.parameters || { type: "object", properties: {} }, ...(t.cache_control ? { cache_control: t.cache_control } : {}) }));
  if (tools.length) {
    out.tools = tools; const tc = body.tool_choice;
    if (tc === "auto") out.tool_choice = { type: "auto" }; else if (tc === "none") out.tool_choice = { type: "none" }; else if (tc === "required") out.tool_choice = { type: "any" };
    else if (tc?.type === "function" && tc.function?.name) out.tool_choice = { type: "tool", name: tc.function.name };
  }
  const oc = {};
  if (effortOk(rec, effort)) { out.thinking = { type: "adaptive" }; oc.effort = effort; }
  else if (rec.reasoning_budget_min && effort && effort !== "default" && effort !== "none" && BUDGET[effort]) { const b = Math.min(Math.max(rec.reasoning_budget_min, BUDGET[effort]), Math.floor(out.max_tokens / 2)); if (b >= rec.reasoning_budget_min) out.thinking = { type: "enabled", budget_tokens: b }; }
  const rf = body.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) oc.format = { type: "json_schema", schema: rf.json_schema.schema };
  if (Object.keys(oc).length) out.output_config = oc;
  if (!out.thinking && rec.temperature && body.temperature != null) out.temperature = body.temperature;
  return out;
}
const A_STOP = { end_turn: "stop", stop_sequence: "stop", max_tokens: "length", tool_use: "tool_calls", refusal: "content_filter", pause_turn: "stop" };
export function messagesStream(cfg, body, model) {
  const tools = new Map(); let n = 0, u = {}, stop = null;
  return chunkStream(cfg, body, model, {
    onEvent(e, chunk) {
      switch (e.type) {
        case "message_start": u = { ...(e.message?.usage || {}) }; return { out: [] };
        case "content_block_start": if (e.content_block?.type === "tool_use") {
          const k = { index: n++, args: false }; tools.set(e.index, k);
          return { out: [chunk({ tool_calls: [{ index: k.index, id: String(e.content_block.id || "call").slice(0, 64), type: "function", function: { name: e.content_block.name, arguments: "" } }] })] };
        } return { out: [] };
        case "content_block_delta": {
          const d = e.delta || {};
          if (d.type === "text_delta" && d.text) return { out: [chunk({ content: String(d.text) })] };
          if (d.type === "thinking_delta" && d.thinking) return { out: [chunk({ reasoning: String(d.thinking) })] };
          if (d.type === "input_json_delta" && d.partial_json) { const k = tools.get(e.index); if (k) { k.args = true; return { out: [chunk({ tool_calls: [{ index: k.index, function: { arguments: String(d.partial_json) } }] })] }; } }
          return { out: [] };
        }
        case "content_block_stop": { const k = tools.get(e.index); if (k && !k.args) { k.args = true; return { out: [chunk({ tool_calls: [{ index: k.index, function: { arguments: "{}" } }] })] }; } return { out: [] }; }
        case "message_delta": stop = e.delta?.stop_reason || stop; u = { ...u, ...(e.usage || {}) }; return { out: [] };
        case "message_stop": {
          const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
          return { out: [chunk({}, A_STOP[stop] || (n ? "tool_calls" : "stop"), { usage: usageOf((u.input_tokens || 0) + cr + cw, u.output_tokens || 0, cr, u.output_tokens_details?.reasoning_tokens || u.opencode?.tokens?.reasoning || 0, u, cw) })], end: true };
        }
        case "error": { const er = e.error || {}; const st = Number(er.status) || STATUS_OF[er.type] || 0; throw ocFail(cfg, ocDetail(st, er.message || "", ocPlan(cfg?.plan)), st); }
        default: return { out: [] };
      }
    },
    onEof() { throw fail(cfg, STOPPED); },
  });
}

// ---- Gemini generateContent ----
const gParts = (c) => {
  if (!Array.isArray(c)) { const t = text(c); return t ? [{ text: t }] : []; }
  return c.map((p) => {
    if (p?.type === "image_url") { const u = imageUrl(p), d = dataUrl(u); return !u ? null : d ? { inlineData: { mimeType: d.mime, data: d.data } } : { fileData: { fileUri: u } }; }
    const t = text([p]); return t ? { text: t } : null;
  }).filter(Boolean);
};
const G_MODE = { auto: "AUTO", none: "NONE", required: "ANY" };
export function geminiBody(body, rec, model, { effort = null } = {}) {
  const sys = [], contents = [], names = new Map();
  const push = (role, parts) => { if (!parts.length) return; const last = contents[contents.length - 1]; if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts }); };
  const sign = /gemini-3/.test(model);   // Gemini 3 wants the thought signature of each earlier function call back; one that was not kept is replaced by Google's documented placeholder
  for (const m of body.messages || []) {
    if (m.role === "system" || m.role === "developer") { const t = text(m.content); if (t) sys.push(t); }
    else if (m.role === "user") push("user", gParts(m.content));
    else if (m.role === "assistant") {
      const parts = gParts(m.content);
      for (const c of m.tool_calls || []) { names.set(String(c.id), c.function?.name); parts.push({ functionCall: { name: c.function?.name, args: parseArgs(c.function?.arguments) }, ...(sign ? { thoughtSignature: "skip_thought_signature_validator" } : {}) }); }
      push("model", parts);
    } else if (m.role === "tool") {
      const t = text(m.content); let v; try { v = JSON.parse(t); } catch { v = undefined; }
      push("user", [{ functionResponse: { name: names.get(String(m.tool_call_id)) || m.name || "tool", response: v && typeof v === "object" && !Array.isArray(v) ? v : { result: t } } }]);
    }
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "." }] });
  const out = { contents };
  if (sys.length) out.systemInstruction = { parts: [{ text: sys.join("\n\n") }] };
  const decl = (body.tools || []).filter((t) => t?.type === "function" && t.function?.name).map((t) => ({ name: t.function.name, description: t.function.description || "", parametersJsonSchema: t.function.parameters || { type: "object", properties: {} } }));
  if (decl.length) {
    out.tools = [{ functionDeclarations: decl }]; const tc = body.tool_choice;
    if (G_MODE[tc]) out.toolConfig = { functionCallingConfig: { mode: G_MODE[tc] } };
    else if (tc?.type === "function" && tc.function?.name) out.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tc.function.name] } };
  }
  const gc = {};
  if (body.max_tokens) gc.maxOutputTokens = outCap(rec, body);
  if (rec.temperature && body.temperature != null) gc.temperature = body.temperature;
  if (effortOk(rec, effort)) gc.thinkingConfig = effort === "none" ? { thinkingBudget: 0 } : { thinkingLevel: effort, includeThoughts: true };
  const rf = body.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) { gc.responseMimeType = "application/json"; gc.responseJsonSchema = rf.json_schema.schema; }
  else if (rf?.type === "json_object") gc.responseMimeType = "application/json";
  if (Object.keys(gc).length) out.generationConfig = gc;
  return out;
}
const G_FINISH = { STOP: "stop", MAX_TOKENS: "length", SAFETY: "content_filter", RECITATION: "content_filter", BLOCKLIST: "content_filter", PROHIBITED_CONTENT: "content_filter", SPII: "content_filter", IMAGE_SAFETY: "content_filter" };
export function geminiStream(cfg, body, model) {
  let n = 0, um = null, fin = null, any = false;
  const finish = (chunk) => {
    const u = um || {}, think = u.thoughtsTokenCount || 0;
    return { out: [chunk({}, n && (!fin || fin === "stop") ? "tool_calls" : fin || "stop", { usage: usageOf(u.promptTokenCount || 0, (u.candidatesTokenCount || 0) + think, u.cachedContentTokenCount || 0, think, u) })], end: true };
  };
  return chunkStream(cfg, body, model, {
    onEvent(e, chunk) {
      if (e.error) { const er = e.error; const st = Number(er.code) || 0; throw ocFail(cfg, ocDetail(st, er.message || "", ocPlan(cfg?.plan)), st); }
      if (e.usageMetadata) um = e.usageMetadata;
      const cand = e.candidates?.[0], out = [];
      if (!cand && e.promptFeedback?.blockReason && !any) throw fail(cfg, `it blocked the request (${redact(e.promptFeedback.blockReason, "", 60)})`);
      for (const p of cand?.content?.parts || []) {
        if (p.functionCall?.name) { any = true; const i = n++; out.push(chunk({ tool_calls: [{ index: i, id: `call_${i}_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }] })); }
        else if (typeof p.text === "string" && p.text) { if (p.thought) out.push(chunk({ reasoning: p.text })); else { any = true; out.push(chunk({ content: p.text })); } }
      }
      if (cand?.finishReason) fin = G_FINISH[cand.finishReason] || "stop";
      return { out };
    },
    onEof(chunk) { if (!fin && !any && !um) throw fail(cfg, STOPPED); return finish(chunk); },
  });
}

// ---- chat/completions passthrough ----
function mapReasoning(j) { for (const c of j?.choices || []) { const m = c.message; if (m && m.reasoning_content != null) { if (m.reasoning == null) m.reasoning = m.reasoning_content; delete m.reasoning_content; } } return j; }
function passStream(cfg, body, model) {
  const ev = sseLines(body), enc = new TextEncoder(); let done = false;
  return new ReadableStream({
    async pull(c) {
      if (done) { c.close(); return; }
      const e = await ev.next();
      if (!e) { done = true; c.enqueue(enc.encode("data: [DONE]\n\n")); return; }
      if (e.error && !e.choices) { const st = Number(e.error.status || e.error.code) || 0; throw ocFail(cfg, ocDetail(st, e.error.message || JSON.stringify(e.error), ocPlan(cfg?.plan))); }
      for (const ch of e.choices || []) { const d = ch.delta; if (d && d.reasoning_content != null) { if (d.reasoning == null) d.reasoning = d.reasoning_content; delete d.reasoning_content; } }
      e.model ||= model;
      c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
    },
    cancel(x) { return ev.cancel(x); },
  });
}

// ---- the one call ----
const sse = (s) => new Response(s, { status: 200, headers: { "content-type": "text/event-stream" } });
async function post(cfg, url, req, { signal, fetchImpl, first, session, stream }) {
  const ac = new AbortController(), onAbort = () => ac.abort(signal?.reason);
  if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener("abort", onAbort, { once: true }); }
  const timer = setTimeout(() => ac.abort(new Error("first-byte timeout")), first);
  let r;
  try {
    r = await fetchImpl(url, { method: "POST", redirect: "manual", signal: ac.signal, body: JSON.stringify(req),
      headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", accept: stream ? "text/event-stream" : "application/json", "user-agent": OC_AGENT, "x-opencode-session": session } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw fail(cfg, ac.signal.aborted ? `no answer within ${Math.round(first / 1000)} seconds` : `couldn't connect${e?.message ? `: ${redact(e.message, cfg.key, 100)}` : ""}`);
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
  if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch?.(() => {}); throw fail(cfg, `error ${r.status || 302}: it redirected to another address`, r.status || 302); }
  if (!r.ok) { const { detail } = await errorDetail(cfg, r); throw ocFail(cfg, ocDetail(r.status, detail, ocPlan(cfg?.plan)), r.status); }
  if (!r.body) throw fail(cfg, "an empty answer");
  return r;
}
// Same contract as chatgptChat: SSE chunks when body.stream, else one JSON chat.completion. `record` (an entry of opencodeModelsJson) skips the list lookup. `session` is a stable id
// for the conversation that OpenCode uses to route Go requests. OpenCode's cost and opencode fields stay in usage.
// Every request carries x-opencode-session (Go requires it). A chat turn sends its task id; a call with none (a chore, a title, a background or memory job, Test) sends a stable id of its purpose.
export const ocSession = (cfg, session = null, purpose = "chat") => {
  const clean = (x) => String(x ?? "").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 100);
  return session ? clean(session) : clean(`1helm-${cfg?.tenantId || "account"}-${purpose || "chat"}`);
};
async function opencodeChatOnce(cfg, body, { signal = null, fetchImpl = globalThis.fetch, model, effort = null, timeouts = {}, record = null, session = null, purpose = null } = {}) {
  if (!cfg || typeof cfg.key !== "string" || !cfg.key) throw new ByokError("Your AI service isn't set up yet. Add your OpenCode API key in Settings → AI services.");
  let rec = record && record.id === model ? record : null;
  if (!rec) {
    const find = async (fresh) => (await recordsOf(cfg, { fetchImpl, signal, fresh })).find((m) => m.id === model);
    rec = await find(false) || await find(true);
    if (!rec) throw fail(cfg, `OpenCode has no model "${redact(model, cfg.key, 80)}" you can use (free models only work inside OpenCode)`, 404);
  }
  const plan = ocPlan(cfg.plan), root = ocBase(plan), first = timeouts.first ?? FIRST_MS;
  // Go: every model is asked through chat/completions, and OpenCode translates for the models that speak another API. Pay as you go: each model's own API.
  const base = plan === "go" ? `${root}/openai/v1` : (rec.base_url || "").replace(/\/+$/, "") || `${OC_BASE}/openai/v1`;
  if (!base.startsWith(`${root}/`)) throw fail(cfg, "OpenCode named an address outside opencode.ai");
  const o = { signal, fetchImpl, first, session: ocSession(cfg, session, purpose) }, wantStream = !!body.stream;
  const done = async (r, translated) => {   // a translated chunk stream → SSE, or one chat.completion
    if (wantStream) return sse(await firstEventOk(cfg, translated));
    return new Response(JSON.stringify(await collect(cfg, translated, model, { keepUsage: true })), { status: 200, headers: { "content-type": "application/json" } });
  };
  if (plan === "go" || rec.family === "chat-completions") {
    const req = byokBody(body, model); if (effortOk(rec, effort)) req.reasoning_effort = effort;
    const r = await post(cfg, `${base}/chat/completions`, req, { ...o, stream: wantStream });
    if (wantStream) return sse(await firstEventOk(cfg, passStream(cfg, guardStream(cfg, r.body, signal), model)));
    const t = await readCapped(cfg, r.body, 2 << 20); let j; try { j = JSON.parse(t); } catch { throw fail(cfg, "the answer wasn't OpenAI-style JSON"); }
    if (j?.error && !j.choices) throw ocFail(cfg, ocDetail(Number(j.error.status || j.error.code) || 0, j.error.message || JSON.stringify(j.error), ocPlan(cfg?.plan)));
    if (!Array.isArray(j?.choices)) throw fail(cfg, "the answer had no reply in it (not OpenAI-style)");
    j.model ||= model;
    return new Response(JSON.stringify(mapReasoning(j)), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (rec.family === "responses") {
    const req = responsesBody(body, model, { effort: effortOk(rec, effort) ? effort : null });
    const r = await post(cfg, `${base}/responses`, req, { ...o, stream: true });
    return done(r, responsesStream(cfg, guardStream(cfg, r.body, signal), model, { detail: (st, code, msg) => ocDetail(st, msg, ocPlan(cfg?.plan)), usage: extras }));
  }
  if (rec.family === "messages") {
    // The only format that takes cache_control here; the other three build their request from plain text and never carry a mark. The session is only read to tell a tool loop (up to four marks) from a chore (one or two) and is not sent in the body.
    const { session_id, ...marked } = withCacheBreakpoints({ ...body, ...(session ? { session_id: String(session) } : {}) });
    const r = await post(cfg, `${base}/messages`, messagesBody(marked, rec, model, { effort }), { ...o, stream: true });
    return done(r, messagesStream(cfg, guardStream(cfg, r.body, signal), model));
  }
  const r = await post(cfg, `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, geminiBody(body, rec, model, { effort }), { ...o, stream: true });
  return done(r, geminiStream(cfg, guardStream(cfg, r.body, signal), model));
}

// A provider behind OpenCode can refuse a request with more tools than it allows ("maximum number of items is 128"). 1Helm sends every tool first. On that
// exact 400 the call is sent again with the first N tools (1Helm's core tools come first in the list; the tools named by tool_choice and by earlier tool calls
// in the messages are kept so the history stays valid), and the limit is remembered for the model. The same for every model.
const toolLimits = new Map();
export function capTools(body, limit) {
  const tools = body?.tools; if (!Array.isArray(tools) || !(limit > 0) || tools.length <= limit) return body;
  const keep = new Set(); const tcn = body.tool_choice?.function?.name; if (tcn) keep.add(tcn);
  for (const m of body.messages || []) for (const c of m.tool_calls || []) if (c?.function?.name) keep.add(c.function.name);
  const must = tools.filter((t) => keep.has(t?.function?.name)).slice(0, limit), mustSet = new Set(must);
  const rest = tools.filter((t) => !mustSet.has(t)).slice(0, limit - must.length), pick = new Set([...must, ...rest]);
  return { ...body, tools: tools.filter((t) => pick.has(t)) };
}
export const toolLimitOf = (e) => { const t = `${e?.message || ""} ${e?.detail || ""}`; const m = /Invalid value for 'tools'[^]*?maximum number of items is (\d+)/i.exec(t) || /tools[^]{0,60}maximum number of items is (\d+)/i.exec(t); return m ? Number(m[1]) : 0; };
export async function opencodeChat(cfg, body, opts = {}) {
  const key = opts.model, known = toolLimits.get(key);
  try { return await opencodeChatOnce(cfg, known ? capTools(body, known) : body, opts); }
  catch (e) {
    const n = toolLimitOf(e);
    if (!n || !Array.isArray(body?.tools) || body.tools.length <= n || opts.signal?.aborted) throw e;
    toolLimits.set(key, n); console.log(`opencode: ${key} allows ${n} tools, sent ${n} of ${body.tools.length}`);
    return opencodeChatOnce(cfg, capTools(body, n), opts);
  }
}
