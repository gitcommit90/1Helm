// Import from a source (the design notes, flag HS_ENVELOPE): the rebuild job made general. An importer reads one source's
// records in pages; each record becomes envelope items in THIS channel's bank (an import never writes to another channel). The job:
//   - runs only with the source registered and consented (memory-sources.js),
//   - can estimate first (records, characters, cost at the meter), and starts as a dry run unless asked otherwise,
//   - saves its cursor before each batch, so a deploy or a crash resumes where it stopped; pause and resume work at any time,
//   - is idempotent: a document id is "imp:<source>:<record id>" and a record seen again replaces its document; the same real event already
//     stored (its dedupe key) is linked, not stored twice,
//   - runs one source at a time per channel, driven by the channel's alarm, with bounded steps.
// "Remove everything from my Google import": hsForgetSource deletes every "imp:<source>:" document (and queues the delayed re-deletes),
// the source's dedupe rows, and marks the source forgotten.
// Importers: { kind, page(res, state, limit) → { records, next, done }, toItems(record, ctx) }. The built-in "jsonl" importer reads a Library
// file of envelope records, one JSON object per line (ENVELOPE.md has the record shape), so any exporter can feed memory by writing that file.
import { hsEnvelope } from "./hs-flag.js";
import { withEnvelope, makeEnvelope, checkItems, resolvePeople } from "./memory-envelope.js";
import { sourceRow, consented, sourceImported, setSourceStatus, dedupeSeenAll, dedupeForgetSource, geocodeCached, tombstoned, clearTombstones } from "./memory-sources.js";
import { listDocuments } from "./mem0.js";
import { itemsNano } from "./hindsight-writers.js";
import { BYOK_MARKUP } from "./byok-meter.js";
import { offsetMin } from "./adapters/media.js";

export const IMPORT_VERSION = 1, IMPORT_BATCH = 20, IMPORT_STEP_MS = 20e3, IMPORT_MAX_TRIES = 8, IMPORT_PAGE_BYTES = 128 * 1024;
const now = () => Date.now();
const sha = async (txt) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
const jp = (s) => { try { return JSON.parse(s); } catch { return null; } };
// A value exactly as it arrived (Captain 2026-10-14: no length limits, no collapsing of spaces or control characters). Only a value with
// no visible character counts as missing. Hindsight itself removes the few characters PostgreSQL cannot store (NUL, other C0 controls
// except tab, newline and carriage return, lone surrogates) from the whole retain item, metadata included (hindsight@v1.0.0
// hindsight-api-slim/hindsight_api/engine/llm_wrapper.py sanitize_text, tests/test_input_robustness.py "Prong D").
const one = (s) => { const t = String(s ?? ""); return t.trim() ? t : ""; };
const GEN = "[Written by 1Helm from the record]";   // marks the lines 1HC adds from the record's fields
export const impDoc = (source, id) => `imp:${source}:${String(id).replace(/\s+/g, "_").slice(0, 160)}`;

