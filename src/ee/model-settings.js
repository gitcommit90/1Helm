// The saved model settings: the single source of truth for every model the platform uses. Each job (model-jobs.js) has its own saved
// model, reasoning level and fallback list. Runtime code reads only these (modelSettingsEnv), and the Models page writes them.
// Reads are uncached and use D1's primary session: an already-running Durable Object sees saves on its next dispatch.
//
// Storage: append-only versions in model_job_settings_versions (new in migration 058). The earlier slot-based table
// (model_settings_versions) is only read, once, to carry an environment's existing choices into the first version.
import { PRIVACY_LEVELS } from "../privacy.js";
import { modelCatalog, validCatalogRecord, validModelId, unlistedIds, listedKinds, NO_LONGER_OFFERED } from "./model-catalog.js";
import { SORTS, CHAT_JOB, CATEGORY_FIELDS, JOBS, JOB_IDS, MODEL_PAGE_JOBS, JOB_KINDS, GROUPS, takesChat, canChat, nativeFor, zdrApplies, ModelSettingsError, jobDef, jobSetting, settingsOf, entriesOf, factsOf, zdrBlocked, privacyCoverage, configuredHosts } from "./model-jobs.js";
import { seedFromLegacy, mergeLevels, SEED_FACTS, ROUTING_ZDR_THIRD_MODEL, JOB_FIELDS, OPTIONAL_JOB_IDS, optionalJobDefault } from "./model-seed.js";
import { quirksFromRecord } from "../model-quirks.js";
import { dynamicRoutingOn, withRoutingConfig, withCategoryLimits } from "./routing-config.js";
import { limitsProblem, compactLimits, timeoutProblem } from "../limits.js";

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

// ---- provider lists ----
// Saved job entries used to carry "hosts" and "pin" (a provider list sent to OpenRouter). They are no longer saved or sent. The saved catalog's own
// "hosts" and "unproven_hosts" are facts about a model and stay. A version is stripped once, as a new append-only version (STRIP_ACTION).
export const STRIP_ACTION = "strip-provider-lists";
const entriesIn = (config) => {
  const out = [];
  for (const j of Object.values(config?.jobs || {})) if (j && typeof j === "object") { out.push(j); for (const f of Array.isArray(j.fallbacks) ? j.fallbacks : []) if (f && typeof f === "object") out.push(f); }
  for (const c of config?.routing?.categories || []) for (const chain of Object.values(c?.chains || {})) for (const e of Array.isArray(chain) ? chain : []) if (e && typeof e === "object") out.push(e);
  return out;
};
export const hasProviderLists = (config) => entriesIn(config).some((e) => own(e, "hosts") || own(e, "pin"));
export function withoutProviderLists(config) {
  if (!hasProviderLists(config)) return config;
  const next = clone(config);
  for (const e of entriesIn(next)) { delete e.hosts; delete e.pin; }
  return next;
}

