// Task-aware model routing (ROUTER_MODE="two"; Captain 2026-10-08, notes/2026-10-08-privacy-routing/PROMPT.md). Replaces the two-model
// Sol/Luna rule. Per message from the person, ONE decider call (decider.js: Perplexity, perplexity/pplx-decider-v1.1-27b, env
// DECIDER_MODEL the kill switch) answers three questions on the last few messages: is it part of a task (stats only), which task
// CATEGORY it is (pool.js CATEGORIES), and whether an earlier result fell short (quality recovery). The category × the account's AI
// data privacy level (privacy.js) gives the ordered model list (pool.js CHAINS). The decider never chooses reasoning effort: every
// managed model has one fixed effort (pool.js POOL), applied on the wire in model.js twoChat, fallbacks included.
// No decider call: unattended runs (scheduled jobs, follow-ups, helpers) and a bare "keep going" with work open reuse the task's
// category (stored per session), else "general". A decider error/timeout/garbage → the task's category, else "general" (cheapest).
// One model per turn (switching breaks the prompt cache), except a deliberate quality-recovery switch:
//   - before the turn: the person says an earlier result fell short (decider `unmet`) or asks for the best model → pool.js RECOVERY by
//     category (apps → Haiku, technical/spreadsheet → Sol, directly; research/general → a corrected approach, research may also take
//     the chain's alternate). Requirements, corrections and tool state are in the context the new model reads.
//   - inside the turn: concrete failures (the same tool failing twice, stalled steps, two malformed calls, "I'm stuck" after tool
//     work) → Sol for the rest of the turn, once. No walk down the availability chain.
// Availability fallback (model.js twoChat): the chain for the category at the CURRENT privacy level (re-read on every dispatch),
// filtered by endpoint eligibility, deduplicated, bounded; each attempt carries the destination model's fixed effort.
// Prompt cache: one key per channel (Resident.callModel), so the shared prefix stays warm across the channel's tasks.
// Chores never use the pool routing: hand-off notes go to gpt-oss (choreRouteFor, CHORE_MODEL); the browser agent, summaries and
// labellers keep their own routes, always on zero-data-retention endpoints (stricter than any level).
// The classic router (router.js) stays behind ROUTER_MODE="classic". Jev Router (typesafe/jev-router) is never used in two mode.

import { testModelFor, testRoute } from "../internal-test-model.js";   // dev test workspaces: no decider call, one model (TEST_MODEL)
import { deciderFetch, deciderModel, deciderProvider } from "./decider.js";
import { modelSettingsEnv, slotModel, replacementModel, configuredHosts } from "./model-settings.js";
import { startShadow, shadowOn, residentWaitUntil } from "./decision-shadow.js";   // dev only: another decider next to the live one, never decides
import { privacyOf, normalizePrivacy, eligibleHosts, ineligibleWhy } from "../privacy.js";
import { SOL, LUNA, HAIKU, POOL_MODELS, CATEGORIES, CATEGORY_LABEL, DEFAULT_CATEGORY, RECOVERY, IN_TURN_TARGET, MAX_MODELS, normalizeCategory, chainModels, fixedEffort, aliasOf, guessCategory, autoToolsOnly } from "./pool.js";

export { SOL, LUNA, HAIKU };
export const ROUTER_TWO = "two";
export const route2On = (env) => env?.ONEHELM_EE === "1hc" && String(env?.ROUTER_MODE || "classic").trim().toLowerCase() === ROUTER_TWO;
export const JEV = "~typesafe/jev-latest";            // the old decider: kept only as the router lab's baseline / DECIDER_MODEL kill-switch value
export const TWO_MODELS = POOL_MODELS;                 // every model the main chat may use (pool.js)

