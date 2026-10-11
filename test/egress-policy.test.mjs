// node --import ./test/stubs/register.mjs test/egress-policy.test.mjs
// Sentinel ON by default (Captain 10-09): the automatic rules (egress-policy.js), the real Sentinel.fetch end to end (stand-in swap only
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
  ["payment POST", { host: "api.stripe.com", method: "POST", path: "/v1/payment_intents" }, "ask", null],
  ["payment background XHR still protected", { host: "shop.example", method: "POST", path: "/checkout", headers: H(CHROME_XHR) }, "ask", null],
  ["API key GET", { host: "api.example", method: "GET", path: "/v1/api_keys" }, "ask", null],
  ["saved-key GET", { host: "api.example", method: "GET", path: "/v1/items", keys: ["K"] }, "ask", null],
  // [what, input, verdict, rule-or-why]
  ["GET anywhere", { host: "httpbin.org", method: "GET", path: "/get" }, "allow", "read"],
  ["HEAD", { host: "pypi.org", method: "HEAD" }, "allow", "read"],
  ["OPTIONS preflight", { host: "api.x.com", method: "OPTIONS" }, "allow", "read"],
  ["GET with a saved key retains scoped approval", { host: "api.openweathermap.org", method: "GET", keys: ["OWM"] }, "ask", null],
  ["curl POST to a third party", { host: "httpbin.org", method: "POST", path: "/post", headers: H({ "content-type": "application/x-www-form-urlencoded" }) }, "allow", "task-action"],
  ["PUT / PATCH / DELETE", { host: "api.github.com", method: "DELETE", path: "/repos/a/b" }, "allow", "task-action"],
  ["git push (receive-pack)", { host: "github.com", method: "POST", path: "/a/b.git/git-receive-pack", headers: H({ "content-type": "application/x-git-receive-pack-request" }) }, "allow", "task-action"],
  ["git clone (upload-pack)", { host: "github.com", method: "POST", path: "/octocat/Hello-World/git-upload-pack", headers: H({ "content-type": "application/x-git-upload-pack-request" }) }, "allow", "git-read"],
  ["upload-pack path without git's content type", { host: "evil.example", method: "POST", path: "/x/git-upload-pack", headers: H({ "content-type": "application/json" }) }, "allow", "task-action"],
  ["LFS download batch", { host: "huggingface.co", method: "POST", path: "/m/x.git/info/lfs/objects/batch", lfsOp: "download" }, "allow", "git-read"],
  ["LFS upload batch", { host: "github.com", method: "POST", path: "/a/b.git/info/lfs/objects/batch", lfsOp: "upload" }, "allow", "task-action"],
  ["npm audit", { host: "registry.npmjs.org", method: "POST", path: "/-/npm/v1/security/advisories/bulk" }, "allow", "npm-audit"],
  ["npm publish", { host: "registry.npmjs.org", method: "PUT", path: "/my-pkg" }, "allow", "task-action"],
  ["npm audit path on another host", { host: "npm.evil.example", method: "POST", path: "/-/npm/v1/security/advisories/bulk" }, "allow", "task-action"],
  ["1Helm storage (presigned PUT)", { host: "acct123.r2.cloudflarestorage.com", method: "PUT", path: "/bucket/t/x" }, "allow", "own-storage"],
  ["someone else's R2", { host: "other.r2.cloudflarestorage.com", method: "PUT", path: "/b/x" }, "allow", "task-action"],
  ["1Helm itself", { host: "owner.example.com", method: "POST", path: "/w/x/api/res/main/approve" }, "deny", "self"],
  ["1Helm itself, case", { host: "OWNER.example.COM", method: "POST", path: "/" }, "deny", "self"],
  ["Next.js telemetry", { host: "telemetry.nextjs.org", method: "POST", path: "/api/v1/record" }, "deny", "telemetry"],
  ["Chrome's own GCM registration (no page)", { host: "android.clients.google.com", method: "POST", path: "/c2dm/register3" }, "deny", "chrome-service"],
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
  ["a clicked form is never a 'report'", { host: "w3-reporting.reddit.com", method: "POST", path: "/x", headers: H(CHROME_FORM) }, "allow", "task-action"],
  ["look-alikes are not report hosts", { host: "channel.example.com", method: "POST", path: "/" }, "allow", "task-action"],
  ["…nor is a site merely containing 'nel'", { host: "panel.example.com", method: "POST", path: "/" }, "allow", "task-action"],
  ["…nor a lookalike of report-uri.com", { host: "notreport-uri.com", method: "POST", path: "/" }, "allow", "task-action"],
  ["a page's XHR to a third party is still the page's", { host: "api.example.com", method: "POST", path: "/x", headers: H(CHROME_XHR) }, "allow", "browser-page"],
  ["browser XHR POST (site search)", { host: "www.kayak.com", method: "POST", path: "/i/api/search", headers: H(CHROME_XHR) }, "allow", "browser-page"],
  ["browser beacon (analytics)", { host: "bat.bing.com", method: "POST", path: "/actionp/0", headers: H(CHROME_BEACON) }, "allow", "browser-page"],
  ["browser form submit (click)", { host: "httpbin.org", method: "POST", path: "/post", headers: H(CHROME_FORM) }, "allow", "task-action"],
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
assert.equal(egressRule({ host: "acct123.r2.cloudflarestorage.com", method: "PUT", headers: H() }).verdict, "allow");
assert.equal(lfsOperation('{"operation":"download","objects":[]}'), "download"); assert.equal(lfsOperation("nope"), null);
assert.match(blockedText({ method: "POST", host: "httpbin.org", path: "/post", why: "the person denied it", verdict: "deny" }), /the person said no.*Nothing was sent/);
assert.match(blockedText({ method: "POST", host: "httpbin.org", path: "/post", why: "nobody is watching this run; request #3 is waiting in the app", verdict: "deny" }), /held POST httpbin\.org\/post.*needs the person's OK/);

// ---- 2. the real Sentinel.fetch: stand-ins, automatic rules, the person's decision ----
const VK = Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 3)).toString("base64");
const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE vault (tenant_id TEXT, name TEXT, standin TEXT, hosts TEXT, sealed TEXT, created_at INTEGER, PRIMARY KEY (tenant_id, name))");
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => (st.run(...a), {}) }; return o; } };
const SIN = newStandin(), SIN2 = newStandin(), REAL = "sk-real-weather-123", REAL2 = "ghp_real_token_456";
const envS = { ...env0, VAULT_KEY: VK, DB };
d1.prepare("INSERT INTO vault VALUES ('t1','WEATHER_KEY',?,?,?,1)").run(SIN, JSON.stringify(["api.weather.example"]), await sealSecret(envS, REAL));
d1.prepare("INSERT INTO vault VALUES ('t1','GH_TOKEN',?,?,?,1)").run(SIN2, JSON.stringify(["*.github.com", "github.com"]), await sealSecret(envS, REAL2));
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

