// The Sandbox samples for the chat categories and the background chat jobs (src/sandbox-samples/chat.js).
// Deterministic: every sample builds with no network and no model call, each request comes from the real builders, and no file name is invented.
import assert from "node:assert/strict";
import { seedSettings } from "./helpers/seed-settings.mjs";
import { samples } from "../src/ee/sandbox-samples/chat.js";
import { CATEGORIES } from "../src/ee/pool.js";
import { JOBS } from "../src/ee/model-jobs.js";
import { contextV2 } from "../src/context.js";
import { cutLazy } from "../src/payload-cut.js";
import { genuiEnvOn } from "../src/genui.js";
import { chatPinned, recentChannelLines, chatChannelOptions, composeSystemPrompt, taskDeveloperText, HANDOFF_PROMPT, attachmentNote, currentTimeTag } from "../src/resident.js";
import { notesRequest, noteMessages, refineMessages, finalMessages } from "../src/ee/live-notes.js";
import { jevBody } from "../src/ee/route2.js";
import { labelRequest, labelSchema } from "../src/tracker.js";
import { cardRequest } from "../src/sidecar.js";
import { structuredBody } from "../src/structured-output.js";
import { ambientExtractMessages, ambientReviewMessages } from "../src/ee/ambient.js";
import { browserValuesMessages, browserNextQuestion, BROWSER_VALUES_SCHEMA } from "../src/ee/browser-agent.js";
import { AMBIENT_EXTRACT_SCHEMA, AMBIENT_REVIEW_SCHEMA, NOTE_PATCH_SCHEMA, FINAL_NOTES_SCHEMA } from "../src/background-schemas.js";
import { AMBIENT_LINES, AMBIENT_FOUND } from "../src/ee/sandbox-samples/chat.js";
import { checkGoldenShape } from "./helpers/golden-shape.mjs";

const FIXTURES = new Set(["sample-photo.jpg", "sample-page.png", "sample-doc.pdf", "sample-speech.wav"]);
const settings = seedSettings();
// The public edition gates smart routing (the decider with open sub-agents) and the append task runtime on the Cloud switch, so the fixture sets it.
const env = { ONEHELM_EE: "1hc", MEMORY: "on", HS_USE: "on", HS_FOUNDATIONS: "on", CONTEXT_LAYOUT: "v2", PAYLOAD_CUT: "on", APPEND_TASK_RUNTIME: "on", GENUI: "on", BROWSER_AGENT: "jev", WORKMEM: "on", DYNAMIC_ROUTING: "on", MODEL_SETTINGS: settings };
const ctx = { settings, now: Date.UTC(2026, 9, 19, 17, 0) };
const quiet = console.log; console.log = (...a) => { if (!/^design tools list failed/.test(String(a[0]))) quiet(...a); };   // the design server list is fetched once and fails with no network

const ASSIGNED = ["decider", "handoff", "label", "chat_title", "browser", "notes", "notes_refine", "notes_final", "sidecar_card", "ambient_extract", "ambient_review", "browser_decider", "workers_ai_chat", ...CATEGORIES.map((c) => `chat:${c}`)];
const by = (job) => samples.filter((s) => s.job === job);
const built = {};
const build = async (job) => (built[job] ||= await by(job)[0].build(env, ctx));
const placeholders = (x, out = []) => { if (Array.isArray(x)) x.forEach((v) => placeholders(v, out)); else if (x && typeof x === "object") { if ("$file" in x) out.push(x); else Object.values(x).forEach((v) => placeholders(v, out)); } return out; };
const textOf = (m) => typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => p.text).join("");

// One sample per assigned job, and every chat category of the saved settings is covered.
assert.deepEqual(samples.map((s) => s.job).sort(), [...ASSIGNED].sort(), "exactly one sample per assigned job");
for (const c of settings.routing.categories) assert.equal(by(`chat:${c.id}`).length, 1, `a sample for the saved category ${c.id}`);
for (const id of CATEGORIES) assert.ok(JOBS.every((j) => j.id !== `chat:${id}`), "chat categories are not saved jobs");
for (const id of ASSIGNED.filter((j) => !j.startsWith("chat:"))) assert.ok(JOBS.some((j) => j.id === id), `${id} is a job in model-jobs.js`);

