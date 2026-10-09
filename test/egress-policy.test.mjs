// node --import ./test/stubs/register.mjs test/egress-policy.test.mjs
// Sentinel ON by default: the automatic rules (egress-policy.js), the real Sentinel.fetch end to end (stand-in swap only
// for the key's own hosts; a key never rides an automatic rule; the person's decision; plain block texts), the real
// Resident.egressDecision with a covered site (no second card after Link / a saved login / their details), the label the helper sees,
// and both wrangler configs.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { egressRule, egressVia, lfsOperation, blockedText } from "../src/egress-policy.js";
import { Sentinel, sealSecret, newStandin } from "../src/sentinel.js";
import { Resident, egressLabel } from "../src/resident.js";

const env0 = { GATEWAY_HOST: "owner.example.com", APP_HOST: "owner.example.com", R2_ENDPOINT: "https://acct123.r2.cloudflarestorage.com" };
const H = (o = {}) => new Headers(o);
const CHROME_XHR = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin", "content-type": "application/json" };
const CHROME_BEACON = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty", "sec-fetch-site": "cross-site", "content-type": "text/plain;charset=UTF-8" };
const CHROME_FORM = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "same-origin", "sec-fetch-user": "?1", "content-type": "application/x-www-form-urlencoded" };
const rule = (o) => egressRule({ env: env0, headers: H(), ...o });

