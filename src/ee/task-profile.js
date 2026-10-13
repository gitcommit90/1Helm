// Managed append-runtime task identity. This is routing state, not credentials.
// Default settings select NEW tasks; persisted tasks retain their selection.
// Current privacy, credential mode, and explicit operator revocations still win.
import { routeTwoTurn, dispatchOrder, setTurnRoute } from "./route2.js";
import { modelSettingsEnv } from "./model-settings.js";
import { configuredHosts } from "./model-jobs.js";
import { taskModelCatalog, validCatalogRecord, effectiveTaskCatalog } from "./model-catalog.js";
import { privacyOf, enforceRequest, PrivacyBlocked } from "../privacy.js";
import { testEffortOf } from "../internal-test-model.js";

export const TASK_PROFILE_KEY = (session) => `task-profile:${session}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const list = (value) => String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
export class TaskAffinityBlocked extends Error {
  constructor(message, reason) { super(message); this.status = 409; this.taskAffinity = true; this.code = "task_affinity_blocked"; this.reason = reason; }
}
// settings (optional): the saved model settings, which say which models accept only automatic tool choice.
export function readTaskProfile(R, session, settings = R?.env?.MODEL_SETTINGS) {
  const raw = R.get(TASK_PROFILE_KEY(session));
  if (raw == null || raw === "") return null;
  try {
    const profile = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("invalid profile");
    return { ...profile, catalog: effectiveTaskCatalog(profile.catalog, profile.requestedModel, settings) };
  }
  catch { throw new TaskAffinityBlocked("This task's model profile could not be restored. Start a new task; the conversation is still saved.", "invalid-profile"); }
}
export function taskRoute(profile) {
  return { two: true, taskAffinity: true, taskProfile: profile, model: profile.requestedModel, primary: profile.requestedModel,
    served: profile.servedModel || null, effort: profile.effort, category: profile.category, level: profile.level,
    fallbacks: [], only: true, why: "task-affinity", reason: "task-affinity", floor: "task model", label: `task/${profile.requestedModel}` };
}
export function bindTaskProfile(R, tc, profile, stats = null) {
  tc.taskProfile = profile;
  setTurnRoute(R, tc, taskRoute(profile));
  if (stats) stats.route = { label: tc.route.label, category: profile.category, level: profile.level, taskAffinity: true, model: profile.requestedModel, settingsRevision: profile.settingsRevision };
  return profile;
}
export async function ensureTaskRuntime(R, tc, args = {}) {
  if (R.env?.ONEHELM_EE !== "1hc") throw new TaskAffinityBlocked("Managed task routing is unavailable on this deployment.", "ee-disabled");
  if (!tc?.session) throw new TaskAffinityBlocked("A task identity is required before starting the model.", "missing-session");
  let profile = readTaskProfile(R, tc.session, (await modelSettingsEnv(R.env)).MODEL_SETTINGS);
  if (profile) {
    await authorizeTaskProfile(R.env, profile, R.get("tenant"));
    return bindTaskProfile(R, tc, profile, args.stats);
  }
  // Arbitrary BYOK endpoints do not yet provide verified capacity metadata.
  // They remain on the established BYOK lane, never a managed-model substitute.
  if (R.env.BYOK) throw new TaskAffinityBlocked("This task uses your own AI service and must continue on the own-key runtime.", "byok-legacy");
  const env = await modelSettingsEnv(R.env), level = await privacyOf(env, R.get("tenant"));
  const { route } = await routeTwoTurn(R, tc, args);
  const pick = route.test ? { model: route.model, effort: null } : dispatchOrder(route, level, { settings: env.MODEL_SETTINGS }).attempts[0], selected = pick?.model;
  if (!selected) throw new PrivacyBlocked("No task model is eligible under the current AI data privacy setting. Review Settings → General → AI data privacy.");
  // Only server-injected fixtures or validated catalog settings can supply a snapshot.
  const saved = env.TASK_MODEL_CATALOG?.[selected] || env.MODEL_SETTINGS?.catalog?.[selected];
  const catalog = effectiveTaskCatalog(validCatalogRecord(saved, selected) ? clone(saved) : await taskModelCatalog(selected, env.MODEL_SETTINGS), selected, env.MODEL_SETTINGS);
  const hosts = configuredHosts({ catalog: { [selected]: catalog } }, selected, level);
  if (!hosts.length) throw new PrivacyBlocked(`The selected task model ${selected} is not allowed by your current AI data privacy setting.`);
  const stepBudget = Number(env.STEP_MAX_TOKENS) >= 1024 ? Math.min(Math.round(Number(env.STEP_MAX_TOKENS)), 128000) : 50000;
  profile = { version: 1, mode: "managed", credentialRef: "managed-openrouter", requestedModel: selected, servedModel: null, servedProvider: null,
    effort: route.test ? testEffortOf(env) : pick.effort, category: route.category || "general", level,
    hosts, catalog, contextLength: catalog.context_length, maxOutput: Math.min(stepBudget, catalog.max_output, catalog.context_length - 1),
    cacheSession: JSON.stringify([R.get("tenant"), R.get("channel"), tc.session]), settingsRevision: env.MODEL_SETTINGS_REVISION || 0,
    createdAt: Date.now(), transitions: [] };
  await authorizeTaskProfile(env, profile, R.get("tenant"));
  R.put(TASK_PROFILE_KEY(tc.session), JSON.stringify(profile));
  return bindTaskProfile(R, tc, profile, args.stats);
}
export async function authorizeTaskProfile(env, profile, tenant, body = {}) {
  if (env?.ONEHELM_EE !== "1hc") throw new TaskAffinityBlocked("Managed task routing is unavailable on this deployment.", "ee-disabled");
  env = await modelSettingsEnv(env);
  if (profile?.version !== 1 || profile.mode !== "managed") throw new TaskAffinityBlocked("This task's model profile cannot be restored. Start a new task; the conversation is still saved.", "invalid-profile");
  if (env.BYOK) throw new TaskAffinityBlocked("Your AI billing mode changed to your own key. This task has stopped before sending its history to a different model. Start a new task with your own AI service, or restore the original mode.", "credential-mode-changed");
  if (!env.OPENROUTER_API_KEY || env.MODEL_PROVIDER === "workers-ai") throw new TaskAffinityBlocked("This task's AI service is unavailable. Restore the managed service and retry; no other model was substituted.", "credential-unavailable");
  if (list(env.TASK_REVOKED_MODELS).includes(profile.requestedModel)) throw new TaskAffinityBlocked("This task's model has been disabled. Start a new task with an available model; no history was sent to a replacement.", "model-revoked");
  const level = await privacyOf(env, tenant), revoked = list(env.TASK_REVOKED_HOSTS);
  // Session-based provider stickiness belongs to OpenRouter. Keep the original
  // whitelist order stable; observed canonical hosts are diagnostic, not a
  // manual order that would disable upstream stickiness.
  const hosts = profile.hosts.filter((h) => !revoked.some((r) => h === r || h.startsWith(`${r}/`)));
  if (!hosts.length) throw new TaskAffinityBlocked("This task's AI providers have been disabled. Retry after service is restored or start a new task.", "provider-revoked");
  // Static privacy registry and OpenRouter's strict filter are applied afresh,
  // never widened to make an old profile work under a changed privacy choice.
  try {
    const checked = enforceRequest({ model: profile.requestedModel, provider: { order: hosts, only: hosts } }, level);
    const c = effectiveTaskCatalog(profile.catalog, profile.requestedModel, env.MODEL_SETTINGS), choice = typeof body.tool_choice === "object" ? "function" : body.tool_choice;
    if (choice && !c.tool_choice.includes(choice)) throw new TaskAffinityBlocked(`This task's model does not support ${choice} tool selection. No different model was substituted.`, "unsupported-tool-choice");
    if (body.messages?.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")) && !c.input_modalities.includes("image"))
      throw new TaskAffinityBlocked("This task's model cannot read images. Start a new task with an image-capable model.", "unsupported-image");
    return { level, hosts: checked.provider.only || hosts };
  } catch (e) {
    if (!e.privacy) throw e;
    throw new PrivacyBlocked("This task's original model is no longer allowed by your AI data privacy setting. Nothing was sent to a replacement. Restore the setting or start a new task using an allowed model.", { reason: "task-privacy-revoked", model: profile.requestedModel, level });
  }
}
// Explicit migration hook for a future authorized UI/controller, not an LLM tool.
// Caller must authorize the choice and create a new context epoch before binding.
export function approvedTaskTransition(profile, replacement, { approved = false, reason = "" } = {}) {
  if (!approved || !String(reason).trim()) throw new TaskAffinityBlocked("Changing a task's model requires an approved migration and recorded reason.", "migration-not-approved");
  return { ...clone(replacement), cacheSession: profile.cacheSession, transitions: [...(profile.transitions || []),
    { from: profile.requestedModel, to: replacement.requestedModel, reason: String(reason).slice(0, 300), at: Date.now() }] };
}
export function recordTaskServed(R, tc, { model = null, provider = null, providerHost = null } = {}) {
  if (!tc?.taskProfile) return;
  // Only an exact canonical host from the response can update host diagnostics.
  // Display names ("Amazon Bedrock") and endpoint indices are not host identities.
  const host = typeof providerHost === "string" && tc.taskProfile.hosts.includes(providerHost) ? providerHost : null;
  const profile = { ...tc.taskProfile, ...(model ? { servedModel: model } : {}), ...(provider ? { servedProvider: provider } : {}),
    ...(host ? { preferredHost: host, providerIdentitySource: "response-canonical-host" } : {}),
    ...(provider && !host ? { providerIdentityUnresolved: true } : host ? { providerIdentityUnresolved: false } : {}) };
  const changed = ["servedModel", "servedProvider", "preferredHost", "providerIdentitySource", "providerIdentityUnresolved"].some((k) => profile[k] !== tc.taskProfile[k]);
  // Providers commonly repeat model/provider fields on every SSE chunk. Only
  // new identity evidence belongs in durable KV, not thousands of equal writes.
  if (!changed) { if (tc.route?.taskAffinity) tc.route.served = profile.servedModel; return; }
  R.put(TASK_PROFILE_KEY(tc.session), JSON.stringify(profile)); tc.taskProfile = profile;
  if (tc.route?.taskAffinity) { tc.route.taskProfile = profile; tc.route.served = profile.servedModel; }
}
