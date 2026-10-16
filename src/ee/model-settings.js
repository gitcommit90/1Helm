// The saved model settings: the single source of truth for every model the platform uses. Each job (model-jobs.js) has its own saved
// model, reasoning level and fallback list. Runtime code reads only these (modelSettingsEnv), and the Models page writes them.
// Reads are uncached and use D1's primary session: an already-running Durable Object sees saves on its next dispatch.
//
// Storage: append-only versions in model_job_settings_versions (new in migration 058). The earlier slot-based table
// (model_settings_versions) is only read, once, to carry an environment's existing choices into the first version.
import { PRIVACY_LEVELS } from "../privacy.js";
import { modelCatalog, validCatalogRecord, validModelId } from "./model-catalog.js";
import { JOBS, JOB_IDS, MODEL_PAGE_JOBS, JOB_KINDS, GROUPS, takesChat, canChat, nativeFor, zdrApplies, ModelSettingsError, jobDef, jobSetting, settingsOf, entriesOf, factsOf, zdrBlocked, privacyCoverage, configuredHosts } from "./model-jobs.js";
import { seedFromLegacy, mergeLevels, SEED_FACTS, SHARED_OR_MOVES } from "./model-seed.js";
import { dynamicRoutingOn, withRoutingConfig } from "./routing-config.js";
import { ambientSearchOn } from "../legacy-flags.js";

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
  const allowed = ["id", "name", "kinds", "efforts", "quirks", "json", "in_nano", "formats", "sec_nano"];
  return !!m && typeof m === "object" && m.id === id && Object.keys(m).every((k) => allowed.includes(k)) && typeof m.name === "string" && m.name.length <= 160
    && (m.kinds == null || (Array.isArray(m.kinds) && m.kinds.length <= 8 && m.kinds.every((k) => typeof k === "string" && k.length <= 40)))
    && Array.isArray(m.efforts) && m.efforts.length <= 12 && m.efforts.every((e) => EFFORTS.includes(e))
    && (m.quirks == null || (typeof m.quirks === "object" && Object.entries(m.quirks).every(([k, v]) => QUIRKS.includes(k) && v === true)))
    && (m.json == null || typeof m.json === "boolean") && (m.in_nano == null || (Number.isFinite(m.in_nano) && m.in_nano >= 0 && m.in_nano <= 100000))
    && (m.formats == null || (Array.isArray(m.formats) && m.formats.length >= 1 && m.formats.length <= 12 && m.formats.every((f) => typeof f === "string" && /^[a-z0-9]{2,8}$/.test(f))))
    && (m.sec_nano == null || (Number.isFinite(m.sec_nano) && m.sec_nano >= 0 && m.sec_nano <= 1000000));
}
// Whether a model can run a kind of job: models for the kind's own call, plus (for any-model kinds) every model that can chat.
export const kindOk = (meta, kind) => meta?.eligible === true
  ? (Array.isArray(meta.kinds) && meta.kinds.length ? meta.kinds.includes(kind.pick) || (takesChat(kind) && canChat(meta)) || nativeFor(meta, kind) : takesChat(kind))
  : Array.isArray(meta?.kinds) && (meta.kinds.includes(kind.pick) || (kind.pick === "chat" && canChat(meta)) || (!!kind.any && (canChat(meta) || nativeFor(meta, kind))));
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
  keys(config, config?.version === 3 ? ["version", "jobs", "catalog", "routing"] : ["version", "jobs", "catalog"], "settings");
  if (![2, 3].includes(config.version)) fail("Unsupported settings version.");
  if (!config.catalog || typeof config.catalog !== "object" || Array.isArray(config.catalog) || Object.keys(config.catalog).length > 220) fail("Invalid model metadata.");
  for (const [id, m] of Object.entries(config.catalog)) if (!validFacts(m, id)) fail(`Invalid model metadata for ${id}.`);
  if (Object.values(config.catalog).filter((m) => m.eligible === true).length > 180) fail("Too many model replacements.");
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
  if (config.version === 3) {
    keys(config.routing, ["categories"], "routing");
    const categories = config.routing.categories;
    if (!Array.isArray(categories) || !categories.length || categories.length > 24) fail("Save between 1 and 24 categories.");
    const ids = new Set(), titles = new Set();
    for (const c of categories) {
      keys(c, ["id", "title", "chains"], "category");
      if (typeof c.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(c.id) || ids.has(c.id)) fail("Invalid category ID.");
      ids.add(c.id);
      if (typeof c.title !== "string" || !c.title.trim() || c.title.length > 240 || /[\u0000-\u001f\u007f]/.test(c.title)) fail("Enter a category title of 1 to 240 characters.");
      if (c.title !== c.title.trim()) fail("Remove spaces at the start or end of the category title.");
      if (titles.has(c.title.toLowerCase())) fail("Each category needs a different title.");
      titles.add(c.title.toLowerCase());
      if ((c.id === "general") !== (c.title === "General")) fail("General's title is locked.");
      keys(c.chains, PRIVACY_LEVELS, "category privacy choices");
      for (const level of PRIVACY_LEVELS) {
        const chain = c.chains[level];
        if (!Array.isArray(chain) || chain.length !== 3) fail(`${c.title}: choose 1st, 2nd and 3rd models for every privacy level.`);
        chain.forEach((e, i) => {
          validEntry(e, `${c.title} ${level} choice ${i + 1}`, config, { kind: "chat", label: c.title }, false);
          if (!configuredHosts(config, e.model, level).length) fail(`${c.title}: ${e.model} is not eligible for ${level}.`);
        });
        if (new Set(chain.map((e) => e.model)).size !== 3) fail(`${c.title}: choose three different models for ${level}.`);
      }
    }
    if (categories[0].id !== "general" || !ids.has("general")) fail("General must be the first category and cannot be deleted.");
  }
  return config;
}

