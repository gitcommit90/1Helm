// Runtime administration: stable route slots with validated OpenRouter model replacements.
// Reads are uncached and use D1's primary session: an already-running Durable Object sees saves on its next dispatch.
import { POOL, CHAINS, CATEGORIES, CATEGORY_LABEL } from "./pool.js";
import { PRIVACY_LEVELS, eligibleHosts } from "../privacy.js";
import { modelCatalog, validCatalogRecord, validModelId } from "./model-catalog.js";

// OpenRouter /api/v1/models, checked 2026-10-10. "none" is available only when reasoning is optional.
const EFFORTS = {
  "muse-c": ["minimal", "low", "medium", "high", "xhigh", "max"],
  "muse-s": ["minimal", "low", "medium", "high", "xhigh", "max"],
  deepseek: ["none", "low", "high", "max"], luna: ["none", "low", "medium", "high", "xhigh", "max"],
  sol: ["low", "medium", "high", "xhigh", "max"], haiku: ["none", "low", "medium", "high", "xhigh", "max"],
};
export const SETTINGS_CHORE_MODELS = {
  oss120: { model: "openai/gpt-oss-120b", hosts: ["cerebras"], efforts: ["default", "low", "medium", "high"] },
  oss20: { model: "openai/gpt-oss-20b", hosts: ["amazon-bedrock"], efforts: ["default", "low", "medium", "high"] },
  dsflash: { model: POOL.deepseek.model, hosts: ["together", "modal", "coreweave"], efforts: ["default", ...EFFORTS.deepseek] },
  haiku: { model: POOL.haiku.model, hosts: ["amazon-bedrock", "google-vertex"], efforts: ["default", ...EFFORTS.haiku] },
  luna: { model: POOL.luna.model, hosts: ["azure", "azure/us", "azure/eu"], efforts: ["default", ...EFFORTS.luna] },
  sol: { model: POOL.sol.model, hosts: ["azure", "azure/us", "azure/eu"], efforts: ["default", ...EFFORTS.sol] },
};
export const SETTINGS_CHORES = ["handoff", "label", "browser", "notes", "notes_final", "memory_summary", "sidecar_card", "upkeep_write", "upkeep_verify", "people_write", "people_verify", "reflect_write", "reflect_verify"];
const DECIDERS = ["default", "perplexity/pplx-decider-v1.1-27b", "~typesafe/jev-latest"];
const clone = (x) => JSON.parse(JSON.stringify(x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const settingsEnvironment = (env) => env?.ENV_NAME === "dev" ? "dev" : "live";
export function defaultModelSettings() {
  return { efforts: Object.fromEntries(Object.entries(POOL).map(([k, m]) => [k, m.effort])), chains: clone(CHAINS),
    chores: Object.fromEntries(SETTINGS_CHORES.map((k) => [k, { model: "default", effort: "default" }])), decider: "default" };
}
export function modelSettingsOptions(env = {}, config = null) {
  return { models: Object.entries(POOL).map(([key, m]) => { const id = slotModel(config, key), meta = config?.catalog?.[id]; return { key, model: id, default_model: m.model, efforts: meta?.efforts || EFFORTS[key], levels: meta?.levels || PRIVACY_LEVELS.filter((lv) => eligibleHosts(m.model, lv).length) }; }),
    categories: CATEGORIES.map((key) => ({ key, label: CATEGORY_LABEL[key] })), levels: PRIVACY_LEVELS,
    chores: SETTINGS_CHORES,
    choreDefaults: {
      handoff: `Inherited: ${env.CHORE_MODEL_HANDOFF || env.CHORE_MODEL || "oss120"}, provider default effort`,
      label: `Inherited: Qwen 3.8 27B, reasoning off; ${env.CHORE_MODEL_LABEL || env.CHORE_MODEL || "oss120"} fallback`,
      browser: `Inherited: ${env.CHORE_MODEL_BROWSER || env.CHORE_MODEL || "oss120"}; DeepSeek/Haiku reasoning off, gpt-oss low`,
      notes: `Inherited: ${env.CHORE_MODEL_NOTES || "haiku"}, reasoning off for Haiku/DeepSeek`,
      notes_final: "Inherited: Luna medium, gpt-oss fallback", memory_summary: "Inherited: Qwen 3.8 27B off, gpt-oss then Workers AI fallback",
      sidecar_card: "Inherited: built-in file summary route",
      ...Object.fromEntries(["upkeep", "people", "reflect"].flatMap((job) => [
        [`${job}_write`, `Inherited: ${env[`CHORE_MODEL_${job.toUpperCase()}`] || "dsflash"}`],
        [`${job}_verify`, `Inherited: ${env.CHORE_MODEL_MJVERIFY || (job === "upkeep" ? "dsflash" : "oss120:medium")}`],
      ])),
    },
    choreModels: [{ key: "default", model: "Built-in defaults", efforts: ["default"] }, ...Object.entries(SETTINGS_CHORE_MODELS).map(([key, m]) => ({ key, model: m.model, efforts: m.efforts }))],
    deciders: DECIDERS.map((key) => ({ key, label: key === "default" ? "Built-in default" : key.startsWith("~") ? "TypeSafe Jev" : "Perplexity" })) };
}
function keys(o, expected, path) {
  if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).length !== expected.length || expected.some((k) => !own(o, k))) fail(`Invalid ${path}: supply exactly ${expected.join(", ")}.`);
}
export function validateModelSettings(config) {
  keys(config, ["efforts", "chains", "chores", "decider", ...(own(config, "models") ? ["models"] : []), ...(own(config, "catalog") ? ["catalog"] : [])], "settings");
  if (own(config, "models")) keys(config.models, Object.keys(POOL), "model slots");
  if (own(config, "catalog")) {
    if (!config.catalog || typeof config.catalog !== "object" || Array.isArray(config.catalog) || Object.keys(config.catalog).length > 19) fail("Invalid model metadata.");
    for (const [id, record] of Object.entries(config.catalog)) if (!validCatalogRecord(record, id)) fail("Invalid model metadata.");
  }
  keys(config.efforts, Object.keys(POOL), "model efforts");
  const seen = new Map();
  for (const key of Object.keys(POOL)) {
    const id = slotModel(config, key), meta = config.catalog?.[id];
    if (!validModelId(id) || id !== POOL[key].model && !meta) fail(`Choose a validated OpenRouter model for ${key}.`);
    if (!(meta?.efforts || EFFORTS[key]).includes(config.efforts[key])) fail(`Unsupported effort for ${key}.`);
    if (seen.has(id) && seen.get(id) !== config.efforts[key]) fail(`The same model (${id}) must use the same effort in every main slot.`);
    seen.set(id, config.efforts[key]);
  }
  keys(config.chains, CATEGORIES, "routes");
  for (const category of CATEGORIES) {
    keys(config.chains[category], PRIVACY_LEVELS, `${category} routes`);
    for (const level of PRIVACY_LEVELS) {
      const a = config.chains[category][level];
      if (!Array.isArray(a) || a.length < 1 || a.length > 3 || new Set(a).size !== a.length) fail(`${category}/${level}: choose one to three different models.`);
      for (const key of a) if (typeof key !== "string" || !own(POOL, key) || !configuredHosts(config, slotModel(config, key), level).length) fail(`${category}/${level}: ${String(key)} is not an eligible model.`);
    }
  }
  keys(config.chores, SETTINGS_CHORES, "background roles");
  for (const role of SETTINGS_CHORES) {
    const c = config.chores[role]; keys(c, ["model", "effort"], role);
    const meta = config.catalog?.[c.model];
    const efforts = c.model === "default" ? ["default"] : own(SETTINGS_CHORE_MODELS, c.model) ? SETTINGS_CHORE_MODELS[c.model].efforts : meta?.levels?.includes("zdr") ? meta.efforts : [];
    if (!efforts.includes(c.effort)) fail(`${role}: unsupported model or effort.`);
  }
  if (!DECIDERS.includes(config.decider)) fail("Choose a supported routing decider.");
  return clone(config);
}
function dbOf(env) { return env?.DB?.withSession ? env.DB.withSession("first-primary") : env?.DB; }
async function readRow(env, revision = null, { legacy = false } = {}) {
  const db = dbOf(env); if (!db) { if (legacy) return null; fail("Model settings storage is unavailable.", 503); }
  try {
    return await db.prepare(`SELECT revision,config,at,by,action FROM model_settings_versions WHERE environment=?${revision == null ? " ORDER BY revision DESC LIMIT 1" : " AND revision=?"}`)
      .bind(settingsEnvironment(env), ...(revision == null ? [] : [revision])).first();
  } catch (e) {
    // During staged rollout, environments without the additive migration keep the established code defaults.
    if (legacy && /no such table: model_settings_versions/i.test(String(e?.message))) return null;
    fail("Model settings could not be read. Try again.", 503);
  }
}
function configOf(row) {
  if (!row?.config) return null;
  try { return validateModelSettings(JSON.parse(row.config)); } catch { fail("Stored model settings are invalid; restore or reset them from Models.", 503); }
}
export async function readModelSettings(env) {
  const row = await readRow(env, null, { legacy: true });
  return { revision: Number(row?.revision || 0), config: configOf(row) };
}
export async function modelSettingsView(env) {
  const row = await readRow(env);
  const history = (await dbOf(env).prepare("SELECT revision,at,by,action FROM model_settings_versions WHERE environment=? ORDER BY revision DESC LIMIT 30").bind(settingsEnvironment(env)).all()).results || [];
  let config = null, config_error = null;
  try { config = configOf(row); } catch (e) { config_error = e.message; }
  return { environment: settingsEnvironment(env), revision: Number(row?.revision || 0), config: config || defaultModelSettings(), config_error, defaults: defaultModelSettings(), options: modelSettingsOptions(env, config), history,
    inherited: !row?.config, effective: "New model calls, including the next step of running tasks. In-flight calls finish with their existing settings." };
}
function revisionOf(value) { if (!Number.isSafeInteger(value) || value < 0) fail("A valid settings revision is required."); return value; }
async function write(env, revision, config, by, action) {
  revisionOf(revision); const db = dbOf(env); if (!db) fail("Model settings storage is unavailable.", 503);
  const r = await db.prepare("INSERT INTO model_settings_versions (environment,revision,config,at,by,action) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM model_settings_versions WHERE environment=?),0)=?")
    .bind(settingsEnvironment(env), revision + 1, config == null ? null : JSON.stringify(config), Date.now(), String(by || "admin").slice(0, 254), action, settingsEnvironment(env), revision).run();
  if (Number(r?.meta?.changes) !== 1) fail("Settings changed in another window. Reload before saving.", 409);
  return modelSettingsView(env);
}
async function validatedSelection(env, config) {
  // Never trust a browser's endpoint/pricing/capability snapshot, including an echoed prior version.
  if (!config || typeof config !== "object" || Array.isArray(config)) fail("Invalid settings.");
  const clean = clone(config); delete clean.catalog;
  const ids = new Set();
  if (clean.models) for (const [key, id] of Object.entries(clean.models)) {
    if (!own(POOL, key) || !validModelId(id)) fail("Invalid replacement model ID.");
    if (id !== POOL[key].model) ids.add(id);
  }
  for (const c of Object.values(clean.chores || {})) if (c?.model !== "default" && !own(SETTINGS_CHORE_MODELS, c?.model)) {
    if (!validModelId(c?.model)) fail("Invalid background model ID."); ids.add(c.model);
  }
  if (ids.size > 19) fail("Too many model replacements.");
  if (ids.size) {
    const catalog = await modelCatalog(env), map = new Map(catalog.models.map((m) => [m.id, m])); clean.catalog = {};
    for (const id of ids) { const m = map.get(id); if (!m?.eligible) fail(`${id}: ${m?.reasons?.join("; ") || "not available in OpenRouter's catalog"}.`); clean.catalog[id] = m; }
  }
  return validateModelSettings(clean);
}
export const saveModelSettings = async (env, { revision, config }, by) => {
  revisionOf(revision);
  // Stale writes should fail before fetching a changing external catalog (atomic write still rechecks).
  const current = await readRow(env); if (Number(current?.revision || 0) !== revision) fail("Settings changed in another window. Reload before saving.", 409);
  return write(env, revision, await validatedSelection(env, config), by, "save");
};
export const resetModelSettings = (env, { revision }, by) => write(env, revision, null, by, "reset");
export async function restoreModelSettings(env, { revision, restore_revision }, by) {
  revisionOf(restore_revision);
  const row = restore_revision ? await readRow(env, restore_revision) : null;
  if (restore_revision && !row) fail("That settings version does not exist.", 404);
  const config = configOf(row);
  return write(env, revision, config ? await validatedSelection(env, config) : null, by, `restore:${restore_revision}`);
}
// Snapshot belongs to one dispatch only. Never mutate Worker env or keep this on a long-lived Resident.
export async function modelSettingsEnv(env) {
  if (env?.ONEHELM_EE !== "1hc" || env?.BYOK) return env;
  const settings = await readModelSettings(env);
  return Object.assign(Object.create(env || null), { MODEL_SETTINGS: settings.config, MODEL_SETTINGS_REVISION: settings.revision });
}
export function configuredChore(env, role, fallbackEffort = "low") {
  const c = env?.MODEL_SETTINGS?.chores?.[role]; if (!c || c.model === "default") return null;
  const meta = env.MODEL_SETTINGS.catalog?.[c.model];
  const m = SETTINGS_CHORE_MODELS[c.model] || { model: c.model, hosts: configuredHosts(env.MODEL_SETTINGS, c.model, "zdr") }, fallback = SETTINGS_CHORE_MODELS.oss120;
  return { model: m.model, host: m.hosts, effort: c.effort, pin: true, chore: true, only: true, runtimeSettings: true, max_output: meta?.max_output, json: meta ? meta.json : c.model !== "oss20",
    fallbacks: c.model === "oss120" ? [] : [{ model: fallback.model, host: fallback.hosts, effort: fallbackEffort, pin: true }] };
}

export const slotModel = (settings, key) => settings?.models?.[key] || POOL[key]?.model;
export const configuredAlias = (settings, model) => Object.keys(POOL).find((key) => slotModel(settings, key) === model) || null;
export const configuredEffort = (settings, model) => { const key = configuredAlias(settings, model); return settings?.efforts?.[key] ?? POOL[key]?.effort ?? null; };
// Resolve old, persisted routes and recovery constants through their stable slot on every call.
export const replacementModel = (settings, model) => { const key = Object.keys(POOL).find((k) => POOL[k].model === model); return key ? slotModel(settings, key) : configuredAlias(settings, model) ? model : null; };
export function configuredHosts(settings, model, level) {
  const meta = settings?.catalog?.[model];
  if (!meta) return eligibleHosts(model, level);
  if (!meta.levels.includes(level)) return [];
  const registered = eligibleHosts(model, level);
  // Catalog records for new IDs are strict ZDR; known IDs still intersect the static policy registry.
  return eligibleHosts(model, "unrestricted").length ? meta.hosts.filter((h) => registered.some((base) => h === base || h.startsWith(`${base}/`))) : meta.hosts;
}
