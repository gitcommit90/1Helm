// Permission levels (the Captain, 10-06): "keep our current permissions as the default, then add an option in the setting to make
// them stricter such as asking before reading emails, asking before other standard 'locked down' stuff all with the ability to
// individually 'Always allow [this type of action]' ... only add 1-2 more strict levels."
//
// Per account (D1, every channel): perm_prefs.level and perm_allow (the kinds they tapped "Always allow" on).
//   standard (default): exactly what the helper always did. Nothing here ever asks, and no row is needed.
//   careful:  also asks before READING private data: email, calendar, contacts, files and messages in connected apps, other apps.
//   locked:   careful + asks before running things on the computer (anything beyond reading files), visiting websites (browser and
//             fetch_url), web searches that carry personal details, starting background helpers, and scheduling things.
// Legacy stored "trusted" normalizes to Standard. The withdrawn preset never supplies financial consent.
//
// Enforced in the tool layer, never by the prompt: Resident.localTool and Resident.execComputerTool (both engines land there) call
// permGate first. A gated call makes a permission request (the Sentinel `approvals` table, perm = the kind) and shows the same
// permission card: Allow once / Always allow <kind> / Don't allow. In the app it arrives live on the task; with nobody watching
// it goes out by text as a live app card (/c/<token>, like Sentinel requests). The call is held while they decide (up to 2 min):
//   once   → it runs, and that kind is allowed for the rest of this turn;
//   always → it runs, and the kind is saved in perm_allow (listed in Settings → Permissions, where it can be taken back);
//   deny   → "NOT ALLOWED" (and no more asks for that kind in this turn).
// No answer in time → "NEEDS PERMISSION" (the helper ends its turn; the task shows the waiting card). A later Allow resumes the task
// through a handoff (an "Allow once" then leaves a one-use grant, so the resumed turn's call goes through).
import { EMAIL_APPS, CALENDAR_APPS, READ_ACTION, appOfAction } from "./ask-first.js";
import { BUILTIN_APPS } from "./ee/index.js";
import { boundedJson, BodyTooLargeError } from "./bounded-body.js";
import { isCustomSlug, customUsable, ownerOf, CUSTOM_DENIED } from "./ee/index.js";
import { loadCheckins, saveCheckins, checkinPatchOk } from './agent-checkins.js';
import { sshPermission, setSshPermission, nativeAvailable, nativeSameOrigin } from './native-network.js';

export const PERM_DDL = ["ALTER TABLE approvals ADD COLUMN perm TEXT", "ALTER TABLE approvals ADD COLUMN what TEXT"];
export function permsInit(sql) { for (const q of PERM_DDL) { try { sql.exec(q); } catch {} } }

export const LEVELS = [
  { id: "standard", name: "Standard", sub: "Carries out requested work without extra confirmations. Payments and API keys stay protected." },
  { id: "careful", name: "Careful", sub: "Also asks before reading your email, calendar, contacts, files or messages." },
  { id: "locked", name: "Locked down", sub: "Also asks before it runs things on its computer, visits websites, searches the web with your personal details, starts background helpers or schedules anything." },
];
const RANK = { standard: 0, careful: 1, locked: 2 };
export const levelOk = (v) => Object.hasOwn(RANK, String(v));

