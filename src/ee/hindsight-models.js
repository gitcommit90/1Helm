// What the Hindsight memory server does that is NOT a model job on the Models page.
//
// On the Cloud service the server's language model calls (retain, consolidation, reflect, mental model refresh) and its recall reranker come through the Worker
// (src/ee/hindsight-llm.js), so they are the saved jobs hs_retain, hs_consolidation, hs_reflect, hs_refresh and hs_rerank, set like every other job. The server's embeddings
// run inside the server on its own CPU (no model call), so the Models page lists them read only. A self-hosted install that does not turn on the Cloud switch keeps the
// models in its own Hindsight server settings, and nothing in this Worker changes them.
export const HINDSIGHT_SET_IN = "the Hindsight host's compose file";
// env: the variable that holds the value on the host.
export const HINDSIGHT_LOCAL = [
  { id: "embeddings", label: "Embeddings", model: "BAAI/bge-small-en-v1.5", effort: null, note: "runs inside the server (384 dimensions), no model call", env: { model: "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL" } },
];
// The bank id goes to the Worker as the OpenAI `user` field and the reranker header, and the Worker removes it before any provider sees it.
export const HINDSIGHT_SWITCHES = { HINDSIGHT_API_LLM_SEND_BANK_AS_USER: "true", HINDSIGHT_API_RERANKER_SEND_BANK_AS_HEADER: "true" };

// The variables that may be read as plain values: only the embeddings model and the two switches, never a key, token, secret, password or URL.
export const HINDSIGHT_ENV_NAMES = [...HINDSIGHT_LOCAL.flatMap((m) => Object.values(m.env)), ...Object.keys(HINDSIGHT_SWITCHES)];
// text: lines of NAME=value from the container (only the names above). Returns the differences, empty when the host is right.
export function compareHindsightEnv(text) {
  const got = new Map(String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)]; }));
  const out = [];
  for (const m of HINDSIGHT_LOCAL) for (const [field, name] of Object.entries(m.env)) {
    const want = m[field], have = got.get(name);
    if (have !== want) out.push({ job: m.id, variable: name, expected: want, actual: have ?? null });
  }
  for (const [name, want] of Object.entries(HINDSIGHT_SWITCHES)) { const have = got.get(name); if (have !== want) out.push({ job: "wiring", variable: name, expected: want, actual: have ?? null }); }
  return out;
}
