// The first-run data for the model settings, and the one-time migration from the earlier format.
//
// This is the ONLY place (besides the endpoint privacy facts in privacy.js and tests) that names models. Nothing at runtime reads it:
// model-settings.js copies these values into the saved settings the first time an environment has none, and from then on every job
// reads only its own saved setting (model-jobs.js). Edit models on the Models page, never here.
//
// Two ways the first copy is made:
//   seedFresh(env)          a brand-new environment (public self-hosting): the values below, nothing else.
//   seedFromLegacy(env, c)  an environment that already ran the earlier slot-based settings: exactly what was in effect there,
//                           including a saved earlier settings row (c).
// Literals only: no environment variable chooses a model, a provider list or a limit here. A saved entry never carries provider lists (hosts, pin).
import { JOBS, JOB_KINDS, CHAT_JOB, configuredHosts } from "./model-jobs.js";
import { jobTimeoutDefault } from "../limits.js";
import { withRoutingConfig } from "./routing-config.js";

const MUSE_C = "meta/muse-spark-1.3-contributor", MUSE_S = "meta/muse-spark-1.3", DEEPSEEK = "deepseek/deepseek-v4.1-flash";
const LUNA = "openai/gpt-6-luna", HAIKU = "anthropic/claude-haiku-5.5";
const OSS120 = "openai/gpt-oss-120b", GLM = "z-ai/glm-5.3-flash";
const PPLX_DECIDER = "perplexity/pplx-decider-v1.1-27b";
// The memory server's models (the jobs hs_retain, hs_consolidation, hs_reflect, hs_refresh and hs_rerank). Their starting values are what the Hindsight host's
// compose file held before its calls moved behind the Worker: OpenRouter latest aliases.
const HS_RETAIN = "~openai/gpt-luna-latest", HS_FLASH = "~deepseek/deepseek-flash-latest", HS_RERANK = "~perplexity/pplx-decider-latest";
// Speech to text, in order (the Captain, 2026-10-15, "it is an accuracy choice"): AssemblyAI Universal-3.6 Pro first, then the earlier order.
const STT_BEST = "assemblyai/universal-3-6-pro", STT = "qwen/qwen3-asr-0.6b", STT_FALLBACK = "openai/whisper-large-v3-turbo", STT_WAI = "@cf/openai/whisper-large-v3-turbo", LIVE_STT = "@cf/deepgram/nova-3";
const CLEF = "@cf/cloudflare/clef", CLEF_FLASH = "@cf/cloudflare/clef-flash";
const EMBED_FILES = "perplexity/pplx-embed-v1-0.6b", EMBED_SELF = "@1hc/perplexity-ai/pplx-embed-v1-0.6b", VISION = "@cf/google/gemma-4-26b-a4b-it", WAI_CHAT = "@cf/zai-org/glm-5.3-flash";
// The browser look's starting model: Moondream 3.1 on Workers AI. It is the saved job "look".
export const MOONDREAM = "@cf/moondream/moondream3.1-9B-A2B";
// The web search provider the search job starts on: Linkup through the Cloudflare Web Search API.
export const SEARCH_LINKUP = "cloudflare/linkup";

