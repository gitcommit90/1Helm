// The one place that decides which apps 1Helm hides. Every server path asks here: find_app and offer_connect (through the catalog),
// the turn's integration hint, app_actions, app_run, app_proxy, the app-triggers tools, the Connect and app-page routes, and the
// catalog file the Apps popup loads (index.js serves /app-static/integrations.json through visibleCatalog), so the app UI keeps no list.
// The data is app-visibility.json; test/app-visibility.test.mjs checks it. Hiding is for offering and using: a person's existing saved accounts in a hidden app still show in
// Settings so they can remove them, but the helper never sees or uses them.
//
// Three rules:
//   1. hidden: slugs listed in app-visibility.json "hidden" (Captain 10-08 deny list: wrong, unsafe, duplicated or too narrow).
//   2. prefixes: every slug that starts with a listed prefix is hidden except the listed exceptions (Captain 10-09: Cloudflare shows
//      only cloudflare_mcp; a future cloudflare_anything is covered automatically).
//   3. Soon (catalog flag x, not built in): not offered and not connectable unless the person is already connected, in which case
//      the app stays usable. connectKind(row, connected) in connect-offer.js applies it; blocksConnect below is the connect-side check.
//   4. Twins (Captain 10-27): Composio lists 45 brands twice, a plain app ("Notion") and its MCP twin ("Notion MCP"), and people can't
//      tell which to pick. app-visibility.json "twins" maps each side that is NOT offered to the side that is, e.g. "notion": "notion_mcp".
//      A twin is treated like Soon: it is left out of the Apps popup, find_app, offer_connect and the hint, and a new person can't connect
//      it, but a workspace that already has an account in it keeps using it (app_actions, app_run, app_proxy, triggers) and sees it in
//      Settings. It is deliberately not in "hidden", which blocks use as well. The kept card shows the brand name without " MCP".
//      Why a generated list and not a runtime computation: most callers only have a slug (the isHiddenApp checks in the helper tools),
//      not the catalog rows, so a list keeps every path one cheap lookup. The list can't go stale silently: findTwinPairs below finds
//      the pairs in the catalog rows, and test/app-visibility.test.mjs fails, with the lines to add, when a catalog file has a pair
//      that "twins" doesn't list. Choosing the kept side (chooseTwin): the MCP side (the company built it), unless only the plain side
//      has one-click sign-in (o, or built in b), and never a side that is Soon while the other isn't.
import data from "./app-visibility.json" with { type: "json" };

export const HIDDEN_TOOLKITS = new Map(Object.entries(data.hidden));
export const HIDDEN_PREFIXES = data.prefixes.map((p) => ({ prefix: String(p.prefix).toLowerCase(), except: (p.except || []).map((e) => String(e).toLowerCase()), reason: p.reason }));
const norm = (s) => String(s || "").trim().toLowerCase();
// twin slug → the slug 1Helm offers instead.
export const TWINS = new Map(Object.entries(data.twins || {}).map(([t, k]) => [norm(t), norm(k)]));
const KEPT = new Set(TWINS.values());

// → the reason an app is hidden, or "" when it isn't.
export function hiddenReason(slug) {
  const s = norm(slug); if (!s) return "";
  if (HIDDEN_TOOLKITS.has(s)) return HIDDEN_TOOLKITS.get(s);
  const p = HIDDEN_PREFIXES.find((x) => s.startsWith(x.prefix) && !x.except.includes(s));
  return p ? p.reason : "";
}
export const isHiddenApp = (slug) => !!hiddenReason(slug);
// An action slug (GMAIL_FETCH_EMAILS) belongs to a hidden app when it starts with that app's slug, e.g. CLOUDFLARE_API_KEY_LIST_ZONES.
// A prefix rule's exceptions keep their own actions: CLOUDFLARE_MCP_EXECUTE is allowed, CLOUDFLARE_LIST_ZONES is not.
export function isHiddenToolkitAction(action) {
  const a = String(action || "").toUpperCase(); if (!a) return false;
  if ([...HIDDEN_TOOLKITS.keys()].some((k) => a.startsWith(`${k.toUpperCase()}_`))) return true;
  return HIDDEN_PREFIXES.some((x) => a.startsWith(x.prefix.toUpperCase()) && !x.except.some((e) => a === e.toUpperCase() || a.startsWith(`${e.toUpperCase()}_`)));
}
export const isTwinApp = (slug) => TWINS.has(norm(slug));
export const twinKept = (slug) => TWINS.get(norm(slug)) || "";
// The twin slugs of an offered app: twinsOf("notion_mcp") → ["notion"].
export const twinsOf = (slug) => [...TWINS].filter(([, k]) => k === norm(slug)).map(([t]) => t);
// The name people see: the kept side of a pair loses its " MCP" ("Notion MCP" → "Notion"), like clean_name in the public site build.
export const brandName = (slug, name) => (KEPT.has(norm(slug)) ? String(name || "").replace(/\s+MCP$/i, "").trim() || String(name || "") : name);
// The catalog rows (integrations.json shape: s = slug) a person may be offered: no hidden app, no twin, kept cards named without " MCP".
// A kept card that has no featured rank (f) takes its twin's, so Notion, Stripe, Canva, Calendly and Todoist stay in Popular.
export function visibleCatalog(list) {
  if (!Array.isArray(list)) return [];
  const rank = new Map(list.filter((a) => a?.f && isTwinApp(a.s)).map((a) => [twinKept(a.s), a.f]));
  return list.filter((a) => !isHiddenApp(a?.s) && !isTwinApp(a?.s)).map((a) => (KEPT.has(norm(a?.s)) ? { ...a, ...(typeof a.n === "string" ? { n: brandName(a.s, a.n) } : {}), ...(!a.f && rank.has(norm(a.s)) ? { f: rank.get(norm(a.s)) } : {}) } : a));
}

