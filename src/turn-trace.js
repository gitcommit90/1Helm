// Turn traces for Langfuse (docs/configuration.md, "Turn traces").
//
// One trace per helper turn: a root observation for the turn, a SPAN per model step, a TOOL observation per tool run, and a SPAN for the
// decider/routing work. Every span here is built from numbers, ids, short codes and names that code chose (model id, tool name, error code).
// No message text, tool argument or tool result is ever read into a span: the only thing taken from a result is its byte length and whether
// it starts with an error marker. buildOtlp() also drops every attribute key that is not in ALLOWED_KEYS, so a new field cannot leak by accident.
//
// The AI Gateway sends its own GENERATION for each model call. The step span passes its trace id and its own span id to the gateway
// (cf-aig-otel-trace-id and cf-aig-otel-parent-span-id), so the generation nests under the step. The generation carries the tokens and the cost
// in Langfuse's usage fields. App spans carry tokens only as observation metadata (in_tok, cached_tok, out_tok), never as usage_details or
// gen_ai.usage.*, so Langfuse adds the tokens up once.
//
// Sending is a single POST of OTLP/HTTP JSON per batch, with a short timeout and no retry. A failed send loses that batch of spans and nothing else.

// The keys of a generation (CONTRACT v2). Each value is built from numbers and the model id only, never from text.
export const GEN_KEYS = { model: "langfuse.observation.model.name", usage: "langfuse.observation.usage_details", cost: "langfuse.observation.cost_details", firstToken: "langfuse.observation.completion_start_time" };

export const ALLOWED_KEYS = new Set([
  ...Object.values(GEN_KEYS),
  "langfuse.trace.name", "langfuse.user.id", "langfuse.session.id", "langfuse.environment",
  "langfuse.observation.type", "langfuse.observation.level", "langfuse.observation.status_message",
  "langfuse.trace.metadata.channel", "langfuse.trace.metadata.task", "langfuse.trace.metadata.turn", "langfuse.trace.metadata.kind",
  "langfuse.trace.metadata.outcome", "langfuse.trace.metadata.total_ms", "langfuse.trace.metadata.steps", "langfuse.trace.metadata.tool_count",
  "langfuse.trace.metadata.error_count", "langfuse.trace.metadata.charge_nano", "langfuse.trace.metadata.charge_usd", "langfuse.trace.metadata.resumes",
  "langfuse.observation.metadata.channel", "langfuse.observation.metadata.task", "langfuse.observation.metadata.turn", "langfuse.observation.metadata.kind",
  "langfuse.observation.metadata.outcome", "langfuse.observation.metadata.total_ms", "langfuse.observation.metadata.steps",
  "langfuse.observation.metadata.tool_count", "langfuse.observation.metadata.error_count", "langfuse.observation.metadata.charge_nano",
  "langfuse.observation.metadata.charge_usd", "langfuse.observation.metadata.resumes",
  "langfuse.observation.metadata.step", "langfuse.observation.metadata.model", "langfuse.observation.metadata.in_tok",
  "langfuse.observation.metadata.cached_tok", "langfuse.observation.metadata.out_tok", "langfuse.observation.metadata.ms",
  "langfuse.observation.metadata.finish", "langfuse.observation.metadata.tools_off", "langfuse.observation.metadata.tool_calls",
  "langfuse.observation.metadata.tool", "langfuse.observation.metadata.ok", "langfuse.observation.metadata.result_bytes",
  "langfuse.observation.metadata.error_type", "langfuse.observation.metadata.error_code", "langfuse.observation.metadata.purpose",
  // Custom Model Selection marker: models_from is "custom" or "ours", category is the routing category id (never a title, which is user text).
  "langfuse.trace.metadata.models_from", "langfuse.trace.metadata.category", "langfuse.observation.metadata.models_from", "langfuse.observation.metadata.category",
  // Own AI key marker: true on a step whose model call the person paid for with their own key (byok.js). The collector moves such a step to the environment own-key-dev or own-key-live.
  "langfuse.observation.metadata.own_key",
]);

