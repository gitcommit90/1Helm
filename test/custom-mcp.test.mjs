// Custom MCP connections, backend lifecycle + security. Run:  node --import ./test/stubs/register.mjs test/custom-mcp.test.mjs
// ALL MOCKED: Composio is faked (test/custom-mcp-harness.mjs) because the dev project's scoped key is refused by the real custom-toolkit
// routes (probe.md). Nothing here is live evidence. Covered: availability/gating, off-by-default, URL + auth validation, no-auth / API-key /
// DCR-OAuth setup, idempotency, resume, sync lifecycle, refresh, callback security, disconnect + retryable cleanup, two-user isolation of the
// HTTP routes, and that secrets never reach logs, D1 or responses. Assistant-path and discovery/execution isolation: custom-mcp-tools.test.mjs.
import assert from "node:assert/strict";
import { makeHarness, SERVER, ECHO, KEY, API_KEY_SECRET, say } from "./custom-mcp-harness.mjs";
import { LIMITS, hooks, resetProbe, customUsable, availability } from "../src/ee/custom-mcp.js";
import { checkPublicUrl, isPrivateIp } from "../src/ee/custom-mcp-url.js";

let n = 0; const ok = (name) => { n++; say(`ok ${n} - ${name}`); };
const H = makeHarness(), { C, api, route, rows, d1, env, enable, age, waitSettled, REQ } = H;
const URL1 = "https://mcp.acme-demo.dev/mcp", URL2 = "https://tools.other-demo.io/v1/mcp";
C.servers[URL1] = SERVER("none"); C.servers[URL2] = SERVER("api_key", API_KEY_SECRET);
C.servers["https://oauth.demo-server.dev/mcp"] = SERVER("oauth");
const mk = (who, body) => api(who, "POST", "/servers", { client_request_id: REQ(), name: "Acme tools", url: URL1, auth: { type: "none" }, ...body });
const upsertBodies = () => C.reqs.filter((r) => r.p === "/custom/toolkits/upsert");

// ---------- 1. availability: gated (the real dev key), unconfigured, self-managed ----------
{
  C.gated = true;
  let r = await api(1, "GET", "");
  assert.equal(r.status, 200); assert.deepEqual({ enabled: r.json.enabled, available: r.json.available, why: r.json.unavailable_reason, servers: r.json.servers }, { enabled: false, available: false, why: "gated", servers: [] });
  const probe = C.reqs.filter((q) => q.p.startsWith("/custom/")); assert.equal(probe.length, 1); assert.equal(probe[0].m, "DELETE", "the probe is a DELETE of a slug that cannot exist: it creates nothing");
  assert.match(probe[0].p, /^\/custom\/toolkits\/CUSTOM_HC_A{16}$/);
  await api(1, "GET", ""); assert.equal(C.reqs.filter((q) => q.p.startsWith("/custom/")).length, 1, "the answer is cached for a few minutes");
  r = await api(1, "PUT", "/settings", { enabled: true }); assert.equal(r.status, 409); assert.equal(r.json.error.code, "unavailable", "can't be switched on while gated");
  r = await mk(1, {}); assert.equal(r.status, 409); assert.equal(r.json.error.code, "unavailable");
  assert.equal(upsertBodies().length, 0, "nothing is registered while gated");
  // no COMPOSIO_CUSTOM_KEY: gated, and no custom request is even sent
  { const k = env.COMPOSIO_CUSTOM_KEY; delete env.COMPOSIO_CUSTOM_KEY; C.gated = false; resetProbe(); const c0 = C.reqs.length;
    r = await api(1, "GET", ""); assert.deepEqual([r.json.available, r.json.unavailable_reason], [false, "gated"]); assert.equal(C.reqs.length, c0, "no request without the admin key");
    env.COMPOSIO_CUSTOM_KEY = k; C.gated = true; resetProbe(); }
  // unconfigured
  const keep = env.COMPOSIO_KEY; delete env.COMPOSIO_KEY; r = await api(1, "GET", ""); env.COMPOSIO_KEY = keep;
  assert.equal(r.json.unavailable_reason, "unconfigured");
  // self-managed
  C.gated = false; resetProbe(); d1.prepare("INSERT INTO tenant_flags VALUES ('t3','apps_mode','self',0)").run();
  const sm = await availability(env, "t3"); assert.deepEqual(sm, { available: false, reason: "self_managed" });
  r = await api(1, "GET", ""); assert.equal(r.json.available, true, "a key that may write custom toolkits (404 for the probe slug) → available");
  ok("availability: gated (exact dev-key 403 code 812) / unconfigured / self_managed report available:false with a reason; nothing is created by the probe");
}

