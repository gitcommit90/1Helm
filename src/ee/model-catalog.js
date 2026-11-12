// Public OpenRouter metadata only. Never fetch a browser-supplied URL or forward an API key.
// Replacement endpoints remain ZDR even on permissive accounts. Price never hides or blocks a model; it is only shown.
// Privacy never drops a model from search either: each result says which levels it can serve (levels, terms), and the picker filters by level.
import { quirkOf } from "../model-quirks.js";
import { registered, eligibleHosts, hostOk, hostTerms, PRIVACY_LEVELS, ENDPOINTS } from "../privacy.js";
import { cloudflareCatalog, isCloudflareModel } from "../cloudflare-models.js";
const OR = "https://openrouter.ai/api/v1";
const EFFORTS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
// OpenRouter's latest model resolution: `~author/family-latest` always runs the newest model of that family (sent to OpenRouter as written).
export const isLatestAlias = (id) => typeof id === "string" && /^~[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*-latest$/.test(id);
export const validModelId = (id) => typeof id === "string" && id.length <= 160 && (isCloudflareModel(id) || isLatestAlias(id) || /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id));
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const price = (p) => p != null && p !== "" && Number.isFinite(Number(p)) && Number(p) >= 0 ? Number(p) * 1e6 : null;
const host = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9/_-]{0,99}$/.test(s);
export class ModelCapabilitiesUnavailable extends Error {
  constructor(model, { reasons = [], endpointStatuses = [] } = {}) {
    super(`Published capabilities for ${model} are unavailable or incompatible. No task request was sent; try again shortly.`);
    this.status = 503; this.code = "model_capabilities_unavailable"; this.model = model;
    this.reasons = reasons.slice(0, 8).map(reason => String(reason).slice(0, 240));
    this.endpointStatuses = [...new Set(endpointStatuses.filter(Number.isFinite))].slice(0, 16);
  }
}
export const catalogUnavailable = error => ["model_catalog_unavailable", "model_capabilities_unavailable"].includes(error?.code);
// Published endpoint flags can overstate support. Meta rejected `none` in the
// live 2026-10-12 final-report check, matching the existing pool restriction.
// Apply to saved snapshots too; this does not change model, limits or history.
// settings: the saved model settings, which say which models accept only automatic tool choice.
export function effectiveTaskCatalog(catalog, model = catalog?.id, settings = null) {
  return catalog && quirkOf(settings, model, "auto_tool_choice_only") ? { ...catalog, tool_choice: ["auto"] } : catalog;
}
// Registered models whose endpoints all keep or train on requests (so they never appear on OpenRouter's zero-data-retention list).
export const retainedModels = () => Object.keys(ENDPOINTS.chat).filter((m) => eligibleHosts(m, "zdr").length === 0);
async function get(path) {
  try {
    // OpenRouter's CDN may serve a list up to an hour old while it refreshes in the background (cache-control stale-while-revalidate),
    // so a model released minutes ago can be missing. A per-minute query value gives a list at most a minute old.
    // The ZDR endpoint list isn't cached by OpenRouter and answers 404 to any query value, so it is requested as is.
    const bucket = path.startsWith("/endpoints/zdr") ? "" : `${path.includes("?") ? "&" : "?"}_=${Math.floor(Date.now() / 60000)}`;
    // Workers supports follow/manual, not error. Manual plus !ok below rejects redirects without following them.
    // cache: "no-store" keeps the Workers fetch from using or filling Cloudflare's cache for this URL, whatever OpenRouter's cache-control says.
    const r = await fetch(`${OR}${path}${bucket}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000), redirect: "manual", cache: "no-store" });
    if (r.status === 404) throw Object.assign(new Error("not found"), { notFound: true });
    if (!r.ok) throw new Error("upstream");
    const json = await r.json(), data = json.data?.endpoints || json.data; if (!Array.isArray(data)) throw new Error("shape");
    return data;
  } catch (e) { throw Object.assign(new Error("OpenRouter's model catalog is unavailable. Your current settings have not changed; try again shortly."), { status: 503, code: "model_catalog_unavailable", ...(e?.notFound ? { notFound: true } : {}) }); }
}
export const NO_LONGER_OFFERED = "no longer offered by OpenRouter";
// IDs OpenRouter lists right now: chat, decision and embedding models. A leftover endpoint on the zero-data-retention list doesn't count as offered.
const offeredFrom = (models, embeddings) => new Set([...models, ...embeddings].map((m) => m.id).filter(Boolean));
// Of the given IDs, those OpenRouter no longer lists. Cloudflare models and IDs this server would never send to OpenRouter are not judged.
const judged = (id) => validModelId(id) && !isCloudflareModel(id);
const unlistedOf = (ids, offered) => [...new Set(ids)].filter((id) => judged(id) && !offered.has(id));
// What each "~author/family-latest" alias runs now, from OpenRouter's own model list (alias_target.slug): { aliasId: targetId } for the given IDs.
// The Models page uses it to tell that a call served under the alias, or under the model it resolves to, is the saved model. A failed lookup gives {}.
export async function aliasTargets(ids) {
  const want = new Set([...ids].filter(isLatestAlias)); if (!want.size) return {};
  try {
    const models = await get("/models?output_modalities=all"), out = {};
    for (const m of models) if (want.has(m.id) && typeof m.alias_target?.slug === "string") out[m.id] = m.alias_target.slug;
    return out;
  } catch { return {}; }
}
// IDs of the records OpenRouter's model list covers (chat, decision and vision models). Speech and other records can be absent from it.
export const listedKinds = (records) => Object.fromEntries(Object.entries(records || {}).filter(([, m]) => (m?.kinds || []).some((k) => ["chat", "chore", "vision", "decider"].includes(k))));
export async function unlistedIds(ids) {
  const want = [...new Set(ids)].filter(judged); if (!want.length) return [];
  const [models, embeddings] = await Promise.all([get("/models?output_modalities=all"), get("/embeddings/models")]);
  return unlistedOf(want, offeredFrom(models, embeddings));
}
// Endpoints of one model as /models/{id}/endpoints lists them, marked with whether the published zero-data-retention list proves each one.
// Unmarked endpoints (the ZDR list itself, the registered models' lists) are never treated as unproven.
export const withProof = (zdrList, id, fetched) => { const proven = new Set(zdrList.filter((e) => e.model_id === id).map((e) => e.tag)); return fetched.map((e) => ({ ...e, model_id: id, ...(proven.has(e.tag) ? {} : { from_model: true }) })); };
// checked: IDs whose own endpoint list was fetched (changes only the wording of the "no endpoint" reason).
export function assessModelCatalog(models, endpoints, { autoOnly = () => false, checked = null } = {}) {
  const byId = new Map();
  for (const e of endpoints) { if (!byId.has(e.model_id)) byId.set(e.model_id, []); byId.get(e.model_id).push(e); }
  return models.filter((m) => validModelId(m.id) && m.architecture?.output_modalities?.includes("text")).map((m) => {
    // A ~...-latest row has no endpoints of its own. It reports the pricing, limits and parameters of the model it resolves to now,
    // so that model's endpoints decide whether it is usable, under the strict zero-data-retention rule that any unregistered model gets.
    const target = isLatestAlias(m.id) && typeof m.alias_target?.slug === "string" ? m.alias_target.slug : null, policyId = target || m.id;
    const reasons = [], reasoning = m.reasoning, efforts = reasoning?.supported_efforts?.filter((e) => EFFORTS.includes(e) && e !== "default") || [];
    if (!reasoning?.mandatory && efforts.length && !efforts.includes("none")) efforts.unshift("none");
    if (!efforts.length) efforts.push("default");
    const input = (m.architecture?.input_modalities || []).filter((x) => ["text", "image", "audio", "video", "file"].includes(x));
    if (!input.includes("text")) reasons.push("No text input");
    const all = target && registered(target) && eligibleHosts(target, "zdr").length === 0 ? [] : byId.get(policyId) || [], priced = all.filter((e) => price(e.pricing?.prompt) !== null && price(e.pricing?.completion) !== null);
    // A model whose own endpoint list wasn't read this search (an empty search, or past the first matches) is still listed, for Unrestricted only.
    // It has no providers yet: saving it and starting a task read its endpoints and refuse if none work (unverified records are never saved).
    if (checked && !registered(policyId) && !all.length && !checked.has(policyId) && !reasons.length && m.supported_parameters?.includes("tools")) {
      const out = Number(m.top_provider?.max_completion_tokens) || 0;
      return { id: m.id, source: "OR", kinds: ["chat", "chore", ...(input.includes("image") ? ["vision"] : [])], name: String(m.name || m.id).slice(0, 160), eligible: true, unverified: true, reasons: [], efforts,
        default_effort: efforts.includes(reasoning?.default_effort) ? reasoning.default_effort : efforts[0], levels: ["unrestricted"], hosts: [], terms: { zdr: false, no_training: false },
        context_length: Number(m.context_length) || 0, max_output: out, input_modalities: input, pricing: { prompt: price(m.pricing?.prompt), completion: price(m.pricing?.completion) }, json: false, tool_choice: [] };
    }
    const capable = priced.filter((e) => host(e.tag) && e.supported_parameters?.includes("tools") && (e.supported_parameters?.includes("max_tokens") || e.supported_parameters?.includes("max_completion_tokens"))
      && positive(e.context_length) && positive(e.max_completion_tokens)
      && (!efforts.some((x) => x !== "default") || e.supported_parameters?.includes("reasoning"))
      && (e.status == null || e.status === 0));
    const knownRetained = registered(m.id) && eligibleHosts(m.id, "zdr").length === 0;
    // A registered model keeps the registry's hosts. Any other model's endpoint serves each level its provider's recorded terms allow, and one with
    // no recorded terms serves every level only when the published ZDR list proves it, and otherwise Unrestricted only.
    const levelsOf = (e) => registered(policyId) ? [] : PRIVACY_LEVELS.filter((l) => hostOk(policyId, e.tag, l, { proven: !e.from_model }));
    const endpointsOk = capable.filter((e) => registered(policyId) ? eligibleHosts(policyId, knownRetained ? "unrestricted" : "zdr").some((h) => e.tag === h || e.tag.startsWith(`${h}/`)) : levelsOf(e).length > 0);
    if (!all.length) reasons.push(checked ? checked.has(policyId) ? "No working endpoint" : "Providers not loaded. Search for this model by name." : "No verified zero-data-retention endpoint");
    else if (!priced.length) reasons.push("Unknown pricing");
    else if (!endpointsOk.length) reasons.push("No compatible endpoint with tools, reasoning and published token limits");
    const hosts = [...new Set(endpointsOk.map((e) => e.tag))].slice(0, 24);
    const levels = !reasons.length ? registered(policyId) ? knownRetained ? PRIVACY_LEVELS.filter((l) => eligibleHosts(m.id, l).some((h) => hosts.includes(h))) : [...PRIVACY_LEVELS]
      : PRIVACY_LEVELS.filter((l) => endpointsOk.some((e) => hosts.includes(e.tag) && levelsOf(e).includes(l))) : [];
    const unproven = [...new Set(endpointsOk.filter((e) => e.from_model && hosts.includes(e.tag) && !hostTerms(policyId, e.tag)).map((e) => e.tag))];
    const limits = endpointsOk.filter((e) => hosts.includes(e.tag));
    return { id: m.id, source: "OR", kinds: ["chat", "chore", ...(input.includes("image") ? ["vision"] : [])], name: String(m.name || m.id).slice(0, 160), eligible: !reasons.length, reasons, efforts,
      default_effort: efforts.includes(reasoning?.default_effort) ? reasoning.default_effort : efforts[0],
      levels, hosts, ...(unproven.length ? { unproven_hosts: unproven } : {}), terms: { zdr: levels.includes("zdr"), no_training: levels.includes("no_training") },
      context_length: limits.length ? Math.min(...limits.map((e) => e.context_length)) : Number(m.context_length) || 0,
      // The most a request may ask for is the largest limit among the usable endpoints (OpenRouter's own top_provider says the same for most models): one
      // endpoint's small limit does not cap the model, because OpenRouter sends the request to an endpoint that can take it. Each endpoint's own limit is
      // kept as a display fact, so the Models page can say which providers can't serve a saved number.
      max_output: limits.length ? Math.max(...limits.map((e) => e.max_completion_tokens)) : 0,
      ...(limits.length ? { endpoint_limits: limits.slice(0, 24).map((e) => ({ host: e.tag, max_output: e.max_completion_tokens, levels: registered(policyId) ? PRIVACY_LEVELS.filter((l) => eligibleHosts(policyId, l).some((h) => e.tag === h || e.tag.startsWith(`${h}/`))) : levelsOf(e) })) } : {}), input_modalities: input,
      pricing: { prompt: limits.length ? Math.max(...limits.map((e) => price(e.pricing.prompt))) : price(m.pricing?.prompt),
        completion: limits.length ? Math.max(...limits.map((e) => price(e.pricing.completion))) : price(m.pricing?.completion) },
      json: limits.length > 0 && limits.every((e) => e.supported_parameters.includes("response_format")),
      // The privacy levels at which some usable endpoint accepts response_format (structured outputs). dispatch sends json_schema only where this holds.
      json_levels: PRIVACY_LEVELS.filter((l) => limits.some((e) => e.supported_parameters.includes("response_format") && (registered(policyId) ? eligibleHosts(policyId, l).some((h) => e.tag === h || e.tag.startsWith(`${h}/`)) : levelsOf(e).includes(l)))),
      tool_choice: (autoOnly(m.id) ? ["auto"] : ["auto", "none", "required", "function"]).filter((choice) => limits.length && limits.every((e) => e.supports_tool_choice?.[choice] === true)),
    };
  });
}
// How many matching models get their own endpoint list checked per search. OpenRouter has no bulk list of every endpoint (only the
// zero-data-retention one), so the others are read one model at a time, for the newest matches of the words typed. An empty search
// checks none, and the picker already offers the saved models and the zero-data-retention ones.
const CHECK_LIMIT = 60;
const termsOf = (q) => q.trim().toLowerCase().split(/\s+/).filter(Boolean);
const matches = (m, terms) => { const hay = `${m.id} ${m.name}`.toLowerCase(); return terms.every((t) => hay.includes(t)); };
// OpenRouter's public lists, fetched together on every search (get() asks for a copy at most a minute old).
async function openRouterLists(q = "") {
  const retained = retainedModels();
  // output_modalities=all adds the decision models (kind "decider"), which the default text-only list leaves out.
  let [models, zdr, embeddings, images, ...kept] = await Promise.all([get("/models?output_modalities=all"), get("/endpoints/zdr"), get("/embeddings/models"), get("/images/models").catch(() => []), ...retained.map((m) => get(`/models/${m}/endpoints`).catch(() => []))]);
  const endpoints = [...zdr], checked = new Set(retained);
  retained.forEach((m, i) => endpoints.push(...kept[i].map((e) => ({ ...e, model_id: m }))));
  // Models the search matches that aren't registered: read their own endpoints, so a model with no zero-data-retention endpoint is still listed.
  const terms = termsOf(q), targetOf = (m) => isLatestAlias(m.id) && typeof m.alias_target?.slug === "string" ? m.alias_target.slug : m.id;
  const ids = terms.length ? [...new Set(models.filter((m) => validModelId(m.id) && m.architecture?.output_modalities?.includes("text") && matches(m, terms)).sort((a, b) => (b.created || 0) - (a.created || 0)).map(targetOf))]
    .filter((id) => validModelId(id) && !registered(id)).slice(0, CHECK_LIMIT) : [];
  const own = await Promise.all(ids.map((id) => get(`/models/${id}/endpoints`).then((list) => ({ id, list })).catch((e) => e?.notFound ? { id, list: [], gone: true } : null)));
  // A model OpenRouter still lists but whose own endpoint page answers 404 is no longer offered, so it is left out like a delisted one.
  const gone = new Set(own.filter((r) => r?.gone).map((r) => r.id));
  if (gone.size) models = models.filter((m) => !gone.has(targetOf(m)));
  for (const r of own) if (r?.list.length) { checked.add(r.id); for (let i = endpoints.length; i-- > 0;) if (endpoints[i].model_id === r.id && !endpoints[i].from_model) endpoints.splice(i, 1); endpoints.push(...withProof(zdr, r.id, r.list)); }
  return { models, endpoints, embeddings, images, checked, offered: offeredFrom(models, embeddings) };
}
export async function modelCatalog(env, { q = "", settings = null, known = [] } = {}) {
  if (typeof q !== "string" || q.length > 160) throw Object.assign(new Error("Search must be 160 characters or fewer."), { status: 400 });
  const autoOnly = (id) => quirkOf(settings, id, "auto_tool_choice_only");
  const sources = await Promise.allSettled([openRouterLists(q), cloudflareCatalog(env, q)]);
  const all = [], warnings = []; let unlisted = [];
  if (sources[0].status === "fulfilled") {
    const { models, endpoints, embeddings, images, checked, offered } = sources[0].value;
    unlisted = unlistedOf([...Object.keys(listedKinds(settings?.catalog)), ...known], offered);
    all.push(...assessModelCatalog(models, endpoints, { autoOnly, checked }), ...assessDecisionCatalog(models, endpoints), ...assessNonChatCatalog(embeddings, endpoints), ...assessImageCatalog(images || [], endpoints));
    // Speech endpoints are verified by the same public ZDR endpoint catalog.
    for (const id of Object.keys(ENDPOINTS.transcription).filter(id => !isCloudflareModel(id))) {
      const eps = endpoints.filter(e => e.model_id === id && host(e.tag)); if (!eps.length) continue;
      all.push({ id, name: eps[0].model_name || id, source: "OR", kinds: ["speech", ...(id === "assemblyai/universal-3-6-pro" ? ["speech_live"] : [])], eligible: true, reasons: [], efforts: ["default"], default_effort: "default", levels: [...PRIVACY_LEVELS], hosts: [...new Set(eps.map(e => e.tag))], context_length: 1, max_output: 1, input_modalities: ["audio"], pricing: { prompt: 0, completion: 0 }, json: false, tool_choice: [], sec_nano: Math.ceil(Math.max(...eps.map(e => Number(e.pricing?.prompt) || 0)) * 1e9), ...(id === "assemblyai/universal-3-6-pro" ? { formats: ["wav"] } : {}) });
    }
  } else warnings.push("OpenRouter model discovery is unavailable.");
  if (sources[1].status === "fulfilled") all.push(...sources[1].value); else warnings.push("Cloudflare model discovery is unavailable.");
  if (sources.every(s => s.status === "rejected")) throw sources[0].reason;
  // Every word of the search must appear in the ID or name, so "pplx decider" finds pplx-decider-v1.2 and "~deepseek flash latest" finds the alias.
  const terms = termsOf(q);
  return { models: all.filter(m => matches(m, terms)), unlisted, warnings, fetched_at: Date.now(),
    policy: "OR uses verified eligible providers and provider fallback. CF uses native Workers AI. Cloudflare's published no-training policy does not establish zero retention, so CF choices without separate ZDR evidence cannot be used for ZDR jobs." };
}
// Decision models (output "decisions": Perplexity, Jev, Clef and others) answer through OpenRouter's /systemone call, so they are kind "decider",
// never chat models. A ~...-latest row is checked against the model it resolves to now.
export function assessDecisionCatalog(models, endpoints) {
  return models.filter((m) => validModelId(m.id) && m.architecture?.output_modalities?.includes("decisions") && !m.architecture.output_modalities.includes("text")).map((m) => {
    const target = isLatestAlias(m.id) && typeof m.alias_target?.slug === "string" ? m.alias_target.slug : m.id;
    const eps = endpoints.filter((e) => e.model_id === target && host(e.tag) && e.status !== -1), hosts = [...new Set(eps.map((e) => e.tag))].slice(0, 24);
    const input = (m.architecture?.input_modalities || []).filter((x) => ["text", "image", "audio", "video", "file"].includes(x)), ok = hosts.length > 0 && input.includes("text"), p = price(m.pricing?.prompt) || 0;
    return { id: m.id, source: "OR", kinds: ["decider"], name: String(m.name || m.id).slice(0, 160), eligible: ok, reasons: ok ? [] : ["No verified zero-data-retention endpoint"], efforts: ["default"], default_effort: "default",
      levels: ok ? [...PRIVACY_LEVELS] : [], hosts, context_length: Number(m.context_length) || 8192, max_output: 1, input_modalities: input, pricing: { prompt: p, completion: 0 }, in_nano: p * 1000, json: false, tool_choice: [] };
  });
}
export function assessNonChatCatalog(models, endpoints) {
  return models.filter(m => validModelId(m.id) && m.architecture?.output_modalities?.includes("embeddings")).map(m => {
    const eps = endpoints.filter(e => e.model_id === m.id && host(e.tag) && e.status !== -1), hosts = [...new Set(eps.map(e => e.tag))];
    return { id: m.id, source: "OR", kinds: ["embedding_files"], name: String(m.name || m.id).slice(0, 160), eligible: hosts.length > 0, reasons: hosts.length ? [] : ["No verified zero-data-retention embedding endpoint"], efforts: ["default"], default_effort: "default", levels: hosts.length ? [...PRIVACY_LEVELS] : [], hosts, context_length: Number(m.context_length) || 8192, max_output: 1, input_modalities: ["text"], pricing: { prompt: price(m.pricing?.prompt) || 0, completion: 0 }, in_nano: (price(m.pricing?.prompt) || 0) * 1000, json: false, tool_choice: [] };
  });
}
// Image generation models (OpenRouter's Image API list, /images/models), kind "image". An image model is eligible when a verified zero-data-retention endpoint serves it.
// image holds what the dispatcher needs: refs (how many input references the model takes), nano (the hold for one output image, only a size for the ledger because the
// charge is the cost OpenRouter reports) and params (the optional request fields the model accepts).
export const IMAGE_HOLD_NANO = 30000000;
export function assessImageCatalog(models, endpoints) {
  return (models || []).filter((m) => validModelId(m?.id) && m.architecture?.output_modalities?.includes("image")).map((m) => {
    const eps = endpoints.filter((e) => e.model_id === m.id && host(e.tag) && e.status !== -1), hosts = [...new Set(eps.map((e) => e.tag))].slice(0, 24);
    const sp = m.supported_parameters && typeof m.supported_parameters === "object" ? m.supported_parameters : {}, refs = Number(sp.input_references?.max);
    const input = (m.architecture?.input_modalities || []).filter((x) => ["text", "image"].includes(x));
    return { id: m.id, source: "OR", kinds: ["image"], name: String(m.name || m.id).slice(0, 160), eligible: hosts.length > 0, reasons: hosts.length ? [] : ["No verified zero-data-retention endpoint"], efforts: ["default"], default_effort: "default",
      levels: hosts.length ? [...PRIVACY_LEVELS] : [], hosts, context_length: 1, max_output: 1, input_modalities: input.includes("text") ? input : ["text", ...input], pricing: { prompt: 0, completion: 0 }, json: false, tool_choice: [],
      image: { refs: Number.isSafeInteger(refs) && refs >= 0 ? Math.min(refs, 40) : 0, nano: IMAGE_HOLD_NANO, params: ["resolution", "aspect_ratio", "size"].filter((k) => k in sp) } };
  });
}
// A new task needs published limits, including for built-in slots. Fetch once
// per task (the caller persists the result), never once per step or message.
export async function taskModelCatalog(model, settings = null, env = null) {
  if (isCloudflareModel(model)) {
    let record;
    try { record = settings?.catalog?.[model] || (await cloudflareCatalog(env, model)).find(m => m.id === model); }
    catch { throw new ModelCapabilitiesUnavailable(model, { reasons: ["Cloudflare model discovery is unavailable"] }); }
    if (!validCatalogRecord(record, model) || !record.kinds?.includes("chat")) throw new ModelCapabilitiesUnavailable(model, { reasons: record?.reasons?.length ? record.reasons : ["No verified chat capabilities"] });
    return record;
  }
  if (!validModelId(model)) throw new Error("Invalid task model ID.");
  const known = registered(model);
  const [models, endpoints] = await Promise.all([get("/models"), get(known ? `/models/${model}/endpoints` : "/endpoints/zdr")]);
  const row = models.find((m) => m.id === model), target = isLatestAlias(model) && typeof row?.alias_target?.slug === "string" ? row.alias_target.slug : model;
  let selected = known ? endpoints.map((e) => ({ ...e, model_id: model })) : endpoints.filter((e) => e.model_id === target);
  // Any other model: read its own endpoints too, so one without a zero-data-retention endpoint can still run where its provider's terms allow
  // (Unrestricted, or No Training when they say so). Each is marked as proven or not against the ZDR list; if the read fails, only the proven ones remain.
  if (!known && validModelId(target) && !registered(target)) { const own = await get(`/models/${target}/endpoints`).catch(() => null); if (own?.length) selected = withProof(endpoints, target, own); }
  const record = assessModelCatalog(models.filter((m) => m.id === model), selected, { autoOnly: (id) => quirkOf(settings, id, "auto_tool_choice_only") })[0];
  if (!validCatalogRecord(record, model)) throw new ModelCapabilitiesUnavailable(model, { reasons: record?.reasons?.length ? record.reasons : ["No compatible published model record"], endpointStatuses: selected.map(endpoint => endpoint.status) });
  return record;
}
const validEndpointLimits = (a) => Array.isArray(a) && a.length <= 24 && a.every((x) => x && typeof x === "object" && host(x.host) && positive(x.max_output) && Array.isArray(x.levels) && x.levels.every((l) => PRIVACY_LEVELS.includes(l)));
// Persist only this bounded, validated server snapshot. Stored rows are not a source of arbitrary provider URLs.
export function validCatalogRecord(m, id) {
  return m && m.id === id && validModelId(id) && m.eligible === true && Array.isArray(m.hosts) && m.hosts.length > 0 && m.hosts.length <= 24 && m.hosts.every(host)
    && Array.isArray(m.efforts) && m.efforts.length > 0 && m.efforts.every((e) => EFFORTS.includes(e))
    && Array.isArray(m.levels) && m.levels.length > 0 && m.levels.every((l) => PRIVACY_LEVELS.includes(l))
    && positive(m.context_length) && positive(m.max_output) && (m.endpoint_limits == null || validEndpointLimits(m.endpoint_limits)) && Array.isArray(m.input_modalities) && (m.input_modalities.includes("text") || m.kinds?.includes("speech"))
    && m.pricing?.prompt >= 0 && m.pricing?.completion >= 0 && (m.unproven_hosts == null || (Array.isArray(m.unproven_hosts) && m.unproven_hosts.length <= 24 && m.unproven_hosts.every(host)))
    && Array.isArray(m.tool_choice) && typeof m.json === "boolean";
}

// Records saved before the catalog kept each endpoint's own limit carry the old lowest-endpoint number and no endpoint list. The Models page needs the
// endpoint limits to judge a saved max output, so it asks the live catalog for those models and uses the answer for display only (nothing is saved).
// One lookup per model per 30 minutes in this isolate; a failed lookup leaves the saved record as it was.
const refreshed = new Map();
const REFRESH_MS = 30 * 60e3;
export async function withEndpointLimits(settings, { lookup = taskModelCatalog, now = Date.now(), env = null, max = 12 } = {}) {
  const out = JSON.parse(JSON.stringify(settings));
  const used = new Set(Object.values(out.jobs || {}).flatMap((j) => j ? [j.model, ...(j.fallbacks || []).map((f) => f.model)] : []));
  const need = [...used].filter((id) => { const m = out.catalog?.[id]; return m?.eligible === true && m.source !== "CF" && !isCloudflareModel(id) && !Array.isArray(m.endpoint_limits) && m.kinds?.includes("chat"); }).slice(0, max);
  await Promise.all(need.map(async (id) => {
    let hit = refreshed.get(id);
    if (!hit || now - hit.at > REFRESH_MS) {
      try { const r = await lookup(id, out, env); hit = { at: now, limits: r?.endpoint_limits || null, max_output: r?.max_output || null }; } catch { hit = { at: now, limits: null, max_output: null }; }
      refreshed.set(id, hit);
    }
    if (hit.limits) { out.catalog[id].endpoint_limits = hit.limits; if (hit.max_output) out.catalog[id].max_output = hit.max_output; }
  }));
  return out;
}
export const resetEndpointLimitCache = () => refreshed.clear();

// Records saved before json_levels existed lack it. dispatch asks the live catalog once per model per 30 minutes in this isolate; a failed lookup
// answers null (the caller then keeps sending json_schema, as before) and is not retried for 30 minutes.
const levelsSeen = new Map();
export const resetJsonLevelCache = () => levelsSeen.clear();
export async function jsonLevelsFor(id, settings, { lookup = taskModelCatalog, now = Date.now(), env = null } = {}) {
  if (!validModelId(id) || isCloudflareModel(id)) return null;
  let hit = levelsSeen.get(id);
  if (!hit || now - hit.at > REFRESH_MS) {
    try { const r = await lookup(id, settings, env); hit = { at: now, levels: Array.isArray(r?.json_levels) ? r.json_levels : null }; } catch { hit = { at: now, levels: null }; }
    levelsSeen.set(id, hit);
  }
  return hit.levels;
}

// ---- live privacy terms ----
// A saved record's privacy facts (levels, hosts, unproven_hosts, terms, endpoint_limits, json_levels) were true when it was saved. Providers gain and lose
// zero-data-retention and no-training terms afterwards, so every place that decides whether a model may be used at a privacy level reads these
// facts through overlayLivePrivacy, which puts OpenRouter's current answer over the saved record. Nothing is saved: the overlay lives in this isolate
// (one lookup per model per 30 minutes, like withEndpointLimits). A lookup needs the model list, the ZDR list and the model's own endpoint list
// to all answer; any failure leaves the saved record as it is, so a failed or partial lookup never widens (or narrows) a model's levels.
// Registered models keep the registry's hosts (privacy.js), Cloudflare and self-hosted models have no OpenRouter terms, so none of them are looked up.
export const LIVE_PRIVACY_FIELDS = ["levels", "hosts", "unproven_hosts", "terms", "endpoint_limits", "json_levels"];
const liveSeen = new Map();   // model id -> { at, fields | null }
export const resetLivePrivacyCache = () => liveSeen.clear();
export const refreshable = (id, rec) => !!rec && rec.eligible === true && !rec.unverified && rec.source !== "CF" && (!rec.connKind || rec.connKind === "openrouter") && validModelId(id) && !isCloudflareModel(id) && !registered(id)
  && !(typeof id === "string" && id.startsWith("@")) && Array.isArray(rec.kinds) && rec.kinds.includes("chat");
// The privacy facts of a live record, or null when the live record isn't a usable one (then the saved record stays).
const liveFields = (r, id) => validCatalogRecord(r, id) ? Object.fromEntries(LIVE_PRIVACY_FIELDS.filter((k) => r[k] !== undefined).map((k) => [k, JSON.parse(JSON.stringify(r[k]))])) : null;
// The saved record with the cached live privacy facts over it. Synchronous: it only reads what refreshLivePrivacy has already fetched.
export function overlayLivePrivacy(rec, id = rec?.id) {
  const hit = liveSeen.get(id);
  if (!hit?.fields || !refreshable(id, rec)) return rec;
  const out = { ...rec };
  for (const k of LIVE_PRIVACY_FIELDS) { if (k in hit.fields) out[k] = hit.fields[k]; else delete out[k]; }
  return out;
}
export const overlayLiveCatalog = (catalog) => catalog && typeof catalog === "object" ? Object.fromEntries(Object.entries(catalog).map(([id, r]) => [id, overlayLivePrivacy(r, id)])) : catalog;
// Reads each model's live record. Throws only for a whole failure; a model whose own list can't be read answers null.
export async function liveRecords(ids, settings = null, env = null) {
  const [models, zdr] = await Promise.all([get("/models"), get("/endpoints/zdr")]);
  const out = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const row = models.find((m) => m.id === id), target = isLatestAlias(id) && typeof row?.alias_target?.slug === "string" ? row.alias_target.slug : id;
      if (!row || !validModelId(target) || registered(target)) return out.set(id, null);
      const own = await get(`/models/${target}/endpoints`);
      if (!own.length) return out.set(id, null);
      out.set(id, assessModelCatalog([row], withProof(zdr, target, own), { autoOnly: (m) => quirkOf(settings, m, "auto_tool_choice_only") })[0] || null);
    } catch { out.set(id, null); }
  }));
  return out;
}
// Brings the cache up to date for the models in `records` ({ id: record } or a list of records) that are stale or unseen. Never throws and never waits
// longer than `wait` ms; a lookup that finishes later still fills the cache.
export async function refreshLivePrivacy(records, { lookup = liveRecords, now = Date.now(), env = null, settings = null, max = 24, wait = 4000 } = {}) {
  const list = Array.isArray(records) ? records.map((r) => [r?.id, r]) : Object.entries(records || {});
  const need = [...new Set(list.filter(([id, r]) => refreshable(id, r)).map(([id]) => id))].filter((id) => { const h = liveSeen.get(id); return !h || now - h.at > REFRESH_MS; }).slice(0, max);
  if (!need.length) return;
  for (const id of need) liveSeen.set(id, { at: now, fields: liveSeen.get(id)?.fields || null });   // other callers don't repeat the lookup while this one runs
  const work = (async () => {
    let got; try { got = await lookup(need, settings, env); } catch { got = new Map(); }
    for (const id of need) { const f = (() => { try { return liveFields(got?.get?.(id), id); } catch { return null; } })(); if (f) liveSeen.set(id, { at: now, fields: f }); }
  })();
  let timer; await Promise.race([work, new Promise((res) => { timer = setTimeout(res, wait); })]); clearTimeout(timer);
}
// A copy of the saved settings whose catalog records of the models in use carry the live privacy facts. Used for the Models page and for dispatch.
export async function withLivePrivacy(settings, opts = {}) {
  if (!settings?.catalog) return settings;
  const used = new Set(Object.values(settings.jobs || {}).flatMap((j) => j ? [j.model, ...(j.fallbacks || []).map((f) => f.model)] : []));
  for (const c of settings.routing?.categories || []) for (const chain of Object.values(c.chains || {})) for (const e of Array.isArray(chain) ? chain : []) used.add(e?.model);
  await refreshLivePrivacy([...used].map((id) => settings.catalog[id]).filter(Boolean), { ...opts, settings });
  return { ...settings, catalog: overlayLiveCatalog(settings.catalog) };
}
