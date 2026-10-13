// The saved model settings: the single source of truth for every model the platform uses. Each job (model-jobs.js) has its own saved
// model, reasoning level and fallback list. Runtime code reads only these (modelSettingsEnv), and the Models page writes them.
// Reads are uncached and use D1's primary session: an already-running Durable Object sees saves on its next dispatch.
//
// Storage: append-only versions in model_job_settings_versions (new in migration 058). The earlier slot-based table
// (model_settings_versions) is only read, once, to carry an environment's existing choices into the first version.
import { PRIVACY_LEVELS } from "../privacy.js";
import { modelCatalog, validCatalogRecord, validModelId } from "./model-catalog.js";
import { JOBS, JOB_IDS, JOB_KINDS, GROUPS, takesChat, canChat, nativeFor, zdrApplies, ModelSettingsError, jobDef, jobSetting, settingsOf, entriesOf, factsOf, zdrBlocked, privacyCoverage } from "./model-jobs.js";
import { seedFromLegacy, mergeLevels } from "./model-seed.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const settingsEnvironment = (env) => env?.ENV_NAME === "dev" ? "dev" : "live";
export { ModelSettingsError };

const EFFORTS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const QUIRKS = ["auto_tool_choice_only", "reasoning_replay", "no_temperature", "rate_limit_waits", "reasoning_mandatory", "no_json"];
const TABLE = "model_job_settings_versions";
const CREATE = `CREATE TABLE IF NOT EXISTS ${TABLE} (environment TEXT NOT NULL, revision INTEGER NOT NULL, config TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL, action TEXT NOT NULL, PRIMARY KEY (environment, revision))`;
// Other models (speech, search index, pictures, Cloudflare) can't be checked against OpenRouter's chat catalog: only the shape is.
const looseId = (id) => typeof id === "string" && id.length <= 160 && /^[@~a-zA-Z0-9][a-zA-Z0-9._~:-]*(\/[a-zA-Z0-9][a-zA-Z0-9._:~-]*)+$/.test(id);

// ---- validation ----
function keys(o, expected, path) {
  if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).length !== expected.length || expected.some((k) => !own(o, k))) fail(`Invalid ${path}: supply exactly ${expected.join(", ")}.`);
}
function validFacts(m, id) {
  if (m?.eligible === true) return validCatalogRecord(m, id);
  const allowed = ["id", "name", "kinds", "efforts", "quirks", "json", "in_nano"];
  return !!m && typeof m === "object" && m.id === id && Object.keys(m).every((k) => allowed.includes(k)) && typeof m.name === "string" && m.name.length <= 160
    && (m.kinds == null || (Array.isArray(m.kinds) && m.kinds.length <= 8 && m.kinds.every((k) => typeof k === "string" && k.length <= 40)))
    && Array.isArray(m.efforts) && m.efforts.length <= 12 && m.efforts.every((e) => EFFORTS.includes(e))
    && (m.quirks == null || (typeof m.quirks === "object" && Object.entries(m.quirks).every(([k, v]) => QUIRKS.includes(k) && v === true)))
    && (m.json == null || typeof m.json === "boolean") && (m.in_nano == null || (Number.isFinite(m.in_nano) && m.in_nano >= 0 && m.in_nano <= 100000));
}
// Whether a model can run a kind of job: models for the kind's own call, plus (for any-model kinds) every model that can chat.
export const kindOk = (meta, kind) => meta?.eligible === true ? takesChat(kind) : Array.isArray(meta?.kinds) && (meta.kinds.includes(kind.pick) || (!!kind.any && (canChat(meta) || nativeFor(meta, kind))));
function validEntry(e, path, config, def, isMain) {
  const allowed = isMain ? ["model", "effort", "hosts", "pin", "strict", "fallbacks"] : ["model", "effort", "hosts", "pin", "strict"];
  if (!e || typeof e !== "object" || Array.isArray(e) || Object.keys(e).some((k) => !allowed.includes(k)) || !own(e, "model") || !own(e, "effort")) fail(`Invalid ${path}.`);
  const kind = JOB_KINDS[def.kind], meta = config.catalog?.[e.model];
  if (!looseId(e.model) || !meta) fail(`${path}: choose a validated model.`);
  if (!kindOk(meta, kind)) fail(`${path}: ${meta.name || e.model} can't be used for ${def.label}.${kind.needs ? ` ${kind.needs}` : ""}`);
  if (kind.effort) { if (!(meta.efforts || []).includes(e.effort)) fail(`${path}: ${meta.name || e.model} doesn't support reasoning level ${String(e.effort)}.`); }
  else if (e.effort != null) fail(`${path}: this job has no reasoning level.`);
  if (e.hosts != null && (!Array.isArray(e.hosts) || e.hosts.length > 8 || !e.hosts.every((h) => typeof h === "string" && /^[a-z0-9][a-z0-9/_.-]{0,99}$/.test(h)))) fail(`${path}: invalid providers.`);
  if (e.pin != null && typeof e.pin !== "boolean") fail(`${path}: invalid provider pin.`);
  if (e.strict != null && e.strict !== true) fail(`${path}: invalid flag.`);
  if (zdrApplies(kind, meta) && zdrBlocked(config, e.model)) fail(`${path}: ${meta.name || e.model} has no zero-data-retention provider, so it can't run ${def.label}.`);
}
export function validateModelSettings(config, { fill = false } = {}) {
  config = clone(config);
  if (fill && config?.jobs && typeof config.jobs === "object") for (const id of JOB_IDS) if (!own(config.jobs, id)) config.jobs[id] = null;
  keys(config, ["version", "jobs", "catalog"], "settings");
  if (config.version !== 2) fail("Unsupported settings version.");
  if (!config.catalog || typeof config.catalog !== "object" || Array.isArray(config.catalog) || Object.keys(config.catalog).length > 120) fail("Invalid model metadata.");
  for (const [id, m] of Object.entries(config.catalog)) if (!validFacts(m, id)) fail(`Invalid model metadata for ${id}.`);
  if (Object.values(config.catalog).filter((m) => m.eligible === true).length > 30) fail("Too many model replacements.");
  keys(config.jobs, JOB_IDS, "jobs");
  for (const def of JOBS) {
    const job = config.jobs[def.id], kind = JOB_KINDS[def.kind];
    if (job === null && fill) continue;   // only while filling in jobs a later release added
    validEntry(job, def.label, config, def, true);
    if (!Array.isArray(job.fallbacks) || job.fallbacks.length > kind.fallbacks) fail(`${def.label}: at most ${kind.fallbacks} fallback model${kind.fallbacks === 1 ? "" : "s"}.`);
    job.fallbacks.forEach((f, i) => validEntry(f, `${def.label} fallback ${i + 1}`, config, def, false));
    const ids = entriesOf(job).map((e) => e.model);
    if (new Set(ids).size !== ids.length) fail(`${def.label}: each model can be listed once.`);
  }
  return config;
}