// ---------- 2. off by default; the switch ----------
{
  let r = await api(1, "GET", ""); assert.equal(r.json.enabled, false, "off by default for everyone");
  r = await mk(1, {}); assert.equal(r.status, 403); assert.equal(r.json.error.code, "disabled");
  r = await api(1, "PUT", "/settings", { enabled: "yes" }); assert.equal(r.status, 400);
  r = await enable(1); assert.equal(r.json.enabled, true);
  assert.equal((await api(2, "GET", "")).json.enabled, false, "another workspace is unaffected");
  r = await api(1, "GET", "/"); assert.ok(r.status === 200 || r.status === 404);
  r = await route(1, "POST", "/w/ck1/api/custom-mcp/servers", { client_request_id: REQ(), name: "x", url: URL1, auth: { type: "none" } }, { headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403, "cross-origin write refused");
  r = await route(1, "POST", "/w/ck1/api/custom-mcp/servers", { client_request_id: REQ(), name: "x", url: URL1, auth: { type: "none" } }, { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(r.status, 403);
  const anon = await (await import("../src/index.js")).default.fetch(new Request("https://owner.example.com/w/ck1/api/custom-mcp"), env, { waitUntil() {} });
  assert.equal(anon.status, 302, "no session: redirected to sign in, no data");
  r = await route(2, "GET", "/w/ck1/api/custom-mcp"); assert.ok(!r.json?.servers, "someone else's workspace path is not theirs to read");
  ok("off by default for everyone; PUT /settings flips only that workspace; cross-origin writes and other people's workspace paths are refused");
}

// ---------- 3. validation ----------
{
  const bad = async (body, code) => { const r = await mk(1, body); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.error.code, code, JSON.stringify(r.json)); return r; };
  await bad({ url: "http://mcp.acme-demo.dev/mcp" }, "bad_url");
  await bad({ url: "ftp://mcp.acme-demo.dev/mcp" }, "bad_url");
  await bad({ url: "https://user:pw@mcp.acme-demo.dev/mcp" }, "bad_url");
  await bad({ url: "https://mcp.acme-demo.dev/mcp?token=abc" }, "bad_url");
  await bad({ url: "https://mcp.acme-demo.dev:8443/mcp" }, "bad_url");
  for (const u of ["https://127.0.0.1/mcp", "https://localhost/mcp", "https://[::1]/mcp", "https://169.254.169.254/latest/meta-data", "https://10.1.2.3/mcp", "https://192.168.0.5/", "https://[fd00::1]/", "https://2130706433/", "https://0x7f.0.0.1/", "https://metadata.google.internal/", "https://router.local/", "https://intranet/"])
    await bad({ url: u }, "private_url");
  await bad({ auth: { type: "bearer" } }, "unsupported_auth");
  await bad({ auth: null }, "unsupported_auth");
  await bad({ auth: { type: "api_key" } }, "bad_key");
  await bad({ auth: { type: "api_key", key: "k", header: "Host" } }, "bad_header");
  await bad({ auth: { type: "api_key", key: "k", header: "bad header" } }, "bad_header");
  await bad({ auth: { type: "api_key", key: "k", template: "Bearer nothing" } }, "bad_template");
  await bad({ auth: { type: "api_key", key: "k", template: "{{generic_api_key}} {{other}}" } }, "bad_template");
  await bad({ auth: { type: "oauth", discovery_url: "https://169.254.169.254/.well-known/oauth-authorization-server" } }, "private_url");
  await bad({ auth: { type: "oauth", discovery_url: "http://auth.example.com/x" } }, "bad_url");
  await bad({ name: "   " }, "bad_name");
  await bad({ client_request_id: "x" }, "bad_request");
  const r = await bad({ auth: { type: "api_key", key: API_KEY_SECRET, header: "Host" } }, "bad_header"); assert.ok(!r.text.includes(API_KEY_SECRET), "a rejected key is never echoed");
  // DNS: a public-looking name that resolves inside
  hooks.resolve = async (t) => ({ Status: 0, Answer: [{ type: t === "A" ? 1 : 28, data: t === "A" ? "10.0.0.7" : "fd00::7" }] });
  await bad({ url: "https://rebind.attacker-demo.dev/mcp" }, "private_url");
  hooks.resolve = async () => ({ Status: 3 });
  await bad({ url: "https://nxdomain.attacker-demo.dev/mcp" }, "bad_url");
  hooks.resolve = async () => { throw new Error("resolver down"); };
  const r2 = await mk(1, { url: URL1 }); assert.equal(r2.status, 200, "a resolver outage doesn't block (Composio does its own checks)");
  await api(1, "DELETE", `/servers/${r2.json.server.id}`);
  hooks.resolve = async () => ({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] });
  assert.equal(upsertBodies().length, 1, "no bad request reached Composio (the one upsert is the resolver-outage server)");
  // Regression: createServer must look up the real host name (it once looked up the literal name "undefined"). The stub answers only for known names.
  { const seen = [], known = new Set(["mcp.acme-demo.dev", "auth.acme-demo.dev"]);
    hooks.resolve = async (t, host) => { seen.push(host); return known.has(host) ? { Status: 0, Answer: [{ type: t === "A" ? 1 : 28, data: t === "A" ? "93.184.216.34" : "2606:2800:220:1:248:1893:25c8:1946" }] } : { Status: 3 }; };
    const c0 = C.reqs.length;
    const g = await mk(1, { url: URL1 }); assert.equal(g.status, 200, "a valid public host registers");
    assert.ok(seen.length && seen.every((h) => h === "mcp.acme-demo.dev"), `looked up the real host, saw ${seen}`);
    await api(1, "DELETE", `/servers/${g.json.server.id}`);
    seen.length = 0; const nx = await mk(1, { url: "https://nope.acme-demo.dev/mcp" }); assert.equal(nx.json.error.code, "bad_url"); assert.ok(seen.every((h) => h === "nope.acme-demo.dev"));
    seen.length = 0; const dd = await mk(1, { url: URL1, auth: { type: "oauth", discovery_url: "https://gone.acme-demo.dev/.well-known/x" } });
    assert.equal(dd.json.error.code, "bad_url", "the discovery host is checked on its own"); assert.ok(seen.includes("mcp.acme-demo.dev") && seen.includes("gone.acme-demo.dev"));
    C.reqs.splice(c0);   // keep the later upsert counts about their own servers
    hooks.resolve = async () => ({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }); }
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true); assert.equal(isPrivateIp("2606:4700:4700::1111"), false); assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(checkPublicUrl("https://mcp.deepwiki.com/mcp").endpoint, "https://mcp.deepwiki.com/mcp");
  assert.ok(!C.otherFetch?.some((u) => !/cloudflare-dns/.test(u)), "the backend never fetches the user's URL");
  ok("validation: bad schemes, credentials, query, ports, loopback/private/link-local/metadata/IP-literal/local names, bad auth, header/template and discovery URL rejected before any Composio call; DNS rebinding to private ranges refused");
}