// The kinds of action, in plain words. level = the lowest level that asks first. ask = the card's question; doing = "wants to …".
export const KINDS = [
  { id: "email", name: "Read your email", level: "careful", ask: "OK to read your email?", always: "Always allow reading email" },
  { id: "calendar", name: "Read your calendar", level: "careful", ask: "OK to look at your calendar?", always: "Always allow your calendar" },
  { id: "contacts", name: "Read your contacts", level: "careful", ask: "OK to look at your contacts?", always: "Always allow your contacts" },
  { id: "files", name: "Read your files", level: "careful", ask: "OK to open your files?", always: "Always allow your files" },
  { id: "messages", name: "Read your messages", level: "careful", ask: "OK to read your messages?", always: "Always allow reading messages" },
  { id: "apps", name: "Read your other apps", level: "careful", ask: "OK to look in your app?", always: "Always allow your apps" },
  { id: "computer", name: "Run things on the computer", level: "locked", ask: "OK to run this on the computer?", always: "Always allow running things" },
  { id: "browser", name: "Visit websites", level: "locked", ask: "OK to visit this website?", always: "Always allow websites" },
  { id: "web", name: "Search the web with your details", level: "locked", ask: "OK to search the web with your details?", always: "Always allow these searches" },
  { id: "helpers", name: "Start background helpers", level: "locked", ask: "OK to start a background helper?", always: "Always allow helpers" },
  { id: "schedule", name: "Schedule things", level: "locked", ask: "OK to schedule this?", always: "Always allow scheduling" },
  // Asks at every level, Standard included (personal-fill.js gates the browser typing tools). The card's question names the details
  // and the site ("OK to fill in your name, phone and email on opentable.com?"): see permQuestion.
  { id: "custom_mcp", name: "Use tools from your custom MCP servers", level: "standard", ask: "OK to use this tool from your custom MCP server?", always: "Always allow custom MCP tools" },
  { id: "personal", name: "Fill in your personal details", level: "standard", ask: "OK to fill in your personal details on this website?", always: "Always allow filling in your details" },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const kindName = (id) => KIND[id]?.name || String(id || "");
// what: the request's "wants to …" text; a personal-details request asks with it ("OK to fill in your name and email on x.com?").
export const permQuestion = (id, what = "") => (id === "personal" && what ? `OK to ${what}?` : KIND[id]?.ask || "OK to go ahead?");
// What a permission card shows for a request (Resident.approvalView / approvalCardData).
export const permView = (a) => ({ perm: a.perm, name: kindName(a.perm), what: a.what || "", ask: permQuestion(a.perm, a.what), always: KIND[a.perm]?.always || "Always allow" });

// ---- which kind a tool call is (null: never gated) ----
const MESSAGE_APPS = new Set(["slack", "slackbot", "discord", "discordbot", "microsoft_teams", "telegram", "whatsapp", "googlechat", "google_chat", "mattermost", "rocketchat", "intercom", "twilio", "zoom"]);
const FILE_APPS = new Set(["googledrive", "googledocs", "googlesheets", "googleslides", "dropbox", "box", "onedrive", "one_drive", "sharepoint", "notion", "evernote", "confluence", "airtable", "googlephotos", "google_photos", "coda", "quip"]);
const CONTACT_APPS = new Set(["googlecontacts", "google_contacts", "icloud_contacts"]);
const CONTACTISH = /CONTACT|PEOPLE|ADDRESS_?BOOK/, CALISH = /CALENDAR|EVENT|FREE_?BUSY|AVAILAB/, MAILISH = /MAIL|MESSAGE|INBOX|THREAD|DRAFT|LABEL|FOLDER/;
const WRITE = /(^|_)(SEND|POST|CREATE|ADD|UPDATE|EDIT|DELETE|REMOVE|MOVE|ARCHIVE|REPLY|FORWARD|INSERT|PATCH|PUT|UPLOAD|SHARE|INVITE|STAR|MARK|SET|CANCEL|PAY|BUY|ORDER|PUBLISH|MODIFY|APPEND|COPY|RENAME|TRASH|ACCEPT|DECLINE|SCHEDULE|REACT|PIN|UNPIN|JOIN|LEAVE|KICK|BAN|ASSIGN|CLOSE|OPEN|MERGE|SUBMIT)(_|$)/;
function appKind(app, act) {
  if (CONTACT_APPS.has(app) || ((EMAIL_APPS.has(app) || CALENDAR_APPS.has(app)) && CONTACTISH.test(act))) return "contacts";
  if (CALENDAR_APPS.has(app) && (CALISH.test(act) || !EMAIL_APPS.has(app))) return "calendar";
  if (EMAIL_APPS.has(app) && (MAILISH.test(act) || app !== "googlesuper")) return "email";
  if (MESSAGE_APPS.has(app)) return "messages";
  if (FILE_APPS.has(app)) return "files";
  return "apps";
}
const COMPUTER_RUN = new Set(["run_command", "write_file", "edit_file"]);
const VISIT = new Set(["browser_navigate", "browser_act", "browser_task", "browser_fill_login", "fetch_url"]);
export const GATED_TOOLS = new Set(["gmail_search", "gmail_read", "calendar_events", "app_run", "app_proxy", "web_search", "search_web_vertical", "start_helper", "schedule_workflow", "schedule_followup", ...COMPUTER_RUN, ...VISIT]);
export function kindFor(name, a = {}, conns = []) {
  if (name === "gmail_search" || name === "gmail_read") return "email";
  if (name === "calendar_events") return "calendar";
  // Custom MCP servers (custom-mcp.js): the remote server picks the tool names, so a name says nothing about what a tool does. Never classified
  // by READ/WRITE words: every call is its own kind, which asks at every level (like personal details) until the person chooses Always allow.
  if (name === "app_run" && isCustomSlug(a.action)) return "custom_mcp";
  if (name === "app_proxy" && isCustomSlug(a.app)) return "custom_mcp";
  if (name === "app_run") {
    const act = String(a.action || "").toUpperCase().replace(/[^A-Z0-9_]/g, ""); if (!act) return null;
    const app = appOfAction(act, conns);
    if (BUILTIN_APPS.has(app)) return null;                        // the no-sign-in apps (weather, Hacker News…): nothing private
    if (!READ_ACTION.test(act) && WRITE.test(act)) return null;    // a change: already needs their OK on that exact action (person_confirmed)
    return appKind(app, act);
  }
  if (name === "app_proxy") {   // the app's own API (stage 3): a GET reads like the app's read actions; anything else needs person_confirmed
    const app = String(a.app || "").toLowerCase().replace(/[^a-z0-9_]/g, ""); if (!app || BUILTIN_APPS.has(app)) return null;
    if (String(a.method || "GET").toUpperCase() !== "GET") return null;
    return appKind(app, String(a.path || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
  }
  if (COMPUTER_RUN.has(name)) return "computer";
  if (VISIT.has(name)) return "browser";
  if (name === "web_search" || name === "search_web_vertical") return "web";   // vertical-search.js: a live search is a web search
  if (name === "start_helper") return "helpers";
  if (name === "schedule_workflow" || name === "schedule_followup") return "schedule";
  return null;
}

// ---- personal details in a web search (locked down only) ----
export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, PHONE_RE = /(?:\+?\d[\s().-]*){7,}/, SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
export const STREET_RE = /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){1,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|ter|terrace|cir|circle|hwy|highway|pkwy|parkway)\b/i;
const norm = (s) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9@.+]+/g, " ").trim()} `;
const digits = (s) => String(s || "").replace(/\D/g, "");
// info = { names: [full names], emails: [...], phones: [...] } (their contacts and the account owner).
export function personalIn(q, info = {}) {
  const s = String(q || ""); if (!s.trim()) return false;
  if (EMAIL_RE.test(s) || SSN_RE.test(s) || STREET_RE.test(s)) return true;
  if (PHONE_RE.test(s) && digits(s.match(PHONE_RE)[0]).length >= 7) return true;
  const t = norm(s), d = digits(s);
  for (const n of info.names || []) { const k = norm(n); if (k.trim().split(" ").length >= 2 && t.includes(k)) return true; }
  for (const e of info.emails || []) if (e && t.includes(norm(e).trim())) return true;
  for (const p of info.phones || []) { const x = digits(p); if (x.length >= 7 && d.includes(x.slice(-7))) return true; }
  return false;
}
async function personalInfo(res) {
  const info = { names: [], emails: [], phones: [] };
  try { for (const p of (await res.archive().peopleList()) || []) {
    if (p.name) info.names.push(p.name);
    for (const e of [p.email, ...(p.emails || []).map((x) => x?.v ?? x)]) if (e && typeof e === "string") info.emails.push(e);
    for (const f of [p.phone, ...(p.phones || []).map((x) => x?.v ?? x)]) if (f && typeof f === "string") info.phones.push(f);
  } } catch {}
  try { const u = await res.env.DB.prepare("SELECT u.email FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE t.id=?").bind(res.get("tenant")).first(); if (u?.email) info.emails.push(u.email); } catch {}
  return info;
}

// ---- the account's settings (D1) ----
// → { level, allow: Set }. No row / no table (migration not applied yet) = Standard, nothing allowed: today's behavior.
// The allowed kinds load on Standard too: "Fill in your personal details" asks at every level.
export async function loadPerms(env, tenant) {
  const out = { level: "standard", allow: new Set() };
  if (!env?.DB || !tenant) return out;
  try { const r = await env.DB.prepare("SELECT level FROM perm_prefs WHERE tenant_id=?").bind(tenant).first(); if (r && levelOk(r.level)) out.level = r.level; } catch {}
  try { for (const r of (await env.DB.prepare("SELECT kind FROM perm_allow WHERE tenant_id=?").bind(tenant).all()).results || []) out.allow.add(r.kind); } catch {}
  return out;
}
export async function allowKind(env, tenant, kind, via = "card") {
  if (!KIND[kind]) return { error: "unknown kind" };
  await env.DB.prepare("INSERT INTO perm_allow (tenant_id,kind,at,via) VALUES (?,?,?,?) ON CONFLICT(tenant_id,kind) DO UPDATE SET at=excluded.at, via=excluded.via").bind(tenant, kind, Date.now(), via).run();
  return { ok: true };
}
export const asks = (level, kind) => kind === 'personal' || kind === 'custom_mcp' || (RANK[level] ?? 0) >= (RANK[KIND[kind]?.level] ?? 99);

// ---- the texts the helper sees ----
const doingOf = (name, a = {}) => {
  const q = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  switch (name) {
    case "gmail_search": return a.query ? `search your email for "${q(a.query, 80)}"` : "look through your email";
    case "gmail_read": return "open an email";
    case "calendar_events": return "look at your calendar";
    case "app_run": return `use ${q(String(a.action || "").toLowerCase().replace(/_/g, " "), 80) || "one of your apps"}`;
    case "app_proxy": return `look in ${q(a.app, 40) || "one of your apps"} (${q(String(a.method || "GET").toUpperCase(), 8)} ${q(a.path, 80)})`;
    case "run_command": return `run \`${q(a.command, 100)}\` on the computer`;
    case "write_file": case "edit_file": return `change ${q(a.path, 80) || "a file"} on the computer`;
    case "browser_navigate": case "fetch_url": { let h = ""; try { h = new URL(String(a.url)).host; } catch {} return h ? `visit ${h}` : "visit a website"; }
    case "browser_act": return "click and type on the open web page";
    case "browser_task": return a.url ? `use the browser on ${(() => { try { return new URL(String(a.url)).host; } catch { return "a website"; } })()}` : "use the browser";
    case "browser_fill_login": return `sign in to ${q(a.site, 60) || "a site"}`;
    case "web_search": return `search the web for "${q(a.query, 80)}"`;
    case "search_web_vertical": return `search ${q(a.kind, 20) || "live results"} for "${q([a.query, a.from, a.to, a.near].filter(Boolean).join(" "), 80)}"`;
    case "start_helper": return `start a background helper${a.name ? `: ${q(a.name, 60)}` : ""}`;
    case "schedule_workflow": return `schedule "${q(a.name, 60) || "a recurring job"}"`;
    case "schedule_followup": return `set a follow-up${a.reason ? `: ${q(a.reason, 60)}` : ""}`;
  }
  return "do this";
};
export const notAllowed = (kind) => kind === "personal"
  ? `NOT ALLOWED: the person said no to "${kindName(kind)}" this time, so nothing was typed. Don't type their details another way. If the form still needs them, use browser_handoff so they fill those fields in themselves, and tell them in one short line.`
  : `NOT ALLOWED: the person said no to "${kindName(kind)}" this time, so nothing was done. Don't try another way to get it. Tell them in one short line what you couldn't do without it, and carry on with the rest if you can.`;
