// The Sandbox view of /models (administrators only, the same check as the page): see the real request a job sends, edit it, and send it to the job's model
// through the real call path with the job's saved settings. Nothing is saved: the call runs on a copy of the Worker env whose database answers only the privacy
// question, so no task, memory, Hindsight call, ledger charge or "Last served" row is written. Every gateway log line is tagged kind "sandbox".
// Routes (under /models/api/sandbox, wired in models-console.js):
//   GET  jobs                    every job and chat category: id, label, group, kind, inputs and the saved main model
//   GET  sample?job=<id>         the job's built request: { request, files, via, shape, model } (samples are in src/sandbox-samples)
//   POST send                    { job, request, files, model?, effort?, facts? } -> the reply, with model, tokens, cost, time, view and the raw request
// The request holds file placeholders { "$file": name, "as": "data_url" | "base64" | "bytes" | "text" }. Fixture files are read from /app-static/sandbox/ by this
// file (the browser never sends fixture bytes), and files the person attached come as base64.
import { JOBS, JOB_KINDS, jobDef, entriesOf, jobSetting } from "./model-jobs.js";
import { modelSettingsEnv } from "./model-settings.js";
import { dispatch } from "./model-dispatch.js";
import { dispatchMedia } from "./media-job.js";
import { askJob, askDecider } from "./text-decision.js";
import { cleanChatRequest } from "./hindsight-llm.js";
import { stt } from "../transcribe.js";
import { routingCategories } from "./routing-config.js";
import { sampleFor } from "./sandbox-samples/index.js";
import { goldenFor, saveGolden } from "./sandbox-goldens.js";

export const FILES_MAX = 20 * 1024 * 1024;            // bytes of files in one send
export const SEND_MAX = Math.ceil(FILES_MAX * 4 / 3) + 512 * 1024;   // the JSON body of a send: the files in base64 plus the text
const FIXTURE = /^\/app-static\/sandbox\/[A-Za-z0-9._-]{1,120}$/;
const MODEL_ID = /^[A-Za-z0-9~@._:/+-]{1,200}$/;
const EFFORTS = ["none", "default", "minimal", "low", "medium", "high", "xhigh", "max"];
const FACT_KEYS = ["name", "kinds", "levels", "pricing", "efforts", "default_effort", "source", "context_length", "max_output", "input_modalities", "json", "tool_choice", "hosts", "in_nano", "quirks"];
const fail = (status, message) => Object.assign(new Error(message), { status });
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- how each function the jobs use to reach a model is called ----
// Each takes the sandbox env, the job id, the request (placeholders already replaced) and { model } (the override, applied through the settings copy), and returns the
// function's own answer. "raw" says the answer is a Response (read as JSON) or an object.
// A sandbox call keeps the gateway kind its real job uses, because the dispatcher and the transport treat some kinds differently (e.g. no temperature for a JSON chore).
// It is marked by two extra tags that change nothing in a request body: sandbox: true and tenant "sandbox" (the tenant also makes the privacy lookup answer "unrestricted").
// A sample can name its kind with a `meta: { kind }` field next to `via`; otherwise this table (the kind each job's real call site sends) is used.
const KIND = { label: "card-label", chat_title: "chat-title", sidecar_card: "sidecar-card", notes: "live-notes-note", notes_refine: "live-notes-refine", notes_final: "live-notes-final", ambient_extract: "ambient-extract", ambient_review: "ambient-review",
  browser: "browser-oss", vision_files: "sidecar-vision-image", hs_retain: "memory-retain", mem_extract: "memory-extract", mem_embed: "memory-embed", mem_rerank: "memory-rerank", hs_consolidation: "memory-consolidation", hs_reflect: "memory-reflect", hs_refresh: "memory-refresh", hs_rerank: "memory-rerank",
  decider: "decider", web_search: "web-search", "chat": "chat" };
