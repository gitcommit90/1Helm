import { aiOpts } from "../model.js";
// Own router (shadow): Jev Router's method, our pool. Captain 2026-10-01: "Jev Router, but we aren't bound to their arbitrary selection of models."
// Method copied from Jev's own metadata (research/own-router/jev-mechanics.md): every model × effort pair gets an estimated cost + time for THIS
// request; one decision call (Clef, Jev-API-compatible) answers Jev's question set; a floor tier is set; pairs are admitted or excluded;
// the cheapest admitted pair wins with 2 fallbacks; reason = initial / escalation (step up at once) / continuation (stay unless switching is cheaper).
// Inputs that differ from Jev: the nightly pool below (OpenRouter ZDR + speed + price, AA quality per effort, Design Arena), AA = intelligence/benchmark scores only: never AA speed, first-token time, cost or reply length.
const OR = "https://openrouter.ai/api/v1", AA = "https://artificialanalysis.ai/api/v2/language/models/free";
const MAX_IN = 3, MAX_OUTP = 15;                       // $/Mtok ceiling (same as model.js OR_MAX_PRICE)
// Reply length per message (never from Artificial Analysis: AA is used for intelligence/benchmark scores only; speed, first token and
// price come from our own ZDR host). Answer tokens = Clef's output_length. Reasoning tokens = effort base × 2^(difficulty − 2),
// so a moderate (2) message gets the base, trivial (0) a quarter, very hard (4) four times. Starting values; Ledger actuals replace them later.
const REASON_BASE = { none: 0, low: 200, medium: 600, high: 1500, xhigh: 3000, max: 5000 };
const reasonTok = (p, diff) => p.think === false ? 0 : Math.round((REASON_BASE[p.effort] ?? 600) * Math.pow(2, Math.max(0, Math.min(4, diff)) - 2));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const base = (s) => String(s).replace(/-\d{8}$/, "");
const tierOf = (ii) => ii >= 47 ? "deep" : ii >= 38 ? "general" : "basic";
const TIERS = ["basic", "general", "deep"];
const effOfAA = (name) => { const s = (String(name).match(/\((.*?)\)/)?.[1] || "").toLowerCase(); if (s.includes("non-reasoning")) return "none";
  for (const k of ["xhigh", "max", "high", "medium", "low"]) if (new RegExp(`\\b${k}\\b`).test(s)) return k; return "default"; };

