// Custom Model Selection on an own AI key: the same options as the advanced model choice (start with "General", up to 3 fallbacks, effort levels). An account connects any number of AI services
// (byok-connections.js) and this is the ONLY place where own-key models are chosen.
//   - where the choices live: tenants.custom_models_own / custom_models_own_on (migration 080). An own key has no off state: the setting is always used. The shape is the same as for our models:
//     { version, categories: [{ id, title, chain: [{model, effort}], max_price }], background: { chain }, catalog }, one to three models per category, but every model is named
//     <connection id>:<model id>, and its record in the catalog says which connection and kind it came from (conn, connKind).
//   - the picker lists the models of every connected service together, each labelled with its service. OpenRouter's models come from the same catalog and the same privacy filter as a full
//     plan (pickerModels, allowedAt); any other service's models are what its list says (GET /models with that connection's key, or ChatGPT's and OpenCode's own list), with the facts the list
//     carries (context length, reasoning levels) and nothing invented. Max price applies to OpenRouter models only.
//   - nothing is chosen for an account that just connected a service: no model is picked on its behalf. Chat then says a model must be chosen here (chooseModelText), and the editor shows it.
//   - routing: byokRouteTurn sends every chat message to the request sorter when there is more than one category (General alone asks nobody; paid for like any 1Helm part on an own key).
//     The main turn always runs on General's models. A message sorted into another category follows the same orchestration as a managed plan: Primary must hand the job to a background
//     worker, which runs on that category's models. byokChatChain tries a plan's models in order through byokChat, which sends each to the connection it is named after.
import { byokChat, streamFallback, byokModelsJson, answersOnOwnKey, ByokError, chooseModelText } from "../byok.js";
import { normalizePrivacy, privacyOf } from "../privacy.js";
import { liveConfig, parse, BACKGROUND_TITLE, CUSTOM_VERSION, MAX_CATEGORIES, CHAIN_LENGTH, allowedAt, nameOf, validateCategories, ownProblems, requiredMessage, CustomModelsRequired, modelCard, pickerModels, statusOf, customEnv } from "./custom-models.js";
import { modelSettingsEnv } from "./model-settings.js";
import { dynamicRoutingOn } from "./routing-config.js";
import { chooseTwo, prevToolsOf, openWorkOf, openAgentsOf, browserBackSteer } from "./route2.js";
import { listRows, viewRows, connCfgs, splitModel, nsModel, ONEHELM_MODEL, ONEHELM_NAME, isOneHelm, oneHelmRecord } from "./byok-connections.js";

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const clone = (x) => JSON.parse(JSON.stringify(x));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const NS_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,219}$/;
const CATEGORY_ID = /^(general|c_[a-z0-9]{6,16})$/;
export const OWN_CHAIN = [1, CHAIN_LENGTH];
// The most the request sorter may cost on an own key, in nano$ before markup: it is reserved first, and a turn that can't pay for it answers from General.
export const SORTER_NANO = 1_000_000;

// "own" when this account's chat is answered by its own key right now (byok plan, an active backup key episode), else null.
export async function ownKeyKind(env, t) {
  try { return (await answersOnOwnKey(env, t)) ? "own" : null; } catch { return null; }
}

// The same answer for the boot payload and the account page, without a read for an ordinary full plan account that never used this setting.
export const ownKindForStatus = (env, t) => (t?.plan === "byok" || Number(t?.custom_models_own_on) === 1 || Number(t?.custom_models_on) === 1 ? ownKeyKind(env, t) : null);

// ---- the stored setting ----
export async function readOwn(env, tenantId) {
  const none = { on: true, config: null, level: normalizePrivacy(undefined) };
  if (!tenantId || !env?.DB) return none;
  try {
    const r = await env.DB.prepare("SELECT ai_privacy, custom_models_own FROM tenants WHERE id=?").bind(String(tenantId)).first();
    return { on: true, config: await liveConfig(env, parse(r?.custom_models_own)), level: normalizePrivacy(r?.ai_privacy) };
  } catch (e) {
    if (/no such column/i.test(String(e?.message || e))) return none;   // before migration 080
    throw e;
  }
}

