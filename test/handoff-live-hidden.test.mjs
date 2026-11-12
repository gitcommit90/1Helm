// node --import ./test/stubs/register.mjs test/handoff-live-hidden.test.mjs
// A handoff turn (a helper's report, a due follow-up, a browser job result) starts from "(Context note, not from the person: ...)"
// text written for the model. The task history never shows it. This checks the live view (sessionDetail().live, which the app
// uses to show a running turn) agrees with the history for every handoff kind, and that a person's own message still shows.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { sealSecret } from "../src/sentinel.js";

// ---- D1 (texting connected) ----
const d1 = new DatabaseSync(":memory:");
d1.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8").match(/CREATE TABLE IF NOT EXISTS texting \([\s\S]*?\n\);\nCREATE TABLE IF NOT EXISTS texting_seen[^\n]*/)[0]);   // only the texting tables of the public schema
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam');");
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const OWNER = "+14155550123";
const env = { ONEHELM_EE: "1hc", DB: D1, WS: { get: async () => null, put: async () => {}, delete: async () => {} }, GATEWAY_HOST: "owner.example.com", APP_HOST: "owner.example.com", MEMORY: "off", GENUI: "off", WORKMEM: "off",
  VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64") };
d1.prepare("INSERT INTO texting (tenant_id,hook_id,phone,status,project_id,project_secret_sealed,webhook_secret_sealed,updated_at) VALUES ('t1','hook1',?,'connected','proj1',?,?,0)").run(OWNER, await sealSecret(env, "sec1"), await sealSecret(env, "whsec"));

// ---- the Resident, on node:sqlite ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = []; const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
let R = new Resident(ctx, env);
const setup = (r) => { r.systemPrompt = async () => "SYSTEM"; r.callModel = model; const lt = r.localTool.bind(r); r.localTool = async (name, a, c) => { spy.push({ name, a }); if (["list_workflows", "work_log"].includes(name) && toolGate) { const g = toolGate; toolGate = null; await g; } return lt(name, a, c); }; };

// ---- scripted model ----
// Entries: "final text" | T([name, args], …) (tool calls) | { wait: promise, then: entry } | { throw: "msg" }. Hand-off notes
// calls (600 max tokens, tools off) answer from notesHook. Every call is recorded with its messages and the tools offered.
let script = [], calls = [], spy = [], toolGate = null, notesHook = null;
const T = (...cs) => ({ calls: cs });
let cn = 0;
async function model(messages, _w, onText, noTools, tc) {
  if (noTools && String(messages.at(-1)?.content).startsWith("(Turn finished")) { if (notesHook) { const h = notesHook; notesHook = null; await h(); } return { content: "- notes", calls: [], inTok: 1, cached: 0, outTok: 1, charge: 0, finish: "stop" }; }
  calls.push({ messages: JSON.parse(JSON.stringify(messages)), noTools: !!noTools, tools: noTools ? null : this.modelTools(tc) });
  let s = script.shift() ?? "Done.";
  while (s && s.wait) { await s.wait; s = s.then; }
  if (s && s.throw) throw new Error(s.throw);
  if (typeof s === "string") { if (s) onText?.(s); return { content: s, calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" }; }
  return { content: s.content || "", calls: s.calls.map(([name, args]) => ({ id: `call_${++cn}`, type: "function", function: { name, arguments: JSON.stringify(args) } })), inTok: 10, cached: 0, outTok: 3, charge: s.charge || 0, finish: "tool_calls" };
}
setup(R); R.spendRefresh = async () => false; R.spendStart = async () => {};   // no Ledger object in this test

// ---- Photon, faked at fetch (texting) ----
const wire = [];
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.includes("/imessage/tokens")) return new Response(JSON.stringify({ data: { token: "tok", expiresIn: 900 } }), { status: 200 });
  const m = u.match(/photon\.imessage\.v1\.(\w+)\/(\w+)$/);
  if (m) { wire.push({ method: m[2], body: Buffer.from(init.body).subarray(5) }); return new Response(`spc-msg-${crypto.randomUUID()}`, { status: 200, headers: { "grpc-status": "0" } }); }
  throw new Error(`unexpected fetch ${u}`);
};
const log0 = console.log; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" ")) || process.env.DBG) log0(...a); };

