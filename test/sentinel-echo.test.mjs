// Sentinel echo protection: a key's own API can echo the request, and the computer must get stand-ins back, never real values.
// Pure scrubbing (src/sentinel-scrub.js) plus the whole Sentinel with a stubbed vault and upstream.
// Run: bash scripts/test.sh test/sentinel-echo.test.mjs
import assert from "node:assert/strict"; import test from "node:test";
import { Sentinel, sealSecret } from "../src/sentinel.js";
import { echoForms, hideEchoedKeys, basicEchoPairs, encodedResponse } from "../src/sentinel-scrub.js";
import { oauthSignature } from "../src/sentinel-swap.js";

const REAL = 'p@ss w/o"rd+é(1)!', STAND = "1hs_" + "E".repeat(32);
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const forms = {
  raw: REAL, url: encodeURIComponent(REAL), urlLower: encodeURIComponent(REAL).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), pct: pct(REAL),
  form: encodeURIComponent(REAL).replace(/%20/g, "+"), twice: pct(pct(REAL)), json: JSON.stringify(REAL).slice(1, -1), jsonTwice: JSON.stringify(JSON.stringify(REAL).slice(1, -1)).slice(1, -1),
  jsonSlash: JSON.stringify(REAL).slice(1, -1).replace(/\//g, "\\/"), jsonU: REAL.split("").map((c) => /[A-Za-z0-9]/.test(c) ? c : "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join(""),
  xml: REAL.replace(/&/g, "&amp;").replace(/"/g, "&quot;"),
};
const scrub = async (res, secrets = [{ real: REAL, standin: STAND }]) => hideEchoedKeys(res, secrets);

test("every encoded form of a real value comes back as the stand-in, in the body and in headers", async () => {
  for (const [name, f] of Object.entries(forms)) {
    assert.ok(echoForms(REAL).has(f), `form ${name} is listed`);
    const r = await scrub(new Response(`before ${f} after`, { status: 200, statusText: "ok " + f, headers: { "x-echo": `v=${f}`, location: `https://x.test/?k=${f}`, "content-length": "99", etag: "x" } }));
    assert.equal(await r.text(), `before ${STAND} after`, name);
    assert.equal(r.headers.get("x-echo"), `v=${STAND}`, name); assert.equal(r.headers.get("location"), `https://x.test/?k=${STAND}`, name);
    assert.equal(r.statusText, "ok " + STAND, name); assert.equal(r.headers.get("content-length"), null); assert.equal(r.headers.get("etag"), null);
  }
});

test("a value split across stream chunks is still replaced, and all bytes are kept in order", async () => {
  const body = new ReadableStream({ start(c) { const e = new TextEncoder(), s = `aa${REAL}bb${forms.url}cc`; for (let i = 0; i < s.length; i += 3) c.enqueue(e.encode(s.slice(i, i + 3))); c.close(); } });
  assert.equal(await (await scrub(new Response(body))).text(), `aa${STAND}bb${STAND}cc`);
  const big = "x".repeat(3_000_000) + REAL + "y".repeat(10);
  assert.equal(await (await scrub(new Response(big))).text(), "x".repeat(3_000_000) + STAND + "y".repeat(10));
  assert.equal((await scrub(new Response(null, { status: 204 }))).status, 204);
});

test("Basic credentials: the echoed base64 comes back as the one the computer sent", () => {
  const sent = "Basic " + Buffer.from(`user:${STAND}`).toString("base64"), after = "Basic " + Buffer.from(`user:${REAL}`).toString("base64");
  const pairs = basicEchoPairs(new Headers({ authorization: sent }), new Headers({ authorization: after }));
  assert.ok(pairs.length);
  const tok = after.split(" ")[1], back = sent.split(" ")[1], un = (t) => t.replace(/=+$/, ""), url = (t) => t.replace(/\+/g, "-").replace(/\//g, "_");
  return Promise.all([[tok, back], [un(tok), un(back)], [url(tok), url(back)]].map(async ([t, b]) =>
    assert.equal(await (await scrub(new Response(`{"authorization":"Basic ${t}"}`), pairs)).text(), `{"authorization":"Basic ${b}"}`)));
});

test("encodedResponse", () => {
  assert.equal(encodedResponse(new Response("x", { headers: { "content-encoding": "gzip" } })), true);
  assert.equal(encodedResponse(new Response("x", { headers: { "content-encoding": "identity" } })), false);
  assert.equal(encodedResponse(new Response("x")), false);
});

// ---- the whole Sentinel ----
const VAULT_KEY = Buffer.alloc(32, 7).toString("base64");
const vaultEnv = (rows, upstream) => {
  const C = { noteEgress: async () => ({}) };
  return { VAULT_KEY, CHANNEL_COMPUTER: { idFromString: (i) => i, get: () => C }, RESIDENT: { idFromName: (i) => i, get: () => ({ egressDecision: async () => ({ verdict: "allow", why: "t" }) }) },
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } };
};
const sent = [];
async function sentinelRun(rows, req, reply) {
  const saved = globalThis.fetch;
  globalThis.fetch = async (r) => { const hdrs = Object.fromEntries(r.headers), body = r.body ? await r.text() : ""; sent.push({ url: r.url, headers: hdrs, body }); return reply({ url: r.url, headers: hdrs, body }); };
  try { return await new Sentinel({ props: { id: "c", tenant: "t", channel: "ch" } }, vaultEnv(rows)).fetch(req); } finally { globalThis.fetch = saved; }
}
const row = async (name, real, standin, hosts = ["api.example.com"]) => ({ name, standin, hosts: JSON.stringify(hosts), sealed: await sealSecret({ VAULT_KEY }, real) });
const echo = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "x-url": o.url, "x-auth": o.headers.authorization || "" } });

