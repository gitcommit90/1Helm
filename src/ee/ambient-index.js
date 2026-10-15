// Search index for ambient items and transcript passages, kept inside the person's BeeSync Durable Object.
// Everything is per person by construction (one object per person), so deleting rows deletes the index.
//   ambient_passages   windows of adjacent same-speaker lines, their normalized text and an int8 vector
//   ambient_item_vec   an int8 vector for each item's clean text and evidence
//   ambient_vocab      every word seen, used to expand a query to stems, typos and split words
//   ambient_qvec       the last few query vectors, so paging through results never embeds again
// Embedding goes through Workers AI (the memory embedding model) and is charged through the existing Ledger
// reserve/settle path. Without the AI binding the index still builds passages and tolerant keyword search works.
import { jobModel } from "./model-settings.js";
import { aiOpts } from "../model.js";
import { normText, passageWindows, quantize, unitVector, cosineQ, fuse, termVariants, groupHit, idfOf, SEMANTIC_MIN } from "./ambient-search.js";

const now = () => Date.now();
export const EMBED_NANO = 12, EMBED_MARKUP = 1.15;   // Workers AI bge-m3: $0.012 per million input tokens, in nano dollars per token
const BATCH = 32, CALLS_PER_RUN = 4, MAX_TRIES = 3, BUILD_PER_RUN = 25, RANK_CAP = 200, SCAN_CAP = 80000, CANDIDATE_CAP = 3000;
const parse = (s, fallback = null) => { try { return JSON.parse(s); } catch { return fallback; } };
const sha = async (x) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)))].map((b) => b.toString(16).padStart(2, "0")).join("");

