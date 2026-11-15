// node --import ./test/stubs/register.mjs test/task-history-trim.test.mjs
import assert from "node:assert/strict";
import { world } from "./deploy-harness.mjs";
import { TaskTranscript, archiveReply, estimateTokens, TASK_HISTORY_TOKEN_LIMIT, TOOL_STUB_MIN } from "../src/task-transcript.js";

const W = world(), R = W.R;
const prefix = [{ role: "system", content: "fixed" }], tools = [];
const big = n => "page text ".repeat(Math.ceil(n / 10)).slice(0, n);
function addTurn(store, turn, outputs) {
  store.append({ role: "user", content: `question for ${turn}` }, turn);
  outputs.forEach((o, i) => {
    const id = `${turn}-c${i}`;
    store.append({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: o.name || "fetch_url", arguments: JSON.stringify(o.args || { url: `https://example.com/${turn}/${i}` }) } }] }, turn);
    store.append(store.bound({ role: "tool", tool_call_id: id, content: o.text }), turn);
  });
  store.append({ role: "assistant", content: `answer ${turn}` }, turn);
}

// Stubs, archive refs, current turn intact, small outputs intact, pairs intact.
const s = new TaskTranscript(R.ctx.storage, "trim1"); s.create(prefix, tools);
addTurn(s, "t1", [{ text: big(40000) }, { text: big(5000), name: "web_search", args: { query: "q ".repeat(200) } }, { text: "tiny result" }]);
addTurn(s, "t2", [{ text: big(9000) }]);
const before = s.messages().map(m => m.content);
assert.equal(s.trimEarlierTurns("t2"), 2, "two long outputs from t1 become stubs");
const after = s.messages();
const toolsAfter = after.filter(m => m.role === "tool");
assert.equal(toolsAfter.length, 4);
const [a, b, c, d] = toolsAfter;
for (const m of [a, b]) assert.ok(m.content.length < 700 && m.content.includes("read_task_archive ref="), m.content.length);
assert.match(a.content, /Tool: fetch_url; arguments: \{"url":"https:\/\/example.com\/t1\/0"\}; original size: 40000 characters/);
assert.match(b.content, /Tool: web_search; arguments: .*\.\.\.; original size: 5000/);
assert.equal(c.content, "tiny result");
assert.equal(d.content, before[before.findIndex((x, i) => after[i].tool_call_id === "t2-c0")], "current turn output stays whole");
assert.ok(d.content.length === 9000);
// The bounded 40000 output kept its original ref and the full text is readable.
const ref = /ref="(tool-[^"]+)"/.exec(a.content)[1];
assert.equal(s.readBlob(ref).length, 40000);
const page = s.archive({ ref }); assert.equal(page.total, 40000);
assert.match(archiveReply(page, { ref }), /^\[archive ref=tool-/);
const refB = /ref="(tool-[^"]+)"/.exec(b.content)[1];
assert.equal(s.readBlob(refB).length, 5000, "unbounded output got a new blob");
// Pairing is intact.
const ids = new Set(); for (const m of after) { for (const x of m.tool_calls || []) ids.add(x.id); if (m.role === "tool") assert.ok(ids.has(m.tool_call_id)); }
assert.equal(after.filter(m => m.tool_calls?.length).length, 4);
// Once per turn boundary: a second call changes nothing.
const snap = JSON.stringify(s.messages());
assert.equal(s.trimEarlierTurns("t2"), 0); assert.equal(JSON.stringify(s.messages()), snap);
assert.ok(s.state().lastTrim.count === 2 && s.state().observations === null);
// The next turn trims t2's output and leaves t3's.
addTurn(s, "t3", [{ text: big(20000) }]);
assert.equal(s.trimEarlierTurns("t3"), 1);
assert.ok(s.messages().find(m => m.tool_call_id === "t2-c0").content.length < 700);
assert.equal(s.messages().find(m => m.tool_call_id === "t3-c0").content.length <= 16000, true);
assert.ok(s.messages().find(m => m.tool_call_id === "t3-c0").content.length > 1500);
// Rows without a stub path (old rows, null turn) are handled: a message with a null turn counts as earlier.
const old = new TaskTranscript(R.ctx.storage, "trim-old"); old.create(prefix, tools, [
  { role: "assistant", content: "", tool_calls: [{ id: "o1", type: "function", function: { name: "run_command", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "o1", content: big(3000) }]);
assert.equal(old.trimEarlierTurns("x"), 1); assert.match(old.messages()[1].content, /Tool: run_command; arguments: \{\}; original size: 3000/);
assert.ok(TOOL_STUB_MIN === 1500);

// Fixed limit: a model with a 1M window still compacts at 150,000, and not again on the next step.
const store = new TaskTranscript(R.ctx.storage, "limit"); store.create(prefix, tools);
const tc = { appendRuntime: true, transcript: store, appendTools: tools, taskProfile: { contextLength: 1000000, maxOutput: 32000, requestedModel: "fixture/big" }, appendStats: {}, session: "limit", turn: "t", kind: "chat" };
let calls = 0; R.callModelOnce = async () => { calls++; return { content: "Summary of goals and facts.", calls: [], inTok: 1000, outTok: 25, cached: 0, charge: 1, finish: "stop" }; };
for (let t = 0; t < 12; t++) addTurn(store, `u${t}`, [{ text: big(14000) }, { text: big(14000) }, { text: big(14000) }]);
store.trimEarlierTurns("u11");
let messages = store.request();
assert.ok(estimateTokens(messages, tools) < TASK_HISTORY_TOKEN_LIMIT, "stubs alone keep this history under the limit");
await R.governTaskContext(messages, tc); assert.equal(calls, 0);
for (let t = 0; t < 12; t++) { store.append({ role: "user", content: "more" }, "v"); for (let i = 0; i < 26; i++) { store.append({ role: "assistant", content: "", tool_calls: [{ id: `v${t}-${i}`, type: "function", function: { name: "fetch_url", arguments: "{}" } }] }, "v"); store.append({ role: "tool", tool_call_id: `v${t}-${i}`, content: big(1400) }, "v"); } }
messages = store.request();
const est = estimateTokens(messages, tools);
assert.ok(est > TASK_HISTORY_TOKEN_LIMIT, `history ${est} is over the fixed limit`);
await R.governTaskContext(messages, tc);
assert.equal(store.state().epoch, 1, "compacted at the fixed limit"); assert.ok(calls >= 1);
const afterEst = estimateTokens(messages, tools);
assert.ok(afterEst < TASK_HISTORY_TOKEN_LIMIT * .8, `after compaction ${afterEst}`);
const n = calls; await R.governTaskContext(messages, tc); assert.equal(calls, n, "no second compaction on the next step"); assert.equal(store.state().epoch, 1);
console.log("PASS task-history-trim");
