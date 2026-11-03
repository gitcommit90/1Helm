// node --import ./test/stubs/register.mjs test/byok-claudecode.test.mjs
// Continue with Claude (src/byok-claudecode.js and the places it plugs in) against a fake engine: no container, no network. Checks: the sign-in steps and the row, Test, Remove, the model list and ids,
// the call itself (claudeChat through the engine's complete(): streamed and not, errors in plain words), chains with a Claude Code model and a fallback, chores and Background jobs on it, and the warm route.
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { test } from "node:test";
import { byokApi, loadByok, byokChat, ByokError } from "../src/byok.js";
import { connDdl, splitModel, nsModel } from "../src/ee/byok-connections.js";
import { saveOwn, readOwn, ownPicker, ownKeyPlan, byokChatChain } from "../src/ee/byok-custom.js";
import { CC_MODELS } from "../src/ee/byok-claudecode.js";
import { sealSecret } from "../src/sentinel.js";
import { orDdl } from "../src/byok-openrouter.js";

const KEY_A = "sk-aaaa-SECRET-1111", A = "https://a.example-ai.com/v1";
const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, owner_user_id TEXT, helper_name TEXT, first_name TEXT, status TEXT DEFAULT 'active', plan TEXT, stripe_subscription TEXT DEFAULT '', updated_at INTEGER);
  INSERT INTO tenants (id, slug, helper_name, first_name, plan) VALUES ('t1','ck1','Ollie','Sam','byok');`);
for (const f of ["0022_031_byok", "0025_034_byok_mode", "0038_046_ai_privacy", "0065_custom_models_own_key", "0069_byok_chatgpt", "0068_byok_effort", "0070_byok_connections"]) d1.exec(readFileSync(new URL(`../db/migrations/${f}.sql`, import.meta.url), "utf8"));
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const calls = [], completes = []; let completeFail = "", think = false; const THINK = [{ type: "reasoning.text", text: "plan", signature: "SIG-123", index: 0, format: "anthropic-claude-v1" }]; let engineState = { signedIn: true, account: { email: "sam@claude.example", plan: "Max" }, version: "2.1.0" }, loginUrl = "https://claude.com/cai/oauth/authorize?code=true&state=abc", engineDown = false, goodCode = "CODE-123-abc";
let startError = "";
const engine = {
  warm: async () => { calls.push("warm"); return { ok: true, ms: 5 }; },
  loginStart: async () => { calls.push("loginStart"); if (startError) return { error: startError }; if (engineDown) throw new Error("no container"); return { url: loginUrl }; },
  loginFinish: async (c) => { calls.push(`loginFinish:${c}`); return c === goodCode ? { ok: true, account: { email: "sam@claude.example", plan: "Max" } } : { error: "bad code" }; },
  status: async () => { calls.push("status"); if (engineDown) throw new Error("no container"); return engineState; },
  signOut: async () => { calls.push("signOut"); },
  complete: async (a) => { calls.push(`complete:${a.model}:${a.effort || "-"}:${a.stream}:${a.session || "-"}`); completes.push(a); if (completeFail) throw new Error(completeFail);
    if (!a.stream && think) return { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } }], reasoning_details: THINK }, finish_reason: "tool_calls" }] };
    if (a.stream && think) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: THINK } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    if (!a.stream) return { choices: [{ message: { role: "assistant", content: "hi from claude" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 9 } };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi from claude" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }); },
};
const env = { ONEHELM_EE: "1hc", DB: D1, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", ENV_NAME: "test", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 1)).toString("base64"), LEDGER: { idFromName: (n) => n, get: () => ({}) }, CLAUDE_ENGINE: { idFromName: (n) => n, get: () => engine } };
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const origFetch = globalThis.fetch, posts = [], plainBodies = [];
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const url = new URL(u);
  if (url.hostname === "a.example-ai.com") { if (url.pathname === "/v1/models") return jres({ data: [{ id: "main-1" }, { id: "other" }] }); { const b = JSON.parse(init.body); posts.push(b.model); plainBodies.push(b); } return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi from a" } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }); }
  throw new Error(`unexpected fetch ${u}`);
};
const wipe = async () => { await orDdl(env); await connDdl(env); d1.exec("DELETE FROM byok; DELETE FROM byok_connections; DELETE FROM byok_multi; DELETE FROM byok_tests; UPDATE tenants SET plan='byok', custom_models_own=NULL, custom_models_own_on=0"); d1.prepare("INSERT OR IGNORE INTO byok_multi (tenant_id, upgraded_at) VALUES ('t1', 1)").run(); calls.length = 0; engineDown = false; engineState = { signedIn: true, account: { email: "sam@claude.example", plan: "Max" }, version: "2.1.0" }; };
const waits = [];
const T = () => d1.prepare("SELECT * FROM tenants WHERE id='t1'").get();
const api = async (sub, body) => { const r = await byokApi(new Request(`https://app.example.test/w/ck1${sub}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), env, T(), sub, { json: (o, status = 200) => jres(o, status), waitUntil: (p) => waits.push(p) }); return { status: r.status, d: await r.json() }; };
const plain = async () => { d1.prepare("INSERT OR REPLACE INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,created_at,updated_at) VALUES ('t1','p_aaaaa','plain','a.example-ai.com',?,?,?,1,1)").run(A, await sealSecret(env, KEY_A), KEY_A.slice(-4)); };
const entry = (model, effort = null) => ({ model, effort });
const cat = (id, title, ...chain) => ({ id, title, chain, max_price: null });
const signIn = async () => { await api("/api/byok/claudecode/start", {}); return api("/api/byok/claudecode/finish", { code: goodCode }); };

