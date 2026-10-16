import { route2On, policyRoute, markServed, choreRouteFor, isHandoff, dispatchOrder } from "./ee/index.js";
import { byokChat } from "./byok.js";
import { privacyOf, enforceRequest, eligibleHosts, PrivacyBlocked, PRIVACY_EXHAUSTED } from "./privacy.js";   // AI data privacy: every dispatch
import { MAX_ATTEMPTS, modelSettingsEnv, readModelSettings, choreRouteOf, jobRoute, jobSetting, entriesOf, configuredHosts, quirkOf, effortBody, effortFor, reasoningMandatory } from "./ee/index.js";
import { testModelFor, testPayload, testHostsOf, testEffortOf } from "./internal-test-model.js";   // dev test workspaces: every call on TEST_MODEL
import { boundedText } from "./bounded-body.js";
import { authorizeTaskProfile, TaskAffinityBlocked, backgroundRole } from "./ee/index.js";
import { cloudflareChat, cloudflareEmbeddings, isCloudflareModel, dynamicProvidersOn } from "./cloudflare-models.js";
export { effortBody, effortFor, reasoningMandatory };
// Model provider. ROUTER_MODE="two" (dev and live): the main chat follows the routing policy (route2.js decides a task category,
// pool.js maps category × AI data privacy level to models with fixed efforts, twoChat below builds every attempt). Classic mode
// (router.js / Jev Router) is kept behind ROUTER_MODE="classic". Every OpenRouter chat request passes orFetch, which validates it against
// the account's AI data privacy level (privacy.js enforceRequest). Per-call usage.cost for billing; sticky session for prompt caching.
// The Workers AI model (the saved setting of the job "workers_ai_chat") is used only when OpenRouter itself can't be reached.
// Every model named here is read from the saved settings (model-jobs.js); no model is named in this file.
export const OR_MAX_OUT = 8000;                         // reasoning tokens count toward max_tokens on OpenRouter
// Per-step output cap on the main chat (managed pool / the dev test model). Captain 10-10: raise the default from 16,384 to 50,000.
// Reasoning tokens count toward this ceiling; env STEP_MAX_TOKENS overrides it (1024–128000). Chores keep their own smaller caps.
// The streaming reader (repeat-guard.js) also stops a step that starts repeating itself long before this.
export const STEP_MAX_OUT = 50000;
export const stepMaxOut = (env) => { const n = Math.round(Number(env?.STEP_MAX_TOKENS)); return n >= 1024 ? Math.min(n, 128000) : STEP_MAX_OUT; };
// Price ceiling (Captain, 2026-10-01): Jev may pick any model up to $3 in / $15 out per million tokens. Keeps the Sonnet 5.5 /
// gpt-6.1-sol step-up, blocks gpt-6-astra and Opus. OpenRouter enforces it (no endpoint above it is used).
export const OR_MAX_PRICE = { prompt: 3, completion: 15 };
// The price ceiling sent to OpenRouter for one model. The $3 / $15 default stays, but a model whose published price (dollars per million tokens,
// from its catalog record) is higher is not blocked by it: its own price, rounded up, becomes the ceiling (Captain 2026-10-16).
export const maxPriceFor = (catalog) => { const up = (v, d) => Number.isFinite(v) && v > d ? Math.ceil(v * 1e4) / 1e4 : d; return { prompt: up(catalog?.pricing?.prompt, OR_MAX_PRICE.prompt), completion: up(catalog?.pricing?.completion, OR_MAX_PRICE.completion) }; };
export const OR_RESERVE_PRICE = { in: 3000, out: 15000 }; // nano$/token = the ceiling, reservations only; settle charges usage.cost
export const useOpenRouter = (env) => !!env.BYOK || (!!env.OPENROUTER_API_KEY && env.MODEL_PROVIDER !== "workers-ai");
// Own AI key (byok.js): env.BYOK is set on a BYOK account's env (byokEnv). Every call below then goes to the person's endpoint, never
// to OpenRouter or Workers AI. Main-chat calls (no route, or a two-mode route) use their main model; chores (any other route: labels,
// summaries, the browser agent's planner; and hand-off notes inside a two-mode turn) use their fast model.
export const byokFast = (route, body) => route?.two ? !!choreRouteFor(route, body) : !!route;

