import { boundedJson } from "../bounded-body.js";
// "Apps I use" (Captain 10-08): which apps the person says they use, picked in Get to know you ("Do you use any of these apps?",
// interview.js), in Settings → Connected accounts → Apps I use, or told to the helper (the apps_i_use tool). A heads-up, never a
// to-do: the helper knows they use these, so when one comes up it checks whether it's connected and, if not, offering the Connect
// card (offer_connect) counts as relevant rather than pushy. Nothing is connected or offered because of the list alone.
// Stored per account in D1 tenant_flags k='apps_used' (no migration: the table is the account's small key/value store, and account
// deletion clears it with every other tenant_id table): v = JSON { apps: [key…], names: {extra slug: name}, none: bool, at, src }.
// A key is an option below (most are one Composio app; "google" and "microsoft365" are a few) or, for an app the person named that
// isn't an option (told to the helper), its catalog slug, with its name kept in names.
// Used in three places, all model-agnostic plain text: the per-person block's apps line (resident.js appsLine: "Apps they use: Slack
// (connected), Notion (not connected)"; changes only when the list or a connection does, so the cached prefix holds), the
// integration hint (integration-hint.js: their apps match more readily), and the which-email/calendar-service ask (connect-offer.js).
import { statusFor, searchApps, appCatalog, connectKind } from "./connect-offer.js";

