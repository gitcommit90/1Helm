// node --import ./test/stubs/register.mjs test/text-cards.test.mjs
// Nothing that waits for the person may wait only in the app when the turn started from a text. The real Resident (node:sqlite) runs
// texting turns through the real textingWebhook with Photon faked at fetch (every Photon call recorded). Checks, one per kind of
// output that needs the person: a GenUI card reply, an interview,
// a texted approval answered by "1", a plan answered by "deny", an approval asked while the app is open, a connect offer whose reply
// has no link, a share offer, a task left waiting on the browser, and the failure paths (the app card refused, the card unsaveable).
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs"; import { createHmac } from "node:crypto";
import { Resident } from "../src/resident.js";
import { textingWebhook } from "../src/ee/texting.js";
import { sealSecret } from "../src/sentinel.js";
import { createHmac as _h } from "node:crypto";
import { textWaitingNotices } from "../src/text-cards.js";
import { askPerson, HOLD } from "../src/perms.js";

// ---- D1 ----
const d1 = new DatabaseSync(":memory:");
d1.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT); INSERT INTO tenants VALUES ('t1','ck1','Ollie','Sam');"); d1.exec("ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");   // billing: only an active plan runs turns (pastdue.js)
d1.exec(readFileSync(new URL("../db/migrations/0001_012_full_schema_dev.sql", import.meta.url), "utf8")); d1.exec(readFileSync(new URL("../db/migrations/0014_024_texting_service.sql", import.meta.url), "utf8"));   // the public schema (tenants is made above)
const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
  run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const OWNER = "+14155550123", HOOK = "hook1", WHSEC = "whsec_test";
const r2 = new Map();
const readAll = async (b) => b == null ? new Uint8Array(0) : b instanceof Uint8Array ? b : new Uint8Array(await new Response(b).arrayBuffer());
const WS = { put: async (k, b, o) => { r2.set(k, { bytes: await readAll(b), meta: o }); }, get: async (k) => { const o = r2.get(k); return o ? { size: o.bytes.length, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.length), body: new Response(o.bytes).body } : null; }, delete: async (ks) => { for (const k of [].concat(ks)) r2.delete(k); } };
const env = { ONEHELM_EE: "1hc", DB: D1, WS, GATEWAY_HOST: "app.example.test", APP_HOST: "app.example.test", MEMORY: "off", GENUI: "off", WORKMEM: "off", VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64") };
d1.prepare("INSERT INTO texting (tenant_id,hook_id,phone,status,project_id,project_secret_sealed,webhook_secret_sealed,updated_at) VALUES ('t1',?,?,'connected','proj1',?,?,0)").run(HOOK, OWNER, await sealSecret(env, "sec1"), await sealSecret(env, WHSEC));

// ---- the General Resident, on node:sqlite ----
const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const waits = []; const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: (p) => waits.push(p) };
const R = new Resident(ctx, env);
R.textFetchOpts = { tries: 1, wait: 10 }; R.textGatherMs = 200;
R.systemPrompt = async () => "SYSTEM";
env.RESIDENT = { idFromName: (n) => n, get: () => R };