export const metaFor = (job, sample = {}) => { const kind = sample?.meta?.kind || KIND[job] || null; return { ...(kind ? { kind } : {}), tenant: "sandbox", sandbox: true }; };
export const VIAS = {
  // The one dispatcher. A chat category runs with a route, as the main chat does.
  "model-dispatch.js#dispatch": (env, job, request, o) => dispatch(env, o.category ? "chat" : job, request, { meta: o.meta, fetch: o.fetch, level: "unrestricted", ...(o.category ? { route: o.route } : {}) }),
  "media-job.js#dispatchMedia": (env, job, request, o) => dispatchMedia(env, job, request, { meta: o.meta, fetch: o.fetch, level: "unrestricted" }),
  // The decision jobs: request is { state, questions } (and an optional timeoutMs).
  "text-decision.js#askJob": (env, job, request, o) => askJob(env, job, { state: request.state, questions: request.questions, meta: o.meta, fetchImpl: o.fetch, ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}) }),
  "text-decision.js#askDecider": (env, job, request, o) => askDecider(env, request.state, request.questions, { job, meta: o.meta, fetchImpl: o.fetch, ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}) }),
  // The memory server's chat calls: request is the body the memory server sends. It is cleaned the way the /_hs endpoint cleans it and runs at the zero-data-retention level.
  "hindsight-llm.js#cleanChatRequest": (env, job, request, o) => dispatch(env, job, cleanChatRequest(request, env.MODEL_SETTINGS, job), { meta: o.meta, fetch: o.fetch, level: "zdr" }),
  // Speech: request is { src: { bytes }, format, estSec?, prompt?, job? }, the arguments of stt().
  "transcribe.js#stt": (env, job, request, o) => stt(env, { bytes: request.src?.bytes }, { format: request.format || "wav", meta: o.meta, fetchImpl: o.fetch, estSec: request.estSec || 0, prompt: request.prompt || "", job: request.job || job }),
};

// ---- jobs ----
export function jobRows(settings, { categories = true } = {}) {
  const rows = JOBS.map((j) => ({ id: j.id, label: j.label, group: j.group, kind: j.kind, inputs: JOB_KINDS[j.kind]?.inputs || ["text"], model: settings?.jobs?.[j.id]?.model || null }));
  if (categories) for (const c of routingCategories(settings)) rows.push({ id: `chat:${c.id}`, label: c.title, group: "chat", kind: "chat", inputs: ["text", "image"], model: firstOfChain(c)?.model || null });
  return rows;
}
const chainOf = (cat) => cat?.chains?.unrestricted || Object.values(cat?.chains || {})[0] || [];
const firstOfChain = (cat) => chainOf(cat)[0] || null;
const parseJob = (id, settings) => {
  id = String(id || "");
  if (id.startsWith("chat:")) { const category = routingCategories(settings).find((c) => c.id === id.slice(5)); if (!category) throw fail(404, "That chat category does not exist."); return { id, category, def: { kind: "chat" } }; }
  const def = jobDef(id); if (!def) throw fail(404, "That job does not exist."); return { id, category: null, def };
};

