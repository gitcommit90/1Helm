// Shared account naming. Only explicit identity fields are inspected: never walk
// arbitrary connection data (which also contains access tokens and API secrets).
import { IDENTITY_TOOLS } from "./composio-identity-tools.js";
const clean = (v) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
const emailOf = (v) => { const s = clean(v); return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s) ? s : ""; };
const EMPTY = Object.freeze({ label: "", email: "", identityKey: "" });
const GOOGLE_IDENTITY = new Set(["googlemeet", "googledocs", "googlesheets", "googleslides", "googletasks", "googlecontacts", "googlephotos", "google_maps", "youtube"]);
// A shared email is NOT an account identity for workspace-based apps: the same
// person can join several Slack/Notion/etc workspaces. Preserve every connection
// until a provider-specific verified workspace+user key is implemented. Only the
// Google account family retains its existing email-based reconnect semantics.
const GOOGLE_EMAIL_IDENTITY = new Set(["gmail", "googlesuper", "googlecalendar", "googledrive", ...GOOGLE_IDENTITY]);
export function emailIdentityKey(app, value) {
  const email = emailOf(value);
  return GOOGLE_EMAIL_IDENTITY.has(app) && email ? `email:${email.toLowerCase()}` : "";
}
// Non-secret descriptive fields only, never a token/credential field. Priority: email, then a person/workspace name, then a site/domain.
const NAME_KEYS = ["displayName", "display_name", "username", "user_name", "login", "handle", "screen_name", "screenName", "full_name", "fullName", "real_name", "preferred_username", "nickname", "name"];
const SITE_KEYS = ["workspace", "workspace_name", "team_name", "organization_name", "org_name", "company_name", "site_name", "instanceName", "subdomain", "your-domain", "COMPANYDOMAIN", "domain", "shop", "account_url", "instanceEndpoint", "api_url"];
const EMAIL_KEYS = ["email", "emailAddress", "email_address", "user_email", "primary_email", "mail", "userPrincipalName"];
const site = (v) => { const s = clean(v).replace(/^https?:\/\//i, "").replace(/\/.*$/, ""); return /^[\w.-]{2,80}$/.test(s) && !/^(api|www)\.?$/.test(s) ? s : ""; };
export function metadataIdentity(a = {}) {
  const roots = [a.state?.val, a.data, a.params, a.account_data, a.connection_data, a.metadata, a].filter((x) => x && typeof x === "object");
  const sources = roots.flatMap((x) => [x, x.user, x.profile, x.user_info, x.userInfo, x.account, x.me].filter((y) => y && typeof y === "object" && !Array.isArray(y)));
  const email = sources.map((x) => EMAIL_KEYS.map((k) => emailOf(x[k])).find(Boolean) || emailOf(x.displayName)).find(Boolean) || emailOf(a.alias);
  const name = sources.map((x) => NAME_KEYS.map((k) => clean(x[k])).find(Boolean)).find(Boolean) || "";
  const domain = sources.map((x) => SITE_KEYS.map((k) => site(x[k])).find(Boolean)).find(Boolean) || "";
  return { label: clean(a.alias) || email || name || domain, email, identityKey: emailIdentityKey(a.toolkit?.slug || a.app, email) };
}
function grantedScopes(a) {
  const raw = a.state?.val?.scope ?? a.state?.val?.scopes ?? a.data?.scope ?? a.data?.scopes ?? a.params?.scope;
  return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
}
const GOOGLE_ID_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"];
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata", "https://www.googleapis.com/auth/drive.metadata.readonly"];
// An explicitly supplied grant is authoritative. Missing scope metadata is not proof of denial, but a known Meet-only grant must not
// cause futile API reads. A Sheets/Docs grant without an identity scope but with Drive access can still read the signed-in user
// through the Drive "about" endpoint (https://developers.google.com/drive/api/reference/rest/v3/about).
function googlePlan(a, app) {
  const scopes = grantedScopes(a);
  if (!scopes.length || scopes.some((s) => GOOGLE_ID_SCOPES.includes(s))) return identityLookup(app);
  if (scopes.some((s) => DRIVE_SCOPES.includes(s))) return { type: "proxy", endpoint: "https://www.googleapis.com/drive/v3/about", query: { fields: "user(emailAddress,displayName)" } };
  if (app === "youtube" && scopes.some((s) => s.startsWith("https://www.googleapis.com/auth/youtube"))) return { type: "proxy", endpoint: "https://www.googleapis.com/youtube/v3/channels", query: { part: "snippet", mine: "true" } };
  return null;
}
// Google documents its userinfo endpoint in OpenID discovery. The exact connected
// account signs this request; never borrow another Google app's credential.
// https://developers.google.com/identity/protocols/oauth2/openid-connect
// https://docs.composio.dev/toolkits/zoom (ZOOM_GET_USER)
export function identityLookup(app) {
  if (GOOGLE_IDENTITY.has(app)) return { type: "proxy", endpoint: "https://openidconnect.googleapis.com/v1/userinfo" };
  if (app === "zoom") return { type: "tool", tool: "ZOOM_GET_USER", args: { user_id: "me" }, version: "20260903_00", versionApp: app };
  if (app === "gmail" || app === "googlesuper") return { type: "tool", tool: "GMAIL_GET_PROFILE", args: {}, versionApp: "gmail" };
  if (app === "googlecalendar") return { type: "tool", tool: "GOOGLECALENDAR_GET_CALENDAR", args: { calendar_id: "primary" }, versionApp: app };
  if (app === "googledrive") return { type: "tool", tool: "GOOGLEDRIVE_GET_ABOUT", args: { fields: "user" }, versionApp: app };
  // Small overrides on top of the generic catalog table: OAuth apps whose own profile endpoint is the only who-am-I.
  if (app === "reddit") return { type: "proxy", endpoint: "https://oauth.reddit.com/api/v1/me" };
  // Generic: the toolkit's read-only, no-input "who am I" tool from Composio's catalog (composio-identity-tools.js).
  const tool = Object.hasOwn(IDENTITY_TOOLS, app) ? IDENTITY_TOOLS[app] : "";
  return tool ? { type: "tool", tool, args: {}, version: "latest", versionApp: app, generic: true } : null;
}
// Walk a profile response a few levels deep for the same descriptive fields as the connected-account payload (never tokens).
function findProfile(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 3) return EMPTY;
  const own = metadataIdentity({ data });
  if (own.email || own.label) return own;
  const kids = Array.isArray(data) ? data.slice(0, 1) : ["data", "response_data", "result", "user", "me", "profile", "account", "viewer", "authenticated_user", "currentUser", "current_user", "member", "response", "details", "attributes", "items"].map((k) => data[k]);
  for (const kid of kids) { const f = findProfile(kid, depth + 1); if (f.email || f.label) return f; }
  return EMPTY;
}
function profileIdentity(app, data) {
  if (!data || typeof data !== "object") return EMPTY;
  const r = data.response_data ?? data;
  const direct = app === "youtube" ? { label: clean(r.items?.[0]?.snippet?.title), email: "" } : app === "zoom" || GOOGLE_EMAIL_IDENTITY.has(app) ? metadataIdentity({ data: r }) : findProfile(r);
  const email = direct.email || emailOf(r.calendar_data?.id) || (app === "googlecalendar" ? emailOf(r.id) : "");
  // Stable IDs are accepted only from the documented authenticated-user response,
  // never a generic connection's `id` (which is the Composio connection itself).
  const id = app === "zoom" ? clean(r.id) : GOOGLE_IDENTITY.has(app) ? clean(r.sub) : "";
  return { label: email || direct.label, email, identityKey: app === "zoom" && id ? `zoom:${id}` : emailIdentityKey(app, email) || (id ? `${app}:${id}` : "") };
}
const CACHES = new WeakMap(), TTL = 600e3, MAX_ENTRIES = 500, TIMEOUT = 3500;
async function bounded(fn, deadline = Infinity) {
  const remaining = Math.min(TIMEOUT, deadline - Date.now());
  if (remaining <= 0) return null;
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((resolve) => { timer = setTimeout(() => resolve(null), remaining); })]); }
  finally { clearTimeout(timer); }
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const connectedOn = (since) => { const t = Date.parse(since); if (!Number.isFinite(t)) return ""; const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
// "Account 2" is only a placeholder: where an app has several accounts and none of them told us who they are, add the one stable,
// non-secret thing every connection has, the date it was connected ("Account 2 · connected Oct 9").
const PLACEHOLDER = /^Account \d+$/;
export function disambiguateAccountLabels(rows) {
  const byApp = new Map();
  for (const row of rows) { if (!byApp.has(row.app)) byApp.set(row.app, []); byApp.get(row.app).push(row); }
  for (const group of byApp.values()) if (group.length > 1) for (const row of group) {
    const when = !row.email && PLACEHOLDER.test(row.label) ? connectedOn(row.since) : "";
    if (when) row.label = `${row.label} \u00b7 connected ${when}`;
  }
  const groups = new Map();
  for (const row of rows) { const key = `${row.app}:${row.label.toLowerCase()}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  for (const group of groups.values()) if (group.length > 1) {
    group.sort((a, b) => String(a.since).localeCompare(String(b.since)) || a.id.localeCompare(b.id));
    group.forEach((row, i) => { row.label = `${row.label} (Account ${i + 1})`; });
  }
  return rows;
}
// The one cheap lookup (if any) worth making for this account. A catalog-table lookup only fills a gap: an account that already has a
// name (alias or provider displayName) is not queried again.
export function identityPlan(a, metadata = metadataIdentity(a)) {
  const app = a.toolkit?.slug || a.app || "";
  const plan = GOOGLE_IDENTITY.has(app) ? googlePlan(a, app) : identityLookup(app);
  return plan?.generic && metadata.label ? null : plan;
}
export async function resolveAccountIdentity({ scope, account: a, lookup, saveAlias, deadline = Infinity, budget = null }) {
  const metadata = metadataIdentity(a), app = a.toolkit?.slug || a.app || "";
  let cache = CACHES.get(scope); if (!cache) { cache = new Map(); CACHES.set(scope, cache); }
  const key = `${app}:${a.id}`, now = Date.now();
  let record = cache.get(key);
  const plan = identityPlan(a, metadata);
  if (!metadata.email && a.status === "ACTIVE" && plan && lookup && now < deadline && (!record || now - record.at > TTL) && (!budget || budget.left > 0)) {
    if (budget) budget.left--;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    // Cache the promise before starting: simultaneous boot/list calls share a read.
    record = { at: now, value: EMPTY }; cache.set(key, record);
    record.pending = (async () => {
      try {
        const raw = await bounded(() => lookup(plan), deadline);
        record.value = profileIdentity(app, raw);
      } catch { /* A denied scope or offline provider never blocks account listing. */ }
      return record.value;
    })();
  }
  const enriched = record?.pending ? (await bounded(() => record.pending, deadline)) || record.value : record?.value || EMPTY;
  const result = { label: metadata.email || enriched.email || metadata.label || enriched.label,
    email: metadata.email || enriched.email,
    identityKey: metadata.identityKey || enriched.identityKey };
  // Persist the best identity (upgrading old auto-written person-only aliases)
  // so expired connections retain their useful label after isolate replacement.
  if (clean(a.alias) !== result.label && result.label && saveAlias && Date.now() < deadline) {
    if (!record) { record = { at: now, value: result }; cache.set(key, record); }
    if (!record.aliasSaved && !record.aliasPending && (!record.aliasAttemptAt || now - record.aliasAttemptAt > TTL)) {
      record.aliasAttemptAt = now;
      record.aliasPending = bounded(async () => { await saveAlias(result.label); record.aliasSaved = true; }, deadline).catch(() => {}).finally(() => { record.aliasPending = null; });
      await record.aliasPending;
    }
  }
  return result;
}