test("model ids are named like every connection's, and the list is the names Claude Code takes", () => {
  assert.deepEqual(splitModel("claudecode:opus"), { conn: "claudecode", model: "opus" }); assert.equal(nsModel("claudecode", "haiku"), "claudecode:haiku");
  assert.deepEqual(CC_MODELS.map((m) => m.id), ["fable", "opus", "sonnet", "haiku"]); assert.equal(CC_MODELS.find((m) => m.id === "haiku").supported_reasoning_efforts, undefined);
});

test("sign in: the engine's stop reasons reach the app in plain words with a code, never as a bare code", async () => {
  await wipe();
  for (const [raw, code, status, re] of [["out_of_credits", "out_of_credits", 402, /paid from credits you add/], ["skipped: daily safety limit reached", "day_limit", 429, /midnight Pacific/], ["ETIMEDOUT", undefined, 502, /isn't reachable/]]) {
    startError = raw; const r = await api("/api/byok/claudecode/start", {});
    assert.equal(r.status, status); assert.equal(r.d.code, code); assert.match(r.d.error, re); assert.notEqual(r.d.error, raw);
  }
  startError = "";
});
test("sign in: start gives Anthropic's address, finish takes the pasted code; the row shows who is signed in; one per account", async () => {
  await wipe();
  let r = await api("/api/byok/claudecode/start", {}); assert.equal(r.status, 200); assert.equal(r.d.url, loginUrl); assert.ok(calls.includes("loginStart"));
  loginUrl = "http://claude.example/insecure"; r = await api("/api/byok/claudecode/start", {}); assert.equal(r.status, 502, "an address that isn't https is never handed to the app"); assert.equal(r.d.code, "bad_signin_url"); assert.ok(!r.d.url); assert.match(r.d.error, /doesn't recognize/);
  loginUrl = "https://claude.com.evil.io/cai/oauth/authorize?state=SECRET-STATE"; const logs = []; const log0 = console.log; console.log = (...a) => logs.push(a.join(" ")); r = await api("/api/byok/claudecode/start", {}); console.log = log0;
  assert.equal(r.status, 502, "a lookalike host is refused on the server"); assert.ok(logs.some((l) => l.includes("claude.com.evil.io")) && !logs.some((l) => l.includes("SECRET-STATE")), "only the host is logged, never the address with its state"); loginUrl = "https://claude.com/cai/oauth/authorize?code=true&state=abc";
  r = await api("/api/byok/claudecode/finish", { code: "x" }); assert.equal(r.status, 400); assert.equal(r.d.field, "code"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 0);
  r = await api("/api/byok/claudecode/finish", { code: "WRONG-CODE-1" }); assert.equal(r.status, 400); assert.equal(r.d.error, "bad code", "the engine's own words are shown"); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections").get().n, 0);
  r = await api("/api/byok/claudecode/finish", { code: goodCode }); assert.equal(r.status, 200); assert.equal(r.d.id, "claudecode");
  const c = r.d.connections.find((x) => x.id === "claudecode"); assert.deepEqual([c.kind, c.label, c.email, c.plan_name, c.signin_again], ["claudecode", "Claude Code", "sam@claude.example", "Max", false]);
  await api("/api/byok/claudecode/finish", { code: goodCode }); assert.equal(d1.prepare("SELECT COUNT(*) n FROM byok_connections WHERE kind='claudecode'").get().n, 1, "signing in again replaces the row");
  assert.equal(d1.prepare("SELECT key_sealed FROM byok_connections WHERE id='claudecode'").get().key_sealed, "", "no key is stored: the sign-in lives in the engine");
});

test("Test asks the engine who is signed in and runs no model; Remove signs out and takes the models out", async () => {
  await wipe(); await signIn(); calls.length = 0;
  let r = await api("/api/byok/test", { id: "claudecode" }); assert.equal(r.d.ok, true); assert.deepEqual(calls, ["status"]); assert.equal(r.d.connections[0].email, "sam@claude.example");
  engineState = { signedIn: false, account: null, version: "2.1.0" }; r = await api("/api/byok/test", { id: "claudecode" }); assert.equal(r.d.ok, false); assert.match(r.d.test.checks.reach.error, /isn't signed in/); assert.equal(r.d.connections[0].signin_again, true);
  engineDown = true; r = await api("/api/byok/test", { id: "claudecode" }); assert.equal(r.d.ok, false); assert.match(r.d.test.checks.reach.error, /isn't reachable/);
  engineDown = false; await plain();
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "high"), entry("p_aaaaa:main-1"))] }, { fetchImpl: globalThis.fetch });
  calls.length = 0; r = await api("/api/byok/remove", { id: "claudecode" }); assert.equal(r.status, 200); assert.deepEqual(calls, ["signOut"]); assert.equal(r.d.removed_models, 1);
  assert.deepEqual((await readOwn(env, "t1")).config.categories[0].chain.map((e) => e.model), ["p_aaaaa:main-1"]);
});

