// Export my data: Settings, Account, "Export my data".
//   1. The button emails a 6-digit code to the account's address (same code length, lifetime, hashing and wrong-guess limits as a sign-in code).
//   2. A correct code starts ONE export job for the account (a partial unique index allows one pending or running job per account).
//   3. The job is resumable like a deletion (deletion.js): it saves its progress before it goes on, a deploy or restart loses nothing, and the 5-minute
//      cron (exportCron, called from index.js) carries on any job whose lease ran out. A job runs continuously until it is done: the ExportRunner
//      Durable Object (data-export-runner.js) keeps an alarm armed for the account and runs the job in slices with no gap, and the cron is only the safety
//      net that arms it again when a job stalled. The zip is written straight into an R2 multipart upload (data-export-zip.js), so an account of any size
//      works and only a few parts (8 to 64 MiB each, chosen from the account's stored bytes) are ever in memory. A very large account (over about 560 GiB)
//      is written as numbered zips (part1, part2, ...), each with its own download link; export.json in part 1 says which part holds each file:
//        export.json   every text item of the account in one JSON document, as stored (never summarized or filtered);
//        files/<channel>/...  every stored file, picture and recording, byte for byte, with its path given in export.json;
//        README.txt    what is in the zip, what is left out on purpose, and any file that was gone from storage.
//   4. When the zip is complete the person gets an email with a download link. The link is a row in download_links (kind "export"), served by
//      download-links.js serveDownloadLink like the phone apps' links (unguessable token, only its sha256 stored, range requests, always an attachment),
//      and it works for 72 hours. The cron then deletes the zip and the link. data_exports keeps status, times, size and expiry and no user content.
//   5. Deleting a channel or the account deletes running exports and finished zips first (exportsGone, called from deletion.js).
//
// Left out on purpose: saved keys, the vault, saved logins, API keys and OAuth or connection tokens, payment or card details, sign-in
// sessions and codes, the helper's computer disk, and the memory vectors. The Durable Objects only return allow listed tables with secret looking columns
// removed (data-export-do.js), the account level tables below are an allow list too, settings text goes through scrubDeep (secrets-scrub.js) and JSON
// settings lose keys with secret looking names. The person's own chat text is exported exactly as stored.
//
// The zip and the scratch objects live under exports/<tenant>/<id>, outside t/<tenant>/, so they are never counted as the person's storage.
import { newCode, cleanCode, sameHash, codeHash, CODE_TTL, CODE_TRIES, EMAIL_FAILS, EMAIL_WINDOW, IP_FAILS, IP_WINDOW, RESEND_WAIT, ipHash } from "./signin-code.js";
import { ZipOut } from "./data-export-zip.js";
import { stPut, stDelete } from "./storage.js";
import { bankId } from "./mem0.js";
import { nsOf } from "./mem0-store.js";
import { linkToken, tokenHash, publicBase } from "./share.js";
import { scrubDeep } from "./secrets-scrub.js";
import { safeName } from "./files.js";
import { ensureTable as ensureLinkTable } from "./download-links.js";
import { SECRET_COL, dropSecretKeys, RESIDENT_TABLES } from "./data-export-do.js";

export const EXPORT_TTL = 72 * 3600e3;          // how long the download link works
export const EXPORT_MAX_AGE = 7 * 86400e3;      // a job that has not finished this long after it started is given up
// LEASE_MS: how long a running job belongs to its process without a sign of life (every checkpoint renews it, and a run that stops gives it back at once).
// ALARM_BUDGET_MS: one slice of the continuous job; the next slice starts right after it. CRON_BUDGET_MS and KICK_BUDGET_MS are for the inline runs (no runner).
const LEASE_MS = 2 * 60e3, CRON_BUDGET_MS = 10 * 60e3, ALARM_BUDGET_MS = 5 * 60e3, KICK_BUDGET_MS = 20e3, CK_EVERY_MS = 20e3;
export const MAX_PARTS = 9000;                  // planned parts in one zip (R2 allows 10,000; the rest is room for the directory and the estimate being off)
const PART_SIZES = [8, 16, 32, 64].map((m) => m * 1024 * 1024);
const MIB = 1024 * 1024, GIB = 1024 * MIB;
const SEND_WINDOW = 15 * 60e3, SENDS_PER_WINDOW = 6, INLINE_MAX = 8 * 1024 * 1024;
const TEST_ADDR = /@example\.(com|org|net)$/;
const isTestAddr = (env, email) => env.TEST_MODE === "1" && TEST_ADDR.test(email || "");
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const jp = (s, d) => { try { return JSON.parse(s ?? "") ?? d; } catch { return d; } };

export const prefixOf = (tid, id) => `exports/${tid}/${id}`;
export const zipKey = (tid, id) => `${prefixOf(tid, id)}.zip`;
export const zipKeyN = (tid, id, n) => (n > 1 ? `${prefixOf(tid, id)}-part${n}.zip` : zipKey(tid, id));
// The smallest part size (8, 16, 32 or 64 MiB) that lets one zip hold the account's stored bytes (plus room for export.json and the directory) in at most
// maxParts parts. Above the largest size's reach, the export is written as several zips of that size.
export function choosePart(totalBytes, maxParts = MAX_PARTS) {
  const need = Math.max(0, Number(totalBytes) || 0) * 1.05 + 64 * MIB;
  return PART_SIZES.find((p) => p * maxParts >= need) || PART_SIZES[PART_SIZES.length - 1];
}
const archive = (env, tid) => env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tid}`));
const resident = (env, tid, slug) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:${slug}`));

export const MSG = {
  format: "Enter the 6-digit code from the email.",
  wrong: "That code isn't right. Check the newest email from 1Helm and try again.",
  too_many: "Too many wrong tries, so this code no longer works. Send a new code.",
  expired: "That code has expired. Send a new one.",
  locked: "Too many wrong codes for this account today. Try again tomorrow.",
  locked_ip: "Too many wrong codes from this network. Wait 15 minutes and try again.",
};
export const STARTED = "Your export has started. It can take up to 7 days. We'll email you a link to download it, and the link works for 72 hours.";

// ---------------------------------------------------------------- tables ----------------------------------------------------------------
let ready = false;
export const _resetReady = () => { ready = false; };
export async function ensureTables(env) {
  if (ready) return;
  for (const q of [
    "CREATE TABLE IF NOT EXISTS data_exports (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, bytes INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, seq INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0, error TEXT)",
    "CREATE UNIQUE INDEX IF NOT EXISTS data_exports_one ON data_exports (tenant_id) WHERE status IN ('pending','running')",
    "CREATE INDEX IF NOT EXISTS data_exports_tenant ON data_exports (tenant_id, requested_at)",
    "CREATE TABLE IF NOT EXISTS data_export_codes (tenant_id TEXT PRIMARY KEY, nonce TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 1, window_at INTEGER NOT NULL, sent_at INTEGER NOT NULL)",
  ]) await env.DB.prepare(q).run();
  ready = true;
}

