// node --import ./test/stubs/register.mjs test/byok-usage.test.mjs
// Plan usage bars under each connected AI service (src/byok-usage.js and the places it plugs in), against mocked fetch and a fake engine: no network, no model call.
// Checks: the parsers (ChatGPT, Claude, Claude headers), the cache and throttle (fresh, failed sources remembered, expired windows), each service's source with success and fallback,
// the GET /api/byok/usage route and the cached numbers in the state, the limit messages (ChatGPT, Claude Code, OpenCode Go), and that no token reaches a log or an answer.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { test } from "node:test";
import { byokApi, withChatgpt, withClaudeCode, ByokError } from "../src/byok.js";
import { connDdl } from "../src/ee/byok-connections.js";
import { chatgptChat, chatgptUsage, CG_USAGE_URL } from "../src/ee/byok-chatgpt.js";
import { claudeChat, claudeUsage } from "../src/ee/byok-claudecode.js";
import { ocFail } from "../src/ee/byok-opencode.js";
import { orDdl } from "../src/byok-openrouter.js";
import { sealSecret } from "../src/sentinel.js";
import * as U from "../src/ee/byok-usage.js";

const logs = []; for (const k of ["log", "error", "warn", "info"]) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map((x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ")); o(...a); }; }
const AT = "AT-SECRET-usage-token", NOW = 1_800_000_000_000;
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', plan TEXT, stripe_subscription TEXT DEFAULT '', updated_at INTEGER);
  INSERT INTO tenants (id, slug, helper_name, first_name, plan) VALUES ('t1','ck1','Ollie','Sam','byok');`);
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0038_046_ai_privacy", "0065_custom_models_own_key", "0069_byok_chatgpt", "0068_byok_effort", "0070_byok_connections", "0074_byok_usage"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
let engineUsage = { none: true, why: "asleep" }, engineThrows = false, engineComplete = null; const engineCalls = [];
const engine = { usage: async () => { engineCalls.push("usage"); if (engineThrows) throw new Error("x"); return engineUsage; }, complete: async (a) => { if (engineComplete) throw engineComplete; return { choices: [{ message: { content: "ok" } }] }; }, status: async () => ({ signedIn: true, account: { email: "s@x.example" } }), signOut: async () => {} };
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", ENV_NAME: "test", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 1)).toString("base64"), LEDGER: { idFromName: (n) => n, get: () => ({}) },
  CLAUDE_ENGINE: { idFromName: (n) => n, get: () => engine } };
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const T = () => d1.prepare("SELECT * FROM tenants WHERE id='t1'").get();
const api = async (sub, body) => { const r = await byokApi(new Request(`https://app.example.test/w/ck1${sub}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), env, T(), sub, { json: (o, status = 200) => jres(o, status), fetchImpl: fetchStub, waitUntil: () => {} }); return { status: r.status, d: await r.json() }; };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64u({ alg: "none" })}.${b64u(claims)}.sig`;
const seedChatgpt = async () => {
  const rec = { client_id: "app_x", id_token: jwt({ sub: "u1", "https://api.openai.com/auth": { chatgpt_account_id: "acct-1234" } }), access_token: AT, refresh_token: "RT-SECRET", expires_at: Date.now() + 3600e3, scopes: ["chatgpt.tokens.use.direct"] };
  d1.prepare("INSERT OR REPLACE INTO byok_chatgpt (tenant_id,client_id,subject,email,record_sealed,expires_at,ver,broken,updated_at) VALUES ('t1','app_x','u1','sam@chat.example',?,?,1,0,1)").run(await sealSecret(env, JSON.stringify(rec)), rec.expires_at);
  d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at) VALUES ('t1','chatgpt','chatgpt','ChatGPT','https://api.openai.com/v1','','',1,1)").run();
};
const seedClaude = () => d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at,test_json) VALUES ('t1','claudecode','claudecode','Claude Code','','','',1,1,?)").run(JSON.stringify({ ok: true, account: { email: "s@x.example", plan: "max" }, at: 1 }));
const seedOpencode = async (plan = "go") => d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at,oc_plan) VALUES ('t1','opencode','opencode','OpenCode','https://opencode.ai/inference',?,?,1,1,?)").run(await sealSecret(env, "oc-key-9f3b"), "9f3b", plan);
const wipe = async () => { await orDdl(env); await connDdl(env); d1.exec("DELETE FROM byok; DELETE FROM byok_connections; DELETE FROM byok_chatgpt; DELETE FROM byok_usage;"); U._resetUsageDdl(); engineCalls.length = 0; engineUsage = { none: true, why: "asleep" }; engineThrows = false; engineComplete = null; logs.length = 0; whamCalls.length = 0; wham.mode = "ok"; };
const whamCalls = [], wham = { mode: "ok" };
const WHAM = { plan_type: "plus", rate_limit: { primary_window: { used_percent: 37.5, reset_at: Math.floor((Date.now() + 7200e3) / 1000), limit_window_seconds: 18000 }, secondary_window: { used_percent: 12, reset_at: Math.floor((Date.now() + 5 * 86400e3) / 1000), limit_window_seconds: 604800 } } };
const fetchStub = async (u, init = {}) => {
  if (String(u) === CG_USAGE_URL) { whamCalls.push({ headers: init.headers, redirect: init.redirect }); if (wham.mode === "ok") return jres(WHAM); if (wham.mode === "html") return new Response("<html>", { status: 200 }); return jres({ error: "x" }, Number(wham.mode)); }
  throw new Error(`unexpected fetch ${u}`);
};
globalThis.fetch = fetchStub;

