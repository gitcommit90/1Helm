// node --import ./test/stubs/register.mjs test/connect-pace.test.mjs
// composio-ratelimit (10-20): pacedConnect (src/ee/connect-pace.js) spaces the sign-in links for one workspace, waits out Composio's
// one-minute window instead of handing out a link that its hosted page would refuse, and remembers a 429's Retry-After. D1 is a real
// SQLite (tenant_flags); Composio is never called, the link maker is a stub.
import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { DatabaseSync } from "node:sqlite";
import { pacedConnect, CONNECT_GAP_MS, COOLDOWN_MAX_MS, COOLDOWN_DEFAULT_MS } from "../src/ee/connect-pace.js";
import { GAUGE, rateLimited, composioRequest, RETRY, retryAfterMs } from "../src/ee/composio-api.js";
let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const d1 = new DatabaseSync(":memory:"); d1.exec(readFileSync(new URL("../db/migrations/0013_023_tenant_flags.sql", import.meta.url), "utf8"));
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
const env = { DB }; let T = 1000000; const clock = { now: () => T };
const link = () => { calls++; return { url: "https://connect.composio.dev/link/lk_1", pending_id: "ca_1" }; }; let calls = 0;
const reset = () => { GAUGE.remaining = null; GAUGE.limit = null; GAUGE.resetAt = 0; calls = 0; d1.exec("DELETE FROM tenant_flags"); };

// 1. the first link goes straight out; a second one asked for at once (another app, rapid taps) waits for the gap.
reset();
let r = await pacedConnect(env, "t1", link, clock); assert.equal(r.url.startsWith("https://"), true); assert.equal(calls, 1);
r = await pacedConnect(env, "t1", link, clock); assert.equal(r.why, "spacing"); assert.equal(calls, 1); assert.equal(r.wait, Math.ceil(CONNECT_GAP_MS / 1000)); assert.ok(r.wait_ms > 0 && r.wait_ms <= CONNECT_GAP_MS);
T += CONNECT_GAP_MS; r = await pacedConnect(env, "t1", link, clock); assert.ok(r.url); assert.equal(calls, 2);
ok("links for one workspace are spaced; the second tap gets a wait, not a link");

// 2. another workspace is not held by the first one's gap.
r = await pacedConnect(env, "t2", link, clock); assert.ok(r.url); assert.equal(calls, 3);
ok("the gap is per workspace");

// 3. two taps at the same moment: exactly one link is made.
reset(); const both = await Promise.all([pacedConnect(env, "t3", link, clock), pacedConnect(env, "t3", link, clock)]);
assert.equal(calls, 1); assert.equal(both.filter((x) => x.url).length, 1); assert.equal(both.filter((x) => x.wait).length, 1);
ok("two taps at once make one link");

// 4. Composio answers 429 with Retry-After 42 s: no link, a wait of 42 s, and the workspace is held for it (no second request to Composio).
reset(); T += 100000;
let r429 = 0; const limited = () => { r429++; throw rateLimited(42000); };
r = await pacedConnect(env, "t4", limited, clock); assert.equal(r.wait, 42); assert.equal(r.why, "limit"); assert.equal(r429, 1);
T += 10000; r = await pacedConnect(env, "t4", limited, clock); assert.equal(r.why, "spacing"); assert.equal(r429, 1); assert.equal(r.wait, 32);
T += 32000; r = await pacedConnect(env, "t4", link, clock); assert.ok(r.url);
ok("a 429 from Composio becomes a wait that uses Retry-After and holds later taps without calling Composio");

// 5. a 429 with no Retry-After waits the default; an absurd Retry-After is capped.
reset(); T += 100000;
r = await pacedConnect(env, "t5", () => { throw rateLimited(null); }, clock); assert.equal(r.wait_ms, COOLDOWN_DEFAULT_MS);
reset(); r = await pacedConnect(env, "t5", () => { throw rateLimited(900000); }, clock); assert.equal(r.wait_ms, COOLDOWN_MAX_MS);
ok("no Retry-After uses 60 s, a huge one is capped");

// 6. other errors pass through unchanged and don't hold the workspace for more than the gap.
reset(); T += 100000;
await assert.rejects(pacedConnect(env, "t6", () => { throw new Error("Slack can't be connected yet."); }, clock), /can't be connected/);
ok("other errors are thrown as before");

// 7. the headers said the window is nearly spent: no link is made until it resets; after that the link goes out.
reset(); T += 100000; GAUGE.remaining = 3; GAUGE.limit = 2000; GAUGE.resetAt = T + 20000;
r = await pacedConnect(env, "t7", link, clock); assert.equal(r.why, "limit"); assert.equal(calls, 0); assert.equal(r.wait, 20);
T += 20001; r = await pacedConnect(env, "t7", link, clock); assert.ok(r.url); assert.equal(calls, 1);
ok("a nearly spent window holds the link until it resets");

// 8. the link request itself used up the window: the link is not handed out; the person waits for the reset.
reset(); T += 100000;
const using = () => { calls++; GAUGE.remaining = 2; GAUGE.limit = 2000; GAUGE.resetAt = T + 15000; return { url: "https://connect.composio.dev/link/lk_2" }; };
r = await pacedConnect(env, "t8", using, clock); assert.equal(r.url, undefined); assert.equal(r.wait, 15); assert.equal(r.why, "limit");
ok("a link made when the window ran out is held back, not opened");

// 9. a limit that has already reset doesn't hold anything; a missing D1 never blocks.
reset(); GAUGE.remaining = 1; GAUGE.limit = 2000; GAUGE.resetAt = T - 1;
r = await pacedConnect(env, "t9", link, clock); assert.ok(r.url);
r = await pacedConnect({}, "t9", link, clock); assert.ok(r.url);
ok("an elapsed window and a missing database don't block");

// 10. composioRequest hands the Retry-After on the error it throws, so the route can use it.
reset(); RETRY.sleep = async () => {}; RETRY.log = () => {}; RETRY.random = () => 0;
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), { status: 429, headers: { "retry-after": "60", "content-type": "application/json" } });
const e = await composioRequest({ COMPOSIO_KEY: "ak_FAKE" }, "/connected_accounts/link", { method: "POST", body: "{}" }).catch((x) => x);
assert.equal(e.rateLimited, true); assert.equal(e.retryAfterMs, 60000); assert.equal(retryAfterMs(new Headers({ "retry-after": "60" })), 60000);
ok("the 429 error carries Retry-After");
console.log(`connect-pace: ${n} checks passed`);