// ---- 1. the policy table ----
const cases = [
  // [what, input, verdict, rule-or-why]
  ["GET anywhere", { host: "httpbin.org", method: "GET", path: "/get" }, "allow", "read"],
  ["HEAD", { host: "pypi.org", method: "HEAD" }, "allow", "read"],
  ["OPTIONS preflight", { host: "api.x.com", method: "OPTIONS" }, "allow", "read"],
  ["GET with a saved key", { host: "api.openweathermap.org", method: "GET", keys: ["OWM"] }, "ask", null],
  ["GET to 1Helm itself", { host: "owner.example.com", method: "GET", path: "/api/res/main/approve" }, "deny", "self"],
  ["curl POST to a third party", { host: "httpbin.org", method: "POST", path: "/post", headers: H({ "content-type": "application/x-www-form-urlencoded" }) }, "ask", null],
  ["PUT / PATCH / DELETE", { host: "api.github.com", method: "DELETE", path: "/repos/a/b" }, "ask", null],
  ["git push (receive-pack)", { host: "github.com", method: "POST", path: "/a/b.git/git-receive-pack", headers: H({ "content-type": "application/x-git-receive-pack-request" }) }, "ask", null],
  ["git clone (upload-pack)", { host: "github.com", method: "POST", path: "/octocat/Hello-World/git-upload-pack", headers: H({ "content-type": "application/x-git-upload-pack-request" }) }, "allow", "git-read"],
  ["upload-pack path without git's content type", { host: "evil.example", method: "POST", path: "/x/git-upload-pack", headers: H({ "content-type": "application/json" }) }, "ask", null],
  ["LFS download batch", { host: "huggingface.co", method: "POST", path: "/m/x.git/info/lfs/objects/batch", lfsOp: "download" }, "allow", "git-read"],
  ["LFS upload batch", { host: "github.com", method: "POST", path: "/a/b.git/info/lfs/objects/batch", lfsOp: "upload" }, "ask", null],
  ["npm audit", { host: "registry.npmjs.org", method: "POST", path: "/-/npm/v1/security/advisories/bulk" }, "allow", "npm-audit"],
  ["npm publish", { host: "registry.npmjs.org", method: "PUT", path: "/my-pkg" }, "ask", null],
  ["npm audit path on another host", { host: "npm.evil.example", method: "POST", path: "/-/npm/v1/security/advisories/bulk" }, "ask", null],
  ["1Helm storage (presigned PUT)", { host: "acct123.r2.cloudflarestorage.com", method: "PUT", path: "/bucket/t/x" }, "allow", "own-storage"],
  ["someone else's R2", { host: "other.r2.cloudflarestorage.com", method: "PUT", path: "/b/x" }, "ask", null],
  ["1Helm itself", { host: "owner.example.com", method: "POST", path: "/w/x/api/res/main/approve" }, "deny", "self"],
  ["1Helm itself, case", { host: "OWNER.EXAMPLE.COM", method: "POST", path: "/" }, "deny", "self"],
  ["Next.js telemetry", { host: "telemetry.nextjs.org", method: "POST", path: "/api/v1/record" }, "deny", "telemetry"],
  ["Next.js telemetry GET", { host: "telemetry.nextjs.org", method: "GET", path: "/api/v1/record?data=x" }, "deny", "telemetry"],
  ["Chrome's own GCM registration (no page)", { host: "android.clients.google.com", method: "POST", path: "/c2dm/register3" }, "deny", "chrome-service"],
  ["Chrome service HEAD", { host: "update.googleapis.com", method: "HEAD", path: "/service/update2/json" }, "deny", "chrome-service"],
  ["Chrome's update check, even with fetch metadata (as seen on dev)", { host: "update.googleapis.com", method: "POST", path: "/service/update2/json", headers: H(CHROME_BEACON) }, "deny", "chrome-service"],
  ["GCM with fetch metadata", { host: "android.clients.google.com", method: "POST", path: "/c2dm/register3", headers: H(CHROME_XHR) }, "deny", "chrome-service"],
  // The browser's own reports (seen on dev: POST w3-reporting-nel.reddit.com/reports while kayak.com loaded → a card)
  ["NEL report (Reporting API), no fetch metadata", { host: "w3-reporting-nel.reddit.com", method: "POST", path: "/reports", headers: H({ "content-type": "application/reports+json" }) }, "deny", "browser-report"],
  ["Reporting API to any host, by content type", { host: "collector.example.org", method: "POST", path: "/r", headers: H({ "content-type": "application/reports+json; charset=utf-8" }) }, "deny", "browser-report"],
  ["CSP violation report", { host: "csp.example.net", method: "POST", path: "/csp", headers: H({ "content-type": "application/csp-report" }) }, "deny", "browser-report"],
  ["Expect-CT report", { host: "ct.example.net", method: "POST", path: "/", headers: H({ "content-type": "application/expect-ct-report+json" }) }, "deny", "browser-report"],
  ["Cloudflare NEL collector without content type", { host: "a.nel.cloudflare.com", method: "POST", path: "/report/v4" }, "deny", "browser-report"],
  ["reddit reporting host without content type", { host: "w3-reporting.reddit.com", method: "POST", path: "/reports" }, "deny", "browser-report"],
  ["Google CSP collector", { host: "csp.withgoogle.com", method: "POST", path: "/csp/x" }, "deny", "browser-report"],
  ["report-uri.com", { host: "acme.report-uri.com", method: "POST", path: "/r/d/csp/enforce" }, "deny", "browser-report"],
  ["a report content type carrying a saved key still asks", { host: "w3-reporting-nel.reddit.com", method: "POST", path: "/reports", keys: ["K"], headers: H({ "content-type": "application/reports+json" }) }, "ask", null],
  ["a clicked form is never a 'report'", { host: "w3-reporting.reddit.com", method: "POST", path: "/x", headers: H(CHROME_FORM) }, "ask", null],
  ["look-alikes are not report hosts", { host: "channel.example.com", method: "POST", path: "/" }, "ask", null],
  ["…nor is a site merely containing 'nel'", { host: "panel.example.com", method: "POST", path: "/" }, "ask", null],
  ["…nor a lookalike of report-uri.com", { host: "notreport-uri.com", method: "POST", path: "/" }, "ask", null],
  ["a page's XHR to a third party is still the page's", { host: "api.example.com", method: "POST", path: "/x", headers: H(CHROME_XHR) }, "allow", "browser-page"],
  ["browser XHR POST (site search)", { host: "www.kayak.com", method: "POST", path: "/i/api/search", headers: H(CHROME_XHR) }, "allow", "browser-page"],
  ["browser beacon (analytics)", { host: "bat.bing.com", method: "POST", path: "/actionp/0", headers: H(CHROME_BEACON) }, "allow", "browser-page"],
  ["browser form submit (click)", { host: "httpbin.org", method: "POST", path: "/post", headers: H(CHROME_FORM) }, "ask", null],
  ["browser auto-submitted redirect form (no click)", { host: "login.example.com", method: "POST", path: "/saml/acs", headers: H({ ...CHROME_FORM, "sec-fetch-user": "" }) }, "allow", "browser-redirect"],
  // A key never rides an automatic rule, whatever the request looks like.
  ["key + forged browser headers", { host: "api.openai.com", method: "POST", path: "/v1/x", keys: ["OPENAI_KEY"], headers: H(CHROME_XHR) }, "ask", null],
  ["key + git upload-pack", { host: "github.com", method: "POST", path: "/a/b/git-upload-pack", keys: ["GH_TOKEN"], headers: H({ "content-type": "application/x-git-upload-pack-request" }) }, "ask", null],
  ["key + npm audit", { host: "registry.npmjs.org", method: "POST", path: "/-/npm/v1/security/audits/quick", keys: ["NPM_TOKEN"] }, "ask", null],
  ["key + own storage", { host: "acct123.r2.cloudflarestorage.com", method: "PUT", path: "/b", keys: ["K"] }, "ask", null],
];
for (const [what, input, verdict, r] of cases) {
  const d = rule(input);
  assert.equal(d.verdict, verdict, `${what}: ${JSON.stringify(d)}`);
  if (verdict !== "ask") assert.equal(d.rule, r, what);
}
assert.equal(rule({ host: "telemetry.nextjs.org", method: "POST" }).quiet, true);
assert.equal(egressVia(H()), "command"); assert.equal(egressVia(H(CHROME_FORM)), "form"); assert.equal(egressVia(H(CHROME_BEACON)), "page");
assert.equal(rule({ host: "httpbin.org", method: "POST", headers: H(CHROME_FORM) }).via, "form");
assert.equal(rule({ host: "httpbin.org", method: "POST" }).via, "command");
// no env (unit default): nothing about 1Helm's own hosts is assumed
assert.equal(egressRule({ host: "acct123.r2.cloudflarestorage.com", method: "PUT", headers: H() }).verdict, "ask");
assert.equal(lfsOperation('{"operation":"download","objects":[]}'), "download"); assert.equal(lfsOperation("nope"), null);
assert.match(blockedText({ method: "POST", host: "httpbin.org", path: "/post", why: "the person denied it", verdict: "deny" }), /the person said no.*Nothing was sent/);
assert.match(blockedText({ method: "POST", host: "httpbin.org", path: "/post", why: "nobody is watching this run; request #3 is waiting in the app", verdict: "deny" }), /held POST httpbin\.org\/post.*needs the person's OK/);

// ---- 2. the real Sentinel.fetch: stand-ins, automatic rules, the person's decision ----
const VK = Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 3)).toString("base64");
const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE vault (tenant_id TEXT, name TEXT, standin TEXT, hosts TEXT, sealed TEXT, created_at INTEGER, PRIMARY KEY (tenant_id, name))");
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => (st.run(...a), {}) }; return o; } };
const SIN = newStandin(), SIN2 = newStandin(), SIN3 = newStandin(), REAL = "sk-real-weather-123", REAL2 = "ghp_real_token_456", REAL3 = "key/with+reserved?chars";
const envS = { ...env0, VAULT_KEY: VK, DB };
d1.prepare("INSERT INTO vault VALUES ('t1','WEATHER_KEY',?,?,?,1)").run(SIN, JSON.stringify(["api.weather.example"]), await sealSecret(envS, REAL));
d1.prepare("INSERT INTO vault VALUES ('t1','GH_TOKEN',?,?,?,1)").run(SIN2, JSON.stringify(["*.github.com", "github.com"]), await sealSecret(envS, REAL2));
d1.prepare("INSERT INTO vault VALUES ('t1','COMPLEX_KEY',?,?,?,1)").run(SIN3, JSON.stringify(["api.weather.example"]), await sealSecret(envS, REAL3));
const notes = [], asks = []; let answer = { verdict: "allow", why: "approved by the person (once)" };
envS.CHANNEL_COMPUTER = { idFromString: (s) => s, get: () => ({ who: async () => ({ tenant: "t1", channel: "main" }), noteEgress: async (e) => { notes.push(e); return { ok: true }; } }) };
envS.RESIDENT = { idFromName: (n) => { assert.equal(n, "res:t1:main"); return n; }, get: () => ({ egressDecision: async (x) => { asks.push(x); return answer; } }) };
// node's Request needs duplex: "half" for a streamed body (workerd doesn't); add it the way workerd behaves.
{ const R0 = globalThis.Request; globalThis.Request = class extends R0 { constructor(u, i) { super(u, i && i.body != null ? { duplex: "half", ...i } : i); } }; }
const upstream = [];
globalThis.fetch = async (r) => { const b = r.body ? await new Response(r.body).text() : ""; upstream.push({ url: r.url, method: r.method, headers: Object.fromEntries(r.headers), body: b }); return new Response("ok", { status: 200 }); };
const S = new Sentinel({ props: { id: "cc1", tenant: "t1", channel: "main" } }, envS);
const go = (url, init = {}) => S.fetch(new Request(url, init));
const reset = () => { notes.length = 0; asks.length = 0; upstream.length = 0; };