// ---- the models a service serves ----
const KNOWN_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "default"];
const perMillion = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null; };
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };
// One entry of a service's model list as a record, or null (not a usable id, or it says it can't call tools). Only facts the entry states are used.
export function recordOfListed(m) {
  const id = typeof m === "string" ? m : [m?.id, m?.model, m?.name].find((x) => typeof x === "string" && x);
  if (!id || !MODEL_RE.test(id)) return null;
  if (m && typeof m === "object" && Array.isArray(m.supported_parameters) && !m.supported_parameters.includes("tools")) return null;
  if (m && typeof m === "object" && m.tools === false) return null;   // OpenCode's list says so
  const o = m && typeof m === "object" ? m : {};
  const listed = o.supported_reasoning_efforts ?? o.reasoning_efforts ?? o.capabilities?.reasoning_efforts;
  let efforts = Array.isArray(listed) ? [...new Set(listed.filter((x) => typeof x === "string" && KNOWN_EFFORTS.includes(x)))] : [];
  if (!efforts.length && Array.isArray(o.supported_parameters) && o.supported_parameters.includes("reasoning_effort")) efforts = ["low", "medium", "high"];
  const pricing = o.pricing && perMillion(o.pricing.prompt) != null && perMillion(o.pricing.completion) != null ? { prompt: perMillion(o.pricing.prompt), completion: perMillion(o.pricing.completion) } : null;
  return { id, name: typeof o.name === "string" && o.name && o.name !== id ? o.name.slice(0, 120) : id, source: "BYOK", eligible: true, kinds: ["chat"], efforts, default_effort: efforts.includes("medium") ? "medium" : efforts[0] || null,
    levels: [], pricing, context_length: positive(o.context_length ?? o.context_window ?? o.max_model_len ?? o.max_context_length), ...(typeof o.family === "string" && o.family ? { family: o.family.slice(0, 60) } : {}), ...(typeof o.note === "string" && o.note ? { note: o.note.slice(0, 80) } : {}) };
}
export function listedRecords(json) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const out = new Map();
  for (const m of arr.slice(0, 2000)) { const r = recordOfListed(m); if (r && !out.has(r.id)) out.set(r.id, r); }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// Each service's list is kept in three places, never keyed by a key or token. 1) This isolate's memory (LISTS). 2) A shared copy in D1 (byok_model_lists, migration 089) that every