// stand-in in a header, to its own host (GET): first use retains the key approval gate
reset(); assert.equal((await go("https://api.weather.example/v1?q=x", { headers: { authorization: `Bearer ${SIN}` } })).status, 200);
assert.equal(upstream[0].headers.authorization, `Bearer ${REAL}`); assert.deepEqual(notes[0].keys, ["WEATHER_KEY"]); assert.equal(asks.length, 1);
// the same stand-in to another host: it stays a stand-in, the key is listed as refused
reset(); await go("https://postman-echo.com/headers", { headers: { "x-k": SIN } });
assert.equal(upstream[0].headers["x-k"], SIN); assert.ok(!JSON.stringify(upstream).includes(REAL)); assert.deepEqual(notes[0].refused, ["WEATHER_KEY"]); assert.deepEqual(notes[0].keys, []);
// in the URL, to its host (wildcard binding): swapped, URL-encoded
reset(); await go(`https://api.github.com/user?access_token=${SIN2}`);
assert.ok(upstream[0].url.includes(`access_token=${REAL2}`));
// a POST carrying a key always asks, even dressed as browser background traffic, and is held until the person decides
reset(); answer = { verdict: "deny", why: "the person denied it" };
let res = await go("https://api.weather.example/v1/alerts", { method: "POST", body: "a=1", headers: { authorization: `Bearer ${SIN}`, ...CHROME_XHR } });
assert.equal(res.status, 403); assert.equal(upstream.length, 0); assert.equal(asks.length, 1); assert.deepEqual(asks[0].keys, ["WEATHER_KEY"]);
assert.match(await res.text(), /the person said no to sending this\. Nothing was sent/); assert.equal(res.headers.get("x-1helm-sentinel"), "blocked");
assert.equal(notes[0].verdict, "deny");
// …and goes out with the real key once they allow it
reset(); answer = { verdict: "allow", why: "approved by the person (once)" };
res = await go("https://api.weather.example/v1/alerts", { method: "POST", body: "a=1", headers: { authorization: `Bearer ${SIN}` } });
assert.equal(res.status, 200); assert.equal(upstream[0].headers.authorization, `Bearer ${REAL}`); assert.equal(upstream[0].body, "a=1");
// a curl POST asks (via command); a browser form asks (via form); a page's XHR and git clone go out without asking
reset(); await go("https://httpbin.org/post", { method: "POST", body: "x" }); assert.equal(asks.length, 0); assert.equal(upstream[0].body, "x");
reset(); await go("https://httpbin.org/post", { method: "POST", body: "x", headers: CHROME_FORM }); assert.equal(asks.length, 0); assert.equal(upstream[0].body, "x");
reset(); res = await go("https://www.kayak.com/i/api/search", { method: "POST", body: "{}", headers: CHROME_XHR });
assert.equal(res.status, 200); assert.equal(asks.length, 0); assert.equal(notes[0].why, "web page background request");
reset(); await go("https://github.com/octocat/Hello-World/git-upload-pack", { method: "POST", body: "0032want", headers: { "content-type": "application/x-git-upload-pack-request" } });
assert.equal(asks.length, 0); assert.equal(upstream[0].body, "0032want");
// Git LFS: the batch body is read to tell a download from an upload, and still forwarded whole
reset(); const lfs = JSON.stringify({ operation: "download", objects: [{ oid: "a", size: 1 }] });
await go("https://huggingface.co/m/x.git/info/lfs/objects/batch", { method: "POST", body: lfs, headers: { "content-type": "application/vnd.git-lfs+json", "content-length": String(lfs.length) } });
assert.equal(asks.length, 0); assert.equal(upstream[0].body, lfs);
reset(); const up = JSON.stringify({ operation: "upload", objects: [] });
await go("https://github.com/a/b.git/info/lfs/objects/batch", { method: "POST", body: up, headers: { "content-length": String(up.length) } });
assert.equal(asks.length, 0); assert.equal(upstream[0]?.body, up);   // allowed by the (stubbed) person: the body still goes out
// 1Helm itself: refused, never asked
reset(); res = await go("https://owner.example.com/w/x/api/res/main/approve", { method: "POST", body: "{}" });
assert.equal(res.status, 403); assert.equal(asks.length, 0); assert.equal(upstream.length, 0);
// telemetry: not sent, no card, a quiet note
reset(); res = await go("https://telemetry.nextjs.org/api/v1/record", { method: "POST", body: "{}" });
assert.equal(res.status, 403); assert.equal(res.headers.get("x-1helm-sentinel"), "skipped"); assert.equal(asks.length, 0);
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
// Login/personal-form coverage is never payment consent. Even Link coverage cannot release API keys.
for (const [reason, path] of [["your saved login", "/payments"], ["your OK to fill in your details", "/checkout"], ["your Link purchase", "/api_keys"]]) {
  seen.length = 0; R.coverSite("task-A", "separate.example", reason);
  const p = R.egressDecision({ host: "separate.example", method: "POST", path, bytes: 1, keys: [], via: "form" });
  await new Promise(r=>setTimeout(r,30)); assert.equal(seen[0]?.t,"approval", `${reason} must not cover ${path}`);
  await R.decideApproval(seen[0].approval.id,"deny"); assert.equal((await p).verdict,"deny");
}
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
for (const f of ["wrangler.example.jsonc"]) assert.match(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /"SENTINEL_DEFAULT": "on"/, f);
console.log("egress-policy ok");
process.exit(0);
