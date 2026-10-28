// Custom Model Selection (Captain 2026-10-27). A per-account setting, off by default, that makes that account's chat answer from its own
// categories instead of the ones set on the Models page. Scope is the chat categories and nothing else: background jobs, the request
// sorter's own model, memory, speech, search, files and the Models page are untouched.
//
// What is stored (tenants.custom_models, JSON; tenants.custom_models_on is the switch):
//   { version: 1, categories: [ { id, title, chain: [ {model, effort} x3 ], max_price: {prompt, completion} | null } ],
//     catalog: { <model id>: the model's saved facts, as the Models page saves them (model-catalog.js records) } }
// General is always first and always there. A category has ONE chain of three models (first choice and two fallbacks) for the account's current
// privacy level, not one per level. Each model keeps its own facts in `catalog`, so eligibility at a level never depends on the Models page.
//
// How it applies: customRouting() reads the account's row (one D1 read, the same row privacyOf reads) and, when the switch is on and every model
// is still allowed at the current privacy level, returns an env whose MODEL_SETTINGS has the account's categories in place of ours (withCustomSettings).
// Everything that routes chat (the request sorter's title list, the chains, per-model reasoning effort, the fallbacks, max price) already reads the
// categories from env.MODEL_SETTINGS, so nothing else changes. Max output, provider sort and timeout come from OUR General category. When any model
// stopped being allowed (the privacy level changed), customRouting() throws CustomModelsRequired and no chat call is made: nothing falls back to our models.
import { PRIVACY_LABEL, normalizePrivacy, DEFAULT_PRIVACY } from "../privacy.js";
import { configuredHosts, JOB_KINDS, CATEGORY_FIELDS } from "./model-jobs.js";
import { modelCatalog, validCatalogRecord, validModelId } from "./model-catalog.js";
import { kindOk } from "./model-settings.js";
import { quirksFromRecord } from "../model-quirks.js";
import { SEED_FACTS } from "./model-seed.js";
import { dynamicRoutingOn } from "./routing-config.js";

export const CUSTOM_VERSION = 1;
export const MAX_CATEGORIES = 12;
export const CHAIN_LENGTH = 3;
const SLOT_NAME = ["first choice", "second choice", "third choice"];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const clone = (x) => JSON.parse(JSON.stringify(x));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const CATEGORY_ID = /^(general|c_[a-z0-9]{6,16})$/;

// Thrown before any chat call while the account's custom models are not all allowed at its privacy level. It carries privacy = true so the callers
// that retry or fall back to another provider (resident.js) stop at once and send nothing; its message is app-written and safe to show.
export class CustomModelsRequired extends Error {
  constructor(message, detail = {}) { super(message); this.name = "CustomModelsRequired"; this.privacy = true; this.customModels = true; this.orStatus = 451; this.status = 409; this.code = "custom_models_required"; Object.assign(this, detail); }
}

// ---- eligibility (the same code dispatch uses: model-jobs.js configuredHosts over the model's saved facts) ----
export const allowedAt = (record, level) => !!record && typeof record.id === "string" && configuredHosts({ catalog: { [record.id]: record } }, record.id, normalizePrivacy(level)).length > 0;
const efforts = (record) => (Array.isArray(record?.efforts) ? record.efforts : []);
export const nameOf = (record, id) => String(record?.name || String(id).split("/").pop());

