// node --import ./test/stubs/register.mjs test/quick-script.test.mjs
// quick_script (src/quick-script.js) with fakes for the Worker Loader and the Library: no network, no model, no Cloudflare.
// Checks: the outbound gate (public hosts pass; private, internal and 1Helm hosts, bad ports and redirects to them are refused; big bodies cut),
// the Library binding (read by name or id, write through the save path with its storage refusal, per-run caps, a closed run is refused),
// the real wrapper module run in node (return, console, errors, the time limit), the tool (result, output cap, CPU and wall errors, rate limit,
// billing amounts and the usage kind), the permission kind (same as run_command) and that helpers get the tool.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanupOnExit } from "./stubs/cleanup.mjs";
import "../src/resident.js";   // loads the module graph in the order the Worker does
import * as Q from "../src/quick-script.js";
import { kindFor, asks, GATED_TOOLS } from "../src/perms.js";
import { helperAllowed } from "../src/helpers.js";
import { EAGER_TOOLS } from "../src/context.js";
import { toolClass } from "../src/resume.js";
import { fallbackStepTitle } from "../src/tracker.js";

// ---- the outbound gate ----
const env = { APP_HOST: "onehelm.example.com", GATEWAY_HOST: "gw.1helm.com" };
for (const u of ["https://api.github.com/repos/x/y", "http://example.org/a?b=1", "https://example.org:8443/x", "https://93.184.216.34/"]) assert.ok(Q.egressCheck(u, env).ok, u);
for (const u of ["http://localhost/", "https://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/x", "http://169.254.169.254/latest", "http://computer.internal/", "https://sentinel.internal/x",
  "https://vault.internal/", "https://onehelm.example.com/api", "https://app.1helm.com/", "https://x.y.1helm.com/", "https://gw.1helm.com/", "http://intranet/", "https://[::1]/", "https://user:pw@example.org/", "ftp://example.org/", "https://example.org:6379/", "not a url"])
  assert.ok(Q.egressCheck(u, env).error, u);

// the gateway: redirects are checked again at each hop, and a big body is refused
const realFetch = globalThis.fetch; const seen = [];
const bodyOf = (n) => new Response(new Uint8Array(n));
globalThis.fetch = async (u, o) => { seen.push(String(u)); if (String(u).includes("/redir-private")) return new Response("", { status: 302, headers: { location: "http://10.1.1.1/x" } });
  if (String(u).includes("/redir-ok")) return new Response("", { status: 301, headers: { location: "/final" } }); if (String(u).includes("/big")) return bodyOf(Q.QS_FETCH_MAX + 1); return new Response("hello " + (o?.method || "GET"), { status: 200, headers: { "content-type": "text/plain" } }); };
const gw = new Q.QuickScriptHttp({ props: {} }, env); gw.env = env;
try {
  const ok = await gw.fetch(new Request("https://example.org/a")); assert.equal(ok.status, 200); assert.equal(await ok.text(), "hello GET");
  assert.equal((await gw.fetch(new Request("http://10.0.0.1/"))).status, 403);
  assert.equal((await gw.fetch(new Request("https://example.org/redir-private"))).status, 403, "a redirect to a private host is refused");
  assert.equal(seen.filter((u) => u.startsWith("http://10.")).length, 0, "the private host was never fetched");
  const r2 = await gw.fetch(new Request("https://example.org/redir-ok")); assert.equal(r2.status, 200); assert.ok(seen.includes("https://example.org/final"));
  assert.equal((await gw.fetch(new Request("https://example.org/big"))).status, 502, "a body over the cap is refused");
  // no header is added: only what the script sent goes out (the fake sees the headers)
} finally { globalThis.fetch = realFetch; }

// ---- the Library binding (the Resident's side) ----
const lib = new Map([["f1", { id: "f1", name: "data.csv", mime: "text/csv", bytes: 5, r2key: "k1" }], ["f2", { id: "f2", name: "big.bin", mime: "application/octet-stream", bytes: Q.QS_LIB_BYTES + 1, r2key: "k2" }]]);
const saved = [];
const fakeFiles = { list: () => [...lib.values()], find: (r) => [...lib.values()].find((f) => f.id === r || f.name.toLowerCase() === String(r).toLowerCase()) || null,
  bytes: async (f) => (f.r2key === "k1" ? new TextEncoder().encode("a,b\n1") : null), mimeOf: (n) => (n.endsWith(".txt") ? "text/plain" : "application/octet-stream"),
  save: async (f) => { if (f.name === "full.txt") return { error: "error: storage is full (1 GB of 1 GB used), so this wasn't saved." }; saved.push(f); return { file: { id: "n" + saved.length, name: f.name, mime: f.mime } }; } };
