// Saved model settings for tests: the first-run data (src/model-seed.js), checked by the real validator. Tests that call code which
// reads the settings give it an env made by withSettings(); nothing in src/ has a built-in model to fall back on.
import { seedFresh, seedFromLegacy } from "../../src/ee/model-seed.js";
import { validateModelSettings } from "../../src/ee/model-settings.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
// Models that are no longer in the first-run data (the catalog keeps only models a job uses) but that many tests use as extra choices.
// Tests add their facts here, to the seeded settings, after the seed is made. A test of the first-run data itself calls seedFresh directly.
export const EXTRA_FACTS = {
  "openai/gpt-6.1-sol": { name: "Sol", kinds: ["chat", "chore"], efforts: ["default", "low", "medium", "high", "xhigh", "max"] },
  "openai/gpt-oss-20b": { name: "GPT OSS 20B", kinds: ["chore"], efforts: ["default", "low", "medium", "high"], quirks: { reasoning_mandatory: true, no_json: true } },
  "qwen/qwen3.8-27b": { name: "Qwen 3.8 27B", kinds: ["chore"], efforts: ["xhigh", "medium", "low", "none"] },
  "~typesafe/jev-latest": { name: "TypeSafe Jev", kinds: ["decider"], efforts: [] },
};
export const withExtraModels = (config) => { const c = clone(config); for (const [id, f] of Object.entries(EXTRA_FACTS)) if (!c.catalog[id]) c.catalog[id] = { id, ...clone(f) }; return c; };
export const seedSettings = (env = {}, legacy = null) => validateModelSettings(withExtraModels(legacy ? seedFromLegacy(env, legacy) : seedFresh(env)));
export const SEED = seedSettings();
// The first-run data with some saved jobs replaced (no environment variable chooses a model any more): seedWith({ browser: { model, effort, fallbacks } }).
export const seedWith = (jobs = {}) => { const c = clone(SEED); for (const [id, over] of Object.entries(jobs)) c.jobs[id] = { ...c.jobs[id], ...over }; return validateModelSettings(withExtraModels(c)); };
export const withSettings = (env = {}, settings = SEED) => ({ ...env, MODEL_SETTINGS: clone(settings), MODEL_SETTINGS_REVISION: 1 });
// The models the first-run data uses, by the names tests use (the ids appear only here and in src/model-seed.js).
export const ID = { MUSE_C: "meta/muse-spark-1.3-contributor", MUSE_S: "meta/muse-spark-1.3", DEEPSEEK: "deepseek/deepseek-v4.1-flash", LUNA: "openai/gpt-6-luna", SOL: "openai/gpt-6.1-sol", HAIKU: "anthropic/claude-haiku-5.5",
  OSS120: "openai/gpt-oss-120b", OSS20: "openai/gpt-oss-20b", QWEN: "qwen/qwen3.8-27b", GLM: "z-ai/glm-5.3-flash", PPLX: "perplexity/pplx-decider-v1.1-27b", JEV: "~typesafe/jev-latest",
  STT_BEST: "assemblyai/universal-3-6-pro", STT: "qwen/qwen3-asr-0.6b", STT_FALLBACK: "openai/whisper-large-v3-turbo", STT_WAI: "@cf/openai/whisper-large-v3-turbo", LIVE: "@cf/deepgram/nova-3", EMBED_FILES: "perplexity/pplx-embed-v1-0.6b", EMBED_MEMORY: "@cf/baai/bge-m3", VISION: "@cf/google/gemma-4-26b-a4b-it", WAI_CHAT: "@cf/zai-org/glm-5.3-flash" };
