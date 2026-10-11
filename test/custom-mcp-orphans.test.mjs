// Custom MCP: no unexplained upstream toolkits. Every upstream registration has its D1 row first (insert, then upsert); concurrent / retried /
// raced requests never register twice or leave one behind; and a sweeper deletes only leftovers that match our generated slug shape, have no
// row, and are older than the safety window. node --import ./test/stubs/register.mjs test/custom-mcp-orphans.test.mjs   (MOCKED Composio)
import assert from "node:assert/strict";
import { makeHarness, SERVER, say } from "./custom-mcp-harness.mjs";
import { sweepOrphans, SWEEP, slugPrefix } from "../src/ee/custom-mcp.js";

const H = makeHarness(), { C, api, env, d1, rows, REQ } = H;
const URL1 = "https://mcp.acme-demo.dev/mcp"; C.servers[URL1] = SERVER("none");
await H.enable(1);
let n = 0; const ok = (m) => { n++; say(`ok ${n} - ${m}`); };
const body = (rid) => ({ client_request_id: rid, name: "Race", url: URL1, auth: { type: "none" } });
const upstream = () => [...C.toolkits.keys()];

// 1. the row exists before the upsert is sent
{ const seenRows = []; C.onUpsert = async (b) => { seenRows.push(!!d1.prepare("SELECT 1 FROM custom_mcp_server WHERE slug=?").get(`CUSTOM_${b.slug}`)); };
  const r = await api(1, "POST", "/servers", body(REQ())); assert.equal(r.status, 200); assert.deepEqual(seenRows, [true], "insert first, then upsert"); C.onUpsert = null;
  await api(1, "DELETE", `/servers/${r.json.server.id}`);
  ok("every upstream registration finds its D1 row already saved"); }

// 2. concurrent requests with one client_request_id: one row, one toolkit
{ const rid = REQ(); let gate; const hold = new Promise((r) => (gate = r)); C.onUpsert = async () => { await hold; };
  const a = api(1, "POST", "/servers", body(rid)); await new Promise((r) => setTimeout(r, 30)); const b = api(1, "POST", "/servers", body(rid)); await new Promise((r) => setTimeout(r, 30)); gate(); C.onUpsert = null;
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 200); assert.equal(rb.status, 200); assert.equal(ra.json.server.id, rb.json.server.id);
  assert.equal(rows().filter((x) => x.request_id === rid).length, 1); assert.equal(upstream().length, 1, "one toolkit upstream");
  assert.equal(C.reqs.filter((q) => q.p === "/custom/toolkits/upsert").length, 2, "(only the first test's and this one: the loser never upserts)");
  await api(1, "DELETE", `/servers/${ra.json.server.id}`); assert.equal(upstream().length, 0);
  ok("two simultaneous creates with the same client_request_id: one row, one registration"); }

// 3. Remove racing an in-flight registration: the toolkit still ends up deleted, and the row never becomes usable again
{ const rid = REQ(); let gate, started; const hold = new Promise((r) => (gate = r)), up = new Promise((r) => (started = r)); C.onUpsert = async () => { started(); await hold; };
  const create = api(1, "POST", "/servers", body(rid)); await up;
  const id = rows().find((x) => x.request_id === rid).id, rm = await api(1, "DELETE", `/servers/${id}`);
  assert.equal(rm.json.server?.status, "removing", "Remove can't touch a row a setup step holds; it stays 'removing'"); assert.equal(upstream().length, 0);
  gate(); C.onUpsert = null; const cr = await create; assert.equal(cr.json.server?.status, "removing", "the in-flight setup stopped at removing, not 'syncing'/'connected'");
  assert.equal(upstream().length, 1, "the registration did land upstream, but it has its row and is marked removing");
  assert.equal(rows().find((x) => x.id === id).status, "removing");
  d1.prepare("UPDATE custom_mcp_server SET cleanup_at=0, lock_until=0 WHERE id=?").run(id); await api(1, "GET", "");
  assert.equal(upstream().length, 0, "the retry deleted it upstream"); assert.ok(!rows().some((x) => x.id === id));
  ok("Remove racing a registration in flight: no usable resurrection, no orphan (the retry deletes it)"); }

