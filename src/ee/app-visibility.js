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
import data from "./app-visibility.json" with { type: "json" };

export const HIDDEN_TOOLKITS = new Map(Object.entries(data.hidden));
export const HIDDEN_PREFIXES = data.prefixes.map((p) => ({ prefix: String(p.prefix).toLowerCase(), except: (p.except || []).map((e) => String(e).toLowerCase()), reason: p.reason }));
const norm = (s) => String(s || "").trim().toLowerCase();

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
// The catalog rows (integrations.json shape: s = slug) without the hidden apps.
export const visibleCatalog = (list) => (Array.isArray(list) ? list.filter((a) => !isHiddenApp(a?.s)) : []);
export const HIDDEN_TEXT = (what) => `error: ${what} isn't available in 1Helm, so nothing was run. Do it another way (your own computer, web_search, or another app), and don't offer to connect it.`;
export const HIDDEN_CONNECT_TEXT = "That app isn't available in 1Helm.";
export const SOON_CONNECT_TEXT = "That app isn't available in 1Helm yet.";
// Soon: the catalog says it can't be connected yet (flag x) and it isn't a built-in app.
export const isSoonRow = (row) => !!row?.x && !row?.b;
// The connect-side rule: → "" (allowed) or the refusal text. row = the app's catalog row (null when unknown), connected = this person
// already has a connected account in it.
export function connectRefusal(slug, row = null, connected = false) {
  if (isHiddenApp(slug)) return HIDDEN_CONNECT_TEXT;
  if (row && isSoonRow(row) && !connected) return SOON_CONNECT_TEXT;
  return "";
}
