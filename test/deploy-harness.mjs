// Shared harness for the deploy-safe tests (test/deploy-safe-p0.test.mjs, test/deploy-resume.test.mjs).
// The real Resident on node:sqlite with the REAL callModel and Ledger accounting against a scripted Workers AI stream. A "deploy" is
// kill(): every storage call the old instance makes from then on throws Cloudflare's reset error (the old code may still be finishing
// a fetch, but it can't touch storage), and its hung model call / tool call never comes back. boot() then constructs a fresh Resident
// over the SAME storage and the same alarm, exactly like the new code starting after a deploy.
import { transactionSyncFor } from "./helpers/transaction-sync.mjs";
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { confirmGate } from "../src/confirm.js";
import { SEED } from "./helpers/seed-settings.mjs";

export const HANG = Symbol("hang");          // brain → HANG: this model call never answers (killed mid-call)
export const RESET = "Durable Object reset because its code was updated.";
export const tick = (ms = 5) => new Promise((z) => setTimeout(z, ms));
export const never = () => new Promise(() => {});

// openrouter: true sends every model call (the helper's steps, the card label, the hand-off notes) through the OpenRouter code path, as
// the live Worker does (labels and notes have no Workers AI path any more, 8dec274 / 11a7df6). A global fetch stand-in answers each
// openrouter.ai chat call with the same scripted brain: a streamed reply for stream requests, a whole JSON answer otherwise.
export function world({ engine = "classic", env: extraEnv = {}, openrouter = false } = {}) {
  const W = {};
  // ---- D1 ----
  const d1 = new DatabaseSync(":memory:");
  d1.exec(readFileSync(new URL("fixtures/migrations/migrations_009.sql", import.meta.url), "utf8"));
  d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, status TEXT, past_due_since INTEGER); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam','active',NULL);");
  d1.exec("CREATE TABLE resident_schedules (tenant_id TEXT, channel TEXT, channel_id TEXT, next_run INTEGER, updated_at INTEGER, PRIMARY KEY (tenant_id, channel))");
  const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
    run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
  W.d1 = d1;
  // ---- Ledger (fake tenant DO, same rules as the real one: settle ≤ reservation; settle 0 = released) ----
  const ledger = W.ledger = { open: new Map(), spend: new Map(), log: [],
    reserve: async (rid, n) => { ledger.open.set(rid, n); ledger.log.push(["reserve", rid, n]); return { ok: true }; },
    settle: async (rid, n) => { const r = ledger.open.get(rid); ledger.open.delete(rid); ledger.log.push(["settle", rid, n]); if ((r != null || n > 0) && !ledger.spend.has(rid)) ledger.spend.set(rid, Math.min(n, r ?? n)); return {}; },
    spent: () => [...ledger.spend.values()].reduce((a, b) => a + b, 0),
    state: async () => ({ balance_nano: 1e12 }), guardInfo: async () => ({}), dayInfo: async () => ({ spent_nano: 0, reserved_nano: 0, cap_nano: 1e15 }), dayCheckin: async () => ({}) };
  // ---- scripted model ----
  W.brain = () => "Done.";
  W.calls = [];
  const whoOf = (messages) => { if (/^You label one finished task/.test(String(messages[0]?.content || ""))) return "label";
    const last = messages.filter((m) => m.role === "user").at(-1); const t = typeof last?.content === "string" ? last.content : last?.content?.[0]?.text || "";
    const all = messages.filter((m) => m.role === "user").map((m) => typeof m.content === "string" ? m.content : m.content?.[0]?.text || "").join("\n");
    return /^\(Turn finished; the person has your reply/.test(t) ? "notes" : /^\(Context checkpoint/.test(t) ? "checkpoint" : /\[Helper job #\d+/.test(all) ? "helper" : "main"; };
  const sse = (objs) => new Response(objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n").body;
  W.env = { ONEHELM_EE: "1hc", DB: D1, MEMORY: "off", GENUI: "off", WORKMEM: "off", COMPOSIO_KEY: "test", MODEL: "@cf/test/model", CLEF_DOORS: "off", ENGINE: engine, SKEW_WAIT_MS: 1,
    LEDGER: { idFromName: (n) => n, get: () => ledger },
    AI: { run: async (_model, body) => {
      const who = whoOf(body.messages), c = { who, tools: (body.tools || []).map((t) => t.function?.name || t.name), messages: body.messages };
      W.calls.push(c);
      let s = who === "label" ? '{"title":"Labelled task","result":"Done","summary":"It was done.","why":{}}' : who === "notes" ? "- notes" : who === "checkpoint" ? "notes so far" : await W.brain({ who, messages: body.messages, tools: c.tools, n: W.calls.filter((x) => x.who === who).length });
      if (s === HANG) return never();
      if (typeof s === "string") s = { content: s };
      const usage = { prompt_tokens: s.usage ?? 1000, completion_tokens: 10 };
      const ev = [];
      if (s.content) ev.push({ choices: [{ delta: { content: s.content } }] });
      (s.calls || []).forEach(([name, args], i) => ev.push({ choices: [{ delta: { tool_calls: [{ index: i, id: `call_${W.calls.length}_${i}`, function: { name, arguments: JSON.stringify(args) } }] } }] }));
      ev.push({ choices: [{ delta: {}, finish_reason: s.calls?.length ? "tool_calls" : "stop" }], usage });
      return sse(ev);
    } }, ...(openrouter ? { OPENROUTER_API_KEY: "k", MODEL_SETTINGS: SEED } : {}), ...extraEnv };
  if (openrouter) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/systemone")) return Response.json({ model: JSON.parse(init.body).model, answers: { is_task: { noul: 1 }, category: { choice: "general" }, unmet: { noul: 0 } }, usage: { cost: 0 } });   // the decider (route2): a fixed local answer, never the network
      if (!String(url).endsWith("/chat/completions")) return realFetch(url, init);
      const body = JSON.parse(init.body);
      for (const m of body.messages || []) if (Array.isArray(m.content) && m.content.every((c) => c.type === "text")) m.content = m.content.map((c) => c.text).join("");   // cache-marked text parts back to a string
      const stream = await W.env.AI.run(body.model, body);
      if (body.stream) return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      if (stream && typeof stream.pipeThrough !== "function") return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: stream.response ?? "" } }], usage: { prompt_tokens: 500, completion_tokens: 50, cost: 0.0001, ...(stream.usage || {}) } });   // a test's own whole-answer stand-in ({ response, usage })
      let text = "", buf = ""; const rd = stream.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) { const { value, done } = await rd.read(); if (done) break; buf += value; }
      for (const l of buf.split("\n")) if (l.startsWith("data: ") && l !== "data: [DONE]") text += JSON.parse(l.slice(6)).choices?.[0]?.delta?.content || "";
      return Response.json({ model: body.model, choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 500, completion_tokens: 50, cost: 0.0001 } });
    };
  }
  // ---- the Durable Object's storage, shared by every instance; each boot gets its own epoch ----
  const dodb = W.dodb = new DatabaseSync(":memory:");
  let epoch = 0; W.alarmAt = null;
  const sqlFor = (my) => ({ exec: (q, ...a) => {
    if (my !== epoch) throw new Error(RESET);   // a reset object can't touch storage any more
    if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)|\bRETURNING\b/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } });
  // ---- tools the test scripts: reads and sends that can hang mid-call ----
  W.sent = []; W.searched = []; W.hangSend = false; W.hangSearch = false; W.texted = []; W.execs = [];
  W.tools = {
    web_search: async (a) => { W.searched.push(a.query); if (W.hangSearch) { W.hangSearch = false; return never(); } return `results for ${a.query}: sunny, 21C`; },
    // Synthetic payment through the REAL gate: ordinary email no longer asks.
    // No provider runs; the irreversible effect recorder can hang mid-call.
    app_run: async (a, ctx, R) => {
      assert.equal(a.action, "PAYPAL_CREATE_PAYMENT", "fixture intercepts only the protected synthetic payment");
      const payload = { action: a.action, arguments: a.arguments, account: "fixture-payment-account" };
      const no = await confirmGate(R, ctx, { tool: "app_run", payload, args: { action: a.action, arguments: a.arguments }, view: { title: "Confirm fixture payment?" }, token: a.confirm_token || null });
      if (no) return no;
      W.sent.push(payload); if (W.hangSend) { W.hangSend = false; return never(); }
      return "Fixture payment completed.";
    },
  };
  W.execOpts = []; W.reattached = [];
  W.computer = { execs: W.execs, onExec: null, onReattach: null, exec: async (cmd, o = {}) => { W.execs.push(cmd); W.execOpts.push(o); const r = W.computer.onExec ? await W.computer.onExec(cmd, o) : null; return r || { code: 0, out: `ran: ${cmd}` }; },
    reattach: async (run, o) => { W.reattached.push([run, o]); return W.computer.onReattach ? W.computer.onReattach(run, o) : { lost: true }; },
    browser: async () => ({ ok: true }), warm: async () => ({ ok: true }), save: async () => ({}), touch: async () => {}, stop: async () => {} };
  W.boot = () => {
    const my = ++epoch, waits = [];
    const ctx = { id: { toString: () => "do-test-id-0000000000000000" }, storage: { sql: sqlFor(my), transactionSync: (f) => { if (my !== epoch) throw new Error(RESET); return transactionSyncFor(dodb)(f); }, getAlarm: async () => W.alarmAt,
      setAlarm: async (t) => { if (my !== epoch) throw new Error(RESET); W.alarmAt = t; }, deleteAlarm: async () => { if (my === epoch) W.alarmAt = null; } }, waitUntil: (p) => waits.push(p) };
    const R = new Resident(ctx, W.env); R._waits = waits; R._epoch = my;
    R.systemPrompt = async () => "SYSTEM"; R.computer = () => W.computer; R.syncFiles = async () => {};
    R.deliverTextReply = async (_t, _c, r) => { W.texted.push(r?.reply ?? ""); return { ok: true }; };
    R.textApproval = async () => false;
    const inner = Resident.prototype.localToolInner;
    R.localToolInner = async function (name, a, c) { return W.tools[name] ? W.tools[name](a, c, R) : inner.call(this, name, a, c); };
    if (!R.get("tenant")) { R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1"); }
    if (engine) R.put("engine", engine);
    W.R = R; return R;
  };
  W.kill = () => { epoch++; };   // the deploy: every instance so far is reset
  W.settle = async (R = W.R) => { for (let i = 0; i < 600; i++) { const n = R._waits.length; await Promise.all(R._waits.map((p) => Promise.resolve(p).catch(() => {}))); await tick(2); if (R._waits.length === n && ![...R.active.values()].some((t) => !t.finished)) break; } };
  W.until = async (f, ms = 3000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${f}`); await tick(5); } };
  W.card = (id) => dodb.prepare("SELECT * FROM cards WHERE id=?").get(id);
  W.cards = () => dodb.prepare("SELECT * FROM cards ORDER BY opened, rowid").all();
  W.turns = () => dodb.prepare("SELECT * FROM turns ORDER BY at, rowid").all();
  W.msgs = (turn) => dodb.prepare("SELECT * FROM msgs WHERE turn=? ORDER BY seq").all(turn);
  W.boot();
  return W;
}
export { assert };
