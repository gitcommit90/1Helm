// The memory client (docs/configuration.md, "Memory"). Mem0's engine (npm mem0ai) stores and searches; 1HC decides everything else. One memory per channel: a bank id
// (`<env>-<tenant>-<channel>`, or `a2a-...` for the raw agent records) names a namespace, and a call never reads or writes another one. Two jobs on the Models page
// make the model calls: Memory: extract (mem_extract), Memory: embed (mem_embed) and Memory: rerank (mem_rerank). A search makes two: the query embedding and the rerank.
import { AsyncLocalStorage } from "node:async_hooks";
import { scrubSecrets } from "./secrets-scrub.js";
import { markStatus } from "./status-notes.js";
// The model dispatcher is loaded when a call needs it: importing the EE seam at the top would make an import cycle (deletion-do.js and resident.js load this file first).
const dispatch = async (...a) => (await import("./ee/index.js")).dispatch(...a);
import { MemStore, MemHistory, DIMS, EXTRACT_CHARS, nsOf, nsPrefix, removeRows } from "./mem0-store.js";

export const hsOn = (env) => !!(env.MEMORY_INDEX && env.DB && env.AI);
export const bankId = (env, tenant, channel) => `${env.ENV_NAME || "dev"}-${tenant}-${channel}`.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 200);
export const contentHash = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
// Secret scrubbing for text that is a JSON array or object (a conversation): every string inside is scrubbed on its own and the JSON is written again, so a replacement can never break the JSON.
export function scrubContent(c) {
  const t = typeof c === "string" ? c : JSON.stringify(c);
  const walk = (x) => typeof x === "string" ? scrubSecrets(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) : x;
  if (/^\s*[\[{]/.test(t)) { try { return JSON.stringify(walk(JSON.parse(t))); } catch {} }
  return scrubSecrets(t);
}

// ---- the engine and its four seams ----
// The package's own factories pick a provider by name. Ours return the 1HC stores and model clients, which read the running call (env, tenant, the category of each fact) from `als`.
export const CATEGORIES = ["identity", "preference", "rule", "decision", "project", "person", "place", "routine", "other"];
const als = new AsyncLocalStorage();
const plain = (env) => (env.BYOK ? Object.create(env, { BYOK: { value: null } }) : env);   // memory models are 1HC's, never the person's own key
const EMBED_BATCH = 50;
// Embedding retries: a transient failure (429, 408, 5xx, or no status at all, e.g. a network error or a short count) is tried again after these waits (ms) before it is thrown.
// Mem0 turns a thrown batch into one embed() call per fact and skips a fact whose call fails (mem0ai issue 5509), so the batch must succeed or throw here. Tests set the waits to 0.
export const EMBED_RETRY_MS = [300, 900];
const transient = (e) => { const s = e?.orStatus ?? e?.status; return !e?.permanent && !e?.privacyBlocked && (s == null || s === 408 || s === 425 || s === 429 || s >= 500); };
async function embedBatchOnce(x, miss) {
  const r = await dispatch(plain(x.env), "mem_embed", { input: miss }, { meta: { ...x.meta, kind: "memory-embed" } }), j = await r.json().catch(() => null);
  if (!Array.isArray(j?.data) || j.data.length !== miss.length) throw Object.assign(new Error(`memory embeddings ${r.status}`), { status: r.ok ? undefined : r.status });
  return j.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => { if (d.embedding?.length !== DIMS) throw Object.assign(new Error(`memory embedding has ${d.embedding?.length} dimensions, the index has ${DIMS}`), { permanent: true }); return d.embedding; });
}
async function embedAll(texts) {
  const x = als.getStore(), out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const part = texts.slice(i, i + EMBED_BATCH), miss = part.filter((t) => !x.pre?.has(t));
    if (miss.length) {
      let vectors;
      for (let n = 0; ; n++) {
        try { vectors = await embedBatchOnce(x, miss); break; }
        catch (e) { if (n >= EMBED_RETRY_MS.length || !transient(e)) throw e; console.log("memory embed retry", n + 1, String(e?.message || e).slice(0, 120)); await new Promise((r) => setTimeout(r, EMBED_RETRY_MS[n])); }
      }
      vectors.forEach((v, k) => (x.pre ||= new Map()).set(miss[k], v));
    }
    out.push(...part.map((t) => x.pre.get(t)));
  }
  return out;
}
// Mem0's reranker hook: scores the facts a search found against the question, best first. bge-reranker-base reads 512 tokens for the question and a fact together, so both are cut (about 4 characters a token).
// A failure is thrown: Mem0 logs it and keeps the search order, so a search never fails because of this call.
const RERANK_QUERY_CHARS = 400, RERANK_FACT_CHARS = 1200;
async function rerank(query, facts, topK) {
  const x = als.getStore(), r = await dispatch(plain(x.env), "mem_rerank", { query: query.slice(0, RERANK_QUERY_CHARS), contexts: facts.map((f) => ({ text: String(f).slice(0, RERANK_FACT_CHARS) })) }, { meta: { ...x.meta, kind: "memory-rerank" } }), j = await r.json().catch(() => null);
  if (!Array.isArray(j?.response) || j.response.length !== facts.length) throw new Error(`memory rerank ${r.status}`);
  return j.response.slice(0, topK).map((d) => ({ index: d.id, rerankScore: d.score }));
}
// The extraction call. Mem0 keeps only the fields its schema names, so the category of each fact is read from the answer here and put on the stored fact by MemStore.
async function extract(messages, format) {
  const x = als.getStore(), r = await dispatch(plain(x.env), "mem_extract", { messages, response_format: format }, { meta: { ...x.meta, kind: "memory-extract" } }), j = await r.json().catch(() => null), text = j?.choices?.[0]?.message?.content ?? "";
  // The input of an add is never empty, so an empty, cut-off or unparseable answer is a failed call (mem0ai issue 4932: a reasoning model can return nothing). Mem0 would read it as "no facts" and report success.
  const bad = !String(text).trim() ? "no content" : j?.choices?.[0]?.finish_reason === "length" ? "cut off at the token limit" : null;
  if (bad) throw new Error(`memory extraction returned ${bad}`);
  let facts; try { facts = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || "null")?.memory; } catch { facts = null; }
  if (!Array.isArray(facts)) throw new Error("memory extraction returned an answer that is not the memory list");
  for (const m of facts) if (m?.text) { x.extracted.add(m.text); if (CATEGORIES.includes(m.category)) x.cats.set(m.text, m.category); }
  return text;
}
let engine;
const load = () => engine ||= import("mem0ai/oss").then((m) => {
  m.EmbedderFactory.create = () => ({ embed: async (t) => { try { return (await embedAll([t]))[0]; } catch (e) { als.getStore().embedFailed?.push(String(e?.message || e)); throw e; } }, embedBatch: embedAll });   // Mem0 skips a fact whose embed() throws (and an entity too), so the failure is also recorded for withMemory
  m.RerankerFactory.create = () => ({ rerank });
  m.LLMFactory.create = () => ({ generateResponse: extract, generateChat: async (messages) => ({ role: "assistant", content: await extract(messages) }) });
  m.VectorStoreFactory.create = (_provider, c) => { const x = als.getStore(), main = c.collectionName === x.ns, st = new MemStore(x.env, c.collectionName, x.cats, main ? [] : null); if (main) x.main = st; return st; };   // the fact store buffers its inserts (flushed in withMemory); an entity store writes at once
  m.HistoryManagerFactory.create = () => new MemHistory(als.getStore().env, als.getStore().ns);
  return m.Memory;
});
// Mem0's add() drops a fact without an error when its embedding failed (mem0ai issue 5509). Every fact the model extracted must be buffered for writing, or already stored (Mem0 skips a duplicate),
// and no embedding may have failed, or the add throws so the writer's retry path (outbox, rebuild step) sends the item again. Runs before the flush, so nothing is half written.
async function lostFacts(ctx) {
  if (ctx.embedFailed.length) throw new Error(`memory embedding failed, so the add was not kept: ${ctx.embedFailed[0].slice(0, 200)}`);
  if (!ctx.extracted.size || !ctx.main) return;
  const kept = new Set((ctx.main.pending || []).flatMap((p) => p.payloads.map((q) => q.data))), missing = [...ctx.extracted].filter((t) => !kept.has(t));
  for (const t of missing.slice()) if (await ctx.env.DB.prepare("SELECT 1 AS y FROM mem WHERE ns=? AND json_extract(payload,'$.data')=?").bind(ctx.ns, t).first()) missing.splice(missing.indexOf(t), 1);
  if (missing.length) throw new Error(`memory lost ${missing.length} of ${ctx.extracted.size} extracted facts, so the add was not kept`);
}
// Runs fn(memory) inside the call's context. instructions: Mem0's customInstructions for an add.
async function withMemory(env, bank, instructions, fn) {
  const Memory = await load(), ns = await nsOf(bank), tenant = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/.exec(bank)?.[0];
  const ctx = { env, ns, cats: new Map(), extracted: new Set(), embedFailed: [], meta: tenant ? { tenant } : {} };
  try { const out = await als.run(ctx, () => fn(new Memory({
    embedder: { provider: "1hc", config: { embeddingDims: DIMS } }, llm: { provider: "1hc", config: {} }, vectorStore: { provider: "1hc", config: { collectionName: ns, dimension: DIMS } },
    historyStore: { provider: "1hc", config: {} }, reranker: { provider: "1hc", config: {} }, ...(instructions ? { customInstructions: instructions } : {}) }), ns));
    await lostFacts(ctx);
    await ctx.main?.flush();   // the facts of the add are written here, in one batch
    return out;
  } catch (e) { if (e?.cause?.orStatus) e.status = e.cause.orStatus; throw e; }   // an extraction model's HTTP status, so the writers can tell a refusal from an outage
}