// The saved catalog holds only models that some job uses as its model or as a fallback (Captain, 2026-10-15). A model that a save leaves unused
// drops out. The picker can still add it again: SEED_FACTS holds the facts of the speech, search, picture and Cloudflare models, and chat
// models come from OpenRouter's live catalog.
export function pruneCatalog(config) {
  const used = new Set(); for (const j of Object.values(config.jobs || {})) if (j) for (const e of entriesOf(j)) used.add(e.model);
  for (const c of config.routing?.categories || []) for (const chain of Object.values(c.chains)) for (const e of chain) used.add(e.model);
  return { ...config, catalog: Object.fromEntries(Object.entries(config.catalog || {}).filter(([id]) => used.has(id))) };
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
// A saved version can name jobs that a later release removed (for example the memory jobs). The validator requires exactly the jobs that exist
// now, so reading drops any job id that is not in the registry, and nothing else is changed. The stored row is left as it is.
export function withoutRetiredJobs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.jobs || typeof raw.jobs !== "object" || Array.isArray(raw.jobs)) return raw;
  const known = new Set(JOB_IDS), dropped = Object.keys(raw.jobs).filter((id) => !known.has(id));
  if (!dropped.length) return raw;
  return { ...raw, jobs: Object.fromEntries(Object.entries(raw.jobs).filter(([id]) => known.has(id))) };
}
function configOf(row) {
  try { return validateModelSettings(withoutRetiredJobs(JSON.parse(row.config))); }
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
// The Captain selected these exact source changes for dev. The append-only
// action marker prevents the baseline migration from overriding later edits.
const SHARED_OR_ACTION = "shared-model-source-or-v1";

async function migrateSharedSources(env, row, config) {
  if (settingsEnvironment(env) !== "dev" || !dynamicRoutingOn(env) || String(env.DYNAMIC_ROUTING_SHARED_OR || "").toLowerCase() !== "on") return false;
  const marker = await dbOf(env).prepare(`SELECT revision FROM ${TABLE} WHERE environment=? AND action=? LIMIT 1`).bind("dev", SHARED_OR_ACTION).first();
  if (marker) return false;
  const moves = SHARED_OR_MOVES.filter((m) => config.jobs[m.job]?.model === m.from), next = clone(config);
  if (moves.length) {
    const live = new Map((await modelCatalog(env, { settings: config })).models.map((m) => [m.id, m]));
    for (const move of moves) {
      const record = live.get(move.to), def = jobDef(move.job);
      if (!record?.eligible || record.source !== "OR" || !record.levels?.includes("zdr") || !validCatalogRecord(record, move.to) || !kindOk(record, JOB_KINDS[def.kind])) throw new ModelSettingsError(`The selected OpenRouter source for ${def.label} has not been verified. The saved settings have not changed.`);
      next.jobs[move.job].model = move.to;
      next.catalog[move.to] = { ...record, ...clone(move.facts || {}), ...(next.catalog[move.to]?.quirks ? { quirks: clone(next.catalog[move.to].quirks) } : {}) };
    }
    // Remove only source records replaced by this migration and now unused.
    const used = new Set(Object.values(next.jobs).flatMap(entriesOf).map((e) => e.model));
    for (const c of next.routing?.categories || []) for (const chain of Object.values(c.chains)) for (const e of chain) used.add(e.model);
    for (const move of moves) if (!used.has(move.from)) delete next.catalog[move.from];
  }
  await insertRow(env, Number(row.revision), validateModelSettings(next), "system", SHARED_OR_ACTION);
  return true;
}
export async function readModelSettings(env) {
  // Without the EE switch the shared settings table is neither read nor written: callers get the first-run data, held in memory.
  if (env?.ONEHELM_EE !== "1hc") return { revision: 0, config: firstRunSettings() };
  const key = settingsEnvironment(env);
  try {
    for (let tries = 0; tries < 5; tries++) {
      let row = await readRow(env);
      if (!row) { await firstVersion(env); row = await readRow(env); if (!row) continue; }
      let config; const stored = JSON.parse(row.config), raw = withoutRetiredJobs(stored), retired = Object.keys(stored?.jobs || {}).filter((id) => !JOB_IDS.includes(id));
      try { config = validateModelSettings(raw); }
      catch {
        // Only jobs missing from an otherwise valid version are filled in; any other fault is reported, never repaired by guessing.
        try { config = validateModelSettings(raw, { fill: true }); } catch { throw new ModelSettingsError("Stored model settings are invalid. Restore an earlier version from Models. Nothing was sent."); }
        if (JOB_IDS.some((id) => !config.jobs[id])) { await addMissingJobs(env, row, config); continue; }
      }
      if (dynamicRoutingOn(env) && config.version === 2) {
        const next = validateModelSettings(withRoutingConfig(config, { zdrThirdModel: env.DYNAMIC_ROUTING_ZDR_THIRD_MODEL }));
        await insertRow(env, Number(row.revision), next, "system", "add-dynamic-routing");
        continue;
      }
      if (await migrateSharedSources(env, row, config)) continue;
      const out = { revision: Number(row.revision), config, ...(retired.length ? { retired } : {}) };
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
// The saved facts of every model (name, kinds, accepted audio formats, price per audio second, ...), for callers that check one model.
export async function modelFacts(env) { return (await jobSettings(env)).catalog || {}; }
// The saved main model and fallbacks of one job, in order.
export async function jobModels(env, id) { return entriesOf(jobSetting(await jobSettings(env), id)).map((e) => e.model); }

// ---- the page's view ----
// Per kind of job, the models the picker offers: exactly the ones the save check accepts (kindOk) that also meet the job's
// zero-data-retention rule, so a normal pick is never refused.
function choicesOf(config) {
  const out = {}, kinds = new Map();
  for (const k of Object.values(JOB_KINDS)) { out[k.pick] = []; kinds.set(k.pick, k); }
  const known = Object.fromEntries(Object.entries(SEED_FACTS).map(([id, f]) => [id, { id, ...clone(f) }]));
  for (const [id, m] of Object.entries({ ...known, ...config.catalog })) {
    for (const [pick, kind] of kinds) {
      if (!kindOk(m, kind) || (zdrApplies(kind, m) && zdrBlocked(config, id))) continue;
      out[pick].push({ id, name: m.name || id, efforts: m.efforts || [], validated: m.eligible === true, chat: canChat(m), kinds: m.kinds || [], eligible: m.eligible === true, source: m.source || (id.startsWith("@cf/") ? "CF" : "OR"), levels: m.levels || PRIVACY_LEVELS.filter((level) => configuredHosts(config, id, level).length) });
    }
  }
  return out;
}
// Jobs the Models page doesn't show because nothing runs them in this environment. Their saved setting stays in the settings.
// embed_memory is used only by the ambient passage index (ambient-index.js), which LEGACY_AMBIENT_SEARCH can turn off.
export const hiddenJobs = (env) => ambientSearchOn(env) ? [] : ["embed_memory"];
export const modelSettingsOptions = (config, hidden = []) => ({ groups: GROUPS, jobs: MODEL_PAGE_JOBS.filter((j) => !hidden.includes(j.id)), kinds: JOB_KINDS, levels: PRIVACY_LEVELS, choices: choicesOf(config) });
export async function modelSettingsView(env) {
  const db = dbOf(env), s = await readModelSettings(env);
  const history = (await db.prepare(`SELECT revision,at,by,action FROM ${TABLE} WHERE environment=? ORDER BY revision DESC LIMIT 30`).bind(settingsEnvironment(env)).all()).results || [];
  const hidden = hiddenJobs(env);
  return { dynamicRouting: dynamicRoutingOn(env), environment: settingsEnvironment(env), revision: s.revision, config: s.config, stale: !!s.stale, hidden, options: modelSettingsOptions(s.config, hidden), history,
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
  if (![2, 3].includes(config.version) || (config.version === 3 && (!config.routing || !Array.isArray(config.routing.categories) || config.routing.categories.some((c) => !c || typeof c !== "object" || !c.chains)))) fail("Invalid routing settings.");
  const next = { version: config.version === 3 ? 3 : 2, jobs: clone(config.jobs), catalog: clone(current.catalog), ...(config.version === 3 ? { routing: clone(config.routing) } : {}) };
  if (dynamicRoutingOn(env) && next.version !== 3) fail("Reload Models before saving routing settings.");
  const need = new Map();
  for (const def of JOBS) {
    const job = next.jobs[def.id]; if (!job || typeof job !== "object") continue;
    for (const e of [job, ...(Array.isArray(job.fallbacks) ? job.fallbacks : [])]) if (e && typeof e.model === "string" && (!own(next.catalog, e.model) || !kindOk(next.catalog[e.model], JOB_KINDS[def.kind]) || (JOB_KINDS[def.kind].effort && !next.catalog[e.model]?.efforts?.includes(e.effort)))) need.set(e.model, def);
  }
  for (const c of next.routing?.categories || []) for (const chain of Object.values(c.chains || {})) {
    if (!Array.isArray(chain)) continue;
    for (const e of chain) if (e && typeof e.model === "string" && (!own(next.catalog, e.model) || !kindOk(next.catalog[e.model], JOB_KINDS.chat) || !next.catalog[e.model]?.efforts?.includes(e.effort))) need.set(e.model, { kind: "chat" });
  }
  for (const [id, def] of need) {
    const kind = JOB_KINDS[def.kind], pick = kind.pick;
    if (takesChat(kind) || dynamicRoutingOn(env)) {
      if (!validModelId(id)) fail("Invalid model ID.");
      // The search is the model's own ID, so its endpoints are read even when it isn't on OpenRouter's zero-data-retention list.
      const m = (await modelCatalog(env, { q: id })).models.find((x) => x.id === id); if (m?.unverified) fail(`${id}: its providers could not be verified right now, so nothing was saved. Try again shortly.`);
      if (!m?.eligible) fail(`${id}: ${m?.reasons?.join("; ") || "not available in the model catalogs"}.`);
      next.catalog[id] = own(SEED_FACTS, id) && SEED_FACTS[id].quirks ? { ...m, quirks: clone(SEED_FACTS[id].quirks) } : m;   // known quirks (e.g. no temperature) are kept when a known model is added again
    } else {
      if (!looseId(id)) fail("Invalid model ID.");
      if (id.startsWith("~")) fail(`${id}: latest-version IDs are only for chat and decision jobs. Pick a specific model for ${def.label}.`);
      // A speech model the first-run data describes keeps its name, kinds, accepted formats and price (model-seed.js SEED_FACTS).
      const known = own(SEED_FACTS, id) && SEED_FACTS[id].kinds?.includes(pick) ? { id, ...clone(SEED_FACTS[id]) } : null;
      next.catalog[id] = known || { id, name: id, kinds: [pick], efforts: [] };
    }
  }
  return validateModelSettings(pruneCatalog(next));
}
export async function saveModelSettings(env, { revision, config }, by, action = "save") {
  revisionOf(revision);
  // Stale writes fail before fetching a changing external catalog (the atomic write checks again).
  const current = await readModelSettings(env); if (current.revision !== revision) fail("Settings changed in another window. Reload before saving.", 409);
  return write(env, revision, await validatedSelection(env, config, current.config), by, String(action).slice(0, 120));
}
// For admin scripts: saves a complete settings object (jobs and model facts), checked by the same validator and written as a new version.
// The Models page never uses it, because the page may not supply model facts.
export async function saveFullModelSettings(env, { revision, config }, by, action = "admin") {
  revisionOf(revision);
  const current = await readModelSettings(env); if (current.revision !== revision) fail("Settings changed in another window. Reload before saving.", 409);
  return write(env, revision, validateModelSettings(pruneCatalog(withoutRetiredJobs(config))), by, String(action).slice(0, 120));
}
export async function restoreModelSettings(env, { revision, restore_revision }, by) {
  revisionOf(restore_revision);
  const row = restore_revision ? await readRow(env, restore_revision) : null;
  if (!row) fail("That settings version does not exist.", 404);
  const current = await readModelSettings(env).catch(() => ({ config: { catalog: {} } }));
  let restored = configOf(row);
  if (dynamicRoutingOn(env) && restored.version === 2) {
    const model = env.DYNAMIC_ROUTING_ZDR_THIRD_MODEL, meta = current.config.catalog?.[model];
    const savedEntry = (current.config.routing?.categories || []).flatMap((c) => Object.values(c.chains || {}).flat()).concat(Object.values(current.config.jobs || {}).flatMap(entriesOf)).find((e) => e.model === model && meta?.efforts?.includes(e.effort));
    restored = withRoutingConfig({ ...restored, catalog: { ...restored.catalog, ...(meta && !restored.catalog[model] ? { [model]: meta } : {}) } }, { zdrThirdModel: model, zdrThirdEntry: savedEntry });
  }
  return write(env, revision, await validatedSelection(env, restored, { catalog: { ...current.config.catalog, ...restored.catalog } }), by, `restore:${restore_revision}`);
}
export { mergeLevels, factsOf, privacyCoverage, jobDef };