// ---- Nightly pool ----
// The raw sources (OpenRouter models + ZDR endpoints + benchmarks, Artificial Analysis when keyed). OpenRouter failing throws;
// AA failing is recorded in errors.aa (the router lab shows it) and every model is then unrated.
export async function fetchSources(env, { aaRequired = true } = {}) {
  const h = { authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, g = async (u, hh = h) => { const r = await fetch(u, { headers: hh }); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
  const [models, zdr, bench] = await Promise.all([g(`${OR}/models`), g(`${OR}/endpoints/zdr`), g(`${OR}/benchmarks`)]);
  const at = Date.now(), aa = [], errors = {}; let aaAt = null;
  if (env.AA_API_KEY) { try { for (let p = 1; p <= 5; p++) { const d = await g(`${AA}?page=${p}`, { "x-api-key": env.AA_API_KEY }); aa.push(...d.data); if (!d.pagination?.has_more) break; } aaAt = Date.now(); }
    catch (e) { if (aaRequired) throw e; errors.aa = String(e?.message || e).slice(0, 200); } }
  else errors.aa = "AA_API_KEY not set: no quality scores";
  return { at, aa_at: aaAt, models, zdr, bench, aa, errors };
}
// One pass over the sources: the classic pool's pairs (unchanged rules) and, for the router lab, every model with its ZDR hosts,
// the efforts OpenRouter says it supports, the AA score per effort (null = unrated, never invented) and why it is excluded, if it is.
export function assessSources(src, { force = {} } = {}) {
  const { models, zdr, bench, aa } = src;
  const M = Object.fromEntries(models.data.map((m) => [m.id, m])), eps = {};
  for (const e of zdr.data || zdr) (eps[e.model_id] ||= []).push(e);
  const design = {}, tau = {};
  for (const r of bench.data || []) { const k = base(r.model_permaslug);
    if (r.source === "design-arena" && ["website", "uicomponent", "svg", "dataviz"].includes(r.category)) (design[k] ||= []).push(r.elo);
    if (r.source === "openrouter" && String(r.benchmark_type).startsWith("tau") && r.accuracy != null) tau[k] = Math.max(tau[k] || 0, r.accuracy); }
  const aaBy = {}; for (const m of aa) (aaBy[norm(String(m.name).replace(/\s*\(.*?\)\s*$/, ""))] ||= []).push(m);
  const pairs = [], dropped = {}, catalog = [];
  const drop = (why, id) => (dropped[why] ||= []).push(id);
  const pr = (e) => [Number(e.pricing.prompt) * 1e6, Number(e.pricing.completion) * 1e6];
  const hostMs = (e) => e.throughput_last_30m?.p50 ? (e.latency_last_30m?.p50 || 1500) + 1e6 / e.throughput_last_30m.p50 : 9e9;
  for (const m of models.data) if (!eps[m.id] && m.architecture?.output_modalities?.includes("text")) catalog.push({ id: m.id, name: clipS(m.name, 80), status: "excluded", reasons: ["no ZDR endpoint"], hosts: [], efforts: [], rated: false });
  for (const [id, E0] of Object.entries(eps)) {
    const m = M[id];
    const sup = m?.reasoning?.supported_efforts || null, mand = !!m?.reasoning?.mandatory, defE = m?.reasoning?.default_effort || "default";
    const rows = aaBy[norm(id.split("/")[1])] || [];
    const d = design[id], de = d ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
    // Lab catalog entry: every ZDR host with its own checks, the supported efforts and the AA score for each (or null).
    const hosts = E0.slice(0, 12).map((e) => { const [i, o] = pr(e), why = [];
      if (!(e.supported_parameters || []).includes("tools")) why.push("no tools"); if ((e.context_length || 0) < 128000) why.push("context < 128k");
      if ((e.uptime_last_1d ?? 0) < 99) why.push("uptime < 99%"); if (!(i >= 0 && i <= MAX_IN && o <= MAX_OUTP)) why.push("over $3/$15");
      return { host: String(e.tag || e.provider_name || ""), name: clipS(e.provider_name, 40), in: i, out: o, cache: e.pricing.input_cache_read != null ? Number(e.pricing.input_cache_read) * 1e6 : null,
        cache_write: e.pricing.input_cache_write != null ? Number(e.pricing.input_cache_write) * 1e6 : null, ctx: e.context_length || 0, uptime: e.uptime_last_1d ?? null,
        tps: e.throughput_last_30m?.p50 || null, ttft: e.latency_last_30m?.p50 ?? null, ok: !why.length, why }; });
    const aaEff = {}; for (const a of rows) { const ii = a.evaluations?.artificial_analysis_intelligence_index; if (ii == null) continue; let eff = effOfAA(a.name); if (eff === "default") eff = sup ? defE : "default"; if (!(eff in aaEff)) aaEff[eff] = { ii, ag: a.evaluations.artificial_analysis_agentic_index ?? null }; }
    const effs = sup ? [...(!mand && (sup.includes("none") || "none" in aaEff) ? ["none"] : []), ...sup.filter((e) => e !== "none")] : ["default"];
    const reasons = []; if (!m) reasons.push("not in the model list"); else if (!m.architecture?.output_modalities?.includes("text")) reasons.push("no text output");
    if (m && !hosts.some((h) => h.ok)) reasons.push(...new Set(hosts.flatMap((h) => h.why).map((w) => `every ZDR host: ${w}`)));
    if (m) catalog.push({ id, name: clipS(m.name, 80), img: !!m.architecture?.input_modalities?.includes("image"), ctx: m.context_length || 0, status: reasons.length ? "excluded" : "eligible", reasons,
      hosts, efforts: effs.map((e) => ({ effort: e, ii: aaEff[e]?.ii ?? null, ag: aaEff[e]?.ag ?? null })), mandatory: mand, default_effort: sup ? defE : null, rated: rows.length > 0, design: de, tau: tau[id] ?? null });
    // Classic pool pairs: the rules as they were.
    // Captain-forced pairs (ROUTER_FORCE="model@provider,…", dev): kept in the pool on that one host, skipping the intelligence minimum,
    // so we can watch whether they ever get picked. ZDR/tools/context/uptime/price still apply. Remove by deleting the var.
    const E = id in force && force[id] ? E0.filter((e) => String(e.tag || e.provider_name).toLowerCase().startsWith(force[id]) || String(e.provider_name).toLowerCase() === force[id]) : E0;
    if (!m || !m.architecture?.output_modalities?.includes("text")) continue;
    let ok = E.filter((e) => (e.supported_parameters || []).includes("tools")); if (!ok.length) { drop("no tools", id); continue; }
    ok = ok.filter((e) => (e.context_length || 0) >= 128000); if (!ok.length) { drop("context < 128k", id); continue; }
    ok = ok.filter((e) => (e.uptime_last_1d ?? 0) >= 99); if (!ok.length) { drop("uptime < 99%", id); continue; }
    ok = ok.filter((e) => { const [i, o] = pr(e); return i >= 0 && i <= MAX_IN && o <= MAX_OUTP; }); if (!ok.length) { drop("over $3/$15", id); continue; }
    if (!rows.length) { drop("no AA score", id); continue; }
    // One real ZDR host per model: speed first (time for a 1,000-token reply = first token + 1,000 / tok/s), then price.
    // Price, tok/s and first-token time all come from that same host (before: cheapest host's price + fastest host's speed).
    const host = ok.reduce((a, b) => { const ta = hostMs(a), tb = hostMs(b); if (tb < ta * 0.9) return b; if (ta < tb * 0.9) return a;
      const [ai, ao] = pr(a), [bi, bo] = pr(b); return bi * 3 + bo < ai * 3 + ao ? b : a; });
    const [pin, pout] = pr(host), pcache = host.pricing.input_cache_read != null ? Number(host.pricing.input_cache_read) * 1e6 : pin;
    const tps = host.throughput_last_30m?.p50 || null, ttft = host.latency_last_30m?.p50 ?? 9e9;
    const seen = new Set();
    for (const a of rows) {
      const ii = a.evaluations?.artificial_analysis_intelligence_index; if (ii == null || ii < 20 && !(id in force)) continue;
      let eff = effOfAA(a.name); if (eff === "default") eff = sup ? defE : "default";
      if (eff === "none" && (mand || !sup)) continue; if (sup && eff !== "none" && !sup.includes(eff)) continue;
      if (seen.has(eff)) continue; seen.add(eff);
      pairs.push({ model: id, effort: eff, ii, ag: a.evaluations.artificial_analysis_agentic_index ?? null, fin: a.evaluations.artificial_analysis_finance_and_accounting_index ?? null,
        legal: a.evaluations.artificial_analysis_legal_index ?? null, tier: tierOf(ii), design: de, tau: tau[id] ?? null, in: pin, out: pout, cache: pcache,
        tps, ttft: ttft < 9e9 ? ttft : null, host: host.tag || host.provider_name, ...(id in force ? { forced: true } : {}), think: !!sup || mand, provs: ok.length, img: !!m.architecture.input_modalities?.includes("image") });
    }
  }
  return { pairs, dropped: Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, v.length])), catalog };
}
const clipS = (s, n) => String(s ?? "").slice(0, n);
export async function buildPool(env) {
  const src = await fetchSources(env);
  // Captain-forced pairs (ROUTER_FORCE="model@provider,…", dev): see assessSources.
  const force = Object.fromEntries(String(env.ROUTER_FORCE || "").split(",").map((x) => x.trim().split("@")).filter((x) => x[0]).map(([m, h]) => [m, (h || "").toLowerCase()]));
  const { pairs, dropped } = assessSources(src, { force });
  return { at: Date.now(), pairs, dropped, models: new Set(pairs.map((p) => p.model)).size };
}
export async function saveNightlyPool(env) {
  const pool = await buildPool(env);
  const prev = await env.DB.prepare("SELECT pairs FROM router_pool ORDER BY id DESC LIMIT 1").first().catch(() => null);
  const was = new Set(prev ? JSON.parse(prev.pairs).map((p) => p.model) : []), now = new Set(pool.pairs.map((p) => p.model));
  const changes = { added: [...now].filter((m) => !was.has(m)), removed: [...was].filter((m) => !now.has(m)) };
  await env.DB.prepare("INSERT INTO router_pool (at, pairs, changes, info) VALUES (?,?,?,?)").bind(pool.at, JSON.stringify(pool.pairs), JSON.stringify(changes), JSON.stringify({ dropped: pool.dropped, models: pool.models, pairs: pool.pairs.length })).run();
  return { models: pool.models, pairs: pool.pairs.length, ...changes, dropped: pool.dropped };
}
export async function currentPool(env) { const r = await env.DB.prepare("SELECT at, pairs FROM router_pool ORDER BY id DESC LIMIT 1").first(); return r ? { at: r.at, pairs: JSON.parse(r.pairs) } : null; }

