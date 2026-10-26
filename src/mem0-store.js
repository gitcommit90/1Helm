// The storage under Mem0 (docs/configuration.md, "Memory"). Facts, their history and the keyword index live in D1 (tables mem, mem_history and mem_fts,
// db/migrations/0063_memory.sql). Vectors live in the Vectorize index bound as MEMORY_INDEX. A namespace is one channel's memory (nsOf), so channels never share rows.
// Vectorize cannot list or delete by filter, so every list, count and delete reads D1 first and then removes the vectors by id.
const VEC_IDS_MAX = 100;   // deleteByIds refuses more than 100 ids in one call (error 40007, seen on Live); the docs state no limit, so getByIds is held to the same size
const TOP_K_MAX = 100;   // Vectorize returns at most 100 results when it returns no values and no metadata (limits page, 2026-08)
export const EXTRACT_CHARS = 12000;   // the most characters one extraction call reads (the meter in byok.js prices it)
export const DIMS = 1024;   // the dimension of both Vectorize indexes, set when they are created (docs/configuration.md, "Memory")
const hex = async (s, n) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))))].slice(0, n / 2).map((x) => x.toString(16).padStart(2, "0")).join("");
const UUID = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/;
// A namespace is 16 hex characters of the tenant and 16 of the bank id (Vectorize allows 64 bytes, a bank id can be 200), so one prefix is every namespace of an account.
export const nsOf = async (bank) => `${await hex(UUID.exec(bank)?.[0] || bank, 16)}${await hex(bank, 16)}`;
export const nsPrefix = async (tenant) => hex(tenant, 16);
const KEYS = ["ts", "source"];   // the payload fields that get a Vectorize metadata index (wrangler vectorize create-metadata-index)
const SCOPE = new Set(["user_id", "agent_id", "run_id"]);   // the namespace is the scope, so these never filter
const OPS = { eq: "$eq", ne: "$ne", gt: "$gt", gte: "$gte", lt: "$lt", lte: "$lte", in: "$in", nin: "$nin" };
const conditions = (filters) => Object.entries(filters || {}).filter(([k]) => !SCOPE.has(k)).map(([k, v]) => {
  if (k === "$or" || k === "$not" || k === "AND" || k === "OR" || k === "NOT" || v === "*") throw new Error(`memory filter ${k} is not supported`);
  const ops = v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v) : Array.isArray(v) ? [["in", v]] : [["eq", v]];
  return ops.map(([op, x]) => { if (!OPS[op]) throw new Error(`memory filter operator ${op} is not supported`); return [k, op, x]; });
}).flat();
// Mem0 filters to Vectorize filters: { ts: { gte: 1, lt: 2 }, source: "bee" } -> { ts: { $gte: 1, $lt: 2 }, source: { $eq: "bee" } }. Only the indexed fields can filter.
export function vecFilter(filters) {
  const out = {};
  for (const [k, op, x] of conditions(filters)) { if (!KEYS.includes(k)) throw new Error(`memory filter on ${k} is not indexed`); (out[k] ||= {})[OPS[op]] = x; }
  return Object.keys(out).length ? out : undefined;
}
const SQL = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
// The same filters as SQL over the payload JSON: { sql: " AND json_extract(payload,'$.ts') >= ?", args: [1] }.
export function sqlFilter(filters, col = "payload") {
  let sql = "", args = [];
  for (const [k, op, x] of conditions(filters)) {
    if (!/^[A-Za-z_]+$/.test(k)) throw new Error(`memory filter key ${k} is not valid`);
    const f = `json_extract(${col},'$.${k}')`;
    if (op === "in" || op === "nin") { sql += ` AND ${f} ${op === "nin" ? "NOT " : ""}IN (${x.map(() => "?").join(",")})`; args.push(...x); } else { sql += ` AND ${f} ${SQL[op]} ?`; args.push(x); }
  }
  return { sql, args };
}
// Vectorize answers 429 (code 40041, Too Many Requests) when an index gets too many mutations: a write waits and tries again (0.4 s, 0.8, 1.6, 3.2) before it fails.
const vec = async (call) => { for (let i = 0; ; i++) try { return await call(); } catch (e) { if (i >= 4 || !/40041|Too Many Requests|\b429\b/i.test(String(e?.message || e))) throw e; await new Promise((z) => setTimeout(z, 400 * 2 ** i + Math.random() * 300)); } };
const KEYWORD_EXTRA = 10;   // the most keyword hits added to the candidates of one search
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };
const row = (r) => (r ? { id: r.id, payload: JSON.parse(r.payload), ...(r.score != null ? { score: r.score } : {}) } : null);
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

