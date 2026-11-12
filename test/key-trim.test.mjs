// Saved keys lose outer whitespace from a paste: the server trims on add and edit (src/vault.js), and the Sentinel (src/sentinel-swap.js) trims
// a value saved before that fix when it inserts it into a URL, header, Basic or OAuth 1.0a request or signature. Inner line breaks (PEM) stay.
// Run: bash scripts/test.sh test/key-trim.test.mjs
import assert from "node:assert/strict"; import test from "node:test"; import { createHmac } from "node:crypto"; import { DatabaseSync } from "node:sqlite";
import { saveVaultKey } from "../src/vault.js";
import { rewriteRequest, trimKey } from "../src/sentinel-swap.js";
import { Sentinel, sealSecret } from "../src/sentinel.js";

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE vault (tenant_id TEXT NOT NULL, name TEXT NOT NULL, standin TEXT NOT NULL UNIQUE, hosts TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, label TEXT, note TEXT, kind TEXT, PRIMARY KEY (tenant_id, name));`);
const stmt = (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: st.run(...a) }) }; return o; };
const VAULT_KEY = Buffer.alloc(32, 7).toString("base64");
const env = { DB: { prepare: stmt }, VAULT_KEY };
const sealedOf = (n) => d1.prepare("SELECT sealed FROM vault WHERE tenant_id='t1' AND name=?").get(n).sealed;
const openOf = async (n) => { const { openSecret } = await import("../src/sentinel.js"); return openSecret(env, sealedOf(n)); };
const H = ["a.example.com"];

test("server trims outer whitespace on add and edit and keeps inner line breaks", async () => {
  assert.equal(trimKey(" \t\r\n​﻿ abc d ​ \n"), "abc d");
  assert.equal((await saveVaultKey(env, "t1", { name: "TRIM_KEY", hosts: H, value: "  \tsecret-1\r\n" })).ok, true);
  assert.equal(await openOf("TRIM_KEY"), "secret-1");
  assert.equal((await saveVaultKey(env, "t1", { name: "TRIM_KEY", was: "TRIM_KEY", hosts: H, value: " ​secret-2﻿\n" })).ok, true);
  assert.equal(await openOf("TRIM_KEY"), "secret-2");
  const pem = "-----BEGIN KEY-----\nAAAA\nBBBB\n-----END KEY-----";
  await saveVaultKey(env, "t1", { name: "PEM_KEY", hosts: H, value: `\n${pem}\n\n` });
  assert.equal(await openOf("PEM_KEY"), pem);
  // whitespace only counts as empty: refused on add, keeps the saved value on edit
  assert.equal((await saveVaultKey(env, "t1", { name: "BLANK_KEY", hosts: H, value: " \n\t" })).status, 400);
  await saveVaultKey(env, "t1", { name: "TRIM_KEY", was: "TRIM_KEY", hosts: H, value: "  \n" });
  assert.equal(await openOf("TRIM_KEY"), "secret-2");
});

const KEYS = [];
const key = (name, real, hosts) => { const standin = "1hs_" + (name.replace(/[^A-Za-z0-9]/g, "") + "0".repeat(32)).slice(0, 32); const r = { name, standin, hosts: JSON.stringify(hosts), sealed: real }; KEYS.push(r); return r; };
const run = (o) => rewriteRequest({ method: "GET", headers: new Headers(), bodyBytes: null, ...o, lookup: async (ids) => KEYS.filter((k) => ids.includes(k.standin)), lookupHostKeys: async () => KEYS, open: (r) => r.sealed });
const q = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

test("Sentinel inserts a value saved with outer whitespace without it: Bearer, Basic, URL", async () => {
  KEYS.length = 0; const k = key("OLD_KEY", "tok-123\n", ["api.example.com"]), p = key("OLD_PASS", " pw ", ["api.example.com"]);
  const r = await run({ host: "api.example.com", url: `https://api.example.com/x?k=${k.standin}`, headers: new Headers({ authorization: `Bearer ${k.standin}`, "x-k": k.standin }) });
  assert.equal(r.url, "https://api.example.com/x?k=tok-123"); assert.equal(r.headers.get("authorization"), "Bearer tok-123"); assert.equal(r.headers.get("x-k"), "tok-123");
  const b = await run({ host: "api.example.com", url: "https://api.example.com/t", headers: new Headers({ authorization: "Basic " + Buffer.from(`${k.standin}:${p.standin}`).toString("base64") }) });
  assert.equal(Buffer.from(b.headers.get("authorization").split(" ")[1], "base64").toString(), "tok-123:pw");
});

