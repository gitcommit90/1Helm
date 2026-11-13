// One Library item for an editable file and its PDF.
//
// Facts this file implements:
//  1. share_file of a PDF: when the same task (files.session) already gave an editable file with the same base name (.docx .docm .odt
//     .pptx .xlsx .html .md), or the channel computer has an editable file with that base name in the PDF's own folder that was written
//     in this task, the PDF is not a second Library item. It is stored as that file's "PDF copy" (table file_pdf_copies) and the Library
//     item stays the editable file. A PDF shared before its source (same task, same base name) is folded into the source when the source arrives.
//  2. A PDF copy belongs to the exact bytes of the version it sits with (src_key = the file's r2key then). A new version of the file makes
//     the shared copy stale: it is not served as current, and the next "Download as PDF" makes a fresh PDF from the new version (the shared
//     bytes are deleted then). Sharing a PDF again for the file replaces the copy (the old bytes are deleted).
//  3. Every Word document, deck and spreadsheet in the Library has a PDF to download: the shared copy when it is current, else a PDF
//     made on the channel computer with LibreOffice (the same converter as the viewer's previews) and kept per version.
// Additive only: one table, no change to files.
import { extOf, safeName } from "./files.js";
import { stDelete } from "./storage.js";
import { previewKind, previewName } from "./file-preview.js";

export const PAIR_EXT = ["docx", "docm", "odt", "pptx", "xlsx", "html", "md"];   // the editable types a PDF can be kept with, in the order a tie is broken
export const SHEET_EXT = new Set(["xlsx", "xls", "xlsm", "ods"]);
export const pdfKind = (name) => { const e = extOf(name); return previewKind(name) || (SHEET_EXT.has(e) ? "sheet" : null); };   // "doc" | "deck" | "sheet" | null: what the converter can turn into a PDF
// "Plan (2).docx" and "plan.docx" have the same base.
export const baseOf = (n) => String(n).replace(/\.[a-z0-9]{1,8}$/i, "").replace(/ \(\d+\)$/, "").trim().toLowerCase();
const rank = (name) => { const i = PAIR_EXT.indexOf(extOf(name)); return i < 0 ? 99 : i; };

// Pure: the editable Library file a PDF belongs with, from facts. rows: Library rows; bases: base names of the PDF; session: the task.
export function pickSource(rows, bases, session) {
  if (!session) return null;
  const c = rows.filter((r) => r.session === session && !r.deleted && PAIR_EXT.includes(extOf(r.name)) && bases.has(baseOf(r.name)));
  c.sort((a, b) => rank(a.name) - rank(b.name) || (b.at || 0) - (a.at || 0));
  return c[0] || null;
}
// Pure: the Library PDFs of this task with this base name (shared before their source).
export function pickPdfs(rows, base, session) {
  if (!session) return [];
  return rows.filter((r) => r.session === session && !r.deleted && extOf(r.name) === "pdf" && baseOf(r.name) === base).sort((a, b) => (b.at || 0) - (a.at || 0));
}

const TABLE = "CREATE TABLE IF NOT EXISTS file_pdf_copies (file_id TEXT PRIMARY KEY, src_key TEXT NOT NULL, key TEXT NOT NULL, bytes INTEGER NOT NULL, name TEXT, origin TEXT NOT NULL, at INTEGER NOT NULL)";
export const hasCopies = (sql) => sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_pdf_copies'").toArray().length > 0;
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