// ---- writing ----
const RAW_CHARS = { "raw-transcript": 800, reference: 3000 };   // chunk sizes of text kept as it is (no model call)
export const MISSION = `LANGUAGE RULE: write every memory in the language of the source text. Never translate and never switch language. Lines marked (user) are the user's own words and lines marked (assistant) are the assistant's. Attribute every memory to the person who said or did it, and never record something the assistant suggested as a fact about the user. Keep stated message origins with the memory they belong to. When a place is mentioned, write the place name into the memory. Do not record the assistant restating facts it recalled as new facts. An item written by a third party holds what that third party said: record it as what they said, never as a fact about the user. Lines marked [Written by 1Helm ...] were added from the item's metadata: write the place and the people into the memories they belong to. Skip greetings, filler, status notices from 1Helm and tool output. Add a "category" field to every memory with exactly one of: ${CATEGORIES.join(", ")} (identity: who the user is; preference: likes and how they want help; rule: something the assistant must always or never do; decision: a choice made and why; project: work, plans, tasks and commitments; person: someone in their life; place: a place that matters; routine: a recurring habit or schedule).`;
// The custom instructions of one extraction call: our mission, the item date as the Observation Date, and the item context line.
const extractInstructions = (day, context = "", mission = MISSION) => `${mission}\n\nThese messages were written on ${day}. Use ${day} as the Observation Date.${context ? `\n\nContext of this item: ${context}` : ""}`;
// Splits text at line breaks into pieces of at most `max` characters (a longer line is cut).
export function pieces(text, max) {
  const out = []; let cur = "";
  for (const line of String(text).split("\n")) {
    for (let l = line; ; l = l.slice(max)) { const s = l.slice(0, max); if (cur && cur.length + s.length + 1 > max) { out.push(cur); cur = ""; } cur += (cur ? "\n" : "") + s; if (l.length <= max) break; }
  }
  if (cur.trim()) out.push(cur); return out;
}
// The times of the lines "[ISO time] speaker: text" in each chunk of a raw transcript: { ts (first line's time, ms), ts_end (last line's time, ms) }. A chunk with no timed line gets the fallback
// (the previous chunk's end, or the item's time), so a chunk is always dated. A line cut at the chunk size continues in the next chunk, which has no time of its own.
const LINE_TIME = /^\[(\d{4}-\d\d-\d\dT[^\]\s]+)\]/;
export function chunkTimes(parts, fallback) {
  let prev = fallback;
  return parts.map((p) => {
    const t = p.split("\n").map((l) => Date.parse(LINE_TIME.exec(l)?.[1] ?? "")).filter(Number.isFinite), ts = t.length ? t[0] : prev, ts_end = t.length ? t.at(-1) : prev;
    prev = ts_end; return { ts, ts_end };
  });
}
// A conversation (a JSON array of { time, speaker, origin, place, reply_to, text }) as lines, other text as it is.
const renderConversation = (c) => Array.isArray(c) ? c.map((e) => `[${e.time || ""}] ${e.speaker || ""}${e.origin ? ` (${e.origin})` : ""}${e.place ? ` at ${e.place}` : ""}: ${e.text}${e.reply_to ? ` (quoting ${e.reply_to.speaker}: ${e.reply_to.text})` : ""}`).join("\n") : String(c);
// items: [{ content (text, or an array of conversation entries), at (ms), context, document_id (required), metadata, strategy, tags, update_mode ("replace" | "append") }].
// Replace deletes the document's facts first and appends keep them, so a document is written again whole or one turn at a time. Secrets are scrubbed from content, context and metadata.
// A strategy of reference or raw-transcript keeps the text as chunks, and verbatim as one fact: no extraction call. → { items: n } | null when nothing was left to send.
const CONCURRENT = 4;   // items of different documents are independent, so up to this many are written at once; one document keeps its order
export async function retainV2(env, bank, items) {
  const waves = []; for (const i of items) { const w = waves.at(-1); if (w && w.length < CONCURRENT && !w.some((x) => x.document_id === i.document_id)) w.push(i); else waves.push([i]); }
  let n = 0;
  for (const w of waves) {   // every item of a wave ends before an error is thrown, so a retry never runs beside a write that is still going
    const done = await Promise.allSettled(w.map((i) => retainOne(env, bank, i))), bad = done.find((d) => d.status === "rejected");
    if (bad) throw bad.reason;
    n += done.filter((d) => d.value).length;
  }
  return n ? { items: n } : null;
}
async function retainOne(env, bank, i) {
  const raw = i.content == null ? "" : typeof i.content === "string" ? i.content : JSON.stringify(i.content);
  if (!raw.trim()) return 0;
  if (!i.document_id) throw new Error("retainV2: every item needs a document_id");
  const doc = String(i.document_id), at = Number(i.at) || Date.now(), clean = scrubContent(raw); let content = clean;
  if (/^\s*\[/.test(clean)) try { content = JSON.parse(clean); } catch {}
  const context = i.context ? scrubSecrets(String(i.context)) : "", source = String((i.tags || []).find((t) => String(t).startsWith("source:")) || "").slice(7) || undefined;
  const meta = { ...Object.fromEntries(Object.entries(i.metadata || {}).filter(([, v]) => v != null).map(([k, v]) => [k, scrubSecrets(String(v))])), doc, ts: at, ...(source ? { source, ...(i.metadata?.source && i.metadata.source !== source ? { sent_by: scrubSecrets(String(i.metadata.source)) } : {}) } : {}) };   // source is the filter key, so a different source in the metadata is kept as sent_by
  if (i.update_mode !== "append") await forgetDocument(env, bank, doc);
  const text = renderConversation(content), chunk = RAW_CHARS[i.strategy];
  if (chunk || i.strategy === "verbatim") {
    const parts = i.strategy === "verbatim" ? [text] : pieces(text, chunk);
    await withMemory(env, bank, "", async (m, ns) => {
      await embedAll(parts);   // one batch for every chunk, not one embedding call each
      const base = { ...meta, ...(context ? { context } : {}), ...(i.strategy === "verbatim" ? {} : { raw: true }) };   // chunks keep their context line (who wrote them), as no extraction reads it
      if (i.strategy !== "raw-transcript") return m.add(parts.map((p) => ({ role: "user", content: p })), { userId: ns, infer: false, metadata: base });
      const times = chunkTimes(parts, at);   // each chunk of a recording is dated by its own first line, with ts_end for the window check in recall
      let out; for (let k = 0; k < parts.length; k++) out = await m.add([{ role: "user", content: parts[k] }], { userId: ns, infer: false, metadata: { ...base, ...times[k] } });
      return out;
    });
  } else {
    const day = new Date(at).toISOString().slice(0, 10);
    for (const part of pieces(text, EXTRACT_CHARS)) await withMemory(env, bank, extractInstructions(day, context),
      (m, ns) => m.add([{ role: "user", content: part }], { userId: ns, metadata: meta }));
  }
  return 1;
}

// ---- reading ----
// Passed on every search instead of relying on Mem0's defaults (20 and 0.1). Mem0 v3 takes its candidates from the semantic results alone: the keyword index only re-ranks them.
export const SEARCH_TOPK = 20, SEARCH_THRESHOLD = 0.1;
const iso = (ms) => (Number.isFinite(Number(ms)) && ms ? new Date(Number(ms)).toISOString() : null);
const shape = (id, p, score, rerank) => ({ id, text: p.data, mentioned_at: iso(p.ts) || p.createdAt || null, document_id: p.doc || null, type: p.category || "other", raw: !!p.raw, metadata: p, ...(score != null ? { scores: { final: score, ...(rerank != null ? { rerank } : {}) } } : {}) });
// A raw chunk is dated by its first line, so a window search asks the index from RAW_LOOKBACK_MS earlier and then keeps a chunk only when it overlaps the window (its last line, ts_end, is at or after from).
export const RAW_LOOKBACK_MS = 15 * 60 * 1000;
// Search in one channel's memory. scope: { from, to } in ms (an exact filter on the item's time, from inclusive, to exclusive; a raw chunk counts when its lines overlap the window). source: "bee" keeps the Bee recordings only. → { results, ms }
export async function recall(env, bank, query, o = {}) {
  const from = o.scope?.from, t0 = Date.now(), ts = { ...(from != null ? { gte: from - RAW_LOOKBACK_MS } : {}), ...(o.scope?.to != null ? { lt: o.scope.to } : {}) };
  const r = await withMemory(env, bank, "", (m, ns) => m.search(String(query).slice(0, 2000), { topK: o.topK || SEARCH_TOPK, threshold: SEARCH_THRESHOLD, rerank: true, filters: { user_id: ns, ...(o.source ? { source: o.source } : {}), ...(Object.keys(ts).length ? { ts } : {}) } }));
  const inside = (x) => from == null || Number(x.metadata?.ts) >= from || (x.metadata?.raw && Number(x.metadata?.ts_end) >= from);
  return { results: r.results.filter(inside).map((x) => shape(x.id, { ...x.metadata, data: x.memory, createdAt: x.createdAt }, x.score, x.rerankScore)), ms: Date.now() - t0 };   // scores.rerank (Mem0's rerankScore, 0 to 1) is present only when the rerank was applied
}
const store = async (env, bank) => new MemStore(env, await nsOf(bank));
// An exact list of the facts in a time range (start inclusive, end exclusive, ms), newest first, or of one document (doc).
export async function memoriesList(env, bank, { start, end, doc, limit = 50, offset = 0 } = {}) {
  const f = { ...(start != null || end != null ? { ts: { ...(start != null ? { gte: Number(start) } : {}), ...(end != null ? { lt: Number(end) } : {}) } } : {}), ...(doc ? { doc } : {}) }, [rows] = await (await store(env, bank)).list(f, Math.min(200, limit), offset);
  return { items: rows.map((x) => shape(x.id, x.payload)) };
}
export async function getMemory(env, bank, id) { const x = await (await store(env, bank)).get(id); return x ? shape(x.id, x.payload) : null; }
// What a fact said before each change, oldest first.
export async function memoryHistory(env, bank, id) {
  const ns = await nsOf(bank);
  return (await new MemHistory(env, ns).getHistory(id)).map((h) => ({ changed_at: h.updated_at || h.created_at, previous_text: h.previous_value, new_text: h.new_value, action: h.action }));
}
const like = (prefix) => `${String(prefix).replace(/[\\%_]/g, "\\$&")}%`;
// The documents of a channel whose id starts with `q`, with the number of facts of each.
export async function listDocuments(env, bank, { q = "", limit = 100, offset = 0 } = {}) {
  const r = await env.DB.prepare("SELECT doc, COUNT(*) n FROM mem WHERE ns=? AND doc LIKE ? ESCAPE '\\' GROUP BY doc ORDER BY doc LIMIT ? OFFSET ?").bind(await nsOf(bank), like(q), limit, offset).all();
  return (r.results || []).map((x) => ({ id: x.doc, facts: x.n }));
}
// How many facts, and how many documents whose id starts with `prefix`, a channel's memory holds.
export async function memoryCounts(env, bank, prefix = "") {
  const r = await env.DB.prepare("SELECT COUNT(*) facts, COUNT(DISTINCT doc) documents FROM mem WHERE ns=? AND doc LIKE ? ESCAPE '\\'").bind(await nsOf(bank), like(prefix)).first();
  return { facts: r.facts, documents: r.documents };
}
// Which of the document ids have at least one fact in a channel's memory (a document the extraction found nothing in has none). One D1 query per 50 ids, no model call.
export async function docsWithFacts(env, bank, ids) {
  const ns = await nsOf(bank), list = [...new Set(ids)], have = new Set();
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50), r = await env.DB.prepare(`SELECT DISTINCT doc FROM mem WHERE ns=? AND doc IN (${part.map(() => "?").join(",")})`).bind(ns, ...part).all();
    for (const x of r.results || []) have.add(x.doc);
  }
  return have;
}
// The whole text of a document of raw chunks, in order.
export async function documentText(env, bank, doc) {
  const r = await env.DB.prepare("SELECT payload FROM mem WHERE ns=? AND doc=? ORDER BY rowid").bind(await nsOf(bank), doc).all();
  return (r.results || []).map((x) => JSON.parse(x.payload).data).join("\n");
}