// 4. a lost response (upstream created, answer 503): row kept, same request id resumes without a second toolkit
{ const rid = REQ(), orig = C.onUpsert; C.failures.push({ re: "POST /custom/toolkits/upsert", status: 503, times: 5, onHit: (b) => { const tk = { slug: `CUSTOM_${b.slug}`, url: b.toolkit_config.app_url, scheme: b.toolkit_config.auth_schemes, tools: [], syncs: 0, createdAt: new Date().toISOString() }; C.toolkits.set(tk.slug, tk); } });   // it did register before the 503
  const r = await api(1, "POST", "/servers", body(rid)); C.onUpsert = orig; C.failures.length = 0;
  assert.equal(r.json.server.status, "failed"); assert.equal(upstream().length, 1); const slug = rows().find((x) => x.request_id === rid).slug; assert.ok(C.toolkits.has(slug));
  const again = await api(1, "POST", "/servers", body(rid)); assert.ok(["syncing", "connected"].includes(again.json.server.status)); assert.equal(upstream().length, 1, "resume: same slug, no second toolkit");
  assert.equal(rows().filter((x) => x.request_id === rid).length, 1);
  await api(1, "DELETE", `/servers/${again.json.server.id}`); assert.equal(upstream().length, 0);
  ok("timeout/lost response then retry: the same registration is resumed, never duplicated"); }

// 5. the sweeper
{ const old = new Date(Date.now() - 3 * 3600e3).toISOString(), fresh = new Date().toISOString(), tk = (slug, createdAt) => C.toolkits.set(slug, { slug, url: URL1, scheme: [{ mode: "NO_AUTH" }], tools: [], syncs: 0, createdAt });
  const live = await api(1, "POST", "/servers", body(REQ())), liveSlug = rows().find((x) => x.id === live.json.server.id).slug;
  tk("CUSTOM_HC_ORPHANAAAAAAAAAA", fresh); tk("CUSTOM_HC_ORPHANBBBBBBBBBB".replace("B", "2"), old); tk("CUSTOM_SOMEONE_ELSES_TOOLKIT", old); tk("CUSTOM_HC_SHORT", old); tk("CUSTOM_HC_lowercase0000000", old); tk("CUSTOM_HC_ABCDEFGHIJKLMNO8", old);
  const O_FRESH = "CUSTOM_HC_ORPHANAAAAAAAAAA", O_OLD = "CUSTOM_HC_ORPHAN2BBBBBBBBB";
  assert.match(O_FRESH, /^CUSTOM_HC_[A-Z2-7]{16}$/); assert.match(O_OLD, /^CUSTOM_HC_[A-Z2-7]{16}$/);
  const del0 = () => C.reqs.filter((q) => q.m === "DELETE" && q.p.startsWith("/custom/")).map((q) => q.p.split("/").pop());
  const d0 = del0().length;
  let r = await sweepOrphans(env, { force: true });
  assert.deepEqual(r.deleted, [O_OLD], "only a matching, row-less orphan that Composio says is old"); assert.ok(C.toolkits.has(O_FRESH), "a fresh one is only recorded (safety window)");
  for (const keep of [liveSlug, "CUSTOM_SOMEONE_ELSES_TOOLKIT", "CUSTOM_HC_SHORT", "CUSTOM_HC_lowercase0000000", "CUSTOM_HC_ABCDEFGHIJKLMNO8"]) assert.ok(C.toolkits.has(keep), `${keep} untouched`);
  assert.deepEqual(del0().slice(d0), [O_OLD], "the only DELETE sent");
  // the fresh one once seen long enough ago
  d1.prepare("UPDATE tenant_flags SET v=? WHERE tenant_id='_custom_mcp' AND k=?").run(String(Date.now() - SWEEP.windowMs - 1000), `seen:${O_FRESH}`);
  C.toolkits.get(O_FRESH).createdAt = fresh;
  r = await sweepOrphans(env, { force: true }); assert.deepEqual(r.deleted, [O_FRESH]);
  // never the one that has a row, even if its seen record is ancient
  d1.prepare("INSERT INTO tenant_flags VALUES ('_custom_mcp',?,?,0)").run(`seen:${liveSlug}`, String(Date.now() - 9e9)); C.toolkits.get(liveSlug).createdAt = old;
  r = await sweepOrphans(env, { force: true }); assert.deepEqual(r.deleted, []); assert.ok(C.toolkits.has(liveSlug)); assert.equal(d1.prepare("SELECT COUNT(*) n FROM tenant_flags WHERE k=?").get(`seen:${liveSlug}`).n, 0, "stale seen record dropped");
  // rate: at most 5 per run; throttled without force; off switch; needs the admin key
  for (let i = 0; i < 8; i++) tk(`CUSTOM_HC_BULK${"ABCDEFGH"[i]}AAAAAAAAAAA`, old);
  r = await sweepOrphans(env, { force: true }); assert.equal(r.deleted.length, SWEEP.max, "at most 5 per run");
  const c0 = C.reqs.length; assert.deepEqual((await sweepOrphans(env)).deleted, []); assert.equal(C.reqs.length, c0, "not again within 10 minutes");
  env.CUSTOM_MCP_SWEEP = "off"; assert.deepEqual((await sweepOrphans(env, { force: true })).deleted, []); delete env.CUSTOM_MCP_SWEEP;
  const k = env.COMPOSIO_CUSTOM_KEY; delete env.COMPOSIO_CUSTOM_KEY; assert.deepEqual((await sweepOrphans(env, { force: true })).deleted, []); env.COMPOSIO_CUSTOM_KEY = k;
  assert.ok(C.reqs.filter((q) => q.m === "DELETE" && q.p.startsWith("/custom/")).every((q) => /^\/custom\/toolkits\/CUSTOM_HC_[A-Z2-7]{16}$/.test(q.p) || q.p.includes("/CUSTOM_HC_A")), "only slugs of our own shape were ever deleted");
  ok("sweeper: deletes only CUSTOM_HC_<16> orphans with no row past the safety window (max 5/run, throttled, switchable); everything else untouched"); }

