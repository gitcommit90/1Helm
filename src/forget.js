// forget (skill B2, src/skills/forget/): remove something from memory when the person asks, and stop it coming back.
// One tool, two calls, like Muse's plan → confirm:
//   forget({ keywords })                       → the plan: everything memory holds that matches, with ids. Changes nothing.
//   forget({ keywords, ids, confirmed: true }) → after the person's clear yes: deletes the listed items, sweeps what memory drew
//                                                from conversation turns that mention it, adds a "forgotten" entry so nothing
//                                                re-learns it, then checks again and reports what (if anything) is still there.
// What it covers, per channel (General: every channel, the memory wall's one exception):
//   - Notebook notes (Archive memory_items, ids m:<note>) and their memory copies (deleteNote's path: ledger rows + Hindsight doc);
//   - saved facts in the channel ledger (u: background upkeep, r: older remember rows), and the supersession chain around each;
//   - Hindsight memories (hs:<id>): the document they came from is deleted, which removes every memory and observation drawn
//     from it; documents are re-deleted later in case an async retain lands after (deletion.js hs_forget);
//   - Contacts facts (contact:<person>:<fact>, a real DELETE, not the Contacts screen's hide); the pinned nightly guidance
//     ("reflection", General's Notebook; rewritten the next night from words that no longer include it);
//   - automatically: every conversation turn whose words match loses its memory copies (ledger rows t:<turn>:*, Hindsight
//     turn-<turn>), and the background-job logs (D1 memjob_runs) and recall receipts that quote it are scrubbed.
//     The visible chat itself stays (deleting a chat is the person's own action in the app).
// The "forgotten" list (table `forgotten` in each channel's Resident) holds only hashes of the keywords, never the text. Everything
// that learns checks it: the background memory jobs (memjobs*.js: turns that match are redacted before any model sees them, and a
// claim that matches is dropped without logging its text), and the end-of-turn capture into the ledger + Hindsight (a matching turn
// is not saved to memory). `remember` lifts an entry when the person asks to have that remembered again.
import { hsOn, hs } from "./hindsight.js";
import { hsForgetDocs } from "./deletion.js";
import { terms } from "./memory.js";
import { hasSecret, scrubSecrets, scrubDeep, secretKinds } from "./secrets-scrub.js";

const MAX_IDS = 40, MAX_KEYS = 12, PLAN_MAX = 40;
export const REDACTED = "(removed: the person asked to forget what was said here)";
const SCRUBBED = "(removed: forgotten at the person's request)";