// ---------------------------------------------------------------- emails ----------------------------------------------------------------
const h = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shell = (env, inner) => `<!doctype html><html><body style="margin:0;background:#f3f2ef;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1c1b19"><div style="max-width:480px;margin:40px auto;background:#fff;border-radius:18px;padding:36px 32px"><img src="https://${env.GATEWAY_HOST}/1helm-icon-64.png" width="40" height="40" alt="1Helm" style="border-radius:10px">${inner}</div></body></html>`;
export function codeEmail(env, code) {
  return { subject: `Your 1Helm export code: ${code}`,
    html: shell(env, `<h1 style="font-size:22px;margin:22px 0 8px">Export your 1Helm data</h1><p style="margin:0 0 14px;color:#55524c">Enter this code in Settings to start your export:</p><div style="margin:0 0 26px;padding:16px 0;border-radius:14px;background:#f3f2ef;text-align:center"><span style="font:600 34px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.22em;padding-left:.22em;color:#1c1b19">${code}</span></div><p style="margin:0;font-size:14px;color:#55524c">The code works once and expires in 15 minutes.</p><p style="margin:20px 0 0;font-size:13px;color:#8a867e">If you didn't ask for this, you can ignore this email. Nobody can start an export without the code. Never share it with anyone.</p>`),
    text: `Export your 1Helm data\n\nYour export code: ${code}\nEnter it in Settings to start your export.\n\nThe code works once and expires in 15 minutes.\n\nIf you didn't ask for this, you can ignore this email. Nobody can start an export without the code. Never share it with anyone.` };
}
// links: the download links, one for each zip (a string is the same as a list of one).
export function readyEmail(env, links, expires) {
  links = [].concat(links); const many = links.length > 1, when = new Date(expires).toUTCString();
  const what = many ? `Your 1Helm data is in ${links.length} zip files because it is large. Part 1 holds export.json with all your text and a list of which part holds each file, and the other parts hold your pictures, recordings and other files.`
    : "Your 1Helm data is in one zip file. It holds export.json with all your text, and a files folder with your pictures, recordings and other files.";
  const it = many ? "them" : "it", file = many ? "files are" : "file is", link = many ? "links work" : "link works", anyLink = many ? "a link" : "the link";
  const button = (l, i) => `<p style="margin:0 0 12px"><a href="${h(l)}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600">${many ? `Download part ${i + 1} of ${links.length}` : "Download your export"}</a></p>`;
  const tail = `Anyone who has ${anyLink} can download your data until it expires, so don't share ${it}. If you didn't ask for this export, change your sign-in email in Settings and write to help@1helm.com.`;
  return { subject: "Your 1Helm export is ready",
    html: shell(env, `<h1 style="font-size:22px;margin:22px 0 8px">Your export is ready</h1><p style="margin:0 0 24px;color:#55524c">${h(what)}</p>${links.map(button).join("")}<p style="margin:24px 0 0;font-size:14px;color:#55524c">The ${link} for 72 hours, until ${h(when)}. After that the ${file} deleted. If you need ${it} again, start a new export in Settings.</p><p style="margin:20px 0 0;font-size:13px;color:#8a867e">${tail}</p>`),
    text: `Your 1Helm export is ready\n\n${what}\n\nDownload ${it} here:\n${many ? links.map((l, i) => `Part ${i + 1}:\n${l}`).join("\n\n") : links[0]}\n\nThe ${link} for 72 hours, until ${when}. After that the ${file} deleted. If you need ${it} again, start a new export in Settings.\n\n${tail}` };
}
export function failedEmail(env) {
  return { subject: "We couldn't finish your 1Helm export",
    html: shell(env, `<h1 style="font-size:22px;margin:22px 0 8px">Your export didn't finish</h1><p style="margin:0;color:#55524c">We tried for 7 days and couldn't finish your export. Nothing was lost. You can start a new export in Settings, and if it fails again write to help@1helm.com.</p>`),
    text: `Your export didn't finish\n\nWe tried for 7 days and couldn't finish your export. Nothing was lost. You can start a new export in Settings, and if it fails again write to help@1helm.com.` };
}
const sendMail = (env, m) => env.EMAIL.send({ to: m.to, from: { email: "hello@mail.1helm.com", name: "1Helm" }, subject: m.subject, html: m.html, text: m.text });

// ---------------------------------------------------------------- the code ----------------------------------------------------------------
// → { ok, expires, resend_wait, sent_to, test_code? } | { error, kind, status }
export async function requestCode(env, t, user, { at = Date.now(), send = sendMail } = {}) {
  await ensureTables(env);
  const busy = await env.DB.prepare("SELECT 1 FROM data_exports WHERE tenant_id=? AND status IN ('pending','running')").bind(t.id).first();
  if (busy) return { error: "An export is already in progress.", kind: "busy", status: 409 };
  const ex = await env.DB.prepare("SELECT * FROM data_export_codes WHERE tenant_id=?").bind(t.id).first();
  let sends = 1, windowAt = at;
  if (ex) {
    if (at - Number(ex.sent_at) < RESEND_WAIT * 1000) return { error: "Wait a few seconds before asking for a new code.", kind: "wait", status: 429 };
    if (at - Number(ex.window_at) < SEND_WINDOW) { if (Number(ex.sends) >= SENDS_PER_WINDOW) return { error: "Too many codes were sent. Try again in a few minutes.", kind: "wait", status: 429 }; sends = Number(ex.sends) + 1; windowAt = Number(ex.window_at); }
  }
  const nonce = rand(), code = newCode();
  await env.DB.prepare("INSERT INTO data_export_codes (tenant_id,nonce,code_hash,expires_at,tries,sends,window_at,sent_at) VALUES (?,?,?,?,0,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET nonce=excluded.nonce, code_hash=excluded.code_hash, expires_at=excluded.expires_at, tries=0, sends=excluded.sends, window_at=excluded.window_at, sent_at=excluded.sent_at")
    .bind(t.id, nonce, await codeHash(env, nonce, user.email, code), at + CODE_TTL, sends, windowAt, at).run();
  if (!isTestAddr(env, user.email)) {
    try { await send(env, { to: user.email, ...codeEmail(env, code) }); }
    catch (e) { await env.DB.prepare("DELETE FROM data_export_codes WHERE tenant_id=? AND nonce=?").bind(t.id, nonce).run(); console.log("export code email failed", e?.code || e?.message); return { error: "We couldn't send the email. Try again in a minute.", kind: "send", status: 502 }; }
  }
  return { ok: true, expires: at + CODE_TTL, resend_wait: RESEND_WAIT, sent_to: user.email, ...(isTestAddr(env, user.email) ? { test_code: code } : {}) };
}
// A typed code against this account's pending code. → { ok } (the code is used up) | { kind, error }
export async function verifyExportCode(env, req, t, user, typed, { at = Date.now() } = {}) {
  await ensureTables(env);
  const DB = env.DB, code = cleanCode(typed), no = (kind) => ({ kind, error: MSG[kind] }), who = `export:${t.id}`;
  if (!/^\d{6}$/.test(code)) return no("format");
  const ip = await ipHash(req);
  const ipFails = await DB.prepare("SELECT COUNT(*) n FROM signin_code_fails WHERE ip=? AND at>?").bind(ip, at - IP_WINDOW).first();
  if (Number(ipFails?.n || 0) >= IP_FAILS) return no("locked_ip");
  const row = await DB.prepare("SELECT nonce,code_hash,expires_at,tries FROM data_export_codes WHERE tenant_id=?").bind(t.id).first();
  if (!row) return no("expired");
  if (Number(row.expires_at) <= at) return no("expired");
  if (Number(row.tries) >= CODE_TRIES) return no("too_many");
  const emailFails = await DB.prepare("SELECT COUNT(*) n FROM signin_code_fails WHERE email=? AND at>?").bind(who, at - EMAIL_WINDOW).first();
  if (Number(emailFails?.n || 0) >= EMAIL_FAILS) return no("locked");
  // Count the guess first (atomic), so parallel guesses can't get past the limit.
  const n = await DB.prepare("UPDATE data_export_codes SET tries=tries+1 WHERE tenant_id=? AND nonce=? AND tries<? RETURNING tries").bind(t.id, row.nonce, CODE_TRIES).first();
  if (!n) return no("too_many");
  if (!sameHash(await codeHash(env, row.nonce, user.email, code), row.code_hash)) {
    await DB.prepare("INSERT INTO signin_code_fails (email,ip,at) VALUES (?,?,?)").bind(who, ip, at).run();
    return no(Number(n.tries) >= CODE_TRIES ? "too_many" : "wrong");
  }
  const used = await DB.prepare("DELETE FROM data_export_codes WHERE tenant_id=? AND nonce=? RETURNING 1 x").bind(t.id, row.nonce).first();
  return used ? { ok: true } : no("expired");
}