const needs = (kind, where) => `NEEDS PERMISSION: ${kind === "personal" ? "1Helm asks the person before" : "the person chose to be asked before"} "${kindName(kind)}", and they haven't answered yet, so nothing was done. The question is waiting for them ${where}. End your turn now with one short line saying what you're waiting on; don't ask again in your own words and don't try another way. When they allow it, you'll be told and can carry on.`;

// ---- the gate ----
// → null (go ahead) or the text the tool returns instead. tc = the turn's context.
export const turnPerms = async (res, tc) => (tc.perm = await loadPerms(res.env, res.get("tenant")));
export async function permGate(res, tc, name, a = {}) {
  if (!tc || !tc.turn || !GATED_TOOLS.has(name)) return null;
  // A custom server this workspace may not use right now (switched off, removed, someone else's, made up) is refused here, final and with no card:
  // the person is never asked to allow something that can't run.
  if ((name === "app_run" && isCustomSlug(a.action)) || (name === "app_proxy" && isCustomSlug(a.app))) {
    if (!ownerOf(await customUsable(res.env, res.get("tenant")), name === "app_run" ? a.action : a.app)) return CUSTOM_DENIED;
  }
  const st = await turnPerms(res, tc);
  const custom = (name === "app_run" && isCustomSlug(a.action)) || (name === "app_proxy" && isCustomSlug(a.app));
  if (st.level === "standard" && !custom) return null;   // custom MCP tools ask at Standard too
  const kind = kindFor(name, a, name === "app_run" ? await res.conns().catch(() => []) : []);
  if (!kind || !asks(st.level, kind) || st.allow.has(kind) || tc.permOk?.has(kind)) return null;
  if (kind === "web" && !personalIn(name === "search_web_vertical" ? [a.query, a.near, a.from, a.to].filter(Boolean).join(" ") : a.query, tc.permInfo ||= await personalInfo(res))) return null;
  if (tc.permNo?.has(kind)) return notAllowed(kind);
  // A one-use grant left by a late "Allow once" (this turn resumed the task after they answered).
  if (takeGrant(res, tc, kind)) { (tc.permOk ||= new Set()).add(kind); return null; }
  return await askPerson(res, tc, kind, doingOf(name, a));
}

