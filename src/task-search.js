// Ranked task search for one channel (the channel sidebar's Search box).
//
// What it does: GET /api/res/<channel>/search?q=... returns the channel's tasks, most likely first. Two rankings are merged with reciprocal rank fusion:
//   1. keywords: SQLite FTS5 (bm25) in this channel's own Resident SQLite, over each task's title and the text of the person's messages and the helper's replies
//      (tool output and work logs are never indexed);
//   2. meaning: one embedding per task (title, messages and replies, cut to EMBED_CHARS), kept in the channel's own Resident SQLite (task_idx.vec) and compared with the query's
//      embedding by cosine score in the Worker. Vectorize is not used here because it makes a written vector searchable only after a delay (measured on dev on 2026-10-26: 86 seconds
//      for one vector in a new namespace), so a search made right after the first build, or after a new message, found nothing by meaning. SQLite has the vector the moment it is written.
// Embeddings use the saved Models page job `mem_embed` (1024 numbers per text), labelled "task-search-embed" in the call's meta.
//
// Spend rules: nothing is indexed until a person searches the channel. The first search builds the index
// (reconcile), and the embeddings of the tasks it finds are made by that search (and by what it leaves behind, finished in the same request's waitUntil). Writes after that keep the
// keyword index current, and they make embeddings only for a channel whose owner is not a test account. A search is always a person's action.
//
// State (all in the channel's Resident, so it goes with the channel; no D1 migration):
//   task_fts      FTS5, one row per task (title, and the text of the messages and replies), for the ranking
//   task_msg_fts  FTS5, one row per message or reply, for the matched snippet
//   task_idx  one row per indexed task: sig (title and turn counts, to see what changed), vsig (the sig its vector was made from), vec (the vector, 1024 numbers as base64 text), at
//   kv ts_built  when the first search built the index
import { dispatch } from "./ee/index.js";
import { scrubSecrets } from "./secrets-scrub.js";
import { cardsToText } from "./genui.js";
import { DIMS } from "./mem0-store.js";
import { hsRawNano } from "./byok.js";

export const RESULTS_MAX = 30;       // results returned
const KW_TOP = 50, VEC_TOP = 50;     // candidates each ranking contributes to the fusion
export const RRF_K = 60;             // reciprocal rank fusion constant
// Meaning cutoff, set from scores measured on dev (a test channel of 59 tasks, bge-m3, 2026-10-26):
//   best task for a query that means the same as it with no shared words: 0.4595 to 0.5827 (7 queries), and the other tasks of that topic 0.4294 to 0.5685;
//   best task for gibberish or an unrelated query: 0.2740 (bread recipe), 0.3227 and 0.3385 (gibberish), 0.4368 (football scores, matched to test fixtures); the rest of the channel 0.13 to 0.41.
// Rule: a query has a meaning result only when its best task scores at least VEC_MIN. Then the tasks within VEC_MARGIN of the best score are meaning results too (a topic often has
// several tasks, and the best is not always the first one a person wants), and never one below VEC_TAIL_MIN. Everything else is background noise at that query.
export const VEC_MIN = 0.45, VEC_MARGIN = 0.08, VEC_TAIL_MIN = 0.35;
const RECENCY = 0.00005;             // tie-break: at most this much added to a fused score, less than the gap between neighbours at rank 50 (1/110 - 1/111 = 0.00008), so it only orders near ties
const EMBED_CHARS = 6000, USER_CHARS = 4000, REPLY_CHARS = 8000, TURNS_MAX = 400, BODY_CHARS = 60000;
const EMBED_BATCH = 32, FIRST_SEARCH_EMBED = 64, EMBED_MIN_GAP_MS = 60e3, MARKUP = 1.15, QUERY_NANO = 1000;
const plain = (env) => (env.BYOK ? Object.create(env, { BYOK: { value: null } }) : env);   // memory models are 1HC's, never the person's own key
const STOP = new Set("a an and are as at be but by do for from had has have how i if in into is it its me my of on or our so that the their them then there these they this to up was we were what when where which who why will with you your about find show get got".split(" "));

