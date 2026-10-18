// The output limit of one /models job, read from its saved setting. An empty limit stays empty (null): no max_tokens is sent and each provider's own maximum
// applies (Captain 2026-10-17). Nothing here sets or lowers a saved limit. The call itself gets its limit from the dispatcher (model-dispatch.js), which uses the same plan.
import { plan } from "./model-plan.js";
import { modelSettingsEnv, readModelSettings } from "./model-settings.js";
import { jobMaxOutput, factsOf, categoryOf, categoryLimits } from "./model-jobs.js";
import { OR_RESERVE_PRICE } from "../model.js";

// The first model's saved limit for the job (kept below that model's context window), or the saved limit alone when no model can run at the
// zero-data-retention level, or null when the job has none saved.
export async function plannedMaxOutput(env, jobId, level = "zdr") {
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS || (await readModelSettings(env)).config;   // an own-key account's env carries no copy
  return plan(settings, jobId, { level }).steps[0]?.maxOutput ?? jobMaxOutput(settings, jobId) ?? null;
}

// The output tokens a spend hold must assume for a call. A saved limit counts as saved. With none saved, the model could write as much as its
// largest endpoint allows, so the hold uses that published maximum (the catalog keeps the largest endpoint limit), kept below the context window.
// It is a size for the hold only: it is never sent and never lowers anything. A model whose facts give neither a published maximum nor a context
// window (a record that was never verified on the Models page) is held at UNKNOWN_MODEL_HOLD, so a call is never held for its input alone.
export const UNKNOWN_MODEL_HOLD = 64000;
export function holdOutput(settings, model, saved) {
  if (Number.isFinite(saved)) return saved;
  const facts = factsOf(settings, model), ctx = Number.isFinite(facts?.context_length) && facts.context_length > 1 ? facts.context_length - 1 : Infinity;
  return Number.isFinite(facts?.max_output) && facts.max_output > 0 ? Math.min(facts.max_output, ctx) : Number.isFinite(ctx) ? ctx : UNKNOWN_MODEL_HOLD;
}
// The hold for the output of one call, in nano dollars: the output tokens above at the model's own published completion price (the dearest endpoint's), or at
// the reservation ceiling when the record has no price.
export function holdOutNano(settings, model, saved) {
  const p = Number(factsOf(settings, model)?.pricing?.completion);
  return holdOutput(settings, model, saved) * (Number.isFinite(p) && p >= 0 ? p * 1000 : OR_RESERVE_PRICE.out);
}
export async function plannedHold(env, jobId, level = "zdr") {
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS || (await readModelSettings(env)).config;
  const step = plan(settings, jobId, { level }).steps[0];
  return step ? holdOutput(settings, step.model, step.maxOutput) : holdOutput(settings, null, jobMaxOutput(settings, jobId));
}
// The dearest output hold over the job's main model and fallbacks (nano dollars), because any of them may answer.
export async function plannedHoldNano(env, jobId, level = "zdr") {
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS || (await readModelSettings(env)).config;
  const steps = plan(settings, jobId, { level }).steps;
  return steps.length ? Math.max(...steps.map((s) => holdOutNano(settings, s.model, s.maxOutput))) : holdOutput(settings, null, jobMaxOutput(settings, jobId)) * OR_RESERVE_PRICE.out;
}

// A chat reply's limits belong to the routing category the turn was routed to (General when it names none): the saved max output, and a spend hold sized
// from the dearest model of the category's list for the privacy level.
export async function plannedChatMaxOutput(env, category) {
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS || (await readModelSettings(env)).config;
  return categoryLimits(settings, category).max_output;
}
export async function plannedChatHoldNano(env, category, level = "zdr") {
  const settings = (await modelSettingsEnv(env)).MODEL_SETTINGS || (await readModelSettings(env)).config;
  const saved = categoryLimits(settings, category).max_output, chain = categoryOf(settings, category)?.chains?.[level] || [];
  return chain.length ? Math.max(...chain.map((e) => holdOutNano(settings, e.model, saved))) : holdOutput(settings, null, saved) * OR_RESERVE_PRICE.out;
}