const R = { _qsRuns: new Map([["run1", { ctx: {}, wrote: 0, bytesWritten: 0, bytesRead: 0 }]]), _qsDeps: { files: fakeFiles } };
assert.equal((await Q.quickLibOp(R, "run1", "list", {})).length, 2);
const rd = await Q.quickLibOp(R, "run1", "read", { ref: "DATA.csv" }); assert.equal(rd.name, "data.csv"); assert.equal(new TextDecoder().decode(rd.bytes), "a,b\n1");
assert.equal((await Q.quickLibOp(R, "run1", "read", { ref: "f1" })).id, "f1", "by id");
await assert.rejects(Q.quickLibOp(R, "run1", "read", { ref: "/workspace/x.txt" }), /Library files only/);
await assert.rejects(Q.quickLibOp(R, "run1", "read", { ref: "f2" }), /at most/);
await assert.rejects(Q.quickLibOp(R, "nope", "list", {}), /has ended/);
const w = await Q.quickLibOp(R, "run1", "write", { name: "out.txt", data: "hi" }); assert.equal(w.bytes, 2); assert.equal(saved[0].mime, "text/plain"); assert.equal(saved[0].bytes.constructor, Uint8Array);
await Q.quickLibOp(R, "run1", "write", { name: "b.bin", data: new Uint8Array(3) }); assert.equal(saved.length, 2);
await assert.rejects(Q.quickLibOp(R, "run1", "write", { name: "full.txt", data: "x" }), /storage is full/);
await assert.rejects(Q.quickLibOp(R, "run1", "write", { name: "", data: "x" }), /needs a file name/);
await assert.rejects(Q.quickLibOp(R, "run1", "write", { name: "z", data: 5 }), /takes a string/);
await assert.rejects(Q.quickLibOp(R, "run1", "write", { name: "huge", data: new Uint8Array(Q.QS_LIB_BYTES + 1) }), /at most/);
for (let i = saved.length; i < Q.QS_LIB_FILES; i++) await Q.quickLibOp(R, "run1", "write", { name: `f${i}`, data: "x" });
await assert.rejects(Q.quickLibOp(R, "run1", "write", { name: "one-more", data: "x" }), /at most 20 files/);
assert.ok(R._qsRuns.get("run1").calls > 20, "each lib call is counted as a request");

// ---- the real wrapper module, run in node ----
const dir = cleanupOnExit(mkdtempSync(join(tmpdir(), "qs-")));
let captured = null;
const loaderFor = (impl) => ({ get: (id, cb) => ({ getEntrypoint: () => ({ fetch: async (req) => { captured = await cb(); captured.id = id; return await impl(captured, req); } }) }) });
async function realRun(code, request, libStub) {   // runs main.js + user.js from the code the tool gave to the loader
  const d = cleanupOnExit(mkdtempSync(join(dir, "r-")));
  for (const [n, src] of Object.entries(code.modules)) writeFileSync(join(d, n), src);
  const m = await import(pathToFileURL(join(d, "main.js")).href + "?" + Math.random());
  return await m.default.fetch(request, { LIB: libStub });
}
function mkRes(over = {}) {
  const kv = new Map(), calls = { reserve: [], settle: [] };
  const res = { env: { LOADER: null, ...over.env }, get: (k) => ({ tenant: "t1", channel: "main" })[k] ?? kv.get(k), put: (k, v) => kv.set(k, v), ctx: { exports: { QuickScriptLib: (o) => ({ lib: o }), QuickScriptHttp: (o) => ({ http: o }) } }, _qsDeps: { files: fakeFiles } };
  const ledger = { reserve: async (id, n) => { calls.reserve.push([id, n]); return over.reject ? { ok: false, reason: over.reject } : { ok: true }; }, settle: async (id, n) => { calls.settle.push([id, n]); } };
  return { res, calls, ledger: () => ledger };
}
const fakeLib = { list: async () => [], read: async () => ({ bytes: new TextEncoder().encode("hey") }), write: async () => ({}) };
const viaWrapper = (lb = fakeLib) => loaderFor((code, req) => realRun(code, req, lb));
const tc = () => ({});

