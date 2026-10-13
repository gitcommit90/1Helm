// Output and time limits for the evaluated background roles. Which model runs each role, its reasoning level and its fallbacks are the
// role's saved setting (model-jobs.js), not part of this file.
const limits = (maxTokens, timeoutMs = 90000) => Object.freeze({ maxTokens, timeoutMs });
export const BACKGROUND_LIMITS = Object.freeze({
  label: limits(2048, 30000),
  notes: limits(1500),
  notes_refine: limits(8192),
  notes_final: limits(4000),
  sidecar_card: limits(1600),
  ambient_extract: limits(3000),
  ambient_review: limits(3000),
  people_verify: limits(6000),
  reflect_verify: limits(6000),
});
export const backgroundPolicy = role => BACKGROUND_LIMITS[role] || null;
export function backgroundRole(kind) {
  return ({ "card-label": "label", "live-notes-note": "notes", "live-notes-refine": "notes_refine",
    "live-notes-final": "notes_final", "sidecar-card": "sidecar_card", "ambient-extract": "ambient_extract",
    "ambient-review": "ambient_review", "memjob-people-verify": "people_verify", "memjob-reflect-verify": "reflect_verify" })[kind] || null;
}
// Conservative reservation at the existing managed $3/$15-per-million ceiling.
// UTF-8 bytes upper-bound source tokens; framing allowance includes chat/schema
// overhead. Include every bounded attempt when a caller settles them together.
export function backgroundReserve(request, attempts = 1) {
  const input = new TextEncoder().encode(JSON.stringify(request)).length + 1024;
  return Math.ceil((input * 3000 * 1.25 + Number(request.max_tokens || 0) * 15000) * 1.15 * attempts);
}