// stand-in in a header, to its own host (GET): the real key goes out only after approval
reset(); assert.equal((await go("https://api.weather.example/v1?q=x", { headers: { authorization: `Bearer ${SIN}` } })).status, 200);
assert.equal(upstream[0].headers.authorization, `Bearer ${REAL}`); assert.deepEqual(notes[0].keys, ["WEATHER_KEY"]); assert.equal(asks.length, 1);
// The same GET is held if the person denies it; the real key never reaches the upstream.
reset(); answer = { verdict: "deny", why: "the person denied it" };
let res = await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${SIN}` } });
assert.equal(res.status, 403); assert.equal(upstream.length, 0); assert.equal(asks.length, 1);
answer = { verdict: "allow", why: "approved by the person (once)" };
// the same stand-in to another host: it stays a stand-in, the key is listed as refused
reset(); await go("https://postman-echo.com/headers", { headers: { "x-k": SIN } });
assert.equal(upstream[0].headers["x-k"], SIN); assert.ok(!JSON.stringify(upstream).includes(REAL)); assert.deepEqual(notes[0].refused, ["WEATHER_KEY"]); assert.deepEqual(notes[0].keys, []);
// in the URL, to its host (wildcard binding): swapped, URL-encoded
reset(); await go(`https://api.github.com/user?access_token=${SIN2}`);
assert.ok(upstream[0].url.includes(`access_token=${REAL2}`));
// a POST carrying a key always asks, even dressed as browser background traffic, and is held until the person decides
reset(); answer = { verdict: "deny", why: "the person denied it" };
res = await go("https://api.weather.example/v1/alerts", { method: "POST", body: "a=1", headers: { authorization: `Bearer ${SIN}`, ...CHROME_XHR } });
assert.equal(res.status, 403); assert.equal(upstream.length, 0); assert.equal(asks.length, 1); assert.deepEqual(asks[0].keys, ["WEATHER_KEY"]);
assert.match(await res.text(), /the person said no to sending this\. Nothing was sent/); assert.equal(res.headers.get("x-1helm-sentinel"), "blocked");
assert.equal(notes[0].verdict, "deny");
// …and goes out with the real key once they allow it
reset(); answer = { verdict: "allow", why: "approved by the person (once)" };
res = await go("https://api.weather.example/v1/alerts", { method: "POST", body: "a=1", headers: { authorization: `Bearer ${SIN}` } });
assert.equal(res.status, 200); assert.equal(upstream[0].headers.authorization, `Bearer ${REAL}`); assert.equal(upstream[0].body, "a=1");
// An approved upstream may echo the real key. Sentinel must scrub response headers and a body
// whose echo crosses stream chunks, including the URL-encoded form used in redirects.
reset(); const fetchOkEcho = globalThis.fetch;
globalThis.fetch = async (r) => {
  upstream.push({ url: r.url, headers: Object.fromEntries(r.headers) });
  const raw = new TextEncoder().encode(`before ${REAL3} after ${encodeURIComponent(REAL3)}`);
  return new Response(new ReadableStream({ start(c) { c.enqueue(raw.slice(0, 13)); c.enqueue(raw.slice(13, 21)); c.enqueue(raw.slice(21)); c.close(); } }),
    { headers: { location: `https://api.weather.example/next?key=${encodeURIComponent(REAL3)}`, "x-echo": REAL3, "content-length": String(raw.length), "content-range": `bytes 0-${raw.length - 1}/${raw.length}`, "accept-ranges": "bytes", etag: '"old"' } });
};
res = await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${SIN3}` } });
globalThis.fetch = fetchOkEcho;
assert.equal(upstream[0].headers.authorization, `Bearer ${REAL3}`);
assert.equal(upstream[0].headers["accept-encoding"], "identity");
assert.equal(await res.text(), `before ${SIN3} after ${SIN3}`);
assert.equal(res.headers.get("x-echo"), SIN3);
assert.equal(res.headers.get("location"), `https://api.weather.example/next?key=${SIN3}`);
assert.equal(res.headers.get("content-length"), null);
assert.equal(res.headers.get("content-range"), null);
assert.equal(res.headers.get("accept-ranges"), null);
assert.equal(res.headers.get("etag"), null);
// A literal key can also be an HTTP header name or the reason phrase.
reset(); globalThis.fetch = async () => new Response(null, { status: 299, statusText: REAL, headers: { [`x-${REAL}`]: "seen" } });
res = await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${SIN}` } });
globalThis.fetch = fetchOkEcho;
assert.equal(res.statusText, SIN);
assert.equal(res.headers.get(`x-${SIN}`), "seen");
assert.equal(res.headers.get(`x-${REAL}`), null);
// If the upstream ignores identity encoding, return a generic failure instead of opaque bytes.
reset(); globalThis.fetch = async () => new Response("opaque", { headers: { "content-encoding": "gzip" } });
res = await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${SIN3}` } });
globalThis.fetch = fetchOkEcho;
assert.equal(res.status, 502); assert.equal(await res.text(), "upstream response encoding not supported for saved keys");
// a curl POST asks (via command); a browser form asks (via form); a page's XHR and git clone go out without asking
reset(); await go("https://httpbin.org/post", { method: "POST", body: "x" }); assert.equal(asks[0].via, "command"); assert.equal(asks[0].path, "/post");
reset(); await go("https://httpbin.org/post", { method: "POST", body: "x", headers: CHROME_FORM }); assert.equal(asks[0].via, "form");
reset(); res = await go("https://www.kayak.com/i/api/search", { method: "POST", body: "{}", headers: CHROME_XHR });
assert.equal(res.status, 200); assert.equal(asks.length, 0); assert.equal(notes[0].why, "web page background request");
reset(); await go("https://github.com/octocat/Hello-World/git-upload-pack", { method: "POST", body: "0032want", headers: { "content-type": "application/x-git-upload-pack-request" } });
assert.equal(asks.length, 0); assert.equal(upstream[0].body, "0032want");
// Git LFS: the batch body is read to tell a download from an upload, and still forwarded whole
reset(); const lfs = JSON.stringify({ operation: "download", objects: [{ oid: "a", size: 1 }] });
await go("https://huggingface.co/m/x.git/info/lfs/objects/batch", { method: "POST", body: lfs, headers: { "content-type": "application/vnd.git-lfs+json", "content-length": String(lfs.length) } });
assert.equal(asks.length, 0); assert.equal(upstream[0].body, lfs);
reset(); res = await go("https://huggingface.co/m/x.git/info/lfs/objects/batch", { method: "POST", body: "x".repeat(70000), headers: { "content-length": "1" } });
assert.equal(res.status, 413, "a forged small Content-Length cannot make Sentinel buffer a large LFS batch");
assert.equal(asks.length, 0); assert.equal(upstream.length, 0); assert.equal(notes[0].verdict, "deny");
reset(); const up = JSON.stringify({ operation: "upload", objects: [] });
await go("https://github.com/a/b.git/info/lfs/objects/batch", { method: "POST", body: up, headers: { "content-length": String(up.length) } });
assert.equal(asks.length, 1); assert.equal(upstream[0]?.body, up);   // allowed by the (stubbed) person: the body still goes out
// 1Helm itself: refused, never asked
reset(); res = await go("https://owner.example.com/w/x/api/res/main/approve", { method: "POST", body: "{}" });
assert.equal(res.status, 403); assert.equal(asks.length, 0); assert.equal(upstream.length, 0);
reset(); res = await go("https://owner.example.com/w/x/api/res/main/approve");
assert.equal(res.status, 403); assert.equal(asks.length, 0); assert.equal(upstream.length, 0);
// A network failure may include the real key in its exception text; neither the response nor traffic log may echo it.
reset(); const fetchOk = globalThis.fetch;
globalThis.fetch = async () => { throw new Error(`failed for ${REAL}`); };
res = await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${SIN}` } });
globalThis.fetch = fetchOk;
assert.equal(res.status, 502); assert.doesNotMatch(await res.text(), new RegExp(REAL)); assert.doesNotMatch(JSON.stringify(notes), new RegExp(REAL));
// telemetry: not sent, no card, a quiet note
reset(); res = await go("https://telemetry.nextjs.org/api/v1/record", { method: "POST", body: "{}" });
assert.equal(res.status, 403); assert.equal(res.headers.get("x-1helm-sentinel"), "skipped"); assert.equal(asks.length, 0);
reset(); res = await go("https://telemetry.nextjs.org/api/v1/record?data=x");
assert.equal(res.status, 403); assert.equal(res.headers.get("x-1helm-sentinel"), "skipped"); assert.equal(asks.length, 0); assert.equal(upstream.length, 0);
// the browser's NEL report (as seen on dev): not sent, no card, a quiet note
reset(); res = await go("https://w3-reporting-nel.reddit.com/reports", { method: "POST", body: "[]", headers: { "content-type": "application/reports+json" } });
assert.equal(res.status, 403); assert.equal(res.headers.get("x-1helm-sentinel"), "skipped"); assert.equal(asks.length, 0); assert.equal(upstream.length, 0);
// props without tenant (a computer started before this change): asks the computer who it is
{ const S2 = new Sentinel({ props: { id: "cc1" } }, envS); reset(); await S2.fetch(new Request(`https://api.weather.example/x`, { headers: { a: SIN } })); assert.equal(upstream[0].headers.a, REAL); }

