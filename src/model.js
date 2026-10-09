import { route2On, policyRoute, markServed, choreRouteFor, dispatchOrder, LUNA } from "./ee/index.js";
import { byokChat } from "./byok.js";
import { privacyOf, enforceRequest, eligibleHosts, PrivacyBlocked, PRIVACY_EXHAUSTED } from "./privacy.js";   // AI data privacy: every dispatch
import { fixedEffort, MAX_ATTEMPTS, isMuse } from "./ee/index.js";   // the managed pool: one fixed effort per model
import { testModelFor, testPayload, testHostsOf, testEffortOf } from "./internal-test-model.js";   // dev test workspaces: every call on TEST_MODEL
import { boundedText } from "./bounded-body.js";
// Model provider. ROUTER_MODE="two" (dev and live): the main chat follows the routing policy (route2.js decides a task category,
// pool.js maps category × AI data privacy level to models with fixed efforts, twoChat below builds every attempt). Classic mode
// (router.js / Jev Router) is kept behind ROUTER_MODE="classic". Every OpenRouter chat request passes orFetch, which validates it against
// the account's AI data privacy level (privacy.js enforceRequest). Per-call usage.cost for billing; sticky session for prompt caching.
// Workers AI (env.MODEL, glm-5.3-flash) is used only when OpenRouter itself can't be reached (classic mode only).
export const OR_MODEL = "typesafe/jev-router";
export const OR_FALLBACKS = ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"];
export const OR_MAX_OUT = 8000;                         // reasoning tokens count toward max_tokens on OpenRouter
// Per-step output cap on the main chat (Sol / Luna / the dev test model). Captain 10-07, replacing "no caps": one Sol step once wrote
// 65,536 tokens of dates inside one run_command argument ($0.67) before the provider stopped it. 16k leaves room for high-effort
// reasoning plus a long file written in one step; env STEP_MAX_TOKENS overrides it (1024–128000). Chores keep their own smaller caps.
// The streaming reader (repeat-guard.js) also stops a step that starts repeating itself long before this.
export const STEP_MAX_OUT = 16384;
export const stepMaxOut = (env) => { const n = Math.round(Number(env?.STEP_MAX_TOKENS)); return n >= 1024 ? Math.min(n, 128000) : STEP_MAX_OUT; };
// Price ceiling (Captain, 2026-10-01): Jev may pick any model up to $3 in / $15 out per million tokens. Keeps the Sonnet 5.5 /
// gpt-6.1-sol step-up, blocks gpt-6-astra and Opus. OpenRouter enforces it (no endpoint above it is used).
export const OR_MAX_PRICE = { prompt: 3, completion: 15 };
export const OR_RESERVE_PRICE = { in: 3000, out: 15000 }; // nano$/token = the ceiling, reservations only; settle charges usage.cost
export const useOpenRouter = (env) => !!env.BYOK || (!!env.OPENROUTER_API_KEY && env.MODEL_PROVIDER !== "workers-ai");
// Own AI key (byok.js): env.BYOK is set on a BYOK account's env (byokEnv). Every call below then goes to the person's endpoint, never
// to OpenRouter or Workers AI. Main-chat calls (no route, or a two-mode route) use their main model; chores (any other route: labels,
// summaries, the browser agent's planner; and hand-off notes inside a two-mode turn) use their fast model.
export const byokFast = (route, body) => route?.two ? !!choreRouteFor(route, body) : !!route;

