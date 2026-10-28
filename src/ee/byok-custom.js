// Custom Model Selection on an own AI key (Captain 2026-10-28: "why wouldn't we just do what we already do for the advanced->choose models? As in, surface the exact same options
// for users who BYOK -> Start with 'General' up to 3 fallbacks, effort levels, all of it").
//
// The editor and its rules are the ones in custom-models.js; this file adds what an own key needs:
//   - where the choices live: tenants.custom_models_own_on / custom_models_own (migration 080), kept apart from the setting for our models because the models are the ones the
//     person's own endpoint serves. The shape is the same: { version, categories: [{ id, title, chain: [{model, effort}], max_price }], catalog }, with one to three models per
//     category (an account starts with its one main model, and adds fallbacks);
//   - the models the picker offers: on OpenRouter the same catalog and the same privacy filter as a full plan (pickerModels, allowedAt); on any other endpoint the models that
//     endpoint serves (GET <base>/models with their key, byok.js byokModelsJson), with the facts the list carries (context length, reasoning levels, tool support, price) and
//     nothing invented. Max price shows only on OpenRouter, where max_price applies;
//   - routing: byokRouteTurn picks the turn's category (General alone asks nobody; more categories ask the request sorter, paid for like any 1Helm part on an own key), and
//     byokChatChain tries the category's models in order through byokChat, which stays the one way 1Helm talks to their endpoint. Chores keep the fast model.
// One source of truth for the main model: while this setting is on, General's first model is the model that answers, and the own AI key settings show the main model as set here.
// When it is off, or nothing is saved, the single main model of the own AI key settings answers, exactly as before.
import { byokChat, byokModelsJson, loadByok, answersOnOwnKey, ByokError } from "../byok.js";
import { isOpenRouterBase, normalizePrivacy, privacyOf } from "../privacy.js";
import { parse, BACKGROUND_TITLE, backgroundChain, CUSTOM_VERSION, MAX_CATEGORIES, CHAIN_LENGTH, allowedAt, nameOf, validateCategories, ownProblems, requiredMessage, CustomModelsRequired, modelCard, pickerModels, statusOf, customEnv } from "./custom-models.js";
import { modelSettingsEnv } from "./model-settings.js";
import { chooseTwo, prevToolsOf, openWorkOf } from "./route2.js";

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const clone = (x) => JSON.parse(JSON.stringify(x));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const CATEGORY_ID = /^(general|c_[a-z0-9]{6,16})$/;
export const OWN_CHAIN = [1, CHAIN_LENGTH];
export const kindOfBase = (base) => (isOpenRouterBase(base) ? "openrouter" : "plain");
// The most the request sorter may cost on an own key, in nano$ before markup: it is reserved first, and a turn that can't pay for it answers from General.
export const SORTER_NANO = 1_000_000;

// "openrouter" | "plain" when this account's chat is answered by its own key right now (byok plan, an active backup key episode), else null.
export async function ownKeyKind(env, t) {
  try {
    if (!(await answersOnOwnKey(env, t))) return null;
    const r = await env.DB.prepare("SELECT base_url FROM byok WHERE tenant_id=?").bind(String(t.id)).first();
    return kindOfBase(r?.base_url);
  } catch { return null; }
}

// The same answer for the boot payload and the account page, without a read for an ordinary full plan account that never used this setting.
export const ownKindForStatus = (env, t) => (t?.plan === "byok" || Number(t?.custom_models_own_on) === 1 || Number(t?.custom_models_on) === 1 ? ownKeyKind(env, t) : null);

// ---- the stored setting ----
export async function readOwn(env, tenantId) {
  const none = { on: false, config: null, level: normalizePrivacy(undefined) };
  if (!tenantId || !env?.DB) return none;
  try {
    const r = await env.DB.prepare("SELECT ai_privacy, custom_models_own_on, custom_models_own FROM tenants WHERE id=?").bind(String(tenantId)).first();
    return { on: Number(r?.custom_models_own_on) === 1, config: parse(r?.custom_models_own), level: normalizePrivacy(r?.ai_privacy) };
  } catch (e) {
    if (/no such column/i.test(String(e?.message || e))) return none;   // before migration 080: off
    throw e;
  }
}

