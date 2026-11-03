import { boundedJson } from "./bounded-body.js";
// Bring your own AI key (Captain 2026-10-06). The "byok" plan is $10/month with 100 GB of storage and no included usage. Its AI
// model calls go to the person's own OpenAI-compatible endpoint (POST <base>/chat/completions) with their key and their models,
// so they pay their provider and 1Helm charges $0 for the AI. Everything else 1Helm runs (the computer, Browser Run, web search,
// memory, embeddings) is metered at our cost + 15% from the prepaid credits they top up (src/resident.js byokHold / byokMeter). Each
// part is reserved before it runs; if the balance can't cover it, it's skipped (memory: no recall or saving that turn), never run on credit.
//   - Settings → AI services: endpoint base URL, key, main model, optional fast model (chores: titles/labels, hand-off notes,
//     memory summaries, the browser agent's planner). Test connection checks reach, tool calling and streaming.
//   - The key is sealed with VAULT_KEY (sentinel.js sealSecret, like Passwords & keys), never returned (•••• + last 4) or logged.
//     The loaded config keeps it in a non-enumerable property, so logging or JSON-encoding the config can't print it.
//   - No OpenRouter or Workers AI fallback: a failing endpoint fails the turn with a plain message that links to Settings.
//   - The address: any HTTPS URL whose path ends in /v1. HTTPS is mandatory for keys and conversation data.
//     No host/port/IP rules: Test connection simply tries it, and any failure shows one plain message plus a short detail.
//     Kept: redirects refused (redirect: "manual", so the key never goes to another host), timeouts and response-size caps on every call,
//     the key never in logs/responses, the key typed again when the address's origin changes, the Test rate limit.
//   - The key: any length, even none (self-hosted Ollama / LM Studio / vLLM need no key: then no Authorization header is sent and
//     key_sealed is stored as ""). Only refused: line breaks/control characters (it goes into a header) and over 4000 characters.
//   - ZDR: 1Helm's zero-data-retention guarantee covers only what 1Helm runs; the AI part is under the provider's terms (ZDR_WARNING).
// A key saved on a full plan (Personal/Plus/Power/Max), Captain 10-06: the person picks one of two options (byok.mode, migration 033):
//   - "fallback" (Keep my plan, use my key as a backup): AI uses 1Helm credits first, as always. Once a model call can't be covered
//     (the Ledger refuses it: out of credits), that call and every later one go to their key, until credits refill (a renewal, an
//     upgrade or a top-up: any new grant). The episode lives in the Ledger (ledgerByok below), so every channel agrees and the switch is
//     announced once (a notice in the app + the stream event "byok_switch"). While it lasts the account runs exactly like the BYOK plan:
//     the computer, browser, web search and memory still need 1Helm credits (metered at cost + 15%; with none they pause with a plain
//     line and an Add credits link), and the spend guard's runaway/budget/day pauses still apply. The ZDR caveat applies only then.
//   - "switch" (Switch to the $10 plan with my key when this billing period ends): plan-change.js's downgrade path (price swap, no
//     proration, from the next bill; its storage check). Until then nothing changes; the renewal invoice makes tenants.plan "byok".
//     Stripe is the truth for whether a switch is pending (a switch made in Change plan counts too); Undo puts the plan's price back.
//   - "switch now" (Captain 10-28: "why can't i just apply whatever dollar amount i have left to credits?"): switchNow() below. It is what
//     the second option does now, and what Change plan does for the byok plan. Order: working key (Test connection again) → Stripe price
//     swap (the same changePlan, no proration, billing date unchanged, no invoice now) → the Ledger turns the unused plan usage into
//     credits (ledgerByok.byokPlanToCredits, once, never created money) → tenants.plan = "byok". Every step is safe to run twice, so a
//     failure part way is finished by trying again. The mode "switch" (scheduled for the renewal) stays for accounts that already have
//     one: Undo as before, or Switch now. A later invoice.paid for the plan the account left is handled in index.js (stale invoice).
//   - Removing the key ends fallback (the row goes); with a switch pending, the app asks whether to cancel the switch too.
// On the byok plan there's no choice: the key is simply their AI.
import { sealSecret, openSecret } from "./sentinel.js";
import { enabled as eeEnabled, effortBody, ownChorePlan, parseOwn, listedRecords, changePlan, nextPlan,
  CC_SOURCE, isCcModel, claudeChat, ccModelsJson, ccStart, ccFinish, ccWarm, claudeUsage,
  usageCache, refreshUsage, dropUsage,
  listRows, viewRows, connCfgs, splitModel, connDdl, plainFromForm, addPlain, addSealed, addChatgpt, addClaudeCode, adoptPending, removeConnection, saveTest, testConnection, setOcPlan, CONN_KEY_RE,
  OC_SOURCE, ocBase, ocPlan, opencodeChat, opencodeModelsJson,
  CG_SOURCE, CG_USAGE_PAGE, CG_WHY_TEXT, cgDdl, cgFinish, chatgptChat, chatgptModelsJson, chatgptUsage } from "./ee/index.js";   // the licensed services layer: several AI services at once (every call into it is behind eeEnabled or a provider only it can save)
import { replayFor } from "./model.js";
import { singleKeyConfig, singleKeyApi } from "./byok-single.js";   // one saved key: the core path without ONEHELM_EE
import { OR_SOURCE, OR_BASE, orDdl, orForget, orView } from "./byok-openrouter.js";
import { byokPrivacyFields, isOpenRouterBase, POLICY_REFUSAL_RE, byokPrivacyText } from "./privacy.js";   // AI data privacy on Sign in with OpenRouter keys   // Sign in with OpenRouter: the same key path, filled in

export const BYOK_PLAN = "byok";
export const ZDR_WARNING = "With your own AI key, your messages and files that the AI reads go to that provider under their terms. 1Helm's zero-data-retention guarantee covers only the parts we run. Everything else stays private as before.";
export const FIRST_BYTE_MS = 120e3;         // until the response headers arrive
export const IDLE_MS = 120e3;               // a stream that sends nothing for this long is dropped
export const TOTAL_MS = 20 * 60e3;          // one call never runs longer than this
export const MAX_JSON_BYTES = 2 << 20;      // a non-streamed answer
export const MAX_STREAM_BYTES = 16 << 20;   // a streamed answer (reasoning streams can be long)
export const MAX_ERR_BYTES = 4096;          // what is read of an error body
export const TEST_LIMIT = 8, TEST_WINDOW_MS = 10 * 60e3;   // Test connection (and Save, which tests first): 8 per 10 minutes
export { BYOK_MARKUP, METER, hsRetainBatchNano, hsRetainNano, hsRawNano, hsRecallNano } from "./byok-meter.js";

export class ByokError extends Error {
  // status stays 502 whatever the provider said: 402/429 mean "1Helm credits / daily limit" everywhere else in the app.
  constructor(message, http = 0, detail = "") { super(message); this.byok = true; this.status = 502; this.http = http; this.detail = detail; }
}
export const BYOK_REPLY_RE = /^Your AI service\b/;
// Out of credits on this plan means the parts 1Helm runs (no plan usage refills them; the AI itself is on their key).
export const BYOK_CREDITS_REPLY = "Your credits for the computer, browser and memory have run out, so I stopped here. Nothing was lost. Add more in Settings → General → Add credits. The AI itself runs on your own key and isn't charged.";
export const isByokError = (e) => !!e?.byok || BYOK_REPLY_RE.test(String(e?.message ?? e ?? ""));

