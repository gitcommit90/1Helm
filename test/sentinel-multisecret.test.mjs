// Sentinel request rewriting (src/sentinel-swap.js): Basic auth, request bodies (form, JSON, multipart, text), OAuth 1.0a and AWS SigV4 re-signing,
// each with a wrong-host case. The OAuth value is Twitter's documented "Creating a signature" example and the SigV4 values are from AWS's
// published SigV4 test suite (get-vanilla, post-x-www-form-urlencoded).
// Run: bash scripts/test.sh test/sentinel-multisecret.test.mjs
import assert from "node:assert/strict"; import test from "node:test";
import { createHmac, createHash } from "node:crypto";
import { sigv4Signature, rewriteRequest, readCapped, BODY_SCAN_MAX, SECRET_CANDIDATES_MAX, findStandins } from "../src/sentinel-swap.js";

const sid = (c) => "1hs_" + c.repeat(32);
const KEYS = [];
const key = (name, real, hosts) => {
  const standin = "1hs_" + (name.replace(/[^A-Za-z0-9]/g, "") + "0".repeat(32)).slice(0, 32);
  const r = { name, standin, hosts: JSON.stringify(hosts), sealed: real }; KEYS.push(r); return r;
};
const run = (o) => rewriteRequest({ method: "GET", headers: new Headers(), bodyBytes: null, ...o,
  lookup: async (ids) => KEYS.filter((k) => ids.includes(k.standin)),
  lookupHostKeys: async () => KEYS,
  open: (r) => r.sealed });
const bytes = (s) => new TextEncoder().encode(s), text = (b) => new TextDecoder().decode(b);

test("Basic auth: stand-ins inside the credentials are swapped and encoded again, on the key's host only", async () => {
  const id = key("APP_ID", "real-id", ["api.example.com"]), sec = key("APP_SECRET", "p@ss:wörd", ["api.example.com"]);
  const auth = "Basic " + Buffer.from(`${id.standin}:${sec.standin}`).toString("base64");
  const r = await run({ host: "api.example.com", url: "https://api.example.com/token", headers: new Headers({ authorization: auth }) });
  assert.equal(Buffer.from(r.headers.get("authorization").split(" ")[1], "base64").toString("utf8"), "real-id:p@ss:wörd");
  assert.deepEqual(r.swapped.sort(), ["APP_ID", "APP_SECRET"]);
  const w = await run({ host: "evil.example.net", url: "https://evil.example.net/token", headers: new Headers({ authorization: auth }) });
  assert.equal(w.headers.get("authorization"), auth); assert.deepEqual(w.swapped, []); assert.deepEqual(w.refused.sort(), ["APP_ID", "APP_SECRET"]);
  // one key on the host and one not: only the right one is swapped
  const mix = key("OTHER_SECRET", "other-real", ["other.example.com"]);
  const m = await run({ host: "api.example.com", url: "https://api.example.com/t", headers: new Headers({ authorization: "Basic " + Buffer.from(`${id.standin}:${mix.standin}`).toString("base64") }) });
  assert.equal(Buffer.from(m.headers.get("authorization").split(" ")[1], "base64").toString(), `real-id:${mix.standin}`);
});