// ---------- 4. no-auth: register, sync, list, idempotent, unique per registration ----------
let noauth;
{
  const rid = REQ();
  const r = await api(1, "POST", "/servers", { client_request_id: rid, name: "  Acme [tools] \n\"x\"", url: URL1, auth: { type: "none" } });
  assert.equal(r.status, 200, r.text);
  const s = r.json.server; noauth = s;
  assert.match(s.id, /^cm_[a-z2-7]{20}$/); assert.equal(s.auth, "none"); assert.equal(s.endpoint, URL1); assert.equal(s.name, "Acme tools x");
  assert.equal(s.status, "connected", "no-auth: initial sync at registration, then listed → connected only after tools exist");
  assert.equal(s.tool_count, 2); assert.deepEqual(s.tools.map((t) => t.name), ["echo", "add_note"]);
  assert.ok(!("authorize_url" in r.json));
  const up = upsertBodies().at(-1).body; assert.match(up.slug, /^HC_[A-Z2-7]{16}$/); assert.deepEqual(up.toolkit_config.auth_schemes, [{ mode: "NO_AUTH" }]);
  assert.ok(!JSON.stringify(up).includes("Acme") && !JSON.stringify(up).includes("sam@") && !JSON.stringify(up).includes("t1"), "the Composio name and slug carry no person-chosen text, email or tenant id");
  const row = rows().find((x) => x.id === s.id); assert.equal(row.tenant_id, "t1"); assert.equal(row.user_id, "u1"); assert.equal(row.slug, `CUSTOM_${up.slug}`);
  // idempotent
  const again = await api(1, "POST", "/servers", { client_request_id: rid, name: "Acme", url: URL1, auth: { type: "none" } });
  assert.equal(again.json.server.id, s.id); assert.equal(upsertBodies().length, 2, "same client_request_id: no second registration");
  assert.equal(rows().filter((x) => x.tenant_id === "t1" && x.endpoint === URL1).length, 1, "one registration for that request id");
  const clash = await api(1, "POST", "/servers", { client_request_id: rid, name: "Acme", url: URL2, auth: { type: "none" } }); assert.equal(clash.status, 409); assert.equal(clash.json.error.code, "request_conflict");
  // same URL, new request id, same person: a second, separate registration (never shared)
  const second = await mk(1, {}); assert.notEqual(second.json.server.id, s.id);
  assert.notEqual(rows().find((x) => x.id === second.json.server.id).slug, row.slug);
  assert.equal([...C.toolkits.keys()].filter((k) => k === rows().find((x) => x.id === second.json.server.id).slug || k === row.slug).length, 2, "two toolkits upstream");
  await api(1, "DELETE", `/servers/${second.json.server.id}`);
  const list = await api(1, "GET", ""); assert.equal(list.json.servers.length, 1);
  const one = await api(1, "GET", `/servers/${s.id}`); assert.equal(one.json.server.tools.length, 2);
  ok("no-auth: registered with a generated non-PII slug, synced, listed 'connected' with tools; repeat of the same client_request_id creates nothing new; same URL twice = two registrations");
}

// ---------- 5. API key: write-only secret ----------
let keyed;
{
  const rid = REQ(), k = API_KEY_SECRET;
  const r = await api(1, "POST", "/servers", { client_request_id: rid, name: "Keyed", url: URL2, auth: { type: "api_key", key: k, header: "X-Api-Key" } });
  assert.equal(r.status, 200, r.text); keyed = r.json.server;
  assert.equal(keyed.status, "connected"); assert.equal(keyed.auth, "api_key");
  const up = upsertBodies().at(-1).body; assert.deepEqual(up.toolkit_config.auth_schemes, [{ mode: "API_KEY", headers: { "X-Api-Key": "{{generic_api_key}}" } }], "the header template, never the key");
  const acct = C.reqs.find((q) => q.p === "/connected_accounts" && q.m === "POST"); assert.equal(acct.body.connection.user_id, "1hc:t1"); assert.equal(acct.body.connection.state.val.generic_api_key, k, "the key goes to Composio's credential store, once");
  assert.equal(C.reqs.filter((q) => JSON.stringify(q.body || {}).includes(k)).length, 1, "the key is in exactly one request");
  const sync = C.reqs.filter((q) => q.p === "/custom/toolkits/sync"); assert.ok(sync.every((q) => !JSON.stringify(q.body).includes(k)));
  // the UI's {key} placeholder is translated to Composio's {{generic_api_key}}
  const tk = await mk(1, { url: URL2, auth: { type: "api_key", key: k, header: "Authorization", template: "Token {key}" } }); assert.deepEqual(upsertBodies().at(-1).body.toolkit_config.auth_schemes[0].headers, { Authorization: "Token {{generic_api_key}}" });
  await api(1, "DELETE", `/servers/${tk.json.server.id}`);
  // default header
  const d = await mk(1, { url: URL2, auth: { type: "api_key", key: k } }); const dd = upsertBodies().at(-1).body; assert.deepEqual(dd.toolkit_config.auth_schemes[0].headers, { Authorization: "Bearer {{generic_api_key}}" });
  await api(1, "DELETE", `/servers/${d.json.server.id}`);
  // a wrong key: setup accepts it (Composio only checks one was given), the sync fails → failed, honest, no secret
  const bad = await mk(1, { url: URL2, auth: { type: "api_key", key: "sk-wrong-key" } });
  assert.notEqual(bad.json.server.status, "connected", "never 'connected' before tools synced");
  d1.prepare("UPDATE custom_mcp_server SET sync_started_at=sync_started_at-20000, checked_at=0 WHERE id=?").run(bad.json.server.id);
  let g = await api(1, "GET", `/servers/${bad.json.server.id}`);
  assert.equal(g.json.server.status, "failed"); assert.equal(g.json.server.error.code, "sync_failed"); assert.match(g.json.server.error.message, /rejected the credentials/);
  assert.ok(!g.text.includes("sk-wrong-key"));
  await api(1, "DELETE", `/servers/${bad.json.server.id}`);
  // secrets nowhere else
  const everything = JSON.stringify([H.dump(), H.logs, C.reqs.filter((q) => !(q.p === "/connected_accounts" && q.m === "POST")).map((q) => q.body)]);
  assert.ok(!everything.includes(k) && !everything.includes("sk-wrong-key"), "no API key in D1, logs or any other request");
  assert.ok(!everything.includes(env.COMPOSIO_CUSTOM_KEY) && !everything.includes(env.COMPOSIO_KEY), "neither Composio key is in D1, logs or request bodies");
  ok("API key: stored only at Composio (one request), header template sent without it, a rejected key fails the sync honestly, secret absent from D1/logs/responses");
}

