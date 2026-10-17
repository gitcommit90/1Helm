// AI data privacy (Captain 2026-10-08): ONE product-wide setting for which AI providers may handle a person's requests.
//   unrestricted — eligible endpoints that may retain requests or train on them are allowed (OpenRouter data_collection "allow" where
//                  an eligible endpoint needs it). Not a command to send data to training providers: stricter routes stay stricter.
//   no_training  — only endpoints that don't train on requests (data_collection "deny" + the endpoint's own no-training policy).
//   zdr          — only endpoints with verified zero-data-retention coverage (zdr: true + no-training).
// Unset, unknown or unreadable → "zdr" (fail closed). Existing accounts stay ZDR until their owner explicitly picks something else.
//
// This module is the shared policy every AI dispatch uses (and future ones must use): the stored level (privacyOf: read from D1 on
// every dispatch, so tightening between calls blocks a stale permissive route), the endpoint registry (ENDPOINTS: per modality,
// model and provider host, what the endpoint does with data), and the request validator (enforceRequest) that rewrites an
// OpenRouter request so it can only reach endpoints eligible at that level, or throws PrivacyBlocked before anything is sent.
// Unknown policy is never evidence of eligibility: a model or host missing from the registry is sent only with OpenRouter's strictest
// filter (zdr: true, data_collection: "deny"), whatever the person chose.
//
// FUTURE MODALITIES (architecture rule, see proto/README.md "AI provider privacy levels"): video, image generation/editing, text to
// speech, transcription and any other AI feature inherit this same level. Register their endpoints under their modality in ENDPOINTS
// (verified per endpoint and per modality; a provider's chat policy says nothing about its image or voice API), call enforceRequest
// (or endpointOk / eligibleHosts for non-OpenRouter APIs) on the exact provider/endpoint and the full submitted payload (reference
// images, audio, voice samples, video, text) for initial requests, async submissions, retries and fallbacks. No eligible route →
// explain the limitation; never weaken the level.

export const PRIVACY_LEVELS = ["unrestricted", "no_training", "zdr"];
export const DEFAULT_PRIVACY = "zdr";
export const PRIVACY_CONSENT_VERSION = "2026-10-08";   // the onboarding/Settings copy version recorded with each explicit choice
export const PRIVACY_LABEL = { unrestricted: "Unrestricted", no_training: "No Training", zdr: "Zero Data Retention" };
export const STRICTNESS = { unrestricted: 0, no_training: 1, zdr: 2 };
export const isPrivacyLevel = (v) => PRIVACY_LEVELS.includes(v);
export const normalizePrivacy = (v) => isPrivacyLevel(v) ? v : DEFAULT_PRIVACY;
export const stricterOf = (a, b) => STRICTNESS[normalizePrivacy(a)] >= STRICTNESS[normalizePrivacy(b)] ? normalizePrivacy(a) : normalizePrivacy(b);

// The authoritative current level for a tenant: one D1 point read per dispatch (no cache: a tightening must win on the very next call).
// No tenant, no DB, a missing row or a failed read → "zdr".
export async function privacyOf(env, tenant) {
  if (!tenant || !env?.DB) return DEFAULT_PRIVACY;
  try { const r = await env.DB.prepare("SELECT ai_privacy FROM tenants WHERE id=?").bind(String(tenant)).first(); return normalizePrivacy(r?.ai_privacy); }
  catch (e) { console.log("privacy: read failed, using zdr", String(e?.message || e).slice(0, 120)); return DEFAULT_PRIVACY; }
}
// The stored choice for the API/boot: { level, chosen (an explicit choice was recorded), version, at }.
export function privacyView(t) {
  const raw = String(t?.ai_privacy || "");
  return { level: normalizePrivacy(raw), chosen: isPrivacyLevel(raw), version: t?.ai_privacy_version || "", at: t?.ai_privacy_at != null ? Number(t.ai_privacy_at) : null };
}
// Server-side validation + write (onboarding and Settings both use it; the caller has already checked the session owns tenantId).
export async function setPrivacy(env, tenantId, level, at = Date.now()) {
  if (!isPrivacyLevel(level)) return { error: "Choose one of the three options." };
  await env.DB.prepare("UPDATE tenants SET ai_privacy=?,ai_privacy_version=?,ai_privacy_at=?,updated_at=? WHERE id=?").bind(level, PRIVACY_CONSENT_VERSION, at, at, tenantId).run();
  return { ok: true, level, version: PRIVACY_CONSENT_VERSION, at };
}

