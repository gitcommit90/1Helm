// One app's "App Store" page: everything Composio knows about a toolkit, in plain words, plus this workspace's connection to it.
// GET /w/<slug>/api/apps/<toolkit>. The catalog part (description, categories, how it connects, what the helper can do, events)
// is the same for every workspace, so it's cached: in this isolate for 10 minutes and in Cloudflare's cache for 6 hours.
// The connection part is this workspace's own and is always fresh. Nothing internal goes out: no auth-config ids, scopes,
// endpoints, tool ids or project ids.
import { call, RETIRED_APPS, latestVersion, versionQuery } from "./composio.js";
import { transportFor } from "./composio-transport.js";
import { isBuiltin, byokInfo } from "./builtin-apps.js";
import { connectAuth, isOAuthScheme, keyScheme } from "./composio-auth.js";

const MEM_TTL = 600e3, EDGE_TTL = 6 * 3600, CACHE_V = 5;   // v5: PayPal's customer-owned S2S setup
const MEM = new Map();            // "<version>:<slug>" → { at, data }
const ver = (env) => (latestVersion(env) ? "latest" : "pinned");   // the Composio toolkit version this server uses (composio.js)
// Keyed on this zone's own host (Cache API entries are per data center and only ever read back by this code; never served to visitors).
const cacheUrl = (env, slug) => `https://${env.APP_HOST || env.GATEWAY_HOST}/__cache/app-detail/v${CACHE_V}/${ver(env)}/${slug}`;
export const cleanSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 64);