// ---- a key on a full plan: the two options ----
export const MODES = ["fallback", "switch"];
export const isFullPlan = (plan) => !!plan && plan !== BYOK_PLAN;
export const FALLBACK_NOTE = "Using your own AI key (1Helm credits used up)";
export const ZDR_FALLBACK = "The zero-data-retention note applies only while your key is in use: then the AI part goes to your provider under their terms. While 1Helm credits last, nothing changes.";
// The one-time notice when an account starts using its key because its credits ran out (the app shows it once; boot shows it if missed).
export const fallbackNotice = (helper = "Your helper", host = "") => `Your 1Helm credits are used up, so ${helper} is now using your own AI key${host ? ` (${host})` : ""} for chat. The computer, browser, web search and memory still need 1Helm credits: add some in Settings → Usage, or they come back when your plan renews. While your key is in use, 1Helm's zero-data-retention guarantee doesn't cover the AI part.`;
// When a computer, browser, web search or memory step can't run because the credits for them are out (own key: the BYOK plan or fallback).
export const creditsLine = (cfg) => `The computer, browser, web search and memory need 1Helm credits, and those have run out, so I couldn't use them. Nothing was lost. ${cfg?.credits ? `[Add credits](${cfg.credits})` : "Add credits in Settings → Usage"} to use them again. Chat keeps working on your own AI key.`;
export const CREDITS_TOOL_ERR = "error: paused, out of credits: the 1Helm credits that pay for the computer, browser, web search and memory have run out, so this step can't run now. Nothing was lost. You (the AI) run on the person's own key, so plain chat still works. Don't try the computer, browser or web search again in this turn: answer from what you already have, and say plainly that those tools are paused until they add credits (the app adds an Add credits link under your reply).";

// ---- the endpoint address ----
// Any http(s) address whose path ends in /v1. "…/v1/" and "…/v1/chat/completions" are trimmed back to "…/v1". Never fetches.
export const V1_MSG = "Use your AI service's address that ends in /v1, like https://api.openai.com/v1.";
export function checkBase(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { error: "Enter your AI service's address, like https://api.openai.com/v1." };
  if (s.length > 300) return { error: "That address is too long." };
  let u; try { u = new URL(s); } catch { return { error: "That isn't a web address. It should look like https://api.openai.com/v1." }; }
  if (u.protocol !== "https:") return { error: "Use an HTTPS address to protect your AI key, messages and files." };
  if (u.username || u.password) return { error: "Put the key in the Key field, not in the address." };
  const path = u.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  if (!/\/v1$/i.test(path)) return { error: V1_MSG };
  return { ok: true, base: `${u.origin}${path}${u.search}`, host: u.hostname.replace(/^\[|\]$/g, ""), origin: u.origin };
}
export function endpointUrl(base) { const u = new URL(base); u.pathname = `${u.pathname.replace(/\/+$/, "")}/chat/completions`; return u.href; }

// ---- messages ----
const hostOf = (cfg) => cfg?.host || (() => { try { return new URL(cfg.base).hostname; } catch { return "your AI service"; } })();
const settingsLink = (cfg) => cfg?.settings ? `[Settings → AI services](${cfg.settings})` : "Settings → AI services";
// One plain message for every failure, with a short detail (status code or reason, key stripped).
export const TEST_FAIL = "Couldn't connect to that AI service. Check the address, key and model, then try again.";
export const TEST_FAIL_CG = "ChatGPT didn't accept that model. Pick a model from the list, then try again.";
export const TEST_FAIL_CG_SIGNIN = "ChatGPT didn't accept the sign-in. Continue with ChatGPT again, then try again.";
export const failText = (cfg, detail) => `Your AI service (${hostOf(cfg)}) didn't work${detail ? ` (${detail})` : ""}, so I couldn't finish this. ${cfg?.provider === CG_SOURCE ? "Check your ChatGPT sign-in" : cfg?.provider === OC_SOURCE ? ("Check your OpenCode key and plan") : "Check the address and key"} in ${settingsLink(cfg)}.${cfg?.fallback ? ` I'm using it because your 1Helm credits are used up; adding credits brings back 1Helm's AI.` : ""}`;
export const fail = (cfg, detail, http = 0) => new ByokError(failText(cfg, detail), http, detail);
export const missingText = (cfg) => cfg?.unreadable ? `Your AI service is set up, but 1Helm couldn't read your saved key just now. Save the key again in ${settingsLink(cfg)}.`
  : `Your AI service isn't set up yet: your plan uses your own AI key, and none is saved. Add it in ${settingsLink(cfg)}.`;
// Provider error text, cleaned: the key itself and anything key-shaped are never echoed back.
export function redact(s, key = "", max = 160) {
  let t = String(s ?? "");
  if (key && key.length >= 4) t = t.split(key).join("[key]");
  t = t.replace(/\b(sk|pk|rk|key|tok|api)[-_][A-Za-z0-9_-]{12,}/gi, "[key]").replace(/[A-Za-z0-9_-]{32,}/g, "[…]").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t;
}

// ---- request shaping: OpenRouter-style bodies in, a plain OpenAI chat body out ----
const MSG_KEYS = ["role", "content", "name", "tool_call_id"];
function cleanMessages(msgs) {
  return (msgs || []).map((m) => {
    const o = {}; for (const k of MSG_KEYS) if (m?.[k] !== undefined) o[k] = m[k];
    if (Array.isArray(m?.tool_calls) && m.tool_calls.length) o.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function?.name, arguments: c.function?.arguments ?? "{}" } }));
    if (o.content === undefined) o.content = o.tool_calls ? null : "";
    return o;
  });
}
export function byokBody(body, model) {
  const out = { model, messages: cleanMessages(body.messages) };
  if (body.tools?.length) out.tools = body.tools;
  if (body.tool_choice) out.tool_choice = body.tool_choice;
  if (body.stream) { out.stream = true; out.stream_options = { include_usage: true }; }
  if (body.max_tokens) out.max_tokens = body.max_tokens;
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.response_format) out.response_format = body.response_format;
  return out;
}
// Parameters some providers refuse (o-series: max_tokens, temperature; others: stream_options, response_format…). A 400 that names
// one drops it and tries once more; the endpoint+model remembers it for later calls.
const DROPPABLE = ["max_tokens", "temperature", "stream_options", "response_format", "tool_choice", "top_p"];
const quirks = new Map();
const quirkKey = (cfg, model) => `${cfg.base}|${model}`;
function applyQuirks(cfg, req) {
  const q = quirks.get(quirkKey(cfg, req.model)); if (!q) return req;
  const out = { ...req };
  for (const p of q) { if (p === "response_format" && req.response_format?.type === "json_schema") continue; if (p === "max_tokens>mct" && out.max_tokens) { out.max_completion_tokens = out.max_tokens; delete out.max_tokens; } else delete out[p]; }
  return out;
}

// Reads at most `max` bytes of a body; more → ByokError.
export async function readCapped(cfg, body, max, what = "answer") {
  if (!body) return "";
  const reader = body.getReader(), dec = new TextDecoder(); let n = 0, s = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    n += value.byteLength; if (n > max) { reader.cancel().catch(() => {}); throw fail(cfg, `its ${what} was too big`); }
    s += dec.decode(value, { stream: true });
  }
  return s + dec.decode();
}
export async function errorDetail(cfg, r) {
  let t = ""; try { const reader = r.body?.getReader(); if (reader) { const dec = new TextDecoder(); let n = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; n += value.byteLength; t += dec.decode(value, { stream: true }); if (n >= MAX_ERR_BYTES) { reader.cancel().catch(() => {}); break; } } } } catch {}
  let msg = t; try { const j = JSON.parse(t); msg = j?.error?.message || j?.message || j?.detail || (typeof j?.error === "string" ? j.error : "") || t; } catch {}
  return { raw: t, detail: redact(typeof msg === "string" ? msg : JSON.stringify(msg), cfg.key) };
}