// ---- validation ----
function keys(o, expected, path) {
  if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).length !== expected.length || expected.some((k) => !own(o, k))) fail(`Invalid ${path}: supply exactly ${expected.join(", ")}.`);
}
function validFacts(m, id) {
  if (m?.eligible === true) return validCatalogRecord(m, id);
  const allowed = ["id", "name", "kinds", "efforts", "quirks", "json", "in_nano", "formats", "sec_nano", "pricing", "embedding_equivalents"];
  return !!m && typeof m === "object" && m.id === id && Object.keys(m).every((k) => allowed.includes(k)) && typeof m.name === "string" && m.name.length <= 160
    && (m.kinds == null || (Array.isArray(m.kinds) && m.kinds.length <= 8 && m.kinds.every((k) => typeof k === "string" && k.length <= 40)))
    && Array.isArray(m.efforts) && m.efforts.length <= 12 && m.efforts.every((e) => EFFORTS.includes(e))
    && (m.quirks == null || (typeof m.quirks === "object" && Object.entries(m.quirks).every(([k, v]) => QUIRKS.includes(k) && v === true)))
    && (m.json == null || typeof m.json === "boolean") && (m.in_nano == null || (Number.isFinite(m.in_nano) && m.in_nano >= 0 && m.in_nano <= 100000))
    && (m.formats == null || (Array.isArray(m.formats) && m.formats.length >= 1 && m.formats.length <= 12 && m.formats.every((f) => typeof f === "string" && /^[a-z0-9]{2,8}$/.test(f))))
    && (m.pricing == null || (typeof m.pricing === "object" && !Array.isArray(m.pricing) && Object.keys(m.pricing).length === 2 && [m.pricing.prompt, m.pricing.completion].every((v) => Number.isFinite(v) && v >= 0 && v <= 10000)))
    && (m.sec_nano == null || (Number.isFinite(m.sec_nano) && m.sec_nano >= 0 && m.sec_nano <= 1000000))
    && (m.embedding_equivalents == null || (Array.isArray(m.embedding_equivalents) && m.embedding_equivalents.length <= 8 && new Set(m.embedding_equivalents).size === m.embedding_equivalents.length && m.embedding_equivalents.every((x) => looseId(x) && x !== id)));
}

// ---- the file search index job (embed_files) ----
// An index records the model that made its vectors, and a search must use vectors from the same model. So:
//  - the main model and every fallback must be a specific model: a latest-version alias ("~author/family-latest", or any ID ending in "-latest") can switch to a
//    different model without a save, which would put vectors of two models in one index;
//  - a fallback must be a model the main model lists in its catalog facts as embedding_equivalents (measured to give the same search results).
// Checked on every save (write below), never on a read, so a version saved earlier can always be read.
export const isAliasId = (id) => typeof id === "string" && (id.startsWith("~") || /-latest$/.test(id));
export function embeddingProblem(config) {
  const job = config?.jobs?.embed_files; if (!job || typeof job !== "object") return null;
  const label = jobDef("embed_files").label, entries = entriesOf(job);
  for (const e of entries) if (isAliasId(e.model)) return `${label}: ${e.model} is a latest-version alias, which can switch to a different model without anyone saving a change. Choose a specific model.`;
  const equivalents = config.catalog?.[job.model]?.embedding_equivalents || [];
  for (const f of job.fallbacks || []) if (!equivalents.includes(f.model)) return `${label}: ${f.model} can't be a fallback, because ${config.catalog?.[job.model]?.name || job.model} doesn't list it as equivalent. A fallback that makes different vectors would match the wrong passages in the index that already exists. Choose a model listed as equivalent, or leave the fallbacks empty.`;
  return null;
}
// Whether a model can run a kind of job: models for the kind's own call, plus (for any-model kinds) every model that can chat.
export const kindOk = (meta, kind) => meta?.eligible === true
  ? (Array.isArray(meta.kinds) && meta.kinds.length ? meta.kinds.includes(kind.pick) || (takesChat(kind) && canChat(meta)) || nativeFor(meta, kind) : takesChat(kind))
  : Array.isArray(meta?.kinds) && (meta.kinds.includes(kind.pick) || (kind.pick === "chat" && canChat(meta)) || (!!kind.any && (canChat(meta) || nativeFor(meta, kind))));
