// Office files open in the app's file viewer. A slide deck (.pptx/.ppt/.odp) or a Word document (.docx/.doc/.odt/.rtf) has no
// browser renderer worth trusting, so the channel computer turns it into a PDF with headless LibreOffice (in the computer image
// since the artifacts skill layer: image/skills-layer.sh) and the viewer shows that PDF's pages (pdf.js), labelled as a deck or a
// document, with Download giving the original file. Spreadsheets keep their own in-browser viewer (SheetJS, v3.ts).
//
// The preview is a hidden companion of the Library file, not a Library file: R2 key <file r2key>.preview.pdf (so it is counted in
// the account's Files storage and swept with the file), one row per file in the Resident's file_previews table. It belongs to the
// exact bytes it was made from (src_key = the file's r2key then): a new version of the file (share_file in place) has a new r2key,
// so the next open makes a new preview and deletes the old one. Made:
//   · right after share_file gives the person a deck or document (the computer is awake then), in the background;
//   · otherwise on first open (uploads, files from apps), by a short job on the computer; later opens are served from R2.
// A failed conversion is remembered for 10 minutes so reopening doesn't wake the computer again and again (the viewer's Try again
// skips that wait).
import { extOf, safeName } from "./files.js";
import { stPut, stDelete, keyInfo, room } from "./storage.js";
import { SKILL_SCRIPTS } from "./skills/scripts.js";
// Impress on the computer image (libreoffice-impress-nogui 7.3) aborts on every deck without one UI file the package leaves out;
// the artifacts skill's lo_impress_ui.sh writes it when missing. Inlined into the job, so it never depends on the skills being installed.
const IMPRESS_UI = SKILL_SCRIPTS.find((f) => f.path === "artifacts/scripts/lo_impress_ui.sh")?.text || "";

export const DECK_EXT = new Set(["pptx", "ppt", "pps", "ppsx", "pptm", "odp"]);
export const WORD_EXT = new Set(["docx", "doc", "docm", "odt", "rtf"]);
export const PREVIEW_MAX = 50 * 1024 * 1024;     // a preview PDF bigger than this isn't kept (the file still downloads)
export const PREVIEW_JOB_MS = 120e3;             // LibreOffice's own limit inside the job
export const PREVIEW_RETRY_MS = 10 * 60e3;       // a failed conversion is tried again after this (or at once with retry)
// "deck" | "doc" | null: whether the viewer shows this file through a PDF preview.
export function previewKind(name) { const e = extOf(name); return DECK_EXT.has(e) ? "deck" : WORD_EXT.has(e) ? "doc" : null; }
export const previewKeyOf = (r2key) => `${r2key}.preview.pdf`;
export const previewName = (name) => `${String(name).replace(/\.[a-z0-9]{1,8}$/i, "")}.pdf`;

const TABLE = "CREATE TABLE IF NOT EXISTS file_previews (file_id TEXT PRIMARY KEY, src_key TEXT NOT NULL, key TEXT, bytes INTEGER, pages INTEGER, at INTEGER NOT NULL, error TEXT)";
const hasTable = (sql) => sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_previews'").toArray().length > 0;
// R2 keys of the previews of these files (all files when ids is null), for deleting a chat or a channel (deletion-do.js).
export function previewKeys(sql, ids = null) {
  if (!hasTable(sql)) return [];
  const rows = ids ? ids.flatMap((id) => sql.exec("SELECT key, bytes FROM file_previews WHERE file_id=? AND key IS NOT NULL", String(id)).toArray())
    : sql.exec("SELECT key, bytes FROM file_previews WHERE key IS NOT NULL").toArray();
  return rows.map((r) => ({ key: r.key, size: r.bytes ?? null }));
}
export function dropPreviewRows(sql, ids = null) {
  if (!hasTable(sql)) return;
  if (ids) for (const id of ids) sql.exec("DELETE FROM file_previews WHERE file_id=?", String(id)); else sql.exec("DELETE FROM file_previews");
}

