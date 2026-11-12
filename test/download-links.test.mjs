// node --import ./test/stubs/register.mjs test/download-links.test.mjs
// Download links for the phone apps (src/download-links.js, share.js route /d/<token>/<name>, index.js POST /api/download-link).
// D1 on node:sqlite, a fake R2. Checks: a Library file link (one file, attachment, right name, 3 minutes, token never stored), a blob link and its R2 copy,
// GET and HEAD only, byte ranges, no cookie, wrong token / other workspace / expiry refused, view-as and signed-out refused, limits, the sweep of expired
// copies, the route and the page's use of it exist in the source.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { createDownloadLink, serveDownloadLink, downloadLinkApi, DL_TTL_MS, DL_MAX_BYTES, DL_PER_HOUR, DL_LIVE_MAX, _resetEnsured } from "../src/download-links.js";
import { servePublic, isPublicShare } from "../src/share.js";

globalThis.FixedLengthStream ??= class extends TransformStream { constructor() { super(); } };   // Workers only
let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const realNow = Date.now.bind(Date); let OFF = 0; Date.now = () => realNow() + OFF;
const enc = (s) => new TextEncoder().encode(s);
const mkDB = () => {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, host_ready INTEGER); INSERT INTO tenants VALUES ('t1','ck1',0),('t2','ck2',0);`);
  _resetEnsured();
  const DB = { prepare: (q) => { const st = d.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => { st.run(...a); return {}; } }; return o; } };
  return { d, DB };
};
const R2 = new Map();
const WS = {
  async put(key, body) { R2.set(key, body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())); },
  async delete(key) { R2.delete(key); },
  async get(key, opts = {}) {
    const b = R2.get(key); if (!b) return null;
    const rh = opts.range instanceof Headers ? opts.range : null, m = rh?.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    if (m) { const a = Number(m[1]), z = m[2] ? Math.min(Number(m[2]), b.length - 1) : b.length - 1; return { size: b.length, httpEtag: '"e1"', body: new Response(b.slice(a, z + 1)).body, range: { offset: a, length: z - a + 1 } }; }
    return { size: b.length, httpEtag: '"e1"', body: new Response(b).body };
  },
};
R2.set("t/t1/files/main/f1", enc("slides bytes")); R2.set("t/t2/files/main/g1", enc("other workspace"));
const FILE1 = { id: "f1", name: "ai impact report.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: 12, r2key: "t/t1/files/main/f1" };
const T1 = { id: "t1", slug: "ck1", host_ready: 0 }, T2 = { id: "t2", slug: "ck2", host_ready: 0 };
const VAULT = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const mkEnv = () => { const { d, DB } = mkDB(); return { d, env: { DB, WS, VAULT_KEY: VAULT, ENV_NAME: "dev", APP_HOST: "app.example.test" } }; };
const tokenOf = (url) => /\/d\/([A-Za-z0-9_-]{43})\//.exec(url)[1];
const get = (env, url, init = {}) => servePublic(new Request(url, init), env, new URL(url));
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

// 1. a Library file link
{
  const { d, env } = mkEnv();
  const r = await createDownloadLink(env, T1, { userId: "u1", channel: "main" }, "file", FILE1);
  assert.ok(!r.error, r.error);
  assert.match(r.url, /^https:\/\/app\.example\.test\/s\/ck1\/d\/[A-Za-z0-9_-]{43}\/ai%20impact%20report\.pptx$/);
  assert.equal(DL_TTL_MS, 3 * 60 * 1000); assert.ok(Math.abs(r.expires_at - realNow() - DL_TTL_MS) < 2000);
  const tok = tokenOf(r.url), row = d.prepare("SELECT * FROM download_links").get();
  assert.equal(row.tenant_id, "t1"); assert.equal(row.user_id, "u1"); assert.equal(row.kind, "file"); assert.equal(row.file_id, "f1"); assert.equal(row.channel, "main");
  assert.ok(!JSON.stringify(row).includes(tok), "the token is never stored"); assert.equal(row.token_hash.length, 64);
  assert.ok(isPublicShare(env, new URL(r.url)), "/s/<slug>/d/<token> is answered before any sign-in gate");
  assert.ok(isPublicShare({ ENV_NAME: "prod", APP_HOST: "app.1helm.com", PUBLIC_BASE_DOMAIN: "1helm.com" }, new URL(`https://ck1.1helm.com/d/${tok}/x.pptx`)));
  ok("a Library file link is for one file, 3 minutes, bound to the workspace, the account and the file; the token is never stored");

  let s = await get(env, r.url);
  assert.equal(s.status, 200); assert.match(s.headers.get("content-disposition"), /^attachment; filename\*=UTF-8''ai%20impact%20report\.pptx$/);
  assert.equal(s.headers.get("content-type"), "application/octet-stream");   /* public linkHeaders sends xml-like types (the pptx type contains "openxml") as octet-stream; still an attachment with the right name */ assert.equal(s.headers.get("content-length"), "12"); assert.equal(s.headers.get("set-cookie"), null);
  assert.equal(s.headers.get("cache-control"), "no-store"); assert.equal(s.headers.get("x-content-type-options"), "nosniff"); assert.equal(s.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await s.text(), "slides bytes");
  s = await get(env, r.url, { headers: { range: "bytes=0-5" } }); assert.equal(s.status, 206); assert.equal(await s.text(), "slides");
  s = await get(env, r.url, { method: "HEAD" }); assert.equal(s.status, 200); assert.equal(await s.text(), "");
  for (const m of ["POST", "PUT", "DELETE"]) assert.equal((await get(env, r.url, { method: m })).status, 405, m);
  ok("serving: always an attachment with the file's name, no cookie, no cache, ranges and HEAD work, GET and HEAD only");

  // an inline-viewable file is still an attachment, and html is never rendered
  R2.set("t/t1/files/main/f9", enc("<script>x</script>")); R2.set("t/t1/files/main/f8", enc("%PDF"));
  for (const [f, mime] of [["f9", "text/html"], ["f8", "application/pdf"]]) {
    const x = await createDownloadLink(env, T1, { userId: "u1" }, "file", { id: f, name: `a.${f}`, mime, bytes: 4, r2key: `t/t1/files/main/${f}` });
    const y = await get(env, x.url); assert.match(y.headers.get("content-disposition"), /^attachment;/, mime);
  }
  ok("a PDF or a web page is an attachment too");

  // refusals
  const other = new URL(r.url.replace("/s/ck1/", "/s/ck2/"));
  assert.equal((await servePublic(new Request(other), env, other)).status, 404, "another workspace's address");
  const bad = new URL(r.url.replace(tok, tok.slice(0, 42) + (tok[42] === "A" ? "B" : "A"))); assert.equal((await servePublic(new Request(bad), env, bad)).status, 404);
  assert.equal((await get(env, r.url.replace(tok, "x".repeat(43)))).status, 404);
  assert.equal((await get(env, r.url.replace(tok, "short"))).status, 404);
  OFF = DL_TTL_MS + 1000; assert.equal((await get(env, r.url)).status, 404, "after 3 minutes"); OFF = 0;
  R2.delete("t/t1/files/main/f1"); assert.equal((await get(env, r.url)).status, 404, "the file is gone"); R2.set("t/t1/files/main/f1", enc("slides bytes"));
  ok("a wrong address, another workspace, a changed token, an expired link and a deleted file all answer 404");

  // too big
  const big = await createDownloadLink(env, T1, { userId: "u1" }, "file", { ...FILE1, bytes: DL_MAX_BYTES + 1 }); assert.equal(big.status, 413);
  assert.equal((await createDownloadLink(env, T1, { userId: "u1" }, "file", { ...FILE1, r2key: "" })).status, 404);
  ok("a file over the limit and a file with no stored bytes are refused");
}