// ---- The endpoint registry: modality → model → OpenRouter provider host → what that endpoint does with requests ----
//   zdr:      verified zero data retention for this modality (OpenRouter /api/v1/endpoints/zdr, checked 2026-10-06…08)
//   training: the endpoint may train on requests
// Hosts are listed in preference order. Sources: the OpenRouter endpoint lists, local validation evidence (both Meta endpoints retain ~30 days; Contributor trains, Standard doesn't;
// per-request data_collection deny / zdr were verified to reject Contributor).
const Z = { zdr: true, training: false };
export const ENDPOINTS = {
  chat: {
    "meta/muse-spark-1.3-contributor": { meta: { zdr: false, training: true } },
    "meta/muse-spark-1.3": { meta: { zdr: false, training: false } },
    "deepseek/deepseek-v4.1-flash": { together: Z, modal: Z, coreweave: Z },
    "openai/gpt-6-luna": { azure: Z, "azure/us": Z, "azure/eu": Z },
    "openai/gpt-6.1-sol": { azure: Z, "azure/us": Z, "azure/eu": Z },
    "anthropic/claude-haiku-5.5": { "amazon-bedrock": Z, "google-vertex": Z },
    "openai/gpt-oss-120b": { cerebras: Z },
    "openai/gpt-oss-20b": { "amazon-bedrock": Z },
  },
  // Speech to text (transcribe.js stt: dictation, Live notes, file sidecars), OpenRouter /audio/transcriptions. ZDR per /endpoints/zdr
  // (2026-10-08) for these exact model + host pairs; host slugs verified on the wire (provider.only ["deepinfra"] reaches deepinfra/us).
  transcription: {
    // Exact Workers AI realtime endpoint: Cloudflare data-usage policy + Deepgram mip_opt_out=true
    // (2026-10-11). transcribe-live.js also disables gateway logs, payload logs and cache explicitly.
    // https://developers.cloudflare.com/workers-ai/platform/data-usage/
    // https://developers.deepgram.com/trust-security/your-data
    "@cf/deepgram/nova-3": { "cloudflare-workers-ai": Z },
    // AssemblyAI Universal-3.6 Pro (2026-10-15): AssemblyAI is OpenRouter's only host (tag "assemblyai"). It is on OpenRouter's
    // /api/v1/endpoints/zdr list, and real calls confirmed it: zdr:true and data_collection:"deny" both answer 200, while a
    // non-ZDR model (openai/whisper-1) with the same filter answers 404 "No endpoints found matching your data policy".
    // OpenRouter's endpoint data doesn't state AssemblyAI's own data policy, so this entry rests on that list alone.
    "assemblyai/universal-3-6-pro": { assemblyai: Z },
    "qwen/qwen3-asr-0.6b": { deepinfra: Z },
    "openai/whisper-large-v3-turbo": { deepinfra: Z, groq: Z },
  },
  // image: {}, video: {}, tts: {}   ← future modalities register here, verified per endpoint (see header).
};
export const registered = (model, modality = "chat") => !!ENDPOINTS[modality]?.[model];
// ---- Terms recorded per provider (OpenRouter host tag, without any "/region" suffix) ----
// What a provider does with requests, for every model it serves, including models released later. A per-model entry in ENDPOINTS
// overrides it. A provider that isn't here has UNKNOWN terms: its endpoints count only where OpenRouter's published ZDR list proves
// zero retention (any level), and otherwise only at Unrestricted. Record a provider only with a citation.
//   meta: both Meta endpoints retain requests ~30 days and the Standard endpoint doesn't train (the same evidence as the per-model Muse entries above). `not` lists model IDs the
//         provider terms don't cover: the Contributor endpoint trains, so a Contributor model gets no recorded terms.
export const PROVIDERS = {
  chat: { meta: { zdr: false, training: false, not: /contributor/i } },
};
// The recorded terms of one host for one model, or null (unknown). A model registered in ENDPOINTS uses only its own entries
// (a host it doesn't list has none); any other model uses the provider's terms.
export function hostTerms(model, host, { modality = "chat" } = {}) {
  if (typeof host !== "string") return null;
  const reg = ENDPOINTS[modality]?.[model];
  if (reg) { const base = Object.keys(reg).filter((b) => host === b || host.startsWith(`${b}/`)).sort((a, b) => b.length - a.length)[0]; return base ? reg[base] : null; }
  const prov = PROVIDERS[modality]?.[host.split("/")[0]];
  return prov && !(prov.not && prov.not.test(String(model))) ? { zdr: prov.zdr, training: prov.training } : null;
}
// Whether a host may serve an unregistered model at a level. Unknown terms: only Unrestricted, unless the host is proven ZDR
// (OpenRouter's published list), which satisfies every level.
export function hostOk(model, host, level, { proven = false, modality = "chat" } = {}) {
  level = normalizePrivacy(level);
  const t = hostTerms(model, host, { modality });
  if (t) return endpointOk(t, level);
  return !ENDPOINTS[modality]?.[model] && (proven || level === "unrestricted");   // a registered model never uses a host it doesn't list
}
// Is one endpoint eligible at a level? Unknown endpoint → no.
export function endpointOk(ep, level) {
  if (!ep) return false;
  level = normalizePrivacy(level);
  if (level === "zdr") return ep.zdr === true && ep.training === false;
  if (level === "no_training") return ep.training === false;
  return true;
}
// The eligible hosts of a model at a level, in registry order; [] when none.
// Content-category provenance does not impose additional model-specific exclusions.
export function eligibleHosts(model, level, { modality = "chat" } = {}) {
  const reg = ENDPOINTS[modality]?.[model]; if (!reg) return [];
  return Object.entries(reg).filter(([, ep]) => endpointOk(ep, level)).map(([h]) => h);
}
// Why a model can't be used at this level (or null when it can): for logs, labels and the ops route preview.
export function ineligibleWhy(model, level, { modality = "chat", prov = null } = {}) {
  const reg = ENDPOINTS[modality]?.[model]; if (!reg) return null;   // unregistered: allowed only under OpenRouter's strict ZDR filter
  if (eligibleHosts(model, level, { modality, prov }).length) return null;
  return `no ${PRIVACY_LABEL[normalizePrivacy(level)]} endpoint`;
}

