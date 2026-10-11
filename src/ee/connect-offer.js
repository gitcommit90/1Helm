import { boundedJson } from "../bounded-body.js";
// Connect offers (10-05): the helper can look up any app in the integrations catalog (find_app) and put a SYSTEM card in the chat
// asking the person to connect one (offer_connect). Only the person's tap on Connect connects anything.
//   find_app({ query })        fuzzy search of the catalog (app-static/integrations.json, the same list the Apps popup shows),
//                               cached in this isolate; each match says this workspace's connection status and how it connects.
//                               No model call. Background helpers may use it (read-only).
//   offer_connect({ app, why, draft? }) a card (logo, name, the helper's one-line why, Connect / Not now, "See what it can do"). At most one
//                               offer per app per task, none when the tenant flag connect_offers = "off", never from a background
//                               helper (HELPER_DENIED) or an unattended run. By text: the reply carries a link to the app's page.
// The card is a row in this channel's Resident (connect_offers), shown with its task (sessionDetail.offers) and streamed live as
// {"t":"connect_offer"}. Connect runs the app's normal Composio sign-in with from=offer; /apps/done then marks the offer
// connected (after checking the app really is connected) and hands a context note back into the task (Resident.handoff), so the
// helper carries on with the original ask. Not now = dismissed; "Don't suggest connecting apps" sets the tenant flag.
// The draft (the Captain's decision, 10-07): when they asked for something to be sent or made in an app that isn't connected ("email
// Bob about lunch", "add the dentist Friday 3pm"), the card also shows what the helper would send or create, under Connect: an email
// (to, cc, subject, body), an event (title, start, end, time zone, calendar, guests) or plain text. Connecting is never a yes to it:
// the note back says so, and a write in the turn that note starts is refused until the person says something (resident.js).
// Another account (the Captain, 10-07: "i want to connect another gmail account" got directions to Settings): for an app that's already
// connected, offer_connect shows "Connect another Gmail account" when the person asked for one in this task (asksForAnother: their
// words, checked, not the model's say-so). Connect is Settings' Add another (/api/apps/connect with another: true, Managed or
// Self-managed), and /apps/done marks the card connected only when an account that wasn't there at offer time (known) shows up, then
// names its email in the card and the note back. Several offers for one app in a task: only after the last one connected.
import { customMentions, displayOf, customUsable, CUSTOM_DENIED, isCustomSlug } from "./custom-mcp.js";
import { RETIRED_APPS, RETIRED_NOTE, SUPER_COVERS, latestVersion } from "./composio.js";
import { transportFor } from "./composio-transport.js";
import { selfStatus, ENDED_LINE } from "./composio-self.js";
import { tidyAfterConnect } from "./composio.js";
import { BUILTIN_APPS_LATEST, byokInfo, isHiddenApp } from "./builtin-apps.js";
import { loginSites } from "../logins.js";
import { appLink } from "./texting.js";
import { taskWords } from "./appfirst.js";
import { personWords } from "../person-asked.js";

export const CONNECT_DDL = [
  `CREATE TABLE IF NOT EXISTS connect_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, session TEXT NOT NULL, turn TEXT, app TEXT NOT NULL,
    name TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'oauth', reconnect INTEGER NOT NULL DEFAULT 0, via TEXT NOT NULL DEFAULT 'app',
    status TEXT NOT NULL DEFAULT 'pending', decided_at INTEGER)`,
  // One app can have several offers in a task since "another account" (10-07): the newest is the one that counts (offerRow).
  "DROP INDEX IF EXISTS connect_offers_one",
  "CREATE INDEX IF NOT EXISTS connect_offers_sa ON connect_offers(session, app)",
];
// draft: JSON (normDraft), 10-07. another: an added account for an app that was already connected; known: JSON [{id,email}] of that
// app's connected accounts when the card was made; email: the account that connected; already: that account was connected before.
const OFFER_COLS = ["draft TEXT", "another INTEGER NOT NULL DEFAULT 0", "known TEXT", "email TEXT", "already INTEGER NOT NULL DEFAULT 0"];
export function connectOfferInit(sql) { for (const q of CONNECT_DDL) sql.exec(q); for (const c of OFFER_COLS) { try { sql.exec(`ALTER TABLE connect_offers ADD COLUMN ${c}`); } catch {} } }