test("form body: value is URL-encoded, Content-Length is dropped so it is recomputed, wrong host is untouched", async () => {
  const cs = key("CLIENT_SECRET", "a b&c=d/é", ["oauth.example.com"]);
  const body = bytes(`grant_type=refresh_token&client_secret=${cs.standin}&x=1`);
  const headers = () => new Headers({ "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) });
  const r = await run({ host: "oauth.example.com", method: "POST", url: "https://oauth.example.com/token", headers: headers(), bodyBytes: body });
  assert.equal(text(r.bodyBytes), `grant_type=refresh_token&client_secret=${encodeURIComponent("a b&c=d/é")}&x=1`);
  assert.equal(r.headers.get("content-length"), null);
  const w = await run({ host: "evil.example.net", method: "POST", url: "https://evil.example.net/token", headers: headers(), bodyBytes: body });
  assert.equal(text(w.bodyBytes), text(body)); assert.equal(w.headers.get("content-length"), String(body.length)); assert.deepEqual(w.refused, ["CLIENT_SECRET"]);
});

test("JSON body: value is JSON-string escaped and the result still parses", async () => {
  const k = key("JSON_KEY", 'q"uo\\te\nline', ["api.example.com"]);
  const body = bytes(JSON.stringify({ key: k.standin, n: 1 }));
  const r = await run({ host: "api.example.com", method: "POST", url: "https://api.example.com/x", headers: new Headers({ "content-type": "application/json; charset=utf-8" }), bodyBytes: body });
  assert.deepEqual(JSON.parse(text(r.bodyBytes)), { key: 'q"uo\\te\nline', n: 1 });
  const w = await run({ host: "evil.example.net", method: "POST", url: "https://evil.example.net/x", headers: new Headers({ "content-type": "application/json" }), bodyBytes: body });
  assert.equal(text(w.bodyBytes), text(body));
});

test("multipart: text parts are swapped, file parts and other content types are not, and a gzip body is not scanned", async () => {
  const k = key("MP_KEY", "real-mp", ["api.example.com"]);
  const b = "XBOUNDX", part = (head, val) => `--${b}\r\n${head}\r\n\r\n${val}\r\n`;
  const body = bytes(part('Content-Disposition: form-data; name="k"', k.standin) + part('Content-Disposition: form-data; name="f"; filename="a.txt"\r\nContent-Type: text/plain', `file ${k.standin}`) + `--${b}--\r\n`);
  const h = () => new Headers({ "content-type": `multipart/form-data; boundary=${b}` });
  const r = await run({ host: "api.example.com", method: "POST", url: "https://api.example.com/up", headers: h(), bodyBytes: body });
  assert.match(text(r.bodyBytes), /name="k"\r\n\r\nreal-mp\r\n/); assert.match(text(r.bodyBytes), new RegExp(`file ${k.standin}`));
  const g = h(); g.set("content-encoding", "gzip");
  const z = await run({ host: "api.example.com", method: "POST", url: "https://api.example.com/up", headers: g, bodyBytes: body });
  assert.equal(text(z.bodyBytes), text(body));
  // plain text and a body with no stand-in come back unchanged
  const t = await run({ host: "api.example.com", method: "POST", url: "https://api.example.com/t", headers: new Headers({ "content-type": "text/plain" }), bodyBytes: bytes(`k=${k.standin}`) });
  assert.equal(text(t.bodyBytes), "k=real-mp");
  const n = await run({ host: "api.example.com", method: "POST", url: "https://api.example.com/t", headers: new Headers({ "content-type": "text/plain" }), bodyBytes: bytes("nothing") });
  assert.equal(text(n.bodyBytes), "nothing");
});

test("body cap: readCapped returns the bytes under the cap and the same bytes as a stream over it", async () => {
  const mk = (n) => new Blob([new Uint8Array(n).fill(65)]).stream();
  assert.equal(BODY_SCAN_MAX, 1048576);
  assert.equal((await readCapped(mk(100), 1000)).bytes.length, 100);
  const o = await readCapped(mk(5000), 1000); assert.ok(o.stream && !o.bytes);
  assert.equal((await new Response(o.stream).arrayBuffer()).byteLength, 5000);
});

// ---- OAuth 1.0a, Twitter's documented example ----
const TW = { ck: "xvz1evFS4wEEPTGEFPHBog", tok: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", cs: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", ts: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", stamp: "1318622958", sig: "hCtSmYh+iHYCEqBWrE7C7hYmtUk=" };
const pctE = (x) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
// What the helper's script does on the computer: sign with whatever strings it holds (stand-ins), header values as sent.
const twHeader = (ck, tok, sig) => `OAuth oauth_consumer_key="${ck}", oauth_nonce="${TW.nonce}", oauth_signature="${encodeURIComponent(sig)}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${TW.stamp}", oauth_token="${tok}", oauth_version="1.0"`;
const twBody = "status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21";
const computerSign = (ck, tok, cs, ts) => createHmac("sha1", `${pctE(cs)}&${pctE(ts)}`).update(`POST&${pctE("https://api.twitter.com/1.1/statuses/update.json")}&${pctE(
  `include_entities=true&oauth_consumer_key=${ck}&oauth_nonce=${TW.nonce}&oauth_signature_method=HMAC-SHA1&oauth_timestamp=${TW.stamp}&oauth_token=${tok}&oauth_version=1.0&status=${pctE("Hello Ladies + Gentlemen, a signed OAuth request!")}`)}`).digest("base64");
const twReq = (host, ck, tok, sig) => ({ host, method: "POST", url: `https://${host}/1.1/statuses/update.json?include_entities=true`, bodyBytes: bytes(twBody),
  headers: new Headers({ "content-type": "application/x-www-form-urlencoded", authorization: twHeader(ck, tok, sig) }) });
const twKeys = (hosts = ["api.twitter.com"]) => { KEYS.length = 0; return { ck: key("CONSUMER_A", TW.ck, hosts), cs: key("SECRET_A", TW.cs, hosts), tok: key("TOKEN_A", TW.tok, hosts), ts: key("TOKEN_SECRET_A", TW.ts, hosts), other: key("BEARER_A", "bearer-real", hosts) }; };

test("OAuth 1.0a, Twitter's documented example: the secrets are found by the signature, whatever the key names are", async () => {
  const k = twKeys();
  const sig = computerSign(k.ck.standin, k.tok.standin, k.cs.standin, k.ts.standin);
  const r = await run(twReq("api.twitter.com", k.ck.standin, k.tok.standin, sig));
  assert.equal(r.resigned, "oauth1");
  assert.equal(r.headers.get("authorization"), twHeader(TW.ck, TW.tok, TW.sig));
  assert.equal(text(r.bodyBytes), twBody);
  assert.deepEqual(r.swapped.sort(), ["CONSUMER_A", "SECRET_A", "TOKEN_A", "TOKEN_SECRET_A"]);
  assert.ok(!r.swapped.includes("BEARER_A")); assert.ok(!JSON.stringify([...r.headers]).includes("1hs_"));
  // secrets listed in the other order (token secret named first) still pair correctly
  KEYS.reverse(); const r2 = await run(twReq("api.twitter.com", k.ck.standin, k.tok.standin, sig));
  assert.equal(r2.headers.get("authorization"), twHeader(TW.ck, TW.tok, TW.sig));
});

test("OAuth 1.0a: no signature match falls back to the plain swap; wrong host changes nothing", async () => {
  const k = twKeys();
  const bad = await run(twReq("api.twitter.com", k.ck.standin, k.tok.standin, "bm90LXRoZS1zaWduYXR1cmU="));
  assert.equal(bad.resigned, ""); assert.match(bad.headers.get("authorization"), new RegExp(`oauth_consumer_key="${TW.ck}"`)); assert.ok(bad.headers.get("authorization").includes(encodeURIComponent("bm90LXRoZS1zaWduYXR1cmU=")));
  assert.ok(!bad.swapped.includes("SECRET_A"));
  const sig = computerSign(k.ck.standin, k.tok.standin, k.cs.standin, k.ts.standin), orig = twReq("evil.example.net", k.ck.standin, k.tok.standin, sig).headers.get("authorization");
  const w = await run(twReq("evil.example.net", k.ck.standin, k.tok.standin, sig));
  assert.equal(w.headers.get("authorization"), orig); assert.equal(w.resigned, ""); assert.deepEqual(w.swapped, []);
  // the secrets are bound to another host: they are not candidates here, so nothing is signed with them
  const k2 = twKeys(["api.twitter.com"]); k2.cs.hosts = k2.ts.hosts = JSON.stringify(["other.example.com"]);
  const s = await run(twReq("api.twitter.com", k2.ck.standin, k2.tok.standin, computerSign(k2.ck.standin, k2.tok.standin, k2.cs.standin, k2.ts.standin)));
  assert.equal(s.resigned, ""); assert.ok(!JSON.stringify([...s.headers]).includes(TW.cs));
});

test("OAuth 1.0a, the helper's Live script: GET https://api.x.com/2/users/me with XCONSUMERKEY, XACCESSTOKEN, XSECRETKEY and XACCESSTOKENSECRET", async () => {
  KEYS.length = 0; const H = ["api.x.com"];
  const ck = key("XCONSUMERKEY", "live-consumer-key-0123", H), cs = key("XSECRETKEY", "live/consumer+secret=AbC9", H), tok = key("XACCESSTOKEN", "1234567-liveAccessTokenXYZ", H), ts = key("XACCESSTOKENSECRET", "liveTokenSecret/with+chars", H), bearer = key("XBEARERTOKEN", "AAAA%2Bbearer", H);
  // the script, as it runs on the computer with os.environ stand-ins (Python quote with safe='~-._' is the same set as pctE)
  const q = (x) => pctE(x), url = "https://api.x.com/2/users/me", nonce = "9f8e7d6c5b4a39281706f5e4d3c2b1a0", ts0 = "1762400000";
  const op = { oauth_consumer_key: ck.standin, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: ts0, oauth_token: tok.standin, oauth_version: "1.0" };
  const base = "GET&" + q(url) + "&" + q(Object.entries(op).sort().map(([k, v]) => q(k) + "=" + q(v)).join("&"));
  const sent = createHmac("sha1", q(cs.standin) + "&" + q(ts.standin)).update(base).digest("base64");
  const hdr = "OAuth " + Object.entries({ ...op, oauth_signature: sent }).sort().map(([k, v]) => `${q(k)}="${q(v)}"`).join(", ");
  const r = await run({ host: "api.x.com", url, headers: new Headers({ authorization: hdr }) });
  // independent computation over the real values
  const rop = { ...op, oauth_consumer_key: "live-consumer-key-0123", oauth_token: "1234567-liveAccessTokenXYZ" };
  const rbase = "GET&" + q(url) + "&" + q(Object.entries(rop).sort().map(([k, v]) => q(k) + "=" + q(v)).join("&"));
  const expected = createHmac("sha1", q("live/consumer+secret=AbC9") + "&" + q("liveTokenSecret/with+chars")).update(rbase).digest("base64");
  const want = "OAuth " + Object.entries({ ...rop, oauth_signature: expected }).sort().map(([k, v]) => `${q(k)}="${q(v)}"`).join(", ");
  assert.equal(r.resigned, "oauth1"); assert.equal(r.headers.get("authorization"), want);
  assert.notEqual(sent, expected); assert.ok(!r.swapped.includes("XBEARERTOKEN"));
  // app-only signing (consumer key only, token empty) also matches
  const op2 = { ...op }; delete op2.oauth_token;
  const b2 = "GET&" + q(url) + "&" + q(Object.entries(op2).sort().map(([k, v]) => q(k) + "=" + q(v)).join("&"));
  const h2 = "OAuth " + Object.entries({ ...op2, oauth_signature: createHmac("sha1", q(cs.standin) + "&").update(b2).digest("base64") }).sort().map(([k, v]) => `${q(k)}="${q(v)}"`).join(", ");
  const r2 = await run({ host: "api.x.com", url, headers: new Headers({ authorization: h2 }) });
  assert.equal(r2.resigned, "oauth1");
  const rop2 = { ...rop }; delete rop2.oauth_token;
  const rb2 = "GET&" + q(url) + "&" + q(Object.entries(rop2).sort().map(([k, v]) => q(k) + "=" + q(v)).join("&"));
  const want2 = "OAuth " + Object.entries({ ...rop2, oauth_signature: createHmac("sha1", q("live/consumer+secret=AbC9") + "&").update(rb2).digest("base64") }).sort().map(([k, v]) => `${q(k)}="${q(v)}"`).join(", ");
  assert.equal(r2.headers.get("authorization"), want2);
});

test("candidate cap", () => assert.equal(SECRET_CANDIDATES_MAX, 30));

// ---- AWS SigV4, AWS's published test suite ----
// The computer signs with the secret's stand-in; the expected signatures are the ones AWS publishes for the real secret.
const AWS = { akid: "AKIDEXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const awsAuth = (a, signed, s) => `AWS4-HMAC-SHA256 Credential=${a}/20150830/us-east-1/service/aws4_request, SignedHeaders=${signed}, Signature=${s}`;
const computerAws = async (host, h, body, signed, standin, method) => {
  const hs = new Headers(h); const ph = createHash("sha256").update(body || "").digest("hex");
  return sigv4Signature({ method, url: `https://${host}/`, headers: hs, payloadHash: ph, secret: standin, date: "20150830T123600Z", region: "us-east-1", service: "service", signedHeaders: signed.split(";") });
};

test("AWS SigV4: get-vanilla from AWS's test suite is signed again with the real secret and access key id", async () => {
  KEYS.length = 0;
  const id = key("ANY_ID_NAME", AWS.akid, ["example.amazonaws.com"]), sec = key("ANY_SECRET_NAME", AWS.secret, ["example.amazonaws.com"]); key("UNRELATED", "zzz", ["example.amazonaws.com"]);
  const mk = async (host) => { const h = { host, "x-amz-date": "20150830T123600Z" }; return { host, url: `https://${host}/`, headers: new Headers({ ...h, authorization: awsAuth(id.standin, "host;x-amz-date", await computerAws(host, h, "", "host;x-amz-date", sec.standin, "GET")) }) }; };
  const r = await run(await mk("example.amazonaws.com"));
  assert.equal(r.resigned, "sigv4");
  assert.equal(r.headers.get("authorization"), awsAuth(AWS.akid, "host;x-amz-date", "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"));
  assert.deepEqual(r.swapped.sort(), ["ANY_ID_NAME", "ANY_SECRET_NAME"]);
  const w = await run(await mk("evil.example.net"));
  assert.equal(w.resigned, ""); assert.ok(w.headers.get("authorization").includes(id.standin)); assert.deepEqual(w.swapped, []);
});

test("AWS SigV4: post-x-www-form-urlencoded from AWS's test suite (payload hash from the body)", async () => {
  KEYS.length = 0;
  const id = key("AWS_ACCESS_KEY_ID", AWS.akid, ["example.amazonaws.com"]), sec = key("AWS_SECRET_ACCESS_KEY", AWS.secret, ["example.amazonaws.com"]);
  const host = "example.amazonaws.com", h = { host, "content-type": "application/x-www-form-urlencoded", "x-amz-date": "20150830T123600Z" }, sg = "content-type;host;x-amz-date";
  const r = await run({ host, method: "POST", url: `https://${host}/`, bodyBytes: bytes("Param1=value1"), headers: new Headers({ ...h, authorization: awsAuth(id.standin, sg, await computerAws(host, h, "Param1=value1", sg, sec.standin, "POST")) }) });
  assert.equal(r.headers.get("authorization"), awsAuth(AWS.akid, sg, "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a"));
  // a signature that no saved key reproduces is left as the computer sent it (access key id is still swapped)
  const n = await run({ host, method: "POST", url: `https://${host}/`, bodyBytes: bytes("Param1=value1"), headers: new Headers({ ...h, authorization: awsAuth(id.standin, sg, "0".repeat(64)) }) });
  assert.equal(n.resigned, ""); assert.match(n.headers.get("authorization"), /Credential=AKIDEXAMPLE\//);
});
