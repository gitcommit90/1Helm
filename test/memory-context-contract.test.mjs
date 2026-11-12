// Local prompt/context contracts, not a claim of live model semantic success.
import test from "node:test";
import assert from "node:assert/strict";
import { FLAGS, staticCore } from "../src/prompt/index.js";
import { channelLayers } from "../src/prompt/context-layers.js";
import { RUNTIME_CONTRACT, CONTEXT_TOOLS, contextMessages } from "../src/context.js";
import { AMBIENT_PROMPT } from "../src/ee/ambient-query.js";
import { TaskTranscript } from "../src/task-transcript.js";

test("all core/EE flag combinations distinguish legacy automatic recall from v2 on-demand", () => {
  for (const ee of [false, true]) for (let mask = 0; mask < 2 ** FLAGS.length; mask++) {
    const flags = { ...Object.fromEntries(FLAGS.map((name, n) => [name, !!(mask & (1 << n))])), ee };
    const prompt = staticCore(flags);
    assert.equal(prompt.includes("Memory recall arrives with each message"), flags.recall && !flags.context_v2, JSON.stringify(flags));
    assert.equal(prompt.includes("Personal memory is searched on demand, not with every message"), flags.recall && flags.context_v2, JSON.stringify(flags));
    if (flags.context_v2 && flags.recall) assert.match(prompt, /not automatically searched for every message/);
  }
});

test("earlier contact evidence cannot justify absent unrelated facts without current targeted retrieval", () => {
  const prior = { role: "tool", tool_call_id: "earlier-lookup", content: "[contact · Dana] Dana — sister" };
  for (const ee of [false, true]) for (const question of ["What's the gate code? One line.", "What's my boss's email? One line."]) {
    const layers = channelLayers({ general: false, recall: true, ee, channel: "example-project" });
    const context = { version: 2, core: staticCore({ context_v2: true, recall: true, ee }), developer: layers.runtime + "\n" + RUNTIME_CONTRACT, standing: layers.data, turn: { time: "later" }, userText: question, modelUserText: question };
    const messages = contextMessages([{ role: "system", content: "replaced" }, prior, { role: "user", content: question }], context);
    assert.doesNotMatch(messages[0].content, /Memory recall arrives with each message/);
    assert.match(messages[1].content, /Before claiming a required personal fact is absent, make a targeted lookup for that fact in this turn/);
    assert.match(messages[1].content, /notes and Contacts can change/);
    assert.match(messages[1].content, /an earlier empty or partial result is not a current search for a different fact/);
    assert.match(messages[1].content, /If the lookup fails, report unavailability rather than absence/);
    assert.ok(CONTEXT_TOOLS.some((t) => t.function.name === "recall_memory"));
    assert.deepEqual(messages.at(-1), { role: "user", content: question });
    assert.equal(messages.filter((m) => m.role === "tool").length, 1, "assembly does not run retrieval or inject an answer");
    assert.equal(messages.find((m) => m.role === "tool").content, prior.content);
    // Exercise the actual append request composer without a private database
    // harness. Its persisted prefix/history must carry the same instructions.
    const appended = TaskTranscript.prototype.request.call({ readBlob: () => messages.slice(0, 3), messages: () => messages.slice(3) });
    assert.deepEqual(appended, messages);
  }
});

test("freshness policy preserves minimal relevant retrieval and optional memory", () => {
  assert.match(RUNTIME_CONTRACT, /A complete calculation, rewrite, explanation or fully specified action does not need unrelated memory/);
  assert.match(RUNTIME_CONTRACT, /Stop retrieving when you have enough/);
  assert.match(RUNTIME_CONTRACT, /Reuse sufficient supplied facts; do not search unrelated history/);
  assert.match(RUNTIME_CONTRACT, /Empty or omitted retrieval means not searched, never proof that no record exists/);
  for (const ee of [false, true]) assert.match(channelLayers({ general: false, recall: false, ee }).runtime, /Automatic personal memory recall is not active/);
});

test("General cites actual memory sources while project and EE boundaries remain intact", () => {
  for (const ee of [false, true]) for (const recall of [false, true]) {
    const general = channelLayers({ general: true, recall, ee }).runtime;
    assert.match(general, /When answering from another channel's memory or Notebook, name that source channel, including facts found through memory_explain/);
    assert.match(general, /Use the source returned by the lookup; never invent one/);
    assert.equal(general.includes(AMBIENT_PROMPT), ee, "source attribution does not enable Cloud ambient instructions");
    const project = channelLayers({ general: false, recall, ee }).runtime;
    assert.match(project, /Do not retrieve other projects' notes/);
    assert.doesNotMatch(project, /When answering from another channel's memory or Notebook/);
  }
});