// One line per fact: date (the person's time zone), kind, and the fact. Raw chunks of a recording are marked as its own words.
export function packHs(results, o = {}) {
  const max = o.maxChars ?? 6000, fmt = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? (o.localDay ? o.localDay(t, o.tz) : new Date(t).toISOString().slice(0, 10)) : "undated"; };
  let used = 0; const out = [];
  for (const r of results) {
    const line = `[${fmt(r.mentioned_at)} · ${r.raw ? "recording" : r.type || "memory"}${r.metadata?.context ? ` · ${scrubSecrets(r.metadata.context).slice(0, 160)}` : ""}] ${markStatus(scrubSecrets(String(r.text)).slice(0, 900))}`;   // a fact stored before a secret was scrubbed still reads without it
    if (used + line.length > max) continue; used += line.length; out.push(line);
  }
  return out.join("\n");
}

// ---- the profile and the Notebook pages, built from facts with no model call ----
const ORDER = ["identity", "rule", "preference", "decision", "project", "routine", "person", "place", "other"];   // OpenClaw's recall.ts: category order, identity always included, a token budget
export const PROFILE_CHARS = 6000;   // about 1,500 tokens
// The facts of the given categories (all kept facts, not raw chunks), newest first.
export async function factsOf(env, bank, categories = CATEGORIES, limit = 300) {
  const q = categories.map(() => "?").join(","), r = await env.DB.prepare(`SELECT id,payload FROM mem WHERE ns=? AND json_extract(payload,'$.category') IN (${q}) AND json_extract(payload,'$.raw') IS NULL ORDER BY json_extract(payload,'$.createdAt') DESC LIMIT ?`).bind(await nsOf(bank), ...categories, limit).all();
  return (r.results || []).map((x) => shape(x.id, JSON.parse(x.payload)));
}
// The standing context for a prompt: facts in category order, then newest first, until the budget is used. Identity facts are always in.
export function categoryBlock(facts, { chars = PROFILE_CHARS } = {}) {
  const ranked = [...facts].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || String(b.mentioned_at).localeCompare(String(a.mentioned_at))), keep = []; let used = 0;
  for (const f of ranked) { const line = `- ${scrubSecrets(String(f.text)).replace(/\s+/g, " ").trim()}`; if (f.type !== "identity" && used + line.length > chars) continue; used += line.length; keep.push({ type: f.type, line }); }
  return ORDER.map((c) => keep.filter((k) => k.type === c)).filter((g) => g.length).map((g) => `${g[0].type[0].toUpperCase()}${g[0].type.slice(1)}:\n${g.map((k) => k.line).join("\n")}`).join("\n");
}