// One POST to the endpoint, with every guard. Returns the Response (2xx). Throws ByokError.
async function byokPost(cfg, req, { signal = null, fetchImpl = globalThis.fetch } = {}) {
  const chk = checkBase(cfg.base);
  if (!chk.ok) throw fail(cfg, chk.error.replace(/\.$/, ""));
  let body = applyQuirks(cfg, req);
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController(), onAbort = () => ac.abort(signal?.reason);
    if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener("abort", onAbort, { once: true }); }
    const timer = setTimeout(() => ac.abort(new Error("first-byte timeout")), FIRST_BYTE_MS);
    let r;
    try {
      r = await fetchImpl(endpointUrl(chk.base), { method: "POST", redirect: "manual", signal: ac.signal,
        headers: { ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}), "content-type": "application/json", accept: body.stream ? "text/event-stream" : "application/json", "user-agent": "1Helm" },
        body: JSON.stringify(body) });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw fail(cfg, ac.signal.aborted ? `no answer within ${Math.round(FIRST_BYTE_MS / 1000)} seconds` : `couldn't connect${e?.message ? `: ${redact(e.message, cfg.key, 100)}` : ""}`);
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
    if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
      r.body?.cancel?.().catch?.(() => {});
      throw fail(cfg, `error ${r.status || 302}: it redirected to another address; use the final address`, r.status || 302);
    }
    if (r.ok) return r;
    const { raw, detail } = await errorDetail(cfg, r);
    if (r.status === 400 && attempt < 3) {
      const p = DROPPABLE.find((k) => k in body && !(k === "response_format" && req.response_format?.type === "json_schema") && new RegExp(`\\b${k}\\b`).test(raw));
      if (p) {
        const q = quirks.get(quirkKey(cfg, body.model)) || new Set();
        const mct = p === "max_tokens" && /max_completion_tokens/.test(raw);
        q.add(mct ? "max_tokens>mct" : p); quirks.set(quirkKey(cfg, body.model), q);
        body = applyQuirks(cfg, req); continue;
      }
    }
    throw fail(cfg, `error ${r.status}${detail ? `: ${detail}` : ""}`, r.status);
  }
}

// A streamed body with an idle timeout, a total time limit and a size cap. Errors surface as ByokError on read.
// The idle time counts from the last chunk that carries an event line ("data:"). A chunk with only comment lines (": keep-alive" or
// ": OPENROUTER PROCESSING", which gateways send every few seconds while a model is still working) does not reset it, so a call that
// never produces an event ends after IDLE_MS instead of running until TOTAL_MS (a live turn waited that way with nothing on screen).
const EVENT_LINE = /(^|\n)[ \t]*data:/;
export function guardStream(cfg, body, signal) {
  const reader = body.getReader(), dec = new TextDecoder(), t0 = Date.now(); let bytes = 0, lastEvent = t0, events = 0, tail = "", onAbort = null;
  return new ReadableStream({
    // The person's Stop ends the upstream read at once, also while the first event is still awaited (firstEventOk), when nothing else listens to the signal.
    start(c) {
      if (!signal) return;
      onAbort = () => { reader.cancel(signal.reason).catch(() => {}); try { c.error(signal.reason); } catch {} };
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    },
    async pull(c) {
      const now = Date.now(), left = TOTAL_MS - (now - t0), idleLeft = IDLE_MS - (now - lastEvent);
      let timer;
      const to = new Promise((_, no) => { timer = setTimeout(() => no(fail(cfg, left <= idleLeft ? "the answer took too long to finish" : events ? "it stopped sending in the middle of the answer" : `no answer within ${Math.round(IDLE_MS / 1000)} seconds`)), Math.max(0, Math.min(idleLeft, left))); });
      try {
        const { value, done } = await Promise.race([reader.read(), to]);
        if (done) { c.close(); return; }
        bytes += value.byteLength;
        if (bytes > MAX_STREAM_BYTES) { reader.cancel().catch(() => {}); c.error(fail(cfg, "its answer was too big")); return; }
        const text = tail + dec.decode(value, { stream: true }); tail = text.slice(-6);   // an event line may start in the previous chunk
        if (EVENT_LINE.test(text)) { lastEvent = Date.now(); events++; }
        c.enqueue(value);
      } catch (e) { reader.cancel().catch(() => {}); c.error(signal?.aborted ? e : e?.byok ? e : fail(cfg, "the connection dropped in the middle of the answer")); }
      finally { clearTimeout(timer); }
    },
    cancel(x) { if (signal && onAbort) signal.removeEventListener("abort", onAbort); return reader.cancel(x); },
  });
}
// Up to the first real event: an error event before any output throws (with the provider's words); otherwise the bytes already read
// are put back in front of the rest.
export async function firstEventOk(cfg, stream) {
  const reader = stream.getReader(), dec = new TextDecoder(), seen = []; let text = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    seen.push(value); text += dec.decode(value, { stream: true });
    let started = false;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue; const d = line.slice(5).trim(); if (!d || d === "[DONE]") continue;
      let ev; try { ev = JSON.parse(d); } catch { continue; }
      if (ev.error) { reader.cancel().catch(() => {}); throw fail(cfg, redact(ev.error.message || JSON.stringify(ev.error), cfg.key)); }
      if (ev.choices || ev.usage) { started = true; break; }
    }
    if (started) break;
  }
  return new ReadableStream({ start(c) { for (const v of seen) c.enqueue(v); },
    async pull(c) { try { const { value, done } = await reader.read(); if (done) c.close(); else c.enqueue(value); } catch (e) { c.error(e); } }, cancel(x) { return reader.cancel(x); } });
}

