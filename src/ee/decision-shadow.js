// Since the 2026-10-08 swap, the real decider IS Perplexity's (decider.js), so this shadow is off by default (shadowOn): it would only
// compare the model with itself. Set DECIDER_MODEL back to "~typesafe/jev-latest" (the kill switch) with DECISION_SHADOW="on" and it
// compares Jev with Perplexity again. "Jev" below means the real decider; the /router page and its data keep working either way.
// Decision shadow (Captain 2026-10-08, dev only): every real Jev decision, side by side with what Perplexity's decider
// (perplexity/pplx-decider-v1.1-27b, OpenRouter /api/v1/systemone) answers for the EXACT same state and questions. Two Jev uses:
//   route           route2.js chooseTwo: the per-message task?/hard? questions (OpenRouter systemone). Both answers go through the
//                   same rule (route2.js routeFromAnswers), so "agree" means the same model would have run the turn.
//   browser_action  browser-agent.js: the next-step choice from the action menu (the decider on OpenRouter systemone).
//   browser_done    browser-agent.js: "is the task complete?" after a FINISH pick.
// Browser rows compare ONE step on Jev's own trajectory: the shadow sees the page Jev's earlier picks led to, and its pick is never
// carried out. Agreement is not task success, and nobody checks either side's accuracy here.
// Jev stays the decider. The shadow call starts next to Jev's and is never awaited by the turn: its row is written pending, then
// finished, all inside ctx.waitUntil. It never touches the Ledger (platform overhead), never changes a route or an action, and any
// failure (timeout, HTTP error, wrong model, malformed answer) only marks its own row.
// Two modes, shown on every row:
//   jev_live     the normal path: Jev's real answer (no second Jev call) next to the shadow's.
//   both_shadow  the dev test override (test-model.js, TEST_MODEL; with TEST_MODEL_SCOPE=all-dev that is all dev traffic, the Captain's
//                too): the test model really decides (route = testRoute, browser picks from its JSON answer), unchanged. Jev and
//                Perplexity are then BOTH probes on the exact state/questions Jev would have had, both in the background, both only
//                recorded; the row also keeps what the test model actually decided. Only cheap decision calls, never a Sol/Luna turn.
// On only when ENV_NAME is "dev" AND DECISION_SHADOW="on" (wrangler.dev.jsonc). Never for an own-AI-key account (env.BYOK).
// ZDR like every OpenRouter call: decider.js deciderProvider (the model's own host only, ZDR, price ceiling), the same policy as the real decider. If no ZDR endpoint
// serves the model, OpenRouter refuses and the row shows that error; nothing retries without it.
import { scrubSecrets } from "../secrets-scrub.js";
import { deciderFetch, deciderProvider, deciderModel } from "./decider.js";

export const SHADOW_MODEL = "perplexity/pplx-decider-v1.1-27b";
export const SHADOW_URL = "https://openrouter.ai/api/v1/systemone";      // = route2.js JEV_URL
export const SHADOW_TIMEOUT_MS = 10_000;
export const JEV_WAIT_MS = 120_000;            // a Jev result that never arrives (the caller died) ends the row as jev_error
export const JEV_PROBE_MS = 15_000;            // both_shadow: the real decider's probe is raced against this
export const ACTUAL_WAIT_MS = 120_000;         // both_shadow: how long the row waits for the test model's own decision
export const SHADOW_IN_NANO = 20;              // $0.02 per million input tokens; output is free
export const SHADOW_KEEP_MS = 7 * 864e5;       // rows are kept 7 days
export const SHADOW_KINDS = ["route", "browser_action", "browser_done"];
export const PREVIEW_CHARS = 160;
const MAX_BODY = 64 << 10;

// Off when the real decider IS the shadow model (Jev is gone, so it would only compare Perplexity with itself); on again only if
// DECIDER_MODEL is switched back to something else and DECISION_SHADOW=on.
export const shadowOn = (env) => env?.ENV_NAME === "dev" && deciderModel(env) !== SHADOW_MODEL && String(env?.DECISION_SHADOW || "").trim().toLowerCase() === "on"
  && !env?.BYOK && !!env?.OPENROUTER_API_KEY && !!env?.DB;

