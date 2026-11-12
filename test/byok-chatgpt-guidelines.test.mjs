// node --import ./test/stubs/register.mjs test/byok-chatgpt-guidelines.test.mjs
// OpenAI's Sign in with ChatGPT UI/UX guidelines (task siwc-guidelines): the usage summary counted from the token usage of completed Responses calls (last 30 UTC days: Total, Peak / day,
// Active days), the first-sign-in message flag, the "Using ChatGPT plan" boot flag, and that no ChatGPT backend-api address is read. No network, no model call.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { test } from "node:test";
import { byokApi, withChatgpt, ByokError } from "../src/byok.js";
import { connDdl } from "../src/ee/byok-connections.js";
import { chatgptChat, translateStream, summarizeChatgptUse, recordChatgptUse, chatgptUseSummary, chatgptWelcomeCreate, chatgptWelcomePending, chatgptWelcomeDone } from "../src/ee/byok-chatgpt.js";
import { chatgptPlanInUse } from "../src/byok.js";
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
const wipe = async () => { await orDdl(env); await connDdl(env); d1.exec("DELETE FROM byok; DELETE FROM byok_connections; DELETE FROM byok_chatgpt; DELETE FROM byok_usage;"); U._resetUsageDdl(); engineCalls.length = 0; whamCalls.length = 0; engineUsage = { none: true, why: "asleep" }; engineThrows = false; engineComplete = null; logs.length = 0; };
const whamCalls = [];
const fetchStub = async (u) => { if (/backend-api/.test(String(u))) whamCalls.push(String(u)); throw new Error(`unexpected fetch ${u}`); };
globalThis.fetch = fetchStub;
const DAY = 86400e3, iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const events = (list) => new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const e of list) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } });
const drain = async (stream) => { const r = stream.getReader(); for (;;) { const { done } = await r.read(); if (done) return; } };

test("summary math: Total is the 30 day sum, Peak / day the largest day, Active days the days with use; older and future days and empty days are left out", () => {
  const at = Date.parse("2026-11-05T12:00:00Z");
  const rows = [{ day: "2026-11-05", tokens: 1000 }, { day: "2026-11-04", tokens: 250 }, { day: "2026-10-07", tokens: 4000 }, { day: "2026-10-06", tokens: 99999 }, { day: "2026-11-06", tokens: 77 }, { day: "2026-11-03", tokens: 0 }, { day: "bad", tokens: 5 }];
  assert.deepEqual(summarizeChatgptUse(rows, at), { total: 5250, peak: 4000, days: 3, window: 30 }, "2026-10-07 is the 30th day back; 10-06 is out");
  assert.deepEqual(summarizeChatgptUse([], at), { total: 0, peak: 0, days: 0, window: 30 });
  assert.deepEqual(summarizeChatgptUse([{ day: "2026-11-05", tokens: -5 }, { day: "2026-11-05", tokens: "12.9" }], at), { total: 12, peak: 12, days: 1, window: 30 });
});

test("a completed ChatGPT call adds its total tokens to today, calls on the same day add up, and an incomplete call counts too", async () => {
  await wipe(); await seedChatgpt();
  const cfg = withChatgpt({ base: "https://api.openai.com/v1" }, env, "t1");
  const done = (usage, type = "response.completed") => events([{ type: "response.output_text.delta", delta: "hi" }, { type, response: { usage } }]);
  await drain(translateStream(cfg, done({ input_tokens: 100, output_tokens: 20, total_tokens: 120 }), "gpt-5"));
  await drain(translateStream(cfg, done({ input_tokens: 30, output_tokens: 10 }), "gpt-5"));   // no total: input + output
  await drain(translateStream(cfg, done({ total_tokens: 5 }, "response.incomplete"), "gpt-5"));
  const row = d1.prepare("SELECT * FROM byok_chatgpt_use WHERE tenant_id='t1'").all(); assert.equal(row.length, 1); assert.equal(row[0].day, iso(Date.now())); assert.equal(row[0].tokens, 165); assert.equal(row[0].calls, 3);
  assert.deepEqual(await chatgptUseSummary(env, "t1"), { total: 165, peak: 165, days: 1, window: 30 });
  // a failed call counts nothing; a call with no usage counts nothing
  await assert.rejects(drain(translateStream(cfg, events([{ type: "response.failed", response: { error: { code: "x", message: "m" } } }]), "gpt-5")));
  await drain(translateStream(cfg, done({}), "gpt-5"));
  assert.equal(d1.prepare("SELECT SUM(tokens) n FROM byok_chatgpt_use").get().n, 165);
  // yesterday's row and an older row feed the summary, and the state and route carry it
  d1.prepare("INSERT INTO byok_chatgpt_use VALUES ('t1',?,?,1), ('t1',?,?,1), ('t2',?,?,1)").run(iso(Date.now() - DAY), 800, iso(Date.now() - 45 * DAY), 9e6, iso(Date.now()), 1e6);
  const st = (await api("/api/byok")).d; assert.deepEqual(st.chatgpt.summary, { total: 965, peak: 800, days: 2, window: 30 }, "another account's rows and rows over 30 days old are not counted");
  assert.deepEqual((await api("/api/byok/usage")).d.chatgpt.summary, st.chatgpt.summary);
  assert.equal(whamCalls.length, 0, "no ChatGPT backend-api call");
  // a call with no ChatGPT handle (a test connection or another service) records nothing and does not throw
  await drain(translateStream({ provider: "x" }, done({ total_tokens: 50 }), "m")); assert.equal(d1.prepare("SELECT SUM(tokens) n FROM byok_chatgpt_use WHERE tenant_id='t1'").get().n, 965 + 9e6);
  await recordChatgptUse(env, "t1", 0); await recordChatgptUse(env, "t1", NaN); await recordChatgptUse(env, "", 5);
  assert.equal(d1.prepare("SELECT SUM(tokens) n FROM byok_chatgpt_use WHERE tenant_id='t1'").get().n, 965 + 9e6);
});

