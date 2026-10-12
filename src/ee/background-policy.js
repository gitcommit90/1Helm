// Evaluated background roles. Keep independent of settings/transport so the UI and
// runtime share one policy without changing other chores or main-chat routing.
const models = {
  haiku: { model: "anthropic/claude-haiku-5.5", hosts: ["google-vertex", "amazon-bedrock"] },
  luna: { model: "openai/gpt-6-luna", hosts: ["azure", "azure/us", "azure/eu"] },
  dsflash: { model: "deepseek/deepseek-v4.1-flash", hosts: ["together", "modal", "coreweave"] },
};
const policy = (modelKey, maxTokens, timeoutMs = 90000) => Object.freeze({ modelKey, ...models[modelKey],
  hosts: Object.freeze([...models[modelKey].hosts]), effort: "low", maxTokens, timeoutMs, fallbackPolicy: "same-model-only" });
export const BACKGROUND_POLICIES = Object.freeze({
  label: policy("haiku", 2048, 30000),
  notes: policy("luna", 1500),
  notes_refine: policy("dsflash", 8192),
  notes_final: policy("haiku", 4000),
  sidecar_card: policy("haiku", 1600),
  ambient_extract: policy("luna", 3000),
  ambient_review: policy("dsflash", 3000),
  people_verify: policy("dsflash", 6000),
  reflect_verify: policy("dsflash", 6000),
});
export const backgroundPolicy = role => BACKGROUND_POLICIES[role] || null;
export function backgroundRoute(role) {
  const p = backgroundPolicy(role);
  return p ? { model: p.model, host: [...p.hosts], effort: p.effort, pin: true,
    fallbacks: [], only: true, chore: true, backgroundRole: role } : null;
}
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