test("parsers: ChatGPT windows, Claude windows, and the unified headers (a fraction and epoch seconds)", () => {
  const c = U.parseCodexUsage({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 250, reset_at: 1_900_000_000, limit_window_seconds: 18000 }, secondary_window: { used_percent: "12.5", reset_at: 1_900_500_000, limit_window_seconds: 604800 } } });
  assert.deepEqual(c.windows, [{ id: "session", label: "5 hours", used: 100, resets_at: 1_900_000_000_000 }, { id: "weekly", label: "This week", used: 12.5, resets_at: 1_900_500_000_000 }]); assert.equal(c.plan, "pro");
  assert.equal(U.parseCodexUsage({ rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 3600 } } }).windows[0].label, "Session", "another window length is just a session");
  assert.deepEqual(U.parseCodexUsage({}).windows, []); assert.deepEqual(U.parseCodexUsage(null).windows, []); assert.deepEqual(U.parseCodexUsage({ rate_limit: { primary_window: { used_percent: "abc" } } }).windows, []);
  const k = U.parseClaudeUsage({ five_hour: { utilization: 41, resets_at: "2030-01-01T05:00:00Z" }, seven_day: { utilization: 9, resets_at: "2030-01-05T00:00:00Z" }, seven_day_sonnet: { utilization: 99, resets_at: null } });
  assert.deepEqual(k.windows.map((w) => [w.id, w.label, w.used, w.resets_at]), [["session", "5 hours", 41, Date.parse("2030-01-01T05:00:00Z")], ["weekly", "This week", 9, Date.parse("2030-01-05T00:00:00Z")]]);
  const h = U.parseClaudeHeaders({ "anthropic-ratelimit-unified-5h-utilization": "0.42", "anthropic-ratelimit-unified-5h-reset": "1900000000", "anthropic-ratelimit-unified-7d-utilization": "1", "anthropic-ratelimit-unified-7d-reset": "1900500000", "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": "1900000000" });
  assert.deepEqual(h.windows.map((w) => [w.id, w.used, w.resets_at]), [["session", 42, 1_900_000_000_000], ["weekly", 100, 1_900_500_000_000]]); assert.equal(h.status, "rejected"); assert.equal(h.reset, 1_900_000_000_000);
  assert.deepEqual(U.parseClaudeHeaders({}).windows, []); assert.deepEqual(U.parseClaudeHeaders(null).windows, []);
  assert.deepEqual([U.resetIn(NOW + 5 * 60e3, NOW), U.resetIn(NOW + 130 * 60e3, NOW), U.resetIn(NOW + 3 * 3600e3, NOW), U.resetIn(NOW + 3 * 86400e3, NOW), U.resetIn(NOW - 1, NOW)], ["in 5 minutes", "in 2 hours 10 minutes", "in 3 hours", "in 3 days", ""]);
});