// ---------------------------------------------------------------- starting and asking ----------------------------------------------------------------
export async function startExport(env, t, user, { at = Date.now() } = {}) {
  await ensureTables(env);
  const id = crypto.randomUUID();
  try { await env.DB.prepare("INSERT INTO data_exports (id,tenant_id,user_id,status,requested_at,updated_at) VALUES (?,?,?,'pending',?,?)").bind(id, t.id, String(user.id), at, at).run(); }
  catch (e) { if (/UNIQUE/i.test(e?.message || "")) return { error: "An export is already in progress.", kind: "busy", status: 409 }; throw e; }
  return { ok: true, id };
}
const view = (r) => r ? { id: r.id, state: r.status === "pending" || r.status === "running" ? "running" : r.status === "done" ? "ready" : r.status === "failed" ? "failed" : "none",
  requested_at: Number(r.requested_at), finished_at: r.finished_at ? Number(r.finished_at) : null, expires_at: r.expires_at ? Number(r.expires_at) : null } : { state: "none" };
export async function exportStatus(env, t, user) {
  await ensureTables(env);
  const r = await env.DB.prepare("SELECT * FROM data_exports WHERE tenant_id=? ORDER BY requested_at DESC LIMIT 1").bind(t.id).first();
  const v = view(r);
  if (v.state === "ready" && Number(r.expires_at) <= Date.now()) return { state: "none" };
  if (v.state === "ready") {
    const ls = await linksOf(env, t, r.id); v.parts = Math.max(1, ls.length);
    if (isTestAddr(env, user.email) && ls.length) { v.test_links = ls; v.test_link = ls[0]; }   // test accounts only: the addresses a real person gets by email (test_link is the first)
  }
  return v;
}
// One name for each zip: 1helm-export-<date>.zip, or ...-part<n>.zip when the export is in several zips.
const dlName = (at, n = 1, total = 1) => `1helm-export-${new Date(at).toISOString().slice(0, 10)}${total > 1 ? `-part${n}` : ""}.zip`;
const partOfName = (name) => Number(/-part(\d+)\.zip$/.exec(String(name))?.[1] || 1);
// The download links of an export, in part order.
async function linksOf(env, t, id) {
  const rows = ((await env.DB.prepare("SELECT id,salt,name FROM download_links WHERE tenant_id=? AND kind='export' AND file_id=? AND expires_at>?").bind(t.id, id, Date.now()).all().catch(() => ({ results: [] }))).results || [])
    .sort((a, b) => partOfName(a.name) - partOfName(b.name));
  return Promise.all(rows.map(async (l) => `${publicBase(env, t)}/d/${await linkToken(env, l.id, l.salt)}/${encodeURIComponent(l.name)}`));
}
// Every zip of an export that is in storage, in part order. → [{ n, key, size }]
export async function zipsOf(env, tid, id) {
  const base = prefixOf(tid, id), out = [];
  for (const k of await listObjs(env, base)) { const m = /^(?:-part(\d+))?\.zip$/.exec(k.key.slice(base.length)); if (m) out.push({ n: Number(m[1] || 1), key: k.key, size: k.size }); }
  return out.sort((a, b) => a.n - b.n);
}

// POST/GET /w/<slug>/api/account/data-export[/code|/start|/delete]. Signed in as the owner; allowed even when the account is read-only (it is the person's own data).
export async function dataExportRoute(req, env, t, user, url, sub, deps = {}) {
  if (sub !== "/api/account/data-export" && !sub.startsWith("/api/account/data-export/")) return null;
  if (sub === "/api/account/data-export") return req.method === "GET" ? json(await exportStatus(env, t, user)) : json({ error: "method" }, 405);
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const origin = req.headers.get("origin");
  if ((origin && origin !== url.origin) || !/^application\/json\b/i.test(req.headers.get("content-type") || "")) return json({ error: "forbidden" }, 403);
  const at = Date.now();
  try {
    if (sub === "/api/account/data-export/code") { const r = await requestCode(env, t, user, { at, send: deps.send }); return r.error ? json({ error: r.error, kind: r.kind }, r.status) : json(r); }
    if (sub === "/api/account/data-export/delete") { const n = await exportsGone(env, t.id); return json({ ok: true, deleted: n }); }   // the person's own: stop a running export and delete finished zips and links now
    if (sub === "/api/account/data-export/start") {
      const b = await req.json().catch(() => ({})), v = await verifyExportCode(env, req, t, user, b.code, { at });
      if (!v.ok) return json({ error: v.error, kind: v.kind }, v.kind === "format" ? 400 : v.kind === "locked" || v.kind === "locked_ip" ? 429 : 403);
      const s = await startExport(env, t, user, { at }); if (s.error) return json({ error: s.error, kind: s.kind }, s.status);
      const run = kick(env, t.id, s.id, { send: deps.send }).catch((e) => console.log("export start", e?.message));
      if (deps.waitUntil) deps.waitUntil(run); else await run;
      return json({ ok: true, state: "running", message: STARTED });
    }
  } catch (e) { console.log("data export", sub, e?.message); return json({ error: "Something went wrong. Try again in a minute." }, 500); }
  return json({ error: "not found" }, 404);
}

// ---------------------------------------------------------------- what goes in export.json ----------------------------------------------------------------
// The account level tables (an allow list). where/args decide whose rows; omit drops columns; only keeps just those columns.
const byT = (table, o = {}) => ({ table, where: "tenant_id = ?", who: "tenant", ...o });
export const D1_TABLES = [
  { table: "users", where: "id = ?", who: "user" },
  { table: "tenants", where: "id = ?", who: "tenant", omit: ["stripe_customer", "stripe_subscription"] },
  byT("resident_schedules"), byT("approval_policy"), byT("perm_prefs"), byT("perm_allow"), byT("notif_prefs"), byT("pomodoro_prefs"), byT("agent_checkin_prefs"), byT("tenant_flags"), byT("tenant_location"),
  byT("interviews"), byT("account_note"), byT("issue_reports"), byT("meeting_alerts"), byT("memory_sources"), byT("memory_places"), byT("app_default"),
  byT("link_purchases", { omit: ["approval_url", "card_last4", "card_filled_host"] }),   // the purchase record: what, where, how much and when; no card details
  byT("share_links", { omit: ["token_hash", "salt", "r2key"] }), byT("share_chats", { omit: ["token_hash", "salt", "prefix"] }), byT("published_pages", { omit: ["prefix"] }),
  byT("cards", { omit: ["token"] }),
  byT("texting", { only: ["phone", "status", "assigned", "connected_at", "inbound_count"] }),
];
const MEM_TABLES = [{ table: "mem", key: "memory_facts" }, { table: "mem_history", key: "memory_history" }];
const colsCache = new WeakMap();
async function columnsOf(env, table) {
  let m = colsCache.get(env.DB); if (!m) colsCache.set(env.DB, m = new Map());
  if (!m.has(table)) m.set(table, ((await env.DB.prepare(`PRAGMA table_info(${table})`).all().catch(() => ({ results: [] }))).results || []).map((c) => c.name));
  return m.get(table);
}
async function d1Page(env, spec, args, cur, { scrub = true } = {}) {
  const cols = (await columnsOf(env, spec.table)).filter((c) => (spec.only ? spec.only.includes(c) : !(spec.omit || []).includes(c)) && !SECRET_COL.test(c));
  if (!cols.length) return { items: [], next: null };
  const got = ((await env.DB.prepare(`SELECT rowid AS _r, ${cols.map((c) => `"${c}"`).join(",")} FROM ${spec.table} WHERE (${spec.where}) AND rowid > ? ORDER BY rowid LIMIT 201`).bind(...args, cur).all().catch(() => ({ results: [] }))).results || []);
  const items = []; let bytes = 0, last = cur, more = false;
  for (let i = 0; i < got.length; i++) {
    if (i >= 200) { more = true; break; }
    let { _r, ...row } = got[i];
    if (spec.table === "mem") row = { ...row, payload: jp(row.payload, row.payload) };
    if (scrub && spec.table !== "mem" && spec.table !== "mem_history") row = scrubDeep(row)[0];
    const n = JSON.stringify(row).length; if (items.length && bytes + n > 1_500_000) { more = true; break; }
    items.push(row); bytes += n; last = Number(_r);
  }
  return { items, next: more ? last : null };
}
const argsOf = (spec, st) => spec.who === "user" ? [st.user.id] : [st.tenant.id];