export const residentPdf = {
  pcRow(id) { this.sql.exec(TABLE); return this.sql.exec("SELECT * FROM file_pdf_copies WHERE file_id=?", String(id)).toArray()[0] || null; },
  pcShared() { if (!this._pcIds) { this.sql.exec(TABLE); this._pcIds = new Set(this.sql.exec("SELECT file_id FROM file_pdf_copies WHERE origin='shared'").toArray().map((r) => r.file_id)); } return this._pcIds; },
  async pcDrop(row) { if (!row) return; this.sql.exec("DELETE FROM file_pdf_copies WHERE file_id=?", row.file_id); this._pcIds = null; try { await stDelete(this.env, [{ key: row.key, size: row.bytes ?? null }]); } catch (e) { console.log("pdf copy", e.message); } },
  // The file is gone (deleteFile): its PDF copy goes with it.
  async dropPdfCopy(id) { try { if (!hasCopies(this.sql)) return; await this.pcDrop(this.pcRow(id)); } catch (e) { console.log("drop pdf copy", e.message); } },

  // → { key, bytes, name, shared } | { error, status }. make: false only serves what exists (view-as, read-only: nothing wakes the computer).
  async filePdfCopy(id, { make = true } = {}) {
    const f = await this.fileRow(id); if (!f || f.pending) return { error: "No such file.", status: 404 };
    const kind = pdfKind(f.name); if (!kind && extOf(f.name) !== "pdf" && !this.pcRow(f.id)) return { error: "This kind of file can't be turned into a PDF here.", status: 415 };
    if (extOf(f.name) === "pdf") return { error: "This file is already a PDF.", status: 415 };
    const row = this.pcRow(f.id), pname = previewName(f.name);
    if (row && row.src_key === f.r2key) return { key: row.key, bytes: row.bytes, name: pname, shared: row.origin === "shared" };
    if (!kind) return { error: "The PDF kept with this file is from an earlier version, and this kind of file can't be turned into a PDF here.", status: 409 };
    if (!make) return { error: "The PDF isn't ready yet.", status: 409 };
    let out;
    if (kind === "sheet") {
      const jobs = (this._pcJobs ||= new Map()), k = `${f.id}\n${f.r2key}`;
      if (!jobs.has(k)) jobs.set(k, this.makeSheetPdf(f).finally(() => jobs.delete(k)));
      out = await jobs.get(k); if (out.error) return out;
    } else {
      const p = await this.filePreview(f.id); if (p.error) return p;   // file-preview.js: cached per version (file_previews)
      out = { key: p.key, bytes: p.bytes };
      if (row) await this.pcDrop(row);   // a stale shared copy: the new version's PDF replaces it
    }
    return { key: out.key, bytes: out.bytes, name: pname, shared: false };
  },
  async makeSheetPdf(f) {
    const old = this.pcRow(f.id), key = `${f.r2key}.copy.pdf`;
    let r; try { r = await this.computer().officeToPdf(f.r2key, key, extOf(f.name)); } catch (e) { return { error: `Couldn't make a PDF: the computer couldn't start (${String(e?.message || e).slice(0, 120)})`, status: 503 }; }
    if (!r.ok) return { error: r.storage_full ? "Your storage is full, so there's no room for a PDF." : `Couldn't make a PDF: ${r.error}`, status: r.storage_full ? 507 : 422 };
    if (!(await this.fileRow(f.id))) { try { await stDelete(this.env, [{ key, size: r.bytes }]); } catch {} return { error: "No such file.", status: 404 }; }
    this.sql.exec("INSERT INTO file_pdf_copies (file_id, src_key, key, bytes, name, origin, at) VALUES (?,?,?,?,?,'made',?) ON CONFLICT(file_id) DO UPDATE SET src_key=excluded.src_key, key=excluded.key, bytes=excluded.bytes, name=excluded.name, origin='made', at=excluded.at", f.id, f.r2key, key, r.bytes, previewName(f.name), Date.now());
    this._pcIds = null;
    if (old && old.key !== key) { try { await stDelete(this.env, [{ key: old.key, size: old.bytes ?? null }]); } catch (e) { console.log("old pdf copy", e.message); } }
    return { key, bytes: r.bytes };
  },

  // ---- pairing ----
  // The editable file with the PDF's base name next to it on the computer, written in this task (its modification time is not before the task began).
  async computerSibling(path, ctx) {
    try {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", file = path.split("/").pop(), base = file.replace(/\.pdf$/i, "");
      const since = Math.floor(Number(this.sql.exec("SELECT created FROM sessions WHERE id=?", String(ctx.session)).toArray()[0]?.created || 0) / 1000) - 5;
      const cmd = `cd /workspace || exit 0; for e in ${PAIR_EXT.join(" ")}; do f=${q((dir ? dir + "/" : "") + base)}.$e; [ -f "$f" ] && echo "$e $(stat -L -c %Y "$f")"; done`;
      const r = await this.computer().exec(cmd, { save: "none", timeoutMs: 10e3 });
      const found = String(r?.out || "").split("\n").map((l) => l.trim().match(/^([a-z0-9]+) (\d+)$/)).filter(Boolean).map((m) => ({ ext: m[1], at: Number(m[2]) })).filter((x) => x.at >= since);
      found.sort((a, b) => PAIR_EXT.indexOf(a.ext) - PAIR_EXT.indexOf(b.ext));
      return found[0] ? `${dir ? dir + "/" : ""}${base}.${found[0].ext}` : null;
    } catch (e) { return null; }
  },
  // share_file of a PDF → the answer text when it was kept with an editable file, null when it is just a file.
  async pairPdf({ path, name }, ctx) {
    if (!ctx.session) return null;
    const bases = new Set([baseOf(name), baseOf(path.split("/").pop())]);
    const rows = () => this.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND hidden=0").toArray();
    let src = pickSource(rows(), bases, ctx.session), via = "it was given in this task";
    if (!src) {
      const sib = await this.computerSibling(path, ctx); if (!sib) return null;
      const t0 = Date.now() - 1, said = await this.shareFile({ path: sib }, ctx); if (/^error:/.test(said)) return null;
      src = this.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND at>=?", t0).toArray().find((r) => PAIR_EXT.includes(extOf(r.name)) && bases.has(baseOf(r.name))) || null;
      if (!src) return null;
      via = `it is next to the PDF on your computer and was written in this task, so it was shared too`;
    }
    const tenant = this.get("tenant"), channel = this.get("channel"), key = `t/${tenant}/files/${channel}/${src.id}.pdf.${Date.now().toString(36)}`;
    let r; try { r = await this.computer().fileToR2(path, key, 250 * 1024 * 1024); } catch (e) { return `error: ${e.message}`; }
    if (!r.ok) return `error: ${r.error}`;
    await this.setSharedCopy(src, { key, bytes: r.bytes, name: safeName(name) });
    const f = this.fileView(this.sql.exec("SELECT * FROM files WHERE id=?", src.id).one());
    ctx.emit?.({ t: "file", file: f }); this.recordShare?.(src, ctx.turn);
    return `Kept "${safeName(name)}" (${r.bytes} bytes) with "${src.name}" as its PDF copy, because ${via}. The Library shows one item, "${src.name}" (the editable file), and the PDF copy is kept with it for download and attachments. The card shows under your reply in this chat. Don't paste its contents; one line about what it is is enough.`;
  },
  async setSharedCopy(src, { key, bytes, name }) {
    const old = this.pcRow(src.id);
    this.sql.exec("INSERT INTO file_pdf_copies (file_id, src_key, key, bytes, name, origin, at) VALUES (?,?,?,?,?,'shared',?) ON CONFLICT(file_id) DO UPDATE SET src_key=excluded.src_key, key=excluded.key, bytes=excluded.bytes, name=excluded.name, origin='shared', at=excluded.at", src.id, src.r2key, key, bytes, name || previewName(src.name), Date.now());
    this._pcIds = null;
    if (old && old.key !== key) { try { await stDelete(this.env, [{ key: old.key, size: old.bytes ?? null }]); } catch (e) { console.log("old pdf copy", e.message); } }
  },
  // A PDF of this task was shared before its source: now that the source is in the Library, the PDF becomes the source's PDF copy and its
  // own Library row goes (its bytes stay as the copy). → text for share_file's answer, "" when there is nothing to fold.
  async foldSharedPdf(src, ctx) {
    try {
      if (!ctx.session || !PAIR_EXT.includes(extOf(src.name))) return "";
      const cur = this.sql.exec("SELECT * FROM files WHERE id=?", src.id).toArray()[0]; if (!cur || cur.session !== ctx.session) return "";
      const pdfs = pickPdfs(this.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND hidden=0").toArray(), baseOf(src.name), ctx.session); if (!pdfs.length) return "";
      const p = pdfs[0];
      await this.setSharedCopy(cur, { key: p.r2key, bytes: p.bytes, name: p.name });
      for (const o of pdfs) {
        this.sql.exec("UPDATE files SET deleted=1, synced=CASE WHEN synced=1 THEN -1 ELSE 0 END WHERE id=?", o.id);
        const own = (k) => k && k !== p.r2key, drop = [...(own(o.view_key) ? [o.view_key] : []), ...(own(o.prev_key) ? [{ key: o.prev_key, size: o.prev_bytes ?? null }] : []), ...(own(o.orig_key) && o.orig_key !== o.prev_key ? [{ key: o.orig_key, size: o.orig_bytes ?? null }] : []), ...(o.id !== p.id ? [{ key: o.r2key, size: o.bytes }] : [])];
        try { if (drop.length) await stDelete(this.env, drop); } catch (e) { console.log("fold pdf", e.message); }
        try { this.sql.exec("DELETE FROM file_shares WHERE file_id=?", o.id); } catch {}
        await (await import("./share.js")).shareFileDeleted(this.env, this.get("tenant"), o.id).catch(() => {});   // loaded here, not at the top: share.js reaches the licensed seam (ee/index.js), and a top import would make a cycle with deletion-do.js
        await this.dropPreview?.(o.id); await this.dropSidecar?.(o.id);
      }
      const f = this.fileView(this.sql.exec("SELECT * FROM files WHERE id=?", src.id).one()); ctx.emit?.({ t: "file", file: f });
      return ` The PDF "${p.name}" you shared earlier in this task is now kept with it as its PDF copy, so the Library shows one item.`;
    } catch (e) { console.log("fold pdf", String(e?.message || e).slice(0, 160)); return ""; }
  },
};
export function pdfMix(Cls) { Object.assign(Cls.prototype, residentPdf); }
// R2 keys and row cleanup for deletion-do.js
export function pdfCopyKeys(sql, ids = null) {
  if (!hasCopies(sql)) return [];
  const rows = ids ? ids.flatMap((id) => sql.exec("SELECT key, bytes FROM file_pdf_copies WHERE file_id=?", String(id)).toArray()) : sql.exec("SELECT key, bytes FROM file_pdf_copies").toArray();
  return rows.map((r) => ({ key: r.key, size: r.bytes ?? null }));
}
export function dropPdfCopyRows(sql, ids = null) {
  if (!hasCopies(sql)) return;
  if (ids) for (const id of ids) sql.exec("DELETE FROM file_pdf_copies WHERE file_id=?", String(id)); else sql.exec("DELETE FROM file_pdf_copies");
}
