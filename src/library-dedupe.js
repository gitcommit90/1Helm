// A deck, a PowerPoint or a PDF the agent made reaches the person once. The same bytes can arrive by more than one road: the deck build writes
// "northwind-ai-impact-2026.html" in its folder, the agent copies it to /workspace/files as "2026 AI Impact Report.html", approval of a worker's
// round attaches the folder file, and share_file or the Library save-back adds the copy. Every road that is about to add a new Library file calls
// identicalLibraryFile first: when a file the agent made earlier holds exactly these bytes, no second file is added, and the existing one takes the
// readable name if the new one has it ("2026 AI Impact Report.html" instead of "northwind-ai-impact-2026.html").
import { stDelete } from "./storage.js";

const DECK_FORMAT = /\.(html?|pptx|pdf)$/i;
export const isDeckFormat = (name) => DECK_FORMAT.test(String(name || ""));
// A file name a build wrote ("northwind-ai-impact-2026.html"): lowercase words joined by hyphens or underscores, no spaces.
export const machineName = (name) => /^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.[a-z0-9]{1,5}$/.test(String(name || ""));
const SAME_BYTES_MAX = 50 * 1024 * 1024;

async function sameBytes(env, a, b) {
  const [x, y] = await Promise.all([env.WS.head?.(a.key), env.WS.head?.(b.key)]);
  if (x && y && x.etag && x.etag === y.etag && Number(x.size) === Number(y.size)) return true;
  if (a.bytes > SAME_BYTES_MAX) return false;
  const [p, q] = await Promise.all([env.WS.get(a.key), env.WS.get(b.key)]);
  if (!p || !q) return false;
  const u = new Uint8Array(await p.arrayBuffer()), v = new Uint8Array(await q.arrayBuffer());
  if (u.length !== v.length) return false;
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

// → the visible Library row an agent made earlier with exactly these bytes, or null. key: where the new bytes are already stored.
export async function identicalLibraryFile(R, { key, bytes, name, exceptId = null }) {
  if (!isDeckFormat(name) || !key || !(bytes > 0)) return null;
  const rows = R.sql.exec("SELECT * FROM files WHERE deleted=0 AND pending=0 AND source='helper' AND bytes=? AND r2key<>?", Number(bytes), key).toArray();
  for (const row of rows) { if (row.id === exceptId || row.hidden || !isDeckFormat(row.name)) continue; try { if (await sameBytes(R.env, { key, bytes }, { key: row.r2key })) return row; } catch {} }
  return null;
}

// The existing file takes the readable name when it has a build's name and the new copy has a readable one. Same id, so links, versions and pages stay.
export function readableName(existingName, newName) { return machineName(existingName) && !machineName(newName) && newName !== existingName ? newName : null; }
export function adoptName(R, row, newName, emit) {
  const to0 = readableName(row.name, newName); if (!to0) return row;
  const taken = new Set(R.sql.exec("SELECT name FROM files WHERE deleted=0 AND id<>?", row.id).toArray().map((x) => x.name.toLowerCase()));
  let to = to0;
  if (taken.has(to.toLowerCase())) { const m = to.match(/^(.*?)(\.[^.]{1,8})?$/); for (let i = 2; i < 1000; i++) { const c = `${m[1]} (${i})${m[2] || ""}`; if (!taken.has(c.toLowerCase())) { to = c; break; } } }
  if (Number(row.synced) === 1) { let l = []; try { l = JSON.parse(R.getRaw("rm_paths") || "[]"); } catch {} R.put("rm_paths", JSON.stringify([...new Set([...l, `files/${row.name}`])])); }   // the old name on the computer goes on the next sync
  R.sql.exec("UPDATE files SET name=?, synced=0 WHERE id=?", to, row.id);
  const next = R.sql.exec("SELECT * FROM files WHERE id=?", row.id).one();
  try { emit?.({ t: "file", file: R.fileView(next) }); } catch {}
  return next;
}
export async function dropNewBytes(R, key, bytes) { try { await stDelete(R.env, [{ key, size: bytes }]); } catch {} }
