// The managed model pool and the task-aware routing policy (Captain 2026-10-08, notes/2026-10-08-privacy-routing/PROMPT.md).
// The decider (decider.js, Perplexity) picks a task CATEGORY per message (route2.js); this file turns category × privacy level into the
// ordered model list. It never picks reasoning effort: each managed model has ONE fixed effort (POOL[*].effort), chosen to match the
// Vals evaluation the Captain used to pick it. Every category, privacy level, subscription amount, retry, fallback, resumed job and
// helper uses the same effort for a given model; a fallback uses the DESTINATION model's effort. Quality recovery may change the
// model (RECOVERY), never its effort.
//
// Vals evidence (notes/2026-10-08-privacy-routing/vals-settings): model pages list `max` for Luna, Sol, DeepSeek V4.1 Flash (reasoning
// effort) and Haiku 5.5 (compute effort); Muse Standard Max is `max`; Muse Contributor `xhigh` is the Captain-approved exception (Meta
// reserves `max` for Standard). Known discrepancy: Vals' DeepSeek V4.1 Flash release note says its runs used "high reasoning effort"
// while the model page lists `max`; we keep `max` (the Captain's table) and never let the router resolve it.
// Execution limits differ from Vals (disclosed, not hidden effort): Vals max output 128k (Luna/Sol/Haiku), 384k (DeepSeek), 131k
// (Muse Max); our main chat caps one step at model.js stepMaxOut (16k by default, env STEP_MAX_TOKENS ≤128k) as a spend-safety
// ceiling. A step that hits it ends with finish "length" and continues; the effort sent is unchanged.

export const MUSE_C = "meta/muse-spark-1.3-contributor", MUSE_S = "meta/muse-spark-1.3", DEEPSEEK = "deepseek/deepseek-v4.1-flash";
export const LUNA = "openai/gpt-6-luna", SOL = "openai/gpt-6.1-sol", HAIKU = "anthropic/claude-haiku-5.5";
// alias → { model, effort (fixed), vals: the evaluated output cap }. Pro/batch variants are never named here.
export const POOL = {
  "muse-c": { model: MUSE_C, effort: "xhigh", vals: { effort: "xhigh (approved exception; Vals scored Max)", max_out: 131072 } },
  "muse-s": { model: MUSE_S, effort: "max", vals: { effort: "max", max_out: 131072 } },
  deepseek: { model: DEEPSEEK, effort: "max", vals: { effort: "max (release note says high)", max_out: 384000 } },
  luna: { model: LUNA, effort: "max", vals: { effort: "max", max_out: 128000 } },
  sol: { model: SOL, effort: "max", vals: { effort: "max", max_out: 128000 } },
  haiku: { model: HAIKU, effort: "max", vals: { effort: "max (compute effort)", max_out: 128000 } },
};
export const POOL_MODELS = Object.values(POOL).map((x) => x.model);
export const inPool = (m) => POOL_MODELS.includes(m);
export const aliasOf = (m) => Object.keys(POOL).find((k) => POOL[k].model === m) || null;
// THE effort for a managed model (fixed). Anything else → null (not a pool model: its caller's own configuration applies).
export const fixedEffort = (m) => POOL[aliasOf(m)]?.effort ?? null;
// Meta's API accepts only tool_choice "auto" (research 10-08: named/required/none → 400). A request that needs a forced choice can't use it.
export const autoToolsOnly = (m) => m === MUSE_C || m === MUSE_S;
export const isMuse = autoToolsOnly;

// Categories the decider chooses from (route2.js CATEGORY_QUESTION). Ids are stable: stored on routes, sessions and resumes.
export const CATEGORIES = ["general", "research", "apps_economical", "skills", "spreadsheet", "technical", "apps_complete"];
export const DEFAULT_CATEGORY = "general";   // missing/invalid decider output → the cheapest everyday route (deterministic, conservative)
export const CATEGORY_LABEL = { general: "everyday", research: "research/finance/legal/tax", apps_economical: "economical app building", skills: "skill-supported execution",
  spreadsheet: "spreadsheet", technical: "demanding technical", apps_complete: "complete app building" };
