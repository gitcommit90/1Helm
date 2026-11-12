// Fakes for the Mem0 memory (src/mem0.js): D1 on node:sqlite with the real migration, a Vectorize index in memory, and a Workers AI embedding that counts words.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { withSettings } from "./seed-settings.mjs";
process.env.MEM0_TELEMETRY = "false";   // the Worker sets it with the wrangler var of the same name
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../db/migrations/0063_memory.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }), first: async () => { const r = db.prepare(sql).all(...args)[0]; return r ? { ...r } : null; }, run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; } });
  return { db, prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };
const matches = (m, f = {}) => Object.entries(f).every(([k, c]) => Object.entries(typeof c === "object" ? c : { $eq: c }).every(([op, v]) => { const x = m?.[k]; return op === "$eq" ? x === v : op === "$gte" ? x >= v : op === "$lt" ? x < v : op === "$lte" ? x <= v : op === "$gt" ? x > v : false; }));
export function fakeIndex() {
  const rows = new Map(), calls = [];
  return { rows, calls,
    upsert: async (list) => { for (const v of list) rows.set(v.id, v); },
    deleteByIds: async (ids) => { for (const id of ids) rows.delete(id); },
    getByIds: async (ids) => ids.filter((id) => rows.has(id)).map((id) => ({ id, values: rows.get(id).values })),
    query: async (vec, o) => { calls.push(o); if (o.topK > 100) throw new Error("topK too large"); return { matches: [...rows.values()].filter((v) => v.namespace === o.namespace && matches(v.metadata, o.filter)).map((v) => ({ id: v.id, score: cos(vec, v.values) })).sort((a, b) => b.score - a.score).slice(0, o.topK) }; } };
}
export const embedding = (text) => { const v = new Array(1024).fill(0); for (const w of String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) { let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) % 1024; v[h] += 1; } return v; };
// The reranker fake: the score of a fact is the number of words it shares with the question.
export const overlap = (q, t) => { const w = new Set(String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu)); return (String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((x) => w.has(x)).length; };
// An env with the saved model settings, the D1 fake, the index fake and an AI binding that embeds. Extraction goes through fetch (see fakeExtraction).
export function memEnv(extra = {}) {
  const index = fakeIndex(), d1 = fakeD1();
  const env = withSettings({ ENV_NAME: "dev", OPENROUTER_API_KEY: "k", PROMPT_CACHE: "off", CF_ACCOUNT_ID: "a", AIG_ID: "g", AIG_TOKEN: "t", DB: d1, MEMORY_INDEX: index, AI: { run: async (m, input) => input.contexts ? { response: input.contexts.map((c, id) => ({ id, score: overlap(input.query, c.text) })) } : { data: input.text.map(embedding), usage: {} } }, ...extra });
  return { env, index, d1 };
}
// Replaces fetch: every extraction call answers with `facts(prompt)` as the model's JSON. Returns { calls, done }.
export function fakeExtraction(facts) {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { const body = JSON.parse(init.body); calls.push(body); const prompt = body.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join(""))).join("\n");
    return new Response(JSON.stringify({ model: "served/m", provider: "P", choices: [{ message: { role: "assistant", content: JSON.stringify({ memory: facts(prompt).map((f, i) => ({ id: String(i), attributed_to: "user", ...f })) }) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } }); };
  return { calls, done: () => { globalThis.fetch = real; } };
}