// ---------- 6. sync lifecycle: grace → explicit sync, sync failure, deadline, refresh ----------
{
  C.autoSync = false;
  const r = await mk(1, { name: "Slow" }); const id = r.json.server.id;
  assert.equal(r.json.server.status, "syncing", "not connected before tools synced");
  let g = await api(1, "GET", `/servers/${id}`); assert.equal(g.json.server.status, "syncing");
  const polls = () => C.reqs.filter((q) => q.p === "/tools").length, syncs = () => C.reqs.filter((q) => q.p === "/custom/toolkits/sync").length, syncs0 = syncs();
  const before = polls(); await api(1, "GET", `/servers/${id}`); await api(1, "GET", `/servers/${id}`); assert.equal(polls(), before, "polling faster than every 2 s doesn't hit Composio again");
  assert.equal(syncs(), syncs0, "inside the grace period no manual sync");
  age(id, 9000); g = await api(1, "GET", `/servers/${id}`); // explicit sync, which now works because autoSync only governs the automatic one
  assert.equal(syncs(), syncs0 + 1);
  g = await waitSettled(1, id); assert.equal(g.json.server.status, "connected"); assert.equal(g.json.server.tool_count, 2); assert.ok(g.json.server.last_synced_at > 0);
  // sync failure
  C.servers[URL1].down = true;
  const f = await mk(1, { name: "Down" }); age(f.json.server.id, 9000);
  g = await api(1, "GET", `/servers/${f.json.server.id}`);
  assert.equal(g.json.server.status, "failed"); assert.equal(g.json.server.error.code, "sync_failed"); assert.match(g.json.server.error.message, /unreachable/);
  // refresh recovers once the server is back
  C.servers[URL1].down = false; C.autoSync = true;
  const rf = await api(1, "POST", `/servers/${f.json.server.id}/refresh`); assert.equal(rf.json.server.status, "connected"); assert.equal(rf.json.server.tool_count, 2);
  // refresh failure keeps the working version usable and says so
  C.servers[URL1].down = true;
  const bad = await api(1, "POST", `/servers/${f.json.server.id}/refresh`);
  assert.equal(bad.json.server.status, "connected", "last good tool version stays in use"); assert.equal(bad.json.server.error.code, "refresh_failed"); assert.equal(bad.json.server.tool_count, 2);
  C.servers[URL1].down = false;
  const again = await api(1, "POST", `/servers/${f.json.server.id}/refresh`); assert.equal(again.json.server.error, undefined, "a good refresh clears the note");
  // deadline
  C.autoSync = false; C.servers[URL1].tools = []; const e = await mk(1, { name: "Empty" }); age(e.json.server.id, 9000);
  g = await api(1, "GET", `/servers/${e.json.server.id}`); assert.equal(g.json.server.status, "connected", "a successful sync of an empty server is honest: connected, 0 tools"); assert.equal(g.json.server.tool_count, 0);
  C.servers[URL1].tools = SERVER().tools;
  C.servers[URL1].down = true; const t = await mk(1, { name: "Timeout" }); d1.prepare("UPDATE custom_mcp_server SET sync_attempts=1 WHERE id=?").run(t.json.server.id); age(t.json.server.id, LIMITS.syncDeadlineMs + 1000);
  g = await api(1, "GET", `/servers/${t.json.server.id}`); assert.equal(g.json.server.status, "failed"); assert.equal(g.json.server.error.code, "sync_timeout");
  C.servers[URL1].down = false; C.autoSync = true;
  for (const id2 of [f.json.server.id, e.json.server.id, t.json.server.id, id]) await api(1, "DELETE", `/servers/${id2}`);
  ok("sync lifecycle: syncing until tools exist; polling bounded (2 s); manual sync only after the automatic one had its grace; failed/timeout/empty are honest; refresh recovers, and a failed refresh keeps the last good tools");
}