// The one way 1Helm talks to a person's own endpoint. body: an OpenRouter-style chat body (messages, tools, stream, max_tokens…).
// fast: the fast model (chores). Returns a Response shaped like OpenRouter's: SSE when streaming, else JSON with usage.cost = 0.
// privacy: the account's AI data privacy level (privacy.js). Sign in with OpenRouter keys get it as OpenRouter's per-request data policy
// (their chosen model is kept; if none of its endpoints qualify, OpenRouter refuses and the person is told why, never moved to another
// model or to 1Helm's own models). Other endpoints can't be steered: their provider's terms apply (Settings says so).
// Custom Model Selection on an own key (byok-custom.js): `model` is the chain entry to try instead of the main model, `effort` its reasoning level and
// `facts` the saved facts of the model (the same as on a full plan), `maxPrice` the category's max price. Without them the call is exactly as before.
// Effort goes the way the endpoint takes it: OpenRouter gets reasoning.effort (effortBody, as for a full plan), any other endpoint gets
// reasoning_effort, and only a level its model's facts listed can be saved, so none is ever sent that the model did not say it supports.
export function effortFields(cfg, effort, model, facts = null) {
  if (!effort || effort === "default") return {};
  if (isOpenRouterBase(cfg?.base)) return effortBody(effort, model, { catalog: facts ? { [model]: facts } : {} });
  return { reasoning_effort: effort };
}
// Several AI services (byok-connections.js): cfg.connections maps a connection id to the config of one service, and a model is named <connection id>:<model>. byokChat sends the call to
// the connection the model belongs to, with that connection's key and API; the rest (one call to one service) is byokChatOne. A cfg with no connections is one service, as it always was.
export const chooseModelText = (cfg) => `Your AI service is connected, but no model is chosen for this yet. Choose one in ${cfg?.settings ? `[Settings, Advanced, Custom Model Selection](${cfg.settings.replace(/settings=byok/, "settings=advanced")})` : "Settings, Advanced, Custom Model Selection"}.`;
const goneText = (cfg, ns) => `Your AI service for ${String(ns).slice(0, 80)} was disconnected. Choose another model in Settings, Advanced, Custom Model Selection.`;
export async function byokChat(cfg, body, opts = {}) {
  if (!cfg || cfg.missing || typeof cfg.key !== "string") throw new ByokError(missingText(cfg));   // "" = no key (Ollama, LM Studio, vLLM…)
  const { fast = false, signal = null, fetchImpl = globalThis.fetch, privacy = null, maxPrice = null, session = null, purpose = null } = opts;
  let { model: pick = null, effort = null, facts = null } = opts;
  if (!cfg.connections) return byokChatOne(cfg, body, opts);
  // Chores: Background jobs' models in order, a failing one hands the call to the next (a bad key and the person's Stop do not).
  if (fast && !pick && cfg.background?.length) {
    let last;
    for (const e of cfg.background) {
      try { return await byokChat(cfg, body, { signal, fetchImpl, privacy, session, purpose: purpose || "background", model: e.model, effort: e.effort, facts: e.facts }); }
      catch (err) { if (signal?.aborted || err?.http === 401 || !(err instanceof ByokError)) throw err; last = err; console.log("byok background: model failed", e.model, String(err.detail || "").slice(0, 100)); }
    }
    throw last;
  }
  if (!pick) { pick = fast ? (cfg.fast || cfg.model) : cfg.model; if (pick === cfg.model && !fast) { effort = cfg.effort || null; facts = cfg.facts || null; } }
  if (!pick) throw new ByokError(chooseModelText(cfg));
  const s = splitModel(pick), conn = s && cfg.connections[s.conn];
  if (!conn) throw new ByokError(goneText(cfg, pick));
  body = { ...body, messages: replayFor(body.messages, pick) };   // opaque reasoning (Claude Code's signed thinking) goes back only to the model that wrote it; every other model gets the messages without it
  return byokChatOne(conn, body, { signal, fetchImpl, privacy, model: s.model, effort, facts, maxPrice, session, purpose: purpose || (fast ? "chores" : null) });
}
async function byokChatOne(cfg, body, { fast = false, signal = null, fetchImpl = globalThis.fetch, privacy = null, model: pick = null, effort = null, facts = null, maxPrice = null, session = null, purpose = null } = {}) {
  if (!cfg || cfg.missing || typeof cfg.key !== "string") throw new ByokError(missingText(cfg));
  // Chores while Custom Model Selection is on: Background jobs' models in order, a failing one hands the call to the next (a bad key and the person's Stop do not).
  if (fast && !pick && cfg.background?.length) {
    let last;
    for (const e of cfg.background) {
      try { return await byokChatOne(cfg, body, { signal, fetchImpl, privacy, session, purpose: purpose || "background", model: e.model, effort: e.effort, facts: e.facts }); }
      catch (err) { if (signal?.aborted || err?.http === 401 || !(err instanceof ByokError)) throw err; last = err; console.log("byok background: model failed", e.model, String(err.detail || "").slice(0, 100)); }
    }
    throw last;
  }
  const model = pick || (fast ? (cfg.fast || cfg.model) : cfg.model);
  const level = pick ? effort : (fast ? cfg.fastEffort : cfg.effort) || null;   // the chosen model's own level, else the one saved for this model (none: the service's default)
  if (cfg.provider === CC_SOURCE) return claudeChat(cfg, body, { signal, model, effort: level, session });   // Continue with Claude: the signed-in Claude Code, one model call at a time (byok-claudecode.js)
  if (cfg.chatgptHandle) return chatgptChat(cfg, body, { signal, fetchImpl, model, effort: level, session, purpose: purpose || (fast ? "chores" : "chat") });   // Continue with ChatGPT: the Responses API, answered in chat/completions shape
  if (cfg.provider === OC_SOURCE) return opencodeChat(cfg, body, { signal, fetchImpl, model, effort: level, session, purpose: purpose || (fast ? "chores" : "chat") });   // Use OpenCode: its own transport (byok-opencode.js)
  const req = { ...byokBody(body, model), ...byokPrivacyFields(cfg, privacy), ...(level ? effortFields(cfg, level, model, pick ? facts : null) : {}) };
  if (pick && maxPrice && isOpenRouterBase(cfg.base) && Number.isFinite(maxPrice.prompt) && Number.isFinite(maxPrice.completion)) req.provider = { ...req.provider, max_price: { prompt: maxPrice.prompt, completion: maxPrice.completion } };
  if (body.response_format?.type === "json_schema" && isOpenRouterBase(cfg.base)) {
    req.provider = { ...req.provider, require_parameters: true };
    // Strict parameter filtering leaves no endpoint when a temperature is sent (see withoutTemperatureWhenStrict in model.js), whatever the model is.
    delete req.temperature;
  }
  let r;
  try { r = await byokPost(cfg, req, { signal, fetchImpl }); }
  catch (e) { if (privacy && isOpenRouterBase(cfg.base) && POLICY_REFUSAL_RE.test(`${e?.detail || ""} ${e?.message || ""}`)) throw new ByokError(byokPrivacyText(cfg, privacy, model), e.http, e.detail); throw e; }
  if (req.stream) {
    if (!r.body) throw fail(cfg, "an empty answer");
    return new Response(await firstEventOk(cfg, guardStream(cfg, r.body, signal)), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  let j; const text = await readCapped(cfg, r.body, MAX_JSON_BYTES);
  try { j = JSON.parse(text); } catch { throw fail(cfg, "the answer wasn't OpenAI-style JSON"); }
  if (j?.error && !j.choices) throw fail(cfg, redact(j.error.message || JSON.stringify(j.error), cfg.key));
  if (!Array.isArray(j?.choices)) throw fail(cfg, "the answer had no reply in it (not OpenAI-style)");
  j.usage = { ...(j.usage || {}), cost: 0 };   // their provider bills them; 1Helm charges nothing for the AI
  j.model ||= model;
  return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
}

// The models the person's endpoint serves: GET <base>/models with their key, under the same rules as every other call (HTTPS only, no redirects, a timeout, a size cap, the key never
// echoed). Returns the parsed JSON, or throws ByokError.
export const MODELS_MS = 15e3, MAX_MODELS_BYTES = 4 << 20;
export async function byokModelsJson(cfg, { fetchImpl = globalThis.fetch, signal = null } = {}) {
  if (!cfg || cfg.missing || typeof cfg.key !== "string") throw new ByokError(missingText(cfg));
  if (cfg.provider === CC_SOURCE) return ccModelsJson();   // a fixed list: the names the Claude Code command takes
  if (cfg.chatgptHandle) return chatgptModelsJson(cfg, { fetchImpl, signal });
  if (cfg.provider === OC_SOURCE) return opencodeModelsJson(cfg, { fetchImpl, signal });
  const chk = checkBase(cfg.base); if (!chk.ok) throw fail(cfg, chk.error.replace(/\.$/, ""));
  const u = new URL(chk.base); u.pathname = `${u.pathname.replace(/\/+$/, "")}/models`;
  const ac = new AbortController(), onAbort = () => ac.abort(signal?.reason);
  if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener("abort", onAbort, { once: true }); }
  const timer = setTimeout(() => ac.abort(new Error("timeout")), MODELS_MS);
  try {
    let r;
    try {
      r = await fetchImpl(u.href, { method: "GET", redirect: "manual", signal: ac.signal, headers: { ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}), accept: "application/json", "user-agent": "1Helm" } });
    } catch (e) { throw fail(cfg, ac.signal.aborted ? `no model list within ${Math.round(MODELS_MS / 1000)} seconds` : `couldn't connect${e?.message ? `: ${redact(e.message, cfg.key, 100)}` : ""}`); }
    if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) { r.body?.cancel?.().catch?.(() => {}); throw fail(cfg, `error ${r.status || 302}: it redirected to another address; use the final address`, r.status || 302); }
    if (!r.ok) { const { detail } = await errorDetail(cfg, r); throw fail(cfg, `error ${r.status}${detail ? `: ${detail}` : ""}`, r.status); }
    const text = await readCapped(cfg, r.body, MAX_MODELS_BYTES, "model list");
    try { return JSON.parse(text); } catch { throw fail(cfg, "the model list wasn't JSON"); }
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
}