// Own router (OWN_ROUTER=on): a decided {model, effort, fallbacks} replaces Jev Router for the call. Same ZDR + price ceiling.
// gpt-oss can't turn reasoning off: OpenRouter rejects reasoning.enabled=false for it ("reasoning is mandatory"), so "none" is
// sent as "low" there. Every call builds its reasoning field here, per model, so no gpt-oss call ever goes out with reasoning off.
export const reasoningMandatory = (m) => /^openai\/gpt-oss/.test(String(m || ""));
export const effortFor = (e, model) => e === "none" && reasoningMandatory(model) ? "low" : e;
export const effortBody = (e, model) => { e = effortFor(e, model); return !e || e === "default" ? {} : e === "none" ? { reasoning: { enabled: false } } : { reasoning: { effort: e } }; };
// signal (optional): the person's Stop aborts the call mid-flight (the fetch and its streamed body).
export async function openRouterChat(env, body, session, route = null, meta = {}, signal = null) {
  if (env.BYOK) return byokChat(env.BYOK, body, { fast: byokFast(route, body), signal, privacy: await privacyOf(env, meta?.tenant) });
  // Dev test workspace (test-model.js): one call on the test model, whatever the route says. No pool models, no fallback list.
  const tm = await testModelFor(env, meta?.tenant);
  if (tm) return testChat(env, body, session, route, meta, signal, tm);
  // Routing policy (route2.js, ROUTER_MODE=two): the category's chain at the current privacy level, or a chore on its chore model.
  if (route2On(env) && (route?.two || route?.chore || !route)) return twoChat(env, body, session, route || policyRoute("general", "zdr", "default"), meta, signal);
  // The `models` list shares the request's one reasoning field, so a fallback that needs its own effort (an object
  // {model, host, effort}, or a gpt-oss string when this call turns reasoning off) is tried on its own after the request fails.
  const fbs = (route?.fallbacks || []).map((f) => typeof f === "string" ? { model: f } : f);
  const inList = (f) => Object.keys(f).length === 1 && effortFor(route.effort, f.model) === route.effort;
  const solo = fbs.filter((f) => !inList(f)), base = { usage: { include: true }, ...(session ? { session_id: String(session).slice(0, 256) } : {}) };
  const send = (p) => orFetch(env, { ...p, ...base, ...body }, meta, { "x-openrouter-metadata": "enabled" }, signal);
  const fail = async (r) => { const t = await boundedText(r, 64 * 1024).catch(() => ""); return Object.assign(new Error(`openrouter ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); };
  let r = await send({ ...(route ? { model: route.model, models: [...fbs.filter(inList).map((f) => f.model), ...OR_FALLBACKS].filter((m, i, a) => m !== route.model && a.indexOf(m) === i).slice(0, 3), ...effortBody(route.effort, route.model) }
        : { model: OR_MODEL, models: OR_FALLBACKS }), provider: { zdr: true, max_price: OR_MAX_PRICE, ...(route?.host ? { order: [route.host].flat() } : {}) } });
  for (const f of solo) {
    if (r.ok) break;
    console.log("openrouter: trying fallback", f.model, r.status); await r.body?.cancel?.().catch(() => {});
    r = await send({ model: f.model, ...effortBody(f.effort ?? route.effort, f.model), provider: { zdr: true, max_price: OR_MAX_PRICE, ...(f.host ? { order: [f.host].flat() } : {}) } });
  }
  if (!r.ok) throw await fail(r);
  return r;
}

// Test model (test-model.js): main chat capped per step like two mode (stepMaxOut). orFetch rewrites the payload (model, hosts, ZDR, reasoning effort
// TEST_MODEL_EFFORT); a 200 carrying an error throws so the caller's retry runs.
async function testChat(env, body, session, route, meta, signal, model) {
  const chore = route?.chore ? route : route?.two ? choreRouteFor(route, body, env) : null, main = !!route?.two && !chore;
  const b = { ...body, messages: replayFor(body.messages, model), ...(main ? { max_tokens: stepMaxOut(env) } : {}) };
  // A chore whose OWN model is the test model with reasoning off (route2.js CHORE_MODELS haiku: the Live notes note-taker) keeps it
  // off: the test model changes nothing for it, so dev runs it exactly as prod will (TEST_MODEL_EFFORT is for every other call).
  const keepOff = !!chore && chore.model === model && chore.effort === "none";
  const r = await orFetch(env, { model, ...effortBody(chore ? chore.effort : route?.effort, model), usage: { include: true },
    ...(session ? { session_id: String(session).slice(0, 256), prompt_cache_key: cacheKey(session) } : {}), ...b }, keepOff ? { ...meta, _reasoningOff: true } : meta, { "x-openrouter-metadata": "enabled" }, signal);
  if (!r.ok) { const t = await boundedText(r, 64 * 1024).catch(() => ""); throw Object.assign(new Error(`openrouter ${model} ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); }
  const out = await firstOk(r, !!body.stream);
  if (route?.two && !route.chore) route.served = model;   // per-turn route object only (chore/label routes are shared constants)
  return out;
}

// Two mode (the main chat's routing policy, route2.js + pool.js): one model per attempt, no OpenRouter `models` list (so nothing outside
// the dispatch order can answer). Order: route2.js dispatchOrder (recovery model, then the category's chain at the account's CURRENT
// privacy level, re-read here on every dispatch; ineligible models skipped). Each attempt is built here, last, so nothing upstream can
// change it: the model's FIXED effort (pool.js fixedEffort: Muse Contributor xhigh, every other pool model max; never the route's,
// the caller's, a retry's or the source model's), provider = the model's eligible endpoints at that level (privacy.js; OpenRouter moves
// between them inside the request on an upstream 429/outage: the bounded same-model endpoint retry), require_parameters so no endpoint
// may silently drop the reasoning setting, the $3/$15 ceiling, and the per-step output cap (stepMaxOut: a spend ceiling, not an effort
// selector). orFetch then validates the request against the level again (enforceRequest). Hand-off notes (choreRouteFor) go to their
// chore model instead. Primary fails (any error) → the next model; all fail → the last error; nothing eligible → PRIVACY_EXHAUSTED.
// Waits (ms) before asking a rate-limited Luna again; env.LUNA_429_WAITS ("2000,5000,10000") overrides (tests: "1,1,1").
export const LUNA_429_WAITS = [2000, 5000, 10000];
const lunaWaits = (env) => env?.LUNA_429_WAITS != null ? String(env.LUNA_429_WAITS).split(",").map(Number).filter((n) => n >= 0) : LUNA_429_WAITS;
const sleep = (ms, signal) => new Promise((ok, no) => { const t = setTimeout(ok, ms); signal?.addEventListener?.("abort", () => { clearTimeout(t); no(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true }); });
// Opaque reasoning (OpenRouter reasoning_details, e.g. Meta's encrypted blocks) is replayed only to the model that produced it
// (Resident keeps it on its assistant messages as reasoning_details + _rmodel); every other model gets the messages without it.
// Never read or shown. _rmodel never leaves 1Helm.
export function replayFor(messages, model) {
  if (!Array.isArray(messages) || !messages.some((m) => m && m._rmodel)) return messages;   // only tagged messages are decided here (idempotent)
  return messages.map((m) => { if (!m || !m._rmodel) return m; const { reasoning_details, _rmodel, ...rest } = m; return reasoning_details && _rmodel === model ? { ...rest, reasoning_details } : rest; });
}
// One pool attempt's exact request (exported for the wire tests and the ops route preview).
export function poolPayload(env, model, level, body, session, prov = null) {
  const hosts = eligibleHosts(model, level, { prov });
  const { reasoning, provider, models, model: _m, ...b } = body || {};   // a caller's/router's effort or provider never reaches the wire
  if (isMuse(model) && b.tool_choice != null && b.tool_choice !== "auto") throw new PrivacyBlocked(`${model} accepts only tool_choice auto`, { model });
  return { ...b, messages: replayFor(b.messages, model), model, reasoning: { effort: fixedEffort(model) },
    provider: { order: hosts, only: hosts, allow_fallbacks: true, require_parameters: true, max_price: OR_MAX_PRICE }, usage: { include: true },
    ...(session ? { session_id: String(session).slice(0, 256), prompt_cache_key: cacheKey(session) } : {}) };
}
async function twoChat(env, body, session, route, meta, signal = null) {
  const chore = route.chore ? route : choreRouteFor(route, body, env);
  // host: one provider or a list in order; pin: only those providers (CHORE_MODELS oss20). Chores keep their own fixed settings.
  const one = async (model, effort, host, b, pin = false) => {
    const r = await orFetch(env, { model, ...effortBody(effort, model), provider: { zdr: true, max_price: OR_MAX_PRICE, ...(host ? { order: [host].flat(), ...(pin ? { allow_fallbacks: false } : {}) } : {}) }, usage: { include: true },
      ...(session ? { session_id: String(session).slice(0, 256), prompt_cache_key: cacheKey(session) } : {}), ...b }, meta, { "x-openrouter-metadata": "enabled" }, signal);
    if (!r.ok) { const t = await boundedText(r, 64 * 1024).catch(() => ""); throw Object.assign(new Error(`openrouter ${model} ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); }
    return r;
  };
  if (chore) {                                          // a chore: its model, then its own fallbacks one at a time, nothing else
    const order = [{ model: chore.model, effort: chore.effort, host: chore.host, pin: chore.pin }, ...(chore.fallbacks || []).map((f) => typeof f === "string" ? { model: f, effort: chore.effort } : f)];
    let err;
    for (const o of order) {
      try { const r = await firstOk(await one(o.model, o.effort, o.host, { ...body, messages: replayFor(body.messages, null) }, !!o.pin), !!body.stream); if (route.two && !route.chore) { route.served = o.model; route.floor = "chore handoff"; route.label = "two/chore handoff"; } return r; }
      catch (e) { if (signal?.aborted) throw e; err = e; console.log("router: chore model failed", o.model, String(e.message).slice(0, 160)); }
    }
    throw err;
  }
  const level = await privacyOf(env, meta?.tenant), prov = meta?._prov ?? null;
  const { models: order, skipped } = dispatchOrder(route, level, { prov, body });
  if (skipped.length) console.log("router: skipped", JSON.stringify({ level, category: route.category || null, skipped }));
  if (!order.length) throw new PrivacyBlocked(PRIVACY_EXHAUSTED, { level, category: route.category || null });
  const b = { ...body, max_tokens: stepMaxOut(env) };   // the main chat's per-step output cap
  let err, attempts = 0;
  for (let i = 0; i < order.length && attempts < MAX_ATTEMPTS; i++) {
    // Luna rate-limited (429 on all its endpoints) → wait and ask Luna again before paying a pricier model for the step (dev 10-07).
    const waits = order[i] === LUNA && i === 0 ? lunaWaits(env) : [];
    for (let k = 0; attempts < MAX_ATTEMPTS; k++) {
      attempts++;
      try {
        const r = await orFetch(env, poolPayload(env, order[i], level, b, session, prov), { ...meta, _privacy: level, _prov: prov }, { "x-openrouter-metadata": "enabled" }, signal);
        if (!r.ok) { const t = await boundedText(r, 64 * 1024).catch(() => ""); throw Object.assign(new Error(`openrouter ${order[i]} ${r.status}: ${t.slice(0, 200)}`), { orStatus: r.status }); }
        const out = await firstOk(r, !!b.stream); markServed(route, order[i], i > 0); return out;
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
export const prefixPrint = (messages, tools) => `${h32((messages || []).filter((m) => m?.role === "system").map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n"))}.${h32(tools ? JSON.stringify(tools) : "")}`;

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
// Checked 10-08 (probes in /workspace/tmp-shots/cachefix, same request marked vs plain):
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
  let sys = -1; while (m[sys + 1]?.role === "system") sys++;            // the leading system message(s): mark the last one
  if (sys >= 0 && markable(m[sys])) marks.add(sys);
  if (payload.session_id && out.tools) {
    const back = (from, floor) => { for (let i = from; i > floor; i--) if (markable(m[i])) return i; return -1; };
    const lastUser = m.findLastIndex((x) => x?.role === "user");
    const hist = lastUser > sys + 1 ? back(lastUser - 1, sys) : -1;    // 3. the stable history before the newest user message
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
  // AI data privacy (privacy.js): the one chokepoint for every OpenRouter chat call validates the request against the account's current
  // level (twoChat passes the level it just read; anything else reads it now). Ineligible → PrivacyBlocked, nothing is sent.
  payload = enforceRequest(payload, meta?._privacy ?? await privacyOf(env, meta?.tenant), { prov: meta?._prov ?? null });
  if (payload.messages) payload = { ...payload, messages: replayFor(payload.messages, payload.model) };   // opaque reasoning: only to the model that wrote it
  // Dev test workspace (test-model.js): every OpenRouter chat call goes to the test model (ZDR endpoints: stricter than any level).
  // The privacy check above already ran on the request as the policy built it.
  const tm = await testModelFor(env, meta?.tenant);
  if (tm) payload = testPayload(payload, tm, OR_MAX_PRICE, testHostsOf(env), meta?._reasoningOff ? "none" : testEffortOf(env));
  if (env.PROMPT_CACHE !== "off") payload = withCacheBreakpoints(payload);   // prompt caching, every route (withCacheBreakpoints); PROMPT_CACHE="off" = kill switch
  const body = JSON.stringify(payload);
  return orSend(env, "chat/completions", () => body, meta, extraHeaders, signal);
}
// OpenRouter's other APIs (sidecar.js: /embeddings, /audio/transcriptions), through the same gateway, key and fallback as the chat.
// Not LLM chat, so no test-model rewrite and no cache breakpoints. body: a payload object, or () → { body, length } for a streamed body
// (made again for the direct retry; length is what FixedLengthStream needs). The caller asks for ZDR endpoints (provider.zdr).
export async function orFetchPath(env, path, body, meta = {}, extraHeaders = {}, signal = null) {
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