// Some models can't turn reasoning off: OpenRouter rejects reasoning.enabled=false for them ("reasoning is mandatory"), so "none" is sent
// as "low" there. Every call builds its reasoning field with effortBody (model-jobs.js), per model, from the model's saved facts.
// signal (optional): the person's Stop aborts the call mid-flight (the fetch and its streamed body).
// The background job a call belongs to (model-jobs.js), from the route's marker or the call's kind; null for the main chat.
export function jobOfCall(route, meta, body) {
  const kind = meta?.kind || "";
  return route?.job || backgroundRole(kind) || (kind === "card-label" ? "label" : kind === "sidecar-card" ? "sidecar_card"
    : kind.startsWith("live-notes-") ? "notes" : isHandoff(route, body) ? "handoff" : null);
}
export async function openRouterChat(env, body, session, route = null, meta = {}, signal = null) {
  env = await modelSettingsEnv(env);   // the saved model settings for this call (own-key accounts use their own endpoint instead)
  // A task's identity takes precedence over defaults, test overrides and legacy
  // fallback chains. Authorization is fresh even though model settings are frozen.
  if (route?.taskAffinity) return taskChat(env, body, route, meta, signal);
  if (env.BYOK) {
    const saved = body?.response_format?.type === "json_schema" ? await readModelSettings(env).then((r) => r.config, () => null) : null;
    return byokChat(env.BYOK, body, { fast: byokFast(route, body), signal, privacy: await privacyOf(env, meta?.tenant), noTemperature: (m) => quirkOf(saved, m, "no_temperature") });
  }
  const jobId = jobOfCall(route, meta, body);
  // Dev test workspace (test-model.js): one call on the test model, whatever the route says. No pool models, no fallback list.
  const tm = await testModelFor(env, meta?.tenant);
  if (tm) return testChat(env, body, session, jobId && route?.job && !route.model ? choreRouteOf(env.MODEL_SETTINGS, jobId) : route, meta, signal, tm);
  if (jobId) {
    // A background job runs the model, reasoning level and fallbacks saved for it, one model at a time, nothing else. The caller's own
    // reasoning field and model list never apply.
    const chore = choreRouteOf(env.MODEL_SETTINGS, jobId), { models, reasoning, ...rest } = body;
    // Models that can't do JSON mode (such as the one on Bedrock) get the request without a response format.
    const single = !chore.json && rest.response_format && rest.response_format.type !== "json_schema" ? (({ response_format, ...r }) => r)(rest) : rest;
    return twoChat(env, single, session, chore, meta, signal);
  }
  // Routing policy (route2.js, ROUTER_MODE=two): the category's list at the current privacy level.
  if (route2On(env) && (route?.two || route?.chore || !route)) return twoChat(env, body, session, route || policyRoute(env.MODEL_SETTINGS, "general", "zdr", "default"), meta, signal);
  // Older single-router mode: the saved "classic_router" job (a router model, then its fallbacks).
  const [main, ...rest] = entriesOf(jobSetting(env.MODEL_SETTINGS, "classic_router")), classicModel = main.model, classicFallbacks = rest.map((e) => e.model);
  const sets = env.MODEL_SETTINGS;
  // The `models` list shares the request's one reasoning field, so a fallback that needs its own effort (an object
  // {model, host, effort}, or a model that can't turn reasoning off when this call turns reasoning off) is tried on its own after the request fails.
  const fbs = (route?.fallbacks || []).map((f) => typeof f === "string" ? { model: f } : f);
  const inList = (f) => Object.keys(f).length === 1 && effortFor(route.effort, f.model, sets) === route.effort;
  const solo = fbs.filter((f) => !inList(f)), base = { usage: { include: true }, ...(session ? { session_id: String(session).slice(0, 256) } : {}) };
  const send = (p) => orFetch(env, { ...p, ...base, ...body, provider: { ...body.provider, ...p.provider } }, meta, { "x-openrouter-metadata": "enabled" }, signal);
  const fail = async (r) => { const t = await boundedText(r, 64 * 1024).catch(() => ""); return Object.assign(new Error(`openrouter ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); };
  let r = await send({ ...(route ? { model: route.model, models: [...fbs.filter(inList).map((f) => f.model), ...classicFallbacks].filter((m, i, a) => m !== route.model && a.indexOf(m) === i).slice(0, 3), ...effortBody(route.effort, route.model, sets) }
        : { model: classicModel, models: classicFallbacks }), provider: { zdr: true, max_price: OR_MAX_PRICE, ...(route?.host ? { order: [route.host].flat() } : {}) } });
  for (const f of solo) {
    if (r.ok) break;
    console.log("openrouter: trying fallback", f.model, r.status); await r.body?.cancel?.().catch(() => {});
    r = await send({ model: f.model, ...effortBody(f.effort ?? route.effort, f.model, sets), provider: { zdr: true, max_price: OR_MAX_PRICE, ...(f.host ? { order: [f.host].flat() } : {}) } });
  }
  if (!r.ok) throw await fail(r);
  return r;
}

// The shared privacy validator adds an order listing every eligible host. Drop it: that list says nothing about the host that is
// already warm. When the task has a recorded preferredHost (the host that served an earlier call, from the response itself) that
// is still eligible, send it as the only order entry. OpenRouter then tries the warm host first, and the provider cache for the
// task's long prefix keeps hitting, while the allowlist and allow_fallbacks still let it move to another eligible host on an outage.
const taskStickyPayload = (payload, preferredHost = null) => {
  const { order, ...provider } = payload.provider;
  if (typeof preferredHost === "string" && Array.isArray(provider.only) && provider.only.includes(preferredHost)) provider.order = [preferredHost];
  return { ...payload, provider };
};
export function taskPayload(profile, body, { hosts, level, settings = null } = {}) {
  const { reasoning, provider, models, model, session_id, prompt_cache_key, ...rest } = body || {};
  if (quirkOf(settings, profile.requestedModel, "auto_tool_choice_only") && rest.tool_choice != null && rest.tool_choice !== "auto")
    throw new TaskAffinityBlocked("This task's model supports only automatic tool selection. No different model was substituted.", "unsupported-tool-choice");
  const p = { ...rest, messages: replayFor(rest.messages, profile.requestedModel), model: profile.requestedModel,
    max_tokens: Math.min(Number(rest.max_tokens) || profile.maxOutput, profile.maxOutput), ...effortBody(profile.effort, profile.requestedModel, settings),
    provider: { only: hosts || profile.hosts, allow_fallbacks: true, require_parameters: true, max_price: maxPriceFor(profile.catalog) },
    usage: { include: true }, session_id: cacheKey(profile.cacheSession), prompt_cache_key: cacheKey(profile.cacheSession) };
  return taskStickyPayload(level ? enforceRequest(p, level) : p, profile.preferredHost);
}
async function taskChat(env, body, route, meta, signal) {
  const original = route.taskProfile, chain = Array.isArray(original.poolChain) && original.poolChain.length ? original.poolChain : [original];
  let last;
  for (let index = 0; index < chain.length; index++) {
    const profile = { ...original, ...chain[index], poolChain: undefined };
    // Every model owns its snapshot, effort, limits and opaque reasoning replay.
    // Provider fallback happens inside one OR request before advancing here.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const auth = await authorizeTaskProfile(env, profile, meta?.tenant, body);
        const frozenSettings = { ...env.MODEL_SETTINGS, catalog: { ...env.MODEL_SETTINGS?.catalog, [profile.requestedModel]: profile.catalog } };
        const payload = taskPayload(profile, body, { ...auth, level: isCloudflareModel(profile.requestedModel) ? null : auth.level, settings: frozenSettings });
        const r = isCloudflareModel(profile.requestedModel)
          ? await cloudflareChat(env, payload, { ...meta, _privacy: auth.level }, signal, profile.catalog)
          : await orFetch(env, payload, { ...meta, _taskAffinity: true, _privacy: auth.level, _preferredHost: profile.preferredHost || null }, { "x-openrouter-metadata": "enabled" }, signal);
        if (!r.ok) {
          const status = r.status, detail = await boundedText(r, 64 * 1024).catch(() => "");
          if ([400,415,422].includes(status) && /image|vision|multimodal|image_url|unsupported.{0,30}(content|media)/i.test(detail)
              && body.messages?.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==="image_url")))
            throw Object.assign(new Error("The selected model rejected image input."), { status, orStatus: status, imageInputRejected: true, detail: detail.slice(0,1000) });
          if (/context.{0,40}(length|window|limit)|maximum.{0,30}token|too many tokens/i.test(detail))
            throw Object.assign(new Error("The task model rejected the request because its context window is full."), { orStatus: status, contextOverflow: true });
          throw Object.assign(new Error(`Task model unavailable (${status}).`), { orStatus: status });
        }
        const out = await firstOk(r, !!body.stream);
        route.served = profile.requestedModel; route.effort = profile.effort;
        // Runtime persists which fallback served without replacing the frozen chain.
        route.servedProfile = profile;
        return out;
      } catch (e) {
        last = e;
        if (signal?.aborted || e.contextOverflow || e.imageInputRejected || e.reason === "credential-mode-changed" || e.reason === "invalid-profile" || e.reason === "unsupported-image" || /context|maximum.*token|token.*limit/i.test(String(e.message))) throw e;
        const transient = e.orStatus === 429 || e.orStatus >= 500 || e instanceof TypeError;
        if (attempt === 0 && transient) continue;
        // Legacy task profiles keep their established single-model behavior.
        if (chain.length === 1 && (e.privacy || e.taskAffinity)) throw e;
        break;
      }
    }
  }
  if (last?.privacy) throw last;
  throw Object.assign(new TaskAffinityBlocked("The configured task models are unavailable right now. Retry shortly; your conversation is saved.", "model-unavailable"), { orStatus: last?.orStatus || 503 });
}

// Test model (test-model.js): main chat capped per step like two mode (stepMaxOut). orFetch rewrites the payload (model, hosts, ZDR, reasoning effort
// TEST_MODEL_EFFORT); a 200 carrying an error throws so the caller's retry runs.
async function testChat(env, body, session, route, meta, signal, model) {
  const chore = route?.chore ? route : route?.two ? choreRouteFor(route, body, env) : null, main = !!route?.two && !chore;
  const b = { ...body, messages: replayFor(body.messages, model), ...(main ? { max_tokens: stepMaxOut(env) } : {}) };
  // A chore whose OWN model is the test model with reasoning off (route2.js CHORE_MODELS haiku: the Live notes note-taker) keeps it
  // off: the test model changes nothing for it, so dev runs it exactly as prod will (TEST_MODEL_EFFORT is for every other call).
  const keepOff = !!chore && chore.model === model && chore.effort === "none";
  const r = await orFetch(env, { model, ...effortBody(chore ? chore.effort : route?.effort, model, env.MODEL_SETTINGS), usage: { include: true },
    ...(session ? { session_id: String(session).slice(0, 256), prompt_cache_key: cacheKey(session) } : {}), ...b }, keepOff ? { ...meta, _reasoningOff: true } : meta, { "x-openrouter-metadata": "enabled" }, signal);
  if (!r.ok) { const t = await boundedText(r, 64 * 1024).catch(() => ""); throw Object.assign(new Error(`openrouter ${model} ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); }
  const out = await firstOk(r, !!body.stream);
  if (route?.two && !route.chore) route.served = model;   // per-turn route object only (chore/label routes are shared constants)
  return out;
}

// Two mode (the main chat's routing policy, route2.js): one model per attempt, no OpenRouter `models` list (so nothing outside
// the dispatch order can answer). Order: route2.js dispatchOrder (recovery model, then the category's saved list at the account's CURRENT
// privacy level, re-read here on every dispatch; ineligible models skipped). Each attempt is built here, last, so nothing upstream can
// change it: the reasoning level saved for that model in that list (never the route's,
// the caller's, a retry's or the source model's), provider = the model's eligible endpoints at that level (privacy.js; OpenRouter moves
// between them inside the request on an upstream 429/outage: the bounded same-model endpoint retry), require_parameters so no endpoint
// may silently drop the reasoning setting, the $3/$15 ceiling, and the per-step output cap (stepMaxOut: a spend ceiling, not an effort
// selector). orFetch then validates the request against the level again (enforceRequest). Hand-off notes (choreRouteFor) go to their
// chore model instead. Primary fails (any error) → the next model; all fail → the last error; nothing eligible → PRIVACY_EXHAUSTED.
// Waits (ms) before asking a rate-limited first model again, for models whose saved facts say so (rate_limit_waits); env.RATE_LIMIT_WAITS
// ("2000,5000,10000") overrides (tests: "1,1,1").
export const RATE_LIMIT_WAITS = [2000, 5000, 10000];
const rateLimitWaits = (env) => env?.RATE_LIMIT_WAITS != null ? String(env.RATE_LIMIT_WAITS).split(",").map(Number).filter((n) => n >= 0) : RATE_LIMIT_WAITS;
const sleep = (ms, signal) => new Promise((ok, no) => { const t = setTimeout(ok, ms); signal?.addEventListener?.("abort", () => { clearTimeout(t); no(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true }); });
// Opaque reasoning (OpenRouter reasoning_details, e.g. Meta's encrypted blocks) is replayed only to the model that produced it
// (Resident keeps it on its assistant messages as reasoning_details + _rmodel); every other model gets the messages without it.
// Never read or shown. _rmodel never leaves 1Helm.
export function replayFor(messages, model) {
  if (!Array.isArray(messages) || !messages.some((m) => m && m._rmodel)) return messages;   // only tagged messages are decided here (idempotent)
  return messages.map((m) => { if (!m || !m._rmodel) return m; const { reasoning_details, _rmodel, ...rest } = m; return reasoning_details && _rmodel === model ? { ...rest, reasoning_details } : rest; });
}
// One pool attempt's exact request (exported for the wire tests and the ops route preview).
export function poolPayload(env, model, level, body, session, prov = null, effort = null) {
  const hosts = configuredHosts(env.MODEL_SETTINGS, model, level), meta = env.MODEL_SETTINGS?.catalog?.[model];
  const { reasoning, provider, models, model: _m, ...b } = body || {};   // a caller's/router's effort or provider never reaches the wire
  if (quirkOf(env.MODEL_SETTINGS, model, "auto_tool_choice_only") && b.tool_choice != null && b.tool_choice !== "auto") throw new PrivacyBlocked(`${model} accepts only tool_choice auto`, { model });
  return { ...b, ...(meta?.max_output && meta?.context_length ? { max_tokens: Math.min(Number(b.max_tokens) || stepMaxOut(env), meta.max_output, Math.max(1, meta.context_length - 1)) } : {}), messages: replayFor(b.messages, model), model, ...effortBody(effort, model, env.MODEL_SETTINGS),
    provider: { order: hosts, only: hosts, allow_fallbacks: true, require_parameters: true, max_price: maxPriceFor(meta) }, usage: { include: true },
    ...(session ? { session_id: String(session).slice(0, 256), prompt_cache_key: cacheKey(session) } : {}) };
}
async function twoChat(env, body, session, route, meta, signal = null) {
  const chore = route.chore ? route : choreRouteFor(route, body, env);
  // host: one provider or a list in order; pin: only those providers. strict: the endpoint must support every parameter sent.
  const one = async (model, effort, host, b, pin = false, strict = false) => {
    const cap = env.MODEL_SETTINGS?.catalog?.[model]?.max_output;
    const dynamic = dynamicProvidersOn(env);
    const r = await orFetch(env, { ...b, ...(cap ? { max_tokens: Math.min(Number(b.max_tokens) || OR_MAX_OUT, cap) } : {}), model, ...effortBody(effort, model, env.MODEL_SETTINGS), provider: { zdr: true, max_price: maxPriceFor(env.MODEL_SETTINGS?.catalog?.[model]), ...(strict ? { require_parameters: true } : {}), ...(host ? { order: [host].flat(), ...(pin && !dynamic ? { only: [host].flat(), allow_fallbacks: false } : {}), ...(dynamic ? { allow_fallbacks: true } : {}) } : {}) }, usage: { include: true },
      ...(session ? { session_id: String(session).slice(0, 256), prompt_cache_key: cacheKey(session) } : {}) }, meta, { "x-openrouter-metadata": "enabled" }, signal);
    if (!r.ok) { const t = await boundedText(r, 64 * 1024).catch(() => ""); throw Object.assign(new Error(`openrouter ${model} ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); }
    return r;
  };
  if (chore) {                                          // a chore: its model, then its own fallbacks one at a time, nothing else
    const order = [{ model: chore.model, effort: chore.effort, host: chore.host, pin: chore.pin, strict: chore.strict ?? chore.runtimeSettings }, ...(chore.fallbacks || []).map((f) => typeof f === "string" ? { model: f, effort: chore.effort } : f)];
    let err;
    for (const o of order) {
      try { const r = await firstOk(await one(o.model, o.effort, o.host, { ...body, messages: replayFor(body.messages, null) }, !!o.pin, !!o.strict), !!body.stream); if (route.two && !route.chore) { route.served = o.model; route.floor = "chore handoff"; route.label = "two/chore handoff"; } return r; }
      catch (e) { if (signal?.aborted) throw e; err = e; console.log("router: chore model failed", o.model, String(e.message).slice(0, 160)); }
    }
    throw err;
  }
  const level = await privacyOf(env, meta?.tenant), prov = meta?._prov ?? null;
  const { attempts: picks, skipped } = dispatchOrder(route, level, { prov, body, settings: env.MODEL_SETTINGS }), order = picks.map((a) => a.model);
  if (skipped.length) console.log("router: skipped", JSON.stringify({ level, category: route.category || null, skipped }));
  if (!order.length) throw new PrivacyBlocked(PRIVACY_EXHAUSTED, { level, category: route.category || null });
  const b = { ...body, max_tokens: stepMaxOut(env) };   // the main chat's per-step output cap
  let err, attempts = 0;
  for (let i = 0; i < order.length && attempts < MAX_ATTEMPTS; i++) {
    // The first model rate-limited (429 on all its endpoints) → wait and ask it again before paying a pricier model for the step (dev 10-07).
    const waits = quirkOf(env.MODEL_SETTINGS, order[i], "rate_limit_waits") && i === 0 ? rateLimitWaits(env) : [];
    for (let k = 0; attempts < MAX_ATTEMPTS; k++) {
      attempts++;
      try {
        const r = await orFetch(env, poolPayload(env, order[i], level, b, session, prov, picks[i].effort), { ...meta, _privacy: level, _prov: prov }, { "x-openrouter-metadata": "enabled" }, signal);
        if (!r.ok) { const t = await boundedText(r, 64 * 1024).catch(() => ""); throw Object.assign(new Error(`openrouter ${order[i]} ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); }
        const out = await firstOk(r, !!b.stream); markServed(route, order[i], i > 0, env.MODEL_SETTINGS);
        route.effort = picks[i].effort;
        return out;
      } catch (e) {
        if (signal?.aborted) throw e; err = e; console.log("router: model failed", order[i], String(e.message).slice(0, 160));
        if (k < waits.length && (e.orStatus === 429 || /\b429\b|rate.?limit/i.test(String(e.message)))) { await sleep(waits[k], signal); continue; }
        break;
      }
    }
  }
  throw err;
}

// The cached prefix's fingerprint for the gateway log (metadata "px" = system hash . tools hash, FNV-1a 32-bit). The provider caches
// system + tools as one block: any change in either (10-06 probe: one changed line at the end of the system prompt) makes the whole
// ~25k-token prefix cold. Two calls with different px can't share a cache; same px and 0 cached means the provider side missed.
export function h32(s) { let h = 0x811c9dc5; s = String(s ?? ""); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); }
// The run a call belongs to, as a third part of the same tag (metadata allows only five entries): the task for a chat turn, the
// helper's or workflow's own card for a helper or workflow (they share the parent's session but are separate conversations).
// The classic lane's session_id/prompt_cache_key is account-wide, so e2e/dev/cache-check.mjs groups calls by this instead.
export const runPrint = (tc) => h32(tc?.kind && tc.kind !== "chat" ? `${tc.session || ""}:${tc.turn || ""}` : tc?.session || "");
export const prefixPrint = (messages, tools) => `${h32((messages || []).filter((m) => ["system", "developer"].includes(m?.role)).map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n"))}.${h32(tools ? JSON.stringify(tools) : "")}`;

