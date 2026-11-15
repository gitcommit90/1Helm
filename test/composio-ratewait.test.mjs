// node --import ./test/stubs/register.mjs test/composio-ratewait.test.mjs
// Rate limited reads of connected apps (src/composio-ratewait.js): Composio is faked at fetch.
//   1. a read the app answered 429 fails at once with a plain message and is not waited for (writes, batches and proxy GETs too).
//   5. the identity lookup is not repeated after a failure within the backoff window, and a good label is kept.
import assert from "node:assert/strict";
import { managedTransport } from "../src/ee/composio-transport.js";
import { resolveAccountIdentity } from "../src/ee/composio-identity.js";
let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const env = { COMPOSIO_KEY: "ak_FAKE_RW" };   // pinned version: direct execution
const R429 = (headers) => ({ successful: false, error: "", data: { http_error: "429 Client Error: Too Many Requests for url: https://oauth.reddit.com/r/x", status_code: 429, ...(headers ? { headers } : {}) } });
const GOOD = (v) => ({ successful: true, data: { response_data: v } });
let script = {}, calls = [], inflight = 0, maxInflight = 0;
globalThis.fetch = async (url, init) => {
  const u = new URL(url), body = init.body ? JSON.parse(init.body) : {};
  const key = u.pathname.replace(/^\/api\/v3\.1\/tools\/execute\//, "");
  calls.push({ key, body });
  inflight++; maxInflight = Math.max(maxInflight, inflight); await new Promise((r) => setTimeout(r, 2)); inflight--;
  const q = script[key === "proxy" ? `proxy ${body.method}` : key];
  const a = q?.length ? q.shift() : GOOD({ ran: key });
  return new Response(JSON.stringify(a), { status: 200, headers: { "content-type": "application/json" } });
};
const reset = (s = {}) => { script = s; calls = []; maxInflight = 0; };
const notes = []; const ctxOf = (o = {}) => ({ app: "reddit", appName: "Reddit", account: "ca_1", readonly: true, rateWait: true, onWait: (t) => notes.push(t), ...o });
const t = managedTransport(env, "t1");

const SHARED = /the app's limit is shared with other 1Helm workspaces, so 1Helm does not wait for it/i;

// 1
reset({ REDDIT_GET: [R429(), GOOD({ posts: 3 })] });
await assert.rejects(t.execute("REDDIT_GET", {}, undefined, ctxOf()), (e) => /HTTP 429/.test(e.message) && SHARED.test(e.message));
assert.equal(calls.length, 1, "one try, no waiting");
ok("a 429 read fails at once with a plain message");

// 2
reset({ REDDIT_POST: [R429(), GOOD({ y: 1 })] });
await assert.rejects(t.execute("REDDIT_POST", {}, undefined, ctxOf({ readonly: false })), /429/); assert.equal(calls.length, 1);
ok("writes are not retried either");

// 3
reset({ A: [GOOD({ a: 1 })], B: [R429(), GOOD({ b: 1 })] });
const rs = await t.multiExecute([{ slug: "A", args: {} }, { slug: "B", args: {} }], ctxOf());
assert.deepEqual(rs.map((r) => [r.slug, r.ok]), [["A", true], ["B", false]]); assert.match(rs[1].error, SHARED); assert.equal(calls.length, 2);
ok("batch: the rate limited read reports the message, the others are kept");

// 4
reset({ "proxy GET": [{ status: 429, data: { error: "x" } }, { status: 200, data: { ok: 1 } }] });
const pr = await t.proxy({ toolkit: "reddit", endpoint: "/api/v1/me", method: "GET" }, { account: "ca_1", app: "reddit", rateWait: true });
assert.equal(pr.status, 429); assert.equal(calls.length, 1);
ok("proxy GET answered 429 is returned at once");

// 5
const scope = {}, acct = { id: "ca_r", status: "ACTIVE", toolkit: { slug: "reddit" }, app: "reddit" }; let lookups = 0, fail = true;
const lookup = async () => { lookups++; if (fail) throw new Error("429"); return { data: { name: "spez" } }; };
await resolveAccountIdentity({ scope, account: acct, lookup }); assert.equal(lookups, 1);
const realNow = Date.now; try {
  await resolveAccountIdentity({ scope, account: acct, lookup }); assert.equal(lookups, 1, "failure not repeated at once");
  Date.now = () => realNow() + 3 * 3600e3; await resolveAccountIdentity({ scope, account: acct, lookup }); assert.equal(lookups, 1, "nor 3 hours later");
  Date.now = () => realNow() + 7 * 3600e3; fail = false; const g = await resolveAccountIdentity({ scope, account: acct, lookup }); assert.equal(lookups, 2); assert.equal(g.label, "spez");
  Date.now = () => realNow() + 90 * 24 * 3600e3; await resolveAccountIdentity({ scope, account: acct, lookup }); assert.equal(lookups, 2, "a good label is kept");
} finally { Date.now = realNow; }
let l2 = 0; await resolveAccountIdentity({ scope: {}, account: { ...acct, alias: "spez" }, lookup: async () => { l2++; return {}; } }); assert.equal(l2, 0, "a saved name needs no lookup");
ok("identity lookup: failure backs off for hours, success kept for good");
console.log(`composio-ratewait: ${n} ok`);
