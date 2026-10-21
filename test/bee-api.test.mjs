// node --import ./test/stubs/register.mjs test/bee-api.test.mjs
// The Bee data API from the Worker (src/bee-api.js): the transport only. Fetch is stubbed with deps.fetch, and deps.sleep records the waits.
//  - beeOnce: URL, Bearer header, timeout, network errors, and a token that shows up in an error message is redacted;
//  - beeData: 3 tries on 429/5xx/network (1 s, 2 s), a 401 is never retried, paths are checked;
//  - syncGetter / beeSyncJob (the old SYNC_JS rules): GET and /v1/ only, a network error is tried 3 times, a 5xx without Retry-After is not
//    retried (reported as slow), a short Retry-After is waited out, a long one (a 429) stops the run's other calls, 401 stops at once;
//  - writeRequester / beeFactsJob (the old WRITE_JS rules): PUT always with the fact's tags (read first when missing; nothing written if
//    unreadable), DELETE, POST once, anything else refused, only the fact paths;
//  - liveGetter: only the list and one conversation, a 429 is not retried and carries Retry-After, a network error is tried once more.
// The sync, write, live and stream logic itself is covered by bee-sync, bee-facts, bee-backfill, bee-stream and live-notes tests.
import assert from "node:assert";
import * as A from "../src/ee/bee-api.js";

const ok = (name) => console.log("  ok", name);
const keepAlive = setInterval(() => {}, 50);   // AbortSignal.timeout's timer doesn't keep Node running
const mkFetch = (handle) => { const seen = []; const f = async (url, init = {}) => { seen.push({ url, method: init.method, auth: init.headers?.authorization, body: init.body ?? null, signal: init.signal }); const r = await handle(url.slice(A.API_ROOT.length), init.method, seen.length);
  if (r instanceof Error) throw r; return new Response(r.body ?? "", { status: r.status, headers: r.headers || {} }); }; return { f, seen }; };
const sleeps = [], deps = (f) => ({ fetch: f, sleep: async (ms) => { sleeps.push(ms); } });
const reset = () => { sleeps.length = 0; };

// ---- 1. beeOnce ----
{
  const { f, seen } = mkFetch(async () => ({ status: 200, body: '{"id":7}' }));
  const r = await A.beeOnce("tok-123456", "PUT", "/v1/facts/7", { body: { text: "x" }, deps: { fetch: f } });
  assert.deepEqual(r, { status: 200, body: '{"id":7}' }); assert.equal(seen[0].url, "https://api.developer.bee.amazon.dev/v1/facts/7"); assert.equal(seen[0].auth, "Bearer tok-123456");
  assert.equal(seen[0].method, "PUT"); assert.equal(seen[0].body, '{"text":"x"}');
  const e429 = mkFetch(async () => ({ status: 429, body: "slow", headers: { "retry-after": "7" } })); assert.deepEqual(await A.beeOnce("t", "GET", "/v1/me", { deps: { fetch: e429.f } }), { status: 429, body: "slow", retry_ms: 7000 });
  const e503 = mkFetch(async () => ({ status: 503, body: "" })); assert.deepEqual(await A.beeOnce("t", "GET", "/v1/me", { deps: { fetch: e503.f } }), { status: 503, body: "", retry_ms: null });
  const net = mkFetch(async () => new TypeError("fetch failed for Bearer tok-secret-12345")); const rn = await A.beeOnce("tok-secret-12345", "GET", "/v1/me", { deps: { fetch: net.f } });
  assert.equal(rn.status, 0); assert.ok(!JSON.stringify(rn).includes("tok-secret-12345"), "a token in an error message is redacted"); assert.match(rn.error, /\[token\]/);
  // a hung request is cut by the timeout
  const hung = async (url, init) => new Promise((_, no) => init.signal.addEventListener("abort", () => no(init.signal.reason)));
  const t0 = Date.now(), rt = await A.beeOnce("t", "GET", "/v1/me", { timeoutMs: 60, deps: { fetch: hung } }); assert.deepEqual(rt, { status: 0, error: "timeout" }); assert.ok(Date.now() - t0 < 2000);
  assert.equal(A.retryAfter("120"), 120000); assert.equal(A.retryAfter("0"), 0); assert.equal(A.retryAfter(undefined), null); assert.equal(A.retryAfter("soon"), null); assert.ok(Math.abs(A.retryAfter(new Date(Date.now() + 90e3).toUTCString()) - 90e3) < 2000);
  ok("beeOnce: public endpoint URL, Bearer header, JSON body, Retry-After on 429/5xx, network error → status 0 (token redacted), timeout");
}