// Every chain slot that can't be used at `level`: [{ category, category_id, slot, model, name, why }]. A config that is missing or has no categories has one problem.
export function problemsOf(config, level) {
  level = normalizePrivacy(level);
  if (!config || !Array.isArray(config.categories) || !config.categories.length) return [{ category: "General", category_id: "general", slot: 0, model: null, name: "", why: "No models are saved yet" }];
  const out = [];
  for (const c of config.categories) {
    const chain = Array.isArray(c?.chain) ? c.chain : [];
    if (!chain.length) out.push({ category: c?.title || "Category", category_id: c?.id, slot: 0, model: null, name: "", why: "No models are chosen" });
    chain.forEach((e, slot) => {
      const rec = config.catalog?.[e?.model];
      const base = { category: c.title, category_id: c.id, slot, model: e?.model ?? null, name: nameOf(rec, e?.model) };
      if (!rec) out.push({ ...base, why: "Its details are missing" });
      else if (!allowedAt(rec, level)) out.push({ ...base, why: `No ${PRIVACY_LABEL[level]} provider` });
      else if (!efforts(rec).includes(e.effort)) out.push({ ...base, why: "Its reasoning level isn't available" });
    });
  }
  return out;
}
// An own OpenRouter key: only a model whose saved facts name its providers can be checked against the privacy level, so a model without facts (the main model an account
// started from) has no problem here, and OpenRouter itself refuses a send its data policy doesn't allow, as before. Any other endpoint has nothing to check.
export const BACKGROUND_TITLE = "Background jobs";
// The own key's chores (task titles, labels, hand-off notes, the browser planner): config.background = { chain: [{ model, effort }] } beside the categories, kept in the same
// JSON (no migration). Absent, the chain is the own key's fast model (else the main model) with no effort sent, so turning the setting on changes nothing.
export function backgroundChain(config, fallbackModel) {
  const saved = Array.isArray(config?.background?.chain) ? config.background.chain.filter((e) => e && typeof e.model === "string") : [];
  const chain = saved.length ? saved : fallbackModel ? [{ model: fallbackModel, effort: null }] : [];
  return chain.map((e) => ({ model: e.model, effort: e.effort ?? null, facts: config?.catalog?.[e.model] || null }));
}
// The chores' chain while Custom Model Selection is on (task titles, labels, hand-off notes, the browser planner): Background jobs' models in order with their facts, or null (off:
// the own key's fast model applies, as before). Read when the own key's config is loaded (byok.js loadByok) and used by byokChat for every call with fast: true.
export function ownChorePlan(row, cfg) {
  if (!row || Number(row.custom_models_own_on) !== 1) return null;
  const config = parse(row.custom_models_own); if (!config) return null;
  const chain = backgroundChain(config, cfg.fast || cfg.model);
  return chain.length ? chain : null;
}
export function ownProblems(config, level) {
  level = normalizePrivacy(level); const out = [];
  const groups = [...(config?.categories || []), ...(Array.isArray(config?.background?.chain) ? [{ id: "background", title: BACKGROUND_TITLE, chain: config.background.chain }] : [])];
  for (const c of groups) (Array.isArray(c?.chain) ? c.chain : []).forEach((e, slot) => {
    const rec = config.catalog?.[e?.model];
    if (rec?.eligible === true && !allowedAt(rec, level)) out.push({ category: c.title, category_id: c.id, slot, model: e.model, name: nameOf(rec, e.model), why: `No ${PRIVACY_LABEL[level]} provider` });
  });
  return out;
}
export function requiredMessage(problems, level) {
  const list = problems.slice(0, 6).map((p) => p.model ? `${p.name || p.model} (${p.category}, ${SLOT_NAME[p.slot] || "model"})` : `${p.category}: ${p.why}`).join(", ");
  return `Your AI data privacy setting is ${PRIVACY_LABEL[normalizePrivacy(level)]}, and these models in Custom Model Selection can't be used with it: ${list}. Nothing was sent. Open Settings, Advanced, Custom Model Selection and choose new models to continue.`;
}

// ---- reading the account's setting ----
export const parse = (text) => { try { const c = typeof text === "string" && text ? JSON.parse(text) : null; return c && typeof c === "object" && c.version === CUSTOM_VERSION && Array.isArray(c.categories) && c.catalog && typeof c.catalog === "object" ? c : null; } catch { return null; } };
// { on, config, level }. No tenant or no DB reads as off. An old database without the columns reads as off; any other failure is thrown, because an
// account that turned this on must never be answered from our models by accident.
export async function readCustom(env, tenantId) {
  if (!tenantId || !env?.DB) return { on: false, config: null, level: DEFAULT_PRIVACY };
  try {
    const r = await env.DB.prepare("SELECT ai_privacy, custom_models_on, custom_models FROM tenants WHERE id=?").bind(String(tenantId)).first();
    return { on: Number(r?.custom_models_on) === 1, config: parse(r?.custom_models), level: normalizePrivacy(r?.ai_privacy) };
  } catch (e) {
    if (/no such column/i.test(String(e?.message || e))) return { on: false, config: null, level: DEFAULT_PRIVACY };
    throw e;
  }
}
// What the app shows: the switch, the level, and whether new choices are needed. Compact; the editor reads the whole config separately.
// ownKey: the account's chat is answered by its own AI key (byok.js answersOnOwnKey), so our models and these choices aren't used and nothing is paused.
// On an own key (byok-custom.js) the account has its own setting, kept apart from the one for our models (tenants.custom_models_own_on / custom_models_own).
// ownKey is false, "openrouter" or "plain". Only an OpenRouter key has providers to filter by the privacy level (ownProblems); any other endpoint has none.
export function statusOf(st, ownKey = false) {
  if (ownKey) { const problems = st.on && ownKey === "openrouter" ? ownProblems(st.config, st.level) : []; return { on: st.on, level: st.level, own_key: true, endpoint: ownKey === "openrouter" ? "openrouter" : "plain", needs_choice: problems.length > 0, problems: problems.slice(0, 12) }; }
  const problems = st.on ? problemsOf(st.config, st.level) : [];
  return { on: st.on, level: st.level, needs_choice: st.on && problems.length > 0, problems: problems.slice(0, 12) };
}
export const statusOfRow = (t, ownKey = false) => statusOf(ownKey ? { on: Number(t?.custom_models_own_on) === 1, config: parse(t?.custom_models_own), level: normalizePrivacy(t?.ai_privacy) }
  : { on: Number(t?.custom_models_on) === 1, config: parse(t?.custom_models), level: normalizePrivacy(t?.ai_privacy) }, ownKey);