// ---------- keys: hashed words, so the forgotten list never stores the subject ----------
const RE = /[a-z0-9][a-z0-9.$%+-]*[a-z0-9%]|[a-z0-9]/g;
const stem = (w) => (w.length > 4 && /ies$/.test(w) ? `${w.slice(0, -3)}y` : w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);   // "pregnancies" = "pregnancy", "dates" = "date"
const words = (s) => (String(s ?? "").toLowerCase().replace(/[’']s\b/g, "").match(RE) || []).map(stem);
function h53(str, seed = 0x1c4f) {   // cyrb53: a small stable 53-bit hash (not for secrecy against guessing; it keeps plain text out of storage)
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const hk = (w) => h53(`1hc-forget:${w}`);
// keywords (words or short phrases) → [[hash, …] per phrase]. A phrase matches a text when every one of its words is in it.
export function forgetKeys(keywords = []) {
  const out = [];
  for (const k of (Array.isArray(keywords) ? keywords : [keywords]).slice(0, MAX_KEYS)) {
    const ws = [...new Set(terms(String(k ?? "").slice(0, 80)).map((w) => stem(w.replace(/'s$/, ""))))].filter(Boolean).slice(0, 6);
    if (ws.length) out.push(ws.map(hk));
  }
  return out;
}
const textHashes = (t) => new Set(words(t).map(hk));
// entries: [{ keys: [[…]] }] (forgottenEntries). True when any phrase of any entry is in the text.
export function matchesKeys(keys, text, H = null) { if (!keys?.length || !String(text ?? "").trim()) return false; const s = H || textHashes(text); return keys.some((p) => p.length && p.every((x) => s.has(x))); }
export function isForgotten(entries, text) { if (!entries?.length || !String(text ?? "").trim()) return false; const H = textHashes(text); return entries.some((e) => matchesKeys(e.keys, text, H)); }
// The person's turns as the memory jobs read them: a turn that matches has its words replaced, so no model sees them and no quote
// can cite them. The turn stays in place, so the jobs' cursors move past it as usual.
export function redactTurns(entries, turns = []) {
  if (!entries?.length) return turns;
  return turns.map((t) => (isForgotten(entries, t.user_text) || isForgotten(entries, t.reply) ? { ...t, user_text: REDACTED, reply: "" } : t));
}
// Any string inside a JSON value that matches is replaced (the background-job logs). → [value, changed?]
export function scrubJson(v, entries) {
  let n = 0;
  const walk = (x) => typeof x === "string" ? (isForgotten(entries, x) ? (n++, SCRUBBED) : x) : Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x;
  const out = walk(v); return [out, n];
}

// ---------- the list, per channel (Resident SQLite) ----------
export function forgottenInit(sql) { sql.exec("CREATE TABLE IF NOT EXISTS forgotten (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, keys TEXT NOT NULL, origin TEXT, removed INTEGER NOT NULL DEFAULT 0)"); }
export function forgottenEntries(sql) {
  try { return sql.exec("SELECT id, at, keys, origin FROM forgotten ORDER BY id").toArray().map((r) => { let keys = []; try { keys = JSON.parse(r.keys); } catch {} return { id: r.id, at: r.at, origin: r.origin, keys }; }); }
  catch { return []; }
}
export function addForgotten(sql, keys, origin = "here", removed = 0) {
  forgottenInit(sql);
  const s = JSON.stringify(keys);
  if (sql.exec("SELECT 1 FROM forgotten WHERE keys=?", s).toArray().length) return false;
  sql.exec("INSERT INTO forgotten (at, keys, origin, removed) VALUES (?,?,?,?)", Date.now(), s, origin, removed); return true;
}
// remember: the person asked to have it remembered again → entries that match the fact are lifted. → how many.
export function liftForgotten(sql, text) {
  const hit = forgottenEntries(sql).filter((e) => isForgotten([e], text));
  for (const e of hit) sql.exec("DELETE FROM forgotten WHERE id=?", e.id);
  return hit.length;
}

// ---------- the tool ----------
export const FORGET_TOOL = { type: "function", function: { name: "forget",
  description: "Remove something from memory when the person asks you to forget it, and stop it coming back. Read the forget skill first. Call it first with keywords only: that returns the plan (everything memory holds that matches, with ids) and changes nothing. Show the person what will go, ask one yes/no question, and only after a clear yes call it again with the same keywords, the ids to delete and confirmed: true. Deleting is permanent.",
  parameters: { type: "object", properties: {
    keywords: { type: "array", items: { type: "string" }, description: "2-8 words or short phrases that identify the subject, with variants (e.g. \"pregnant\", \"pregnancy\", \"due date\"). Background memory skips anything containing them from now on." },
    ids: { type: "array", items: { type: "string" }, description: "Only with confirmed: the ids from the plan (or from memory_explain) the person agreed to delete" },
    confirmed: { type: "boolean", description: "true only after the person clearly said yes to this exact plan" } }, required: ["keywords"] } } };

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = one(s); return s.length > n ? `${s.slice(0, n)}…` : s; };
const has = (sql, t) => { try { return sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t).toArray().length > 0; } catch { return false; } };
const day = (ms, tz) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(ms)); } catch { return ""; } };
const CURATED = ["fact", "notebook", "memory"];
// A Contacts fact this channel may see (people.js recall): what the person typed in Contacts, or learned here; General sees all.
const visibleFact = (f, me, general) => general || /^You /.test(f.src || "") || f.channel === me;

// What one channel holds that matches (inside that channel's Resident). → { items: [{ id, kind, text, where }], turns: [ids], workflows, files }
export async function planLocal(res, keys, o = {}) {
  const sql = res.sql, tz = res.tz(), items = [], seen = new Set(), pre = o.prefix || "";
  const add = (id, kind, text, where) => { if (seen.has(id) || items.length >= PLAN_MAX) return; seen.add(id); items.push({ id: `${pre}${id}`, kind, text: clip(text, 220), where }); };
  // 1. saved facts and Notebook copies in the ledger (current or replaced: a replaced version still says it)
  if (has(sql, "mem_rows")) for (const r of sql.exec(`SELECT id, at, kind, author, source, text FROM mem_rows WHERE kind IN (${CURATED.map(() => "?").join(",")}) ORDER BY at DESC LIMIT 3000`, ...CURATED).toArray()) {
    if (!matchesKeys(keys, r.text)) continue;
    const base = String(r.id).startsWith("m:") ? String(r.id).replace(/@\d+$/, "") : r.id;
    if (base === "m:reflect-how") continue;   // General's pinned nightly note (memjobs-reflect REFLECT_ID): planned as "reflection"
    add(base, base.startsWith("m:") ? "note" : "fact", r.text, `${base.startsWith("m:") ? "Notebook" : r.author === "upkeep" ? "saved by background memory upkeep" : "saved fact"}, ${day(r.at, tz)}`);
  }
  // 2. Hindsight (this channel's bank): memories drawn from saved facts or from conversations
  let hsNote = null;
  if (hsOn(res.env) && o.query) {
    try {
      const r = await hs(res.env, `/v1/default/banks/${encodeURIComponent(res.hsBankId())}/memories/recall`, { method: "POST", body: { query: String(o.query).slice(0, 500), budget: "mid", max_tokens: 2500 }, timeoutMs: 8000 }).catch((e) => { if (e.status === 404) return { results: [] }; throw e; });
      for (const m of r?.results || []) {
        if (!matchesKeys(keys, m.text)) continue;
        const doc = String(m.document_id || "");
        if (doc.startsWith("fact-") && seen.has(doc.slice(5).replace(/@\d+$/, ""))) continue;   // goes with that fact
        if (doc.startsWith("turn-")) continue;                                                   // goes with the conversation sweep below
        add(`hs:${m.id}`, "memory", m.text, `memory drawn ${m.type === "observation" ? "from several records" : "from a saved record"}`);
      }
    } catch (e) { hsNote = `Hindsight (the main memory) couldn't be searched right now (${clip(e.message, 100)}).`; }
  }
  // 3. conversation turns that mention it: what memory drew from them goes automatically (the chat itself stays)
  const turns = [];
  if (has(sql, "turns")) for (const t of sql.exec("SELECT id, user_text, reply FROM turns ORDER BY at DESC LIMIT 5000").toArray())
    if (matchesKeys(keys, t.user_text) || matchesKeys(keys, t.reply)) turns.push(t.id);
  // 4. things that can bring it back or still show it: scheduled work and Library files (reported, not changed)
  const workflows = has(sql, "workflows") ? sql.exec("SELECT id, kind, name, prompt, notes, status FROM workflows WHERE status IN ('active','paused')").toArray().filter((w) => matchesKeys(keys, `${w.name}\n${w.prompt}\n${w.notes || ""}`)).map((w) => ({ id: w.id, kind: w.kind, name: w.name, status: w.status })) : [];
  const files = has(sql, "files") ? sql.exec("SELECT name FROM files WHERE deleted=0").toArray().filter((f) => matchesKeys(keys, String(f.name).replace(/[._-]+/g, " "))).map((f) => f.name).slice(0, 10) : [];
  return { items, turns, workflows, files, note: hsNote };
}

// Contacts facts (account-wide registry, in the Archive) that match and that this channel may see. General sees all.
async function planContacts(res, keys, general) {
  const me = res.get("channel"), out = [];
  let list = []; try { list = await res.archive().peopleList(); } catch { return out; }
  for (const p of list) for (const f of p.facts || []) {
    if (!visibleFact(f, me, general)) continue;
    if (matchesKeys(keys, `${p.name}: ${f.text}`)) out.push({ id: `contact:${p.id}:${f.id}`, kind: "contact fact", text: clip(`${p.name}: ${f.text}`, 220), where: /^You /.test(f.src || "") ? "Contacts (they added it)" : `Contacts, learned in #${f.channel || "chat"}` });
  }
  return out.slice(0, 20);
}

// Delete in this channel (inside its Resident). ids: local ids. → { removed: { notes, facts, memories, turns }, missing: [ids] }
export async function executeLocal(res, keys, ids = [], o = {}) {
  const sql = res.sql, removed = { notes: 0, facts: 0, memories: 0, turns: 0, logs: 0 }, missing = [], docs = new Set();
  const del = (id) => { if (!has(sql, "mem_rows")) return 0; const n = sql.exec("SELECT COUNT(*) n FROM mem_rows WHERE id=?", id).one()?.n || 0; sql.exec("DELETE FROM mem_rows WHERE id=?", id); try { sql.exec("DELETE FROM mem_fts WHERE id=?", id); } catch {} return n; };
  // The chain: every version linked by superseded_by, both ways (a replaced version still says it).
  const chain = (id) => { const out = new Set([id]), q = [id]; while (q.length && out.size < 12) { const x = q.shift();
    for (const r of sql.exec("SELECT id, superseded_by FROM mem_rows WHERE id=? OR superseded_by=?", x, x).toArray()) for (const y of [r.id, r.superseded_by]) if (y && !out.has(y) && sql.exec("SELECT 1 FROM mem_rows WHERE id=?", y).toArray().length) { out.add(y); q.push(y); } }
    return [...out]; };
  const noteIds = new Set();
  for (const raw of ids) {
    const id = String(raw);
    if (id.startsWith("hs:")) {
      if (!hsOn(res.env)) { missing.push(id); continue; }
      try {
        const m = await hs(res.env, `/v1/default/banks/${encodeURIComponent(res.hsBankId())}/memories/${encodeURIComponent(id.slice(3))}`, { timeoutMs: 6000 });
        let srcDocs = m?.document_id ? [m.document_id] : (m?.source_memories || []).map((s) => s.document_id).filter(Boolean);
        // An observation (a summary of several memories): the documents of the memories it was built from (Hindsight 0.10.2 names
        // them source_memory_ids; its source_memories carry no document_id).
        const srcIds = m?.source_memory_ids || m?.source_fact_ids || (m?.source_memories || []).map((s) => s.id).filter(Boolean);
        if (!srcDocs.length && Array.isArray(srcIds)) for (const sid of srcIds.slice(0, 8)) { try { const x = await hs(res.env, `/v1/default/banks/${encodeURIComponent(res.hsBankId())}/memories/${encodeURIComponent(sid)}`, { timeoutMs: 6000 }); if (x?.document_id) srcDocs.push(x.document_id); } catch {} }
        for (const d of srcDocs) { docs.add(d); if (String(d).startsWith("fact-")) ids.push(String(d).slice(5)); if (String(d).startsWith("turn-")) o.turns = [...(o.turns || []), String(d).slice(5)]; }
        removed.memories++;
      } catch (e) { missing.push(id); }
      continue;
    }
    if (!has(sql, "mem_rows") || !sql.exec("SELECT 1 FROM mem_rows WHERE id=? OR id LIKE ?", id, `${id}@%`).toArray().length) { if (!id.startsWith("m:")) { missing.push(id); continue; } }
    for (const x of id.startsWith("m:") ? [id] : chain(id)) {
      if (x.startsWith("m:")) { noteIds.add(x.slice(2).replace(/@\d+$/, "")); continue; }
      if (x.startsWith("t:")) { o.turns = [...(o.turns || []), x.split(":")[1]]; continue; }
      if (del(x)) removed.facts++;
      docs.add(`fact-${x}`);
      if (x.startsWith("u:") && has(sql, "mj_cites")) sql.exec("DELETE FROM mj_cites WHERE ref=?", x);
      if (x.startsWith("s:") && has(sql, "mem_segments")) sql.exec("DELETE FROM mem_segments WHERE id=?", x);
    }
  }
  // Notebook notes: the note itself (Archive) and its memory copies (the same path as Delete in the Notebook).
  for (const nid of noteIds) {
    let gone = 0; try { if (o.channelId != null) gone = (await res.archive().noteDelete(String(o.channelId), nid))?.deleted || 0; } catch (e) { console.log("forget note", e.message); }
    const m = await res.noteForget(nid); for (const d of m.hsDocs || []) docs.add(d);
    if (gone || m.rows) removed.notes++; else missing.push(`m:${nid}`);
  }
  // Conversation turns that mention it (the sweep) + any a memory pointed at: their memory copies, not the visible chat.
  const turns = [...new Set([...(o.turns || [])])];
  for (const t of turns) {
    if (has(sql, "mem_rows")) { const rows = sql.exec("SELECT id FROM mem_rows WHERE id LIKE ?", `t:${t}:%`).toArray(); for (const r of rows) del(r.id); }
    docs.add(`turn-${t}`); removed.turns++;
  }
  // Recall receipts quote the person's message: drop the ones that match.
  if (has(sql, "mem_receipts")) for (const r of sql.exec("SELECT id, query FROM mem_receipts").toArray()) if (matchesKeys(keys, r.query)) sql.exec("DELETE FROM mem_receipts WHERE id=?", r.id);
  // Hindsight: delete now, and again later in case an asynchronous retain lands afterwards.
  if (hsOn(res.env) && docs.size) { try { await hsForgetDocs(res.env, res.hsBankId(), [...docs]); } catch (e) { console.log("forget hindsight", e.message); o.hsError = e.message; } }
  // The background jobs' run log (dev D1) quotes facts and words: scrub what matches.
  removed.logs = await scrubLogs(res, [{ keys }]);
  addForgotten(sql, keys, o.origin || "here", removed.notes + removed.facts + removed.memories + removed.turns);
  return { removed, missing, hsError: o.hsError || null };
}
async function scrubLogs(res, entries) {
  try {
    const rows = (await res.env.DB.prepare("SELECT id, changes, steps FROM memjob_runs WHERE tenant_id=? AND channel=? ORDER BY started_at DESC LIMIT 500").bind(res.get("tenant"), res.get("channel")).all())?.results || [];
    let n = 0;
    for (const r of rows) {
      let c, s; try { c = JSON.parse(r.changes || "[]"); s = JSON.parse(r.steps || "[]"); } catch { continue; }
      const [c2, a] = scrubJson(c, entries), [s2, b] = scrubJson(s, entries);
      if (a + b) { await res.env.DB.prepare("UPDATE memjob_runs SET changes=?, steps=? WHERE id=?").bind(JSON.stringify(c2), JSON.stringify(s2), r.id).run(); n++; }
    }
    return n;
  } catch { return 0; }   // no log table yet
}

// ---------- nosecrets: clear secrets already in memory (dev ops: POST /_ops/secrets-sweep) ----------
// One channel, inside its Resident. The same machinery as forget: Notebook notes and saved facts that hold a secret are deleted
// (noteDelete + noteForget, ledger rows + their search copies), and every Hindsight document that holds one is deleted now and again
// later (hsForgetDocs), which removes the memories and observations drawn from it. What memory drew from a conversation turn is
// scrubbed in place instead (ledger turn rows, hand-off notes, work log summaries, recall receipts, job evidence, job logs), so the
// rest of that turn stays remembered; its Hindsight document goes. The visible chat (msgs, turns.user_text) is not changed.
// Returns counts and kinds only, never the secrets. dry: count, change nothing. general: also Contacts facts (account-wide).
const HS_SCAN_MAX = 5000;
export async function sweepSecretsLocal(res, o = {}) {
  const sql = res.sql, dry = !!o.dry, docs = new Set(), kinds = {}, errors = [];
  const out = { notebook_notes: 0, saved_facts: 0, ledger_rows_scrubbed: 0, hand_off_notes: 0, chat_turns_with_secrets: 0, work_log_rows: 0, receipts: 0, job_evidence: 0, job_logs: 0, contacts_facts: 0, hindsight_memories: 0, hindsight_docs: 0, hindsight_memories_edited: 0, hindsight_observations_cleared: 0 };
  const seen = (t) => { for (const [k, n] of Object.entries(secretKinds(t))) kinds[k] = (kinds[k] || 0) + n; };
  const delRow = (id) => { sql.exec("DELETE FROM mem_rows WHERE id=?", id); try { sql.exec("DELETE FROM mem_fts WHERE id=?", id); } catch {} };
  const scrubRow = (r) => { const t = scrubSecrets(r.text); sql.exec("UPDATE mem_rows SET text=?, source=?, vec=NULL WHERE id=?", t, scrubSecrets(r.source || ""), r.id); try { sql.exec("DELETE FROM mem_fts WHERE id=?", r.id); sql.exec("INSERT INTO mem_fts (text,id) VALUES (?,?)", `${scrubSecrets(r.source || "")} ${t}`, r.id); } catch {} };
  // 1. Notebook notes (this channel's, the person's own and the helper's): deleted with their memory copies, like Delete in the Notebook.
  const cid = o.channelId ?? res.get("channel_id"), noted = new Set();
  if (cid != null) {
    let notes = []; try { notes = (await res.archive().channel(String(cid), 1))?.memory || []; } catch (e) { errors.push(`notebook: ${clip(e.message, 100)}`); }
    for (const n of notes) { if (!hasSecret(n.content)) continue; seen(n.content); out.notebook_notes++; noted.add(`m:${n.id}`); docs.add(`fact-m:${n.id}`);
      if (!dry) { try { await res.archive().noteDelete(String(cid), n.id); const m = await res.noteForget(String(n.id)); for (const d of m.hsDocs || []) docs.add(d); } catch (e) { errors.push(`note: ${clip(e.message, 100)}`); } } }
  }
  // 2. The ledger: saved facts (remember, upkeep, Notebook copies, summaries of facts) are deleted; rows drawn from a turn are scrubbed.
  if (has(sql, "mem_rows")) for (const r of sql.exec("SELECT id, kind, source, text FROM mem_rows").toArray()) {
    if (!hasSecret(r.text) && !hasSecret(r.source)) continue; seen(`${r.source || ""} ${r.text}`);
    const id = String(r.id), turn = id.match(/^t:([^:]+):/)?.[1];
    if (noted.has(id.replace(/@\d+$/, ""))) continue;   // went with its Notebook note
    if (turn || id.startsWith("b:") || r.kind === "summary") { out.ledger_rows_scrubbed++; if (turn) docs.add(`turn-${turn}`); if (turn && id.endsWith(":p")) docs.add(`partial-${turn}`); if (!dry) scrubRow(r); continue; }
    out.saved_facts++; docs.add(`fact-${id}`);
    if (!dry) { delRow(id); if (id.startsWith("u:") && has(sql, "mj_cites")) sql.exec("DELETE FROM mj_cites WHERE ref=?", id); sql.exec("UPDATE mem_rows SET superseded_by=NULL WHERE superseded_by=?", id); }
  }
  // 3. Conversation turns: what the person typed stays in the chat, but the turn's Hindsight document held it; hand-off notes are scrubbed.
  if (has(sql, "turns")) for (const t of sql.exec("SELECT id, user_text, reply, notes FROM turns").toArray()) {
    const inChat = hasSecret(t.user_text) || hasSecret(t.reply), inNotes = hasSecret(t.notes);
    if (!inChat && !inNotes) continue;
    if (inChat) { out.chat_turns_with_secrets++; seen(`${t.user_text || ""} ${t.reply || ""}`); }
    if (inNotes) { out.hand_off_notes++; seen(t.notes); if (!dry) sql.exec("UPDATE turns SET notes=? WHERE id=?", scrubSecrets(t.notes), t.id); }
    docs.add(`turn-${t.id}`);
  }
  // 4. The work log's summaries and unfinished-work notes (the full saved results are the raw work, like the chat, and age out in 7 days).
  if (has(sql, "work_log")) for (const w of sql.exec("SELECT id, query, terms, args, hits, note FROM work_log").toArray()) {
    if (![w.query, w.args, w.hits, w.note].some(hasSecret)) continue; out.work_log_rows++; seen([w.query, w.args, w.hits, w.note].join(" "));
    if (!dry) sql.exec("UPDATE work_log SET query=?, terms=?, args=?, hits=?, note=? WHERE id=?", scrubSecrets(w.query), scrubSecrets(w.terms), scrubSecrets(w.args), scrubSecrets(w.hits), w.note == null ? null : scrubSecrets(w.note), w.id);
  }
  if (has(sql, "work_log_partial")) for (const w of sql.exec("SELECT turn, text FROM work_log_partial").toArray()) {
    if (!hasSecret(w.text)) continue; out.work_log_rows++; seen(w.text); docs.add(`partial-${w.turn}`);
    if (!dry) sql.exec("UPDATE work_log_partial SET text=? WHERE turn=?", scrubSecrets(w.text), w.turn);
  }
  // 5. Recall receipts (they quote the person's message) and the background jobs' evidence (quotes of the person's words).
  if (has(sql, "mem_receipts")) for (const r of sql.exec("SELECT id, query FROM mem_receipts").toArray()) if (hasSecret(r.query)) { out.receipts++; seen(r.query); if (!dry) sql.exec("UPDATE mem_receipts SET query=? WHERE id=?", scrubSecrets(r.query), r.id); }
  if (has(sql, "mj_cites")) for (const r of sql.exec("SELECT ref, data FROM mj_cites").toArray()) if (hasSecret(r.data)) { out.job_evidence++; seen(r.data); if (!dry) { let d; try { d = JSON.parse(r.data); } catch { d = null; } sql.exec("UPDATE mj_cites SET data=? WHERE ref=?", d ? JSON.stringify(scrubDeep(d)[0]) : JSON.stringify({ scrubbed: true }), r.ref); } }
  // 6. Hindsight (API 0.10.2 on the dev box: there is no DELETE for a single memory). Every memory in the bank whose text holds a
  //    secret is cleared by the route that fits it:
  //    - it came from a document (world / experience facts): that document is deleted, which also deletes every observation built
  //      on its memories (Hindsight sweeps them before and after the cascade);
  //    - an observation (no document of its own): the documents of its source memories (source_memory_ids) are deleted; a source
  //      with no document has its observations cleared (DELETE /memories/<id>/observations) and, if it holds the secret too, its
  //      text replaced by the scrubbed text (PATCH, which re-embeds it and drops what was derived from it);
  //    - a fact with no document: PATCH its text to the scrubbed text.
  //    Documents are counted and deleted only if they're still in the bank (one paged listing), so a dry run after a sweep reads 0.
  if (hsOn(res.env)) {
    const B = `/v1/default/banks/${encodeURIComponent(res.hsBankId())}`, enc = encodeURIComponent;
    const get = (id) => hs(res.env, `${B}/memories/${enc(id)}`, { timeoutMs: 8000 });
    const patch = [], clearObs = new Set();
    try {
      for (let off = 0; off < HS_SCAN_MAX; off += 100) {
        const r = await hs(res.env, `${B}/memories/list?limit=100&offset=${off}`, { timeoutMs: 15000 }).catch((e) => { if (e.status === 404) return null; throw e; });
        const page = r?.items || [];
        for (const m of page) {
          if (!hasSecret(m.text) && !hasSecret(m.context)) continue; out.hindsight_memories++; seen(`${m.text || ""} ${m.context || ""}`);
          const type = m.fact_type || m.type;
          if (m.document_id) { docs.add(String(m.document_id)); continue; }
          if (type !== "observation") { patch.push(m); continue; }
          let srcIds = Array.isArray(m.source_memory_ids) ? m.source_memory_ids : null;
          if (!srcIds) { try { const x = await get(m.id); srcIds = x?.source_memory_ids || (x?.source_memories || []).map((y) => y.id); } catch (e) { errors.push(`hindsight observation: ${clip(e.message, 100)}`); srcIds = []; } }
          for (const sid of srcIds.slice(0, 20)) {
            try { const y = await get(sid);
              if (y?.document_id) docs.add(String(y.document_id));
              else { clearObs.add(String(sid)); if (hasSecret(y?.text) || hasSecret(y?.context)) patch.push(y); } }
            catch (e) { if (e.status !== 404) errors.push(`hindsight source memory: ${clip(e.message, 100)}`); }   // 404: already gone, its observation goes with it
          }
        }
        if (page.length < 100 || (r?.total != null && off + 100 >= Number(r.total))) break;
      }
    } catch (e) { errors.push(`hindsight scan: ${clip(e.message, 120)}`); }
    // Which of the candidate documents (from local turns / facts / notes and from the scan) are really still in the bank.
    let live = null;
    try { const have = new Set(); for (let off = 0; off < HS_SCAN_MAX; off += 100) { const r = await hs(res.env, `${B}/documents?limit=100&offset=${off}`, { timeoutMs: 15000 }).catch((e) => { if (e.status === 404) return { items: [] }; throw e; });
      for (const d of r?.items || []) have.add(String(d.id)); if ((r?.items || []).length < 100 || (r?.total != null && off + 100 >= Number(r.total))) break; } live = have; }
    catch (e) { errors.push(`hindsight documents: ${clip(e.message, 100)} (deleting every candidate)`); }
    const doomed = live ? [...docs].filter((d) => live.has(d)) : [...docs];
    const uniq = [...new Map(patch.filter(Boolean).map((m) => [String(m.id), m])).values()];
    out.hindsight_docs = doomed.length; out.hindsight_memories_edited = uniq.length; out.hindsight_observations_cleared = clearObs.size;
    if (!dry) {
      if (doomed.length) { try { await hsForgetDocs(res.env, res.hsBankId(), doomed); } catch (e) { errors.push(`hindsight delete: ${clip(e.message, 120)} (retried later)`); } }
      for (const m of uniq) { try { await hs(res.env, `${B}/memories/${enc(m.id)}`, { method: "PATCH", body: { text: scrubSecrets(m.text || ""), ...(hasSecret(m.context) ? { context: scrubSecrets(m.context) } : {}) }, timeoutMs: 15000 }); }
        catch (e) { errors.push(`hindsight memory edit: ${clip(e.message, 100)}`); } }
      for (const sid of clearObs) { try { await hs(res.env, `${B}/memories/${enc(sid)}/observations`, { method: "DELETE", timeoutMs: 15000 }); } catch (e) { if (e.status !== 404) errors.push(`hindsight observations: ${clip(e.message, 100)}`); } }
    }
  }
  // 7. The background jobs' run log (dev D1) for this channel.
  try {
    const rows = (await res.env.DB.prepare("SELECT id, changes, steps FROM memjob_runs WHERE tenant_id=? AND channel=? ORDER BY started_at DESC LIMIT 1000").bind(res.get("tenant"), res.get("channel")).all())?.results || [];
    for (const r of rows) { if (!hasSecret(r.changes) && !hasSecret(r.steps)) continue; out.job_logs++; seen(`${r.changes || ""} ${r.steps || ""}`);
      if (!dry) { let c, st; try { c = JSON.parse(r.changes || "[]"); st = JSON.parse(r.steps || "[]"); } catch { c = scrubSecrets(r.changes); st = scrubSecrets(r.steps); }
        await res.env.DB.prepare("UPDATE memjob_runs SET changes=?, steps=? WHERE id=?").bind(typeof c === "string" ? c : JSON.stringify(scrubDeep(c)[0]), typeof st === "string" ? st : JSON.stringify(scrubDeep(st)[0]), r.id).run(); } }
  } catch {}   // no log table
  // 8. Contacts facts (account-wide; General runs it once for the account): a real delete, as forget does.
  if (o.general) {
    let list = []; try { list = await res.archive().peopleList(); } catch (e) { errors.push(`contacts: ${clip(e.message, 100)}`); }
    for (const p of list) for (const f of p.facts || []) { if (!hasSecret(f.text)) continue; out.contacts_facts++; seen(f.text);
      if (!dry) { try { await res.archive().personFactForget(p.id, f.id); } catch (e) { errors.push(`contacts fact: ${clip(e.message, 100)}`); } } }
  }
  return { channel: res.get("channel"), dry, ...out, kinds, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) };
}

// The tool, in the channel the person is talking in. General fans out to every other channel (it sees across).
export async function forgetTool(res, a = {}, ctx = {}) {
  const kw = (Array.isArray(a.keywords) ? a.keywords : typeof a.keywords === "string" ? a.keywords.split(/[,\n]/) : []).map((k) => one(k)).filter(Boolean).slice(0, MAX_KEYS);
  const keys = forgetKeys(kw);
  if (!keys.length) return "error: keywords are required: 2-8 words or short phrases that identify what to forget (with variants).";
  const me = res.get("channel"), general = !!ctx.general, tz = res.tz();
  const all = await res.archive().channels().catch(() => []), mine = all.find((c) => (c.slug || c.name) === me);
  const others = general ? all.filter((c) => c.kind !== "dm" && (c.slug || c.name) !== me) : [];
  const other = (slug) => res.env.RESIDENT.get(res.env.RESIDENT.idFromName(`res:${res.get("tenant")}:${slug}`));
  const query = kw.join(", ");
  const reflection = await Promise.resolve().then(() => res.archive().reflectionNote()).catch(() => null);
  const reflHit = reflection?.content && matchesKeys(keys, reflection.content);

  if (!a.confirmed) {
    const here = await planLocal(res, keys, { query });
    const there = await Promise.all(others.map(async (c) => { const slug = c.slug || c.name; try { return { slug, name: c.name || slug, ...(await other(slug).forgetPlanHere(kw, { prefix: `${slug}/` })) }; } catch (e) { return { slug, name: c.name || slug, items: [], turns: [], workflows: [], files: [], note: `#${c.name || slug} couldn't be searched (${clip(e.message, 80)})` }; } }));
    const contacts = await planContacts(res, keys, general);
    const items = [...here.items, ...there.flatMap((t) => t.items), ...contacts, ...(reflHit ? [{ id: "reflection", kind: "pinned guidance", text: clip(String(reflection.content).split("\n").filter((l) => matchesKeys(keys, l)).join(" / "), 220), where: "the pinned \"How to work with\" note in General's Notebook (written nightly)" }] : [])];
    const turns = here.turns.length + there.reduce((n, t) => n + t.turns.length, 0);
    const wf = [...here.workflows.map((w) => ({ ...w, ch: me })), ...there.flatMap((t) => t.workflows.map((w) => ({ ...w, ch: t.slug })))];
    const files = [...here.files, ...there.flatMap((t) => t.files)];
    const L = [`(forget plan for: ${kw.map((k) => `"${k}"`).join(", ")}. Nothing has changed yet.${general ? " From General this covers every channel." : ` This covers #${mine?.name || me} only (and Contacts facts it can see); General can forget across all channels.`})`];
    if (items.length) { L.push("Found in memory (pass the ids the person agrees to as ids, with confirmed: true):"); for (const x of items) L.push(`- [id ${x.id}] ${x.kind}: "${x.text}" (${x.where})`); }
    else L.push(general ? "No saved notes, facts or contact facts match." : `No saved notes, facts or contact facts match in #${mine?.name || me}. Don't tell them nothing is saved: if they said it in another channel, it's kept in that channel's notes, which this channel can't see. Tell them they can ask there, or in General, which can forget across all channels.`);
    L.push(turns ? `Also, automatically: what memory drew from ${turns} conversation turn${turns === 1 ? "" : "s"} that mention it. The conversation itself stays visible in the chat (deleting a chat is the person's own action in the app).` : "No conversation turns mention it.");
    if (wf.length) L.push(`Scheduled work that mentions it (forget doesn't change these; ask the person, then pause or complete with set_workflow_status): ${wf.map((w) => `#${w.id} "${clip(w.name, 60)}" (${w.status}${w.ch !== me ? `, in #${w.ch}` : ""})`).join("; ")}.`);
    if (files.length) L.push(`Files in the Library whose names mention it (not changed; the person can delete them in the Library): ${files.map((f) => `"${clip(f, 60)}"`).join(", ")}.`);
    for (const n of [here.note, ...there.map((t) => t.note)].filter(Boolean)) L.push(n);
    L.push("From then on, background memory skips anything containing these keywords, and turns that mention them aren't saved to memory. Next: tell the person in plain words what will be removed and what stays, ask one yes/no question, and call forget again with confirmed: true only after a clear yes. Don't repeat the details back more than needed.");
    return L.join("\n").slice(0, 9000);
  }

  // Confirmed: delete, sweep, suppress, check again.
  const want = (Array.isArray(a.ids) ? a.ids : []).map((x) => one(x)).filter(Boolean).slice(0, MAX_IDS);
  const local = [], remote = new Map(), contactIds = [], bad = [];
  let refl = false;
  for (const id of want) {
    if (id === "reflection") { refl = true; continue; }
    if (id.startsWith("contact:")) { contactIds.push(id); continue; }
    const k = id.indexOf("/");
    if (k > 0 && id.slice(0, k) !== me) {
      if (!general) { bad.push(`${id} (another channel's memory: forget it from that channel, or from General)`); continue; }
      const slug = id.slice(0, k); if (!others.some((c) => (c.slug || c.name) === slug)) { bad.push(`${id} (no such channel)`); continue; }
      if (!remote.has(slug)) remote.set(slug, []); remote.get(slug).push(id.slice(k + 1)); continue;
    }
    local.push(k > 0 ? id.slice(k + 1) : id);
  }
  const sweep = (await planLocal(res, keys, {})).turns;
  const R = await executeLocal(res, keys, local, { turns: sweep, channelId: res.get("channel_id"), origin: general ? "general" : "here" });
  const tot = { ...R.removed }, missing = [...R.missing], errs = R.hsError ? [`Hindsight: ${clip(R.hsError, 100)} (it will be retried)`] : [];
  // General: every other channel forgets too (its own ids, its own sweep, its own forgotten entry), since General sees across.
  for (const c of others) {
    const slug = c.slug || c.name;
    try { const r = await other(slug).forgetHere(kw, remote.get(slug) || [], { origin: "general" }); for (const [k2, v] of Object.entries(r.removed || {})) tot[k2] = (tot[k2] || 0) + v; missing.push(...(r.missing || []).map((x) => `${slug}/${x}`)); if (r.hsError) errs.push(`#${c.name || slug}: Hindsight retry pending`); }
    catch (e) { errs.push(`#${c.name || slug}: ${clip(e.message, 80)}`); }
  }
  // Contacts facts: a real delete (the fact row and its search copy).
  let cf = 0;
  for (const id of contactIds) {
    const [, pid, fid] = id.split(":");
    try { const p = await res.archive().personGet(pid), f = p?.facts?.find((x) => x.id === fid);
      if (!f) { missing.push(id); continue; }
      if (!visibleFact(f, me, general)) { bad.push(`${id} (learned in another channel: forget it from there or from General)`); continue; }
      const r = await res.archive().personFactForget(pid, fid); cf += r?.deleted || 0; }
    catch (e) { errs.push(`Contacts: ${clip(e.message, 80)}`); }
  }
  // The pinned nightly guidance: removed now; tonight's reflection rewrites it from words that no longer include this.
  if (refl && reflection) {
    try { const g = all.find((c) => (c.slug || c.name) === "main"); if (g) { await res.archive().noteDelete(String(g.id), reflection.id); const G = me === "main" ? res : other("main"); await G.noteForget(reflection.id); tot.notes++; } }
    catch (e) { errs.push(`pinned guidance: ${clip(e.message, 80)}`); }
  }
  // Check again from fresh state.
  const after = await planLocal(res, keys, { query });
  const afterOthers = general ? (await Promise.all(others.map(async (c) => { const slug = c.slug || c.name; try { return (await other(slug).forgetPlanHere(kw, { prefix: `${slug}/` })).items; } catch { return []; } }))).flat() : [];
  const left = [...after.items, ...afterOthers, ...(await planContacts(res, keys, general))];
  const reflLeft = !refl && reflection?.content && matchesKeys(keys, reflection.content);
  const parts = [tot.notes && `${tot.notes} Notebook note${tot.notes === 1 ? "" : "s"}`, tot.facts && `${tot.facts} saved fact${tot.facts === 1 ? "" : "s"}`, tot.memories && `${tot.memories} memor${tot.memories === 1 ? "y" : "ies"}`, cf && `${cf} Contacts fact${cf === 1 ? "" : "s"}`, tot.turns && `what memory drew from ${tot.turns} conversation turn${tot.turns === 1 ? "" : "s"}`].filter(Boolean);
  const L = ["(forget done. Report it without repeating the forgotten details.)", parts.length ? `Removed: ${parts.join(", ")}.` : "Nothing matching was stored, so nothing needed removing."];
  L.push(`Background memory ${general ? "in every channel" : "in this channel"} now skips anything containing these keywords, and turns that mention them aren't saved to memory${tot.logs ? "; background-job logs that quoted it were cleaned" : ""}.`);
  if (missing.length) L.push(`Not found (already gone, or not an id from the plan): ${missing.slice(0, 10).join(", ")}.`);
  if (bad.length) L.push(`Not done: ${bad.join("; ")}.`);
  if (errs.length) L.push(`Problems: ${errs.join("; ")}.`);
  if (left.length || reflLeft) L.push(`Still in memory (not in the ids you passed): ${[...left.map((x) => `[id ${x.id}] ${x.kind}: "${x.text}"`), ...(reflLeft ? ["[id reflection] pinned guidance"] : [])].slice(0, 12).join("; ")}. Ask the person whether these should go too before calling forget again.`);
  else L.push("Checked again: nothing matching is left in memory.");
  if (after.workflows.length) L.push(`Scheduled work still mentions it: ${after.workflows.map((w) => `#${w.id} "${clip(w.name, 60)}"`).join(", ")} (unchanged).`);
  L.push("Tell the person what was removed, that memory won't pick it up again from new conversations, and what stays, in plain words, without repeating the forgotten details. Say \"forgotten\" only if nothing is left above.");
  return L.join("\n").slice(0, 6000);
}