// a script returns text, JSON, logs, and reads the Library
{
  const m = mkRes(); m.res.env.LOADER = viaWrapper(); const t = tc();
  assert.equal(await Q.quickScriptTool(m.res, { script: "return 1 + 2;" }, t, { ledger: m.ledger }), "3");
  assert.equal(await Q.quickScriptTool(m.res, { script: "return {a: [1, 2]};" }, t, { ledger: m.ledger }), '{"a":[1,2]}');
  assert.equal(await Q.quickScriptTool(m.res, { script: "return 'plain';" }, t, { ledger: m.ledger }), "plain");
  assert.equal(await Q.quickScriptTool(m.res, { script: "return await lib.readText('x');" }, t, { ledger: m.ledger }), "hey");
  const lg = await Q.quickScriptTool(m.res, { script: "console.log('a', {b: 1}); return 7;" }, t, { ledger: m.ledger }); assert.equal(lg, '7\n[console]\na {"b":1}');
  const er = await Q.quickScriptTool(m.res, { script: "throw new Error('boom');" }, t, { ledger: m.ledger }); assert.match(er, /^error: the script threw: Error: boom/);
  assert.match(await Q.quickScriptTool(m.res, { script: "return (" }, t, { ledger: m.ledger }), /^error: /, "a syntax error is an error result, not a crash");
  assert.match(await Q.quickScriptTool(m.res, { script: "  " }, t, { ledger: m.ledger }), /script is required/);
  assert.match(await Q.quickScriptTool(m.res, { script: "x".repeat(Q.QS_SCRIPT_MAX + 1) }, t, { ledger: m.ledger }), /the most is/);
  // the code given to the loader: only LIB, a gateway and the limits; no secrets
  assert.deepEqual(Object.keys(captured.env), ["LIB"]); assert.ok(captured.globalOutbound.http); assert.deepEqual(captured.limits, { cpuMs: Q.QS_CPU_MS, subRequests: Q.QS_SUBREQUESTS });
  assert.deepEqual(captured.env.LIB.lib.props, { tenant: "t1", channel: "main" });
  // output cap
  const big = await Q.quickScriptTool(m.res, { script: "return 'x'.repeat(50000);" }, t, { ledger: m.ledger }); assert.ok(big.startsWith("x".repeat(100)) && big.length < Q.QS_OUT_MAX + 200 && /result cut/.test(big));
  // the wrapper's own time limit: a script that waits past the deadline is stopped, fetch after the deadline is refused
  const slow = await realRun({ modules: { "main.js": (await import("node:fs")).readFileSync(new URL("../src/quick-script.js", import.meta.url), "utf8").match(/const WRAPPER = `([\s\S]*?)`;\nexport const userModule/)[1].replace(/\\\\n/g, "\\n"), "user.js": Q.userModule("await new Promise((r) => setTimeout(r, 400)); return 1;") } },
    new Request("https://x.invalid/run", { method: "POST", body: JSON.stringify({ runId: "r", deadline: Date.now() + 80 }) }), fakeLib);
  const sj = await slow.json(); assert.equal(sj.ok, false); assert.match(sj.error, /time limit passed/);
}