// ---- 3. the real Resident: covered sites, the via on the card, the label ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const rsrc = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
dodb.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);" + rsrc.match(/CREATE TABLE IF NOT EXISTS approvals[\s\S]*?approval_id INTEGER\);/)[0]);
dodb.exec("ALTER TABLE approvals ADD COLUMN perm TEXT; ALTER TABLE approvals ADD COLUMN what TEXT");
const R = Object.create(Resident.prototype);
Object.assign(R, { sql, env: { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) }) } }, active: new Map(), ctx: {} });
R.put("tenant", "t1"); R.put("channel", "main");
const seen = [];
const turn = (session) => { const t = { finished: false, inTool: 1, subs: new Set([(e) => seen.push(e)]), session, turn: "turn-1", workflow_id: null }; t.emit = (e) => { for (const s of t.subs) s(e); }; return t; };
R.active = new Map([["k", turn("task-A")]]);
// Covered: they approved a Link purchase typed on shop.example → the checkout form on secure.shop.example goes through, this task only
assert.equal(R.coverSite("task-A", "www.shop.example", "your Link purchase"), true);
assert.equal(R.coverSite(null, "shop.example", "x"), false); assert.equal(R.coverSite("task-A", "not a site", "x"), false);
let v = await R.egressDecision({ host: "secure.shop.example", method: "POST", path: "/checkout", bytes: 10, keys: [], via: "form" });
assert.equal(v.verdict, "allow"); assert.match(v.why, /covered: your Link purchase/); assert.equal(seen.length, 0);
assert.equal((await R.egressDecision({ host: "shop.example", method: "POST", path: "/", bytes: 1, keys: [], via: "form" })).verdict, "allow");
// …only a browser form: a command's POST to the same site, or a form carrying a saved key, still asks
for (const x of [{ via: "command", keys: [] }, { via: "form", keys: ["K"] }]) {
  seen.length = 0; const pc = R.egressDecision({ host: "shop.example", method: "POST", path: "/api", bytes: 1, ...x });
  await new Promise((z) => setTimeout(z, 30)); assert.equal(seen[0]?.t, "approval", JSON.stringify(x)); await R.decideApproval(seen[0].approval.id, "deny"); assert.equal((await pc).verdict, "deny"); }
