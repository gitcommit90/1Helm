// Public OpenRouter metadata only. Never fetch a browser-supplied URL or forward an API key.
// Replacement endpoints remain ZDR even on permissive accounts; the request price ceiling is unchanged.
import { registered, eligibleHosts, PRIVACY_LEVELS, ENDPOINTS } from "../privacy.js";
const OR = "https://openrouter.ai/api/v1";
export const MODEL_PRICE_LIMIT = { prompt: 3, completion: 15 };
const EFFORTS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
export const validModelId = (id) => typeof id === "string" && id.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id);
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const price = (p) => p != null && p !== "" && Number.isFinite(Number(p)) && Number(p) >= 0 ? Number(p) * 1e6 : null;
const host = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9/_-]{0,99}$/.test(s);
// Published endpoint flags can overstate support. Meta rejected `none` in the
// live 2026-10-12 final-report check, matching the existing pool restriction.
// Apply to saved snapshots too; this does not change model, limits or history.
// settings: the saved model settings, which say which models accept only automatic tool choice.
export function effectiveTaskCatalog(catalog, model = catalog?.id, settings = null) {
  return catalog && settings?.catalog?.[model]?.quirks?.auto_tool_choice_only ? { ...catalog, tool_choice: ["auto"] } : catalog;
}
// Registered models whose endpoints all keep or train on requests (so they never appear on OpenRouter's zero-data-retention list).
export const retainedModels = () => Object.keys(ENDPOINTS.chat).filter((m) => eligibleHosts(m, "zdr").length === 0);
async function get(path) {
  try {
    // Workers supports follow/manual, not error. Manual plus !ok below rejects redirects without following them.
    const r = await fetch(`${OR}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000), redirect: "manual" });
    if (!r.ok) throw new Error("upstream");
    const json = await r.json(), data = json.data?.endpoints || json.data; if (!Array.isArray(data)) throw new Error("shape");
    return data;
  } catch { throw Object.assign(new Error("OpenRouter's model catalog is unavailable. Your current settings have not changed; try again shortly."), { status: 503 }); }
}
export function assessModelCatalog(models, endpoints, { autoOnly = () => false } = {}) {
  const byId = new Map();
  for (const e of endpoints) { if (!byId.has(e.model_id)) byId.set(e.model_id, []); byId.get(e.model_id).push(e); }
  return models.filter((m) => validModelId(m.id) && m.architecture?.output_modalities?.includes("text")).map((m) => {
    const reasons = [], reasoning = m.reasoning, efforts = reasoning?.supported_efforts?.filter((e) => EFFORTS.includes(e) && e !== "default") || [];
    if (!reasoning?.mandatory && efforts.length && !efforts.includes("none")) efforts.unshift("none");
    if (!efforts.length) efforts.push("default");
    const input = (m.architecture?.input_modalities || []).filter((x) => ["text", "image", "audio", "video", "file"].includes(x));
    if (!input.includes("text")) reasons.push("No text input");
    const all = byId.get(m.id) || [], priced = all.filter((e) => {
      const p = price(e.pricing?.prompt), c = price(e.pricing?.completion);
      return p !== null && c !== null && p <= MODEL_PRICE_LIMIT.prompt && c <= MODEL_PRICE_LIMIT.completion;
    });
    const capable = priced.filter((e) => host(e.tag) && e.supported_parameters?.includes("tools") && (e.supported_parameters?.includes("max_tokens") || e.supported_parameters?.includes("max_completion_tokens"))
      && positive(e.context_length) && positive(e.max_completion_tokens)
      && (!efforts.some((x) => x !== "default") || e.supported_parameters?.includes("reasoning"))
      && (e.status == null || e.status === 0));
    const knownRetained = registered(m.id) && eligibleHosts(m.id, "zdr").length === 0;
    const endpointsOk = capable.filter((e) => !registered(m.id) || eligibleHosts(m.id, knownRetained ? "unrestricted" : "zdr").some((h) => e.tag === h || e.tag.startsWith(`${h}/`)));
    if (!all.length) reasons.push("No verified zero-data-retention endpoint");
    else if (!priced.length) reasons.push("Above the existing $3 input / $15 output per million token limit, or unknown pricing");
    else if (!endpointsOk.length) reasons.push("No compatible ZDR endpoint with tools, reasoning and published token limits");
    const hosts = [...new Set(endpointsOk.map((e) => e.tag))].slice(0, 24);
    const limits = endpointsOk.filter((e) => hosts.includes(e.tag));
    return { id: m.id, name: String(m.name || m.id).slice(0, 160), eligible: !reasons.length, reasons, efforts,
      default_effort: efforts.includes(reasoning?.default_effort) ? reasoning.default_effort : efforts[0],
      levels: !reasons.length ? knownRetained ? PRIVACY_LEVELS.filter((l) => eligibleHosts(m.id, l).some((h) => hosts.includes(h))) : [...PRIVACY_LEVELS] : [], hosts,
      context_length: limits.length ? Math.min(...limits.map((e) => e.context_length)) : Number(m.context_length) || 0,
      max_output: limits.length ? Math.min(...limits.map((e) => e.max_completion_tokens)) : 0, input_modalities: input,
      pricing: { prompt: limits.length ? Math.max(...limits.map((e) => price(e.pricing.prompt))) : price(m.pricing?.prompt),
        completion: limits.length ? Math.max(...limits.map((e) => price(e.pricing.completion))) : price(m.pricing?.completion) },
      json: limits.length > 0 && limits.every((e) => e.supported_parameters.includes("response_format")),
      tool_choice: (autoOnly(m.id) ? ["auto"] : ["auto", "none", "required", "function"]).filter((choice) => limits.length && limits.every((e) => e.supports_tool_choice?.[choice] === true)),
    };
  });
}
export async function modelCatalog(env, { q = "", settings = null } = {}) {
  if (typeof q !== "string" || q.length > 160) throw Object.assign(new Error("Search must be 160 characters or fewer."), { status: 400 });
  const retained = retainedModels(), autoOnly = (id) => !!settings?.catalog?.[id]?.quirks?.auto_tool_choice_only;
  const [models, endpoints, ...kept] = await Promise.all([get("/models"), get("/endpoints/zdr"), ...retained.map((m) => get(`/models/${m}/endpoints`))]);
  retained.forEach((m, i) => endpoints.push(...kept[i].map((e) => ({ ...e, model_id: m }))));
  const all = assessModelCatalog(models, endpoints, { autoOnly }), query = q.trim().toLowerCase();
  return { models: all.filter((m) => !query || `${m.id} ${m.name}`.toLowerCase().includes(query)), fetched_at: Date.now(),
    policy: "New models use verified zero-data-retention endpoints. Existing registered models keep their current privacy restrictions. All replacements require tool support and the existing $3 input / $15 output per million token ceiling." };
}
// A new task needs published limits, including for built-in slots. Fetch once
// per task (the caller persists the result), never once per step or message.
export async function taskModelCatalog(model, settings = null) {
  if (!validModelId(model)) throw new Error("Invalid task model ID.");
  const known = registered(model);
  const [models, endpoints] = await Promise.all([get("/models"), get(known ? `/models/${model}/endpoints` : "/endpoints/zdr")]);
  const selected = known ? endpoints.map((e) => ({ ...e, model_id: model })) : endpoints.filter((e) => e.model_id === model);
  const record = assessModelCatalog(models.filter((m) => m.id === model), selected, { autoOnly: (id) => !!settings?.catalog?.[id]?.quirks?.auto_tool_choice_only })[0];
  if (!validCatalogRecord(record, model)) throw Object.assign(new Error(`Published capabilities for ${model} are unavailable or incompatible. No task request was sent; try again shortly.`), { status: 503 });
  return record;
}
// Persist only this bounded, validated server snapshot. Stored rows are not a source of arbitrary provider URLs.
export function validCatalogRecord(m, id) {
  return m && m.id === id && validModelId(id) && m.eligible === true && Array.isArray(m.hosts) && m.hosts.length > 0 && m.hosts.length <= 24 && m.hosts.every(host)
    && Array.isArray(m.efforts) && m.efforts.length > 0 && m.efforts.every((e) => EFFORTS.includes(e))
    && Array.isArray(m.levels) && m.levels.length > 0 && m.levels.every((l) => PRIVACY_LEVELS.includes(l))
    && positive(m.context_length) && positive(m.max_output) && Array.isArray(m.input_modalities) && m.input_modalities.includes("text")
    && m.pricing?.prompt >= 0 && m.pricing.prompt <= MODEL_PRICE_LIMIT.prompt && m.pricing?.completion >= 0 && m.pricing.completion <= MODEL_PRICE_LIMIT.completion
    && Array.isArray(m.tool_choice) && typeof m.json === "boolean";
}
