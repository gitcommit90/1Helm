// The first-run data for the model settings, and the one-time migration from the earlier format.
//
// This is the ONLY place (besides the endpoint privacy facts in privacy.js and tests) that names models. Nothing at runtime reads it:
// model-settings.js copies these values into the saved settings the first time an environment has none, and from then on every job
// reads only its own saved setting (model-jobs.js). Edit models on the Models page, never here.
//
// Two ways the first copy is made:
//   seedFresh(env)          a brand-new environment (public self-hosting): the values below, nothing else.
//   seedFromLegacy(env, c)  an environment that already ran the earlier slot-based settings: exactly what was in effect there,
//                           including a saved earlier settings row (c) and the environment variables that used to choose models
//                           (CHORE_MODEL_*, DECIDER_MODEL, STT_MODEL, SIDECAR_*_MODEL, MODEL). Those variables are read here, once, and nowhere else.
import { CATEGORIES } from "./pool.js";
import { JOBS, JOB_KINDS, configuredHosts } from "./model-jobs.js";

const MUSE_C = "meta/muse-spark-1.3-contributor", MUSE_S = "meta/muse-spark-1.3", DEEPSEEK = "deepseek/deepseek-v4.1-flash";
const LUNA = "openai/gpt-6-luna", HAIKU = "anthropic/claude-haiku-5.5";
const OSS120 = "openai/gpt-oss-120b", GLM = "z-ai/glm-5.3-flash";
const PPLX_DECIDER = "perplexity/pplx-decider-v1.1-27b", JEV_ROUTER = "typesafe/jev-router";
// Speech to text, in order (the Captain, 2026-10-15, "it is an accuracy choice"): AssemblyAI Universal-3.6 Pro first, then the earlier order.
const STT_BEST = "assemblyai/universal-3-6-pro", STT = "qwen/qwen3-asr-0.6b", STT_FALLBACK = "openai/whisper-large-v3-turbo", STT_WAI = "@cf/openai/whisper-large-v3-turbo", LIVE_STT = "@cf/deepgram/nova-3";
const CLEF = "@cf/cloudflare/clef", CLEF_FLASH = "@cf/cloudflare/clef-flash";
const EMBED_FILES = "perplexity/pplx-embed-v1-0.6b", EMBED_MEMORY = "@cf/baai/bge-m3", VISION = "@cf/google/gemma-4-26b-a4b-it", WAI_CHAT = "@cf/zai-org/glm-5.3-flash";
// The browser look's model (sidecar.js lookModel; SIDECAR_LOOK_MODEL overrides). Not a saved job: Moondream 3.1 on Workers AI.
export const MOONDREAM = "@cf/moondream/moondream3.1-9B-A2B";

// Exact source migration selected for dev. Copied into saved settings once.
export const SHARED_OR_MOVES = [
  { job: "vision_files", from: "@cf/google/gemma-4-26b-a4b-it", to: "google/gemma-4-26b-a4b-it" },
  { job: "embed_memory", from: EMBED_MEMORY, to: "baai/bge-m3", facts: { embedding_equivalents: [EMBED_MEMORY, "baai/bge-m3"], embedding_dimensions: 1024 } },
];

const LEVELS = ["unrestricted", "no_training", "zdr"];
// OpenRouter /api/v1/models reasoning levels, checked 2026-10-10. "none" is offered only when reasoning is optional.
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
  [JEV_ROUTER]: { name: "TypeSafe Jev Router", kinds: ["classic"], efforts: [] },
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
  [EMBED_FILES]: { name: "Perplexity Embed 0.6B", kinds: ["embedding_files"], efforts: [] },
  [EMBED_MEMORY]: { name: "BGE M3 (Cloudflare)", kinds: ["embedding_memory"], efforts: [] },
  [VISION]: { name: "Gemma 4 26B (Cloudflare)", kinds: ["vision"], efforts: [] },
  [WAI_CHAT]: { name: "GLM 5.3 Flash (Cloudflare)", kinds: ["workers_ai"], efforts: [] },
};

