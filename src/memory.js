// 1Helm memory (P1 ledger + P2 recall), per channel, inside the Resident's own Durable Object SQLite.
// Rules (memory PROPOSAL v1, Captain-approved 2026-10-02): raw rows are never overwritten (supersession is a state),
// no LLM on write or read (embedding + search + rank only), a small sourced pack per message instead of a memory dump.
// Bench: local validation evidence (v1: ours 96.4/97.3 at ~1.8k tok/q vs 1HC today 84.8/86.6 at ~19k tok/q).
import { questionScope, annotateRecord, localDay } from "./dates.js";
import { cardsToText } from "./genui.js";
import { markStatus } from "./status-notes.js";   // a record of a pause / limit notice reads as a past status note
import { scrubSecrets } from "./secrets-scrub.js";   // nosecrets: a password, key, card number or code is never kept in the ledger
export const EMBED_MODEL = "@cf/baai/bge-m3";
const STOP = new Set("a an and are as at be but by can did do does for from had has have how i if in is it its me my of on or our so that the their them then there these they this to us was we were what when where which who why will with you your should would could about after before since just also into than only not no yes".split(" "));
export const terms = (s) => [...new Set(String(s).toLowerCase().match(/[a-z0-9][a-z0-9.$%+-]*[a-z0-9%]|[a-z0-9]/g) || [])].filter((w) => !STOP.has(w) && w.length > 1).slice(0, 24);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "undated");