// ---- importers ----
export const IMPORTERS = {
  // A Library file (state.file) of envelope records, one JSON object per line:
  //   { id, kind, modality, title, text, when: { start, end, tz, offset }, where: { place, address, lat, lng }, who: [{ name, email, phone, self, role }],
  //     source: "user" | "third_party" | "assistant" (the person's own item, e.g. their sent email, is user; one from someone else, e.g. a received
  //     email, is third_party), device, dedupe, distill: false }
  // A record that does not say its source is treated as third_party (never a fact about the person, never instructions).
  // The cursor is a byte offset; a page is the whole lines inside the next IMPORT_PAGE_BYTES bytes.
  jsonl: {
    kind: "jsonl",
    async page(res, s, limit) {
      const f = res.sql.exec("SELECT r2key, bytes FROM files WHERE id=? AND deleted=0", String(s.file || "")).toArray()[0];
      if (!f) throw new Error("import: the Library file is gone");
      const at = Number(s.cursor) || 0; if (at >= Number(f.bytes)) return { records: [], next: at, done: true };
      const o = await res.env.WS.get(f.r2key, { range: { offset: at, length: IMPORT_PAGE_BYTES } }); if (!o) throw new Error("import: the Library file cannot be read");
      const buf = new Uint8Array(await o.arrayBuffer()); let end = buf.lastIndexOf(10); const last = at + buf.length >= Number(f.bytes);
      if (end < 0) { if (!last) throw new Error("import: a line is longer than one page"); end = buf.length - 1; }
      const text = new TextDecoder().decode(buf.subarray(0, last ? buf.length : end + 1)), recs = [];
      for (const line of text.split("\n")) { const t = line.trim(); if (!t) continue; const r = jp(t); if (r && r.id != null && (r.text || r.content)) recs.push(r); if (recs.length >= limit) break; }
      const next = last ? Number(f.bytes) : at + end + 1;
      return { records: recs, next, done: next >= Number(f.bytes) };
    },
    toItems(r, ctx) {
      const t = (x) => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : Date.parse(x) || null), offset = r.when?.offset ?? null;
      const e = makeEnvelope({
        kind: r.kind ?? null, modality: r.modality,   // the record's own kind as given; 1HC's kind only when it is exactly one of KINDS
        when: { start: t(r.when?.start), end: t(r.when?.end), tz: r.when?.tz || null, offset, tzSource: offset != null || r.when?.tz ? "source" : "unknown", precision: r.when?.precision, how: "import" },
        where: r.where ? { ...r.where, place: r.where.place || ctx.placeOf?.(r.where) || null, placeFrom: r.where.place ? "source" : "geocoded", how: "import" } : null,
        who: resolvePeople((r.who || []).map((p) => ({ name: p.name || p.email || p.phone, email: p.email, phone: p.phone, self: p.self === true, role: p.role })), ctx.people),
        from: { key: ctx.source, device: r.device || null }, links: { import: ctx.source, ...(r.links || {}) },
        id: { record: String(r.id), dedupe: r.dedupe || null }, ingest: { at: now() },
        source: ["user", "assistant", "third_party"].includes(r.source) ? r.source : "third_party",
      });
      // The record's own local time with its offset; UTC, said as such, when the record gives no zone.
      const off = e.when.start == null ? null : e.when.offset ?? (e.when.tz ? offsetMin(e.when.start, e.when.tz) : null), a = Math.abs(off || 0);
      const when = e.when.start == null ? "" : `${new Date(e.when.start + (off || 0) * 60e3).toISOString().slice(0, 16).replace("T", " ")} ${off == null ? "UTC" : `(UTC${off < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")})`}`;
      const head = [r.title ? one(r.title) : "", when ? `${GEN} When: ${when}` : "", e.where?.place ? `${GEN} Where: ${e.where.place}` : "", e.who.filter((p) => !p.self).length ? `${GEN} With: ${e.who.filter((p) => !p.self).map((p) => p.name).join(", ")}` : ""].filter(Boolean).join("\n");
      const item = { document_id: impDoc(ctx.source, r.id), strategy: r.distill === true ? "chat" : "reference", tags: ["source:import"], observation_scopes: "shared",
        content: `${head ? `${head}\n\n` : ""}${String(r.text || r.content)}`, at: e.when.start || now(), update_mode: "replace",
        context: `An item imported from ${one(ctx.label || ctx.source)} into ${one(ctx.first) || "the user"}'s memory.`, metadata: { kind: "import", source: ctx.source } };
      return [withEnvelope(item, e, { first: ctx.first })];
    },
  },
};

// ---- the job, mixed into the Resident ----
const blank = (source) => ({ v: IMPORT_VERSION, source, auto: false, status: "idle", kind: null, file: null, cursor: 0, sent: 0, linked: 0, skipped: 0, batches: 0, tries: 0, error: null, started: 0, updated: 0, finished: 0, pause: false, retry_at: 0, dry: true });
export const importMethods = {
  hsImp(source) { return { ...blank(source), ...(jp(this.get(`hs_imp:${source}`)) || {}) }; },
  hsImpSave(s) { s.updated = now(); this.put(`hs_imp:${s.source}`, JSON.stringify(s)); this.put("hs_imp_active", s.status === "running" ? s.source : (this.get("hs_imp_active") === s.source ? "" : this.get("hs_imp_active") || "")); return s; },
  // cmd: start | estimate | status | pause | resume | forget. o: { source, kind, file, dry, auto }. auto: true only for an automatic re-sync
  // from a connected source; a person's own import is deliberate (the default).
  async hsImport(cmd = "status", o = {}) {
    if (!hsEnvelope(this.env)) return { error: "HS_ENVELOPE is off" };
    const source = String(o.source || this.get("hs_imp_active") || ""); if (!source) return { error: "source is required" };
    const row = await sourceRow(this.env, this.get("tenant"), source);
    if (cmd === "status") return this.hsImpView(this.hsImp(source), row);
    if (cmd === "forget") { if (row && row.channel !== this.get("channel")) return { error: "the source belongs to another channel" }; return this.hsForgetSource(source); }
    if (!row || row.channel !== this.get("channel")) return { error: "the source is not registered for this channel" };   // the air gap: a source belongs to one channel's bank
    if (!consented(row)) return { error: "the source has no recorded consent" };
    const kind = String(o.kind || row.kind), imp = IMPORTERS[kind]; if (!imp) return { error: `no importer for ${kind}` };
    let s = this.hsImp(source);
    if (cmd === "estimate") return this.hsImportEstimate({ ...s, kind, file: o.file ?? s.file });
    if (cmd === "pause") { if (s.status === "running") { s.pause = true; this.hsImpSave(s); } return this.hsImpView(s, row); }
    if (cmd === "resume") { if (s.status === "paused" || s.status === "failed") { s.status = "running"; s.tries = 0; s.error = null; s.pause = false; this.hsImpSave(s); await this.arm().catch(() => {}); } return this.hsImpView(s, row); }
    if (cmd === "start") {
      const active = this.get("hs_imp_active"); if (active && active !== source && this.hsImp(active).status === "running") return { error: `another import is running here (${active})` };
      if (o.dry !== false) return { dry: true, would: "start", source, kind, file: o.file ?? null, estimate: await this.hsImportEstimate({ ...blank(source), kind, file: o.file ?? null }) };
      // auto: an automatic re-sync from a connected source
      s = { ...blank(source), kind, file: o.file ?? null, auto: o.auto === true, status: "running", started: now(), dry: false }; this.hsImpSave(s); await this.arm().catch(() => {});
      return { ok: "started", ...this.hsImpView(s, row) };
    }
    return { error: `unknown command ${cmd}` };
  },
  hsImpView(s, row = null) { return { source: s.source, status: s.status, kind: s.kind, cursor: s.cursor, sent: s.sent, linked: s.linked, skipped: s.skipped, batches: s.batches, error: s.error, started: s.started, finished: s.finished, registry: row ? { status: row.status, items: row.items, consent_at: row.consent_at } : null }; },
  hsImportNext() { if (!hsEnvelope(this.env)) return null; const a = this.get("hs_imp_active"); if (!a) return null; const s = this.hsImp(a); return s.status === "running" ? Math.max(s.retry_at || 0, now() + 500) : null; },
  async hsImportAlarm() {
    if (!hsEnvelope(this.env)) return; const a = this.get("hs_imp_active"); if (!a) return;
    const s = this.hsImp(a); if (s.status !== "running" || (s.retry_at && s.retry_at > now())) return;
    const t0 = now();
    try {
      while (s.status === "running" && now() - t0 < IMPORT_STEP_MS) {
        if (s.pause) { s.status = "paused"; s.pause = false; this.hsImpSave(s); break; }
        const r = await this.hsImportBatch(s); if (r === "done") break;
      }
      s.tries = 0; s.error = null; this.hsImpSave(s);
    } catch (e) {
      s.tries = (s.tries || 0) + 1; s.error = String(e?.message || e).slice(0, 300);
      if (s.tries >= IMPORT_MAX_TRIES) s.status = "failed"; else s.retry_at = now() + Math.min(10 * 60e3, 15e3 * 2 ** (s.tries - 1));
      this.hsImpSave(s); console.log("memory import", s.source, s.error);
    }
    if (s.status === "running") await this.arm().catch(() => {});
  },
  // One page → items → dedupe → send. The cursor moves only after the batch is sent or queued (a crash repeats the batch, and the send is idempotent).
  async hsImportBatch(s) {
    const imp = IMPORTERS[s.kind], ctx = await this.hsImportCtx(s);
    const pg = await imp.page(this, s, IMPORT_BATCH), t = this.get("tenant"), ch = this.get("channel");
    for (const rec of pg.records) if (rec?.where && rec.where.lat != null && !rec.where.place) await ctx._geo(rec.where);
    const built = []; for (const rec of pg.records) built.push(...checkItems(imp.toItems(rec, ctx)));
    // A deliberate import (the person started it) is always accepted: a record the person deleted comes back, and a copy of an item already
    // stored is stored too, linked to it (rel_same_as). Only an automatic re-sync from a connected source (s.auto) skips deleted records
    // (tombstones) and links a copy instead of storing it again (Captain 2026-10-14).
    const dead = s.auto ? await tombstoned(this.env, t, ch, built.map((x) => x.document_id)) : new Set(), items = [];
    for (const it of built) {
      if (dead.has(it.document_id)) { s.skipped++; continue; }
      // Dedupe: 1) the document id is source + record, so the same record again replaces itself; 2) a content fingerprint; 3) the cross source key.
      const fp = `fp:${await sha(`${it.metadata?.when_start || ""}\n${typeof it.content === "string" ? it.content : JSON.stringify(it.content)}`)}`;
      let same = null;
      { const d = await dedupeSeenAll(this.env, t, ch, [fp, it.metadata?.dedupe], it.document_id, s.source, { linkOnly: !!s.auto }); if (!d.first) same = d.doc; }   // every matching key gets this source, not only the first
      if (same) { s.linked++; if (s.auto) continue; it.metadata = { ...it.metadata, rel_same_as: same }; }
      items.push(it);
    }
    if (items.length) { const r = await this.hsPut(items, { paid: true }); if (r?.error) throw new Error(`import send: ${r.error}`); s.sent += items.length; await sourceImported(this.env, this.get("tenant"), s.source, items.length); if (!s.auto) await clearTombstones(this.env, t, ch, items.map((x) => x.document_id)); }
    s.cursor = pg.next; s.batches++;
    if (pg.done) { s.status = "done"; s.finished = now(); }
    this.hsImpSave(s); return pg.done ? "done" : "go";
  },
  async hsImportCtx(s) {
    const { names, tz, channel } = await this.hsLocal(), row = await sourceRow(this.env, this.get("tenant"), s.source);
    let people = []; try { people = await this.archive().peopleList(); } catch {}
    const geo = new Map();
    return { source: s.source, label: row?.label || s.source, first: names.first, tz, channel, people, placeOf: (w) => (w?.lat != null ? geo.get(`${w.lat},${w.lng}`) || null : null),
      _geo: async (w) => { if (w?.lat == null) return; const k = `${w.lat},${w.lng}`; if (!geo.has(k)) geo.set(k, await geocodeCached(this.env, w.lat, w.lng).catch(() => "")); } };
  },
  // Records, characters and cost at the meter, without sending anything. Reads the whole source (bounded to 50 pages).
  async hsImportEstimate(s0) {
    const imp = IMPORTERS[s0.kind]; if (!imp) return { error: `no importer for ${s0.kind}` };
    const s = { ...s0, cursor: 0 }, ctx = await this.hsImportCtx(s); let records = 0, items = [], pages = 0, done = false;
    while (!done && pages < 50) { const pg = await imp.page(this, s, IMPORT_BATCH); pages++; records += pg.records.length; for (const r of pg.records) items.push(...imp.toItems(r, ctx)); s.cursor = pg.next; done = pg.done; }
    let nano = 0; for (let i = 0; i < items.length; i += IMPORT_BATCH) nano += itemsNano(items.slice(i, i + IMPORT_BATCH));   // one send per batch, as the job sends
    nano = Math.ceil(nano * BYOK_MARKUP);
    return { source: s.source, records, items: items.length, characters: items.reduce((n, i) => n + String(i.content || "").length, 0), complete: done, cost_usd: nano / 1e9 };
  },
  // Delete and forget a whole source in this channel's bank.
  async hsForgetSource(source) {
    const docs = (await listDocuments(this.env, this.hsBankId(), { limit: 100000, q: `imp:${source}:` })).map((d) => d.id);
    const s = this.hsImp(source); if (s.status === "running") { s.status = "paused"; this.hsImpSave(s); }
    const dropped = await this.hsDropDocs(docs, { tombstone: false });   // deletes now and queues the delayed re-deletes (hs_forget), and drops queued writes. No tombstones: a new consented import of the source may bring it back.
    await dedupeForgetSource(this.env, this.get("tenant"), source); await setSourceStatus(this.env, this.get("tenant"), source, "forgotten");
    return { source, documents: docs.length, dropped };
  },
};
export const importMix = (Cls) => Object.assign(Cls.prototype, importMethods);

// ---- the dev admin path (POST /_ops/hs-import) ----
// action=sources | register | estimate | start | status | pause | resume | forget, with slug, channel (default main) and source.
// register records consent for a source, so it is allowed only on test accounts (owner email @example.com); a real person gives consent in the app.
// start is a dry run unless dry=0. file: the Library file id for the jsonl importer.
export async function hsImportAdmin(env, action, { slug = "", channel = "main", source = "", kind = "jsonl", file = "", label = "", dry = true, archive } = {}) {
  if (!hsEnvelope(env)) return { error: "HS_ENVELOPE is off" };
  if (env.ENV_NAME !== "dev") return { error: "dev only" };
  if (!["sources", "register", "estimate", "start", "status", "pause", "resume", "forget"].includes(action)) return { error: "action must be sources, register, estimate, start, status, pause, resume or forget" };
  const t = slug ? await env.DB.prepare("SELECT t.id, t.slug, u.email FROM tenants t LEFT JOIN users u ON u.id=t.owner_user_id WHERE t.slug=?").bind(slug).first() : null;
  if (!t) return { error: "slug: no such workspace" };
  const { listSources, registerSource } = await import("./memory-sources.js");
  if (action === "sources") return { sources: await listSources(env, t.id) };
  if (action === "register") {
    if (!/@example\.com$/i.test(String(t.email || ""))) return { error: "register is for test accounts only: a real person records consent in the app" };
    return { source: await registerSource(env, t.id, { key: source, channel, kind, label, consentScope: "dev admin, test account" }) };
  }
  const chans = archive ? ((await archive(env, t.id).channels().catch(() => [])) || []) : [], c0 = chans.find((c) => (c.slug || c.name) === channel);
  if (archive && !c0) return { error: "no such channel" };
  const res = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${c0 ? c0.slug || c0.name : channel}`));
  return res.hsImport(action, { source, kind, file: file || undefined, dry });
}