// The person asks for the best model → treated as an explicit request for a more thorough attempt (RECOVERY), never an effort change.
export const BEST_RE = /\b(use (your|the) (best|smartest|strongest|top|most powerful|biggest) (model|brain|ai)|your (best|smartest|strongest|most powerful) (model|ai))\b/i;
// A bare go-on ("Keep going.", "continue", "ok, go ahead") that carries on work already under way keeps the task's category, no decider call.
export const CONTINUE_RE = /^\s*(?:(?:ok(?:ay)?|yes|sure)[,.!]?\s+)?(?:please\s+)?(?:keep going|continue|carry on|go on|go ahead|proceed|resume|keep at it|finish (?:it|up))(?:,?\s*please)?[.!]*\s*$/i;
// Chores (nobody waits on them or reads them directly): gpt-oss-120b, fastest ZDR host first.
export const CHORE_ROUTE = { model: "openai/gpt-oss-120b", host: "cerebras", effort: "default", fallbacks: [], only: true, chore: true };
// Which model runs a chore (CHORE_MODEL, eval 2026-10-06 in tmp-shots/oss20): "oss120" (default, unset), "oss20", "dsflash" or "haiku". Per chore:
// CHORE_MODEL_HANDOFF / CHORE_MODEL_LABEL / CHORE_MODEL_BROWSER / CHORE_MODEL_NOTES override it. gpt-oss-20b isn't on Cerebras. Its fastest ZDR host is
// Amazon Bedrock, pinned. "dsflash": DeepSeek V4.1 Flash with reasoning off, pinned to its fastest ZDR hosts (Together, Modal, CoreWeave).
// These chore configurations are internal background calls with their own fixed settings; they are not the managed pool's routing
// (pool.js), and they stay on zero-data-retention endpoints at every privacy level.
// "haiku": Claude Haiku 5.5 with reasoning OFF, pinned to its ZDR hosts (Amazon Bedrock first, then Google Vertex; privacy.js ENDPOINTS).
// Reasoning is off on purpose: these are fixed-settings chores, not the pool (pool.js fixedEffort is for the main chat). The Live notes
// note-taker (replay 2026-10-08, tmp-shots/stt + tmp-shots/notetaker) on gpt-oss-120b spent its 1500-token cap on reasoning in 8 of 23
// passes and returned nothing readable; Haiku with reasoning off had 0 unreadable passes, similar notes, and cost less.
export const CHORE_MODELS = { oss120: { model: "openai/gpt-oss-120b", hosts: ["cerebras"] }, oss20: { model: "openai/gpt-oss-20b", hosts: ["amazon-bedrock"], pin: true },
  dsflash: { model: "deepseek/deepseek-v4.1-flash", hosts: ["together", "modal", "coreweave"], pin: true, effort: "none" },
  haiku: { model: "anthropic/claude-haiku-5.5", hosts: ["amazon-bedrock", "google-vertex"], pin: true, effort: "none" } };
export const CHORES = ["handoff", "label", "browser", "notes"];
// A chore's own default when CHORE_MODEL_<CHORE> isn't set: the Live notes note-taker (and its auto-refine draft) is Haiku
// (Captain 2026-10-08). CHORE_MODEL_NOTES still overrides it; the global CHORE_MODEL doesn't (it predates this choice).
export const CHORE_DEFAULTS = { notes: "haiku" };
export function choreModelOf(env, chore) {
  const own = env?.[`CHORE_MODEL_${String(chore).toUpperCase()}`], def = CHORE_DEFAULTS[chore];
  const v = String(own || def || env?.CHORE_MODEL || "oss120").trim().toLowerCase();
  return CHORE_MODELS[v] ? v : def || "oss120";
}
// The attempts for one chore, in order: [{model, host, effort, pin}]. host is a string or a list (OpenRouter provider.order).
export function choreAttempts(env, chore, effort = "default") {
  const k = choreModelOf(env, chore), m = CHORE_MODELS[k], a = { model: m.model, host: m.hosts.length > 1 ? m.hosts : m.hosts[0], effort: m.effort || effort, ...(m.pin ? { pin: true } : {}) };
  return k === "oss120" ? [a] : [a, { model: CHORE_MODELS.oss120.model, host: CHORE_MODELS.oss120.hosts[0], effort }];
}
// The hand-off route for this env: CHORE_ROUTE itself by default, else the chosen model with 120b behind it.
export function choreRoute(env, chore = "handoff") {
  const [a, ...rest] = choreAttempts(env, chore, CHORE_ROUTE.effort);
  return rest.length ? { ...CHORE_ROUTE, model: a.model, host: a.host, pin: a.pin, effort: a.effort, fallbacks: rest } : CHORE_ROUTE;
}

