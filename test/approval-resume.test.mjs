// node --import ./test/stubs/register.mjs test/approval-resume.test.mjs
// A person's decision on a held request after the turn that asked has ended resumes the task once (Resident.decideApproval):
// egress (late approve, late deny, decision while the turn still runs, second decide), plus SSH, confirm, permission and plan cards.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { Resident } from "../src/resident.js";
import { nativeInit } from "../src/native-network.js";
import { permsInit } from "../src/perms.js";
import { confirmInit } from "../src/confirm.js";
import { blockedText } from "../src/egress-policy.js";
import { egressLabel } from "../src/resident.js";

const dodb = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { dodb.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = dodb.prepare(q); const r = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
dodb.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);" + src.match(/CREATE TABLE IF NOT EXISTS approvals[\s\S]*?approval_id INTEGER\);/)[0]);
permsInit(sql); nativeInit(sql); confirmInit(sql); dodb.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,updated INTEGER,done INTEGER,done_at INTEGER,waiting TEXT,seen_at INTEGER); INSERT INTO sessions(id,updated) VALUES('task1',0)");
const R = Object.create(Resident.prototype);
Object.assign(R, { sql, env: { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }) }) } }, active: new Map(), ctx: {} });
R.put("tenant", "t1"); R.put("channel", "main");
R.session = (id) => id === "task1";
let steer = { mode: "open" }; const turns = [];
R.steerOrOpen = (s, input) => (steer.mode === "open" ? { mode: "open", card: { id: "card" + turns.length } } : steer);
R.runTurn = async (tenant, channel, cid, text, x, o) => { turns.push({ text, o }); return { reply: "" }; };
R.cardHandoff = Resident.prototype.cardHandoff;
R.helperAtCard = () => null;
const settle = async () => { await R._lastHandoff?.catch(() => {}); R._lastHandoff = null; };
const reset = () => { turns.length = 0; steer = { mode: "open" }; R._lastHandoff = null; R._egressHeld = new Set(); };
const addEgress = (o = {}) => { sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session) VALUES (?,?,?,?,?,?,?,?)", Date.now(), "api.x.com", "GET", "/2/search", 0, "[]", "turn-a", "task1");
  return sql.exec("SELECT id FROM approvals ORDER BY id DESC LIMIT 1").one().id; };

// 1. Late approve: one resumed turn with the approval note.
reset(); let id = addEgress();
assert.equal((await R.decideApproval(id, "channel")).ok, true); await settle();
assert.equal(turns.length, 1);
assert.equal(turns[0].text, `(Context note, not from the person: they approved GET api.x.com/2/search (request #${id}, this channel); run it again now and continue the task.)`);
assert.equal(turns[0].o.session, "task1");
// A second decide: error, no second turn.
assert.deepEqual(await R.decideApproval(id, "once"), { error: "already approved" }); await settle();
assert.equal(turns.length, 1);

// 2. Late deny: one resumed turn with the deny note.
reset(); id = addEgress();
assert.equal((await R.decideApproval(id, "deny")).ok, true); await settle();
assert.equal(turns.length, 1);
assert.equal(turns[0].text, `(Context note, not from the person: they didn't allow GET api.x.com/2/search (request #${id}); continue the task without it.)`);
assert.deepEqual(await R.decideApproval(id, "deny"), { error: "already denied" }); await settle();
assert.equal(turns.length, 1);

// 3. A turn still running in the task: steered into that turn, no second turn.
reset(); steer = { mode: "steered" }; id = addEgress();
await R.decideApproval(id, "once"); await settle();
assert.equal(turns.length, 0);

// 3b. The hold loop is still waiting on the answer: it reads the status itself, nothing is handed off.
reset(); id = addEgress(); R._egressHeld.add(id);
await R.decideApproval(id, "once"); await settle();
assert.equal(turns.length, 0);

// 3c. Marking the task done denies its pending requests without resuming it.
reset(); id = addEgress(); R._doneSweep = true;
await R.decideApproval(id, "deny"); R._doneSweep = false; await settle();
assert.equal(turns.length, 0);

// 4. A request with no task (scheduled run): unchanged, nobody is told.
reset(); sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session) VALUES (?,?,?,?,?,?,?,?)", Date.now(), "api.x.com", "GET", "/", 0, "[]", "t", null);
id = sql.exec("SELECT id FROM approvals ORDER BY id DESC LIMIT 1").one().id;
assert.equal((await R.decideApproval(id, "once")).ok, true); await settle();
assert.equal(turns.length, 0);

