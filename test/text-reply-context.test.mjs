// node --import ./test/stubs/register.mjs test/text-reply-context.test.mjs
// A text the app sends from a task (a workflow run, a reminder, a "needs you" notice) is recorded with its task. A plain text answer,
// even many hours later, goes to that task with the alert quoted, so the helper can carry on. Judged on app facts only: which task
// the answer was routed to, what the turn received (quote, helper note), the numbered question, and what is stored or deleted.
// Real Resident SQL; Photon faked at fetch (nothing is sent to a real phone); no model calls (textTurn is replaced by a recorder).
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { notifyTask } from "../src/notify.js";
import { sealSecret } from "../src/sentinel.js";
import { openAlerts, recordTextAlert, dropTextAlerts } from "../src/text-alerts.js";

const d1 = new DatabaseSync(":memory:");
d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT);
  CREATE TABLE texting (tenant_id TEXT PRIMARY KEY, status TEXT, phone TEXT, project_id TEXT, project_secret_sealed TEXT);
  CREATE TABLE notif_prefs (tenant_id TEXT PRIMARY KEY, prefs TEXT);
  INSERT INTO tenants VALUES ('owner','ck1','Skipper','Sam');`);
const env = { VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64"), ENV_NAME: "dev", ONEHELM_EE: "1hc", MEMORY: "off", GENUI: "off", WORKMEM: "off" };
d1.prepare("INSERT INTO texting VALUES ('owner','connected','+14155550123','proj1',?)").run(await sealSecret(env, "sec1"));
env.DB = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
const sent = [];
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.includes("/imessage/tokens")) return new Response(JSON.stringify({ data: { token: "tok", expiresIn: 900 } }), { status: 200 });
  const m = u.match(/photon\.imessage\.v1\.MessageService\/(\w+)$/);
  if (m) { sent.push(Buffer.from(init.body).toString("latin1")); return new Response(`spc-msg-${crypto.randomUUID()}`, { status: 200, headers: { "grpc-status": "0" } }); }
  throw new Error(`unexpected fetch ${u}`);
};
function resident() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
  const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil() {} }, env);
  R.put("tenant", "owner"); R.put("channel", "main"); R.put("channel_id", "1");
  R.turnsSeen = []; R.textTurn = async (tenant, channel, channelId, text, opts) => { R.turnsSeen.push({ text, opts }); return { ok: true }; };
  return R;
}
const inbound = (R, text, id = crypto.randomUUID(), extra = {}) => R.textInbound("owner", "main", "1", { id: `spc-msg-${id}`, timestamp: Date.now(), text, ...extra });
const alertRow = (R, session) => R.sql.exec("SELECT * FROM text_alerts WHERE session=? ORDER BY id DESC", session).toArray()[0];
const hoursAgo = (R, h) => R.sql.exec("UPDATE text_alerts SET at=at-?", h * 36e5);
// What a workflow run does when the helper calls text_person (the real tool, delivered through the faked Photon).
const workflowText = async (R, session, msg, expects_reply = true) => {
  const workflow_id = R.addWorkflow({ kind: "workflow", name: "Text when something happens", prompt: "x", interval_seconds: 300, next_run: Date.now() + 3e5, session });
  return R.localTool("text_person", { message: msg, expects_reply }, { kind: "workflow", workflow_id, session, turn: `card-${session}` });
};
let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const CLINIC = 'BNI Clinics replied to "Appointment request with Dr. Alavi": Dr. Alavi\'s next opening is Thursday Oct 29 at 6:20 PM. Reply to the email to confirm if that works. A reply is needed.';

await test("an alert texted from a workflow run is recorded with its task, and a plain answer 10 hours later goes to that task with the alert quoted", async () => {
  const R = resident(), alavi = R.newSession("Requesting Appointment with Dr. Alavi"), texts = R.newSession("Text with Skipper"); R.put("texts_session", texts);
  const out = await workflowText(R, alavi, CLINIC); assert.match(out, /^Sent/);
  assert.equal(sent.length > 0, true);
  const a = alertRow(R, alavi); assert.equal(a.state, "open"); assert.equal(a.text, CLINIC); assert.ok(a.workflow_id > 0); assert.equal(a.kind, "workflow"); assert.match(a.guid, /^spc-msg-/);
  hoursAgo(R, 10);
  await inbound(R, "reply with a one sentance confirmation, then when you're done, put it on my Google calendar");
  assert.equal(R.turnsSeen.length, 1); const { opts, text } = R.turnsSeen[0];
  assert.equal(opts.session, alavi, "routed to the task that sent the text, not Text with Skipper");
  assert.equal(opts.reply.role, "agent"); assert.ok(opts.reply.text.startsWith("BNI Clinics replied"));
  assert.ok(opts.note.includes("next opening is Thursday Oct 29 at 6:20 PM") && opts.note.includes("Requesting Appointment with Dr. Alavi"), "the helper reads the whole alert and the task");
  assert.equal(text, "reply with a one sentance confirmation, then when you're done, put it on my Google calendar");
  assert.equal(alertRow(R, alavi).state, "answered");
});

await test("a text with no alert behind it still goes to the Texts task, and the phone's own reply feature is not overridden", async () => {
  const R = resident(), texts = R.newSession("Text with Skipper"); R.put("texts_session", texts);
  await inbound(R, "what's the weather"); assert.equal(R.turnsSeen[0].opts.session, undefined);
  const other = R.newSession("Other"); recordTextAlert(R, { session: other, text: "alert" });
  await inbound(R, "quoted", "x1", { reply: { target: { id: "unknown-guid" } }, photon_target: { id: "unknown-guid" } });
  assert.equal(R.turnsSeen[1].opts.session, undefined, "a phone reply target is handled by photon-replies.js, never by alert inference");
  assert.equal(alertRow(R, other).state, "open");
});

await test("a task's own Texts-task replies are never recorded as alerts", async () => {
  const R = resident(), texts = R.newSession("Text with Skipper"); R.put("texts_session", texts);
  assert.equal(recordTextAlert(R, { session: texts, text: "hello" }), null); assert.equal(R.sql.exec("SELECT COUNT(*) n FROM text_alerts").one().n, 0);
  assert.equal(recordTextAlert(R, { session: "no-such-task", text: "hello" }), null);
});

await test("two open alerts from two tasks: the app asks one numbered question and holds the text; the number routes the held text to that task", async () => {
  const R = resident(), A = R.newSession("Dr. Alavi appointment"), B = R.newSession("Flight check"); R.put("texts_session", R.newSession("Text with Skipper"));
  await workflowText(R, A, "The clinic offered Thursday at 6:20 PM. Reply to confirm.");
  await new Promise((z) => setTimeout(z, 5)); await workflowText(R, B, "Your flight dropped to $212. Want me to book it?");
  const before = sent.length;
  const r = await inbound(R, "yes do it");
  assert.equal(r.asked, true); assert.equal(R.turnsSeen.length, 0, "nothing runs until they choose");
  assert.equal(sent.length, before + 1, "exactly one question texted"); assert.ok(sent.at(-1).includes("Which one is this about?"));
  assert.ok(sent.at(-1).includes("Dr. Alavi appointment") && sent.at(-1).includes("Flight check") && sent.at(-1).includes("Something new"));
  await inbound(R, "1"); assert.equal(R.turnsSeen.length, 1);   // the list is newest first
  assert.equal(R.turnsSeen[0].opts.session, B); assert.equal(R.turnsSeen[0].text, "yes do it", "the held text, not the number, reaches the helper");
  assert.ok(R.turnsSeen[0].opts.note.includes("flight dropped to $212"));
  assert.equal(alertRow(R, B).state, "answered"); assert.equal(alertRow(R, A).state, "open", "the other alert stays open");
});

await test("after a reply is routed the conversation stays with that task for two hours; later, the one remaining open alert is used", async () => {
  const R = resident(), A = R.newSession("Task A"), B = R.newSession("Task B"); R.put("texts_session", R.newSession("Text with Skipper"));
  await workflowText(R, A, "A needs you."); await new Promise((z) => setTimeout(z, 5)); await workflowText(R, B, "B needs you.");
  await inbound(R, "about B"); await inbound(R, "1");   // list is newest first: 1 = Task B
  assert.equal(R.turnsSeen[0].opts.session, B);
  const r = await inbound(R, "and one more thing"); assert.equal(r.asked, undefined); assert.equal(R.turnsSeen[1].opts.session, B, "same task inside the two hours, although A is still open");
  R.put("text_focus", JSON.stringify({ session: B, at: Date.now() - 3 * 36e5 }));
  await inbound(R, "much later"); assert.equal(R.turnsSeen[2].opts.session, A, "only A is still open");
});

await test("a reply about something new: 0 sends the held text to the Texts task and closes the open alerts", async () => {
  const R = resident(), A = R.newSession("Task A"), B = R.newSession("Task B"), T = R.newSession("Text with Skipper"); R.put("texts_session", T);
  await workflowText(R, A, "A needs you."); await new Promise((z) => setTimeout(z, 5)); await workflowText(R, B, "B needs you.");
  await inbound(R, "what's a good pizza place"); await inbound(R, "0");
  assert.equal(R.turnsSeen.length, 1); assert.equal(R.turnsSeen[0].opts.session, undefined); assert.equal(R.turnsSeen[0].text, "what's a good pizza place");
  assert.equal(alertRow(R, A).state, "moved_on"); assert.equal(alertRow(R, B).state, "moved_on");
  await inbound(R, "thanks"); assert.equal(R.turnsSeen[1].opts.session, undefined, "no open alert is left to claim it");
});

await test("an answer that is not a number cancels the question; the helper in the Texts task is told what was held", async () => {
  const R = resident(), A = R.newSession("Task A"), B = R.newSession("Task B"); R.put("texts_session", R.newSession("Text with Skipper"));
  await workflowText(R, A, "A needs you."); await workflowText(R, B, "B needs you.");
  await inbound(R, "first thing"); await inbound(R, "actually never mind, different question");
  assert.equal(R.get("text_choice"), "", "the held text is cleared");
  assert.ok(R.turnsSeen.at(-1).opts.note.includes("first thing"), "the helper learns what was held");
});

await test("the source task deleted or finished: the text goes to the Texts task with the alert in the helper's note", async () => {
  const R = resident(), A = R.newSession("Dr. Alavi"), T = R.newSession("Text with Skipper"); R.put("texts_session", T);
  await workflowText(R, A, CLINIC);
  R.sql.exec("DELETE FROM sessions WHERE id=?", A);
  await inbound(R, "ok confirm it");
  const t = R.turnsSeen[0]; assert.equal(t.opts.session, undefined); assert.ok(t.opts.note.includes("next opening is Thursday Oct 29"), "the helper still sees what was texted");
  assert.equal(alertRow(R, A).state, "gone");
  const B = R.newSession("Task B"); await workflowText(R, B, "B needs you."); R.sql.exec("UPDATE sessions SET done=1 WHERE id=?", B);
  await inbound(R, "yes"); assert.equal(R.turnsSeen[1].opts.session, undefined); assert.ok(R.turnsSeen[1].opts.note.includes("B needs you"));
});

await test("a reply-expecting alert older than two days is not used; a text question asked after the alert keeps its own routing", async () => {
  const R = resident(), A = R.newSession("Task A"); R.put("texts_session", R.newSession("Text with Skipper"));
  await workflowText(R, A, "A needs you."); hoursAgo(R, 49);
  await inbound(R, "hello"); assert.equal(R.turnsSeen[0].opts.session, undefined); assert.equal(alertRow(R, A).state, "expired");
  const R2 = resident(), C = R2.newSession("Task C"); R2.put("texts_session", R2.newSession("Text with Skipper"));
  await workflowText(R2, C, "C needs you."); await new Promise((z) => setTimeout(z, 5));
  R2.sql.exec("INSERT INTO user_questions (id,session,source_turn,question,status,created,via) VALUES ('q1',?,?,'Which one?','pending',?, 'text')", C, "turn-q", Date.now());
  await inbound(R2, "the first");
  assert.equal(alertRow(R2, C).state, "open", "the pending text question owns this answer");
});

await test("a 'task needs you' notice texted by notifyTask is only context: it never captures a reply", async () => {
  const R = resident(), A = R.newSession("Book the dentist"), T = R.newSession("Text with Skipper"); R.put("texts_session", T);
  const out = await notifyTask(R, A, "needs", { why: "question", reply: "Which day works?" }); assert.equal(out.texted, true);
  const a = alertRow(R, A); assert.equal(a.kind, "question"); assert.equal(a.expects, 0); assert.ok(a.text.includes("Book the dentist"));
  await inbound(R, "Friday"); assert.equal(R.turnsSeen[0].opts.session, undefined);
  assert.ok(R.turnsSeen[0].opts.note.includes("Book the dentist"), "the Texts task's helper reads the notice");
});

await test("a report that asks for nothing, then an unrelated text: it stays in the Texts task with the notice as context, no question asked", async () => {
  const R = resident(), A = R.newSession("Daily report"), B = R.newSession("Other report"), T = R.newSession("Text with Skipper"); R.put("texts_session", T);
  await workflowText(R, A, "Daily report: 3 new emails.", false); await workflowText(R, B, "Other report: nothing urgent.", false);
  const before = sent.length;
  const r = await inbound(R, "thanks, do it");
  assert.equal(r.asked, undefined); assert.equal(sent.length, before, "no question texted"); assert.equal(R.turnsSeen[0].opts.session, undefined);
  assert.ok(R.turnsSeen[0].opts.note.includes("Daily report: 3 new emails.") && R.turnsSeen[0].opts.note.includes("Other report: nothing urgent."));
  assert.equal(alertRow(R, A).state, "open", "a notice is never answered or closed");
});

await test("one reply-expecting alert plus one notice: the reply routes to the alert's task without a question", async () => {
  const R = resident(), A = R.newSession("Dr. Alavi"), B = R.newSession("Daily report"); R.put("texts_session", R.newSession("Text with Skipper"));
  await workflowText(R, A, CLINIC, true); await new Promise((z) => setTimeout(z, 5)); await workflowText(R, B, "Daily report: all quiet.", false);
  const before = sent.length; const r = await inbound(R, "confirm it");
  assert.equal(r.asked, undefined); assert.equal(sent.length, before); assert.equal(R.turnsSeen[0].opts.session, A);
});

await test("the numbered question also appears in the Texts task, so the app reads like the phone", async () => {
  const R = resident(), A = R.newSession("Task A"), B = R.newSession("Task B"), T = R.newSession("Text with Skipper"); R.put("texts_session", T);
  await workflowText(R, A, "A needs an answer."); await new Promise((z) => setTimeout(z, 5)); await workflowText(R, B, "B needs an answer.");
  await inbound(R, "yes");
  const line = R.sql.exec("SELECT reply FROM turns WHERE session=? AND kind='livenote'", T).toArray()[0];
  assert.ok(line && line.reply.includes("Which one is this about?") && line.reply.includes("Task A") && line.reply.includes("Task B"));
});

await test("deleting the task deletes its recorded alerts and its focus", async () => {
  const R = resident(), A = R.newSession("Task A"); await workflowText(R, A, "A needs you."); R.put("text_focus", JSON.stringify({ session: A, at: Date.now() }));
  dropTextAlerts(R, A); assert.equal(R.sql.exec("SELECT COUNT(*) n FROM text_alerts").one().n, 0); assert.equal(R.get("text_focus"), "");
  assert.deepEqual(openAlerts(R).open, []);
});
console.log(`text-reply-context: ${n} ok`);
