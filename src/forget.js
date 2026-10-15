// Clearing secrets already in memory (dev ops: POST /_ops/secrets-sweep, sweepSecretsLocal), and the helpers it uses.
// There is no "forget" tool: when the person says "forget it", that is an ordinary turn, retained like any other. Nothing is deleted,
// skipped or redacted because of it (Captain 2026-10-15). The person deletes things themselves in the app (Library, Notebook, Contacts, chats).
// The old `forgotten` table stays in each channel's Resident so no storage changes in this deploy, but nothing reads it.
import { hsOn, hs } from "./hindsight.js";
import { forgetMemoryDocs } from "./deletion.js";
import { hsWriters, docKind } from "./hindsight-writers.js";   // HS_WRITERS: a conversation document is written again without the forgotten turns, not deleted whole
import { terms } from "./memory.js";
import { hasSecret, scrubSecrets, scrubDeep, secretKinds } from "./secrets-scrub.js";



export function forgottenInit(sql) { sql.exec("CREATE TABLE IF NOT EXISTS forgotten (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, keys TEXT NOT NULL, origin TEXT, removed INTEGER NOT NULL DEFAULT 0)"); }
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = one(s); return s.length > n ? `${s.slice(0, n)}…` : s; };
const has = (sql, t) => { try { return sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t).toArray().length > 0; } catch { return false; } };
const day = (ms, tz) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(ms)); } catch { return ""; } };
const CURATED = ["fact", "notebook", "memory"];

// Forgotten text or a secret must never stay in Hindsight. A conversation document is written again without it; if that fails, the documents are
// deleted instead (forgetDocument now plus an hs_forget row for the delayed re-delete, like any other document, and their queued writes go too).
// -> { rewritten, deleted, fellBack, error }  (error only when the fallback failed as well)
export async function rewriteOrDelete(res, docs, exclude = []) {
  try { const r = await res.hsConvRewrite(docs, exclude); return { rewritten: r?.rewritten || 0, deleted: r?.dropped || 0, fellBack: false }; }
  catch (e) {
    console.log("forget conversation rewrite failed, deleting the documents", e.message);
    try { await res.hsDropDocs(docs); return { rewritten: 0, deleted: docs.length, fellBack: true }; }
    catch (e2) { return { rewritten: 0, deleted: 0, fellBack: true, error: e2.message }; }
  }
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
    docs.add(`turn-${t.id}`); if (hsWriters(res.env)) for (const d of res.hsConvDocsOfTurns([t.id])) docs.add(d);
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
    let doomed = live ? [...docs].filter((d) => live.has(d)) : [...docs];
    // HS_WRITERS: a conversation document that holds a secret is written again (its text is scrubbed when it is built), not deleted with the whole day.
    const convRewrite = hsWriters(res.env) ? doomed.filter((d) => docKind(d) === "conv") : []; if (convRewrite.length) doomed = doomed.filter((d) => docKind(d) !== "conv");
    const uniq = [...new Map(patch.filter(Boolean).map((m) => [String(m.id), m])).values()];
    out.hindsight_docs = doomed.length + convRewrite.length; out.hindsight_memories_edited = uniq.length; out.hindsight_observations_cleared = clearObs.size;
    if (!dry) {
      if (convRewrite.length) { const fb = await rewriteOrDelete(res, convRewrite, []); if (fb.error) errors.push(`hindsight conversation rewrite: ${clip(fb.error, 120)}`); }
      if (doomed.length) { try { await forgetMemoryDocs(res.env, res.get("tenant"), res.get("channel"), doomed); } catch (e) { errors.push(`hindsight delete: ${clip(e.message, 120)} (retried later)`); } }
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