test("the picker lists Claude Code's models with their reasoning levels, under the service's name", async () => {
  await wipe(); await signIn(); await plain();
  const p = await ownPicker(env, { id: "t1" }, "own", "", { conn: "claudecode", fetchImpl: globalThis.fetch });
  assert.deepEqual(p.models.map((m) => [m.id, m.service, m.kind]), [["claudecode:fable", "Claude Code", "claudecode"], ["claudecode:haiku", "Claude Code", "claudecode"], ["claudecode:opus", "Claude Code", "claudecode"], ["claudecode:sonnet", "Claude Code", "claudecode"]]);
  const opus = p.models.find((m) => m.id === "claudecode:opus"); assert.deepEqual(opus.efforts, ["default", "low", "medium", "high", "xhigh", "max"]); assert.deepEqual(p.models.find((m) => m.id === "claudecode:haiku").efforts, []);
  assert.deepEqual(p.models.map((m) => m.name), ["Claude Fable 5.1", "Claude Haiku 5.5", "Claude Opus 5.5", "Claude Sonnet 5.5"], "names carry version numbers");
  const fable = p.models.find((m) => m.id === "claudecode:fable"); assert.deepEqual(fable.efforts, ["default", "low", "medium", "high", "xhigh", "max"]); assert.equal(fable.note, "May use your Claude usage credits"); assert.equal(opus.note, undefined);
  assert.deepEqual(p.errors, []);
});

test("saving: a Claude Code model in any place, with a level its model lists", async () => {
  await wipe(); await signIn(); await plain(); const v = { fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:sonnet", "medium"), entry("p_aaaaa:main-1"))], background: { chain: [entry("claudecode:haiku")] } }, v);
  const c = (await readOwn(env, "t1")).config; assert.deepEqual(c.categories[0].chain, [{ model: "claudecode:sonnet", effort: "medium" }, { model: "p_aaaaa:main-1", effort: null }]); assert.deepEqual(c.background.chain, [{ model: "claudecode:haiku", effort: null }]);
  await assert.rejects(saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:haiku", "high"))] }, v), /doesn't support the reasoning level/);
  await assert.rejects(saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:nope"))] }, v), /isn't in the model list of Claude Code/);
});

test("a call on Claude Code goes through the engine's complete(): streamed and not, effort, session, no charge; the default level sends none", async () => {
  await wipe(); await signIn(); await plain(); const v = { fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "high"))] }, v);
  const cfg = await loadByok(env, "t1"); assert.equal(cfg.model, "claudecode:opus"); completes.length = 0;
  const txt = await (await byokChat(cfg, { messages: [{ role: "user", content: "hi" }], stream: true }, { session: "s-7" })).text(); assert.match(txt, /hi from claude/);
  assert.deepEqual([completes[0].model, completes[0].effort, completes[0].stream, completes[0].session, completes[0].body.model], ["opus", "high", true, "s-7", "opus"]);
  const j = await (await byokChat(cfg, { messages: [{ role: "user", content: "hi" }] }, { model: "claudecode:sonnet", effort: "default" })).json();
  assert.equal(j.choices[0].message.content, "hi from claude"); assert.equal(j.usage.cost, 0, "the Claude plan pays: nothing is charged"); assert.equal(completes[1].effort, undefined); assert.equal(completes[1].stream, false);
  assert.equal(posts.length, 0, "no other service was called");
});