// 6. environment slug prefix: dev (HC) and Live (HP) share one Composio project; each sweeper touches only its own prefix
{ const old = new Date(Date.now() - 3 * 3600e3).toISOString(), tk = (slug) => C.toolkits.set(slug, { slug, url: URL1, scheme: [{ mode: "NO_AUTH" }], tools: [], syncs: 0, createdAt: old });
  for (const k of [...C.toolkits.keys()]) if (/^CUSTOM_HC_BULK/.test(k)) C.toolkits.delete(k);   // leftovers of test 5
  const HCO = "CUSTOM_HC_ENVPREFIX2222222", HPO = "CUSTOM_HP_ENVPREFIX2222222";
  const gone = () => !C.toolkits.has(HCO) && !C.toolkits.has(HPO);
  const sweepAs = async (prefix) => { const e = { ...env }; if (prefix) e.CUSTOM_MCP_SLUG_PREFIX = prefix; else delete e.CUSTOM_MCP_SLUG_PREFIX; return sweepOrphans(e, { force: true }); };
  // an HP environment generates HP slugs; unset defaults to HC
  assert.equal(slugPrefix({}), "HC"); assert.equal(slugPrefix({ CUSTOM_MCP_SLUG_PREFIX: "HP" }), "HP"); assert.equal(slugPrefix({ CUSTOM_MCP_SLUG_PREFIX: "bogus" }), "HC");
  const envHP = { ...env, CUSTOM_MCP_SLUG_PREFIX: "HP" }, saved = env.CUSTOM_MCP_SLUG_PREFIX;
  env.CUSTOM_MCP_SLUG_PREFIX = "HP"; const mk = await api(1, "POST", "/servers", body(REQ())); delete env.CUSTOM_MCP_SLUG_PREFIX;
  assert.equal(mk.status, 200); const hpSlug = rows().find((x) => x.id === mk.json.server.id).slug; assert.match(hpSlug, /^CUSTOM_HP_[A-Z2-7]{16}$/, "HP environment generates HP slugs");
  // and its own row routes/validates (a row can be removed again)
  await api(1, "DELETE", `/servers/${mk.json.server.id}`); assert.equal(upstream().filter((x) => x === hpSlug).length, 0, "HP row cleaned up");
  tk(HCO); tk(HPO);
  let r = await sweepAs("HC"); assert.deepEqual(r.deleted, [HCO], "HC sweeper sweeps its own orphan"); assert.ok(C.toolkits.has(HPO), "HC sweeper ignores HP orphans");
  tk(HCO); r = await sweepAs("HP"); assert.deepEqual(r.deleted, [HPO], "HP sweeper sweeps its own orphan"); assert.ok(C.toolkits.has(HCO), "HP sweeper ignores HC orphans");
  C.toolkits.delete(HCO); assert.ok(gone());
  // an existing HC row still works with the var unset
  const pre = await api(1, "POST", "/servers", body(REQ())); const hcSlug = rows().find((x) => x.id === pre.json.server.id).slug; assert.match(hcSlug, /^CUSTOM_HC_/, "unset var defaults to HC");
  tk(HPO); r = await sweepAs(undefined); assert.deepEqual(r.deleted, [HPO].filter(() => false), "default (HC) leaves HP alone"); assert.ok(C.toolkits.has(hcSlug), "its own registered row's toolkit survives");
  await api(1, "DELETE", `/servers/${pre.json.server.id}`); C.toolkits.delete(HPO); if (saved) env.CUSTOM_MCP_SLUG_PREFIX = saved;
  ok("env slug prefix: HP generates HP slugs; HC and HP sweepers each sweep only their own orphans; unset defaults to HC and an HC row keeps working"); }
say(`custom-mcp-orphans: ${n} ok`);
