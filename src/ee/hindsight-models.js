// The models the Hindsight memory server uses. They are set in the server's own compose file (on the
// Hindsight host, documented with the server), not in the saved model settings, and Hindsight 1.0.0 has no call that returns
// them (GET /version lists features only, and a bank's GET /config has no model fields). The Models page therefore shows this constant, read only,
// and scripts/check-hindsight-models.mjs compares it with the real container environment so a change on the host cannot go unnoticed.
// When the host changes, change this file in the same release.
export const HINDSIGHT_SET_IN = "the Hindsight host's compose file";
// env: the variable that holds the value on the host, checked by the script.
export const HINDSIGHT_MODELS = [
  { id: "retain", label: "Retain (fact extraction)", model: "openai/gpt-6-luna", effort: "low", env: { model: "HINDSIGHT_API_RETAIN_LLM_MODEL", effort: "HINDSIGHT_API_RETAIN_LLM_REASONING_EFFORT" } },
  { id: "consolidation", label: "Consolidation (observations)", model: "deepseek/deepseek-v4.1-flash", effort: "none", env: { model: "HINDSIGHT_API_CONSOLIDATION_LLM_MODEL", effort: "HINDSIGHT_API_CONSOLIDATION_LLM_REASONING_EFFORT" } },
  { id: "reflect", label: "Reflect", model: "deepseek/deepseek-v4.1-flash", effort: "low", env: { model: "HINDSIGHT_API_REFLECT_LLM_MODEL", effort: "HINDSIGHT_API_REFLECT_LLM_REASONING_EFFORT" } },
  { id: "refresh", label: "Mental model and knowledge page refresh", model: "deepseek/deepseek-v4.1-flash", effort: "low", env: { model: "HINDSIGHT_API_MENTAL_MODEL_REFRESH_LLM_MODEL", effort: "HINDSIGHT_API_MENTAL_MODEL_REFRESH_LLM_REASONING_EFFORT" } },
  { id: "reranker", label: "Reranker", model: "perplexity/pplx-decider-v1.1-27b", effort: null, note: "TypeSafe provider on OpenRouter, with rrf order as the fallback", env: { model: "HINDSIGHT_API_RERANKER_TYPESAFE_MODEL" } },
  { id: "embeddings", label: "Embeddings", model: "BAAI/bge-small-en-v1.5", effort: null, note: "runs inside the server (384 dimensions)", env: { model: "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL" } },
];
// The variables the script reads: names only from the list above, never a key, token, secret, password or URL.
export const HINDSIGHT_ENV_NAMES = HINDSIGHT_MODELS.flatMap((m) => Object.values(m.env));
// text: lines of NAME=value from the container (only the names above). Returns the differences, empty when the constant is right.
export function compareHindsightEnv(text) {
  const got = new Map(String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)]; }));
  const out = [];
  for (const m of HINDSIGHT_MODELS) for (const [field, name] of Object.entries(m.env)) {
    const want = m[field], have = got.get(name);
    if (have !== want) out.push({ job: m.id, variable: name, expected: want, actual: have ?? null });
  }
  return out;
}