test("cache and throttle: fresh numbers are not read again, a refused source is remembered, a network error is retried after two minutes, a passed reset shows nothing used", async () => {
  await wipe(); let n = 0, mode = "ok";
  const getter = async () => { n++; if (mode === "ok") return { windows: [{ id: "session", label: "5 hours", used: 40, resets_at: NOW + 3600e3 }, { id: "weekly", label: "This week", used: 10, resets_at: NOW + 86400e3 * 3 }], source: "t" }; throw Object.assign(new Error("x"), { why: mode }); };
  let v = await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW }); assert.equal(n, 1); assert.equal(v.windows.length, 2); assert.equal(v.tried, true); assert.equal(v.manage, "https://chatgpt.com/settings/usage");
  await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 60e3 }); assert.equal(n, 1, "within five minutes: from the cache");
  v = await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 6 * 60e3 }); assert.equal(n, 2, "stale: read again");
  v = await U.viewOf("chatgpt", d1.prepare("SELECT * FROM byok_usage").get(), NOW + 3700e3); assert.deepEqual(v.windows[0], { id: "session", label: "5 hours", used: 0, resets_at: null }); assert.equal(v.windows[1].used, 10);
  v = await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 3700e3 }); assert.equal(n, 3, "a window that reset is read again");
  d1.exec("DELETE FROM byok_usage"); n = 0; mode = "http_401";
  v = await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW }); assert.equal(n, 1); assert.deepEqual(v.windows, []); assert.equal(v.tried, true, "no numbers: the page shows Manage usage");
  for (let i = 1; i <= 5; i++) await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + i * 3600e3 }); assert.equal(n, 1, "a refusal is not retried for six hours");
  await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 6 * 3600e3 + 1 }); assert.equal(n, 2);
  d1.exec("DELETE FROM byok_usage"); n = 0; mode = "network";
  await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW }); await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 60e3 }); assert.equal(n, 1); await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 130e3 }); assert.equal(n, 2, "a network error is retried after two minutes");
  mode = "ok"; await U.refreshUsage(env, "t1", "chatgpt", getter, { now: NOW + 400e3 }); assert.equal((await U.usageView(env, "t1", "chatgpt")).windows.length, 2);
  assert.deepEqual(await U.refreshUsage(env, "t1", "opencode", null, { now: NOW }), { windows: [], at: 0, tried: false, manage: "https://opencode.ai/console", limit: null }, "a service with no source is the link, and no row is written");
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_usage WHERE service='opencode'").get().n, 0);
});

test("a limit note forces the next read and shows until the reset time", async () => {
  await wipe(); let n = 0; const getter = async () => { n++; return { windows: [{ id: "session", label: "5 hours", used: 100, resets_at: NOW + 3600e3 }], source: "t" }; };
  await U.refreshUsage(env, "t1", "claudecode", getter, { now: NOW }); await U.refreshUsage(env, "t1", "claudecode", getter, { now: NOW + 1000 }); assert.equal(n, 1);
  await U.noteLimit(env, "t1", "claudecode", { window: "session", resets_at: NOW + 3600e3 }, NOW + 2000);
  let v = await U.refreshUsage(env, "t1", "claudecode", getter, { now: NOW + 3000 }); assert.equal(n, 2, "read again right after a limit"); assert.deepEqual(v.limit, { window: "session", resets_at: NOW + 3600e3 });
  assert.equal(U.viewOf("claudecode", d1.prepare("SELECT * FROM byok_usage").get(), NOW + 3700e3).limit, null, "gone after the reset time");
  await U.noteLimit(env, "t1", "claudecode", { window: "other", resets_at: null }, NOW); assert.deepEqual(U.viewOf("claudecode", d1.prepare("SELECT * FROM byok_usage").get(), NOW + 60e3).limit, { window: "", resets_at: null }, "no reset time: shown for six hours");
  assert.equal(U.viewOf("claudecode", d1.prepare("SELECT * FROM byok_usage").get(), NOW + 7 * 3600e3).limit, null);
});