// ---- stored config ----
const appUrl = (env, slug, sec = "ai") => `https://${env.GATEWAY_HOST || env.APP_HOST}/w/${slug}/app?settings=${sec}`;
export function withKey(o, key) { Object.defineProperty(o, "key", { value: key, enumerable: false, writable: false }); return o; }
// Continue with ChatGPT: no key; the token is fetched (and refreshed) for each call from the sealed record (byok-chatgpt.js). The handle is hidden like the key.
export function withChatgpt(o, env, tid) { const c = withKey({ ...o, provider: CG_SOURCE, host: "ChatGPT" }, ""); Object.defineProperty(c, "chatgptHandle", { value: { env, tid }, enumerable: false, writable: false }); return c; }
const CC_WARMED = new Map();
// Claude Code: no key either; the sign-in lives in the account's engine container. The handle is hidden like the key.
export function withClaudeCode(o, env, tid) { const c = withKey({ ...o, provider: CC_SOURCE, host: "Claude Code" }, ""); Object.defineProperty(c, "ccHandle", { value: { env, tid }, enumerable: false, writable: false }); return c; }
// The account's own-AI-key config: on the byok plan { connections, model, fast, settings, credits, background, … }, or { missing: true } when no service is connected yet. On a full plan with mode
// "fallback" and a connected service: the same with fallback: true (used only once its credits run out: Resident.byokRefresh / byokFallbackOn decide). null otherwise (AI goes to 1Helm's own models).
// connections (hidden, like every key): the config of each connected service by id (byok-connections.js). model, fast, effort and background come from the own-key Custom Model Selection
// setting, General's first model, Background jobs and the facts of each model. With nothing chosen yet, model is "" and byokChat says so.
async function byokRow(env, tenantId) {
  const q = (cols) => env.DB.prepare(`SELECT t.plan, t.slug, t.helper_name${cols} FROM tenants t LEFT JOIN byok b ON b.tenant_id=t.id WHERE t.id=?`).bind(tenantId).first();
  for (const cols of [", b.mode", ""]) { try { return await q(cols); } catch (e) { if (!/no such column/i.test(String(e?.message)) || !cols) throw e; } }   // before migration 033 (mode)
}
export async function loadByok(env, tenantId) {
  if (!env?.DB || !tenantId) return null;
  if (!eeEnabled(env)) return singleKeyConfig(env, tenantId);   // core: the one saved key (byok-single.js)
  const r = await byokRow(env, tenantId);
  if (!r) return null;
  const onPlan = r.plan === BYOK_PLAN;
  if (!onPlan && r.mode !== "fallback") return null;
  const settings = appUrl(env, r.slug), credits = appUrl(env, r.slug, "credits");
  const rows = await listRows(env, tenantId);
  const conns = await connCfgs(env, tenantId, { settings, credits, helper: r.helper_name || "" });
  const usable = Object.keys(conns).filter((k) => !conns[k].missing);
  if (!usable.length) return onPlan ? { missing: true, ...(rows.length ? { unreadable: true } : {}), settings } : null;   // never fall back to 1Helm's AI
  const cfg = withKey({ base: "", host: usable.map((k) => conns[k].host || conns[k].label).join(", "), model: "", fast: "", last4: "", effort: "", fastEffort: "", settings, credits, helper: r.helper_name || "", ...(onPlan ? {} : { fallback: true }) }, "");
  Object.defineProperty(cfg, "connections", { value: conns, enumerable: false, writable: false });
  for (const c of Object.values(conns)) c.fallback = !onPlan;
  try {
    const t = await env.DB.prepare("SELECT custom_models_own_on, custom_models_own FROM tenants WHERE id=?").bind(tenantId).first(), config = parseOwn(t?.custom_models_own);
    if (config) {
      const general = config.categories.find((c) => c.id === "general")?.chain?.[0];
      if (general) { cfg.model = general.model; cfg.effort = general.effort || ""; Object.defineProperty(cfg, "facts", { value: config.catalog?.[general.model] || null, enumerable: false }); }
      const chain = ownChorePlan(t, cfg); if (chain) cfg.background = chain;
      cfg.fast = chain?.[0]?.model || cfg.model;
    }
  } catch (e) { if (!/no such column/i.test(String(e?.message))) throw e; }   // before migration 080 there is nothing chosen
  return cfg;
}
// The Ledger side of fallback (mixed into the per-tenant Ledger in index.js, next to spendguard's ledgerGuard: its guardKv, sql,
// totals, expire). One episode at a time: kv byok_fb = when it started. It ends when credits come back: any new positive grant
// (a renewal's included usage, an upgrade, a top-up, a test grant) after it started.
export const ledgerByok = {
  byokFbState() {
    const since = Number(this.guardKv("byok_fb")) || 0; if (!since) return { active: false };
    const refill = this.sql.exec("SELECT at FROM grants WHERE nano>0 AND kind IN ('included','topup','test') AND at>=? ORDER BY at LIMIT 1", since).toArray()[0];
    if (refill) { this.guardKv("byok_fb", null); return { active: false, ended: Number(refill.at) }; }
    return { active: true, since };
  },
  // A model call couldn't be covered (or a turn starts with nothing left): start an episode, once. notice → the app's one-time notice.
  byokFbStart(notice = "") {
    const s = this.byokFbState(); if (s.active) return { ...s, started: false };
    const since = Date.now(); this.guardKv("byok_fb", since);
    if (notice) this.guardKv("notice_pending", JSON.stringify({ kind: "byok", text: notice, at: since }));
    return { active: true, since, started: true };
  },
  // The plan usage still unspent: the unexpired part of the "included" grants (renewals and upgrades), counted the way grantIncluded
  // counts what a renewal expires (included + included_expire - everything spent), less open reservations, and never more than the
  // balance. Credits bought (top-ups) are never in it. Reads only, apart from expire() settling stale reservations as the Ledger always does.
  byokUnusedPlan() {
    this.expire();
    const sum = (q) => Number(this.sql.exec(q).toArray()[0].n);
    const inc = sum("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind IN ('included','included_expire')");
    const spent = sum("SELECT COALESCE(SUM(nano),0) n FROM spend"), reserved = sum("SELECT COALESCE(SUM(nano),0) n FROM res");
    const balance = sum("SELECT COALESCE(SUM(nano),0) n FROM grants") - spent - reserved;
    return Math.max(0, Math.min(inc - spent - reserved, balance));
  },
  // Switch now: the unused plan usage becomes prepaid credits (kind "topup": never expires, spent after the plan usage like any credit).
  // Two rows, one transaction: the plan usage expires (included_expire, -X) and the same X is granted as credits. The balance doesn't
  // change, so no money is created. Once per plan grant: the key names the latest included grant, so a retry or a double click finds
  // its own rows and moves nothing again; a second switch later (after an upgrade) follows a newer grant and has its own key.
  // A new period starts for the usage meter (guardMarkPeriod), so the card on the byok plan measures the credits, not the old plan.
  byokPlanToCredits() {
    const last = this.sql.exec("SELECT key FROM grants WHERE kind='included' AND nano>0 ORDER BY at DESC, rowid DESC LIMIT 1").toArray()[0];
    const key = `unused-plan-balance-to-credits:${last?.key || "none"}`;
    const had = this.sql.exec("SELECT nano FROM grants WHERE key=?", key).toArray()[0];
    if (had) return { moved_nano: Number(had.nano), duplicate: true, balance_nano: this.totals().balance_nano };
    const x = Math.floor(this.byokUnusedPlan());
    this.guardMarkPeriod(); this.guardKv("switch_now_at", Date.now());
    if (x > 0) this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO grants (key,nano,kind,at) VALUES (?,?,?,?)", `${key}:expire`, -x, "included_expire", Date.now());
      this.sql.exec("INSERT INTO grants (key,nano,kind,at) VALUES (?,?,?,?)", key, x, "topup", Date.now());
    });
    return { moved_nano: x, duplicate: false, balance_nano: this.totals().balance_nano };
  },
  // When the last switch now happened (ms), or 0. index.js's invoice.paid compares it with the invoice's creation time.
  byokSwitchAt() { return Number(this.guardKv("switch_now_at")) || 0; },
  // Turn start: on the key already, or nothing left at all (balance ≤ 0) → start now, before any routing call.
  byokFbCheck(notice = "") {
    const s = this.byokFbState(); if (s.active) return { ...s, started: false };
    this.expire(); return this.totals().balance_nano <= 0 ? this.byokFbStart(notice) : s;
  },
};
// The env a BYOK account's model calls run with: the same bindings, plus BYOK (model.js routes on it).
export function byokEnv(env, cfg) {
  const base = env?.__byokBase || env;
  if (!cfg) return base;
  return Object.create(base, { BYOK: { value: cfg, enumerable: false }, __byokBase: { value: base, enumerable: false } });
}