// Vectorize applies a write only after a delay (86 seconds for one vector, measured on dev on 2026-10-26), and a delete asked for before that lands can run first, so the
// vector appears afterwards with no D1 row behind it. Every deleted id is therefore remembered here, and deleted from Vectorize again by the 5 minute cron (goneVectorsDue)
// after 2, 10 and 30 minutes. The recheck cannot read D1 for these ids (their rows are gone), so it works from this table. Ids only, never text.
const GONE_RECHECK = [2 * 60e3, 10 * 60e3, 30 * 60e3];
const goneReady = new WeakSet();   // per D1 binding
async function ensureGone(env) {
  if (goneReady.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS mem_vec_gone (id TEXT PRIMARY KEY, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS mem_vec_gone_due ON mem_vec_gone(due)").run();
  goneReady.add(env.DB);
}
async function noteGone(env, ids) {
  if (!ids.length) return;
  await ensureGone(env); const due = Date.now() + GONE_RECHECK[0];
  for (const part of chunks(ids, 30)) await env.DB.prepare(`INSERT INTO mem_vec_gone (id,due,tries) VALUES ${part.map(() => "(?,?,0)").join(",")} ON CONFLICT(id) DO UPDATE SET due=excluded.due, tries=0`).bind(...part.flatMap((id) => [id, due])).run();
}
// Deletes again the vectors of the ids whose recheck is due, then schedules the next recheck or forgets the id. → the number of ids rechecked
export async function goneVectorsDue(env, { limit = 500 } = {}) {
  if (!env.MEMORY_INDEX || !env.DB) return 0;
  await ensureGone(env);
  const rows = (await env.DB.prepare("SELECT id, tries FROM mem_vec_gone WHERE due<=? ORDER BY due LIMIT ?").bind(Date.now(), limit).all()).results || [];
  for (const all of chunks(rows, VEC_IDS_MAX)) {
    // An id that has a row in D1 again (written again after its delete) is live: its vector stays and the id is forgotten. Mem0 makes every id with a random UUID, so this is a guard, not an expected case.
    const live = new Set(); for (const sub of chunks(all.map((r) => r.id), 90)) for (const x of (await env.DB.prepare(`SELECT id FROM mem WHERE id IN (${sub.map(() => "?").join(",")})`).bind(...sub).all()).results || []) live.add(x.id);
    for (const r of all) if (live.has(r.id)) await env.DB.prepare("DELETE FROM mem_vec_gone WHERE id=?").bind(r.id).run();
    const part = all.filter((r) => !live.has(r.id));
    if (!part.length) continue;
    await vec(() => env.MEMORY_INDEX.deleteByIds(part.map((r) => r.id)));
    for (const r of part) {
      const next = Number(r.tries) + 1;
      if (next >= GONE_RECHECK.length) await env.DB.prepare("DELETE FROM mem_vec_gone WHERE id=?").bind(r.id).run();
      else await env.DB.prepare("UPDATE mem_vec_gone SET tries=?, due=? WHERE id=?").bind(next, Date.now() + GONE_RECHECK[next], r.id).run();
    }
  }
  return rows.length;
}

// Every id of the namespaces that start with `prefix`, with their rows removed from D1 and their vectors from Vectorize. where: SQL after "WHERE ns LIKE ?" (default: all).
export async function removeRows(env, prefix, where = "", args = []) {
  const found = ((await env.DB.prepare(`SELECT id, ns FROM mem WHERE ns LIKE ?${where}`).bind(`${prefix}%`, ...args).all()).results || []), ids = found.map((r) => r.id), gone_vectors = [...ids];
  for (const part of chunks(ids, 90)) {   // 90 ids stay under the 100 bound values of one D1 statement
    const q = part.map(() => "?").join(",");
    await env.DB.batch([env.DB.prepare(`DELETE FROM mem WHERE id IN (${q}) AND ns LIKE ?`).bind(...part, `${prefix}%`), env.DB.prepare(`DELETE FROM mem_history WHERE memory_id IN (${q})`).bind(...part)]);
  }
  // A delete of some facts (a whole namespace or account goes with its entity rows by prefix) also takes their ids out of the entities that link to them, as Mem0's own delete does.
  // An entity left with no fact is deleted. Its text is unchanged, so its vector stays as it is.
  if (where) for (const ns of new Set(found.map((r) => r.ns).filter((n) => !n.endsWith("_entities")))) {
    const gone = new Set(found.filter((r) => r.ns === ns).map((r) => r.id)), dead = [];
    for (const e of (await env.DB.prepare("SELECT id, payload FROM mem WHERE ns=?").bind(`${ns}_entities`).all()).results || []) {
      const p = JSON.parse(e.payload), linked = (p.linkedMemoryIds || []).filter((id) => !gone.has(id));
      if (linked.length === (p.linkedMemoryIds || []).length) continue;
      if (linked.length) await env.DB.prepare("UPDATE mem SET payload=? WHERE ns=? AND id=?").bind(JSON.stringify({ ...p, linkedMemoryIds: linked }), `${ns}_entities`, e.id).run(); else dead.push(e.id);
    }
    for (const part of chunks(dead, 90)) { await env.DB.prepare(`DELETE FROM mem WHERE ns=? AND id IN (${part.map(() => "?").join(",")})`).bind(`${ns}_entities`, ...part).run(); gone_vectors.push(...part); }
  }
  for (const part of chunks(gone_vectors, VEC_IDS_MAX)) await vec(() => env.MEMORY_INDEX.deleteByIds(part));
  await noteGone(env, gone_vectors);
  return ids.length;
}

// The VectorStore that Mem0 calls (mem0-ts/src/oss/src/vector_stores/base.ts). `cats` carries the category of each extracted fact (see mem0.js).
export class MemStore {
  // pending: the fact store of an add keeps its inserts here and writes them all at once in flush(), so one add is one D1 batch and one upsert whatever the number of facts or chunks.
  constructor(env, ns, cats, pending = null) { this.env = env; this.ns = ns; this.cats = cats; this.pending = pending; }
  async initialize() {}
  async getUserId() { return "1hc"; }
  async setUserId() {}
  async insert(vectors, ids, payloads) {
    if (this.pending) this.pending.push({ vectors, ids, payloads }); else await this.write(vectors, ids, payloads);
  }
  async flush() { const all = this.pending?.splice(0) || []; if (all.length) await this.write(all.flatMap((x) => x.vectors), all.flatMap((x) => x.ids), all.flatMap((x) => x.payloads)); }
  async write(vectors, ids, payloads) {
    const { DB, MEMORY_INDEX } = this.env;
    payloads.forEach((p) => { if (!p.category && this.cats?.has(p.data)) p.category = this.cats.get(p.data); });
    await DB.batch(ids.map((id, i) => DB.prepare("INSERT INTO mem (ns,id,payload) VALUES (?,?,?)").bind(this.ns, id, JSON.stringify(payloads[i]))));
    const items = ids.map((id, i) => ({ id, namespace: this.ns, values: vectors[i], metadata: Object.fromEntries(KEYS.filter((k) => payloads[i][k] != null).map((k) => [k, payloads[i][k]])) }));
    for (const part of chunks(items, 1000)) await vec(() => MEMORY_INDEX.upsert(part));   // Vectorize takes at most 1,000 vectors in one upsert
  }
  async search(query, topK = 20, filters) {
    // Vectors that D1 no longer holds (a delete Vectorize has not applied yet) take places in the answer, so more matches are asked for than the page needs, and the page is cut after the filter.
    const r = await this.env.MEMORY_INDEX.query(query, { topK: Math.min(Math.max(topK * 3, topK + 30), TOP_K_MAX), namespace: this.ns, returnValues: false, returnMetadata: "none", ...(vecFilter(filters) ? { filter: vecFilter(filters) } : {}) });
    const ids = r.matches.map((m) => m.id), found = new Map();
    for (const part of chunks(ids, 90)) for (const x of (await this.env.DB.prepare(`SELECT id,payload FROM mem WHERE ns=? AND id IN (${part.map(() => "?").join(",")})`).bind(this.ns, ...part).all()).results || []) found.set(x.id, x);
    const out = r.matches.filter((m) => found.has(m.id)).slice(0, topK).map((m) => row({ ...found.get(m.id), score: m.score }));   // a vector that D1 no longer holds was deleted: Vectorize deletes lag
    this.last = { out, query, topK };
    return out;
  }
  // BM25 over the lemmatized text (Mem0 adds it to the semantic score). The score is positive, higher is better.
  async keywordSearch(query, topK = 20, filters) {
    const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].slice(0, 32);
    if (!words.length) return [];
    const f = sqlFilter(filters, "m.payload");
    const r = await this.env.DB.prepare(`SELECT m.id, m.payload, -bm25(mem_fts) AS score FROM mem_fts JOIN mem m ON m.rowid = mem_fts.rowid WHERE mem_fts MATCH ? AND m.ns = ?${f.sql} ORDER BY score DESC LIMIT ?`)
      .bind(`ns:"${this.ns}" AND t:(${words.map((w) => `"${w}"`).join(" OR ")})`, this.ns, ...f.args, topK).all();
    const hits = (r.results || []).map(row);
    await this.addCandidates(hits);
    return hits;
  }
  // Mem0 v3 scores only the results of the vector search as candidates, and the keyword score only re-ranks them, so a rare word (a name) in a long text is never found.
  // Mem0 calls search() and then keywordSearch() and builds its candidates from the array search() returned, so the best keyword hits that the vector search missed are
  // added to that array here, each with its real cosine to the query (read from its stored vector), and the lowest vector hits make room for them (the total stays at topK).
  async addCandidates(hits) {
    const { out, query, topK } = this.last || {}; if (!out) return;
    const have = new Set(out.map((x) => x.id)), extra = hits.filter((h) => !have.has(h.id)).slice(0, KEYWORD_EXTRA);
    if (!extra.length) return;
    const got = []; for (const part of chunks(extra.map((h) => h.id), VEC_IDS_MAX)) got.push(...((await this.env.MEMORY_INDEX.getByIds(part)) || []));
    const vectors = new Map(got.map((v) => [v.id, v.values])), add = extra.filter((h) => vectors.has(h.id)).map((h) => ({ id: h.id, payload: h.payload, score: cosine(query, vectors.get(h.id)) }));
    out.length = Math.min(out.length, Math.max(0, topK - add.length)); out.push(...add);
  }
  async get(id) { return row(await this.env.DB.prepare("SELECT id,payload FROM mem WHERE ns=? AND id=?").bind(this.ns, id).first()); }
  async update(id, vector, payload) {
    await this.env.DB.prepare("UPDATE mem SET payload=? WHERE ns=? AND id=?").bind(JSON.stringify(payload), this.ns, id).run();
    if (this.ns.endsWith("_entities")) return;   // an entity's text, and so its vector, never changes: only the facts it links do
    await vec(() => this.env.MEMORY_INDEX.upsert([{ id, namespace: this.ns, values: vector, metadata: Object.fromEntries(KEYS.filter((k) => payload[k] != null).map((k) => [k, payload[k]])) }]));
  }
  async delete(id) { await removeRows(this.env, this.ns, " AND id=?", [id]); }
  async deleteCol() { await removeRows(this.env, this.ns); }
  // The newest first, like Mem0's own stores.
  async list(filters, topK = 100, offset = 0) {
    const f = sqlFilter(filters);
    const r = await this.env.DB.prepare(`SELECT id,payload FROM mem WHERE ns=?${f.sql} ORDER BY json_extract(payload,'$.createdAt') DESC LIMIT ? OFFSET ?`).bind(this.ns, ...f.args, topK, offset).all();
    return [(r.results || []).map(row), (r.results || []).length];
  }
}

// The history Mem0 writes on every add (mem0-ts/src/oss/src/storage/base.ts). Mem0's optional saveMessages and getLastMessages are left out: the
// extraction then sees no earlier messages, and each item carries its own context line.
export class MemHistory {
  constructor(env, ns) { this.env = env; this.ns = ns; }
  async addHistory(memoryId, prev, next, action, createdAt, updatedAt, isDeleted = 0) {
    await this.env.DB.prepare("INSERT INTO mem_history (ns,memory_id,previous_value,new_value,action,created_at,updated_at,is_deleted) VALUES (?,?,?,?,?,?,?,?)").bind(this.ns, memoryId, prev, next, action, createdAt ?? null, updatedAt ?? null, isDeleted).run();
  }
  async getHistory(memoryId) { return (await this.env.DB.prepare("SELECT * FROM mem_history WHERE ns=? AND memory_id=? ORDER BY id").bind(this.ns, memoryId).all()).results || []; }
  async reset() { await this.env.DB.prepare("DELETE FROM mem_history WHERE ns=?").bind(this.ns).run(); }
  close() {}
}