test("ChatGPT: the connection's token and account id go to wham/usage, two bars come back, and the state shows them from the cache without a call", async () => {
  await wipe(); await seedChatgpt();
  let st = (await api("/api/byok")).d; assert.equal(whamCalls.length, 0, "opening the state reads no usage"); assert.deepEqual(st.usage.chatgpt, { windows: [], at: 0, tried: false, manage: "https://chatgpt.com/settings/usage", limit: null });
  const r = await api("/api/byok/usage"); assert.equal(r.status, 200); assert.equal(whamCalls.length, 1);
  assert.equal(whamCalls[0].headers.authorization, `Bearer ${AT}`); assert.equal(whamCalls[0].headers["chatgpt-account-id"], "acct-1234"); assert.equal(whamCalls[0].redirect, "manual");
  assert.deepEqual(r.d.usage.chatgpt.windows.map((w) => [w.id, w.label, w.used]), [["session", "5 hours", 37.5], ["weekly", "This week", 12]]);
  await api("/api/byok/usage"); assert.equal(whamCalls.length, 1, "from the cache");
  st = (await api("/api/byok")).d; assert.equal(st.usage.chatgpt.windows.length, 2);
  assert.ok(!logs.join("\n").includes(AT) && !JSON.stringify(r.d).includes(AT), "no token in a log or an answer"); assert.ok(logs.some((l) => /byok usage: chatgpt ok/.test(l)));
});

test("ChatGPT: a refused or unreadable answer leaves the Manage usage link, and the page view does not try again", async () => {
  for (const mode of ["401", "403", "404", "500", "html"]) {
    await wipe(); await seedChatgpt(); wham.mode = mode;
    const r = await api("/api/byok/usage"); assert.deepEqual(r.d.usage.chatgpt.windows, [], mode); assert.equal(r.d.usage.chatgpt.manage, "https://chatgpt.com/settings/usage"); assert.equal(r.d.usage.chatgpt.tried, true);
    await api("/api/byok/usage"); await api("/api/byok"); assert.equal(whamCalls.length, 1, `${mode}: one try`);
    assert.ok(logs.some((l) => /byok usage: chatgpt failed/.test(l)) && !logs.join("\n").includes(AT));
  }
  await wipe(); await seedChatgpt(); d1.prepare("UPDATE byok_chatgpt SET broken=1, record_sealed=''").run();
  assert.deepEqual((await api("/api/byok/usage")).d.usage.chatgpt.windows, [], "signed out: the link, no call"); assert.equal(whamCalls.length, 0);
  await assert.rejects(chatgptUsage(env, "t1", { fetchImpl: fetchStub }), (e) => e.why === "signin");
});