// A short preview that is safe to keep: secrets scrubbed, one line, ≤ PREVIEW_CHARS.
export function preview(text) {
  const s = scrubSecrets(String(text ?? "")).replace(/\s+/g, " ").trim();
  return s.length > PREVIEW_CHARS ? s.slice(0, PREVIEW_CHARS - 1) + "…" : s;
}
const clip = (s, n = 200) => String(s ?? "").slice(0, n);
const prob = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

// The shadow's answers, checked against the questions asked: every question answered, nouls a probability in [0, 1], a choice one of
// the offered ids, any probabilities map only offered ids with values in [0, 1], a score a number from 0 to (criteria − 1).
// A missing or out-of-range answer is an error, never a zero. opts.choiceFromProbs: a choice given only as probabilities takes the
// most likely id (Clef answers choices that way). Returns { answers } or { error }.
export function validateAnswers(questions, answers, opts = {}) {
  if (!answers || typeof answers !== "object") return { error: "malformed: no answers" };
  const out = {};
  for (const [k, q] of Object.entries(questions || {})) {
    let a = answers[k]; if (!a || typeof a !== "object") return { error: `malformed: no answer to ${k}` };
    if (q.type === "noul") { if (!prob(a.noul)) return { error: `malformed: ${k}.noul ${clip(JSON.stringify(a.noul), 40)}` }; out[k] = { noul: a.noul }; continue; }
    if (q.type === "score") {
      const top = (Array.isArray(q.criteria) ? q.criteria.length : Object.keys(q.criteria || {}).length) - 1;
      if (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > top) return { error: `malformed: ${k}.score ${clip(JSON.stringify(a.score), 40)} is not 0-${top}` };
      out[k] = { score: a.score }; continue;
    }
    if (q.type === "choice") {
      const ids = Object.keys(q.criteria || {});
      if (a.choice == null && opts.choiceFromProbs && a.probabilities && typeof a.probabilities === "object" && !Array.isArray(a.probabilities)) {
        const best = Object.entries(a.probabilities).filter(([id, p]) => ids.includes(id) && prob(p)).sort((x, y) => y[1] - x[1])[0];
        if (best) a = { ...a, choice: best[0] };
      }
      if (typeof a.choice !== "string" || !ids.includes(a.choice)) return { error: `malformed: ${k}.choice ${clip(JSON.stringify(a.choice), 40)} is not one of the ${ids.length} options` };
      let probabilities;
      if (a.probabilities != null) {
        if (typeof a.probabilities !== "object" || Array.isArray(a.probabilities)) return { error: `malformed: ${k}.probabilities` };
        for (const [id, p] of Object.entries(a.probabilities)) if (!ids.includes(id) || !prob(p)) return { error: `malformed: ${k}.probabilities[${clip(id, 20)}]` };
        probabilities = a.probabilities;
      }
      out[k] = { choice: a.choice, ...(probabilities ? { p: probabilities[a.choice] ?? null } : {}) }; continue;
    }
    return { error: `unsupported question type ${clip(q.type, 20)}` };
  }
  return { answers: out };
}

// Cost in nano$: usage.cost when OpenRouter reports it, else input tokens × $0.02/M (estimated), else ~4 characters a token.
export function shadowCost(usage, bodyChars = 0, inNano = SHADOW_IN_NANO) {
  const c = Number(usage?.cost);
  if (usage && usage.cost != null && Number.isFinite(c) && c >= 0) return { nano: Math.round(c * 1e9), src: "reported" };
  const t = Number(usage?.input_tokens ?? usage?.prompt_tokens);
  if (Number.isFinite(t) && t >= 0) return { nano: Math.round(t * inNano), src: "estimated" };
  return { nano: Math.round(Math.ceil(bodyChars / 4) * inNano), src: "estimated" };
}

