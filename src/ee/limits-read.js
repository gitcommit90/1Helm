// The one reader of the saved limits (src/limits.js). It takes the Worker env, or an env that modelSettingsEnv already made, and returns the limits in
// the units the code uses. A turn reads them once at its start, so a change on the Models page applies from the next message.
// If the saved settings can't be read, the starting values (today's values) are used, so a settings outage never removes a safety limit.
import { readModelSettings } from "./model-settings.js";
import { runtimeLimits, DEFAULT_RUNTIME_LIMITS, jobTimeoutDefault } from "./limits.js";
import { jobTimeoutMs } from "./model-jobs.js";

const settingsOf = async (env) => env?.MODEL_SETTINGS || (await readModelSettings(env)).config;
// Own AI key accounts still use 1Helm's saved limits: the limits protect 1Helm's own account and the turn loop, not one provider.
export async function limitsFor(env) {
  try { return runtimeLimits(await settingsOf(env)); }
  catch (e) {
    console.error("limits: saved settings could not be read, using the starting values", String(e?.message || e).slice(0, 160));
    return DEFAULT_RUNTIME_LIMITS;
  }
}
// A job's timeout in milliseconds, or null for none: the saved `timeout_ms` of the job, else its starting value.
export async function jobTimeoutFor(env, jobId) {
  try { return jobTimeoutMs(await settingsOf(env), jobId); } catch { return jobTimeoutDefault(jobId); }
}