// Is this account's chat answered by its own key right now? The byok plan: always. A full plan with a backup key (mode "fallback"): while the Ledger's
// episode is active (byokFbState, a read that changes nothing). Used by the account routes and the boot payload (Custom Model Selection's status); a read
// that fails answers false. t: the tenants row.
export async function answersOnOwnKey(env, t) {
  if (!t?.id) return false;
  if (t.plan === BYOK_PLAN) return true;
  try {
    const r = await env.DB.prepare("SELECT mode FROM byok WHERE tenant_id=?").bind(String(t.id)).first();
    if (r?.mode !== "fallback") return false;
    const L = ledgerOf(env, t.id), f = typeof L?.byokFbState === "function" ? await L.byokFbState() : null;
    return !!f?.active;
  } catch { return false; }
}

// ---- Settings API (/api/byok…) ----
const now = () => Date.now();
async function rateOk(env, tid) {
  await env.DB.prepare("DELETE FROM byok_tests WHERE at<?").bind(now() - 3600e3).run().catch(() => {});
  const n = Number((await env.DB.prepare("SELECT COUNT(*) n FROM byok_tests WHERE tenant_id=? AND at>?").bind(tid, now() - TEST_WINDOW_MS).first())?.n || 0);
  if (n >= TEST_LIMIT) return false;
  await env.DB.prepare("INSERT INTO byok_tests (tenant_id, at) VALUES (?,?)").bind(tid, now()).run();
  return true;
}
const RATE_MSG = "That's a lot of tests in a few minutes. Wait a few minutes and try again.";
// ---- the two options on a full plan ----
// The row of byok holds only the plan option (mode) now: the services are in byok_connections. It is made when an option is chosen.
const setMode = (env, tid, mode) => env.DB.prepare("INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,test_json,created_at,updated_at,mode) VALUES (?,'','','','','','',?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode").bind(tid, now(), now(), mode).run().catch((e) => { if (!/no such column|has no column/i.test(String(e?.message))) throw e; });
const modeOf = async (env, tid) => { try { return (await env.DB.prepare("SELECT mode FROM byok WHERE tenant_id=?").bind(tid).first())?.mode || ""; } catch { return ""; } };
const ledgerOf = (env, tid) => { try { return env.LEDGER.get(env.LEDGER.idFromName(`tenant:${tid}`)); } catch { return null; } };
// ---- switch now ----
const usdText = (nano) => `$${(Math.max(0, Number(nano) || 0) / 1e9).toFixed(2)}`;
const SWITCH_TEST_FAIL = "Your AI key didn't pass the connection test, so your plan wasn't changed. Check it in Settings → AI services, then try again.";
// What the confirm dialog says before a switch now: the unused plan usage that becomes credits, and when the next bill is. Reads only.
export async function switchPreview(env, t, d) {
  if (!isFullPlan(t.plan)) return { error: "You're on the Bring your own key plan already.", status: 409 };
  const L = ledgerOf(env, t.id); let unused = 0;
  try { unused = Math.floor(Number(await L.byokUnusedPlan()) || 0); } catch (e) { console.log("byok: unused plan", String(e?.message || e).slice(0, 120)); return { error: "Couldn't read your balance. Try again in a minute.", status: 503 }; }
  let at = null;
  if (d?.stripe && t.stripe_subscription) try {
    const sub = await d.stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET"), item = (sub.items?.data || []).find((i) => d.planOfPrice(env, i.price?.id));
    at = 1000 * Number(item?.current_period_end || sub.current_period_end || 0) || null;
  } catch (e) { console.log("byok: subscription", String(e?.message || e).slice(0, 120)); }
  return { ok: true, unused_nano: unused, unused: usdText(unused), price: d?.PLANS?.[BYOK_PLAN]?.price ?? 10, next_bill_at: at };
}
// Move the account to the byok plan right now (see the header). t: the tenants row. Returns { ok, plan, moved_nano, moved, next_bill_at } or { error, status }.
export async function switchNow(env, t, d, { fetchImpl = globalThis.fetch } = {}) {
  if (t.plan === BYOK_PLAN) return { ok: true, plan: BYOK_PLAN, already: true, moved_nano: 0, moved: usdText(0) };
  if (!d?.stripe || !d.PLANS?.[t.plan]) return { error: "Plans can't be changed right now. Try again in a minute.", status: 503 };
  if (!t.stripe_subscription) return { error: "No active plan to change yet.", status: 409 };
  const conns = await connCfgs(env, t.id), ids = Object.keys(conns);
  if (!ids.length) return { error: "Connect your AI service first, then switch.", status: 409 };
  if (!(await ownModelChosen(env, t.id))) return { error: "Choose your models in Settings, Advanced, Custom Model Selection first, then switch.", status: 409 };
  if (!(await rateOk(env, t.id))) return { error: RATE_MSG, rate_limited: true, status: 429 };
  const tests = await Promise.all(ids.map((id) => testConnection(conns[id], { fetchImpl })));
  const test = tests.find((x) => x.ok) || tests[0];
  if (!test.ok) return { error: SWITCH_TEST_FAIL, test, status: 409 };
  // 1. Stripe: the byok price on the same subscription, no proration (nothing charged or refunded), billing date unchanged. Already
  //    there (a switch scheduled for the renewal, or a retry after a later step failed)? Leave it.
  const next = await nextPlan(env, t, d).catch(() => null);
  let end = next?.plan === BYOK_PLAN ? next.at : null;
  if (next?.plan !== BYOK_PLAN) { const r = await changePlan(env, t, BYOK_PLAN, d); if (r.error) return r; end = r.from || null; }
  // 2. The Ledger: the unused plan usage becomes credits, once.
  const L = ledgerOf(env, t.id); if (!L) return { error: "Couldn't reach your balance. Try again in a minute.", status: 503 };
  const moved = await L.byokPlanToCredits();
  // 3. The plan. From here the next model call goes to their endpoint (loadByok reads the plan on every turn).
  await env.DB.prepare("UPDATE tenants SET plan=?, updated_at=? WHERE id=?").bind(BYOK_PLAN, now(), t.id).run();
  try { await setMode(env, t.id, ""); } catch (e) { if (!/no such column/i.test(String(e?.message))) throw e; }
  return { ok: true, plan: BYOK_PLAN, moved_nano: moved.moved_nano, moved: usdText(moved.moved_nano), next_bill_at: end };
}