// The options, most used first (the first TOP show without searching). k: key; n: label; apps: Composio slugs; logo: the slug whose
// logo the chip shows; short: each app's short name in the apps line (only for groups); also: other words that mean it.
// Every slug here is one-click (o=1) or key-connect in both catalog files, never Soon (test/apps-used.test.mjs checks). Twitter/X,
// TikTok and Spotify are left out: they can't be connected yet.
export const APP_OPTIONS = [
  { k: "google", n: "Google Account", apps: ["gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "googleslides"], logo: "googlesuper",
    short: { gmail: "Gmail", googlecalendar: "Calendar", googledrive: "Drive", googledocs: "Docs", googlesheets: "Sheets", googleslides: "Slides" }, also: ["google", "gmail", "google calendar", "google drive", "google docs", "google sheets", "google slides", "gcal", "gdrive", "g suite", "google workspace"] },
  { k: "outlook", n: "Outlook", apps: ["outlook"], also: ["hotmail", "microsoft outlook", "outlook email", "outlook calendar"] },
  { k: "microsoft365", n: "Microsoft 365", apps: ["one_drive", "excel", "share_point"], logo: "one_drive", short: { one_drive: "OneDrive", excel: "Excel", share_point: "SharePoint" },
    also: ["onedrive", "one drive", "office 365", "office", "excel", "sharepoint", "microsoft office", "ms office"] },
  { k: "microsoft_teams", n: "Microsoft Teams", apps: ["microsoft_teams"], also: ["teams", "ms teams"] },
  { k: "slack", n: "Slack", apps: ["slack"] },
  { k: "zoom", n: "Zoom", apps: ["zoom"] },
  { k: "canva", n: "Canva", apps: ["canva"] },
  { k: "notion", n: "Notion", apps: ["notion"] },
  { k: "linkedin", n: "LinkedIn", apps: ["linkedin"] },
  { k: "youtube", n: "YouTube", apps: ["youtube"], also: ["yt"] },
  { k: "instagram", n: "Instagram for Business", apps: ["instagram"], also: ["instagram", "insta", "ig"] },
  { k: "facebook", n: "Facebook for Business", apps: ["facebook"], also: ["facebook", "fb", "facebook pages"] },
  { k: "whatsapp", n: "WhatsApp Business", apps: ["whatsapp"], also: ["whatsapp"] },
  { k: "reddit", n: "Reddit", apps: ["reddit"] },
  { k: "stripe", n: "Stripe", apps: ["stripe"] },
  { k: "shopify", n: "Shopify", apps: ["shopify"] },
  { k: "quickbooks", n: "QuickBooks", apps: ["quickbooks"], also: ["quick books", "qbo"] },
  { k: "asana", n: "Asana", apps: ["asana"] },
  { k: "trello", n: "Trello", apps: ["trello"] },
  { k: "monday", n: "monday.com", apps: ["monday"], also: ["monday", "monday com"] },
  { k: "clickup", n: "ClickUp", apps: ["clickup"], also: ["click up"] },
  { k: "jira", n: "Jira", apps: ["jira"] },
  { k: "github", n: "GitHub", apps: ["github"], also: ["git hub"] },
  { k: "hubspot", n: "HubSpot", apps: ["hubspot"], also: ["hub spot"] },
  { k: "salesforce", n: "Salesforce", apps: ["salesforce"] },
  { k: "airtable", n: "Airtable", apps: ["airtable"] },
  { k: "figma", n: "Figma", apps: ["figma"] },
  { k: "dropbox", n: "Dropbox", apps: ["dropbox"] },
  { k: "calendly", n: "Calendly", apps: ["calendly"] },
  { k: "todoist", n: "Todoist", apps: ["todoist"] },
];
export const TOP = 12;   // shown first; the rest behind search / "More apps"
export const NONE = "none";
const BY_KEY = new Map(APP_OPTIONS.map((o) => [o.k, o]));
const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SLUG = /^[a-z0-9][a-z0-9_]{0,63}$/;
export const optionOf = (k) => BY_KEY.get(String(k)) || null;
// What the app shows for the options (interview card and Settings): plain JSON.
export const optionsView = () => APP_OPTIONS.map((o, i) => ({ v: o.k, label: o.n, logo: o.logo || o.apps[0], ...(i < TOP ? { top: true } : {}), ...(o.short ? { covers: Object.values(o.short).join(", ") } : {}) }));

// ---- storage ----
const EMPTY = { apps: [], names: {}, none: false, at: 0, src: "" };
export function parseUsed(v) {
  let j = null; try { j = JSON.parse(v || ""); } catch {}
  if (!j || typeof j !== "object") return { ...EMPTY, answered: false };
  const apps = Array.isArray(j.apps) ? [...new Set(j.apps.map(String).filter((k) => BY_KEY.has(k) || SLUG.test(k)))].slice(0, 60) : [];
  const names = {}; for (const k of apps) if (!BY_KEY.has(k)) names[k] = String(j.names?.[k] || k).replace(/[\u0000-\u001f]/g, "").slice(0, 60);
  return { apps, names, none: !apps.length && !!j.none, at: Number(j.at) || 0, src: String(j.src || "").slice(0, 20), answered: true };
}
export async function getAppsUsed(env, tid) {
  try { const r = await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k='apps_used'").bind(String(tid)).first(); return r ? parseUsed(r.v) : { ...EMPTY, answered: false }; }
  catch { return { ...EMPTY, answered: false }; }
}
// apps: option keys (anything else is dropped) plus extras { slug: name } already checked against the catalog by the caller.
export function normalizeUsed({ apps = [], extras = {}, none = false } = {}) {
  const keys = [...new Set((Array.isArray(apps) ? apps : []).map(String))];
  const out = keys.filter((k) => BY_KEY.has(k)), names = {};
  for (const k of keys) if (!BY_KEY.has(k) && extras[k] && SLUG.test(k) && !APP_OPTIONS.some((o) => o.apps.includes(k))) { out.push(k); names[k] = String(extras[k]).slice(0, 60); }
  return { apps: out.slice(0, 60), names, none: !out.length && !!none };
}
export async function setAppsUsed(env, tid, used, src = "settings") {
  const v = { ...normalizeUsed(used), at: Date.now(), src };
  await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,'apps_used',?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at")
    .bind(String(tid), JSON.stringify(v), v.at).run();
  return parseUsed(JSON.stringify(v));
}
// Every Composio slug their list covers (the hint's prior, the which-service ask).
export function usedSlugs(used) {
  const s = new Set(); for (const k of used?.apps || []) { const o = BY_KEY.get(k); if (o) o.apps.forEach((a) => s.add(a)); else s.add(k); } return s;
}
export const usedName = (used, k) => BY_KEY.get(k)?.n || used?.names?.[k] || k;

// ---- the apps line (in the per-person block, next to the connected apps) ----
// "Apps they use (they told 1Helm): Google Account (Gmail connected; Calendar, Drive, Docs, Sheets, Slides not connected), Slack (connected), Notion (not connected)."
export function appsUsedLine(used, conns = []) {
  if (!used?.answered) return "";
  if (!used.apps.length) return used.none ? "Apps they use: none of the common ones (they said so)." : "";
  const st = (slug) => { const s = statusFor(slug, conns).status; return s === "connected" ? "connected" : s === "expired" ? "expired" : "not connected"; };
  const parts = used.apps.map((k) => {
    const o = BY_KEY.get(k); if (!o) return `${used.names[k] || k} [${k}] (${st(k)})`;
    if (o.apps.length === 1) return `${o.n} [${o.apps[0]}] (${st(o.apps[0])})`;
    const by = {}; for (const a of o.apps) (by[st(a)] ||= []).push(o.short?.[a] || a);
    const ks = Object.keys(by);
    if (ks.length === 1) return `${o.n} (${by[ks[0]].join(", ")}: ${ks[0] === "not connected" ? "none connected" : `all ${ks[0]}`})`;
    return `${o.n} (${["connected", "expired", "not connected"].filter((x) => by[x]).map((x) => `${by[x].join(", ")} ${x}`).join("; ")})`;
  });
  return `Apps they use (they told 1Helm; a heads-up, not a to-do): ${parts.join(", ")}.`;
}

// ---- the helper's tool: they say they use (or stopped using) an app ----
export const APPS_USED_TOOL = { type: "function", function: { name: "apps_i_use", description:
  "Update the list of apps the person says they use (the \"Apps they use\" line in your context; they also edit it in Settings → Connected accounts → Apps I use). " +
  "Only when they tell you they use an app, stopped using one, or ask you to change the list (\"I use Trello too\", \"I don't use Slack anymore\"). It never connects " +
  "or offers anything: if they want one connected, use offer_connect. Names as they said them (\"Google\", \"Teams\", \"monday\").",
  parameters: { type: "object", properties: {
    add: { type: "array", items: { type: "string" }, description: "apps they use" },
    remove: { type: "array", items: { type: "string" }, description: "apps they no longer use, or that shouldn't be on the list" },
    none: { type: "boolean", description: "true when they say they use none of these apps (clears the list)" } } } } };
export const APPS_USED_LINE = "updating the apps you use";
// A name → an option key, or a catalog app { slug, name } (only a name match, never a guess), or null.
export function resolveApp(name, list = []) {
  const c = compact(name); if (!c) return null;
  for (const o of APP_OPTIONS) if (c === compact(o.k) || c === compact(o.n) || o.apps.some((a) => compact(a) === c) || (o.also || []).some((w) => compact(w) === c)) return { key: o.k };
  const h = list.length ? searchApps(list, name, 1)[0] : null;
  if (!h || h.score < 85) return null;
  const k = APP_OPTIONS.find((o) => o.apps.includes(h.a.s)); if (k) return { key: k.k };
  const kind = connectKind(h.a); if (kind === "soon" || kind === "retired") return { soon: h.a.n };
  return { key: h.a.s, name: h.a.n };
}
export async function appsUsedTool(env, tid, a = {}) {
  const add = (Array.isArray(a.add) ? a.add : a.add ? [a.add] : []).map(String).slice(0, 30), rm = (Array.isArray(a.remove) ? a.remove : a.remove ? [a.remove] : []).map(String).slice(0, 30);
  if (!add.length && !rm.length && a.none !== true) return "error: pass add (apps they use), remove (apps they don't), or none: true.";
  const list = add.length || rm.length ? await appCatalog(env).catch(() => []) : [];
  const cur = await getAppsUsed(env, tid), apps = a.none === true ? [] : [...cur.apps], extras = { ...cur.names }, unknown = [], soon = [];
  for (const n of rm) { const r = resolveApp(n, list); const i = r?.key ? apps.indexOf(r.key) : -1; if (i >= 0) apps.splice(i, 1); else if (!r) unknown.push(n); }
  for (const n of add) { const r = resolveApp(n, list); if (!r) { unknown.push(n); continue; } if (r.soon) { soon.push(r.soon); continue; } if (!apps.includes(r.key)) apps.push(r.key); if (r.name) extras[r.key] = r.name; }
  const saved = await setAppsUsed(env, tid, { apps, extras, none: a.none === true || (!apps.length && cur.none) }, "helper");
  const names = saved.apps.map((k) => usedName(saved, k));
  return `Saved. Apps they use: ${names.length ? names.join(", ") : saved.none ? "none" : "(empty)"}.${unknown.length ? ` Not found as a connectable app, so not added: ${unknown.join(", ")}.` : ""}${soon.length ? ` Can't be connected yet, so not added: ${soon.join(", ")}.` : ""} Nothing was connected. Tell them in one short line; they can also change it in Settings → Connected accounts → Apps I use.`;
}

// ---- the app's API: GET/POST /w/<slug>/api/apps-used ----
// GET → { apps, names, none, answered, options }. POST { apps: [key…], none } → the same (option keys only from the app; extras the
// helper added are kept unless the app sends the list without them).
export async function appsUsedApi(req, env, t, { json, look = false } = {}) {
  const view = (u) => ({ apps: u.apps, names: u.names, none: u.none, answered: !!u.answered, options: optionsView() });
  if (req.method === "GET") return json(view(await getAppsUsed(env, t.id)));
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (look) return json({ error: "read only" }, 403);
  const b = await boundedJson(req);
  if (!b || !Array.isArray(b.apps)) return json({ error: "apps must be a list" }, 400);
  const cur = await getAppsUsed(env, t.id);
  return json(view(await setAppsUsed(env, t.id, { apps: b.apps.slice(0, 80), extras: cur.names, none: b.none === true }, "settings")));
}