// ---- helpers ----
const gate = () => { let open; const p = new Promise((z) => { open = z; }); return { p, open }; };
const until = async (f, what = "condition") => { for (let i = 0; i < 400; i++) { await new Promise((z) => setTimeout(z, 5)); if (await f()) return; } throw new Error(`timed out waiting for ${what}`); };
function collect(readable) {
  const ev = [], rd = readable.getReader(), dec = new TextDecoder(); let buf = "";
  const done = (async () => { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) ev.push(JSON.parse(l)); } } })();
  return { ev, done, cancel: () => rd.cancel() };
}
const stream = async (session, text, opts = {}) => { const r = await R.chatStream("t1", "main", "1", text, { session, ...opts }); return r instanceof ReadableStream ? collect(r) : r; };
const events = (card) => dodb.prepare("SELECT * FROM card_events WHERE card=? ORDER BY seq").all(card);
const card = (id) => dodb.prepare("SELECT * FROM cards WHERE id=?").get(id);
const turnRows = (id) => dodb.prepare("SELECT * FROM turns WHERE id=?").all(id);
const userMsgs = (c) => c.messages.filter((m) => m.role === "user").map((m) => typeof m.content === "string" ? m.content : m.content.find((x) => x.type === "text")?.text || "");
const toolMsgs = (c) => c.messages.filter((m) => m.role === "tool");
const texts = (from) => wire.slice(from).filter((w) => w.method === "SendTextMessage").map((w) => w.body.toString("utf8"));
async function scenario(name, fn) { script = []; calls = []; spy = []; toolGate = null; notesHook = null; await fn(); console.log("  ok", name); }
let sn = 0; const newTask = async (t) => (await R.createSession(`${t} ${++sn}`)).id;
import { handoffAwayText, handoffSteerText } from "../src/helpers.js";
import { followupText } from "../src/helpers.js";

const NOTE = /Context note, not from the person/;
const rep = { id: 1, name: "Find Eiffel Tower night images", status: "done", report: "Job complete, 3 images found.\n\n**Search command used:** `python3 images.py`" };
const kinds = [
  ["helper (away)", { text: handoffSteerText(rep, 0), away: handoffAwayText(rep, 0), ref: "1", from: { type: "helper", id: 1, title: rep.name } }],
  ["follow-up", { text: followupText("check the oven"), from: { type: "followup", workflow_id: 9, title: "Oven" } }],
  ["browser job", { text: "(Context note, not from the person: browser job #3 finished.)", away: "(Context note, not from the person: browser job #3 finished while you were away.)", ref: "c3", from: { type: "browser_job", id: 3, title: "Browser job" } }],
  ["connect", { text: "(Context note, not from the person: they just connected Gmail.)", from: { type: "connect", title: "App connected" } }],
];
await scenario("setup: one ordinary turn so the Resident knows its tenant", async () => { const s = await newTask("prime"); script = ["Hi."]; await (await stream(s, "hello")).done; });
for (const [name, inp] of kinds) await scenario(`${name}: live view hides the context note, history agrees, the reply shows`, async () => {
  const s = await newTask(name), g = gate();
  script = [{ wait: g.p, then: "Your helper found 3 images." }];
  const h = R.handoff(s, inp); assert.equal(h.mode, "open");
  await until(() => calls.length >= 1, "model call");
  assert.match(userMsgs(calls[0]).at(-1), NOTE, "the model still gets the note");
  const live = (await R.sessionDetail(s)).live;
  assert.ok(live, "the turn is live"); assert.equal(live.card.kind, "handoff");
  assert.equal(live.user_text, null, "no visible user message while live");
  assert.ok(!JSON.stringify(live).includes("Context note") || !live.user_text, "no note in user_text");
  g.open(); await h.run;
  const d = await R.sessionDetail(s);
  assert.equal(d.live, null);
  const t = d.turns.find((x) => x.card === h.card.id);
  assert.ok(t, "the turn is in history"); assert.equal(t.reply, "Your helper found 3 images.");
  assert.deepEqual(t.msgs, [], "no user message in history"); assert.equal(t.user_text, null);
  for (const x of d.turns) { assert.ok(!NOTE.test(x.user_text || ""), "history user_text"); for (const m of x.msgs || []) assert.ok(!NOTE.test(m.text || ""), "history msgs"); }
});

await scenario("a person's own message still shows live and in history", async () => {
  const s = await newTask("normal"), g = gate();
  script = [{ wait: g.p, then: "Hello there." }];
  const c = await stream(s, "hi, please say hello", { session: s });
  await until(() => calls.length >= 1, "model call");
  const live = (await R.sessionDetail(s)).live;
  assert.equal(live.card.kind, "chat"); assert.match(live.user_text, /say hello/);
  g.open(); await c.done;
  const d = await R.sessionDetail(s);
  assert.match(d.turns.at(-1).msgs[0].text, /say hello/); assert.equal(d.turns.at(-1).reply, "Hello there.");
});

await scenario("a person's message typed into a running handoff card still shows", async () => {
  const s = await newTask("steer"), g = gate();
  script = [{ wait: g.p, then: "ok" }, "Noted."];
  const h = R.handoff(s, kinds[0][1]);
  await until(() => calls.length >= 1, "model call");
  const r = R.steerOrOpen(s, { type: "msg", text: "also make them black and white", cid: "c-steer-1" });
  assert.equal(r.mode, "steer");
  const ev = (await R.sessionDetail(s)).live.card.events;
  assert.ok(ev.some((e) => e.type === "msg" && /black and white/.test(e.text)), "the person's steer is in the live card events (the app renders these)");
  g.open(); await h.run;
});
console.log("handoff live view: ok"); process.exit(0);
