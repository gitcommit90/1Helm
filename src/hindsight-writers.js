// Memory Overhaul phase 3 (the design notes): everything a channel holds goes into that
// channel's Hindsight bank in the right shape. This file has two parts.
//   1. Pure builders (no network, no storage): the flag, document ids, context strings, speaker names, the conversation entries, and
//      one retain item per kind (turn, note, file, live notes, Bee conversation, skill, task card, contact card, inbox item).
//   2. Resident methods (mixed in at the bottom): the one place that sends or queues an item (hsPut), the outbox, the deletion helpers,
//      and the writers the Resident owns (turns, unfinished work, Notebook notes, files, skills, task cards).
// Everything here runs only when HS_WRITERS is "on" (and HS_FOUNDATIONS, because the strategies live in the bank template). With the flag
// off, every call site keeps the phase 2 code path, so a rollback is a flag change and a redeploy.
import { retainV2, hsOn, forgetDocument, contentHash } from "./hindsight.js";
import { contextFor, speakerLabels } from "./hindsight-template.js";
import { scrubSecrets } from "./secrets-scrub.js";
import { hsRetainBatchNano } from "./byok-meter.js";
import { helperName } from "./helper-name.js";
import { stripInjectedMemory } from "./memory-block.js";   // phase 4A: memory added to a turn is never retained

export { hsWriters } from "./hs-flag.js";
import { hsWriters, hsEnvelope } from "./hs-flag.js";
import { withEnvelope, makeEnvelope, placeId as placeIdOf } from "./memory-envelope.js";   // HS_ENVELOPE: time, place, people and source on every item (ENVELOPE.md)
import { chatPlace, chatEnvelope, placeEntries } from "./adapters/chat.js";
import { isPhoto, isVideo, readMediaMeta, mediaEnvelope, mediaDetails, fileSource } from "./adapters/media.js";
import { beeEnveloped } from "./adapters/bee.js";
import { locationOf } from "./location.js";
import { geocodeCached, placeLabel, dedupeSeen } from "./memory-sources.js";
const forgetMemoryDocs = async (...args) => (await import("./deletion.js")).forgetMemoryDocs(...args);   // loaded on use: deletion.js reaches the whole EE seam, which would make an import cycle

// ---- document ids (DESIGN 3.3). Stable, and rebuildable from 1HC's own records. ----
export const DOC = {
  conv: (sid, day) => `conv:${sid}:${day}`, note: (id) => `note:${id}`, file: (id) => `file:${id}`, live: (task, n) => `live:${task}:s${n}`,
  bee: (id) => `bee:conv:${id}`, skill: (slug) => `skill:${slug}`, task: (sid) => `task:${sid}`, contact: (id) => `contact:${id}`, inbox: (id) => `inbox:${id}`,
};
// The kind of a document id ("conv", "bee", ...), or null for an old id (turn-..., fact-..., partial-...).
export const docKind = (id) => { const s = String(id || ""); if (s.startsWith("bee:conv:")) return "bee"; const m = s.match(/^(conv|note|file|live|skill|task|contact|inbox):/); return m ? m[1] : null; };
// The constant tag of each kind (DESIGN 3.6). A document's tag set never changes between appends (Hindsight issues #5415 and #5267).
export const TAG = { chat: "source:chat", note: "source:note", file: "source:file", live: "source:live", bee: "source:bee", skill: "source:skill", task: "source:task", contact: "source:contact", inbox: "source:bee" };
export const STRATEGY = { chat: "chat", note: "note", ambient: "ambient", file: "file", reference: "reference", rawTranscript: "raw-transcript" };
// Extra tag of a Bee recording's chunks (it marks a hit as the recording's own words): the source:bee tag stays the constant tag, so one strict recall over source:bee finds it.
export const TAG_RAW = "kind:raw";
export const FILE_MD_MAX = 60000;      // Markdown above this many characters (and every spreadsheet) is retained as "reference": chunks, no model call (DESIGN 3.5)
export const RAW_CHUNK_CHARS = 800;   // retain_chunk_size of the raw-transcript strategy in both bank templates (measured, DESIGN 7.3)
// TURN_PART_MAX and TURN_NOTES_MAX are kept for callers that read them; convEntries no longer cuts text to them (Captain 2026-10-14:
// no length limits on stored content). SLICE_MAX only splits a long day into several sends; nothing is dropped.
export const TURN_PART_MAX = 8000, TURN_NOTES_MAX = 2000, SLICE_MAX = 120000;

// A value exactly as it arrived (Captain 2026-10-14: no length limits, no collapsing of spaces or control characters). Only a value with
// no visible character counts as missing. Hindsight itself removes the few characters PostgreSQL cannot store (NUL, other C0 controls
// except tab, newline and carriage return, lone surrogates) from the whole retain item, metadata included (hindsight@v1.0.0
// hindsight-api-slim/hindsight_api/engine/llm_wrapper.py sanitize_text, tests/test_input_robustness.py "Prong D").
const one = (s) => { const t = String(s ?? ""); return t.trim() ? t : ""; };

