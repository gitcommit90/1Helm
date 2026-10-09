// File sidecar SQL helpers, kept independent of the Worker and Resident imports.
export const hasSidecarTable = (sql) => sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_sidecars'").toArray().length > 0;
export const sidecarOn = (env) => String(env?.SIDECAR || "on").toLowerCase() !== "off";
// R2 keys of these files' sidecars (all when ids is null), for deleting a chat or a channel (deletion-do.js).
export function sidecarKeys(sql, ids = null) {
  if (!hasSidecarTable(sql)) return [];
  const rows = ids ? ids.flatMap((id) => sql.exec("SELECT key, vec_key, bytes FROM file_sidecars WHERE file_id=?", String(id)).toArray()) : sql.exec("SELECT key, vec_key, bytes FROM file_sidecars").toArray();
  return rows.flatMap((r) => [r.key && { key: r.key, size: null }, r.vec_key && { key: r.vec_key, size: null }]).filter(Boolean);
}
export function dropSidecarRows(sql, ids = null) {
  if (!hasSidecarTable(sql)) return;
  if (ids) for (const id of ids) sql.exec("DELETE FROM file_sidecars WHERE file_id=?", String(id)); else sql.exec("DELETE FROM file_sidecars");
}