export class PrivacyBlocked extends Error {
  constructor(message, detail = {}) { super(message); this.privacy = true; this.orStatus = 451; this.status = 451; Object.assign(this, detail); }
}
export const PRIVACY_EXHAUSTED = "No AI model allowed by your AI data privacy setting is available right now, so I stopped here. Nothing was sent anywhere else. Try again in a few minutes, or review the setting in Settings → General → AI data privacy.";

// The validator around every OpenRouter chat request: returns the request with OpenRouter's own data policy fields set for `level`, or throws
// PrivacyBlocked (nothing is sent). The levels map to OpenRouter's fields and nothing else:
//   zdr -> zdr: true and data_collection "deny";  no_training -> data_collection "deny";  unrestricted -> data_collection "allow".
// A request that already asks for a stricter value (zdr, or "deny") keeps it, so a stricter job is never weakened. No host list is built or kept:
// provider.order, provider.only and provider.ignore are removed from every request. A model the registry (ENDPOINTS) lists must have at least one
// endpoint allowed at the level, or the request is refused here; every other model is left to OpenRouter's filter.
// A `models` fallback list always gets the strictest filter.
export function enforceRequest(payload, level, { prov = null, modality = "chat" } = {}) {
  level = normalizePrivacy(level);
  const p = { ...payload }, { order, only, ignore, ...given } = p.provider && typeof p.provider === "object" ? p.provider : {};
  const STRICT = { zdr: true, data_collection: "deny" };
  if (Array.isArray(p.models) && p.models.length) {
    const ok = (m) => !registered(m, modality) || eligibleHosts(m, "zdr", { modality, prov }).length > 0;
    if (p.model && !ok(p.model)) throw new PrivacyBlocked(`privacy: ${p.model} has no zero-data-retention endpoint`, { model: p.model, level });
    p.models = p.models.filter(ok); if (!p.models.length) delete p.models;
    p.provider = { ...given, ...STRICT };
    return p;
  }
  if (registered(p.model, modality) && !eligibleHosts(p.model, level, { modality, prov }).length)
    throw new PrivacyBlocked(`privacy: ${p.model} is not allowed at ${level} (${ineligibleWhy(p.model, level, { modality, prov })})`, { model: p.model, level });
  const zdr = level === "zdr" || given.zdr === true, deny = zdr || level !== "unrestricted" || given.data_collection === "deny";
  const { zdr: _z, data_collection: _d, ...rest } = given;
  p.provider = { ...rest, ...(zdr ? { zdr: true } : {}), data_collection: deny ? "deny" : "allow" };
  return p;
}

