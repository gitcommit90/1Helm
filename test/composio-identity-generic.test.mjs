// Generic account identity (account-labels-2). Payload shapes below are REDACTED recordings of Composio v3.1 connected-account
// objects (dev project, 2026-10-10): key names and structure are real; tokens are masked by Composio itself ("xxxxxxxx") and no
// person's name/email appears (example.com placeholders only).
import assert from "node:assert/strict";
import { metadataIdentity, identityLookup, identityPlan, resolveAccountIdentity, disambiguateAccountLabels } from "../src/ee/composio-identity.js";
import { IDENTITY_TOOLS } from "../src/ee/composio-identity-tools.js";

const MASK = "xxxxxxxx";
const oauth = (toolkit, scope, data = {}, extra = {}) => ({ id: `ca_${toolkit}`, toolkit: { slug: toolkit }, status: "ACTIVE", alias: null, created_at: "2026-10-09T10:00:00.000Z",
  data: { status: "ACTIVE", access_token: MASK, token_type: MASK, refresh_token: MASK, expires_in: 3599, scope, callback_url: "https://backend.composio.dev/api/v1/auth-apps/add", ...data },
  state: { authScheme: "OAUTH2", val: { status: "ACTIVE", access_token: MASK, scope, ...data } }, ...extra });
const SHAPES = {
  ticktick: oauth("ticktick", "tasks:read tasks:write"),
  googlesheets: oauth("googlesheets", "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email openid", { id_token: MASK }),
  googlesheets_noemail: oauth("googlesheets", "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets", {}),
  googlesheets_sheetsonly: oauth("googlesheets", "https://www.googleapis.com/auth/spreadsheets", {}),
  googledocs: oauth("googledocs", "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email openid", { id_token: MASK }),
  googledrive: oauth("googledrive", "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email openid", { id_token: MASK }),
  googlecalendar: oauth("googlecalendar", "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar"),
  gmail: oauth("gmail", "https://mail.google.com/ openid email", { displayName: "gmail.person@example.com", id_token: MASK }),
  slack: oauth("slack", "channels:history,users:read", { displayName: "person (Example Workspace)", extra_token_data: { team: { id: MASK, name: MASK } } }),
  github: oauth("github", "repo,user", { displayName: "octocat" }),
  canva: oauth("canva", "asset:read", { displayName: "Canva Person" }),
  linkedin: oauth("linkedin", "email,openid,profile", { displayName: "li.person@example.com", id_token: MASK }),
  reddit: oauth("reddit", "edit submit read vote identity flair"),
  asana: { id: "ca_asana", toolkit: { slug: "asana" }, status: "EXPIRED", alias: null, data: { status: "EXPIRED", redirectUrl: "https://backend.composio.dev/api/v3/s/x" }, state: { authScheme: "OAUTH2", val: { status: "EXPIRED" } } },
  twenty: { id: "ca_twenty", toolkit: { slug: "twenty" }, status: "FAILED", alias: null, data: { status: "FAILED" }, state: { authScheme: "API_KEY", val: { status: "FAILED" } } },
  tailscale: { id: "ca_tailscale", toolkit: { slug: "tailscale" }, status: "ACTIVE", alias: null, data: { status: "ACTIVE", generic_api_key: MASK }, state: { authScheme: "API_KEY", val: { generic_api_key: MASK } } },
  google_maps: oauth("google_maps", "https://www.googleapis.com/auth/cloud-platform"),
  googlephotos: oauth("googlephotos", "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata"),
  youtube: oauth("youtube", "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly"),
  hugging_face: oauth("hugging_face", "openid profile email", { id_token: MASK }),
  shopify: { id: "ca_shopify", toolkit: { slug: "shopify" }, status: "ACTIVE", alias: null, data: { status: "ACTIVE", access_token: MASK, shop: "example-store" }, state: { authScheme: "OAUTH2", val: { shop: "example-store", access_token: MASK } } },
  jira: { id: "ca_jira", toolkit: { slug: "jira" }, status: "ACTIVE", alias: null, data: { status: "ACTIVE", access_token: MASK, subdomain: "https://acme-corp.atlassian.net/" }, state: { val: {} } },
};

// 1. Payload-only: what the account object alone tells us (no API call).
const payload = (k) => metadataIdentity(SHAPES[k]);
assert.equal(payload("gmail").email, "gmail.person@example.com");
assert.equal(payload("linkedin").email, "li.person@example.com");
assert.equal(payload("slack").label, "person (Example Workspace)");
assert.equal(payload("github").label, "octocat");
assert.equal(payload("canva").label, "Canva Person");
assert.equal(payload("shopify").label, "example-store", "store/site name from the connection's own non-secret field");
assert.equal(payload("jira").label, "acme-corp.atlassian.net", "protocol and path stripped from a site URL");
for (const k of ["ticktick", "googlesheets", "googledocs", "googledrive", "googlecalendar", "reddit", "asana", "twenty", "tailscale", "google_maps", "googlephotos", "youtube", "hugging_face"]) assert.equal(payload(k).label, "", `${k}: no identifier in payload (tokens are masked by Composio; never read)`);
assert.equal(metadataIdentity({ data: { id_token: "aaa.bbb.ccc", access_token: "zzz", client_secret: "s", refresh_token: "r" } }).label, "", "never decodes or reads token/secret fields");
assert.equal(payload("shopify").identityKey, "", "site names and display names never become identity keys");