export class AmbientIndex {
  constructor(store) {
    this.s = store; this.vocabSet = null;
    // Workers hand blobs over as ArrayBuffer; node:sqlite (tests) needs a typed array.
    this.asView = typeof globalThis.WebSocketPair === "undefined";
    this.init();
  }
  get sql() { return this.s.sql; }
  rows(q, ...a) { return this.s.rows(q, ...a); }
  blob(i8) { return this.asView ? new Uint8Array(i8.buffer, i8.byteOffset, i8.byteLength) : i8.buffer.slice(i8.byteOffset, i8.byteOffset + i8.byteLength); }
  init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ambient_passages (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, chunk_hash TEXT NOT NULL, ord INTEGER NOT NULL, at INTEGER, until INTEGER, speaker TEXT, is_user INTEGER NOT NULL DEFAULT 0, line_from INTEGER, line_to INTEGER, utterance_ids TEXT, text TEXT NOT NULL, ntext TEXT NOT NULL, vec BLOB, scale REAL, model TEXT, tries INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ambient_passage_source ON ambient_passages(source,source_id);
      CREATE INDEX IF NOT EXISTS ambient_passage_at ON ambient_passages(at);
      CREATE TABLE IF NOT EXISTS ambient_item_vec (id TEXT PRIMARY KEY, text_hash TEXT NOT NULL, vec BLOB, scale REAL, model TEXT, tries INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ambient_vocab (term TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS ambient_qvec (h TEXT PRIMARY KEY, vec BLOB NOT NULL, scale REAL NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL);`);
    if (!this.rows("PRAGMA table_info(ambient_chunks)").some((c) => c.name === "passages_built")) this.sql.exec("ALTER TABLE ambient_chunks ADD COLUMN passages_built INTEGER NOT NULL DEFAULT 0");
  }
  available() { return !!this.s.host.env.AI?.run; }
  // ---- deletion: nothing outlives its source ----
  purge(source = null, id = null) {
    const scope = source == null ? "" : " AND source=? AND source_id=?", a = source == null ? [] : [source, String(id)];
    this.sql.exec(`DELETE FROM ambient_passages WHERE 1=1${scope} AND NOT EXISTS(SELECT 1 FROM ambient_chunks c WHERE c.source=ambient_passages.source AND c.source_id=ambient_passages.source_id AND c.hash=ambient_passages.chunk_hash AND c.active=1)`, ...a);
    this.sql.exec("DELETE FROM ambient_item_vec WHERE id NOT IN (SELECT id FROM ambient_items)");
    this.s.host.put("ambient_vocab_dirty", "1"); this.vocabSet = null; this.s.host.put("ambient_index_stats", null);
  }
  clear() { for (const t of ["ambient_passages", "ambient_item_vec", "ambient_vocab", "ambient_qvec"]) this.sql.exec(`DELETE FROM ${t}`); this.sql.exec("UPDATE ambient_chunks SET passages_built=0"); this.vocabSet = null; this.s.host.put("ambient_vocab_dirty", null); this.s.host.put("ambient_index_stats", null); }
  // ---- vocabulary ----
  vocab() {
    if (this.vocabSet && this.s.host.get("ambient_vocab_dirty") !== "1") return this.vocabSet;
    if (this.s.host.get("ambient_vocab_dirty") === "1") {
      // Words of deleted speech must not linger: rebuild from what remains. Streamed row by row, never all rows in memory
      // (a year of heavy use is hundreds of MB of passage text; the object has 128 MB).
      this.sql.exec("DELETE FROM ambient_vocab");
      const set = new Set();
      for (const r of this.iter("SELECT ntext FROM ambient_passages")) for (const w of r.ntext.split(" ")) if (w) set.add(w);
      for (const r of this.iter("SELECT json_extract(data,'$.search_text') t,json_extract(data,'$.text') x FROM ambient_items")) for (const w of normText(`${r.t || ""} ${r.x || ""}`).split(" ")) if (w) set.add(w);
      this.s.transaction(() => { for (const w of set) this.sql.exec("INSERT OR IGNORE INTO ambient_vocab VALUES(?)", w); });
      this.s.host.put("ambient_vocab_dirty", null); this.vocabSet = set; return set;
    }
    const set = new Set(); for (const r of this.iter("SELECT term FROM ambient_vocab")) set.add(r.term); this.vocabSet = set; return set;
  }
  addVocab(ntext) { const set = this.vocabSet; for (const w of ntext.split(" ")) { if (!w) continue; if (set && set.has(w)) continue; this.sql.exec("INSERT OR IGNORE INTO ambient_vocab VALUES(?)", w); set?.add(w); } }
  // ---- building passages from stored chunks (also the backfill of existing history) ----
  build(limit = BUILD_PER_RUN) {
    const chunks = this.rows("SELECT c.source,c.source_id,c.hash,c.lines FROM ambient_chunks c WHERE c.active=1 AND c.passages_built=0 ORDER BY COALESCE((SELECT source_at FROM ambient_sources s WHERE s.source=c.source AND s.source_id=c.source_id),0) DESC,c.ordinal LIMIT ?", limit);
    for (const c of chunks) this.s.transaction(() => {
      windowsOf(parse(c.lines, [])).forEach((w, ord) => {
        const ntext = normText(w.text);
        this.sql.exec("INSERT OR IGNORE INTO ambient_passages(id,source,source_id,chunk_hash,ord,at,until,speaker,is_user,line_from,line_to,utterance_ids,text,ntext) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", `${c.source}:${c.source_id}:${c.hash}:${ord}`, c.source, c.source_id, c.hash, ord, w.at, w.until, w.speaker, w.is_user ? 1 : 0, w.line_from, w.line_to, JSON.stringify(w.utterance_ids), w.text, ntext);
        this.addVocab(ntext);
      });
      this.sql.exec("UPDATE ambient_chunks SET passages_built=1 WHERE source=? AND source_id=? AND hash=?", c.source, c.source_id, c.hash);
    });
    if (chunks.length) this.s.host.put("ambient_index_stats", null);
    return chunks.length;
  }
  itemText(data) { return [data.text, ...(data.evidence || []).map((e) => e.quote)].filter(Boolean).join("\n").slice(0, 1200); }
  // ---- embedding ----
  pending() {
    const unbuilt = Number(this.rows("SELECT COUNT(*) n FROM ambient_chunks WHERE active=1 AND passages_built=0")[0]?.n || 0);
    const p = Number(this.rows("SELECT COUNT(*) n FROM ambient_passages WHERE vec IS NULL AND tries<? AND retry_at<=?", MAX_TRIES, now())[0]?.n || 0);
    const i = Number(this.rows("SELECT COUNT(*) n FROM ambient_items i JOIN ambient_chunks c ON c.source=i.source AND c.source_id=i.source_id AND c.hash=i.chunk_hash WHERE c.active=1 AND c.state='done' AND NOT EXISTS(SELECT 1 FROM ambient_item_vec v WHERE v.id=i.id AND (v.vec IS NOT NULL OR v.tries>=?))", MAX_TRIES)[0]?.n || 0);
    return { unbuilt, passages: p, items: i };
  }
  // When the next indexing pass is due, or null when there is nothing to do (or it is paused until later).
  nextWork() { if (!this.available()) return null; const p = this.pending(); if (!(p.unbuilt || p.passages || p.items)) return null; return Math.max(now() + 1000, Number(this.s.host.get("ambient_embed_retry_at") || 0)); }
  async embed(texts) {
    const h = this.s.host, L = h.ledger(), chars = texts.reduce((n, t) => n + t.length + 4, 0), reserve = Math.ceil(chars * EMBED_NANO * EMBED_MARKUP), rid = `ambient:embed:${crypto.randomUUID()}`;
    this.sql.exec("INSERT INTO ambient_attempts VALUES(?,?)", rid, now());
    const held = await L.reserve(rid, reserve);
    if (!held?.ok) { this.sql.exec("DELETE FROM ambient_attempts WHERE id=?", rid); throw Object.assign(new Error("ambient spending paused"), { ambientPause: held?.reason === "day_limit" ? "Daily spending limit reached" : "Ambient search indexing waiting for credits" }); }
    let settled = false;
    try {
      const allowed = await this.s.privacy(texts); if (allowed.size !== texts.length) throw new Error("ambient context changed");
      const model = await jobModel(h.env, "embed_memory");
      const r = await h.env.AI.run(model, { text: texts }, aiOpts(h.env, { tenant: h.tid(), channel: "main", kind: "ambient-embed" }));
      const vecs = (r?.data || []).map((v) => Array.isArray(v) || ArrayBuffer.isView(v) ? v : null);
      const tokens = Number(r?.usage?.prompt_tokens) || Math.ceil(chars / 4), cost = Math.min(reserve, Math.ceil(tokens * EMBED_NANO * EMBED_MARKUP));
      await L.settle(rid, cost); settled = true; h.bump({ ambient_embed_calls: 1, ambient_embed_nano: cost });
      this.sql.exec("DELETE FROM ambient_attempts WHERE id=?", rid);
      if (vecs.length !== texts.length || vecs.some((v) => !v)) throw new Error("embedding response incomplete");
      return { vecs: vecs.map(unitVector), model };
    } catch (e) { if (!settled) { await L.settle(rid, 0); this.sql.exec("DELETE FROM ambient_attempts WHERE id=?", rid); } throw e; }
  }
  // One bounded pass: build passages, then embed a few batches (passages first, newest speech first, then items).
  async run(fixture = false) {
    const h = this.s.host; if (!this.s.running(fixture)) return { built: 0, embedded: 0 };
    const built = this.build();
    if (!this.available() || Number(h.get("ambient_embed_retry_at") || 0) > now()) return { built, embedded: 0 };
    let embedded = 0;
    try {
      for (let call = 0; call < CALLS_PER_RUN; call++) {
        const model = await jobModel(h.env, "embed_memory");
        const rows = this.rows("SELECT id,text FROM ambient_passages WHERE (vec IS NULL OR model<>?) AND tries<? AND retry_at<=? ORDER BY at DESC LIMIT ?", model, MAX_TRIES, now(), BATCH);
        let kind = "passage", batch = rows.map((r) => ({ id: r.id, text: r.text }));
        if (!batch.length) {
          const items = this.rows("SELECT i.id,i.data FROM ambient_items i JOIN ambient_chunks c ON c.source=i.source AND c.source_id=i.source_id AND c.hash=i.chunk_hash WHERE c.active=1 AND c.state='done' ORDER BY i.source_at DESC LIMIT 400");
          kind = "item"; batch = [];
          for (const r of items) { const text = this.itemText(parse(r.data, {})); if (!text) continue; const th = await sha(text), v = this.rows("SELECT text_hash,model,vec,tries FROM ambient_item_vec WHERE id=?", r.id)[0]; if (v && v.text_hash === th && (v.tries >= MAX_TRIES || v.vec && v.model === model)) continue; batch.push({ id: r.id, text, th, tries: v?.tries || 0 }); if (batch.length >= BATCH) break; }
        }
        if (!batch.length) break;
        // Privacy: a forgotten line is never sent, and is marked so it is not retried.
        const ok = await this.s.privacy(batch.map((b) => b.text)), send = batch.filter((_, i) => ok.has(i));
        for (const b of batch.filter((_, i) => !ok.has(i))) this.mark(kind, b, MAX_TRIES);
        if (!send.length) continue;
        // Save progress before the paid step: the attempt is counted even if the Worker restarts mid request.
        for (const b of send) this.mark(kind, b, null);
        let out; try { out = await this.embed(send.map((b) => b.text)); } catch (e) {
          if (e?.ambientPause) { h.put("ambient_embed_retry_at", now() + 300000); h.put("ambient_note", e.ambientPause); return { built, embedded, paused: e.ambientPause }; }
          for (const b of send) this.mark(kind, b, "retry");
          console.log("ambient embed retry", String(e?.message || e).slice(0, 120)); if (/context changed/.test(String(e?.message))) continue; throw e;
        }
        // Recheck right before saving: text forgotten while the request ran is not stored.
        const again = await this.s.privacy(send.map((b) => b.text));
        this.s.transaction(() => send.forEach((b, i) => { if (!again.has(i)) return this.mark(kind, b, MAX_TRIES); const { q, scale } = quantize(out.vecs[i]); this.store(kind, b, this.blob(q), scale, out.model); embedded++; }));
      }
    } catch (e) { h.put("ambient_embed_retry_at", now() + 60000); console.log("ambient index step failed", String(e?.message || e).slice(0, 120)); }
    h.put("ambient_index_stats", null);
    return { built, embedded };
  }
  // tries: null = count an attempt; number = set; "retry" = back off.
  mark(kind, b, tries) {
    if (kind === "passage") {
      if (tries === null) this.sql.exec("UPDATE ambient_passages SET tries=tries+1 WHERE id=?", b.id);
      else if (tries === "retry") this.sql.exec("UPDATE ambient_passages SET retry_at=? WHERE id=?", now() + 60000, b.id);
      else this.sql.exec("UPDATE ambient_passages SET tries=? WHERE id=?", tries, b.id);
    } else {
      this.sql.exec("INSERT OR IGNORE INTO ambient_item_vec(id,text_hash) VALUES(?,?)", b.id, b.th);
      if (tries === null) this.sql.exec("UPDATE ambient_item_vec SET tries=CASE WHEN text_hash=? THEN tries+1 ELSE 1 END,text_hash=?,vec=CASE WHEN text_hash=? THEN vec ELSE NULL END WHERE id=?", b.th, b.th, b.th, b.id);
      else if (tries === "retry") this.sql.exec("UPDATE ambient_item_vec SET retry_at=? WHERE id=?", now() + 60000, b.id);
      else this.sql.exec("UPDATE ambient_item_vec SET tries=? WHERE id=?", tries, b.id);
    }
  }
  store(kind, b, blob, scale, model) {
    if (kind === "passage") this.sql.exec("UPDATE ambient_passages SET vec=?,scale=?,model=?,tries=0 WHERE id=?", blob, scale, model, b.id);
    else this.sql.exec("INSERT INTO ambient_item_vec(id,text_hash,vec,scale,model,tries) VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET text_hash=excluded.text_hash,vec=excluded.vec,scale=excluded.scale,model=excluded.model,tries=0", b.id, b.th, blob, scale, model);
  }
  // ---- the query vector (cached so paging never embeds, and so never bills, again) ----
  async queryVector(text) {
    if (!this.available()) return { unavailable: "Semantic search is not available here; results use tolerant keyword matching only." };
    const q = String(text).trim().slice(0, 500), h = await sha(q), model = await jobModel(this.s.host.env, "embed_memory").catch(() => null);
    const hit = this.rows("SELECT vec,scale,model FROM ambient_qvec WHERE h=?", h)[0];
    if (hit && hit.model === model) return { vec: toI8(hit.vec), scale: hit.scale, model };
    try {
      const out = await this.embed([q]), u = out.vecs[0];
      // The query vector stays float; the cache holds it quantized like everything else.
      const { q: i8, scale } = quantize(u); this.sql.exec("INSERT OR REPLACE INTO ambient_qvec VALUES(?,?,?,?,?)", h, this.blob(i8), scale, out.model, now());
      this.sql.exec("DELETE FROM ambient_qvec WHERE h NOT IN (SELECT h FROM ambient_qvec ORDER BY at DESC LIMIT 40)");
      return { vec: i8, scale, model: out.model };
    } catch (e) { return { unavailable: e?.ambientPause ? `Semantic search is paused (${e.ambientPause}); results use tolerant keyword matching only.` : "Semantic search could not run for this query; results use tolerant keyword matching only." }; }
  }
  // ---- coverage ----
  status(qv) {
    const h = this.s.host; let stats = parse(h.get("ambient_index_stats"));
    if (!stats) {
      const p = this.rows("SELECT COUNT(*) n,SUM(CASE WHEN vec IS NOT NULL THEN 1 ELSE 0 END) done,SUM(CASE WHEN vec IS NULL AND tries>=? THEN 1 ELSE 0 END) failed FROM ambient_passages", MAX_TRIES)[0] || {};
      const i = this.rows("SELECT COUNT(*) n FROM ambient_item_vec WHERE vec IS NOT NULL")[0] || {}, ni = this.rows("SELECT COUNT(*) n FROM ambient_items")[0] || {};
      stats = { passages: Number(p.n || 0), passages_embedded: Number(p.done || 0), passages_failed: Number(p.failed || 0), items: Number(ni.n || 0), items_embedded: Number(i.n || 0), unbuilt_chunks: Number(this.rows("SELECT COUNT(*) n FROM ambient_chunks WHERE active=1 AND passages_built=0")[0]?.n || 0) };
      h.put("ambient_index_stats", JSON.stringify(stats));
    }
    const behind = stats.unbuilt_chunks || stats.passages_embedded < stats.passages - stats.passages_failed || stats.items_embedded < stats.items;
    return { keyword: "tolerant: stems, small typos, split and joined words, any matching word", semantic: qv?.vec ? "used" : "not_used", ...(qv?.unavailable ? { semantic_unavailable: qv.unavailable } : this.available() ? {} : { semantic_unavailable: "Semantic search is not available here; results use tolerant keyword matching only." }),
      indexing_complete: !behind && this.available(), ...stats, note: behind ? "Semantic indexing of some speech is still in progress. Older or very recent speech may match by words only." : stats.passages_embedded > SCAN_CAP ? `Meaning search covers the newest ${SCAN_CAP} passages; older speech matches by words only.` : null };
  }
  // ---- ranking ----
  // Passages: tolerant keyword score fused with vector similarity.
  rankPassages(query, { from = null, to = null, source_id = null } = {}, qv = null) {
    const where = [], args = [];
    if (source_id) { where.push("source_id=?"); args.push(String(source_id)); }
    if (from != null) { where.push("COALESCE(until,at,0)>=?"); args.push(from); }
    if (to != null) { where.push("COALESCE(at,0)<=?"); args.push(to); }
    const w = where.length ? ` AND ${where.join(" AND ")}` : "", groups = termVariants(query, this.vocab());
    const lexical = [], info = new Map();
    if (groups.length) {
      const conds = groups.map((g) => `(${[...g.variants.keys()].map(() => "instr(ntext,?)>0").join(" OR ")})`), params = groups.flatMap((g) => [...g.variants.keys()].map((v) => ` ${v} `));
      const N = Number(this.rows(`SELECT COUNT(*) n FROM ambient_passages WHERE 1=1${w}`, ...args)[0]?.n || 0);
      const df = this.rows(`SELECT ${conds.map((c) => `SUM(CASE WHEN ${c} THEN 1 ELSE 0 END)`).join(",")} FROM ambient_passages WHERE 1=1${w}`, ...params, ...args)[0] || {}, idf = Object.values(df).map((d) => idfOf(N, Number(d || 0)));
      const cand = this.rows(`SELECT id,ntext FROM ambient_passages WHERE (${conds.join(" OR ")})${w} ORDER BY COALESCE(at,0) DESC LIMIT ${CANDIDATE_CAP}`, ...params, ...args);
      const avg = cand.reduce((n, r) => n + r.ntext.length, 0) / (cand.length || 1);
      const scored = cand.map((r) => { let s = 0; const matched = []; groups.forEach((g, i) => { const hit = groupHit(g, r.ntext); if (hit) { s += hit * (idf[i] || 0.1) * 1.5 / (1 + 0.5 * (r.ntext.length / (avg || 1))); matched.push(g.term); } }); return { id: r.id, s, matched }; }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
      const top = scored[0]?.s || 0;
      for (const x of scored.filter((x, i) => i < 20 || x.s >= top * 0.25).slice(0, RANK_CAP)) { lexical.push(x.id); info.set(x.id, { terms: x.matched }); }
    }
    const semantic = [], sims = new Map();
    if (qv?.vec) {
      const best = [], rowsIt = this.iter(`SELECT id,vec,scale FROM ambient_passages WHERE vec IS NOT NULL AND model=?${w} ORDER BY COALESCE(at,0) DESC LIMIT ${SCAN_CAP}`, qv.model, ...args);
      for (const r of rowsIt) { const sim = cosineQ(qv.vec, r.vec, r.scale * qv.scale); if (sim >= SEMANTIC_MIN) { best.push([r.id, sim]); if (best.length > RANK_CAP * 3) { best.sort((a, b) => b[1] - a[1]); best.length = RANK_CAP; } } }
      best.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); for (const [id, sim] of best.slice(0, RANK_CAP)) { semantic.push(id); sims.set(id, sim); }
    }
    return this.finish(fuse([{ name: "keyword", ids: lexical }, { name: "meaning", ids: semantic }]), info, sims);
  }
  // Items arrive as rows already filtered by kind, state and dates.
  rankItems(query, rows, qv = null) {
    const groups = termVariants(query, this.vocab()), data = new Map(), nt = new Map();
    for (const r of rows) { const d = parse(r.data, {}); data.set(r.id, d); nt.set(r.id, normText(`${d.text || ""} ${d.search_text || ""}`)); }
    const N = rows.length, idf = groups.map((g) => idfOf(N, [...nt.values()].filter((t) => groupHit(g, t)).length)), avg = [...nt.values()].reduce((n, t) => n + t.length, 0) / (N || 1);
    const info = new Map(), scored = [];
    for (const r of rows) { const t = nt.get(r.id); let s = 0; const matched = []; groups.forEach((g, i) => { const hit = groupHit(g, t); if (hit) { s += hit * idf[i] * 1.5 / (1 + 0.5 * (t.length / (avg || 1))); matched.push(g.term); } }); if (s > 0) scored.push({ id: r.id, s, matched }); }
    scored.sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
    const top = scored[0]?.s || 0, lexical = []; for (const x of scored.filter((x, i) => i < 20 || x.s >= top * 0.25).slice(0, RANK_CAP)) { lexical.push(x.id); info.set(x.id, { terms: x.matched }); }
    const semantic = [], sims = new Map();
    if (qv?.vec && rows.length) {
      const ids = new Set(rows.map((r) => r.id)), best = [];
      for (const v of this.iter("SELECT id,vec,scale FROM ambient_item_vec WHERE vec IS NOT NULL AND model=?", qv.model)) if (ids.has(v.id)) { const sim = cosineQ(qv.vec, v.vec, v.scale * qv.scale); if (sim >= SEMANTIC_MIN) best.push([v.id, sim]); }
      best.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); for (const [id, sim] of best.slice(0, RANK_CAP)) { semantic.push(id); sims.set(id, sim); }
    }
    return { ranked: this.finish(fuse([{ name: "keyword", ids: lexical }, { name: "meaning", ids: semantic }]), info, sims), data };
  }
  finish(fused, info, sims) {
    return fused.slice(0, RANK_CAP).map((f) => ({ id: f.id, match: { via: f.via, ...(info.has(f.id) ? { keywords: info.get(f.id).terms } : {}), ...(sims.has(f.id) ? { meaning_score: Math.round(sims.get(f.id) * 100) / 100 } : {}) } }));
  }
  iter(q, ...a) { const c = this.sql.exec(q, ...a); return typeof c[Symbol.iterator] === "function" ? c : c.toArray(); }
  passages(ids) {
    const out = new Map(); for (let i = 0; i < ids.length; i += 50) { const part = ids.slice(i, i + 50); for (const r of this.rows(`SELECT p.id,p.source,p.source_id,p.at,p.until,p.speaker,p.is_user,p.line_from,p.line_to,p.utterance_ids,p.text,s.revision,s.source_state,c.state FROM ambient_passages p JOIN ambient_sources s ON s.source=p.source AND s.source_id=p.source_id JOIN ambient_chunks c ON c.source=p.source AND c.source_id=p.source_id AND c.hash=p.chunk_hash WHERE p.id IN (${part.map(() => "?").join(",")})`, ...part)) out.set(r.id, r); }
    return out;
  }
}
const toI8 = (b) => new Int8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
function windowsOf(lines) { return passageWindows(lines); }