// The per job fields (model-seed.js JOB_FIELDS). Each may be missing (older saved settings), which reads as its starting value.
function validJobFields(job, path, kind) {
  if (kind.resultCount && !(own(job, "results") ? Number.isSafeInteger(job.results) && job.results >= 1 && job.results <= 10 : true)) fail(`${path}: the number of results must be a whole number from 1 to 10.`);
  if (!kind.resultCount && own(job, "results") && job.results !== null) fail(`${path}: only a web search job has a number of results.`);
  if (own(job, "max_output") && job.max_output !== null && !(Number.isSafeInteger(job.max_output) && job.max_output >= 1 && job.max_output <= 1000000)) fail(`${path}: max output must be a whole number from 1 to 1000000, or empty.`);
  if (own(job, "max_output") && job.max_output !== null && (kind.noOutput || kind.resultCount)) fail(`${path}: this job writes no text, so it has no max output.`);
  if (own(job, "timeout_ms") && timeoutProblem(job.timeout_ms)) fail(`${path}: ${timeoutProblem(job.timeout_ms)}`);
  if (own(job, "sort") && job.sort !== null && !SORTS.includes(job.sort)) fail(`${path}: sort must be price, throughput or latency, or empty.`);
  if (own(job, "max_price") && job.max_price !== null) {
    const p = job.max_price, price = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000;
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== 2 || !own(p, "prompt") || !own(p, "completion") || !price(p.prompt) || !price(p.completion)) fail(`${path}: max price needs a prompt and a completion price in dollars per million tokens (0 to 10000), or empty.`);
  }
}
function validEntry(e, path, config, def, isMain) {
  const allowed = isMain ? ["model", "effort", "strict", "fallbacks", ...JOB_FIELDS] : ["model", "effort", "strict"];
  if (e && typeof e === "object" && (own(e, "hosts") || own(e, "pin"))) fail(`${path}: provider lists (hosts, pin) are not saved. OpenRouter picks the provider. A sender older than this release (or an old saved copy) must drop them first.`);
  if (!e || typeof e !== "object" || Array.isArray(e) || Object.keys(e).some((k) => !allowed.includes(k)) || !own(e, "model") || !own(e, "effort")) fail(`Invalid ${path}.`);
  const kind = JOB_KINDS[def.kind], meta = config.catalog?.[e.model];
  if (!looseId(e.model) || !meta) fail(`${path}: choose a validated model.`);
  if (!kindOk(meta, kind)) fail(`${path}: ${meta.name || e.model} can't be used for ${def.label}.${kind.needs ? ` ${kind.needs}` : ""}`);
  if (kind.effort) { if (kind.effortNullOk && e.effort == null) { /* saved before the level existed */ } else if (!(meta.efforts || []).includes(e.effort)) fail(`${path}: ${meta.name || e.model} doesn't support reasoning level ${String(e.effort)}.`); }
  else if (e.effort != null) fail(`${path}: this job has no reasoning level.`);
  if (e.strict != null && e.strict !== true) fail(`${path}: invalid flag.`);
  if (kind.cloudflare && !(meta.source === "CF" || String(e.model).startsWith("@cf/"))) fail(`${path}: ${def.label} runs only on Cloudflare models.`);
  if (isMain) validJobFields(e, path, kind);
  if (zdrApplies(kind, meta) && zdrBlocked(config, e.model)) fail(`${path}: ${meta.name || e.model} has no zero-data-retention provider, so it can't run ${def.label}.`);
}
// A job a later release added (OPTIONAL_JOB_IDS) that the settings don't carry reads as its starting value, in memory only.
function withOptionalJobs(config) {
  if (!config?.jobs || typeof config.jobs !== "object" || Array.isArray(config.jobs)) return config;
  for (const id of OPTIONAL_JOB_IDS) {
    if (own(config.jobs, id)) continue;
    const d = optionalJobDefault(id, config.jobs);
    config.jobs[id] = d.job;
    if (d.facts && config.catalog && typeof config.catalog === "object" && !own(config.catalog, d.facts.id)) config.catalog[d.facts.id] = d.facts;
    // A model the saved catalog already describes may not list the starting reasoning level (the memory jobs start on the server's own level). The job then starts on the
    // nearest level the saved facts list, so adding a job never makes the stored settings invalid.
    const levels = config.catalog?.[d.job.model]?.efforts;
    if (d.job.effort != null && Array.isArray(levels) && levels.length && !levels.includes(d.job.effort)) d.job.effort = ["low", "default"].find((e) => levels.includes(e)) ?? levels[0];
  }
  return config;
}
// Saved before these existed: the picture job's reasoning level (null reads as "none", and a Cloudflare model's saved facts get the levels the first-run data lists)
// and Moondream's price. In memory only, like withOptionalJobs: the stored row is left as it was.
function withStartingFacts(config) {
  const cat = config?.catalog && typeof config.catalog === "object" ? config.catalog : null, jobs = config?.jobs;
  if (!cat || !jobs || typeof jobs !== "object") return config;
  const look = jobs.look?.model, seed = look && SEED_FACTS[look];
  if (seed?.pricing && cat[look] && typeof cat[look] === "object" && !cat[look].eligible && !own(cat[look], "pricing")) cat[look].pricing = clone(seed.pricing);
  // The web search job kept its number of results in max_output before it had its own field.
  const ws = jobs.web_search;
  if (ws && typeof ws === "object" && own(ws, "max_output") && ws.max_output !== null && !own(ws, "results")) { ws.results = ws.max_output; ws.max_output = null; }
  const v = jobs.vision_files;
  if (v && typeof v === "object" && v.effort == null) {
    const meta = cat[v.model];
    if (meta && typeof meta === "object" && !meta.eligible && Array.isArray(meta.efforts) && !meta.efforts.length && SEED_FACTS[v.model]?.efforts?.length) meta.efforts = clone(SEED_FACTS[v.model].efforts);
    if (meta && Array.isArray(meta.efforts) && meta.efforts.includes("none")) v.effort = "none";
  }
  return config;
}
export function validateModelSettings(config, { fill = false } = {}) {
  config = withStartingFacts(withOptionalJobs(clone(config)));
  if (fill && config?.jobs && typeof config.jobs === "object") for (const id of JOB_IDS) if (!own(config.jobs, id)) config.jobs[id] = null;
  const expected = config?.version === 3 ? ["version", "jobs", "catalog", "routing"] : ["version", "jobs", "catalog"];
  keys(config, config && typeof config === "object" && own(config, "limits") ? [...expected, "limits"] : expected, "settings");   // `limits` (limits.js) is optional: older saved settings have none
  if (own(config, "limits")) { const problem = limitsProblem(config.limits); if (problem) fail(problem); }
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
      keys(c, ["id", "title", "chains", ...CATEGORY_FIELDS.filter((k) => own(c, k))], "category");   // the limits are optional: a category saved before they existed has none
      validJobFields(c, c.title, JOB_KINDS.chat);
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
const OLD_CHAT_JOB = "chat.general";
export const hasRetiredJobs = (raw) => !!raw && typeof raw === "object" && !!raw.jobs && typeof raw.jobs === "object" && !Array.isArray(raw.jobs) && Object.keys(raw.jobs).some((id) => !JOB_IDS.includes(id));
export function withoutRetiredJobs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.jobs || typeof raw.jobs !== "object" || Array.isArray(raw.jobs)) return raw;
  const known = new Set(JOB_IDS), dropped = Object.keys(raw.jobs).filter((id) => !known.has(id));
  if (!dropped.length) return raw;
  // The chat job is gone: its max output, sort, max price and timeout now belong to each routing category. A version 3 category without them takes the
  // saved values of the chat job (or of "chat.general" in the oldest versions). A version 2 version has no categories, so it first becomes version 3
  // from the chat job's models, which also copies the limits to the General category.
  const chatJob = own(raw.jobs, CHAT_JOB) ? raw.jobs[CHAT_JOB] : raw.jobs[OLD_CHAT_JOB];
  // Earlier versions saved the chat limits and models as "chat.general" (with a job for each old kind of request next to it). Its saved values
  // are used as the chat job's, so no saved limit is lost. The other old chat jobs, the retry jobs and "escalate" are dropped.
  const jobs = Object.fromEntries(Object.entries(raw.jobs).filter(([id]) => known.has(id)));
  if (chatJob && typeof chatJob === "object") {
    if (raw.version === 3 && raw.routing?.categories?.length) return withCategoryLimits({ ...raw, jobs }, chatJob);
    if (raw.version === 2) { try { return withRoutingConfig(clone({ ...raw, jobs: { ...jobs, [CHAT_JOB]: chatJob } }), { zdrThirdModel: ROUTING_ZDR_THIRD_MODEL }); } catch { /* left as version 2: the check reports it */ } }
  }
  return { ...raw, jobs };
}
function configOf(row) {
  try { return validateModelSettings(withoutProviderLists(withoutRetiredJobs(JSON.parse(row.config)))); }
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
    for (let tries = 0; tries < 5; tries++) {
      let row = await readRow(env);
      if (!row) { await firstVersion(env); row = await readRow(env); if (!row) continue; }
      const stored = JSON.parse(row.config);
      if (hasProviderLists(stored) || hasRetiredJobs(stored)) {
        // One time, append only: a saved version that still has provider lists, or jobs that no longer exist, is replaced by a new version without them. The old row stays in History.
        // Only a version that is otherwise valid is written; any other fault is reported below, never repaired by guessing.
        // Everything else stays exactly as it was (a missing optional job is not filled in).
        const clean = withoutRetiredJobs(withoutProviderLists(stored)); let ok = false; try { validateModelSettings(clean); ok = true; } catch { /* reported by the normal path below */ }
        if (ok) { if (await insertRow(env, Number(row.revision), clean, "system", STRIP_ACTION)) console.log("model settings: provider lists and retired jobs removed", JSON.stringify({ environment: key, from_revision: Number(row.revision) })); continue; }
      }
      let config; const raw = withoutRetiredJobs(withoutProviderLists(stored)), retired = Object.keys(stored?.jobs || {}).filter((id) => !JOB_IDS.includes(id));
      try { config = validateModelSettings(raw); }
      catch {
        // Only jobs missing from an otherwise valid version are filled in; any other fault is reported, never repaired by guessing.
        try { config = validateModelSettings(raw, { fill: true }); } catch { throw new ModelSettingsError("Stored model settings are invalid. Restore an earlier version from Models. Nothing was sent."); }
        if (JOB_IDS.some((id) => !config.jobs[id])) { await addMissingJobs(env, row, config); continue; }
      }
      if (dynamicRoutingOn(env) && config.version === 2) {
        const next = validateModelSettings(withRoutingConfig(config, { zdrThirdModel: ROUTING_ZDR_THIRD_MODEL }));
        await insertRow(env, Number(row.revision), next, "system", "add-dynamic-routing");
        continue;
      }
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
  // Kinds that share a pick (the request sorter and the memory ranking both pick "decider") offer a model when any of them accepts it; the page then greys out what the job's own kind refuses.
  const out = {}, kinds = new Map();
  for (const k of Object.values(JOB_KINDS)) { out[k.pick] = []; kinds.set(k.pick, [...(kinds.get(k.pick) || []), k]); }
  const known = Object.fromEntries(Object.entries(SEED_FACTS).map(([id, f]) => [id, { id, ...clone(f) }]));
  // The models the file search index's main model lists as equivalent (saved facts, else the first-run facts): the only ones a fallback may be.
  const mainEmbed = config.jobs?.embed_files?.model, equivalents = new Set([...(config.catalog?.[mainEmbed]?.embedding_equivalents || []), ...(SEED_FACTS[mainEmbed]?.embedding_equivalents || [])]);
  for (const [id, m] of Object.entries({ ...known, ...config.catalog })) {
    for (const [pick, same] of kinds) {
      if (!same.some((kind) => kindOk(m, kind) && !(zdrApplies(kind, m) && zdrBlocked(config, id)))) continue;
      out[pick].push({ id, name: m.name || id, efforts: m.efforts || [], validated: m.eligible === true, chat: canChat(m), kinds: m.kinds || [], eligible: m.eligible === true, source: m.source || (id.startsWith("@cf/") ? "CF" : id.startsWith("@1hc/") ? "SELF" : "OR"), levels: m.levels || PRIVACY_LEVELS.filter((level) => configuredHosts(config, id, level).length), ...(same.some((kind) => kind.equivalentOnly) ? { main_equivalent: equivalents.has(id) } : {}) });
    }
  }
  return out;
}
export const modelSettingsOptions = (config) => ({ groups: GROUPS, jobs: MODEL_PAGE_JOBS, kinds: JOB_KINDS, levels: PRIVACY_LEVELS, choices: choicesOf(config) });
// Models in the saved settings or the first-run list that OpenRouter no longer lists. A failed lookup flags nothing.
// Kept apart from modelSettingsView so that opening the page never waits on OpenRouter.
export async function unlistedModels(env) {
  const s = await readModelSettings(env);
  return unlistedIds(Object.keys({ ...listedKinds(SEED_FACTS), ...listedKinds(s.config.catalog) })).catch(() => []);
}
export async function modelSettingsView(env) {
  const db = dbOf(env), s = await readModelSettings(env);
  const history = (await db.prepare(`SELECT revision,at,by,action FROM ${TABLE} WHERE environment=? ORDER BY revision DESC LIMIT 30`).bind(settingsEnvironment(env)).all()).results || [];
  return { dynamicRouting: dynamicRoutingOn(env), environment: settingsEnvironment(env), revision: s.revision, config: s.config, stale: !!s.stale, options: modelSettingsOptions(s.config), history,
    effective: "New tasks and background calls use these settings. Running tasks keep the model and reasoning level they started with. Privacy restrictions and explicit operator revocations still apply immediately." };
}

// ---- writing ----
function revisionOf(value) { if (!Number.isSafeInteger(value) || value < 0) fail("A valid settings revision is required."); return value; }
async function write(env, revision, config, by, action) {
  revisionOf(revision);
  const problem = embeddingProblem(config); if (problem) fail(problem);
  if (!dbOf(env)) throw new ModelSettingsError("Model settings storage is unavailable.");
  if (!(await insertRow(env, revision, config, by, action))) fail("Settings changed in another window. Reload before saving.", 409);
  return modelSettingsView(env);
}
// Never trust a browser's endpoint, price or capability snapshot: only the jobs come from the browser. A model the saved settings
// already know keeps its saved record; a new chat model is checked against OpenRouter's catalog; other new models are checked for shape.
async function validatedSelection(env, config, current) {
  if (!config || typeof config !== "object" || Array.isArray(config) || !config.jobs || typeof config.jobs !== "object") fail("Invalid settings.");
  // The models of a reply live in the routing categories (there is no chat job), so a save always carries them: a page loaded before this release sends version 2 and must reload.
  if (config.version !== 3) fail("Reload Models before saving routing settings.");
  if (!config.routing || !Array.isArray(config.routing.categories) || config.routing.categories.some((c) => !c || typeof c !== "object" || !c.chains)) fail("Invalid routing settings.");
  const next = { version: 3, jobs: clone(config.jobs), catalog: clone(current.catalog), routing: clone(config.routing) };
  // The limits (limits.js): what the page sent, kept sparse (only values that differ from the starting value); a save that sends none keeps the saved ones.
  if (own(config, "limits")) { const problem = limitsProblem(config.limits); if (problem) fail(problem); const sparse = compactLimits(config.limits); if (Object.keys(sparse).length) next.limits = sparse; }
  else if (current.limits && Object.keys(current.limits).length) next.limits = clone(current.limits);
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
    if (takesChat(kind) || kind.latest || dynamicRoutingOn(env)) {
      if (!validModelId(id)) fail("Invalid model ID.");
      // The search is the model's own ID, so its endpoints are read even when it isn't on OpenRouter's zero-data-retention list.
      const m = (await modelCatalog(env, { q: id })).models.find((x) => x.id === id); if (m?.unverified) fail(`${id}: its providers could not be verified right now, so nothing was saved. Try again shortly.`);
      if (!m && !id.startsWith("@cf/")) fail(`${id}: ${NO_LONGER_OFFERED}. Nothing was saved.`);
      if (!m?.eligible) fail(`${id}: ${m?.reasons?.join("; ") || "not available in the model catalogs"}.`);
      // Quirks: those of a known model (e.g. no temperature) are kept when it is added again, and the rest come from the record's own endpoint data (model-quirks.js quirksFromRecord).
      const derived = quirksFromRecord(m), quirks = { ...derived, ...(own(SEED_FACTS, id) && SEED_FACTS[id].quirks ? clone(SEED_FACTS[id].quirks) : {}) };
      next.catalog[id] = Object.keys(quirks).length ? { ...m, quirks } : m;
    } else {
      if (!looseId(id)) fail("Invalid model ID.");
      if (id.startsWith("~")) fail(`${id}: latest-version IDs are only for chat and decision jobs. Pick a specific model for ${def.label}.`);
      // A speech model the first-run data describes keeps its name, kinds, accepted formats and price (model-seed.js SEED_FACTS).
      const known = own(SEED_FACTS, id) && SEED_FACTS[id].kinds?.includes(pick) ? { id, ...clone(SEED_FACTS[id]) } : null;
      next.catalog[id] = known || { id, name: id, kinds: [pick], efforts: [] };
    }
  }
  // A model the settings already know skips the check above, so a model OpenRouter has since dropped is checked here when a job picks it newly.
  const before = (job) => new Set(entriesOf(job || {}).map((e) => e.model)), fresh = new Set();
  for (const def of JOBS) if (takesChat(JOB_KINDS[def.kind]) && next.jobs[def.id]) for (const e of entriesOf(next.jobs[def.id])) if (e?.model && !before(current.jobs?.[def.id]).has(e.model)) fresh.add(e.model);
  for (const c of next.routing?.categories || []) { const was = (current.routing?.categories || []).find((x) => x.id === c.id); for (const [level, chain] of Object.entries(c.chains || {})) for (const e of Array.isArray(chain) ? chain : []) if (e?.model && !(was?.chains?.[level] || []).some((x) => x?.model === e.model)) fresh.add(e.model); }
  const check = [...fresh].filter((id) => !need.has(id) && validModelId(id) && own(next.catalog, id) && listedKinds({ [id]: next.catalog[id] })[id]);
  if (check.length) { const gone = await unlistedIds(check).catch(() => []); if (gone.length) fail(`${gone[0]}: ${NO_LONGER_OFFERED}. Nothing was saved.`); }
  // The embedding models' equivalents are facts the first-run data holds (SEED_FACTS), so a record saved before they existed is completed here.
  for (const e of entriesOf(next.jobs.embed_files || { model: null, fallbacks: [] })) {
    const m = next.catalog[e.model], eq = SEED_FACTS[e.model]?.embedding_equivalents;
    if (m && typeof m === "object" && !m.eligible && eq && !own(m, "embedding_equivalents")) m.embedding_equivalents = clone(eq);
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
    const model = ROUTING_ZDR_THIRD_MODEL, meta = current.config.catalog?.[model];
    const savedEntry = (current.config.routing?.categories || []).flatMap((c) => Object.values(c.chains || {}).flat()).concat(Object.values(current.config.jobs || {}).flatMap(entriesOf)).find((e) => e.model === model && meta?.efforts?.includes(e.effort));
    restored = withRoutingConfig({ ...restored, catalog: { ...restored.catalog, ...(meta && !restored.catalog[model] ? { [model]: meta } : {}) } }, { zdrThirdModel: model, zdrThirdEntry: savedEntry });
  }
  return write(env, revision, await validatedSelection(env, restored, { catalog: { ...current.config.catalog, ...restored.catalog } }), by, `restore:${restore_revision}`);
}
export { mergeLevels, factsOf, privacyCoverage, jobDef };