// ---------------- the catalog ----------------
// integrations.json rows: s slug, n name, d description, c categories, t tool count, o one-click sign-in (Composio-managed OAuth),
// f featured rank (0 = not featured), b built in (no sign-in; set by design-sandbox scripts/integrations-builtin.mjs and only trusted
// for the audited apps in builtin-apps.js), x not available yet ("Soon" in the Apps popup).
// Two files, one per Composio toolkit version (composio.js latestVersion): integrations.json for the pinned version and
// integrations-latest.json (design-sandbox scripts/integrations-version.mjs: t, b and x from the latest versions). The Worker serves the
// matching one at /app-static/integrations.json, so the Apps popup, find_app and offer_connect all see the same list.
export const catalogFile = (env) => (latestVersion(env) ? "integrations-latest.json" : "integrations.json");
const CAT_TTL = 3600e3;
let CAT = null;             // { at, list }
export function setCatalog(list) { CAT = list ? { at: Date.now(), list: list.filter((a) => !isHiddenApp(a?.s)).map(prep) } : null; }   // the deny list (builtin-apps.js) never reaches the helper
export async function appCatalog(env) { return catalog(env); }
async function catalog(env) {
  if (CAT && Date.now() - CAT.at < CAT_TTL) return CAT.list;
  try {
    if (!env.ASSETS) throw new Error("no ASSETS binding");
    const r = await env.ASSETS.fetch(new Request(`https://${env.APP_HOST || env.GATEWAY_HOST}/app-static/${catalogFile(env)}`));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json(); if (!Array.isArray(list) || !list.length) throw new Error("empty catalog");
    setCatalog(list); return CAT.list;
  } catch (e) { console.log("find_app catalog", e.message); if (CAT) { CAT.at = Date.now() - CAT_TTL + 60e3; return CAT.list; } return []; }
}
const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function prep(a) {
  const name = String(a.n || a.s || ""), words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return { ...a, n: name, _c: compact(name), _s: compact(a.s), _w: words, _cat: (a.c || []).map((x) => String(x).toLowerCase()), _d: ` ${String(a.d || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} ` };
}
// Retired apps aren't in the catalog file any more; asked by name, they still answer (as retired).
const RETIRED_ROWS = [prep({ s: "googlesuper", n: "Google Super", d: "One sign-in for several Google apps (retired).", c: [], t: 0, o: 0, f: 0 })];
// Nicknames → slug. Only used when that slug is in the catalog.
const ALIASES = {
  yt: "youtube", youtube: "youtube", "you tube": "youtube",
  gmail: "gmail", "google mail": "gmail", gcal: "googlecalendar", "google cal": "googlecalendar", calendar: "googlecalendar",
  gdrive: "googledrive", drive: "googledrive", "google drive": "googledrive", gdocs: "googledocs", "google doc": "googledocs", docs: "googledocs",
  sheets: "googlesheets", gsheets: "googlesheets", "google sheet": "googlesheets", "google spreadsheet": "googlesheets", "google spreadsheets": "googlesheets",
  slides: "googleslides", "google slide": "googleslides", meet: "googlemeet", "google photo": "googlephotos", photos: "googlephotos", maps: "google_maps",
  "google maps": "google_maps", contacts: "googlecontacts", "google tasks": "googletasks",
  ig: "instagram", insta: "instagram", fb: "facebook", twitter: "twitter", x: "twitter", "x twitter": "twitter",
  teams: "microsoft_teams", "ms teams": "microsoft_teams", hotmail: "outlook", "outlook mail": "outlook", "microsoft outlook": "outlook", onedrive: "one_drive",
  "microsoft excel": "excel", "ms excel": "excel", qb: "quickbooks", qbo: "quickbooks", "quick books": "quickbooks", "google super": "googlesuper",
};
const FILLER = new Set(["my", "our", "the", "a", "an", "app", "apps", "account", "accounts", "api", "acct", "please", "access", "to", "in", "on", "and", "for", "of", "with", "service", "can", "could", "do", "does", "i", "me", "is", "there", "connect", "use", "get", "into"]);
const STOP = new Set(["that", "this", "with", "from", "your", "their", "into", "have", "about", "more", "what", "when", "which", "data", "tool", "tools", "platform", "service", "online", "manage", "management"]);
export function normQuery(q) { return String(q || "").toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !FILLER.has(w)).join(" "); }
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
// How well one app matches: 100 exact name/id … 50 inside the name ("name" matches), 25 category / 12 description ("related").
function score(a, qn, qc, qw, alias) {
  if (!qc) return 0;
  if (alias && a.s === alias) return 99;
  if (qc === a._c || qc === a._s) return 100;
  if (qc.length >= 3 && (a._c.startsWith(qc) || a._s.startsWith(qc))) return 85 - Math.min(10, a._c.length - qc.length);
  if (qw.length && qw.every((w) => a._w.some((x) => x === w || (w.length >= 3 && x.startsWith(w))))) return 75;
  if (qw.length > 1 && a._c.length >= 4 && qw.some((w) => w === a._c || w === a._s)) return 70;   // "can you get into youtube"
  const k = qc.length >= 8 ? 2 : qc.length >= 5 ? 1 : 0;
  if (k && (lev(qc, a._c, k) <= k || lev(qc, a._s, k) <= k)) return 62;
  if (qc.length >= 4 && a._c.includes(qc)) return 50;
  const big = qw.filter((w) => w.length >= 4 && !STOP.has(w));
  if (big.length && big.some((w) => a._cat.some((c) => c.split(/[^a-z]+/).some((x) => x === w || x === w.replace(/s$/, "") || x.replace(/s$/, "") === w)))) return 25;
  if (big.length && big.some((w) => a._d.includes(` ${w} `) || a._d.includes(` ${w}s `))) return 12;
  return 0;
}
const NAME_MATCH = 50;
// Top matches for a query: [{ a (catalog row), score, match: "name" | "related" }].
export function searchApps(list, query, n = 5) {
  const qn = normQuery(query), qc = compact(qn), qw = qn.split(" ").filter(Boolean), alias = ALIASES[qn] || ALIASES[qc] || null;
  const rows = list.length && list[0]._c === undefined ? list.map(prep) : list;   // raw integrations.json rows are fine too
  const all = [...rows, ...RETIRED_ROWS.filter((r) => !rows.some((x) => x.s === r.s))];
  return all.map((a) => ({ a, score: score(a, qn, qc, qw, alias) })).filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || (+!!y.a.f - +!!x.a.f) || ((x.a.f || 1e9) - (y.a.f || 1e9)) || (y.a.o || 0) - (x.a.o || 0) || (y.a.t || 0) - (x.a.t || 0))
    .slice(0, n).map((x) => ({ ...x, match: x.score >= NAME_MATCH ? "name" : "related" }));
}
// How it connects: oauth (one-click sign-in) | key (an API key on Composio's secure page) | builtin | soon | retired.
// A b flag counts only for an audited app (either version's list: each catalog file only flags its own version's audited apps).
export function connectKind(a) { return RETIRED_APPS.has(a.s) ? "retired" : a.b && BUILTIN_APPS_LATEST.has(a.s) ? "builtin" : a.x ? "soon" : a.o ? "oauth" : "key"; }
// A key app that is an AI model provider (Gemini, OpenAI…): the person's own key, billed by that provider. → plain words, or "".
export function byokText(a) { const b = connectKind(a) === "key" ? byokInfo(a.s, a.n, { cats: a.c || [] }) : null; return b ? `needs their own API key from ${b.provider}${b.url ? ` (${b.url})` : ""}; they pay ${b.payer} directly for what you use, and 1Helm doesn't bill for it` : ""; }
const KIND_TEXT = { oauth: "one-click sign-in", key: "needs an API key or token from the app (pasted on a secure page)", builtin: "built in: nothing to connect", soon: "not available yet (Soon)", retired: "retired: can't be connected any more" };
// First sentence of the catalog text, without the leading "<Name> is a".
export function oneLine(a) {
  let d = (String(a.d || "").match(/^.*?[.!?](?=\s|$)/)?.[0] || String(a.d || "")).replace(/\.$/, "").trim();
  d = d.replace(new RegExp(`^(the )?${a.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( app| api)?('s)?\\s+(is|are|provides|offers|enables|lets|helps|allows)\\s+(a |an |the )?`, "i"), "");
  d = d ? d[0].toUpperCase() + d.slice(1) : (a.c || []).join(", ");
  return d.length > 170 ? d.slice(0, 167).replace(/\s+\S*$/, "") + "…" : d;
}
// This workspace's connection to one app, from listConnections rows ({ app, status, email, retired }).
export function statusFor(slug, conns = []) {
  const mine = conns.filter((c) => c.app === slug), on = mine.filter((c) => c.status === "connected");
  if (on.length) return { status: "connected", accounts: on.map((c) => c.email || c.id).filter(Boolean) };
  if (SUPER_COVERS.has(slug) && conns.some((c) => c.app === "googlesuper" && c.status === "connected")) return { status: "connected", via: "googlesuper", accounts: [] };
  if (mine.length) return { status: "expired", accounts: [] };
  return { status: "not connected", accounts: [] };
}
const statusText = (st, kind) => kind === "builtin" ? "built in" : st.status === "connected"
  ? `connected${st.via ? " (through Google Super, which is being retired)" : st.accounts.length > 1 ? ` (${st.accounts.length} accounts: ${st.accounts.slice(0, 4).join(", ")})` : st.accounts.length ? ` (${st.accounts[0]})` : ""}`
  : st.status === "expired" ? "expired (needs reconnecting)" : "not connected";

