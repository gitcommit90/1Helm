// Saved logins (Settings → Passwords & keys): website + username + password (several accounts per site allowed). The password is sealed with VAULT_KEY like a
// saved key, is never returned to the browser after saving, and is never shown to the model. Helpers use a login only through
// the browser_fill_login tool, which types it into the page itself and only when the open page belongs to the login's site.
import { sealSecret, openSecret } from "./sentinel.js";

// A few multi-label public suffixes people might type by mistake; a login for one of these would match every site under it.
const PUBLIC = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "com.mx", "co.in", "github.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "blogspot.com", "appspot.com", "web.app", "firebaseapp.com"]);

// "https://www.Costco.com/login?x=1" → "costco.com". Returns "" when it isn't a usable site name.
export function normSite(input) {
  let s = String(input || "").trim().toLowerCase(); if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = "https://" + s;
  let h; try { h = new URL(s).hostname; } catch { return ""; }
  h = h.replace(/\.$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]{1,62}$/.test(h) || h.length > 253 || PUBLIC.has(h)) return "";
  return h;
}
// The page host belongs to the login's site: the site itself or any subdomain of it (www.costco.com, secure.costco.com).
export function hostMatchesSite(host, site) {
  host = String(host || "").toLowerCase().replace(/\.$/, ""); site = String(site || "").toLowerCase();
  return !!host && !!site && (host === site || host.endsWith("." + site));
}

export async function listLogins(env, tenantId) {
  return ((await env.DB.prepare("SELECT site, username, created_at, note<>'' AS has_note FROM logins WHERE tenant_id=? ORDER BY site, username").bind(tenantId).all()).results || [])
    .map((r) => ({ site: r.site, username: r.username, created_at: r.created_at, ...(Number(r.has_note) ? { has_note: true } : {}) }));
}
export const NOTE_MAX = 2000;
// One login per site + username (the same rule Import from Chrome uses): saving the same pair again replaces its password
// (the duplicate is merged, never a second row); a new username adds another account.
// Add a login: { site, username, password, note? }. A note is sealed like the password; saving without one keeps the old note.
// Edit a login: also { was: { site, username } }. The password may be left blank (keeps the saved one); note is set as given
// ('' clears it). Changing the site or username onto another saved login merges the two: that one is replaced, this one moves.
export async function saveLogin(env, tenantId, b) {
  const site = normSite(b.site), username = String(b.username ?? "").trim(), password = String(b.password ?? "");
  const hasNote = b.note != null, note = String(b.note ?? "").replace(/\r\n?/g, "\n").trim();
  const was = b.was && typeof b.was === "object" ? { site: normSite(b.was.site) || String(b.was.site || "").trim().toLowerCase(), username: String(b.was.username ?? "").trim() } : null;
  if (!site) return { error: "website: the site's address, e.g. costco.com" };
  if (username.length > 300) return { error: "username is too long" };
  if ((!was && !password) || password.length > 1000) return { error: "password required" };
  if (note.length > NOTE_MAX) return { error: `note is too long (up to ${NOTE_MAX.toLocaleString("en-US")} characters)` };
  const sealedNote = note ? await sealSecret(env, note) : "", at = Date.now();
  const row = (s, u) => env.DB.prepare("SELECT sealed, note FROM logins WHERE tenant_id=? AND site=? AND username=?").bind(tenantId, s, u).first();
  if (!was) {
    const existed = !!(await row(site, username));
    await env.DB.prepare(`INSERT INTO logins (tenant_id,site,username,sealed,created_at,note) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,site,username) DO UPDATE SET sealed=excluded.sealed, created_at=excluded.created_at${hasNote && note ? ", note=excluded.note" : ""}`)
      .bind(tenantId, site, username, await sealSecret(env, password), at, sealedNote).run();
    return { ok: true, site, username, updated: existed, ...(note ? { has_note: true } : {}) };
  }
  const old = await row(was.site, was.username);
  if (!old) return { error: "That login isn't saved anymore. Add it again." };
  const sealed = password ? await sealSecret(env, password) : old.sealed, keepNote = hasNote ? sealedNote : old.note || "";
  const same = site === was.site && username === was.username, target = same ? null : await row(site, username);
  if (same) await env.DB.prepare("UPDATE logins SET sealed=?, note=?, created_at=? WHERE tenant_id=? AND site=? AND username=?").bind(sealed, keepNote, at, tenantId, site, username).run();
  else await env.DB.batch([
    env.DB.prepare("DELETE FROM logins WHERE tenant_id=? AND site=? AND username=?").bind(tenantId, was.site, was.username),
    env.DB.prepare("INSERT INTO logins (tenant_id,site,username,sealed,created_at,note) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,site,username) DO UPDATE SET sealed=excluded.sealed, created_at=excluded.created_at, note=excluded.note")
      .bind(tenantId, site, username, sealed, at, keepNote)]);
  return { ok: true, site, username, edited: true, ...(target ? { merged: true } : {}), ...(keepNote ? { has_note: true } : {}) };
}
// The note on one login, for its owner's Edit form (the password is never returned).
export async function loginNote(env, tenantId, site, username) {
  const r = await env.DB.prepare("SELECT note FROM logins WHERE tenant_id=? AND site=? AND username=?").bind(tenantId, normSite(site) || String(site || "").trim().toLowerCase(), String(username ?? "").trim()).first();
  if (!r) return { error: "That login isn't saved anymore." };
  return { note: r.note ? await openSecret(env, r.note) : "" };
}
// Removes one account (site + username). Without a username (an older app), every account for the site.
export async function deleteLogin(env, tenantId, site, username) {
  const s = normSite(site) || String(site || "").trim().toLowerCase();
  if (username == null) await env.DB.prepare("DELETE FROM logins WHERE tenant_id=? AND site=?").bind(tenantId, s).run();
  else await env.DB.prepare("DELETE FROM logins WHERE tenant_id=? AND site=? AND username=?").bind(tenantId, s, String(username).trim()).run();
  return { ok: true, site: s, username: username == null ? null : String(username).trim() };
}

