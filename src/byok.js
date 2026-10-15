import { boundedJson } from "./bounded-body.js";
// Bring your own AI key (Captain 2026-10-06). The "byok" plan is $10/month with 100 GB of storage and no included usage. Its AI
// model calls go to the person's own OpenAI-compatible endpoint (POST <base>/chat/completions) with their key and their models,
// so they pay their provider and 1Helm charges $0 for the AI. Everything else 1Helm runs (the computer, Browser Run, web search,
// memory, embeddings) is metered at our cost + 15% from the prepaid credits they top up (src/resident.js byokHold / byokMeter). Each
// part is reserved before it runs; if the balance can't cover it, it's skipped (memory: no recall or saving that turn), never run on credit.
//   - Settings → Use my own AI key: endpoint base URL, key, main model, optional fast model (chores: titles/labels, hand-off notes,
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
//   - Removing the key ends fallback (the row goes); with a switch pending, the app asks whether to cancel the switch too.
// On the byok plan there's no choice: the key is simply their AI.
import { sealSecret, openSecret } from "./sentinel.js";
import { enabled as eeEnabled } from "./ee/index.js";
import { changePlan, nextPlan } from "./ee/index.js";
import { OR_SOURCE, OR_BASE, orDdl, orPendingKey, orForget, orView, orModels } from "./byok-openrouter.js";
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
export { BYOK_MARKUP, METER, HS_CHUNK_CHARS, HS_FACTS_PER_CALL, HS_CONSOLIDATE_FACTS, HS_REFRESH_WINDOW_MS, hsRetainBatchNano, hsRetainNano, hsRawNano, HS_RECALL_TIERS, hsRecallNano } from "./byok-meter.js";

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
const settingsLink = (cfg) => cfg?.settings ? `[Settings → Use my own AI key](${cfg.settings})` : "Settings → Use my own AI key";
// One plain message for every failure, with a short detail (status code or reason, key stripped).
export const TEST_FAIL = "Couldn't connect to that AI service. Check the address, key and model, then try again.";
export const failText = (cfg, detail) => `Your AI service (${hostOf(cfg)}) didn't work${detail ? ` (${detail})` : ""}, so I couldn't finish this. Check the address, key and model in ${settingsLink(cfg)}.${cfg?.fallback ? ` I'm using it because your 1Helm credits are used up; adding credits brings back 1Helm's AI.` : ""}`;
const fail = (cfg, detail, http = 0) => new ByokError(failText(cfg, detail), http, detail);
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
async function readCapped(cfg, body, max, what = "answer") {
  if (!body) return "";
  const reader = body.getReader(), dec = new TextDecoder(); let n = 0, s = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    n += value.byteLength; if (n > max) { reader.cancel().catch(() => {}); throw fail(cfg, `its ${what} was too big`); }
    s += dec.decode(value, { stream: true });
  }
  return s + dec.decode();
}
async function errorDetail(cfg, r) {
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
function guardStream(cfg, body, signal) {
  const reader = body.getReader(), t0 = Date.now(); let bytes = 0;
  return new ReadableStream({
    async pull(c) {
      const left = TOTAL_MS - (Date.now() - t0);
      let timer;
      const to = new Promise((_, no) => { timer = setTimeout(() => no(fail(cfg, left <= IDLE_MS ? "the answer took too long to finish" : "it stopped sending in the middle of the answer")), Math.max(0, Math.min(IDLE_MS, left))); });
      try {
        const { value, done } = await Promise.race([reader.read(), to]);
        if (done) { c.close(); return; }
        bytes += value.byteLength;
        if (bytes > MAX_STREAM_BYTES) { reader.cancel().catch(() => {}); c.error(fail(cfg, "its answer was too big")); return; }
        c.enqueue(value);
      } catch (e) { reader.cancel().catch(() => {}); c.error(signal?.aborted ? e : e?.byok ? e : fail(cfg, "the connection dropped in the middle of the answer")); }
      finally { clearTimeout(timer); }
    },
    cancel(x) { return reader.cancel(x); },
  });
}
// Up to the first real event: an error event before any output throws (with the provider's words); otherwise the bytes already read
// are put back in front of the rest.
async function firstEventOk(cfg, stream) {
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
export async function byokChat(cfg, body, { fast = false, signal = null, fetchImpl = globalThis.fetch, privacy = null, noTemperature = null } = {}) {
  if (!cfg || cfg.missing || typeof cfg.key !== "string") throw new ByokError(missingText(cfg));   // "" = no key (Ollama, LM Studio, vLLM…)
  const model = fast ? (cfg.fast || cfg.model) : cfg.model, req = { ...byokBody(body, model), ...byokPrivacyFields(cfg, privacy) };
  if (body.response_format?.type === "json_schema" && isOpenRouterBase(cfg.base)) {
    req.provider = { ...req.provider, require_parameters: true };
    // These OpenRouter endpoints advertise schemas but not temperature; strict parameter filtering otherwise
    // rejects the request before inference. Respect the person's selected main/fast model and every privacy field.
    if (noTemperature?.(model)) delete req.temperature;   // the saved facts of that model say it has no temperature setting
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

// ---- Test connection: reach + tool calling (main model), streaming (main model), and the fast model if it's different ----
// Every failed check: the one standard message, then a short detail line from the actual error (key stripped).
const testErr = (cfg, e, prefix = "") => {
  const detail = `${prefix}${e?.byok ? e.detail || "" : redact(e?.message || e, cfg.key, 100)}`.replace(/\.$/, "");
  return { ok: false, error: detail ? `${TEST_FAIL} Details: ${detail}.` : TEST_FAIL, detail };
};
const PING_TOOL = { type: "function", function: { name: "ping", description: "Connection test. Call it with word set to \"ok\".", parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } } };
export async function testByok(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now(), checks = {};
  const done = () => ({ ok: ["reach", "tools", "stream", "fast"].every((k) => !checks[k] || checks[k].ok), checks, ms: Date.now() - t0, at: Date.now() });
  try {
    const s = Date.now(), r = await byokChat(cfg, { messages: [{ role: "system", content: "This is a connection test. Answer only by calling the ping tool." }, { role: "user", content: "Call the ping tool with word set to \"ok\"." }],
      tools: [PING_TOOL], max_tokens: 2000 }, { fetchImpl }), j = await r.json();
    checks.reach = { ok: true, ms: Date.now() - s, model: String(j.model || cfg.model).slice(0, 120) };
    const call = (j.choices?.[0]?.message?.tool_calls || [])[0];
    checks.tools = call?.function?.name === "ping" ? { ok: true } : testErr(cfg, { byok: true, detail: "the model answered in words instead of calling a tool; 1Helm needs a model with tool (function) calling" });
  } catch (e) { checks.reach = testErr(cfg, e); return done(); }
  try {
    const r = await byokChat(cfg, { messages: [{ role: "user", content: "Reply with the word OK." }], stream: true, max_tokens: 400 }, { fetchImpl });
    const text = await readCapped(cfg, r.body, 1 << 20);
    const evs = text.split("\n").filter((l) => l.startsWith("data:") && l.slice(5).trim() !== "[DONE]").map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).filter(Boolean);
    checks.stream = evs.some((e) => Array.isArray(e.choices)) ? { ok: true, events: evs.length } : testErr(cfg, { byok: true, detail: "the service didn't stream its answer; 1Helm needs streaming (stream: true)" });
  } catch (e) { checks.stream = testErr(cfg, e); }
  if (cfg.fast && cfg.fast !== cfg.model) {
    try { const r = await byokChat(cfg, { messages: [{ role: "user", content: "Reply with the word OK." }], max_tokens: 400 }, { fast: true, fetchImpl }); await r.json(); checks.fast = { ok: true, model: cfg.fast }; }
    catch (e) { checks.fast = testErr(cfg, e, `fast model ${cfg.fast}: `); }
  }
  return done();
}

// ---- stored config ----
const appUrl = (env, slug, sec = "byok") => `https://${env.GATEWAY_HOST || env.APP_HOST}/w/${slug}/app?settings=${sec}`;
function withKey(o, key) { Object.defineProperty(o, "key", { value: key, enumerable: false, writable: false }); return o; }
// The account's own-AI-key config: on the byok plan { base, host, model, fast, settings, credits, last4, key (hidden) }, or
// { missing: true } when no key is saved yet. On a full plan with mode "fallback" and a readable key: the same with fallback: true
// (used only once its credits run out: Resident.byokRefresh / byokFallbackOn decide). null otherwise (AI goes to 1Helm's own models).
async function byokRow(env, tenantId) {
  const q = (mode) => env.DB.prepare(`SELECT t.plan, t.slug, t.helper_name, b.base_url, b.model, b.fast_model, b.key_sealed, b.key_last4${mode ? ", b.mode" : ""} FROM tenants t LEFT JOIN byok b ON b.tenant_id=t.id WHERE t.id=?`).bind(tenantId).first();
  try { return await q(true); } catch (e) { if (/no such column/i.test(String(e?.message))) return q(false); throw e; }   // before migration 033
}
export async function loadByok(env, tenantId) {
  if (!env?.DB || !tenantId) return null;
  const r = await byokRow(env, tenantId);
  if (!r) return null;
  const onPlan = !eeEnabled(env) || r.plan === BYOK_PLAN;
  if (!onPlan && r.mode !== "fallback") return null;
  const settings = appUrl(env, r.slug), credits = appUrl(env, r.slug, "credits");
  if (r.key_sealed == null || !r.base_url || !r.model) return onPlan ? { missing: true, settings } : null;
  const chk = checkBase(r.base_url);
  let key = ""; if (r.key_sealed) try { key = await openSecret(env, r.key_sealed); } catch { return onPlan ? { missing: true, unreadable: true, settings } : null; }   // never fall back to 1Helm's AI
  return withKey({ base: r.base_url, host: chk.host || "", model: r.model, fast: r.fast_model || r.model, last4: r.key_last4 || "", settings, credits, helper: r.helper_name || "", ...(onPlan ? {} : { fallback: true }) }, key);
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

// ---- Settings API (/api/byok…) ----
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const KEY_RE = /^[^\x00-\x1f\x7f]{0,4000}$/;   // any length, even empty (no key); only no line breaks/control characters (it goes into a header)
const now = () => Date.now();
async function savedRow(env, tid) { return env.DB.prepare("SELECT * FROM byok WHERE tenant_id=?").bind(tid).first(); }
function view(row) {
  if (!row) return null;
  let test = null; try { test = row.test_json ? JSON.parse(row.test_json) : null; } catch {}
  return { base: row.base_url, host: checkBase(row.base_url).host || "", model: row.model, fast: row.fast_model || "", last4: row.key_last4 || "", saved_at: row.updated_at, tested_at: row.tested_at || null, test, ...(row.source === OR_SOURCE ? { source: OR_SOURCE } : {}) };   // source: signed in with OpenRouter
}
// Fields from the form → a config to test/save. The key may be left empty: with a saved key, that keeps it, but only for the same
// origin (scheme + host + port): pointing the saved key at a different address needs the key typed again. With no saved key (or a
// saved empty one), empty means no key at all (self-hosted servers like Ollama, LM Studio, vLLM): no Authorization header is sent.
// source "openrouter" (Sign in with OpenRouter, byok-openrouter.js): the address is OpenRouter's and the key is the one the sign-in
// gave (waiting in byok_or_key), or the saved one when it came from that sign-in too (only the models change). Never a typed key.
async function formCfg(env, t, b, row) {
  const or = b.source === OR_SOURCE;
  const chk = checkBase(or ? OR_BASE : b.base); if (!chk.ok) return { error: chk.error, field: "base" };
  const model = String(b.model ?? "").trim(), fast = String(b.fast ?? "").trim();
  if (!MODEL_RE.test(model)) return { error: "Enter the model name exactly as your service lists it, like gpt-4o-mini.", field: "model" };
  if (fast && !MODEL_RE.test(fast)) return { error: "Enter the fast model's name exactly as your service lists it, or leave it empty.", field: "fast" };
  let key = or ? "" : String(b.key ?? "").trim();
  if (or) {
    const waiting = await orPendingKey(env, t.id);
    if (waiting != null) key = waiting;
    else if (row?.source === OR_SOURCE && row.key_sealed) { try { key = await openSecret(env, row.key_sealed); } catch { return { error: "Sign in with OpenRouter again.", field: "or" }; } }
    else return { error: "Sign in with OpenRouter first.", field: "or" };
    if (!key || !KEY_RE.test(key)) return { error: "Sign in with OpenRouter again.", field: "or" };
  } else if (!key) {
    if (row?.key_sealed) {
      if (checkBase(row.base_url).origin !== chk.origin) return { error: "You changed the address, so enter the key again.", field: "key" };
      try { key = await openSecret(env, row.key_sealed); } catch { return { error: "Enter your key again.", field: "key" }; }
    }
  } else if (!KEY_RE.test(key)) return { error: "That key doesn't look right: it should be one line, up to 4000 characters.", field: "key" };
  return { cfg: withKey({ base: chk.base, host: chk.host, model, fast: fast && fast !== model ? fast : model, last4: key.slice(-4) }, key), fastIn: fast && fast !== model ? fast : "", source: or ? OR_SOURCE : "" };
}
async function rateOk(env, tid) {
  await env.DB.prepare("DELETE FROM byok_tests WHERE at<?").bind(now() - 3600e3).run().catch(() => {});
  const n = Number((await env.DB.prepare("SELECT COUNT(*) n FROM byok_tests WHERE tenant_id=? AND at>?").bind(tid, now() - TEST_WINDOW_MS).first())?.n || 0);
  if (n >= TEST_LIMIT) return false;
  await env.DB.prepare("INSERT INTO byok_tests (tenant_id, at) VALUES (?,?)").bind(tid, now()).run();
  return true;
}
const RATE_MSG = "That's a lot of tests in a few minutes. Wait a few minutes and try again.";
// ---- the two options on a full plan ----
const setMode = (env, tid, mode) => env.DB.prepare("UPDATE byok SET mode=? WHERE tenant_id=?").bind(mode, tid).run().catch((e) => { if (!/no such column/i.test(String(e?.message))) throw e; });
const ledgerOf = (env, tid) => { try { return env.LEDGER.get(env.LEDGER.idFromName(`tenant:${tid}`)); } catch { return null; } };
// What the page shows. d: index.js's plan deps ({ stripe, PLANS, planPrices, planOfPrice }); without them (tests, sandbox) Stripe isn't read.
// next: a pending plan change already known (after a change), else read from Stripe. Stripe is the truth for a pending switch:
// one scheduled in Change plan counts too, and a stored "switch" that Stripe no longer has (undone in Change plan, or it happened) is cleared.
async function stateOf(env, t, d, row, next) {
  const onPlan = !eeEnabled(env) || t.plan === BYOK_PLAN, full = !onPlan, o = { on_plan: onPlan, full, plan: t.plan || "", plan_name: eeEnabled(env) ? d?.PLANS?.[t.plan]?.name || "" : "Self-hosted", price: eeEnabled(env) ? 10 : 0, warning: ZDR_WARNING, saved: view(row), mode: "",
    openrouter: await orView(env, t.id, row).catch(() => ({ pending: null, manage: "" })) };
  if (onPlan) return o;
  if (next === undefined && d?.stripe && t.stripe_subscription) next = await nextPlan(env, t, d).catch((e) => { console.log("byok: subscription", String(e?.message || e).slice(0, 120)); return undefined; });
  const stored = row?.mode || "";
  if (next === undefined) o.mode = stored;   // Stripe couldn't be read: what was chosen
  else if (next?.plan === BYOK_PLAN) { o.mode = "switch"; o.switch_at = next.at || null; if (row && stored !== "switch") await setMode(env, t.id, "switch"); }
  else { o.mode = stored === "fallback" ? "fallback" : ""; if (row && stored === "switch") await setMode(env, t.id, ""); }
  if (row && o.mode === "fallback") { try { const L = ledgerOf(env, t.id); const f = typeof L?.byokFbState === "function" ? await L.byokFbState() : null; o.fallback = { active: !!f?.active, since: f?.since || null }; } catch { o.fallback = { active: false, since: null }; } }
  return o;
}
// Choose (or change, or undo) the option. "switch" schedules the byok plan from the next bill (plan-change.js: no proration, its
// storage check); "fallback" and "" (keep my plan, key unused) put the plan's own price back first if a switch was pending.
async function chooseMode(env, t, d, mode, row) {
  if (t.plan === BYOK_PLAN) return { error: "You're on the Bring your own key plan already, so your key is simply your AI.", status: 409 };
  if (!["fallback", "switch", ""].includes(mode)) return { error: "Choose one of the two options.", status: 400 };
  if (mode && !row) return { error: "Save your key first, then choose how to use it.", status: 409 };
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
  if (row) await setMode(env, t.id, mode);
  return { next: null };
}

// t: the tenant row. Returns a Response, or null when `sub` isn't a BYOK route.
// deps: { json, fetchImpl, stripe, PLANS, planPrices, planOfPrice } (the plan deps come from index.js, for the two options).
export async function byokApi(req, env, t, sub, { json, fetchImpl = globalThis.fetch, ...d } = {}) {
  if (!/^\/api\/byok(\/(test|save|delete|mode|models|openrouter\/forget))?$/.test(sub)) return null;
  const onPlan = !eeEnabled(env) || t.plan === BYOK_PLAN;
  if (!eeEnabled(env) && sub === "/api/byok/mode") return json({ error: "not found" }, 404);
  await orDdl(env);
  if (sub === "/api/byok" && req.method === "GET") return json(await stateOf(env, t, d, await savedRow(env, t.id)));
  // OpenRouter's model list for the model fields (only models with tool calling; public, no key involved).
  if (sub === "/api/byok/models" && req.method === "GET") { try { return json({ models: await orModels({ fetchImpl }) }); } catch (e) { console.log("byok: openrouter models", String(e?.message || e).slice(0, 80)); return json({ models: [], error: "Couldn't load OpenRouter's model list. You can still type a model name." }); } }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (sub === "/api/byok/mode") {
    const b = await boundedJson(req), row = await savedRow(env, t.id);
    const r = await chooseMode(env, t, d, String(b.mode ?? ""), row);
    if (r.error) return json({ error: r.error, ...(r.storage ? { storage: r.storage } : {}) }, r.status || 400);
    return json({ ok: true, ...(await stateOf(env, t, d, await savedRow(env, t.id), r.next)) });
  }
  if (sub === "/api/byok/delete") {
    // A switch to the byok plan pending: cancel_switch (the app asked) puts the plan's own price back first; otherwise the switch stays.
    const b = await boundedJson(req);
    let next;
    if (b.cancel_switch === true && !onPlan) { const r = await chooseMode(env, t, d, "", null); if (r.error) return json({ error: r.error }, r.status || 400); next = r.next; }
    await env.DB.prepare("DELETE FROM byok WHERE tenant_id=?").bind(t.id).run();
    await orForget(env, t.id);   // a key from Sign in with OpenRouter that was still waiting for its models goes too
    return json({ ok: true, ...(await stateOf(env, t, d, null, next)) });
  }
  // Signed in with OpenRouter but changed their mind before saving: forget only the waiting key (a saved setup stays).
  if (sub === "/api/byok/openrouter/forget") { await orForget(env, t.id); return json({ ok: true, ...(await stateOf(env, t, d, await savedRow(env, t.id))) }); }
  const b = await boundedJson(req), row = await savedRow(env, t.id);
  const f = await formCfg(env, t, b, row); if (f.error) return json({ error: f.error, field: f.field }, 400);
  if (sub === "/api/byok/save" && b.ack !== true) return json({ error: "Read the note about your provider and tick the box to save.", field: "ack" }, 400);
  if (!(await rateOk(env, t.id))) return json({ error: RATE_MSG, rate_limited: true }, 429);
  const test = await testByok(f.cfg, { fetchImpl });
  if (sub === "/api/byok/test") return json({ ok: test.ok, test });
  if (!test.ok) return json({ error: "Not saved: the connection test didn't pass. Fix what it says and try again.", test }, 400);
  const at = now();
  await env.DB.prepare(`INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,test_json,tested_at,created_at,updated_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET base_url=excluded.base_url, model=excluded.model, fast_model=excluded.fast_model, key_sealed=excluded.key_sealed, key_last4=excluded.key_last4,
      test_json=excluded.test_json, tested_at=excluded.tested_at, updated_at=excluded.updated_at, source=excluded.source`)
    .bind(t.id, f.cfg.base, f.cfg.model, f.fastIn, f.cfg.key ? await sealSecret(env, f.cfg.key) : "", f.cfg.last4, JSON.stringify(test), test.at, at, at, f.source).run();
  await orForget(env, t.id);   // saved: a waiting OpenRouter key is now this row (or was set aside for a pasted key)
  return json({ ok: true, test, ...(await stateOf(env, t, d, await savedRow(env, t.id))) });
}