// A one-use grant left by a late "Allow once" for this kind (decidePerm) → true when one was there (and is now used up).
export function takeGrant(res, tc, kind) {
  const g = res.sql.exec("SELECT id FROM grants WHERE host=? AND (session IS NULL OR session=?) AND uses_left<>0 AND (expires IS NULL OR expires>?) ORDER BY id LIMIT 1", `perm:${kind}`, tc.session || "", Date.now()).toArray()[0];
  if (g) res.sql.exec("DELETE FROM grants WHERE id=?", g.id);
  return !!g;
}

const HOLD_MS = 120e3, TICK = 500;
// key: what an answer covers in this turn (tc.permOk / tc.permNo): the kind, or "personal@<site>" for personal details.
export async function askPerson(res, tc, kind, what, key = kind) {
  const sql = res.sql, now = Date.now(), session = tc.session || null;
  // One open request per kind per task (a retry while it's pending reuses it: one card, one text).
  let a = sql.exec("SELECT * FROM approvals WHERE status='pending' AND perm=? AND COALESCE(session,'')=? AND at>? ORDER BY id DESC LIMIT 1", kind, session || "", now - 3600e3).toArray()[0];
  if (!a) {
    sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,workflow_id,session,perm,what) VALUES (?,?,?,?,?,?,?,?,?,?,?)", now, "", "PERM", "", 0, "[]", tc.turn || null, tc.workflow_id ?? null, session, kind, what);
    a = sql.exec("SELECT * FROM approvals WHERE id=last_insert_rowid()").one();
  }
  const live = tc.subs?.size > 0;
  const texted = live ? false : await res.textApproval(a).catch((e) => { console.log("perm text", e.message); return false; });
  if (!live && !texted) return needs(kind, "in the app, on this task");
  (res._permHeld ||= new Set()).add(a.id);
  try {
    tc.emit?.({ t: "approval", approval: res.approvalView(a) });
    for (let i = 0; i < HOLD_MS / TICK; i++) {
      const cur = sql.exec("SELECT status, decision FROM approvals WHERE id=?", a.id).one();
      if (cur.status !== "pending") {
        tc.emit?.({ t: "approval_done", id: a.id, status: cur.status });
        if (cur.status === "denied") { (tc.permNo ||= new Set()).add(key); return notAllowed(kind); }
        if (cur.decision === "always") (tc.perm ||= { level: "careful", allow: new Set() }).allow.add(kind);
        else (tc.permOk ||= new Set()).add(key);
        return null;
      }
      if (tc.abort === "hard") break;
      await new Promise((z) => setTimeout(z, TICK));
    }
  } finally { res._permHeld.delete(a.id); }
  return needs(kind, texted && !live ? "on their phone and in the app" : "in the app, on this task");
}