// The job on the computer: the file's bytes (from R2, on stdin) into a private /tmp folder (never /workspace: nothing is saved into
// the channel's layers or counted as computer storage), LibreOffice with its own profile (two runs sharing one block each other),
// and the result judged by the PDF it wrote, not soffice's exit code (it can hang after storing the file).
export function convertScript(dir, ext, limitS = PREVIEW_JOB_MS / 1000) {
  if (!/^\/tmp\/1hc-pv-[0-9a-f-]{36}$/.test(dir) || !/^[a-z0-9]{1,8}$/.test(ext)) throw new Error("bad preview job");
  return `d=${dir}; cd "$d" || exit 3; export HOME="$d"
command -v soffice >/dev/null || { echo "ERR LibreOffice isn't installed on this computer"; rm -rf "$d"; exit 1; }
${DECK_EXT.has(ext) && IMPRESS_UI ? `( ${IMPRESS_UI}
) >/dev/null 2>&1
` : ""}timeout ${Math.round(limitS)} soffice --headless --norestore "-env:UserInstallation=file://$d/prof" --convert-to pdf --outdir "$d/out" "$d/in.${ext}" >"$d/log" 2>&1
if [ ! -s "$d/out/in.pdf" ]; then echo "ERR LibreOffice couldn't read it: $(grep -v -e javaldx -e '^[[:space:]]*$' "$d/log" | head -n 2 | tr '\\n' ' ' | cut -c1-200)"; rm -rf "$d"; exit 1; fi
echo "OK $(stat -c %s "$d/out/in.pdf") $(pdfinfo "$d/out/in.pdf" 2>/dev/null | awk '/^Pages:/{print $2}')"`;
}
export function parseConvert(out) {
  const ok = String(out || "").match(/^OK (\d+)(?: (\d+))?\s*$/m); if (ok) return { ok: true, bytes: Number(ok[1]), pages: ok[2] ? Number(ok[2]) : null };
  const er = String(out || "").match(/^ERR (.*)$/m);
  if (er && /Fatal exception|Signal \d|Unspecified Application Error/.test(er[1])) return { ok: false, error: "LibreOffice stopped while opening it (the file may be damaged, or use something it can't read)" };
  return { ok: false, error: (er ? er[1] : String(out || "no output").slice(-200)).trim().slice(0, 300) || "the conversion failed" };
}

// ---- ChannelComputer: officeToPdf(srcKey, outKey, ext) → { ok, bytes, pages } | { ok: false, error } ----
export const computerPreview = {
  async officeToPdf(srcKey, outKey, ext) {
    if (!/^[a-z0-9]{1,8}$/.test(String(ext))) return { ok: false, error: "bad file type" };
    const src = await this.env.WS.get(srcKey); if (!src) return { ok: false, error: "the file is missing from storage" };
    await this.ensureRunning(); this.put("last_activity", Date.now());
    this.inflight = (this.inflight || 0) + 1;   // never idle-stopped mid-job
    const dir = `/tmp/1hc-pv-${crypto.randomUUID()}`;
    try {
      const w = await this.ctx.container.exec(["bash", "-c", 'mkdir -p "$1/out" && cat > "$1/in.$2"', "_", dir, ext], { stdin: src.body, stderr: "combined" });
      const wo = await w.output(); if (wo.exitCode !== 0) return { ok: false, error: "couldn't copy the file to the computer" };
      const r = parseConvert((await this.sh(convertScript(dir, ext), { timeoutMs: PREVIEW_JOB_MS + 20e3 })).out);
      if (!r.ok) return r;
      if (r.bytes > PREVIEW_MAX) return { ok: false, error: `the preview would be ${Math.round(r.bytes / 1048576)} MB` };
      const info = keyInfo(outKey), rm = info ? await room(this.env, info.tenant, r.bytes) : { ok: true };
      if (!rm.ok) return { ok: false, storage_full: true, error: "storage is full" };
      const p = await this.ctx.container.exec(["cat", "--", `${dir}/out/in.pdf`], { stderr: "ignore" });
      await stPut(this.env, outKey, p.stdout.pipeThrough(new FixedLengthStream(r.bytes)), { httpMetadata: { contentType: "application/pdf" } }, { size: r.bytes, replace: true });
      return r;
    } finally {
      this.inflight--; this.put("last_activity", Date.now());
      try { await (await this.ctx.container.exec(["rm", "-rf", "--", dir])).exitCode; } catch {}
    }
  },
};
export function computerPreviewMix(Cls) { Object.assign(Cls.prototype, computerPreview); }