// ---- the models an endpoint serves ----
const KNOWN_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "default"];
const perMillion = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null; };
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };
// One entry of an endpoint's model list as a record, or null (not a usable id, or it says it can't call tools). Only facts the entry states are used.
export function recordOfListed(m) {
  const id = typeof m === "string" ? m : [m?.id, m?.model, m?.name].find((x) => typeof x === "string" && x);
  if (!id || !MODEL_RE.test(id)) return null;
  if (m && typeof m === "object" && Array.isArray(m.supported_parameters) && !m.supported_parameters.includes("tools")) return null;
  const o = m && typeof m === "object" ? m : {};
  const listed = o.supported_reasoning_efforts ?? o.reasoning_efforts ?? o.capabilities?.reasoning_efforts;
  let efforts = Array.isArray(listed) ? [...new Set(listed.filter((x) => typeof x === "string" && KNOWN_EFFORTS.includes(x)))] : [];
  if (!efforts.length && Array.isArray(o.supported_parameters) && o.supported_parameters.includes("reasoning_effort")) efforts = ["low", "medium", "high"];
  const pricing = o.pricing && perMillion(o.pricing.prompt) != null && perMillion(o.pricing.completion) != null ? { prompt: perMillion(o.pricing.prompt), completion: perMillion(o.pricing.completion) } : null;
  return { id, name: typeof o.name === "string" && o.name && o.name !== id ? o.name.slice(0, 120) : id, source: "BYOK", eligible: true, kinds: ["chat"], efforts, default_effort: efforts.includes("medium") ? "medium" : efforts[0] || null,
    levels: [], pricing, context_length: positive(o.context_length ?? o.context_window ?? o.max_model_len ?? o.max_context_length) };
}
export function listedRecords(json) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const out = new Map();
  for (const m of arr.slice(0, 2000)) { const r = recordOfListed(m); if (r && !out.has(r.id)) out.set(r.id, r); }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// A short memory of each endpoint's list, so the picker's searches don't ask the person's server again for every key stroke. Keyed by account and address, never by the key.
const LISTS = new Map(); const LIST_TTL_MS = 60e3;
export const _resetLists = () => LISTS.clear();
export async function endpointRecords(cfg, tenantId, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const k = `${tenantId}|${cfg.base}`, hit = LISTS.get(k);
  if (hit && now - hit.at < LIST_TTL_MS) return hit.list;
  const list = listedRecords(await byokModelsJson(cfg, { fetchImpl }));
  if (LISTS.size > 200) LISTS.clear();
  LISTS.set(k, { at: now, list });
  return list;
}