test("failures are plain words that point to Settings, AI services; a failing Claude Code model hands the call to the next in the chain", async () => {
  await wipe(); await signIn(); await plain(); const v = { fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "default"), entry("p_aaaaa:main-1"))] }, v);
  const cfg = await loadByok(env, "t1"), plan = await ownKeyPlan(env, "t1", cfg, "general"), body = { messages: [{ role: "user", content: "hi" }], stream: true };
  let r = await byokChatChain(cfg, body, plan); assert.equal(r.pick.model, "claudecode:opus"); assert.equal(r.pick.failed.length, 0);
  for (const [fail, re] of [["Not logged in · Please run /login", /isn't signed in\. Open Settings, AI services/], ["Claude AI usage limit reached|1700000000", /usage limit/], ["no container", /isn't reachable right now/], ["weird crash", /stopped: weird crash\. Check it in Settings, AI services/]]) {
    completeFail = fail; await assert.rejects(byokChat(cfg, { messages: [], stream: true }, { model: "claudecode:opus" }), (e) => e instanceof ByokError && re.test(e.message));
    posts.length = 0; r = await byokChatChain(cfg, body, plan); assert.equal(r.pick.model, "p_aaaaa:main-1"); assert.equal(r.pick.slot, 1); assert.match(r.pick.failed[0].error, /./); assert.deepEqual(posts, ["main-1"], "the fallback answered");
  }
  completeFail = "";
});

test("chores and Background jobs can run on Claude Code like on any service", async () => {
  await wipe(); await signIn(); const v = { fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "default"))], background: { chain: [entry("claudecode:haiku")] } }, v);
  const cfg = await loadByok(env, "t1"); assert.equal(cfg.fast, "claudecode:haiku"); completes.length = 0;
  await (await byokChat(cfg, { messages: [{ role: "user", content: "title?" }], stream: true }, { fast: true })).text(); assert.equal(completes[0].model, "haiku");
});

test("warm: only an account whose General model is Claude Code starts the engine, at most once in 30 seconds", async () => {
  await wipe(); await signIn(); await plain(); const v = { fetchImpl: globalThis.fetch }; calls.length = 0;
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("p_aaaaa:main-1"))] }, v);
  let r = await api("/api/byok/claudecode/warm", {}); assert.deepEqual(r.d, { ok: true, warming: false }); assert.ok(!calls.includes("warm"));
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "default"))] }, v);
  r = await api("/api/byok/claudecode/warm", {}); assert.equal(r.d.warming, true); await Promise.all(waits); assert.equal(calls.filter((c) => c === "warm").length, 1);
  r = await api("/api/byok/claudecode/warm", {}); assert.equal(r.d.warming, false, "a second call within 30 seconds starts nothing"); assert.equal(calls.filter((c) => c === "warm").length, 1);
  calls.length = 0; r = await api("/api/byok/claudecode/warm", { login: true }); assert.equal(r.d.warming, true, "Settings, AI services warms the engine for the sign-in"); await Promise.all(waits); assert.equal(calls.filter((c) => c === "warm").length, 1);
  r = await api("/api/byok/claudecode/warm", { login: true }); assert.equal(r.d.warming, false);
});

