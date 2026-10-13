// Task categories and the quality-recovery rules. Which MODEL answers each category, and which model takes over on recovery, is not
// decided here: it is the saved setting of the job "chat.<category>", "recover.<category>" or "escalate" (model-jobs.js, edited on the
// Models page). This file holds no model names and no reasoning levels.
//
// The decider (decider.js) picks a task CATEGORY per message (route2.js); the category's saved list, filtered by the account's AI data
// privacy setting (privacy.js), gives the ordered models. Each model in a list carries its own saved reasoning level.

// Categories the decider chooses from (route2.js CATEGORY_QUESTION). Ids are stable: stored on routes, sessions and resumes.
export const CATEGORIES = ["general", "research", "apps_economical", "skills", "spreadsheet", "technical", "apps_complete"];
export const DEFAULT_CATEGORY = "general";   // missing/invalid decider output → the cheapest everyday route (deterministic, conservative)
export const CATEGORY_LABEL = { general: "everyday", research: "research/finance/legal/tax", apps_economical: "economical app building", skills: "skill-supported execution",
  spreadsheet: "spreadsheet", technical: "demanding technical", apps_complete: "complete app building" };
export const MAX_MODELS = 3, MAX_ATTEMPTS = 5;   // models per dispatch; total attempts (incl. same-model endpoint retries)
export const normalizeCategory = (c) => CATEGORIES.includes(c) ? c : DEFAULT_CATEGORY;

// Quality recovery (PROMPT.md §4): what a concrete failure or the person's correction switches to, by category. Direct jumps, never a
// walk down the availability chain. null model = keep the model and correct the approach (a note to the helper).
export const APPROACH_NOTE = "(Context note, not from the person: they weren't satisfied with the last result. Before redoing it, re-read their exact request and every correction, say briefly what you'll do differently, check what you already found or built instead of starting over, and verify the result against what they asked.)";
export const RESEARCH_NOTE = "(Context note, not from the person: they weren't satisfied with the research. Widen and correct the approach: check primary and authoritative sources, compare at least two, say what each source actually says with links, and flag anything uncertain instead of guessing.)";
// job: the saved setting that names the model ("recover.<category>"); alternate: the second allowed model of the category's own list.
export const RECOVERY = {
  apps_economical: { job: "recover.apps_economical", why: "missing app functionality" }, apps_complete: { job: "recover.apps_complete", why: "missing app functionality" },
  technical: { job: "recover.technical", why: "technical blocker" }, spreadsheet: { job: "recover.spreadsheet", why: "spreadsheet problem" },
  research: { alternate: true, note: RESEARCH_NOTE, why: "research approach" },
  general: { note: APPROACH_NOTE, why: "corrected approach" }, skills: { note: APPROACH_NOTE, why: "corrected approach" },
};
// In-turn concrete failures (route2.js escalation: the same tool failing twice, stalled steps, malformed calls, "I'm stuck" after tool
// work) are technical blockers: the rest of the turn moves to the saved model of the job "escalate".
export const IN_TURN_JOB = "escalate";

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