// ---------- 7. upstream trouble: rate limit, unavailable, partial setup, resume ----------
{
  // 429 on registration: not 'connected', recoverable via the same request id
  C.rateLimit = 3; const rid = REQ();
  let r = await api(1, "POST", "/servers", { client_request_id: rid, name: "Busy", url: URL1, auth: { type: "none" } });
  assert.equal(r.status, 200); assert.equal(r.json.server.status, "failed"); assert.equal(r.json.server.error.code, "busy"); assert.match(r.json.server.error.message, /busy/i);
  C.rateLimit = 0;
  r = await api(1, "POST", "/servers", { client_request_id: rid, name: "Busy", url: URL1, auth: { type: "none" } });
  assert.equal(r.json.server.status, "connected", "the same request id resumes the registration"); assert.equal(rows().filter((x) => x.request_id === rid).length, 1);
  await api(1, "DELETE", `/servers/${r.json.server.id}`);
  // definitive rejection at registration: no row left behind
  const before = rows().length; C.failures.push({ re: "POST /custom/toolkits/upsert", status: 400, msg: `server not reachable for key ${KEY}`, times: 1 });
  r = await mk(1, {}); assert.equal(r.status, 502); assert.equal(r.json.error.code, "rejected"); assert.ok(!r.text.includes(KEY), "an upstream message that echoes the project key is scrubbed");
  assert.equal(rows().length, before, "a definite failure leaves no orphan row");
  // upstream 5xx on registration (retried, then unknown): kept as failed so cleanup can find it
  C.failures.push({ re: "POST /custom/toolkits/upsert", status: 503, times: 5 });
  r = await mk(1, {}); assert.equal(r.status, 200); assert.equal(r.json.server.status, "failed"); const stuck = r.json.server.id;
  assert.equal(r.json.server.error.code, "upstream_error"); C.failures.length = 0;
  // API key partial setup: account creation fails once → failed at step 'authcfg'; the retry (which carries the key again: it is never stored) resumes from that step with no duplicate account or auth config
  const rid2 = REQ(); C.failures.push({ re: "POST /connected_accounts$", status: 400, msg: "no", times: 1 });
  r = await api(1, "POST", "/servers", { client_request_id: rid2, name: "Partial", url: URL2, auth: { type: "api_key", key: API_KEY_SECRET } });
  assert.equal(r.json.server.status, "failed"); assert.equal(rows().find((x) => x.request_id === rid2).step, "authcfg");
  const noKey = await api(1, "POST", "/servers", { client_request_id: rid2, name: "Partial", url: URL2, auth: { type: "api_key", key: API_KEY_SECRET } });
  assert.equal(noKey.json.server.status, "connected", "resumed from the saved step (the retry carries the key again; it was never stored)");
  assert.equal(C.accounts.filter((a) => a.toolkit.slug === rows().find((x) => x.request_id === rid2).slug).length, 1);
  assert.equal(C.authConfigs.filter((a) => a.toolkit.slug === rows().find((x) => x.request_id === rid2).slug).length, 1, "one auth config");
  // the stuck registration is removable and its upstream toolkit (if any) goes
  const del = await api(1, "DELETE", `/servers/${stuck}`); assert.deepEqual(del.json, { ok: true }); assert.ok(!rows().some((x) => x.id === stuck));
  await api(1, "DELETE", `/servers/${noKey.json.server.id}`);
  // server limit
  const filler = []; while (rows().filter((x) => x.tenant_id === "t1").length < LIMITS.servers) { const f = await mk(1, { name: `S${filler.length}` }); assert.equal(f.status, 200); filler.push(f.json.server.id); }
  r = await mk(1, {}); assert.equal(r.status, 409); assert.equal(r.json.error.code, "limit_reached");
  for (const id of filler) await api(1, "DELETE", `/servers/${id}`);
  assert.deepEqual(rows().filter((x) => x.tenant_id === "t1").map((x) => x.id).sort(), [noauth.id, keyed.id].sort(), "only the two earlier servers remain");
  ok("upstream trouble: 429 and 5xx leave a recoverable failed row, definite 4xx leaves nothing, an echoed project key is scrubbed, a half-made API-key setup resumes without duplicates, the server cap holds");
}