// 2. blobs: a copy made in R2, served, swept after expiry
{
  const { d, env } = mkEnv();
  const r = await createDownloadLink(env, T1, { userId: "u1" }, "blob", { name: "meeting-transcript.txt", mime: "text/plain", body: enc("hello transcript"), len: 16 });
  assert.ok(!r.error, r.error); const row = d.prepare("SELECT * FROM download_links").get();
  assert.equal(row.kind, "blob"); assert.match(row.r2key, /^t\/t1\/dl\//); assert.ok(R2.has(row.r2key));
  const s = await get(env, r.url); assert.equal(s.status, 200); assert.match(s.headers.get("content-disposition"), /attachment; filename\*=UTF-8''meeting-transcript\.txt/); assert.equal(await s.text(), "hello transcript");
  OFF = DL_TTL_MS + 1000; assert.equal((await get(env, r.url)).status, 404);
  const r2 = await createDownloadLink(env, T1, { userId: "u1" }, "blob", { name: "b.txt", mime: "text/plain", body: enc("two"), len: 3 }); OFF = 0;
  assert.ok(!R2.has(row.r2key), "the expired copy is deleted when the next link is made"); assert.equal(d.prepare("SELECT r2key FROM download_links WHERE id=?").get(row.id).r2key, ""); OFF = 4000e3; await createDownloadLink(env, T1, { userId: "u1" }, "file", FILE1); OFF = 0; assert.equal(d.prepare("SELECT COUNT(*) n FROM download_links WHERE id=?").get(row.id).n, 0, "rows go after an hour");
  assert.ok(!r2.error);
  ok("a blob is kept as a temporary copy for 3 minutes, served as an attachment, then deleted");
}

// 3. limits
{
  const { env } = mkEnv();
  for (let i = 0; i < DL_LIVE_MAX; i++) assert.ok(!(await createDownloadLink(env, T1, { userId: "u1" }, "file", FILE1)).error);
  assert.equal((await createDownloadLink(env, T1, { userId: "u1" }, "file", FILE1)).status, 429, "live cap");
  assert.ok(!(await createDownloadLink(env, T2, { userId: "u2" }, "file", { ...FILE1, r2key: "t/t2/files/main/g1" })).error, "the cap is per workspace");
  const e2 = mkEnv().env;
  for (let i = 0; i < DL_PER_HOUR; i++) { assert.ok(!(await createDownloadLink(e2, T1, { userId: "u1" }, "file", FILE1)).error, `link ${i}`); if (i % DL_LIVE_MAX === DL_LIVE_MAX - 1) OFF += DL_TTL_MS + 1000; }
  assert.equal((await createDownloadLink(e2, T1, { userId: "u1" }, "file", FILE1)).status, 429, "hourly cap"); OFF = 0;
  ok("at most DL_LIVE_MAX open links and DL_PER_HOUR new links an hour for each workspace");
}

// 4. the signed-in route
{
  const { env } = mkEnv();
  const deps = (over = {}) => ({ json, look: false, channelOf: async (c) => (c === "main" ? { slug: "main" } : null), fileRowOf: async (ch, id) => (id === "f1" ? FILE1 : null), ...over });
  const post = (sub, body, headers = {}) => new Request(`https://app.example.test/w/ck1${sub}`, { method: "POST", body, headers });
  let r = await downloadLinkApi(post("/api/download-link", JSON.stringify({ channel: "main", file: "f1" })), env, T1, { id: "u1" }, "/api/download-link", deps());
  assert.equal(r.status, 200); const j = await r.json(); assert.match(j.url, /\/d\/[A-Za-z0-9_-]{43}\//); assert.equal(j.name, FILE1.name);
  r = await downloadLinkApi(post("/api/download-link", JSON.stringify({ channel: "main", file: "f1" })), env, T1, { id: "u1" }, "/api/download-link", deps({ look: true }));
  assert.equal(r.status, 403, "a view-as request is refused");
  r = await downloadLinkApi(post("/api/download-link", JSON.stringify({ channel: "main", file: "f1" })), env, T1, null, "/api/download-link", deps()); assert.equal(r.status, 401, "signed out");
  r = await downloadLinkApi(new Request("https://app.example.test/w/ck1/api/download-link"), env, T1, { id: "u1" }, "/api/download-link", deps()); assert.equal(r.status, 405);
  r = await downloadLinkApi(post("/api/download-link", JSON.stringify({ channel: "nope", file: "f1" })), env, T1, { id: "u1" }, "/api/download-link", deps()); assert.equal(r.status, 404);
  r = await downloadLinkApi(post("/api/download-link", JSON.stringify({ channel: "main", file: "zzz" })), env, T1, { id: "u1" }, "/api/download-link", deps()); assert.equal(r.status, 404);
  r = await downloadLinkApi(post("/api/download-link", "[]"), env, T1, { id: "u1" }, "/api/download-link", deps()); assert.equal(r.status, 400);
  r = await downloadLinkApi(post("/api/download-link/blob", "hello", { "content-length": "5", "x-file-name": encodeURIComponent("my notes.txt"), "content-type": "text/plain" }), env, T1, { id: "u1" }, "/api/download-link/blob", deps());
  assert.equal(r.status, 200, await r.clone().text()); const b = await r.json(); assert.match(b.url, /my%20notes\.txt$/);
  assert.equal(await (await get(env, b.url)).text(), "hello");
  r = await downloadLinkApi(post("/api/download-link/blob", "x", { "content-length": String(DL_MAX_BYTES + 1) }), env, T1, { id: "u1" }, "/api/download-link/blob", deps()); assert.equal(r.status, 413);
  r = await downloadLinkApi(post("/api/download-link/blob", "x"), env, T1, { id: "u1" }, "/api/download-link/blob", deps({})); assert.ok([411, 200].includes(r.status));
  ok("the signed-in route makes links for the person's own files and blobs, refuses view-as, signed-out, wrong method, unknown file and oversize bodies");
}

// 5. the wiring in the source (the public repository has no dev lock; the /d/ path is answered by share.js before any sign-in gate)
{
  const tok = "A".repeat(43);
  assert.equal(isPublicShare({}, new URL(`https://x.test/s/ck1/d/${tok}/x.pptx`)), true, "the token path is a public share route, so no sign-in gate is in front of it");
  assert.equal(isPublicShare({}, new URL(`https://x.test/w/ck1/api/download-link`)), false);
  const idx = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(idx, /sub === "\/api\/download-link" \|\| sub === "\/api\/download-link\/blob"/); assert.match(idx, /downloadLinkApi\(req, env, t, user, sub/); assert.match(idx, /look: !!viewAsToken\(req\)/);
  ok("the /d/ path is a public share route, and index.js routes both download-link POSTs through downloadLinkApi with the view-as flag");
}
console.log(`PASS ${n} checks`);