// ---- files and placeholders ----
const isPlaceholder = (v) => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.$file === "string" && Object.keys(v).every((k) => k === "$file" || k === "as");
function walk(v, fn) {
  if (isPlaceholder(v)) return fn(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, fn)]));
  return v;
}
export function toBase64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
const fromBase64 = (t) => { try { const s = atob(String(t)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } catch { throw fail(400, "A file could not be read."); } };
// The bytes of every file in the request body's files list: fixtures from the static folder, uploads from their base64. Total size is bounded.
async function loadFiles(env, list, origin) {
  if (!Array.isArray(list)) list = [];
  if (list.length > 24) throw fail(400, "Too many files.");
  const out = new Map(); let total = 0;
  for (const f of list) {
    const name = String(f?.name || "").slice(0, 160), type = String(f?.type || "application/octet-stream").slice(0, 100);
    if (!name || out.has(name)) throw fail(400, "Each file needs its own name.");
    let bytes;
    if (f.source === "upload") bytes = fromBase64(f.data);
    else {
      if (!FIXTURE.test(String(f.path || ""))) throw fail(400, "That sample file is not available.");
      const r = await env.ASSETS?.fetch(new Request(new URL(f.path, origin))).catch(() => null);
      if (!r?.ok) throw fail(404, `The sample file ${name} is not available.`);
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    total += bytes.length;
    if (total > FILES_MAX) throw fail(413, "Files are limited to 20 MB in total. Remove a file and try again.");
    out.set(name, { name, type, bytes });
  }
  return out;
}
// Replaces each placeholder with the file's content in the form it asks for. shown: the same request with each placeholder as "<name, N bytes>".
export function resolveRequest(request, files) {
  const need = (p) => { const f = files.get(p.$file); if (!f) throw fail(400, `The file "${p.$file}" is not attached. Add it again or remove it from the request.`); return f; };
  const real = walk(request, (p) => {
    const f = need(p), as = p.as || "base64";
    if (as === "data_url") return `data:${f.type};base64,${toBase64(f.bytes)}`;
    if (as === "base64") return toBase64(f.bytes);
    if (as === "bytes") return f.bytes;
    if (as === "text") return new TextDecoder().decode(f.bytes);
    throw fail(400, `Unknown file form "${String(as).slice(0, 20)}".`);
  });
  const shown = walk(request, (p) => `<${need(p).name}, ${need(p).bytes.length} bytes>`);
  return { real, shown };
}

// ---- recording what is sent to the provider ----
// A send hands its own recording fetch to the dispatcher (the `fetch` option, carried down to every OpenRouter and AI Gateway call) and wraps the Workers AI binding on its
// own env copy. Nothing global is replaced, so other requests in the same Worker are never recorded. The recorder keeps each outgoing request: URL, headers without any credential, and the body as sent, with file bytes shown as "<name, N bytes>".
const SECRET = /auth|key|token|secret|cookie/i;
function shownBody(v, files) {
  let t;
  if (typeof v === "string") t = v;
  else if (v == null) return null;
  else if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `<${v.byteLength} bytes>`;
  else if (typeof v === "object" && typeof v.getReader === "function") return "<streamed body>";
  else { try { t = JSON.stringify(v, (k, x) => (x instanceof Uint8Array ? `<${x.length} bytes>` : x)); } catch { return "<body>"; } }
  for (const f of files.values()) { const b64 = toBase64(f.bytes), sh = `<${f.name}, ${f.bytes.length} bytes>`; t = t.split(`data:${f.type};base64,${b64}`).join(sh).split(b64).join(sh); }
  try { return JSON.parse(t); } catch { return t; }
}
function makeRecorder(env, files) {
  const sent = [];
  const hdrs = (h) => { const out = {}; const it = h instanceof Headers ? [...h.entries()] : Object.entries(h || {}); for (const [k, v] of it) if (!SECRET.test(k)) out[String(k).toLowerCase()] = String(v); return out; };
  const wrapped = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    sent.push({ url: url.replace(/([?&](?:key|token|api_key)=)[^&]*/gi, "$1<hidden>"), method: init.method || "GET", headers: hdrs(init.headers), body: shownBody(init.body, files) });
    return globalThis.fetch(input, init);
  };
  const ai = env.AI ? new Proxy(env.AI, { get(t, k) { const v = t[k]; return typeof v === "function" ? (...a) => {
    sent.push({ binding: `AI.${String(k)}`, ...(k === "run" ? { model: a[0], input: shownBody(a[1], files), options: shownBody(a[2] ? { ...a[2], ...(a[2].extraHeaders ? { extraHeaders: hdrs(a[2].extraHeaders) } : {}), signal: undefined } : null, files) } : { input: shownBody(a[0], files) }) });
    return v.apply(t, a); } : v; } }) : undefined;
  return { sent, fetch: wrapped, ai };
}

// ---- the env a send runs on ----
// A copy of the Worker env: the saved settings (with the model chosen for this send, if any), no waitUntil work, and a database that answers only the account privacy
// question (the sandbox account has none, so it is the unrestricted level) and writes nothing. Bindings the call itself needs (AI, secrets, ASSETS) are inherited.
export function sandboxDb() {
  const stmt = (q) => { const s = { bind() { return s; }, async first() { return /ai_privacy/.test(q) ? { ai_privacy: "unrestricted" } : null; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 0 } }; } }; return s; };
  return { prepare: stmt };
}
function sandboxEnv(env, settings, ai) {
  return Object.assign(Object.create(env), { DB: sandboxDb(), MODEL_SETTINGS: settings, MODEL_SETTINGS_REVISION: 0, waitUntil() {}, ...(ai ? { AI: ai } : {}) });
}
// The saved settings with the one model of this send in place of the job's models. Returns { settings, route }.
export function withOverride(settings, parsed, over) {
  const s = clone(settings), route = parsed.category ? { dynamicRouting: true, category: parsed.category.id, chain: chainOf(parsed.category).map((e) => ({ model: e.model, effort: e.effort ?? null })) } : null;
  if (!over) return { settings: s, route };
  const entry = { model: over.model, effort: over.effort ?? null };
  if (!s.catalog[over.model] && over.facts) s.catalog[over.model] = { id: over.model, ...over.facts };
  if (route) route.chain = [entry];
  else s.jobs[parsed.id] = { ...jobSetting(s, parsed.id), ...entry, fallbacks: [] };
  return { settings: s, route };
}
function readOverride(body) {
  if (body.model == null || body.model === "") return null;
  const model = String(body.model);
  if (!MODEL_ID.test(model)) throw fail(400, "That model ID is not valid.");
  const effort = body.effort == null || body.effort === "" ? null : String(body.effort);
  if (effort !== null && !EFFORTS.includes(effort)) throw fail(400, "That reasoning level is not valid.");
  let facts = null;
  if (body.facts && typeof body.facts === "object" && !Array.isArray(body.facts)) facts = Object.fromEntries(FACT_KEYS.filter((k) => body.facts[k] !== undefined).map((k) => [k, clone(body.facts[k])]));
  return { model, effort, facts };
}