const rand = (bytes) => { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); };
export const newTraceId = () => rand(16);
export const newSpanId = () => rand(8);
const HEX32 = /^[0-9a-f]{32}$/, HEX16 = /^[0-9a-f]{16}$/;
const SAFE_NAME = /^[A-Za-z0-9_.:\-]{1,64}$/;
// A name or code chosen by a model or by an exception is used only when it looks like an identifier.
export const safeName = (s, fallback = "unknown") => SAFE_NAME.test(String(s ?? "")) ? String(s) : fallback;
const SAFE_MODEL = /^[A-Za-z0-9_.:\/~@\-]{1,100}$/;
const safeModel = (m) => { const s = String(m ?? "").replace(/ \[.*$/, ""); return SAFE_MODEL.test(s) ? s : "unknown"; };
const safeLabel = (s) => String(s ?? "").replace(/[^\p{L}\p{N} _.\-]/gu, "").slice(0, 64);

// Where a call's models came from: the account's own Custom Model Selection ("custom") or our categories ("ours"), and the routing category id.
// The id is used only when it looks like one (general, or c_ plus letters and digits); a title or any other text becomes "unknown".
const CATEGORY_ID = /^(general|[a-z][a-z0-9_]{0,31})$/;
export function modelsMark(profile) {
  if (!profile || typeof profile !== "object") return {};
  const raw = profile.dispatch?.category ?? profile.category, category = raw == null ? null : CATEGORY_ID.test(String(raw)) ? String(raw) : "unknown";
  return { models_from: profile.custom === true ? "custom" : "ours", ...(category ? { category } : {}) };
}

const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
// usage_details: input is the uncached prompt, so the input* keys add up to the prompt total (cache_read_input_tokens is the cached part).
export function usageOf(res) {
  const total = num(res?.inTok), cached = num(res?.cached) ?? 0, written = num(res?.cacheWrite) ?? 0, out = num(res?.outTok);
  if (total == null && out == null) return null;
  return { input: Math.max(0, (total || 0) - cached - written), cache_read_input_tokens: cached, cache_creation_input_tokens: written, output: out || 0 };
}
const costOf = (v) => { const c = num(v); return c == null ? null : { total: c }; };
const isoOf = (ms) => Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;

const nano = (ms) => (BigInt(Math.max(0, Math.round(ms))) * 1000000n).toString();
const attr = (key, v) => typeof v === "boolean" ? { key, value: { boolValue: v } }
  : typeof v === "number" && Number.isInteger(v) ? { key, value: { intValue: String(v) } }
  : typeof v === "number" ? { key, value: { doubleValue: v } } : { key, value: { stringValue: String(v) } };

// How a tool's result text is judged. Only the first characters are tested, and nothing from the text is kept.
export function toolVerdict(out, threw = null) {
  if (threw) return { ok: false, type: "exception", code: safeName(threw.code ?? threw.name, "exception").slice(0, 40), bytes: 0 };
  const s = typeof out === "string" ? out : out == null ? "" : JSON.stringify(out);
  const bytes = new TextEncoder().encode(s).length;
  if (/^error:/i.test(s)) {
    const code = /not valid JSON/i.test(s.slice(0, 120)) ? "bad_arguments" : /not available|no longer available/i.test(s.slice(0, 160)) ? "unavailable"
      : /^error: computer unavailable/i.test(s) ? "computer_unavailable" : /credits|payment/i.test(s.slice(0, 120)) ? "credits" : "tool_error";
    return { ok: false, type: "tool_error", code, bytes };
  }
  if (/(^|\n)exit [1-9]\d*\n/.test(s.slice(0, 300))) return { ok: false, type: "command_failed", code: "exit_nonzero", bytes };
  return { ok: true, bytes };
}
// A model step's error becomes a short code: the error's own code when it is an identifier, else the HTTP status, else a fixed word.
export function modelErrorCode(e) {
  if (!e) return "model_error";
  if (e.objectReset || /Durable Object reset/i.test(String(e.message || ""))) return "interrupted";
  if (e.name === "StopError" || /stopped/i.test(String(e.code || ""))) return "stopped";
  const c = e.code ?? e.reason; if (c != null && SAFE_NAME.test(String(c))) return String(c).slice(0, 40);
  const st = Number(e.orStatus ?? e.status); if (st >= 100 && st < 600) return `http_${st}`;
  return "model_error";
}

export class TurnTrace {
  constructor({ traceId, rootId, name, tenant, session, channel, task, turnNo, kind, start, resumes = 0 }) {
    this.traceId = HEX32.test(traceId || "") ? traceId : newTraceId();
    this.rootId = HEX16.test(rootId || "") ? rootId : newSpanId();
    this.name = safeLabel(name) || "chat turn"; this.tenant = safeLabel(tenant); this.session = String(session ?? "").slice(0, 64);
    this.channel = safeLabel(channel); this.task = safeLabel(task); this.turnNo = Number(turnNo) || 0; this.kind = safeName(kind, "chat");
    this.start = start || Date.now(); this.resumes = resumes;
    this.pending = []; this.sentRoot = false; this.stepSeq = 0; this.tools = 0; this.errors = 0; this.lastFlush = Date.now(); this.last = null;
  }
  // What a resumed turn needs to keep this trace (saved with the turn's journal).
  saved() { return { trace: this.traceId, root: this.rootId, turn: this.turnNo, resumes: this.resumes, steps: this.stepSeq, tools: this.tools, errors: this.errors }; }
  restore(s) { if (s && typeof s === "object") { this.stepSeq = Number(s.steps) || this.stepSeq; this.tools = Number(s.tools) || this.tools; this.errors = Number(s.errors) || this.errors; } return this; }
  // The AI Gateway headers for a model call made inside this span.
  headers(span) { return span ? { "cf-aig-otel-trace-id": this.traceId, "cf-aig-otel-parent-span-id": span.id } : {}; }
  open(type, name, attrs = {}, parent = this.rootId) { return { id: newSpanId(), parent, type, name, start: Date.now(), attrs }; }
  close(span, { level = null, message = null, attrs = {}, end = Date.now() } = {}) {
    span.end = end; span.attrs = { ...span.attrs, ...attrs };
    if (level) { span.level = level; if (message) span.message = String(message).slice(0, 80); }
    if (level === "ERROR" && !span.root) this.errors++;
    this.pending.push(span); return span;
  }
  stepOpen(purpose = null, retry = false, mark = {}) {
    const n = ++this.stepSeq, s = this.open("generation", retry ? "chat-retry" : "chat", { step: n, ...(purpose ? { purpose } : {}), ...mark }); this.last = s; return s;
  }
  // A step is named after the gateway kind of its call ("chat", or "chat-retry" when the call was retried); the step number is the metadata `step`.
  stepClose(span, res, err = null) {
    if (span.retry) span.name = "chat-retry";
    if (err) { const code = modelErrorCode(err); return this.close(span, { level: code === "stopped" || code === "interrupted" ? "WARNING" : "ERROR", message: code, attrs: { error_code: code, ms: Date.now() - span.start } }); }
    span.gen = { model: res?.model ? safeModel(res.model) : null, usage: usageOf(res), cost: costOf(res?.providerCost), firstToken: isoOf(res?.firstTokenAt) };
    return this.close(span, { attrs: { ms: Date.now() - span.start, ...(res?.model ? { model: safeModel(res.model) } : {}),
      in_tok: Number(res?.inTok) || 0, cached_tok: Number(res?.cached) || 0, out_tok: Number(res?.outTok) || 0,
      ...(res?.finish ? { finish: safeName(res.finish, "other") } : {}), tool_calls: Array.isArray(res?.calls) ? res.calls.length : 0 } });
  }
  // A finished tool run. parent is the step span that was current when the call began.
  tool(name, start, verdict, parent = this.last?.id || this.rootId, skipped = false) {
    this.tools++;
    const s = { id: newSpanId(), parent, type: "tool", name: safeName(name, "unknown_tool"), start, attrs: { tool: safeName(name, "unknown_tool") } };
    return this.close(s, { ...(skipped ? { level: "WARNING", message: "skipped" } : verdict.ok ? {} : { level: "ERROR", message: verdict.code }),
      attrs: { ms: skipped ? 0 : Date.now() - start, ok: !!verdict.ok && !skipped, result_bytes: verdict.bytes || 0, ...(verdict.ok || skipped ? {} : { error_type: verdict.type, error_code: verdict.code }) } });
  }
  // A timed piece of work that is not a model step or a tool (the decider, routing).
  span(name, start, attrs = {}, err = null) {
    const s = { id: newSpanId(), parent: this.rootId, type: "span", name: safeName(name, "work"), start, attrs: { ...attrs } };
    return err ? this.close(s, { level: "ERROR", message: modelErrorCode(err), attrs: { ms: Date.now() - start, error_code: modelErrorCode(err) } }) : this.close(s, { attrs: { ms: Date.now() - start } });
  }
  // The decider call as a generation. jev is route2.js jevAsk's answer: model, cost in USD, ms, usage when the endpoint returned it.
  routing(jev, start) {
    const s = { id: newSpanId(), parent: this.rootId, type: "generation", name: "decider", start, attrs: {} };
    const u = jev?.usage || null, usage = u ? usageOf({ inTok: u.prompt_tokens ?? u.input_tokens, cached: u.prompt_tokens_details?.cached_tokens, outTok: u.completion_tokens ?? u.output_tokens }) : null;
    s.gen = { model: jev?.model ? safeModel(jev.model) : null, usage: usage && (usage.input || usage.output) ? usage : null, cost: costOf(jev?.cost > 0 ? jev.cost : null), firstToken: null };
    const failed = !!jev?.error;
    return this.close(s, { ...(failed ? { level: "ERROR", message: "routing_error" } : {}), attrs: { ms: num(jev?.ms) ?? Date.now() - start, ...(failed ? { error_code: "routing_error" } : {}) } });
  }
  // The root observation, built when the turn ends. outcome: replied | error | stopped | paused.
  finish({ outcome, steps, tools, charge, error = null, end = Date.now(), mark = {} }) {
    const total = end - this.start, nsteps = steps ?? this.stepSeq, ntools = tools ?? this.tools, ch = Math.max(0, Math.round(Number(charge) || 0));
    const root = { id: this.rootId, parent: null, type: "agent", name: this.name, start: this.start, root: true,
      attrs: { kind: this.kind, channel: this.channel, task: this.task, turn: this.turnNo, outcome, total_ms: total, steps: nsteps, tool_count: ntools, error_count: this.errors + (outcome === "error" ? 1 : 0),
        charge_nano: ch, charge_usd: Number((ch / 1e9).toFixed(6)), ...(this.resumes ? { resumes: this.resumes } : {}), ...mark } };
    this.close(root, { end, ...(outcome === "error" ? { level: "ERROR", message: safeName(error, "turn_error").slice(0, 40) } : {}) });
    this.sentRoot = true; return root;
  }
  hasWork() { return this.stepSeq > 0 || this.tools > 0; }
  // Take the finished spans out of the queue and make the OTLP body for them (null when there is nothing to send).
  drain() { const spans = this.pending.splice(0); this.lastFlush = Date.now(); return spans.length ? buildOtlp(this, spans) : null; }
  due() { return this.pending.length >= 8 || (this.pending.length > 0 && Date.now() - this.lastFlush > 30000); }
}

export function buildOtlp(t, spans) {
  const out = spans.map((s) => {
    const md = (k) => (s.root ? [`langfuse.trace.metadata.${k}`, `langfuse.observation.metadata.${k}`] : [`langfuse.observation.metadata.${k}`]);
    const a = { "langfuse.observation.type": s.type, "langfuse.user.id": t.tenant, "langfuse.session.id": t.session };
    if (s.root) a["langfuse.trace.name"] = t.name;
    if (s.level) a["langfuse.observation.level"] = s.level;
    if (s.message) a["langfuse.observation.status_message"] = s.message;
    if (s.gen) {
      if (s.gen.model) a[GEN_KEYS.model] = s.gen.model;
      if (s.gen.usage) a[GEN_KEYS.usage] = JSON.stringify(s.gen.usage);
      if (s.gen.cost) a[GEN_KEYS.cost] = JSON.stringify(s.gen.cost);
      if (s.gen.firstToken) a[GEN_KEYS.firstToken] = s.gen.firstToken;
    }
    for (const [k, v] of Object.entries(s.attrs || {})) { if (v === "" || v == null) continue; for (const key of md(k)) a[key] = v; }
    // Child spans repeat the trace identity as observation metadata so a filter on them works without the root.
    if (!s.root) { a["langfuse.observation.metadata.channel"] = t.channel; a["langfuse.observation.metadata.task"] = t.task; }
    const attributes = Object.entries(a).filter(([k, v]) => ALLOWED_KEYS.has(k) && v !== "" && v != null).map(([k, v]) => attr(k, v));
    return { traceId: t.traceId, spanId: s.id, ...(s.parent ? { parentSpanId: s.parent } : {}), name: s.name, kind: 1, startTimeUnixNano: nano(s.start), endTimeUnixNano: nano(s.end ?? s.start),
      attributes, status: s.level === "ERROR" ? { code: 2, message: s.message || "" } : { code: 1 } };
  });
  return { resourceSpans: [{ resource: { attributes: [attr("service.name", "1helm-app")] }, scopeSpans: [{ scope: { name: "1helm.turn" }, spans: out }] }] };
}

// One POST, a 4 second limit, no retry. Never throws. Returns true when the endpoint answered 2xx.
export async function sendOtlp(env, body, fetchImpl = globalThis.fetch) {
  const url = env?.APP_OTEL_URL, token = env?.APP_OTEL_TOKEN;
  if (!body || !url || !token) return false;
  try {
    const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    try { await r.body?.cancel?.(); } catch {}
    return r.ok;
  } catch { return false; }
}
// Queue a send without making anything wait for it.
export function flushTrace(env, t, waitUntil, fetchImpl) {
  try { const body = t.drain(); if (!body) return; const p = sendOtlp(env, body, fetchImpl); if (waitUntil) waitUntil(p); } catch {}
}

// Methods added to Resident (resident.js calls traceMix(Resident)). Every one of them swallows its own errors: tracing never changes a turn.
export const traceMix = (Resident, cacheKey) => Object.assign(Resident.prototype, {
  // The value the gateway sends as `session` for this turn's model calls (the OpenRouter session_id), so app spans and gateway generations share a Langfuse session.
  otelSession(tc) {
    const p = tc?.taskProfile; if (p?.cacheSession) return cacheKey(p.cacheSession);
    return `${this.ctx.id.toString().slice(0, 24)}:${this.get("tenant") || ""}`.slice(0, 64);
  },
  // Start (or, for a resumed turn, continue) the trace of one turn.
  otelStart(tc, tenant, channel, opts = {}) {
    try {
      let saved = null; if (opts.resume) { try { saved = JSON.parse(opts.resume.extra || "{}").otel || null; } catch {} }
      let turnNo = Number(saved?.turn) || 0;
      if (!turnNo) { try { turnNo = (this.sql.exec("SELECT COUNT(*) n FROM turns WHERE session IS ? AND kind=?", tc.session ?? null, tc.kind).toArray()[0]?.n || 0) + 1; } catch { turnNo = 0; } }
      const t = new TurnTrace({ traceId: saved?.trace, rootId: saved?.root, name: `${tc.kind} turn`, tenant, session: this.otelSession(tc), channel, task: tc.session,
        turnNo, kind: tc.kind, start: opts.resume?.started || tc.t0, resumes: opts.resume ? (Number(saved?.resumes) || 0) + 1 : 0 });
      if (saved) t.restore(saved);
      return t;
    } catch { return null; }
  },
  async otelModel(tc, purpose, fn) {
    const t = tc?.otel; let span;
    try { if (!t) return await fn(); t.session = this.otelSession(tc); span = t.stepOpen(purpose, !!tc.otelRetry, modelsMark(tc.taskProfile)); tc.otelRetry = false; tc.otelStep = span; } catch (e) { if (!span) return fn(); throw e; }
    // Own AI key (byok.js): env.BYOK is set while the person's own key pays for the call. It is read after the call because a backup key can switch on during it.
    const ownKey = () => { try { if (this.env?.BYOK) span.attrs.own_key = true; } catch {} };
    let r;
    try { r = await fn(); } catch (e) { ownKey(); try { t.stepClose(span, null, e); } catch {} throw e; }
    ownKey();
    try { t.stepClose(span, r); this.otelCheckpoint(tc); } catch {}
    return r;
  },
  async otelTool(tc, name, fn) {
    const t = tc?.otel; if (!t) return fn();
    const start = Date.now(), parent = t.last?.id || t.rootId;
    let out;
    try { out = await fn(); } catch (e) { try { if (!(e?.objectReset || /Durable Object reset/i.test(String(e?.message || "")))) t.tool(name, start, toolVerdict(null, e), parent); } catch {} throw e; }
    try { t.tool(name, start, toolVerdict(out), parent); } catch {}
    return out;
  },
  // Pi engine and other callers that time a tool themselves.
  otelToolDone(tc, name, start, out) { try { tc?.otel?.tool(name, start, toolVerdict(out), tc.otel.last?.id || tc.otel.rootId); } catch {} },
  async otelSpan(tc, name, fn) {
    const t = tc?.otel; if (!t) return fn(); const start = Date.now();
    try { const r = await fn(); try { t.span(name, start); } catch {} return r; } catch (e) { try { t.span(name, start, {}, e); } catch {} throw e; }
  },
  // route2.js routeTwoTurn calls this after the decider answered (or was skipped).
  otelRouting(tc, jev, start) { try { const t = tc?.otel; if (!t) return; if (!jev) t.span("routing", start); else t.routing(jev, start); } catch {} },
  // The meta keys a model call passes to the dispatcher so the gateway nests its generation under the current step.
  otelMeta(tc) { const t = tc?.otel, s = tc?.otelStep; return t && s ? { _otel: { trace: t.traceId, parent: s.id } } : {}; },
  // Send what is finished so far when a long turn has queued enough spans (the root is sent only by otelEnd).
  otelCheckpoint(tc) { const t = tc?.otel; if (t && t.due()) flushTrace(this.env, t, (p) => this.ctx?.waitUntil?.(p)); },
  // The turn ended. A parked turn (a deploy reset it) sends its finished spans and leaves the root for the resumed run.
  otelEnd(tc, r, err) {
    try {
      const t = tc?.otel; if (!t || tc.otelDone) return; tc.otelDone = true;
      const wu = (p) => this.ctx?.waitUntil?.(p);
      if (tc.objectReset) { if (t.hasWork()) flushTrace(this.env, t, wu); return; }
      const outcome = tc.stoppedTurn || tc.abort === "hard" ? "stopped" : err || r?.error ? "error"
        : tc.pause || tc.inputRequest || tc.helperInputQuestion || tc.orchestration?.waitingInput || r?.input_requested ? "paused" : "replied";
      if (!t.hasWork() && outcome === "replied") return;   // a turn that made no model call and ran no tool (a fixture, a read-only account) leaves nothing to look at
      t.session = this.otelSession(tc);
      t.finish({ outcome, steps: r?.steps, tools: r?.tool_calls, charge: r?.charge ?? tc.appendStats?.charge ?? 0, error: err ? modelErrorCode(err) : r?.error ? safeName(r.error, "turn_error") : null, mark: modelsMark(tc.taskProfile) });
      flushTrace(this.env, t, wu);
    } catch {}
  },
});