// ---------------- tenant flag: connect_offers = "off" ----------------
export async function offersFlag(env, tenantId) {
  try { return (await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k='connect_offers'").bind(tenantId).first())?.v || ""; } catch { return ""; }
}
export async function setOffersFlag(env, tenantId, off) {
  if (off) await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,'connect_offers','off',?) ON CONFLICT(tenant_id,k) DO UPDATE SET v='off', updated_at=excluded.updated_at").bind(tenantId, Date.now()).run();
  else await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k='connect_offers'").bind(tenantId).run();
  return { connect_offers: off ? "off" : "on" };
}

// ---------------- tools ----------------
export const FIND_APP_TOOL = { type: "function", function: { name: "find_app", description:
  "Look up whether an app or service can be connected to 1Helm, and whether this person has connected it. Use it when they ask \"can you access my X?\" or \"do you work with X?\", " +
  "and before offering a connection you aren't sure exists. Fuzzy: a name, nickname or kind of app (\"yt\", \"google sheets\", \"my bank\", \"Venmo\"). Returns up to 5 matches, each with " +
  "its status for this person (connected / expired / not connected) and how it connects (one-click sign-in, needs an API key, not available yet). Instant and free. " +
  "Then: connected → just use it. Available but not connected (or expired) → offer_connect. No match, or not available yet → tell them plainly it can't be connected yet and " +
  "offer to do it in the browser instead (browser_task; browser_fill_login if they saved a login for the site, else browser_handoff so they sign in themselves).",
  parameters: { type: "object", properties: { query: { type: "string", description: "the app or service, as the person said it, e.g. \"YouTube\", \"yt\", \"my bank\"" } }, required: ["query"] } } };
export const OFFER_CONNECT_TOOL = { type: "function", function: { name: "offer_connect", description:
  "Show the person a card in the chat to connect one app: its logo and name, your one-line why, and Connect / Not now. Nothing connects unless they tap Connect. " +
  "Use it (a) when they ask for something a NOT-connected app would clearly help with (also say it in one short line, e.g. \"I can do that if you connect YouTube. Want to?\"), or " +
  "(b) when find_app shows the app they asked about is available but not connected, or its connection expired. Then end your turn and wait: when they connect, you get a note and " +
  "carry on with their ask. Never pester: at most one offer per app per task; if they tap Not now or say no, don't offer that app again in this task. If they say they don't want " +
  "connection suggestions, save that with remember and stop offering. Not for an app that's already connected (just use it) or not available yet (offer the browser instead), " +
  "except when they ask to connect ANOTHER account of a connected app (\"connect another gmail\", \"add my work email too\"): then pass another: true and the card is \"Connect another Gmail account\" (never send them to Settings for it). " +
  "When they asked you to SEND or CREATE something with it (an email, an event, a message, a task), pass draft: exactly what you'd send or create, so the card shows it under Connect. Write it in full from their words (never invent a recipient or a time); leave out what you don't know rather than guess. Not for reads (\"check my email\").",
  parameters: { type: "object", properties: {
    app: { type: "string", description: "the app's id from find_app (e.g. youtube) or its exact name" },
    why: { type: "string", description: "one short line in plain words: what connecting lets you do for them right now, e.g. \"So I can find the cooking videos you saved.\"" },
    another: { type: "boolean", description: "true when the app is already connected and they asked to connect another account of it (a second Gmail, their work Slack too)" },
    service_from: { type: "string", description: "only for an email or calendar app the person didn't name in this task: the exact words in your memory recall that say they use it" },
    draft: { type: "object", description: "what you'd send or create once it's connected, shown on the card. An email: {to, cc?, subject, body}. An event: {title, start, end, timezone?, calendar?, guests?, location?} (start and end as ISO date-times with their offset, e.g. 2026-10-09T15:00:00-07:00; timezone an IANA name, theirs by default). Anything else (a message, a post, a task): {text}.",
      properties: { to: { type: "string" }, cc: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, title: { type: "string" }, start: { type: "string" }, end: { type: "string" },
        timezone: { type: "string" }, calendar: { type: "string" }, guests: { type: "array", items: { type: "string" } }, location: { type: "string" }, text: { type: "string" } } } }, required: ["app", "why"] } } };
export const CONNECT_TOOLS = [FIND_APP_TOOL, OFFER_CONNECT_TOOL];
export const CONNECT_TOOL_NAMES = new Set(CONNECT_TOOLS.map((t) => t.function.name));
export const CONNECT_LINES = { find_app: "looking through the apps it can connect", offer_connect: "asking you to connect an app" };

// ---------------- which service? (eval run2 10-07, gmail/which-email-provider) ----------------
// "Check my email for anything from my landlord" with no email app connected went straight to "Connect Gmail". Email and calendar
// have several common services, so an offer for one of them waits until the person has named the service (in this task: their
// words, an address at a provider like sam@outlook.com, or their pick from the choices card) or memory says it (service_from, checked against this
// turn's memory recall). Until then offer_connect answers ASK FIRST: ask which service with a small card, and end the turn.
// Any other address says nothing about their service: "email jordan@example.com …" is who it goes to, not where it's sent from (10-07).
const EMAIL_APPS_OFFER = new Set(["gmail", "outlook", "zoho_mail"]), CAL_APPS_OFFER = new Set(["googlecalendar", "outlook", "calendly", "cal"]);
const CAL_WORDS = /\b(calendar|meeting|event|appointment|schedul\w*|availability|free time|invite)\b/i;
const NAMED = {
  email: /\b(g ?mail|google ?mail|google|outlook|hotmail|live\.com|msn|office ?365|microsoft|exchange|yahoo|icloud|me\.com|mac\.com|apple|aol|proton ?(?:mail)?|fastmail|zoho|gmx)\b/i,
  calendar: /\b(google|gcal|g ?cal|outlook|microsoft|office ?365|exchange|teams|icloud|apple|calendly|cal\.com|fantastical|proton|zoho|yahoo)\b/i,
};
export const PROVIDER_CHOICES = { email: ["Gmail", "Outlook", "iCloud", "Yahoo", "Other"], calendar: ["Google Calendar", "Outlook", "iCloud", "Other"] };
// The kind of service an offer is for: "email" | "calendar" | null (not a several-services kind).
export function serviceKind(app, words = []) {
  const cal = CAL_APPS_OFFER.has(app), mail = EMAIL_APPS_OFFER.has(app);
  if (cal && mail) return words.some((w) => CAL_WORDS.test(String(w || ""))) ? "calendar" : "email";
  return mail ? "email" : cal ? "calendar" : null;
}
const normQ = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
// → the ASK FIRST text, or null when the offer may go ahead.
// used: the Composio slugs on their "Apps I use" list (apps-used.js). That list names their service when it has this app and no other
// app of the same kind (Google Account and not Outlook → Gmail is theirs); with both, it still asks.
export function serviceAsk(app, name, { words = [], memNote = "", serviceFrom = "", cards = false, used = null } = {}) {
  const kind = serviceKind(app, words); if (!kind) return null;
  if (words.some((w) => NAMED[kind].test(String(w || "")))) return null;   // they named a service (or gave an address) in this task
  const same = kind === "email" ? EMAIL_APPS_OFFER : CAL_APPS_OFFER;
  if (used?.has?.(app) && ![...same].some((x) => x !== app && used.has(x))) return null;   // their apps list says which
  const q = normQ(serviceFrom);
  if (q.length >= 6 && normQ(memNote).includes(q) && (q.includes(normQ(name)) || NAMED[kind].test(q))) return null;   // memory says which
  const choices = PROVIDER_CHOICES[kind];
  return `ASK FIRST: they didn't say which ${kind} service they use, and memory doesn't say, so nothing was shown. Don't assume ${name}. ` +
    (cards ? `Ask which one with a small card of choices (${choices.join(", ")}) and end your turn. ` : `Ask which one, naming a few likely ones (${choices.slice(0, -1).join(", ")}), and end your turn. `) +
    `When they pick, call offer_connect for that one (or find_app first if it's another service)${kind === "email" ? ", with your draft of the email if they asked you to send one" : ", with your draft of the event if they asked you to add one"}. If memory clearly says which one they use, pass service_from with those exact words from your memory recall.`;
}

const offerRow = (sql, session, app) => sql.exec("SELECT * FROM connect_offers WHERE session=? AND app=? ORDER BY id DESC LIMIT 1", String(session), app).toArray()[0] || null;
export function offerView(r) {
  const d = draftOf(r);
  return { id: r.id, at: r.at, app: r.app, name: r.name, why: r.why, logo: `https://logos.composio.dev/api/${r.app}`, kind: r.kind, reconnect: !!r.reconnect, status: r.status, turn: r.turn || null, session: r.session, ...(d ? { draft: d } : {}),
    ...(r.another ? { another: true } : {}), ...(r.email ? { email: r.email } : {}), ...(r.already ? { already: true } : {}) };
}
const draftOf = (r) => { if (!r?.draft) return null; try { return JSON.parse(r.draft); } catch { return null; } };

// ---------------- the draft ----------------
// → { draft } (null when none was given) | { error }. Shapes: { kind: "email", to, cc?, subject, body } | { kind: "event", title, start,
// end?, timezone?, calendar?, guests?, location? } | { kind: "text", text }. Nothing is cut short: the card shows all of it, so a
// draft too long to show is refused (the helper shortens it) rather than shown different from what would go.
export const DRAFT_LIMITS = { to: 1000, cc: 1000, subject: 400, body: 12000, title: 300, calendar: 120, location: 300, guest: 200, guests: 50, text: 12000 };
const dtext = (x) => String(x ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+$/gm, "").replace(/^\n+|\s+$/g, "");
const line = (x) => dtext(x).replace(/\s+/g, " ").trim();
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
export const validZone = (z) => { if (!z) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
export function normDraft(raw, { tz = "" } = {}) {
  if (raw == null || raw === "") return { draft: null };
  let d = raw; if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = { text: d }; } }
  if (!d || typeof d !== "object" || Array.isArray(d)) return { error: "error: draft must be an object: {to, subject, body} for an email, {title, start, end} for an event, or {text}." };
  const L = DRAFT_LIMITS, long = (k, v, n) => v.length > n ? `error: the draft's ${k} is too long to show on the card (${v.length} characters; at most ${n}). Shorten it, or leave the draft out and show it in your reply.` : null;
  const kind = String(d.kind || "").toLowerCase();
  const isMail = kind === "email" || (!kind && (d.to != null || d.subject != null || d.body != null));
  const isEvent = kind === "event" || (!kind && !isMail && (d.start != null || d.title != null));
  if (isMail) {
    const out = { kind: "email", to: line(Array.isArray(d.to) ? d.to.join(", ") : d.to), subject: line(d.subject), body: dtext(d.body) };
    const cc = line(Array.isArray(d.cc) ? d.cc.join(", ") : d.cc); if (cc) out.cc = cc;
    if (!out.to && !out.subject && !out.body) return { error: "error: the email draft is empty: give at least who it's to and what it says." };
    for (const k of ["to", "cc", "subject", "body"]) { const e = out[k] != null && long(k, out[k], L[k]); if (e) return { error: e }; }
    return { draft: out };
  }
  if (isEvent) {
    const out = { kind: "event", title: line(d.title), start: line(d.start) };
    if (!out.title) return { error: "error: the event draft needs a title." };
    if (!ISO_DAY.test(out.start)) return { error: `error: the event draft's start must be an ISO date or date-time with their offset, e.g. 2026-10-09T15:00:00-07:00 (got "${out.start.slice(0, 60)}").` };
    const end = line(d.end); if (end) { if (!ISO_DAY.test(end)) return { error: `error: the event draft's end must be an ISO date or date-time like its start (got "${end.slice(0, 60)}").` }; out.end = end; }
    const z = line(d.timezone || d.time_zone || d.tz); out.timezone = validZone(z) ? z : validZone(tz) ? tz : "";
    if (!out.timezone) delete out.timezone;
    const cal = line(d.calendar); if (cal) out.calendar = cal;
    const loc = line(d.location); if (loc) out.location = loc;
    const g = (Array.isArray(d.guests) ? d.guests : typeof d.guests === "string" ? d.guests.split(/[,;\n]/) : []).map(line).filter(Boolean);
    if (g.length > L.guests) return { error: `error: the event draft has ${g.length} guests; the card shows at most ${L.guests}.` };
    if (g.length) out.guests = g.map((x) => x.slice(0, L.guest));
    for (const k of ["title", "calendar", "location"]) { const e = out[k] != null && long(k, out[k], L[k]); if (e) return { error: e }; }
    return { draft: out };
  }
  const text = dtext(d.text ?? d.message ?? d.content);
  if (!text) return { error: "error: draft must be {to, subject, body} for an email, {title, start, end} for an event, or {text} for anything else." };
  const e = long("text", text, L.text); if (e) return { error: e };
  const out = { kind: "text", text }; const t = line(d.title); if (t) out.title = t.slice(0, L.title);
  return { draft: out };
}
// The draft in plain words, for the helper (the tool's answer and the note back after they connect).
export function draftWords(d) {
  if (!d) return "";
  if (d.kind === "email") return `the email to ${d.to || "(no recipient yet)"}${d.cc ? `, cc ${d.cc}` : ""}, subject "${d.subject || "(none)"}", body:\n"""\n${d.body || ""}\n"""`;
  if (d.kind === "event") return `the event "${d.title}", ${d.start}${d.end ? ` to ${d.end}` : ""}${d.timezone ? ` (${d.timezone})` : ""}${d.calendar ? `, on the ${d.calendar} calendar` : ""}${d.location ? `, at ${d.location}` : ""}${d.guests?.length ? `, guests ${d.guests.join(", ")}` : ", no guests"}`;
  return `this:\n"""\n${d.text}\n"""`;
}
const draftShort = (d) => d.kind === "email" ? `the email to ${d.to || "(no recipient yet)"} ("${d.subject || "no subject"}")` : d.kind === "event" ? `the event "${d.title}" (${d.start})` : "your draft";
export function offersView(sql, session) {
  try { return sql.exec("SELECT * FROM connect_offers WHERE session=? ORDER BY id", String(session)).toArray().map(offerView); } catch { return []; }
}
const offeredText = (r) => r.status === "dismissed" ? "they said Not now" : r.status === "connected" ? "they connected it" : "the card is still on screen";
const cleanWhy = (s) => { let t = String(s || "").replace(/\*\*|__|`|#+\s/g, "").replace(/\s+/g, " ").trim(); if (t.length > 160) t = t.slice(0, 157).replace(/\s+\S*$/, "") + "…"; return t; };

async function findApp(res, a, ctx) {
  const q = String(a.query || "").trim(); if (!q) return "error: say which app (query), e.g. \"YouTube\".";
  const list = await catalog(res.env);
  // The person's own custom MCP servers (custom-mcp.js) that the words name: this workspace's enabled, synced ones only.
  let mine = []; try { mine = await customMentions(res.env, res.get("tenant"), q); } catch {}
  { const raw = q.match(/custom_h[cp]_[a-z2-7]{16}/i)?.[0]; if (raw) { const u = (await customUsable(res.env, res.get("tenant"))).get(raw.toLowerCase()); if (!u) return CUSTOM_DENIED; if (!mine.includes(u)) mine.push(u); } }
  if (!list.length && !mine.length) return "error: the app list couldn't be loaded just now. Try again in a minute.";
  const hits = list.length ? searchApps(list, q) : [], named = hits.filter((h) => h.match === "name");
  const conns = named.length ? await res.conns() : [];
  const session = ctx.session || null, tenant = res.get("tenant");
  const off = (await offersFlag(res.env, tenant)) === "off";
  const out = named.map(({ a: x }) => {
    const kind = connectKind(x), st = statusFor(x.s, conns), prev = session ? offerRow(res.sql, session, x.s) : null;
    return { app: x.s, name: x.n, what: oneLine(x), status: statusText(st, kind), connects: byokText(x) || KIND_TEXT[kind], ...(prev ? { offered_in_this_task: offeredText(prev) } : {}), _k: kind, _st: st.status, _p: prev, _x: x };
  });
  const own = mine.map((r) => ({ app: r.slug.toLowerCase(), name: displayOf(r), what: "a custom MCP server the person added in Settings → Advanced", status: "connected", connects: "already added by the person; nothing to connect" }));
  const related = hits.filter((h) => h.match === "related").map(({ a: x }) => `${x.n} (${x.s})`);
  let next;
  const top = out[0];
  const browser = async () => {
    const words = normQuery(q).split(" ").filter((w) => w.length >= 3), sites = await loginSites(res.env, tenant).catch(() => []);
    const saved = sites.find((s) => words.some((w) => s.toLowerCase().includes(w)));
    return `Tell them plainly it isn't available as a connection yet, and offer to do it in the browser instead (browser_task${saved ? `; they saved a login for ${saved.replace(/ \(\d+ accounts\)$/, "")}, so sign in with browser_fill_login` : "; if the site needs a sign-in and there's no saved login, use browser_handoff so they sign in themselves"}).`;
  };
  if (own.length) next = `${own[0].name} is the person's own custom MCP server and it is connected: use it (app_actions with app "${own[0].app}"). Don't offer to connect it.${top ? ` ${top.name} (the built-in app, ${top._st === "connected" ? "connected" : top._st === "expired" ? "its connection expired" : "not connected"}) is a different thing: never describe the custom server as expired or not connected because of it; mention the built-in one only if it matters.` : ""}`;
  else if (!top) next = `No app called "${q}" can be connected.${related.length ? ` Related apps (only if one clearly is what they meant): ${related.join(", ")}.` : ""} ${await browser()}`;
  else if (top._k === "soon") next = `${top.name} isn't available as a connection yet. ${await browser()}`;
  else if (top._k === "retired") next = `${RETIRED_NOTE} Don't offer it; offer the individual app instead (find_app it).`;
  else if (top._k === "builtin") next = `${top.name} is built in: use it right away (app_actions with app "${top.app}"), nothing to connect.`;
  else if (top._st === "connected") next = `${top.name} is connected: just use it${top.app === "gmail" ? " (gmail_search / gmail_read / gmail_draft)" : top.app === "googlecalendar" ? " (calendar_events / calendar_add)" : ` (app_actions with app "${top.app}")`}. Don't offer to connect it, unless they asked to connect another account of it (a second ${top.name}): then call offer_connect with app "${top.app}" and another: true, and the card shows right in the chat.`;
  else if (top._p) next = `You already offered ${top.name} in this task (${offeredText(top._p)}): don't offer it again.${top._p.status === "dismissed" ? " Do it another way if you can (e.g. the browser), or leave it." : ""}`;
  else if (off) next = `${top.name} isn't connected, and the person turned off connection suggestions: don't call offer_connect. If it matters, mention once in a few words that they can connect it in Apps.`;
  else if (top._st !== "expired" && serviceAsk(top.app, top.name, { words: taskWords(res, ctx), memNote: ctx.memNote || "", used: res._usedSlugs })) {
    const kind = serviceKind(top.app, taskWords(res, ctx));
    next = `${top.name} isn't connected, and they haven't said which ${kind} service they use: don't assume ${top.name}. Ask which one first${res.genuiOn?.() ? ` with a small card of choices (${PROVIDER_CHOICES[kind].join(", ")})` : ` (${PROVIDER_CHOICES[kind].slice(0, -1).join(", ")} or another)`} and end your turn; then offer_connect their pick.`;
  }
  else next = `${top.name} ${top._st === "expired" ? "was connected but the connection expired" : "isn't connected"}${res._usedSlugs?.has?.(top.app) ? " (it's on their Apps they use list)" : ""}: if it would help with what they asked, call offer_connect with app "${top.app}" (once in this task).${top._k === "key" ? ` It needs ${byokText(top._x) ? `their own API key from ${byokInfo(top.app, top.name, { cats: top._x.c || [] }).provider}, which they pay for directly` : "an API key from them"}, so say so in your line.` : ""}`;
  return JSON.stringify({ query: q, matches: [...own, ...out.map(({ _k, _st, _p, _x, ...r }) => r)], ...(related.length && !top ? { related } : {}), next });
}