export const JEV_URL = "https://openrouter.ai/api/v1/systemone";
export const JEV_TIMEOUT_MS = 4000;                     // a slow decider never holds the reply: timeout → the task's category / general
export const JEV_CONVO_BELOW = 0.35, JEV_TASK_FROM = 0.65;   // is_task bands (stats only)
export const UNMET_FROM = 0.6;                           // P(unmet) at or above this → quality recovery
export const JEV_CONTEXT_MSGS = 4;                      // last few user/assistant messages the decider sees
export const JEV_MSG_CHARS = 800, JEV_TEXT_CHARS = 2000;
export const JEV_MARKUP = 1.15;                         // billed like every model call: usage.cost × 1.15 (resident.js MARKUP)
export const JEV_QUESTION = "Is the latest message from the person part of a task, rather than plain conversation? "
  + "A task needs tools, planning, browsing, code, files, money or several steps. "
  + "A short reply such as done, ok, yes, go ahead, try again or a correction that continues an open task (previous_turn_used_tools is true, or open_work is not none) is a task. "
  + "Plain conversation is a quick question, chit-chat, thanks or a short answer that needs no tools.";
export const CATEGORY_QUESTION = "What kind of work does the latest message ask for? Judge the specific task, not the broad topic: making or editing a spreadsheet is spreadsheet even when it's about money; "
  + "researching financial, legal or tax sources is research; a difficult code migration is technical; app building means building software, not using Gmail or another connected app. "
  + "A short reply that continues open work (ok, go ahead, try again, a correction) belongs to the work already under way in the conversation.";
export const CATEGORY_CRITERIA = {
  general: "Everyday conversation and general help: questions, chat, advice, writing, email, calendar, reminders, using connected apps.",
  research: "Researching or analysing information, especially finance, investing, legal, contracts or tax: finding, reading and comparing sources.",
  apps_economical: "Building software (a simple app, website, script, game or small tool) where a quick, economical working version is fine.",
  skills: "Carrying out a routine multi-step job with the helper's skills: travel planning, booking, shopping, forms, or a document, deck or PDF from a clear brief.",
  spreadsheet: "Creating or editing a spreadsheet or workbook: formulas, financial models, budgets, CSV or Excel files.",
  technical: "Demanding technical work: real coding or debugging, terminal and server work, failing builds or tests, data or code migrations.",
  apps_complete: "Building software where the person stresses it must be complete and fully working, with every feature functional.",
};
export const UNMET_QUESTION = "Does the latest message say an earlier result in this conversation fell short: it doesn't work, something is missing, wrong or incomplete, it isn't what they asked for, "
  + "they repeat a correction, or they ask for a more thorough attempt? A plain follow-up question, thanks, or a new request is No.";

// Route objects: what callModel / openRouterChat read. reason/floor keep the "[reason/floor]" label in turn stats, e.g.
// "deepseek/deepseek-v4.1-flash [policy/deepseek general·zdr decider]". level is informational: dispatch re-reads the current level.
export function policyRoute(category, level, why, { recovery = null, note = null } = {}) {
  category = normalizeCategory(category); level = normalizePrivacy(level);
  const chain = chainModels(category, level), first = recovery && POOL_MODELS.includes(recovery) ? recovery : chain[0], k = aliasOf(first);
  return { two: true, policy: true, category, level, why, primary: first, model: first, effort: fixedEffort(first), ...(recovery ? { recovery: first } : {}), ...(note ? { note } : {}),
    fallbacks: chain.filter((m) => m !== first), only: true, label: `${k}/${category} ${why}`, reason: "policy", floor: `${k} ${category}·${level} ${why}` };
}
// Legacy: an old Sol/Luna route (stored on a turn journaled before this deploy and resumed after it) keeps its model first.
export function twoRoute(model, why) { return policyRoute(DEFAULT_CATEGORY, "zdr", why, { recovery: model }); }
// openRouterChat calls this around each attempt so the label always names the model that actually answered.
export function markServed(route, model, fellBack = false) {
  if (!route?.two) return; const k = aliasOf(model) || String(model).split("/").pop(), why = fellBack ? "fallback" : route.why;
  route.served = model; route.floor = `${k} ${route.category || DEFAULT_CATEGORY}·${route.level || "zdr"} ${why}`; route.label = `${k}/${route.category || DEFAULT_CATEGORY} ${why}`;
}