// ---- 2. beeData ----
{
  reset(); let n = 0;
  let { f, seen } = mkFetch(async () => ++n < 3 ? { status: 502, body: "bad" } : { status: 200, body: '{"id":1,"first_name":"A"}' });
  let r = await A.beeData({}, "t1", "tok-aaaaaaa", "GET", "/v1/me", undefined, deps(f)); assert.equal(r.status, 200); assert.deepEqual(r.json, { id: 1, first_name: "A" }); assert.equal(seen.length, 3, "a 502 twice, then 200"); assert.deepEqual(sleeps, [1000, 2000]);
  reset(); ({ f, seen } = mkFetch(async () => ({ status: 401, body: '{"error":"Unauthorized"}' }))); r = await A.beeData({}, "t1", "tok-aaaaaaa", "GET", "/v1/me", undefined, deps(f)); assert.equal(r.status, 401); assert.equal(seen.length, 1, "a 401 is not retried"); assert.deepEqual(sleeps, []);
  reset(); ({ f, seen } = mkFetch(async () => new Error("ECONNRESET"))); r = await A.beeData({}, "t1", "tok-aaaaaaa", "GET", "/v1/me", undefined, deps(f)); assert.equal(r.status, 0); assert.equal(r.error, "ECONNRESET"); assert.equal(seen.length, 3);
  reset(); ({ f, seen } = mkFetch(async () => ({ status: 200, body: "{}" }))); await A.beeData({}, "t1", "tok-aaaaaaa", "POST", "/v1/facts", { text: "hi" }, deps(f)); assert.equal(seen[0].body, '{"text":"hi"}');
  await assert.rejects(A.beeData({}, "t1", "x", "GET", "https://evil.example/v1/me", undefined, deps(f)), /not a Bee API path/); await assert.rejects(A.beeData({}, "t1", "x", "GET", "/v1/../admin", undefined, deps(f)), /not a Bee API path/);
  ok("beeData: 3 tries on 5xx / no answer (1 s, 2 s), a 401 is not retried, a body is sent as JSON, only /v1/ paths");
}