// Scripted model: each turn plays its script, one step per model call: [{ react: "like" }, ..., "final text"].
let script = [], seen = [];
const call = (name, args) => ({ id: `c${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
R.callModel = async (messages, _w, onText) => {
  seen.push(messages);
  const s = script.shift() ?? "Done.";
  if (typeof s === "string") { if (s) onText?.(s); return { content: s, calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" }; }
  if (s.call) return { content: "", calls: [call(s.call[0], s.call[1])], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "tool_calls" };
  return { content: "", calls: [call("react", { reaction: s.react })], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "tool_calls" };
};

// ---- Photon, faked at fetch ----
const wire = [];          // every Photon call in order: { method, body }
let failTapback = false, failApp = false;
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.includes("/imessage/tokens")) return new Response(JSON.stringify({ data: { token: "tok", expiresIn: 900 } }), { status: 200 });
  const m = u.match(/photon\.imessage\.v1\.(\w+)\/(\w+)$/);
  if (m) {
    const body = Buffer.from(init.body).subarray(5); wire.push({ method: m[2], body });
    if (m[2] === "SendCustomizedMiniAppMessage" && failApp) return new Response("", { status: 200, headers: { "grpc-status": "9", "grpc-message": "Target%20not%20allowed" } });
    if (m[2] === "SetReaction" && failTapback) return new Response("", { status: 200, headers: { "grpc-status": "9", "grpc-message": "Target%20not%20allowed" } });
    return new Response(`spc-msg-${crypto.randomUUID()}`, { status: 200, headers: { "grpc-status": "0" } });
  }
  throw new Error(`unexpected fetch ${u}`);
};
const logs = []; const log0 = console.log; console.log = (...a) => { logs.push(a.join(" ")); if (/^ {2}ok /.test(a.join(" "))) log0(...a); };

// ---- helpers ----
async function hook(content, id = `spc-msg-${crypto.randomUUID()}`) {
  const raw = JSON.stringify({ event: "messages", message: { id, direction: "inbound", platform: "iMessage", timestamp: new Date().toISOString(), sender: { id: OWNER, platform: "iMessage" }, space: { id: `any;-;${OWNER}`, platform: "iMessage", type: "dm", phone: "shared" }, content } });
  const ts = String(Math.floor(Date.now() / 1000)), sig = "v0=" + createHmac("sha256", WHSEC).update(`v0:${ts}:${raw}`).digest("hex");
  const r = await textingWebhook(new Request(`https://app.example.test/hooks/photon/${HOOK}`, { method: "POST", body: raw, headers: { "x-spectrum-timestamp": ts, "x-spectrum-signature": sig } }), env, ctx, HOOK);
  assert.equal(r.status, 200); return id;
}
async function settle() { for (let i = 0; i < 50; i++) { const n = waits.length; await Promise.all(waits); await R._lastFlush; await R._lastTextRun; await new Promise((z) => setTimeout(z, 5)); if (waits.length === n && !R._textBatch && !R._lastFlush) break; } await R._lastTextRun; }
const texts = (from) => wire.slice(from).filter((w) => w.method === "SendTextMessage").map((w) => w.body.toString("utf8"));
const taps = (from) => wire.slice(from).filter((w) => w.method === "SetReaction");
const lastTurn = () => dodb.prepare("SELECT * FROM turns ORDER BY at DESC, rowid DESC LIMIT 1").get();
async function appTurn(session, text, steps, engine = "classic") {
  script = [...steps]; const ev = [];
  const r = await R.runTurn("t1", "main", "1", text, (o) => ev.push(o), { session, engine });
  return { r, ev, reacts: ev.filter((e) => e.t === "reaction") };
}
async function scenario(name, fn) { await fn(); console.log("  ok", name); }

d1.exec(readFileSync(new URL("../db/migrations/0006_017_cards.sql", import.meta.url), "utf8")); d1.exec(readFileSync(new URL("../db/migrations/0007_018_card_kinds.sql", import.meta.url), "utf8"));
d1.exec(readFileSync(new URL("../db/migrations/0015_025_share.sql", import.meta.url), "utf8"));
R.genuiOn = () => true;
const said = (from) => texts(from).map((t) => t.replace(/^[\s\S]*any;-;\+\d+[^\x20-\x7e]*/, ""));
const kinds = (from) => wire.slice(from).map((w) => w.method);
const outbox = () => dodb.prepare("SELECT * FROM outbox ORDER BY id").all();
const cardSql = (q, ...a) => d1.prepare(q).all(...a);
const tcs = () => dodb.prepare("SELECT * FROM text_cards ORDER BY id").all();

const CARD = 'root = Stack([message, times])\nmessage = Say("What time should I remind you to call Alec and congratulate him on the new job?")\ntimes = Buttons([Button("Around 1 PM today", "one", "primary"), Button("Around 2 PM today", "two", "secondary"), Button("In an hour", "hour", "secondary")])';

await scenario("a texted turn whose reply is a button card: the question and its choices go as a text, the app card follows, and the outbox records it", async () => {
  const w0 = wire.length; script = [CARD];
  await hook({ type: "text", text: "remind me to call Alec after church" }); await settle();
  const t = texts(w0); assert.equal(t.length, 1, JSON.stringify(t));
  assert.ok(t[0].includes("What time should I remind you to call Alec") && t[0].includes("Reply with: Around 1 PM today / Around 2 PM today / In an hour"), t[0]);
  assert.match(t[0], /https:\/\/app\.example\.test\/c\/[A-Za-z0-9_-]{32}/);
  assert.deepEqual(kinds(w0).filter((m) => /Send/.test(m)), ["SendTextMessage", "SendCustomizedMiniAppMessage"]);
  const o = outbox().at(-1); assert.match(o.delivery, /^sent:spc-msg-/); assert.ok(o.turn);
  // Answering by text is a normal message in the same task, the same as the tap of a button (which sends its label).
  const w1 = wire.length; script = ["Done, around 2 PM."]; await hook({ type: "text", text: "Around 2 PM today" }); await settle();
  assert.equal(R.sql.exec("SELECT COUNT(DISTINCT session) n FROM turns").one().n, 1);
  assert.ok(texts(w1).some((x) => x.includes("Done, around 2 PM.")));
});

await scenario("the app card is refused by the provider: the text with the question and choices has already gone", async () => {
  failApp = true; const w0 = wire.length; script = [CARD];
  await hook({ type: "text", text: "remind me again" }); await settle(); failApp = false;
  const t = texts(w0); assert.equal(t.length, 1); assert.ok(t[0].includes("Reply with: Around 1 PM today"));
});

await scenario("the card cannot be saved: the plain text form goes instead of nothing, and the failure is in the log", async () => {
  d1.exec("ALTER TABLE cards RENAME TO cards_off"); const w0 = wire.length, l0 = logs.length; script = [CARD];
  try { await hook({ type: "text", text: "remind me a third time" }); await settle(); } finally { d1.exec("ALTER TABLE cards_off RENAME TO cards"); }
  const t = texts(w0); assert.equal(t.length, 1, JSON.stringify(t)); assert.ok(t[0].includes("What time should I remind you") && t[0].includes("Reply with:"), t[0]);
  assert.ok(logs.slice(l0).some((l) => /text reply delivery failed/.test(l)));
  assert.match(outbox().at(-1).delivery, /^sent:/);
});

await scenario("an interview in a texted turn: its questions go by text with a way to answer by replying", async () => {
  const w0 = wire.length; script = [{ call: ["interview", { title: "Plan the trip", purpose: "Pick dates", questions: [{ id: "a", text: "Which month works?", kind: "text" }, { id: "b", text: "Is a rental car needed?", kind: "yesno" }, { id: "c", text: "Who is coming?", kind: "text" }] }] }, "A few questions are coming."];
  await hook({ type: "text", text: "interview me about the trip" }); await settle();
  const t = texts(w0).join("\n---\n"); assert.ok(t.includes("1. Which month works?") && t.includes("2. Is a rental car needed? (yes or no)") && t.includes("3. Who is coming?") && t.includes("Reply here with your answers"), t);
  assert.ok(kinds(w0).includes("SendCustomizedMiniAppMessage"));
});

// An approval request that goes to the phone: a numbered text, and a text of exactly "1" settles it like a tap and starts no model turn.
const insertApproval = (extra = "") => { const now = Date.now(); dodb.prepare("INSERT INTO approvals (at,host,method,path,bytes,keys,session,via) VALUES (?,?,?,?,?,?,?,?)").run(now, "api.example.org", "POST", "/x", 10, "[]", R.get("texts_session"), "app"); return dodb.prepare("SELECT * FROM approvals ORDER BY id DESC LIMIT 1").get(); };
await scenario("an approval texted from a text turn lists its replies, and \"1\" allows it with no model turn", async () => {
  const a = insertApproval(), w0 = wire.length, turns0 = dodb.prepare("SELECT COUNT(*) n FROM turns").get().n;
  assert.equal(await R.textApproval(a, { viaText: true }), true);
  (R._egressHeld ||= new Set()).add(a.id);   // the command is still held waiting for this answer (egressDecision), so nothing resumes the task
  const t = texts(w0); assert.ok(t[0].includes("Reply 1 to allow once or 2 to deny.") && t[0].includes("api.example.org"), t[0]);
  assert.equal(tcs().at(-1).state, "open");
  const w1 = wire.length; await hook({ type: "text", text: "1" }); await settle();
  assert.equal(dodb.prepare("SELECT status, decision FROM approvals WHERE id=?").get(a.id).status, "approved");
  assert.deepEqual(said(w1), ["Allowed once."]);
  assert.equal(dodb.prepare("SELECT COUNT(*) n FROM turns").get().n, turns0, "no model turn for a card answer");
  assert.equal(tcs().at(-1).state, "answered");
});
await scenario("\"2\" denies; a text that is not exactly a reply goes to the helper as a normal message; two open cards leave a bare number alone", async () => {
  let a = insertApproval(); await R.textApproval(a, { viaText: true }); R._egressHeld.add(a.id);
  let w0 = wire.length; await hook({ type: "text", text: "2" }); await settle();
  assert.equal(dodb.prepare("SELECT status FROM approvals WHERE id=?").get(a.id).status, "denied"); assert.deepEqual(said(w0), ["Not allowed."]);
  a = insertApproval(); await R.textApproval(a, { viaText: true }); R._egressHeld.add(a.id);
  script = ["Sure, tell me more."]; w0 = wire.length; await hook({ type: "text", text: "1 sec, what is this for?" }); await settle();
  assert.equal(dodb.prepare("SELECT status FROM approvals WHERE id=?").get(a.id).status, "pending"); assert.ok(texts(w0).some((x) => x.includes("Sure, tell me more.")));
  const b = insertApproval(); await R.textApproval(b, { viaText: true }); script = ["Which one do you mean?"]; w0 = wire.length;
  await hook({ type: "text", text: "1" }); await settle();
  assert.equal(dodb.prepare("SELECT status FROM approvals WHERE id IN (?,?)").all(a.id, b.id).every((x) => x.status === "pending"), true);
  for (const x of [a, b]) dodb.prepare("UPDATE approvals SET status='denied' WHERE id=?").run(x.id);
});

await scenario("a permission asked in a texted turn goes to the phone even when the app is open, and the notification setting does not stop it", async () => {
  d1.exec("CREATE TABLE IF NOT EXISTS notif_prefs (tenant_id TEXT PRIMARY KEY, needs INTEGER, finished INTEGER, sound INTEGER, needs_text INTEGER, meetings INTEGER); INSERT OR REPLACE INTO notif_prefs VALUES ('t1',1,1,1,0,1)");
  const w0 = wire.length, tc = { session: R.get("texts_session"), turn: "tx-perm", viaText: true, subs: new Set([{ emit() {} }]), emit() {} };
  HOLD.ms = 50; const out = await askPerson(R, tc, "email", "read your email"); HOLD.ms = 120e3;
  const t = texts(w0); assert.ok(t.length === 1 && /Reply 1 to allow once/.test(t[0]), JSON.stringify(t)); assert.match(String(out), /phone/);
  dodb.prepare("UPDATE approvals SET status='denied' WHERE status='pending'").run();
  d1.exec("DELETE FROM notif_prefs");
});

await scenario("a plan texted from a text turn: APPROVE or DENY by text decides it", async () => {
  const items = JSON.stringify([{ i: 1, kind: "task", title: "Draft the packing list" }]);
  dodb.prepare("INSERT INTO plans (session,card,items,status,created,via_text) VALUES (?,?,?,'pending',?,1)").run(R.get("texts_session"), "tx-plan", items, Date.now());
  const id = dodb.prepare("SELECT id FROM plans ORDER BY id DESC LIMIT 1").get().id, w0 = wire.length;
  assert.equal(await R.planText(id), true);
  assert.ok(texts(w0)[0].includes("Draft the packing list") && texts(w0)[0].includes("Reply APPROVE to start all of them or DENY"), texts(w0)[0]);
  const w1 = wire.length; await hook({ type: "text", text: "Deny" }); await settle();
  assert.equal(dodb.prepare("SELECT status FROM plans WHERE id=?").get(id).status, "denied"); assert.equal(said(w1)[0], "Denied. I won't start them.");
});

await scenario("a connect offer: its link is texted when the reply left it out, and not twice when the reply has it", async () => {
  const ses = R.get("texts_session"), now = Date.now();
  dodb.prepare("INSERT INTO connect_offers (at,session,turn,app,name,why,kind,via) VALUES (?,?,?,?,?,?,?,?)").run(now, ses, "tx-co1", "gmail", "Gmail", "So I can read your email.", "oauth", "text");
  const id = dodb.prepare("SELECT id FROM connect_offers ORDER BY id DESC LIMIT 1").get().id;
  dodb.prepare("INSERT INTO cards (id,session,kind,status,title,opened,started) VALUES (?,?,?,?,?,?,?)").run("tx-co1", ses, "chat", "complete", "t", now, now);
  let w0 = wire.length; const sent = await R.textWaitingNotices("t1", { turn: "tx-co1", reply: "I need Gmail connected first." });
  assert.equal(sent.length, 1); assert.ok(texts(w0)[0].includes("Connect Gmail here: https://app.example.test/w/ck1/app?appinfo=gmail&offer=main.") , texts(w0)[0]);
  w0 = wire.length; assert.deepEqual(await R.textWaitingNotices("t1", { turn: "tx-co1", reply: "x" }), []); assert.deepEqual(said(w0), []);
  dodb.prepare("INSERT INTO connect_offers (at,session,turn,app,name,why,kind,via) VALUES (?,?,?,?,?,?,?,?)").run(now, ses, "tx-co1", "notion", "Notion", "", "oauth", "text");
  const id2 = dodb.prepare("SELECT id FROM connect_offers ORDER BY id DESC LIMIT 1").get().id; w0 = wire.length;
  assert.deepEqual(await R.textWaitingNotices("t1", { turn: "tx-co1", reply: `Open https://app.example.test/w/ck1/app?appinfo=notion&offer=${encodeURIComponent(`main.${id2}`)}` }), []); assert.deepEqual(said(w0), []);
});

await scenario("a share offer and a task left waiting on the browser each get a text with the task link", async () => {
  const ses = R.get("texts_session"), now = Date.now();
  d1.prepare("INSERT INTO share_offers (id,tenant_id,channel,session,turn,kind,name,title,status,created_at) VALUES ('so1','t1','main',?,?,?,?,?,'pending',?)").run(ses, "tx-so", "page", "kyoto-trip", "Kyoto trip", now);
  dodb.prepare("INSERT INTO cards (id,session,kind,status,title,opened,started) VALUES (?,?,?,?,?,?,?)").run("tx-so", ses, "chat", "complete", "t", now, now);
  let w0 = wire.length; const sent = await R.textWaitingNotices("t1", { turn: "tx-so", reply: "Prepared it." });
  assert.deepEqual(sent.map((x) => x.kind), ["share_offer"]); assert.ok(texts(w0)[0].includes("publish kyoto-trip") && texts(w0)[0].includes(`/w/ck1/app#/main/s/${ses}`), texts(w0)[0]);
  dodb.prepare("UPDATE sessions SET waiting='browser' WHERE id=?").run(ses);
  dodb.prepare("INSERT INTO cards (id,session,kind,status,title,opened,started) VALUES (?,?,?,?,?,?,?)").run("tx-br", ses, "chat", "complete", "t", now, now);
  w0 = wire.length; const s2 = await R.textWaitingNotices("t1", { turn: "tx-br", reply: "Over to you in the browser." });
  assert.deepEqual(s2.map((x) => x.kind), ["waiting_browser"]); assert.ok(/needs you in the browser/.test(texts(w0)[0]) && texts(w0)[0].includes(`#/main/s/${ses}`), texts(w0)[0]);
  dodb.prepare("UPDATE sessions SET waiting=NULL WHERE id=?").run(ses);
});

await scenario("a focus timer offer in a texted turn is refused (it is an app-only card)", async () => {
  const out = await R.pomoTool({ session: R.get("texts_session"), viaText: true, person_asked: "" }, { action: "offer", work_min: 25 });
  assert.match(String(out), /by text/);
});

console.log = log0;
console.log("text-cards ok");
process.exit(0);