// ---- storage ----
const dbOf = (env) => env?.DB?.withSession ? env.DB.withSession("first-primary") : env?.DB;
const LAST_GOOD = new Map();   // per environment: the last settings that were read and checked, used only if a later read fails
async function readRow(env, revision = null) {
  const db = dbOf(env); if (!db) throw new ModelSettingsError("Model settings storage is unavailable. Nothing was sent.");
  const q = () => db.prepare(`SELECT revision,config,at,by,action FROM ${TABLE} WHERE environment=?${revision == null ? " ORDER BY revision DESC LIMIT 1" : " AND revision=?"}`)
    .bind(settingsEnvironment(env), ...(revision == null ? [] : [revision])).first();
  try { return await q(); }
  catch (e) {
    if (!/no such table/i.test(String(e?.message))) throw e;
    await db.prepare(CREATE).run();   // the table is new in migration 058; creating it here is the same statement and is safe to repeat
    return await q();
  }
}
async function insertRow(env, revision, config, by, action) {
  const db = dbOf(env), env_ = settingsEnvironment(env);
  const r = await db.prepare(`INSERT INTO ${TABLE} (environment,revision,config,at,by,action) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM ${TABLE} WHERE environment=?),0)=?`)
    .bind(env_, revision + 1, JSON.stringify(config), Date.now(), String(by || "admin").slice(0, 254), action, env_, revision).run();
  return Number(r?.meta?.changes) === 1;
}
function configOf(row) {
  try { return validateModelSettings(JSON.parse(row.config)); }
  catch { throw new ModelSettingsError("Stored model settings are invalid. Restore an earlier version from Models. Nothing was sent."); }
}
// The earlier slot-based settings, read once to carry over what an environment had chosen. Absent table, row or reset = no saved choices.
async function earlierSettings(env) {
  const db = dbOf(env);
  try {
    const row = await db.prepare("SELECT config FROM model_settings_versions WHERE environment=? ORDER BY revision DESC LIMIT 1").bind(settingsEnvironment(env)).first();
    if (!row?.config) return null;
    const c = JSON.parse(row.config);
    return c && typeof c === "object" && !Array.isArray(c) ? c : null;
  } catch (e) {
    if (/no such table/i.test(String(e?.message))) return null;
    throw e;
  }
}
// The first saved version: what is in effect today (model-seed.js). Runs once per environment.
async function firstVersion(env) {
  const earlier = await earlierSettings(env), seeded = seedFromLegacy(env, earlier);
  let config;
  try { config = validateModelSettings(seeded); }
  catch (e) { console.error("model settings: the first version could not be made from the earlier settings", String(e?.message || e)); throw new ModelSettingsError("The model settings could not be set up from the earlier settings. Nothing was sent."); }
  const ok = await insertRow(env, 0, config, "system", earlier ? "migrate" : "seed");
  console.log("model settings: first version saved", JSON.stringify({ environment: settingsEnvironment(env), from: earlier ? "earlier settings" : "first-run data", won: ok }));
  return ok;
}
// A job added by a later release has no saved setting yet: its starting value is copied in once, as a new version.
async function addMissingJobs(env, row, config) {
  const missing = JOB_IDS.filter((id) => !config.jobs[id]);
  if (!missing.length) return null;
  const seeded = seedFromLegacy(env, null), next = clone(config);
  for (const id of missing) next.jobs[id] = seeded.jobs[id];
  for (const [id, m] of Object.entries(seeded.catalog)) if (!own(next.catalog, id)) next.catalog[id] = m;
  const valid = validateModelSettings(next);
  const ok = await insertRow(env, Number(row.revision), valid, "system", `add-jobs:${missing.join(",")}`.slice(0, 120));
  console.log("model settings: added jobs from first-run data", missing.join(","), ok ? "saved" : "another instance saved first");
  return ok;
}
let FIRST_RUN;
const firstRunSettings = () => (FIRST_RUN ||= validateModelSettings(seedFromLegacy({}, null)));
export async function readModelSettings(env) {
  // Without the EE switch the shared settings table is neither read nor written: callers get the first-run data, held in memory.
  if (env?.ONEHELM_EE !== "1hc") return { revision: 0, config: firstRunSettings() };
  const key = settingsEnvironment(env);
  try {
    for (let tries = 0; tries < 3; tries++) {
      let row = await readRow(env);
      if (!row) { await firstVersion(env); row = await readRow(env); if (!row) continue; }
      let config; const raw = JSON.parse(row.config);
      try { config = validateModelSettings(raw); }
      catch {
        // Only jobs missing from an otherwise valid version are filled in; any other fault is reported, never repaired by guessing.
        try { config = validateModelSettings(raw, { fill: true }); } catch { throw new ModelSettingsError("Stored model settings are invalid. Restore an earlier version from Models. Nothing was sent."); }
        if (JOB_IDS.some((id) => !config.jobs[id])) { await addMissingJobs(env, row, config); continue; }
      }
      const out = { revision: Number(row.revision), config };
      LAST_GOOD.set(key, out);
      return out;
    }
    throw new ModelSettingsError("Model settings could not be completed. Nothing was sent.");
  } catch (e) {
    const good = LAST_GOOD.get(key);
    if (good) {
      console.error("model settings: read failed, using the last saved copy this instance read", String(e?.message || e).slice(0, 200));
      return { ...good, stale: true };
    }
    console.error("model settings: read failed and there is no saved copy", String(e?.message || e).slice(0, 200));
    throw e instanceof ModelSettingsError ? e : new ModelSettingsError("Model settings could not be read. Nothing was sent.");
  }
}
// A snapshot for one dispatch only. Never mutate the Worker env or keep this on a long-lived Resident.
export async function modelSettingsEnv(env) {
  if (env?.BYOK || env?.MODEL_SETTINGS) return env;
  // Without the EE switch nothing reads the shared settings table: a deployment gets the first-run data, unchanged and in memory only.
  if (env?.ONEHELM_EE !== "1hc") return Object.assign(Object.create(env || null), { MODEL_SETTINGS: firstRunSettings(), MODEL_SETTINGS_REVISION: 0 });
  const s = await readModelSettings(env);
  return Object.assign(Object.create(env || null), { MODEL_SETTINGS: s.config, MODEL_SETTINGS_REVISION: s.revision, ...(s.stale ? { MODEL_SETTINGS_STALE: true } : {}) });
}