// ---- 3. a sync run (the old SYNC_JS rules) ----
{
  const c = (id, o = {}) => ({ id, start_time: 1000, end_time: 2000, state: "COMPLETED", transcriptions: [{ utterances: [] }], ...o });
  let flaky = 1, hot = false, revoked = false, cursorBad = false;
  const { f, seen } = mkFetch(async (path) => {
    if (revoked) return { status: 401, body: '{"error":"Unauthorized"}' };
    if (path.startsWith("/v1/changes")) { if (path.includes("cursor=v1-bad")) return { status: 400, body: '{"error":"cursor_too_old"}' }; return { status: 200, body: JSON.stringify({ facts: [], conversations: [201, 202, 203], dailies: [], journals: [], todos: [], since: 1, until: 2, updated: true, timezone: "UTC", next_cursor: "v1-2" }) }; }
    if (hot && path.startsWith("/v1/conversations/")) return { status: 429, body: '{"error":"slow down"}', headers: { "retry-after": "120" } };
    if (path === "/v1/conversations/201") return flaky-- > 0 ? { status: 502, body: "{}", headers: { "retry-after": "1" } } : { status: 200, body: JSON.stringify({ conversation: c(201), timezone: "UTC" }) };
    if (path === "/v1/conversations/209") return { status: 503, body: "{}" };
    if (path === "/v1/conversations/202") return { status: 200, body: JSON.stringify({ conversation: c(202, { end_time: null, state: "CAPTURING" }), timezone: "UTC" }) };
    return { status: 404, body: '{"error":"Conversation not found"}' };
  });
  const run = (input) => A.beeSyncJob({}, "t1", "tok-777777", input, deps(f));
  reset(); let r = await run({ cursor: "v1-1", ids: [201], max: 25 });
  assert.equal(r.status, 200); assert.equal(r.reset, false); assert.deepEqual(r.changes, { next_cursor: "v1-2", since: 1, until: 2, updated: true, timezone: "UTC", conversations: 3, facts: 0, todos: 0, dailies: 0, journals: 0 });
  assert.deepEqual(r.convs.map((x) => [x.id, x.status]), [[201, 200], [202, 200], [203, 404]]); assert.equal(r.convs[0].conv.timezone, "UTC"); assert.equal(r.convs[1].conv.end_time, null);
  assert.ok(seen.every((s) => s.auth === "Bearer tok-777777" && s.method === "GET" && s.url.startsWith(A.API_ROOT + "/v1/")), "GET only, the token only to Bee");
  assert.equal(seen.filter((s) => s.url.endsWith("/v1/conversations/201")).length, 2, "the 502 was retried after its Retry-After (1 s)"); assert.deepEqual(sleeps, [1000]);
  assert.equal(seen.filter((s) => /conversations\/20[12]$/.test(s.url)).length, 3, "ids de-duplicated"); assert.equal(typeof r.ms, "number");
  r = await run({ cursor: "v1-bad", max: 2 }); assert.equal(r.reset, true); assert.deepEqual(r.more, [203], "over max → more"); assert.equal(r.convs.length, 2); assert.ok(seen.some((s) => s.url === A.API_ROOT + "/v1/changes"), "re-read without the refused cursor");
  let k = seen.length; r = await run({ cursor: "v1-1", ids: [209], max: 25 });
  assert.equal(seen.slice(k).filter((s) => s.url.endsWith("/v1/conversations/209")).length, 1, "no blind quick retry"); assert.deepEqual(r.slow, { status: 503, retry_ms: null });
  hot = true; k = seen.length; r = await run({ cursor: "v1-1", ids: [204, 205, 206, 207, 208], max: 25 });
  assert.equal(seen.slice(k).filter((s) => /\/v1\/conversations\/\d+$/.test(s.url)).length, 4, "the first 4 (one batch) hit the 429; the other 4 were never sent");
  assert.equal(r.status, 200); assert.deepEqual(r.slow, { status: 429, retry_ms: 120000 }); assert.ok(r.convs.every((x) => x.status === 429)); hot = false;
  revoked = true; r = await run({ cursor: "v1-1" }); assert.equal(r.status, 401);
  // a network error is tried 3 times (1 s, 2 s), then reported
  reset(); const net = mkFetch(async () => new Error("ECONNRESET")); r = await A.beeSyncJob({}, "t1", "tok-777777", { cursor: "v1-1" }, deps(net.f)); assert.equal(net.seen.length, 3); assert.deepEqual(sleeps, [1000, 2000]); assert.equal(r.status, 0); assert.equal(r.error, "ECONNRESET");
  // only /v1/ paths
  assert.deepEqual(await A.syncGetter("t", deps(f))("/admin"), { status: 0, error: "bad path" });
  ok("sync run: changes → conversations 4 at a time, ids de-duplicated, a 5xx retried only after a short Retry-After (none: not retried; a 429 stops the run's other calls; both reported as slow), 404 reported, over max → more, refused cursor → once more without it, 401 stops, network errors tried 3 times");
}

