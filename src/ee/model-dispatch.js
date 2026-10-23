// The one place a job's model call is made from. Other files ask for a job by its ID and never pick a model, a transport or a provider.
//
// API (frozen in commit A1, filled in by A2):
//   plan(settings, jobId, { level, call }) -> Plan            pure, in src/model-plan.js (the Plan and Step shapes are documented there)
//   dispatch(env, jobId, request, { meta, signal, level, session, model, fetch }) -> Promise<Response>
//     env      the Worker env. The saved settings are read here (modelSettingsEnv), never taken from the caller.
//     jobId    a saved job ID (model-jobs.js JOB_IDS)
//     request  the adapter's body (below). The model, reasoning level, output limit, provider fields and price ceiling come from the plan, never from the request.
//     meta     { tenant, kind, channel, ... } gateway and receipt tags, passed through. The gateway log also gets { job: jobId }.
//     signal   AbortSignal for the person's Stop
//     level    the account's privacy level; when omitted it is read for meta.tenant
//     session  the session ID used for prompt cache stickiness (chat adapters)
//     model    run only the plan step that holds this model (a caller that already chose one entry of the job, such as a live dictation chunk)
//     fetch    transport for the live dictation WebSocket and the decision endpoint (tests)
//     route    the main chat only: a running task's route (route.taskAffinity, with its profile) or the routing policy's route (route.two). Its models come from the
//              route, in its order, and each attempt reads max output, sort and price cap from the saved routing category the turn was routed to (categoryLimits in model-jobs.js).
//
// The plan lists the job's models in order. Each step has its own adapter, and dispatch tries the steps in order and returns the first answer.
// When every step fails it throws the last error, with `errors` listing "model: message" for each step.
// A caller's max_tokens, reasoning, models and provider fields are ignored: /models owns them. Adapters (request shapes):
//   chat              a chat completion body (messages, tools, stream, response_format, ...). Returns the chat completion Response, streamed when body.stream is set.
//   decide_json       the same chat body, with a response_format asking for JSON. The step's provider sets require_parameters.
//   embeddings        { input: string[] }. Returns an OpenAI shaped embeddings Response.
//   rerank            { query, contexts: [{ text }], top_k? }. Returns { response: [{ id (index into contexts), score }], model, usage } as JSON, best first, the shape of the Workers AI reranker.
//   transcribe        { openrouter?: ({ model, provider }) => () => body | string, cloudflare?: () => workersAiInput, skip?: (step) => reason|null, tryMs? }.
//                     openrouter makes the body of POST /audio/transcriptions for that model; cloudflare makes the Workers AI input. Returns the transcription Response (JSON).
//                     self makes the audio for a model of the 1Helm container (source SELF): async () => ({ audio, format, language? }). That answer is JSON with model, text, segments
//                     ([{ start, end, text }]), words ([{ w, s, e }], empty when the model gives no word times), duration and usage ({ cost, seconds }, cost in dollars of container time).
//                     A SELF step throws an error with warming set to true when no container is ready (it starts one in the background), so the next step answers.
//   transcribe_live   {} . Returns the 101 Response of the live dictation WebSocket (use response.webSocket). A model of the 1Helm container is not a socket: it is planned as "transcribe".
//   diarize           { audio, format, num_speakers? } or { session }. Says who spoke when with a model of the 1Helm container. Returns JSON { model, turns, usage }: turns are
//                     [{ s, e, speaker }] in seconds for audio, and [{ start_ms, end_ms, speaker }] for a live session (the session key, speech container).
//   decide_systemone  { state, questions }. Returns the /systemone Response (JSON: answers, usage, model).
//   decide_clef       { state, questions }. Returns the Workers AI answer as a JSON Response.
//   look              the Moondream body ({ task, image, question | target | caption_length }). The job's max_output applies to the "query" task when it is saved. Returns the answer as a JSON Response.
//   search            { query, limit }. The saved job's model is "cloudflare/<provider>". Returns the Cloudflare Web Search Response.
//
// The transport is the ID's source (isCloudflareModel, isSelfHostedModel); there is no ENV_NAME, TEST_MODE or DYNAMIC_ROUTING check in this file.
import { plan } from "./model-plan.js";
import { jsonLevelsFor } from "./model-catalog.js";
import { noteServed, servedJobOf } from "./model-served.js";
import { modelSettingsEnv } from "./model-settings.js";
import { effortBody, quirkOf, jobTimeoutMs } from "./model-jobs.js";
import { privacyOf } from "../privacy.js";
import { boundedText } from "../bounded-body.js";
import { cappedResponseBytes } from "../bounded-response.js";
import { byokChat } from "../byok.js";
import { orFetch, orFetchPath, firstOk, replayFor, cacheKey, aiOpts, routedChat, byokFast } from "../model.js";
import { cloudflareChat, cloudflareEmbeddings, cloudflareRerank, authorizeCloudflare, cfOptions, abortable, isCloudflareModel } from "../cloudflare-models.js";
import { selfHostedEmbeddings } from "../selfhost-models.js";
import { speechFn } from "../speech-impl.js";   // selfTranscribe, selfDiarize and selfSessionDiarize of selfhost-speech.js (a test puts fakes in their place)
export { plan };