const extOf = (n) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(n || "")); return m ? m[1].toLowerCase() : ""; };
// Values kept on the saved state object that must not be saved (caches).
const hid = (o, k, v) => { Object.defineProperty(o, k, { value: v, writable: true, enumerable: false, configurable: true }); return v; };
// A path inside the zip that no other file of this channel has: the file's own name, or "name (2).ext" when taken.
const usedSet = (st) => { if (!st._set || st._n !== st.used.length) { hid(st, "_set", new Set(st.used)); hid(st, "_n", st.used.length); } return st._set; };
function uniquePath(st, dir, name) {
  const used = usedSet(st); let base = safeName(name), p = `${dir}/${base}`;
  if (used.has(p.toLowerCase())) { const e = extOf(base), stem = e ? base.slice(0, -(e.length + 1)) : base; for (let i = 2; ; i++) { p = `${dir}/${stem} (${i})${e ? "." + e : ""}`; if (!used.has(p.toLowerCase())) break; } }
  st.used.push(p.toLowerCase()); used.add(p.toLowerCase()); st._n = st.used.length; return p;
}
// Which zip a file goes in. Files are given to part 1 until it is full (by the stored sizes plus what each entry adds to the zip), then to part 2, and so on, so the
// parts of the manifest only ever go up. Part 1 keeps room for export.json, the README and the directory. → the part number
const usable = (st, n) => { const full = st.maxParts * st.partSize, reserve = n === 1 ? Math.min(4 * GIB, full * 0.25) : full * 0.02; return (full - reserve) * 0.95; };
const addFile = (st, key, path, size, at) => {
  const sz = Number(size) || 0, cost = sz + 400 + 3 * String(path).length, a = st.asg;   // entry header, descriptor and directory record, with the name in both
  if (a.bytes > 0 && a.bytes + cost > usable(st, a.n)) { a.n++; a.bytes = 0; }
  a.bytes += cost; st.mfBuf.push({ key, path, size: sz, at: Number(at) || 0, part: a.n }); st.counts.files++; st.counts.bytes += sz; return a.n;
};
// Run fn over the list a few at a time, in order.
async function inBatches(list, n, fn) { const out = []; for (let i = 0; i < list.length; i += n) out.push(...await Promise.all(list.slice(i, i + n).map(fn))); return out; }

// ---- reading pages from the Durable Objects: big pages, and the next page is asked for while the current one is being written ----
const OLD_RPC = /does not implement|is not a function|not a function/i;
// Ask for the big page; an object still running the code from before the deploy answers with the small page.
async function dxCall(stub, big, old, ...args) {
  try { return await stub[big](...args); }
  catch (e) { if (OLD_RPC.test(String(e?.message || e))) return stub[old](...args); throw e; }
}
async function rawNow(env, st, src, cur) {
  const tid = st.tenant.id;
  if (src.k === "arch") return dxCall(archive(env, tid), "dxPageBig", "dxPage", src.table, cur);
  if (src.k === "archrows") return dxCall(archive(env, tid), "dxRowsBig", "dxRows", src.cid, cur);
  if (src.k === "bee") return env.BEE_SYNC ? dxCall(env.BEE_SYNC.get(env.BEE_SYNC.idFromName(tid)), "dxPageBig", "dxPage", src.table, cur) : { rows: [], next: null };
  if (src.k === "beeconvs") return env.BEE_SYNC ? dxCall(env.BEE_SYNC.get(env.BEE_SYNC.idFromName(tid)), "dxPageBig", "dxPage", "convs", cur) : { rows: [], next: null };
  if (src.k === "res") return dxCall(resident(env, tid, src.slug), "dxPageBig", "dxPage", src.table, cur);
  if (src.k === "sessions") return dxCall(resident(env, tid, src.slug), "dxPageBig", "dxPage", "sessions", cur);
  if (src.k === "turns") return dxCall(resident(env, tid, src.slug), "dxTurnsBig", "dxTurns", src.sid, cur);
  throw new Error(`unknown export source ${src.k}`);
}
// One page of a Durable Object source. When the answer says there is more, the next page is requested at once, so the next call usually finds it ready.
async function raw(env, st, src, cur) {
  const a = st._ahead || hid(st, "_ahead", new Map()), key = JSON.stringify([src, cur]), p = a.get(key); a.delete(key);
  let r; if (p) { try { r = await p; } catch { r = null; } }
  r ||= await rawNow(env, st, src, cur);
  if (r.next != null) { const nk = JSON.stringify([src, r.next]); if (!a.has(nk)) { const q = rawNow(env, st, src, r.next); q.catch(() => {}); a.set(nk, q); } }
  return r;
}

// One page of one source. → { items, next } (next null = done). Items are what goes into the JSON array, as stored.
async function fetchPage(env, st, src, cur) {
  const tid = st.tenant.id;
  if (src.k === "d1") { const spec = D1_TABLES[src.i]; return d1Page(env, spec, argsOf(spec, st), cur); }
  if (src.k === "mem") { const ns = await nsOf(bankId(env, tid, src.slug)), spec = { table: src.table, where: "ns = ?" }; return d1Page(env, spec, [ns], cur, { scrub: false }); }
  if (src.k === "arch" || src.k === "archrows" || src.k === "bee") { const r = await raw(env, st, src, cur); return { items: r.rows, next: r.next }; }
  if (src.k === "beeconvs") {
    if (!env.BEE_SYNC) return { items: [], next: null };
    const r = await raw(env, st, src, cur), got = await inBatches(r.rows, 4, async (c) => {   // the transcripts are read a few at a time; each is added to the zip in order below
      const key = c.r2_key || `t/${tid}/bee/conv/${c.id}.json`, head = await env.WS.head(key).catch(() => null);
      return { c, key, head, text: head && head.size <= INLINE_MAX ? await (await env.WS.get(key)).text() : null };
    }), items = [];
    for (const { c, key, head, text } of got) {
      const { r2_key, ...row } = c;
      if (!head) items.push({ ...row, transcript: null });
      else if (text != null) items.push({ ...row, transcript: text });
      else { const path = `files/_bee/conversation-${c.id}.json`, part = addFile(st, key, path, head.size, c.start_time); items.push({ ...row, transcript_file: path, part }); }
    }
    return { items, next: r.next };
  }
  if (src.k === "r2text") {   // live notes: the saved text of each session, from R2
    const l = await env.WS.list({ prefix: src.prefix, cursor: cur || undefined, limit: 50 }), objs = l.objects || [];
    const got = await inBatches(objs, 4, async (o) => (o.size <= INLINE_MAX ? { o, text: await (async () => { const g = await env.WS.get(o.key); return g ? g.text() : null; })() } : { o, text: undefined })), items = [];
    for (const { o, text } of got) {
      const rel = o.key.slice(src.prefix.length);
      if (text !== undefined) items.push({ key: rel, bytes: o.size, text });
      else { const path = `files/${src.slug}/live-notes/${safeName(rel.replace(/\//g, "-"))}`, part = addFile(st, o.key, path, o.size, 0); items.push({ key: rel, bytes: o.size, file: path, part }); }
    }
    return { items, next: l.truncated ? l.cursor : null };
  }
  if (src.k === "photos") {   // contact photos: stored inside the Contacts data, so each one is copied to a scratch object that the file step then reads
    const { row } = await archive(env, tid).dxPhoto(cur); if (!row) return { items: [], next: null };
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(row.data), mime = m?.[1] || "image/jpeg", rawData = m ? (m[2] ? m[3] : decodeURIComponent(m[3])) : row.data;
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic" }[mime] || "jpg";
    const bytes = m && !m[2] ? enc.encode(rawData) : Uint8Array.from(atob(rawData.replace(/\s+/g, "")), (c) => c.charCodeAt(0)), path = `files/_contacts/${safeName(row.person)}.${ext}`;
    const scratch = `${prefixOf(tid, st.id)}/photo-${row._r}`; await stPut(env, scratch, bytes); const part = addFile(st, scratch, path, bytes.length, row.at);
    return { items: [{ person: row.person, mime, bytes: bytes.length, file: path, part }], next: row._r };
  }
  if (src.k === "res") {   // one table of a channel's Resident
    const r = await raw(env, st, src, cur);
    if (src.table === "files") {
      const items = []; st.used = st.used || [];
      for (const f of r.rows) {
        if (Number(f.deleted) === 1) continue;
        const { r2key, view_key, prev_key, orig_key, ...rest } = f, path = uniquePath(st, `files/${src.slug}`, f.name);
        const part = r2key ? addFile(st, r2key, path, f.bytes, f.at) : null;
        items.push({ ...rest, path: r2key ? path : null, part });
      }
      return { items, next: r.next };
    }
    if (src.table === "shots") {
      return { items: r.rows.map((s) => { const { r2key, ...rest } = s, path = r2key ? uniquePath(st, `files/${src.slug}/screenshots`, `${s.id}.${extOf(r2key) || "jpg"}`) : null; const part = r2key ? addFile(st, r2key, path, s.bytes, s.at) : null; return { ...rest, path, part }; }), next: r.next };
    }
    if (src.table === "kv") return { items: r.rows.map((x) => scrubDeep(x)[0]), next: r.next };
    return { items: r.rows, next: r.next };
  }
  if (src.k === "turns") { const r = await raw(env, st, src, cur); return { items: r.rows, next: r.next }; }
  throw new Error(`unknown export source ${src.k}`);
}