// ---- reading the answer ----
const flat = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("") : "";
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
function toolCalls(msg) {
  return (Array.isArray(msg?.tool_calls) ? msg.tool_calls : []).map((t) => {
    let args = t?.function?.arguments; if (typeof args === "string") { try { args = JSON.parse(args); } catch { /* shown as text */ } }
    return { id: t?.id ?? null, name: t?.function?.name ?? t?.name ?? null, arguments: args ?? null };
  });
}
// The answers of a decision or ranking call as an order, best first, when every answer is a number or names a choice.
function rankingOf(answers) {
  const rows = Object.entries(answers || {}).map(([id, a]) => ({ id, score: num(a?.score ?? a?.noul ?? a) })).filter((r) => r.score !== null);
  return rows.length && rows.length === Object.keys(answers).length ? rows.sort((a, b) => b.score - a.score) : null;
}
export async function readReply(r, { jobId, kind, via }) {
  let j = r;
  if (r && typeof r.clone === "function" && typeof r.json === "function") { const text = await r.clone().text().catch(() => ""); try { j = JSON.parse(text); } catch { j = { text }; } }
  j = j && typeof j === "object" ? j : {};
  const u = j.usage || {};
  const out = { served: typeof j.model === "string" ? j.model : (typeof r?.model === "string" ? r.model : null), provider: typeof j.provider === "string" ? j.provider : null,
    tokens_in: num(u.prompt_tokens ?? u.input_tokens), tokens_out: num(u.completion_tokens ?? u.output_tokens), tokens_reasoning: num(u.completion_tokens_details?.reasoning_tokens), cost: num(u.cost ?? j.cost), requested: typeof r?.requested === "string" ? r.requested : null };
  if (via === "transcribe.js#stt") return { ...out, served: j.model || out.served, cost: j.nano != null ? num(j.nano) / 1e9 : null, view: { type: "transcript", text: String(j.text || "") } };
  if (via.startsWith("text-decision.js")) {
    if (j.error) throw new Error(String(j.error));
    return { ...out, served: j.model || j.entryModel || null, tokens_in: num(j.usage?.input_tokens), cost: j.nano != null ? num(j.nano) / 1e9 : num(j.usage?.cost), view: { type: "answers", answers: j.answers ?? null } };
  }
  const choice = j.choices?.[0];
  if (choice) { const msg = choice.message || {}; return { ...out, view: { type: "chat", text: flat(msg.content), tool_calls: toolCalls(msg), finish_reason: choice.finish_reason ?? null } }; }
  const vec = j.data?.[0]?.embedding;
  if (Array.isArray(vec)) return { ...out, view: { type: "embedding", size: vec.length, first: vec.slice(0, 8) } };
  if (kind === "rerank_memory" && Array.isArray(j.response)) return { ...out, view: { type: "ranking", order: j.response.map((d) => ({ id: String(d.id), score: d.score })), answers: null } };
  if (kind === "rerank" || (j.answers && jobId === "hs_rerank")) return { ...out, view: { type: "ranking", order: rankingOf(j.answers), answers: j.answers ?? null } };
  if (j.answers) return { ...out, view: { type: "answers", answers: j.answers } };
  const list = j.results || j.items || j.result?.results || j.data?.results || j.response?.results;
  if (Array.isArray(list) || kind === "search") return { ...out, view: { type: "search", results: (Array.isArray(list) ? list : []).slice(0, 10).map((x) => ({ title: String(x?.title || x?.name || "").slice(0, 200), url: String(x?.url || x?.link || "").slice(0, 400), snippet: String(x?.snippet || x?.description || x?.content || x?.text || "").slice(0, 400) })) } };
  if (kind === "look" || j.answer !== undefined || j.caption !== undefined || j.points !== undefined) return { ...out, view: { type: "look", answer: j.answer ?? j.caption ?? null, points: j.points ?? null } };
  if (typeof j.text === "string" || (typeof j.result?.text === "string")) return { ...out, view: { type: "transcript", text: String(j.text ?? j.result.text) } };
  return { ...out, view: { type: "json", json: j } };
}

