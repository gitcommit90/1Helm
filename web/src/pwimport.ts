// Import from Chrome (Settings → Passwords & keys): parse "Chrome Passwords.csv" in the browser and turn it into
// {site, username, password} rows. The file never leaves the browser as a file; only these rows go to /api/logins/import,
// where the server checks every row again. Nothing here logs rows or keeps them after the caller drops the plan.

// RFC 4180: quoted fields, "" inside quotes, commas and line breaks inside quotes; CRLF or LF; a leading BOM is dropped.
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, rows: string[][] = [];
  let row: string[] = [], f = "", q = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === "") { q = true; i++; continue; }
    if (c === ",") { row.push(f); f = ""; i++; continue; }
    if (c === "\r" || c === "\n") { row.push(f); rows.push(row); row = []; f = ""; i += c === "\r" && s[i + 1] === "\n" ? 2 : 1; continue; }
    f += c; i++;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}

// Same rules as the server's normSite (src/logins.js in 1helm-cloud): "https://www.Costco.com/login" → "costco.com".
const PUBLIC = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "com.mx", "co.in", "github.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "blogspot.com", "appspot.com", "web.app", "firebaseapp.com"]);
export function siteOf(input: string): string {
  let s = String(input || "").trim().toLowerCase(); if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = "https://" + s;
  let h: string; try { h = new URL(s).hostname; } catch { return ""; }
  h = h.replace(/\.$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]{1,62}$/.test(h) || h.length > 253 || PUBLIC.has(h)) return "";
  return h;
}

export type PwRow = { site: string; username: string; password: string };
export type PwPlan = { rows: PwRow[]; skipped: { site: string; reason: string }[]; merged: number; total: number };
export const PW_MAX = 5000;
// Header names Chrome uses first; the others make most password managers' exports work too.
const COLS: Record<string, string[]> = {
  url: ["url", "website", "web site", "login_uri", "login uri", "origin", "origin_url", "address"],
  username: ["username", "user name", "login_username", "login name", "login", "email", "user"],
  password: ["password", "login_password"],
};

// The rows to import (the last one wins when a site + username shows up twice) and the ones skipped, with why.
// Chrome saves a login once per page address (auth.hulu.com/ and auth.hulu.com/login), so exact copies are common: they're
// merged and counted, not skipped. Copies with different passwords still show as skipped ("kept the last one").
export function planImport(text: string): PwPlan | { error: string } {
  const all = parseCsv(text);
  if (!all.length) return { error: "That file is empty. In Chrome, open Password Manager → Settings → Export passwords, then pick the “Chrome Passwords.csv” it saves." };
  const head = all[0].map(h => h.trim().toLowerCase());
  const col = (k: string) => { for (const n of COLS[k]) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const cu = col("url"), cn = col("username"), cp = col("password");
  if (cu < 0 || cn < 0 || cp < 0) return { error: "That doesn't look like a Chrome passwords export. Use the “Chrome Passwords.csv” from Chrome's Password Manager → Settings → Export passwords (its columns are name, url, username, password)." };
  const skipped: PwPlan["skipped"] = [], keep = new Map<string, PwRow>(), body = all.slice(1); let merged = 0;
  for (const r of body) {
    const url = (r[cu] || "").trim(), username = (r[cn] || "").trim(), password = r[cp] || "";
    const scheme = url.toLowerCase().match(/^([a-z][a-z0-9+.-]*):\/\//)?.[1] || "";
    const web = !scheme || scheme === "http" || scheme === "https", site = web ? siteOf(url) : "";
    const label = (site || url.replace(/^[a-z][a-z0-9+.-]*:\/\/([^@/]*@)?/i, "").replace(/[/?#].*$/, "") || url).slice(0, 120);
    const why = !url ? "No website" : scheme === "android" ? "Android app, not a website" : !web ? "Not a website" : !site ? "Not a website 1Helm can use" : !password ? "No password" : password.length > 1000 ? "Password is too long" : username.length > 300 ? "Username is too long" : "";
    if (why) { skipped.push({ site: label || "(blank)", reason: why }); continue; }
    const k = site + "\n" + username, prev = keep.get(k);
    if (prev) { keep.delete(k); if (prev.password === password) merged++; else skipped.push({ site, reason: "Listed twice in the file; kept the last one" }); }
    keep.set(k, { site, username, password });
  }
  const rows = [...keep.values()].sort((a, b) => a.site.localeCompare(b.site) || a.username.localeCompare(b.username));
  if (rows.length > PW_MAX) return { error: `That file has ${rows.length.toLocaleString()} logins. 1Helm imports up to ${PW_MAX.toLocaleString()} at a time: split the file and import it in parts.` };
  return { rows, skipped, merged, total: body.length };
}