// ---- finding and choosing pairs (the list in app-visibility.json is made with these; the test checks it against the catalog) ----
const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isMcp = (r) => /_mcp$/i.test(r.s) || /\sMCP$/i.test(String(r.n || ""));
// A pair is a plain app and its MCP twin: slug X and X_mcp, or names "Y" and "Y MCP" that match once lowercased and stripped of anything
// but letters and digits (browserbase_tool / browserbase_mcp, search_api / searchapi_mcp). → [{ plain, mcp, how }] with catalog rows.
export function findTwinPairs(list) {
  const rows = (Array.isArray(list) ? list : []).filter((r) => r?.s), by = new Map(rows.map((r) => [String(r.s).toLowerCase(), r])), out = [], seen = new Set();
  for (const mcp of rows.filter(isMcp)) {
    const slug = String(mcp.s).toLowerCase(); if (seen.has(slug)) continue;
    let plain = by.get(slug.replace(/_mcp$/, "")), how = "slug";
    if (!plain || plain === mcp) { const base = compact(String(mcp.n || "").replace(/\s+MCP$/i, "")); plain = base ? rows.find((x) => x !== mcp && !isMcp(x) && compact(x.n) === base) : null; how = "name"; }
    if (plain && plain !== mcp) { seen.add(slug); out.push({ plain, mcp, how }); }
  }
  return out;
}
// Which side to offer. → "plain" | "mcp". MCP unless only the plain side signs in with one click (built in counts as no sign-in needed),
// and never a Soon side when the other side isn't Soon.
export function chooseTwin({ plain, mcp }) {
  const easy = (r) => !!(r.o || r.b), soon = (r) => !!r.x && !r.b;
  if (soon(mcp) !== soon(plain)) return soon(mcp) ? "plain" : "mcp";
  return easy(plain) && !easy(mcp) ? "plain" : "mcp";
}
// The twins map for a catalog: { twinSlug: keptSlug }.
export function twinsFor(list) {
  const m = {}; for (const p of findTwinPairs(list)) { const side = chooseTwin(p); m[(side === "mcp" ? p.plain : p.mcp).s] = (side === "mcp" ? p.mcp : p.plain).s; }
  return m;
}
export const HIDDEN_TEXT = (what) => `error: ${what} isn't available in 1Helm, so nothing was run. Do it another way (your own computer, web_search, or another app), and don't offer to connect it.`;
export const HIDDEN_CONNECT_TEXT = "That app isn't available in 1Helm.";
export const SOON_CONNECT_TEXT = "That app isn't available in 1Helm yet.";
export const TWIN_CONNECT_TEXT = "1Helm offers this app under another entry with the same name. Connect that one from the Apps list instead.";
// Soon: the catalog says it can't be connected yet (flag x) and it isn't a built-in app.
export const isSoonRow = (row) => !!row?.x && !row?.b;
// The connect-side rule: → "" (allowed) or the refusal text. row = the app's catalog row (null when unknown), connected = this person
// already has a connected account in it.
export function connectRefusal(slug, row = null, connected = false) {
  if (isHiddenApp(slug)) return HIDDEN_CONNECT_TEXT;
  if (isTwinApp(slug) && !connected) return TWIN_CONNECT_TEXT;
  if (row && isSoonRow(row) && !connected) return SOON_CONNECT_TEXT;
  return "";
}