// ---------------------------------------------------------------- the plan ----------------------------------------------------------------
// The JSON is produced by a stack of steps (the top runs first). The stack is part of the saved state, so a restart continues at the same place.
const Rw = (open, src, close = "]") => ({ t: "rows", open, close, src, cur: 0, n: 0, begun: false });
const plan = (st) => {
  const out = [{ t: "begin", name: "export.json", at: st.at },
    { t: "lit", s: `{"format":"1helm-export","version":1,"exported_at":${JSON.stringify(new Date(st.at).toISOString())},"workspace":${JSON.stringify(st.tenant.slug)},"account":{` }];
  D1_TABLES.forEach((s, i) => out.push(Rw(`${i ? "," : ""}"${s.table}":[`, { k: "d1", i })));
  out.push({ t: "lit", s: `},"contacts":{` });
  out.push(Rw(`"people":[`, { k: "arch", table: "people" }), Rw(`,"people_facts":[`, { k: "arch", table: "people_facts" }), Rw(`,"people_seen":[`, { k: "arch", table: "people_seen" }), Rw(`,"photos":[`, { k: "photos" }));
  out.push({ t: "lit", s: `},"bee":{` }, Rw(`"conversations":[`, { k: "beeconvs" }), Rw(`,"facts":[`, { k: "bee", table: "facts" }), Rw(`,"speaker_map":[`, { k: "bee", table: "speaker_map" }), Rw(`,"speakers":[`, { k: "bee", table: "speakers" }));
  out.push({ t: "lit", s: `},"workspace_rows":[` }, Rw("", { k: "archrows", cid: null }, ""), { t: "lit", s: `],"channels":[` });
  st.channels.forEach((c, i) => out.push({ t: "chan", i }));
  out.push({ t: "lit", s: `]` }, { t: "zipinfo" }, { t: "lit", s: `}` }, { t: "endentry" }, { t: "copy" }, { t: "readme" }, { t: "finish" });
  return out.reverse();
};
function channelSteps(st, i) {
  const c = st.channels[i], slug = c.slug, out = [{ t: "lit", s: `${i ? "," : ""}{"slug":${JSON.stringify(slug)},"name":${JSON.stringify(c.name)},"channel":${JSON.stringify(dropSecretKeys(c.row))}` }];
  out.push(Rw(`,"archive_rows":[`, { k: "archrows", cid: c.id }));
  out.push({ t: "tasks", slug, open: `,"tasks":[`, close: "]", cur: 0, i: 0, n: 0, loose: false, begun: false });
  for (const table of RESIDENT_TABLES) if (table !== "sessions") out.push(Rw(`,"${table}":[`, { k: "res", slug, table }));
  for (const m of MEM_TABLES) out.push(Rw(`,"${m.key}":[`, { k: "mem", slug, table: m.table }));
  out.push(Rw(`,"live_notes_text":[`, { k: "r2text", slug, prefix: `t/${st.tenant.id}/bee/live/${slug}/` }), { t: "lit", s: `}` });
  return out;
}
// The end of export.json: how many zips there are and what they are called (every file item above has the number of the zip that holds it, "part").
const zipInfo = (st) => `,"zip_parts":{"count":${st.nparts},"files":${JSON.stringify(Array.from({ length: st.nparts }, (_, k) => dlName(st.at, k + 1, st.nparts)))}}`;

