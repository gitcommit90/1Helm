import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TaskTranscript, contextBudget, contextSize, estimateTokens, compactionPlan, transcriptDelete, transcriptDiagnostics } from "../src/task-transcript.js";

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT)");
let failWrite = false;
const sql = { exec(q, ...a) {
  if (failWrite && q.startsWith("INSERT INTO task_transcript_parts")) throw new Error("injected storage failure");
  if (!a.length && q.split(";").filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; }
  const st = db.prepare(q), rows = /^SELECT/.test(q) ? st.all(...a) : (st.run(...a), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
const storage = { sql, transactionSync(fn) { db.exec("BEGIN"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
const prefix = [{ role: "system", content: "stable system" }, { role: "developer", content: "stable instructions" }];
const tools = [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } }];
let store = new TaskTranscript(storage, "task1"); store.create(prefix, tools);
let previous = prefix;
for (let i = 0; i < 55; i++) {
  const user = { role: "user", content: `User ${i} ` + "Readable conversation. ".repeat(100) };
  store.append(user, `turn${i}`);
  const request = store.request(); assert.deepEqual(request.slice(0, previous.length), previous, "every prior envelope is identical");
  const assistant = { role: "assistant", content: `Answer ${i}`, reasoning_details: [{ type: "reasoning.encrypted", data: `opaque${i}` }], _rmodel: "fixture/model" };
  store.append(assistant, `turn${i}`);
  previous = store.request();
  if (i === 25) store = new TaskTranscript(storage, "task1");
}
assert.equal(store.messages().length, 110); assert.equal(store.state().compactions, 0);
assert.ok(JSON.stringify(store.messages()).length > 60000);
assert.equal(store.messages()[1].reasoning_details[0].data, "opaque0");
assert.deepEqual(store.tools(), tools);
const multimodal = { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,fixture" } }] };
store.append(multimodal, "image"); assert.deepEqual(new TaskTranscript(storage, "task1").messages().at(-1), multimodal);
const huge = { role: "tool", tool_call_id: "abc", content: "UNICODE 🐝 ".repeat(10000) }, raw = huge.content;
store.bound(huge); assert.ok(huge.content.length < 16000);
const ref = huge.content.match(/ref="([^"]+)"/)[1]; assert.equal(store.readBlob(ref), raw);
assert.equal(store.archive({ ref, offset: 100, limit: 80 }).text, raw.slice(100, 180));
assert.equal(new TaskTranscript(storage, "other").archive({ ref }).error, "Archive reference not found in this task");
const before = store.request(); failWrite = true;
assert.throws(() => store.compact([{ role: "user", content: "summary" }], "near_model_capacity"), /injected/);
failWrite = false; assert.deepEqual(store.request(), before); assert.equal(store.state().epoch, 0);
store.compact([{ role: "user", content: "summary" }, multimodal], "near_model_capacity");
assert.equal(store.state().epoch, 1); assert.deepEqual(store.messages(0), before.slice(prefix.length));
assert.equal(store.messages()[0].content, "summary"); assert.equal(store.state().compactions, 1);
const budget = contextBudget({ contextLength: 1000000, maxOutput: 50000 });
assert.equal(budget.input, 933616); assert.equal(budget.output, 50000);
assert.equal(contextBudget({ contextLength: 16384, maxOutput: 16384 }).output, 4096, "the room kept for the answer is at most a quarter of the context");
assert.equal(contextBudget({ contextLength: 400000, maxOutput: 235929 }).output, 100000, "a very large published maximum does not take the input window");
store.observe(500, store.request(), tools);
const appended = [...store.request(), { role: "user", content: "new " .repeat(500) }];
assert.ok(contextSize(store, appended, tools) >= 500 + estimateTokens(appended, tools) - estimateTokens(store.request(), tools));
const history = Array.from({ length: 60 }, (_, i) => [{ role: "user", content: `question${i}` }, { role: "assistant", content: "", tool_calls: [{ id: `t${i}`, type: "function", function: { name: "read_file", arguments: "{}" } }] }, { role: "tool", tool_call_id: `t${i}`, content: "tool output ".repeat(500) }, { role: "assistant", content: `answer${i}` }]).flat();
const plan = compactionPlan(history, prefix, tools, budget), callIds = new Set();
for (const m of plan.retained) { for (const c of m.tool_calls || []) callIds.add(c.id); if (m.role === "tool") assert.ok(callIds.has(m.tool_call_id), "retained tool results have calls"); }
for (let i = 0; i < 60; i++) { assert.ok(plan.retained.some(m => m.content === `question${i}`)); assert.ok(plan.retained.some(m => m.content === `answer${i}`)); }
const diagnostic = transcriptDiagnostics(sql, "task1"); assert.equal(diagnostic.epoch, 1); assert.ok(diagnostic.envelopes.every(x => x.digest && !x.content));
store.privacyReset(prefix, [{ role: "user", content: "visible conversation" }], "forgotten");
assert.equal(store.state().reason, "privacy_memory_reset"); assert.equal(store.readBlob(ref), null); assert.deepEqual(store.messages(0), []);
transcriptDelete(sql, "task1"); assert.equal(store.state(), null); assert.equal(store.readBlob("prefix"), null);
console.log("PASS task transcript: 55 turns, exact prefixes, restart, opaque reasoning, multimodal, chunked archives, transactional epochs, retention, calibrated limits, scoped reads, privacy reset and deletion");

