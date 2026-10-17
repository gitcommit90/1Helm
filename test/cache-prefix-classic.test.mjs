// node --import ./test/stubs/register.mjs test/cache-prefix-classic.test.mjs
// r35-cache-fix: on the classic lane (helpers, workflows, follow-ups, own-key chat, resumed classic turns) a request may only APPEND to
// the one before it during a task. Real Resident turns on the OpenRouter route with CONTEXT_LAYOUT=v2 and WORKMEM=on: a load_tools call,
// a result over 20,000 chars, several steps, a second turn in the same task, a resume after a deploy, and a final report with the tools
// off. The wire bodies are checked with comparePrefix (below): same model and tools, earlier messages unchanged.
import { world, HANG, tick, assert } from "./deploy-harness.mjs";
import { Resident } from "../src/resident.js";
import { withSettings } from "./helpers/seed-settings.mjs";
import { unmark } from "./cache-unmark.mjs";

// Cache annotations move as the request grows, so they are removed before comparing; nothing else is normalized.
function comparePrefix(previous, next) {
  const a = unmark(previous), b = unmark(next);
  assert.ok(a && b && Array.isArray(a.messages) && Array.isArray(b.messages), "Both requests must have messages");
  assert.ok(b.messages.length >= a.messages.length, "Historical messages disappeared");
  assert.deepEqual(b.messages.slice(0, a.messages.length), a.messages, "Previously sent provider-visible messages changed");
  for (const key of ["model", "tools", "session_id", "prompt_cache_key", "reasoning", "response_format"]) assert.deepEqual(b[key], a[key], `${key} changed`);
}

const BIG = "line of a long log\n".repeat(1500);   // about 28,000 chars
for (const engine of ["classic", "pi"]) {
  const W = world({ engine, env: { CONTEXT_LAYOUT: "v2", WORKMEM: "on", RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0, GENUI: "off", OPENROUTER_API_KEY: "k", ROUTER_MODE: "two", ENV_NAME: "dev", ...withSettings({}) } });
  W.d1.exec("ALTER TABLE tenants ADD COLUMN helper_tone INTEGER; CREATE TABLE vault (tenant_id TEXT,name TEXT,hosts TEXT); CREATE TABLE logins (tenant_id TEXT,site TEXT,username TEXT);");
  W.env.ARCHIVE = { idFromName: (n) => n, get: () => ({ channel: async () => ({ channel: { name: "main", purpose: "" }, memory: [], messages: [] }) }) };
  const boot = W.boot, attach = (R) => { R.systemPrompt = Resident.prototype.systemPrompt; R.conns = async () => []; R.notebookBackfillOnce = async () => 0; R.mem.syncCurated = () => {}; R.memoryBackfill = () => {}; return R; };
  W.boot = () => attach(boot()); attach(W.R);
  const wire = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    u = String(u); const body = init.body ? JSON.parse(init.body) : {};
    if (u.endsWith("/systemone")) return new Response(JSON.stringify({ answers: { is_task: { noul: 0.97 }, category: { choice: "spreadsheet" }, unmet: { noul: 0.05 } }, usage: { cost: 0.00001 } }), { status: 200 });
    if (!u.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${u}`);
    if (!body.stream) {
      assert.equal(body.response_format?.json_schema?.name, "task_labels", "only labels use the whole-answer fixture");
      return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify({ title: "Cache prefix", result: "Done", summary: "Completed", why: {} }) }, finish_reason: "stop" }], usage: { cost: .00001 } });
    }
    if (body.tools) wire.push(structuredClone(body));
    return new Response(await W.env.AI.run("m", body), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  W.tools.web_search = async () => BIG;   // a result over 20,000 chars (a command's output is capped at 20,000 before it gets here)
  const pairs = (list, tag) => { for (let i = 1; i < list.length; i++) { try { comparePrefix(list[i - 1], list[i]); } catch (e) { throw new Error(`${engine} ${tag}: call ${i} is not an append of call ${i - 1}: ${e.message.split("\n")[0]}`); } } };
  const sess = W.R.newSession("Cache prefix");

  // turn 1: load_tools, a huge result, more steps, then the answer
  let n = 0;
  W.brain = ({ who }) => { if (who !== "main") return "ok"; n++;
    if (n === 1) return { calls: [["load_tools", { names: ["list_workflows"], step_title: "Load tools" }]] };
    if (n === 2) return { calls: [["web_search", { query: "the long log", step_title: "Read log" }]] };
    if (n <= 6) return { calls: [["run_command", { command: `echo step ${n}`, step_title: `Step ${n}` }]] };
    return "Turn one done."; };
  const r1 = await W.R.runTurn("t1", "main", "1", "Check the log and report.", null, { session: sess });
  assert.ok(!r1.error, r1.error); await W.settle();
  const t1 = wire.splice(0); assert.ok(t1.length >= 7, `${engine}: turn 1 made ${t1.length} calls`);
  if (engine === "classic") assert.ok(t1.some((b) => JSON.stringify(b.messages).includes("chars set aside")), "classic: the huge result was trimmed (the pi engine has no working memory)");
  pairs(t1, "turn 1");
  assert.ok(t1.every((b) => b.tools.length === t1[0].tools.length), "same tools every step");

  // turn 2, same task: the person's next message, then the step limit gives a final report with the tools off
  n = 0;
  W.brain = ({ who }) => { if (who !== "main") return "ok"; n++; return n <= 4 ? { calls: [["run_command", { command: `echo again ${n}`, step_title: `Again ${n}` }]] } : "Turn two done."; };
  const r2 = await W.R.runTurn("t1", "main", "1", "And once more.", null, { session: sess, max_steps: 3 });
  assert.ok(!r2.error, r2.error); await W.settle();
  const t2 = wire.splice(0); assert.ok(t2.length >= 3);
  pairs(t2, "turn 2");
  const final = t2.at(-1); assert.equal(final.tool_choice, "none", `${engine}: the final report call keeps the tools and sets tool_choice none`);
  assert.equal(final.tools.length, t2[0].tools.length);
  // the second turn continues the first turn's request (same tools and system part; the earlier turn's messages are rebuilt as history)
  assert.deepEqual(t2[0].tools, t1[0].tools, `${engine}: turn 2 sends the same tools as turn 1`);
  assert.deepEqual(t2[0].messages.slice(0, 2), t1[0].messages.slice(0, 2));

  // a resume after a deploy: the interrupted turn carries on with the same tools and the same earlier messages
  n = 0;
  W.brain = ({ who }) => { if (who !== "main") return "ok"; n++; return n === 1 ? { calls: [["run_command", { command: "echo r1", step_title: "R1" }]] } : n === 2 ? { calls: [["run_command", { command: "echo r2", step_title: "R2" }]] } : n === 3 ? HANG : "Resumed."; };
  W.R.runTurn("t1", "main", "1", "A third request.", null, { session: sess }).catch(() => {});
  await W.until(() => wire.length >= 3, 10000);
  const before = wire.splice(0); W.kill();
  const R2 = W.boot(); await tick(10);
  W.brain = ({ who }) => who === "main" ? "Resumed." : "ok";
  await R2.alarm(); await W.settle(R2); for (const p of R2._resumeRuns || []) await p;
  const after = wire.splice(0); assert.ok(after.length >= 1, `${engine}: the resume made a call`);
  pairs([...before, after[0]], "resume");
  globalThis.fetch = realFetch;
  console.log(`PASS ${engine}: every consecutive classic request (load_tools, huge result, steps, next turn, limit report, resume) only appends`);
}
process.exit(0);   // the interrupted turn of the resume step leaves its timers running