// billing: reserve the most one run can cost, settle at the real amount, own usage kind, charged to the turn; the Dynamic Worker creation fee once a day per script
{
  let clock = Date.parse("2026-11-08T10:00:00Z"); const logged = [], oldLog = console.log; console.log = (...x) => { logged.push(x.join(" ")); };
  const m = mkRes(); m.res.env.LOADER = loaderFor(async () => { clock += 1200; return Response.json({ ok: true, out: "ok", logs: "" }); }); const t = tc(), now = () => clock;
  await Q.quickScriptTool(m.res, { script: "return 'ok'" }, t, { ledger: m.ledger, now });
  assert.match(m.calls.reserve[0][0], /^quick-script:[0-9a-f-]{36}$/); assert.equal(m.calls.reserve[0][1], Q.quickScriptMaxNano());
  assert.equal(m.calls.settle[0][1], Math.ceil((300 + 1200 * 20) * 1.15), "request + 1.2 s of CPU, plus 15%; no creation fee");
  assert.equal(t.extraCharge, m.calls.settle[0][1]);
  await Q.quickScriptTool(m.res, { script: "return 'ok'" }, t, { ledger: m.ledger, now });
  assert.equal(m.calls.settle[1][1], m.calls.settle[0][1], "the same script costs the same");
  await Q.quickScriptTool(m.res, { script: "return 'other'" }, t, { ledger: m.ledger, now });
  assert.equal(m.calls.settle[2][1], m.calls.settle[0][1], "a new script is not charged a creation fee either");
  clock += 86400e3; await Q.quickScriptTool(m.res, { script: "return 'ok'" }, t, { ledger: m.ledger, now });
  assert.equal(m.calls.settle[3][1], m.calls.settle[0][1], "nor the next day");
  const lines = logged.filter((l) => l.startsWith("quick_script {")).map((l) => JSON.parse(l.slice(13)));
  assert.deepEqual(lines.slice(-4).map((l) => l.created), [true, false, true, true], "the log counts a creation on the first run of a script each day");
  assert.equal(Q.quickScriptNano({ cpuMs: 99999 }), Math.ceil((300 + Q.QS_CPU_MS * 20) * 1.15), "CPU is capped at the limit");
  console.log = oldLog;
  assert.ok(Q.quickScriptMaxNano() >= m.calls.settle[0][1], "the hold covers any run");
}
// the creation fee: not charged within the month's 1,000 included creations (account-wide), charged from the 1,001st, reset on a new UTC month
{
  const counts = new Map();   // the shared counter: logo_usage k -> n, one atomic increment per creation
  const DB = { prepare: () => ({ bind: (k) => ({ first: async () => { counts.set(k, (counts.get(k) || 0) + 1); return { n: counts.get(k) }; } }) }) };
  let clock = Date.parse("2026-11-30T23:00:00Z"); const now = () => clock, t = tc();
  const m = mkRes(); m.res.env.DB = DB; m.res.env.LOADER = loaderFor(async () => Response.json({ ok: true, out: "ok" }));
  const base = Math.ceil(300 * 1.15), fee = Math.ceil((300 + 2_000_000) * 1.15), logged = [], oldLog = console.log; console.log = (...x) => { logged.push(x.join(" ")); };
  const go = (script) => Q.quickScriptTool(m.res, { script }, t, { ledger: m.ledger, now });
  counts.set("dynworkers:2026-11", 998);                       // two creations left in the allowance
  await go("return 1");  await go("return 2");               // the 999th and the 1,000th creation: no fee
  assert.deepEqual(m.calls.settle.map((x) => x[1]), [base, base], "creations 999 and 1000 are free to the person");
  await go("return 3");                                      // the 1,001st: charged $0.002 + 15%
  assert.equal(m.calls.settle[2][1], fee, "the 1,001st creation is charged the fee plus 15%");
  await go("return 3");                                      // the same script again the same day: not a creation
  assert.equal(m.calls.settle[3][1], base, "a repeat the same day is not a creation");
  assert.equal(counts.get("dynworkers:2026-11"), 1001, "only creations are counted");
  clock = Date.parse("2026-12-01T00:30:00Z");               // a new month starts at 0
  await go("return 3");                                      // a new day: a creation again, number 1 of December
  assert.equal(m.calls.settle[4][1], base, "a new month starts again within the allowance");
  assert.equal(counts.get("dynworkers:2026-12"), 1);
  console.log = oldLog;
  const lines = logged.filter((l) => l.startsWith("quick_script {")).map((l) => JSON.parse(l.slice(13)));
  assert.deepEqual(lines.map((l) => [l.created, l.creation_count, l.creation_charged]), [[true, 999, false], [true, 1000, false], [true, 1001, true], [false, null, false], [true, 1, false]]);
  assert.equal(Q.creationMonth(Date.parse("2026-11-30T23:59:59Z")), "2026-11");
  // a counter that can't be read: no fee, and the log says the count is unknown
  const b = mkRes(); b.res.env.DB = { prepare: () => { throw new Error("no table"); } }; b.res.env.LOADER = m.res.env.LOADER;
  await Q.quickScriptTool(b.res, { script: "return 9" }, tc(), { ledger: b.ledger, now }); assert.equal(b.calls.settle[0][1], base);
}
// no credits: nothing runs; BYOK gets the paused message
{
  const m = mkRes({ reject: "out_of_credits" }); let ran = 0; m.res.env.LOADER = loaderFor(async () => { ran++; return Response.json({ ok: true, out: "" }); });
  assert.match(await Q.quickScriptTool(m.res, { script: "return 1" }, tc(), { ledger: m.ledger }), /out of credits/);
  m.res.env.BYOK = "1"; assert.equal(await Q.quickScriptTool(m.res, { script: "return 1" }, tc(), { ledger: m.ledger, creditsErr: "PAUSED" }), "PAUSED");
  const d = mkRes({ reject: "day_limit" }); d.res.env.LOADER = m.res.env.LOADER; assert.match(await Q.quickScriptTool(d.res, { script: "return 1" }, tc(), { ledger: d.ledger }), /daily safety limit/);
  assert.equal(ran, 0);
}
// CPU limit and wall limit come back as clear errors, and the run is still billed
{
  const m = mkRes(); m.res.env.LOADER = loaderFor(async () => { throw new Error("Worker exceeded CPU time limit."); });
  const r = await Q.quickScriptTool(m.res, { script: "while(true){}" }, tc(), { ledger: m.ledger }); assert.match(r, /^error: the script used more than 5 seconds of CPU time/);
  assert.equal(m.calls.settle[0][1], Math.ceil((300 + Q.QS_CPU_MS * 20) * 1.15));
  const w2 = mkRes(); w2.res.env.LOADER = loaderFor(() => new Promise(() => {}));
  const r2 = await Q.quickScriptTool(w2.res, { script: "await new Promise(()=>{})" }, tc(), { ledger: w2.ledger, wallMs: 30 }); assert.match(r2, /^error: the script ran longer than 30 seconds/);
  assert.equal(w2.calls.settle.length, 1);
  const w3 = mkRes(); w3.res.env.LOADER = loaderFor(async () => Response.json({ ok: false, error: "Error: quick_script: the time limit passed" }));
  assert.match(await Q.quickScriptTool(w3.res, { script: "1" }, tc(), { ledger: w3.ledger }), /longer than 30 seconds/);
  const l = mkRes(); l.res.env.LOADER = null; assert.match(await Q.quickScriptTool(l.res, { script: "1" }, tc(), { ledger: l.ledger }), /isn't available/);
}
// rate limit per channel: parallel runs and runs per minute
{
  const m = mkRes(); let release; const gate = new Promise((r) => { release = r; }); m.res.env.LOADER = loaderFor(async () => { await gate; return Response.json({ ok: true, out: "ok" }); });
  const a = [1, 2, 3].map((i) => Q.quickScriptTool(m.res, { script: `return ${i}` }, tc(), { ledger: m.ledger }));
  assert.match(await Q.quickScriptTool(m.res, { script: "return 4" }, tc(), { ledger: m.ledger }), /3 at a time/);
  release(); await Promise.all(a);
  for (let i = 3; i < Q.QS_RATE.perMin; i++) await Q.quickScriptTool(m.res, { script: `return ${i}` }, tc(), { ledger: m.ledger });
  assert.match(await Q.quickScriptTool(m.res, { script: "return 'x'" }, tc(), { ledger: m.ledger }), /last minute/);
  assert.equal(m.calls.settle.length, Q.QS_RATE.perMin, "a refused run is not billed");
}

// ---- permissions, helpers, step wording ----
assert.equal(kindFor("quick_script", { script: "1" }), kindFor("run_command", { command: "ls" })); assert.equal(kindFor("quick_script", {}), "computer");
assert.ok(GATED_TOOLS.has("quick_script"));
assert.equal(asks("standard", "computer"), false); assert.equal(asks("careful", "computer"), false); assert.equal(asks("locked", "computer"), true, "Locked down asks first, like run_command");
assert.equal(helperAllowed("quick_script"), true, "helpers get the tool");
assert.ok(EAGER_TOOLS.has("quick_script")); assert.equal(toolClass("quick_script"), toolClass("run_command"));
assert.equal(fallbackStepTitle("quick_script", {}), "Ran a short script");
assert.match(Q.QUICK_SCRIPT_TOOL.function.description, /does NOT see the computer's \/workspace files/);
console.log("quick-script ok");