// Own AI key (byok.js) through Sign in with OpenRouter: the key is theirs, but OpenRouter still honours per-request data policy, so the
// level is applied there too (their chosen model is kept: if no endpoint of it qualifies, OpenRouter refuses and the person is told
// why, see byokPrivacyText). Any other endpoint (OpenAI, a self-hosted server…) can't be steered: the provider's terms apply, and
// Settings says so. Returns the extra request fields, or {}.
export const isOpenRouterBase = (base) => /^https:\/\/openrouter\.ai\/api\/v1\/?$/i.test(String(base || "").trim());
export function byokPrivacyFields(cfg, level) {
  if (!cfg || !isOpenRouterBase(cfg.base)) return {};
  level = normalizePrivacy(level);
  return level === "zdr" ? { provider: { zdr: true, data_collection: "deny" } } : level === "no_training" ? { provider: { data_collection: "deny" } } : {};
}
export const POLICY_REFUSAL_RE = /data policy|zero data retention|paid model training|No endpoints found matching/i;
export const byokPrivacyText = (cfg, level, model) => `Your AI data privacy setting (${PRIVACY_LABEL[normalizePrivacy(level)]}) doesn't allow any provider that OpenRouter has for ${model || "your chosen model"}, so I couldn't send this. Nothing was sent elsewhere. Pick a different model in ${cfg?.settings ? `[Settings → Use my own AI key](${cfg.settings})` : "Settings → Use my own AI key"}, or change AI data privacy in Settings → General.`;
// What the app shows (boot / Settings): the stored choice, plus whether an own AI key is in play and whether this setting reaches it
// (byok: "openrouter" = applied through OpenRouter's data policy; "other" = their provider's terms apply; null = no key in use).
export async function privacyBoot(env, t) {
  const v = privacyView(t); let byok = null;
  try { const b = await env.DB.prepare("SELECT base_url, mode FROM byok WHERE tenant_id=?").bind(t.id).first();
    if (b?.base_url && (t.plan === "byok" || b.mode === "fallback")) byok = isOpenRouterBase(b.base_url) ? "openrouter" : "other"; } catch {}
  return { ...v, byok };
}