test("signed thinking from Claude Code comes back unchanged on the next call to the same model, and never goes to a fallback model", async () => {
  await wipe(); await signIn(); await plain(); const v = { fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "default"), entry("p_aaaaa:main-1"))] }, v);
  const cfg = await loadByok(env, "t1"), plan = await ownKeyPlan(env, "t1", cfg, "general"), user = { role: "user", content: "weather?" };
  // call one (streamed, and also non-streamed): the engine answers with a tool call and signed thinking
  think = true; completes.length = 0;
  const r1 = await (await byokChat(cfg, { messages: [user], stream: false }, { model: "claudecode:opus" })).json();
  assert.deepEqual(r1.choices[0].message.reasoning_details, THINK, "the non-streamed answer carries reasoning_details");
  const sse = await (await byokChat(cfg, { messages: [user], stream: true }, { model: "claudecode:opus" })).text();
  assert.ok(sse.includes("SIG-123"), "the stream carries reasoning_details");
  think = false;
  // the Resident keeps them on its assistant message, tagged with the exact model id (resident.js)
  const assistant = { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } }], reasoning_details: THINK, _rmodel: "claudecode:opus" };
  const messages = [user, assistant, { role: "tool", tool_call_id: "call_1", content: "3 degrees" }];
  completes.length = 0; await (await byokChat(cfg, { messages, stream: true }, { model: "claudecode:opus" })).text();
  const sent = completes[0].body.messages.find((m) => m.role === "assistant");
  assert.deepEqual(sent.reasoning_details, THINK, "the same model gets its signed thinking back unchanged"); assert.equal(sent._rmodel, undefined, "_rmodel never leaves 1Helm");
  // a different Claude Code model and the fallback service get the messages without it
  completes.length = 0; await (await byokChat(cfg, { messages, stream: true }, { model: "claudecode:sonnet" })).text();
  assert.equal(completes[0].body.messages.find((m) => m.role === "assistant").reasoning_details, undefined, "another model never sees it");
  plainBodies.length = 0; await (await byokChat(cfg, { messages, stream: true }, { model: "p_aaaaa:main-1" })).text();
  assert.ok(!JSON.stringify(plainBodies[0]).includes("SIG-123") && !JSON.stringify(plainBodies[0]).includes("_rmodel"), "the fallback model never sees it");
  // a chain: Claude Code fails, the fallback answers, still without it
  completeFail = "no container"; plainBodies.length = 0; const r = await byokChatChain(cfg, { messages, stream: true }, plan); assert.equal(r.pick.model, "p_aaaaa:main-1"); assert.ok(!JSON.stringify(plainBodies[0]).includes("SIG-123")); completeFail = "";
});

test("prompt caching: the body handed to the engine carries the same cache marks the OpenRouter path sends, and no session id", async () => {
  await wipe(); await signIn(); await plain(); const v = { fetchImpl: globalThis.fetch };
  await saveOwn(env, "t1", { categories: [cat("general", "General", entry("claudecode:opus", "high"))] }, v);
  const cfg = await loadByok(env, "t1"); const marks = (x) => JSON.stringify(x).split('"cache_control"').length - 1;
  const loop = { messages: [{ role: "system", content: "S" }, { role: "user", content: "one" }, { role: "assistant", content: "ok", tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: "result" }, { role: "user", content: "next" }],
    tools: [{ type: "function", function: { name: "web_search", parameters: { type: "object", properties: {} } } }], stream: true };
  completes.length = 0; await (await byokChat(cfg, loop, { session: "task-5" })).text();
  let b = completes[0].body; assert.ok(marks(b) >= 3 && marks(b) <= 4, `a session tool loop: three or four marks (${marks(b)})`); assert.ok(!("session_id" in b), "session_id is never sent on");
  assert.ok(b.tools.at(-1).cache_control && b.messages[0].content[0].cache_control && b.messages.at(-1).content.at(-1).cache_control, "last tool, system and the last message are marked");
  assert.equal(completes[0].session, "task-5", "the engine still gets the session");
  assert.ok(loop.tools[0].cache_control === undefined && typeof loop.messages[0].content === "string", "the caller's request is not changed");
  completes.length = 0; await (await byokChat(cfg, { messages: loop.messages, stream: true }, { fast: true })).text(); b = completes[0].body; assert.ok(marks(b) >= 1 && marks(b) <= 2, "a chore: one or two marks"); assert.equal(marks(b.messages.slice(1)), 0, "none on the conversation");
  env.PROMPT_CACHE = "off"; completes.length = 0; await (await byokChat(cfg, loop, { session: "task-5" })).text(); assert.equal(marks(completes[0].body), 0, "PROMPT_CACHE=off sends no marks"); delete env.PROMPT_CACHE;
});