// ---- the starting setting: General's one model is the own key's main model ----
// On OpenRouter its facts are read when they are known and allowed at the account's level; otherwise it is kept without facts (no reasoning level, nothing to check), so turning
// this on changes nothing. `seed: true` marks such a record.
async function seedRecord(id, kind, { level, lookup = null, list = null } = {}) {
  let rec = null;
  try {
    if (kind === "openrouter") { const r = lookup ? await lookup(id) : null; if (r && r.eligible === true && allowedAt(r, level)) rec = clone(r); }
    else rec = (list || []).find((x) => x.id === id) ? clone(list.find((x) => x.id === id)) : null;
  } catch {}
  return rec || { id, name: id.split("/").pop(), source: kind === "openrouter" ? "OR" : "BYOK", kinds: ["chat"], efforts: [], default_effort: null, levels: [], pricing: null, seed: true };
}
// Background jobs starts as the own key's fast model (else the main model) with no effort. fast is "" or the main model when no separate one is set.
export async function ownDefault(cfg, kind, { level, lookup = null, list = null } = {}) {
  const id = cfg.model, fast = cfg.fast || cfg.model, catalog = { [id]: await seedRecord(id, kind, { level, lookup, list }) };
  if (!catalog[fast]) catalog[fast] = await seedRecord(fast, kind, { level, lookup, list });
  return { version: CUSTOM_VERSION, categories: [{ id: "general", title: "General", chain: [{ model: id, effort: null }], max_price: null }], background: { chain: [{ model: fast, effort: null }] }, catalog };
}
// A saved setting from before Background jobs has none: it shows (and routes) the fast model, with its facts when they are known.
async function withBackground(config, cfg, kind, ctx) {
  if (!config || Array.isArray(config.background?.chain)) return config;
  const fast = cfg.fast || cfg.model, c = clone(config);
  if (!c.catalog[fast]) c.catalog[fast] = await seedRecord(fast, kind, ctx);
  c.background = { chain: [{ model: fast, effort: null }] };
  return c;
}

