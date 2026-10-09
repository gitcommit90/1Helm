// Work log (Captain, 10-06): an index of every lookup in outside data, written the moment each tool returns.
// Why: a brain-dump demo ran 3 email tasks ~36 steps each across 9 inboxes and was cut off by a redeploy. Nothing they found was
// kept (Hindsight only gets a finished turn), so the next try would redo all of it. Now:
// 1. Every read of outside data (gmail_search/read, calendar_events, read-only app_run actions, fetch_url, browser_task) writes one
//    work_log row right after the tool returns: when, channel/task/turn, tool, account, the normalized query + date range, status,
//    and a structured summary (count + top hits: id, subject/title, date, who, a few words). No model call; a stopped or cut-off
//    turn keeps every row it wrote.
// 2. Reuse before redoing (skipped with fresh: true):
//    - an email search with the same words in the same account within 24 h, whose date range the earlier search covered, only
//      fetches mail newer than that search (Gmail after:<epoch>), and says so: "Already searched <account> for '<q>' at <time>:
//      N results (…). Showing only messages newer than that."
//    - the same message read, the same calendar listing, the same web page or the same app read inside its window comes back from
//      the saved copy, with a note saying when it was fetched;
//    - a similar (not identical) earlier lookup is named in a note, and the new one runs in full.
//    Notes ride in ctx.wlNotes and go in front of the result, outside the untrusted-content wrapper.
// 3. Big app_run results are trimmed to their key fields (lean.js); the full result stays in work_log_full, opened by key.
//    app_proxy GETs (the app's own API, stage 3) are logged, reused and trimmed the same way, family app:proxy:<app>.
// 4. work_log tool: search/list earlier lookups by words, account, tool, time; open a saved result by key.
// 5. relevantLookups: the 3 most relevant recent lookups, one line each, for the per-message memory pack.
// 6. retainPartial(session, turn): a turn that ended without a reply (restart, Stop, a cap) leaves a short memory item built from
//    its rows ("Searched X, Y for Z; found …"), in Hindsight and the local ledger, and as that turn's hand-off notes.
import { pickAccount } from "./ee/index.js";
import { leanJSON, readMail, clip } from "./ee/index.js";
import { scrubSecrets } from "./secrets-scrub.js";   // nosecrets: summaries never keep a password, key or code (a "your code is 482913" email)

export const WL_DDL = `CREATE TABLE IF NOT EXISTS work_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, channel TEXT, session TEXT, turn TEXT,
    tool TEXT NOT NULL, family TEXT NOT NULL, app TEXT, account TEXT, query TEXT, terms TEXT, args TEXT, date_from INTEGER, date_to INTEGER,
    status TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, max INTEGER, hits TEXT, chars INTEGER, base INTEGER, note TEXT);
  CREATE INDEX IF NOT EXISTS work_log_fam ON work_log(family, account, at);
  CREATE INDEX IF NOT EXISTS work_log_turn ON work_log(turn);
  CREATE TABLE IF NOT EXISTS work_log_full (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS work_log_partial (turn TEXT PRIMARY KEY, at INTEGER NOT NULL, session TEXT, text TEXT)`;
export function worklogInit(sql) { sql.exec(WL_DDL); }

const H = 3600e3;
export const WINDOW = { email: 24 * H, calendar: 1 * H, web: 1 * H, app: 6 * H, browser: 0, live: H / 4 };   // live: search_web_vertical (prices move)
export const APP_LEAN_CHARS = 6000;   // an app_run result over this is trimmed to its key fields
const FULL_KEEP = 300, FULL_MAX = 300000;
const LOOKUP_TOOLS = new Set(["gmail_search", "gmail_read", "calendar_events", "app_run", "app_proxy", "fetch_url", "web_search", "search_web_vertical"]);
export const isLookupTool = (name) => LOOKUP_TOOLS.has(name);
const SAVED_FILES = / ok[^\n]*\. Saved "[^"\n]+" \([^)]*\) to the Library \(file id /;
const FRESH = { type: "boolean", description: "true = run it again in full even if the work log has this lookup (only when the person asks to re-check, or the earlier result is clearly stale)" };
// The fresh flag on the lookup tools (added in place, like composio.js's account param, so the definitions stay where they are).
export function addFresh(tools) { for (const t of tools) if (LOOKUP_TOOLS.has(t?.function?.name) && t.function.parameters?.properties) t.function.parameters.properties.fresh = FRESH; return tools; }

