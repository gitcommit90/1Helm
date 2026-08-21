import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-followup-auth-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.CTRL_MAX_TOOL_ROUNDS = "8";

const providerRequests = [];
const hostCommands = [];

const sse = (res, chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
const toolCall = (res, name, args, id = `${name}-1`) => {
  sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });
  sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  res.end("data: [DONE]\n\n");
};
const answer = (res, content) => {
  sse(res, { choices: [{ delta: { content } }] });
  sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
  res.end("data: [DONE]\n\n");
};

const providerServer = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  providerRequests.push(body);
  const serialized = JSON.stringify(body.messages || []);
  const toolNames = (body.tools || []).map((tool) => tool.function?.name);
  const toolResults = (body.messages || []).filter((message) => message.role === "tool");
  const lastTool = toolResults.at(-1);
  res.writeHead(200, { "content-type": "text/event-stream" });

  if (!/scheduled-followup-wake/i.test(serialized)) {
    if (lastTool?.name === "schedule_followup") return answer(res, "Follow-up scheduled.");
    if (/create-authorized/i.test(serialized)) return toolCall(res, "schedule_followup", { delay_seconds: 30, reason: "authorized-complete", check_hint: "NEVER_EXECUTE_RAW_HINT", max_attempts: 4 });
    if (/create-unauthorized/i.test(serialized)) return toolCall(res, "schedule_followup", { delay_seconds: 30, reason: "unknown-no-capability", check_hint: "inspect host status", max_attempts: 4 });
    if (/create-running/i.test(serialized)) return toolCall(res, "schedule_followup", { delay_seconds: 30, reason: "running-first", check_hint: "inspect background status", max_attempts: 3 });
    if (/create-resident/i.test(serialized)) return toolCall(res, "schedule_followup", { delay_seconds: 30, reason: "resident-check", max_attempts: 2 });
    return answer(res, "No action.");
  }

  if (/authorized-complete/i.test(serialized)) {
    if (!lastTool) return toolCall(res, "run_command", { command: "inspect-authorized-status" });
    return answer(res, "Completed — the background task is confirmed complete.");
  }
  if (/running-first/i.test(serialized)) {
    if (!lastTool) return toolCall(res, "run_command", { command: "inspect-running-status" });
    return toolCall(res, "schedule_followup", { delay_seconds: 30, reason: "running-complete", check_hint: "inspect background status", observed_state: "confirmed_running" });
  }
  if (/running-complete/i.test(serialized)) {
    if (!lastTool) return toolCall(res, "run_command", { command: "inspect-completed-status" });
    return answer(res, "Completed — the retried task is confirmed complete.");
  }
  if (/unknown-no-capability/i.test(serialized)) {
    if (!lastTool) return toolCall(res, "run_command", { command: "must-not-run-unauthorized" });
    if (lastTool.name === "run_command" && toolNames.includes("schedule_followup")) return toolCall(res, "schedule_followup", { delay_seconds: 30, reason: "unknown-no-capability", observed_state: "confirmed_running" });
    return answer(res, "Blocked — task state is unknown because host run_command is unavailable for this wake.");
  }
  return answer(res, "Completed.");
});
await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
const providerPort = providerServer.address().port;

const computerServer = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  hostCommands.push(String(body.command || ""));
  const running = /running-status/.test(String(body.command || ""));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: `command-${hostCommands.length}`, status: "completed", exit_code: 0, output: [{ type: "stdout", data: running ? "still running" : "complete" }], next_offset: 1 }));
});
await new Promise((resolve) => computerServer.listen(0, "127.0.0.1", resolve));
const computerPort = computerServer.address().port;

const dbModule = await import("../src/server/db.ts");
const { db, now, q, q1, run, seed } = dbModule;
const bots = await import("../src/server/bots.ts");
const followups = await import("../src/server/followups.ts");

