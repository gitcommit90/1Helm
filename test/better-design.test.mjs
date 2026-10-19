// node --import ./test/stubs/register.mjs test/better-design.test.mjs
// Better Design as a design source follows the account (src/better-design.js): on for Unrestricted unless the person turned it off, off for No Training
// and ZDR unless the person turned it on (Settings -> Advanced, tenant_flags k='better_design'). Checks, none of which depends on a model:
//   1 the effective value for every privacy level, with and without an explicit choice (and unknown levels fail closed)
//   2 the settings route round-trips (GET /api/account, POST /api/account/prefs) and rejects anything but a boolean
//   3 the design brief call carries skip: ["better-design"] when off and is byte-for-byte the old call when on; the Worker skips Better Design on skip
//   4 design_mcp.py: off, better-design calls print one plain line and exit 0 with no request, and brief sends skip; on, nothing changes
//   5 the Resident: a command that names design_mcp.py carries DESIGN_MCP_BETTER_DESIGN=off only when off; the brief call follows the account
//   6 the prompt: the static core, the artifacts skill and its references name Better Design only when it is on
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto"; import { readFileSync } from "node:fs";
import http from "node:http"; import { execFile } from "node:child_process";
import { effectiveBetterDesign, betterDesignState, betterDesignOn, betterDesignView, SKIP_SOURCE } from "../src/better-design.js";
import { fetchBrief, briefForWrite } from "../src/design-brief.js";
import { staticCore } from "../src/prompt/index.js";
import { readSkill } from "../src/skills/index.js";
import { DESIGNED_WORK, DESIGNED_WORK_NO_BD } from "../src/helpers.js";
import { Resident } from "../src/resident.js";
import { transactionSyncFor } from "./helpers/transaction-sync.mjs";
const ok = (m) => console.log("  ok", m);
const worker = (await import("../src/index.js")).default;