// The shadow call itself. Never throws: { answers, ms, nano, src, model } or { error, ms, nano, src, model }.
export const askShadow = (env, state, questions, opts = {}) => askSystemone(env, SHADOW_MODEL, state, questions, { meta: { kind: "decision-shadow" }, ...opts });
// Any decider on OpenRouter's systemone endpoint (Perplexity's decider, Jev for the router lab), ZDR only, validated, bounded.
// opts.priceInNano: the estimate when usage.cost is missing (nano$ per input token).
export async function askSystemone(env, MODEL, state, questions, { fetchImpl = globalThis.fetch, timeoutMs = SHADOW_TIMEOUT_MS, title = "1Helm decision shadow", priceInNano = SHADOW_IN_NANO, choiceFromProbs = false, meta = {} } = {}) {
  const t0 = Date.now(), ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  const body = JSON.stringify({ model: MODEL, provider: deciderProvider(MODEL), state, questions });
  const SHADOW_MODEL = MODEL.replace(/^~/, "").replace(/-latest$/, "");
  const fail = (error, extra = {}) => ({ error: clip(error), ms: Date.now() - t0, nano: 0, src: null, model: null, ...extra });
  try {
    const r = await deciderFetch(env, body, { signal: ac.signal, title, meta: { kind: "decider", ...meta }, fetchImpl });
    const t = await r.text(); if (t.length > MAX_BODY) return fail(`response too large (${t.length} bytes)`);
    let j = null; try { j = JSON.parse(t); } catch {}
    if (!r.ok || !j || j.error) return fail(`HTTP ${r.status}: ${JSON.stringify(j?.error ?? j ?? t.slice(0, 120))}`);
    const cost = shadowCost(j.usage, body.length, priceInNano), model = typeof j.model === "string" ? j.model : null;
    // No silent swap: an answer from another model is an error, not a comparison.
    if (model && !model.startsWith(SHADOW_MODEL)) return fail(`answered by ${model}, not ${SHADOW_MODEL}`, { nano: cost.nano, src: cost.src, model });
    const v = validateAnswers(questions, j.answers, { choiceFromProbs });
    return { ...(v.error ? { error: v.error } : { answers: v.answers }), ms: Date.now() - t0, nano: cost.nano, src: cost.src, model, provider: typeof j.provider === "string" ? clip(j.provider, 40) : null };
  } catch (e) { return fail(ac.signal.aborted ? `timeout after ${Math.round(timeoutMs / 1000)} s` : String(e?.message || e)); }
  finally { clearTimeout(timer); }
}

const NOOP = Object.freeze({ finish() {}, actual() {}, row: null });
// A promise that settles within ms: the value, or onTimeout().
export const within = (p, ms, onTimeout) => { let t; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((z) => { t = setTimeout(() => z(onTimeout()), ms); })]); };
const statusOf = (j, s) => j.error && s.error ? "both_error" : j.error ? "jev_error" : s.error ? "shadow_error" : "done";
const safeJudge = (judge, a) => { try { return judge(a) || {}; } catch (e) { return { key: null, judge_error: clip(e?.message || e, 120) }; } };