// Prompt caching: ONE capability for every route (Captain 10-08: 1Helm is model-agnostic, no per-model caching code). Every OpenRouter
// request carries cache breakpoints in OpenRouter's standard form, `cache_control: {type: "ephemeral"}` on content blocks:
//   1. the last tool definition (tools render first, so this caches the tool schemas alone),
//   2. the end of the system prompt (tools + system),
//   and on a session's tool-loop calls (session_id + tools: the main chat's steps) two more on messages:
//   3. the last message before the newest user message: the stable history, so the next turn reuses it (the newest user message
//      carries the per-turn lines: time, location, memory recall, other tasks, and is rewritten in later turns),
//   4. the last message: the moving breakpoint, so each step reads everything the step before it wrote.
// At most 4 (Anthropic's limit). Chores (no session, or no tools) get only 1–2: a one-shot call would pay the write premium on
// messages nobody reads again. Layout rule for callers: stable prefix first, volatile per-turn lines last (after breakpoint 3).
// Checked 10-08 (probes in local validation evidence, same request marked vs plain):
//   explicit-cache families USE them: Anthropic (claude-haiku-5.5 on Amazon Bedrock: 0 → 51,303 cached on the 2nd step; Bedrock honours
//   breakpoints on system, tools and tool/user messages); Alibaba Qwen first-party and Gemini explicit (OpenRouter docs: same syntax;
//   Gemini uses only the last breakpoint).
//   automatic-cache families IGNORE them, same cached tokens and cost as unmarked: OpenAI on Azure (gpt-6-luna; GPT-5.6+ explicit
//   caching is a different field, prompt_cache_breakpoint), gpt-oss on Cerebras and Bedrock, DeepSeek (Together), Z.AI GLM
//   (Fireworks/Parasail), Qwen 3.8 (ModelRun). No provider rejected the marked shape (content arrays on system/user/tool messages).
// So there is no capability table: the same request goes to every family. Own AI key (byok.js) never gets here (its own endpoint).
// The caller's payload is not changed: marked messages are copies.
export const CACHE_CONTROL = { type: "ephemeral" };
const textOk = (s) => typeof s === "string" && s.trim() !== "";
const markable = (m) => !!m && (textOk(m.content) || (Array.isArray(m.content) && m.content.some((p) => p?.type === "text" && textOk(p.text))));
function markMessage(m) {
  if (typeof m.content === "string") return { ...m, content: [{ type: "text", text: m.content, cache_control: CACHE_CONTROL }] };
  const parts = m.content.slice(), i = parts.findLastIndex((p) => p?.type === "text" && textOk(p.text));
  parts[i] = { ...parts[i], cache_control: CACHE_CONTROL };
  return { ...m, content: parts };
}
export function withCacheBreakpoints(payload) {
  const msgs = payload?.messages; if (!Array.isArray(msgs) || !msgs.length) return payload;
  const out = { ...payload }, m = msgs.slice(), marks = new Set();
  if (Array.isArray(payload.tools) && payload.tools.length) { const t = payload.tools.slice(); t[t.length - 1] = { ...t[t.length - 1], cache_control: CACHE_CONTROL }; out.tools = t; }
  let sys = -1; while (["system", "developer"].includes(m[sys + 1]?.role)) sys++; // stable instruction layers
  if (sys >= 0 && markable(m[sys])) marks.add(sys);
  if (payload.session_id && out.tools) {
    const back = (from, floor) => { for (let i = from; i > floor; i--) if (markable(m[i])) return i; return -1; };
    const lastUser = m.findLastIndex((x) => x?.role === "user");
    let historyEnd = lastUser - 1;
    // v2 puts volatile task data in its own user-data message, before the actual
    // request. Do not pretend that per-turn block is stable conversation history.
    const priorText = m[historyEnd]?.content;
    if (typeof priorText === "string" && priorText.startsWith("[BEGIN TURN CONTEXT]")) historyEnd--;
    const hist = lastUser > sys + 1 ? back(historyEnd, sys) : -1;
    if (hist >= 0) marks.add(hist);
    const tail = back(m.length - 1, Math.max(sys, hist));               // 4. the moving breakpoint
    if (tail >= 0) marks.add(tail);
  }
  for (const i of marks) m[i] = markMessage(m[i]);
  out.messages = m;
  return out;
}
// Cache writes cost up to 1.25× the input price (Anthropic, Qwen, GPT-5.6+ at the 5-minute TTL), reads 0.1–0.5×. Billing uses
// OpenRouter's usage.cost, which already prices both; this multiplier only keeps a reservation at or above what a step can cost.
export const CACHE_WRITE_MULT = 1.25;