// Starting values of the saved per job fields max_output, sort, max_price and results. A saved setting without a field reads as the value here.
//   max_output: the most tokens the job may write. Empty (null) is every job's starting value: the request carries no limit, so each provider's own
//   maximum applies (Captain 2026-10-17). sort: OpenRouter's own provider sort, "price", "throughput" or "latency" (null: none).
//   max_price: { prompt, completion } in dollars per million tokens (null: the ceiling in model.js). results: how many results a web search asks for
//   (only the web_search job has it; it is not a token limit).
const SORTS = { vision_files: "throughput" };
// The memory jobs start with the output limits the Hindsight server itself asked for (retain 64000 by its own default, consolidation, reflect and refresh 16000 by its
// settings), because the Worker now sends the call and ignores the server's own limit. A saved empty value sends no limit.
const MAX_OUTPUT = { hs_retain: 64000, hs_consolidation: 16000, hs_reflect: 16000, hs_refresh: 16000, notes: 6000, notes_final: 24000, notes_refine: 24000 };
export const jobFieldDefaults = (id) => ({ max_output: MAX_OUTPUT[id] ?? null, sort: SORTS[id] ?? null, max_price: null, results: id === "web_search" ? 5 : null, timeout_ms: jobTimeoutDefault(id) });
export const JOB_FIELDS = ["max_output", "sort", "max_price", "results", "timeout_ms"];
// Jobs a later release added that an older saved version doesn't carry. They are filled in with this value
// when read or checked, and nothing is written for it.
export const OPTIONAL_JOB_IDS = ["look", "web_search", "browser_decider", "chat_title", "hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh", "hs_rerank"];
const OPTIONAL_MODEL = { look: MOONDREAM, web_search: SEARCH_LINKUP, hs_retain: HS_RETAIN, hs_consolidation: HS_FLASH, hs_reflect: HS_FLASH, hs_refresh: HS_FLASH, hs_rerank: HS_RERANK };
// The reasoning level each memory job started with (the server's own setting).
const OPTIONAL_EFFORT = { hs_retain: "low", hs_consolidation: "none", hs_reflect: "low", hs_refresh: "low" };
// browser_decider starts as a copy of the request sorter job (model, reasoning level and fallbacks), so `jobs` (the settings' jobs) says which; it adds no model facts.
// chat_title starts as a copy of the task summaries job (label): model, reasoning level and fallbacks.
export const optionalJobDefault = (id, jobs = null) => id === "chat_title" ? { job: (({ model, effort, strict, fallbacks }) => clone({ model, effort: effort ?? null, ...(strict ? { strict } : {}), fallbacks: fallbacks || [] }))(jobs?.label || inEffectChore("label")), facts: null } : id === "browser_decider" ? { job: (({ model, effort, strict, fallbacks }) => clone({ model, effort: effort ?? null, ...(strict ? { strict } : {}), fallbacks: fallbacks || [] }))(jobs?.decider || { model: PPLX_DECIDER, fallbacks: [] }), facts: null } : OPTIONAL_MODEL[id] ? { job: { model: OPTIONAL_MODEL[id], effort: OPTIONAL_EFFORT[id] ?? null, fallbacks: [] }, facts: { id: OPTIONAL_MODEL[id], ...clone(SEED_FACTS[OPTIONAL_MODEL[id]]) } } : null;

// The third zero-data-retention model of a General list, used only when an older saved version (without categories) is converted to routing categories.
export const ROUTING_ZDR_THIRD_MODEL = DEEPSEEK;