// ---------------------------------------------------------------- the job ----------------------------------------------------------------
async function initState(env, row, at, { part, maxParts = MAX_PARTS } = {}) {
  const t = await env.DB.prepare("SELECT id, slug FROM tenants WHERE id=?").bind(row.tenant_id).first(); if (!t) throw new Error("account is gone");
  const u = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(row.user_id).first();
  const chans = (await archive(env, row.tenant_id).channels().catch(() => [])) || [];
  // The part size comes from what the account stores (everything but the computer disk, which is not exported); a wrong count only changes how many zips there are.
  const total = Number((await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) b FROM storage_usage WHERE tenant_id=? AND kind<>'computer'").bind(row.tenant_id).first().catch(() => null))?.b) || 0;
  const st = { v: 1, id: row.id, at, zip: {}, mfSegs: 0, mfBuf: [], used: [], copy: { seg: 1, idx: 0 }, missing: [], counts: { files: 0, bytes: 0 },
    partSize: part || choosePart(total, maxParts), maxParts, curPart: 1, nparts: 1, asg: { n: 1, bytes: 0 }, done: [], stored_bytes: total,
    tenant: { id: t.id, slug: t.slug }, user: { id: u?.id || row.user_id },
    channels: chans.map((c) => ({ slug: String(c.slug || c.name), name: c.name, id: String(c.id), row: c })) };
  st.counts.channels = st.channels.length; st.stack = plan(st); return st;
}
async function claim(env, id, at) {
  return env.DB.prepare("UPDATE data_exports SET status='running', lease_until=?, started_at=COALESCE(started_at,?), updated_at=?, tries=tries+1 WHERE id=? AND status IN ('pending','running') AND lease_until<? RETURNING *")
    .bind(at + LEASE_MS, at, at, id, at).first();
}
const readText = async (env, key) => { const o = await env.WS.get(key); return o ? o.text() : null; };

// Runs (or carries on) one export for at most budgetMs, then saves and gives the lease back. → { done } | { paused } | { skipped } | { error }
// Whatever way a run stops (time is up, an error, a pause), it has saved its progress first and then gives the lease back at once, so the next run can start right away.
export async function runExport(env, id, { budgetMs = CRON_BUDGET_MS, now = Date.now, send = sendMail, part, maxParts, ckEveryMs = CK_EVERY_MS, mem } = {}) {
  await ensureTables(env);
  const t0 = now(), row = await claim(env, id, t0); if (!row) return { skipped: true };
  const tid = row.tenant_id, p = prefixOf(tid, id); let z = null, seq = Number(row.seq) || 0, lastCk = t0;
  try {
    let st = seq ? jp(await readText(env, `${p}/state-${seq}`), null) : null;
    if (seq && !st) {   // the zips were complete and the row was not updated before a restart (the scratch is gone): only the last steps are left
      const zs = await zipsOf(env, tid, id); if (!zs.length) throw new Error("export state is missing");
      await finalize(env, row, zs, { now, send }); return { done: true, size: zs.reduce((n, x) => n + x.size, 0), resumed: true };
    }
    const fresh = !st; st ||= await initState(env, row, t0, { part, maxParts });
    st.curPart ||= 1; st.nparts ||= 1; st.done ||= []; st.asg ||= { n: 1, bytes: 0 }; st.maxParts ||= 1e9; st.partSize ||= st.zip.part || part;   // a state saved before the zips could be split
    const zipP = (n) => (n > 1 ? `${p}/z${n}` : p), newZip = () => new ZipOut(env, { key: zipKeyN(tid, id, st.curPart), scratch: zipP(st.curPart), state: st.zip, ...(st.partSize ? { part: st.partSize } : {}) });
    for (let h; st.zip.uploadId && (h = await env.WS.head(zipKeyN(tid, id, st.curPart)));) {   // a zip was completed but the state saying so was not saved: carry on after it
      if (!st.done.some((d) => d.n === st.curPart)) st.done.push({ n: st.curPart, size: h.size });
      if (st.curPart >= st.nparts) { await finalize(env, row, st.done, { now, send }); return { done: true, size: st.done.reduce((n, x) => n + x.size, 0), resumed: true }; }
      if (st.stack.at(-1)?.t === "finish") st.stack.pop();
      st.curPart++; st.zip = {}; st.stack.push({ t: "finish" }, { t: "copy" });
    }
    z = await newZip().open();
    const ck = async () => {   // everything so far survives a restart
      const prev = seq; seq++;
      await z.checkpoint(seq);
      if (st.mfBuf.length) { await stPut(env, `${p}/mf-${st.mfSegs + 1}`, st.mfBuf.map((x) => JSON.stringify(x)).join("\n")); st.mfSegs++; st.mfBuf = []; }
      await stPut(env, `${p}/state-${seq}`, JSON.stringify(st));
      const r = await env.DB.prepare("UPDATE data_exports SET seq=?, updated_at=?, lease_until=?, bytes=? WHERE id=? AND status='running'").bind(seq, now(), now() + LEASE_MS, st.done.reduce((n, x) => n + x.size, 0) + (st.zip.size || 0), id).run();
      if (!Number(r.meta?.changes || 0)) throw Object.assign(new Error("export was canceled"), { canceled: true });
      await z.dropOld(prev); if (prev) await stDelete(env, [`${p}/state-${prev}`]).catch(() => {}); lastCk = now();
    };
    if (fresh) await ck();   // the work of starting (the channel list, the plan) is saved at once
    const over = () => now() - t0 > budgetMs, due = () => now() - lastCk > ckEveryMs;
    const put = (s) => z.write(enc.encode(s));
    const pause = async () => { await ck(); await env.DB.prepare("UPDATE data_exports SET lease_until=0 WHERE id=? AND status='running'").bind(id).run(); return { paused: true }; };
    const pages = st._pages || hid(st, "_pages", new Map());
    while (st.stack.length) {
      const top = st.stack[st.stack.length - 1];
      if (top.t === "lit") { await put(top.s); st.stack.pop(); }
      else if (top.t === "begin") { await z.begin(top.name, top.at); st.stack.pop(); }
      else if (top.t === "zipinfo") { st.nparts = st.asg.n; await put(zipInfo(st)); st.stack.pop(); }
      else if (top.t === "endentry") { await z.end(); st.stack.pop(); await ck(); }
      else if (top.t === "chan") { st.stack.pop(); st.used = []; const c = st.channels[top.i]; await resident(env, tid, c.slug).bind(tid, c.slug, String(c.id)); st.stack.push(...channelSteps(st, top.i).reverse()); }
      else if (top.t === "rows") {
        if (!top.begun) { await put(top.open); top.begun = true; }
        const r = await fetchPage(env, st, top.src, top.cur);
        if (r.items.length) { let s = ""; for (const it of r.items) s += (top.n++ ? "," : "") + JSON.stringify(it); await put(s); }   // the whole page in one write
        if (r.next == null) { await put(top.close); st.stack.pop(); } else top.cur = r.next;
      }
      else if (top.t === "tasks") {   // each chat with its turns and their messages
        if (!top.begun) { await put(top.open); top.begun = true; }
        const R = resident(env, tid, top.slug);
        if (!top.loose) {
          const k = `${top.slug}:${top.cur}`; let page = pages.get(k);   // one page of chats is read once, however many chats are on it
          if (!page) { pages.clear(); page = await raw(env, st, { k: "sessions", slug: top.slug }, top.cur); pages.set(k, page); }
          if (top.i >= page.rows.length) { if (page.next == null) top.loose = true; else { top.cur = page.next; top.i = 0; } continue; }
          const s = page.rows[top.i++];
          await put((top.n++ ? "," : "") + `{"session":${JSON.stringify(s)},"turns":[`);
          st.stack.push({ t: "lit", s: "]}" }, { t: "rows", open: "", close: "", src: { k: "turns", slug: top.slug, sid: String(s.id) }, cur: 0, n: 0, begun: false });
        } else {
          if (await R.dxHasLooseTurns()) { await put((top.n++ ? "," : "") + `{"session":null,"turns":[`); st.stack.pop(); st.stack.push({ t: "lit", s: top.close }, { t: "lit", s: "]}" }, { t: "rows", open: "", close: "", src: { k: "turns", slug: top.slug, sid: null }, cur: 0, n: 0, begun: false }); }
          else { await put(top.close); st.stack.pop(); }
        }
      }
      else if (top.t === "copy") {
        const done = await copyFiles(env, st, z, p, { over, ck, due, now, mem });
        if (done === "pause") return await pause();
        st.stack.pop(); await ck();
      }
      else if (top.t === "readme") { await z.entry("README.txt", enc.encode(readme(st)), st.at); st.stack.pop(); await ck(); }
      else if (top.t === "finish") {
        await ck();   // the last state of this zip, in case finishing is interrupted after the upload is complete
        const r = await z.finish(); st.done.push({ n: st.curPart, size: r.size, entries: r.entries }); st.stack.pop();
        if (st.curPart >= st.nparts) break;
        st.curPart++; st.zip = {}; st.stack.push({ t: "finish" }, { t: "copy" }); z = await newZip().open(); await ck();   // the next zip
      }
      else throw new Error(`unknown export step ${top.t}`);
      if (over()) return await pause();
      if (due()) await ck();
    }
    await finalize(env, row, st.done, { now, send });
    return { done: true, size: st.done.reduce((n, x) => n + x.size, 0), parts: st.done.length, entries: st.done.reduce((n, x) => n + (x.entries || 0), 0), files: st.counts.files, missing: st.missing.length };
  } catch (e) {
    if (e?.canceled) { try { await z?.abort(); } catch {} await dropScratch(env, tid, id).catch(() => {}); return { canceled: true }; }
    console.log("export step failed", id, String(e?.message || e).slice(0, 200));
    await env.DB.prepare("UPDATE data_exports SET error=?, lease_until=0, updated_at=? WHERE id=? AND status='running'").bind(String(e?.message || e).slice(0, 300), now(), id).run().catch(() => {});
    return { error: String(e?.message || e).slice(0, 200) };
  }
}

// Every zip is complete: record them, drop the scratch objects, make the 72 hour links and email them. zips: [{ n, size }]
async function finalize(env, row, zips, { now, send }) {
  const fin = now(), exp = fin + EXPORT_TTL, size = zips.reduce((n, x) => n + x.size, 0);
  const u = await env.DB.prepare("UPDATE data_exports SET status='done', finished_at=?, bytes=?, expires_at=?, lease_until=0, updated_at=?, error=NULL WHERE id=? AND status='running' RETURNING 1 x").bind(fin, size, exp, fin, row.id).first();
  if (!u) return false;
  await dropScratch(env, row.tenant_id, row.id);
  for (const zp of [...zips].sort((a, b) => a.n - b.n)) await makeLink(env, row, zp, zips.length, fin, exp);
  await notify(env, row.id, { send }).catch((e) => console.log("export email", e?.message));
  return true;
}

// What the copy step needs memory for, by part size: files read ahead (whole, when small), and the windows of a big file read in ranges at the same time.
const memPlan = (part) => (part >= 64 * MIB ? { small: 2 * MIB, ahead: 8 * MIB, chunk: 4 * MIB, win: 2 } : { small: 4 * MIB, ahead: 16 * MIB, chunk: 8 * MIB, win: 2 });
const AHEAD_FILES = 16;
// The bytes of an object from `from` to `size`, in order, read as several range requests at the same time (so a big file is not limited by one stream).
function rangeReader(env, key, from, size, { chunk, win }) {
  const q = []; let off = from;
  const fill = () => { while (q.length < win && off < size) {
    const o = off, len = Math.min(chunk, size - o); off += len;
    const pr = (async () => { const x = await env.WS.get(key, { range: { offset: o, length: len } }); if (!x) throw new Error("a file could not be read"); const b = new Uint8Array(await x.arrayBuffer()); if (b.length !== len) throw new Error("a file could not be read completely"); return b; })();
    pr.catch(() => {}); q.push(pr);
  } };
  fill();
  return { async next() { if (!q.length) return null; const b = await q.shift(); fill(); return b; } };
}
// The files: every manifest entry of the current zip in order, byte for byte. A restart in the middle of a file continues from the bytes already written.
// The zip is always written in manifest order. The reading is what overlaps: the next small files are fetched while the current one is written, and a big file is read in
// several ranges at once. → "done" (every entry of this zip is in) | "pause"
async function copyFiles(env, st, z, p, { over, ck, due, now, mem: memOpt }) {
  const mem = memOpt || memPlan(z.part); let lines = null, lineSeg = 0; const pf = new Map(); let pfBytes = 0;
  const partOf = (e) => e.part || 1;
  const readyAhead = (from) => {   // start reading the next small files of this zip
    for (let j = from + 1; j < Math.min(lines.length, from + 1 + AHEAD_FILES); j++) {
      const e = lines[j]; if (partOf(e) !== st.curPart) break; if (pf.has(j)) continue;
      const sz = Number(e.size) || 0; if (sz > mem.small) continue; if (pfBytes + sz > mem.ahead) break;
      pfBytes += sz;
      const pr = (async () => { const o = await env.WS.get(e.key, { range: { offset: 0, length: mem.small + 1 } }); if (!o) return { missing: true }; if (o.size > mem.small) return { big: true }; return { data: new Uint8Array(await o.arrayBuffer()) }; })().catch((x) => ({ failed: x }));
      pf.set(j, { pr, sz });
    }
  };
  const takeAhead = async (j) => { const a = pf.get(j); if (!a) return null; pf.delete(j); const r = await a.pr; pfBytes -= a.sz; return r; };
  try {
    for (;;) {
      if (st.copy.seg > st.mfSegs) {   // entries still waiting to be saved
        if (!st.mfBuf.length) return "done"; await ck(); continue;
      }
      if (lineSeg !== st.copy.seg) { lines = (await readText(env, `${p}/mf-${st.copy.seg}`) || "").split("\n").filter(Boolean).map((l) => JSON.parse(l)); lineSeg = st.copy.seg; pf.clear(); pfBytes = 0; }
      if (st.copy.idx >= lines.length) { st.copy.seg++; st.copy.idx = 0; continue; }
      const idx = st.copy.idx, e = lines[idx], open = z.state.cur;
      if (partOf(e) !== st.curPart) return "done";   // the rest of the manifest is for the next zip
      if (open && open.name !== e.path) throw new Error("export is out of step");
      readyAhead(idx);
      let got = await takeAhead(idx); if (open) got = null;
      if (got?.missing) { st.missing.push(e.path); st.copy.idx++; continue; }
      if (got?.data) { await z.begin(e.path, e.at); await z.write(got.data); await z.end(); st.copy.idx++; if (over()) { await ck(); return "pause"; } if (due()) await ck(); continue; }
      const head = await env.WS.head(e.key).catch(() => null);
      if (!head) {
        if (open) throw new Error("a file went missing while it was being copied");
        st.missing.push(e.path); st.copy.idx++; continue;
      }
      if (!open) await z.begin(e.path, e.at);
      const from = z.state.cur.len;
      if (from < head.size) {
        const rd = rangeReader(env, e.key, from, head.size, mem);
        for (let b; (b = await rd.next());) {
          await z.write(b); readyAhead(idx);
          if (over()) { await ck(); return "pause"; }
          if (due()) await ck();
        }
      }
      await z.end(); st.copy.idx++;
      if (over()) { await ck(); return "pause"; }
      if (due()) await ck();
    }
  } finally { pf.clear(); }
}
function readme(st) {
  const miss = st.missing.length ? `\nFiles that were listed but no longer in storage when the export ran (${st.missing.length}):\n${st.missing.map((x) => `  ${x}`).join("\n")}\n` : "";
  const many = st.nparts > 1, names = Array.from({ length: st.nparts }, (_, k) => dlName(st.at, k + 1, st.nparts));
  const split = many ? `
This export is in ${st.nparts} zip files because it is large. Open all of them to get everything.
  ${names.join("\n  ")}
  This is part 1. It holds export.json, this README and the first files. Each of the other parts holds more files, in the same folders. In export.json every
  file has a "part" number that says which zip holds it, and "zip_parts" at the end lists the zips.
` : "";
  return `Your 1Helm export

Made on ${new Date(st.at).toUTCString()} for the workspace ${st.tenant.slug}.
${split}
What is in ${many ? "part 1" : "this zip"}
  export.json   All of your text in one JSON document, as it is stored: your profile and settings, your channels, every task with all its messages, your
                Notebook, memory facts, contacts and the facts about them, schedules, live notes text, Bee conversation text, purchase records, share
                links and the details of every file (name, type, size, dates, channel, the path of the file and the number of the zip that holds it).
  files/        ${many ? "The first pictures, PDFs, recordings and other files you stored" : "Every picture, PDF, recording and other file you stored"}, copied byte for byte, in one folder for each channel. Each file in export.json has
                a "path" that points to its copy ${many ? "in the zip named by its \"part\"" : "here"}.

What is left out on purpose
  Saved keys, the vault, saved logins, API keys, connection and sign-in tokens, payment or card details, sign-in sessions and codes, the helper's
  computer disk and the memory vectors (search data made from your memory facts).

This file holds personal data, so keep it somewhere safe.
${miss}`;
}
async function makeLink(env, row, zp, total, at, exp) {
  await ensureLinkTable(env);
  const lid = crypto.randomUUID(), salt = rand(16);
  await env.DB.prepare("INSERT INTO download_links (id,token_hash,salt,tenant_id,user_id,kind,channel,file_id,r2key,name,mime,bytes,created_at,expires_at) VALUES (?,?,?,?,?,'export',NULL,?,?,?,?,?,?,?)")
    .bind(lid, await tokenHash(await linkToken(env, lid, salt)), salt, row.tenant_id, row.user_id ? String(row.user_id) : null, row.id, zipKeyN(row.tenant_id, row.id, zp.n), dlName(row.started_at || at, zp.n, total), "application/zip", zp.size, at, exp).run();
}
// Email the link (once). Test accounts get no email; their link comes from the status route.
export async function notify(env, id, { send = sendMail } = {}) {
  const r = await env.DB.prepare("SELECT * FROM data_exports WHERE id=? AND status='done' AND notified=0 AND expires_at>?").bind(id, Date.now()).first(); if (!r) return false;
  const t = await env.DB.prepare("SELECT id, slug, host_ready FROM tenants WHERE id=?").bind(r.tenant_id).first(), u = await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(r.user_id).first();
  if (!t || !u) return false;
  if (!isTestAddr(env, u.email)) {
    let links = await linksOf(env, t, r.id);
    const zs = await zipsOf(env, r.tenant_id, r.id);
    if (zs.length && links.length !== zs.length) {   // a restart after "done" and before the links: make them again (nothing was sent yet)
      await env.DB.prepare("DELETE FROM download_links WHERE tenant_id=? AND kind='export' AND file_id=?").bind(r.tenant_id, r.id).run();
      for (const zp of zs) await makeLink(env, r, zp, zs.length, Number(r.finished_at), Number(r.expires_at)); links = await linksOf(env, t, r.id);
    }
    if (!links.length) return false; await send(env, { to: u.email, ...readyEmail(env, links, Number(r.expires_at)) }); }
  await env.DB.prepare("UPDATE data_exports SET notified=1 WHERE id=?").bind(id).run(); return true;
}

// ---------------------------------------------------------------- cleaning up ----------------------------------------------------------------
async function listObjs(env, prefix) { const out = []; let cursor; do { const l = await env.WS.list({ prefix, cursor, limit: 1000 }); out.push(...(l.objects || [])); cursor = l.truncated ? l.cursor : null; } while (cursor); return out; }
async function listAll(env, prefix) { return (await listObjs(env, prefix)).map((o) => o.key); }
// The scratch objects of one export (everything but the zip).
async function dropScratch(env, tid, id) { const keys = await listAll(env, `${prefixOf(tid, id)}/`); if (keys.length) await stDelete(env, keys); }
// Every zip, the scratch objects, an unfinished upload and the download links of one export.
async function dropExport(env, r) {
  const tid = r.tenant_id, p = prefixOf(tid, r.id);
  if (r.status === "pending" || r.status === "running") {
    const s = Number(r.seq) ? jp(await readText(env, `${p}/state-${r.seq}`).catch(() => null), null) : null;
    if (s?.zip?.uploadId) { try { await env.WS.resumeMultipartUpload(zipKeyN(tid, r.id, s.curPart || 1), s.zip.uploadId).abort(); } catch {} }
  }
  await dropScratch(env, tid, r.id);
  const zips = (await zipsOf(env, tid, r.id).catch(() => [])).map((x) => x.key); await stDelete(env, [...new Set([zipKey(tid, r.id), ...zips])]).catch(() => {});   // every part
  await env.DB.prepare("DELETE FROM download_links WHERE tenant_id=? AND kind='export' AND file_id=?").bind(tid, r.id).run().catch(() => {});
}
// Deleting a channel or the account (deletion.js): running exports are stopped and finished zips are deleted, because they hold what is being deleted. → how many
export async function exportsGone(env, tenantId, { all = false } = {}) {
  await ensureTables(env);
  const rows = (await env.DB.prepare("SELECT * FROM data_exports WHERE tenant_id=? AND status IN ('pending','running','done')").bind(tenantId).all()).results || [];
  for (const r of rows) {
    await env.DB.prepare("UPDATE data_exports SET status=?, lease_until=0, expires_at=NULL, updated_at=? WHERE id=?").bind(r.status === "done" ? "deleted" : "canceled", Date.now(), r.id).run();
    await dropExport(env, r);
  }
  // Anything under the account's export prefix that no row knows (a crash between steps): gone too.
  const rest = await listAll(env, `exports/${tenantId}/`); if (rest.length) await stDelete(env, rest);
  await env.DB.prepare("DELETE FROM data_export_codes WHERE tenant_id=?").bind(tenantId).run().catch(() => {});
  if (all) await env.DB.prepare("DELETE FROM data_exports WHERE tenant_id=?").bind(tenantId).run().catch(() => {});
  return rows.length + rest.length;
}

// ---------------------------------------------------------------- the continuous job ----------------------------------------------------------------
// One ExportRunner Durable Object per account (data-export-runner.js) keeps an alarm armed while the account has a pending or running export. Each alarm runs one slice of
// the job (ALARM_BUDGET_MS), and the next alarm is set for right after it, so the job runs from start to finish without gaps. Only one slice can run at a time: the object
// handles one alarm at a time, and runExport takes the job's lease first (a second runner finds it taken and does nothing).
export async function armRunner(env, tid) { const r = env.EXPORT_RUNNER.get(env.EXPORT_RUNNER.idFromName(`export:${tid}`)); await r.kick(tid); return true; }
// Starting an export: arm the runner (the job starts at once, and no request has to stay open for it). Without a runner (tests, an older setup) the first minutes run here.
export async function kick(env, tid, id, { send } = {}) {
  if (env.EXPORT_RUNNER) return armRunner(env, tid);
  return runExport(env, id, { budgetMs: KICK_BUDGET_MS, send });
}
// One slice for an account (called by the runner's alarm). → { again } milliseconds until the next slice, or null when there is nothing left to run
export async function exportAlarm(env, tid, { now = Date.now, budgetMs = ALARM_BUDGET_MS, send = sendMail, part, maxParts, mem } = {}) {
  await ensureTables(env);
  const at = now(), rows = (await env.DB.prepare("SELECT id, requested_at, lease_until FROM data_exports WHERE tenant_id=? AND status IN ('pending','running')").bind(tid).all()).results || [];
  let again = null; const ran = [];
  for (const r of rows) {
    if (at - Number(r.requested_at) > EXPORT_MAX_AGE) continue;   // the cron gives it up
    const res = await runExport(env, r.id, { budgetMs, now, send, part, maxParts, mem }); ran.push(res);
    const wait = res.paused ? 0 : res.skipped ? Math.min(60e3, Math.max(1e3, Number(r.lease_until) - at + 1e3)) : res.error ? 120e3 : null;   // a stalled one is tried again in 2 minutes
    if (wait != null) again = again == null ? wait : Math.min(again, wait);
  }
  return { again, ran };
}

// ---------------------------------------------------------------- the cron (every 5 min, index.js) ----------------------------------------------------------------
export async function exportCron(env, { now = Date.now, budgetMs = CRON_BUDGET_MS, send = sendMail } = {}) {
  await ensureTables(env);
  const at = now(), out = { ran: 0, expired: 0, failed: 0, notified: 0 };
  // Jobs that no process holds: carry on.
  const due = (await env.DB.prepare("SELECT id, tenant_id, requested_at FROM data_exports WHERE status IN ('pending','running') AND lease_until<? ORDER BY updated_at LIMIT 3").bind(at).all()).results || [];
  const give = [], run = [], arm = [];
  for (const r of due) (at - Number(r.requested_at) > EXPORT_MAX_AGE ? give : env.EXPORT_RUNNER ? arm : run).push(env.EXPORT_RUNNER && at - Number(r.requested_at) <= EXPORT_MAX_AGE ? r.tenant_id : r.id);
  for (const id of give) {
    const r = await env.DB.prepare("UPDATE data_exports SET status='failed', error='did not finish in 7 days', lease_until=0, updated_at=? WHERE id=? AND status IN ('pending','running') RETURNING *").bind(at, id).first();
    if (r) { await dropExport(env, { ...r, status: "running" }); out.failed++;
      try { const u = await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(r.user_id).first(); if (u && !isTestAddr(env, u.email)) await send(env, { to: u.email, ...failedEmail(env) }); } catch (e) { console.log("export failed email", e?.message); } }
  }
  // The safety net: a job that no process holds (a stalled or never started runner) gets its runner armed again, and the runner carries on right away.
  const res = await Promise.allSettled([...run.map((id) => runExport(env, id, { budgetMs, now, send })), ...[...new Set(arm)].map((tid) => armRunner(env, tid))]); out.ran = res.length;
  // A finished export whose email did not go out: try again.
  for (const r of (await env.DB.prepare("SELECT id FROM data_exports WHERE status='done' AND notified=0 AND expires_at>? LIMIT 5").bind(at).all()).results || []) { try { if (await notify(env, r.id, { send })) out.notified++; } catch (e) { console.log("export email retry", e?.message); } }
  // 72 hours are up: the zip and the link go.
  for (const r of (await env.DB.prepare("SELECT * FROM data_exports WHERE status='done' AND expires_at<=? LIMIT 20").bind(at).all()).results || []) {
    await dropExport(env, r); await env.DB.prepare("UPDATE data_exports SET status='expired', updated_at=? WHERE id=?").bind(at, r.id).run(); out.expired++;
  }
  await env.DB.prepare("DELETE FROM data_export_codes WHERE expires_at<?").bind(at - 3600e3).run().catch(() => {});
  return out;
}