// What the page shows. d: index.js's plan deps ({ stripe, PLANS, planPrices, planOfPrice }); without them (tests, sandbox) Stripe isn't read.
// next: a pending plan change already known (after a change), else read from Stripe. Stripe is the truth for a pending switch:
// one scheduled in Change plan counts too, and a stored "switch" that Stripe no longer has (undone in Change plan, or it happened) is cleared.
// While Custom Model Selection is on for the own key (byok-custom.js), General's first model is the one that answers, so Settings shows the main model as set there:
// { on, model } where model is General's first model (null until something is saved, then the main model below is the one in use).
async function ownMain(env, tid) {
  try {
    const r = await env.DB.prepare("SELECT custom_models_own FROM tenants WHERE id=?").bind(String(tid)).first(), c = parseOwn(r?.custom_models_own);
    return { on: true, model: c?.categories?.find((x) => x.id === "general")?.chain?.[0]?.model || null, fast: c?.background?.chain?.[0]?.model || null };
  } catch { return { on: true, model: null, fast: null }; }
}
// True once General has a model chosen in Custom Model Selection (own-key).
async function ownModelChosen(env, tid) { return !!(await ownMain(env, tid)).model; }
async function stateOf(env, t, d, next) {
  const onPlan = t.plan === BYOK_PLAN, full = !onPlan, rows = await listRows(env, t.id), row = { mode: await modeOf(env, t.id) };
  const o = { on_plan: onPlan, full, plan: t.plan || "", plan_name: d?.PLANS?.[t.plan]?.name || "", price: 10, warning: ZDR_WARNING, mode: "", connections: await viewRows(env, t.id, rows), custom: await ownMain(env, t.id),
    openrouter: { manage: (await orView(env, t.id, rows.find((r) => r.kind === "openrouter") ? { source: OR_SOURCE, key_sealed: rows.find((r) => r.kind === "openrouter").key_sealed } : null).catch(() => ({}))).manage || "" }, chatgpt: { manage: CG_USAGE_PAGE }, usage: await usageCache(env, t.id, rows.map((r) => r.kind)) };
  if (onPlan) return o;
  if (next === undefined && d?.stripe && t.stripe_subscription) next = await nextPlan(env, t, d).catch((e) => { console.log("byok: subscription", String(e?.message || e).slice(0, 120)); return undefined; });
  const stored = row.mode || "", has = rows.length > 0;
  if (next === undefined) o.mode = stored;   // Stripe couldn't be read: what was chosen
  else if (next?.plan === BYOK_PLAN) { o.mode = "switch"; o.switch_at = next.at || null; if (stored !== "switch") await setMode(env, t.id, "switch"); }
  else { o.mode = stored === "fallback" ? "fallback" : ""; if (stored === "switch") await setMode(env, t.id, ""); }
  if (has && o.mode === "fallback") { try { const L = ledgerOf(env, t.id); const f = typeof L?.byokFbState === "function" ? await L.byokFbState() : null; o.fallback = { active: !!f?.active, since: f?.since || null }; } catch { o.fallback = { active: false, since: null }; } }
  return o;
}
// Choose (or change, or undo) the option. "switch" schedules the byok plan from the next bill (plan-change.js: no proration, its
// storage check); "fallback" and "" (keep my plan, key unused) put the plan's own price back first if a switch was pending.
async function chooseMode(env, t, d, mode, has) {
  if (t.plan === BYOK_PLAN) return { error: "You're on the Bring your own key plan already, so your key is simply your AI.", status: 409 };
  if (!["fallback", "switch", ""].includes(mode)) return { error: "Choose one of the two options.", status: 400 };
  if (mode && !has) return { error: "Connect your AI service first, then choose how to use it.", status: 409 };
  if (!d?.stripe) return { error: "Plans can't be changed right now. Try again in a minute.", status: 503 };
  const next = t.stripe_subscription ? await nextPlan(env, t, d) : null, pending = next?.plan === BYOK_PLAN;
  if (mode === "switch") {
    if (pending) { await setMode(env, t.id, "switch"); return { next }; }
    const r = await changePlan(env, t, BYOK_PLAN, d);
    if (r.error) return r;
    await setMode(env, t.id, "switch");
    return { next: { plan: BYOK_PLAN, name: d.PLANS[BYOK_PLAN]?.name || "", at: r.from || null } };
  }
  if (pending) {
    if (!d.PLANS[t.plan]) return { error: `Couldn't find your plan. Contact ${env.SUPPORT_EMAIL || env.EMAIL_FROM} and we'll fix it.`, status: 409 };
    const r = await changePlan(env, t, t.plan, d);   // back to the plan already paid for: nothing charged
    if (r.error) return r;
  }
  if (has) await setMode(env, t.id, mode);
  return { next: null };
}