seen.length = 0;
// a look-alike host is not covered (shop.example.evil.com, evilshop.example): a card appears; the card carries via "form"
const pv = R.egressDecision({ host: "evilshop.example", method: "POST", path: "/x", bytes: 1, keys: [], via: "form" });
await new Promise((z) => setTimeout(z, 30)); assert.equal(seen[0]?.t, "approval"); assert.equal(seen[0].approval.via, "form"); assert.equal(seen[0].approval.host, "evilshop.example");
await R.decideApproval(seen[0].approval.id, "deny"); assert.equal((await pv).verdict, "deny");
assert.deepEqual((await R.approvalCardData(seen[0].approval.id)).approval.via, "form");
// another task in the same channel is not covered
seen.length = 0; R.active = new Map([["k", turn("task-B")]]);
const pb = R.egressDecision({ host: "secure.shop.example", method: "POST", path: "/checkout", bytes: 1, keys: [], via: "form" });
await new Promise((z) => setTimeout(z, 30)); assert.equal(seen[0]?.t, "approval"); await R.decideApproval(seen[0].approval.id, "deny"); await pb;
// covered grants never show as "Always allowed" sites, and expire after 15 minutes
assert.ok((await R.listGrants()).every((g) => !g.host.startsWith("*.")));
dodb.exec("UPDATE grants SET expires=1 WHERE host LIKE '*.%'"); seen.length = 0; R.active = new Map([["k", turn("task-A")]]);
const pe = R.egressDecision({ host: "shop.example", method: "POST", path: "/", bytes: 1, keys: [], via: "form" });
await new Promise((z) => setTimeout(z, 30)); assert.equal(seen[0]?.t, "approval"); await R.decideApproval(seen[0].approval.id, "once"); assert.equal((await pe).verdict, "allow");

