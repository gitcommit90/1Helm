// Output limits for the evaluated background roles. Which model runs each role, its reasoning level, its fallbacks, its max output and its timeout are
// the role's saved setting (model-jobs.js, the Models page). The output limit and the timeout are those saved fields (the timeout is `timeout_ms`, limits.js) and have no number here.
const limits = (_job) => Object.freeze({});
export const BACKGROUND_LIMITS = Object.freeze({
  label: limits("label"),
  notes: limits("notes"),
  notes_refine: limits("notes_refine"),
  notes_final: limits("notes_final"),
  sidecar_card: limits("sidecar_card"),
  ambient_extract: limits("ambient_extract"),
  ambient_review: limits("ambient_review"),
});
export const backgroundPolicy = role => BACKGROUND_LIMITS[role] || null;
export function backgroundRole(kind) {
  return ({ "card-label": "label", "live-notes-note": "notes", "live-notes-refine": "notes_refine",
    "live-notes-final": "notes_final", "sidecar-card": "sidecar_card", "ambient-extract": "ambient_extract",
    "ambient-review": "ambient_review" })[kind] || null;
}
// Conservative reservation at the existing managed $3/$15-per-million ceiling.
// UTF-8 bytes upper-bound source tokens; framing allowance includes chat/schema
// overhead. Include every bounded attempt when a caller settles them together.
// outputNano: what the output could cost. The saved job limit when it has one, else the published maximum of its model, at the model's price (job-limits.js
// plannedHoldNano); it only sizes the hold. Without it the request's own max_tokens is held at the reservation ceiling.
export function backgroundReserve(request, attempts = 1, outputNano = Number(request.max_tokens || 0) * 15000) {
  const input = new TextEncoder().encode(JSON.stringify(request)).length + 1024;
  return Math.ceil((input * 3000 * 1.25 + Number(outputNano || 0)) * 1.15 * attempts);
}
