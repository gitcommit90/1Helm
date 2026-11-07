// Whole-file SFTP through the managed SSH session: send a Library file or a computer file to the server, or save a server file to the
// Library. The Worker reads or writes the bytes and walks the broker's existing chunked sftp write/read (offset, at most 1 MiB per call), so the
// broker, its session checks and the "broker only" network rule are unchanged. Every chunk goes through broker.sftpSsh with the session's own auth.
import { safeName, mimeOf, humanBytes } from './files.js';

export const SSH_FILE_MAX = 25 * 1024 * 1024;       // 25 MiB per transfer, both ways (the same limit as files for app actions)
export const SSH_CHUNK = 512 * 1024;            // bytes per broker call (the broker accepts up to 1 MiB)
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s || ''), (c) => c.charCodeAt(0));
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

// A lone computer path given as `data` is the helper's mistake: the broker would write those characters, not the file.
export const pathAsData = (data) => typeof data === 'string' && data.length < 300 && /^\/workspace\/\S+$/.test(data.trim());
export const PATH_AS_DATA = (p) => `"data" is the content to write, so "${p.trim().slice(0, 200)}" would be written as that text, not as the file. To send the file itself, pass file: "${p.trim().slice(0, 200)}" (a Library file name or a /workspace path) with a destination path on the server in "path". Nothing was written.`;

// d: { broker, auth, session, read(ref) -> { name, bytes } | { error }, aborted() }
export async function sendFile(d, a) {
  const ref = String(a.file || '').trim(), remote = String(a.path || '').trim();
  if (!remote) return fail('Give the destination path on the server in "path". Nothing was written.');
  let f; try { f = await d.read(ref); } catch (e) { return fail(`couldn't read "${ref}": ${String(e.message || e).slice(0, 200)}. Nothing was written.`); }
  if (!f || f.error) return fail(`${f?.error || `couldn't read "${ref}".`} Nothing was written.`);
  const bytes = f.bytes, name = safeName(f.name || ref.split('/').pop()), total = Number(bytes?.byteLength || 0);
  if (total > SSH_FILE_MAX) return fail(`"${name}" is ${humanBytes(total)}; a file sent over SSH can be at most ${humanBytes(SSH_FILE_MAX)}. Nothing was written.`);
  let at = a.offset == null ? 0 : Number(a.offset);
  if (!Number.isInteger(at) || at < 0 || at > total) return fail(`offset must be a whole number from 0 to ${total} (the file's size). Nothing was written.`);
  const start = at;
  do {
    if (d.aborted?.()) return fail(`Stopped after ${at} of ${total} bytes.`, { bytes_sent: at, next_offset: at });
    const part = bytes.subarray(at, Math.min(total, at + SSH_CHUNK));
    // The first chunk of a send from 0 truncates the destination; later chunks write at their offset and keep the other bytes.
    const r = await d.broker.sftpSsh(d.auth, { session: d.session, op: 'write', path: remote, data: b64(part), encoding: 'base64', offset: at, truncate: at === 0 });
    if (!r?.ok) return fail(`${r?.error || 'SFTP write failed'} after ${at} of ${total} bytes. To resume, call again with offset ${at}.`, { bytes_sent: at, next_offset: at });
    at += Number(r.bytes ?? part.byteLength);
    if (Number(r.bytes ?? part.byteLength) !== part.byteLength) return fail(`The server accepted ${r.bytes} of ${part.byteLength} bytes in one chunk, after ${at - Number(r.bytes)} of ${total} bytes. To resume, call again with offset ${at - Number(r.bytes)}.`, { bytes_sent: at - Number(r.bytes) });
  } while (at < total);
  const st = await d.broker.sftpSsh(d.auth, { session: d.session, op: 'stat', path: remote });
  if (st?.ok && Number.isFinite(Number(st.size)) && Number(st.size) !== total) return fail(`Sent ${total} bytes but the server file is ${st.size} bytes. Check ${remote}.`, { bytes_sent: total, remote_size: st.size });
  return { ok: true, sent: name, bytes: total, bytes_this_call: total - start, destination: remote, verified_size: st?.ok ? Number(st.size) : null, message: `sent ${name} (${humanBytes(total)}) to ${remote}` };
}

// d adds: save({ name, mime, bytes }) -> { file } | { error }. a.path: the server file; a.save_as: the Library name (default the file's own name).
export async function fetchFile(d, a) {
  const remote = String(a.path || '').trim();
  if (!remote) return fail('Give the server file in "path".');
  const st = await d.broker.sftpSsh(d.auth, { session: d.session, op: 'stat', path: remote });
  if (!st?.ok) return fail(st?.error || 'SFTP stat failed.');
  if (st.directory) return fail(`${remote} is a directory.`);
  if (Number(st.size) > SSH_FILE_MAX) return fail(`${remote} is ${humanBytes(Number(st.size))}; a file fetched over SSH can be at most ${humanBytes(SSH_FILE_MAX)}. Read part of it with offset and length instead.`);
  const parts = []; let at = 0;
  for (;;) {
    if (d.aborted?.()) return fail(`Stopped after ${at} bytes. Nothing was saved.`);
    const r = await d.broker.sftpSsh(d.auth, { session: d.session, op: 'read', path: remote, encoding: 'base64', offset: at, length: SSH_CHUNK });
    if (!r?.ok) return fail(`${r?.error || 'SFTP read failed'} after ${at} bytes. Nothing was saved.`);
    const u = unb64(r.data); parts.push(u); at += u.byteLength;
    if (at > SSH_FILE_MAX) return fail(`${remote} is larger than ${humanBytes(SSH_FILE_MAX)}. Nothing was saved.`);
    if (r.eof || !u.byteLength) break;
  }
  const bytes = new Uint8Array(at); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
  const name = safeName(String(a.save_as || '').trim() || remote.split('/').pop() || 'file');
  const sv = await d.save({ name, mime: mimeOf(name), bytes });
  if (sv?.error || !sv?.file) return fail(sv?.error || "couldn't save the file to the Library.");
  return { ok: true, saved: sv.file.name || name, bytes: at, source: remote, file: sv.file, message: `saved ${sv.file.name || name} (${humanBytes(at)}) from ${remote} to the Library` };
}