const C = "muse-c", S = "muse-s", D = "deepseek", L = "luna", O = "sol", H = "haiku";
// Availability chains, primary first (PROMPT.md §2/§3). Same for every subscription plan.
export const CHAINS = {
  general:         { unrestricted: [C, D, L], no_training: [D, S, L], zdr: [D, L, H] },
  research:        { unrestricted: [C, D, O], no_training: [S, D, O], zdr: [D, O, H] },
  apps_economical: { unrestricted: [C, D, H], no_training: [D, S, H], zdr: [D, H, O] },
  skills:          { unrestricted: [C, D, O], no_training: [D, O, S], zdr: [D, O, H] },
  spreadsheet:     { unrestricted: [L, O, C], no_training: [L, O, S], zdr: [L, O, H] },
  technical:       { unrestricted: [O, H, D], no_training: [O, H, D], zdr: [O, H, D] },
  apps_complete:   { unrestricted: [H, O, D], no_training: [H, O, D], zdr: [H, O, D] },
};
export const MAX_MODELS = 3, MAX_ATTEMPTS = 5;   // models per dispatch; total attempts (incl. same-model endpoint retries)
export const normalizeCategory = (c) => CATEGORIES.includes(c) ? c : DEFAULT_CATEGORY;
// The chain's models for a category × level (no eligibility filter: that's privacy.js, at dispatch).
export const chainModels = (category, level) => (CHAINS[normalizeCategory(category)][level] || CHAINS[normalizeCategory(category)].zdr).map((a) => POOL[a].model);

// Quality recovery (PROMPT.md §4): what a concrete failure or the person's correction switches to, by category. Direct jumps, never a
// walk down the availability chain. null model = keep the model and correct the approach (a note to the helper).
export const APPROACH_NOTE = "(Context note, not from the person: they weren't satisfied with the last result. Before redoing it, re-read their exact request and every correction, say briefly what you'll do differently, check what you already found or built instead of starting over, and verify the result against what they asked.)";
export const RESEARCH_NOTE = "(Context note, not from the person: they weren't satisfied with the research. Widen and correct the approach: check primary and authoritative sources, compare at least two, say what each source actually says with links, and flag anything uncertain instead of guessing.)";
export const RECOVERY = {
  apps_economical: { model: HAIKU, why: "missing app functionality" }, apps_complete: { model: HAIKU, why: "missing app functionality" },
  technical: { model: SOL, why: "technical blocker" }, spreadsheet: { model: SOL, why: "spreadsheet problem" },
  research: { model: null, alternate: true, note: RESEARCH_NOTE, why: "research approach" },
  general: { model: null, note: APPROACH_NOTE, why: "corrected approach" }, skills: { model: null, note: APPROACH_NOTE, why: "corrected approach" },
};
// In-turn concrete failures (route2.js escalation: the same tool failing twice, stalled steps, malformed calls, "I'm stuck" after tool
// work) are technical blockers → Sol directly.
export const IN_TURN_TARGET = SOL;

// Deterministic keyword guess, used ONLY to label what a dev test turn would have routed to (test-model.js turns never call the decider)
// and by the ops route preview. Never dispatched in place of the decider.
export function guessCategory(text) {
  const t = String(text || "");
  if (/\b(spreadsheet|workbook|excel|xlsx|csv|google sheets?)\b/i.test(t)) return "spreadsheet";
  if (/\b(debug|stack ?trace|segfault|migrat(e|ion)|refactor|terminal|compile|build (is )?fail|failing tests?|kubernetes|docker|sql schema)\b/i.test(t)) return "technical";
  if (/\b(app|website|web ?site|web app|landing page|script|game|extension|plugin)\b/i.test(t) && /\b(build|make|create|code|write|develop)\b/i.test(t))
    return /\b(every feature|fully (working|functional)|complete|production|all the features|works end.to.end)\b/i.test(t) ? "apps_complete" : "apps_economical";
  if (/\b(research|sources?|cite|citations?|tax(es)?|legal|lawyer|contract|lease|financ(e|ial)|invest|stocks?|10-?k)\b/i.test(t)) return "research";
  return DEFAULT_CATEGORY;
}
