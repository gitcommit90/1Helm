// Saving changes made on the channel computer under /workspace/files back to the stored Library file the app shows.
// Before and after every edit_file, write_file and run_command, the computer lists its top-level files (size and modified time). Each file
// that is new or changed is saved: a Library file of that name gets a new version (same id, share links and pages follow), and a file with no
// Library row is added as a new Library file. A save that can't be done makes the tool result an error, so the helper's claim follows the
// app's facts. See docs/files-and-library.md.
import { MAX_UPLOAD, mimeOf, humanBytes } from "./files.js";
import { stDelete } from "./storage.js";

// One line per file: size, modified time (seconds with fractions), name.
export const SNAP_CMD = `cd /workspace && find files -maxdepth 1 -type f -printf '%s %T@ %f\\n' 2>/dev/null; true`;

export function parseSnap(out) {
  const m = new Map();
  for (const line of String(out || "").split("\n")) { const x = line.match(/^(\d+) (\d+(?:\.\d+)?) (.+)$/); if (x) m.set(x[3], `${x[1]} ${x[2]}`); }
  return m;
}
const skip = (n) => n.startsWith(".") || /\.crdownload$/i.test(n) || n.length > 250;
export function changedNames(before, after) {
  const out = []; for (const [n, sig] of after) if (!skip(n) && before.get(n) !== sig) out.push(n);
  return out;
}
const sameLibraryName = "SELECT * FROM files WHERE deleted=0 AND pending=0 AND name=? ORDER BY hidden ASC, at DESC LIMIT 1";

// → { saved: [{ name, version, bytes, created }], failed: [{ name, error }] }
export async function saveBack(R, names, after, tc) {
  const saved = [], failed = [], C = R.computer(), tenant = R.get("tenant"), channel = R.get("channel");
  const done = (R._sbDone ||= new Map());
  for (const name of names) {
    const sig = after.get(name); if (done.get(name) === sig) continue;   // an overlapping tool call already saved exactly these bytes
    try {
      const row = R.sql.exec(sameLibraryName, name).toArray()[0], path = `files/${name}`;
      if (row) {
        if (Number(row.synced) === 0) { failed.push({ name, error: `the stored "${name}" was changed by something else (for example Live notes writing the meeting notes) after this computer's copy was made, so the computer's copy was out of date and your change was not saved. The newer stored file is put on the computer again; read it and make the change again.` }); continue; }
        const v = Number(row.version || 1) + 1, key = `t/${tenant}/files/${channel}/${row.id}.v${v}`;
        const r = await C.fileToR2(path, key, MAX_UPLOAD);
        if (!r.ok) { failed.push({ name, error: r.error || "the copy to storage failed" }); continue; }
        const cur = R.sql.exec("SELECT version FROM files WHERE id=? AND deleted=0", row.id).toArray()[0];
        if (!cur || Number(cur.version || 1) !== Number(row.version || 1)) { await stDelete(R.env, [{ key, size: r.bytes }]).catch(() => {}); failed.push({ name, error: `the stored "${name}" changed while your command ran, so your change was not saved. Read the file again and make the change again.` }); continue; }
        try {   // a rewrite with the same bytes (the file sync touching the file while a command ran) is not a change
          const [x, y] = await Promise.all([R.env.WS.head?.(row.r2key), R.env.WS.head?.(key)]);
          if (x && y && x.etag && x.etag === y.etag && x.size === y.size) { await stDelete(R.env, [{ key, size: r.bytes }]).catch(() => {}); done.set(name, sig); continue; }
        } catch {}
        await R.putVersion(row, { key, bytes: r.bytes, src_path: row.src_path, synced: 1, session: tc?.session || null, turn: tc?.turn || null });
        if (!row.hidden) { try { await R.fileUpdated(row, { r2key: key, bytes: r.bytes, path }, tc || {}, ""); } catch (e) { console.log("file save-back follow", String(e?.message || e).slice(0, 120)); } }
        saved.push({ name, version: v, bytes: r.bytes });
      } else {
        const id = crypto.randomUUID(), key = `t/${tenant}/files/${channel}/${id}`;
        const r = await C.fileToR2(path, key, MAX_UPLOAD);
        if (!r.ok) { failed.push({ name, error: r.error || "the copy to storage failed" }); continue; }
        const f = R.addFileRow({ id, name, mime: mimeOf(name), bytes: r.bytes, r2key: key, source: "helper", session: tc?.session || null, turn: tc?.turn || null, synced: 1, src_path: path });
        try { tc?.emit?.({ t: "file", file: f }); } catch {}
        saved.push({ name: f.name, version: 1, bytes: r.bytes, created: true });
      }
      done.set(name, sig);
    } catch (e) { failed.push({ name, error: String(e?.message || e).slice(0, 200) }); }
  }
  return { saved, failed };
}

// The text added to the tool result, and whether the result is now a failure.
export function saveBackNote({ saved = [], failed = [], unchecked = false }) {
  const lines = [];
  for (const s of saved) lines.push(`Saved to the Library: "${s.name}" is ${s.created ? "added as a new file" : `now version ${s.version}`} (${humanBytes(s.bytes)}). The person sees this change.`);
  for (const f of failed) lines.push(`error: the change to "${f.name}" is on your computer but was NOT saved to the stored Library file the person sees: ${f.error} Don't tell the person it was updated.`);
  if (unchecked) lines.push("error: 1Helm could not check whether this changed a file in /workspace/files, so it may not have been saved to the Library the person sees. Don't tell the person it was updated; share it with share_file or try again.");
  return { text: lines.join("\n"), failed: failed.length > 0 || unchecked };
}