// ---- saving ----
// Background jobs is checked like a category (the same validators, as a category named General so every message and rule is the same), then its models join the catalog.
// The saved background is kept when only categories are saved, with its models' facts.
async function checkBackground(env, input, cur, validate) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => k !== "chain")) fail("Invalid Background jobs.");
  try { const r = await validate([{ id: "general", title: "General", chain: input.chain }]); return { chain: r.categories[0].chain, catalog: r.catalog }; }
  catch (e) { if (typeof e?.message === "string") e.message = e.message.replace(/^General\b/, BACKGROUND_TITLE); throw e; }
}
function joinBackground(config, bg, have) {
  const chain = bg?.chain || (Array.isArray(have?.background?.chain) ? have.background.chain : null);
  if (!chain) return config;
  const catalog = { ...config.catalog };
  for (const e of chain) if (!catalog[e.model]) { const r = bg?.catalog?.[e.model] || have?.catalog?.[e.model]; if (r) catalog[e.model] = r; }
  return { ...config, catalog, background: { chain: chain.map((e) => ({ model: e.model, effort: e.effort ?? null })) } };
}
async function validatePlain(input, { have = {}, list = null, listError = "" } = {}) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_CATEGORIES) fail(`Save between 1 and ${MAX_CATEGORIES} categories.`);
  const byId = new Map((list || []).map((r) => [r.id, r])), ids = new Set(), titles = new Set(), catalog = {}, categories = [];
  for (const c of input) {
    if (!c || typeof c !== "object" || Array.isArray(c)) fail("Invalid category.");
    if (typeof c.id !== "string" || !CATEGORY_ID.test(c.id) || ids.has(c.id)) fail("Invalid category ID.");
    ids.add(c.id);
    const title = typeof c.title === "string" ? c.title : "";
    if (!title.trim() || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title) || title !== title.trim()) fail("Enter a category name of 1 to 80 characters, with no spaces at the start or end.");
    if ((c.id === "general") !== (title === "General")) fail("General's name can't be changed.");
    if (titles.has(title.toLowerCase())) fail("Each category needs a different name.");
    titles.add(title.toLowerCase());
    if (!Array.isArray(c.chain) || c.chain.length < OWN_CHAIN[0] || c.chain.length > OWN_CHAIN[1]) fail(`${title}: choose a first model and up to two fallbacks.`);
    if (new Set(c.chain.map((e) => e?.model)).size !== c.chain.length) fail(`${title}: choose different models.`);
    if (c.max_price != null) fail(`${title}: max price is only available on OpenRouter.`);
    const chain = [];
    for (const [i, e] of c.chain.entries()) {
      const slot = ["first choice", "second choice", "third choice"][i];
      if (!e || typeof e !== "object" || typeof e.model !== "string" || !MODEL_RE.test(e.model) || Object.keys(e).some((k) => !["model", "effort"].includes(k))) fail(`${title}, ${slot}: choose a model.`);
      let rec = byId.get(e.model);
      if (!rec && have?.[e.model]?.seed === true && e.effort == null) rec = have[e.model];   // the main model the account started from stays until it is replaced
      if (!rec && !list && have?.[e.model]) rec = have[e.model];                         // the list couldn't be read: a model already saved stays
      if (!rec) fail(list ? `${e.model} isn't in your AI service's model list. Choose another model.` : `Couldn't read your AI service's model list${listError ? ` (${listError})` : ""}, so ${e.model} can't be checked. Try again.`, list ? 400 : 503);
      const levels = Array.isArray(rec.efforts) ? rec.efforts : [];
      if (!(e.effort == null && (!levels.length || rec.seed)) && !levels.includes(e.effort)) fail(`${nameOf(rec, e.model)} doesn't support the reasoning level "${String(e.effort)}".`);
      catalog[e.model] = rec; chain.push({ model: e.model, effort: e.effort ?? null });
    }
    categories.push({ id: c.id, title, chain, max_price: null });
  }
  if (input[0].id !== "general" || !ids.has("general")) fail("General must be the first category and can't be removed.");
  return { version: CUSTOM_VERSION, categories, catalog };
}
// ctx: { cfg (the own key's config, loadByok), kind, settings, lookup, fetchImpl, at }
export async function saveOwn(env, tenantId, body, ctx) {
  const { cfg, kind, settings = null, lookup = null, fetchImpl = globalThis.fetch, at = Date.now() } = ctx;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["on", "categories", "background"].includes(k)) || (!own(body, "on") && !own(body, "categories") && !own(body, "background"))) fail("Nothing to change.");
  if (own(body, "on") && typeof body.on !== "boolean") fail("Choose on or off.");
  if (!cfg || cfg.missing) fail("Save your own AI key first.", 409);
  const cur = await readOwn(env, tenantId);
  let config = cur.config, on = own(body, "on") ? body.on : cur.on, list = null, listErr = "";
  if (own(body, "categories") || own(body, "background")) {
    if (!cur.on && !own(body, "on")) fail("Turn on Custom Model Selection first.", 409);
    if (kind !== "openrouter") { try { list = await endpointRecords(cfg, tenantId, { fetchImpl }); } catch (e) { listErr = String(e?.detail || "").slice(0, 100); } }
    const have = cur.config?.catalog;
    const validate = (cats) => (kind === "openrouter" ? validateCategories(env, cats, cur.level, { have, settings, lookup, chain: OWN_CHAIN, ownKey: true }) : validatePlain(cats, { have, list, listError: listErr }));
    const bg = own(body, "background") ? await checkBackground(env, body.background, cur, validate) : null;
    if (own(body, "categories")) config = await validate(body.categories); else if (!config) fail("Turn on Custom Model Selection first.", 409);
    config = joinBackground(config, bg, cur.config);
  }
  if (on && !config) {
    if (kind !== "openrouter") { try { list = list || await endpointRecords(cfg, tenantId, { fetchImpl }); } catch {} }
    config = await ownDefault(cfg, kind, { level: cur.level, lookup, list });
  }
  try { await env.DB.prepare("UPDATE tenants SET custom_models_own_on=?, custom_models_own=?, updated_at=? WHERE id=?").bind(on ? 1 : 0, config ? JSON.stringify(config) : null, at, String(tenantId)).run(); }
  catch (e) { if (/no such column/i.test(String(e?.message))) fail("This isn't available yet. Try again shortly.", 503); throw e; }
  return ownView({ on, config, level: cur.level }, kind);
}
// The editor's state on an own key. endpoint: "openrouter" shows max price and filters by the privacy level; "plain" shows neither.
export function ownView(st, kind) {
  const s = statusOf(st, kind), cfg = st.config, or = kind === "openrouter";
  return { ...s, endpoint: kind, max_categories: MAX_CATEGORIES, categories: cfg ? cfg.categories.map((c) => ({ id: c.id, title: c.title, chain: c.chain.map((e) => ({ ...e })), max_price: c.max_price ? { ...c.max_price } : null })) : [],
    background: cfg?.background?.chain ? { title: BACKGROUND_TITLE, chain: cfg.background.chain.map((e) => ({ model: e.model, effort: e.effort ?? null })) } : null,
    models: cfg ? Object.fromEntries(Object.entries(cfg.catalog).map(([id, r]) => [id, { ...modelCard(r, st.level), allowed: or ? r.eligible !== true || allowedAt(r, st.level) : true }])) : {} };
}
// What the editor reads for the account: its own view on an own key (read from the row, with the main model of the own AI key as the starting point when nothing is saved), otherwise null.
export async function ownViewFor(env, t, kind, { cfg = null, lookup = null, fetchImpl = globalThis.fetch } = {}) {
  if (!kind) return null;
  const st = await readOwn(env, t.id);
  if (st.on) {
    cfg ||= await loadByok(env, t.id).catch(() => null);
    if (cfg && !cfg.missing) {
      const ctx = { level: st.level, lookup, list: kind === "plain" ? await endpointRecords(cfg, t.id, { fetchImpl }).catch(() => null) : null };
      st.config = st.config ? await withBackground(st.config, cfg, kind, ctx) : await ownDefault(cfg, kind, ctx);
    }
  }
  return ownView(st, kind);
}
// The picker on an own key.
export async function ownPicker(env, t, kind, q, { cfg, settings = null, search = null, fetchImpl = globalThis.fetch } = {}) {
  const st = await readOwn(env, t.id);
  if (kind === "openrouter") return { level: st.level, endpoint: kind, models: await pickerModels(env, st.level, { q, settings, have: st.config?.catalog, search }) };
  const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = await endpointRecords(cfg, t.id, { fetchImpl });
  return { level: st.level, endpoint: kind, models: list.filter((r) => words.every((w) => `${r.id} ${r.name}`.toLowerCase().includes(w))).slice(0, 80).map((r) => ({ ...modelCard(r, st.level), allowed: true })) };
}

