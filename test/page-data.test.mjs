// node --import ./test/stubs/register.mjs test/page-data.test.mjs
// Saved data of published pages (src/page-data.js): anyone with the page link reads and writes it, no sign-in. Checks the public route through
// servePublic (add, list, get, put, delete, a reserved _data path that never serves a page file, CORS and the OPTIONS preflight, the session cookie never
// read or set), every limit with its plain message (entry size, entries per page, page bytes, collections, writes per visitor and per page, the account's
// storage), the owner API (counts in the list, JSON and CSV download with formula guard, clear), the helper tool, republish keeping the data, unpublish
// removing it, and that one person's page never sees another's. Channel and account deletion are in test/deletion.test.mjs.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync, readdirSync } from "node:fs";
import { servePublic, shareApi, runShareTool } from "../src/share.js";
import { publishVersion, unpublish, getPage } from "../src/publish.js";
import { PAGE_DATA, pageDataCsv } from "../src/page-data.js";
import { storageOf } from "../src/storage.js";

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, plan TEXT, status TEXT);
  CREATE TABLE storage_usage (tenant_id TEXT, kind TEXT, bytes INTEGER, objects INTEGER, PRIMARY KEY (tenant_id, kind));
  CREATE TABLE storage_plan (tenant_id TEXT PRIMARY KEY, blocks INTEGER DEFAULT 0, counted_at INTEGER, notice_seen INTEGER DEFAULT 0, refused_at INTEGER, refused_what TEXT, updated_at INTEGER);
  INSERT INTO tenants VALUES ('t1','ck1','plus','active'),('t2','ck2','plus','active');`);
d1.exec(readFileSync(new URL("../db/migrations/0015_025_share.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("../db/migrations/0083_page_data.sql", import.meta.url), "utf8"));
const DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }; return o; } };
const R2 = new Map();
const WS = { async put(k, v) { R2.set(k, v); return {}; }, async head(k) { return R2.has(k) ? { key: k } : null; }, async get(k) { return R2.has(k) ? { body: new Response(R2.get(k)).body, size: 3, httpEtag: '"e"' } : null; },
  async delete(keys) { for (const k of [].concat(keys)) R2.delete(k); }, async list({ prefix = "" } = {}) { return { objects: [...R2.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 3 })), truncated: false }; } };
const env = { DB, WS, APP_HOST: "onehelm.test" };
let passed = 0; const ok = (n) => { passed++; console.log("  ok", n); };
const T1 = { id: "t1", slug: "ck1" };

const pre1 = `t/t1/pages/${crypto.randomUUID()}`; R2.set(`${pre1}/index.html`, "<h1>dinner</h1>");
const pub = await publishVersion(env, "t1", { name: "dinner", prefix: pre1, files: 1, bytes: 15, title: "Dinner", channel: "main", source: "x" }); assert.ok(pub.page, JSON.stringify(pub));
const pre2 = `t/t2/pages/${crypto.randomUUID()}`; R2.set(`${pre2}/index.html`, "x");
await publishVersion(env, "t2", { name: "dinner", prefix: pre2, files: 1, bytes: 1, channel: "main", source: "y" });
const U = (path, host = "onehelm.test", slug = "ck1") => `https://${host}/s/${slug}/p/${path}`;
const call = (path, { method = "GET", body, headers = {}, ip = "1.1.1.1", slug = "ck1" } = {}) => servePublic(new Request(U(path, "onehelm.test", slug), { method, headers: { "cf-connecting-ip": ip, origin: "null", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env, new URL(U(path, "onehelm.test", slug)));
const J = async (r) => ({ status: r.status, body: await r.json() });

// ---- add, list, get, put, delete ----
{
  const a = await call("dinner/_data/orders", { method: "POST", body: { name: "Sam", order: "soup" } }); assert.equal(a.status, 201);
  const aj = await a.json(); assert.match(aj.id, /^[0-9a-f]{16}$/); assert.deepEqual(aj.data, { name: "Sam", order: "soup" });
  await call("dinner/_data/orders", { method: "POST", body: { name: "Eve", order: "salad" } });
  const l = await J(await call("dinner/_data/orders")); assert.equal(l.status, 200); assert.equal(l.body.count, 2); assert.deepEqual(l.body.entries.map((e) => e.data.name), ["Sam", "Eve"]); assert.equal(l.body.next, null);
  assert.equal((await J(await call("dinner/_data/orders?limit=1"))).body.next, 1);
  assert.equal((await J(await call("dinner/_data/orders?limit=1&offset=1"))).body.entries[0].data.name, "Eve");
  const g = await J(await call(`dinner/_data/orders/${aj.id}`)); assert.equal(g.body.data.order, "soup");
  assert.equal((await call("dinner/_data/orders/nope")).status, 404);
  const empty = await J(await call("dinner/_data/other")); assert.deepEqual(empty.body, { entries: [], count: 0, next: null });
  const p1 = await call("dinner/_data/games/abc123", { method: "PUT", body: { board: [1, 2, 3], turn: "x" } }); assert.equal(p1.status, 201);
  const p2 = await call("dinner/_data/games/abc123", { method: "PUT", body: { board: [1, 2, 3, 4], turn: "o" } }); assert.equal(p2.status, 200);
  const g2 = await J(await call("dinner/_data/games/abc123")); assert.deepEqual(g2.body.data.board, [1, 2, 3, 4]); assert.equal(d1.prepare("SELECT COUNT(*) n FROM page_data WHERE collection='games'").get().n, 1);
  assert.equal(g2.body.created_at, (await p1.json()).created_at, "a replace keeps the creation time");
  assert.deepEqual(await (await call("dinner/_data/games/abc123", { method: "DELETE" })).json(), { ok: true, deleted: 1 });
  assert.equal((await call("dinner/_data/games/abc123")).status, 404);
  assert.equal((await call("dinner/_data/orders", { method: "HEAD" })).status, 200);
  ok("add / list (paging) / get / put (create + replace) / delete, JSON in and out");
}
// ---- CORS, preflight, cookies, reserved path ----
{
  const pf = await call("dinner/_data/orders", { method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  assert.equal(pf.status, 204); assert.equal(pf.headers.get("access-control-allow-origin"), "*"); assert.match(pf.headers.get("access-control-allow-methods"), /POST.*PUT.*DELETE/); assert.match(pf.headers.get("access-control-allow-headers"), /content-type/i);
  assert.equal((await call("nothere/_data/x", { method: "OPTIONS" })).status, 204, "the preflight needs no lookup");
  for (const r of [await call("dinner/_data/orders"), await call("dinner/_data/orders", { method: "POST", body: { a: 1 }, headers: { cookie: "hc_session=aa11" } }), await call("dinner/_data/BAD!", {}), await call("dinner/_data/orders", { method: "POST", body: "{nope" })]) {
    assert.equal(r.headers.get("access-control-allow-origin"), "*"); assert.equal(r.headers.get("set-cookie"), null); assert.equal(r.headers.get("cache-control"), "no-store"); assert.match(r.headers.get("content-type"), /^application\/json/); }
  R2.set(`${pre1}/_data/secret.json`, "files named _data are never served"); assert.equal((await call("dinner/_data/secret.json")).status, 400); assert.equal((await call("dinner/_data")).status, 404);
  assert.equal((await call("dinner/_data/orders/x/y")).status, 404);
  assert.equal((await call("dinner/index.html", { method: "POST", body: {} })).status, 405, "a page file still only takes GET");
  assert.equal((await servePublic(new Request(U("dinner/_data/orders"), { method: "PATCH", headers: { "cf-connecting-ip": "1.1.1.1" }, body: "{}" }), env, new URL(U("dinner/_data/orders")))).status, 405);
  assert.equal((await call("dinner/")).status, 200, "the page itself still serves"); assert.match((await call("dinner/")).headers.get("content-security-policy"), /^sandbox allow-scripts allow-forms allow-popups;/);
  assert.equal((await call("dinner/_data/orders", { method: "PUT", body: {} })).status, 405); assert.equal((await call("dinner/_data/orders/x", { method: "POST", body: {} })).status, 405);
  ok("CORS on every answer, OPTIONS preflight, no cookie read or set, _data reserved, other methods refused, page CSP unchanged");
}
// ---- one person's page is never another's ----
{
  const t2 = await J(await call("dinner/_data/orders", { slug: "ck2" })); assert.equal(t2.body.count, 0, "Eve's dinner page has its own data");
  await call("dinner/_data/orders", { method: "POST", body: { name: "Eve only" }, slug: "ck2" });
  assert.equal((await J(await call("dinner/_data/orders"))).body.count, 3); assert.equal((await J(await call("dinner/_data/orders", { slug: "ck2" }))).body.count, 1);
  assert.equal((await call("dinner/_data/orders", { slug: "ck3" })).status, 404);
  d1.prepare("DELETE FROM page_data WHERE tenant_id='t2'").run();
  ok("data is keyed by account and page: the same page name on two accounts is separate, an unknown address is 404");
}
// ---- limits ----
{
  const big = await call("dinner/_data/orders", { method: "POST", body: { t: "x".repeat(PAGE_DATA.entry_bytes) } }); assert.equal(big.status, 413); assert.match((await big.json()).error, /too big.*up to 64 KB/);
  assert.equal((await call("dinner/_data/orders", { method: "POST", body: "" })).status, 400); assert.equal((await call("dinner/_data/orders", { method: "POST", body: "{nope" })).status, 400);
  assert.equal((await call("dinner/_data/Bad_Name", { method: "POST", body: {} })).status, 400); assert.equal((await call("dinner/_data/orders/bad%20id", { method: "PUT", body: {} })).status, 400);
  // rate: 60 writes a minute per address (the earlier writes in this run count); another address still writes
  const now = Math.floor(Date.now() / 60000); d1.prepare("DELETE FROM page_data_rate").run();
  let last; for (let i = 0; i < PAGE_DATA.writes_per_minute + 1; i++) last = await call(`dinner/_data/rate/k${i}`, { method: "PUT", body: { i }, ip: "9.9.9.9" });
  assert.equal(last.status, 429); assert.match((await last.json()).error, /Too many saves from this address\. Try again in a minute\./); assert.ok(Number(last.headers.get("retry-after")) >= 1);
  assert.equal((await call("dinner/_data/rate/z", { method: "PUT", body: {}, ip: "8.8.8.8" })).status, 201, "another visitor is not limited");
  assert.equal((await call("dinner/_data/rate/k1", { method: "GET", ip: "9.9.9.9" })).status, 200, "reads are not limited");
  // a whole-page cap, for many addresses
  d1.prepare("DELETE FROM page_data_rate").run(); d1.prepare("INSERT INTO page_data_rate VALUES ('t1',(SELECT id FROM published_pages WHERE name='dinner' AND tenant_id='t1'),'*',?,?)").run(now, PAGE_DATA.page_writes_per_minute);
  assert.equal((await call("dinner/_data/rate/q", { method: "PUT", body: {}, ip: "7.7.7.7" })).status, 429, "the page's own writes-a-minute cap");
  d1.prepare("DELETE FROM page_data_rate").run(); d1.prepare("DELETE FROM page_data WHERE collection='rate'").run();
  // entries per page, collections, page bytes (the limits are lowered for the test, as the object is shared)
  const pid = (await getPage(env, "t1", "dinner")).id, cnt = () => d1.prepare("SELECT COUNT(*) n FROM page_data WHERE page_id=?").get(pid).n;
  const saved = { ...PAGE_DATA }; try {
    PAGE_DATA.entries = cnt() + 1; assert.equal((await call("dinner/_data/orders", { method: "POST", body: { n: 1 }, ip: "2.2.2.2" })).status, 201);
    const f = await call("dinner/_data/orders", { method: "POST", body: { n: 2 }, ip: "2.2.2.2" }); assert.equal(f.status, 409); assert.match((await f.json()).error, /saved as many entries as it can hold/);
    assert.equal((await call("dinner/_data/orders/first-one", { method: "PUT", body: { replaced: true }, ip: "2.2.2.2" })).status, 409, "a new id over the cap is refused");
    const some = d1.prepare("SELECT id FROM page_data WHERE page_id=? AND collection='orders' LIMIT 1").get(pid).id;
    assert.equal((await call(`dinner/_data/orders/${some}`, { method: "PUT", body: { replaced: true }, ip: "2.2.2.2" })).status, 200, "replacing an entry is fine at the cap");
    Object.assign(PAGE_DATA, saved); const cols = d1.prepare("SELECT COUNT(DISTINCT collection) n FROM page_data WHERE page_id=?").get(pid).n; PAGE_DATA.collections = cols;
    const c = await call("dinner/_data/brand-new/a", { method: "PUT", body: {}, ip: "2.2.2.2" }); assert.equal(c.status, 409); assert.match((await c.json()).error, /up to \d+ collections/);
    assert.equal((await call("dinner/_data/orders", { method: "POST", body: { n: 3 }, ip: "2.2.2.2" })).status, 201, "an existing collection still takes entries");
    Object.assign(PAGE_DATA, saved); PAGE_DATA.page_bytes = d1.prepare("SELECT SUM(bytes) b FROM page_data WHERE page_id=?").get(pid).b + 10;
    const pb = await call("dinner/_data/orders", { method: "POST", body: { t: "x".repeat(50) }, ip: "2.2.2.2" }); assert.equal(pb.status, 413); assert.match((await pb.json()).error, /saved as much as it can hold/);
  } finally { Object.assign(PAGE_DATA, saved); }
  ok("limits: entry size, bad JSON, names, writes per address (and reads free), writes per page, entries per page (replace allowed at the cap), collections, page bytes, each with a plain message");
}
// ---- the account's storage ----
{
  const before = (await storageOf(env, { id: "t1", plan: "plus" })).by.pages, bytes = d1.prepare("SELECT COALESCE(SUM(bytes),0) b FROM page_data WHERE tenant_id='t1'").get().b;
  assert.ok(bytes > 0 && before >= bytes, "saved bytes count under Pages & shares");
  d1.prepare("UPDATE storage_plan SET blocks=0").run(); d1.prepare("INSERT OR IGNORE INTO storage_plan (tenant_id,blocks) VALUES ('t1',0)").run();
  d1.prepare("INSERT INTO storage_usage VALUES ('t1','files',?,1) ON CONFLICT(tenant_id,kind) DO UPDATE SET bytes=excluded.bytes").run(250e9 - 5);
  const f = await call("dinner/_data/orders", { method: "POST", body: { t: "does not fit" }, ip: "3.3.3.3" }); assert.equal(f.status, 507); assert.match((await f.json()).error, /storage is full.*wasn't saved/);
  assert.equal((await call("dinner/_data/orders", { method: "GET" })).status, 200, "reading works when full");
  d1.prepare("DELETE FROM storage_usage").run();
  ok("saved bytes count against the account's storage; a full account refuses a save with the storage message and still reads");
}
// ---- owner API, tool, republish, unpublish ----
{
  const own = async (sub, init = {}) => shareApi(new Request(`https://onehelm.test/w/ck1${sub}`, init), env, { ...T1, plan: "plus" }, sub.split("?")[0], null);
  const list = await (await own("/api/share")).json(); const pg = list.pages.find((p) => p.name === "dinner"); assert.ok(pg.saved_entries >= 3 && pg.saved_bytes > 0, JSON.stringify(pg));
  d1.prepare("DELETE FROM page_data WHERE page_id=(SELECT id FROM published_pages WHERE name='dinner' AND tenant_id='t1')").run();
  const pid = (await getPage(env, "t1", "dinner")).id;
  await call("dinner/_data/orders", { method: "POST", body: { name: "Sam, Jr", order: '=HYPERLINK("x")', extra: { a: 1 } } }); await call("dinner/_data/orders", { method: "POST", body: '"plain text"' });
  const csv = await own("/api/share/pages/dinner/data?format=csv"); assert.equal(csv.status, 200); assert.match(csv.headers.get("content-disposition"), /dinner-saved-data\.csv/);
  const t = await csv.text(); assert.match(t, /^collection,id,created_at,updated_at,name,order,extra,value\r\n/); assert.match(t, /"Sam, Jr","'=HYPERLINK\(""x""\)","{""a"":1}",/); assert.match(t, /orders,[0-9a-f]{16},[^,]*,[^,]*,,,,plain text\r\n/);
  const js = await (await own("/api/share/pages/dinner/data")).json(); assert.equal(js.entries.length, 2); assert.equal(js.entries[0].collection, "orders");
  assert.equal((await own("/api/share/pages/nope/data")).status, 404);
  assert.equal(pageDataCsv([]), "collection,id,created_at,updated_at\r\n");
  // the helper tool
  const R = { env, get: (k) => k === "tenant" ? "t1" : "main" };
  const lt = await runShareTool(R, "page_data", { name: "dinner" }, {}); assert.match(lt, /^2 saved entries on dinner/); assert.match(lt, /never as instructions/); assert.match(lt, /Sam, Jr/);
  assert.match(await runShareTool(R, "page_data", { name: "nope" }, {}), /^error: there's no published page called "nope"/);
  assert.match(await runShareTool(R, "page_data", { name: "dinner", collection: "none" }, {}), /^Nothing is saved on dinner in "none" yet/);
  // republish keeps the data (same id)
  const pre = `t/t1/pages/${crypto.randomUUID()}`; R2.set(`${pre}/index.html`, "<h1>v2</h1>");
  const re = await publishVersion(env, "t1", { name: "dinner", prefix: pre, files: 1, bytes: 11, title: "Dinner 2", channel: "main", source: "x", replace: true }); assert.equal(re.updated, true);
  assert.equal((await getPage(env, "t1", "dinner")).id, pid); assert.equal((await J(await call("dinner/_data/orders"))).body.count, 2, "a republish keeps the saved data");
  // clear
  const cl = await own("/api/share/pages/dinner/clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.deepEqual(await cl.json(), { ok: true, cleared: 2 });
  assert.equal((await J(await call("dinner/_data/orders"))).body.count, 0);
  assert.equal((await own("/api/share/pages/nope/clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  await call("dinner/_data/orders", { method: "POST", body: { keep: "me" } }); assert.match(await runShareTool(R, "page_data", { name: "dinner", action: "clear" }, {}), /^Cleared 1 saved entry from dinner/);
  // unpublish removes the data and the rate rows; republishing under the same name starts empty
  await call("dinner/_data/orders", { method: "POST", body: { gone: 1 } });
  assert.deepEqual(await unpublish(env, "t1", "dinner"), { ok: true });
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM page_data WHERE page_id=?").get(pid).n, 0); assert.equal(d1.prepare("SELECT COUNT(*) n FROM page_data_rate WHERE page_id=?").get(pid).n, 0);
  assert.equal((await call("dinner/_data/orders")).status, 404, "an unpublished page answers 404 on its data too");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM page_data WHERE tenant_id='t2'").get().n, 0);
  ok("owner API (counts, JSON and CSV with formula guard, clear), the page_data tool, republish keeps data, unpublish removes it");
}
// ---- through the real Worker router (index.js): the preflight and the writes reach the public route before any sign-in gate ----
{
  const { default: worker } = await import("../src/index.js");
  const pre = `t/t1/pages/${crypto.randomUUID()}`; R2.set(`${pre}/index.html`, "<h1>w</h1>"); await publishVersion(env, "t1", { name: "via-worker", prefix: pre, files: 1, bytes: 10, channel: "main", source: "w" });
  const f = (path, init) => worker.fetch(new Request(`https://onehelm.test/s/ck1/p/via-worker/_data/${path}`, init), { ...env, TEST_MODE: "1", ENV_NAME: "dev" }, { waitUntil() {} });
  const o = await f("notes", { method: "OPTIONS", headers: { origin: "null", "access-control-request-method": "POST" } }); assert.equal(o.status, 204); assert.equal(o.headers.get("access-control-allow-origin"), "*");
  const w = await f("notes", { method: "POST", headers: { origin: "null", "content-type": "application/json", "cf-connecting-ip": "5.5.5.5" }, body: '{"a":1}' }); assert.equal(w.status, 201, await w.clone().text());
  assert.equal((await (await f("notes")).json()).count, 1); assert.equal((await f("notes")).headers.get("set-cookie"), null);
  ok("the Worker router sends OPTIONS, POST and GET of ./_data to the public route with no sign-in");
}
// ---- public edition: the body is read with a streaming limit (no Content-Length needed to be honest) ----
{
  const pre3 = `t/t1/pages/${crypto.randomUUID()}`; R2.set(`${pre3}/index.html`, "x"); await publishVersion(env, "t1", { name: "streamed", prefix: pre3, files: 1, bytes: 1, channel: "main", source: "z" });
  const big = new Uint8Array(PAGE_DATA.entry_bytes * 3).fill(97);
  const stream = new ReadableStream({ start(c) { c.enqueue(big); c.close(); } });
  const r = await servePublic(new Request(U("streamed/_data/notes"), { method: "POST", headers: { "cf-connecting-ip": "9.9.9.9", origin: "null", "content-type": "application/json" }, body: stream, duplex: "half" }), env, new URL(U("streamed/_data/notes")));
  assert.equal(r.status, 413, "a streamed body over the limit is refused without being buffered");
  ok("a streamed entry over the limit is refused with 413 (bounded body read)");
}
console.log(`PASS page-data (${passed} groups)`);