function fixture() {
  seed();
  const ownerId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('followup-owner','x','Owner',1,?)", now()).lastInsertRowid;
  const main = q1("SELECT id FROM channels WHERE name='main' ORDER BY id LIMIT 1");
  run("UPDATE channels SET personal_main_owner_id=?,created_by=? WHERE id=?", ownerId, ownerId, main.id);
  run("INSERT OR IGNORE INTO members (channel_id,user_id,last_read) VALUES (?,?,0)", main.id, ownerId);
  const providerId = run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES ('followup-mock',?,'x','openai',?)", `http://127.0.0.1:${providerPort}/v1`, now()).lastInsertRowid;
  const skipperBot = run("INSERT INTO bots (name,provider_id,model,created) VALUES ('followup-skipper',?,'mock',?)", providerId, now()).lastInsertRowid;
  const skipperAgent = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'skipper','followup-skipper','ready',?)", skipperBot, now()).lastInsertRowid;
  const computer1 = run("INSERT INTO computers (name,base_url,api_key,created) VALUES ('This Computer',?,'',?)", `http://127.0.0.1:${computerPort}`, now()).lastInsertRowid;
  const computer2 = run("INSERT INTO computers (name,base_url,api_key,created) VALUES ('Captain Mac',?,'',?)", `http://127.0.0.1:${computerPort}`, now()).lastInsertRowid;
  run("INSERT INTO bot_computers (bot_id,computer_id) VALUES (?,?),(?,?)", skipperBot, computer1, skipperBot, computer2);

  const residentChannel = run("INSERT INTO channels (name,slug,kind,status,created_by,created) VALUES ('followup-resident','followup-resident','channel','active',?,?)", ownerId, now()).lastInsertRowid;
  const residentBot = run("INSERT INTO bots (name,provider_id,model,created) VALUES ('followup-resident',?,'mock',?)", providerId, now()).lastInsertRowid;
  const residentAgent = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel','followup-resident','ready',?)", residentBot, now()).lastInsertRowid;
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", residentAgent, residentChannel, now());
  return { ownerId, main: Number(main.id), skipperBot, skipperAgent, computer1, computer2, residentChannel, residentBot, residentAgent };
}

function rootThread(channelId, ownerId, body) {
  const root = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", channelId, ownerId, body, now()).lastInsertRowid;
  const thread = followups.ensureFollowupThread(root, channelId);
  return { root, thread };
}

async function createViaTurn(f, marker, authorized = false) {
  const { root, thread } = rootThread(f.main, f.ownerId, marker);
  await bots.runBot(q1("SELECT * FROM bots WHERE id=?", f.skipperBot), f.main, root, root, false, undefined, authorized);
  return { root, thread, followup: q1("SELECT * FROM agent_followups WHERE thread_id=? ORDER BY id DESC LIMIT 1", thread) };
}

