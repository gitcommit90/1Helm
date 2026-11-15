// What the request sorter needs from a decision answer: the answer validator, the cost estimate, the call to Perplexity's or Jev's decision endpoint
// through the dispatcher (the saved job's model and provider fields), and a time limit helper. The comparison tools that used to share this file were removed.
import { dispatch } from "./model-dispatch.js";

export const SHADOW_TIMEOUT_MS = 10_000;
export const SHADOW_IN_NANO = 20;              // $0.02 per million input tokens; output is free
const MAX_BODY = 64 << 10;
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

// opts.job: the saved job the model belongs to (default "decider"); the dispatcher sends the model, provider fields and price cap saved for it.
// opts.priceInNano: the estimate when usage.cost is missing (nano$ per input token). The transport is the dispatcher's (fetchImpl is passed through for tests).
export async function askSystemone(env, MODEL, state, questions, { fetchImpl = globalThis.fetch, timeoutMs = SHADOW_TIMEOUT_MS, priceInNano = SHADOW_IN_NANO, choiceFromProbs = false, meta = {}, job = "decider" } = {}) {
  const t0 = Date.now(), ac = new AbortController(), timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;   // null: no timeout (the saved decider timeout, limits.js)
  const want = MODEL.replace(/^~/, "").replace(/-latest$/, "");
  const fail = (error, extra = {}) => ({ error: clip(error), ms: Date.now() - t0, nano: 0, src: null, model: null, ...extra });
  try {
    const r = await dispatch(env, job, { state, questions }, { meta: { kind: "decider", ...meta }, signal: ac.signal, model: MODEL, fetch: fetchImpl });
    const t = await r.text(); if (t.length > MAX_BODY) return fail(`response too large (${t.length} bytes)`);
    let j = null; try { j = JSON.parse(t); } catch {}
    if (!r.ok || !j || j.error) return fail(`HTTP ${r.status}: ${JSON.stringify(j?.error ?? j ?? t.slice(0, 120))}`);
    const cost = shadowCost(j.usage, JSON.stringify({ state, questions }).length, priceInNano), model = typeof j.model === "string" ? j.model : null;
    // No silent swap: an answer from another model is an error, not a comparison.
    if (model && !model.startsWith(want)) return fail(`answered by ${model}, not ${want}`, { nano: cost.nano, src: cost.src, model });
    const v = validateAnswers(questions, j.answers, { choiceFromProbs });
    return { ...(v.error ? { error: v.error } : { answers: v.answers }), ms: Date.now() - t0, nano: cost.nano, src: cost.src, model, provider: typeof j.provider === "string" ? clip(j.provider, 40) : null };
  } catch (e) { return fail(ac.signal.aborted ? `timeout after ${Math.round(timeoutMs / 1000)} s` : e?.orStatus ? `HTTP ${e.orStatus}: ${String(e.message).replace(/^\S+ \S+ \d+: /, "")}` : String(e?.message || e)); }
  finally { clearTimeout(timer); }
}

// A promise that settles within ms: the value, or onTimeout().
export const within = (p, ms, onTimeout) => { let t; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((z) => { t = setTimeout(() => z(onTimeout()), ms); })]); };
