import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Regression coverage for silently truncated provider responses (dgx thread 8180):
// the runtime must send an explicit output budget, refuse to execute tool calls
// whose arguments were cut off, fail a "length" stream loudly, and never publish
// a raw run_command result as the agent's final answer.

const dataDir = mkdtempSync(join(tmpdir(), "1helm-output-truncation-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.CTRL_MAX_TOOL_ROUNDS = "6";

const providerRequests = [];
const hostCommands = [];
const sse = (res, chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

const providerServer = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  providerRequests.push(body);
  const serialized = JSON.stringify(body.messages || []);
  const toolResults = (body.messages || []).filter((message) => message.role === "tool");
  res.writeHead(200, { "content-type": "text/event-stream" });

  if (/truncated-tool-call/i.test(serialized)) {
    // Claude hit max_tokens mid tool_use: partial JSON arguments then finish_reason length.
    sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_trunc", type: "function", function: { name: "run_command", arguments: '{"command":"cat <<EOF > big.py\\nimport torch' } }] } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: "length" }] });
    return res.end("data: [DONE]\n\n");
  }
  if (/empty-arguments-call/i.test(serialized)) {
    if (!toolResults.length) {
      // A syntactically complete but argument-less call must be rejected, not run as "".
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_empty", type: "function", function: { name: "run_command", arguments: "" } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      return res.end("data: [DONE]\n\n");
    }
    sse(res, { choices: [{ delta: { content: `Tool result was: ${String(toolResults.at(-1).content).slice(0, 80)}` } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    return res.end("data: [DONE]\n\n");
  }
  if (/silent-final/i.test(serialized)) {
    if (!toolResults.length) {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_ok", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "echo profile-table" }) } }] } }] });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      return res.end("data: [DONE]\n\n");
    }
    // Model ends with zero text after the tool round.
    sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    return res.end("data: [DONE]\n\n");
  }
  sse(res, { choices: [{ delta: { content: "Plain answer." } }] });
  sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
const providerPort = providerServer.address().port;

const computerServer = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  hostCommands.push(String(body.command ?? ""));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: `command-${hostCommands.length}`, status: "completed", exit_code: 0, output: [{ type: "stdout", data: "kernel  nospec ms  mtp4 ms\nexl3_mgemm 3.76 17.31" }], next_offset: 1 }));
});
await new Promise((resolve) => computerServer.listen(0, "127.0.0.1", resolve));
const computerPort = computerServer.address().port;

const { now, q1, run, seed } = await import("../src/server/db.ts");
const bots = await import("../src/server/bots.ts");

let cached = null;
function fixture() {
  if (cached) return cached;
  seed();
  const ownerId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('trunc-owner','x','Owner',1,?)", now()).lastInsertRowid;
  const main = q1("SELECT id FROM channels WHERE name='main' ORDER BY id LIMIT 1");
  run("UPDATE channels SET personal_main_owner_id=?,created_by=? WHERE id=?", ownerId, ownerId, main.id);
  run("INSERT OR IGNORE INTO members (channel_id,user_id,last_read) VALUES (?,?,0)", main.id, ownerId);
  const providerId = run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES ('trunc-mock',?,'x','openai',?)", `http://127.0.0.1:${providerPort}/v1`, now()).lastInsertRowid;
  const skipperBot = run("INSERT INTO bots (name,provider_id,model,created) VALUES ('trunc-skipper',?,'mock',?)", providerId, now()).lastInsertRowid;
  run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'skipper','trunc-skipper','ready',?)", skipperBot, now());
  const computer = run("INSERT INTO computers (name,base_url,api_key,created) VALUES ('This Computer',?,'',?)", `http://127.0.0.1:${computerPort}`, now()).lastInsertRowid;
  run("INSERT INTO bot_computers (bot_id,computer_id) VALUES (?,?)", skipperBot, computer);
  cached = { ownerId, main: Number(main.id), skipperBot };
  return cached;
}

async function turn(f, body) {
  const root = run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,?,?,?)", f.main, f.ownerId, body, now()).lastInsertRowid;
  await bots.runBot(q1("SELECT * FROM bots WHERE id=?", f.skipperBot), f.main, root, root, false, undefined, true);
  const reply = q1("SELECT * FROM messages WHERE parent_id=? AND bot_id IS NOT NULL ORDER BY id DESC LIMIT 1", root);
  const agentTurn = q1("SELECT * FROM agent_turns WHERE trigger_id=? ORDER BY id DESC LIMIT 1", root);
  return { root, reply, agentTurn };
}

test("every provider request carries an explicit 100k+ output budget", async () => {
  const f = fixture();
  await turn(f, "plain request");
  assert(providerRequests.length >= 1);
  for (const request of providerRequests) {
    assert.equal(typeof request.max_tokens, "number", "max_tokens is always sent so the router never applies its 4096 default");
    assert(request.max_tokens >= 100000, `max_tokens ${request.max_tokens} must be at least 100k`);
  }
  assert.equal(bots.MAX_OUTPUT_TOKENS >= 100000, true);
});

test("a finish_reason=length stream fails the turn and executes nothing", async () => {
  const f = fixture();
  hostCommands.length = 0;
  const { reply, agentTurn } = await turn(f, "truncated-tool-call");
  assert.deepEqual(hostCommands, [], "the partial run_command must not reach the computer");
  assert.equal(agentTurn.state, "failed", "a truncated response is not a completed turn");
  assert.match(String(reply.body), /cut off by the output token limit/i);
  assert.equal(q1("SELECT count(*) n FROM tool_actions WHERE invocation_id=?", agentTurn.id).n, 0, "no tool action row is recorded for a truncated call");
});

test("tool calls missing required arguments are refused as failed actions instead of running empty", async () => {
  const f = fixture();
  hostCommands.length = 0;
  const { agentTurn } = await turn(f, "empty-arguments-call");
  assert.deepEqual(hostCommands, [], "run_command with no command never executes");
  const action = q1("SELECT * FROM tool_actions WHERE invocation_id=? AND tool='run_command' ORDER BY id LIMIT 1", agentTurn.id);
  assert(action, "the refused call is still recorded for audit");
  assert.equal(action.status, "failed");
  assert.match(String(action.result_summary), /without required argument.*command/i);
  assert.equal(agentTurn.state, "completed", "the model was told and answered normally");
});

test("a turn that ends with no text after run_command fails instead of publishing the raw result", async () => {
  const f = fixture();
  hostCommands.length = 0;
  const { reply, agentTurn } = await turn(f, "silent-final");
  assert.deepEqual(hostCommands, ["echo profile-table"], "the well-formed command ran once");
  assert.equal(agentTurn.state, "failed");
  assert.doesNotMatch(String(reply.body), /^The command completed\./, "raw command output is never passed off as the answer");
  assert.doesNotMatch(String(reply.body), /exl3_mgemm/, "tool output is not the reply body");
  assert.match(String(reply.body), /no usable answer/i);
});

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 150)); // let asynchronous notification persistence settle
  await Promise.all([
    new Promise((resolve) => providerServer.close(resolve)),
    new Promise((resolve) => computerServer.close(resolve)),
  ]);
  rmSync(dataDir, { recursive: true, force: true });
});