// ---- local dates ----
const dtf = new Map();
const fmtOf = (tz) => { let f = dtf.get(tz); if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); dtf.set(tz, f); } return f; };
const partsOf = (ms, tz) => { let f; try { f = fmtOf(tz || "UTC"); } catch { f = fmtOf("UTC"); } return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value])); };
// "2026-10-14" in the person's time zone.
export function dayKey(ms, tz) { const p = partsOf(ms, tz); return `${p.year}-${p.month}-${p.day}`; }
// "2026-10-14T09:02:00-07:00": the time with the person's offset, as the entries of a conversation carry it.
export function isoLocal(ms, tz) {
  const p = partsOf(ms, tz), asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second), off = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  const a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, "0")}:${p.minute}:${p.second}${off < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
// The first millisecond of a local day and of the day after it (a day is 23 to 25 hours long around a clock change).
export function dayRange(key, tz) {
  const [y, m, d] = key.split("-").map(Number), t0 = Date.UTC(y, m - 1, d);
  const firstAtOrAfter = (k, lo, hi) => { while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (dayKey(mid, tz) >= k) hi = mid; else lo = mid + 1; } return lo; };   // dayKey never goes down, so this is a binary search
  const n = new Date(t0 + 24 * 3600e3), nk = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
  return { start: firstAtOrAfter(key, t0 - 15 * 3600e3, t0 + 15 * 3600e3), end: firstAtOrAfter(nk, t0 + 9 * 3600e3, t0 + 39 * 3600e3) };
}

// ---- names and context strings (DESIGN 3.4). contextFor (phase 2) holds chat, scheduled, note, file, live and bee. ----
export function ctxFor(kind, v = {}) {
  const f = one(v.first) || "the user", h = helperName(one(v.helper)), c = one(v.channel) || "main";
  if (kind === "skill") return `A procedure ${f} asked ${h} to save as a skill in #${c}: ${one(v.name)}. It is ${f}'s own instruction to ${h}.`;
  if (kind === "task") return `The task card of "${one(v.name)}" in #${c}: the task title and its checklist. The assistant and ${f} both add items.`;
  if (kind === "contact") return `A contact card in ${f}'s 1Helm Contacts. It is information ${f} keeps about a person, not words ${f} said.`;
  if (kind === "inbox") return `A voice inbox item found in ${f}'s Bee recordings and kept with its status. The wearer is ${f}.`;
  return contextFor(kind, { ...v, first: f, helper: h, channel: c });
}
const SECTION_NAMES = { ov: "overview", about: "about", how: "how to work together", people: "people", places: "places", now: "right now" };
export const sectionName = (sec) => SECTION_NAMES[sec] || one(sec) || "notes";
// A speaker in ambient audio: the wearer is the user, everyone else is another person (DESIGN 3.4).
export function ambientSpeaker(raw, { first, isUser } = {}) {
  const f = one(first) || "the user", s = one(typeof raw === "object" && raw ? (raw.name || raw.display_name || raw.id) : raw);
  if (isUser === true || /^(wearer|you|me|user)$/i.test(s) || (s && s.toLowerCase() === f.toLowerCase())) return `${f} (wearer, the user)`;
  if (!s || /^unknown( speaker)?$/i.test(s)) return "Unknown speaker (not the user)";
  if (/^others?$/i.test(s)) return "Others (not the user)";
  return `${s} (not the user)`;
}

