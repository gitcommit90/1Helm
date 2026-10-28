// Managed append-runtime task identity. This is routing state, not credentials.
// Default settings select NEW tasks; persisted tasks retain their selection.
// Current privacy, credential mode, and explicit operator revocations still win.
import { routeTwoTurn, dispatchOrder, setTurnRoute, policyRoute } from "./route2.js";
import { modelSettingsEnv } from "./model-settings.js";
import { configuredHosts } from "./model-jobs.js";
import { taskModelCatalog, validCatalogRecord, effectiveTaskCatalog, catalogUnavailable, isLatestAlias } from "./model-catalog.js";
import { privacyOf, enforceRequest, PrivacyBlocked } from "../privacy.js";
import { dynamicRoutingOn, generalRoutingChain } from "./routing-config.js";
import { customRouting } from "./custom-models.js";

export const TASK_PROFILE_KEY = (session) => `task-profile:${session}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
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
    fallbacks: (profile.poolChain || []).slice(1).map(p => p.requestedModel), ...(profile.dynamicRouting ? { dynamicRouting: true, dispatch: profile.dispatch, requiredDelegation: profile.dispatch?.requiredDelegation, steer: profile.dispatch?.steer } : {}), only: true, why: "task-affinity", reason: "task-affinity", floor: "task model", label: `task/${profile.requestedModel}` };
}
export function bindTaskProfile(R, tc, profile, stats = null) {
  tc.taskProfile = profile;
  setTurnRoute(R, tc, taskRoute(profile));
  if (stats) stats.route = { ...(stats.route || {}), label: tc.route.label, category: profile.dispatch?.category || profile.category, level: profile.level, taskAffinity: true, model: profile.requestedModel, settingsRevision: profile.settingsRevision };
  return profile;
}
// A scheduled task is a fresh General dispatch, not a classifier request or a
// shared summary job. Its journal owns the frozen profile, never the chat KV.
export async function bindBackgroundRuntime(R, tc, { resumed = false, stats = null, workflowId = null } = {}) {
  if (!["workflow", "followup"].includes(tc?.kind)) return false;
  if (resumed) {
    if (!tc.route?.taskProfile?.backgroundGeneral) return false;
    bindTaskProfile(R, tc, tc.route.taskProfile, stats);
    return true;
  }
  if (!dynamicRoutingOn(R.env) || R.env.BYOK) return false;
  const base = await modelSettingsEnv(R.env), level = await privacyOf(base, R.get("tenant"));
  const env = (await customRouting(base, R.get("tenant")))?.env || base;   // Custom Model Selection: the account's own General, or CustomModelsRequired (custom-models.js)
  const profile = await routingProfile(R, generalRoutingChain(env.MODEL_SETTINGS, level), {
    category: "general", session: JSON.stringify(["background", workflowId, tc.turn]), env });
  profile.backgroundGeneral = true;
  bindTaskProfile(R, tc, profile, stats);
  return true;
}
export async function ensureTaskRuntime(R, tc, args = {}) {
  if (R.env?.ONEHELM_EE !== "1hc") throw new TaskAffinityBlocked("Managed task routing is unavailable on this deployment.", "ee-disabled");
  if (!tc?.session) throw new TaskAffinityBlocked("A task identity is required before starting the model.", "missing-session");
  const settingsEnv = await modelSettingsEnv(R.env);
  if (dynamicRoutingOn(settingsEnv)) {
    const restored = tc.route?.taskProfile;
    if (restored?.dynamicRouting) return bindTaskProfile(R, tc, restored, args.stats);
    const { route } = await routeTwoTurn(R, tc, { ...args, hist: args.hist?.length ? args.hist : R.compactHistory?.(tc.session) || [] });
    const routeEnv = (await customRouting(settingsEnv, R.get("tenant")))?.env || settingsEnv;   // Custom Model Selection: the facts of the account's own models
    const profile = await routingProfile(R, route.chain, { category: "general", session: tc.session, env: routeEnv });
    profile.dynamicRouting = true;
    profile.dispatch = { category: route.category, requiredDelegation: route.requiredDelegation, steer: route.steer || null,
      workerProfile: route.category === "general" ? { ...clone(profile), cacheSession: JSON.stringify([R.get("tenant"), R.get("channel"), tc.session, "worker"]) } : await routingProfile(R, route.workerChain, { category: route.category, session: `${tc.session}:worker`, env: routeEnv }) };
    R.put(TASK_PROFILE_KEY(tc.session), JSON.stringify(profile));
    return bindTaskProfile(R, tc, profile, args.stats);
  }
  let profile = readTaskProfile(R, tc.session, settingsEnv.MODEL_SETTINGS);
  // A running task picks up a change made on the Models page at the NEXT person message (Captain, 2026-10-17); inside one turn the model stays fixed.
  // profile.refreshedTurn is the turn the profile was last read from the saved settings. A profile saved before this field existed is stamped with the
  // current turn and kept (a turn resumed after a deploy must not change model half way); it refreshes at the next message.
  const turn = tc.turn ?? null;
  if (profile && profile.refreshedTurn === undefined) { profile = { ...profile, refreshedTurn: turn }; R.put(TASK_PROFILE_KEY(tc.session), JSON.stringify(profile)); }
  if (profile && (turn == null || profile.refreshedTurn === turn)) {
    await authorizeTaskProfile(R.env, profile, R.get("tenant"));
    return bindTaskProfile(R, tc, profile, args.stats);
  }
  const previous = profile;
  // A tightened privacy setting still stops the task before anything is sent (nothing is substituted); only a task that is still allowed moves to the saved list.
  if (previous) await authorizeTaskProfile(R.env, previous, R.get("tenant"));
  // Arbitrary BYOK endpoints do not yet provide verified capacity metadata.
  // They remain on the established BYOK lane, never a managed-model substitute.
  if (R.env.BYOK) throw new TaskAffinityBlocked("This task uses your own AI service and must continue on the own-key runtime.", "byok-legacy");
  const env = await modelSettingsEnv(R.env), level = await privacyOf(env, R.get("tenant"));
  // A refresh keeps the task's category and reads that category's saved list again; it asks the request sorter nothing.
  const { route } = previous ? { route: policyRoute(env.MODEL_SETTINGS, previous.category || "general", level, "saved settings") } : await routeTwoTurn(R, tc, args);
  const pick = dispatchOrder(route, level, { settings: env.MODEL_SETTINGS }).attempts[0], selected = pick?.model;
  if (!selected) throw new PrivacyBlocked("No task model is eligible under the current AI data privacy setting. Review Settings → General → AI data privacy.");
  // Only server-injected fixtures or validated catalog settings can supply a snapshot.
  const saved = env.TASK_MODEL_CATALOG?.[selected] || env.MODEL_SETTINGS?.catalog?.[selected];
  const catalog = effectiveTaskCatalog(await taskCatalogFor(selected, saved, env), selected, env.MODEL_SETTINGS);
  const hosts = configuredHosts({ catalog: { [selected]: catalog } }, selected, level);
  if (!hosts.length) throw new PrivacyBlocked(`The selected task model ${selected} is not allowed by your current AI data privacy setting.`);
  const same = previous && previous.requestedModel === selected;
  profile = { version: 1, mode: "managed", credentialRef: "managed-openrouter", requestedModel: selected, servedModel: same ? previous.servedModel : null, servedProvider: same ? previous.servedProvider : null,
    effort: pick.effort, category: route.category || "general", level,
    hosts, catalog, contextLength: catalog.context_length, maxOutput: Math.min(catalog.max_output, catalog.context_length - 1),   // the model's own ceiling; the limit a step uses is the saved job's max_output (model.js taskPayload)
    cacheSession: previous?.cacheSession || JSON.stringify([R.get("tenant"), R.get("channel"), tc.session]), settingsRevision: env.MODEL_SETTINGS_REVISION || 0,
    createdAt: previous?.createdAt || Date.now(), refreshedTurn: turn,
    transitions: [...(previous?.transitions || []), ...(previous && !same ? [{ from: previous.requestedModel, to: selected, reason: "saved settings changed", at: Date.now() }] : [])] };
  await authorizeTaskProfile(env, profile, R.get("tenant"));
  R.put(TASK_PROFILE_KEY(tc.session), JSON.stringify(profile));
  return bindTaskProfile(R, tc, profile, args.stats);
}
// The capabilities a task starts with. A saved snapshot is used when valid, except for a ~...-latest ID: it can point at a new model between
// tasks, so its limits and providers are read again at task start (the saved snapshot is the fallback when OpenRouter can't be reached).
async function taskCatalogFor(model, saved, env) {
  const ok = validCatalogRecord(saved, model);
  if (ok && (!isLatestAlias(model) || env.TASK_MODEL_CATALOG?.[model])) return clone(saved);
  try { return await taskModelCatalog(model, env.MODEL_SETTINGS, env); }
  catch (e) { if (ok && catalogUnavailable(e)) return clone(saved); throw e; }
}
// Freeze the complete saved chain when a new dispatch starts. Open workers keep this snapshot through revisions.
export async function routingProfile(R, entries, { category = "general", session, env = R.env } = {}) {
  env = await modelSettingsEnv(env);
  const level = await privacyOf(env, R.get("tenant"));
  const poolChain = [], unavailableChoices = [];
  for (const [index, entry] of (entries || []).entries()) {
    const model = entry.model, saved = env.TASK_MODEL_CATALOG?.[model] || env.MODEL_SETTINGS?.catalog?.[model];
    let catalog;
    try { catalog = effectiveTaskCatalog(await taskCatalogFor(model, saved, env), model, env.MODEL_SETTINGS); }
    catch (error) {
      if (!catalogUnavailable(error)) throw error;
      const skipped = { choice: index + 1, model, stage: "capabilities", code: error.code, reasons: error.reasons || ["Published model catalog could not be read"], endpointStatuses: error.endpointStatuses || [] };
      unavailableChoices.push(skipped);
      console.log("router: skipped unverified choice", JSON.stringify({ category, level, ...skipped }));
      continue;
    }
    const cf = catalog.source === "CF" || model.startsWith("@cf/") || model.startsWith("@hf/");
    poolChain.push({ version: 1, mode: "managed", credentialRef: cf ? "managed-cloudflare" : "managed-openrouter", source: cf ? "CF" : "OR",
      requestedModel: model, servedModel: null, servedProvider: null, effort: entry.effort ?? null, category, level,
      hosts: cf ? ["cloudflare"] : configuredHosts({ catalog: { [model]: catalog } }, model, level), catalog,
      contextLength: catalog.context_length, maxOutput: Math.min(catalog.max_output, catalog.context_length - 1),   // the model's own ceiling; the limit a step uses is the saved job's max_output (model.js taskPayload)
      cacheSession: JSON.stringify([R.get("tenant"), R.get("channel"), session]), settingsRevision: env.MODEL_SETTINGS_REVISION || 0,
      createdAt: Date.now(), transitions: [], ...(env.MODEL_SETTINGS_CUSTOM ? { custom: true } : {}) });   // custom: the models come from the account's Custom Model Selection (turn-trace.js marks it)
  }
  if (!poolChain.length) {
    if (unavailableChoices.length) throw Object.assign(new TaskAffinityBlocked("The configured task models have no verified capabilities available right now. Retry shortly; your conversation is saved and no task request was sent.", "model-unavailable"), { code: "model_chain_unavailable", status: 503, orStatus: 503, unavailableChoices });
    throw new PrivacyBlocked("No saved model choices exist for this privacy level.");
  }
  return { ...poolChain[0], poolChain, ...(unavailableChoices.length ? { unavailableChoices } : {}) };
}
export async function authorizeTaskProfile(env, profile, tenant, body = {}) {
  if (env?.ONEHELM_EE !== "1hc") throw new TaskAffinityBlocked("Managed task routing is unavailable on this deployment.", "ee-disabled");
  env = await modelSettingsEnv(env);
  if (profile?.version !== 1 || profile.mode !== "managed") throw new TaskAffinityBlocked("This task's model profile cannot be restored. Start a new task; the conversation is still saved.", "invalid-profile");
  if (env.BYOK) throw new TaskAffinityBlocked("Your AI billing mode changed to your own key. This task has stopped before sending its history to a different model. Start a new task with your own AI service, or restore the original mode.", "credential-mode-changed");
  const cf = profile.source === "CF" || profile.catalog?.source === "CF";
  if (cf && !env.AI) throw new TaskAffinityBlocked("Cloudflare AI is unavailable.", "credential-unavailable");
  if (!cf && !env.OPENROUTER_API_KEY) throw new TaskAffinityBlocked("This task's AI service is unavailable. Restore the managed service and retry; no other model was substituted.", "credential-unavailable");
  const level = await privacyOf(env, tenant);
  if (cf) {
    if (!profile.catalog?.levels?.includes(level)) throw new PrivacyBlocked("The saved Cloudflare model is not allowed at the current privacy level.");
    const c = effectiveTaskCatalog(profile.catalog, profile.requestedModel, env.MODEL_SETTINGS), choice = typeof body.tool_choice === "object" ? "function" : body.tool_choice;
    if (body.tools?.length && !c.tool_choice?.length) throw new TaskAffinityBlocked("The saved Cloudflare model cannot use tools.", "unsupported-tools");
    if (choice && !c.tool_choice?.includes(choice)) throw new TaskAffinityBlocked("The saved Cloudflare model does not support the requested tool choice.", "unsupported-tool-choice");
    if (body.messages?.some(m => Array.isArray(m.content) && m.content.some(p => p.type === "image_url")) && !c.input_modalities?.includes("image")) throw new TaskAffinityBlocked("The saved Cloudflare model cannot read images.", "unsupported-image");
    return { level, hosts: ["cloudflare"] };
  }
  // Static privacy registry and OpenRouter's strict filter are applied afresh,
  // never widened to make an old profile work under a changed privacy choice.
  try {
    enforceRequest({ model: profile.requestedModel, provider: {} }, level);
    const c = effectiveTaskCatalog(profile.catalog, profile.requestedModel, env.MODEL_SETTINGS), choice = typeof body.tool_choice === "object" ? "function" : body.tool_choice;
    if (choice && !c.tool_choice.includes(choice)) throw new TaskAffinityBlocked(`This task's model does not support ${choice} tool selection. No different model was substituted.`, "unsupported-tool-choice");
    if (body.messages?.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")) && !c.input_modalities.includes("image"))
      throw new TaskAffinityBlocked("This task's model cannot read images. Start a new task with an image-capable model.", "unsupported-image");
    return { level, hosts: profile.hosts };
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
  const served = tc.route?.servedProfile || tc.taskProfile.poolChain?.find(p => p.requestedModel === model);
  const profile = { ...tc.taskProfile, ...(served ? { catalog: served.catalog, contextLength: served.contextLength, maxOutput: served.maxOutput, source: served.source, hosts: served.hosts, effort: served.effort } : {}), ...(model ? { servedModel: model } : {}), ...(provider ? { servedProvider: provider } : {}),
    ...(host ? { preferredHost: host, providerIdentitySource: "response-canonical-host" } : {}),
    ...(provider && !host ? { providerIdentityUnresolved: true } : host ? { providerIdentityUnresolved: false } : {}) };
  const changed = ["servedModel", "servedProvider", "preferredHost", "providerIdentitySource", "providerIdentityUnresolved"].some((k) => profile[k] !== tc.taskProfile[k]);
  // Providers commonly repeat model/provider fields on every SSE chunk. Only
  // new identity evidence belongs in durable KV, not thousands of equal writes.
  if (!changed) { if (tc.route?.taskAffinity) tc.route.served = profile.servedModel; return; }
  if (tc.kind !== "helper" && !profile.backgroundGeneral) R.put(TASK_PROFILE_KEY(tc.session), JSON.stringify(profile)); tc.taskProfile = profile;
  if (tc.route?.taskAffinity) { tc.route.taskProfile = profile; tc.route.served = profile.servedModel; }
}