test("durable follow-ups preserve least-privilege authorization and bound wake outcomes", async () => {
  const f = fixture();

  const authorized = await createViaTurn(f, "create-authorized", true);
  assert.equal(Number(authorized.followup.host_authorized), 1, "creating turn host authorization is persisted");
  assert.deepEqual(JSON.parse(authorized.followup.host_authorized_computer_ids), [f.computer1, f.computer2], "assigned computer scope is captured without credentials or output");
  assert.equal(q1("SELECT host_authorized FROM agent_turns WHERE trigger_id=?", authorized.root).host_authorized, 1);

  const addedLater = run("INSERT INTO computers (name,base_url,api_key,created) VALUES ('Added Later',?,'',?)", `http://127.0.0.1:${computerPort}`, now()).lastInsertRowid;
  run("INSERT INTO bot_computers (bot_id,computer_id) VALUES (?,?)", f.skipperBot, addedLater);
  run("UPDATE agent_followups SET due_at=? WHERE id=?", now() - 1, authorized.followup.id);
  await followups.runFollowupPass();
  const authorizedWake = q1("SELECT * FROM agent_turns WHERE trigger_id IN (SELECT id FROM messages WHERE body LIKE '[scheduled-followup id=%authorized-complete%') ORDER BY id DESC LIMIT 1");
  assert.equal(Number(authorizedWake.host_authorized), 1, "the wake is admitted with the captured host capability");
  assert.deepEqual(JSON.parse(authorizedWake.host_authorized_computer_ids), [f.computer1, f.computer2], "a computer assigned after scheduling is not added on wake");
  const authorizedRequest = providerRequests.find((request) => JSON.stringify(request.messages).includes("authorized-complete") && (request.tools || []).some((tool) => tool.function?.name === "run_command"));
  assert(authorizedRequest, "run_command is available on the authorized Skipper wake");
  assert.deepEqual(authorizedRequest.tools.find((tool) => tool.function?.name === "run_command").function.parameters.properties.computer_id.enum, [f.computer1, f.computer2]);
  assert(hostCommands.includes("inspect-authorized-status"), "the wake can inspect task state");
  assert(!hostCommands.includes("NEVER_EXECUTE_RAW_HINT"), "check_hint remains prompt context and is never executed directly");
  assert.equal(q1("SELECT status FROM agent_followups WHERE id=?", authorized.followup.id).status, "done");
  assert.equal(q1("SELECT COUNT(*) n FROM agent_followups WHERE source_followup_id=?", authorized.followup.id).n, 0, "confirmed completion does not reschedule");

  const unauthorized = await createViaTurn(f, "create-unauthorized", false);
  assert.equal(Number(unauthorized.followup.host_authorized), 0);
  assert.deepEqual(JSON.parse(unauthorized.followup.host_authorized_computer_ids), []);
  run("UPDATE agent_followups SET due_at=? WHERE id=?", now() - 1, unauthorized.followup.id);
  await followups.runFollowupPass();
  const unauthorizedWake = q1("SELECT * FROM agent_turns WHERE trigger_id IN (SELECT id FROM messages WHERE body LIKE '[scheduled-followup id=%unknown-no-capability%') ORDER BY id DESC LIMIT 1");
  assert.equal(Number(unauthorizedWake.host_authorized), 0, "unauthorized wake stays unauthorized");
  const unauthorizedRequests = providerRequests.filter((request) => JSON.stringify(request.messages).includes("unknown-no-capability"));
  assert(unauthorizedRequests.every((request) => !(request.tools || []).some((tool) => tool.function?.name === "run_command")), "run_command is unavailable");
  assert(!hostCommands.includes("must-not-run-unauthorized"), "an unadvertised provider tool call is also rejected at execution time");
  assert.equal(q1("SELECT COUNT(*) n FROM agent_followups WHERE source_followup_id=?", unauthorized.followup.id).n, 0, "unknown task state cannot create a successor");
  assert.match(q1("SELECT body FROM messages WHERE parent_id=? AND bot_id=? ORDER BY id DESC LIMIT 1", unauthorized.root, f.skipperBot).body, /Blocked.*state is unknown.*run_command is unavailable/i);

  const running = await createViaTurn(f, "create-running", true);
  const runningComputerScope = JSON.parse(running.followup.host_authorized_computer_ids);
  const retryAddedLater = run("INSERT INTO computers (name,base_url,api_key,created) VALUES ('Retry Added Later',?,'',?)", `http://127.0.0.1:${computerPort}`, now()).lastInsertRowid;
  run("INSERT INTO bot_computers (bot_id,computer_id) VALUES (?,?)", f.skipperBot, retryAddedLater);
  run("UPDATE agent_followups SET due_at=? WHERE id=?", now() - 1, running.followup.id);
  await followups.runFollowupPass();
  const successor = q1("SELECT * FROM agent_followups WHERE source_followup_id=?", running.followup.id);
  assert(successor, "a tool-confirmed running task may schedule one subsequent check");
  assert.equal(Number(successor.host_authorized), 1);
  assert.equal(Number(successor.attempts), 1, "attempt count continues across successor rows");
  assert.equal(Number(successor.max_attempts), 3, "the creating follow-up's attempt cap cannot be widened by a retry");
  assert.deepEqual(JSON.parse(successor.host_authorized_computer_ids), runningComputerScope, "retry authority does not expand to newly assigned computers");
  assert.equal(q1("SELECT COUNT(*) n FROM agent_followups WHERE source_followup_id=?", running.followup.id).n, 1, "one wake creates exactly one successor");
  run("UPDATE agent_followups SET due_at=? WHERE id=?", now() - 1, successor.id);
  await followups.runFollowupPass();
  assert.equal(q1("SELECT status,attempts FROM agent_followups WHERE id=?", successor.id).status, "done");
  assert.equal(Number(q1("SELECT status,attempts FROM agent_followups WHERE id=?", successor.id).attempts), 2);
  assert.equal(q1("SELECT COUNT(*) n FROM agent_followups WHERE source_followup_id=?", successor.id).n, 0, "completion on retry terminates the chain");

  const restart = await createViaTurn(f, "create-authorized", true);
  run("UPDATE agent_followups SET status='running',attempts=1,due_at=?,last_error='' WHERE id=?", now() - 1, restart.followup.id);
  assert.equal(followups.recoverInterruptedFollowups(), 1);
  const recovered = q1("SELECT * FROM agent_followups WHERE id=?", restart.followup.id);
  assert.equal(recovered.status, "pending");
  assert.equal(Number(recovered.attempts), 1, "restart recovery does not refund a consumed attempt");
  assert.equal(Number(recovered.host_authorized), 1, "restart recovery preserves authorization provenance");
  assert.deepEqual(JSON.parse(recovered.host_authorized_computer_ids), JSON.parse(restart.followup.host_authorized_computer_ids));
  run("UPDATE agent_followups SET status='cancelled' WHERE id=?", restart.followup.id);

  run("UPDATE agent_followups SET status='running' WHERE id=?", running.followup.id);
  assert.equal(followups.recoverInterruptedFollowups(), 1);
  assert.equal(q1("SELECT status FROM agent_followups WHERE id=?", running.followup.id).status, "done", "restart does not replay a parent wake after its successor was persisted");

  const residentRoot = rootThread(f.residentChannel, f.ownerId, "create-resident");
  await bots.runBot(q1("SELECT * FROM bots WHERE id=?", f.residentBot), f.residentChannel, residentRoot.root, residentRoot.root, false, undefined, true);
  const residentFollowup = q1("SELECT * FROM agent_followups WHERE thread_id=?", residentRoot.thread);
  assert.equal(Number(residentFollowup.agent_id), f.residentAgent);
  assert.equal(Number(residentFollowup.channel_id), f.residentChannel, "resident follow-up stays in its originating channel");
  assert.equal(Number(residentFollowup.host_authorized), 0, "resident follow-up never acquires Skipper host authority");
  assert.deepEqual(JSON.parse(residentFollowup.host_authorized_computer_ids), []);

  const legacy = rootThread(f.main, f.ownerId, "legacy-default");
  const legacyId = run(`INSERT INTO agent_followups
    (agent_id,bot_id,channel_id,thread_id,root_message_id,due_at,reason,status,attempts,max_attempts,created,updated)
    VALUES (?,?,?,?,?,?,'legacy','pending',0,2,?,?)`, f.skipperAgent, f.skipperBot, f.main, legacy.thread, legacy.root, now() + 60_000, now(), now()).lastInsertRowid;
  assert.equal(Number(q1("SELECT host_authorized FROM agent_followups WHERE id=?", legacyId).host_authorized), 0, "rows serialized without authorization default closed");
  assert.deepEqual(JSON.parse(q1("SELECT host_authorized_computer_ids FROM agent_followups WHERE id=?", legacyId).host_authorized_computer_ids), []);
  run("UPDATE agent_followups SET due_at=? WHERE id=?", now() - 1, legacyId);
  await followups.runFollowupPass();
  const legacyWake = q1("SELECT host_authorized,host_authorized_computer_ids FROM agent_turns WHERE trigger_id IN (SELECT id FROM messages WHERE body LIKE '[scheduled-followup id=%legacy%') ORDER BY id DESC LIMIT 1");
  assert.equal(Number(legacyWake.host_authorized), 0, "legacy wake is admitted without host authority");
  assert.deepEqual(JSON.parse(legacyWake.host_authorized_computer_ids), []);
  const legacyRequest = providerRequests.find((request) => JSON.stringify(request.messages).includes("Check / finish: legacy"));
  assert(legacyRequest && !(legacyRequest.tools || []).some((tool) => tool.function?.name === "run_command"));

  const cancelled = await createViaTurn(f, "create-authorized", true);
  assert.equal(followups.cancelThreadFollowups(cancelled.thread, "test cancellation"), 1);
  assert.equal(q1("SELECT status FROM agent_followups WHERE id=?", cancelled.followup.id).status, "cancelled", "cancellation still wins without altering provenance");
});