// ---------------- another account of a connected app ----------------
// The person's own words in this task ask to connect one more account: a connect word and an "another" word ("connect another
// gmail account", "add my work email too", "can I link a second Slack"), or, when the helper says another: true, a connect word with
// the app, an account or an email/calendar word ("hook up my wife's gmail"). Only an ask shows the card: never on the helper's own idea.
const CONNECT_WORD = /\b(connect\w*|add(?:ing|ed)?|link(?:ing|ed)?|hook(?:ing|ed)? (?:it )?up|hook up|sign(?:ing)? (?:in|into|up)|log(?:ging)? ?in(?:to)?|set(?:ting)? up|attach\w*|plug\w* in)\b/i;
const ANOTHER_WORD = /\b(another|second|2nd|third|3rd|other|additional|extra|new|different|one more|more|too|also|as well|both|multiple|several)\b/i;
const ACCOUNT_WORD = /\b(accounts?|e-?mails?|inbox(?:es)?|mail|calendars?|address(?:es)?|profiles?|workspaces?|logins?)\b/i;
export function asksForAnother(words = [], x = {}, flagged = false) {
  const name = String(x.n || "").toLowerCase(), slug = String(x.s || "").toLowerCase();
  const nick = Object.entries(ALIASES).filter(([, v]) => v === slug).map(([k]) => k);
  const mentions = (w) => { const t = ` ${w.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `; return [name, slug, ...nick].some((n) => n && t.includes(` ${n.replace(/[^a-z0-9]+/g, " ").trim()} `)) || ACCOUNT_WORD.test(w); };
  return words.map((w) => String(w || "")).some((w) => CONNECT_WORD.test(w) && mentions(w) && (ANOTHER_WORD.test(w) || flagged));
}
const acctList = (conns, app) => { const e = conns.filter((c) => c.app === app && c.status === "connected").map((c) => c.email).filter(Boolean); return e.length ? ` (${e.slice(0, 4).join(", ")})` : ""; };

