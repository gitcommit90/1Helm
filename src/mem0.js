// The memory client (docs/configuration.md, "Memory"). Mem0's engine (npm mem0ai) stores and searches; 1HC decides everything else. One memory per channel: a bank id
// (`<env>-<tenant>-<channel>`, or `a2a-...` for the raw agent records) names a namespace, and a call never reads or writes another one. Two jobs on the Models page
// make the model calls: Memory: extract (mem_extract) and Memory: embed (mem_embed). Search makes no model call except the query embedding.
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
async function embedAll(texts) {
  const x = als.getStore(), out = [];
  if (x.capture) return texts.map(() => new Array(DIMS).fill(0));   // a capture (buildExtraction) makes no model call
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const part = texts.slice(i, i + EMBED_BATCH), miss = part.filter((t) => !x.pre?.has(t));
    if (miss.length) {
      const r = await dispatch(plain(x.env), "mem_embed", { input: miss }, { meta: { ...x.meta, kind: "memory-embed" } }), j = await r.json().catch(() => null);
      if (!Array.isArray(j?.data) || j.data.length !== miss.length) throw new Error(`memory embeddings ${r.status}`);
      j.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).forEach((d, k) => { if (d.embedding?.length !== DIMS) throw new Error(`memory embedding has ${d.embedding?.length} dimensions, the index has ${DIMS}`); (x.pre ||= new Map()).set(miss[k], d.embedding); });
    }
    out.push(...part.map((t) => x.pre.get(t)));
  }
  return out;
}
// The extraction call. Mem0 keeps only the fields its schema names, so the category of each fact is read from the answer here and put on the stored fact by MemStore.
async function extract(messages, format) {
  const x = als.getStore();
  if (x.capture) { x.capture.push({ messages, response_format: format }); return '{"memory":[]}'; }   // a capture records the request and extracts nothing
  const r = await dispatch(plain(x.env), "mem_extract", { messages, response_format: format }, { meta: { ...x.meta, kind: "memory-extract" } }), j = await r.json().catch(() => null), text = j?.choices?.[0]?.message?.content ?? "";
  try { for (const m of JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || "{}").memory || []) if (m?.text && CATEGORIES.includes(m.category)) x.cats.set(m.text, m.category); } catch {}
  return text;
}
// The stores of a capture: nothing is found and nothing is written.
const CAPTURE_STORE = { initialize: async () => {}, getUserId: async () => "1hc", setUserId: async () => {}, search: async () => [], keywordSearch: async () => [], get: async () => null, list: async () => [[], 0] };
const CAPTURE_HISTORY = { addHistory: async () => {}, getHistory: async () => [], reset: async () => {}, close() {} };
let engine;
const load = () => engine ||= import("mem0ai/oss").then((m) => {
  m.EmbedderFactory.create = () => ({ embed: async (t) => (await embedAll([t]))[0], embedBatch: embedAll });
  m.LLMFactory.create = () => ({ generateResponse: extract, generateChat: async (messages) => ({ role: "assistant", content: await extract(messages) }) });
  m.VectorStoreFactory.create = (_provider, c) => { const x = als.getStore(); if (x.capture) return CAPTURE_STORE; const main = c.collectionName === x.ns, st = new MemStore(x.env, c.collectionName, x.cats, main ? [] : null); if (main) x.main = st; return st; };   // a capture finds and writes nothing; the fact store buffers its inserts (flushed in withMemory); an entity store writes at once
  m.HistoryManagerFactory.create = () => als.getStore().capture ? CAPTURE_HISTORY : new MemHistory(als.getStore().env, als.getStore().ns);
  return m.Memory;
});
// Runs fn(memory) inside the call's context. instructions: Mem0's customInstructions for an add.
async function withMemory(env, bank, instructions, fn) {
  const Memory = await load(), ns = await nsOf(bank), tenant = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/.exec(bank)?.[0];
  const ctx = { env, ns, cats: new Map(), meta: tenant ? { tenant } : {} };
  try { const out = await als.run(ctx, () => fn(new Memory({
    embedder: { provider: "1hc", config: { embeddingDims: DIMS } }, llm: { provider: "1hc", config: {} }, vectorStore: { provider: "1hc", config: { collectionName: ns, dimension: DIMS } },
    historyStore: { provider: "1hc", config: {} }, ...(instructions ? { customInstructions: instructions } : {}) }), ns));
    await ctx.main?.flush();   // the facts of the add are written here, in one batch
    return out;
  } catch (e) { if (e?.cause?.orStatus) e.status = e.cause.orStatus; throw e; }   // an extraction model's HTTP status, so the writers can tell a refusal from an outage
}