// A short, stable prompt-cache key for a session string (FNV-1a 64-bit, hex): no tenant or session ids leave in clear.
export function cacheKey(session) {
  let h = 0xcbf29ce484222325n; for (const ch of new TextEncoder().encode(String(session))) { h ^= BigInt(ch); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return `1h-${h.toString(16).padStart(16, "0")}`;
}

// OpenRouter often reports an upstream 429/outage as HTTP 200 with the error inside the body (first stream event, or the JSON).
// Read up to the first real event: an error before any output throws (so the other model is tried); otherwise the Response is
// rebuilt with the bytes already read in front of the rest of the stream.
export const MODEL_STREAM_PRELUDE_MAX = 1024 * 1024;
export async function firstOk(r, stream) {
  const fail = (e) => Object.assign(new Error(`openrouter: ${String(e?.message || JSON.stringify(e)).slice(0, 200)}`), { orStatus: Number(e?.code) || 502 });
  if (!stream) {
    let raw;
    try { raw = await boundedText(r, 16 * 1024 * 1024); }
    catch (e) { await r.body?.cancel().catch(() => {}); throw e; }
    let j = null; try { j = JSON.parse(raw); } catch {}
    if (j?.error && !j.choices) throw fail(j.error);
    return new Response(raw, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
  const reader = r.body.getReader(), dec = new TextDecoder(), seen = []; let text = "", size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MODEL_STREAM_PRELUDE_MAX) throw Object.assign(new Error("openrouter response prelude exceeds 1 MiB"), { orStatus: 502 });
      seen.push(value); text += dec.decode(value, { stream: true });
      let started = false;
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue; const d = line.slice(5).trim(); if (!d || d === "[DONE]") continue;
        let ev; try { ev = JSON.parse(d); } catch { continue; }     // partial line: wait for more
        if (ev.error) throw fail(ev.error);
        if (ev.choices || ev.usage) { started = true; break; }
      }
      if (started) break;
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  const body = new ReadableStream({ start(c) { for (const v of seen) c.enqueue(v); },
    async pull(c) { const { value, done } = await reader.read(); if (done) c.close(); else c.enqueue(value); }, cancel(x) { return reader.cancel(x); } });
  return new Response(body, { status: r.status, headers: r.headers });
}

// Cloudflare AI Gateway (AIG_ID set): every model call goes through our gateway for per-call logs (cost, status, duration,
// tagged env/tenant/channel/kind) and spend limits. Prompt and reply bodies are NOT stored (cf-aig-collect-log-payload: false), except
// on dev with AIG_LOG_PAYLOADS="1" (wrangler.dev.jsonc only), where the gateway keeps them for debugging (aigPayload).
// OpenRouter: provider-native endpoint, our own OR key passed through; cf-aig-no-wholesale stops any Cloudflare-billed fallback.
// (The gateway itself can't be byok_only: typesafe/jev is a Cloudflare-billed partner model on the AI binding.)
// If the gateway itself fails (unreachable, 5xx/401 from the gateway, not from OpenRouter) the call goes straight to OpenRouter;
// a gateway 429 (spend limit) is returned as-is so limits hold.
export const aigPayload = (env) => env.ENV_NAME === "dev" && env.AIG_LOG_PAYLOADS === "1" ? "true" : "false";
export const aigOn = (env) => !!(env.AIG_ID && env.AIG_TOKEN && env.CF_ACCOUNT_ID);
// Keys starting with "_" (_privacy, _prov) are internal and never sent.
export const aigMeta = (env, meta = {}) => Object.fromEntries(Object.entries({ env: env.ENV_NAME || "live", ...meta })
  .filter(([k, v]) => v != null && v !== "" && !k.startsWith("_")).slice(0, 5).map(([k, v]) => [k, typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 64)]));