async function offerConnect(res, a, ctx) {
  if (ctx.kind === "helper") return "error: offer_connect isn't available to a background helper. Say in your report which app would help; the helper who started you can offer it.";
  if (!ctx.session || ctx.kind !== "chat") return "error: offer_connect only works while you're talking with the person in a task. Mention the app in your report instead.";
  const want = String(a.app || "").trim(); if (!want) return "error: which app? Pass its id from find_app (e.g. youtube).";
  if (isCustomSlug(want)) return CUSTOM_DENIED;   // a custom MCP server is added in Settings → Advanced, never through a Connect card
  const list = await catalog(res.env);
  const all = [...list, ...RETIRED_ROWS], wc = compact(want);
  let x = all.find((r) => r.s === want.toLowerCase() || r._s === wc || r._c === wc);
  if (!x) { const h = searchApps(list, want, 1)[0]; if (h && h.score >= 85) x = h.a; }
  if (!x) return `error: no app called "${want}" in the catalog. Call find_app first; if nothing matches, it isn't available as a connection, so offer the browser instead.`;
  const kind = connectKind(x);
  if (kind === "retired") return `NOT OFFERED: ${RETIRED_NOTE}`;
  if (kind === "soon") return `NOT OFFERED: ${x.n} isn't available as a connection yet. Tell them plainly, and offer to do it in the browser instead (browser_task; browser_fill_login if they saved a login for it, else browser_handoff).`;
  if (kind === "builtin") return `NOT OFFERED: ${x.n} is built in, nothing to connect. Use it right away with app_actions (app "${x.s}").`;
  const conns = await res.conns(true), st = statusFor(x.s, conns);
  // Already connected: a card only for another account, and only when they asked for one (their words, checked).
  const another = st.status === "connected" && !st.via;
  if (st.status === "connected" && (st.via || !asksForAnother(taskWords(res, ctx), x, a.another === true)))
    return `NOT OFFERED: ${x.n} is already connected${acctList(conns, x.s)}. Just use it. Only if they ask to connect another account of it (a second ${x.n}), call offer_connect with another: true.`;
  // Email / calendar: which service is theirs? (above). An expired or connected one is theirs already.
  if (st.status === "not connected") { const ask = serviceAsk(x.s, x.n, { words: taskWords(res, ctx), memNote: ctx.memNote || "", serviceFrom: a.service_from, cards: !!res.genuiOn?.(), used: res._usedSlugs }); if (ask) return ask; }
  const tenant = res.get("tenant");
  if (!another && (await offersFlag(res.env, tenant)) === "off") return `NOT OFFERED: the person turned off connection suggestions. Don't offer apps; do it another way if you can, or mention once in a few words that they can connect ${x.n} in Apps.`;
  const prev = offerRow(res.sql, ctx.session, x.s);
  if (prev && !(another && prev.status === "connected")) return `NOT OFFERED: you already offered ${x.n} in this task (${offeredText(prev)}). Don't offer it again.${prev.status === "dismissed" ? ` Do it another way if you can (e.g. the browser), or leave it. If they've changed their mind and want to connect it, tell them they can in Apps.` : ""}`;
  const nd = normDraft(a.draft, { tz: res.tz?.() || "" }); if (nd.error) return `${nd.error} Nothing was shown.`;
  const draft = nd.draft;
  const why = cleanWhy(a.why) || `So I can use ${x.n} for you.`, now = Date.now();
  const known = conns.filter((c) => c.app === x.s && c.status === "connected").map((c) => ({ id: String(c.id || ""), email: String(c.email || "") }));
  res.sql.exec("INSERT INTO connect_offers (at,session,turn,app,name,why,kind,reconnect,via,draft,another,known) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", now, String(ctx.session), ctx.turn || null, x.s, x.n, why, kind, st.status === "expired" ? 1 : 0, ctx.viaText ? "text" : "app", draft ? JSON.stringify(draft) : null, another ? 1 : 0, JSON.stringify(known));
  const row = offerRow(res.sql, ctx.session, x.s), view = offerView(row);
  ctx.emit?.({ t: "connect_offer", offer: view });
  let link = "";
  if (ctx.viaText) {
    const t = await res.env.DB.prepare("SELECT slug FROM tenants WHERE id=?").bind(tenant).first().catch(() => null);
    if (t?.slug) link = `${appLink(res.env, t.slug)}?appinfo=${encodeURIComponent(x.s)}&offer=${encodeURIComponent(`${res.get("channel")}.${row.id}`)}`;
  }
  const verb = draft?.kind === "event" ? "create" : "send";
  return `Card shown: "${another ? `Connect another ${x.n} account` : `Connect ${x.n}?`}" with your line "${why}", Connect and Not now${draft ? `, and under them ${draftShort(draft)}, in full` : ""}. ` +
    (ctx.viaText ? `This conversation is by text, so the card is only in the app: put this link in your reply so they can connect from their phone${draft ? " (the page shows the draft too)" : ""}: ${link || "(open 1Helm → Apps)"} . ` : "") +
    `${kind === "key" ? `Connecting ${x.n} ${byokText(x) || "needs an API key from them"} (pasted on a secure page). ` : ""}` +
    `End your turn now with one short line (don't repeat the card${draft ? " or the draft" : ""}); don't keep working on the part that needs it. When they connect, you get a note${another ? " naming the new account" : ""} and carry on.` +
    (another ? ` Connect opens ${x.n}'s own sign-in for a new account: they sign in to the other account there (if they're signed in to the one already connected, they pick "use another account").` : "") +
    (draft ? ` Connection only supplies access, not new authorization. If their original request explicitly asked you to ${verb} this exact ordinary action, carry it out after connecting without a second yes. A draft-only request stays a draft. Preserve the requested account, recipients and content; ask if a consequential detail changed or was never authorized.` : "") +
    " If they tap Not now, it's not connected: don't offer it again in this task.";
}