// ---- D1 on node:sqlite ----
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE magic_links (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, status TEXT, onboarding_completed INTEGER, onboard_step TEXT, slug_chosen INTEGER, helper_name TEXT, first_name TEXT, plan TEXT, stripe_customer_id TEXT, created_at INTEGER);
  CREATE TABLE logins (tenant_id TEXT NOT NULL, site TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', sealed TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, site, username));
  INSERT INTO users VALUES ('u1','sam@corp.test',0);
  INSERT INTO tenants VALUES ('t1','ck1','u1','active',1,'',1,'Ollie','Sam','starter','cus_1',0);`);
for (const f of ["0021_030_account", "0046_age_ack", "0033_041_show_costs", "0038_046_ai_privacy", "0049_shortcuts", "0013_023_tenant_flags"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
d1.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at,ua,place) VALUES (?,?,?,?,?,?)").run(sha("aa11"), "u1", Date.now() + 864e5, Date.now(), "Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0 Safari/537.36", "Denver, CO, US");
const stmt = (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }), _run: () => st.run(...a) }; return o; };
const DB = { prepare: stmt, batch: async (list) => { d1.exec("BEGIN"); try { for (const s of list) s._run(); d1.exec("COMMIT"); } catch (e) { d1.exec("ROLLBACK"); throw e; } return []; } };
const env = { DB, TEST_MODE: "0", GATEWAY_HOST: "selfhost.example", APP_HOST: "selfhost.example", VAULT_KEY: Buffer.alloc(32, 7).toString("base64"), EMAIL: { send: async () => {} }, LEDGER: { idFromName: (x) => x, get: () => ({}) } };
const setLevel = (lv) => d1.prepare("UPDATE tenants SET ai_privacy=? WHERE id='t1'").run(lv ?? "");
const clearChoice = () => d1.exec("DELETE FROM tenant_flags WHERE tenant_id='t1' AND k='better_design'");

// 1. Effective value.
{
  const want = { unrestricted: [true, true, false], no_training: [false, true, false], zdr: [false, true, false], "": [false, true, false], bogus: [false, true, false] };
  for (const [lv, [none, on, off]] of Object.entries(want)) {
    assert.equal(effectiveBetterDesign(lv, null), none, `${lv || "unset"}, no choice`);
    assert.equal(effectiveBetterDesign(lv, "on"), on, `${lv || "unset"}, chose on`);
    assert.equal(effectiveBetterDesign(lv, "off"), off, `${lv || "unset"}, chose off`);
  }
  assert.equal(effectiveBetterDesign(undefined, undefined), false); assert.equal(effectiveBetterDesign("unrestricted", "maybe"), true, "an unknown stored choice counts as no choice");
  // From D1, through the same read the Resident uses.
  for (const [lv, choice, expected] of [["unrestricted", null, true], ["unrestricted", "off", false], ["no_training", null, false], ["no_training", "on", true], ["zdr", null, false], ["zdr", "on", true], [null, null, false]]) {
    setLevel(lv); clearChoice(); if (choice) d1.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES ('t1','better_design',?,1)").run(choice);
    const s = await betterDesignState(env, "t1");
    assert.equal(s.on, expected, `D1: ${lv} / ${choice}`); assert.equal(await betterDesignOn(env, "t1"), expected);
  }
  assert.equal((await betterDesignState(env, "nobody")).on, false, "an unknown tenant is off"); assert.equal(await betterDesignOn({}, "t1"), false, "no DB is off");
  assert.equal(await betterDesignOn({ DB: { prepare() { throw new Error("down"); } } }, "t1"), false, "a failed read is off");
  assert.deepEqual(betterDesignView({ ai_privacy: "unrestricted" }, null), { choice: null, on: true }); assert.deepEqual(betterDesignView({ ai_privacy: "zdr" }, "on"), { choice: "on", on: true });
  ok("effective value: choice wins, else on only for Unrestricted; unknown, unreadable and missing fail closed");
}

// 2. The settings route.
{
  const H = "https://selfhost.example";
  const call = (path, b) => worker.fetch(new Request(`${H}${path}`, { method: b !== undefined ? "POST" : "GET", redirect: "manual", headers: { cookie: "hc_session=aa11", origin: H, "content-type": "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0 Safari/537.36" }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) }), env, { waitUntil() {} });
  const api = async (path, b) => { const r = await call(`/w/ck1/api/${path}`, b); return { status: r.status, ...(await r.json()) }; };
  setLevel("zdr"); clearChoice();
  let r = await api("account"); assert.equal(r.status, 200); assert.deepEqual(r.better_design, { choice: null, on: false }, "ZDR, never chosen: off");
  r = await api("account/prefs", { better_design: true }); assert.equal(r.status, 200); assert.deepEqual(r.better_design, { choice: "on", on: true });
  assert.deepEqual((await api("account")).better_design, { choice: "on", on: true }, "GET reads it back");
  assert.equal(d1.prepare("SELECT v FROM tenant_flags WHERE tenant_id='t1' AND k='better_design'").get().v, "on");
  r = await api("account/prefs", { better_design: false }); assert.deepEqual(r.better_design, { choice: "off", on: false });
  setLevel("unrestricted"); clearChoice();
  assert.deepEqual((await api("account")).better_design, { choice: null, on: true }, "Unrestricted, never chosen: on");
  r = await api("account/prefs", { better_design: false }); assert.deepEqual(r.better_design, { choice: "off", on: false }, "Unrestricted can turn it off");
  setLevel("zdr"); assert.deepEqual((await api("account")).better_design, { choice: "off", on: false });
  for (const bad of ["yes", 1, null, "true", {}]) { r = await api("account/prefs", { better_design: bad }); assert.equal(r.status, 400, `refuses ${JSON.stringify(bad)}`); }
  assert.equal(d1.prepare("SELECT v FROM tenant_flags WHERE tenant_id='t1' AND k='better_design'").get().v, "off", "a refused value changes nothing");
  assert.equal((await call("/w/ck1/api/account/prefs", undefined)).status, 405);
  ok("settings route: GET shows { choice, on }, POST saves a boolean, other values 400, Unrestricted and ZDR defaults differ");
}

// 3. The brief call and the Worker.
{
  const calls = [];
  const fetchFn = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "BRIEF" }] } })); };
  assert.equal(await fetchBrief("a bakery", { url: "https://design.example/brief/mcp", fetchFn }), "BRIEF");
  assert.deepEqual(calls[0].params.arguments, { description: "a bakery" }, "on (the default): exactly the call Live makes today");
  await fetchBrief("a bakery", { url: "https://design.example/brief/mcp", fetchFn, betterDesign: true }); assert.deepEqual(calls[1].params.arguments, { description: "a bakery" });
  await fetchBrief("a bakery", { url: "https://design.example/brief/mcp", fetchFn, betterDesign: false }); assert.deepEqual(calls[2].params.arguments, { description: "a bakery", skip: [SKIP_SOURCE] });
  assert.equal(SKIP_SOURCE, "better-design");
  // Through briefForWrite: the account decides.
  const run = async (on) => {
    const sql = new DatabaseSync(":memory:"); const seen = [];
    const res = { sql: { exec: (q, ...a) => { const st = sql.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } }, betterDesignOn: async () => on };
    const out = await briefForWrite(res, "write_file", { path: "/w/a.html" }, { code: 0, out: "x" }, { session: "s" + on, userText: "a bakery site" }, { url: "https://design.example/brief/mcp", fetchFn: async (u, init) => { seen.push(JSON.parse(init.body).params.arguments); return fetchFn(u, init); } });
    return { out, seen };
  };
  let g = await run(true); assert.ok(g.out.includes("BRIEF")); assert.deepEqual(g.seen[0], { description: "a bakery site" });
  g = await run(false); assert.ok(g.out.includes("BRIEF")); assert.deepEqual(g.seen[0], { description: "a bakery site", skip: ["better-design"] });
  const broken = { sql: { exec: () => ({ toArray: () => [] }) }, betterDesignOn: async () => { throw new Error("x"); } }; const seen2 = [];
  await briefForWrite(broken, "write_file", { path: "/w/a.html" }, { code: 0, out: "x" }, { session: "s3", userText: "a site" }, { url: "https://design.example/brief/mcp", fetchFn: async (u, init) => { seen2.push(JSON.parse(init.body).params.arguments); return fetchFn(u, init); } });
  assert.deepEqual(seen2[0].skip, ["better-design"], "an unreadable switch means off");
  // The Worker.
  const { designBrief } = await import("../design-mcp/src/brief.js"); const urls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response("{}", { status: 404 }); };
  try {
    await designBrief({ description: "a bakery site", skip: ["better-design"] }, { BETTER_DESIGN_KEY: "k" }).catch(() => {});
    assert.ok(!urls.some((u) => u.includes("better-design.com")), "skip: Better Design is never called");
    urls.length = 0; await designBrief({ description: "a bakery site" }, { BETTER_DESIGN_KEY: "k" }).catch(() => {});
    assert.ok(urls.some((u) => u.includes("better-design.com")), "no skip: Better Design is called as before");
    urls.length = 0; await designBrief({ description: "a bakery site", skip: ["something-else"] }, { BETTER_DESIGN_KEY: "k" }).catch(() => {});
    assert.ok(urls.some((u) => u.includes("better-design.com")), "an unknown name skips nothing");
  } finally { globalThis.fetch = realFetch; }
  const { briefTools } = await import("../design-mcp/src/brief.js");
  assert.deepEqual(briefTools[0].inputSchema.required, ["description"], "skip is optional"); assert.ok(briefTools[0].inputSchema.properties.skip);
  ok("brief call: skip only when off, old call when on, unreadable is off; the Worker honors skip and stays backward compatible");
}

// 4. The script.
{
  const reqs = [];
  const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); const b = Buffer.concat(chunks).toString(); reqs.push({ url: req.url, body: b });
    const m = b ? JSON.parse(b) : {}; res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: m.method === "tools/call" ? { content: [{ type: "text", text: "DESIGN BRIEF" }] } : m.method === "tools/list" ? { tools: [] } : {} })); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, script = new URL("../src/skills/artifacts/scripts/design_mcp.py", import.meta.url).pathname;
  const py = (off, ...args) => new Promise((resolve) => execFile("python3", ["-I", script, ...args], { env: { ...process.env, DESIGN_MCP_URL: base, ...(off ? { DESIGN_MCP_BETTER_DESIGN: "off" } : {}) } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
  try {
    let r = await py(true, "better-design", "find-design-system", '{"query":"bakery"}');
    assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim().split("\n").length, 1, "one plain line"); assert.match(r.stdout, /Better Design is turned off/); assert.equal(r.stderr, ""); assert.equal(reqs.length, 0, "no request was made");
    r = await py(true, "better-design", "tools"); assert.equal(r.code, 0); assert.equal(reqs.length, 0);
    r = await py(true, "magicui", "tools"); assert.equal(r.code, 0); assert.ok(reqs.length > 0, "other servers still work when Better Design is off");
    reqs.length = 0; r = await py(true, "brief", "a bakery");
    assert.equal(r.code, 0, r.stderr); assert.deepEqual(JSON.parse(reqs.find((q) => JSON.parse(q.body).method === "tools/call").body).params.arguments, { description: "a bakery", skip: ["better-design"] });
    reqs.length = 0; r = await py(false, "brief", "a bakery");
    assert.deepEqual(JSON.parse(reqs.find((q) => JSON.parse(q.body).method === "tools/call").body).params.arguments, { description: "a bakery" }, "on: the old call");
    reqs.length = 0; r = await py(false, "better-design", "tools"); assert.equal(r.code, 0); assert.ok(reqs.some((q) => q.url.startsWith("/better-design/")), "on: Better Design is called");
  } finally { server.close(); }
  ok("design_mcp.py: off skips better-design quietly with exit 0 and no request, and brief sends skip; on is unchanged");
}

// 5. The Resident: the command carries the switch.
{
  const dodb = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)|\bRETURNING\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const ctx = { id: { toString: () => "do-bd-test-0000000000000000" }, storage: { sql, transactionSync: transactionSyncFor(dodb), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil() {} };
  const computer = { execs: [], exec: async (cmd) => { computer.execs.push(cmd); return { code: 0, out: "ok" }; }, warm: async () => ({ ok: true }), save: async () => ({}), touch: async () => {}, stop: async () => ({}) };
  const R = new Resident(ctx, { MEMORY: "off", GENUI: "off", WORKMEM: "off", MODEL: "@cf/test/model", DB, DESIGN_MCP_URL: "https://design.example" });
  R.computer = () => computer; R.syncFiles = async () => {}; R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
  const cmd = "python3 /opt/1hc/skills/artifacts/scripts/design_mcp.py better-design tools";
  const last = () => computer.execs.at(-1);
  setLevel("zdr"); clearChoice();
  await R.execComputerTool("run_command", { command: cmd }, { kind: "chat", session: "r1", inTool: 0 });
  assert.ok(last().startsWith("export DESIGN_MCP_BETTER_DESIGN=off; ") && last().endsWith(cmd), "ZDR: the command carries off");
  await R.execComputerTool("run_command", { command: "ls -la" }, { kind: "chat", session: "r1", inTool: 0 }); assert.equal(last(), "ls -la", "other commands are untouched");
  d1.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES ('t1','better_design','on',1)").run();
  await R.execComputerTool("run_command", { command: cmd }, { kind: "chat", session: "r1", inTool: 0 }); assert.equal(last(), cmd, "chose on: the command is as written");
  clearChoice(); setLevel("unrestricted");
  await R.execComputerTool("run_command", { command: cmd }, { kind: "chat", session: "r1", inTool: 0 }); assert.equal(last(), cmd, "Unrestricted, no choice: as written");
  d1.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES ('t1','better_design','off',1)").run();
  await R.execComputerTool("run_command", { command: cmd }, { kind: "chat", session: "r1", inTool: 0 }); assert.ok(last().startsWith("export DESIGN_MCP_BETTER_DESIGN=off; "), "Unrestricted who turned it off");
  assert.equal(R.promptFlags(true).better_design, false, "the prompt flag follows the last read (off)");
  clearChoice(); await R.betterDesignOn(); assert.equal(R.promptFlags(true).better_design, true, "and turns on for Unrestricted");
  // The brief through the real write path.
  const seen = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { seen.push(JSON.parse(init.body).params.arguments); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "BRIEF" }] } })); };
  try {
    setLevel("zdr"); clearChoice();
    await R.execComputerTool("write_file", { path: "/w/p.html", content: "<html></html>" }, { kind: "chat", session: "w1", userText: "a bakery site", inTool: 0, callNo: 1 });
    assert.deepEqual(seen.at(-1), { description: "a bakery site", skip: ["better-design"] }, "a ZDR account's brief skips Better Design");
    setLevel("unrestricted");
    await R.execComputerTool("write_file", { path: "/w/p.html", content: "<html></html>" }, { kind: "chat", session: "w2", userText: "a bakery site", inTool: 0, callNo: 1 });
    assert.deepEqual(seen.at(-1), { description: "a bakery site" }, "an Unrestricted account's brief is the old call");
  } finally { globalThis.fetch = realFetch; }
  ok("Resident: design_mcp commands carry off only when off; the brief follows the account; the prompt flag follows the same read");
}

// 6. The prompt.
{
  const base = { apps: true, compact: true, recall: true, cards: true };
  for (const extra of [{}, { append: true, lean_families: true }, { context_v2: true }, { context_v2: true, append: true, lean_families: true }]) {
    const on = staticCore({ ...base, ...extra, better_design: true }), off = staticCore({ ...base, ...extra, better_design: false });
    assert.ok(on.includes(DESIGNED_WORK) && on.includes("Inspo, Better Design, Magic UI, React Bits and Canvas UI are also reached"), "on: names Better Design");
    assert.ok(off.includes(DESIGNED_WORK_NO_BD) && !off.includes(DESIGNED_WORK), "off: the line without Better Design"); assert.ok(!/Better Design|better-design/i.test(off), "off: the whole core never says Better Design");
    assert.ok(off.includes("Inspo, Magic UI, React Bits and Canvas UI are also reached"));
  }
  const refs = ["web-page", "presentation", "pdf-design"];
  for (const flags of [{}, { better_design: false, apps: true }]) {
    const texts = [readSkill({ slug: "artifacts" }, flags), ...refs.map((ref) => readSkill({ slug: "artifacts", ref }, flags))].join("\n");
    assert.ok(!/Better Design|better-design|find-design-system|get-review-rules/i.test(texts), "off: the artifacts skill and references never send the model to Better Design");
    assert.match(texts, /design_mcp\.py brief/); assert.match(texts, /Inspo/); assert.match(texts, /Magic UI/); assert.match(texts, /four sources/);
  }
  const onTexts = [readSkill({ slug: "artifacts" }, { better_design: true }), ...refs.map((ref) => readSkill({ slug: "artifacts", ref }, { better_design: true }))].join("\n");
  for (const w of ["Better Design", "better-design", "find-design-system", "get-review-rules", "five sources"]) assert.ok(onTexts.includes(w), `on: ${w}`);
  ok("prompt: static core, the helper line, the artifacts skill and references name Better Design only when it is on");
}
console.log("better-design.test.mjs: all ok");
