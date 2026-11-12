// node --import ./test/stubs/register.mjs test/composio-app-errors.test.mjs
// 1. A failed app call with an empty `error` still tells the model what the app said (a 429 reads as rate limiting).
// 2. app_actions with words that match nothing returns the app's unfiltered first page, with a note and Composio's cursor.
import assert from "node:assert/strict";
import { managedTransport, selfManagedTransport, failureText } from "../src/ee/composio-transport.js";
import { RETRY } from "../src/ee/composio-api.js"; RETRY.sleep = async () => {};
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const env = { COMPOSIO_KEY: "ak_FAKE", COMPOSIO_TOOLKIT_VERSION: "latest", APP_HOST: "app.example.test" };
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);
const HTTP = "429 Client Error: Too Many Requests for url: https://oauth.reddit.com/r/MacApps/about/rules?raw_json=1";
const BODY = { successful: false, error: "", data: { http_error: HTTP, message: "", status_code: 429 } };
const RT = Array.from({ length: 5 }, (_, i) => ({ slug: `REDDIT_T${i}`, name: `T${i}`, description: "d", toolkit: { slug: "reddit" }, tags: [], input_parameters: { type: "object", properties: {} } }));
let urls = [];
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u)), p = url.pathname.replace(/^\/api\/v3\.1/, ""), j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  urls.push(url);
  if (p === "/tools" ) { const q = url.searchParams.get("query"); const off = Number(url.searchParams.get("cursor") || 0);
    if (q) return j({ items: [], next_cursor: null });
    return j({ items: RT.slice(off, off + 2), next_cursor: off + 2 < RT.length ? String(off + 2) : null }); }
  if (p.startsWith("/tools/execute/")) return j(BODY);
  return j({ error: { message: `unexpected ${p}` } }, 500);
};
{
  const t = failureText(BODY); assert.match(t, /429/); assert.match(t, /Too Many Requests for url/); assert.match(t, /rate limited/i); assert.ok(!/the app said no/.test(t));
  assert.equal(failureText({ successful: false, error: "", data: {} }), "the app said no");
  assert.match(failureText({ error: "", data: { status_code: 404, message: "no such sub" } }), /HTTP 404: no such sub/);
  assert.equal(failureText({ error: "bad input" }), "bad input"); ok("failureText wording");
}
{
  const tr = managedTransport(env, "t1");
  await assert.rejects(tr.execute("REDDIT_GET_SUBREDDIT_RULES", {}, undefined, { account: "ca_r", readonly: true }), (e) => /429/.test(e.message) && /Too Many Requests/.test(e.message)); ok("managed execute carries the 429 text");
}
{
  const mcp = async () => ({ data: { results: [{ index: 0, response: BODY }] } });
  const tr = selfManagedTransport({ mcp, catalog: managedTransport(env, "t1") });
  const [r] = await tr.multiExecute([{ slug: "REDDIT_GET_SUBREDDIT_RULES", args: {}, account: "a" }]);
  assert.equal(r.ok, false); assert.match(r.error, /429/); assert.match(r.error, /Too Many Requests/); ok("self-managed multi carries the 429 text");
}
{
  const tr = managedTransport(env, "t1");
  const r = await tr.list("read my account profile karma age and subreddit rules and posts", { app: "reddit", appName: "Reddit" });
  assert.equal(r.tools.length, 2); assert.match(r.note, /No action matched/); assert.equal(r.next, "all:2");
  assert.ok(urls.some((u) => u.searchParams.get("query")), "the filtered search was tried first");
  const r2 = await tr.list("read my account profile karma age and subreddit rules and posts", { app: "reddit", appName: "Reddit", cursor: r.next });
  assert.deepEqual(r2.tools.map((x) => x.slug), ["REDDIT_T2", "REDDIT_T3"]); assert.equal(r2.next, "all:4"); assert.ok(!r2.note); ok("empty filtered search returns the unfiltered list and pages on");
}
{
  const tr = selfManagedTransport({ mcp: async () => ({}), catalog: managedTransport(env, "t1") });
  const r = await tr.list("read my account profile karma age", { app: "reddit", appName: "Reddit", cursor: "all:2" });
  assert.deepEqual(r.tools.map((x) => x.slug), ["REDDIT_T2", "REDDIT_T3"]); ok("self-managed paging with a fallback cursor");
}