// ---------- 8. DCR OAuth + callback security ----------
const OURL = "https://oauth.demo-server.dev/mcp";
const stateOf = (acctId) => new URL(C.accounts.find((a) => a.id === acctId).callback_url).searchParams.get("state");
const cb = (who, slug, qs, headers) => route(who, "GET", `/w/${slug}/custom-mcp/callback?${qs}`, undefined, { headers });
const BACK = "https://owner.example.com/w/ck1/app?settings=advanced";
let oauth;
{
  const r = await api(1, "POST", "/servers", { client_request_id: REQ(), name: "OAuth one", url: OURL, auth: { type: "oauth" } });
  assert.equal(r.status, 200, r.text); oauth = r.json.server;
  assert.equal(oauth.status, "authorization_required"); assert.equal(oauth.tool_count, 0, "not connected, no tools yet");
  assert.match(r.json.authorize_url, /^https:\/\/connect\.composio\.dev\/link\/ca_\d+$/);
  const up = upsertBodies().at(-1).body.toolkit_config.auth_schemes[0]; assert.deepEqual(up, { mode: "DCR_OAUTH", discovery_url: "https://oauth.demo-server.dev/.well-known/oauth-authorization-server" });
  const link = C.reqs.filter((q) => q.p === "/connected_accounts/link").at(-1).body, slug = rows().find((x) => x.id === oauth.id).slug;
  assert.equal(link.user_id, "1hc:t1"); assert.equal(link.auth_config_id, rows().find((x) => x.id === oauth.id).auth_config_id);
  assert.match(link.callback_url, /^https:\/\/owner\.example\.com\/w\/ck1\/custom-mcp\/callback\?state=[a-z2-7]{40}$/, "callback is under the workspace, carries only an opaque state");
  const pending = r.json.authorize_url.split("/").pop(), state = stateOf(pending);
  const stRow = d1.prepare("SELECT * FROM custom_mcp_state").all().at(-1); assert.notEqual(stRow.state_hash, state, "only a hash of the state is stored"); assert.equal(stRow.user_id, "u1"); assert.equal(stRow.tenant_id, "t1"); assert.equal(stRow.server_id, oauth.id);
  assert.ok(stRow.expires_at - Date.now() <= LIMITS.stateTtlMs && stRow.expires_at > Date.now(), "expires");
  const stateRows = () => d1.prepare("SELECT used_at FROM custom_mcp_state WHERE state_hash=?").get(stRow.state_hash);
  const statusNow = async () => (await api(1, "GET", `/servers/${oauth.id}`)).json.server;

  // someone not signed in, someone else, a forged state: nothing happens, the state isn't burned
  const anon = await worker_fetch(`/w/ck1/custom-mcp/callback?state=${state}`); assert.equal(anon.status, 302); assert.ok(!/custom-mcp|settings/.test(anon.headers.get("location")), "no session → back to sign-in");
  C.completeOauth(pending);
  let c = await cb(2, "ck2", `state=${state}&status=success`); assert.equal(c.status, 302);
  assert.equal(stateRows().used_at, null, "another person's workspace can't use or burn the state"); assert.equal((await statusNow()).status, "authorization_required");
  c = await cb(2, "ck1", `state=${state}&status=success`); assert.match(c.text, /Not found|No 1Helm/, "someone else's workspace path is not theirs");
  c = await cb(1, "ck1", `state=${"a".repeat(40)}&status=success`); assert.equal(c.headers.get("location"), BACK); assert.equal((await statusNow()).status, "authorization_required", "forged state: no effect");
  c = await cb(1, "ck1", `status=success`); assert.equal((await statusNow()).status, "authorization_required", "no state: no effect");
  // success
  c = await cb(1, "ck1", `state=${state}&status=success&connected_account_id=ca_other`); assert.equal(c.status, 302); assert.equal(c.headers.get("location"), BACK, "back to Settings → Advanced (?settings=advanced)");
  assert.ok(stateRows().used_at, "single use");
  assert.equal(rows().find((x) => x.id === oauth.id).account_id, pending, "the account comes from the stored pending id, never from the redirect's own parameters");
  let s = await waitSettled(1, oauth.id); assert.equal(s.json.server.status, "connected"); assert.equal(s.json.server.tool_count, 2);
  // replay
  const synced = C.reqs.length; c = await cb(1, "ck1", `state=${state}&status=success`); assert.equal(c.headers.get("location"), BACK);
  assert.equal(rows().find((x) => x.id === oauth.id).account_id, pending); assert.equal(C.reqs.length, synced, "replay: no upstream call, nothing changes");
  // expired state
  let a = await api(1, "POST", `/servers/${oauth.id}/authorize`); assert.equal(a.status, 200); assert.match(a.json.authorize_url, /^https:\/\/connect\.composio\.dev\//);
  let p2 = a.json.authorize_url.split("/").pop(), st2 = stateOf(p2); d1.prepare("UPDATE custom_mcp_state SET expires_at=? WHERE used_at IS NULL").run(Date.now() - 1);
  C.completeOauth(p2); c = await cb(1, "ck1", `state=${st2}&status=success`); assert.equal(rows().find((x) => x.id === oauth.id).account_id, pending, "expired state: no effect");
  // newer authorize invalidates the older state
  const a1 = await api(1, "POST", `/servers/${oauth.id}/authorize`), a2 = await api(1, "POST", `/servers/${oauth.id}/authorize`);
  const s1 = stateOf(a1.json.authorize_url.split("/").pop()), s2 = stateOf(a2.json.authorize_url.split("/").pop());
  C.completeOauth(a1.json.authorize_url.split("/").pop()); c = await cb(1, "ck1", `state=${s1}&status=success`); assert.equal(rows().find((x) => x.id === oauth.id).account_id, pending, "an older state stops working when a new one is issued");
  // cancelled / denied
  c = await cb(1, "ck1", `state=${s2}&error=access_denied`); s = (await api(1, "GET", `/servers/${oauth.id}`)).json.server;
  assert.equal(s.status, "connected", "a cancelled re-authorization doesn't break a working connection"); assert.equal(s.error.code, "authorization_cancelled");
  // forged pending account (another person's account id stored with the state): refused
  const a3 = await api(1, "POST", `/servers/${oauth.id}/authorize`), p3 = a3.json.authorize_url.split("/").pop(), s3 = stateOf(p3);
  C.accounts.push({ id: "ca_victim", user_id: "1hc:t2", toolkit: { slug }, auth_config: { id: rows().find((x) => x.id === oauth.id).auth_config_id }, status: "ACTIVE" });
  d1.prepare("UPDATE custom_mcp_state SET pending_account_id='ca_victim' WHERE state_hash=?").run(await sha(s3));
  c = await cb(1, "ck1", `state=${s3}&status=success`); assert.equal(rows().find((x) => x.id === oauth.id).account_id, pending, "an account that isn't this person's is never adopted");
  // pending account not ACTIVE although the redirect said success
  const a4 = await api(1, "POST", `/servers/${oauth.id}/authorize`), s4 = stateOf(a4.json.authorize_url.split("/").pop());
  c = await cb(1, "ck1", `state=${s4}&status=success`); assert.equal(rows().find((x) => x.id === oauth.id).account_id, pending, "INITIATED account: not adopted");
  // token expiry → reconnect_required → authorize → connected again with the replaced account removed upstream
  C.accounts.find((x) => x.id === pending).status = "EXPIRED"; d1.prepare("UPDATE custom_mcp_server SET checked_at=0 WHERE id=?").run(oauth.id);
  s = (await api(1, "GET", `/servers/${oauth.id}`)).json.server; assert.equal(s.status, "reconnect_required"); assert.equal(s.error.code, "reconnect_required");
  assert.equal((await customUsable(env, "t1")).has(rows().find((x) => x.id === oauth.id).slug.toLowerCase()), false, "an expired sign-in is not usable");
  const a5 = await api(1, "POST", `/servers/${oauth.id}/authorize`), p5 = a5.json.authorize_url.split("/").pop(); C.completeOauth(p5);
  await cb(1, "ck1", `state=${stateOf(p5)}&status=success`); s = await waitSettled(1, oauth.id); assert.equal(s.json.server.status, "connected");
  assert.equal(rows().find((x) => x.id === oauth.id).account_id, p5); assert.ok(!C.accounts.some((x) => x.id === pending), "the replaced account was removed");
  // authorize on other kinds
  let x = await api(1, "POST", `/servers/${keyed.id}/authorize`); assert.equal(x.json.error.code, "unsupported_auth");
  x = await api(1, "POST", `/servers/${noauth.id}/authorize`); assert.equal(x.json.error.code, "unsupported_auth");
  ok("DCR OAuth: state is random, hashed, bound to user+workspace+server, expiring, single-use, superseded by a newer one; callbacks from anyone else / forged / replayed / expired / cancelled / foreign account are inert; success only from the stored pending account; expiry → reconnect_required");
}
async function worker_fetch(path) { const w = (await import("../src/index.js")).default; return w.fetch(new Request(`https://owner.example.com${path}`, { redirect: "manual" }), env, { waitUntil() {} }); }
async function sha(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ---------- 9. two-user isolation over HTTP ----------
{
  await enable(2);
  assert.deepEqual((await api(2, "GET", "")).json.servers, [], "user 2 sees none of user 1's servers");
  for (const [m, p, b] of [["GET", `/servers/${noauth.id}`], ["DELETE", `/servers/${noauth.id}`], ["POST", `/servers/${noauth.id}/refresh`, {}], ["POST", `/servers/${oauth.id}/authorize`, {}], ["GET", `/servers/${keyed.id}`], ["DELETE", `/servers/${keyed.id}`]]) {
    const r = await api(2, m, p, b); assert.equal(r.status, 404, `${m} ${p}`); assert.equal(r.json.error.code, "not_found");
  }
  const forged = await api(2, "GET", "/servers/cm_aaaaaaaaaaaaaaaaaaaa"); assert.equal(forged.status, 404);
  const slugOf = (id) => rows().find((x) => x.id === id).slug;
  const forgedBySlug = await api(2, "GET", `/servers/${slugOf(noauth.id)}`); assert.equal(forgedBySlug.status, 404, "a toolkit slug is not an id");
  assert.ok(rows().some((x) => x.id === noauth.id) && C.toolkits.has(slugOf(noauth.id)), "user 1's resources untouched by those attempts");
  // both register the same URL
  const mine = await api(2, "POST", "/servers", { client_request_id: REQ(), name: "Same URL", url: URL1, auth: { type: "none" } }); assert.equal(mine.status, 200);
  assert.notEqual(mine.json.server.id, noauth.id); assert.notEqual(slugOf(mine.json.server.id), slugOf(noauth.id)); assert.equal(rows().find((x) => x.id === mine.json.server.id).tenant_id, "t2");
  assert.equal((await api(1, "GET", "")).json.servers.some((x) => x.id === mine.json.server.id), false);
  assert.equal((await api(2, "GET", "")).json.servers.length, 1);
  // a client-supplied owner is ignored
  const sneaky = await api(2, "POST", "/servers", { client_request_id: REQ(), name: "Sneaky", url: URL1, auth: { type: "none" }, tenant_id: "t1", user_id: "u1", slug: slugOf(noauth.id), owner: "t1" });
  assert.equal(rows().find((x) => x.id === sneaky.json.server.id).tenant_id, "t2"); assert.notEqual(slugOf(sneaky.json.server.id), slugOf(noauth.id));
  // disabling one workspace doesn't touch the other
  await api(2, "PUT", "/settings", { enabled: false }); assert.equal((await api(1, "GET", "")).json.enabled, true);
  await api(2, "PUT", "/settings", { enabled: true });
  // user 2 removes theirs: only theirs go
  const before = [...C.toolkits.keys()], theirs = [slugOf(mine.json.server.id), slugOf(sneaky.json.server.id)];
  await api(2, "DELETE", `/servers/${mine.json.server.id}`); await api(2, "DELETE", `/servers/${sneaky.json.server.id}`);
  assert.deepEqual(before.filter((k) => !C.toolkits.has(k)).sort(), theirs.sort(), "exactly user 2's two registrations were deleted upstream");
  assert.ok(C.toolkits.has(slugOf(noauth.id)) && C.toolkits.has(slugOf(keyed.id)) && C.toolkits.has(slugOf(oauth.id)), "user 1's registrations survive");
  ok("isolation over HTTP: list/get/refresh/authorize/delete of another person's id or slug → 404; the same URL registered by both = separate registrations; a supplied owner/slug is ignored; switches and removals are per workspace");
}

// ---------- 10. disconnect: block first, delete only that registration, retry when Composio fails ----------
{
  const slugs = () => Object.fromEntries(rows().map((r) => [r.id, r.slug]));
  const S = slugs(), usable = async () => [...(await customUsable(env, "t1")).keys()];
  assert.equal((await usable()).length, 3, "three usable servers");
  C.deleted.length = 0;
  let r = await api(1, "DELETE", `/servers/${oauth.id}`); assert.deepEqual(r.json, { ok: true });
  assert.deepEqual(C.deleted, [S[oauth.id]], "exactly that registration's toolkit was deleted upstream, nothing else");
  assert.ok(!C.toolkits.has(S[oauth.id]) && !C.accounts.some((a) => a.toolkit.slug === S[oauth.id]), "its accounts went with it (documented cascade)");
  assert.ok(C.toolkits.has(S[noauth.id]) && C.toolkits.has(S[keyed.id]) && C.accounts.some((a) => a.toolkit.slug === S[keyed.id]), "the others, and their accounts, are untouched");
  assert.equal(d1.prepare("SELECT COUNT(*) AS n FROM custom_mcp_state WHERE server_id=?").get(oauth.id).n, 0, "oauth states go with it");
  assert.deepEqual((await usable()).sort(), [S[noauth.id], S[keyed.id]].map((x) => x.toLowerCase()).sort());
  assert.ok(C.reqs.filter((q) => q.m === "DELETE").every((q) => /^\/(custom\/toolkits\/CUSTOM_HC_[A-Z2-7]{16}|connected_accounts\/ca_\d+)$/.test(q.p)), "only generated custom slugs / this registration's account are ever deleted");

  // upstream failure: use is blocked at once, row stays 'removing', never usable again, retried later
  C.failures.push({ re: "DELETE /custom/toolkits/", status: 503, times: 12 });
  r = await api(1, "DELETE", `/servers/${keyed.id}`); assert.equal(r.status, 200); assert.equal(r.json.server.status, "removing"); assert.equal(r.json.server.error.code, "cleanup_pending");
  assert.deepEqual(await usable(), [S[noauth.id].toLowerCase()], "blocked immediately, before and while upstream deletion fails");
  assert.ok(C.toolkits.has(S[keyed.id]), "still registered upstream");
  for (const [m, p, b] of [["POST", `/servers/${keyed.id}/refresh`, {}], ["POST", `/servers/${keyed.id}/authorize`, {}]]) { const x = await api(1, m, p, b); assert.ok([400, 409].includes(x.status), `${p}: ${x.text}`); }
  let g = await api(1, "GET", `/servers/${keyed.id}`); assert.equal(g.json.server.status, "removing", "a poll doesn't resurrect it");
  const list = await api(1, "GET", ""); assert.equal(list.json.servers.find((x) => x.id === keyed.id).status, "removing");
  const att = rows().find((x) => x.id === keyed.id).cleanup_attempts; assert.ok(att >= 1);
  // retried from the list once the retry gap passed, still failing → still removing; then Composio recovers
  C.failures.length = 0; C.failures.push({ re: "DELETE /custom/toolkits/", status: 500, times: 3 });
  d1.prepare("UPDATE custom_mcp_server SET cleanup_at=0 WHERE id=?").run(keyed.id); await api(1, "GET", ""); assert.equal(rows().find((x) => x.id === keyed.id)?.status, "removing");
  C.failures.length = 0; d1.prepare("UPDATE custom_mcp_server SET cleanup_at=0 WHERE id=?").run(keyed.id);
  await api(1, "GET", ""); assert.ok(!rows().some((x) => x.id === keyed.id), "the retry finished the removal"); assert.ok(!C.toolkits.has(S[keyed.id]));
  // Remove again by hand also retries, and a toolkit already gone upstream (404) counts as removed
  const m1 = await mk(1, { name: "Gone" }); C.toolkits.delete(rows().find((x) => x.id === m1.json.server.id).slug);
  r = await api(1, "DELETE", `/servers/${m1.json.server.id}`); assert.deepEqual(r.json, { ok: true });
  // a removing row can't be 'created' again by a repeat of its request id
  const rid = REQ(), m2 = await api(1, "POST", "/servers", { client_request_id: rid, name: "R", url: URL1, auth: { type: "none" } });
  C.failures.push({ re: "DELETE /custom/toolkits/", status: 500, times: 3 }); await api(1, "DELETE", `/servers/${m2.json.server.id}`);
  const rep = await api(1, "POST", "/servers", { client_request_id: rid, name: "R", url: URL1, auth: { type: "none" } }); assert.equal(rep.status, 409); assert.equal(rep.json.error.code, "removing");
  C.failures.length = 0; assert.deepEqual((await api(1, "DELETE", `/servers/${m2.json.server.id}`)).json, { ok: true });
  // disabled / gated workspaces can still disconnect; gated just keeps it pending
  const m3 = await mk(1, { name: "Gated removal" }); await api(1, "PUT", "/settings", { enabled: false });
  C.gated = true; resetProbe(); r = await api(1, "DELETE", `/servers/${m3.json.server.id}`); assert.equal(r.json.server.status, "removing"); assert.equal(r.json.server.error.code, "cleanup_pending");
  C.gated = false; d1.prepare("UPDATE custom_mcp_server SET cleanup_at=0 WHERE id=?").run(m3.json.server.id); await api(1, "GET", ""); assert.ok(!rows().some((x) => x.id === m3.json.server.id));
  // saved connections survive switching off and back on
  const keep = rows().filter((x) => x.tenant_id === "t1"); assert.deepEqual(keep.map((x) => x.id), [noauth.id], "the switch never deleted anything");
  assert.equal((await api(1, "GET", "")).json.servers.length, 1, "still listed while off"); assert.deepEqual(await usable(), [], "but not usable while off");
  await enable(1); assert.equal((await usable()).length, 1, "back on: usable again without re-adding");
  ok("disconnect: use blocked first, only that registration's toolkit deleted (cascade accounted), failures keep it 'removing' and unusable, retries from list/delete finish it, 404 = done, repeat create refused, works while off/gated; the switch never deletes saved connections");
}
say(`custom-mcp: ${n} ok`);