// ---- what a call looks up ----
export const READ_ACT = /(^|_)(SEARCH|LIST|FETCH|GET|FIND|QUERY|READ|RETRIEVE|LOOKUP|DOWNLOAD)(_|$)/;   // DOWNLOAD: stage 4, a file saved to the Library gets its row
const EMAIL_SEARCH_ACT = /^(GMAIL|GOOGLESUPER)_(FETCH_EMAILS|LIST_MESSAGES|LIST_THREADS|SEARCH\w*)$/;
const EMAIL_READ_ACT = /^(GMAIL|GOOGLESUPER)_(FETCH_MESSAGE_BY_MESSAGE_ID|FETCH_MESSAGE_BY_THREAD_ID|GET_MESSAGE)$/;
const CAL_LIST_ACT = /^(GOOGLECALENDAR|GOOGLESUPER)_(EVENTS_LIST|LIST_EVENTS|FIND_EVENT)\w*$/;
const APP_NAMES = { gmail: "Gmail", googlecalendar: "Google Calendar", googlesuper: "Google", googledrive: "Google Drive", outlook: "Outlook", slack: "Slack", notion: "Notion", github: "GitHub" };
const appOfAction = (act, conns = []) => { const low = String(act || "").toLowerCase();
  return [...new Set(conns.map((c) => c.app))].filter((s) => low.startsWith(`${s}_`)).sort((a, b) => b.length - a.length)[0] || low.split("_")[0]; };
const accountOf = (conns, app, want) => { if (!app) return ""; try { const p = pickAccount(conns || [], app, want); return p.acct?.label || p.acct?.email || String(want || ""); } catch { return String(want || ""); } };
const str = (x) => String(x ?? "").trim();
const stable = (v) => v == null || typeof v !== "object" ? v : Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
export function normUrl(u) { try { const x = new URL(String(u)); x.hash = ""; let s = x.toString(); if (x.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1); return s; } catch { return str(u); } }
// → { tool, kind, family, app, account, query, max, from, to, delta(q) } or null when the call isn't a lookup.
export function lookupSpec(name, a = {}, conns = []) {
  if (name === "gmail_search") return { tool: name, kind: "email", family: "email.search:gmail", app: "gmail", account: accountOf(conns, "gmail", a.account), query: str(a.query), max: Math.max(1, Math.min(25, Number(a.max) || 10)), delta: (q) => ({ ...a, query: q }) };
  if (name === "gmail_read") return { tool: name, kind: "email", family: "email.read:gmail", app: "gmail", account: accountOf(conns, "gmail", a.account), query: str(a.id), exact: true };
  if (name === "calendar_events") return { tool: name, kind: "calendar", family: "calendar:googlecalendar", app: "googlecalendar", account: accountOf(conns, "googlecalendar", a.account), query: str(a.search), from: Date.parse(a.from) || null, to: Date.parse(a.to) || null, key: JSON.stringify([str(a.from), str(a.to), str(a.search).toLowerCase(), Number(a.max) || 25]), exact: true };
  if (name === "web_search") { const q = String(a.query ?? "").replace(/\s+/g, " ").trim().slice(0, 400), n = Math.max(1, Math.min(10, Math.round(Number(a.count)) || 5));
    return { tool: name, kind: "web", family: "web.search", app: "", account: "", query: q, exact: true, key: JSON.stringify([q.toLowerCase(), n, String(a.freshness || ""), String(a.region || "").toLowerCase()]) }; }   // websearch.js
  if (name === "search_web_vertical") {   // vertical-search.js: the same live search again within 15 minutes is the saved copy
    const { fresh, step_title, ...rest } = a || {}, kind = str(rest.kind).toLowerCase();
    return { tool: name, kind: "live", family: `web.vertical:${kind}`, app: "", account: "", query: clip([rest.query, rest.from && `${rest.from}→${rest.to || "?"}`, rest.near && `near ${rest.near}`, rest.date, rest.check_in && `${rest.check_in}–${rest.check_out || "?"}`].filter(Boolean).join(" "), 300), key: JSON.stringify(stable(rest)), exact: true };
  }
  if (name === "fetch_url") return { tool: name, kind: "web", family: "web.fetch", app: "", account: "", query: normUrl(a.url), exact: true, ...(a.raw === true ? { key: JSON.stringify([normUrl(a.url), "raw"]) } : {}) };
  if (name === "browser_task") return { tool: name, kind: "browser", family: "web.browser", app: "", account: "", query: clip(`${a.url ? `${a.url} ` : ""}${a.task || ""}`, 400), logOnly: true };
  if (name === "app_proxy") {   // composio.js runProxy: a GET on the app's own API is a lookup (family per app); a write isn't logged, like app_run's
    if (String(a.method || "GET").toUpperCase() !== "GET") return null;
    const app = str(a.app).toLowerCase().replace(/[^a-z0-9_]/g, ""); if (!app) return null;
    const q = a.query && typeof a.query === "object" ? stable(a.query) : {}, qs = Object.entries(q).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("&");
    return { tool: name, kind: "app", family: `app:proxy:${app}`, app, account: accountOf(conns, app, a.account), query: clip(`GET ${str(a.path)}${qs ? `?${qs}` : ""}`, 300), key: JSON.stringify([str(a.path), q]), exact: true };
  }
  if (name !== "app_run") return null;
  const act = str(a.action).toUpperCase().replace(/[^A-Z0-9_]/g, ""); if (!act || !READ_ACT.test(act)) return null;
  const app = appOfAction(act, conns), args = a.arguments && typeof a.arguments === "object" ? a.arguments : {}, account = accountOf(conns, app, a.account);
  if (EMAIL_SEARCH_ACT.test(act)) return { tool: name, action: act, kind: "email", family: "email.search:gmail", app, account, query: str(args.query ?? args.q), max: Number(args.max_results) || null, delta: (q) => ({ ...a, arguments: { ...args, ...("q" in args && !("query" in args) ? { q } : { query: q }) } }) };
  if (EMAIL_READ_ACT.test(act)) return { tool: name, action: act, kind: "email", family: "email.read:gmail", app, account, query: str(args.message_id ?? args.thread_id ?? args.id), exact: true, read: true };
  const key = JSON.stringify(stable(args));
  if (CAL_LIST_ACT.test(act)) return { tool: name, action: act, kind: "calendar", family: "calendar:googlecalendar", app, account, query: str(args.q ?? args.query), from: Date.parse(args.timeMin) || null, to: Date.parse(args.timeMax) || null, key, exact: true };
  return { tool: name, action: act, kind: "app", family: `app:${act}`, app, account, query: clip(Object.values(args).filter((v) => typeof v !== "object").join(" ") || key, 300), key, exact: true };
}