// ---- Resident: the preview of one Library file ----
export const residentPreview = {
  pvRow(id) { this.sql.exec(TABLE); return this.sql.exec("SELECT * FROM file_previews WHERE file_id=?", String(id)).toArray()[0] || null; },
  // → { key, bytes, pages, kind, name } (ready) | { error, status }. make: false only serves what is already made (view-as,
  // read-only accounts: nothing wakes the computer). One job per file at a time; a second open waits for the first.
  async filePreview(id, { make = true, retry = false } = {}) {
    const f = await this.fileRow(id); if (!f || f.pending) return { error: "No such file.", status: 404 };
    const kind = previewKind(f.name); if (!kind) return { error: "This kind of file has no preview.", status: 415 };
    const p = this.pvRow(f.id), ready = (q) => ({ key: q.key, bytes: q.bytes, pages: q.pages, kind, name: previewName(f.name) });
    if (p && p.src_key === f.r2key && p.key) return ready(p);
    if (p && p.src_key === f.r2key && p.error && !retry && Date.now() - p.at < PREVIEW_RETRY_MS) return { error: p.error, status: 422 };
    if (!make) return { error: "The preview isn't ready yet.", status: 409 };
    const jobs = (this._pvJobs ||= new Map()), k = `${f.id}\n${f.r2key}`;
    if (!jobs.has(k)) jobs.set(k, this.makePreview(f).finally(() => jobs.delete(k)));
    const r = await jobs.get(k);
    return r.error ? { error: r.error, status: r.status || 422 } : ready(r);
  },
  async makePreview(f) {
    const out = previewKeyOf(f.r2key), ext = extOf(f.name);
    let r; try { r = await this.computer().officeToPdf(f.r2key, out, ext); } catch (e) { r = { ok: false, error: `the computer couldn't start (${String(e?.message || e).slice(0, 120)})`, transient: true }; }
    // Another request may have replaced or deleted this Library file while the
    // conversion ran. Its old PDF must not replace a newer row or reach a viewer.
    const current = await this.fileRow(f.id);
    if (!current || current.r2key !== f.r2key) {
      if (r.ok) try { await stDelete(this.env, [{ key: out, size: r.bytes }]); } catch (e) { console.log("stale preview", e.message); }
      return current ? { error: "The file changed while making its preview. Try again.", status: 409 }
        : { error: "No such file.", status: 404 };
    }
    const old = this.pvRow(f.id);
    if (!r.ok) {
      // Storage full or the computer not starting is not the file's fault: not remembered, the next open tries again.
      if (!r.storage_full && !r.transient) this.sql.exec("INSERT INTO file_previews (file_id, src_key, key, bytes, pages, at, error) VALUES (?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET src_key=excluded.src_key, key=excluded.key, bytes=excluded.bytes, pages=excluded.pages, at=excluded.at, error=excluded.error",
        f.id, f.r2key, old?.src_key === f.r2key ? old.key : null, old?.src_key === f.r2key ? old.bytes : null, null, Date.now(), r.error);
      return { error: r.storage_full ? "Your storage is full, so there's no room for a preview." : `Couldn't make a preview: ${r.error}`, status: r.storage_full ? 507 : r.transient ? 503 : 422 };
    }
    this.sql.exec("INSERT INTO file_previews (file_id, src_key, key, bytes, pages, at, error) VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(file_id) DO UPDATE SET src_key=excluded.src_key, key=excluded.key, bytes=excluded.bytes, pages=excluded.pages, at=excluded.at, error=NULL",
      f.id, f.r2key, out, r.bytes, r.pages, Date.now());
    if (old?.key && old.key !== out) { try { await stDelete(this.env, [{ key: old.key, size: old.bytes ?? null }]); } catch (e) { console.log("old preview", e.message); } }
    return { key: out, bytes: r.bytes, pages: r.pages };
  },
  // The file is gone (deleteFile): its preview goes with it.
  async dropPreview(id) {
    if (!hasTable(this.sql)) return;
    const p = this.pvRow(id); if (!p) return;
    if (p.key) await stDelete(this.env, [{ key: p.key, size: p.bytes ?? null }]);
    this.sql.exec("DELETE FROM file_previews WHERE file_id=?", String(id));
  },
  // After share_file: previews for the decks and documents it just gave or updated (rows touched since `since`), made now while the
  // computer is awake, in the background. → the promise (tests await it).
  warmPreviews(since) {
    const rows = this.sql.exec("SELECT id, name FROM files WHERE deleted=0 AND pending=0 AND at>=?", Number(since) || 0).toArray().filter((r) => previewKind(r.name));
    if (!rows.length) return Promise.resolve([]);
    const p = Promise.all(rows.map((r) => this.filePreview(r.id).catch((e) => ({ error: e.message }))));
    this.ctx?.waitUntil?.(p);
    return p;
  },
};
export function previewMix(Cls) { Object.assign(Cls.prototype, residentPreview); }

// The served preview: a PDF, inline, named after the file, same no-script headers as every served file.
export const previewFileName = (name) => safeName(previewName(name));