// Every sample builds, names a real function, and uses only the four fixture files.
for (const s of samples) {
  assert.match(s.via, /^[a-z0-9-]+\.js#[A-Za-z]+$/, `${s.job} via`);
  const r = await s.build(env, ctx);
  assert.ok(r.request && typeof r.request === "object", `${s.job} request`);
  assert.ok(Array.isArray(r.files), `${s.job} files`);
  for (const f of r.files) { assert.ok(FIXTURES.has(f.name), `${s.job}: fixture ${f.name}`); assert.equal(f.path, `/app-static/sandbox/${f.name}`); assert.ok(f.type); }
  for (const p of placeholders(r.request)) {
    assert.ok(FIXTURES.has(p.$file), `${s.job}: $file ${p.$file}`); assert.ok(["data_url", "base64", "bytes", "text"].includes(p.as), `${s.job}: as ${p.as}`);
    assert.ok(r.files.some((f) => f.name === p.$file), `${s.job}: $file ${p.$file} is listed in files`);
  }
  assert.doesNotThrow(() => JSON.stringify(r.request), `${s.job} request is plain data`);
}

// The gateway kind the real call site sends, where A's table in the Sandbox has none for the job.
{
  const kinds = Object.fromEntries(samples.filter((x) => x.meta).map((x) => [x.job, x.meta.kind]));
  assert.deepEqual(kinds, { ...Object.fromEntries(CATEGORIES.map((c) => [`chat:${c}`, "chat"])), handoff: "chat", browser_decider: "decider", workers_ai_chat: "chat-fallback" });
}

// Chat: the system prompt is exactly what the real builder returns for the same inputs, and the request carries tools, the picture and the notes.
{
  const r = (await build("chat:general")).request, now = ctx.now;
  assert.equal(contextV2(env), true);
  const msgs = r.messages, roles = msgs.map((m) => m.role);
  assert.deepEqual(roles, ["system", "developer", "user", "user", "user"], "layered request: core, developer rules, standing data, turn data, the person's message");
  const mod = await import("../src/ee/sandbox-samples/chat.js");
  assert.equal(typeof mod.chatRequestFor, "function");
  const pinned = chatPinned(env, [], "on");
  assert.equal(pinned.useOn, true);
  // Rebuild the system prompt from the builders with the same inputs; the core and developer layers must be identical.
  const again = composeSystemPrompt(env, { flagOpts: { browser: true, mode: "on", betterDesign: false }, stable: true, cards: genuiEnvOn(env), layered: true, append: true,
    channelOptions: chatChannelOptions({ ee: true, profile: { first_name: "Maya", helper_name: "Juniper", helper_tone: 1 }, tz: "America/Los_Angeles", channel: "main", ch: { name: "General" }, mmode: "on", mem: "", recent: "", memoryProfile: "" }) });
  assert.equal(msgs[0].content, again.core, "system message is the real core prompt");
  assert.equal(msgs[1].content.endsWith(taskDeveloperText("", { appendRuntime: true, appendLazy: cutLazy(env) && contextV2(env) }).replace(/^\n\n/, "\n\n")), true, "developer layer ends with the real task tool note");
  const runtimeHead = again.developer.split("\n")[0];
  assert.ok(msgs[1].content.startsWith(runtimeHead), "developer layer starts with the real runtime text");
  const standing = msgs[2].content;
  assert.match(standing, /Keep replies short and plain/, "pinned how-to-work notes");
  assert.match(standing, /Portland/, "profile text");
  assert.match(standing, /earlier_channel_messages/, "recent channel messages");
  assert.ok(recentChannelLines([{ created: now, body: "x", bot_id: "None" }]).includes("person: x"));
  assert.match(msgs[3].content, /TURN CONTEXT/);
  const last = msgs.at(-1), pic = last.content.find((p) => p.type === "image_url");
  assert.deepEqual(pic.image_url.url, { $file: "sample-photo.jpg", as: "data_url" }, "attached picture in the shape the real chat sends it");
  const inJson = (t) => JSON.stringify(t).slice(1, -1);   // the turn data is a JSON block
  const note = attachmentNote({ att: [{ name: "sample-photo.jpg", mime: "image/jpeg", bytes: 184320 }], pics: [pic], sc: { got: [], saved: "", body: "" }, unseen: [], extra: 0 });
  assert.ok(textOf(msgs[3]).includes(inJson(note)), "the attachment note is the real one");
  assert.match(textOf(last), /Maple Street Bakery receipt from Oct 14/, "the person's own words come last, with the picture, and they match the picture");
  assert.ok(!/pharmacy/.test(JSON.stringify(msgs)), "nothing in the request calls the receipt a pharmacy receipt");
  assert.ok(textOf(msgs[3]).includes(inJson(currentTimeTag(now, "America/Los_Angeles"))), "the time line is the real one");
  const names = r.tools.map((t) => t.function.name);
  for (const n of ["load_tools", "recall_memory", "web_search", "remember", "list_channels", "start_task"]) assert.ok(names.includes(n), `General tool ${n}`);
  assert.ok(r.tools.every((t) => t.function.parameters.properties.step_title), "every tool has a step_title first");
  assert.equal(r.stream, true);
  // Every category and the backup chat use this same builder: the same core prompt, the same tools, and the backup chat sends the general message.
  for (const id of CATEGORIES) assert.deepEqual((await build(`chat:${id}`)).request.messages[0], msgs[0]);
  assert.deepEqual((await build("workers_ai_chat")).request.tools.map((t) => t.function.name), names);
  assert.deepEqual((await build("workers_ai_chat")).request.messages, msgs, "the backup chat sends the general message");
  // Each category has its own first message, and only the general one carries the picture.
  const asked = {};
  for (const id of CATEGORIES) {
    const b = await build(`chat:${id}`), m = b.request.messages.at(-1);
    asked[id] = textOf(m).split("\n\n")[0];
    assert.equal(typeof m.content === "string", id !== "general", `${id}: the picture is only in the general message`);
    assert.deepEqual(b.files.map((f) => f.name), id === "general" ? ["sample-photo.jpg"] : [], `${id}: files`);
    assert.equal(/The person attached/.test(JSON.stringify(b.request.messages)), id === "general", `${id}: the attachment note is only in the general message`);
  }
  assert.equal(new Set(Object.values(asked)).size, CATEGORIES.length, "every category has its own message");
  assert.match(asked.research, /mileage rate/); assert.match(asked.skills, /six family dentists/); assert.match(asked.spreadsheet, /spreadsheet/);
  assert.match(asked.technical, /expected 1075 to equal 1080/); assert.match(asked.apps_economical, /Chore Tick/); assert.match(asked.apps_complete, /Invoice Desk/);
  assert.match(asked.general, /Maple Street Bakery/); assert.match(asked.general, /Oct 14/);
}

// Handoff: the chat request, the work, then the real hand-off prompt with its JSON format.
{
  const r = (await build("handoff")).request, chat = (await build("chat:general")).request;
  assert.deepEqual(r.messages.slice(0, chat.messages.length), chat.messages);
  assert.equal(r.messages.at(-1).content, HANDOFF_PROMPT);
  assert.equal(r.response_format.json_schema.name, "handoff_notes");
  assert.equal(r.tools, undefined, "the hand-off call offers no tools");
}

// Decider and browser decider: the argument askJob takes, from the real question builders.
{
  const r = (await build("decider")).request, again = jevBody(r.state, Object.assign(Object.create(env), { MODEL_SETTINGS: settings }));
  assert.deepEqual(r.questions, again.questions, "the decider's questions are the real ones");
  assert.ok(r.state.latest_message && Array.isArray(r.state.conversation));
  const b = (await build("browser_decider")).request;
  assert.deepEqual(Object.keys(b.questions), ["next"]);
  assert.deepEqual(b.questions, browserNextQuestion(b.questions.next.criteria));
  assert.ok(Object.values(b.questions.next.criteria).some((l) => /^FINISH/.test(l)), "the menu has the real FINISH action");
  assert.ok(b.state.page_outline_now.includes("New patient form"));
}

// Browser: the real values prompt in the body structuredChat sends.
{
  const r = (await build("browser")).request;
  assert.deepEqual(r.messages[0], browserValuesMessages("x")[0], "system prompt is the real one");
  assert.equal(r.stream, false); assert.equal(r.response_format.json_schema.name, "browser_values"); assert.equal(r.usage.include, true);
}

// Label, file summary and ambient jobs: the system prompts are the real ones, and the body is the one the real call sends.
{
  const label = (await build("label")).request, ref = labelRequest({ msgs: [], steps: [], handoffs: [], reply: "" }, undefined);
  assert.equal(label.messages[0].content, ref.messages[0].content);
  assert.equal(label.response_format.json_schema.name, "task_labels"); assert.equal(label.stream, false); assert.equal(label.temperature, 0);
  const card = (await build("sidecar_card")).request, cref = cardRequest({ name: "a.pdf", bytes: 1 }, "pdf", "x", []);
  assert.equal(card.messages[0].content, cref.messages[0].content);
  assert.ok(card.messages[1].content.includes("sample-doc.pdf") && card.messages[1].content.includes("UNTRUSTED"), "the file text is inline and marked untrusted");
  assert.equal(card.response_format.json_schema.name, "file_card");
  const ex = (await build("ambient_extract")).request;
  assert.equal(ex.messages[0].content, ambientExtractMessages([], [])[0].content);
  assert.deepEqual(JSON.parse(ex.messages[1].content).lines.map((l) => l.line), AMBIENT_LINES.map((_, i) => i));
  assert.equal(ex.response_format.json_schema.name, "ambient_extract");
  const rv = (await build("ambient_review")).request, input = JSON.parse(rv.messages[1].content);
  assert.equal(rv.messages[0].content, ambientReviewMessages({}).at(0).content);
  assert.ok(input.candidates.length >= 1 && input.context.length === AMBIENT_LINES.length, "the review has candidates found by the real checker");
  assert.equal(rv.response_format.json_schema.name, "ambient_review");
}

// Live notes: each request is the one notesRequest wraps, with the real system prompt of its kind and the kind's schema.
{
  const note = (await build("notes")).request, refine = (await build("notes_refine")).request, final = (await build("notes_final")).request;
  const probe = { s: { source: "bee", started_at: 0, ended_at: 60e3, prev: "" }, n: 1, win: { lines: [], omitted: 0 }, lines: [], depth: { minutes: 1, summary: 2, words: 1, topics: 2 }, sec: "", title: "t", tz: "UTC", cur: "", human: [], text: "" };
  assert.equal(note.messages[0].content, noteMessages(probe)[0].content);
  assert.equal(final.messages[0].content, finalMessages(probe)[0].content);
  assert.equal(refine.messages[0].content, refineMessages(probe)[0].content);
  assert.equal(note.response_format.json_schema.name, "live_notes_note");
  assert.equal(final.response_format.json_schema.name, "live_notes_final");
  assert.equal(refine.response_format.json_schema.name, "live_notes_refine");
  assert.equal(JSON.stringify(notesRequest("final", final.messages, undefined)).length > 0, true);
  assert.match(note.messages[1].content, /Transcript so far/); assert.match(final.messages[1].content, /Full transcript/); assert.match(refine.messages[1].content, /Bee's cleaned-up final version/);
  assert.match(final.messages[1].content, /Length guide for this meeting/);
}

// Golden answers: each is well formed, its paths and ids exist in the job's answer schema or in the sample's own request, and the traps are in the request.
{
  const GOLDEN_JOBS = ASSIGNED, props = (schema) => Object.keys(schema.properties);
  for (const job of GOLDEN_JOBS) checkGoldenShape(job, by(job)[0].golden);
  for (const s of samples) assert.ok(s.golden, `${s.job} has a default golden`);
  const jsonOf = (r) => JSON.stringify(r.messages);
  // Facts the golden asks for are in the request the job sends (so a correct reply can carry them), and the paths exist in the job's answer.
  const facts = async (job, field = null) => { const g = by(job)[0].golden, r = (await build(job)).request; assert.equal(g.type, "contains"); assert.equal(g.field, field);
    for (const p of g.value) assert.ok(jsonOf(r).toLowerCase().includes(p.replace(/"/g, "").toLowerCase()) || /^"\d"$/.test(p), `${job}: ${p} is in the request`); return g; };
  await facts("handoff"); await facts("sidecar_card"); await facts("notes_refine"); await facts("chat_title");
  { const g = await facts("label"); assert.ok(g.value.includes('"1"') && g.value.includes('"2"')); assert.deepEqual(Object.keys(labelSchema({ steps: [1, 2] }).properties.why.properties), ["1", "2"], "one why per step, keyed by number"); }
  { const g = by("browser")[0].golden, r = (await build("browser")).request; assert.equal(g.type, "contains"); assert.ok(g.field in BROWSER_VALUES_SCHEMA.properties);
    assert.equal(g.value.length, 3); for (const p of g.value) { assert.match(p, /^".+"$/, "quoted, so the value is exact"); assert.ok(r.messages[1].content.includes(p.slice(1, -1)), `${p} is in the task`); } }
  // The chat jobs: each golden checks only what a correct first answer must do, extras allowed, and what it expects is in the request.
  const WANT = { research: "web_search", skills: "read_skill", spreadsheet: "read_skill", technical: "run_command" }, NAME = { apps_economical: "Chore Tick", apps_complete: "Invoice Desk", general: "72.88" };
  for (const job of [...CATEGORIES.map((c) => `chat:${c}`), "workers_ai_chat"]) {
    const id = job.replace(/^chat:/, ""), g = by(job)[0].golden, r = (await build(job)).request, names = r.tools.map((t) => t.function.name);
    const text = r.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    if (WANT[id]) {
      assert.deepEqual([g.type, g.list, g.match, g.extras_fail], ["items", "tool_calls", ["name"], false], job);
      assert.deepEqual(g.value, [{ name: WANT[id] }], job);
      assert.ok(names.includes(WANT[id]), `${job}: ${WANT[id]} is a tool of the request`);
    } else {
      assert.deepEqual([g.type, g.field, g.value], ["contains", null, [NAME[id] || NAME.general]], job);
      if (id !== "general" && job !== "workers_ai_chat") assert.ok(textOf(r.messages.at(-1)).includes(g.value[0]), `${job}: the name is in the message`);
    }
  }
  // The general golden reads the photo: the total is on the sample photo's receipt (the fixture's own page), not in the request text.
  assert.ok(!JSON.stringify((await build("chat:general")).request.messages).includes("72.88"), "the total is only in the picture");
  assert.equal(by("handoff")[0].golden.value[0], "72.88");
  const itemProps = (schema) => schema.properties.items.items.properties;

  // Ambient review: one verdict for each candidate of the request, covering all three verdicts, and the schema's own fields.
  { const g = by("ambient_review")[0].golden, cands = JSON.parse((await build("ambient_review")).request.messages[1].content).candidates, item = itemProps(AMBIENT_REVIEW_SCHEMA);
    assert.equal(g.list, "items"); assert.ok(g.id in item && g.field in item);
    assert.deepEqual(g.options, item.verdict.enum);
    assert.deepEqual(Object.keys(g.value).sort(), cands.map((c) => c.id).sort(), "a verdict for every candidate");
    assert.deepEqual(new Set(Object.values(g.value)), new Set(["retain", "uncertain", "drop"]));
    assert.equal(cands.length, AMBIENT_FOUND.length);
    cands.forEach((c, i) => assert.equal(g.value[c.id], AMBIENT_FOUND[i].verdict, `${c.id} follows AMBIENT_FOUND`));
    const by_line = Object.fromEntries(cands.map((c) => [c.line, g.value[c.id]]));
    assert.match(AMBIENT_LINES[5][1], /^Order in the next ten minutes/); assert.equal(by_line["current:5"], "drop", "the advertisement is dropped");
    assert.match(AMBIENT_LINES[7][1], /say we needed to order/); assert.equal(by_line["current:7"], "drop", "the example is dropped");
    assert.equal(by_line["current:8"], "uncertain", "the half thought is uncertain");
    assert.equal(by_line["current:9"], "retain", "the bill already paid is kept as an update");
  }
  // Ambient extract: expected lines exist, say what the golden claims, and the fields and values are in the schema.
  { const g = by("ambient_extract")[0].golden, item = itemProps(AMBIENT_EXTRACT_SCHEMA), lines = JSON.parse((await build("ambient_extract")).request.messages[1].content).lines;
    assert.equal(g.list, "items"); for (const f of g.match) assert.ok(f in item, `${f} is a field of an extracted item`);
    for (const e of g.value) {
      assert.ok(Number.isInteger(e.line) && e.line >= 0 && e.line < lines.length, "the line exists in the request");
      if (e.kind) assert.ok(item.kind.enum.includes(e.kind)); if (e.status) assert.ok(item.status.enum.includes(e.status));
      if (e.relation) assert.ok(item.relation.anyOf[0].enum.includes(e.relation));
    }
    const text = (n) => lines[n].text;
    assert.match(text(g.value.find((e) => e.status === "completed").line), /already paid/);
    assert.match(text(g.value.find((e) => e.relation === "correction").line), /^Actually/);
    for (const n of [5, 7, 8]) assert.ok(!g.value.some((e) => e.line === n), `line ${n} (media, example, half thought) is not expected`);
  }
  // Decider and browser decider: the question ids and the answers are in the request.
  { const g = by("decider")[0].golden, q = (await build("decider")).request.questions;
    assert.equal(g.list, ""); assert.equal(g.id, null); assert.equal(g.field, "choice");
    for (const [id, v] of Object.entries(g.value)) { assert.equal(q[id].type, "choice"); assert.ok(v in q[id].criteria, `${id}: ${v} is offered`); }
    assert.deepEqual([...g.options].sort(), Object.keys(q.steer.criteria).sort());
    const b = by("browser_decider")[0].golden, bq = (await build("browser_decider")).request.questions;
    assert.equal(b.field, "choice"); assert.equal(bq[Object.keys(b.value)[0]].criteria[b.value.next], 'Choose "Thursday" in dropdown "Preferred day"');
    assert.ok(Object.values(bq.next.criteria).some((l) => /^Click button "Submit request"/.test(l)), "the too early Submit button is on the menu");
    assert.ok(JSON.stringify((await build("browser_decider")).request.state.previous_actions).includes("503-555-0142"), "the phone number is already typed");
  }
  // Live notes and final notes.
  { const g = by("notes")[0].golden, ops = NOTE_PATCH_SCHEMA.properties.ops.items.anyOf, all = new Set(ops.flatMap((o) => Object.keys(o.properties))), r = (await build("notes")).request, user = r.messages[1].content;
    assert.equal(g.list, "ops"); for (const f of g.match) assert.ok(all.has(f), `${f} is a field of a note op`);
    const sec = ops.find((o) => o.properties.sec).properties.sec.enum;
    for (const e of g.value) { if (e.sec) assert.ok(sec.includes(e.sec)); if (e.op) assert.ok(ops.some((o) => o.properties.op.enum[0] === e.op)); }
    const fresh = user.split("NEW transcript lines:")[1].split("Current session")[0];
    assert.match(fresh, /Wednesday instead/); assert.match(fresh, /drop the two extra interview slots/);
    assert.match(user, /Book the pricing call.*due: Tuesday/, "the notes so far still say Tuesday"); assert.match(user, /Keep the two extra interview slots\?/, "the question to remove is in the notes");
    const f = by("notes_final")[0].golden, act = FINAL_NOTES_SCHEMA.properties.actions.items.properties, full = (await build("notes_final")).request.messages[1].content;
    assert.equal(f.list, "actions"); for (const m of f.match) assert.ok(m in act, `${m} is a field of an action`);
    for (const e of f.value) { assert.ok(full.includes(e.due), `${e.due} is in the transcript`); assert.ok(full.includes(e.owner)); }
    assert.ok(f.value.some((e) => e.due === "Wednesday") && !f.value.some((e) => e.due === "Tuesday"), "the corrected day is the one expected");
  }
}

// A prompt builder that changes shows up in the sample with no edit to the sample (structuredBody is the one wrapper the real call uses).
assert.equal(structuredBody({ messages: [] }, "n", { type: "object", properties: {}, required: [], additionalProperties: false }).stream, false);

console.log = quiet;
console.log("PASS sandbox chat samples:", samples.length, "samples");