// ---- the earlier built-in defaults, used only to reproduce what was in effect ----
const OLD_POOL = { "muse-c": [MUSE_C, "xhigh"], "muse-s": [MUSE_S, "xhigh"], deepseek: [DEEPSEEK, "max"], luna: [LUNA, "xhigh"], haiku: [HAIKU, "xhigh"] };
const C = "muse-c", S = "muse-s", D = "deepseek", L = "luna", H = "haiku";
// Sol left the first-run data (Captain, 2026-10-15), so Haiku takes its place in each list, once per list.
const OLD_CHAINS = {
  general: { unrestricted: [C, D, L], no_training: [D, S, L], zdr: [D, L, H] },
  research: { unrestricted: [C, D, H], no_training: [S, D, H], zdr: [D, H] },
  apps_economical: { unrestricted: [C, D, H], no_training: [D, S, H], zdr: [D, H] },
  skills: { unrestricted: [C, D, H], no_training: [D, H, S], zdr: [D, H] },
  spreadsheet: { unrestricted: [L, H, C], no_training: [L, H, S], zdr: [L, H] },
  technical: { unrestricted: [H, D], no_training: [H, D], zdr: [H, D] },
  apps_complete: { unrestricted: [H, D], no_training: [H, D], zdr: [H, D] },
};
const OLD_RECOVERY = { apps_economical: H, apps_complete: H, technical: H, spreadsheet: H };
const OLD_IN_TURN = H;
// The earlier chore model keys: model, hosts in order, whether the hosts were pinned, the model's own reasoning default.
const OLD_CHORE = { oss120: { model: OSS120, hosts: ["cerebras"] },
  dsflash: { model: DEEPSEEK, hosts: ["together", "modal", "coreweave"], pin: true, effort: "none" },
  haiku: { model: HAIKU, hosts: ["amazon-bedrock", "google-vertex"], pin: true, effort: "none" },
  luna: { model: LUNA, hosts: ["azure", "azure/us", "azure/eu"], pin: true } };
const bg = (model, hosts, effort = "low") => ({ model, hosts, effort, pin: true });
const OLD_POLICY = { label: bg(HAIKU, ["google-vertex", "amazon-bedrock"]), notes: bg(LUNA, ["azure", "azure/us", "azure/eu"]),
  notes_refine: bg(DEEPSEEK, ["together", "modal", "coreweave"]), notes_final: bg(HAIKU, ["google-vertex", "amazon-bedrock"]), sidecar_card: bg(HAIKU, ["google-vertex", "amazon-bedrock"]),
  ambient_extract: bg(LUNA, ["azure", "azure/us", "azure/eu"]), ambient_review: bg(DEEPSEEK, ["together", "modal", "coreweave"]) };