export function verdict(p) {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return "unsure";
  return p < JEV_CONVO_BELOW ? "conversation" : p >= JEV_TASK_FROM ? "task" : "unsure";
}

// The questions and the systemone body. The decision shadow (decision-shadow.js) and the router lab send these same questions.
export const JEV_QUESTIONS = { is_task: { type: "noul", instructions: JEV_QUESTION }, category: { type: "choice", instructions: CATEGORY_QUESTION, criteria: CATEGORY_CRITERIA },
  unmet: { type: "noul", instructions: UNMET_QUESTION } };
export const jevBody = (state, env = null) => ({ model: deciderModel(env), provider: deciderProvider(deciderModel(env)), state, questions: JEV_QUESTIONS });
// A choice answer → a category id, or null (missing/invalid). Accepts { choice } or { probabilities } (the most likely offered id).
export function categoryOf(a) {
  if (!a || typeof a !== "object") return null;
  if (typeof a.choice === "string" && CATEGORIES.includes(a.choice)) return a.choice;
  if (a.probabilities && typeof a.probabilities === "object") { const best = Object.entries(a.probabilities).filter(([k, p]) => CATEGORIES.includes(k) && typeof p === "number").sort((x, y) => y[1] - x[1])[0]; return best ? best[0] : null; }
  return null;
}

