// One rule for every path where an agent adds a file to the Library (share_file, browser downloads, files an app action returns):
// if the new file is an edit of a file that is already in the Library, it becomes a new version of that Library file (same id, same
// name, same share links and published pages) and the person never sees a second copy. the design notes
//
// Which Library file is it an edit of? Evidence first, name last. Every Library file is a candidate (uploads too), in this channel only
// (each channel has its own Resident and Library, so a match can never cross channels or accounts).
//  1. "library copy": the path is files/<name>, the Library copy on the computer.
//  2. "same path": a Library file that was saved from this same computer path (the earlier rule about names and tasks still applies).
//  3. "used in this task": the agent read, copied or opened that Library file in this task (file_text, read_file, a command naming
//     files/<name>, the person attached it, or the agent already updated it in this task) and the names are alike ("Kyoto plan v2.pdf",
//     "Kyoto trip plan.pdf" from "Kyoto plan.pdf"; same extension). The uses are in file_uses.
//  4. "same name": the same name ignoring a " (N)" suffix (a file the Library shows as "plan (2).html" counts as plan.html).
// A file the agent used in this task whose new name is nothing like it is NOT matched (it could be a new file made from a template);
// the agent names it with replace: when it is an edit.
// copy: true and an explicit replace: are handled by the caller. The person's uploaded original is never lost (see putVersion).
import { extOf } from "./files.js";
import { stDelete } from "./storage.js";

const unsuffixed = (n) => String(n).replace(/ \(\d+\)(\.[^.]{1,8})?$/, "$1").toLowerCase();
const NOISE = new Set(["v", "final", "edited", "edit", "updated", "update", "new", "copy", "revised", "rev", "draft", "latest", "fixed"]);
// "Kyoto plan v2 (final).pdf" and "kyoto-plan.pdf" both become "kyoto plan".
const stem = (n) => String(n).toLowerCase().replace(/\.[^.]{1,8}$/, "").replace(/ \(\d+\)$/, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !NOISE.has(w) && !/^(v|rev)\d+$/.test(w)).join(" ").trim();
const alike = (a, b) => { const x = stem(a), y = stem(b); if (!x || !y) return false; if (x === y) return true; const [s, l] = x.length <= y.length ? [x, y] : [y, x]; if (s.length >= 3 && l.includes(s)) return true; const ls = new Set(l.split(" ")); return s.split(" ").length >= 2 && s.split(" ").every((w) => ls.has(w)); };   // one name inside the other, or all the words of the shorter one in the longer
const exactStem = (a, b) => stem(a) !== "" && stem(a) === stem(b);