const LEVELS = ["unrestricted", "no_training", "zdr"];
// OpenRouter /api/v1/models reasoning levels, checked 2026-10-10. "none" is offered only when reasoning is optional.
const VISION_EFFORTS = ["default", "none", "low", "medium", "high"];
const ALL = ["minimal", "low", "medium", "high", "xhigh", "max"];
// What each model is and what it can do. Copied into the saved settings; the runtime reads the saved copy.
export const SEED_FACTS = {
  [MUSE_C]: { name: "Muse Contributor", kinds: ["chat"], efforts: ALL, quirks: { auto_tool_choice_only: true, reasoning_replay: true } },
  [MUSE_S]: { name: "Muse Standard", kinds: ["chat"], efforts: ALL, quirks: { auto_tool_choice_only: true, reasoning_replay: true } },
  [DEEPSEEK]: { name: "DeepSeek Flash", kinds: ["chat", "chore", "classic"], efforts: ["default", "none", "low", "high", "max"] },
  [LUNA]: { name: "Luna", kinds: ["chat", "chore"], efforts: ["default", "none", "low", "medium", "high", "xhigh", "max"], quirks: { no_temperature: true, rate_limit_waits: true } },
  [HAIKU]: { name: "Haiku", kinds: ["chat", "chore"], efforts: ["default", "none", "low", "medium", "high", "xhigh", "max"], quirks: { no_temperature: true } },
  [OSS120]: { name: "GPT OSS 120B", kinds: ["chore"], efforts: ["default", "low", "medium", "high"], quirks: { reasoning_mandatory: true } },
  // Reasoning levels as OpenRouter lists them (checked 2026-10-15): Qwen supports xhigh, medium and low and can turn reasoning off; GLM supports
  // low, high and max and can't turn it off (mandatory), so "none" is sent as "low" there.
  [GLM]: { name: "GLM 5.3 Flash", kinds: ["chore", "classic"], efforts: ["low", "high", "max"], quirks: { reasoning_mandatory: true } },
  [PPLX_DECIDER]: { name: "Perplexity Decider", kinds: ["decider"], efforts: [] },
  // The memory server's latest aliases (OpenRouter resolves each to a current model when the call is made). Luna takes no temperature (the server's retain setting
  // omitted it for the same reason), and the others take what the server sends.
  [HS_RETAIN]: { name: "Luna (latest)", kinds: ["chat", "chore"], efforts: ["default", "none", "low", "medium", "high", "xhigh", "max"], quirks: { no_temperature: true, rate_limit_waits: true } },
  [HS_FLASH]: { name: "DeepSeek Flash (latest)", kinds: ["chat", "chore", "classic"], efforts: ["default", "none", "low", "high", "max"] },
  [HS_RERANK]: { name: "Perplexity Decider (latest)", kinds: ["decider"], efforts: [] },
  // formats: the input_audio formats it accepts (checked 2026-10-15: webm, m4a, mp4, mp3, ogg and flac answer 400 "only wav is supported";
  // 16-bit PCM WAV at any rate or channel count works, 8-bit and mu-law WAV don't; no length limit found up to 20 min / 38 MB).
  // sec_nano: price in nano-dollars per audio second, rounded up ($0.0000833333/s on OpenRouter), used for reservations.
  [STT_BEST]: { name: "AssemblyAI Universal-3.6 Pro", kinds: ["speech", "speech_live"], efforts: [], formats: ["wav"], sec_nano: 83334 },
  [STT]: { name: "Qwen3 ASR 0.6B", kinds: ["speech"], efforts: [] },
  [STT_FALLBACK]: { name: "Whisper Large v3 Turbo", kinds: ["speech"], efforts: [] },
  [STT_WAI]: { name: "Whisper Large v3 Turbo (Cloudflare)", kinds: ["speech_cloudflare"], efforts: [] },
  [LIVE_STT]: { name: "Deepgram Nova 3 (Cloudflare)", kinds: ["speech_live"], efforts: [] },
  [CLEF]: { name: "Clef (Cloudflare)", kinds: ["workers_decider"], efforts: [], in_nano: 240 },
  // Clef Flash: $0.038 per million input tokens on Cloudflare (Workers AI model list, checked 2026-10-15), so 38 nano-dollars per token.
  [CLEF_FLASH]: { name: "Clef Flash (Cloudflare)", kinds: ["workers_decider"], efforts: [], in_nano: 38 },
  // pricing: dollars per million tokens (Workers AI list price), the look job's cost comes from it.
  [MOONDREAM]: { name: "Moondream 3.1 (Cloudflare)", kinds: ["look"], efforts: [], pricing: { prompt: 0.3, completion: 1.0 } },
  [SEARCH_LINKUP]: { name: "Linkup (Cloudflare Web Search)", kinds: ["search"], efforts: [] },
  // The same weights, run by 1Helm in its own container (selfhost-models.js). Each lists the other as equivalent: measured 2026-10-18 on 364 chunks and 181
  // queries, the vectors have a mean cosine of 0.995 against Perplexity's API, the top result is the same for 96 to 98 percent of
  // queries, and hit rates and mean reciprocal rank are the same (0.570 to 0.577 against 0.576). An index made by one is searched with the other with no re-index.
  // pricing: dollars per million tokens, used only to size reservations. 117 tokens a second were measured on the 2 vCPU instance, whose container costs
  // $0.0000611 a second, so $0.52 per million tokens. The charge is the container's own measured running time.
  [EMBED_FILES]: { name: "Perplexity Embed 0.6B", kinds: ["embedding_files"], efforts: [], embedding_equivalents: [EMBED_SELF] },
  [EMBED_SELF]: { name: "Perplexity Embed 0.6B (1Helm container)", kinds: ["embedding_files"], efforts: [], pricing: { prompt: 0.6, completion: 0 }, embedding_equivalents: [EMBED_FILES] },
  [VISION]: { name: "Gemma 4 26B (Cloudflare)", kinds: ["vision"], efforts: VISION_EFFORTS },
  [WAI_CHAT]: { name: "GLM 5.3 Flash (Cloudflare)", kinds: ["workers_ai"], efforts: [] },
};

// ---- the earlier built-in defaults, used only to reproduce what was in effect ----
const OLD_POOL = { "muse-c": [MUSE_C, "xhigh"], "muse-s": [MUSE_S, "xhigh"], deepseek: [DEEPSEEK, "max"], luna: [LUNA, "xhigh"], haiku: [HAIKU, "xhigh"] };
const C = "muse-c", S = "muse-s", D = "deepseek", L = "luna", H = "haiku";
// Sol left the first-run data (Captain, 2026-10-15), so Haiku takes its place in each list, once per list.
const OLD_GENERAL_CHAIN = { unrestricted: [C, D, L], no_training: [D, S, L], zdr: [D, L, H] };
// The earlier chore model keys: the model and its own reasoning default.
const OLD_CHORE = { oss120: { model: OSS120 }, dsflash: { model: DEEPSEEK, effort: "none" }, haiku: { model: HAIKU, effort: "none" }, luna: { model: LUNA } };
const bg = (model, effort = "low") => ({ model, effort });
const OLD_POLICY = { label: bg(HAIKU), notes: bg(LUNA), notes_refine: bg(DEEPSEEK), notes_final: bg(HAIKU), sidecar_card: bg(HAIKU), ambient_extract: bg(LUNA), ambient_review: bg(DEEPSEEK) };