// t: the tenant row. Returns a Response, or null when `sub` isn't a BYOK route.
// deps: { json, fetchImpl, stripe, PLANS, planPrices, planOfPrice } (the plan deps come from index.js, for the two options).
// Routes: GET /api/byok (the services and the plan option), POST connections (a service with an address and a key), opencode (the key from the OpenCode console), test { id }, remove { id },
// mode, switch-now, switch-preview, chatgpt/finish (the pasted address), chatgpt/forget and openrouter/forget (nothing is waiting any more; they answer the same state).
export async function byokApi(req, env, t, sub, { json, fetchImpl = globalThis.fetch, waitUntil = null, ...d } = {}) {
  if (!eeEnabled(env)) return singleKeyApi(req, env, t, sub, { json, fetchImpl });   // core: one saved key
  if (!/^\/api\/byok(\/(connections|opencode|opencode-plan|test|remove|mode|switch-now|switch-preview|openrouter\/forget|chatgpt\/(finish|forget)|claudecode\/(start|finish|warm)|usage))?$/.test(sub)) return null;
  const onPlan = t.plan === BYOK_PLAN;
  await orDdl(env); await cgDdl(env); await connDdl(env);
  await adoptPending(env, t.id);   // a key Sign in with OpenRouter just made becomes the OpenRouter connection
  if (sub === "/api/byok" && req.method === "GET") return json(await stateOf(env, t, d));
  // Plan usage bars: read again when the cache is stale (byok-usage.js: a failed source is remembered, so this never retries on every view). Always answers; no numbers means the page shows Manage usage.
  if (sub === "/api/byok/usage" && req.method === "GET") {
    const kinds = [...new Set((await listRows(env, t.id)).map((r) => r.kind))].filter((k) => k === "chatgpt" || k === "claudecode" || k === "opencode");
    const getters = { chatgpt: () => chatgptUsage(env, t.id, { fetchImpl }), claudecode: () => claudeUsage(env, t.id), opencode: null };
    const views = await Promise.all(kinds.map(async (k) => [k, await refreshUsage(env, t.id, k, getters[k])]));
    return json({ usage: Object.fromEntries(views) });
  }
  if (sub === "/api/byok/switch-preview" && req.method === "GET") { const r = await switchPreview(env, t, d); return json(r, r.error ? r.status || 400 : 200); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (sub === "/api/byok/switch-now") { const r = await switchNow(env, t, d, { fetchImpl }); return json(r, r.error ? r.status || 400 : 200); }
  const has = async () => (await listRows(env, t.id)).length > 0;
  if (sub === "/api/byok/mode") {
    const b = await boundedJson(req);
    const r = await chooseMode(env, t, d, String(b.mode ?? ""), await has());
    if (r.error) return json({ error: r.error, ...(r.storage ? { storage: r.storage } : {}) }, r.status || 400);
    return json({ ok: true, ...(await stateOf(env, t, d, r.next)) });
  }
  if (sub === "/api/byok/openrouter/forget" || sub === "/api/byok/chatgpt/forget") return json({ ok: true, ...(await stateOf(env, t, d)) });
  // Continue with ChatGPT: the person pastes the address their browser ended on (OpenAI's 127.0.0.1 page), and the code in it is exchanged here. The sign-in becomes the ChatGPT connection.
  if (sub === "/api/byok/chatgpt/finish") {
    const b = await boundedJson(req);
    const r = await cgFinish(env, { tenantId: t.id, pasted: b.url, fetchImpl });
    if (r.error) return json({ error: CG_WHY_TEXT[r.error] || CG_WHY_TEXT.exchange, why: r.error }, 400);
    await addChatgpt(env, t.id);
    return json({ ok: true, ...(await stateOf(env, t, d)) });
  }
  // Continue with Claude: start gives Anthropic's own address (the app opens it in a new tab), finish takes the code Anthropic shows there. The sign-in stays in the account's engine.
  // Warm: the app calls it when a channel opens and when the composer gets focus. Only an account whose General model is Claude Code starts anything, at most once every 30 seconds.
  if (sub === "/api/byok/claudecode/warm") {
    const wb = await req.clone().json().catch(() => ({})), wk = wb?.login === true ? "login:" + t.id : t.id, last = CC_WARMED.get(wk) || 0;   // login: true is sent by Settings, AI services, so the sign-in start is fast
    if (!(wb?.login === true || isCcModel((await ownMain(env, t.id)).model)) || Date.now() - last < 30e3) return json({ ok: true, warming: false });
    CC_WARMED.set(wk, Date.now()); if (CC_WARMED.size > 500) CC_WARMED.clear();
    const p = ccWarm(env, t.id); if (waitUntil) waitUntil(p);
    return json({ ok: true, warming: true });
  }
  if (sub === "/api/byok/claudecode/start") {
    if (!(await rateOk(env, t.id))) return json({ error: RATE_MSG, rate_limited: true }, 429);
    const r = await ccStart(env, t.id); if (r.error) return json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, r.status || 502);
    return json({ ok: true, url: r.url });
  }
  if (sub === "/api/byok/claudecode/finish") {
    if (!(await rateOk(env, t.id))) return json({ error: RATE_MSG, rate_limited: true }, 429);
    const b = await boundedJson(req), r = await ccFinish(env, t.id, b.code);
    if (r.error) return json({ error: r.error, field: "code", ...(r.code ? { code: r.code } : {}) }, r.status || 400);
    await addClaudeCode(env, t.id, r.account);
    return json({ ok: true, id: "claudecode", ...(await stateOf(env, t, d)) });
  }
  const b = await boundedJson(req);
  // Remove: the services' models leave Custom Model Selection too. Removing the last one ends the backup option; with a switch pending the app asks whether to cancel it (cancel_switch).
  if (sub === "/api/byok/remove") {
    const id = String(b.id ?? "");
    const rows = await listRows(env, t.id); if (!rows.find((r) => r.id === id)) return json({ error: "That service isn't connected.", status: 404 }, 404);
    let next;
    if (rows.length === 1 && b.cancel_switch === true && !onPlan) { const r = await chooseMode(env, t, d, "", false); if (r.error) return json({ error: r.error }, r.status || 400); next = r.next; }
    const r = await removeConnection(env, t.id, id, { fetchImpl });
    if (r.error) return json({ error: r.error }, r.status || 400);
    await dropUsage(env, t.id, id);
    if (r.left === 0) await env.DB.prepare("DELETE FROM byok WHERE tenant_id=?").bind(t.id).run();   // the last one: the backup option ends with it
    return json({ ok: true, removed_models: r.removed, ...(await stateOf(env, t, d, r.left === 0 ? next : undefined)) });
  }
  if (!(await rateOk(env, t.id))) return json({ error: RATE_MSG, rate_limited: true }, 429);
  // Test one connection: no paid model call (see testConnection).
  if (sub === "/api/byok/test") {
    const id = String(b.id ?? ""), row = (await listRows(env, t.id)).find((r) => r.id === id);
    if (!row) return json({ error: "That service isn't connected.", status: 404 }, 404);
    const test = await testConnection((await connCfgs(env, t.id))[id], { fetchImpl });
    await saveTest(env, t.id, id, test);
    return json({ ok: test.ok, test, ...(await stateOf(env, t, d)) });
  }
  // Switch the OpenCode connection between the Go plan and pay as you go (no key needed again).
  if (sub === "/api/byok/opencode-plan") {
    if (b.plan !== "go" && b.plan !== "payg") return json({ error: "Choose the Go plan or pay as you go.", field: "plan" }, 400);
    const r = await setOcPlan(env, t.id, b.plan); if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ ok: true, ...(await stateOf(env, t, d)) });
  }
  if (b.ack !== true) return json({ error: "Read the note about your provider and tick the box to connect.", field: "ack" }, 400);
  // Use OpenCode: the key made in the OpenCode console, pasted here. The address is fixed.
  if (sub === "/api/byok/opencode") {
    const key = String(b.key ?? "").trim();
    if (!key || !CONN_KEY_RE.test(key)) return json({ error: "Paste the key from your OpenCode console. It is one line.", field: "key" }, 400);
    const plan = ocPlan(b.plan);
    const cfg = withKey({ id: "opencode", kind: "opencode", base: ocBase(plan), plan, tenantId: t.id, host: "OpenCode", provider: OC_SOURCE, settings: "" }, key);
    const test = await testConnection(cfg, { fetchImpl });
    if (!test.ok) return json({ error: test.checks.reach.error, field: "key", test }, 400);
    await addSealed(env, t.id, "opencode", key, plan); await saveTest(env, t.id, "opencode", test);
    return json({ ok: true, id: "opencode", ...(await stateOf(env, t, d)) });
  }
  // Any service with an OpenAI-compatible API: its address and key. Tested before it is kept.
  if (sub === "/api/byok/connections") {
    const f = plainFromForm(b); if (f.error) return json({ error: f.error, field: f.field }, 400);
    const cfg = withKey({ id: "p_test", kind: "plain", base: f.chk.base, host: f.chk.host, provider: "", settings: "" }, f.key);
    const test = await testConnection(cfg, { fetchImpl });
    if (!test.ok) return json({ error: "Not connected: the connection test didn't pass. Fix what it says and try again.", test }, 400);
    const r = await addPlain(env, t.id, f); if (r.error) return json({ error: r.error }, r.status || 400);
    await saveTest(env, t.id, r.id, test);
    return json({ ok: true, id: r.id, ...(await stateOf(env, t, d)) });
  }
  return null;
}