export async function connectTool(res, name, a, ctx = {}) {
  try {
    if (name === "find_app") return await findApp(res, a, ctx);
    if (name === "offer_connect") return await offerConnect(res, a, ctx);
  } catch (e) { return `error: ${String(e.message || e).slice(0, 300)}`; }
  return "error: unknown connect tool";
}

// ---------------- "Your Composio sign-in ended" (Self-managed) ----------------
// The Reconnect card: the same card as any offer (app "composio", reconnect), made by 1Helm itself (resident.js cmpGate) when a
// Self-managed workspace's sign-in to its own Composio account ended. Connect runs the Composio sign-in again (index.js /api/apps/connect
// app "composio"); back in the task the helper gets a note and carries on. One card per task; a later ending in the same task shows it again.
export const COMPOSIO_WHY = `${ENDED_LINE}. Sign in again so I can use your apps.`;
export function composioSigninOffer(res, ctx = {}) {
  if (!ctx.session || ctx.kind !== "chat") return null;   // background helpers and unattended runs: the helper says it in its report
  const prev = offerRow(res.sql, ctx.session, "composio");
  if (prev?.status === "pending") return offerView(prev);   // already on screen
  if (prev) res.sql.exec("UPDATE connect_offers SET status='pending', at=?, turn=?, why=?, reconnect=1, decided_at=NULL WHERE id=?", Date.now(), ctx.turn || null, COMPOSIO_WHY, prev.id);
  else res.sql.exec("INSERT INTO connect_offers (at,session,turn,app,name,why,kind,reconnect,via) VALUES (?,?,?,?,?,?,?,?,?)", Date.now(), String(ctx.session), ctx.turn || null, "composio", "Composio", COMPOSIO_WHY, "oauth", 1, ctx.viaText ? "text" : "app");
  const view = offerView(offerRow(res.sql, ctx.session, "composio"));
  ctx.emit?.({ t: "connect_offer", offer: view });
  return view;
}
const composioNote = () => "(Context note, not from the person: they just signed in to their own Composio account again from the card you showed. Their apps work again: carry on with what they asked. Continue only the originally requested ordinary work, without asking for another confirmation. Connecting grants access, not permission for new actions. Payments and API-key operations retain protected approval.)";