const clone = (x) => JSON.parse(JSON.stringify(x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const entry = (model, effort, extra = {}) => ({ model, effort, ...extra });

// One chore route the way the earlier code built it from a chore key.
function choreKeyEntry(key, effortOverride, fallbackEffort) {
  const m = OLD_CHORE[key] || OLD_CHORE.oss120;
  return entry(m.model, effortOverride || m.effort || fallbackEffort, { hosts: [...m.hosts], pin: !!m.pin });
}
// Captain's rule: every background job has at least one fallback. A DeepSeek Flash or Luna job falls back to Haiku or DeepSeek Flash,
// and a Haiku job falls back to DeepSeek Flash, on the same providers the earlier chore keys used. Browser summaries seed on gpt-oss-120b and fall back to DeepSeek Flash. Any other main model gets none here.
const RULE_FALLBACK = { [DEEPSEEK]: [HAIKU, "haiku", ["google-vertex", "amazon-bedrock"]], [HAIKU]: [DEEPSEEK, "dsflash"], [LUNA]: [DEEPSEEK, "dsflash"], [OSS120]: [DEEPSEEK, "dsflash"] };
const ruleFallbacks = (model, effort = "low") => {
  const r = RULE_FALLBACK[model]; if (!r) return [];
  const m = OLD_CHORE[r[1]], e = (SEED_FACTS[m.model].efforts || []).includes(effort) ? effort : "low";
  return [entry(m.model, e, { hosts: [...(r[2] || m.hosts)], pin: true })];
};
function choreKeyOf(env, chore, dflt) {
  const own = env?.[`CHORE_MODEL_${String(chore).toUpperCase()}`];
  const v = String(own || dflt || env?.CHORE_MODEL || "oss120").trim().toLowerCase();
  return OLD_CHORE[v] ? v : dflt || "oss120";
}
// The earlier jobs that came from environment variables or code, in effect with no saved override.
function inEffectChore(env, role, legacy) {
  if (own(OLD_POLICY, role)) { const p = OLD_POLICY[role]; return { ...entry(p.model, p.effort, { hosts: [...p.hosts], pin: true }), fallbacks: ruleFallbacks(p.model, p.effort) }; }
  if (role === "handoff") {
    // Captain's change: task handoffs default to DeepSeek Flash at low reasoning (an explicit CHORE_MODEL_HANDOFF still wins).
    if (!env?.CHORE_MODEL_HANDOFF && !env?.CHORE_MODEL) { const first = choreKeyEntry("dsflash", "low"); return { ...first, fallbacks: ruleFallbacks(first.model, "low") }; }
    const k = choreKeyOf(env, "handoff", null);
    if (k === "oss120") return { ...entry(OSS120, "default", { hosts: ["cerebras"], pin: false }), fallbacks: [] };
    return { ...choreKeyEntry(k, null, "default"), fallbacks: [entry(OSS120, "default", { hosts: ["cerebras"], pin: false })] };
  }
  if (role === "browser") {
    const k = choreKeyOf(env, "browser", null);
    const first = choreKeyEntry(k, null, "low");
    return k === "oss120" ? { ...entry(OSS120, "low", { hosts: ["cerebras"], pin: true }), fallbacks: ruleFallbacks(OSS120, "low") }
      : { ...first, fallbacks: [entry(OSS120, "low", { hosts: ["cerebras"], pin: true })] };
  }
  return null;
}
// A saved earlier chore selection replaces the built-in one for its role.
function savedChore(legacy, role) {
  const c = legacy?.chores?.[role]; if (!c || c.model === "default") return null;
  const meta = legacy?.catalog?.[c.model], fallbackEffort = "low";
  const known = OLD_CHORE[c.model];
  const model = known ? known.model : c.model, hosts = known ? [...known.hosts] : meta?.hosts ? [...meta.hosts] : undefined;
  const isPolicy = own(OLD_POLICY, role) || c.model === "oss120";
  return { ...entry(model, c.effort, { ...(hosts ? { hosts } : {}), pin: true, strict: true }), fallbacks: isPolicy ? (c.model === "oss120" ? [] : ruleFallbacks(model, c.effort)) : [entry(OSS120, fallbackEffort, { hosts: ["cerebras"], pin: true, strict: true })] };
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
function otherJobs(env) {
  const sttList = [...new Set([String(env?.STT_MODEL || STT_BEST).trim() || STT_BEST, STT, STT_FALLBACK])];
  return {
    stt: { model: sttList[0], effort: null, fallbacks: sttList.slice(1).map((m) => entry(m, null)) },
    stt_cloudflare: { model: STT_WAI, effort: null, fallbacks: [] },
    live_dictation: { model: STT_BEST, effort: null, fallbacks: [entry(LIVE_STT, null)] },
    embed_files: { model: String(env?.SIDECAR_EMBED_MODEL || "").trim() || EMBED_FILES, effort: null, fallbacks: [] },
    embed_memory: { model: EMBED_MEMORY, effort: null, fallbacks: [] },
    vision_files: { model: String(env?.SIDECAR_VISION_MODEL || "").trim() || VISION, effort: null, fallbacks: [] },
    workers_ai_chat: { model: String(env?.MODEL || "").trim() || WAI_CHAT, effort: null, fallbacks: [] },
    doors_shadow: { model: CLEF_FLASH, effort: null, fallbacks: [] },
    classic_decider: { model: `@cf/cloudflare/${String(env?.OWN_ROUTER_CLEF || "").trim() || "clef"}`, effort: null, fallbacks: [] },
    classic_router: { model: JEV_ROUTER, effort: null, fallbacks: [entry(DEEPSEEK, null), entry(GLM, null)] },
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

// What was in effect, as v2 settings. env: the Worker's variables. legacy: the latest saved earlier settings (or null).
export function seedFromLegacy(env = {}, legacy = null) {
  const slot = (key) => entry(legacy?.models?.[key] || OLD_POOL[key]?.[0], legacy?.efforts?.[key] ?? OLD_POOL[key]?.[1]);
  const jobs = {};
  for (const cat of CATEGORIES) {
    const chains0 = legacy?.chains?.[cat] || OLD_CHAINS[cat], chains = Object.fromEntries(Object.entries(chains0).map(([lv, l]) => [lv, (l || []).filter((k) => own(OLD_POOL, k) || legacy?.models?.[k])])), list = mergeLevels(chains, (k, lv) => configuredHosts({ catalog: legacy?.catalog || {} }, slot(k).model, lv).length > 0).map(slot).filter((e, i, a) => a.findIndex((x) => x.model === e.model) === i);
    const [first, ...rest] = list;
    jobs[`chat.${cat}`] = { ...first, fallbacks: rest };
  }
  for (const [cat, key] of Object.entries(OLD_RECOVERY)) jobs[`recover.${cat}`] = { ...slot(key), fallbacks: [] };
  jobs.escalate = { ...slot(OLD_IN_TURN), fallbacks: [] };
  const deciderSaved = legacy?.decider && legacy.decider !== "default" ? legacy.decider : null;
  jobs.decider = { model: deciderSaved || String(env?.DECIDER_MODEL || "").trim() || PPLX_DECIDER, effort: null, fallbacks: [] };
  for (const role of LEGACY_CHORES) jobs[role] = savedChore(legacy, role) || inEffectChore(env, role, legacy);
  Object.assign(jobs, otherJobs(env));
  return finish(jobs, legacy?.catalog || {});
}