// "Adds and/or removes specified gmail labels for a message; ensure `message id` …" → "Adds and/or removes specified gmail labels for a message."
export function firstSentence(s, max = 180) {
  let t = String(s || "").replace(/`+/g, "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // End of the first sentence: . ! ? then a space (Composio lowercases a lot, so the next word may start lowercase), not "e.g. ".
  const re = /[.!?](?=\s|$)/g; let m;
  while ((m = re.exec(t))) { if (!/\b(e\.g|i\.e|etc|vs|approx|incl|no|U\.S)$/i.test(t.slice(Math.max(0, m.index - 6), m.index))) { t = t.slice(0, m.index + 1); break; } }
  const semi = t.indexOf("; "); if (semi >= 20) t = t.slice(0, semi);
  t = t.replace(/\s*\((ensure|note|use|requires|must|e\.g\.?|i\.e\.?)\b[^)]*\)/gi, "");   // "(ensure is html=true for html)"
  t = t.replace(/[,:]\s*(ensure|note|use|requires|requiring|provided|where|if|when|this|returns)\b.*$/i, "").trim();
  if (t.length > max) t = t.slice(0, max).replace(/[\s,;:]+\S*$/, "") + "…";
  if (!/[.!?…]$/.test(t)) t += ".";
  return t[0].toUpperCase() + t.slice(1);
}
// Composio writes "gmail", "notion page": put the app's own spelling back.
const brand = (s, name) => !/^[A-Za-z][A-Za-z0-9 ]+$/.test(name) || name.length < 3 ? s : s.replace(new RegExp(`\\b${name}\\b`, "gi"), name);
const own = (s) => s.endsWith("s") ? `${s}'` : `${s}'s`;
const titleCase = (s) => /[A-Z]/.test(s) ? s : s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(And|Or|Of|For)\b/g, (w) => w.toLowerCase());
const httpUrl = (u) => { try { const x = new URL(String(u || "")); return x.protocol === "https:" || x.protocol === "http:" ? x : null; } catch { return null; } };
const day = (s) => { const t = Date.parse(String(s || "")); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };

// Whose sign-in page the person lands on (Gmail → Google, Outlook → Microsoft); otherwise the app's own name.
const PROVIDERS = [[/google/, "Google"], [/microsoft|live\.com|office\.com/, "Microsoft"], [/apple\.com/, "Apple"], [/amazon/, "Amazon"], [/facebook|meta\.com/, "Meta"], [/atlassian/, "Atlassian"], [/zoho/, "Zoho"], [/intuit/, "Intuit"]];
function provider(d, name) {
  const host = (httpUrl(d.auth_config_details?.find((a) => a.deprecated_auth_provider_details?.authorization_url)?.deprecated_auth_provider_details?.authorization_url) || httpUrl(d.base_url))?.hostname || "";
  return PROVIDERS.find(([re]) => re.test(host))?.[1] || name;
}
const KEYISH = { API_KEY: "an API key", BEARER_TOKEN: "an access token", BASIC: "a username and password", BASIC_WITH_JWT: "a username and password" };
function modeText(mode, name, prov, managed) {
  if (isOAuthScheme(mode)) return managed || mode === "DCR_OAUTH" ? `Signs in with your ${prov} account` : `Signs in with ${prov} (needs its own developer app, not set up yet)`;
  if (mode === "NO_AUTH") return "Built in: no sign-in needed";
  if (KEYISH[mode]) return `Needs ${KEYISH[mode]} from ${name}`;
  return `Needs credentials from ${name}`;
}
// The way 1Helm's Connect button will actually connect it (same order as composio.js authConfigFor), and the rest in plain words.
// "Built in" only for the audited apps (builtin-apps.js): Composio's NO_AUTH alone isn't enough (Gemini lists NO_AUTH and API_KEY but
// won't run without the person's key). A NO_AUTH-only app that isn't on the list has nothing to connect and doesn't run: unavailable.
function howItConnects(d, name, slug = d.slug, env = null) {
  const details = d.auth_config_details || [], modes = [...new Set(details.map((a) => a.mode).filter(Boolean))], managed = d.composio_managed_auth_schemes || [];
  const prov = provider(d, name);
  const noauth = isBuiltin(slug, modes, env);
  const selected = connectAuth(modes, managed), keyish = keyScheme(modes);
  const fieldsOf = (mode) => (details.find((a) => a.mode === mode)?.fields?.connected_account_initiation?.required || [])
    .filter((f) => f.user_visible !== false).slice(0, 6).map((f) => ({ label: String(f.displayName || f.name || "").slice(0, 80), help: firstSentence(f.description, 240) }));
  let connect;
  if (noauth) connect = { kind: "none", text: "Built in: there's nothing to connect. Your helper can use it right away." };
  else if (selected && isOAuthScheme(selected.scheme)) connect = { kind: "oauth", text: `${modeText(selected.scheme, name, prov, selected.managed)}. You sign in on ${own(prov)} own page, and 1Helm never sees your password.`, provider: prov };
  else if (keyish) {
    connect = { kind: "key", text: `${modeText(keyish, name, prov, false)}. You paste it on a secure page, and 1Helm never sees it.`, fields: fieldsOf(keyish) };
    if (slug === "paypal") connect = { kind: "key", text: "Needs your PayPal developer app's Client ID and Client Secret. Choose Live or Sandbox on the secure setup page. 1Helm passes them securely to Composio; they aren't shared with your helper.", fields: [{ label: "Client ID", help: "From your PayPal developer app." }, { label: "Client Secret", help: "Must belong to the same app and environment." }, { label: "Environment", help: "Live or Sandbox." }] };
    // AI model providers (Gemini, OpenAI…): the person's OWN key from that provider, and the provider bills them directly.
    const hint = (details.find((a) => a.mode === keyish)?.fields?.connected_account_initiation?.required || []).map((f) => f.description).join(" ");
    const cats = (d.meta?.categories || []).map((c) => String(c?.name || c || ""));
    const b = byokInfo(slug, name, { cats, hint, site: httpUrl(d.meta?.app_url)?.origin || "" });
    if (b) connect.byok = { provider: b.provider, payer: b.payer, url: b.url, text: b.text };
  }
  else if (modes.length && modes.every((m) => m === "NO_AUTH")) connect = { kind: "unavailable", text: `${name} isn't available in 1Helm yet: there's nothing to connect, and it doesn't run without a connection.` };
  else connect = { kind: "unavailable", text: `${name} needs its own developer app before it can connect, so it isn't available yet.` };
  const auth = modes.length ? modes.filter((m) => m !== "NO_AUTH" || noauth).map((m) => ({ kind: isOAuthScheme(m) ? "oauth" : m === "NO_AUTH" ? "none" : "key", text: modeText(m, name, prov, managed.includes(m)) })) : [{ kind: connect.kind, text: connect.text }];
  return { connect, auth };
}

async function allTools(env, slug) {
  const out = []; let cursor = "";
  for (let page = 0; page < 3; page++) {     // the same listing the helper's app_actions searches (the version this server uses)
    const d = await call(env, `/tools?toolkit_slug=${slug}&limit=1000${versionQuery(env)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...(d.items || [])); cursor = d.next_cursor; if (!cursor) break;
  }
  return out;
}
async function build(env, slug) {
  let d;
  try { d = await call(env, `/toolkits/${slug}`); }
  catch (e) { if (/not found/i.test(e.message)) { const err = new Error("No app by that name."); err.status = 404; throw err; } throw e; }
  const m = d.meta || {}, name = String(d.name || slug);
  const [toolsR, trigR] = await Promise.allSettled([allTools(env, slug), call(env, `/triggers_types?toolkit_slugs=${slug}&limit=200`)]);
  const tools = toolsR.status === "fulfilled" ? toolsR.value.filter((t) => !t.is_deprecated && !(t.tags || []).includes("deprecated")).map((t) => ({
    name: String(t.name || "").replace(/\s*\(deprecated\)\s*/i, "").trim() || String(t.slug || "").toLowerCase().replace(/_/g, " "),
    does: brand(firstSentence(t.description || t.human_description), name),
    reads: (t.tags || []).includes("readOnlyHint"),
    key: (t.tags || []).includes("important"),
  })) : null;
  const trig = trigR.status === "fulfilled" ? (trigR.value.items || []).map((t) => ({ name: String(t.name || "").replace(/\s*trigger$/i, "").trim(), does: brand(firstSentence(t.description), name) })) : null;
  const site = httpUrl(m.app_url), help = httpUrl(d.auth_guide_url) || httpUrl((d.auth_config_details || []).find((a) => a.auth_hint_url)?.auth_hint_url);
  return {
    slug, name,
    logo: `https://logos.composio.dev/api/${slug}`,
    description: String(m.description || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().replace(/([A-Za-z0-9)])$/, "$1."),
    categories: [...new Set((m.categories || []).map((c) => titleCase(String(c?.name || c || "").trim())).filter(Boolean))],
    website: site ? { url: site.origin, label: site.hostname.replace(/^www\./, "") } : null,
    help: help ? { url: help.href, label: help.hostname.replace(/^www\./, "") } : null,
    ...howItConnects(d, name, slug, env),
    tools: tools ? { count: tools.length, items: tools } : null,
    triggers: trig ? { count: trig.length, items: trig } : null,
    updated: day(m.updated_at),
    complete: !!(tools && trig),
  };
}
// Catalog part, cached. A partial result (tools or events failed to load) is kept only briefly so it heals soon.
export async function appCatalog(env, slugIn, { fresh = false } = {}) {
  const slug = cleanSlug(slugIn); if (!slug) { const e = new Error("Which app?"); e.status = 400; throw e; }
  const mk = `${ver(env)}:${slug}`, hit = MEM.get(mk);
  if (!fresh && hit && Date.now() - hit.at < (hit.data.complete ? MEM_TTL : 60e3)) return hit.data;
  const edge = typeof caches !== "undefined" ? caches.default : null;
  if (!fresh && edge) { try { const r = await edge.match(cacheUrl(env, slug)); if (r) { const data = await r.json(); MEM.set(mk, { at: Date.now(), data }); return data; } } catch {} }
  const data = await build(env, slug);
  MEM.set(mk, { at: Date.now(), data });
  if (edge && data.complete) { try { await edge.put(cacheUrl(env, slug), new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${EDGE_TTL}` } })); } catch {} }
  return data;
}
// This workspace's accounts in that app (unfinished sign-ins left out), oldest first, each with its label and which one is the default.
export async function appConnection(env, tenantId, slugIn) {
  const slug = cleanSlug(slugIn);
  const accounts = (await transportFor(env, tenantId).listConnections({ app: slug, names: false })).reverse()
    .map((a) => ({ id: a.id, email: a.email, label: a.label, default: a.default, since: a.since, status: a.status, ...(a.memo ? { memo: a.memo } : {}) }));
  return { status: accounts.some((a) => a.status === "connected") ? "connected" : accounts.length ? "expired" : "none", accounts };
}
export async function appDetail(env, tenantId, slug) {
  const [cat, conn] = await Promise.all([appCatalog(env, slug), appConnection(env, tenantId, slug).catch(() => ({ status: "unknown", accounts: [] }))]);
  const { complete, ...pub } = cat;
  // A retired app (Google Super) never offers Connect; the server refuses new connections to it anyway.
  if (RETIRED_APPS.has(cleanSlug(slug))) pub.connect = { kind: "unavailable", text: `${pub.name} is being retired. Connect the individual apps you use instead.` };
  return { ...pub, connection: conn };
}