// ---- conversation entries (DESIGN 3.3): one JSON element per speaker line, appended to the day's document ----
// reply: the text of the assistant's answer already turned into plain text (cardsToText). partial: unfinished work text.
export function convEntries({ userText, reply, notes, partial, at, endAt, kind = "chat", labels, tz }) {
  const L = labels || speakerLabels({}), out = [], t0 = at || Date.now(), t1 = endAt || t0, e = (speaker, time, text, n) => { const t = scrubSecrets(stripInjectedMemory(text)); if (t.trim()) out.push({ speaker, time: isoLocal(time, tz), text: t }); };
  e(kind === "chat" ? L.user : L.scheduled, t0, userText, TURN_PART_MAX);
  e(L.assistant, t1, reply, TURN_PART_MAX);
  e(L.notes, t1, String(notes ?? "").split("\n").filter((l) => !/^\s*-?\s*\(1Helm:/.test(l)).join("\n"), TURN_NOTES_MAX);   // 1Helm's own notices (out of credits, a pause) are not the helper's words
  if (partial) e(L.assistant, t1, `(unfinished) ${partial}`, 5000);
  return out;
}
// The document a turn belongs to: its task and its local day. A scheduled run with no task has its own document per workflow.
export const convSession = (session, workflowId) => session ? String(session) : `run-${workflowId ?? 0}`;
export const convDocOf = ({ session, workflowId, at }, tz) => DOC.conv(convSession(session, workflowId), dayKey(at, tz));
// Cut a long array of entries into slices of at most `max` characters of JSON (a whole busy day is one document, sent in order).
export function sliceEntries(entries, max = SLICE_MAX) {
  const out = []; let cur = [], size = 2;
  for (const x of entries) { const n = JSON.stringify(x).length + 1; if (cur.length && size + n > max) { out.push(cur); cur = []; size = 2; } cur.push(x); size += n; }
  if (cur.length) out.push(cur); return out;
}

// ---- retain items (the shape retainV2 takes) ----
const itemOf = (doc, kind, strategy, o) => ({ document_id: doc, strategy, tags: [TAG[kind]], observation_scopes: "shared", ...o });
export function turnItem({ doc, entries, at, context, channel, session, day, key, mode = "append" }) {
  return itemOf(doc, "chat", STRATEGY.chat, { content: entries, at, context, update_mode: mode, key, metadata: { kind: "conversation", channel, session, day } });
}
export function noteItem({ row, names, channel }) {
  const human = row.author_type === "human", at = Number(row.edited || row.created) || Date.now();
  return itemOf(DOC.note(row.id), "note", STRATEGY.note, { content: scrubSecrets(String(row.content || "")), at, update_mode: "replace",
    context: row.page ? ctxFor("page-edit", { ...names, page: row.page.title, heading: row.page.section }) : ctxFor(human ? "note" : "helper-note", { ...names, section: sectionName(row.sec) }),
    metadata: { kind: "note", note: row.id, section: row.sec || "", author: human ? "person" : "helper", channel, ...(row.page ? { page: String(row.page.id), page_section: row.page.section || "" } : {}) } });
}
// kind: sidecar kind ("sheet", "pdf", ...). Spreadsheets and long files become "reference" (chunks, no model call).
export function fileItem({ id, name, md, kind, at, names, mime, channel }) {
  const long = String(md || "").length > FILE_MD_MAX, reference = kind === "sheet" || long;
  return itemOf(DOC.file(id), "file", reference ? STRATEGY.reference : STRATEGY.file, { content: md, at, update_mode: "replace",
    context: ctxFor("file", { ...names, file: name }), metadata: { kind: "file", file: id, name: one(name), mime: one(mime), channel } });
}
export function skillItem({ slug, description, body, at, names, channel }) {
  return itemOf(DOC.skill(slug), "skill", STRATEGY.note, { content: `# Skill: ${slug}\n${description}\n\n${body}`, at, update_mode: "replace",
    context: ctxFor("skill", { ...names, channel, name: slug }), metadata: { kind: "skill", skill: slug, channel } });
}
// The task card text: the title and the checklist, with who last changed each item.
export function taskText({ title, created, items = [], names }) {
  const f = one(names?.first) || "the user", h = helperName(one(names?.helper)), lines = [`Task: ${one(title)}`, ...(created ? [`Started: ${new Date(created).toISOString().slice(0, 10)}`] : [])];
  if (items.length) { lines.push("Checklist:"); for (const x of items) lines.push(`- [${x.status}] ${one(x.text)} (${x.by === "person" ? `${f} changed it last` : `${h} changed it last`})`); }
  return lines.join("\n");
}
export function taskItem({ session, title, created, updated, items, names, channel }) {
  return itemOf(DOC.task(session), "task", STRATEGY.chat, { content: taskText({ title, created, items, names }), at: updated || created || Date.now(), update_mode: "replace",
    context: ctxFor("task", { ...names, channel, name: title }), metadata: { kind: "task", session, channel } });
}
// A Contacts entry as text (General only). Facts a channel learned stay out: they already arrive through that channel's conversations.
export function contactText(p) {
  const L = [`Contact: ${one(p.name)}`];
  if (p.rel) L.push(`Relationship to the user: ${one(p.rel)}`);
  if (p.aka?.length) L.push(`Also called: ${p.aka.map((a) => one(a)).filter(Boolean).join(", ")}`);
  if (p.bday) L.push(`Birthday: ${one(p.bday)}`);
  if (p.addr) L.push(`Address: ${one(p.addr)}`);
  for (const x of (p.phones?.length ? p.phones : p.phone ? [{ v: p.phone }] : [])) L.push(`Phone${x.label && x.label !== "Personal" ? ` (${x.label.toLowerCase()})` : ""}: ${one(x.v)}`);
  for (const x of (p.emails?.length ? p.emails : p.email ? [{ v: p.email }] : [])) L.push(`Email${x.label && x.label !== "Personal" ? ` (${x.label.toLowerCase()})` : ""}: ${one(x.v)}`);
  for (const f of (p.facts || []).filter((x) => !x.channel)) L.push(`Note: ${one(f.text)}`);
  return L.join("\n");
}
export function contactItem({ p, names }) {
  return itemOf(DOC.contact(p.id), "contact", STRATEGY.chat, { content: scrubSecrets(contactText(p)), at: Number(p.updated || p.created) || Date.now(), update_mode: "replace",
    context: ctxFor("contact", names), metadata: { kind: "contact", contact: p.id } });
}
// Live notes (DESIGN 3.3): the transcript lines of one session, as JSON elements. utts: [{ at, speaker, text }]; mic: no speaker labels.
export function liveEntries(utts, { first, tz, mic = false } = {}) {
  return utts.map((u) => ({ speaker: mic && !u.speaker ? "Unlabeled speech (microphone)" : ambientSpeaker(u.speaker, { first }), time: isoLocal(u.at, tz), text: scrubSecrets(String(u.text || "")) })).filter((x) => x.text.trim());
}
export function liveItem({ task, n, entries, at, names, channel, key, mode = "append" }) {
  return itemOf(DOC.live(task, n), "live", STRATEGY.ambient, { content: entries, at, update_mode: mode, key, context: ctxFor("live", names), metadata: { kind: "live", task, session: String(n), channel } });
}
// A Bee conversation: lines = ambientLines(conv) ([{ at, speaker, is_user, text }]). summary goes into the context, clipped.
export function beeEntries(lines, { first, tz }) {
  return lines.map((u) => ({ speaker: ambientSpeaker(u.speaker, { first, isUser: u.is_user }), time: isoLocal(u.at || Date.now(), tz), text: scrubSecrets(String(u.text || "")) })).filter((x) => x.text.trim());
}
// Bee option A (Captain decision 2026-10-14): a recording goes into General's bank once, as its own words and nothing else. Hindsight splits the text into chunks (strategy
// raw-transcript, chunks mode, no model call) and stores each chunk as it is, so Bee's own facts (the Notebook notes the person approved) are the only facts that come from Bee.
// One line per utterance, "[time] speaker label: words", with the time and label exactly as the entries carry them. Tags: source:bee (the one constant tag of Bee documents) and
// kind:raw, which marks a hit as the recording's own words. Observation scopes stay "shared" and consolidation is Hindsight's own. This is the one place a Bee document is built.
export const beeRawText = (entries) => entries.map((e) => `[${e.time}] ${e.speaker}: ${e.text}`).join("\n");
export function beeItem({ id, entries, at, address, summary, started, ended, names }) {
  return itemOf(DOC.bee(id), "bee", STRATEGY.rawTranscript, { content: beeRawText(entries), at, update_mode: "replace", tags: [TAG.bee, TAG_RAW], context: ctxFor("bee", { ...names, address, summary }),
    metadata: { kind: "bee", source: "bee", vendor_id: String(id), started_at: started || "", ended_at: ended || "", location: address || "" } });
}
// A voice inbox item (DESIGN 7, option (a)): kept with its status in the text, so a status change replaces the document.
export function inboxText(it, { first, tz }) {
  const f = one(first) || "the user", when = it.source_at ? dayKey(it.source_at, tz) : "";
  const ev = (it.evidence || []).map((e) => `"${one(e.quote || e.text)}"`).filter((x) => x !== '""');
  const who = it.attribution?.is_user === false ? `someone other than ${f}` : f;
  return [`Voice inbox ${one(it.kind)}: ${one(it.text)}`, `Status: ${one(it.status || "open")}.`, `Said by ${who}${when ? ` on ${when}` : ""}, heard by the Bee wearable.`, ...(it.due_text ? [`When: ${one(it.due_text)}`] : []), ...(ev.length ? [`Evidence: ${ev.join(" ")}`] : [])].join("\n");
}
export function inboxItem({ it, names, tz }) {
  return itemOf(DOC.inbox(it.id), "inbox", STRATEGY.note, { content: scrubSecrets(inboxText(it, { first: names?.first, tz })), at: it.source_at || Date.now(), update_mode: "replace",
    context: ctxFor("inbox", names), metadata: { kind: "inbox", item: it.id, item_kind: one(it.kind), status: one(it.status || "open"), source_id: String(it.source_id || "") } });
}
// An inbox item reaches memory only when the person confirmed it or it was located in the speech with confidence (DESIGN 7).
export const inboxEligible = (it) => !!it && (it.confirmed === true || (it.confidence === "captured" && !it.needs_review));

// Characters this item will cost to extract (the strategy "reference" runs no model, so it has none).
export const itemChars = (i) => typeof i.content === "string" ? i.content.length : JSON.stringify(i.content ?? "").length;
export const itemExtractChars = (i) => i.strategy === STRATEGY.reference || i.strategy === STRATEGY.rawTranscript ? 0 : itemChars(i);   // chunks mode makes no model call
// A send costs what a normal retain costs: hsRetainBatchNano() in src/byok.js (extraction calls, characters, consolidation), and the refresh runs
// of a new window when the Resident's hsRetainHold finds one open. `models` is the runs to add (0 for none).
export const itemsNano = (items, models = 0) => hsRetainBatchNano(items.map(itemExtractChars), models);

// Rounds of one send: an append goes alone (Hindsight serializes appends only for a request with exactly one document), and a replace
// goes with up to `max` other replaces that have different document ids (an async request with a repeated id is refused).
export function rounds(items, max = 20) {
  const out = []; let cur = null;
  for (const i of items) {
    if (i.update_mode === "append") { if (cur) { out.push(cur); cur = null; } out.push([i]); continue; }
    if (!cur) cur = [];
    if (cur.length >= max || cur.some((x) => x.document_id === i.document_id)) { out.push(cur); cur = []; }
    cur.push(i);
  }
  if (cur?.length) out.push(cur); return out;
}

// ---------------------------------------------------------------- Resident methods ----------------------------------------------------------------
const OUTBOX = "CREATE TABLE IF NOT EXISTS hs_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL, item TEXT, del INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, ref TEXT)";
export const OUTBOX_MAX_TRIES = 20;
// HS_ENVELOPE: the place of a chat turn (adapters/chat.js), saved next to the turn so a rebuild of the bank keeps it. One row per turn that had
// a fresh location services fix; nothing for a turn without one. Deleting the turn's chat or the channel removes it with the turns.
// 1HC's kind for a Library file that is not a photo or a video: "document" only for document formats (text, PDF, office, ebook); any
// other file (an archive, a font, a binary) has no 1HC kind, so it is never relabeled.
const DOC_EXT = new Set(["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "markdown", "html", "htm", "xls", "xlsx", "ods", "csv", "tsv", "ppt", "pptx", "odp", "epub", "pages", "numbers", "key", "json", "xml"]);
export const docKind1hc = (mime, name) => (/^text\//i.test(String(mime || "")) || /pdf|msword|officedocument|opendocument|rtf|epub|csv/i.test(String(mime || "")) || DOC_EXT.has(String(name || "").toLowerCase().split(".").pop()) ? "document" : null);
// The SHA-256 of a whole stored file, streamed from one R2 read into a digest (Cloudflare's crypto.DigestStream), so memory stays flat
// whatever the size and the read is one subrequest. → hex, or null when the file is gone.
export async function fileHash(env, key) {
  const o = await env.WS.get(key); if (!o) return null;
  let buf;
  if (o.body && typeof crypto.DigestStream === "function") { const d = new crypto.DigestStream("SHA-256"); await o.body.pipeTo(d); buf = await d.digest; }
  else buf = await crypto.subtle.digest("SHA-256", await o.arrayBuffer());
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const TURN_PLACE = "CREATE TABLE IF NOT EXISTS hs_turn_place (turn TEXT PRIMARY KEY, place TEXT, lat REAL, lng REAL, at INTEGER)";
const jp = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

export const writerMethods = {
  hsW() { return hsWriters(this.env) && hsOn(this.env); },
  hsOutboxInit() { if (!this._hsOb) { this.sql.exec(OUTBOX); this._hsOb = true; } },
  // Is this bank being rebuilt right now? Writers then queue instead of sending (DESIGN 5.2, step 1).
  hsRebuilding() { const s = jp(this.get("hs_rb")); return !!s && ["running", "paused", "failed"].includes(s.status); },
  hsOutboxCount() { try { this.hsOutboxInit(); return Number(this.sql.exec("SELECT COUNT(*) n FROM hs_outbox").one().n); } catch { return 0; } },
  async hsLocal() { const n = (await this.hsNames()) || {}, tz = this.tz(); return { names: { first: n.first, helper: n.helper, channel: this.get("channel") }, tz, channel: this.get("channel") }; },
  // The one place an item is sent or queued. items: retainV2 items. Returns { sent, queued, skipped }.
  async hsPut(items, o = {}) {
    if (!this.hsW() || !items?.length) return { skipped: "off" };
    if (this.memoryMode() === "off") return { skipped: "memory off" };
    items = items.filter((i) => itemChars(i) > 0); if (!items.length) return { skipped: "empty" };
    if (this.hsRebuilding() && !o.rebuild) {
      // The bank is being rebuilt: queue, and pay now (a normal write keeps its hold; the rebuild itself is 1HC's cost).
      const h = o.paid === false ? { done: async () => 0 } : await this.hsRetainHold(items.map(itemExtractChars));
      if (!h) { this.byokRetainSkipped(items); return { skipped: "credits" }; }
      await h.done(); this.hsOutboxInit();
      for (const i of items) this.sql.exec("INSERT INTO hs_outbox (doc, item, del, paid, at, ref) VALUES (?,?,0,1,?,?)", i.document_id, JSON.stringify(i), Date.now(), i.key ? String(i.key) : null);   // ref: the turn the entry came from, so the rebuild's source leaves that turn out
      return { queued: items.length };
    }
    return this.hsSend(items, { paid: o.paid !== false, rebuild: !!o.rebuild });
  },
  // Send rounds. paid: reserve the metered cost first (own AI key accounts). A failed round goes to the outbox and is tried again by the
  // alarm (a client error, HTTP 400 to 499, is dropped: sending it again cannot help).
  async hsSend(items, { paid = true, rebuild = false } = {}) {
    let bank; try { bank = await this.hsBank(); } catch (e) { return this.hsRetryLater(items, e, paid); }
    const res = { sent: 0, queued: 0, skipped: 0, dropped: 0 };
    for (const r of rounds(items)) {
      const h = paid ? await this.hsRetainHold(r.map(itemExtractChars)) : { done: async () => 0 };
      if (!h) { this.byokRetainSkipped(r); res.skipped += r.length; continue; }
      try { await retainV2(this.env, bank, r); await h.done(); res.sent += r.length; }
      catch (e) {
        await h.done(0);
        if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 409 && e.status !== 429) { console.log("hindsight retain dropped", e.message); this.mem.receipt({ mode: "hs-retain", query: r[0]?.document_id, error: String(e.message || e).slice(0, 300) }); res.dropped += r.length; }
        else if (rebuild) throw e;
        else { this.hsRetryLater(r, e, paid); res.queued += r.length; }
      }
    }
    return res;
  },
  hsRetryLater(items, e, paid = true) {
    console.log("hindsight retain queued for retry", String(e?.message || e).slice(0, 160));
    try { this.mem.receipt({ mode: "hs-retain", query: items[0]?.document_id, error: `queued for retry: ${String(e?.message || e).slice(0, 200)}` }); } catch {}
    this.hsOutboxInit(); for (const i of items) this.sql.exec("INSERT INTO hs_outbox (doc, item, del, paid, at, tries, ref) VALUES (?,?,0,?,?,1,?)", i.document_id, JSON.stringify(i), paid ? 0 : 1, Date.now(), i.key ? String(i.key) : null);
    return { queued: items.length };
  },
  // Send what the outbox holds, oldest first, at most `max` rows. An entry that fails stays (its tries go up, and after
  // OUTBOX_MAX_TRIES it is dropped and logged). A delete entry removes its document.
  async hsFlush({ max = 40, paid = false } = {}) {
    this.hsOutboxInit();
    const rows = this.sql.exec("SELECT * FROM hs_outbox ORDER BY seq LIMIT ?", max).toArray(); if (!rows.length) return { sent: 0, left: 0 };
    let sent = 0; const bank = await this.hsBank();
    for (let i = 0; i < rows.length;) {
      const r = rows[i];
      if (r.del) { try { await forgetDocument(this.env, bank, r.doc); } catch (e) { console.log("hindsight outbox delete", e.message); break; } this.sql.exec("DELETE FROM hs_outbox WHERE seq=?", r.seq); i++; sent++; continue; }
      const run = [r]; let j = i + 1; while (j < rows.length && !rows[j].del && run.length < 20) run.push(rows[j++]);
      const items = run.map((x) => jp(x.item)), rs = rounds(items), seqs = new Map(items.map((it, k) => [it, run[k].seq]));
      let failed = false;
      for (const round of rs) {
        const need = round.some((it) => !run[items.indexOf(it)].paid) && paid, h = need ? await this.hsRetainHold(round.map(itemExtractChars)) : { done: async () => 0 };
        if (!h) { failed = true; break; }
        try { await retainV2(this.env, bank, round); await h.done(); for (const it of round) this.sql.exec("DELETE FROM hs_outbox WHERE seq=?", seqs.get(it)); sent += round.length; }
        catch (e) { await h.done(0);
          if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 409 && e.status !== 429) { for (const it of round) this.sql.exec("DELETE FROM hs_outbox WHERE seq=?", seqs.get(it)); console.log("hindsight outbox dropped", e.message); }
          else { for (const it of round) { const q = this.sql.exec("SELECT tries FROM hs_outbox WHERE seq=?", seqs.get(it)).toArray()[0]; if (q && q.tries + 1 >= OUTBOX_MAX_TRIES) this.sql.exec("DELETE FROM hs_outbox WHERE seq=?", seqs.get(it)); else this.sql.exec("UPDATE hs_outbox SET tries=tries+1 WHERE seq=?", seqs.get(it)); } failed = true; console.log("hindsight outbox retry", e.message); }
        }
        if (failed) break;
      }
      if (failed) break; i = j;
    }
    return { sent, left: this.hsOutboxCount() };
  },
  // The alarm wants to wake the Resident again when the outbox holds entries that are not part of a rebuild.
  hsOutboxNext() { if (!this.hsW() || this.hsRebuilding()) return null; try { const r = this.hsOutboxCount() ? this.sql.exec("SELECT MIN(at) a, MAX(tries) t FROM hs_outbox").one() : null; return r ? Math.max(Date.now() + 1000, Number(r.a) + Math.min(30 * 60e3, 30e3 * 2 ** Math.min(6, Number(r.t || 0)))) : null; } catch { return null; } },
  async hsOutboxAlarm() { if (!this.hsW() || this.hsRebuilding() || !this.hsOutboxCount()) return null; return this.hsFlush({ max: 40, paid: true }).catch((e) => { console.log("hindsight outbox alarm", e.message); return null; }); },

  // ---- deletes: remove documents now and again later (hs_forget), and take their queued writes out of the outbox ----
  async hsDropDocs(docs, o = {}) {
    // Every delete of memory documents goes through forgetMemoryDocs (deletion.js): it clears the dedupe records (with HS_ENVELOPE) and leaves a
    // tombstone for a deleted import document unless o.tombstone is false, then deletes the documents from the bank now and again later.
    docs = [...new Set((docs || []).filter(Boolean))]; const t = this.get("tenant"), c = this.get("channel");
    if (!docs.length) return 0;
    if (!this.hsW()) { await forgetMemoryDocs(this.env, t, c, docs, { tombstone: o.tombstone, hindsight: false }); return 0; }
    this.hsOutboxInit(); for (const d of docs) this.sql.exec("DELETE FROM hs_outbox WHERE doc=? AND del=0", d);
    if (this.hsRebuilding()) this.hsRbDropped(docs.length);   // the rebuild's verify step knows documents went while it ran
    try { await forgetMemoryDocs(this.env, t, c, docs, { tombstone: o.tombstone }); } catch (e) { console.log("hindsight drop", e.message); }
    return docs.length;
  },
  // RPC for callers outside this object (the Worker's delete paths, the Archive's people, BeeSync's inbox).
  async hsDrop(docs) { return this.hsDropDocs(docs); },

  // The conversation documents the given turns are in (hsConvRewrite builds them again without some turns).
  hsConvDocsOfTurns(ids) {
    const tz = this.tz(), out = new Set();
    for (let i = 0; i < ids.length; i += 90) { const c = ids.slice(i, i + 90).map(String); for (const r of this.sql.exec(`SELECT at, session, workflow_id FROM turns WHERE id IN (${c.map(() => "?").join(",")})`, ...c).toArray()) out.add(convDocOf({ session: r.session, workflowId: r.workflow_id, at: Number(r.at) }, tz)); }
    return [...out];
  },
  // ---- turns and unfinished work (DESIGN 5.1) ----
  // One finished turn: its entries are appended to the task's document for the person's local day, with a constant tag set.
  async hsTurnWrite({ turn, session, at, userText, reply, notes, kind = "chat", workflowId = null, endAt = null }) {
    if (!this.hsW()) return { skipped: "off" };
    const { names, tz, channel } = await this.hsLocal(); let entries = convEntries({ userText, reply, notes, at, endAt, kind, labels: speakerLabels(names), tz });
    if (!entries.length) return { skipped: "empty" };
    const sid = convSession(session, workflowId), day = dayKey(at, tz);
    let item = turnItem({ doc: DOC.conv(sid, day), entries, at, context: ctxFor(kind === "chat" ? "chat" : "scheduled", names), channel, session: sid, day, key: turn });
    if (hsEnvelope(this.env)) {   // the envelope: when, and where when location services gave a fresh fix (adapters/chat.js)
      const where = kind === "chat" ? chatPlace(await locationOf(this.env, this.get("tenant")), at) : null;
      if (where?.lat != null) where.label = await placeLabel(this.env, this.get("tenant"), placeIdOf(where.lat, where.lng)).catch(() => null);   // "Home", "Office": the person's own name for the spot
      const e = chatEnvelope({ at, endAt, tz, where, session: sid, turn, kind });
      entries = placeEntries(entries, e); item = withEnvelope({ ...item, content: entries }, e, { first: names.first });
      if (where) try { this.sql.exec(TURN_PLACE); this.sql.exec("INSERT OR REPLACE INTO hs_turn_place (turn, place, lat, lng, at) VALUES (?,?,?,?,?)", String(turn), e.where.place || "", e.where.lat, e.where.lng, Number(at) || Date.now()); } catch (x) { console.log("turn place", x.message); }   // kept with the turn so a rebuild keeps it (1HC holds the originals)
    }
    const r = await this.hsPut([item]);
    if (session) await this.hsTaskSync(session).catch((e) => console.log("task card", e.message));   // the title or the checklist may have changed with this turn
    return r;
  },
  async hsPartialWrite({ session, turn, at, text }) {
    if (!this.hsW()) return { skipped: "off" };
    const row = this.sql.exec("SELECT kind, session, workflow_id FROM turns WHERE id=?", String(turn)).toArray()[0] || {}, { names, tz, channel } = await this.hsLocal();
    const entries = convEntries({ partial: text, at, kind: row.kind || "chat", labels: speakerLabels(names), tz }), sid = convSession(session ?? row.session, row.workflow_id), day = dayKey(at, tz);
    return this.hsPut([turnItem({ doc: DOC.conv(sid, day), entries, at, context: ctxFor("chat", names), channel, session: sid, day, key: `p:${turn}` })]);
  },

  // ---- Notebook notes: every add, edit and delete, from the person and from the helper (closes gap G1) ----
  async hsNoteSync(noteId) {
    if (!this.hsW()) return { skipped: "off" };
    const id = String(noteId), cid = this.get("channel_id"); let row = null;
    try { row = await this.archive().noteRow(String(cid), id); } catch (e) { console.log("note read", e.message); return { skipped: "read failed" }; }
    if (!row || row.status === "superseded") return { dropped: await this.hsDropDocs([DOC.note(id)]) };
    return this.hsNoteWrite(row);
  },
  async hsNoteWrite(row) {
    if (!this.hsW() || !row?.id) return { skipped: "off" };
    if (row.src === "reflection") return { skipped: "the nightly reflection is derived from memory, not a source" };   // phase 5 retires it; retaining it would feed memory back into itself
    const { names, channel, tz } = await this.hsLocal(); let it = noteItem({ row, names, channel });
    if (hsEnvelope(this.env)) it = withEnvelope(it, makeEnvelope({ kind: row.kind || null, kind1hc: "note", modality: "text", when: { start: it.at, tz, tzSource: "account", how: row.edited ? "edit" : "capture" }, links: { note: row.id },
      id: { record: `note:${row.id}` }, source: row.author_type === "human" ? "user" : "assistant" }), { first: names.first });
    return this.hsPut([it]);
  },

  // ---- Library files (DESIGN 5.1): the sidecar Markdown, or the text of a plain text or Markdown file itself ----
  // md: given by the caller (the meeting notes writer); otherwise read from the sidecar. Retained once per version of the bytes.
  async hsFileSync(fileId, { md = null, force = false } = {}) {
    if (!this.hsW()) return { skipped: "off" };
    const f = this.sql.exec("SELECT * FROM files WHERE id=? AND deleted=0", String(fileId)).toArray()[0];
    if (!f || f.pending) return { dropped: await this.hsDropDocs([DOC.file(fileId)]) };
    const r = await this.hsFileText(f, md); if (!r) return { skipped: "no text yet" };
    const sig = `${f.r2key}:${r.md.length}`;
    if (!force && this.get(`hsf:${f.id}`) === sig) return { skipped: "unchanged" };
    const { names, channel } = await this.hsLocal(), it = await this.hsFileEnrich(f, fileItem({ id: f.id, name: f.name, md: r.md, kind: r.kind, at: Number(f.at) || Date.now(), names, mime: f.mime, channel }));
    // An upload is deliberate, so a copy of a file already stored is stored too, linked to the first one (Captain 2026-10-14).
    if (it?.metadata?.dedupe) { const d = await dedupeSeen(this.env, this.get("tenant"), channel, it.metadata.dedupe, it.document_id, "1hc").catch(() => ({ first: true })); if (!d.first && d.doc) it.metadata.rel_same_as = d.doc; }
    const out = await this.hsPut([it]); if (out.sent || out.queued) this.put(`hsf:${f.id}`, sig); return out;
  },
  // → { md, kind } | null. A Markdown or plain text file is its own text (a meeting notes file is rewritten in place and has no fresh sidecar).
  async hsFileText(f, md = null) {
    const ext = String(f.name || "").toLowerCase().split(".").pop();
    if (md != null) return { md: String(md), kind: "text" };
    if (["md", "markdown", "txt"].includes(ext) && Number(f.bytes) <= HS_FILE_DIRECT_MAX) { const o = await this.env.WS.get(f.r2key); if (o) return { md: await o.text(), kind: "text" }; }
    let row = null; try { row = this.scRow(f.id); } catch {}
    if (!row || row.src_key !== f.r2key || !(row.status === "ready" || row.status === "text")) return null;
    const d = await this.sidecarDoc(row); return d?.md ? { md: d.md, kind: row.kind || "text" } : null;
  },

  // HS_ENVELOPE (adapters/media.js): a photo or a video gets its capture time, place and device from the file's own metadata, with no model
  // call; any other file gets its upload time and link. The details line goes in front of the text, the item's time becomes the capture
  // time (Hindsight dates the facts by it), and the place is looked up once per rounded spot (cached in this channel's storage).
  async hsFileEnrich(f, it) {
    if (!hsEnvelope(this.env) || !it) return it;
    const { tz, names } = await this.hsLocal(), uploadedAt = Number(f.at) || Date.now(), first = names.first;
    if (!isPhoto(f.mime, f.name) && !isVideo(f.mime, f.name)) return withEnvelope(it, makeEnvelope({ kind: f.mime || null, kind1hc: docKind1hc(f.mime, f.name), modality: "text", when: { start: uploadedAt, tz, tzSource: "account", how: "upload" }, links: { file: f.id },
      id: { record: `file:${f.id}` }, ingest: { at: uploadedAt }, source: fileSource(f.source) }), { first });
    let meta = null; const get = async (range) => { const o = await this.env.WS.get(f.r2key, { range }); return o ? new Uint8Array(await o.arrayBuffer()) : null; };
    try { meta = await readMediaMeta(get, { mime: f.mime, name: f.name, bytes: f.bytes }); } catch (e) { console.log("media metadata", String(e?.message || e).slice(0, 120)); }
    let hash = null; try { hash = await fileHash(this.env, f.r2key); } catch (e) { console.log("file hash", String(e?.message || e).slice(0, 120)); }
    // The dedupe key: the SHA-256 of the whole file (fileHash), so only a byte-identical file counts as the same photo.
    let place = "", label = null;
    if (meta?.lat != null) { place = await geocodeCached(this.env, meta.lat, meta.lng).catch(() => ""); label = await placeLabel(this.env, this.get("tenant"), placeIdOf(meta.lat, meta.lng)).catch(() => null); }
    const e = mediaEnvelope({ meta, tz, uploadedAt, place, label, fileId: f.id, mime: f.mime, name: f.name, hash, source: fileSource(f.source) }), line = mediaDetails(e, { tz });
    return withEnvelope({ ...it, ...(line && typeof it.content === "string" ? { content: `${line}\n\n${it.content}` } : {}), at: e.when.start || it.at }, e, { first });
  },

  // ---- channel skills and task cards ----
  async hsSkillSync(slug) {
    if (!this.hsW()) return { skipped: "off" };
    let r = null; try { r = this.sql.exec("SELECT slug, description, body, created, updated FROM channel_skills WHERE slug=?", String(slug)).toArray()[0]; } catch {}   // the table exists after the first saved skill
    if (!r) return { dropped: await this.hsDropDocs([DOC.skill(slug)]) };
    const { names, channel } = await this.hsLocal();
    return this.hsPut([skillItem({ slug: r.slug, description: r.description, body: r.body, at: r.updated, names, channel })]);
  },
  async hsTaskSync(session) {
    if (!this.hsW() || !session) return { skipped: "off" };
    const s = this.sql.exec("SELECT id, title, created, updated FROM sessions WHERE id=?", String(session)).toArray()[0];
    if (!s) return { dropped: await this.hsDropDocs([DOC.task(session)]) };
    const items = this.todoRow(session).items || [];   // every task has a card, with or without a checklist
    const { names, channel } = await this.hsLocal(), it = taskItem({ session: s.id, title: s.title, created: s.created, updated: s.updated, items, names, channel });
    const sig = await contentHash(`${s.title}|${JSON.stringify(items.map((x) => [x.id, x.text, x.status, x.by]))}`);
    if (this.get(`hst:${s.id}`) === sig) return { skipped: "unchanged" };
    const out = await this.hsPut([it]); if (out.sent || out.queued) this.put(`hst:${s.id}`, sig); return out;
  },
  // ---- live notes (DESIGN 5.1): the LiveNotes object sends raw lines, the Resident knows the names and the time zone ----
  async hsLiveAppend({ task, n, rows, mic = false, at, key }) {
    if (!this.hsW()) return { skipped: "off" };
    const { names, tz, channel } = await this.hsLocal(), entries = liveEntries(rows, { first: names.first, tz, mic });
    if (!entries.length) return { skipped: "empty" };
    return this.hsPut([liveItem({ task, n, entries, at: at || rows[0].at, names, channel, key })]);
  },
  // ---- the voice inbox (General only): the items BeeSync found eligible, as retain items ----
  async hsInboxPut(items) {
    if (!this.hsW() || this.get("channel") !== "main") return { skipped: "not General" };
    const { names, tz } = await this.hsLocal();
    return this.hsPut((items || []).filter(inboxEligible).map((it) => inboxItem({ it, names, tz })));
  },
  // ---- Bee conversations (General only): the transcript lines, with the summary in the context ----
  async hsBeePut({ id, lines, at, address, summary, started, ended, location = null, primary = null, timezone = null, device = null, start_raw = null, end_raw = null, speakers = [] }) {
    if (!this.hsW() || this.get("channel") !== "main") return { skipped: "not General" };
    const { names, tz } = await this.hsLocal(), entries = beeEntries(lines || [], { first: names.first, tz });
    if (!entries.length) return { skipped: "empty" };
    // The Bee path reserved its credits already (bee-sync.js), so the Resident does not hold again.
    let item = beeItem({ id, entries, at, address, summary, started, ended, names });
    if (hsEnvelope(this.env)) item = beeEnveloped(item, { id, lines, at, started, ended, location, primary, timezone, device, start_raw, end_raw, speakers }, { first: names.first });   // HS_ENVELOPE: Bee's time, place and speakers, as Bee gave them (adapters/bee.js)
    return this.hsPut([item], { paid: false });
  },
  // ---- Contacts cards (General only): contact:<person id>. ids: the people that changed; null = the ones added or changed since the last catch-up (an import). ----
  async hsContactSync(ids = null) {
    if (!this.hsW() || this.get("channel") !== "main") return { skipped: "not General" };
    const A = this.archive(), all = await A.peopleList(), byId = new Map(all.map((p) => [String(p.id), p]));
    let want, since = Number(this.get("hs_contacts_at") || 0);
    if (ids) want = ids.map(String); else want = all.filter((p) => Number(p.updated || p.created) > since).sort((a, b) => (a.updated || 0) - (b.updated || 0)).slice(0, 200).map((p) => String(p.id));
    const { names } = await this.hsLocal(), put = [], drop = [];
    for (const id of want) { const p = byId.get(id); if (p?.name) put.push(contactItem({ p, names })); else drop.push(DOC.contact(id)); }
    if (!ids && want.length) this.put("hs_contacts_at", String(Math.max(since, ...want.map((id) => Number(byId.get(id)?.updated || byId.get(id)?.created || 0)))));
    if (drop.length) await this.hsDropDocs(drop);
    return put.length ? this.hsPut(put) : { dropped: drop.length };
  },
};
const HS_FILE_DIRECT_MAX = 2e6;
export const writersMix = (Cls) => Object.assign(Cls.prototype, writerMethods);
// Worker-level helper: Contacts changed (people ids), or null for the ones an import added. General's bank only.
export async function hsContactNotify(env, tenantId, ids) {
  if (!hsWriters(env) || !env.RESIDENT) return null;
  try { const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tenantId}:main`)); return await R.hsContactSync(ids); }
  catch (e) { console.log("contact memory sync", String(e?.message || e).slice(0, 160)); return null; }
}
// Worker-level helper: a Notebook note was added, edited or deleted in this channel (any writer: the app, the helper, Bee, the interview).
export async function hsNoteNotify(env, tenantId, slug, channelId, noteId) {
  if (!hsWriters(env) || !env.RESIDENT) return null;
  try { const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tenantId}:${slug}`)); await R.bind(tenantId, slug, String(channelId)); return await R.hsNoteSync(String(noteId)); }
  catch (e) { console.log("note memory sync", String(e?.message || e).slice(0, 160)); return null; }
}