// ---- deciding (Resident.decideApproval for a request with perm set) ----
export const PERM_DECISIONS = ["once", "always", "deny"];
export async function decidePerm(res, a, decision) {
  if (!PERM_DECISIONS.includes(decision)) return { error: "decision must be once, always or deny" };
  const now = Date.now(), sql = res.sql;
  if (decision === "always") { try { await allowKind(res.env, res.get("tenant"), a.perm, "card"); } catch (e) { return { error: `couldn't save that (${String(e.message || e).slice(0, 80)})` }; } }
  sql.exec("UPDATE approvals SET status=?, decision=?, decided_at=? WHERE id=? AND status='pending'", decision === "deny" ? "denied" : "approved", decision, now, a.id);
  // Nobody is holding the call any more (the turn ended with NEEDS PERMISSION): an Allow carries the task on.
  if (decision !== "deny" && !res._permHeld?.has(a.id) && a.session && res.session(a.session)) {
    if (decision === "once") sql.exec("INSERT INTO grants (at,host,method,scope,session,uses_left,expires,approval_id) VALUES (?,?,?,?,?,?,?,?)", now, `perm:${a.perm}`, "*", "once", a.session, 1, now + 3600e3, a.id);
    try { res.handoff(a.session, { text: resumeText(a, decision), from: { type: "permission", id: a.id, title: `Allowed: ${kindName(a.perm)}` } }); } catch (e) { console.log("perm handoff", e.message); }
  }
  return { ok: true, approval: res.approvalView(sql.exec("SELECT * FROM approvals WHERE id=?", a.id).one()) };
}
const resumeText = (a, d) => `(Not from the person: they just allowed "${kindName(a.perm)}"${d === "always" ? " from now on" : " once"}${a.what ? `, for when you wanted to ${a.what}` : ""}. Carry on with what you were doing.)`;