// isolate reads. A copy younger than LIST_FRESH_MS is served as is; an older one is served at once and read again in the background (waitUntil), so opening the picker never waits for
// a service and never asks ChatGPT for a token while a copy exists. 3) The service itself, only when no copy exists or the caller asks for a fresh list (a save checking a model).
const LISTS = new Map(); const LIST_FRESH_MS = 10 * 60e3, LIST_KEEP_MS = 7 * 24 * 3600e3, LIST_MAX_JSON = 1_500_000, INFLIGHT = new Map();
const sigOf = (cfg) => `${cfg.provider || ""}|${cfg.base}`;
const LISTS_DDL = "CREATE TABLE IF NOT EXISTS byok_model_lists (tenant_id TEXT NOT NULL, conn_id TEXT NOT NULL, sig TEXT NOT NULL DEFAULT '', list_json TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, conn_id))";
let listsDdlFor = null;
// Tests only: _forgetMemory simulates another isolate (only this isolate's memory is empty); _resetLists forgets every copy, in memory and in the database last used.
export const _forgetMemory = () => LISTS.clear();
export const _resetLists = () => { LISTS.clear(); INFLIGHT.clear(); try { listsDdlFor?.prepare("DELETE FROM byok_model_lists").run().catch(() => {}); } catch {} };
async function sharedRead(env, tenantId, cfg) {
  if (!env?.DB || !cfg.id) return null;
  try {
    if (listsDdlFor !== env.DB) { await env.DB.prepare(LISTS_DDL).run(); listsDdlFor = env.DB; }
    const r = await env.DB.prepare("SELECT sig, list_json, fetched_at FROM byok_model_lists WHERE tenant_id=? AND conn_id=?").bind(String(tenantId), cfg.id).first();
    if (!r || r.sig !== sigOf(cfg)) return null;
    const list = JSON.parse(r.list_json); return Array.isArray(list) ? { at: Number(r.fetched_at) || 0, list } : null;
  } catch { return null; }
}
async function sharedWrite(env, tenantId, cfg, list, at) {
  if (!env?.DB || !cfg.id) return;
  try {
    const json = JSON.stringify(list); if (json.length > LIST_MAX_JSON) return;
    await env.DB.prepare("INSERT OR REPLACE INTO byok_model_lists (tenant_id, conn_id, sig, list_json, fetched_at) VALUES (?,?,?,?,?)").bind(String(tenantId), cfg.id, sigOf(cfg), json, at).run();
  } catch { /* the copy is an optimisation: a failed write only means the next open reads the service */ }
}
export async function forgetLists(env, tenantId, connId = null) {
  for (const k of [...LISTS.keys()]) if (k.startsWith(`${tenantId}|${connId ?? ""}`)) LISTS.delete(k);
  if (!env?.DB) return;
  try { await (connId ? env.DB.prepare("DELETE FROM byok_model_lists WHERE tenant_id=? AND conn_id=?").bind(String(tenantId), connId) : env.DB.prepare("DELETE FROM byok_model_lists WHERE tenant_id=?").bind(String(tenantId))).run(); } catch {}
}
// One read of the service itself (one at a time per account and connection), stored in memory and in D1.
function readService(cfg, tenantId, k, { fetchImpl, env, now }) {
  let p = INFLIGHT.get(k); if (p) return p;
  p = (async () => {
    const list = listedRecords(await byokModelsJson(cfg, { fetchImpl }));
    if (LISTS.size > 200) LISTS.clear();
    LISTS.set(k, { at: now, list }); await sharedWrite(env, tenantId, cfg, list, now);
    return list;
  })().finally(() => INFLIGHT.delete(k));
  INFLIGHT.set(k, p); return p;
}
// opts: fetchImpl, now, env (for the shared copy), waitUntil (keeps the background read alive after the answer), fresh (ignore every copy: a save checking a model).
export async function endpointRecords(cfg, tenantId, { fetchImpl = globalThis.fetch, now = Date.now(), env = null, waitUntil = null, fresh = false } = {}) {
  const k = `${tenantId}|${cfg.id || ""}|${cfg.provider || ""}|${cfg.base}`;
  if (fresh) return readService(cfg, tenantId, k, { fetchImpl, env, now });
  let hit = LISTS.get(k);
  if (!hit || now - hit.at >= LIST_FRESH_MS) { const shared = await sharedRead(env, tenantId, cfg); if (shared && (!hit || shared.at > hit.at)) { hit = shared; LISTS.set(k, hit); } }
  if (!hit || now - hit.at > LIST_KEEP_MS) return readService(cfg, tenantId, k, { fetchImpl, env, now });
  if (now - hit.at >= LIST_FRESH_MS) {   // stale: answer now, read again in the background
    const again = readService(cfg, tenantId, k, { fetchImpl, env, now }).catch(() => {});
    if (waitUntil) waitUntil(again);
  }
  return hit.list;
}
// Reads every non-OpenRouter connection's list into the copies (when there is none or it is stale). The caller doesn't wait for it: the AI services page and a new connection call it.
export async function warmLists(env, tenantId, { fetchImpl = globalThis.fetch, waitUntil = null, settings = null, search = null } = {}) {
  const st = await readOwn(env, tenantId), conns = await connCfgs(env, tenantId), jobs = [];
  for (const conn of Object.values(conns)) {
    if (!conn || conn.missing) continue;
    if (conn.kind === "openrouter") jobs.push(pickerModels(env, st.level, { q: "", settings, have: orHave(st.config), search }).catch(() => {}));
    else jobs.push(endpointRecords(conn, tenantId, { fetchImpl, env, waitUntil }).catch(() => {}));
  }
  const all = Promise.all(jobs); if (waitUntil) waitUntil(all); return all;
}
// A record in the setting: named after its connection, and remembering where it came from.
const tagged = (conn, rec, id = rec.id) => ({ ...rec, id: nsModel(conn.id, id), conn: conn.id, connKind: conn.kind });
const orHave = (config) => Object.fromEntries(Object.entries(config?.catalog || {}).filter(([, r]) => r.connKind === "openrouter").map(([id, r]) => [id.slice(id.indexOf(":") + 1), { ...r, id: id.slice(id.indexOf(":") + 1) }]));