test("schema migration adds authorization provenance to legacy follow-up rows with safe defaults", () => {
  const migrationDir = mkdtempSync(join(tmpdir(), "1helm-followup-migration-"));
  const source = new URL("../src/server/db.ts", import.meta.url).href;
  const env = { ...process.env, CTRL_DATA_DIR: migrationDir };
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    const m=await import(${JSON.stringify(source)}); m.seed();
    const owner=m.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('legacy','x','Legacy',1,?)",m.now()).lastInsertRowid;
    const channel=m.q1("SELECT id FROM channels LIMIT 1").id;
    const bot=m.run("INSERT INTO bots (name,model,created) VALUES ('legacy','mock',?)",m.now()).lastInsertRowid;
    const agent=m.run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'skipper','legacy','ready',?)",bot,m.now()).lastInsertRowid;
    const root=m.run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,'legacy',?)",channel,owner,m.now()).lastInsertRowid;
    const thread=m.run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','','',?,?)",root,channel,m.now(),m.now()).lastInsertRowid;
    m.db.exec("PRAGMA foreign_keys=OFF; DROP TABLE agent_followups; CREATE TABLE agent_followups (id INTEGER PRIMARY KEY,agent_id INTEGER NOT NULL,bot_id INTEGER NOT NULL,channel_id INTEGER NOT NULL,thread_id INTEGER NOT NULL,root_message_id INTEGER NOT NULL,due_at INTEGER NOT NULL,reason TEXT NOT NULL,check_hint TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 48,last_error TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL)");
    m.run("INSERT INTO agent_followups (agent_id,bot_id,channel_id,thread_id,root_message_id,due_at,reason,created,updated) VALUES (?,?,?,?,?,?,?,?,?)",agent,bot,channel,thread,root,m.now()+60000,"legacy",m.now(),m.now());
    m.db.close();
  `], { cwd: process.cwd(), env });
  const migrated = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    const m=await import(${JSON.stringify(source)});
    const row=m.q1("SELECT host_authorized,host_authorized_computer_ids,source_followup_id FROM agent_followups LIMIT 1");
    process.stdout.write(JSON.stringify({columns:m.q("PRAGMA table_info(agent_followups)").map(c=>c.name),row})); m.db.close();
  `], { cwd: process.cwd(), env, encoding: "utf8" }));
  assert(migrated.columns.includes("host_authorized") && migrated.columns.includes("host_authorized_computer_ids") && migrated.columns.includes("source_followup_id"));
  assert.equal(Number(migrated.row.host_authorized), 0);
  assert.deepEqual(JSON.parse(migrated.row.host_authorized_computer_ids), []);
  assert.equal(migrated.row.source_followup_id, null);
  rmSync(migrationDir, { recursive: true, force: true });
});

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  providerServer.close();
  computerServer.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});