// One decider call, three questions. Never throws: { p, category, unmet, cost, ms, model, error }.
export async function jevAsk(env, state, { fetchImpl = globalThis.fetch, timeoutMs = JEV_TIMEOUT_MS, meta = {} } = {}) {
  const t0 = Date.now(), ac = new AbortController(), timer = setTimeout(() => ac.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" })), timeoutMs);
  try {
    env = await modelSettingsEnv(env);
    const r = await deciderFetch(env, JSON.stringify(jevBody(state, env)), { signal: ac.signal, title: "1Helm router", meta, fetchImpl });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { p: null, cost: 0, ms: Date.now() - t0, error: `decider ${r.status}: ${JSON.stringify(j?.error || j || "").slice(0, 160)}` };
    const p = j.answers?.is_task?.noul, u = j.answers?.unmet?.noul, category = categoryOf(j.answers?.category);
    return { p: typeof p === "number" ? p : null, category, unmet: typeof u === "number" ? u : null, cost: Number(j.usage?.cost) || 0, ms: Date.now() - t0, model: j.model || null,
      ...(category ? {} : { error: "decider: no category" }) };
  } catch (e) { return { p: null, cost: 0, ms: Date.now() - t0, error: `decider: ${String(e?.name === "TimeoutError" || ac.signal.aborted ? "timeout" : e?.message || e).slice(0, 160)}` }; }
  finally { clearTimeout(timer); }
}

// The decider's state: the last few messages (context notes left out), whether the previous turn used tools, open work, and the task's
// category so far (so "it still doesn't work" is read against the work under way).
export function jevState({ hist = [], text = "", prevTools = 0, openWork = [], prevCategory = null }) {
  const flat = (c) => Array.isArray(c) ? c.filter((x) => x?.type === "text").map((x) => x.text).join(" ") : String(c ?? "");
  const conversation = hist.filter((m) => (m.role === "user" || m.role === "assistant") && !flat(m.content).startsWith("(Context note") && flat(m.content) !== "Noted.")
    .slice(-JEV_CONTEXT_MSGS).map((m) => ({ role: m.role, content: flat(m.content).slice(0, JEV_MSG_CHARS) }));
  return { conversation, previous_turn_used_tools: prevTools > 0, open_work: openWork.length ? openWork.join("; ") : "none",
    ...(prevCategory ? { task_so_far: CATEGORY_LABEL[prevCategory] || prevCategory } : {}), latest_message: String(text).slice(0, JEV_TEXT_CHARS) };
}

// The decider's answers → the route. Pure: chooseTwo, the decision shadow and the router lab all use it.
//   category: the decider's choice; missing → the task's category so far, else general.
//   recovery: unmet ≥ UNMET_FROM, or "use your best model" → RECOVERY for the task's category (the work that fell short).
export function routeFromAnswers(env, text, { p = null, category = null, unmet = null, error = null } = {}, { level = "zdr", prevCategory = null } = {}) {
  const v = error && !category ? "unsure" : verdict(p);
  const cat = normalizeCategory(category || prevCategory || DEFAULT_CATEGORY);
  const best = BEST_RE.test(String(text || "")), fell = typeof unmet === "number" && unmet >= UNMET_FROM;
  if (fell || best) {
    const base = normalizeCategory(prevCategory || cat), rc = RECOVERY[base], why = fell ? `recover:${base}` : "ask:best";
    const alt = rc.alternate ? chainModels(base, normalizePrivacy(level))[1] : null;
    return { route: policyRoute(base, level, why, { recovery: rc.model || alt, note: rc.note || null }), verdict: "recover" };
  }
  return { route: policyRoute(cat, level, category ? "decider" : error ? "decider:unsure" : "default"), verdict: v };
}
// What the dashboard shows for one side (decision-shadow.js judge): the route's model is the comparison key, the label the second one.
export function routeJudge(env, text, ctx = {}) {
  return (a) => {
    const err = a?.error || null, ans = err ? { error: err } : { p: a?.is_task?.noul ?? null, category: categoryOf(a?.category), unmet: a?.unmet?.noul ?? null };
    const { route, verdict: label } = routeFromAnswers(env, text, ans, ctx);
    return { key: route.model, label, route: aliasOf(route.model), why: route.why, category: route.category, effort: route.effort, p: ans.p ?? null, unmet: ans.unmet ?? null };
  };
}

// The routes decided without asking the decider (a job, a bare go-on with work open), or null when the message goes to the decider.
// The decision shadow's test-mode probe uses the same gates, so it only probes messages the decider would really see.
export function jevGate(env, { kind = "chat", text, prevTools = 0, openWork = [], prevCategory = null, level = "zdr" }) {
  if (kind !== "chat") return policyRoute(prevCategory || DEFAULT_CATEGORY, level, "job");
  if (CONTINUE_RE.test(String(text || "")) && (prevTools > 0 || openWork.length)) return policyRoute(prevCategory || DEFAULT_CATEGORY, level, "continue");
  return null;
}
// The decider's answer in the decision shadow's shape (decision-shadow.js startShadow finish / jevProbe).
export const jevOutcome = (jev) => jev.error && !jev.category ? { error: jev.error, ms: jev.ms } : { answers: { is_task: { noul: jev.p }, category: { choice: jev.category }, unmet: { noul: jev.unmet } }, ms: jev.ms, nano: Math.round((jev.cost || 0) * 1e9), src: jev.cost ? "reported" : null, model: jev.model || null };

export async function chooseTwo(env, { kind = "chat", text, hist, prevTools = 0, openWork = [], prevCategory = null, level = "zdr" }, opts = {}) {
  const g = jevGate(env, { kind, text, prevTools, openWork, prevCategory, level }); if (g) return { route: g, jev: null };
  const state = jevState({ hist, text, prevTools, openWork, prevCategory }), jevP = jevAsk(env, state, opts);   // the decider's request is on its way first
  let sh = null; try { sh = opts.shadow?.({ kind: "route", state, questions: JEV_QUESTIONS, judge: routeJudge(env, text, { level, prevCategory }), preview: state.latest_message }) || null; } catch {}
  const jev = await jevP, d = routeFromAnswers(env, text, jev, { level, prevCategory });
  sh?.finish?.(jevOutcome(jev));
  return { route: d.route, jev: { ...jev, verdict: d.verdict } };
}

// Open work in this task, read from the Resident: unfinished to-dos (not ones ready for the person to tick), helpers still running.
export function openWorkOf(R, session) {
  const out = [];
  try { const items = session ? R.todoRow(session).items || [] : [], left = items.filter((x) => x.status !== "done" && !x.ready).length; if (left) out.push(`${left} unfinished to-do item${left > 1 ? "s" : ""}`); } catch {}
  try { if (session && R.helperNote?.(session)) out.push("a helper is still working"); } catch {}
  return out;
}
export function prevToolsOf(R, session) {
  try { return Number(R.sql.exec("SELECT tool_calls FROM turns WHERE session=? AND kind='chat' ORDER BY at DESC LIMIT 1", session).toArray()[0]?.tool_calls || 0); } catch { return 0; }
}
// The task's category so far (kv `rcat:<session>`), carried through its turns, helpers, follow-ups and scheduled runs.
export const CAT_KEY = (session) => `rcat:${session}`;
export function sessionCategory(R, session) { try { const v = session ? R.get?.(CAT_KEY(session)) : null; return CATEGORIES.includes(v) ? v : null; } catch { return null; } }
export function saveSessionCategory(R, session, category) { try { if (session && CATEGORIES.includes(category)) R.put?.(CAT_KEY(session), category); } catch {} }
// The one place the turn's route is written, whether it lives on the Resident (this._route) or the turn (tc.route).
export function setTurnRoute(R, tc, route) { R._route = route; if (tc) tc.route = route; }

// Resident hook (resident.js runTurnInner, two mode): decide, bill the decider call like any model call, set the route.
// Returns the decision for turn stats; never throws (any failure → the task's category, else general).
export async function routeTwoTurn(R, tc, { kind, text, hist, stats }) {
  let d;
  const tenant = R.get?.("tenant"), level = await privacyOf(R.env, tenant), prevCategory = sessionCategory(R, tc?.session);
  // Dev test workspace (test-model.js): no decider call; the test model runs the whole turn and never escalates. The route the policy
  // WOULD have taken (task category by keyword guess / the task's category, the account's current level) rides on the route for labels.
  const tm = await testModelFor(R.env, tenant);
  if (tm) {
    const would = policyRoute(kind === "chat" ? (prevCategory && CONTINUE_RE.test(String(text || "")) ? prevCategory : guessCategory(text)) : prevCategory || DEFAULT_CATEGORY, level, "would");
    d = { route: { ...testRoute(tm), category: would.category, level, would: { model: would.model, effort: would.effort, chain: [would.model, ...would.fallbacks] } }, jev: null };
    d.route.label = `${d.route.label} would:${aliasOf(would.model)}@${would.effort} ${would.category}·${level}`;
    testShadow(R, tc, d.route, { kind, text, hist, level, prevCategory });
  }
  else try { d = await chooseTwo(R.env, { kind, text, hist, prevTools: prevToolsOf(R, tc?.session), openWork: openWorkOf(R, tc?.session), prevCategory, level }, { shadow: routeShadow(R, tc), meta: { tenant, channel: R.get?.("channel") } }); }
  catch (e) { d = { route: policyRoute(prevCategory || DEFAULT_CATEGORY, level, "decider:unsure"), jev: { error: String(e?.message || e).slice(0, 160), verdict: "unsure" } }; }
  const nano = Math.ceil((d.jev?.cost || 0) * 1e9 * JEV_MARKUP);
  if (nano > 0) { try { const rid = `rtr:${crypto.randomUUID()}`; if ((await R.ledger().reserve(rid, nano)).ok) { await R.ledger().settle(rid, nano); if (stats) stats.charge += nano; } } catch (e) { console.log("decider charge", e.message); } }
  setTurnRoute(R, tc, d.route);
  saveSessionCategory(R, tc?.session, d.route.category);
  if (stats) stats.route = { label: d.route.label, category: d.route.category, level, p: d.jev?.p ?? null, unmet: d.jev?.unmet ?? null, ms: d.jev?.ms ?? null, error: d.jev?.error || null };
  if (tc) { tc.esc = newEsc(); tc.routeStats = stats?.route || null; }
  return d;
}

// The decision shadow's starter for this turn (dev + DECISION_SHADOW="on" only; decision-shadow.js), or undefined.
function routeShadow(R, tc) {
  const wu = residentWaitUntil(R); if (!wu || !shadowOn(R.env)) return undefined;
  const meta = { tenant: R.get?.("tenant") || null, channel: R.get?.("channel") || null, session: tc?.session || null };
  return ({ preview, ...spec }) => startShadow(R.env, wu, { ...spec, meta: { ...meta, preview } });
}

// Dev test override (decision-shadow.js both_shadow): the test model runs the turn exactly as before (testRoute, no decider call in the
// turn); for a message the decider would have seen (same gates), the live and shadow deciders are asked in the background on the
// exact state. Nothing is billed, nothing waits, the route never changes.
function testShadow(R, tc, route, { kind, text, hist, level, prevCategory }) {
  try {
    const wu = residentWaitUntil(R); if (!wu || !shadowOn(R.env)) return;
    const prevTools = prevToolsOf(R, tc?.session), openWork = openWorkOf(R, tc?.session);
    if (jevGate(R.env, { kind, text, prevTools, openWork, prevCategory, level })) return;
    const state = jevState({ hist, text, prevTools, openWork, prevCategory });
    const sh = startShadow(R.env, wu, { kind: "route", state, questions: JEV_QUESTIONS, judge: routeJudge(R.env, text, { level, prevCategory }), jevProbe: () => jevAsk(R.env, state).then(jevOutcome),
      meta: { tenant: R.get?.("tenant") || null, channel: R.get?.("channel") || null, session: tc?.session || null, preview: state.latest_message } });
    sh.actual({ model: route.model, route: route.label });
  } catch (e) { console.log("decision shadow (test mode)", String(e?.message || e).slice(0, 160)); }
}

// ---- In-turn quality recovery (both engines: Resident.callModel calls these around every main-chat model call) ----
// State on tc.esc. Before a call, the tool results of the previous step's calls (found in the messages by call id) are judged:
//   - the same tool failed in two steps in a row (an "error…" result, invalid/cut-off JSON, a command killed or not found)  → "tool-errors"
//   - ESCALATE_STALL steps in a row with no progress (every call repeats one made earlier this turn, or every result failed) → "stalled"
// After a call: two malformed tool calls this turn → "bad-calls"; a final answer saying it's stuck after tool work → that same step
// is redone on Sol. Every switch moves the rest of the turn to Sol (pool.js IN_TURN_TARGET), once; a turn already on Sol never switches.
export const ESCALATE_FAILS = 2, ESCALATE_STALL = 3;
export const STUCK_RE = /\b(I'?m|I am|I've been|I have been) (stuck|going (around )?in circles)\b|\bkeep(s)? (getting|hitting|running into) (the same |this |that )?(error|failure|problem)|\bI (can'?t|cannot|couldn'?t|could not) (figure out|get (it|this|that) to work|make (it|this) work)\b|\b(ran|run) out of (ideas|things to try)\b/i;
export const newEsc = () => ({ pending: [], seen: new Set(), failTool: null, fails: 0, stall: 0, bad: 0, tools: 0, done: null });
const sigOf = (c) => { let a = {}; try { a = JSON.parse(c.function?.arguments || "{}"); } catch {} const { step_title, ...rest } = a || {}; return `${c.function?.name}:${JSON.stringify(rest)}`; };
export function failedResult(text) {
  const t = String(text ?? "").replace(/^(\[[^\]]*\]\n)+/, "").trimStart();   // egress / Sentinel notes come first
  if (/^(error\b|Your tool arguments were not valid JSON|Validation failed for tool|Tool \S+ not found)/i.test(t)) return true;   // classic + pi
  const m = t.match(/^exit (\d+)/); return !!m && [2, 124, 126, 127, 137].includes(Number(m[1]));   // exit 1 is often just "no match"
}
const recoverable = (tc) => !!tc?.route?.two && !tc.route.test && !!tc.esc && !tc.esc.done && (tc.route.served || tc.route.primary) !== IN_TURN_TARGET;
export function escalateTurn(R, tc, reason) {
  if (!recoverable(tc)) return false;
  tc.esc.done = reason;
  setTurnRoute(R, tc, policyRoute(tc.route.category, tc.route.level, `escalated:${reason}`, { recovery: IN_TURN_TARGET }));
  if (tc.routeStats) tc.routeStats.escalated = reason;
  console.log("router: rest of the turn on the recovery model", JSON.stringify({ reason, session: tc.session || null, kind: tc.kind || null, category: tc.route.category }));
  return true;
}
export function escalationBefore(R, tc, messages) {
  if (!recoverable(tc)) return null;
  const e = tc.esc, ids = new Map(e.pending.map((p) => [p.id, p])); if (!ids.size) return null;
  const res = (messages || []).filter((m) => m?.role === "tool" && ids.has(m.tool_call_id));
  if (!res.length) return null;                           // e.g. a checkpoint call: nothing new to judge
  e.pending = [];
  const failed = res.filter((m) => failedResult(typeof m.content === "string" ? m.content : JSON.stringify(m.content))).map((m) => ids.get(m.tool_call_id).name);
  const allFailed = failed.length === res.length, allRepeat = res.every((m) => ids.get(m.tool_call_id).repeat);
  if (failed.length) { const t = failed.includes(e.failTool) ? e.failTool : failed[0]; e.fails = t === e.failTool ? e.fails + 1 : 1; e.failTool = t; } else { e.fails = 0; e.failTool = null; }
  e.stall = allFailed || allRepeat ? e.stall + 1 : 0;
  const why = e.fails >= ESCALATE_FAILS ? "tool-errors" : e.stall >= ESCALATE_STALL ? "stalled" : null;
  return why && escalateTurn(R, tc, why) ? why : null;
}
// Returns the reason when this step must be redone on the recovery model (the switch is already made), else null.
export function escalationAfter(R, tc, r) {
  if (!recoverable(tc) || !r) return null;
  const e = tc.esc, calls = r.calls || [];
  for (const c of calls) { const s = sigOf(c); e.pending.push({ id: c.id, name: c.function?.name, repeat: e.seen.has(s) }); e.seen.add(s); }
  e.tools += calls.length;
  if (calls.some((c) => c.bad_args != null) && ++e.bad >= ESCALATE_FAILS) { escalateTurn(R, tc, "bad-calls"); return null; }
  if (!calls.length && e.tools > 0 && STUCK_RE.test(r.content || "")) return escalateTurn(R, tc, "stuck") ? "stuck" : null;
  return null;
}