// ---- saving ----
// ctx: { env, conns: { id: connection config }, level, have (the saved catalog), settings, lookup, fetchImpl, tenantId }. One chain entry → its record (named after its connection), or an error in plain words.
async function checkEntry(e, title, slot, ctx) {
  // 1Helm's models (byok-connections.js ONEHELM_MODEL): no service, no reasoning level; 1Helm's own routing picks the models.
  if (isOneHelm(e.model)) { if (ctx.byokPlan) fail(`${ONEHELM_NAME} aren't available on the Bring your own key plan. Choose one of your own services' models.`); if (e.effort != null && e.effort !== "default") fail(`${ONEHELM_NAME} have no reasoning level.`); return oneHelmRecord(); }
  const s = splitModel(e.model), conn = s && ctx.conns[s.conn];
  if (!conn || conn.missing) fail(`${title}, ${slot}: that AI service isn't connected. Choose another model.`);
  if (conn.kind === "openrouter") {
    const have = ctx.have?.[e.model] ? { [s.model]: { ...ctx.have[e.model], id: s.model } } : {};
    const r = await validateCategories(ctx.env, [{ id: "general", title: "General", chain: [{ model: s.model, effort: e.effort }] }], ctx.level, { have, settings: ctx.settings, lookup: ctx.lookup, chain: [1, 1], ownKey: true });
    return tagged(conn, r.catalog[s.model], s.model);
  }
  let list = ctx.lists.get(conn.id);
  if (list === undefined) { try { list = await endpointRecords(conn, ctx.tenantId, { fetchImpl: ctx.fetchImpl, env: ctx.env }); ctx.lists.set(conn.id, list); } catch (err) { ctx.lists.set(conn.id, null); ctx.errs.set(conn.id, String(err?.detail || "").slice(0, 100)); list = null; } }
  let found = (list || []).find((r) => r.id === s.model); const kept = ctx.have?.[e.model];
  if (!found && list && !ctx.fresh?.has(conn.id)) {   // a model missing from a copy may be new: ask the service once before refusing
    (ctx.fresh ||= new Set()).add(conn.id);
    try { list = await endpointRecords(conn, ctx.tenantId, { fetchImpl: ctx.fetchImpl, env: ctx.env, fresh: true }); ctx.lists.set(conn.id, list); found = list.find((r) => r.id === s.model); } catch { /* keep the copy's answer */ }
  }
  let rec = found ? tagged(conn, found) : null;
  if (!rec && kept?.seed === true && e.effort == null) rec = kept;   // the model the account started from stays until it is replaced
  if (!rec && !list && kept) rec = kept;                              // the list couldn't be read: a model already saved stays
  if (!rec) fail(list ? `${s.model} isn't in the model list of ${conn.label}. Choose another model.` : `Couldn't read the model list of ${conn.label}${ctx.errs.get(conn.id) ? ` (${ctx.errs.get(conn.id)})` : ""}, so ${s.model} can't be checked. Try again.`, list ? 400 : 503);
  const levels = Array.isArray(rec.efforts) ? rec.efforts : [];
  // An empty level is fine when the model has no levels, was carried over (seed), or is already saved with an empty level (a slot the person didn't touch: every pick sends all slots together).
  if (!(e.effort == null && (!levels.length || rec.seed || kept)) && !levels.includes(e.effort)) fail(`${nameOf(rec, s.model)} doesn't support the reasoning level "${String(e.effort)}".`);
  return rec;
}
// Categories (or Background jobs, as one called General) from the form, checked: the same rules as for our models, for models of any connected service.
async function validateOwn(input, ctx, { empty = false } = {}) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_CATEGORIES) fail(`Save between 1 and ${MAX_CATEGORIES} categories.`);
  const ids = new Set(), titles = new Set(), catalog = {}, categories = [], hasOr = Object.values(ctx.conns).some((c) => c.kind === "openrouter");
  for (const c of input) {
    if (!c || typeof c !== "object" || Array.isArray(c)) fail("Invalid category.");
    if (typeof c.id !== "string" || !CATEGORY_ID.test(c.id) || ids.has(c.id)) fail("Invalid category ID.");
    ids.add(c.id);
    const title = typeof c.title === "string" ? c.title : "";
    if (!title.trim() || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title) || title !== title.trim()) fail("Enter a category name of 1 to 80 characters, with no spaces at the start or end.");
    if ((c.id === "general") !== (title === "General")) fail("General's name can't be changed.");
    if (titles.has(title.toLowerCase())) fail("Each category needs a different name.");
    titles.add(title.toLowerCase());
    if (!Array.isArray(c.chain) || c.chain.length < (empty ? 0 : OWN_CHAIN[0]) || c.chain.length > OWN_CHAIN[1]) fail(`${title}: choose a first model and up to two fallbacks.`);
    if (new Set(c.chain.map((e) => e?.model)).size !== c.chain.length) fail(`${title}: choose different models.`);
    let max_price = null;
    if (c.max_price != null) {
      const p = c.max_price, ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000;
      if (!hasOr) fail(`${title}: max price is only available on OpenRouter.`);
      if (typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== 2 || !ok(p.prompt) || !ok(p.completion)) fail(`${title}: max price needs both prices, from 0 to 10000 dollars per million tokens.`);
      max_price = { prompt: p.prompt, completion: p.completion };
    }
    const chain = [];
    for (const [i, e] of c.chain.entries()) {
      const slot = ["first choice", "second choice", "third choice"][i];
      if (!e || typeof e !== "object" || typeof e.model !== "string" || !NS_RE.test(e.model) || Object.keys(e).some((k) => !["model", "effort"].includes(k))) fail(`${title}, ${slot}: choose a model.`);
      const rec = await checkEntry(e, title, slot, ctx);
      catalog[e.model] = rec; chain.push({ model: e.model, effort: e.effort ?? null });
    }
    categories.push({ id: c.id, title, chain, max_price });
  }
  if (input[0].id !== "general" || !ids.has("general")) fail("General must be the first category and can't be removed.");
  return { version: CUSTOM_VERSION, categories, catalog };
}
async function checkBackground(input, ctx) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => k !== "chain")) fail("Invalid Background jobs.");
  try { const r = await validateOwn([{ id: "general", title: "General", chain: input.chain }], ctx, { empty: true }); return { chain: r.categories[0].chain, catalog: r.catalog }; }
  catch (e) { if (typeof e?.message === "string") e.message = e.message.replace(/^General\b/, BACKGROUND_TITLE); throw e; }
}
function joinBackground(config, bg, have) {
  const chain = bg?.chain || (Array.isArray(have?.background?.chain) ? have.background.chain : null);
  if (!chain) return config;
  const catalog = { ...config.catalog };
  for (const e of chain) if (!catalog[e.model]) { const r = bg?.catalog?.[e.model] || have?.catalog?.[e.model]; if (r) catalog[e.model] = r; }
  return { ...config, catalog, background: { chain: chain.map((e) => ({ model: e.model, effort: e.effort ?? null })) } };
}
// ctx: { settings, lookup, fetchImpl, at }. Body: { categories?, background? } ("on" is accepted and ignored: an own key has no off state).
export async function saveOwn(env, tenantId, body, ctx = {}) {
  const { settings = null, lookup = null, fetchImpl = globalThis.fetch, at = Date.now() } = ctx;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["on", "categories", "background"].includes(k)) || (!own(body, "on") && !own(body, "categories") && !own(body, "background"))) fail("Nothing to change.");
  if (own(body, "on") && typeof body.on !== "boolean") fail("Choose on or off.");
  const cur = await readOwn(env, tenantId);
  let config = cur.config;
  if (own(body, "categories") || own(body, "background")) {
    const conns = await connCfgs(env, tenantId);
    if (!Object.keys(conns).length) fail("Connect an AI service first, in Settings, AI services.", 409);
    const v = { env, conns, byokPlan: await onByokPlan(env, tenantId), level: cur.level, have: cur.config?.catalog, settings, lookup, fetchImpl, tenantId, lists: new Map(), errs: new Map() };
    const bg = own(body, "background") ? await checkBackground(body.background, v) : null;
    if (own(body, "categories")) config = await validateOwn(body.categories, v); else if (!config) fail("Choose a model for General first.", 409);
    config = joinBackground(config, bg, cur.config);
    try { await env.DB.prepare("UPDATE tenants SET custom_models_own_on=1, custom_models_own=?, updated_at=? WHERE id=?").bind(JSON.stringify(config), at, String(tenantId)).run(); }
    catch (e) { if (/no such column/i.test(String(e?.message))) fail("This isn't available yet. Try again shortly.", 503); throw e; }
  }
  return ownViewFor(env, { id: tenantId }, "own", { st: { on: true, config, level: cur.level } });
}
// The editor's state on an own key: General always has its place (empty until a model is chosen), the connected services (their names label the models), and where max price applies.
export const onByokPlan = async (env, tenantId) => { try { return (await env.DB.prepare("SELECT plan FROM tenants WHERE id=?").bind(String(tenantId)).first())?.plan === "byok"; } catch { return false; } };
export function ownView(st, conns = [], { byokPlan = false } = {}) {
  const s = statusOf(st, "own"), label = Object.fromEntries(conns.map((c) => [c.id, c.label]));
  // On the Bring your own key plan 1Helm's models don't exist: the editor neither offers them nor lists a saved entry (it stays stored, and comes back on a full plan).
  const cfg = !st.config || !byokPlan ? st.config : { ...st.config, categories: st.config.categories.map((c) => ({ ...c, chain: c.chain.filter((e) => !isOneHelm(e.model)) })), background: st.config.background ? { chain: st.config.background.chain.filter((e) => !isOneHelm(e.model)) } : st.config.background, catalog: Object.fromEntries(Object.entries(st.config.catalog).filter(([id]) => !isOneHelm(id))) };
  const cats = cfg?.categories?.length ? cfg.categories : [{ id: "general", title: "General", chain: [], max_price: null }];
  return { ...s, max_categories: MAX_CATEGORIES, categories: cats.map((c) => ({ id: c.id, title: c.title, chain: c.chain.map((e) => ({ ...e })), max_price: c.max_price ? { ...c.max_price } : null })),
    background: { title: BACKGROUND_TITLE, chain: (cfg?.background?.chain || []).map((e) => ({ model: e.model, effort: e.effort ?? null })) },
    onehelm: byokPlan ? null : { id: ONEHELM_MODEL, name: ONEHELM_NAME, service: "1Helm" },
    connections: conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, host: c.kind === "plain" ? String(c.host || "") : "" })), has_openrouter: conns.some((c) => c.kind === "openrouter"),
    models: cfg ? Object.fromEntries(Object.entries(cfg.catalog).map(([id, r]) => [id, { ...modelCard(r, st.level), service: isOneHelm(id) ? "1Helm" : label[r.conn] || "", conn: r.conn || "", allowed: r.connKind === "openrouter" ? r.eligible !== true || allowedAt(r, st.level) : true }])) : {} };
}
// What the editor reads for the account (own key only; otherwise null).
export async function ownViewFor(env, t, kind, { st = null, fetchImpl = globalThis.fetch } = {}) {
  if (!kind) return null;
  const given = !!st; st ||= await readOwn(env, t.id);
  const rows = await listRows(env, t.id);
  if (!given) st = await fillSeeds(env, t.id, st, fetchImpl);
  return ownView(st, await viewRows(env, t.id, rows), { byokPlan: t.plan !== undefined ? t.plan === "byok" : await onByokPlan(env, t.id) });
}
// Models carried over by the upgrade of the old single key are saved as seed records (name = id, no reasoning levels) because the upgrade never asks the service. Once the service's own list
// can be read, the view shows the list's record (name, levels, context) in place of each seed, so the editor shows the slider. Loading never writes: the setting itself keeps the seed
// until a save, where checkEntry stores the list's record. A service whose list can't be read leaves its seeds as they are. OpenRouter's models are filled by the picker and by saving.
async function fillSeeds(env, tenantId, st, fetchImpl) {
  const catalog = st.config?.catalog, seeds = Object.entries(catalog || {}).filter(([, r]) => r?.seed === true && r.connKind !== "openrouter");
  if (!seeds.length) return st;
  let conns; try { conns = await connCfgs(env, tenantId); } catch { return st; }
  const lists = new Map(), next = { ...catalog }; let changed = false;
  for (const [id, r] of seeds) {
    const s = splitModel(id), conn = s && conns[s.conn]; if (!conn || conn.missing || conn.kind === "openrouter") continue;
    if (!lists.has(conn.id)) { try { lists.set(conn.id, await endpointRecords(conn, tenantId, { fetchImpl, env })); } catch { lists.set(conn.id, null); } }
    const found = (lists.get(conn.id) || []).find((x) => x.id === s.model); if (!found) continue;
    const have = Array.isArray(r.efforts) ? r.efforts : [];   // a level the old setting used stays selectable if the list doesn't name it
    next[id] = tagged(conn, found); if (have.length && !next[id].efforts.length) next[id].efforts = have; changed = true;
  }
  if (!changed) return st;
  const config = { ...st.config, catalog: next };
  return { ...st, config };
}
// The picker on an own key: every connected service's models together, each with its service's name. A service that can't be read is named in `errors` and the others still list.
// The services are read at the same time. opts.conn limits the answer to one connection (the picker asks for each service on its own, so a slow one never holds back the others).
export async function ownPicker(env, t, kind, q, { settings = null, search = null, fetchImpl = globalThis.fetch, waitUntil = null, conn: only = null } = {}) {
  const st = await readOwn(env, t.id), allRows = await listRows(env, t.id), conns = await connCfgs(env, t.id);
  const rows = only ? allRows.filter((r) => r.id === only) : allRows;
  const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean), cap = only ? 200 : Math.max(12, Math.floor(80 / Math.max(1, rows.length)));
  const parts = await Promise.all(rows.map(async (r) => {
    const conn = conns[r.id]; if (!conn || conn.missing) return { err: { id: r.id, label: r.label }, models: [] };
    try {
      let cards;
      if (conn.kind === "openrouter") cards = (await pickerModels(env, st.level, { q, settings, have: orHave(st.config), search })).map((c) => ({ ...c, id: nsModel(conn.id, c.id) }));
      else cards = (await endpointRecords(conn, t.id, { fetchImpl, env, waitUntil })).filter((x) => words.every((w) => `${x.id} ${x.name} ${x.family || ""} ${conn.label}`.toLowerCase().includes(w))).map((x) => ({ ...modelCard(x, st.level), id: nsModel(conn.id, x.id), ...(x.family ? { family: x.family } : {}), ...(x.note ? { note: x.note } : {}), allowed: true }));
      return { models: cards.slice(0, cap).map((c) => ({ ...c, service: r.label, conn: conn.id, kind: conn.kind })) };
    } catch (e) { console.log("byok picker: list", conn.id, String(e?.detail || e?.message || e).slice(0, 80)); return { err: { id: r.id, label: r.label, error: String(e?.detail || "").slice(0, 120) }, models: [] }; }
  }));
  return { level: st.level, endpoint: "own", models: parts.flatMap((p) => p.models).slice(0, only ? 200 : 80), errors: parts.filter((p) => p.err).map((p) => p.err) };
}