export async function customStatus(env, tenantId) { return statusOf(await readCustom(env, tenantId)); }

// ---- applying it to routing ----
// The categories of the account as routing categories. Max output, sort and timeout are our General category's saved values; max price is the account's.
export function categoriesFor(settings, config) {
  const general = (settings?.routing?.categories || []).find((c) => c.id === "general") || {};
  const limits = Object.fromEntries(CATEGORY_FIELDS.filter((k) => k !== "max_price").map((k) => [k, own(general, k) ? clone(general[k]) : null]));
  return config.categories.map((c) => {
    const chain = c.chain.map((e) => ({ model: e.model, effort: e.effort ?? null }));
    return { id: c.id, title: c.title, chains: { unrestricted: clone(chain), no_training: clone(chain), zdr: clone(chain) }, ...limits, max_price: c.max_price ? { prompt: c.max_price.prompt, completion: c.max_price.completion } : null };
  });
}
export function withCustomSettings(settings, config) {
  return { ...settings, catalog: { ...settings.catalog, ...clone(config.catalog) }, routing: { ...settings.routing, categories: categoriesFor(settings, config), custom: true } };
}
export const customEnv = (env, config) => Object.assign(Object.create(env), { MODEL_SETTINGS: withCustomSettings(env.MODEL_SETTINGS, config), MODEL_SETTINGS_CUSTOM: true });
// null when this account uses our categories. Otherwise { env, config, level } with the account's categories in env.MODEL_SETTINGS, or CustomModelsRequired.
// env must already carry MODEL_SETTINGS (modelSettingsEnv). An own AI key and a deployment without category routing never use it.
export async function customRouting(env, tenantId) {
  if (!env?.MODEL_SETTINGS || env.BYOK || env.MODEL_SETTINGS_CUSTOM || !dynamicRoutingOn(env) || !env.MODEL_SETTINGS.routing?.categories) return null;
  const st = await readCustom(env, tenantId);
  if (!st.on) return null;
  const problems = problemsOf(st.config, st.level);
  if (problems.length) throw new CustomModelsRequired(requiredMessage(problems, st.level), { problems, level: st.level });
  return { env: customEnv(env, st.config), config: st.config, level: st.level };
}

// ---- the starting config: our General at the account's level ----
export function defaultConfig(settings, level) {
  level = normalizePrivacy(level);
  const general = (settings?.routing?.categories || []).find((c) => c.id === "general");
  const chain = (general?.chains?.[level] || []).slice(0, CHAIN_LENGTH).map((e) => ({ model: e.model, effort: e.effort ?? null }));
  if (chain.length !== CHAIN_LENGTH) fail("The General models aren't set up yet, so there is nothing to start from.", 503);
  const catalog = {}; for (const e of chain) { const rec = settings.catalog?.[e.model]; if (rec) catalog[e.model] = clone(rec); }
  return { version: CUSTOM_VERSION, categories: [{ id: "general", title: "General", chain, max_price: general?.max_price ? clone(general.max_price) : null }], catalog };
}