export const fileVersionsMethods = {
  fvInit() {
    // orig_key/orig_bytes: the bytes of a file the person uploaded, kept for good when an agent first replaces it. Additive columns only.
    for (const c of ["orig_key TEXT", "orig_bytes INTEGER"]) { try { this.sql.exec(`ALTER TABLE files ADD COLUMN ${c}`); } catch {} }
    // file_uses: which Library files the agent read, copied, opened or was given in a task. The evidence that a new file is an edit.
    this.sql.exec("CREATE TABLE IF NOT EXISTS file_uses (session TEXT NOT NULL, file_id TEXT NOT NULL, at INTEGER NOT NULL, how TEXT, PRIMARY KEY (session, file_id))");
  },
  noteFileUse(session, ids, how) {
    if (!session) return;
    for (const id of [].concat(ids || [])) { if (id) try { this.sql.exec("INSERT INTO file_uses (session,file_id,at,how) VALUES (?,?,?,?) ON CONFLICT(session,file_id) DO UPDATE SET at=excluded.at", String(session), String(id), Date.now(), how || "used"); } catch {} }
  },
  // A command or path the agent runs: every Library file it names (files/<name> or the bare full name next to "files") was used.
  noteFilesIn(session, text) {
    const t = String(text || ""); if (!session || !t.includes("files")) return;
    const hit = []; for (const f of this.sql.exec("SELECT id,name FROM files WHERE deleted=0 AND pending=0").toArray()) {
      if (f.name.length < 4) continue;
      if (t.includes(f.name) || t.includes(f.name.replace(/ /g, "\\ ")) || t.includes(f.name.replace(/'/g, "'\\''"))) hit.push(f.id);
    }
    if (hit.length) this.noteFileUse(session, hit, "command");
  },
  // → { file, why } | null (a new file). opts: { path, name, named, session }.
  resolveFile({ path = null, name, named = false, session = null }) {
    const rows = this.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 ORDER BY at DESC LIMIT 1000").toArray();
    const lc = name.toLowerCase(), ext = extOf(name), usedAt = new Map();
    if (session) for (const u of this.sql.exec("SELECT file_id, at FROM file_uses WHERE session=?", String(session)).toArray()) usedAt.set(u.file_id, u.at);
    const same = (f) => !!session && f.session === session, exact = (f) => f.name.toLowerCase() === lc, asked = (f) => exact(f) || unsuffixed(f.name) === lc;
    let f;
    if (path && (f = rows.find((r) => path === `files/${r.name}`))) return { file: f, why: "it is the Library copy on your computer" };
    if (path && (f = rows.find((r) => r.src_path === path && (!named || asked(r) || same(r))))) return { file: f, why: "it was saved from the same path" };
    const used = rows.filter((r) => usedAt.has(r.id) && extOf(r.name) === ext).sort((a, b) => usedAt.get(b.id) - usedAt.get(a.id));
    const likely = used.filter((r) => alike(r.name, name));
    if (likely.length) return { file: likely.find((r) => exactStem(r.name, name)) || likely[0], why: "you used it in this task and the new file has a similar name" };
    const byName = rows.filter((r) => unsuffixed(r.name) === unsuffixed(name));
    if (byName.length) return { file: byName.find(exact) || byName.find(same) || byName[0], why: "it has the same name" };
    return null;
  },
  // The words every tool result ends with: which file, which versions are kept.
  keptLine(fileId) {
    const r = this.sql.exec("SELECT * FROM files WHERE id=?", String(fileId)).toArray()[0]; if (!r) return "";
    const v = Number(r.version || 1), kept = [`version ${v} (current)`];
    if (r.prev_key) kept.push(r.prev_key === r.orig_key ? "the version before it (which is also the person's original)" : `the version before it`);
    if (r.orig_key && r.orig_key !== r.r2key && r.orig_key !== r.prev_key) kept.push(`the person's original upload, always kept`);
    return ` Library file "${r.name}" (id ${r.id}). Versions kept: ${kept.join(", ")}.${r.prev_key ? ` share_file {"restore": "${r.name}"} puts back the version before it.` : ""}${r.orig_key && r.orig_key !== r.r2key ? ` share_file {"restore": "${r.name}", "original": true} puts back the person's original.` : ""}`;
  },
  // Make the bytes already stored at newKey the current version of `target` (same id, name, links and pages). The version before is kept,
  // the one before that is deleted, except the person's original: the first time an agent replaces a file the person uploaded, its
  // bytes are kept under orig_key for good, so no number of edits can push it out.
  async putVersion(target, { key, bytes, src_path, synced = 0, session = null, turn = null }) {
    const v = Number(target.version || 1) + 1;
    const orig = target.orig_key || (target.source === "upload" ? target.r2key : null), origBytes = target.orig_key ? target.orig_bytes : (target.source === "upload" ? target.bytes : null);
    this.sql.exec("UPDATE files SET r2key=?, bytes=?, prev_key=?, prev_bytes=?, version=?, view_key=NULL, at=?, session=COALESCE(?,session), turn=COALESCE(?,turn), synced=?, src_path=COALESCE(?,src_path), orig_key=?, orig_bytes=? WHERE id=?",
      key, bytes, target.r2key, target.bytes, v, Date.now(), session, turn, synced, src_path ?? null, orig, origBytes ?? null, target.id);
    const gone = [];
    if (target.prev_key && target.prev_key !== orig) gone.push({ key: target.prev_key, size: target.prev_bytes ?? null });
    if (target.view_key) gone.push(target.view_key);
    try { await stDelete(this.env, gone); } catch (e) { console.log("file old version", e.message); }
    this.noteFileUse(session, target.id, "updated");   // a file this task already updated is evidence for its next edit
    this.sidecarKick?.(this.sql.exec("SELECT * FROM files WHERE id=?", target.id).one());
    return v;
  },
};
export function fileVersionsMix(Cls) { Object.assign(Cls.prototype, fileVersionsMethods); }