// ---- query words and date ranges (Gmail syntax) ----
const DATE_OP = /^-?(after|before|newer|older|newer_than|older_than):/i;
const STOP = new Set(["the", "and", "for", "with", "that", "this", "any", "all", "my", "me", "of", "to", "in", "on", "a", "an", "is", "are", "was", "were", "about", "at", "by",
  "what", "when", "where", "which", "who", "how", "did", "does", "do", "can", "could", "you", "your", "please", "find", "check", "tell", "remind", "show", "get", "look", "see", "it", "its", "there", "from", "again", "know"]);
export function termsOf(q) {
  return [...new Set(String(q || "").toLowerCase().replace(/[()"{}]/g, " ").split(/\s+/).map((w) => w.replace(/^[,.;]+|[,.;]+$/g, "")).filter((w) => w && !DATE_OP.test(w) && !STOP.has(w)))].sort();
}
const UNIT = { d: 864e5, h: 36e5, m: 30 * 864e5, y: 365 * 864e5, w: 7 * 864e5 };
const dateArg = (v) => { if (/^\d{9,11}$/.test(v)) return Number(v) * 1000; const m = v.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
// The absolute window a Gmail query asks for, read at time `at`. null ends = unbounded.
export function gmailRange(q, at) {
  let from = null, to = null;
  for (const t of String(q || "").split(/\s+/)) {
    const m = t.match(/^(after|before|newer|older|newer_than|older_than):(\S+)$/i); if (!m) continue;
    const op = m[1].toLowerCase(), v = m[2];
    let ms = null;
    if (op.endsWith("_than")) { const r = v.match(/^(\d+)([dhmyw])$/i); if (r) ms = at - Number(r[1]) * UNIT[r[2].toLowerCase()]; }
    else ms = dateArg(v);
    if (ms == null) continue;
    if (op === "after" || op === "newer" || op === "newer_than") from = from == null ? ms : Math.max(from, ms);
    else to = to == null ? ms : Math.min(to, ms);
  }
  return { from, to };
}
const jacc = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; const u = A.size + B.size - i; return u ? i / u : 1; };

// ---- notes and formatting ----
export function fmtTime(ms, tz) { try { return new Date(ms).toLocaleString("en-US", { timeZone: tz || "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); } }
const ago = (ms, now) => { const m = Math.round((now - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const where = (r) => r.account ? `${r.account}${r.app && APP_NAMES[r.app] ? ` (${APP_NAMES[r.app]})` : r.app ? ` (${r.app})` : ""}` : r.app ? (APP_NAMES[r.app] || r.app) : "";
const hitText = (h) => `${h.title ? `"${clip(h.title, 70)}"` : h.id ? `id ${clip(h.id, 40)}` : ""}${h.date ? ` ${shortDate(h.date)}` : ""}${h.who ? ` from ${clip(String(h.who).replace(/\s*<[^>]*>?/g, "") || h.who, 40)}` : ""}`.trim();
function shortDate(d) { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : clip(d, 20); }
const parseHits = (r) => { try { return JSON.parse(r.hits || "[]"); } catch { return []; } };
// "Searched work@x.com (Gmail) for "columbia trip": 12 results — "Flight confirmation" 2026-10-02 from Delta; …"
export function rowLine(r, { hits = 3, tz } = {}) {
  const verb = r.family.startsWith("email.search") ? `Searched ${where(r)} for "${clip(r.query, 120)}"` : r.family.startsWith("email.read") ? `Read message ${clip(r.query, 40)} in ${where(r)}`
    : r.family.startsWith("calendar") ? `Checked ${where(r)}${r.query ? ` for "${clip(r.query, 60)}"` : ""}${r.date_from ? ` ${shortDate(new Date(r.date_from).toISOString())}–${r.date_to ? shortDate(new Date(r.date_to).toISOString()) : ""}` : ""}`
    : r.family.startsWith("app:proxy:") ? `Called the ${APP_NAMES[r.app] || r.app} API${r.account ? ` in ${where(r)}` : ""} (${clip(r.query, 120)})`
    : r.family.startsWith("web.vertical:") ? `Live search (${r.family.slice(13)}) for "${clip(r.query, 120)}"`
    : r.family === "web.search" ? `Searched the web for "${clip(r.query, 120)}"` : r.family === "web.fetch" ? `Fetched ${clip(r.query, 160)}` : r.family === "web.browser" ? `Browser task: ${clip(r.query, 160)}` : `Ran ${r.family.slice(4)}${r.account ? ` in ${where(r)}` : ""} (${clip(r.query, 100)})`;
  const hs = parseHits(r).slice(0, hits).map(hitText).filter(Boolean);
  const res = r.status === "error" ? `error${r.note ? `: ${clip(r.note, 120)}` : ""}` : r.status === "empty" ? "nothing found" : `${r.count} result${r.count === 1 ? "" : "s"}${r.max && r.count >= r.max ? ` (hit its limit of ${r.max})` : ""}`;
  return `${verb}: ${res}${hs.length ? ` — ${hs.join("; ")}` : ""}${tz !== undefined ? ` [${fmtTime(r.at, tz)}, key wl${r.id}]` : ""}`;
}
const note = (ctx, s) => { if (ctx) (ctx.wlNotes ||= []).push(s); };
// The notes for this call, to go in front of its result (outside the untrusted wrapper). Clears them.
export function wlNotes(ctx) { const n = ctx?.wlNotes || []; if (ctx) ctx.wlNotes = []; return n.length ? `${n.join("\n")}\n` : ""; }

// ---- summary from the structured result (no model call) ----
const pick = (o, ks) => { for (const k of ks) { const v = o?.[k]; if (v != null && v !== "") return typeof v === "object" ? (v.dateTime || v.date || v.email || v.name || v.displayName || v.login || "") : v; } return ""; };
const hitOf = (o) => !o || typeof o !== "object" ? { title: clip(o, 100) } : {
  id: clip(pick(o, ["id", "messageId", "uid", "key", "threadId", "number", "url", "link", "html_url", "permalink"]), 80),
  title: clip(pick(o, ["subject", "title", "name", "summary", "full_name", "filename", "text"]), 100),
  date: clip(pick(o, ["date", "messageTimestamp", "start", "created_at", "createdAt", "created", "updated_at", "modifiedTime", "timestamp", "ts", "time", "due"]), 30),
  who: clip(pick(o, ["from", "sender", "organizer", "author", "owner", "user", "email", "creator"]), 60),
  words: clip(pick(o, ["snippet", "preview", "description", "body", "text", "messageText", "notes"]), 60) };
function mainList(v, d = 0) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object" || d > 3) return null;
  let best = null; for (const x of Object.values(v)) { const l = mainList(x, d + 1); if (l && (!best || l.length > best.length)) best = l; }
  return best;
}
const jsonIn = (s) => { const t = String(s || ""); const i = t.search(/[[{]/); if (i < 0) return null; const j = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]")); try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; } };
const compact = (h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v));
// → { status, count, hits, note } or null when the result isn't a lookup (not connected, needs asking first, refused).
export function summarize(sp, out) {
  const s = String(out ?? "");
  if (/^(NOT |ASK FIRST|COMPOSIO SIGN-IN ENDED)/.test(s)) return null;   // nothing ran (composio-self.js: Self-managed sign-in ended)
  if (/^error/i.test(s) || /^browser_task error/.test(s) || /^Web search is busy/.test(s)) return { status: "error", count: 0, hits: [], note: clip(s.replace(/^error:?\s*/i, ""), 200) };
  if (sp.family === "web.fetch") {
    const m = s.match(/^HTTP (\d+) \((\d+) chars/), code = Number(m?.[1] || 0), n = Number(m?.[2] || 0);
    const title = s.match(/<title[^>]*>([^<]{1,200})/i)?.[1] || s.match(/^title: "?([^"\n]{1,200})"?$/m)?.[1] || s.split("\n").slice(1).find((l) => l.trim()) || "";
    return { status: code >= 400 || !code ? "error" : n ? "ok" : "empty", count: n ? 1 : 0, hits: n ? [compact({ id: sp.query, title: clip(title, 100), words: `HTTP ${code}, ${n} chars` })] : [], note: code >= 400 ? `HTTP ${code}` : null };
  }
  if (sp.family === "web.browser") {
    const ok = /^browser_task (done|finished|complete)/i.test(s) || !/stopped|handed|error|fail/i.test(s.split("\n")[0]);
    const page = s.match(/\nPage: (.*) — (\S+)/), res = s.match(/Result[^:]*: ([\s\S]*?)\nPage:/)?.[1] || "";
    return { status: ok ? "ok" : "error", count: 1, hits: [compact({ id: page?.[2] || "", title: clip(page?.[1] || "", 100), words: clip(res, 160) })], note: ok ? null : clip(s.split("\n")[0], 160) };
  }
  const body = sp.tool === "app_run" || sp.tool === "app_proxy" ? s.slice(s.indexOf("\n") + 1) : s, v = jsonIn(body);
  if (v == null) return { status: s.trim() ? "ok" : "empty", count: s.trim() ? 1 : 0, hits: s.trim() ? [{ words: clip(body, 100) }] : [] };
  if (sp.family.startsWith("email.read")) { const m = v.messageId ? readMail(v) : v; return { status: "ok", count: 1, hits: [compact({ id: m.id || sp.query, title: clip(m.subject, 100), date: clip(m.date, 30), who: clip(m.from, 60), words: clip(m.text, 80) })] }; }
  const list = mainList(v) || (typeof v === "object" ? [v] : []);
  const hits = list.slice(0, sp.kind === "email" ? 25 : 10).map(hitOf).map(compact).filter((h) => Object.keys(h).length);
  return { status: list.length ? "ok" : "empty", count: list.length, hits };
}

// ---- the log itself ----
let inserts = 0;
function insertRow(res, ctx, sp, sum, extra = {}) {
  const now = extra.at ?? Date.now(); res.sql.exec(
    "INSERT INTO work_log (at,channel,session,turn,tool,family,app,account,query,terms,args,date_from,date_to,status,count,max,hits,chars,base,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    now, res.get?.("channel") ?? null, ctx?.session ?? null, ctx?.turn ?? null, sp.action || sp.tool, sp.family, sp.app || null, sp.account || "", scrubSecrets(sp.query || ""),
    termsOf(scrubSecrets(sp.query || "")).join(" "), scrubSecrets(String(extra.args || "")).slice(0, 1500), sp.from ?? extra.from ?? null, sp.to ?? extra.to ?? null, sum.status, sum.count || 0, sp.max ?? null,
    scrubSecrets(JSON.stringify(sum.hits || [])).slice(0, 8000), extra.chars ?? null, extra.base ?? null, sum.note ? scrubSecrets(sum.note) : null);
  const id = res.sql.exec("SELECT last_insert_rowid() AS id").toArray()[0]?.id;
  if (++inserts % 50 === 0) prune(res.sql, now);
  return id;
}
export function prune(sql, now = Date.now()) {
  sql.exec("DELETE FROM work_log WHERE at < ?", now - 90 * 864e5);
  sql.exec("DELETE FROM work_log_full WHERE at < ? OR id NOT IN (SELECT id FROM work_log_full ORDER BY id DESC LIMIT ?)", now - 7 * 864e5, FULL_KEEP);
}
const saveFull = (sql, id, body) => { if (id) sql.exec("INSERT OR REPLACE INTO work_log_full (id,at,body) VALUES (?,?,?)", id, Date.now(), String(body).slice(0, FULL_MAX)); };
export const savedBody = (sql, id) => sql.exec("SELECT body FROM work_log_full WHERE id=?", Number(id)).toArray()[0]?.body ?? null;
const recent = (sql, sp, since) => sql.exec("SELECT * FROM work_log WHERE family=? AND account=? AND at>=? AND status<>'error' ORDER BY id DESC LIMIT 60", sp.family, sp.account || "", since).toArray();

// The earlier lookup this one can reuse. → { row, mode: "delta" | "saved" | "similar" } or null.
export function findPrior(sql, sp, now = Date.now()) {
  const win = WINDOW[sp.kind] || 0; if (!win || sp.logOnly) return null;
  const rows = recent(sql, sp, now - win); if (!rows.length) return null;
  if (sp.exact) {
    const keyOf = (r) => { try { return JSON.parse(r.args || "{}").k ?? null; } catch { return null; } };
    const r = rows.find((x) => (sp.key != null ? keyOf(x) === sp.key : x.query === sp.query));
    if (r) return { row: r, mode: "saved" };
    if (sp.kind === "calendar" && sp.from != null) { const r = rows.find((x) => x.date_from != null && x.date_from < (sp.to ?? Infinity) && (x.date_to ?? Infinity) > sp.from); if (r) return { row: r, mode: "similar" }; }
    return null;
  }
  const t = termsOf(sp.query), rq = gmailRange(sp.query, now);
  for (const r of rows) {
    const rt = (r.terms || "").split(" ").filter(Boolean);
    if (rt.join(" ") !== t.join(" ")) continue;
    const covered = (r.date_from == null || (rq.from != null && rq.from >= r.date_from)) && (r.date_to == null || r.date_to >= Math.min(rq.to ?? Infinity, r.at));
    if (covered) return { row: r, mode: "delta" };
  }
  let best = null, bs = 0;
  for (const r of rows) { const j = jacc(t, (r.terms || "").split(" ").filter(Boolean)); if (j > bs) { bs = j; best = r; } }
  return best && bs >= 0.5 ? { row: best, mode: "similar" } : null;
}
// A delta chain (a delta search, the one before it, …): every hit seen so far, newest first, and the first search's time.
function chain(sql, row) {
  const rows = []; let r = row;
  for (let i = 0; r && i < 8; i++) { rows.push(r); r = r.base ? sql.exec("SELECT * FROM work_log WHERE id=?", r.base).toArray()[0] : null; }
  const seen = new Set(), hits = []; for (const x of rows) for (const h of parseHits(x)) { const k = h.id || h.title; if (k && !seen.has(k)) { seen.add(k); hits.push(h); } }
  return { rows, hits, total: rows.reduce((n, x) => n + (x.count || 0), 0), first: rows.at(-1), capped: rows.some((x) => x.max && x.count >= x.max) };
}

// Run a lookup with the work log around it. run(args) → the tool's raw text result. Returns the (possibly trimmed) result; any
// "already searched" note goes to ctx.wlNotes. Never throws because of the log: a log failure just runs the tool plainly.
export async function workLogged(res, ctx, name, a, run, conns = null) {
  let sp = null; try { sp = lookupSpec(name, a, conns || (await res.conns?.()) || []); } catch (e) { console.log("work log spec", e.message); }
  if (!sp) return run(a);
  const fresh = a.fresh === true, now = Date.now(), tz = res.tz?.() || "UTC";
  const args = { ...a }; delete args.fresh;
  let prior = null; if (!fresh) { try { prior = findPrior(res.sql, sp, now); } catch (e) { console.log("work log find", e.message); } }
  // Same message / listing / page / app read inside its window: the saved copy, no new call.
  if (prior?.mode === "saved") {
    const body = savedBody(res.sql, prior.row.id);
    if (body != null) {
      note(ctx, `[Work log] Already ${sp.family.startsWith("email.read") ? "read this message" : sp.family === "web.search" ? "ran this web search" : sp.kind === "live" ? "ran this live search" : sp.kind === "web" ? "fetched this page" : "ran this exact lookup"}${prior.row.account ? ` in ${where(prior.row)}` : ""} at ${fmtTime(prior.row.at, tz)} (${ago(prior.row.at, now)}); this is the saved result (key wl${prior.row.id}), nothing was fetched again. Pass fresh: true only if it may have changed since.`);
      return present(res, sp, body, prior.row.id);
    }
  }
  let callArgs = args, base = null;
  if (prior?.mode === "delta" && sp.delta) {
    const c = chain(res.sql, prior.row), afterSec = Math.floor(prior.row.at / 1000) - 120;
    callArgs = sp.delta(`${sp.query} after:${afterSec}`.trim()); base = prior.row.id;
    const ids = c.hits.slice(0, 12).map((h) => h.id).filter(Boolean);
    const top = c.hits.slice(0, 5).map(hitText).filter(Boolean);
    note(ctx, `[Work log] Already searched ${where(prior.row)} for '${clip(sp.query, 120)}' at ${fmtTime(prior.row.at, tz)}${c.rows.length > 1 ? ` (first at ${fmtTime(c.first.at, tz)})` : ""}: ${c.total} result${c.total === 1 ? "" : "s"}${ids.length ? ` (ids ${ids.join(", ")}${c.hits.length > ids.length ? ", …" : ""})` : ""}${top.length ? `; top: ${top.join("; ")}` : ""}. Showing only messages newer than that.${c.capped ? " That search stopped at its result limit, so older matches beyond those may exist: narrow the query, or pass fresh: true to search everything again." : " Pass fresh: true to search everything again."} work_log (key wl${prior.row.id}) lists the earlier results.`);
  } else if (prior?.mode === "similar") {
    note(ctx, `[Work log] A similar earlier lookup: ${rowLine(prior.row, { hits: 3 })} [at ${fmtTime(prior.row.at, tz)}, key wl${prior.row.id}]. This one ran in full.`);
  }
  const out = await run(callArgs);
  let id = null, kept = false;
  try {
    const sum = summarize(sp, out);
    if (sum) {
      const rq = sp.kind === "email" && !sp.exact ? gmailRange(sp.query, now) : {};
      const k = sp.key != null ? { k: sp.key } : {};
      id = insertRow(res, ctx, sp, sum, { args: JSON.stringify({ ...k, ...stable(args) }), chars: String(out).length, base, from: rq.from, to: rq.to, at: now });
      // A result that saved files to the Library (composio-files.js) is logged but never replayed: the file may be gone by then, so the
      // same download again runs again.
      if (sum.status !== "error" && !sp.logOnly && !SAVED_FILES.test(String(out).split("\n", 1)[0])) { saveFull(res.sql, id, out); kept = true; }
    }
  } catch (e) { console.log("work log write", e.message); }
  return present(res, sp, out, kept ? id : null);
}
// What the model sees: big app_run results trimmed to their key fields (the full one stays in work_log_full under its key).
function present(res, sp, out, id) {
  const s = String(out ?? "");
  if (/^(error|NOT |ASK FIRST)/.test(s)) return s;
  const app = sp.tool === "app_run" || sp.tool === "app_proxy" || /^\S.* ok[^\n]*:\n/.test(s), i = app ? s.indexOf("\n") : -1, head = i >= 0 ? s.slice(0, i) : "", body = i >= 0 ? s.slice(i + 1) : s;
  // One message read (either tool, fresh or saved): headers + the cleaned body only.
  if (sp.family.startsWith("email.read")) { const v = jsonIn(body); if (v?.messageId) { const t = JSON.stringify(readMail(v)); if (t.length < body.length) return head ? `${head}\n${t}` : t; } }
  if (!app) return s;
  if (body.length <= APP_LEAN_CHARS) return s;
  const l = leanJSON(body, APP_LEAN_CHARS);
  return `${head}\n${l.text}\n(Trimmed from ${body.length} to ${l.text.length} chars: key fields only.${id ? ` Full result saved: work_log with open "wl${id}" shows it.` : ""})`;
}
// browser_task: logged only (a browser job may act, so it's never replayed).
export function logBrowserTask(res, ctx, a, out) {
  try { const sp = lookupSpec("browser_task", a), sum = summarize(sp, out); if (sum) insertRow(res, ctx, sp, sum, { args: JSON.stringify(stable(a)).slice(0, 1500), chars: String(out).length }); }
  catch (e) { console.log("work log browser", e.message); }
}

// ---- the work_log tool ----
export const WORK_LOG_TOOL = { type: "function", function: { name: "work_log", description: "Your log of earlier lookups in this channel's outside data (email searches and reads, calendar, app reads, web pages, browser tasks): what was searched, in which account, when, and what came back (counts, ids, subjects, dates). Check it before searching again, and to pick up what an earlier or interrupted turn already found. Each row has a key; open a key to see that lookup's full saved result.", parameters: { type: "object", properties: {
  query: { type: "string", description: "words to look for in what was searched or found (optional; empty = newest first)" }, account: { type: "string", description: "only this account (label or email)" },
  tool: { type: "string", enum: ["email", "calendar", "web", "app", "browser"], description: "only this kind of lookup" }, since: { type: "string", description: "how far back, e.g. 24h, 7d, or a date (default 30d)" },
  limit: { type: "integer", description: "1–30, default 12" }, open: { type: "string", description: "a key from an earlier answer (e.g. wl12): show that lookup's full saved result" } } } } };
const FAM = { email: "email.%", calendar: "calendar%", web: "web.%", app: "app:%", browser: "web.browser" };
const sinceMs = (s, now) => { const m = String(s || "").trim().match(/^(\d+)\s*([hdwmy])/i); if (m) return now - Number(m[1]) * UNIT[m[2].toLowerCase()]; const t = Date.parse(String(s || "")); return Number.isFinite(t) ? t : now - 30 * 864e5; };
export function workLogTool(res, a = {}, ctx = {}) {
  const sql = res.sql, now = Date.now(), tz = res.tz?.() || "UTC";
  if (a.open) {
    const id = Number(String(a.open).replace(/^wl/i, "")); const r = sql.exec("SELECT * FROM work_log WHERE id=?", id).toArray()[0];
    if (!r) return `error: no work log entry ${a.open}`;
    const b = savedBody(sql, id);
    return `${rowLine(r, { hits: 5, tz })}\n${b == null ? "(The full result wasn't kept: it was an error, a browser task, or older than 7 days. Run the lookup again if you need it.)" : `Full saved result:\n${b.slice(0, 60000)}${b.length > 60000 ? `\n…(${b.length - 60000} more chars)` : ""}`}`;
  }
  const where_ = ["at >= ?"], args = [sinceMs(a.since, now)];
  if (a.tool && FAM[a.tool]) { where_.push("family LIKE ?"); args.push(FAM[a.tool]); if (a.tool === "web") where_.push("family <> 'web.browser'"); }
  if (a.account) { where_.push("lower(account) LIKE ?"); args.push(`%${String(a.account).toLowerCase()}%`); }
  const words = termsOf(a.query).filter((w) => w.length > 1).slice(0, 8);
  const rows = sql.exec(`SELECT * FROM work_log WHERE ${where_.join(" AND ")} ORDER BY id DESC LIMIT 400`, ...args).toArray();
  const hay = (r) => `${r.query} ${r.account} ${r.tool} ${r.hits}`.toLowerCase();
  const scored = rows.map((r) => ({ r, s: words.length ? words.filter((w) => hay(r).includes(w.replace(/^\w+:/, ""))).length : 1 })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || y.r.id - x.r.id).slice(0, Math.max(1, Math.min(30, Number(a.limit) || 12)));
  if (!scored.length) return words.length ? `No earlier lookups match "${a.query}"${a.account ? ` in ${a.account}` : ""}. Nothing in the work log, so search for real.` : "The work log is empty for that range.";
  return `${scored.length} earlier lookup${scored.length === 1 ? "" : "s"} (newest and best matches first; open a key for the full result):\n${scored.map(({ r }) => `- ${rowLine(r, { hits: r.family.startsWith("email.search") ? 5 : 3, tz })}${r.session && ctx.session && r.session !== ctx.session ? " (another task)" : ""}`).join("\n")}`;
}

// ---- memory: the most relevant recent lookups for a new message (one line each), and partial findings of an unfinished turn ----
export function relevantLookups(sql, text, { now = Date.now(), tz = "UTC", n = 3, days = 7 } = {}) {
  const words = termsOf(text).filter((w) => w.length >= 3 && !/:/.test(w)); if (!words.length) return "";
  let rows; try { rows = sql.exec("SELECT * FROM work_log WHERE at >= ? AND status IN ('ok','empty') ORDER BY id DESC LIMIT 300", now - days * 864e5).toArray(); } catch { return ""; }
  const seen = new Set(), out = [];
  // What was searched for counts double; words only in what came back count once.
  const scored = rows.map((r) => { const q = `${r.query} ${r.account}`.toLowerCase(), h = parseHits(r).map((x) => `${x.title || ""} ${x.who || ""}`).join(" ").toLowerCase();
    const s = words.reduce((n, w) => n + (q.includes(w) ? 2 : h.includes(w) ? 1 : 0), 0); return { r, s }; })
    .filter((x) => x.s >= Math.min(3, words.length * 2)).sort((x, y) => y.s - x.s || y.r.id - x.r.id);
  for (const { r } of scored) { const k = `${r.family}|${r.account}|${r.query}`; if (seen.has(k)) continue; seen.add(k); out.push(`- ${rowLine(r, { hits: 2, tz })}`); if (out.length >= n) break; }
  return out.join("\n");
}
export const LOOKUPS_HEADER = "(Earlier lookups from the work log that look related. Reuse them instead of searching again; work_log has the details:)";
// The short memory item for a turn that ended without a reply. null when the turn looked nothing up (or was already retained).
export function partialText(sql, turn, { userText = "", why = "interrupted", tz = "UTC" } = {}) {
  const rows = sql.exec("SELECT * FROM work_log WHERE turn=? ORDER BY id", String(turn)).toArray(); if (!rows.length) return null;
  const ok = rows.filter((r) => r.status !== "error"), bad = rows.length - ok.length;
  const lines = ok.slice(0, 30).map((r) => `- ${rowLine(r, { hits: r.family.startsWith("email.search") ? 4 : 2 })} [key wl${r.id}]`);
  const text = `Unfinished work (${why} before a reply, ${fmtTime(rows[0].at, tz)}).${userText ? ` The person had asked: ${clip(scrubSecrets(userText), 400)}` : ""}\nLookups already done (saved in the work log; reuse them, don't redo them):\n${lines.join("\n")}${ok.length > 30 ? `\n- …and ${ok.length - 30} more (work_log lists them)` : ""}${bad ? `\n(${bad} lookup${bad === 1 ? "" : "s"} failed.)` : ""}`;
  return scrubSecrets(text).slice(0, 5000);   // it becomes memory and the turn's hand-off notes
}
// Retain a stopped/interrupted/capped turn's partial findings: Hindsight (when on), the local memory ledger, and the turn's
// hand-off notes (so the task's history shows them next time). Once per turn. Safe to call from any stop path.
export async function retainPartial(res, session, turn, why = "stopped") {
  const sql = res.sql;
  if (sql.exec("SELECT 1 FROM work_log_partial WHERE turn=?", String(turn)).toArray().length) return null;
  const t = sql.exec("SELECT at, user_text, kind FROM turns WHERE id=?", String(turn)).toArray()[0];
  const text = partialText(sql, turn, { userText: t?.user_text || "", why, tz: res.tz?.() || "UTC" }); if (!text) return null;
  sql.exec("INSERT OR IGNORE INTO work_log_partial (turn,at,session,text) VALUES (?,?,?,?)", String(turn), Date.now(), session ?? null, text);
  try { sql.exec("UPDATE turns SET notes=COALESCE(notes, ?) WHERE id=?", text, String(turn)); } catch {}
  try { if (res.memoryMode?.() !== "off" && res.mem?.put) res.mem.put({ id: `t:${turn}:p`, at: Date.now(), kind: "note", author: "work log", source: `task ${String(session || "").slice(0, 8)} · unfinished work`, session: session ?? null, text }); } catch (e) { console.log("partial ledger", e.message); }
  try { await res.hsCapture?.([{ content: text, at: t?.at || Date.now(), context: `unfinished work in #${res.get?.("channel") || ""}`, document_id: `partial-${turn}`, metadata: { turn, session, kind: "partial" } }]); } catch (e) { console.log("partial hindsight", e.message); }
  return text;
}
// After recoverCards (a restart): every interrupted card that looked something up keeps what it found.
export async function retainPartials(res, recovered = []) {
  for (const c of recovered) { try { await retainPartial(res, c.session, c.id, "interrupted by a restart"); } catch (e) { console.log("retainPartial", e.message); } }
}
