// The note a run gets once, shortly before its step limit (the limit itself is set on the Models page and is not changed here). Both engines use it:
// resident.js (the plain loop) and pi-engine.js. "left" is how many more model calls may still use tools; the run is warned when 3 or fewer remain.
export const STEP_WARN_AT = 3;
export const stepsLeft = (step, limit) => limit - 1 - step;
export const shouldWarnSteps = (step, limit, warned) => !warned && Number.isFinite(limit) && stepsLeft(step, limit) >= 1 && stepsLeft(step, limit) <= STEP_WARN_AT;
export function stepWarning(left, worker) {
  const n = `${left} step${left === 1 ? "" : "s"}`;
  return worker
    ? `(${n} left before the step limit. Finish the deliverable now: write or save the output the job asks for, then call done.)`
    : `(${n} left before the step limit. Finish now: do the last thing the request needs, then write your final answer or report.)`;
}
// A resumed run may already hold the note (it is saved with the messages), so it is not sent twice.
export const hasStepWarning = (messages) => (messages || []).some((m) => /steps? left before the step limit/.test(typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "")));

// The last model call of a worker that hit its step limit: only the done tool stays available, and the ask names it.
export const WORKER_LIMIT_ASK = "(Step limit reached. No more tools except done. Call done now with your final report: what you checked, what you found, and what the next run should reuse or do differently.)";
export const DONE_ONLY = new Set(["done"]);

// Some models write a tool call as plain text instead of calling the tool (e.g. DeepSeek's DSML markup, or an Anthropic style invoke block).
// When a worker's report text holds a done call with a response parameter, this returns the response text. Otherwise it returns null.
export function doneResponseFromMarkup(text) {
  const t = String(text ?? "");
  const inv = /invoke\s+name\s*=\s*["']done["'][^>]*>/i.exec(t); if (!inv) return null;
  const rest = t.slice(inv.index + inv[0].length);
  const par = /parameter\s+name\s*=\s*["']response["'][^>]*>/i.exec(rest); if (!par) return null;
  let body = rest.slice(par.index + par[0].length);
  const end = body.search(/<\/[^<>]*(?:parameter|invoke|calls)[^<>]*>|<[^<>]*(?:parameter|invoke)\s+name\s*=/i);
  if (end >= 0) body = body.slice(0, end);
  body = body.trim();
  return body || null;
}