// Hand-off notes (written after the reply, read only by the helper's future self) are a chore: gpt-oss-120b, not the pool.
// Matched on the prompt resident.js sends for them (test/route2.test.mjs checks it's still there).
export const HANDOFF_PREFIX = "(Turn finished; the person has your reply.";
export function choreRouteFor(route, body, env = null) {
  if (!route?.two || body?.tools) return null;
  const last = (body?.messages || []).at(-1);
  return last?.role === "user" && typeof last.content === "string" && last.content.startsWith(HANDOFF_PREFIX) ? choreRoute(env, "handoff") : null;
}


// The models one main-chat dispatch may try, in order (model.js twoChat): a recovery/legacy model first, then the category's chain at the
// CURRENT level; each kept only if some endpoint of it is eligible at that level for this payload (privacy.js), and not a Meta model
// when the request forces a tool choice (Meta accepts only "auto"). Deduplicated, at most MAX_MODELS. skipped: why each was left out.
export function dispatchOrder(route, level, { prov = null, body = null, settings = null } = {}) {
  const lead = [route?.recovery, route?.policy ? null : route?.primary].map((m) => replacementModel(settings, m)).filter(Boolean);
  const configured = settings?.chains?.[normalizeCategory(route?.category)]?.[normalizePrivacy(level)];
  const list = [...lead, ...(configured ? configured.map((k) => slotModel(settings, k)).filter(Boolean) : chainModels(normalizeCategory(route?.category), normalizePrivacy(level)).map((m) => replacementModel(settings, m)))];
  const forced = body?.tool_choice != null && body.tool_choice !== "auto";
  const models = [], skipped = [];
  for (const m of list) {
    if (models.includes(m) || skipped.some((s) => s.model === m)) continue;
    if (forced && autoToolsOnly(m)) { skipped.push({ model: m, why: "forced tool choice (Meta accepts only auto)" }); continue; }
    const meta = settings?.catalog?.[m], choice = typeof body?.tool_choice === "object" ? "function" : body?.tool_choice;
    if (meta && choice && !meta.tool_choice.includes(choice)) { skipped.push({ model: m, why: "unsupported tool choice" }); continue; }
    const images = body?.messages?.some((msg) => Array.isArray(msg.content) && msg.content.some((part) => part.type === "image_url"));
    if (meta && images && !meta.input_modalities.includes("image")) { skipped.push({ model: m, why: "no image input" }); continue; }
    if (!configuredHosts(settings, m, normalizePrivacy(level)).length) { skipped.push({ model: m, why: ineligibleWhy(m, level, { prov }) || "no eligible configured endpoint" }); continue; }
    models.push(m);
  }
  return { models: models.slice(0, MAX_MODELS), skipped };
}