test("the first-sign-in message: created once, pending until Got it, never again (also after a disconnect and a new sign-in)", async () => {
  await wipe(); await seedChatgpt(); d1.exec("DELETE FROM byok_chatgpt_welcome");
  assert.equal(await chatgptWelcomePending(env, "t1"), false, "an account connected before this change has no pending message");
  assert.equal((await api("/api/byok")).d.chatgpt.welcome, false);
  await chatgptWelcomeCreate(env, "t1"); assert.equal(await chatgptWelcomePending(env, "t1"), true); assert.equal((await api("/api/byok")).d.chatgpt.welcome, true);
  await chatgptWelcomeCreate(env, "t1"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt_welcome").get().n, 1);
  assert.equal(await chatgptWelcomePending(env, "t2"), false, "per account");
  assert.equal((await api("/api/byok/chatgpt/welcomed", {})).d.chatgpt.welcome, false);
  const at = d1.prepare("SELECT shown_at FROM byok_chatgpt_welcome").get().shown_at; assert.ok(at > 0);
  await chatgptWelcomeDone(env, "t1", at + 5000); assert.equal(d1.prepare("SELECT shown_at FROM byok_chatgpt_welcome").get().shown_at, at, "the first time stays");
  await chatgptWelcomeCreate(env, "t1"); assert.equal(await chatgptWelcomePending(env, "t1"), false, "a new sign-in does not bring it back");
  await api("/api/byok/remove", { id: "chatgpt" }); assert.equal(await chatgptWelcomePending(env, "t1"), false);
  assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt_use WHERE tenant_id='t1'").get().n, 0, "the usage counts go with the sign-in (Remove)");
});

test("Using ChatGPT plan: shown at boot only on the Bring your own key plan whose General model is on the ChatGPT connection", async () => {
  await wipe(); await seedChatgpt();
  const own = (model) => d1.prepare("UPDATE tenants SET custom_models_own=? WHERE id='t1'").run(model ? JSON.stringify({ version: 1, catalog: {}, categories: [{ id: "general", chain: [{ model }] }] }) : "");
  const tenant = (plan) => ({ ...T(), plan });
  own("chatgpt:gpt-6.1-sol"); assert.equal(await chatgptPlanInUse(env, tenant("byok")), true);
  own("opencode:glm-5.3"); assert.equal(await chatgptPlanInUse(env, tenant("byok")), false, "another service answers");
  own(""); assert.equal(await chatgptPlanInUse(env, tenant("byok")), false, "no model chosen");
  own("chatgpt:gpt-6.1-sol"); assert.equal(await chatgptPlanInUse(env, tenant("plus")), false, "a full plan runs on 1Helm credits");
  d1.exec("DELETE FROM byok_connections"); assert.equal(await chatgptPlanInUse(env, tenant("byok")), false, "not connected");
});

test("the invite banner: shown only to an account with no ChatGPT connection that has not dismissed it, and the dismissal is kept per account", async () => {
  await wipe(); d1.exec("DELETE FROM byok_chatgpt_invite");
  assert.equal((await api("/api/byok")).d.chatgpt.invite, true, "no connection, not dismissed");
  await seedChatgpt(); assert.equal((await api("/api/byok")).d.chatgpt.invite, false, "connected accounts never see it");
  d1.exec("DELETE FROM byok_connections"); assert.equal((await api("/api/byok")).d.chatgpt.invite, true);
  const r = await api("/api/byok/chatgpt/invite-dismiss", {}); assert.equal(r.status, 200); assert.equal(r.d.chatgpt.invite, false);
  assert.equal((await api("/api/byok/chatgpt/invite-dismiss", {})).d.chatgpt.invite, false); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_chatgpt_invite").get().n, 1, "one row, however many presses");
  assert.equal((await api("/api/byok")).d.chatgpt.invite, false, "stays dismissed after a reload and a disconnect");
});