// Options for env.AI.run (Workers AI / Clef / Jev): adds the gateway when on, keeps any extraHeaders.
export const aiOpts = (env, meta = {}, opts = {}) => !env.AIG_ID ? opts
  : { ...opts, gateway: { id: env.AIG_ID, collectLog: true, metadata: aigMeta(env, meta) }, extraHeaders: { ...(opts.extraHeaders || {}), "cf-aig-collect-log-payload": aigPayload(env) } };
const OR_API = "https://openrouter.ai/api/v1";
export async function orFetch(env, payload, meta = {}, extraHeaders = {}, signal = null) {
  // Own AI key: a chore (the browser agent's planner) on the fast model. Failures come back as an error body, like OpenRouter's.
  if (env.BYOK) { try { return await byokChat(env.BYOK, payload, { fast: true, signal, privacy: await privacyOf(env, meta?.tenant) }); } catch (e) { if (signal?.aborted) throw e; return new Response(JSON.stringify({ error: { message: e.message } }), { status: 502, headers: { "content-type": "application/json" } }); } }
  if (isCloudflareModel(payload.model)) return cloudflareChat(env, payload, payload.provider?.zdr ? { ...meta, _privacy: "zdr" } : meta, signal);
  // AI data privacy (privacy.js): the one chokepoint for every OpenRouter chat call validates the request against the account's current
  // level (twoChat passes the level it just read; anything else reads it now). Ineligible → PrivacyBlocked, nothing is sent.
  payload = enforceRequest(payload, meta?._privacy ?? await privacyOf(env, meta?.tenant), { prov: meta?._prov ?? null });
  if (meta?._taskAffinity) payload = taskStickyPayload(payload, meta._preferredHost);
  if (payload.messages) payload = { ...payload, messages: replayFor(payload.messages, payload.model) };   // opaque reasoning: only to the model that wrote it
  // Dev test workspace (test-model.js): every OpenRouter chat call goes to the test model (ZDR endpoints: stricter than any level).
  // The privacy check above already ran on the request as the policy built it.
  const tm = meta?._taskAffinity ? null : await testModelFor(env, meta?.tenant);
  if (tm) payload = testPayload(payload, tm, OR_MAX_PRICE, testHostsOf(env), meta?._reasoningOff ? "none" : testEffortOf(env));
  // Background chores historically sent temperature:0, which these endpoints silently ignored. With strict parameter
  // enforcement that now makes otherwise schema-capable endpoints ineligible. Their advertised capabilities
  // (2026-10-11) omit temperature. Apply after test-model rewriting; preserve other models and normal chat.
  const strictChore = /^(?:live-notes-(?:note|final|refine)|ambient-(?:extract|review)|sidecar-card|sidecar-vision-[a-z]+|card-label|browser-(?:oss|jev))$/.test(meta?.kind || "")
    || (meta?.kind === "chat" && payload.response_format?.json_schema?.name === "handoff_notes");
  if (payload.response_format?.type === "json_schema" && strictChore
      && quirkOf(env.MODEL_SETTINGS, payload.model, "no_temperature")) {
    const { temperature, ...supported } = payload; payload = supported;
  }
  if (payload.response_format?.type === "json_schema") payload = { ...payload, provider: { ...payload.provider, require_parameters: true } };
  if (env.PROMPT_CACHE !== "off") payload = withCacheBreakpoints(payload);   // prompt caching, every route (withCacheBreakpoints); PROMPT_CACHE="off" = kill switch
  const body = JSON.stringify(payload);
  return orSend(env, "chat/completions", () => body, meta, extraHeaders, signal);
}
// OpenRouter's other APIs (sidecar.js: /embeddings, /audio/transcriptions), through the same gateway, key and fallback as the chat.
// Not LLM chat, so no test-model rewrite and no cache breakpoints. body: a payload object, or () → { body, length } for a streamed body
// (made again for the direct retry; length is what FixedLengthStream needs). The caller asks for ZDR endpoints (provider.zdr).
export async function orFetchPath(env, path, body, meta = {}, extraHeaders = {}, signal = null) {
  if (typeof body === "object" && isCloudflareModel(body?.model)) {
    if (path === "embeddings") return Response.json(await cloudflareEmbeddings(await modelSettingsEnv(env), body.model, body.input, body.provider?.zdr ? { ...meta, _privacy: "zdr" } : meta));
    throw new Error(`No native Cloudflare adapter supports ${path}.`);
  }
  const make = typeof body === "function" ? body : (() => { const s = JSON.stringify(body); return () => s; })();
  return orSend(env, path, make, meta, extraHeaders, signal);
}
async function orSend(env, path, make, meta, extraHeaders, signal) {
  const headers = { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json", ...(env.APP_HOST ? { "http-referer": `https://${env.APP_HOST}` } : {}), "x-title": "1Helm", ...extraHeaders };
  const bodyOf = () => { const b = make(); return typeof b === "string" || b instanceof Uint8Array || !b?.body ? b : b.body; };
  const streamed = (b) => (typeof ReadableStream === "function" && b instanceof ReadableStream ? { duplex: "half" } : {});   // node's fetch needs it for a stream body
  if (aigOn(env)) {
    try {
      const gb = bodyOf();
      const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AIG_ID}/openrouter/v1/${path}`, { method: "POST", body: gb, ...streamed(gb), ...(signal ? { signal } : {}),
        headers: { ...headers, "cf-aig-authorization": `Bearer ${env.AIG_TOKEN}`, "cf-aig-collect-log-payload": aigPayload(env), "cf-aig-no-wholesale": "true", "cf-aig-metadata": JSON.stringify(aigMeta(env, meta)) } });
      if (r.ok || r.status === 429 || (r.status < 500 && r.status !== 401)) return r;
      const t = await boundedText(r.clone(), 64 * 1024).catch(() => "");
      if (!/AiGatewayError/.test(t)) return r;                       // OpenRouter's own error, passed through
      console.log("ai gateway error, calling openrouter directly", r.status, t.slice(0, 160));
    } catch (e) { if (signal?.aborted) throw e; console.log("ai gateway unreachable, calling openrouter directly", String(e?.message || e).slice(0, 160)); }
  }
  const db = bodyOf();
  return fetch(`${OR_API}/${path}`, { method: "POST", headers, body: db, ...streamed(db), ...(signal ? { signal } : {}) });
}
// Compact "why this model" note from Jev's router metadata (kept on the turn for the Ledger/debug view).
export function jevNote(md) {
  const s = (md?.pipeline || []).find((x) => x?.name === "jev-router")?.data; if (!s) return null;
  const top = (k) => { const p = s.answers?.[k]?.probabilities; return p ? Object.entries(p).sort((a, b) => b[1] - a[1])[0][0] : undefined; };
  return { floor: s.floor, reason: s.reason, task: top("task"), difficulty: top("difficulty"), effort: s.candidates?.[0]?.effort ?? null,
    est_cost: s.candidates?.[0]?.estimated_cost ?? null, failed: s.recent_failed_attempts ?? 0, pool: s.pool_model_count ?? null };
}