const clone = (x) => JSON.parse(JSON.stringify(x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const entry = (model, effort, extra = {}) => ({ model, effort, ...extra });

// One chore route the way the earlier code built it from a chore key.
function choreKeyEntry(key, effortOverride, fallbackEffort) {
  const m = OLD_CHORE[key] || OLD_CHORE.oss120;
  return entry(m.model, effortOverride || m.effort || fallbackEffort);
}
// Captain's rule: every background job has at least one fallback. A DeepSeek Flash or Luna job falls back to Haiku or DeepSeek Flash,
// and a Haiku job falls back to DeepSeek Flash. Browser summaries seed on gpt-oss-120b and fall back to DeepSeek Flash. Any other main model gets none here.
const RULE_FALLBACK = { [DEEPSEEK]: [HAIKU, "haiku"], [HAIKU]: [DEEPSEEK, "dsflash"], [LUNA]: [DEEPSEEK, "dsflash"], [OSS120]: [DEEPSEEK, "dsflash"] };
const ruleFallbacks = (model, effort = "low") => {
  const r = RULE_FALLBACK[model]; if (!r) return [];
  const m = OLD_CHORE[r[1]], e = (SEED_FACTS[m.model].efforts || []).includes(effort) ? effort : "low";
  return [entry(m.model, e)];
};
// The earlier jobs that came from code, in effect with no saved override.
function inEffectChore(role) {
  if (own(OLD_POLICY, role)) { const p = OLD_POLICY[role]; return { ...entry(p.model, p.effort), fallbacks: ruleFallbacks(p.model, p.effort) }; }
  // Task handoffs: DeepSeek Flash at low reasoning, falling back to Haiku.
  if (role === "handoff") { const first = choreKeyEntry("dsflash", "low"); return { ...first, fallbacks: ruleFallbacks(first.model, "low") }; }
  // Browser summaries: gpt-oss-120b, falling back to DeepSeek Flash.
  if (role === "browser") return { ...entry(OSS120, "low"), fallbacks: ruleFallbacks(OSS120, "low") };
  return null;
}
// A saved earlier chore selection replaces the built-in one for its role.
function savedChore(legacy, role) {
  const c = legacy?.chores?.[role]; if (!c || c.model === "default") return null;
  const meta = legacy?.catalog?.[c.model], fallbackEffort = "low";
  const known = OLD_CHORE[c.model];
  const model = known ? known.model : c.model;
  const isPolicy = own(OLD_POLICY, role) || c.model === "oss120";
  return { ...entry(model, c.effort, { strict: true }), fallbacks: isPolicy ? (c.model === "oss120" ? [] : ruleFallbacks(model, c.effort)) : [entry(OSS120, fallbackEffort, { strict: true })] };
}
// Merge the three per-level lists of the earlier format into one ordered list, so that skipping what each privacy setting forbids gives
// back each level's own list. The strictest level's order is fixed first, then the next, then Unrestricted; an order that would
// contradict a stricter level is left out. allowed(key, level): may the privacy setting use that model at all. The result keeps every
// level's first choice. Only fallbacks of a looser level can differ, and only when two levels order the same models oppositely.
export function mergeLevels(lists, allowed = () => true) {
  const LV = ["zdr", "no_training", "unrestricted"], rank = [];
  for (let i = 0; i < 3; i++) for (const lv of ["unrestricted", "no_training", "zdr"]) { const k = lists?.[lv]?.[i]; if (k != null && !rank.includes(k)) rank.push(k); }
  const before = new Map(rank.map((k) => [k, new Set()]));   // before.get(b) = the keys that must come before b
  const reaches = (from, to) => { const seen = new Set(), stack = [to]; while (stack.length) { const n = stack.pop(); if (n === from) return true; if (seen.has(n)) continue; seen.add(n); for (const p of before.get(n) || []) stack.push(p); } return false; };
  const add = (a, b) => { if (a !== b && !reaches(b, a)) before.get(b).add(a); };
  for (const lv of LV) {
    const list = lists?.[lv] || []; if (!list.length) continue;
    for (let i = 0; i + 1 < list.length; i++) add(list[i], list[i + 1]);
    for (const k of rank) if (!list.includes(k) && allowed(k, lv)) add(list.at(-1), k);
  }
  const out = [], left = new Set(rank);
  while (left.size) { const next = rank.find((k) => left.has(k) && [...before.get(k)].every((p) => !left.has(p))); out.push(next); left.delete(next); }
  return out;
}

export const LEGACY_CHORES = ["handoff", "label", "browser", "notes", "notes_refine", "notes_final", "sidecar_card", "ambient_extract", "ambient_review"];

// The jobs that don't depend on the earlier saved format (environment variables and built-in values).
function otherJobs() {
  const sttList = [STT_BEST, STT, STT_FALLBACK];
  return {
    stt: { model: sttList[0], effort: null, fallbacks: sttList.slice(1).map((m) => entry(m, null)) },
    stt_cloudflare: { model: STT_WAI, effort: null, fallbacks: [] },
    live_dictation: { model: STT_BEST, effort: null, fallbacks: [entry(LIVE_STT, null)] },
    embed_files: { model: EMBED_FILES, effort: null, fallbacks: [entry(EMBED_SELF, null)] },
    vision_files: { model: VISION, effort: "none", fallbacks: [] },
    workers_ai_chat: { model: WAI_CHAT, effort: null, fallbacks: [] },
    look: optionalJobDefault("look").job,
    web_search: optionalJobDefault("web_search").job,
    ...Object.fromEntries(["hs_retain", "hs_consolidation", "hs_reflect", "hs_refresh", "hs_rerank"].map((id) => [id, optionalJobDefault(id).job])),
  };
}

function finish(jobs, extraFacts = {}) {
  const used = new Set();
  for (const j of Object.values(jobs)) { used.add(j.model); for (const f of j.fallbacks) used.add(f.model); }
  const catalog = {};
  for (const [id, f] of Object.entries(extraFacts)) catalog[id] = clone(f);
  // A model the first-run facts don't describe (named by an environment variable) is described by the jobs that use it.
  const picks = (id) => [...new Set(JOBS.filter((d) => jobs[d.id] && [jobs[d.id].model, ...jobs[d.id].fallbacks.map((f) => f.model)].includes(id)).map((d) => JOB_KINDS[d.kind].pick))];
  for (const id of used) if (!own(catalog, id)) catalog[id] = own(SEED_FACTS, id) ? { id, ...clone(SEED_FACTS[id]) } : { id, name: id, kinds: picks(id), efforts: ["default", "none", "low", "medium", "high"] };
  // The catalog holds only models that some job uses as its model or a fallback (Captain, 2026-10-15). SEED_FACTS stays the list of known facts.
  for (const id of Object.keys(catalog)) if (!used.has(id)) delete catalog[id];
  return { version: 2, jobs, catalog };
}

// Values for an environment with no saved settings at all (first run, including public self-hosting).
export function seedFresh(env = {}) { return seedFromLegacy(env, null); }

// What was in effect, as v2 settings. env: kept for callers and ignored. legacy: the latest saved earlier settings (or null).
export function seedFromLegacy(env = {}, legacy = null) {
  const slot = (key) => entry(legacy?.models?.[key] || OLD_POOL[key]?.[0], legacy?.efforts?.[key] ?? OLD_POOL[key]?.[1]);
  const jobs = {};
  // The chat job starts as the earlier General list (the other earlier category lists no longer exist).
  const chains = Object.fromEntries(Object.entries(legacy?.chains?.general || OLD_GENERAL_CHAIN).map(([lv, l]) => [lv, (l || []).filter((k) => own(OLD_POOL, k) || legacy?.models?.[k])]));
  const list = mergeLevels(chains, (k, lv) => configuredHosts({ catalog: legacy?.catalog || {} }, slot(k).model, lv).length > 0).map(slot).filter((e, i, a) => a.findIndex((x) => x.model === e.model) === i);
  const [first, ...rest] = list;
  jobs[CHAT_JOB] = { ...first, fallbacks: rest };
  const deciderSaved = legacy?.decider && legacy.decider !== "default" ? legacy.decider : null;
  jobs.decider = { model: deciderSaved || PPLX_DECIDER, effort: null, fallbacks: [] };
  for (const role of LEGACY_CHORES) jobs[role] = savedChore(legacy, role) || inEffectChore(role);
  Object.assign(jobs, otherJobs());
  jobs.browser_decider = optionalJobDefault("browser_decider", jobs).job;
  jobs.chat_title = optionalJobDefault("chat_title", jobs).job;
  // The chat list becomes the General category (its models are in the catalog because the list is a job while the catalog is made), then the job goes.
  return withRoutingConfig(finish(jobs, legacy?.catalog || {}), { zdrThirdModel: ROUTING_ZDR_THIRD_MODEL });
}