// 2. Which lookup (if any) each shape gets.
const plan = (k) => identityPlan(SHAPES[k]);
assert.equal(plan("googlesheets").endpoint, "https://openidconnect.googleapis.com/v1/userinfo");
assert.equal(plan("googledocs").endpoint, "https://openidconnect.googleapis.com/v1/userinfo");
assert.deepEqual(plan("googlesheets_noemail"), { type: "proxy", endpoint: "https://www.googleapis.com/drive/v3/about", query: { fields: "user(emailAddress,displayName)" } }, "Drive-scoped Sheets grant reads the signed-in user through Drive about");
assert.equal(plan("googlesheets_sheetsonly"), null, "Sheets-only grant: no identity scope, no futile call");
assert.equal(plan("googledrive").tool, "GOOGLEDRIVE_GET_ABOUT");
assert.equal(plan("googlecalendar").tool, "GOOGLECALENDAR_GET_CALENDAR");
assert.equal(plan("googlephotos"), null);
assert.equal(plan("youtube").endpoint, "https://www.googleapis.com/youtube/v3/channels");
assert.equal(plan("reddit").endpoint, "https://oauth.reddit.com/api/v1/me");
assert.deepEqual(plan("asana"), { type: "tool", tool: "ASANA_GET_CURRENT_USER", args: {}, version: "latest", versionApp: "asana", generic: true });
assert.equal(plan("hugging_face").tool, "HUGGING_FACE_GET_WHOAMI");
for (const k of ["ticktick", "twenty", "tailscale", "google_maps"]) assert.equal(plan(k), null, `${k}: no identity tool in the catalog`);
assert.equal(plan("slack"), null, "Slack already named by its payload: no extra lookup");
assert.equal(identityPlan({ ...SHAPES.asana, status: "ACTIVE" }).tool, "ASANA_GET_CURRENT_USER");
assert.equal(identityLookup("zoom").tool, "ZOOM_GET_USER", "explicit overrides unchanged");
// The generated table: slugs belong to their own toolkit, take no inputs, and never mutate.
for (const [tk, slug] of Object.entries(IDENTITY_TOOLS)) { assert.ok(!slug.slice(tk.length).split("_").some((w) => ["DELETE", "CREATE", "UPDATE", "SEND", "SAVE", "ADD", "REMOVE", "SET", "POST"].includes(w)), `${slug} must be read-only`); }
assert.ok(Object.keys(IDENTITY_TOOLS).length > 250);

// 3. Responses of the lookups, parsed generically.
const resolve = async (shape, response, status) => resolveAccountIdentity({ scope: {}, account: { ...SHAPES[shape], ...(status ? { status } : {}) }, lookup: async () => response });
assert.equal((await resolve("asana", { data: { name: "Ann Person", email: "ann@example.com", gid: "1" } }, "ACTIVE")).label, "ann@example.com");
assert.equal((await resolve("hugging_face", { name: "hf-user", fullname: "HF User", email: "hf@example.com" })).email, "hf@example.com");
assert.equal((await resolve("reddit", { name: "reddit_user", id: "t2_abc" })).label, "reddit_user");
assert.equal((await resolve("youtube", { items: [{ id: "UC123", snippet: { title: "My Channel" } }] })).label, "My Channel");
assert.equal((await resolve("googlesheets_noemail", { user: { emailAddress: "drive.user@example.com", displayName: "Drive User" } })).email, "drive.user@example.com");
assert.equal((await resolve("googlesheets", { email: "Sheets@Example.com", sub: "123" })).identityKey, "email:sheets@example.com", "Google family keeps email-based reconnect identity");
assert.equal((await resolve("asana", { data: { result: { user: { login: "ann-login" } } } }, "ACTIVE")).label, "ann-login", "nested wrappers are searched a few levels deep");
assert.equal((await resolve("asana", { data: { name: "Ann" } }, "ACTIVE")).identityKey, "", "workspace apps never get an email/name identity key");
assert.equal((await resolve("asana", null, "ACTIVE")).label, "", "empty or failed lookup leaves the account unnamed");
assert.equal((await resolve("asana", { data: { token: "SECRET-TOKEN", access_token: "SECRET" } }, "ACTIVE")).label, "", "secret-looking fields are never used");

