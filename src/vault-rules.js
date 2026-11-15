// The rules for a saved key's name, sites and size. One place, used by vault.js (Settings → Passwords & keys) and secret-card.js (the helper's secret card).
export const KEY_SITES_MAX = 20, KEY_VALUE_MAX = 8000;
export const NAME_RE = /^[A-Z][A-Z0-9_]{1,40}$/, SITE_RE = /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/;
export const LABEL_MAX = 60, NOTE_MAX = 300;
// A plain label ("App Store Connect") → a variable name (APP_STORE_CONNECT). `taken` is the set of names already saved: a clash gets _2, _3, ...
export function nameFromLabel(label, taken = new Set()) {
  let base = String(label || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) base = "KEY";
  if (!/^[A-Z]/.test(base)) base = "KEY_" + base;
  base = base.slice(0, 36).replace(/_+$/, "");
  if (base.length < 2) base = "KEY_" + base;
  let n = base, i = 2; while (taken.has(n)) n = `${base}_${i++}`;
  return n;
}
export const cleanLine = (s, max) => { const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max).trimEnd() : t; };
// Where file secrets live on the channel computer, one real file per saved file key (mode 600). Not under /workspace, so it is never saved into a layer.
export const KEY_FILES_DIR = "/var/1hc/keys";
export const keyFilePath = (name) => `${KEY_FILES_DIR}/${name}`;
// Names that would break every command if they held a key's value (the shell and the computer's own settings). Such a key is still saved and hidden, but not set as a variable.
export const RESERVED_ENV = new Set(["HOME", "PATH", "SHELL", "USER", "PWD", "LANG", "TERM", "TMPDIR", "IFS", "PS1", "SHLVL", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS",
  "PYTHONUSERBASE", "PYTHONPATH", "PIP_NO_CACHE_DIR", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]);
// Reads the account's saved key rows. label, note and kind are newer columns (migrations_102): when they are not there yet the read falls back to the older columns,
// so a Worker deployed a moment before the migration still has its keys.
export async function vaultRows(env, tid, cols) {
  const newer = new Set(["label", "note", "kind"]), run = async (c) => (await env.DB.prepare(`SELECT ${c.join(", ")} FROM vault WHERE tenant_id=? ORDER BY name`).bind(tid).all()).results || [];
  try { return await run(cols); } catch (e) { const base = cols.filter((c) => !newer.has(c)); if (base.length === cols.length) throw e; return run(base); }
}
// Settings → Passwords & keys → "Check every site" (tenant_flags, v='all'): Sentinel then sees all of the computer's HTTPS, so a saved key sent to any site that is not on its list is held.
// Off by default: sites such as Google and Canva refuse requests that arrive through Sentinel, which breaks the computer's browser.
export const KEY_LOCK_FLAG = "key_lock_all";
export async function keyLockAll(env, tid) { try { return (await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tid), KEY_LOCK_FLAG).first())?.v === "on"; } catch { return false; } }
export async function setKeyLockAll(env, tid, on, at = Date.now()) {
  if (!on) await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tid), KEY_LOCK_FLAG).run();
  else await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,'on',?) ON CONFLICT(tenant_id,k) DO UPDATE SET v='on', updated_at=excluded.updated_at").bind(String(tid), KEY_LOCK_FLAG, at).run();
  return !!on;
}