export class Memory {
  constructor(sql, env, meta = () => ({})) {
    this.sql = sql; this.env = env; this.meta = meta;
    sql.exec(`CREATE TABLE IF NOT EXISTS mem_rows (id TEXT PRIMARY KEY, at INTEGER, kind TEXT, author TEXT, source TEXT, session TEXT, seq INTEGER, text TEXT NOT NULL, superseded_by TEXT, vec BLOB);
      CREATE INDEX IF NOT EXISTS mem_rows_at ON mem_rows(at);
      CREATE INDEX IF NOT EXISTS mem_rows_sess ON mem_rows(session, seq);
      CREATE TABLE IF NOT EXISTS mem_receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, turn TEXT, session TEXT, mode TEXT, query TEXT, ids TEXT, top_sim REAL, ms INTEGER, chars INTEGER, error TEXT);`);
    sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(text, id UNINDEXED, tokenize='porter unicode61')");
  }
  // ---- P1: the ledger (append-only) ----
  put(r) {
    if (!r?.id || !String(r.text || "").trim()) return false;
    if (this.sql.exec("SELECT 1 FROM mem_rows WHERE id=?", r.id).toArray().length) return false;   // never overwrite raw
    // The one way into the ledger, so every row (turns, hand-off notes, tool results, facts, Notebook and Contacts copies) is scrubbed.
    const text = scrubSecrets(String(r.text)).slice(0, 8000), source = scrubSecrets(r.source || "");
    this.sql.exec("INSERT INTO mem_rows (id,at,kind,author,source,session,seq,text) VALUES (?,?,?,?,?,?,?,?)", r.id, r.at ?? Date.now(), r.kind || "msg", r.author || "", source, r.session ?? null, r.seq ?? null, text);
    this.sql.exec("INSERT INTO mem_fts (text,id) VALUES (?,?)", `${source} ${text}`, r.id);
    return true;
  }
  supersede(oldId, newId) { this.sql.exec("UPDATE mem_rows SET superseded_by=? WHERE id=? AND superseded_by IS NULL", newId, oldId); }
  nextSeq(session) { return (this.sql.exec("SELECT MAX(seq) m FROM mem_rows WHERE session=?", session).one().m || 0) + 1; }
  // One finished turn → rows: what the person said, what the helper answered, its hand-off notes, each tool call + result.
  captureTurn({ turn, session, at, userText, reply, notes, kind = "chat", workflowId = null }) {
    const src = kind === "chat" ? `task ${String(session || "").slice(0, 8)}` : `${kind}${workflowId ? ` #${workflowId}` : ""}`;
    let seq = this.nextSeq(session || `k:${kind}`), n = 0;
    const add = (id, k, author, text) => { if (this.put({ id, at: at + n, kind: k, author, source: `${src} · ${author}`, session: session || `k:${kind}`, seq: seq++, text })) n++; };
    if (userText) add(`t:${turn}:u`, "msg", kind === "chat" ? "person" : "schedule", userText);
    const calls = {}; for (const m of this.sql.exec("SELECT seq, role, content, tool_calls, tool_call_id FROM msgs WHERE turn=? ORDER BY seq", turn).toArray()) {
      if (m.role === "assistant" && m.tool_calls) { try { for (const c of JSON.parse(m.tool_calls)) calls[c.id] = `${c.function?.name}(${String(c.function?.arguments || "").slice(0, 400)})`; } catch {} }
      if (m.role === "tool") add(`t:${turn}:x${m.seq}`, "tool", "tool", `${calls[m.tool_call_id] || "tool"} → ${String(m.content || "").slice(0, 1500)}`);
    }
    if (reply) add(`t:${turn}:a`, "msg", "helper", cardsToText(reply));   // cards are kept as their plain-text form
    if (notes) add(`t:${turn}:n`, "note", "helper notes", notes);
    return n;
  }
  // Curated memory (imported rows, the person's Notebook) mirrors into the ledger by id; a superseded status is a state, not a delete.
  syncCurated(items = []) {
    let n = 0;
    for (const m of items) {
      // Compared scrubbed, as put() stores it: an old note holding a secret mustn't look "edited" on every sync.
      const id = `m:${m.id}`, text = scrubSecrets(String(m.content || "").trim()); if (!text) continue;
      const at = Number(m.edited || m.created || m.created_at || Date.parse(m.created_at || "") || 0) || null;
      const ex = this.sql.exec("SELECT text FROM mem_rows WHERE id=? OR id LIKE ? ORDER BY at DESC LIMIT 1", id, `${id}@%`).toArray()[0];
      // The nightly reflection (memjobs.js) is an agent row replaced each night: each night's text is a new version, not a person's edit.
      const refl = m.src === "reflection" && m.author_type !== "human";
      if (!ex) { if (this.put({ id, at, kind: m.author_type === "human" ? "notebook" : "memory", author: m.author_type || "", source: refl ? "nightly reflection" : m.author_type === "human" ? (m.src === "interview" ? "notebook · get to know you" : "notebook") : `memory · ${m.kind || ""}`, text })) n++; }
      else if (ex.text !== text.slice(0, 8000)) { const nid = `${id}@${Date.now()}`; if (this.put(refl ? { id: nid, at: Date.now(), kind: "memory", author: "agent", source: "nightly reflection", text } : { id: nid, at: Date.now(), kind: "notebook", author: "human", source: "notebook (edited)", text })) { this.supersede(id, nid); n++; } }
      if (m.status === "superseded") this.supersede(id, "later memory");
    }
    return n;
  }
  async embed(texts) {
    // hold (Resident, own AI key): reserved before the call; false = the credits can't cover it, so nothing is embedded (never on credit).
    const h = this.hold ? await this.hold(texts) : null;
    if (h === false) throw Object.assign(new Error("out of credits: embedding skipped"), { credits: true });
    let r; try { r = await this.env.AI.run(EMBED_MODEL, { text: texts }, this.meta("memory-embed")); } catch (e) { await h?.done(0); throw e; }
    // Charged by input tokens: Workers AI's count when it gives one, else ~4 characters a token (never above what was reserved).
    await h?.done(Number(r?.usage?.prompt_tokens) || Math.ceil(texts.reduce((n, t) => n + String(t).length, 0) / 4));
    return (r.data || []).map(unit);
  }
  async embedMissing(limit = 200) {
    let done = 0;
    while (done < limit) {
      const rows = this.sql.exec("SELECT id, source, text FROM mem_rows WHERE vec IS NULL LIMIT 32").toArray(); if (!rows.length) break;
      const vs = await this.embed(rows.map((r) => `${r.source}: ${r.text}`.slice(0, 2000)));
      rows.forEach((r, i) => vs[i] && this.sql.exec("UPDATE mem_rows SET vec=? WHERE id=?", vs[i].buffer, r.id)); done += rows.length;
    }
    return done;
  }
  // ---- P3 (index, part 1): supersession in the background. For each new fact / person-message row, find older rows that say
  // something close (vector sim ≥ 0.62), ask Clef one yes/no per pair "does the new one replace the old one?", mark replaced rows
  // SUPERSEDED (a state, never a delete). No text generation, so no invented facts. Rows are checked once (sup_checked).
  async supersedeNew(clef, limit = 8) {
    try { this.sql.exec("ALTER TABLE mem_rows ADD COLUMN sup_checked INTEGER"); } catch {}
    const fresh = this.sql.exec("SELECT id, at, text, vec, session FROM mem_rows WHERE sup_checked IS NULL AND vec IS NOT NULL AND kind IN ('fact','msg','notebook') AND (kind<>'msg' OR author='person') ORDER BY at LIMIT ?", limit).toArray();
    let marked = 0;
    for (const n of fresh) {
      this.sql.exec("UPDATE mem_rows SET sup_checked=? WHERE id=?", Date.now(), n.id);
      const nv = new Float32Array(n.vec);
      const olds = this.sql.exec("SELECT id, at, text, vec FROM mem_rows WHERE id<>? AND at<? AND superseded_by IS NULL AND vec IS NOT NULL AND kind IN ('fact','msg','notebook','memory') AND (kind<>'msg' OR author='person')", n.id, n.at).toArray()
        .map((o) => ({ ...o, s: dot(nv, new Float32Array(o.vec)) })).filter((o) => o.s >= 0.62).sort((a, b) => b.s - a.s).slice(0, 4);
      if (!olds.length) continue;
      // Three yes/no questions per pair; all must be confident. Bench P3 run 1 (one loose question at 0.7) marked 14 wrong rows:
      // steps of the same task ("option 3" -> "option 5") and different facts about the same project (budget -> contractor).
      const q = {}; olds.forEach((o, i) => { const pair = `OLD (${day(o.at)}): "${String(o.text).slice(0, 500)}"`;
        q[`same_${i}`] = { type: "noul", instructions: `${pair}\nAre the NEW and OLD statements about the exact same single detail (the same attribute of the same thing, e.g. both state the kitchen budget, or both state the dinner headcount)? Two different details of the same project (budget vs contractor) are NOT the same detail.` };
        q[`differs_${i}`] = { type: "noul", instructions: `${pair}\nDoes the NEW statement give a different value for that detail than the OLD one (a different number, date, name, place or choice)?` };
        q[`update_${i}`] = { type: "noul", instructions: `${pair}\nIs the NEW statement a correction, change of plans or final decision that makes the OLD value no longer true? Answer no if NEW is just another option being compared, another step in a list, or extra information.` }; });
      let r; try { r = await clef({ state: { new_statement: `(${day(n.at)}) ${String(n.text).slice(0, 800)}` }, questions: q }); } catch (e) { this.receipt({ mode: "supersede", query: n.id, error: String(e.message || e).slice(0, 200) }); continue; }
      const A = r.answers || {}, hit = [], p = (k) => Number(A[k]?.noul ?? 0);
      olds.forEach((o, i) => { if (p(`same_${i}`) >= 0.8 && p(`differs_${i}`) >= 0.8 && p(`update_${i}`) >= 0.8) { this.supersede(o.id, n.id); hit.push(o.id); marked++; } });
      this.receipt({ mode: "supersede", query: n.id, ids: hit, topSim: olds[0].s });
    }
    return marked;
  }
  // ---- P3 (index, part 2): segment summaries with pointers. After a task's ledger grows by >= SEG rows, the oldest unsummarized
  // stretch (<= 24 rows) gets one short dated summary written by the default model in the background. The summary is a mem_rows row
  // (kind 'summary') that points at its raw rows; recall that hits a summary also pulls its best-matching raw rows, so the answer
  // always rests on the original words, not the summary.
  async summarizeSegments(model, limit = 2, SEG = 12) {
    this.sql.exec("CREATE TABLE IF NOT EXISTS mem_segments (id TEXT PRIMARY KEY, session TEXT, from_seq INTEGER, to_seq INTEGER, row_ids TEXT, at INTEGER)");
    let made = 0;
    for (const s of this.sql.exec("SELECT r.session, MAX(r.seq) top, COALESCE((SELECT MAX(to_seq) FROM mem_segments g WHERE g.session=r.session), 0) done FROM mem_rows r WHERE r.session IS NOT NULL AND r.kind<>'summary' GROUP BY r.session").toArray()) {
      if (made >= limit || s.top - s.done < SEG) continue;
      const rows = this.sql.exec("SELECT id, at, kind, author, text, seq FROM mem_rows WHERE session=? AND seq>? AND kind<>'summary' ORDER BY seq LIMIT 24", s.session, s.done).toArray();
      if (rows.length < SEG) continue;
      const body = rows.map((r) => `[${day(r.at)} ${r.author}] ${String(r.text).slice(0, r.kind === "tool" ? 300 : 900)}`).join("\n").slice(0, 14000);
      let out = "";
      try { const r = await model([{ role: "system", content: "You index a work log for later search. Write 2-5 plain sentences: what was asked, what was decided or found, and any exact names, numbers, dates, prices, files or links that matter. Only facts that appear in the log. No advice, no headings." }, { role: "user", content: body }]); out = String(r || "").trim(); }
      catch (e) { this.receipt({ mode: "summary", query: s.session, error: String(e.message || e).slice(0, 200) }); break; }
      if (!out) break;
      const id = `s:${s.session}:${rows[0].seq}-${rows.at(-1).seq}`, ids = rows.map((r) => r.id);
      this.sql.exec("INSERT OR IGNORE INTO mem_segments VALUES (?,?,?,?,?,?)", id, s.session, rows[0].seq, rows.at(-1).seq, JSON.stringify(ids), Date.now());
      this.put({ id, at: rows.at(-1).at, kind: "summary", author: "index", source: `summary of ${day(rows[0].at)}${day(rows[0].at) !== day(rows.at(-1).at) ? `–${day(rows.at(-1).at)}` : ""} work`, text: out.slice(0, 1500) });
      this.receipt({ mode: "summary", query: s.session, ids: [id], chars: out.length }); made++;
    }
    return made;
  }
  // Raw rows behind a summary, best match to the question first.
  pointers(id, qv, n = 3) {
    const g = this.sql.exec("SELECT row_ids FROM mem_segments WHERE id=?", id).toArray()[0]; if (!g) return [];
    const ids = JSON.parse(g.row_ids); if (!ids.length) return [];
    const rows = this.sql.exec(`SELECT id, vec FROM mem_rows WHERE id IN (${ids.map(() => "?").join(",")}) AND vec IS NOT NULL`, ...ids).toArray();
    return (qv ? rows.map((r) => ({ id: r.id, s: dot(qv, new Float32Array(r.vec)) })).sort((a, b) => b.s - a.s) : rows).slice(0, n).map((r) => r.id);
  }
  // ---- P2: recall. time scope → BM25 + vector legs → weighted RRF → recency reserve → ±1 neighbours → chronological pack ----
  async recall(query, o = {}) {
    const k = o.k ?? 8, scan = o.scan ?? 60, asOf = o.asOf ?? null, t0 = Date.now(), exclude = o.excludeSession || "";
    const ts = [...new Set([...terms(query), ...(o.extraTerms || []).flatMap((x) => terms(x))])].slice(0, 32), ftsq = ts.map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");
    const ex = exclude ? "AND coalesce(r.session,'')<>?" : "", exA = exclude ? [exclude] : [];
    const lex = ftsq ? this.sql.exec(`SELECT f.id FROM mem_fts f JOIN mem_rows r ON r.id=f.id WHERE mem_fts MATCH ? ${ex} ${asOf ? "AND r.at<=?" : ""} ORDER BY bm25(mem_fts) LIMIT ?`,
      ftsq, ...exA, ...(asOf ? [asOf] : []), scan).toArray().map((r) => r.id) : [];
    let sem = [], topSim = 0, qv = o.qv || null;
    try {
      qv = qv || (await this.embed([query]))[0];
      const sims = this.sql.exec(`SELECT r.id, r.vec FROM mem_rows r WHERE r.vec IS NOT NULL ${ex} ${asOf ? "AND r.at<=?" : ""}`, ...exA, ...(asOf ? [asOf] : [])).toArray()
        .map((r) => ({ id: r.id, s: dot(qv, new Float32Array(r.vec)) })).sort((a, b) => b.s - a.s);
      sem = sims.slice(0, scan).map((r) => r.id); topSim = sims[0]?.s ?? 0;
    } catch (e) { o.onError?.(`embed: ${e.message}`); }
    const score = new Map(), K = 60;
    lex.forEach((id, i) => score.set(id, (score.get(id) || 0) + 0.6 / (K + i + 1)));
    sem.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1.0 / (K + i + 1)));
    // Date scope ("yesterday", "last week", "in September", "before Oct 1"): rows inside the range (±1 day of slack) get double
    // weight, plus their own scoped search leg, so the right day wins without hiding everything else.
    let scoped = 0;
    if (o.scope && (o.scope.from || o.scope.to)) {
      const lo = o.scope.from ? o.scope.from - 86400e3 : 0, hi = o.scope.to ? o.scope.to + 86400e3 : 9e15;
      const inS = new Set(this.sql.exec(`SELECT id FROM mem_rows WHERE at>=? AND at<? ${exclude ? "AND coalesce(session,'')<>?" : ""}`, lo, hi, ...exA).toArray().map((r) => r.id));
      if (qv) this.sql.exec(`SELECT id, vec FROM mem_rows WHERE vec IS NOT NULL AND at>=? AND at<? ${exclude ? "AND coalesce(session,'')<>?" : ""}`, lo, hi, ...exA).toArray()
        .map((r) => ({ id: r.id, s: dot(qv, new Float32Array(r.vec)) })).sort((a, b) => b.s - a.s).slice(0, 20).forEach((r, i) => score.set(r.id, (score.get(r.id) || 0) + 1.0 / (K + i + 1)));
      for (const [id, v] of score) if (inS.has(id)) { score.set(id, v * 2); scoped++; }
    }
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (!ranked.length) return { rows: [], topSim, ms: Date.now() - t0 };
    const top = ranked.slice(0, 3 * k), at = new Map(this.sql.exec(`SELECT id, at FROM mem_rows WHERE id IN (${top.map(() => "?").join(",")})`, ...top).toArray().map((r) => [r.id, r.at || 0]));
    const R = o.reserve ?? 2, main = ranked.slice(0, k - R), newest = top.filter((id) => !main.includes(id)).sort((a, b) => at.get(b) - at.get(a)).slice(0, R);
    const ids = new Set([...main, ...newest]);
    if (this.sql.exec("SELECT 1 FROM sqlite_master WHERE name='mem_segments'").toArray().length) for (const id of [...ids]) if (id.startsWith("s:")) for (const p of this.pointers(id, qv)) ids.add(p);
    for (const r of this.sql.exec(`SELECT session, seq FROM mem_rows WHERE id IN (${[...ids].map(() => "?").join(",")}) AND session IS NOT NULL AND seq IS NOT NULL`, ...ids).toArray())
      for (const nb of this.sql.exec("SELECT id FROM mem_rows WHERE session=? AND seq IN (?,?)", r.session, r.seq - 1, r.seq + 1).toArray()) ids.add(nb.id);
    const rows = this.sql.exec(`SELECT id, at, kind, author, source, text, superseded_by FROM mem_rows WHERE id IN (${[...ids].map(() => "?").join(",")})`, ...ids).toArray()
      .sort((a, b) => (a.at || 0) - (b.at || 0));
    return { rows, topSim, scoped, ms: Date.now() - t0 };
  }
  pack(res, o = {}) {
    const max = o.maxChars ?? 9000; let used = 0; const out = [];
    for (const r of res.rows) {
      const text = scrubSecrets(String(r.text)).slice(0, o.rowChars ?? 1400), d = o.tz ? localDay(r.at, o.tz) : day(r.at);   // a row from before the scrub still recalls without its secret
      const line = `[${d} · ${r.source}${r.superseded_by ? " · SUPERSEDED by a later record" : ""}] ${markStatus(text)}${o.tz ? annotateRecord(text, r.at, o.tz) : ""}`;
      if (used + line.length > max) continue; used += line.length; out.push(line);
    }
    return out.join("\n");
  }
  // "You never said that" check (no model). Specific words in the question (names, numbers, capitalised or rare words) are looked up
  // in the WHOLE channel ledger, not just the pack. Words with no record anywhere are named, so the model says "no record of X"
  // instead of answering around a false premise; named words that DO exist are listed too, so a found person isn't denied.
  coverage(question, extraText = "") {
    const q = String(question || "").replace(/[’]/g, "'"), xt = String(extraText || "").toLowerCase();
    const caps = (q.match(/(?<![.!?]\s|^)\b[A-Z][a-zA-Z'-]{1,}\b/g) || []).filter((w) => !/^(I|I'm|I've|I'd|OK|Mr|Mrs|Ms|Dr|AM|PM|PT|ET|Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December|(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(day|nesday|sday|urday)?|Today|Tomorrow|Yesterday)$/.test(w));
    const nums = q.match(/\$?\d[\d,.:]*%?/g) || [];
    const quoted = (q.match(/"([^"]{2,40})"/g) || []).map((x) => x.slice(1, -1));
    const cand = [...new Set([...caps, ...nums, ...quoted].map((w) => w.replace(/'s$/, "").replace(/[.,:]+$/, "")).filter((w) => w.length > 1))].slice(0, 10);
    const found = [], missing = [];
    for (const w of cand) {
      const ws = terms(w); if (!ws.length) continue;
      let hit = false;
      try { hit = this.sql.exec("SELECT 1 FROM mem_fts WHERE mem_fts MATCH ? LIMIT 1", `"${ws.join(" ").replace(/"/g, "")}"`).toArray().length > 0; } catch {}
      if (!hit && xt.includes(w.toLowerCase())) hit = true;
      (hit ? found : missing).push(w);
    }
    return { found, missing };
  }
  receipt(r) { this.sql.exec("INSERT INTO mem_receipts (at,turn,session,mode,query,ids,top_sim,ms,chars,error) VALUES (?,?,?,?,?,?,?,?,?,?)", Date.now(), r.turn || null, r.session || null, r.mode, scrubSecrets(String(r.query || "")).slice(0, 500), JSON.stringify(r.ids || []), r.topSim ?? null, r.ms ?? null, r.chars ?? null, r.error || null); }
  stats() {
    const c = this.sql.exec("SELECT COUNT(*) n, SUM(vec IS NOT NULL) e, SUM(superseded_by IS NOT NULL) s FROM mem_rows").one();
    const byKind = this.sql.exec("SELECT kind, COUNT(*) n FROM mem_rows GROUP BY kind").toArray();
    return { rows: c.n, embedded: c.e || 0, superseded: c.s || 0, byKind, receipts: this.sql.exec("SELECT id, at, turn, mode, query, ids, top_sim, ms, chars, error FROM mem_receipts ORDER BY id DESC LIMIT 10").toArray() };
  }
}
// "Near me" (places-search, eval 10-07: "seafood near me" asked "what city?" while the channel's Notebook held the home address):
// the message itself shares no words with "Home is in Rockridge, Oakland", so the recall query also asks for where they live or stay.
export const NEAR_ME_RE = /\b(near (me|us|here|my (place|house|home|apartment|flat|hotel|office))|nearby|close (to|by) (me|us|here)|around (me|here|us)|in my (area|neighbou?rhood|city|town)|local(ly)?|walking distance|within \d+ (miles?|km|minutes?))\b/i;
export const LOCATION_HINT = " (where the person lives or is staying: home, home address, neighborhood, city)";
export const withLocationHint = (q, text) => NEAR_ME_RE.test(String(text || "")) ? `${q}${LOCATION_HINT}` : q;
export const PACK_HEADER = "(Memory recall for this message, not from the person: records from earlier work in this channel, oldest first, each with its date (the person's time zone) and source; relative words inside a record (\"yesterday\") have their real date in [brackets]. Newer dates win unless the question is about an earlier time; SUPERSEDED means a later record replaced it. Use them when relevant and ignore the rest. If they don't hold the answer and recall_history can't find it either, say you have no record rather than guessing. If the question names something memory has no record of, say so plainly (\"I have no record of X\") instead of answering around it; if memory has records about a person or thing the question names, answer from them even if they don't cover every part of the question.)"
  + "\n(Connection-state exception: recalled SSH/Tailscale login and connection notes are historical, even the newest ones; this memory context has not checked current membership. Call native_network with operation status before claiming connected or not signed in. Unchecked or unavailable current state is unknown, not disconnected.)";