// ---- writing ----
const RAW_CHARS = { "raw-transcript": 800, reference: 3000 };   // chunk sizes of text kept as it is (no model call)
export const MISSION = `LANGUAGE RULE: write every memory in the language of the source text. Never translate and never switch language. Lines marked (user) are the user's own words and lines marked (assistant) are the assistant's. Attribute every memory to the person who said or did it, and never record something the assistant suggested as a fact about the user. Keep stated message origins with the memory they belong to. When a place is mentioned, write the place name into the memory. Do not record the assistant restating facts it recalled as new facts. An item written by a third party holds what that third party said: record it as what they said, never as a fact about the user. Lines marked [Written by 1Helm ...] were added from the item's metadata: write the place and the people into the memories they belong to. Skip greetings, filler, status notices from 1Helm and tool output. Add a "category" field to every memory with exactly one of: ${CATEGORIES.join(", ")} (identity: who the user is; preference: likes and how they want help; rule: something the assistant must always or never do; decision: a choice made and why; project: work, plans, tasks and commitments; person: someone in their life; place: a place that matters; routine: a recurring habit or schedule).`;
// The custom instructions of one extraction call: our mission, the item's date as the Observation Date, and the item's context line.
export const extractInstructions = (day, context = "", mission = MISSION) => `${mission}\n\nThese messages were written on ${day}. Use ${day} as the Observation Date.${context ? `\n\nContext of this item: ${context}` : ""}`;
// The extraction request that retainV2 sends for one piece of text (at most EXTRACT_CHARS characters), built by Mem0's own add() with nothing found, nothing written and no model call:
// { messages: [system (Mem0's extraction prompt), user (its sections with the text and our instructions)], response_format }. mission replaces MISSION. system replaces Mem0's prompt.
// The evaluation route (sandbox-eval.js) sends this request. The existing memories and earlier messages that a real call may find in the channel are left empty.
export async function buildExtraction(text, { context = "", day, mission, system } = {}) {
  const Memory = await load(), captured = [], d = day || new Date().toISOString().slice(0, 10);
  const ctx = { env: {}, ns: "capture", cats: new Map(), fails: [], meta: {}, capture: captured };
  await als.run(ctx, async () => {
    const m = new Memory({ embedder: { provider: "1hc", config: { embeddingDims: DIMS } }, llm: { provider: "1hc", config: {} }, vectorStore: { provider: "1hc", config: { collectionName: "capture", dimension: DIMS } },
      historyStore: { provider: "1hc", config: {} }, customInstructions: extractInstructions(d, context ? scrubSecrets(String(context)) : "", mission ?? MISSION) });
    await m.add([{ role: "user", content: String(text) }], { userId: "capture" });
  });
  if (captured.length !== 1) throw new Error("the extraction request could not be built");
  const r = captured[0]; if (system !== undefined) r.messages[0] = { ...r.messages[0], content: system };
  return r;
}
// Splits text at line breaks into pieces of at most `max` characters (a longer line is cut).
export function pieces(text, max) {
  const out = []; let cur = "";
  for (const line of String(text).split("\n")) {
    for (let l = line; ; l = l.slice(max)) { const s = l.slice(0, max); if (cur && cur.length + s.length + 1 > max) { out.push(cur); cur = ""; } cur += (cur ? "\n" : "") + s; if (l.length <= max) break; }
  }
  if (cur.trim()) out.push(cur); return out;
}
// A conversation (a JSON array of { time, speaker, origin, place, reply_to, text }) as lines, other text as it is.
export const renderConversation = (c) => Array.isArray(c) ? c.map((e) => `[${e.time || ""}] ${e.speaker || ""}${e.origin ? ` (${e.origin})` : ""}${e.place ? ` at ${e.place}` : ""}: ${e.text}${e.reply_to ? ` (quoting ${e.reply_to.speaker}: ${e.reply_to.text})` : ""}`).join("\n") : String(c);
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
      return m.add(parts.map((p) => ({ role: "user", content: p })), { userId: ns, infer: false, metadata: { ...meta, ...(context ? { context } : {}), ...(i.strategy === "verbatim" ? {} : { raw: true }) } });   // chunks keep their context line (who wrote them), as no extraction reads it
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
const shape = (id, p, score) => ({ id, text: p.data, mentioned_at: iso(p.ts) || p.createdAt || null, document_id: p.doc || null, type: p.category || "other", raw: !!p.raw, metadata: p, ...(score != null ? { scores: { final: score } } : {}) });
// Search in one channel's memory. scope: { from, to } in ms (an exact filter on the item's time, from inclusive, to exclusive). source: "bee" keeps the Bee recordings only. → { results, ms }
export async function recall(env, bank, query, o = {}) {
  const t0 = Date.now(), ts = { ...(o.scope?.from != null ? { gte: o.scope.from } : {}), ...(o.scope?.to != null ? { lt: o.scope.to } : {}) };
  const r = await withMemory(env, bank, "", (m, ns) => m.search(String(query).slice(0, 2000), { topK: o.topK || SEARCH_TOPK, threshold: SEARCH_THRESHOLD, filters: { user_id: ns, ...(o.source ? { source: o.source } : {}), ...(Object.keys(ts).length ? { ts } : {}) } }));
  return { results: r.results.map((x) => shape(x.id, { ...x.metadata, data: x.memory, createdAt: x.createdAt }, x.score)), ms: Date.now() - t0 };
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