test("Claude Code: the engine's numbers become two bars; with none the link shows, and the engine is not asked again for five minutes of failure", async () => {
  await wipe(); seedClaude();
  engineUsage = { source: "headers", at: 1, windows: [{ id: "session", label: "5 hours", used: 61, resets_at: NOW + 3600e3 }, { id: "weekly", label: "This week", used: 20, resets_at: NOW + 86400e3 }] };
  let r = await api("/api/byok/usage"); assert.deepEqual(r.d.usage.claudecode.windows.map((w) => [w.id, w.used]), [["session", 61], ["weekly", 20]]); assert.equal(r.d.usage.claudecode.manage, "https://claude.ai/settings/usage");
  assert.deepEqual(await claudeUsage(env, "t1"), { windows: engineUsage.windows, source: "headers" });
  await wipe(); seedClaude(); engineUsage = { none: true, why: "asleep" };
  r = await api("/api/byok/usage"); assert.deepEqual(r.d.usage.claudecode.windows, []); assert.equal(r.d.usage.claudecode.tried, true); await api("/api/byok/usage"); assert.equal(engineCalls.length, 1, "a quiet engine is not asked on every view");
  await wipe(); seedClaude(); engineThrows = true; r = await api("/api/byok/usage"); assert.equal(r.status, 200); assert.deepEqual(r.d.usage.claudecode.windows, []);
});

test("OpenCode: no usage endpoint is documented for a personal key, so the link is all there is and nothing is fetched", async () => {
  await wipe(); await seedOpencode(); const before = whamCalls.length;
  const r = await api("/api/byok/usage"); assert.deepEqual(r.d.usage.opencode, { windows: [], at: 0, tried: false, manage: "https://opencode.ai/console", limit: null }); assert.equal(whamCalls.length, before);
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_usage").get().n, 0);
});

test("the usage route covers only connected services, and removing a service forgets its numbers", async () => {
  await wipe(); assert.deepEqual((await api("/api/byok/usage")).d, { usage: {} }); await seedChatgpt(); await seedClaude(); engineUsage = { source: "headers", windows: [{ id: "session", label: "5 hours", used: 5, resets_at: NOW }] };
  assert.deepEqual(Object.keys((await api("/api/byok/usage")).d.usage).sort(), ["chatgpt", "claudecode"]); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_usage").get().n, 2);
  await api("/api/byok/remove", { id: "chatgpt" }); assert.deepEqual(d1.prepare("SELECT service FROM byok_usage").all().map((x) => x.service), ["claudecode"]);
});

test("limit hit, ChatGPT: the reply names the service and the limit, says when it resets, links Manage usage, and the page is told", async () => {
  await wipe(); await seedChatgpt();
  const cfg = withChatgpt({ base: "https://api.openai.com/v1", settings: "https://app.example.test/w/ck1/app#/settings" }, env, "t1");
  const limit = (body) => async (u, init) => (String(u).endsWith("/responses") ? new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json" } }) : fetchStub(u, init));
  await U.refreshUsage(env, "t1", "chatgpt", () => chatgptUsage(env, "t1", { fetchImpl: fetchStub }));   // the numbers are read first
  await assert.rejects(chatgptChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "gpt-5", fetchImpl: limit({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }) }),
    (e) => e instanceof ByokError && e.limit === true && /^Your AI service \(ChatGPT\) has reached the usage limit of your ChatGPT plan, so I couldn't finish this\. \[Manage usage\]\(https:\/\/chatgpt\.com\/settings\/usage\), or choose another model in Settings/.test(e.message));
  const at = Date.now() + 3 * 3600e3;
  await assert.rejects(chatgptChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "gpt-5", fetchImpl: limit({ error: { code: "subscription_sharing_usage_limit_exceeded", resets_at: Math.floor(at / 1000) } }) }),
    (e) => /reached the usage limit of your ChatGPT plan, and it resets in (2 hours 5\d minutes|3 hours)/.test(e.message));
  const v = await U.usageView(env, "t1", "chatgpt"); assert.ok(v.limit && Math.abs(v.limit.resets_at - Math.floor(at / 1000) * 1000) < 1000, "the limit note carries the reset time");
  // with the weekly window full in the numbers, the message says weekly
  d1.exec("DELETE FROM byok_usage"); await U.refreshUsage(env, "t1", "chatgpt", async () => ({ windows: [{ id: "session", label: "5 hours", used: 30, resets_at: Date.now() + 3600e3 }, { id: "weekly", label: "This week", used: 100, resets_at: Date.now() + 2 * 86400e3 }] }));
  await assert.rejects(chatgptChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "gpt-5", fetchImpl: limit({ error: { code: "subscription_sharing_usage_limit_exceeded" } }) }), (e) => /reached the weekly usage limit of your ChatGPT plan, and it resets in 2 days/.test(e.message));
  // other errors keep their old words
  await assert.rejects(chatgptChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "gpt-5", fetchImpl: limit({ error: { code: "subscription_sharing_usage_unavailable" } }) }), (e) => !e.limit && /couldn't check your usage/.test(e.message));
});