// ---- routing ----
// The plan for one call on an own key: the category's models in order with their facts and the category's max price, or null (off: the main model answers, as before).
// An OpenRouter key whose saved models aren't allowed at the privacy level stops the call before anything is sent (CustomModelsRequired), as on a full plan.
export async function ownKeyPlan(env, tenantId, cfg, categoryId = "general") {
  if (!cfg || cfg.missing || !env?.DB) return null;
  const st = await readOwn(env, tenantId);
  if (!st.on) return null;
  const kind = kindOfBase(cfg.base), config = st.config || await ownDefault(cfg, kind, { level: st.level });
  if (kind === "openrouter") { const problems = ownProblems(config, st.level); if (problems.length) throw new CustomModelsRequired(requiredMessage(problems, st.level), { problems, level: st.level }); }
  const cat = config.categories.find((c) => c.id === categoryId) || config.categories.find((c) => c.id === "general") || config.categories[0];
  if (!cat?.chain?.length) return null;
  return { category: cat.id, title: cat.title, level: st.level, categories: config.categories.length, maxPrice: cat.max_price || null, chain: cat.chain.map((e) => ({ model: e.model, effort: e.effort ?? null, facts: config.catalog?.[e.model] || null })) };
}
// Tries the plan's models in order. A model that fails (an error from their endpoint, a refusal, no answer in time) hands the call to the next one; a bad key (401) or the person's
// Stop does not. Returns { response, pick: { model, effort, slot, failed } }, or throws the last error.
export async function byokChatChain(cfg, body, plan, { signal = null, fetchImpl = globalThis.fetch, privacy = null } = {}) {
  const failed = []; let last;
  for (const [slot, e] of plan.chain.entries()) {
    try {
      const response = await byokChat(cfg, body, { signal, fetchImpl, privacy, model: e.model, effort: e.effort, facts: e.facts, maxPrice: plan.maxPrice });
      return { response, pick: { model: e.model, effort: e.effort, slot, failed } };
    } catch (err) {
      if (signal?.aborted || err?.http === 401 || !(err instanceof ByokError)) throw err;
      last = err; failed.push({ model: e.model, error: String(err.detail || err.message).slice(0, 160) });
      console.log("byok chain: model failed", e.model, String(err.detail || "").slice(0, 100));
    }
  }
  throw last;
}
// At the start of a chat turn on an own key (resident.js, where routeTwoTurn runs for a full plan): which category answers. General alone asks nobody. With more categories the
// request sorter picks among their titles (route2.js chooseTwo with the account's own categories), reserved first like every part 1Helm runs on an own key. Any failure answers from
// General. The choice is kept for the task (a helper, a follow-up and a resumed turn use the same category) and the turn's plan is set on tc.
export async function byokRouteTurn(R, tc, { kind, text, hist, stats = null }) {
  const cfg = R.env.BYOK, tenant = R.get("tenant");
  const first = await ownKeyPlan(R.env, tenant, cfg, "general");   // off: null; privacy problems: stops here, before anything is paid for
  if (!first) { tc.byokPlan = null; return null; }
  let category = "general", d = null;
  const saved = R.get?.(`byokcat:${tc.session}`);
  if (kind === "chat" && first.categories > 1 && !tc.helper) {
    const hold = await R.byokHold("route", SORTER_NANO, tc);
    if (hold) {
      let jev = null;
      try {
        const st = await readOwn(R.env, tenant), config = st.config || await ownDefault(cfg, kindOfBase(cfg.base), { level: st.level });
        const base = R.env.__byokBase || R.env, env = customEnv(await modelSettingsEnv(base), config), level = await privacyOf(env, tenant);
        d = await chooseTwo(env, { kind, text, hist, prevTools: prevToolsOf(R, tc.session), openWork: openWorkOf(R, tc.session), openAgents: [], prevCategory: config.categories.some((c) => c.id === saved) ? saved : null, level },
          { meta: { tenant, channel: R.get("channel") } });
        jev = d.jev; if (config.categories.some((c) => c.id === d.route?.category)) category = d.route.category;
      } catch (e) { jev = { error: String(e?.message || e).slice(0, 160) }; console.log("byok sorter", jev.error); }
      await hold.done(Math.ceil((Number(jev?.cost) || 0) * 1e9));   // done() adds the same 15% as every part 1Helm runs on an own key
      if (stats) stats.route = { label: first.categories ? category : "", category, level: first.level, p: jev?.p ?? null, ms: jev?.ms ?? null, error: jev?.error || null, answers: jev?.answers || null };
    }
  } else if (typeof saved === "string" && saved) category = saved;
  tc.byokPlan = await ownKeyPlan(R.env, tenant, cfg, category);
  if (tc.byokPlan) { try { R.put(`byokcat:${tc.session}`, tc.byokPlan.category); } catch {} if (stats) stats.route = { ...(stats.route || {}), label: tc.byokPlan.title, category: tc.byokPlan.category, categoryTitle: tc.byokPlan.title, level: tc.byokPlan.level }; }
  return tc.byokPlan;
}
// The plan for a model call of this turn (the turn's, else the task's category, else General). Chores (the fast model) never use it.
export async function planForCall(R, tc) {
  if (tc && tc.byokPlan !== undefined) return tc.byokPlan;
  const saved = tc?.session ? R.get?.(`byokcat:${tc.session}`) : null;
  const plan = await ownKeyPlan(R.env, R.get("tenant"), R.env.BYOK, typeof saved === "string" && saved ? saved : "general");
  if (tc) tc.byokPlan = plan;
  return plan;
}