// ---- saving ----
const recordOf = (value, id) => (value && typeof value === "object" ? { ...value, id } : null);
async function lookupLive(env, id, settings) {
  const m = (await modelCatalog(env, { q: id, settings })).models.find((x) => x.id === id);
  if (!m) return null;
  if (m.unverified) fail(`${id}: its providers could not be verified right now. Try again shortly.`, 503);
  const derived = quirksFromRecord(m), quirks = { ...derived, ...(own(SEED_FACTS, id) && SEED_FACTS[id].quirks ? clone(SEED_FACTS[id].quirks) : {}) };
  return Object.keys(quirks).length ? { ...m, quirks } : m;
}
// The facts of one model for this account: the ones it already saved, then our saved facts, then OpenRouter's live catalog.
async function factsFor(env, id, have, settings, lookup) {
  const known = [recordOf(have?.[id], id), recordOf(settings?.catalog?.[id], id)].find((r) => r && r.eligible === true && validCatalogRecord(r, id));
  return known || (await (lookup || ((x) => lookupLive(env, x, settings)))(id));
}
const titleOf = (t) => (typeof t === "string" ? t : "");
// Checks a whole set of categories exactly as a save does and returns the config to store. input: [{ id, title, chain: [{model, effort}], max_price }].
// have: the account's saved catalog (its models keep their facts). Throws an error with a plain message and status 400 for anything wrong.
// chain: how many models a category may have, [min, max]. A full plan has exactly three; an own key (byok-custom.js) has one to three.
export async function validateCategories(env, input, level, { have = {}, settings = null, lookup = null, chain: [chainMin, chainMax] = [CHAIN_LENGTH, CHAIN_LENGTH], ownKey = false } = {}) {
  level = normalizePrivacy(level);
  if (!Array.isArray(input) || !input.length || input.length > MAX_CATEGORIES) fail(`Save between 1 and ${MAX_CATEGORIES} categories.`);
  const ids = new Set(), titles = new Set(), catalog = {}, categories = [];
  for (const c of input) {
    if (!c || typeof c !== "object" || Array.isArray(c)) fail("Invalid category.");
    if (typeof c.id !== "string" || !CATEGORY_ID.test(c.id) || ids.has(c.id)) fail("Invalid category ID.");
    ids.add(c.id);
    const title = titleOf(c.title);
    if (!title.trim() || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title) || title !== title.trim()) fail("Enter a category name of 1 to 80 characters, with no spaces at the start or end.");
    if ((c.id === "general") !== (title === "General")) fail("General's name can't be changed.");
    if (titles.has(title.toLowerCase())) fail("Each category needs a different name.");
    titles.add(title.toLowerCase());
    if (!Array.isArray(c.chain) || c.chain.length < chainMin || c.chain.length > chainMax) fail(chainMin === chainMax ? `${title}: choose a first model and two fallbacks.` : `${title}: choose a first model and up to two fallbacks.`);
    if (new Set(c.chain.map((e) => e?.model)).size !== c.chain.length) fail(chainMin === chainMax ? `${title}: choose three different models.` : `${title}: choose different models.`);
    let max_price = null;
    if (c.max_price != null) {
      const p = c.max_price, ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000;
      if (typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== 2 || !ok(p.prompt) || !ok(p.completion)) fail(`${title}: max price needs both prices, from 0 to 10000 dollars per million tokens.`);
      max_price = { prompt: p.prompt, completion: p.completion };
    }
    const chain = [];
    for (const [i, e] of c.chain.entries()) {
      if (!e || typeof e !== "object" || typeof e.model !== "string" || !validModelId(e.model) || Object.keys(e).some((k) => !["model", "effort"].includes(k))) fail(`${title}, ${SLOT_NAME[i]}: choose a model.`);
      // An own key: the main model the account started from may have no facts, and no reasoning level (nothing is sent); it stays as it is until the person replaces it.
      if (ownKey && !own(catalog, e.model) && have?.[e.model]?.seed === true && e.effort == null) { catalog[e.model] = have[e.model]; chain.push({ model: e.model, effort: null }); continue; }
      if (!own(catalog, e.model)) {
        const rec = await factsFor(env, e.model, have, settings, lookup);
        if (!rec) fail(`${e.model} is no longer offered. Choose another model.`);
        if (rec.eligible !== true || !validCatalogRecord(rec, e.model)) fail(`${nameOf(rec, e.model)} can't be used: ${(rec.reasons || []).join("; ") || "it isn't available"}.`);
        if (!kindOk(rec, JOB_KINDS.chat)) fail(`${nameOf(rec, e.model)} can't answer chats.`);
        catalog[e.model] = rec;
      }
      const rec = catalog[e.model];
      if (!allowedAt(rec, level)) fail(`${nameOf(rec, e.model)} has no ${PRIVACY_LABEL[level]} provider, so it can't be used with your AI data privacy setting.`);
      if (!(ownKey && e.effort == null) && !efforts(rec).includes(e.effort)) fail(`${nameOf(rec, e.model)} doesn't support the reasoning level "${String(e.effort)}".`);
      chain.push({ model: e.model, effort: e.effort });
    }
    categories.push({ id: c.id, title, chain, max_price });
  }
  if (input[0].id !== "general" || !ids.has("general")) fail("General must be the first category and can't be removed.");
  return { version: CUSTOM_VERSION, categories, catalog };
}