// The saved main model of one job, for callers that only need the model's name (speech, search index, pictures).
// These parts of the platform run on 1Helm's own account even for own-key accounts, so they always read the saved settings.
const jobSettings = async (env) => env?.MODEL_SETTINGS || (env?.ONEHELM_EE === "1hc" ? (await readModelSettings(env)).config : firstRunSettings());
export async function jobModel(env, id) { return jobSetting(await jobSettings(env), id).model; }
// The saved model of a job and its estimated cost in nano-dollars per input token (a model's saved facts), for jobs billed by size.
export async function jobCost(env, id) { const s = await jobSettings(env), model = jobSetting(s, id).model; return { model, in_nano: Number(s.catalog?.[model]?.in_nano) || 240 }; }
// The saved main model and fallbacks of one job, in order.
export async function jobModels(env, id) { return entriesOf(jobSetting(await jobSettings(env), id)).map((e) => e.model); }

// ---- the page's view ----
// Per kind of job, the models the picker offers: exactly the ones the save check accepts (kindOk) that also meet the job's
// zero-data-retention rule, so a normal pick is never refused.
function choicesOf(config) {
  const out = {}, kinds = new Map();
  for (const k of Object.values(JOB_KINDS)) { out[k.pick] = []; kinds.set(k.pick, k); }
  for (const [id, m] of Object.entries(config.catalog)) {
    for (const [pick, kind] of kinds) {
      if (!kindOk(m, kind) || (zdrApplies(kind, m) && zdrBlocked(config, id))) continue;
      out[pick].push({ id, name: m.name || id, efforts: m.efforts || [], validated: m.eligible === true, chat: canChat(m) });
    }
  }
  return out;
}
export const modelSettingsOptions = (config) => ({ groups: GROUPS, jobs: JOBS, kinds: JOB_KINDS, levels: PRIVACY_LEVELS, choices: choicesOf(config) });
export async function modelSettingsView(env) {
  const db = dbOf(env), s = await readModelSettings(env);
  const history = (await db.prepare(`SELECT revision,at,by,action FROM ${TABLE} WHERE environment=? ORDER BY revision DESC LIMIT 30`).bind(settingsEnvironment(env)).all()).results || [];
  return { environment: settingsEnvironment(env), revision: s.revision, config: s.config, stale: !!s.stale, options: modelSettingsOptions(s.config), history,
    effective: "New tasks and background calls use these settings. Running tasks keep the model and reasoning level they started with. Privacy restrictions and explicit operator revocations still apply immediately." };
}

