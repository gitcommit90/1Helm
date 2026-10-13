// Saved model settings for tests: the first-run data (src/model-seed.js), checked by the real validator. Tests that call code which
// reads the settings give it an env made by withSettings(); nothing in src/ has a built-in model to fall back on.
import { seedFresh, seedFromLegacy } from "../../src/ee/model-seed.js";
import { validateModelSettings } from "../../src/ee/model-settings.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
export const seedSettings = (env = {}, legacy = null) => validateModelSettings(legacy ? seedFromLegacy(env, legacy) : seedFresh(env));
export const SEED = seedSettings();
export const withSettings = (env = {}, settings = SEED) => ({ ...env, MODEL_SETTINGS: clone(settings), MODEL_SETTINGS_REVISION: 1 });
// The models the first-run data uses, by the names tests use (the ids appear only here and in src/model-seed.js).
export const ID = { MUSE_C: "meta/muse-spark-1.3-contributor", MUSE_S: "meta/muse-spark-1.3", DEEPSEEK: "deepseek/deepseek-v4.1-flash", LUNA: "openai/gpt-6-luna", SOL: "openai/gpt-6.1-sol", HAIKU: "anthropic/claude-haiku-5.5",
  OSS120: "openai/gpt-oss-120b", OSS20: "openai/gpt-oss-20b", QWEN: "qwen/qwen3.8-27b", GLM: "z-ai/glm-5.3-flash", PPLX: "perplexity/pplx-decider-v1.1-27b", JEV: "~typesafe/jev-latest",
  STT: "qwen/qwen3-asr-0.6b", STT_FALLBACK: "openai/whisper-large-v3-turbo", STT_WAI: "@cf/openai/whisper-large-v3-turbo", LIVE: "@cf/deepgram/nova-3", EMBED_FILES: "perplexity/pplx-embed-v1-0.6b", EMBED_MEMORY: "@cf/baai/bge-m3", VISION: "@cf/google/gemma-4-26b-a4b-it", WAI_CHAT: "@cf/zai-org/glm-5.3-flash" };