// ---- Per-message decision (Jev's method) ----
const TASKS = ["code:general_impl", "code:debugging", "code:review_security", "code:sql_database", "code:frontend_ui", "code:devops_config", "code:shell_execution", "code:file_read_write", "code:repo_scan",
  "agent:multi_step_planning", "agent:web_search", "agent:workflow_execution", "agent:tool_dispatch", "agent:memory_extraction", "classification_tagging", "data:extraction", "data:transformation", "devops",
  "summarization", "translation", "content_writing", "research_report", "qa_knowledge", "conversational_reply", "customer_support", "finance_trading", "security_audit", "math", "roleplay_fiction", "other"];
const OUT_BY_LEN = [150, 400, 1000, 2500, 6000];
const outTok = (p, ansTok, diff) => ansTok + reasonTok(p, diff);
export const estCost = (p, inTok, cachedTok, ansTok, diff = 2) => ((inTok - cachedTok) * p.in + cachedTok * p.cache + outTok(p, ansTok, diff) * p.out) / 1e6;
export const estMs = (p, ansTok, diff = 2) => (p.ttft || 1500) + (outTok(p, ansTok, diff) / (p.tps || 40)) * 1000;
export { outTok as estOutTok, OUT_BY_LEN, REASON_BASE };
const sc = (a) => a?.score ?? 0, nl = (a) => a?.noul ?? 0;
// A pair's tier index: unrated pairs (no AA score for that model/effort, router lab only) sit below "basic" (-1), so they are only
// admitted when the decider says that pair is sufficient, and never used to top up the list.
const tierIx = (t) => TIERS.indexOf(t);
// Shortlist ≤ 40 pairs for the decision call: each tier's cost/quality frontier, the best design pairs, and the incumbent's efforts.
export function shortlist(pairs, inc, inTok) {
  const by = (t) => pairs.filter((p) => p.tier === t).map((p) => ({ p, c: estCost(p, inTok, 0, 1000) })).sort((a, b) => a.c - b.c);
  const out = new Map(), add = (p) => out.size < 40 && out.set(`${p.model}|${p.effort}`, p);
  pairs.filter((p) => p.forced).forEach(add);   // forced pairs are always candidates
  if (inc) pairs.filter((p) => p.model === inc.model).forEach(add);
  for (const t of TIERS) { let best = -1; for (const { p } of by(t)) if (p.ii > best) { best = p.ii; add(p); } }
  // Speed frontier too: each tier's fastest pairs, keeping one only if it's smarter than every faster one.
  for (const t of TIERS) { let best = -1; for (const p of pairs.filter((q) => q.tier === t).sort((a, b) => estMs(a, 1000) - estMs(b, 1000))) if (p.ii > best) { best = p.ii; add(p); } }
  pairs.filter((p) => p.design).sort((a, b) => b.design - a.design).slice(0, 4).forEach(add);
  return [...out.values()];
}
// Jev's question set for these candidates (pure: the router lab sends the same object to every decider).
export function decisionQuestions(cands) {
  const q = { task: { type: "choice", instructions: "What kind of task is the person's latest message?", criteria: Object.fromEntries(TASKS.map((t) => [t, t])) },
    task_changed: { type: "noul", instructions: "Is the latest message a different task from the one before it?" },
    difficulty: { type: "score", instructions: "How difficult is the latest request to do well?", criteria: ["trivial", "easy", "moderate", "hard", "very hard"] },
    precision: { type: "score", instructions: "How much does exactness matter (money, legal, health, irreversible actions)?", criteria: ["not at all", "a little", "somewhat", "a lot", "critical"] },
    big_model_gain: { type: "noul", instructions: "Would a frontier model give a meaningfully better result than a good cheap model?" },
    visual_quality: { type: "noul", instructions: "Does the result depend on visual design quality (a flyer, deck, page, poster, layout)?" },
    codebase_integration: { type: "noul", instructions: "Does it require working inside an existing codebase?" },
    output_length: { type: "score", instructions: "How long should the answer be?", criteria: ["one line", "a short paragraph", "a page", "several pages", "a long document"] },
    latency_sensitive: { type: "noul", instructions: "Is the person waiting for a quick reply where speed matters more than depth?" },
    previous_attempt_failed: { type: "noul", instructions: "Does the person say an earlier answer in this conversation did not work, or show they are stuck or frustrated after retries?" } };
  cands.forEach((p, i) => { q[`cheaper_model_sufficient_${i}`] = { type: "noul", instructions: `Would ${p.model.split("/")[1]} at ${p.effort} effort (${p.ii == null ? "intelligence not rated" : `intelligence ${p.ii}/60`}${p.design ? `, design ${p.design}` : ""}, ${p.tps ? Math.round(p.tps) + " tok/s" : "speed unknown"}, $${p.in}/$${p.out} per M tokens) do this well enough?` }; });
  return q;
}
export async function decide(env, { pool, convo, incumbent, failed = 0, inTok = 4000, cachedTok = 0, clef }) {
  const cands = shortlist(pool.pairs, incumbent, inTok), q = decisionQuestions(cands);
  const t0 = Date.now(), r = await clef({ state: { conversation: convo, current_model: incumbent || null, recent_failed_attempts: failed }, questions: q });
  const d = decideFromAnswers(env, { pool, cands, answers: r.answers || {}, incumbent, failed, inTok, cachedTok });
  delete d.list;
  return { ...d, clef_ms: Date.now() - t0, clef_in: r.usage?.input_tokens || 0, pool_at: pool.at };
}
// The decision from one decider's answers (pure). cachedTok applies to the incumbent model only; the router lab passes 0 (no cache
// is assumed for a model that never ran). list = every candidate with its estimate and why it was admitted or not.
export function decideFromAnswers(env, { pool, cands, answers: A, incumbent = null, failed = 0, inTok = 4000, cachedTok = 0 }) {
  const top = (k) => { const p = A[k]?.probabilities; return p ? Object.entries(p).sort((a, b) => b[1] - a[1])[0][0] : A[k]?.choice; };
  // Jev reads recent_failed_attempts from its own state; with Jev gone, Clef supplies it from the conversation.
  if (nl(A.previous_attempt_failed) >= 0.6) failed = Math.max(failed, 1);
  const diff = sc(A.difficulty), prec = sc(A.precision), gain = nl(A.big_model_gain), vis = nl(A.visual_quality), lat = nl(A.latency_sensitive);
  let fl = diff >= 2.5 ? 2 : diff >= 1.3 ? 1 : 0; if (gain >= 0.6 || prec >= 3) fl = Math.max(fl, 1); if (gain >= 0.75 && diff >= 2) fl = 2; if (failed >= 1 && diff >= 1.5) fl = 2;
  const floor = TIERS[fl], ans = OUT_BY_LEN[Math.max(0, Math.min(4, Math.round(sc(A.output_length))))];
  const ev = cands.map((p, i) => {
    const suff = nl(A[`cheaper_model_sufficient_${i}`]), c = estCost(p, inTok, incumbent && p.model === incumbent.model ? cachedTok : 0, ans, diff), ms = estMs(p, ans, diff);
    let reason = "heuristic";
    if (tierIx(p.tier) < fl && suff < 0.8) reason = p.tier === "unrated" ? "unrated" : "tier";
    else if (vis >= 0.5 && (!p.design || p.design < 1290)) reason = "visual";
    return { model: p.model, effort: p.effort, host: p.host || null, tps: p.tps || null, tier: p.tier, ii: p.ii ?? null, tok: outTok(p, ans, diff), suff: +suff.toFixed(2), cost: c, ms: Math.round(ms), admitted: reason === "heuristic", reason };
  });
  // Among models smart enough: weigh speed and cost together in one number, dollars.
  // score = estimated cost + estimated wait × what a second of waiting is worth. A second is worth $0.002, rising to $0.01
  // when Clef says the person is waiting (ROUTER_SEC_USD / ROUTER_SEC_USD_WAITING override). Starting values, to tune from real picks.
  const secLo = Number(env.ROUTER_SEC_USD ?? 0.002), secHi = Number(env.ROUTER_SEC_USD_WAITING ?? 0.01), perSec = secLo + (secHi - secLo) * lat;
  const adm0 = ev.filter((e) => e.admitted), score = (e) => e.cost + (e.ms / 1000) * perSec;
  for (const e of ev) e.score = +score(e).toFixed(5);
  const adm = adm0.sort((a, b) => a.score - b.score);
  // Too few admitted models for a pick + 2 fallbacks: top up with the cheapest pairs at or above the floor.
  if (new Set(adm.map((e) => e.model)).size < 3) adm.push(...ev.filter((e) => !e.admitted && tierIx(e.tier) >= fl).sort((a, b) => a.score - b.score));
  if (!adm.length) adm.push(...ev.filter((e) => e.tier === "deep").sort((a, b) => a.score - b.score));
  // Nothing at the floor in this pool (router lab pools can lack a deep tier): the smartest rated pairs, flagged below_floor.
  const below = !adm.length; if (below) adm.push(...ev.filter((e) => e.ii != null).sort((a, b) => b.ii - a.ii || a.score - b.score));
  let pick = adm[0], why = incumbent ? "continuation" : "initial", stay = null, sw = null;
  if (incumbent && pick) {
    const cur = ev.find((e) => e.model === incumbent.model && e.effort === incumbent.effort) || ev.find((e) => e.model === incumbent.model && e.admitted);
    const curTier = tierIx(pool.pairs.find((p) => p.model === incumbent.model && p.effort === incumbent.effort)?.tier ?? "basic");
    if (curTier < fl || failed >= 1 && pick.model !== incumbent.model && tierIx(pick.tier) > curTier) why = "escalation";
    else if (failed >= 1 && pick.model === incumbent.model && ["none","low","medium","default","high","xhigh","max"].indexOf(pick.effort) > ["none","low","medium","default","high","xhigh","max"].indexOf(incumbent.effort)) why = "escalation";
    else if (cur?.admitted && nl(A.task_changed) < 0.5) { stay = cur.cost; sw = pick.cost; if (cur.score <= pick.score || pick.model === cur.model) pick = cur; else why = "continuation"; }
    else if (nl(A.task_changed) >= 0.5) why = "initial";
  }
  const fallbacks = []; for (const e of adm) if (e.model !== pick?.model && !fallbacks.some((f) => f.model === e.model) && fallbacks.length < 2) fallbacks.push(e);
  return { pick, fallbacks, reason: why, floor, task: top("task"), difficulty: +diff.toFixed(2), precision: +prec.toFixed(2), big_model_gain: +gain.toFixed(2), visual: +vis.toFixed(2),
    latency: +lat.toFixed(2), failed, stay_cost: stay, switch_cost: sw, candidates: ev.length, admitted: below ? 0 : adm.length, ...(below ? { below_floor: true } : {}), answer_tok: ans, list: ev };
}
// model: the full model id saved for the job (for example "@cf/cloudflare/clef-flash"); the request names the short model too.
export const clefVia = (env, model, meta = {}) => async (body) => await env.AI.run(model, { model: String(model).split("/").pop(), ...body }, aiOpts(env, meta));