// ---------------- the person's taps ----------------
// Resident side. op: dismiss (Not now). → { ok, offer } | { error }
// One offer, for the page a texted offer's link opens (its draft under Connect). → { offer } | { error }
export function offerGet(res, id) {
  const r = res.sql.exec("SELECT * FROM connect_offers WHERE id=?", Number(id)).toArray()[0];
  return r ? { offer: offerView(r) } : { error: "no such offer" };
}
export function offerAct(res, id, op) {
  const r = res.sql.exec("SELECT * FROM connect_offers WHERE id=?", Number(id)).toArray()[0];
  if (!r) return { error: "no such offer" };
  if (op !== "dismiss") return { error: "op must be dismiss" };
  if (r.status === "pending") res.sql.exec("UPDATE connect_offers SET status='dismissed', decided_at=? WHERE id=?", Date.now(), r.id);
  const o = offerView(res.sql.exec("SELECT * FROM connect_offers WHERE id=?", r.id).one());
  res.liveTurn?.(r.session)?.emit?.({ t: "connect_offer_done", offer: o });
  return { ok: true, offer: o };
}
// Another account: the note names the account that connected (or says it was one they already had) and its siblings.
const anotherNote = (o, accounts = []) => o.already
  ? `(Context note, not from the person: from the "Connect another ${o.name} account" card you showed, they signed in to ${o.email}, which was already connected, so no new account was added. ` +
    `Tell them that in one short line. If they meant a different account, they choose it on ${o.name}'s sign-in page ("use another account"); you can show the card again with offer_connect (another: true). Then carry on with anything else they asked.)`
  : `(Context note, not from the person: they just connected another ${o.name} account from the card you showed: ${o.email || "(no email shown)"}. ` +
    `${accounts.length > 1 ? `${o.name} now has ${accounts.length} accounts: ${accounts.join(", ")}. ` : ""}Tell them in one short line that ${o.email || "it"} is connected. ` +
    "If they haven't said what it's for, offer to save a note on it (note_account) so you know when to use which; if they already said (\"my work email\"), save that note now. " +
    `Carry on with anything else they asked; with several accounts, pass account to say which one. Their original request authorizes ordinary actions, not unrelated work. Payments and API-key operations keep protected approval.)`;
export const connectedNote = (o, accounts) => o.another ? anotherNote(o, accounts) : `(Context note, not from the person: they just connected ${o.name} from the card you showed${o.why ? ` ("${o.why}")` : ""}${o.email ? `; the account is ${o.email}` : ""}. ` +
  `Carry on with what they asked, using ${o.name} now${o.app === "gmail" ? " (gmail_search / gmail_read / gmail_draft / gmail_send)" : o.app === "googlecalendar" ? " (calendar_events / calendar_add)" : ` (app_actions with app "${o.app}")`}. ` +
  (o.draft ? `The card showed your draft, ${draftWords(o.draft)}\n` +
    "Connection only supplies access, not new authorization. If their original request explicitly asked you to send or create this exact ordinary action, complete it without a second yes. A draft-only request stays a draft. Check the intended account and any calendar clash; preserve the requested recipients, content and scope. Ask only if a consequential detail is missing or changed. " : "") +
  "Payments and API-key operations keep protected approval; purchases use Link.)";
