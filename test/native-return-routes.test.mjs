// node --import ./test/stubs/register.mjs test/native-return-routes.test.mjs
// Real Worker routes with the Composio fake (test/custom-mcp-harness.mjs). ALL MOCKED. A sign-in started inside a phone app:
// /apps/return needs no session, custom MCP gives Composio that address, and the signed-in app finishes the sign-in when it comes back.
import assert from "node:assert/strict";
import { makeHarness, SERVER, say, ORIGIN } from "./custom-mcp-harness.mjs";
let n = 0; const ok = (name) => { n++; say(`ok ${n} - ${name}`); };
const H = makeHarness(), { C, api, route, rows, d1, env, enable, REQ } = H;
const OURL = "https://oauth.demo-server.dev/mcp"; C.servers[OURL] = SERVER("oauth");
const worker = (await import("../src/index.js")).default;

// 1. /apps/return through the Worker with no cookie at all.
{
  const r = await worker.fetch(new Request(`${ORIGIN}/apps/return?next=https://evil.test`, { redirect: "manual" }), env, { waitUntil() {} });
  const t = await r.text(); assert.equal(r.status, 200); assert.match(t, /Go back to the 1Helm app/); assert.match(t, /onehelm:\/\/openrouter/); assert.doesNotMatch(t, /evil\.test/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  ok("/apps/return answers a request with no session");
}

await enable(1);
// 2. custom MCP: native flag gives the new return address; the sign-in is finished by the signed-in app, never by the phone's browser.
{
  const r = await api(1, "POST", "/servers?native=android", { client_request_id: REQ(), name: "OAuth native", url: OURL, auth: { type: "oauth" } });
  assert.equal(r.status, 200, r.text); const srv = r.json.server, pending = r.json.authorize_url.split("/").pop();
  assert.equal(C.reqs.filter((q) => q.p === "/connected_accounts/link").at(-1).body.callback_url, `${ORIGIN}/apps/return`);
  let f = await api(2, "POST", `/servers/${srv.id}/finish?native=android`); assert.notEqual(f.status, 200, "another person can't finish it");
  f = await api(1, "POST", `/servers/${srv.id}/finish?native=android`); assert.equal(f.status, 200); assert.equal(f.json.pending, true, "not signed in yet: still waiting");
  assert.equal(d1.prepare("SELECT used_at FROM custom_mcp_state").all().at(-1).used_at, null, "the state is kept while waiting");
  C.completeOauth(pending);
  f = await api(1, "POST", `/servers/${srv.id}/finish?native=android`); assert.equal(f.status, 200); assert.equal(f.json.pending, false);
  assert.equal(rows().find((x) => x.id === srv.id).account_id, pending, "the account is the stored pending one");
  assert.ok(d1.prepare("SELECT used_at FROM custom_mcp_state").all().at(-1).used_at, "single use");
  f = await api(1, "POST", `/servers/${srv.id}/finish?native=android`); assert.equal(f.json.pending, false); assert.equal(rows().find((x) => x.id === srv.id).account_id, pending, "a repeat changes nothing");
  ok("custom MCP: native sign-in returns to /apps/return and the app finishes it (other users refused, single use)");

  // 3. no flag: the browser callback is exactly as before.
  const U2 = "https://oauth.other-demo.dev/mcp"; C.servers[U2] = SERVER("oauth");
  const b = await api(1, "POST", "/servers", { client_request_id: REQ(), name: "OAuth browser", url: U2, auth: { type: "oauth" } }); assert.equal(b.status, 200, b.text);
  assert.match(C.reqs.filter((q) => q.p === "/connected_accounts/link").at(-1).body.callback_url, /^https:\/\/owner\.example\.com\/w\/ck1\/custom-mcp\/callback\?state=[a-z2-7]{40}$/);
  const x = await api(1, "POST", `/servers/${b.json.server.id}/authorize?native=mac`); assert.equal(x.status, 200, x.text); assert.match(C.reqs.filter((q) => q.p === "/connected_accounts/link").at(-1).body.callback_url, /\/custom-mcp\/callback\?state=/, "an unknown platform is not native");
  ok("custom MCP: no native flag keeps the browser callback");
}
console.log(`# ${n} passed`);
process.exit(0);
