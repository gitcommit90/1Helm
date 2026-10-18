// The task categories of the classic request sorter (routing off). Which MODEL answers is not decided here: with category routing on it is the
// saved routing category (routing-config.js), and with it off it is the saved General category (routing-config.js, edited on the Models page).
// This file holds no model names and no reasoning levels.

// Categories the decider chooses from (route2.js CATEGORY_QUESTION). Ids are stable: stored on routes, sessions and resumes.
export const CATEGORIES = ["general", "research", "apps_economical", "skills", "spreadsheet", "technical", "apps_complete"];
export const DEFAULT_CATEGORY = "general";   // missing/invalid decider output → the cheapest everyday route (deterministic, conservative)
export const CATEGORY_LABEL = { general: "everyday", research: "research/finance/legal/tax", apps_economical: "economical app building", skills: "skill-supported execution",
  spreadsheet: "spreadsheet", technical: "demanding technical", apps_complete: "complete app building" };
export const MAX_MODELS = 3, MAX_ATTEMPTS = 5;   // models per dispatch; total attempts (incl. same-model endpoint retries)
export const normalizeCategory = (c) => CATEGORIES.includes(c) ? c : DEFAULT_CATEGORY;

// Deterministic keyword guess, used ONLY to label the ops route preview. Never dispatched in place of the decider.
export function guessCategory(text) {
  const t = String(text || "");
  if (/\b(spreadsheet|workbook|excel|xlsx|csv|google sheets?)\b/i.test(t)) return "spreadsheet";
  if (/\b(debug|stack ?trace|segfault|migrat(e|ion)|refactor|terminal|compile|build (is )?fail|failing tests?|kubernetes|docker|sql schema)\b/i.test(t)) return "technical";
  if (/\b(app|website|web ?site|web app|landing page|script|game|extension|plugin)\b/i.test(t) && /\b(build|make|create|code|write|develop)\b/i.test(t))
    return /\b(every feature|fully (working|functional)|complete|production|all the features|works end.to.end)\b/i.test(t) ? "apps_complete" : "apps_economical";
  if (/\b(research|sources?|cite|citations?|tax(es)?|legal|lawyer|contract|lease|financ(e|ial)|invest|stocks?|10-?k)\b/i.test(t)) return "research";
  return DEFAULT_CATEGORY;
}