// 5. Permission: late allow and late deny each resume once.
const addPerm = () => { sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session,perm,what) VALUES (?,?,?,?,?,?,?,?,?,?)", Date.now(), "", "PERM", "", 0, "[]", "turn-a", "task1", "email", "read your email");
  return sql.exec("SELECT id FROM approvals ORDER BY id DESC LIMIT 1").one().id; };
reset(); id = addPerm(); await R.decideApproval(id, "once"); await settle(); assert.equal(turns.length, 1); assert.match(turns[0].text, /allowed/);
assert.match((await R.decideApproval(id, "once")).error, /already/); await settle(); assert.equal(turns.length, 1);
reset(); id = addPerm(); await R.decideApproval(id, "deny"); await settle(); assert.equal(turns.length, 1); assert.match(turns[0].text, /did not allow/);

// 6. Confirm: late Confirm and late Cancel each resume once.
const addConfirm = () => { sql.exec("INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session,perm,what,cview) VALUES (?,?,?,?,?,?,?,?,?,?,?)", Date.now(), "", "CONFIRM", "", 0, "[]", "turn-a", "task1", "confirm", "Send this email?", JSON.stringify({ title: "Send this email?", call: { tool: "app_run", args: { action: "X" } } }));
  return sql.exec("SELECT id FROM approvals ORDER BY id DESC LIMIT 1").one().id; };
reset(); id = addConfirm(); await R.decideApproval(id, "once"); await settle(); assert.equal(turns.length, 1);
assert.match((await R.decideApproval(id, "once")).error, /already/); await settle(); assert.equal(turns.length, 1);
reset(); id = addConfirm(); await R.decideApproval(id, "deny"); await settle(); assert.equal(turns.length, 1);

// 6b. SSH: a late deny resumes once (a late allow resumes through completeSsh, covered in approval-cards.test.mjs and native tests).
const addSsh = () => { sql.exec("INSERT INTO approvals (at,host,method,keys,turn,session,perm,what,ssh_data) VALUES (?,?,?,?,?,?,?,?,?)", Date.now(), "s.example", "SSH", "[]", "turn-a", "task1", "ssh", "ops@s.example", JSON.stringify({ user: "ops", host: "s.example", task: "task1", turn: "turn-a", expires: Date.now() + 6e5 }));
  return sql.exec("SELECT id FROM approvals ORDER BY id DESC LIMIT 1").one().id; };
reset(); id = addSsh(); await R.decideApproval(id, "deny"); await settle(); assert.equal(turns.length, 1); assert.match(turns[0].text, /denied SSH/);
assert.match((await R.decideApproval(id, "deny")).error, /denied/); await settle(); assert.equal(turns.length, 1);

// 6c. Marking the task done (updateSession done:true) denies pending perm, confirm and SSH approvals and starts no turn for any of them.
reset(); const ids = [addPerm(), addConfirm(), addSsh()];
R.textsSessions = () => []; R.sessionView = () => ({}); dodb.exec("CREATE TABLE IF NOT EXISTS helpers(id INTEGER, session TEXT, status TEXT); CREATE TABLE IF NOT EXISTS user_questions(session TEXT, status TEXT); CREATE TABLE IF NOT EXISTS spend_pauses(card TEXT, session TEXT, status TEXT, reason TEXT)");
const upd = await R.updateSession("task1", { done: true }); await settle();
assert.ok(!upd?.error, JSON.stringify(upd));
for (const i of ids) assert.equal(sql.exec("SELECT status FROM approvals WHERE id=?", i).one().status, "denied");
assert.equal(turns.length, 0, "done sweep resumes nothing");
// The same denial by the person, after the sweep ran, still resumes: the guard is only for the sweep.
assert.equal(R._doneSweep, false);
reset(); id = addPerm(); await R.decideApproval(id, "deny"); await settle(); assert.equal(turns.length, 1);

// 7. The text the helper sees says the request waits in the app and the helper is told.
const t = blockedText({ method: "GET", host: "api.x.com", path: "/2/search", why: "nobody is watching this run; request #1 is waiting in the app, and the helper is told when the person decides", verdict: "deny" });
assert.match(t, /waits in the app, and you are told when the person decides/); assert.doesNotMatch(t, /Tell the person/);
const lab = egressLabel({ egress: [{ host: "api.x.com", method: "GET", verdict: "deny", why: "nobody is watching this run; request #1 is waiting in the app" }] });
assert.match(lab, /you are told when they decide/);
console.log("approval-resume: ok");