// ---- 4. what the helper reads after a command ----
assert.match(egressLabel({ egress: [{ host: "httpbin.org", method: "POST", verdict: "deny", why: "the person denied it" }] }), /The person said no to sending POST httpbin\.org.*Don't retry it or send it another way/);
assert.match(egressLabel({ egress: [{ host: "httpbin.org", method: "POST", verdict: "deny", why: "nobody is watching this run; request #2 is waiting in the app" }] }), /held 1 outgoing request.*POST httpbin\.org/);
assert.doesNotMatch(egressLabel({ egress: [{ host: "telemetry.nextjs.org", method: "POST", verdict: "deny", why: "dev-tool telemetry (not sent)" }] }), /held|said no/);
assert.doesNotMatch(egressLabel({ egress: [{ host: "android.clients.google.com", method: "POST", verdict: "deny", why: "the browser's own background service (not sent)" }] }), /held|said no/);
assert.doesNotMatch(egressLabel({ egress: [{ host: "w3-reporting-nel.reddit.com", method: "POST", verdict: "deny", why: "the browser's own error/security report (not sent)" }] }), /held|said no/);
assert.match(egressLabel({ egress: [{ host: "pypi.org", method: "GET", verdict: "allow" }] }), /UNTRUSTED/);

// ---- 5. on by default ----
assert.match(readFileSync(new URL("../wrangler.example.jsonc", import.meta.url), "utf8"), /"SENTINEL_DEFAULT": "on"/);
console.log("egress-policy ok");
process.exit(0);