// The one write path (the account route): { on?, categories? }. Turning it on the first time starts from our General at the account's level.
// Returns the same view the app reads. settings: our saved model settings (the General the account starts from, and known model facts).
export async function saveCustom(env, tenantId, body, { settings, lookup = null, at = Date.now(), ownKey = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["on", "categories"].includes(k)) || (!own(body, "on") && !own(body, "categories"))) fail("Nothing to change.");
  if (own(body, "on") && typeof body.on !== "boolean") fail("Choose on or off.");
  const cur = await readCustom(env, tenantId);
  let config = cur.config, on = own(body, "on") ? body.on : cur.on;
  if (own(body, "categories")) {
    if (!cur.on && !own(body, "on")) fail("Turn on Custom Model Selection first.", 409);
    config = await validateCategories(env, body.categories, cur.level, { have: cur.config?.catalog, settings, lookup });
  }
  if (on && !config) config = defaultConfig(settings, cur.level);
  await env.DB.prepare("UPDATE tenants SET custom_models_on=?, custom_models=?, updated_at=? WHERE id=?").bind(on ? 1 : 0, config ? JSON.stringify(config) : null, at, String(tenantId)).run();
  return customView({ on, config, level: cur.level }, ownKey);
}
// The editor's state: the switch, the level, the problems and the saved categories with the facts the editor shows for each model.
export function customView(st, ownKey = false) {
  const s = statusOf(st, ownKey), cfg = st.config;
  return { ...s, max_categories: MAX_CATEGORIES, categories: cfg ? cfg.categories.map((c) => ({ id: c.id, title: c.title, chain: c.chain.map((e) => ({ ...e })), max_price: c.max_price ? { ...c.max_price } : null })) : [],
    models: cfg ? Object.fromEntries(Object.entries(cfg.catalog).map(([id, r]) => [id, modelCard(r, st.level)])) : {} };
}

// ---- the model picker ----
// What the picker shows for a model (never the provider lists): its name, reasoning levels and price, and whether it is allowed at the account's level.
export const modelCard = (r, level) => ({ id: r.id, name: nameOf(r, r.id), source: r.source || "OR", efforts: efforts(r), default_effort: r.default_effort || efforts(r)[0] || null,
  levels: Array.isArray(r.levels) ? r.levels : [], pricing: r.pricing || null, context_length: r.context_length || null, allowed: allowedAt(r, level) });
// Chat models the account may pick at its level: our saved models plus, for a search, OpenRouter's live catalog. Only models with at least one
// provider allowed at the level are listed. No provider or host list is built here: allowedAt is the dispatcher's own check.
export async function pickerModels(env, level, { q = "", settings = null, have = {}, search = null } = {}) {
  level = normalizePrivacy(level); q = String(q || "").trim().toLowerCase();
  const pool = new Map();
  const add = (r) => { if (r && r.eligible === true && !r.unverified && r.id && validCatalogRecord(r, r.id) && kindOk(r, JOB_KINDS.chat) && allowedAt(r, level)) pool.set(r.id, r); };
  for (const r of Object.values(settings?.catalog || {})) add(r);
  for (const r of Object.values(have || {})) add(r);
  if (q.length >= 2) { const found = await (search || ((x) => modelCatalog(env, { q: x, settings, known: [] }).then((r) => r.models)))(q); for (const r of found) if (!pool.has(r.id)) add(r); }
  const words = q.split(/\s+/).filter(Boolean);
  return [...pool.values()].filter((r) => words.every((w) => `${r.id} ${r.name || ""}`.toLowerCase().includes(w))).slice(0, 80).map((r) => modelCard(r, level));
}