test("Sentinel bodies: single-line value is trimmed, a multi-line value (PEM) stays as stored", async () => {
  KEYS.length = 0; const one = key("ONE_KEY", "abc \n", ["api.example.com"]), pem = "-----BEGIN-----\nAAA\n-----END-----\n", multi = key("MULTI_KEY", pem, ["api.example.com"]);
  const post = (body) => run({ host: "api.example.com", method: "POST", url: "https://api.example.com/x", headers: new Headers({ "content-type": "application/json" }), bodyBytes: new TextEncoder().encode(body) });
  const a = await post(JSON.stringify({ k: one.standin })); assert.deepEqual(JSON.parse(new TextDecoder().decode(a.bodyBytes)), { k: "abc" });
  const b = await post(JSON.stringify({ k: multi.standin })); assert.deepEqual(JSON.parse(new TextDecoder().decode(b.bodyBytes)), { k: pem });
});

test("Sentinel OAuth 1.0a: signature verifies against the trimmed key, token and secrets", async () => {
  KEYS.length = 0; const H2 = ["api.x.com"];
  const ck = key("XCONSUMERKEY", "ck-0123\n", H2), cs = key("XSECRETKEY", " cons/secret+AbC9", H2), tok = key("XACCESSTOKEN", "123-tokXYZ ", H2), ts = key("XACCESSTOKENSECRET", "tokSecret/+x\r\n", H2);
  const url = "https://api.x.com/2/users/me", op = { oauth_consumer_key: ck.standin, oauth_nonce: "9f8e7d6c5b4a3928", oauth_signature_method: "HMAC-SHA1", oauth_timestamp: "1762400000", oauth_token: tok.standin, oauth_version: "1.0" };
  const mk = (o, sig) => "OAuth " + Object.entries({ ...o, oauth_signature: sig }).sort().map(([k, v]) => `${q(k)}="${q(v)}"`).join(", ");
  const base = (o) => "GET&" + q(url) + "&" + q(Object.entries(o).sort().map(([k, v]) => q(k) + "=" + q(v)).join("&"));
  const sent = createHmac("sha1", q(cs.standin) + "&" + q(ts.standin)).update(base(op)).digest("base64");
  const r = await run({ host: "api.x.com", url, headers: new Headers({ authorization: mk(op, sent) }) });
  const rop = { ...op, oauth_consumer_key: "ck-0123", oauth_token: "123-tokXYZ" };
  const want = createHmac("sha1", q("cons/secret+AbC9") + "&" + q("tokSecret/+x")).update(base(rop)).digest("base64");
  assert.equal(r.resigned, "oauth1"); assert.equal(r.headers.get("authorization"), mk(rop, want));
});

test("Sentinel: an echo of the trimmed real value (and of the stored one) comes back as the stand-in", async () => {
  const S = "1hs_" + "T".repeat(32), stored = "real-key-9\n";
  const rows = [{ name: "T_KEY", standin: S, hosts: JSON.stringify(["api.example.com"]), sealed: await sealSecret({ VAULT_KEY }, stored) }];
  const C = { noteEgress: async () => ({}) };
  const e = { VAULT_KEY, CHANNEL_COMPUTER: { idFromString: (i) => i, get: () => C }, RESIDENT: { idFromName: (i) => i, get: () => ({ egressDecision: async () => ({ verdict: "allow", why: "t" }) }) }, DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } };
  const saved = globalThis.fetch; let seen;
  globalThis.fetch = async (r) => { seen = r; return new Response(`url=${r.url} auth=${r.headers.get("authorization")} stored=${stored.replace("\n", "\\n")}`); };
  try {
    const res = await new Sentinel({ props: { id: "c", tenant: "t", channel: "ch" } }, e).fetch(new Request(`https://api.example.com/x?k=${S}`, { headers: { authorization: `Bearer ${S}` } }));
    assert.equal(seen.url, "https://api.example.com/x?k=real-key-9"); assert.equal(seen.headers.get("authorization"), "Bearer real-key-9");
    const text = await res.text(); assert.ok(!text.includes("real-key-9"), text); assert.ok(text.includes(S));
  } finally { globalThis.fetch = saved; }
});
