// The browser job's attempts as request bodies, built from the plan (what dispatch sends for the job "browser"). For tests only.
import { plan } from "../../src/ee/model-plan.js";
import { modelSettingsEnv } from "../../src/ee/model-settings.js";
import { effortBody } from "../../src/ee/model-jobs.js";
export async function browserPlan(env) {
  const e = await modelSettingsEnv(env);
  return plan(e.MODEL_SETTINGS, "browser", { level: "zdr" }).steps.map((s) => ({ model: s.model, ...(Number.isFinite(s.maxOutput) ? { max_tokens: s.maxOutput } : {}), ...effortBody(s.effort, s.model, e.MODEL_SETTINGS), provider: s.provider, usage: { include: true } }));
}
