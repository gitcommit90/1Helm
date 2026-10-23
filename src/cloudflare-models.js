// Native Workers AI discovery and transport. IDs never become provider URLs.
import { cappedResponseJson } from "./bounded-response.js";
import { aigMeta } from "./aig-meta.js";
import { normalizePrivacy, privacyOf, PrivacyBlocked, ENDPOINTS, endpointOk } from "./privacy.js";
export const isCloudflareModel = (id) => typeof id === "string" && /^@(cf|hf)\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id);
const CF_JSON_BYTES = 8 * 1024 * 1024;   // the most one non streamed model answer may hold
export const CF_PRIVACY_SOURCE = "https://developers.cloudflare.com/workers-ai/platform/data-usage/";
// The published policy promises no training. It does not explicitly promise
// zero retention. Partner-hosted models need their own policy evidence.
export function cloudflareLevels(model, properties = {}) {
  const verified = ENDPOINTS.transcription?.[model]?.["cloudflare-workers-ai"];
  if (verified) return ["unrestricted", "no_training", "zdr"].filter(l => endpointOk(verified, l));
  return properties.partner === "true" || properties.partner === true ? [] : ["unrestricted", "no_training"];
}
// Every deployment runs the saved model settings the same way: an OpenRouter ID goes to OpenRouter and an @cf/ ID to Workers AI.
const propsOf = m => Object.fromEntries((m.properties || []).map(p => { let value = p.value; if (typeof value === "string" && /^[{[]/.test(value)) { try { value = JSON.parse(value); } catch {} } return [p.property_id, value]; }));
const yes = p => p === true || p === "true";
export function assessCloudflareModels(models) {
  return models.filter(m => isCloudflareModel(m.name)).map(m => {
    const p = propsOf(m), prices = Array.isArray(p.price) ? p.price : [], cost = unit => Number(prices.find(x => x.unit === unit)?.price), task = m.task?.name;
    const prompt = cost("per M input tokens"), completion = cost("per M output tokens"), levels = cloudflareLevels(m.name, p);
    const context = Number(p.context_window) || 0, tools = yes(p.function_calling), vision = yes(p.vision), speech = task === "Automatic Speech Recognition" && /\/whisper-large-v3-turbo$/.test(m.name);
    const embedding = task === "Text Embeddings", rerank = task === "Text Classification" && /reranker/.test(m.name), decision = /^@cf\/cloudflare\/clef(?:-flash)?$/.test(m.name);
    const chat = task === "Text Generation" && !decision && tools && context > 0 && Number.isFinite(prompt) && Number.isFinite(completion) && prompt <= 3 && completion <= 15;
    const kinds = decision ? ["workers_decider", "decider"] : [...(chat ? ["chat", "chore", "workers_ai", ...(vision ? ["vision"] : [])] : []), ...(speech ? ["speech", "speech_cloudflare"] : []), ...(rerank ? ["rerank_memory"] : []), ...(embedding ? ["embedding_files", "embedding_memory"] : [])];
    const reasons = []; if (!kinds.length) reasons.push("No supported request adapter with verified capabilities"); if (!levels.length) reasons.push("Partner data policy has not been verified");
    return { id: m.name, name: m.name, source: "CF", kinds, eligible: !reasons.length, reasons, efforts: ["default"], default_effort: "default", levels, hosts: ["cloudflare"], context_length: context || 8192,
      max_output: Math.min(Number(p.max_output_tokens) || 4096, context || 8192), input_modalities: ["text", ...(vision ? ["image", "video"] : [])],
      pricing: { prompt: Number.isFinite(prompt) ? prompt : 0, completion: Number.isFinite(completion) ? completion : 0 },
      json: chat && yes(p.json_mode), tool_choice: chat ? ["auto"] : [], privacy_source: CF_PRIVACY_SOURCE,
      ...(speech ? { formats: ["wav", "mp3", "webm", "ogg", "m4a", "mp4", "flac"], sec_nano: Math.ceil((cost("per audio minute") || 0.000513) * 1e9 / 60) } : {}),
      ...(embedding || rerank ? { in_nano: Number.isFinite(prompt) ? prompt * 1000 : 240 } : {}) };
  });
}
export async function cloudflareCatalog(env, q = "") {
  if (!env?.AI?.models) throw Object.assign(new Error("Cloudflare model discovery is unavailable."), { status: 503 });
  const rows = [], seen = new Set();
  for (let page = 1; page <= 12; page++) {
    const result = await env.AI.models({ page, per_page: 100, ...(q.trim() ? { search: q.trim() } : {}) });
    const batch = Array.isArray(result) ? result : result?.result;
    if (!Array.isArray(batch)) throw new Error("Cloudflare model catalog returned an invalid response.");
    let added = 0; for (const row of batch) if (!seen.has(row.name)) { rows.push(row); seen.add(row.name); added++; }
    if (!added || !batch.length) break;
  }
  return assessCloudflareModels(rows);
}
export async function authorizeCloudflare(env, model, meta = {}, catalog = null) {
  if (!isCloudflareModel(model) || !env?.AI?.run) throw new Error("Cloudflare Workers AI is unavailable.");
  const level = normalizePrivacy(meta._privacy ?? await privacyOf(env, meta.tenant));
  // Catalog facts come only from a server-validated saved snapshot.
  // A saved Cloudflare model runs at every level, as it does today. cloudflarePrivacyNote says what Cloudflare promises where the level asks for more.
  // Only a partner-hosted model (no published no-training promise at all, so no level) stays blocked.
  const levels = catalog?.source === "CF" && Array.isArray(catalog.levels) ? catalog.levels : cloudflareLevels(model);
  if (!levels.length) throw new PrivacyBlocked(`Cloudflare has no verified privacy promise for ${model}.`, { model, level });
  return level;
}
// The text /models shows beside a Cloudflare model the account's level asks more of than Cloudflare promises, or null.
export function cloudflarePrivacyNote(model, level, catalog = null) {
  const levels = catalog?.source === "CF" && Array.isArray(catalog.levels) ? catalog.levels : cloudflareLevels(model);
  if (levels.includes(normalizePrivacy(level))) return null;
  return levels.length ? "Cloudflare promises no training, not zero retention. It runs at this level as it does today." : "Cloudflare has no privacy promise for this model.";
}
export const cfOptions = (env, meta = {}) => ({ ...(env.AIG_ID ? { gateway: { id: env.AIG_ID, collectLog: false, skipCache: true, metadata: aigMeta(env, meta) } } : {}),
  extraHeaders: { "cf-aig-no-wholesale": "true", "cf-aig-collect-log": "false", "cf-aig-collect-log-payload": "false", "cf-aig-skip-cache": "true" } });
export async function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let onAbort;
  const cancelled = new Promise((_, reject) => { onAbort = () => reject(signal.reason || Object.assign(new Error("aborted"), { name: "AbortError" })); signal.addEventListener("abort", onAbort, { once: true }); });
  try { return await Promise.race([promise, cancelled]); } finally { signal.removeEventListener("abort", onAbort); }
}
const usageOf = (usage, catalog) => {
  const prompt_tokens = Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0, completion_tokens = Number(usage?.completion_tokens ?? usage?.output_tokens) || 0;
  return { ...usage, prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens,
    cost: Number(usage?.cost) || ((prompt_tokens * (catalog?.pricing?.prompt || 0) + completion_tokens * (catalog?.pricing?.completion || 0)) / 1e6) };
};
const eventOf = (out, model, catalog, stream = false) => {
  const value = out?.result || out;
  if (value?.error) return value;
  const choices = value?.choices || [{ index: 0, ...(stream ? { delta: { content: value?.response || "", ...(value?.tool_calls ? { tool_calls: value.tool_calls.map((t, i) => t.function ? t : { index: i, id: t.id || `cf-tool-${i}`, type: "function", function: { name: t.name, arguments: typeof t.arguments === "string" ? t.arguments : JSON.stringify(t.arguments || {}) } }) } : {}) } } : { message: { role: "assistant", content: value?.response || "", ...(value?.tool_calls ? { tool_calls: value.tool_calls.map((t, i) => t.function ? t : { index: i, id: t.id || `cf-tool-${i}`, type: "function", function: { name: t.name, arguments: typeof t.arguments === "string" ? t.arguments : JSON.stringify(t.arguments || {}) } }) } : {}) } }), finish_reason: value?.tool_calls?.length ? "tool_calls" : stream ? null : "stop" }];
  return { ...value, model, provider: "Cloudflare", provider_host: "cloudflare", choices, ...(value?.usage ? { usage: usageOf(value.usage, catalog) } : {}) };
};
export async function cloudflareChat(env, payload, meta = {}, signal = null, catalog = null) {
  const model = payload.model; catalog ||= env.MODEL_SETTINGS?.catalog?.[model];
  await authorizeCloudflare(env, model, meta, catalog); signal?.throwIfAborted();
  const { provider, models, model: ignored, session_id, prompt_cache_key, usage, reasoning, ...input } = payload;
  // Workers AI uses its native request shape. No OpenRouter provider or cache fields leave here.
  if (reasoning?.enabled === false) input.chat_template_kwargs = { ...input.chat_template_kwargs, enable_thinking: false };
  else if (reasoning?.effort) input.reasoning_effort = reasoning.effort;
  const response = await abortable(env.AI.run(model, input, { ...cfOptions(env, meta), returnRawResponse: true, ...(signal ? { signal } : {}) }), signal);
  signal?.throwIfAborted();
  if (response instanceof Response && !response.ok) return response;
  if (!payload.stream) {
    const value = response instanceof Response ? await cappedResponseJson(response, CF_JSON_BYTES) : response;
    if (value == null) throw new Error("Cloudflare returned an unreadable or oversized answer.");
    return Response.json(eventOf(value, model, catalog));
  }
  const source = response instanceof Response ? response.body : response;
  if (!source?.getReader) throw new Error("Cloudflare did not return a response stream.");
  const reader = source.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder(); let buffer = "";
  const stream = new ReadableStream({ async pull(c) {
    try {
      signal?.throwIfAborted(); const { value, done } = await abortable(reader.read(), signal);
      if (done) { if (buffer.trim()) emit(buffer, c); c.close(); return; }
      buffer += decoder.decode(value, { stream: true }); let i;
      while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, i).replace(/\r$/, ""); buffer = buffer.slice(i + 1); emit(line, c); }
    } catch (e) { reader.cancel(e).catch(() => {}); c.error(e); }
  }, cancel(reason) { return reader.cancel(reason); } });
  function emit(line, c) { if (!line.startsWith("data:")) return; const s = line.slice(5).trim(); if (!s) return; if (s === "[DONE]") { c.enqueue(encoder.encode("data: [DONE]\n\n")); return; }
    let value; try { value = JSON.parse(s); } catch { throw new Error("Cloudflare returned an invalid stream event."); }
    c.enqueue(encoder.encode(`data: ${JSON.stringify(eventOf(value, model, catalog, true))}\n\n`)); }
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
// Workers AI reranker: { query, contexts: [{ text }], top_k? } in, { response: [{ id (the index of the context), score }] } out, best first, with the usage like an embedding answer.
export async function cloudflareRerank(env, model, { query, contexts, top_k }, meta = {}, signal = null) {
  const catalog = env.MODEL_SETTINGS?.catalog?.[model]; await authorizeCloudflare(env, model, meta, catalog);
  const out = await abortable(env.AI.run(model, { query, contexts, ...(top_k ? { top_k } : {}) }, cfOptions(env, meta)), signal), rows = out?.response;
  if (!Array.isArray(rows) || rows.some((r) => !Number.isInteger(r?.id) || r.id < 0 || r.id >= contexts.length || !Number.isFinite(r?.score))) throw new Error("Cloudflare returned an invalid ranking.");
  return { model, response: rows.map((r) => ({ id: r.id, score: r.score })).sort((a, b) => b.score - a.score), usage: usageOf(out.usage, catalog) };
}
export async function cloudflareEmbeddings(env, model, texts, meta = {}) {
  const catalog = env.MODEL_SETTINGS?.catalog?.[model]; await authorizeCloudflare(env, model, meta, catalog);
  const out = await env.AI.run(model, { text: texts }, cfOptions(env, meta)), vectors = out?.data;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error("Cloudflare returned incomplete embeddings.");
  return { object: "list", model, data: vectors.map((embedding, index) => ({ embedding, index })), usage: usageOf(out.usage, catalog) };
}
