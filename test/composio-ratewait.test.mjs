// node --import ./test/stubs/register.mjs test/composio-ratewait.test.mjs
// Rate limited reads of connected apps (src/composio-ratewait.js): Composio is faked at fetch, waits are recorded and never slept.
//   1. a read the app answered 429 (successful:false, data.status_code 429) is retried after 20 s and then succeeds; the person sees one progress line.
//   2. a Retry-After passed by Composio is honoured; every try failing returns the rate limit error plus how long 1Helm already waited (schedule 20, 60, 120 s).
//   3. a write is never retried; a read without rateWait (background lookups) is not retried either.
//   4. a batch (multiExecute) is retried one after another, never in parallel; the ones that were fine are not sent again.
//   5. a GET through the proxy that comes back 429 is retried; a POST is not.
//   6. the identity lookup is not repeated after a failure within the backoff window, and a good label is kept.
import assert from "node:assert/strict";
import { managedTransport } from "../src/ee/composio-transport.js";
import { WAIT } from "../src/ee/composio-ratewait.js";
import { resolveAccountIdentity } from "../src/ee/composio-identity.js";
let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const waits = []; WAIT.sleep = async (ms) => { waits.push(ms); };
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
const reset = (s = {}) => { script = s; calls = []; waits.length = 0; maxInflight = 0; };
const notes = []; const ctxOf = (o = {}) => ({ app: "reddit", appName: "Reddit", account: "ca_1", readonly: true, rateWait: true, onWait: (t) => notes.push(t), ...o });
const t = managedTransport(env, "t1");

// 1
reset({ REDDIT_GET: [R429(), GOOD({ posts: 3 })] }); notes.length = 0;
assert.deepEqual(await t.execute("REDDIT_GET", {}, undefined, ctxOf()), { posts: 3 });
assert.deepEqual(waits, [20e3]); assert.equal(calls.length, 2); assert.deepEqual(notes, ["Reddit is limiting requests; trying again in 20 s"]);
ok("429 read retried after 20 s then succeeds, one progress line");

// 2
reset({ REDDIT_GET: [R429({ "Retry-After": "7" }), GOOD({ x: 1 })] });
await t.execute("REDDIT_GET", {}, undefined, ctxOf()); assert.deepEqual(waits, [8e3]);
reset({ REDDIT_GET: [R429(), R429(), R429(), R429()] });
await assert.rejects(t.execute("REDDIT_GET", {}, undefined, ctxOf()), (e) => /rate limited this request \(HTTP 429/.test(e.message) && /already waited 200 seconds and tried 4 times/.test(e.message));
assert.deepEqual(waits, [20e3, 60e3, 120e3]); assert.equal(calls.length, 4);
reset({ REDDIT_GET: [R429({ "X-Ratelimit-Reset": "600" })] });
await assert.rejects(t.execute("REDDIT_GET", {}, undefined, ctxOf()), /429/); assert.deepEqual(waits, [], "a reset longer than the budget is not waited for"); assert.equal(calls.length, 1);
ok("Retry-After honoured; exhausted retries report the waited time; schedule 20/60/120 s");

// 3
reset({ REDDIT_POST: [R429(), GOOD({ y: 1 })] });
await assert.rejects(t.execute("REDDIT_POST", {}, undefined, ctxOf({ readonly: false })), /429/); assert.equal(calls.length, 1); assert.deepEqual(waits, []);
reset({ REDDIT_GET: [R429(), GOOD({})] });
await assert.rejects(t.execute("REDDIT_GET", {}, undefined, ctxOf({ rateWait: false })), /429/); assert.equal(calls.length, 1);
ok("writes and background reads are never retried");

// 4
reset({ A: [GOOD({ a: 1 })], B: [R429(), GOOD({ b: 1 })], C: [R429(), R429(), GOOD({ c: 1 })] });
const rs = await t.multiExecute([{ slug: "A", args: {} }, { slug: "B", args: {} }, { slug: "C", args: {} }], ctxOf());
assert.deepEqual(rs.map((r) => [r.slug, r.ok, r.data]), [["A", true, { a: 1 }], ["B", true, { b: 1 }], ["C", true, { c: 1 }]]);
assert.deepEqual(calls.map((c) => c.key), ["A", "B", "C", "B", "C", "C"], "first round together, then one retry at a time");
const afterFirst = calls.slice(3); assert.equal(afterFirst.filter((c) => c.key === "A").length, 0);
assert.deepEqual(waits, [20e3, 20e3, 60e3]);
reset({ B: [R429(), R429()], C: [R429(), GOOD({})] }); inflight = 0;
await t.multiExecute([{ slug: "B", args: {} }, { slug: "C", args: {} }], ctxOf());
assert.equal(maxInflight <= 2, true, "retries do not run in parallel (only the first round does)");
ok("batch: first round together, rate limited reads retried one after another");

// 5
reset({ "proxy GET": [{ status: 429, data: { error: "x" }, headers: { "retry-after": "3" } }, { status: 200, data: { ok: 1 } }] });
const pr = await t.proxy({ toolkit: "reddit", endpoint: "/api/v1/me", method: "GET" }, { account: "ca_1", app: "reddit", appName: "Reddit", rateWait: true, onWait: (x) => notes.push(x) });
assert.equal(pr.status, 200); assert.deepEqual(waits, [4e3]);
reset({ "proxy POST": [{ status: 429, data: {} }] });
assert.equal((await t.proxy({ toolkit: "reddit", endpoint: "/x", method: "POST", body: {} }, { account: "ca_1", rateWait: true })).status, 429); assert.equal(calls.length, 1);
reset({ "proxy GET": [{ status: 429, data: {} }, { status: 429, data: {} }, { status: 429, data: {} }, { status: 429, data: {} }] });
const pf = await t.proxy({ toolkit: "reddit", endpoint: "/x", method: "GET" }, { account: "ca_1", rateWait: true });
assert.equal(pf.status, 429); assert.equal(pf.waited_ms, 200e3);
ok("proxy GET retried on 429, POST not");

// 6
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