// 4. Lazy, bounded re-resolution: at most `budget.left` new lookups per listing; failures are not retried for 10 minutes.
let calls = 0; const budget = { left: 2 }, scope = {};
for (const i of [1, 2, 3, 4]) await resolveAccountIdentity({ scope, budget, account: { ...SHAPES.asana, id: `ca_a${i}`, status: "ACTIVE" }, lookup: async () => { calls++; return { name: `n${i}` }; } });
assert.equal(calls, 2, "listing-wide lookup budget");
await resolveAccountIdentity({ scope, budget: { left: 5 }, account: { ...SHAPES.asana, id: "ca_a3", status: "ACTIVE" }, lookup: async () => { calls++; return { name: "n3" }; } });
assert.equal(calls, 3, "accounts skipped by the budget are resolved on a later listing");
await resolveAccountIdentity({ scope, budget: { left: 5 }, account: { ...SHAPES.asana, id: "ca_a1", status: "ACTIVE" }, lookup: async () => { calls++; return {}; } });
assert.equal(calls, 3, "resolved accounts come from cache, not the provider");

// 5. Fallback labels: never a bare "Account N" when several accounts cannot be told apart.
const row = (id, app, label, since, extra = {}) => ({ id, app, label, since, email: "", ...extra });
let rows = disambiguateAccountLabels([row("1", "ticktick", "Account 1", "2026-10-09T10:00:00Z"), row("2", "ticktick", "Account 2", "2026-10-11T01:00:00Z"), row("3", "ticktick", "Account 3", "2026-10-11T23:00:00Z")]);
assert.deepEqual(rows.map((r) => r.label), ["Account 1 · connected Oct 9", "Account 2 · connected Oct 11", "Account 3 · connected Oct 11"]);
rows = disambiguateAccountLabels([row("1", "asana", "Account 1", "2026-10-09T10:00:00Z")]);
assert.equal(rows[0].label, "Account 1", "a single account keeps the plain placeholder");
rows = disambiguateAccountLabels([row("1", "slack", "Ann (Work)", "2026-10-09T10:00:00Z"), row("2", "slack", "Account 2", "2026-10-10T10:00:00Z")]);
assert.deepEqual(rows.map((r) => r.label), ["Ann (Work)", "Account 2 · connected Oct 10"], "named and unnamed accounts mix");
rows = disambiguateAccountLabels([row("1", "slack", "Same", "2026-10-09T10:00:00Z"), row("2", "slack", "Same", "2026-10-10T10:00:00Z")]);
assert.deepEqual(rows.map((r) => r.label), ["Same (Account 1)", "Same (Account 2)"], "existing duplicate-name rule unchanged");
rows = disambiguateAccountLabels([row("1", "gmail", "a@example.com", "2026-10-09T10:00:00Z", { email: "a@example.com" }), row("2", "gmail", "Account 2", "bad-date")]);
assert.equal(rows[1].label, "Account 2", "no date available: placeholder unchanged");
// 6. Through the real managed listing (HTTP mocked at the boundary): unnamed accounts get dates, catalog-tool accounts get a name.
{
  const { listManagedConnections } = await import("../src/ee/composio.js");
  const acct = (id, toolkit, created_at, extra = {}) => ({ id, toolkit: { slug: toolkit }, status: "ACTIVE", user_id: "1hc:generic-tenant", alias: null, created_at, data: { status: "ACTIVE", access_token: MASK }, state: { val: {} }, ...extra });
  let items = [acct("ca_t1", "ticktick", "2026-10-09T10:00:00Z"), acct("ca_t2", "ticktick", "2026-10-10T10:00:00Z"), acct("ca_as1", "asana", "2026-10-09T10:00:00Z"), acct("ca_sh1", "googlesheets", "2026-10-09T10:00:00Z", { data: { status: "ACTIVE", scope: "https://www.googleapis.com/auth/spreadsheets", access_token: MASK } })];
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : null; seen.push(`${method} ${u.pathname}`);
    const ok = (d) => new Response(JSON.stringify(d));
    if (u.pathname.endsWith("/connected_accounts")) return ok({ items });
    if (u.pathname.includes("/connected_accounts/") && method === "PATCH") { items.find((a) => a.id === u.pathname.split("/").at(-1)).alias = body.alias; return ok({}); }
    if (u.pathname.endsWith("/tools/execute/ASANA_GET_CURRENT_USER")) return ok({ successful: true, data: { response_data: { name: "Ann Asana", email: "ann.asana@example.com" } } });
    throw Error(`unexpected request ${method} ${u.pathname}`);
  };
  const out = await listManagedConnections({ COMPOSIO_KEY: "generic-test" }, "generic-tenant", { names: false });
  const label = (id) => out.find((r) => r.id === id).label;
  assert.equal(label("ca_t1"), "Account 1 \u00b7 connected Oct 9"); assert.equal(label("ca_t2"), "Account 2 \u00b7 connected Oct 10");
  assert.equal(label("ca_as1"), "ann.asana@example.com"); assert.equal(label("ca_sh1"), "Account 1", "Sheets-only grant, single account: placeholder, and no futile request");
  assert.equal(seen.filter((x) => x.includes("/tools/execute")).length, 1, "only the account with a catalog identity tool was looked up");
  assert.equal(items.find((a) => a.id === "ca_as1").alias, "ann.asana@example.com", "resolved identity saved as the alias");
}
console.log("composio-identity-generic ok: payload shapes, per-toolkit plans, response parsing, lookup budget, fallback labels");