// Bulk import (Settings → Passwords & keys → Import from Chrome). The browser parses the CSV and sends only
// {site, username, password} rows; each is re-validated and sealed here. Passwords are never echoed or logged.
export const IMPORT_MAX = 5000;
const ROWS_PER_INSERT = 25;      // 4 bound values per row → 100, D1's per-statement limit
const STMTS_PER_BATCH = 50;
export async function importLogins(env, tenantId, rows) {
  if (!Array.isArray(rows)) return { error: "logins: a list of {site, username, password}" };
  if (rows.length > IMPORT_MAX) return { error: `That's more than ${IMPORT_MAX.toLocaleString("en-US")} logins. Split the file and import it in parts.` };
  const skipped = [], keep = new Map();
  for (const r of rows) {
    const raw = String(r?.site ?? "").trim(), username = String(r?.username ?? "").trim(), password = String(r?.password ?? "");
    const scheme = raw.toLowerCase().match(/^([a-z][a-z0-9+.-]*):\/\//)?.[1];
    const site = scheme && scheme !== "https" && scheme !== "http" ? "" : normSite(raw);
    const why = !raw ? "no website" : scheme && scheme !== "https" && scheme !== "http" ? "not a website" : !site ? "not a website 1Helm can use" : !password ? "no password" : password.length > 1000 ? "password is too long" : username.length > 300 ? "username is too long" : "";
    if (why) { skipped.push({ site: (site || raw).slice(0, 200), reason: why }); continue; }
    const k = site + "\n" + username;
    if (keep.has(k)) { keep.delete(k); skipped.push({ site, reason: "listed twice; kept the last one" }); }
    keep.set(k, { site, username, password });
  }
  const have = new Set(((await env.DB.prepare("SELECT site, username FROM logins WHERE tenant_id=?").bind(tenantId).all()).results || []).map((x) => x.site + "\n" + x.username));
  const list = [...keep.values()], now = Date.now();
  let added = 0, updated = 0;
  for (const x of list) have.has(x.site + "\n" + x.username) ? updated++ : added++;
  const stmts = [];
  for (let i = 0; i < list.length; i += ROWS_PER_INSERT) {
    const part = list.slice(i, i + ROWS_PER_INSERT), vals = [];
    for (const x of part) vals.push(tenantId, x.site, x.username, await sealSecret(env, x.password));
    stmts.push(env.DB.prepare(`INSERT INTO logins (tenant_id,site,username,sealed,created_at) VALUES ${part.map(() => `(?,?,?,?,${now})`).join(",")} ON CONFLICT(tenant_id,site,username) DO UPDATE SET sealed=excluded.sealed, created_at=excluded.created_at`).bind(...vals));
  }
  for (let i = 0; i < stmts.length; i += STMTS_PER_BATCH) await env.DB.batch(stmts.slice(i, i + STMTS_PER_BATCH));
  return { added, updated, skipped };
}
// Sites only (no usernames) for the resident's system prompt; a site with several accounts says how many.
export async function loginSites(env, tenantId) {
  try { return ((await env.DB.prepare("SELECT site, COUNT(*) AS n FROM logins WHERE tenant_id=? GROUP BY site ORDER BY site").bind(tenantId).all()).results || []).map((r) => r.n > 1 ? `${r.site} (${r.n} accounts)` : r.site); } catch { return []; }
}
// The saved login for this host: the most specific site that covers it (accounts.google.com beats google.com). With a
// username, that account on any covering site. Several accounts and no username: { site, choices } (usernames only,
// no password opened). Opened only here, for browser_fill_login. Never logged.
export async function loginForHost(env, tenantId, host, username) {
  const rows = ((await env.DB.prepare("SELECT site, username, sealed FROM logins WHERE tenant_id=?").bind(tenantId).all()).results || [])
    .filter((x) => hostMatchesSite(host, x.site)).sort((a, b) => b.site.length - a.site.length || a.username.localeCompare(b.username));
  if (!rows.length) return null;
  let r;
  const want = username == null ? "" : String(username).trim(), blank = want === "(no username)";
  if (want) {
    r = blank ? rows.find((x) => !x.username) : rows.find((x) => x.username === want) || rows.find((x) => x.username.toLowerCase() === want.toLowerCase());
    if (!r) return { site: rows[0].site, choices: rows.map((x) => x.username), missing: want };
  } else {
    const top = rows.filter((x) => x.site === rows[0].site);
    if (top.length > 1) return { site: rows[0].site, choices: top.map((x) => x.username) };
    r = top[0];
  }
  return { site: r.site, username: r.username, password: await openSecret(env, r.sealed) };
}
