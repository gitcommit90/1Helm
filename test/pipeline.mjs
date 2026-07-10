import WebSocket from "ws";

const B = process.env.BASE || "localhost:8123";
const MOCK = "http://localhost:9099/v1";
const api = (path, opts = {}, tok) => fetch(`http://${B}${path}`, { ...opts, headers: { ...(opts.body ? { "content-type": "application/json" } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("  ok  -", label); } else { fail++; console.log("  FAIL-", label); } };

// admin user (first registered) — reuse alice if exists else register
let tok;
const reg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: "admin", password: "secret", display: "Admin" }) });
tok = reg.body.token || (await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "secret" }) })).body.token;
ok(!!tok, "auth token obtained");
const me = await api("/api/me", {}, tok);
const isAdmin = me.body.user.is_admin;

// create a provider, then fetch its models
const provRes = await api("/api/providers", { method: "POST", body: JSON.stringify({ name: "mock", base_url: MOCK, api_key: "x" }) }, tok);
ok(provRes.status === 200 && provRes.body.provider, "create provider (admin)");
const provId = provRes.body.provider.id;
const models = await api(`/api/providers/${provId}/models`, {}, tok);
ok(models.body.models?.includes("mock-large"), "provider models endpoint returns mock models");

// create bot referencing the provider
const botRes = await api("/api/bots", { method: "POST", body: JSON.stringify({ name: "helper", provider_id: provId, model: "", prompt: "Be terse." }) }, tok);
ok(botRes.status === 200 && botRes.body.bot, "create bot referencing provider");
ok(botRes.body.bot.provider_id === provId, "bot stores provider_id");
const bot = botRes.body.bot;

// second bot reuses the SAME provider (bot-agnostic providers)
const bot2 = await api("/api/bots", { method: "POST", body: JSON.stringify({ name: "helper2", provider_id: provId, model: "mock-small" }) }, tok);
ok(bot2.body.bot?.provider_id === provId, "a second bot can reuse the same provider");

// set GLOBAL model pref
await api("/api/model-pref", { method: "POST", body: JSON.stringify({ botId: bot.id, scope: "global", scopeId: "", model: "mock-large" }) }, tok);

// channel id
const channels = await api("/api/channels", {}, tok);
const cid = channels.body.channels[0].id;

// connect app WS to observe events
const ws = new WebSocket(`ws://${B}/ws?token=${tok}`);
const events = [];
ws.on("message", (d) => events.push(JSON.parse(d.toString())));
await new Promise((r) => ws.on("open", r));

// 1) mention bot in channel while NOT a member → expect bot_prompt event, no reply
await api(`/api/channels/${cid}/messages`, { method: "POST", body: JSON.stringify({ body: "hey @helper you there?" }) }, tok);
await sleep(400);
const prompt = events.find((e) => e.type === "bot_prompt" && e.botName === "helper");
ok(!!prompt, "mention in channel (bot not member) → prompt to add");

// 2) accept: join bot to channel and trigger (fresh context, opens a thread)
await api(`/api/bots/${bot.id}/join`, { method: "POST", body: JSON.stringify({ channelId: cid, triggerId: prompt.triggerId, threadRootId: prompt.threadRootId, fresh: prompt.fresh }) }, tok);
await sleep(1200);
const botMsg = events.filter((e) => (e.type === "message" || e.type === "message_update") && e.message?.author?.kind === "bot").pop();
ok(!!botMsg, "bot replied");
ok(botMsg?.message?.parent_id === prompt.triggerId, "bot reply is inside a THREAD under the channel message (not main channel)");
ok(/mock-large/.test(botMsg?.message?.body || ""), "bot used GLOBAL model (mock-large)");

// 3) channel-level override → set channel model, mention in-thread should use it
await api("/api/model-pref", { method: "POST", body: JSON.stringify({ botId: bot.id, scope: "channel", scopeId: String(cid), model: "mock-small" }) }, tok);
const rootId = prompt.triggerId;
events.length = 0;
await api(`/api/channels/${cid}/messages`, { method: "POST", body: JSON.stringify({ body: "@helper again in thread", parentId: rootId }) }, tok);
await sleep(1200);
const botMsg2 = events.filter((e) => e.message?.author?.kind === "bot").pop();
ok(/mock-small/.test(botMsg2?.message?.body || ""), "channel override applied (mock-small) in thread");

// 4) thread-level override wins
await api("/api/model-pref", { method: "POST", body: JSON.stringify({ botId: bot.id, scope: "thread", scopeId: String(rootId), model: "mock-large" }) }, tok);
events.length = 0;
await api(`/api/channels/${cid}/messages`, { method: "POST", body: JSON.stringify({ body: "@helper thread override?", parentId: rootId }) }, tok);
await sleep(1200);
const botMsg3 = events.filter((e) => e.message?.author?.kind === "bot").pop();
ok(/mock-large/.test(botMsg3?.message?.body || ""), "thread override wins over channel (mock-large)");

// 5) remove thread override → falls back to channel
await api("/api/model-pref", { method: "POST", body: JSON.stringify({ botId: bot.id, scope: "thread", scopeId: String(rootId), model: null }) }, tok);
events.length = 0;
await api(`/api/channels/${cid}/messages`, { method: "POST", body: JSON.stringify({ body: "@helper after removing thread pref", parentId: rootId }) }, tok);
await sleep(1200);
const botMsg4 = events.filter((e) => e.message?.author?.kind === "bot").pop();
ok(/mock-small/.test(botMsg4?.message?.body || ""), "removing thread pref falls back to channel (mock-small)");

// 6) tool calling: assign This Computer, ask to run a command
const comps = await api("/api/computers", {}, tok);
const compId = comps.body.computers[0].id;
await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ computers: [compId] }) }, tok);
events.length = 0;
await api(`/api/channels/${cid}/messages`, { method: "POST", body: JSON.stringify({ body: "@helper run whoami on the computer", parentId: rootId }) }, tok);
await sleep(2500);
const toolMsgs = events.filter((e) => e.message?.author?.kind === "bot").map((e) => e.message.body);
const finalTool = toolMsgs.pop() || "";
ok(/\$ whoami/.test(finalTool), "bot invoked run_command tool on the computer");

// 7) computers persist when set at CREATE time (regression: POST used to drop them)
const created = await api("/api/bots", { method: "POST", body: JSON.stringify({ name: "builder", provider_id: provId, computers: [compId] }) }, tok);
ok(created.body.bot?.computers?.includes(compId), "computers assigned at bot-create time persist");

// 8) provider deletion is blocked while bots reference it
const delProv = await api(`/api/providers/${provId}`, { method: "DELETE" }, tok);
ok(delProv.status === 409, "deleting an in-use provider is blocked (409)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