// "Never send just because they connected": in the turn the connected note starts, nothing the person said yet, a send / create /
// change with person_confirmed is refused (resident.js localTool). Their yes comes as their own message, a new turn or a steer.
// Resident strips the obsolete person_confirmed flag before this check. Ordinary actions follow
// the original user request; payment/key operations still pass confirmGate. Keep this legacy
// guard for older direct callers: a model-set flag alone cannot turn connection into authority.
const CONNECT_WRITES = new Set(["gmail_send", "calendar_add", "app_run", "app_proxy"]);
export function connectWriteBlock(ctx, name, a) {
  if (!CONNECT_WRITES.has(name) || a?.person_confirmed !== true || ctx?.handoffFrom !== "connect" || personWords(ctx).length) return null;
  return `NOT DONE: they just connected the app; that isn't a yes to ${name === "calendar_add" ? "create the event" : name === "gmail_send" ? "send the email" : "send, create or change anything"}, and they haven't said anything since. ` +
    "Show them exactly what you'll do (the draft from the card, with any changes) and ask; do it once they say yes. If this was only a read, call again without person_confirmed.";
}
// Back from the app's sign-in with from=offer: only if the app really is connected now does the card turn connected and the helper
// get its note (a handoff into the task: it joins a running turn or starts one). → { ok, offer, session } | { error }
export async function offerConnected(res, id, app) {
  let accounts = [];
  const r = res.sql.exec("SELECT * FROM connect_offers WHERE id=?", Number(id)).toArray()[0];
  if (!r || (app && r.app !== app)) return { error: "no such offer" };
  if (r.status === "connected") return { ok: true, offer: offerView(r), session: r.session, already: true };
  if (r.app === "composio") {   // the Reconnect card: done when the Composio sign-in works again
    if ((await selfStatus(res.env, res.get("tenant"))).status !== "ok") return { error: "not connected", offer: offerView(r), session: r.session };
    res._conns = null;
  } else {
    const conns = res.env.COMPOSIO_KEY ? await transportFor(res.env, res.get("tenant")).listConnections({ fresh: true }).catch(() => null) : null;
    if (conns) res._conns = { at: Date.now(), list: conns };
    if (!conns || statusFor(r.app, conns).status !== "connected") return { error: "not connected", offer: offerView(r), session: r.session };
    // Which account connected: one that wasn't there when the card was made (newest first). Another account: none new = not yet.
    let known = []; try { known = JSON.parse(r.known || "[]"); } catch {}
    const on = conns.filter((c) => c.app === r.app && c.status === "connected"), ids = new Set(known.map((k) => k.id));
    const fresh = on.filter((c) => !ids.has(String(c.id || "")))[0] || null;
    if (r.another && !fresh) return { error: "not connected", offer: offerView(r), session: r.session };
    const email = String(fresh?.email || fresh?.label || ""), already = !!(r.another && email && known.some((k) => k.email && k.email.toLowerCase() === email.toLowerCase()));
    res.sql.exec("UPDATE connect_offers SET email=?, already=? WHERE id=?", email || null, already ? 1 : 0, r.id);
    accounts = on.map((c) => c.email || c.label || c.id).filter(Boolean);
  }
  res.sql.exec("UPDATE connect_offers SET status='connected', decided_at=? WHERE id=?", Date.now(), r.id);
  const o = offerView(res.sql.exec("SELECT * FROM connect_offers WHERE id=?", r.id).one());
  res.liveTurn?.(r.session)?.emit?.({ t: "connect_offer_done", offer: o });
  let h = null; try { h = res.handoff(r.session, { text: o.app === "composio" ? composioNote() : connectedNote(o, accounts), from: { type: "connect", app: o.app, title: o.app === "composio" ? "Signed in to Composio" : o.another ? `${o.already ? "Already connected" : "Connected"}: ${o.email || `another ${o.name} account`}` : `${o.name} connected` } }); } catch (e) { console.log("connect offer handoff", e.message); }
  return { ok: true, offer: o, session: r.session, handoff: h?.mode || null };
}

// ---------------- Worker routes (index.js) ----------------
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const CH = /^[a-z0-9][a-z0-9-]{0,62}$/;
const resOf = (env, t, ch) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${ch}`));
// POST /w/<slug>/api/connect-offer { op: "dismiss", ch, id } | { op: "off" } | { op: "on" }. channelOk(slug) → is it this workspace's channel.
// GET  /w/<slug>/api/connect-offer?ch=&id= → { offer } (the page a texted offer's link opens shows its draft).
export async function connectOfferApi(req, env, t, channelOk) {
  if (req.method === "GET") {
    const u = new URL(req.url), ch = String(u.searchParams.get("ch") || ""), id = Number(u.searchParams.get("id"));
    if (!CH.test(ch) || !(id > 0) || !(await channelOk(ch))) return json({ error: "no such offer" }, 404);
    const r = await resOf(env, t, ch).connectOfferGet(id);
    return json(r, r.error ? 404 : 200);
  }
  const b = await boundedJson(req), op = String(b.op || "");
  if (op === "off" || op === "on") return json(await setOffersFlag(env, t.id, op === "off"));
  if (op !== "dismiss") return json({ error: "op must be dismiss, off or on" }, 400);
  const ch = String(b.ch || ""); if (!CH.test(ch) || !(await channelOk(ch))) return json({ error: "no such channel" }, 404);
  const r = await resOf(env, t, ch).connectOfferAct(Number(b.id), op);
  return json(r, r.error ? 404 : 200);
}
// The callback for a Connect tapped on an offer card (from=offer&ch=&oid=), checked against the channel list; ok = Composio said success.
export const offerCallbackQuery = (b) => { const ch = String(b?.offer?.ch || ""), id = Number(b?.offer?.id); return CH.test(ch) && id > 0 ? `&ch=${ch}&oid=${id}` : ""; };
export async function connectOfferDone(env, t, origin, url, channelOk) {
  const app = String(url.searchParams.get("app") || "").replace(/[^a-z0-9_]/g, ""), ok = url.searchParams.get("status") !== "failed";
  const ch = String(url.searchParams.get("ch") || ""), oid = Number(url.searchParams.get("oid"));
  let hash = "", st = ok ? "connected" : "failed";
  if (CH.test(ch) && oid > 0 && (await channelOk(ch))) {
    // Signed in to an account that was already connected (same email, Managed): keep one, as Settings' /apps/done does.
    if (ok && app && env.COMPOSIO_KEY) { try { await tidyAfterConnect(env, t.id, app, String(url.searchParams.get("connected_account_id") || url.searchParams.get("connectedAccountId") || "")); } catch (e) { console.log("tidy after offer connect", app, e.message); } }
    const r = ok ? await resOf(env, t, ch).connectOfferConnected(oid, app).catch((e) => ({ error: e.message })) : null;
    if (r?.session) hash = `#/${ch}/s/${r.session}`;
    if (ok && r?.error) st = "pending";
  }
  return Response.redirect(`${origin}/w/${t.slug}/app?app=${app}&appst=${st}&from=offer${hash}`, 302);
}