// Start one comparison. Returns { finish(jev), actual(a) }, both cheap and synchronous:
//   jev_live (no jevProbe): the caller has already started Jev's real request and calls finish(jev) once it's known;
//   both_shadow (jevProbe: () => Promise<jev>): this starts the Jev probe itself, next to the shadow; the caller calls actual(a) with
//     what the test model decided: { model, answers } (answers judged like the others) or { model, route } / { model, error }.
//   jev = { answers, ms, nano, src, model } or { error, ms }   (answers in the same shape as the questions)
// judge(answers | { error }) → { key, label, ...shown }: the decision the caller's own rule makes from those answers; equal keys = agree.
// The same judge runs on every side. Never throws and never makes the caller wait.
export function startShadow(env, waitUntil, { kind, state, questions, judge, meta = {}, jevProbe = null }, opts = {}) {
  try {
    if (!shadowOn(env) || !SHADOW_KINDS.includes(kind) || typeof waitUntil !== "function") return NOOP;
    const DB = env.DB, id = crypto.randomUUID(), at = Date.now(), now = opts.now || Date.now, mode = jevProbe ? "both_shadow" : "jev_live";
    const shadowP = askShadow(env, state, questions, opts);
    let done, timer, setActual, atimer;
    const jevP = new Promise((z) => { done = z; timer = setTimeout(() => z({ error: "Jev's result never arrived", ms: null }), opts.jevWaitMs ?? JEV_WAIT_MS); });
    const actualP = mode === "both_shadow" ? new Promise((z) => { setActual = z; atimer = setTimeout(() => z(null), opts.actualWaitMs ?? ACTUAL_WAIT_MS); }) : null;
    if (jevProbe) { const t0 = Date.now(); Promise.resolve().then(jevProbe).then((j) => done(j && typeof j === "object" ? j : { error: "no result", ms: Date.now() - t0 }), (e) => done({ error: `jev probe: ${clip(e?.message || e, 160)}`, ms: Date.now() - t0 })); }
    const row = (async () => {
      await DB.prepare("INSERT INTO decision_shadow (id, at, kind, mode, status, tenant_id, channel, session, preview, shadow_model) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id, at, kind, mode, "pending", meta.tenant ? String(meta.tenant) : null, meta.channel ? String(meta.channel) : null, meta.session ? String(meta.session) : null, preview(meta.preview), SHADOW_MODEL).run();
      const [s, j, act] = await Promise.all([shadowP, jevP, actualP]); clearTimeout(timer); clearTimeout(atimer);
      const actual = mode === "jev_live" ? null : act ? { model: act.model ? clip(act.model, 80) : null, ...(act.error ? { error: clip(act.error) } : act.answers ? safeJudge(judge, act.answers) : {}), ...(act.route ? { route: clip(act.route, 60) } : {}) } : { error: "the test model's decision wasn't reported" };
      const jd = safeJudge(judge, j.error ? { error: j.error } : j.answers), sd = s.error ? null : safeJudge(judge, s.answers);
      const both = !j.error && !s.error && jd.key != null && sd?.key != null;
      const jevOut = { ...jd, ...(j.error ? { error: clip(j.error) } : {}), model: j.model || null };
      const shOut = { ...(sd || {}), ...(s.error ? { error: s.error } : {}), model: s.model, provider: s.provider || null };
      await DB.prepare("UPDATE decision_shadow SET status=?, done_at=?, actual=?, jev=?, shadow=?, agree=?, label_agree=?, jev_ms=?, shadow_ms=?, jev_nano=?, shadow_nano=?, jev_cost_src=?, shadow_cost_src=? WHERE id=?")
        .bind(statusOf(j, s), now(), actual ? JSON.stringify(actual) : null, JSON.stringify(jevOut), JSON.stringify(shOut), both ? Number(jd.key === sd.key) : null,
          both ? Number((jd.label ?? jd.key) === (sd.label ?? sd.key)) : null, j.ms ?? null, s.ms ?? null, Math.round(j.nano || 0), Math.round(s.nano || 0), j.src || null, s.src || null, id).run();
      return id;
    })().catch((e) => { clearTimeout(timer); clearTimeout(atimer); console.log("decision shadow", kind, String(e?.message || e).slice(0, 160)); return null; });
    waitUntil(row);
    return { finish(j) { if (jevProbe) return; try { done(j && typeof j === "object" ? j : { error: "no result" }); } catch {} },
      actual(a) { try { setActual?.(a && typeof a === "object" ? a : null); } catch {} }, row };
  } catch (e) { console.log("decision shadow start", String(e?.message || e).slice(0, 160)); return NOOP; }
}

// The Resident's waitUntil, for the two hooks (route2.js, browser-agent.js).
export const residentWaitUntil = (R) => typeof R?.ctx?.waitUntil === "function" ? (p) => R.ctx.waitUntil(p) : null;

// Hourly (index.js cron, dev only): rows older than 7 days go.
export async function pruneShadow(env, now = Date.now()) {
  if (env?.ENV_NAME !== "dev" || !env?.DB) return 0;
  const r = await env.DB.prepare("DELETE FROM decision_shadow WHERE at < ?").bind(now - SHADOW_KEEP_MS).run();
  return Number(r?.meta?.changes || 0);
}

// ---- the dashboard's data (router-page.js /router/data, ops-read.js /_ops/decision-shadow) ----
export const WINDOWS = { "1h": 3600e3, "24h": 864e5, "7d": SHADOW_KEEP_MS };
export const SHOWS = ["all", "differ", "pending", "errors"];
export const LOST_MS = 3 * 60e3;               // a row still pending after this was cut off (the Resident went away)
const jp = (s) => { if (s == null || s === "") return null; try { return JSON.parse(s); } catch { return null; } };
export function shadowQuery(params) {
  const g = (k) => String((params?.get ? params.get(k) : params?.[k]) ?? "");
  const kind = SHADOW_KINDS.includes(g("kind")) ? g("kind") : "all", show = SHOWS.includes(g("show")) ? g("show") : "all";
  const win = WINDOWS[g("window")] ? g("window") : "24h", n = Math.min(200, Math.max(1, Math.round(Number(g("n")) || 100)));
  return { kind, show, window: win, n };
}
export async function shadowData(env, params = {}, now = Date.now()) {
  const q = shadowQuery(params), since = now - WINDOWS[q.window];
  const testScope = String(env.TEST_MODEL_SCOPE || "test-accounts").trim().toLowerCase();
  const state = { on: shadowOn(env), flag: String(env.DECISION_SHADOW || ""), model: SHADOW_MODEL, task_model: String(env.TASK_MODEL || "luna"),
    test_model: env.ENV_NAME === "dev" && env.TEST_MODEL ? String(env.TEST_MODEL) : null, test_scope: testScope, router_mode: String(env.ROUTER_MODE || "classic") };
  const w = ["d.at >= ?"], a = [since];
  if (q.kind !== "all") { w.push("d.kind = ?"); a.push(q.kind); }
  if (q.show === "differ") w.push("d.agree = 0");
  else if (q.show === "pending") w.push("d.status = 'pending'");
  else if (q.show === "errors") w.push("d.status IN ('shadow_error','jev_error','both_error')");
  let rows = [], counts = [], error = null;
  try {
    rows = (await env.DB.prepare(`SELECT d.*, t.slug AS slug FROM decision_shadow d LEFT JOIN tenants t ON t.id = d.tenant_id WHERE ${w.join(" AND ")} ORDER BY d.at DESC LIMIT ?`).bind(...a, q.n).all()).results || [];
    counts = (await env.DB.prepare("SELECT kind, status, agree, label_agree, COUNT(*) AS n, SUM(jev_nano) AS jev_nano, SUM(shadow_nano) AS shadow_nano, AVG(jev_ms) AS jev_ms, AVG(shadow_ms) AS shadow_ms FROM decision_shadow WHERE at >= ? GROUP BY kind, status, agree, label_agree").bind(since).all()).results || [];
  } catch (e) { error = String(e?.message || e).slice(0, 200); }
  const tot = {}; for (const k of ["all", ...SHADOW_KINDS]) tot[k] = { n: 0, compared: 0, agree: 0, label_agree: 0, pending: 0, errors: 0, jev_nano: 0, shadow_nano: 0, jev_ms: 0, shadow_ms: 0, timed: 0 };
  for (const c of counts) for (const k of ["all", c.kind]) { const t = tot[k]; if (!t) continue;
    t.n += c.n; if (c.agree != null) { t.compared += c.n; t.agree += c.agree ? c.n : 0; t.label_agree += c.label_agree ? c.n : 0; }
    if (c.status === "pending") t.pending += c.n; if (/error/.test(c.status)) t.errors += c.n;
    t.jev_nano += c.jev_nano || 0; t.shadow_nano += c.shadow_nano || 0;
    if (c.status !== "pending" && c.jev_ms != null && c.shadow_ms != null) { t.jev_ms += c.jev_ms * c.n; t.shadow_ms += c.shadow_ms * c.n; t.timed += c.n; } }
  for (const t of Object.values(tot)) { t.jev_ms = t.timed ? Math.round(t.jev_ms / t.timed) : null; t.shadow_ms = t.timed ? Math.round(t.shadow_ms / t.timed) : null; delete t.timed; }
  return { now, query: q, state, ...(error ? { error } : {}), counts: tot,
    rows: rows.map((r) => ({ id: r.id, at: r.at, done_at: r.done_at, kind: r.kind, status: r.status === "pending" && now - r.at > LOST_MS ? "lost" : r.status,
      mode: r.mode || "jev_live", actual: jp(r.actual), slug: r.slug || null, channel: r.channel, session: r.session, preview: r.preview, shadow_model: r.shadow_model, jev: jp(r.jev), shadow: jp(r.shadow),
      agree: r.agree, label_agree: r.label_agree, jev_ms: r.jev_ms, shadow_ms: r.shadow_ms, jev_nano: r.jev_nano, shadow_nano: r.shadow_nano, jev_cost_src: r.jev_cost_src, shadow_cost_src: r.shadow_cost_src })) };
}