const OR_HEADERS = { "x-openrouter-metadata": "enabled" };
const fail = (what, status, text) => Object.assign(new Error(`${what} ${status}: ${String(text || "").slice(0, 200)}`), { orStatus: status });
// Throws for a Response that is not a success, so the next step runs.
async function okOrThrow(r, what) { if (!r.ok) throw fail(what, r.status, await boundedText(r, 64 * 1024).catch(() => "")); return r; }
// Reads a remote answer once, up to a limit, and gives it back as a Response that can be read again (the stream is cancelled when it is too big, and the
// answer is then empty so the caller reports its own error). A tee of the stream (response.clone) would wait for the other copy to be cancelled.
async function hold(r, maxBytes) {
  const bytes = await cappedResponseBytes(r, maxBytes);
  let json = null; try { if (bytes) json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch {}
  return { json, response: new Response(bytes || "", { status: r.status, statusText: r.statusText, headers: r.headers }) };
}
const withTimeout = (signal, ms) => ms ? (signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms)) : signal;

// The Workers AI streaming WebSocket (Deepgram) through our AI Gateway. Logging, payload logging and caching are off: audio and text stay in the socket.
export function liveProviderRequest(env, model) {
  const query = new URLSearchParams({ model, encoding: "linear16", sample_rate: "16000", channels: "1", interim_results: "true", punctuate: "true", endpointing: "300", mip_opt_out: "true" });
  return { url: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AIG_ID}/workers-ai?${query}`, headers: {
    Upgrade: "websocket", "cf-aig-authorization": `Bearer ${env.AIG_TOKEN}`,
    "cf-aig-collect-log": "false", "cf-aig-collect-log-payload": "false", "cf-aig-skip-cache": "true" } };
}

// The levels, or null when the lookup fails or takes longer than ms (the request then goes as before).
async function levelsWithin(ms, promise) { let t; try { return await Promise.race([promise, new Promise((r) => { t = setTimeout(() => r(null), ms); })]); } catch { return null; } finally { clearTimeout(t); } }
// True unless the catalog record lists the levels where an endpoint accepts response_format and the job's level is not one of them (older records
// carry no list and keep sending json_schema).
export const structuredSupported = (facts, level) => !Array.isArray(facts?.json_levels) || !level || facts.json_levels.includes(level);
// The body fields to replace: no response_format, and the schema as an instruction in a system message that the reply is JSON only.
export function promptOnlyJson(body, facts, level) {
  const f = body?.response_format;
  if (f?.type !== "json_schema" || structuredSupported(facts, level)) return {};
  const schema = f.json_schema?.schema;
  const note = { role: "system", content: `Reply with only one JSON value, with no other text and no code fence, that matches this JSON schema:\n${JSON.stringify(schema ?? {})}` };
  return { response_format: undefined, messages: [...(body.messages || []), note] };
}

const ADAPTERS = {
  // chat and decide_json: one chat completion on the step's model, built from the plan only.
  async chat(c, s) {
    const { reasoning, provider, models, model: _m, max_tokens, ...b } = c.request || {};
    const facts = c.settings?.catalog?.[s.model];
    // A model that can't do JSON mode gets the request without a response format.
    if (b.response_format && b.response_format.type !== "json_schema" && (quirkOf(c.settings, s.model, "no_json") || facts?.json === false)) delete b.response_format;
    // A request for structured outputs goes to a model with no endpoint at this privacy level that accepts response_format as a prompt-only JSON request,
    // because json_schema with require_parameters would leave OpenRouter no endpoint (404 "No endpoints found that can handle the requested parameters").
    if (s.source === "OR" && b.response_format?.type === "json_schema") {
      const known = Array.isArray(facts?.json_levels) ? facts : { ...facts, json_levels: await levelsWithin(3000, (c.jsonLevels || jsonLevelsFor)(s.model, c.settings, { env: c.env })) };
      Object.assign(b, promptOnlyJson(b, known, c.level));
    }
    const payload = { ...b, messages: replayFor(b.messages, s.model), model: s.model, ...(Number.isFinite(s.maxOutput) ? { max_tokens: s.maxOutput } : {}), ...effortBody(s.effort, s.model, c.settings),
      ...(s.source === "OR" ? { provider: s.provider, usage: { include: true }, ...(c.session ? { session_id: String(c.session).slice(0, 256), prompt_cache_key: cacheKey(c.session) } : {}) } : {}) };
    const r = s.source === "CF" ? await cloudflareChat(c.env, payload, c.meta, c.signal, facts) : await orFetch(c.env, payload, c.meta, OR_HEADERS, c.signal, c.fetchImpl || globalThis.fetch);
    await okOrThrow(r, `openrouter ${s.model}`);
    return firstOk(r, !!b.stream);
  },
  async embeddings(c, s) {
    if (s.source === "CF") return Response.json(await cloudflareEmbeddings(c.env, s.model, c.request.input, c.meta));
    if (s.source === "SELF") return Response.json(await selfHostedEmbeddings(c.env, s.model, c.request.input, c.meta));
    return okOrThrow(await orFetchPath(c.env, "embeddings", { model: s.model, input: c.request.input, provider: s.provider }, c.meta, {}, c.signal, c.fetchImpl || undefined), `embeddings ${s.model}`);
  },
  async rerank(c, s) {
    if (s.source !== "CF") throw new Error(`${s.model} cannot rerank here.`);   // the 1Helm container (source SELF) is added by selfhost-models.js
    return Response.json(await cloudflareRerank(c.env, s.model, c.request, c.meta, c.signal));
  },
  async transcribe(c, s) {
    const q = c.request || {}, why = q.skip?.(s);
    if (why) throw new Error(String(why));
    const signal = withTimeout(c.signal, q.tryMs);
    if (s.source === "SELF") {
      if (!q.self) throw new Error("no audio for the 1Helm container");
      const r = await abortable(speechFn("selfTranscribe")(c.env, s.model, await q.self(), c.meta), signal);
      signal?.throwIfAborted();
      return Response.json({ model: r.model, text: r.segs.map((x) => x.t).join(" "), segments: r.segs.map((x) => ({ start: x.s, end: x.e, text: x.t })), words: r.words, duration: r.usage.audio_s, usage: { cost: r.usage.cost, seconds: r.usage.audio_s, container_ms: r.usage.container_ms } });
    }
    if (s.source === "CF") {
      if (!q.cloudflare) throw new Error("no Cloudflare input for this recording");
      await authorizeCloudflare(c.env, s.model, c.meta, c.settings?.catalog?.[s.model]); signal?.throwIfAborted();
      const out = await abortable(c.env.AI.run(s.model, await q.cloudflare(), { ...cfOptions(c.env, c.meta), ...(signal ? { signal } : {}) }), signal);
      signal?.throwIfAborted();
      return Response.json(out);
    }
    if (!q.openrouter) throw new Error("no OpenRouter body for this recording");
    const r = await orFetchPath(c.env, "audio/transcriptions", q.openrouter({ model: s.model, provider: s.provider }), c.meta, c.request?.headers || {}, signal, c.fetchImpl || undefined);
    const { json: j, response } = await hold(r, 8 << 20);   // bounded: a remote answer is never read whole
    if (!r.ok || !j || j.error) throw fail(s.model, r.status, JSON.stringify(j?.error || j || {}));
    return response;
  },
  async transcribe_live(c, s) {
    if (s.source === "SELF") throw new Error(`${s.model} takes live audio in chunks, not through a socket`);
    const spec = liveProviderRequest(c.env, s.model), controller = new AbortController();
    c.signal?.throwIfAborted();
    // The fetch signal stays tied to the upgraded WebSocket, so only the connection attempt is timed (a timer cleared on upgrade).
    const timer = setTimeout(() => controller.abort(), 15000);
    let r; try { r = await (c.fetchImpl || fetch)(spec.url, { headers: spec.headers, signal: controller.signal }); } finally { clearTimeout(timer); }
    if (r.status !== 101 || !r.webSocket) { try { r.webSocket?.close(); } catch {} throw new Error("upgrade"); }
    return r;
  },
  // Speaker labels (who spoke when) from the 1Helm container: audio in the call, or a live session whose chunks the container holds.
  async diarize(c, s) {
    if (s.source !== "SELF") throw new Error(`${s.model} cannot label speakers here.`);
    const q = c.request || {}, signal = c.signal;
    const r = await abortable(q.session ? speechFn("selfSessionDiarize")(c.env, q.session, s.model, c.meta) : speechFn("selfDiarize")(c.env, s.model, q, c.meta), signal);
    return Response.json({ model: s.model, turns: r.turns, usage: r.usage });
  },
  // The request sorter's own endpoint on OpenRouter (Perplexity's decider, Jev): { model, provider, state, questions } -> { answers, usage, model }.
  async decide_systemone(c, s) {
    return okOrThrow(await orFetchPath(c.env, "systemone", { model: s.model, provider: s.provider, state: c.request.state, questions: c.request.questions }, { kind: "decider", ...c.meta }, {}, c.signal, c.fetchImpl || globalThis.fetch), `systemone ${s.model}`);
  },
  async decide_clef(c, s) {
    const facts = c.settings?.catalog?.[s.model];
    await authorizeCloudflare(c.env, s.model, c.meta, facts);
    return Response.json(await abortable(c.env.AI.run(s.model, { model: String(s.model).split("/").pop(), state: c.request.state, questions: c.request.questions }, aiOpts(c.env, c.meta)), c.signal));
  },
  // Moondream on Workers AI: { task, image, ... } in, { answer, caption, points } out.
  async look(c, s) {
    const { max_tokens, ...b } = c.request || {};
    await authorizeCloudflare(c.env, s.model, c.meta, c.settings?.catalog?.[s.model]);
    const out = await abortable(c.env.AI.run(s.model, { ...b, stream: false, ...(b.task === "query" && Number.isFinite(s.maxOutput) ? { max_tokens: s.maxOutput } : {}) }, aiOpts(c.env, c.meta)), c.signal);
    return Response.json(out);
  },
  // Web search through the AI Gateway. The saved model is "cloudflare/<provider>".
  async search(c, s) {
    const m = /^cloudflare\/([a-z0-9-]+)$/i.exec(s.model);
    if (!m) throw new Error(`Web search provider "${s.model}" is not served by the dispatcher.`);
    if (!c.env.AI?.websearch || !c.env.AIG_ID) throw new Error("Cloudflare web search is not available.");
    const r = await abortable(c.env.AI.websearch({ gatewayId: c.env.AIG_ID, query: c.request.query, provider: m[1], limit: Math.min(...[c.request.limit ?? c.request.count, s.results].filter(Number.isFinite)) }), c.signal);
    if (!r?.ok) throw fail("cloudflare search", r?.status, "");
    return r;
  },
};
ADAPTERS.decide_json = ADAPTERS.chat;

// What answered, for the "Last served" column. A Cloudflare model is recorded as the requested ID with provider "cloudflare". An OpenRouter answer carries
// the served model and provider in its JSON ("model" and "provider"; a chat stream carries them in its first event, which firstOk reads). When the answer
// names none, nothing is recorded as served: the requested ID is never copied in its place.
const cloudflareServed = (model) => isCloudflareModel(model) ? { model, provider: "cloudflare" } : null;
// A plain answer (not a stream or a socket) is read once, bounded, to see which model and provider named themselves. → { response, served }.
async function servedOf(r, step) {
  if (step.source === "CF") return { response: r, served: { model: step.model, provider: "cloudflare" } };
  if (step.source === "SELF") return { response: r, served: { model: step.model, provider: "1helm-container" } };
  if (!r || typeof r.clone !== "function" || r.webSocket || r.status === 101 || /event-stream/i.test(r.headers?.get?.("content-type") || "")) return { response: r, served: null };
  try {
    const { json: j, response } = await hold(r, 16 << 20);
    return { response, served: j && (typeof j.model === "string" || typeof j.provider === "string") ? { model: typeof j.model === "string" ? j.model : null, provider: typeof j.provider === "string" ? j.provider : null } : null };
  } catch { return { response: r, served: null }; }
}

export async function dispatch(env, jobId, request = {}, { meta = {}, signal = null, level = null, session = null, model = null, fetch: fetchImpl = null, route = null, jsonLevels = null } = {}) {
  env = await modelSettingsEnv(env);
  // Own AI key: the person's own endpoint answers every chat call, whatever the saved settings say. It needs no plan (and its env carries no copy of the settings).
  // A task's route is checked by routedChat first (a task that began on managed models stops when the mode changed to an own key).
  if (env.BYOK && Array.isArray(request?.messages) && !route?.taskAffinity) {
    return byokChat(env.BYOK, request, { fast: route ? byokFast(route, request) : true, signal, privacy: level ?? await privacyOf(env, meta?.tenant) });
  }
  // The main chat: a route (a running task's profile, or the routing policy) says which models to try, in which order; each attempt reads its limits from its saved job.
  if (route) {
    const asked = () => route.served || route.model || route.primary || route.taskProfile?.requestedModel || "";
    // Each routing category keeps its own last-served row: "chat:<category id>" (the category the turn was routed to, General when it names none).
    const servedJob = servedJobOf(jobId, route);
    try {
      const r = await routedChat(env, request, session, route, { ...meta, job: jobId }, signal, fetchImpl || globalThis.fetch);
      noteServed(env, { job: servedJob, requested: asked(), served: cloudflareServed(route.served || route.taskProfile?.requestedModel) || r?.served || null, ok: true });
      return r;
    } catch (e) { if (!signal?.aborted) noteServed(env, { job: servedJob, requested: asked(), ok: false, error: e?.message }); throw e; }
  }
  const settings = env.MODEL_SETTINGS, lvl = level ?? await privacyOf(env, meta?.tenant);
  const p = plan(settings, jobId, { level: lvl });
  const steps = model ? p.steps.filter((s) => s.model === model) : p.steps;
  if (!steps.length) throw Object.assign(new Error(model ? `"${model}" is not an allowed model of "${jobId}" at privacy level ${p.level}. Nothing was sent.` : `No model of "${jobId}" can run at privacy level ${p.level}. Nothing was sent.`), { privacyBlocked: true });
  // Metadata keys that start with "_" are internal: they never leave the Worker.
  const ctx = { env, settings, jobId, request, session, signal, level: p.level, fetchImpl, jsonLevels, meta: { ...meta, job: jobId, _privacy: p.level } };
  const errors = [], failures = []; let last;
  // The job's saved timeout (limits.js, `timeout_ms`; null means none) is for one attempt: each step starts a fresh timer. The live dictation socket
  // only times its connect, so it keeps its own timer.
  const timeoutMs = jobTimeoutMs(settings, jobId);
  for (const step of steps) {
    try {
      let r = await ADAPTERS[step.adapter](timeoutMs && step.adapter !== "transcribe_live" ? { ...ctx, signal: withTimeout(signal, timeoutMs) } : ctx, step);
      let served = r?.served || null;
      if (!served) ({ response: r, served } = await servedOf(r, step));
      if (r && typeof r === "object") { try { r.requested = step.model; r.effort = step.effort; } catch {} }   // for callers that record which step answered
      noteServed(env, { job: jobId, requested: step.model, served: step.source === "CF" ? cloudflareServed(step.model) || { model: step.model, provider: "cloudflare" } : served, ok: true, failed: failures[0] || null });
      return r;
    } catch (e) {
      if (signal?.aborted) throw e;
      // A failed step is written only when it was the last one tried; when a later step answers, that write carries the failure (noteServed's `failed`).
      if (step === steps[steps.length - 1]) noteServed(env, { job: jobId, requested: step.model, ok: false, error: e?.message });
      failures.push({ model: step.model, error: String(e?.message || e) });
      last = e; errors.push(`${step.model}: ${String(e?.message || e).slice(0, 160)}`);
      console.log("dispatch: step failed", jobId, step.model, String(e?.message || e).slice(0, 160));
    }
  }
  throw Object.assign(last instanceof Error ? last : new Error(String(last)), { errors });
}