// ---- deleting ----
// One document and every fact drawn from it. { deleted: 1 | 0, units: facts }
export async function forgetDocument(env, bank, doc) { const n = await removeRows(env, await nsOf(bank), " AND doc=?", [doc]); return { deleted: n ? 1 : 0, units: n }; }
// A whole channel (or raw agent bank): every fact and vector of its namespace.
export async function forgetBank(env, bank) { const n = await removeRows(env, await nsOf(bank)); return { deleted: n ? 1 : 0 }; }
export const forgetChannel = (env, tenant, channel) => forgetBank(env, bankId(env, tenant, channel));
// Every channel of an account, and its raw agent records (their namespaces share the account's prefix).
export async function forgetTenant(env, tenant) { const n = await removeRows(env, await nsPrefix(tenant)); return { deleted: n ? 1 : 0, facts: n }; }
// The nightly safety net: the facts of an account that no longer exists (a delete path that missed something). → { accounts, doomed, deleted }
export async function sweepMemory(env, { dry = false } = {}) {
  const have = ((await env.DB.prepare("SELECT DISTINCT substr(ns, 1, 16) AS p FROM mem").all()).results || []).map((r) => r.p);
  const live = new Set(await Promise.all(((await env.DB.prepare("SELECT id FROM tenants").all()).results || []).map((t) => nsPrefix(t.id))));
  const doomed = have.filter((p) => !live.has(p));
  if (!dry) for (const p of doomed) await removeRows(env, p);
  return { accounts: have.length, doomed: doomed.length, deleted: dry ? 0 : doomed.length };
}