test("Sentinel: echoed header, URL and body come back as stand-ins, and the request asks for identity encoding", async () => {
  const S1 = "1hs_" + "A".repeat(32), S2 = "1hs_" + "B".repeat(32), R1 = "real/key+1", R2 = 'sec"ret';
  const rows = [await row("K1", R1, S1), await row("K2", R2, S2)];
  const basic = "Basic " + Buffer.from(`${S1}:${S2}`).toString("base64");
  const res = await sentinelRun(rows, new Request(`https://api.example.com/x?k=${S1}`, { method: "POST", headers: { authorization: basic, "content-type": "application/json", "accept-encoding": "gzip", "x-k": S2 }, body: JSON.stringify({ a: S1, b: S2 }) }), echo);
  const out = sent.at(-1);
  assert.equal(out.headers["accept-encoding"], "identity");
  assert.ok(out.url.includes(encodeURIComponent(R1)) && out.body.includes(R2.replace(/"/g, '\\"')), "upstream got real values");
  const text = await res.text();
  for (const real of [R1, encodeURIComponent(R1), R2, 'sec\\"ret']) assert.ok(!text.includes(real), "body has no " + real);
  const inner = JSON.parse(text);
  assert.equal(inner.url, `https://api.example.com/x?k=${S1}`); assert.equal(inner.body, JSON.stringify({ a: S1, b: S2 }));
  assert.equal(inner.headers["x-k"], S2);
  assert.equal(res.headers.get("x-url"), `https://api.example.com/x?k=${S1}`);
  assert.equal(res.headers.get("x-auth"), basic, "the echoed Basic credential is the one the computer sent");
  assert.ok(!text.includes(Buffer.from(`${R1}:${R2}`).toString("base64")));
});

test("Sentinel: a signing-only secret is scrubbed too (OAuth PLAINTEXT echo)", async () => {
  const CK = "1hs_" + "C".repeat(32), CS = "1hs_" + "D".repeat(32), CS_REAL = "con&sumer secret";
  const rows = [await row("CK", "real-ck", CK), await row("CS", CS_REAL, CS)];
  const params = { oauth_consumer_key: CK, oauth_signature_method: "PLAINTEXT", oauth_nonce: "n", oauth_timestamp: "1", oauth_version: "1.0" };
  const sig = await oauthSignature({ method: "GET", url: "https://api.example.com/o", params: Object.entries(params), consumerSecret: CS, tokenSecret: "", sigMethod: "PLAINTEXT" });
  const auth = "OAuth " + Object.entries({ ...params, oauth_signature: pct(sig) }).map(([k, v]) => `${k}="${v}"`).join(", ");
  const res = await sentinelRun(rows, new Request("https://api.example.com/o", { headers: { authorization: auth } }), echo);
  assert.ok(sent.at(-1).headers.authorization.includes(pct(pct(CS_REAL))), "the request was signed with the real secret");
  const text = await res.text(), hdr = res.headers.get("x-auth");
  for (const s of [text, hdr]) for (const f of [CS_REAL, pct(CS_REAL), pct(pct(CS_REAL)), "real-ck"]) assert.ok(!s.includes(f), "no " + f);
  assert.ok(hdr.includes(pct(pct(CS))), "the double-encoded stand-in is back");
});

test("Sentinel: an encoded response is refused with 502 when keys were swapped", async () => {
  const S = "1hs_" + "F".repeat(32), rows = [await row("K", "rk", S)];
  const res = await sentinelRun(rows, new Request(`https://api.example.com/x?k=${S}`), () => new Response("gz", { headers: { "content-encoding": "gzip" } }));
  assert.equal(res.status, 502); assert.match(await res.text(), /encoding not supported/);
});

test("Sentinel: requests without swapped keys are untouched", async () => {
  const S = "1hs_" + "G".repeat(32), rows = [await row("K", "rk", S, ["other.example.com"])];
  const body = new Response("hello rk", { headers: { "content-encoding": "gzip", etag: "e", "content-length": "8" } });
  // no stand-in at all
  const plain = await sentinelRun(rows, new Request("https://api.example.com/x", { headers: { "accept-encoding": "gzip" } }), () => body);
  assert.equal(sent.at(-1).headers["accept-encoding"], "gzip"); assert.equal(plain, body, "the upstream response object is returned as is");
  // a stand-in for another host stays a stand-in and nothing is scrubbed
  const wrong = new Response("echo", { headers: { "content-encoding": "gzip" } });
  const r = await sentinelRun(rows, new Request(`https://api.example.com/x?k=${S}`, { headers: { "accept-encoding": "gzip" } }), () => wrong);
  assert.equal(sent.at(-1).headers["accept-encoding"], "gzip"); assert.equal(r, wrong); assert.ok(sent.at(-1).url.endsWith(S));
});
