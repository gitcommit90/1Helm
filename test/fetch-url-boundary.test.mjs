import assert from "node:assert/strict";
import { BUSY, browserRejectRequestPatterns, fetchPage, publicPageUrl, webSearch } from "../src/websearch.js";

const env = { APP_HOST: "owner.example.com", GATEWAY_HOST: "owner.example.com", SUPPORT_EMAIL: "help@example.com" };
for (const url of ["http://localhost/x", "http://localhost./x", "http://127.0.0.1/x", "http://2130706433/x", "http://[::1]/x",
  "http://metadata.google.internal/x", "http://host.local/x", "http://router.lan/x", "http://nas.home/x",
  "http://printer.home.arpa/x", "http://office.corp/x", "http://host.intranet/x", "http://service.localdomain/x",
  "http://hidden.onion/x",
  "https://owner.example.com/api/x", "https://intranet/x",
  "https://name:pass@public.example/x", "file:///workspace/x"]) assert.equal(publicPageUrl(url, env), null, url);
assert.equal(publicPageUrl("https://public.example/x", env)?.hostname, "public.example");
const browserRejects = browserRejectRequestPatterns(env).map((pattern) => {
  assert.match(pattern, /^\/.+\/$/, "Cloudflare expects slash-delimited regex strings");
  return new RegExp(pattern.slice(1, -1));
});
for (const url of ["http://localhost/x", "http://127.0.0.1/x", "http://2130706433/x", "http://[::1]/x",
  "http://metadata.google.internal/x", "http://router.lan/x", "http://printer.home.arpa/x",
  "https://owner.example.com/api/x", "https://intranet/x", "https://name:pass@public.example/x"])
  assert.ok(browserRejects.some((pattern) => pattern.test(new URL(url).href)), `browser request to ${url} must be rejected`);
for (const url of ["https://public.example/x", "https://public.example.com/x", "https://other.example/owner.example.com"])
  assert.ok(!browserRejects.some((pattern) => pattern.test(url)), `public browser request to ${url} must be allowed`);

const seen = [];
const fetchImpl = async (url, opts) => {
  seen.push({ url: String(url), redirect: opts.redirect });
  if (url.pathname === "/start.json") return new Response(null, { status: 302, headers: { location: "/finish.json" } });
  if (url.pathname === "/private.json") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secrets" } });
  if (url.pathname === "/lan.json") return new Response(null, { status: 302, headers: { location: "http://router.lan/config" } });
  if (url.pathname === "/self.json") return new Response(null, { status: 302, headers: { location: "https://owner.example.com/api/x" } });
  return new Response("public data");
};
assert.match(await fetchPage(env, "https://public.example/start.json", { fetchImpl }), /public data/);
assert.deepEqual(seen.map((x) => x.url), ["https://public.example/start.json", "https://public.example/finish.json"]);
assert.ok(seen.every((x) => x.redirect === "manual"));
seen.length = 0;
assert.match(await fetchPage(env, "https://public.example/private.json", { fetchImpl }), /redirect target is not a public URL/);
assert.equal(seen.length, 1, "the private redirect target was not fetched");
seen.length = 0;
assert.match(await fetchPage(env, "https://public.example/lan.json", { fetchImpl }), /redirect target is not a public URL/);
assert.equal(seen.length, 1, "the local-network redirect target was not fetched");
seen.length = 0;
assert.match(await fetchPage(env, "https://public.example/self.json", { fetchImpl }), /redirect target is not a public URL/);
assert.equal(seen.length, 1, "the app's own host was not fetched");
seen.length = 0;
assert.match(await fetchPage(env, "http://127.0.0.1/x", { fetchImpl }), /only public http\(s\) URLs/);
assert.equal(seen.length, 0, "an invalid initial URL was not fetched");

let cancelled = false;
const oversizedFetch = async () => new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(600_000).fill(65)); },
  cancel() { cancelled = true; },
}), { headers: { "content-length": "1" } });
const oversizedPage = await fetchPage(env, "https://public.example/large.txt", { fetchImpl: oversizedFetch, limit: 32 });
assert.match(oversizedPage, /^HTTP 200 \(1000000 chars, truncated\)\nA{32}$/);
assert.equal(cancelled, true, "the remote response stops after the byte budget despite a forged short content length");

let browserCalls = 0;
const browserEnv = { ...env, BROWSER: { quickAction: async (action, args) => {
  browserCalls++;
  assert.equal(action, "markdown");
  assert.deepEqual(args.rejectRequestPattern, browserRejectRequestPatterns(env));
  return { success: true, result: "private text ".repeat(30), meta: { status: 200, finalUrl: "http://127.0.0.1/secrets" } };
} } };
assert.match(await fetchPage(browserEnv, "https://public.example/page", { fetchImpl }), /page redirected to a non-public URL/);
assert.equal(browserCalls, 1); assert.equal(seen.length, 0, "private browser result was not returned or retried via fetch");

let browserCancelled = 0;
const largeBrowserResult = () => new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(800_000).fill(65)); },
  cancel() { browserCancelled++; },
}), { headers: { "content-type": "application/json", "content-length": "1" } });
const largeBrowserEnv = { ...env, WEB_SEARCH_FALLBACK: "off", BROWSER: { quickAction: async () => largeBrowserResult() } };
assert.match(await fetchPage(largeBrowserEnv, "https://public.example/page", { fetchImpl }), /public data/);
assert.equal(browserCancelled, 1, "oversized Browser Run markdown was cancelled before a plain fetch fallback");
const search = await webSearch(largeBrowserEnv, { query: "population" }, { sleep: async () => {}, log: () => {} });
assert.equal(search.out, BUSY);
assert.equal(browserCancelled, 3, "both oversized Browser Run search attempts were cancelled");
console.log("ok - public page reads reject private URLs and guard Browser Run requests");