// ---- the per-person prompt line (only when not Standard, so everyone on Standard keeps the same prompt) ----
export function permPromptLine(level) {
  if (level === "careful") return "Permissions: the person chose Careful. Before you read their email, calendar, contacts, files or messages in their apps, 1Helm asks them first (a permission card); you don't ask in your own words. A tool that returns NEEDS PERMISSION is waiting on them: end your turn with one short line. NOT ALLOWED means no: don't try another way.";
  if (level === "locked") return "Permissions: the person chose Locked down. Before you read their email, calendar, contacts, files or messages, run anything on your computer beyond reading files, visit websites, search the web with personal details, start helpers or schedule anything, 1Helm asks them first (a permission card); you don't ask in your own words. A tool that returns NEEDS PERMISSION is waiting on them: end your turn with one short line. NOT ALLOWED means no: don't try another way.";
  return "";
}

// ---- Settings → Permissions (the app): GET/POST /api/permissions ----
//   GET  → { level, levels, kinds, allowed: [{ kind, name, at }], sites: [{ channel, channel_name, id, host, scope, at }] }
//   POST { level }                     → set the level
//   POST { revoke: kind }              → take back an "Always allow"
//   POST { revoke_site: { channel, id } } → take back an "Always allow <site>" (a Sentinel grant in that channel)
export async function permsApi(req, env, t, { channels }) {
  const DB = env.DB, json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const resOf = (slug) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slug}`));
  if (req.method === "POST") {
    let b;
    try { b = await boundedJson(req, 8192); }
    catch (e) { return json({ error: e instanceof BodyTooLargeError ? "too_large" : "bad_request" }, e instanceof BodyTooLargeError ? 413 : 400); }
    if (b.agent_checkins != null) {
      if (!nativeSameOrigin(req)) return json({ error: 'Check-in changes require a same-origin request.' }, 403);
      if (!checkinPatchOk(b.agent_checkins)) return json({ error: 'Agent check-ins accept silent and fast whole-number thresholds from 1 to 1000.' }, 400);
      await saveCheckins(env, t.id, b.agent_checkins);
    } else if (b.direct_protocols != null) {
      if (!nativeSameOrigin(req)) return json({ error: 'Native permission changes require a same-origin request.' }, 403);
      if (!b.direct_protocols || Object.keys(b.direct_protocols).some(k => k !== 'ssh') || !['deny','ask','trusted'].includes(b.direct_protocols.ssh)) return json({ error: 'Outbound SSH accepts deny, ask or trusted.' }, 400);
      const r = await setSshPermission(env, t.id, b.direct_protocols.ssh, channels);
      if (!r.ok) return json(r, 503);
    } else if (b.level != null) {
      if (b.level === 'trusted') return json({ error: 'Trusted is unavailable. Standard approval checks apply; no spending permission was granted.' },400);
      if (!levelOk(b.level)) return json({ error: "level must be standard, careful or locked" }, 400);
      await DB.prepare("INSERT INTO perm_prefs (tenant_id,level,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET level=excluded.level, updated_at=excluded.updated_at").bind(t.id, b.level, Date.now()).run();
    } else if (b.revoke != null) {
      if (!KIND[b.revoke]) return json({ error: "unknown kind" }, 400);
      await DB.prepare("DELETE FROM perm_allow WHERE tenant_id=? AND kind=?").bind(t.id, String(b.revoke)).run();
    } else if (b.allow != null) {
      if (!KIND[b.allow]) return json({ error: "unknown kind" }, 400);
      await allowKind(env, t.id, String(b.allow), "settings");
    } else if (b.revoke_site?.channel && b.revoke_site?.id != null) {
      const chs = await channels(); if (!chs.some((c) => (c.slug || c.name) === String(b.revoke_site.channel))) return json({ error: "no such channel" }, 404);
      await resOf(String(b.revoke_site.channel)).revokeGrant(Number(b.revoke_site.id));
    } else return json({ error: "nothing to change" }, 400);
  }
  return json(await permsView(env, t, channels));
}
export async function permsView(env, t, channels) {
  const DB = env.DB;
  const lv = await DB.prepare("SELECT level FROM perm_prefs WHERE tenant_id=?").bind(t.id).first().catch(() => null);
  const allowed = ((await DB.prepare("SELECT kind, at FROM perm_allow WHERE tenant_id=? ORDER BY at DESC").bind(t.id).all().catch(() => null))?.results || [])
    .filter((r) => KIND[r.kind]).map((r) => ({ kind: r.kind, name: kindName(r.kind), at: r.at }));
  // "Always allow <site>" (Sentinel, per channel): each channel's lasting grants.
  const sites = [];
  try {
    for (const c of await channels()) {
      const slug = c.slug || c.name;
      let gs = []; try { gs = await env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slug}`)).listGrants(); } catch {}
      for (const g of gs || []) if (g.scope === "this channel" && !String(g.host).startsWith("perm:")) sites.push({ channel: slug, channel_name: c.name || slug, id: g.id, host: g.host, scope: g.scope, at: g.at });
    }
  } catch {}
  return { level: levelOk(lv?.level) ? lv.level : "standard", levels: LEVELS, kinds: KINDS.map(({ id, name, level }) => ({ id, name, level })), allowed, sites,
    agent_checkins: await loadCheckins(env, t.id),
    direct_protocols: { ssh: (await sshPermission(env, t.id)).mode }, native_network_available: nativeAvailable(env) };
}