// ---- routing ----
// The plan for one call on an own key: the category's models in order with their facts and the category's max price, or null (off: the main model answers, as before).
// An OpenRouter key whose saved models aren't allowed at the privacy level stops the call before anything is sent (CustomModelsRequired), as on a full plan.
export async function ownKeyPlan(env, tenantId, cfg, categoryId = "general") {
  if (!cfg || cfg.missing || !env?.DB) return null;
  const st = await readOwn(env, tenantId), config = st.config;
  if (!config?.categories?.length) throw new ByokError(chooseModelText(cfg));
  const problems = ownProblems(config, st.level); if (problems.length) throw new CustomModelsRequired(requiredMessage(problems, st.level, "Settings, AI services, Models"), { problems, level: st.level });
  const general = config.categories.find((c) => c.id === "general") || config.categories[0];
  const picked = config.categories.find((c) => c.id === categoryId), cat = picked?.chain?.length ? picked : general;   // a category with nothing left in it answers from General
  if (!cat?.chain?.length) throw new ByokError(chooseModelText(cfg));
  return { category: cat.id, title: cat.title, level: st.level, categories: config.categories.length, maxPrice: cat.max_price || null, chain: cat.chain.map((e) => ({ model: e.model, effort: e.effort ?? null, facts: config.catalog?.[e.model] || null })) };
}
// Tries the plan's models in order. A model that fails (an error from their endpoint, a refusal, no answer in time) hands the call to the next one; a bad key (401) or the person's
// Stop does not. Returns { response, pick: { model, effort, slot, failed } }, or throws the last error.
export async function byokChatChain(cfg, body, plan, { signal = null, fetchImpl = globalThis.fetch, privacy = null, session = null, ctx = null, job = null, limits = null } = {}) {
  const failed = []; let last;
  const run = (e) => () => byokChat(cfg, body, { signal, fetchImpl, privacy, session, model: e.model, effort: e.effort, facts: e.facts, maxPrice: plan.maxPrice, ctx, job, limits });
  for (const [slot, e] of plan.chain.entries()) {
    try {
      let response = await run(e)();
      // A reply that fails after it started (the stream is read by the caller, outside this loop) is retried on the next model too: streamFallback (byok.js).
      const rest = plan.chain.slice(slot + 1).map((x, k) => ({ model: x.model, effort: x.effort, slot: k + 1, run: run(x) }));
      if (body.stream && rest.length && response.body) response = streamFallback(response, rest, { signal, slot0: slot, failed, model0: e.model, log: "byok chain" });
      return { response, pick: { model: e.model, effort: e.effort, slot, failed } };
    } catch (err) {
      if (signal?.aborted || err?.http === 401 || !(err instanceof ByokError)) throw err;
      last = err; failed.push({ model: e.model, error: String(err.detail || err.message).slice(0, 160) });
      console.log("byok chain: model failed", e.model, String(err.detail || "").slice(0, 100));
    }
  }
  throw last;
}
// The frozen profile of one own-key dispatch: the same shape the managed task profile gives the orchestration (task-profile.js routingProfile), minus anything about a model request,
// because every call of an own-key turn goes to their endpoint through the category's plan (ownKeyPlan, byokChatChain). mode "byok" keeps it from being run on a managed plan.
export const ownKeyProfile = (plan, cacheSession) => ({ version: 1, mode: "byok", credentialRef: "own-key", requestedModel: plan.chain[0].model, effort: plan.chain[0].effort ?? null, category: plan.category, categoryTitle: plan.title, level: plan.level, cacheSession });
// The turn's profile when its category is not General or a message is for an open worker: General's own profile with the dispatch the orchestration reads (resident.js, orchestrator.js),
// exactly as ensureTaskRuntime builds it for a managed plan. The worker's profile carries the category's own plan and its own cache session.
export function ownKeyDispatch(R, tc, general, worker, { steer = null } = {}) {
  const key = (...more) => JSON.stringify([R.get("tenant"), R.get("channel"), tc.session, ...more]);
  return { ...ownKeyProfile(general, key()), dynamicRouting: true, dispatch: { category: worker.category, requiredDelegation: worker.category !== general.category, steer: steer || null, workerProfile: ownKeyProfile(worker, key("worker")) } };
}
// At the start of a chat turn on an own key (resident.js, where routeTwoTurn runs for a full plan). The turn itself always runs on General's models, so the main model never changes
// mid-chat and its cache stays. With more than one category, the request sorter (route2.js chooseTwo with the account's own categories, reserved first like every part 1Helm runs on
// an own key) picks the category and whether the message is for an open worker. A category other than General, or a message for a worker, gives the turn the same dispatch a managed
// plan has (tc.byokProfile): Primary must hand the job to a background worker that runs on the category's models. Any failure answers from General.
// A worker's turn runs on its own category's plan. skipSort: a worker's returned result or an answer to its question is not a new request.
export async function byokRouteTurn(R, tc, { kind, text, hist, stats = null, skipSort = false }) {
  const cfg = R.env.BYOK, tenant = R.get("tenant");
  // No model chosen yet is not thrown from here: the call itself (planForCall) says so as the person's reply, like any own-key failure.
  const planOf = async (category) => { try { return await ownKeyPlan(R.env, tenant, cfg, category); } catch (e) { if (e?.byok) return undefined; throw e; } };
  if (tc.helper?.dynamic_routing) { tc.byokPlan = await planOf(tc.helper.category || "general"); return tc.byokPlan; }
  const general = await planOf("general");   // privacy problems: stops here, before anything is paid for
  tc.byokPlan = general; tc.byokProfile = null;
  if (!general) return null;
  let worker = general, steer = null;
  if (kind === "chat" && general.categories > 1 && !skipSort && dynamicRoutingOn(R.env)) {   // the worker orchestration is what other categories run on, so without it General answers
    const hold = await R.byokHold("route", SORTER_NANO, tc);
    if (hold) {
      let jev = null, d = null;
      try {
        const st = await readOwn(R.env, tenant), config = st.config;
        const base = R.env.__byokBase || R.env, env = customEnv(await modelSettingsEnv(base), config), level = await privacyOf(env, tenant);
        d = await chooseTwo(env, { kind, text, hist, prevTools: prevToolsOf(R, tc.session), openWork: openWorkOf(R, tc.session), openAgents: openAgentsOf(R, tc.session), prevCategory: null, level },
          { meta: { tenant, channel: R.get("channel") } });
        browserBackSteer(R, tc.session, d, text);
        jev = d.jev; steer = d.route?.steer || null;
        if (config.categories.some((c) => c.id === d.route?.category)) worker = (await ownKeyPlan(R.env, tenant, cfg, d.route.category)) || general;
      } catch (e) { jev = { error: String(e?.message || e).slice(0, 160) }; steer = null; worker = general; console.log("byok sorter", jev.error); }
      await hold.done(Math.ceil((Number(jev?.cost) || 0) * 1e9));   // done() adds the same 15% as every part 1Helm runs on an own key
      if (stats) stats.route = { label: worker.title, category: worker.category, categoryTitle: worker.title, level: general.level, p: jev?.p ?? null, ms: jev?.ms ?? null, error: jev?.error || null, answers: jev?.answers || null, steer };
    }
  }
  if (worker.category !== general.category || steer) tc.byokProfile = ownKeyDispatch(R, tc, general, worker, { steer });
  if (stats && !stats.route) stats.route = { label: general.title, category: general.category, categoryTitle: general.title, level: general.level };
  return general;
}
// The plan for a model call of this turn: a routed worker's own category, otherwise General (the main turn never changes model). Chores (the fast model) never use it.
export async function planForCall(R, tc) {
  if (tc && tc.byokPlan !== undefined) return tc.byokPlan;
  const plan = await ownKeyPlan(R.env, R.get("tenant"), R.env.BYOK, tc?.helper?.dynamic_routing && tc.helper.category || "general");
  if (tc) tc.byokPlan = plan;
  return plan;
}