export function taskSearchInit(sql) {
  sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS task_fts USING fts5(title, body, session UNINDEXED, tokenize='porter unicode61 remove_diacritics 2')");
  sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS task_msg_fts USING fts5(body, session UNINDEXED, turn UNINDEXED, role UNINDEXED, tokenize='porter unicode61 remove_diacritics 2')");
  sql.exec("CREATE TABLE IF NOT EXISTS task_idx (session TEXT PRIMARY KEY, sig TEXT NOT NULL, vsig TEXT, at INTEGER NOT NULL, vec TEXT)");
  try { sql.exec("ALTER TABLE task_idx ADD COLUMN vec TEXT"); } catch {}   // a table made before vectors moved here (the column exists on a new table, so this throws and is ignored)
}

// ---- vectors ----
const b64 = (v) => { const u = new Uint8Array(new Float32Array(v).buffer); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (t) => { const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
const norm = (v) => { let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; return Math.sqrt(n) || 1; };
export function cosine(a, b, nb = norm(b)) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d / (norm(a) * nb); }
// scored: [{ id, score }] for every task with a vector. → the meaning results, best first, by the rule at VEC_MIN.
export function meaningHits(scored, limit = VEC_TOP) {
  const s = scored.slice().sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  if (!s.length || s[0].score < VEC_MIN) return [];
  const cut = Math.max(s[0].score - VEC_MARGIN, VEC_TAIL_MIN);
  return s.filter((x) => x.score >= cut).slice(0, limit);
}

// ---- pure helpers ----
// The FTS5 MATCH expression for what the person typed: each word on its own, any of them (bm25 puts the tasks with more of them first), the last one as a prefix because the
// person may still be typing it. Words like "the" are left out unless nothing else is left.
export function ftsQuery(q) {
  const words = (String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 12), keep = words.filter((w) => !STOP.has(w)), use = keep.length ? keep : words;
  return use.map((w, i) => `"${w}"${i === use.length - 1 && w.length >= 2 ? "*" : ""}`).join(" OR ");
}
// Reciprocal rank fusion. lists: arrays of ids, best first. → [{ id, score }] best first. A task in several lists scores the sum of 1/(k + rank).
export function fuse(lists, k = RRF_K) {
  const s = new Map();
  for (const l of lists) l.forEach((id, i) => s.set(id, (s.get(id) || 0) + 1 / (k + i + 1)));
  return [...s].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

// ---- what is indexed for one task ----
// The person's messages and the helper's replies of the task, oldest first, as { turn, role: "u" | "a", text }. Secrets are scrubbed. A card that opened with text only the model saw
// (a helper's report, a handed-back result) is not a message of the person.
export function taskDocs(R, session) {
  const s = R.session(session); if (!s) return null;
  const out = [];
  let turns; try { turns = R.sql.exec("SELECT t.id, t.user_text, t.reply, c.kind AS ck FROM turns t LEFT JOIN cards c ON c.id=t.id WHERE t.session=? AND t.kind='chat' ORDER BY t.at DESC, t.rowid DESC LIMIT ?", session, TURNS_MAX).toArray(); }
  catch { turns = R.sql.exec("SELECT id, user_text, reply, NULL AS ck FROM turns WHERE session=? AND kind='chat' ORDER BY at DESC, rowid DESC LIMIT ?", session, TURNS_MAX).toArray(); }
  turns.reverse();
  let steers = []; try { steers = R.sql.exec("SELECT e.card, e.text FROM card_events e JOIN turns t ON t.id=e.card WHERE t.session=? AND t.kind='chat' AND e.type='msg' AND e.seq>1 AND e.text<>'' ORDER BY e.card, e.seq", session).toArray(); } catch {}
  for (const t of turns) {
    const mine = t.ck === "handoff" ? "" : [t.user_text || "", ...steers.filter((e) => e.card === t.id).map((e) => e.text)].join("\n").trim();
    if (mine) out.push({ turn: t.id, role: "u", text: scrubSecrets(mine).slice(0, USER_CHARS) });
    let reply = ""; try { reply = cardsToText(t.reply || ""); } catch { reply = String(t.reply || ""); }
    if (reply.trim()) out.push({ turn: t.id, role: "a", text: scrubSecrets(reply.trim()).slice(0, REPLY_CHARS) });
  }
  return { title: scrubSecrets(String(s.title || "")), rows: out };
}
export const embedText = (d) => [d.title, ...d.rows.map((r) => r.text)].join("\n").slice(0, EMBED_CHARS);

// ---- the keyword index ----
const sigs = (R, only = null) => R.sql.exec(`SELECT s.id, s.title, s.updated, COALESCE(t.n,0) n, COALESCE(t.m,0) m, COALESCE(t.l,0) l FROM sessions s
  LEFT JOIN (SELECT session, COUNT(*) n, MAX(at) m, SUM(LENGTH(COALESCE(reply,''))+LENGTH(COALESCE(user_text,''))) l FROM turns WHERE kind='chat'${only ? " AND session=?" : ""} GROUP BY session) t ON t.session=s.id${only ? " WHERE s.id=?" : ""}`, ...(only ? [only, only] : [])).toArray()
  .map((r) => ({ id: r.id, updated: r.updated, sig: `${r.title}\u0001${r.n}.${r.m}.${r.l}` }));
const sigOf = (R, id) => sigs(R, id)[0]?.sig;
export function ftsPut(R, id, sig = sigOf(R, id)) {
  const d = taskDocs(R, id);
  R.sql.exec("DELETE FROM task_fts WHERE session=?", id); R.sql.exec("DELETE FROM task_msg_fts WHERE session=?", id);
  if (!d || sig == null) { R.sql.exec("DELETE FROM task_idx WHERE session=?", id); return false; }
  // One row per task for the ranking (so a task whose title has one word and whose messages have another still has both), one row per message for the snippet.
  R.sql.exec("INSERT INTO task_fts (title, body, session) VALUES (?,?,?)", d.title, d.rows.map((r) => r.text).join("\n").slice(0, BODY_CHARS), id);
  for (const r of d.rows) R.sql.exec("INSERT INTO task_msg_fts (body, session, turn, role) VALUES (?,?,?,?)", r.text, id, r.turn, r.role);
  R.sql.exec("INSERT INTO task_idx (session, sig, vsig, at) VALUES (?,?,NULL,?) ON CONFLICT(session) DO UPDATE SET sig=excluded.sig, at=excluded.at", id, sig, Date.now());
  return true;
}
export const isBuilt = (R) => !!R.getRaw("ts_built");
// Brings the keyword index in line with the channel: new and changed tasks are indexed again, tasks that are gone leave it. It reads every write path (title changes, new turns,
// cleared tasks) from the counts in each task's signature, so no writer can be missed. → { n: how many tasks it indexed again, gone: the ids that left }.
export function reconcile(R) {
  const now = sigs(R), have = new Map(R.sql.exec("SELECT session, sig FROM task_idx").toArray().map((r) => [r.session, r.sig])), live = new Set(now.map((x) => x.id));
  let n = 0;
  for (const x of now) if (have.get(x.id) !== x.sig) { ftsPut(R, x.id, x.sig); n++; }
  const gone = [...have.keys()].filter((id) => !live.has(id)); for (const id of gone) dropRows(R, id);
  if (!isBuilt(R)) R.put("ts_built", String(Date.now()));
  return { n, gone };
}
function dropRows(R, id) { R.sql.exec("DELETE FROM task_fts WHERE session=?", id); R.sql.exec("DELETE FROM task_msg_fts WHERE session=?", id); R.sql.exec("DELETE FROM task_idx WHERE session=?", id); }
// Keyword ranking: → [{ id, score }] best first. A match in the title counts six times a match in the messages (bm25 column weights).
export function keywordRank(R, q, limit = KW_TOP) {
  const m = ftsQuery(q); if (!m) return [];
  try { return R.sql.exec("SELECT session AS id, -bm25(task_fts, 3.0, 1.0) AS score FROM task_fts WHERE task_fts MATCH ? ORDER BY score DESC LIMIT ?", m, limit).toArray(); } catch { return []; }
}
// The short matched passage of a task: the best matching message, with the words around the match.
export function snippetOf(R, q, session) {
  const m = ftsQuery(q); if (!m) return null;
  try { return R.sql.exec("SELECT snippet(task_msg_fts, 0, '', '', '…', 14) AS sn FROM task_msg_fts WHERE task_msg_fts MATCH ? AND session=? ORDER BY bm25(task_msg_fts) LIMIT 1", m, session).toArray()[0]?.sn || null; } catch { return null; }
}

// ---- embeddings ----
async function embedTexts(R, texts) {
  const r = await dispatch(plain(R.env), "mem_embed", { input: texts }, { meta: { tenant: R.get("tenant"), kind: "task-search-embed" } }), j = await r.json().catch(() => null);
  if (!Array.isArray(j?.data) || j.data.length !== texts.length) throw new Error(`task search embeddings ${r.status}`);
  const out = j.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  if (out.some((v) => v?.length !== DIMS)) throw new Error(`task search embedding is not ${DIMS} numbers`);
  // A different embedding model on the Models page makes the saved vectors useless: every task is embedded again, lazily by the searches that follow.
  const model = String(j.model || ""), was = R.getRaw("ts_model");
  if (model && was && model !== was) R.sql.exec("UPDATE task_idx SET vsig=NULL");
  if (model && model !== was) R.put("ts_model", model);
  return { vectors: out, changed: !!(model && was && model !== was) };
}
// A hold on the person's credits for the characters about to be embedded, then the charge. A channel out of credits gets keyword results only. → settle(), or null when it can't be held.
async function hold(R, chars) {
  const nano = Math.ceil(Math.max(QUERY_NANO, hsRawNano(chars)) * MARKUP);
  if (!R.env.LEDGER || !R.get("tenant")) return { done: async () => {} };
  const rid = `task-search:${crypto.randomUUID()}`;
  try { const led = R.ledger(); const h = await led.reserve(rid, nano); if (!h?.ok) return null; return { done: async (ok = true) => { await led.settle(rid, ok ? nano : 0).catch(() => {}); } }; } catch { return null; }
}
export const vectorsOn = (env) => !!env.AI;   // the embedding job runs on Workers AI; without the binding the keyword ranking answers alone
// Embeds up to `max` tasks whose vector is missing or older than their text (newest tasks first) and writes the vectors. → how many are done, and how many are still pending.
export async function embedPending(R, max) {
  if (!vectorsOn(R.env)) return { done: 0, left: 0 };
  const pending = () => R.sql.exec("SELECT i.session, i.sig FROM task_idx i JOIN sessions s ON s.id=i.session WHERE i.vsig IS NULL OR i.vsig<>i.sig OR i.vec IS NULL ORDER BY s.updated DESC LIMIT ?", max).toArray();
  const rows = pending(); if (!rows.length) return { done: 0, left: 0 };
  const jobs = rows.map((r) => ({ ...r, d: taskDocs(R, r.session) })).filter((j) => j.d);
  const texts = jobs.map((j) => embedText(j.d)), h = await hold(R, texts.reduce((a, t) => a + t.length, 0));
  if (!h) return { done: 0, left: rows.length };
  let done = 0;
  try {
    for (let i = 0; i < jobs.length; i += EMBED_BATCH) {
      const part = jobs.slice(i, i + EMBED_BATCH), { vectors, changed } = await embedTexts(R, texts.slice(i, i + EMBED_BATCH));
      if (changed) break;   // the model changed under us: the next search starts again with every task pending
      part.forEach((j, k) => R.sql.exec("UPDATE task_idx SET vsig=?, vec=? WHERE session=? AND sig=?", j.sig, b64(vectors[k]), j.session, j.sig));
      done += part.length;
    }
    await h.done(true);
  } catch (e) { await h.done(done > 0); console.log("task search embed", String(e?.message || e).slice(0, 160)); }
  const left = R.sql.exec("SELECT COUNT(*) n FROM task_idx WHERE vsig IS NULL OR vsig<>sig OR vec IS NULL").one().n;
  return { done, left };
}
async function vectorRank(R, q, queryVector) {
  const qv = Float32Array.from(queryVector), nq = norm(qv);
  const rows = R.sql.exec("SELECT session, vec FROM task_idx WHERE vec IS NOT NULL AND vsig IS NOT NULL").toArray();
  const scored = []; for (const r of rows) { let v; try { v = unb64(r.vec); } catch { continue; } if (v.length === qv.length) scored.push({ id: r.session, score: cosine(v, qv, nq) }); }
  return meaningHits(scored);
}

// ---- the search ----
// → { results: [{ id, score, snippet }], keyword: n, meaning: n }. An empty or one character query returns nothing. A failure of the meaning side is not an error: the keyword ranking answers alone.
export async function search(R, q) {
  q = String(q ?? "").trim().slice(0, 300);
  if ([...q].length < 2) return { results: [] };
  reconcile(R);   // the first search builds the index; later ones only catch up (a task that left takes its row and vector with it)
  const kw = keywordRank(R, q), updated = new Map(sigs(R).map((x) => [x.id, x.updated]));
  let vec = [], left = 0;
  if (vectorsOn(R.env)) {
    try {
      const h = await hold(R, q.length);
      if (h) {
        let qv = null;
        try {
          const [qe, pend] = await Promise.all([embedTexts(R, [q]), embedPending(R, FIRST_SEARCH_EMBED)]); await h.done(true); left = pend.left;
          if (!qe.changed) qv = qe.vectors[0];
        } catch (e) { await h.done(false); console.log("task search query", String(e?.message || e).slice(0, 160)); }
        if (qv) vec = await vectorRank(R, q, qv);
      }
    } catch (e) { console.log("task search vectors", String(e?.message || e).slice(0, 160)); }
    if (left > 0) R.ctx?.waitUntil?.(finishEmbedding(R).catch(() => {}));
  }
  const kwIds = new Set(kw.map((x) => x.id)), fused = fuse([kw.map((x) => x.id), vec.map((x) => x.id)]);
  const newest = Math.max(1, ...[...updated.values()].map(Number)), oldest = Math.min(...[...updated.values()].map(Number), newest);
  const recency = (id) => ((Number(updated.get(id)) || oldest) - oldest) / Math.max(1, newest - oldest);
  const results = fused.map((f) => ({ id: f.id, score: f.score + RECENCY * recency(f.id) })).filter((r) => updated.has(r.id))
    .sort((a, b) => b.score - a.score).slice(0, RESULTS_MAX).map((r) => ({ ...r, score: Math.round(r.score * 1e6) / 1e6, snippet: kwIds.has(r.id) ? snippetOf(R, q, r.id) : null }));
  return { results, keyword: kw.length, meaning: vec.length };
}
// What a search leaves pending is embedded in the same request's waitUntil, in steps, so the next search finds it done. One loop at a time.
export function finishEmbedding(R) {
  if (R._tsLoop) return R._tsLoop;
  return (R._tsLoop = (async () => { try { for (let n = 0; n < 40; n++) { const r = await embedPending(R, EMBED_BATCH * 2); if (!r.done || !r.left) break; } } finally { R._tsLoop = null; } })());
}

// ---- writes ----
// A task changed (a turn finished, a title changed): its keyword rows follow at once. Nothing happens before the first search. Its embedding follows after a pause between writes,
// and never for a test account.
export function onWrite(R, session) {
  if (!isBuilt(R) || !session) return;
  try { ftsPut(R, String(session)); } catch (e) { console.log("task search index", String(e?.message || e).slice(0, 120)); return; }
  if (!vectorsOn(R.env)) return;
  const at = (R._tsVecAt ||= new Map()), last = at.get(session) || 0;
  if (Date.now() - last < EMBED_MIN_GAP_MS) return;   // the search that comes next embeds what is still pending
  at.set(session, Date.now());
  R.ctx?.waitUntil?.((async () => { if (await R.hsTestOwner?.()) return; await embedPending(R, 4); })().catch(() => {}));
}
// The task is gone (deleted, or its turns cleared with the row gone): its rows and its vector leave. Awaited by deletion so a deleted task never answers a search.
export async function onDelete(R, session) { try { dropRows(R, String(session)); } catch {} }
// The whole channel is deleted: the rows and vectors go with the Resident's storage.
export async function onWipe() {}

// GET /w/<slug>/api/res/<channel>/search?q=... (index.js hands over the signed-in user, the tenant row and a function that lists the tenant's channels). Owner only.
// → null when the path is not this route, else a Response: { slug, q, results: [{ id, score, snippet }] }, at most RESULTS_MAX.
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function searchRoute({ req, env, t, user, sub, url, channels }) {
  const m = /^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/search$/.exec(sub); if (!m) return null;
  if (req.method !== "GET") return reply({ error: "method" }, 405);
  if (!user || !t || user.id !== t.owner_user_id) return reply({ error: "owner only" }, 403);
  const chans = await channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === m[1]);
  if (!ch) return reply({ error: "no such channel" }, 404);
  const q = String(url.searchParams.get("q") ?? "");
  if (env.TEST_MODE === "1" && url.searchParams.get("debug") === "1") { const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`)); await R.bind(t.id, slugOf(ch), String(ch.id)); return reply(await R.tsDebug(q)); }
  if ([...q.trim()].length < 2) return reply({ slug: m[1], q, results: [] });
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`)); await R.bind(t.id, slugOf(ch), String(ch.id));
  const d = await R.taskSearch(q);
  return reply({ slug: m[1], q, results: d.results });
}