// ---- the routes ----
const answerJson = (value, status = 200) => ({ status, value });
export async function sandboxRead(env, url) {
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS, path = url.pathname;
  if (path.endsWith("/jobs")) return answerJson({ jobs: jobRows(settings) });
  const parsed = parseJob(url.searchParams.get("job"), settings);
  const sample = sampleFor(parsed.id);
  if (!sample) throw fail(404, "This job has no sample request yet.");
  if (!VIAS[sample.via]) throw fail(409, `The sample of ${parsed.id} uses ${sample.via}, which the Sandbox cannot send.`);
  const built = await sample.build(env, { settings, job: parsed.id });
  const files = [];
  for (const f of built.files || []) {
    let size = null;
    try { const r = await env.ASSETS?.fetch(new Request(new URL(f.path, url.origin))); if (r?.ok) size = (await r.arrayBuffer()).byteLength; } catch { /* the chip shows no size */ }
    files.push({ name: f.name, type: f.type, path: f.path, size });
  }
  const row = jobRows(settings).find((r) => r.id === parsed.id);
  return answerJson({ job: row, via: sample.via, request: built.request, files, shape: Array.isArray(built.request?.messages) ? "chat" : "fields", golden: await goldenFor(env, parsed.id, sample) });
}

// POST golden: { job, golden: { value, max_wer? } | null }. Saves the golden answers for the job (null goes back to the sample's own). Returns { golden, default, saved }.
export async function sandboxGolden(env, body, email) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "The request must be a JSON object.");
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS, parsed = parseJob(body.job, settings);
  if (body.golden !== null && (!body.golden || typeof body.golden !== "object" || Array.isArray(body.golden))) throw fail(400, "The golden answers must be an object.");
  return answerJson({ ok: true, ...(await saveGolden(env, parsed.id, sampleFor(parsed.id), body.golden, email)) });
}

// body: the parsed JSON of a send. Returns { status, value }.
export async function sandboxSend(env, body, url) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "The request must be a JSON object.");
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS, parsed = parseJob(body.job, settings);
  const sample = sampleFor(parsed.id);
  if (!sample || !VIAS[sample.via]) throw fail(404, "This job has no sample request yet.");
  if (!body.request || typeof body.request !== "object" || Array.isArray(body.request)) throw fail(400, "The request must be a JSON object.");
  const files = await loadFiles(env, body.files, url.origin), { real } = resolveRequest(body.request, files);
  // A sandbox send is never streamed, and tools are only described to the model: nothing here runs one.
  if ("stream" in real) delete real.stream;
  const over = readOverride(body), { settings: used, route } = withOverride(settings, parsed, over);
  const meta = metaFor(parsed.category ? "chat" : parsed.id, sample);
  {
    const rec = makeRecorder(env, files), sbx = sandboxEnv(env, used, rec.ai), started = Date.now();
    const raw = () => ({ job: parsed.id, via: sample.via, ...(over ? { model: over.model } : {}), requests: rec.sent });
    try {
      const r = await VIAS[sample.via](sbx, parsed.category ? "chat" : parsed.id, real, { category: parsed.category, route, meta, fetch: rec.fetch });
      const reply = await readReply(r, { jobId: parsed.id, kind: parsed.def.kind, via: sample.via });
      return answerJson({ ok: true, job: parsed.id, via: sample.via, requested: over?.model || reply.requested || null, ...reply, ms: Date.now() - started, raw_request: raw() });
    } catch (e) {
      return answerJson({ ok: false, error: String(e?.message || e).slice(0, 600), errors: Array.isArray(e?.errors) ? e.errors.slice(0, 6) : [], ms: Date.now() - started, raw_request: raw() }, 502);
    }
  }
}
