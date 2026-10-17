// What the media call sites (pictures, video, speech, embeddings, the browser look, web search) read about a job from the saved
// model settings: the plan's steps, and a reservation that follows the saved max output and the model's catalog price.
// No model, limit or provider is named here. The call itself is made by dispatch() in model-dispatch.js.
import { plan } from "./model-plan.js";
import { modelSettingsEnv } from "./model-settings.js";
import { factsOf } from "./model-jobs.js";
import { dispatch } from "./model-dispatch.js";

// Used only when neither the catalog nor the saved job gives a price: the ceiling a job without a saved max_price already gets.
const UNPRICED = { prompt: 3, completion: 15 };   // dollars per million tokens

// The plan of a job from the saved settings. level "unrestricted" keeps every step, which is what a reservation must cover.
export async function stepsOf(env, jobId, { level = "unrestricted", call = null } = {}) {
  const e = await modelSettingsEnv(env);
  return { env: e, steps: plan(e.MODEL_SETTINGS, jobId, { level, call }).steps };
}
// Nano dollars per token, in and out, for a step: the catalog price, else the saved job's max price, else the ceiling above.
export function nanoPerToken(settings, step) {
  const p = factsOf(settings, step.model)?.pricing, cap = step.provider?.max_price || UNPRICED;
  const one = (v, c) => Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== "" ? Number(v) * 1000 : c * 1000;
  return { in: one(p?.prompt, cap.prompt), out: one(p?.completion, cap.completion) };
}
// The most a call to this job can cost before the markup, over the job's main model and its fallbacks (the dearest one counts).
export async function jobReserveNano(env, jobId, tokensIn, { level = "unrestricted", call = null } = {}) {
  const { env: e, steps } = await stepsOf(env, jobId, { level, call });
  let most = 0;
  for (const s of steps) {
    const n = nanoPerToken(e.MODEL_SETTINGS, s), out = s.maxOutput ?? factsOf(e.MODEL_SETTINGS, s.model)?.max_output ?? 0;
    most = Math.max(most, tokensIn * n.in + out * n.out);
  }
  return Math.ceil(most);
}
// The first step the job runs at this level, or null.
export async function firstStep(env, jobId, level = "unrestricted") { return (await stepsOf(env, jobId, { level })).steps[0] || null; }
// dispatch() for the media call sites. A job with no model allowed at the account's privacy level is reported the way the callers already
// read it (err.privacy, status 451), besides dispatch's own err.privacyBlocked.
export async function dispatchMedia(env, jobId, request, opts) {
  try { return await dispatch(env, jobId, request, opts); }
  catch (e) { if (e?.privacyBlocked && !e.privacy) { e.privacy = true; e.status = 451; } throw e; }
}