// TEST_MODE only (a debug route like the other test routes): what the index holds for this channel and the raw meaning scores of a query, computed in the Worker.
export async function debugView(R, q) {
  const rows = R.sql.exec("SELECT session, sig, vsig, vec FROM task_idx").toArray();
  const lens = rows.filter((r) => r.vec).map((r) => { try { return unb64(r.vec).length; } catch { return -1; } });
  const out = { idx_rows: rows.length, with_vec: lens.length, vec_lengths: [...new Set(lens)], vsig_set: rows.filter((r) => r.vsig).length, pending: R.sql.exec("SELECT COUNT(*) n FROM task_idx WHERE vsig IS NULL OR vsig<>sig OR vec IS NULL").one().n, built: isBuilt(R), vectors_on: vectorsOn(R.env), test_owner: !!(await R.hsTestOwner?.()), ts_model: R.getRaw("ts_model") || null };
  if (q) { try { const { vectors } = await embedTexts(R, [q]); const qv = Float32Array.from(vectors[0]), nq = norm(qv), sc = [];
    for (const r of rows) if (r.vec) sc.push({ id: r.session, score: Math.round(cosine(unb64(r.vec), qv, nq) * 1e4) / 1e4 });
    sc.sort((a, b) => b.score - a.score); out.top = sc.slice(0, 10); out.hits = meaningHits(sc).map((x) => x.id); } catch (e) { out.error = String(e?.message || e).slice(0, 200); } }
  return out;
}
export const taskSearchMethods = {
  async tsDebug(q) { return debugView(this, q); },
  async taskSearch(q) { return search(this, q); },
  tsTouch(session) { try { onWrite(this, session); } catch {} },
  async tsForget(session) { try { await onDelete(this, session); } catch {} },
  async tsWipe() { try { await onWipe(this); } catch {} },
};