// ---- 4. fact writes (the old WRITE_JS rules) ----
{
  const flaky = { n: 1 };
  const { f, seen } = mkFetch(async (path, method) => {
    if (method === "GET" && path === "/v1/facts/7") return { status: 200, body: JSON.stringify({ fact: { id: 7, text: "old", tags: ["food", "drinks"], confirmed: true, created_at: 1 } }) };
    if (method === "PUT" && path === "/v1/facts/7") return flaky.n-- > 0 ? { status: 502, body: "{}" } : { status: 200, body: JSON.stringify({ id: 7, text: "new", tags: ["food", "drinks"], confirmed: true }) };
    if (method === "DELETE" && path === "/v1/facts/8") return { status: 200, body: '{"ok":true}' };
    if (method === "POST" && path === "/v1/facts") return { status: 500, body: '{"error":"boom"}' };
    return { status: 404, body: '{"error":"Fact not found"}' };
  });
  reset();
  const r = await A.beeFactsJob({}, "t1", "tok-999999", [{ op: "put", id: 7, body: { text: "new", confirmed: true } }, { op: "delete", id: 8 }, { op: "post", body: { text: "x" } },
    { op: "put", id: 9, body: { text: "no tags given and unreadable", confirmed: true } }, { op: "get", id: 7 }, { op: "put", id: 7, body: { text: "", tags: [], confirmed: true } }, { op: "delete", id: "../me" }], deps(f));
  assert.equal(r.status, 200); assert.deepEqual(r.results.map((x) => [x.op, x.status]), [["put", 200], ["delete", 200], ["post", 500], ["put", 404], ["get", 0], ["put", 0], ["delete", 0]]);
  const puts = seen.filter((s) => s.method === "PUT"); assert.equal(puts.length, 2, "the 502 was retried");
  assert.deepEqual(JSON.parse(puts.at(-1).body), { text: "new", tags: ["food", "drinks"], confirmed: true }, "no tags given → the fact's own tags were read and sent");
  assert.equal(seen.filter((s) => s.method === "POST").length, 1, "a POST is never sent twice");
  assert.ok(!seen.some((s) => s.method === "PUT" && s.url.endsWith("/v1/facts/9")), "tags unreadable → nothing written");
  assert.ok(seen.every((s) => s.auth === "Bearer tok-999999" && /\/v1\/facts(\/\d+)?$/.test(s.url)), "only the fact paths, the Bearer token");
  const req = A.writeRequester("t", deps(f)); assert.deepEqual(await req("PATCH", "/v1/facts/7"), { status: 0, error: "not allowed" }); assert.deepEqual(await req("GET", "/v1/changes"), { status: 0, error: "not allowed" });
  ok("fact writes: PUT always with tags (read first when missing; nothing written if unreadable), DELETE, POST once; anything else refused; only the fact paths");
}

// ---- 5. Live notes reads ----
{
  reset(); let mode = 200;
  const { f, seen } = mkFetch(async () => mode === 429 ? { status: 429, body: "{}", headers: { "retry-after": "7" } } : mode === 0 ? new Error("ECONNRESET") : { status: 200, body: "{}" });
  const get = A.liveGetter("tok-111111", deps(f));
  assert.equal((await get("/v1/conversations?limit=10")).status, 200); assert.equal((await get("/v1/conversations/701")).status, 200);
  for (const bad of ["/v1/facts", "/v1/changes", "/v1/stream?types=all", "/v1/conversations/12/transcript", "https://evil.example/v1/conversations/1"]) assert.deepEqual(await get(bad), { status: 0, error: "bad path" }, bad);
  mode = 429; const n0 = seen.length; assert.deepEqual(await get("/v1/conversations?limit=10"), { status: 429, body: "{}", retry_ms: 7000 }); assert.equal(seen.length, n0 + 1, "a 429 is not retried here");
  mode = 0; const n1 = seen.length; const r = await get("/v1/conversations/701"); assert.equal(r.status, 0); assert.equal(seen.length, n1 + 2, "a network error is tried once more"); assert.deepEqual(sleeps, [500]);
  ok("Live notes reads: only the list and one conversation, a 429 isn't retried and carries Retry-After, a network error is tried once more");
}
clearInterval(keepAlive);
console.log("bee-api: ok");