// ---- writing ----
function revisionOf(value) { if (!Number.isSafeInteger(value) || value < 0) fail("A valid settings revision is required."); return value; }
async function write(env, revision, config, by, action) {
  revisionOf(revision);
  if (!dbOf(env)) throw new ModelSettingsError("Model settings storage is unavailable.");
  if (!(await insertRow(env, revision, config, by, action))) fail("Settings changed in another window. Reload before saving.", 409);
  return modelSettingsView(env);
}
// Never trust a browser's endpoint, price or capability snapshot: only the jobs come from the browser. A model the saved settings
// already know keeps its saved record; a new chat model is checked against OpenRouter's catalog; other new models are checked for shape.
async function validatedSelection(env, config, current) {
  if (!config || typeof config !== "object" || Array.isArray(config) || !config.jobs || typeof config.jobs !== "object") fail("Invalid settings.");
  const next = { version: 2, jobs: clone(config.jobs), catalog: clone(current.catalog) };
  const need = new Map();
  for (const def of JOBS) {
    const job = next.jobs[def.id]; if (!job || typeof job !== "object") continue;
    for (const e of [job, ...(Array.isArray(job.fallbacks) ? job.fallbacks : [])]) if (e && typeof e.model === "string" && !own(next.catalog, e.model)) need.set(e.model, def);
  }
  let live = null;
  for (const [id, def] of need) {
    const kind = JOB_KINDS[def.kind], pick = kind.pick;
    if (takesChat(kind)) {
      if (!validModelId(id)) fail("Invalid model ID.");
      live ||= new Map((await modelCatalog(env)).models.map((m) => [m.id, m]));
      const m = live.get(id); if (!m?.eligible) fail(`${id}: ${m?.reasons?.join("; ") || "not available in OpenRouter's catalog"}.`);
      next.catalog[id] = m;
    } else {
      if (!looseId(id)) fail("Invalid model ID.");
      next.catalog[id] = { id, name: id, kinds: [pick], efforts: [] };
    }
  }
  // Drop catalog entries nothing uses any more, except facts the first version carried (they stay selectable).
  const used = new Set(); for (const j of Object.values(next.jobs)) if (j) for (const e of entriesOf(j)) used.add(e.model);
  for (const [id, m] of Object.entries(next.catalog)) if (m.eligible === true && !used.has(id)) delete next.catalog[id];
  return validateModelSettings(next);
}
export async function saveModelSettings(env, { revision, config }, by) {
  revisionOf(revision);
  // Stale writes fail before fetching a changing external catalog (the atomic write checks again).
  const current = await readModelSettings(env); if (current.revision !== revision) fail("Settings changed in another window. Reload before saving.", 409);
  return write(env, revision, await validatedSelection(env, config, current.config), by, "save");
}
export async function restoreModelSettings(env, { revision, restore_revision }, by) {
  revisionOf(restore_revision);
  const row = restore_revision ? await readRow(env, restore_revision) : null;
  if (!row) fail("That settings version does not exist.", 404);
  const current = await readModelSettings(env).catch(() => ({ config: { catalog: {} } }));
  return write(env, revision, await validatedSelection(env, configOf(row), { catalog: { ...current.config.catalog, ...clone(configOf(row).catalog) } }), by, `restore:${restore_revision}`);
}
export { mergeLevels, factsOf, privacyCoverage, jobDef };