test("limit hit, Claude Code: a rate limit error from the engine says which limit and when, from the engine's numbers", async () => {
  await wipe(); seedClaude();
  const cfg = withClaudeCode({ base: "", model: "", fast: "", settings: "" }, env, "t1");
  engineComplete = new Error("Claude usage limit reached");
  engineUsage = { source: "headers", status: "rejected", reset: Date.now() + 90 * 60e3, windows: [{ id: "session", label: "5 hours", used: 100, resets_at: Date.now() + 90 * 60e3 }, { id: "weekly", label: "This week", used: 30, resets_at: Date.now() + 86400e3 }] };
  await assert.rejects(claudeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "opus" }), (e) => e instanceof ByokError && e.limit === true && /^Your AI service \(Claude Code\) has reached the 5-hour usage limit of your Claude plan, and it resets in 1 hour 3\d minutes, so I couldn't finish this\. \[Manage usage\]\(https:\/\/claude\.ai\/settings\/usage\)/.test(e.message));
  assert.ok((await U.usageView(env, "t1", "claudecode")).limit, "the page is told");
  engineUsage = { none: true, why: "asleep" }; engineComplete = Object.assign(new Error("429 too many requests"), { status: 429 });
  await assert.rejects(claudeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "opus" }), (e) => e.limit === true && /has reached the usage limit of your Claude plan, so I couldn't finish this\. \[Manage usage\]/.test(e.message), "no numbers: no reset time, the link still there");
  engineComplete = new Error("not logged in"); await assert.rejects(claudeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { model: "opus" }), (e) => !e.limit && /isn't signed in/.test(e.message));
});

test("limit hit, OpenCode Go: a Go plan limit gets the Manage usage reply; pay as you go and other errors keep their words", () => {
  const go = { plan: "go", host: "OpenCode" }, payg = { plan: "payg", host: "OpenCode" };
  const e = ocFail(go, "you've reached your OpenCode Go usage limit (5-hour limit)", 429); assert.ok(e.limit && /^Your AI service \(OpenCode\) has reached the usage limit of your OpenCode Go plan, so I couldn't finish this\. \[Manage usage\]\(https:\/\/opencode\.ai\/console\), switch this connection to pay as you go, or choose another model in Settings/.test(e.message));
  assert.ok(ocFail(go, "your OpenCode Go plan didn't cover this request. Check your Go usage in the OpenCode console", 402).limit);
  assert.ok(!ocFail(payg, "your OpenCode balance is too low. Add funds", 402).limit); assert.ok(!ocFail(go, "OpenCode refused your key. Check or replace the OpenCode API key", 401).limit);
  assert.match(ocFail(payg, "your OpenCode balance is too low. Add funds", 402).message, /^Your AI service \(OpenCode\) didn't work/);
});

test("limitText: names the service, the window and the reset, always with the link", () => {
  assert.equal(U.limitText("chatgpt", { window: "weekly", resets_at: NOW + 2 * 86400e3, host: "ChatGPT", now: NOW }), "Your AI service (ChatGPT) has reached the weekly usage limit of your ChatGPT plan, and it resets in 2 days, so I couldn't finish this. [Manage usage](https://chatgpt.com/settings/usage), or choose another model in Settings → AI services.");
  assert.match(U.limitText("claudecode", {}), /\[Manage usage\]\(https:\/\/claude\.ai\/settings\/usage\)/);
});
