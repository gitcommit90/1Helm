// node --import ./test/stubs/register.mjs test/memory-use.test.mjs
// Using memory in a turn (src/memory-use.js, flag HS_USE), on the Mem0 memory fakes (D1, Vectorize, embeddings) and a scripted extraction model that finds no facts and records what it is given. Checks:
//  A. Pure parts: the flag and the arm, the wrapped memory block and stripping it, the recall tool arguments and dates, the arm helpers (the query is the message alone).
//  B. The arm with a fake search: its request, and a timeout or an error leaves the turn without memory and says why.
//  C. The Resident: the profile in the standing context (the channel's facts by category, "how" notes verbatim, nightly note and 3,000 character slice gone),
//     flag off unchanged, the recall tool with a date range, crossChannelRecall.
//  D. A real turn on both engines: arm B adds memory to the turn context (never the system prompt), arm A adds nothing, the added memory is stripped before the
//     turn is retained, the deadline, the dev only setting and the ops route.
import assert from "node:assert/strict";
import { world, tick } from "./deploy-harness.mjs";
import { readFileSync } from "node:fs";
import { hsUse } from "../src/hs-flag.js";
import { wrapMemory, stripInjectedMemory, MEM_OPEN, MEM_CLOSE } from "../src/memory-block.js";
import { autoQuery, packInjected, runArmB, recallArgs, dayStart, armOf, B_HEADER } from "../src/memory-use.js";
import { retainV2, bankId, factsOf, categoryBlock } from "../src/mem0.js";
import { convEntries } from "../src/hindsight-writers.js";
import { speakerLabels } from "../src/hindsight-template.js";
import { Resident } from "../src/resident.js";
import { CONTEXT_TOOLS, CONTEXT_TOOLS_USE, contextReceipt } from "../src/context.js";
import { staticCore, channelBlock } from "../src/prompt/index.js";
import { channelLayers } from "../src/prompt/context-layers.js";
import { memEnv, embedding } from "./helpers/mem0-fakes.mjs";

const log0 = console.log, LOGS = []; console.log = (...a) => { if (/^ {2}ok /.test(a.join(" "))) log0(...a); else LOGS.push(a.join(" ")); };
process.on("exit", (c) => { if (c) log0(LOGS.slice(-40).join("\n")); });
const ok = (name) => console.log("  ok", name);
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
// Waits for a background effect (the retain write) instead of guessing a delay: a fixed sleep is too short when the full suite loads the host.
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(10); };
const text = (m) => typeof m.content === "string" ? m.content : m.content?.filter((p) => p.type === "text").map((p) => p.text).join("");

// ================= A. pure parts =================
{
  assert.equal(hsUse({ HS_USE: "on", HS_FOUNDATIONS: "on" }), true);
  assert.equal(hsUse({ HS_USE: "on" }), false, "needs HS_FOUNDATIONS");
  assert.equal(hsUse({ HS_USE: "off", HS_FOUNDATIONS: "on" }), false); assert.equal(hsUse({}), false); assert.equal(hsUse(undefined), false);
  const on = { HS_USE: "on", HS_FOUNDATIONS: "on" };
  assert.equal(armOf(on, "B"), "B"); assert.equal(armOf(on, ""), "B", "B is the default for every channel"); assert.equal(armOf(on, "A"), "A", "dev can override to A");
  assert.equal(armOf(on, "B2"), "B", "an unknown setting falls back to the default"); assert.equal(armOf({ ...on, ENV_NAME: "live" }, "B"), "B", "armOf does not look at the environment; only the dev ops route can store a setting");
  assert.equal(armOf({ HS_USE: "off", HS_FOUNDATIONS: "on" }, "B"), "A", "flag off");
  ok("A1. the flag needs HS_FOUNDATIONS; the arm is B unless dev sets A");
}
{
  // the wrapped block and stripping
  const w = wrapMemory("Sam is allergic to peanuts."); assert.ok(w.startsWith(MEM_OPEN) && w.endsWith(MEM_CLOSE));
  assert.equal(wrapMemory(""), ""); assert.equal(wrapMemory("  \n"), "");
  assert.equal(stripInjectedMemory(`Build me a website\n\n${w}`), "Build me a website");
  assert.equal(stripInjectedMemory(`${w}\nAnswer: done\n${w}`), "Answer: done");
  assert.equal(stripInjectedMemory(`Hello ${MEM_OPEN}\nunterminated block that goes on`), "Hello", "an opening tag with no end removes the rest");
  assert.equal(stripInjectedMemory("no block here\n\n\nkept as it is"), "no block here\n\n\nkept as it is", "text with no tags is returned untouched");
  assert.equal(stripInjectedMemory(null), ""); assert.equal(stripInjectedMemory(undefined), "");
  // the conversation writer's choke point: nothing injected reaches Hindsight, and ordinary text is as before
  const L = speakerLabels({ first: "Sam", helper: "Ollie" });
  const e = convEntries({ userText: `Plan dinner\n${w}`, reply: `${w}\nHow about pasta?`, notes: `- note\n${w}`, at: 1e12, labels: L, tz: "UTC" });
  assert.equal(e.length, 3); assert.equal(e[0].text, "Plan dinner"); assert.equal(e[1].text, "How about pasta?"); assert.equal(e[2].text, "- note");
  assert.ok(!JSON.stringify(e).includes("injected-memory") && !JSON.stringify(e).includes("peanuts"), "the writer strips the memory block");
  assert.equal(convEntries({ userText: "just words", reply: "ok", at: 1e12, labels: L, tz: "UTC" })[0].text, "just words");
  ok("A3. memory added to a turn is wrapped, stripped before retain (also unterminated), ordinary text untouched");
}
{
  // recall tool arguments
  const tz = "America/Los_Angeles";
  assert.deepEqual(recallArgs({ query: "x" }, tz), { range: null });
  const r = recallArgs({ from: "2026-10-03", to: "2026-10-09" }, tz).range;
  assert.equal(r.from, Date.parse("2026-10-03T00:00:00-07:00"), "a date is that local midnight");
  assert.equal(r.to, Date.parse("2026-10-10T00:00:00-07:00"), "to is the last day included (the next midnight)");
  assert.match(r.label, /Oct 3, 2026 to .*Oct 9, 2026/);
  assert.equal(recallArgs({ from: "2026-11-01", to: "2026-11-02" }, tz).range.to - recallArgs({ from: "2026-11-01", to: "2026-11-02" }, tz).range.from, 49 * 3600e3, "a daylight saving change: Nov 1 (25 hours) and Nov 2 span 49 hours in LA");
  assert.equal(dayStart(2026, 11, 1, tz), Date.parse("2026-11-01T00:00:00-07:00")); assert.equal(dayStart(2026, 11, 2, tz), Date.parse("2026-11-02T00:00:00-08:00"));
  assert.equal(recallArgs({ from: "2026-10-03T09:30:00Z" }, tz).range.from, Date.parse("2026-10-03T09:30:00Z"), "a full ISO time is used as it is");
  assert.equal(recallArgs({ from: "2026-10-03" }, tz).range.to, null); assert.equal(recallArgs({ to: "2026-10-03" }, tz).range.from, null);
  assert.match(recallArgs({ from: "last week" }, tz).error, /dates like 2026-10-03/); assert.match(recallArgs({ from: "2026-10-09", to: "2026-10-03" }, tz).error, /after from/);
  // the tool schema: the old one with the flag off, optional dates with it on
  const old = CONTEXT_TOOLS.find((t) => t.function.name === "recall_memory"), nu = CONTEXT_TOOLS_USE.find((t) => t.function.name === "recall_memory");
  assert.deepEqual(Object.keys(old.function.parameters.properties), ["query"], "flag off: the schema is unchanged");
  assert.deepEqual(Object.keys(nu.function.parameters.properties), ["query", "from", "to"]); assert.deepEqual(nu.function.parameters.required, ["query"]);
  assert.equal(CONTEXT_TOOLS_USE.length, CONTEXT_TOOLS.length); assert.deepEqual(CONTEXT_TOOLS_USE.filter((t) => t.function.name !== "recall_memory"), CONTEXT_TOOLS.filter((t) => t.function.name !== "recall_memory"));
  ok("A5. recall tool arguments: dates are local days (also across a daylight saving change), to is inclusive, old schema with the flag off");
}
{
  // arm helpers
  assert.equal(autoQuery("Build me a website", null), "Build me a website");
  assert.equal(autoQuery("and her?", { user: "My sister Dana visits", reply: "Nice, when?" }), "and her?", "the query is the message alone: no previous turn is added");
  assert.ok(autoQuery("x".repeat(5000)).length <= 2000);
  const lines = packInjected([{ type: "preference", text: "Sam prefers HTML for sites.", mentioned_at: "2026-10-03T12:00:00Z" }, { type: "person", text: "Sam is allergic to peanuts.", mentioned_at: "2026-10-05T12:00:00Z", metadata: { context: "1Helm chat" } }, { type: "other", raw: true, text: "The plumber said the leak is fixed.", mentioned_at: "2026-10-06T12:00:00Z" }], { tz: "UTC" });
  assert.match(lines, /^- \[Sat, Oct 3, 2026 · preference\] Sam prefers HTML/); assert.match(lines, /\[Mon, Oct 5, 2026 · person\] Sam is allergic/); assert.match(lines, /\[Tue, Oct 6, 2026 · recording\] The plumber/); assert.ok(!lines.includes("1Helm chat"), "the context string is left out");
  assert.equal(packInjected([{ type: "other", text: "a".repeat(400) }, { type: "other", text: "b".repeat(400) }], { maxChars: 500 }).split("\n").length, 1, "limited by characters");
  assert.ok(!/hunter2/.test(packInjected([{ type: "other", text: "my password is hunter2 and my api key is sk-abcdefghijklmnopqrstuvwx1234" }])), "secrets are scrubbed");
  ok("A6. arm helpers: the message alone as the query, injected lines without context");
}

// ================= B. the arm with a fake search =================
{
  const calls = []; let out = { results: [{ id: "o1", type: "preference", text: "Sam prefers plain HTML for every website.", mentioned_at: "2026-10-03T12:00:00Z" }, { id: "w1", type: "person", text: "Sam is allergic to peanuts.", mentioned_at: "2026-10-04T12:00:00Z" }], ms: 321 };
  const recallFn = async (q, o) => { calls.push({ q, o }); if (out instanceof Error) throw out; return out; };
  const now = Date.UTC(2026, 9, 14, 17);
  let r = await runArmB({ recall: recallFn, text: "Build me a website", now, tz: "UTC" });
  assert.equal(calls[0].q, "Build me a website", "no previous turn in the query"); assert.deepEqual(calls[0].o, { topK: 10 });
  assert.ok(r.block.startsWith(MEM_OPEN) && r.block.includes(B_HEADER) && r.block.includes("plain HTML") && r.block.endsWith(MEM_CLOSE));
  assert.equal(r.n, 2); assert.deepEqual(r.ids, ["o1", "w1"]); assert.equal(r.search_ms, 321); assert.ok(!r.error);
  out = { results: [] }; r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC" }); assert.equal(r.block, "", "nothing recalled adds nothing");
  out = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC" });
  assert.equal(r.block, ""); assert.equal(r.timedOut, true); assert.match(r.error, /timeout/);
  out = new Error("memory search 500"); r = await runArmB({ recall: recallFn, text: "x", now, tz: "UTC" }); assert.equal(r.block, ""); assert.ok(!r.timedOut); assert.match(r.error, /500/);
  ok("B1. arm B: the message alone with topK 10; empty, timeout and error add nothing");
}

// ================= C. the Resident: profile, recall tool, cross channel =================
const T = Date.UTC(2026, 9, 14, 17, 0);
// The world's Resident with the Mem0 fakes: the world's D1 gets the memory tables, and its AI binding also answers embeddings (every embedded text is recorded).
function mk({ flag = "on", engine = "classic", notes = [], channel = "main", extraEnv = {}, embedDelay = 0 } = {}) {
  const { env: m, index } = memEnv(), semantic = [], { DB: _db, AI: _ai, ...memory } = m;
  const W = world({ engine, openrouter: true, env: { CONTEXT_LAYOUT: "v2", RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0, GENUI: "on", MEMORY: "on", ...memory, HS_FOUNDATIONS: "on", HS_USE: flag, HS_WRITERS: "on", ...extraEnv } });
  // The scripted model also answers the memory's extraction calls: it finds no facts, and the prompts it was given are kept in W.extracted.
  const isExtraction = (a) => /Observation Date/.test(JSON.stringify(a.messages)); let inner = () => "Done."; W.extracted = [];
  Object.defineProperty(W, "brain", { configurable: true, get: () => (a) => (isExtraction(a) ? (W.extracted.push(JSON.stringify(a.messages)), '{"memory":[]}') : inner(a)), set: (f) => { inner = f; } });
  W.mainCall = () => W.calls.find((c) => c.who === "main" && !isExtraction(c));
  W.d1.exec(readFileSync(new URL("../db/migrations/0063_memory.sql", import.meta.url), "utf8"));
  W.env.DB.batch = async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; };
  const brainAI = W.env.AI.run; W.env.AI.run = async (model, body) => (body.text ? (semantic.push(...body.text), embedDelay && await sleep(embedDelay), { data: body.text.map(embedding), usage: {} }) : brainAI(model, body));
  W.d1.exec("ALTER TABLE tenants ADD COLUMN owner_user_id TEXT; UPDATE tenants SET owner_user_id='u1'; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','chk+mu@example.com');");   // a test account, so the first write does not start a rebuild of the channel's memory
  W.d1.exec("ALTER TABLE tenants ADD COLUMN helper_tone INTEGER; CREATE TABLE vault (tenant_id TEXT,name TEXT,hosts TEXT); CREATE TABLE logins (tenant_id TEXT,site TEXT,username TEXT);");
  W.d1.exec("CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc)); CREATE TABLE IF NOT EXISTS hs_rebuild_runs (bank TEXT PRIMARY KEY, tenant TEXT, channel TEXT, status TEXT NOT NULL, phase TEXT, version INTEGER, started_at INTEGER, updated_at INTEGER NOT NULL, summary TEXT);");
  const rows = notes, arch = { channel: async () => ({ channel: { name: channel, purpose: "Home base" }, memory: rows, messages: [] }), channels: async () => [{ id: 1, name: channel, slug: channel }, { id: 2, name: "recipes", slug: "recipes" }],
    wsRecall: async () => ({ pack: "", ids: [], people: [] }), homeNote: async () => "", reflectionNote: async () => ({ id: "reflect-how", content: "NIGHTLY: prefers short emails." }), peopleList: async () => [], noteRow: async (c, id) => rows.find((x) => x.id === id) || null };
  W.env.ARCHIVE = { idFromName: (n) => n, get: () => arch };
  const attach = (R) => { R.systemPrompt = Resident.prototype.systemPrompt; R.conns = async () => [];
    R.put("channel", channel); R.put("tenant", "t1"); R.put("channel_id", "1"); R.archive = () => arch; return R; };
  const boot = W.boot; W.boot = () => attach(boot()); attach(W.R); W.arch = arch; W.index = index; W.semantic = semantic;
  // Saves facts word for word: [category, text, at].
  W.seed = async (slug, facts) => { for (const [i, [category, t, at]] of facts.entries()) await retainV2(W.env, bankId(W.env, "t1", slug), [{ document_id: `seed:${slug}:${i}`, content: t, at: at ?? T - i * 1e3, strategy: "verbatim", metadata: { category } }]); };
  return W;
}
const mine = (id, content, sec, at, x = {}) => ({ id, content, kind: "preference", sec, author_type: "human", status: "current", created: at, ...x });
const agentNote = (id, content, sec, at) => ({ id, content, kind: sec === "how" ? "preference" : "fact", sec, author_type: "agent", status: "current", created: at });
{
  // the profile in the standing context
  const notes = [mine("n1", "Always send me a plan before you start. No exceptions, even for small jobs, and keep every line of the plan short.", "how", T - 5e6), mine("n2", "My dentist is Dr. Okafor on Elm Street.", "about", T - 4e6), agentNote("n3", "Prefers aisle seats", "how", T - 3e6), { id: "reflect-how", content: "NIGHTLY: prefers short emails.", kind: "preference", sec: "how", author_type: "agent", src: "reflection", status: "current", created: T - 9e6 }, ...Array.from({ length: 40 }, (_, i) => mine(`b${i}`, `Note ${i} about the broadcast team and their streaming schedule that is long enough to fill the budget nicely.`, "about", T - 1e6 - i))];
  const W = mk({ notes }), R = W.R; R.memoryMode = () => "on";
  await W.seed("main", [["identity", "Sam lives in Austin with his wife Lilly"], ["preference", "Sam is allergic to peanuts"]]);
  const p1 = await R.systemPrompt(true, false, true), standing = p1.standing, facts = await factsOf(W.env, bankId(W.env, "t1", "main"));
  assert.equal(standing.memory_profile, categoryBlock(facts), "the profile is the channel's facts by category"); assert.match(standing.memory_profile, /^Identity:\n- Sam lives in Austin with his wife Lilly/); assert.match(standing.memory_profile, /Sam is allergic to peanuts/);
  assert.match(p1.developer, /memory_profile is what you already know about the person/);
  assert.ok(standing.pinned_notes.includes("- (you) Always send me a plan before you start. No exceptions, even for small jobs, and keep every line of the plan short."), "their own how note is pinned word for word");
  assert.ok(!standing.pinned_notes.includes("dentist") && !standing.pinned_notes.includes("Note 3") && !standing.pinned_notes.includes("aisle") && !standing.pinned_notes.includes("NIGHTLY"), "the 3,000 character slice, other notes and the nightly note are gone from the prompt");
  assert.ok(!/\+\d+ more note/.test(standing.pinned_notes));
  assert.equal(R._pinned.includes("Austin"), true, "the ask first guard reads the profile too");
  assert.equal(JSON.stringify((await R.systemPrompt(true, false, true)).standing), JSON.stringify(standing), "the standing context is the same until a fact is added");
  await W.seed("main", [["place", "Sam works from a studio on Elm Street"]]); assert.match((await R.systemPrompt(true, false, true)).standing.memory_profile, /studio on Elm Street/, "a new fact shows in the next prompt");
  // a project channel reads its own facts only
  const W2 = mk({ channel: "recipes", notes: [] }); W2.R.memoryMode = () => "on"; await W2.seed("recipes", [["other", "Recipes for the Okafor family"]]); await W2.seed("main", [["other", "NOT THIS"]]);
  const q2 = await W2.R.systemPrompt(true, false, true); assert.match(q2.standing.memory_profile, /Recipes for the Okafor family/); assert.ok(!/NOT THIS/.test(q2.standing.memory_profile), "a channel's profile holds only its own facts");
  // flag off: the old layout exactly (slice, nightly note, no profile key)
  const W3 = mk({ flag: "off", notes }); W3.R.memoryMode = () => "on"; await W3.seed("main", [["other", "SHOULD NOT SHOW"]]); const p3 = await W3.R.systemPrompt(true, false, true);
  assert.ok(!("memory_profile" in p3.standing), "flag off: no profile key, the prompt is as before"); assert.ok(!p3.standing.pinned_notes.includes("NIGHTLY"), "flag off: the old nightly note is never pinned (that job is gone)"); assert.ok(p3.standing.pinned_notes.includes("dentist"));
  assert.ok(!/memory_profile/.test(p3.developer)); assert.ok(p3.standing.pinned_notes.length <= 3000 + 1700 + 200, "flag off: the 3,000 character slice");
  // the classic (non layered) block carries it too, and nothing when empty
  assert.match(channelBlock({ firstName: "Sam", pinned: "- (you) x", memoryProfile: "Sam is vegetarian." }), /What you already know about them[^\n]*\nSam is vegetarian\./); assert.doesNotMatch(channelBlock({ firstName: "Sam", pinned: "x" }), /What you already know about them/);
  assert.equal("memory_profile" in channelLayers({ channel: "x" }).data, false, "no key when there is no profile"); assert.equal(channelLayers({ channel: "x", memoryProfile: "p" }).data.memory_profile, "p");
  // memory off: no profile
  const W4 = mk({ notes }); W4.R.memoryMode = () => "off"; await W4.seed("main", [["other", "x"]]); assert.ok(!("memory_profile" in (await W4.R.systemPrompt(true, false, true)).standing));
  ok("C1. profile in the standing context: the channel's own facts by category, how notes verbatim, slice and nightly note replaced, flag off keeps the slice, memory off has none");
}
{
  // the prompt rule and its flag
  const on = staticCore({ context_v2: true, recall: true, use: true }), off = staticCore({ context_v2: true, recall: true });
  assert.match(on, /Use what you know about the person without saying that you remember it/); assert.match(on, /The result may show the constraint as a property of what you offer/); assert.match(on, /The reply never explains or cites the remembered fact or the reason for the choice/); assert.match(on, /Good: "Here are three weekend trips[^\n]*Bad: "Since you have a dog/);
  assert.doesNotMatch(off, /without saying that you remember it/); assert.doesNotMatch(off, /correct_memory/); assert.doesNotMatch(on, /correct_memory/); assert.doesNotMatch(on + off, /rewritten each night/, "the nightly note job is gone"); assert.match(on, /The notes the person wrote themselves are pinned/);
  ok("C2. the silent memory rule is in the prompt only with the flag; no correct_memory, no nightly note");
}
{
  // recall_memory with a date range: the search is limited to the range, and the exact list of that period is added
  const W = mk(), R = W.R; R.memoryMode = () => "on"; R.put("tz", "America/Los_Angeles");
  await W.seed("main", [["other", "Sam mentioned the Lisbon trip", Date.UTC(2026, 9, 4, 12)], ["other", "Wedding in Lisbon", Date.UTC(2026, 8, 1)]]);
  const ctx = { context: { version: 2 }, session: "s1", turn: "t-1" };
  const out = await R.localToolInner("recall_memory", { query: "Lisbon trip", from: "2026-10-03", to: "2026-10-09" }, ctx);
  assert.match(out, /Records in the date range you asked for/); assert.match(out, /Sam mentioned the Lisbon trip/); assert.ok(!/Wedding in Lisbon/.test(out), "a fact outside the range is left out");
  const all = await R.localToolInner("recall_memory", { query: "Lisbon" }, ctx); assert.match(all, /Wedding in Lisbon/); assert.match(all, /Sam mentioned the Lisbon trip/); assert.ok(!/Records in the date range/.test(all), "no list without dates");
  assert.match(await R.localToolInner("recall_memory", { query: "x", from: "yesterday" }, ctx), /^error: from and to must be dates/);
  // flag off: extra arguments ignored
  const W2 = mk({ flag: "off" }); W2.R.memoryMode = () => "on"; await W2.seed("main", [["other", "Wedding in Lisbon", Date.UTC(2026, 8, 1)]]);
  const off = await W2.R.localToolInner("recall_memory", { query: "Lisbon", from: "2026-10-03" }, ctx); assert.match(off, /Wedding in Lisbon/, "flag off: the dates do not limit the search"); assert.ok(!/Records in the date range/.test(off));
  ok("C3. recall_memory: a date range limits the search and lists that period, invalid dates refused, flag off as before");
}
{
  // crossChannelRecall: a weakly matching fact in another channel is still kept, flag on or off
  for (const flag of ["on", "off"]) {
    const W = mk({ flag }), R = W.R; R.memoryMode = () => "on"; await W.seed("recipes", [["other", "Dinner idea pasta with a long list of unrelated words about boats, tides, harbors, ropes, sails, anchors and docks"]]);
    const x = await R.crossChannelRecall("pasta", null); assert.equal(x.ids.length, 1, `flag ${flag}: the result is kept whatever its score`);
  }
  ok("C4. crossChannelRecall: no score cut, with the flag on or off");
}

// ================= D. a real turn: the arms =================
for (const engine of ["classic", "pi"]) {
  const W = mk({ engine }), R = W.R; R.memoryMode = () => "on"; R.put("tz", "UTC");
  await W.seed("main", [["preference", "Sam prefers plain HTML for every website"]]);
  const turn = async (msg, session) => { W.calls.length = 0; W.brain = () => "Built it with plain HTML."; const r = await R.runTurn("t1", "main", "1", msg, null, { session: session || R.newSession("T") }); assert.ok(!r.error, r.error); return { r, call: W.mainCall() }; };
  const turnCtx = (call) => call.messages.find((m) => /^\[BEGIN TURN CONTEXT\]/.test(text(m))); const all = (call) => JSON.stringify(call.messages);
  // the default arm is B: the memory goes in the turn context
  let { call } = await turn("Build me a website"); const tcx = text(turnCtx(call)); assert.match(tcx, /injected_memory/); assert.match(tcx, /Sam prefers plain HTML for every website/); assert.match(tcx, /<injected-memory>/);
  assert.ok(call.messages.slice(0, 3).every((m) => !text(m).includes("injected-memory")), `${engine}: never in the system prompt, the developer text or the standing context`);
  assert.equal(text(call.messages.at(-1)), "Build me a website", "the person's own message is unchanged");
  assert.ok(W.semantic.includes("Build me a website"), "the search is the message alone");
  const trace = JSON.parse(W.turns().at(-1).trace), arm = trace.find((t) => t.tool === "memory_arm"); assert.ok(arm && arm.args === "B" && /"n":1/.test(arm.out), "the turn trace records the arm and its result count"); assert.ok(Number.isFinite(arm.ms));
  assert.equal(contextReceipt({ ...{ sections: [] }, turn: { injected_memory: "x" } }, [], []).automatic_recall, true); assert.equal(contextReceipt({ sections: [], turn: {} }, [], []).automatic_recall, false);
  // retain: the added memory is never retained (what the extraction model is given)
  await tick(); await until(() => W.extracted.join().includes("Build me a website")); await sleep(30); const sent = W.extracted.join();
  assert.ok(sent.includes("Build me a website"), "the conversation is retained"); assert.ok(!sent.includes("injected-memory") && !sent.includes(B_HEADER.slice(0, 40)), `${engine}: the added memory is not retained`);
  assert.ok(!JSON.stringify(W.turns().at(-1)).includes("injected-memory"), "nor saved in the turn row");
  // a follow up sends its own words alone: the previous turn is not added to the query
  W.semantic.length = 0; await turn("and for my sister?"); assert.ok(W.semantic.includes("and for my sister?")); assert.ok(!W.semantic.some((t) => /website/.test(t) && /sister/.test(t)));
  // arm A (dev override): nothing added and no search
  assert.equal((await R.memArmAdmin({ arm: "A" })).effective, "A"); W.semantic.length = 0; ({ call } = await turn("Build me a website")); assert.ok(!all(call).includes("injected-memory"), `${engine}: arm A adds nothing`); assert.ok(!W.semantic.includes("Build me a website"), "no search without an arm");
  assert.equal((await R.memArmAdmin({ arm: "B" })).effective, "B"); assert.equal(R.get("mem_arm"), "B");
  // arms C and B2 no longer exist
  assert.match((await R.memArmAdmin({ arm: "C" })).error, /arm must be A, B or default/); assert.match((await R.memArmAdmin({ arm: "B2" })).error, /arm must be A, B or default/);
  // flag off: the setting is ignored
  const off = mk({ flag: "off", engine }); off.R.memoryMode = () => "on"; off.R.put("mem_arm", "B"); await off.seed("main", [["preference", "Sam prefers plain HTML for every website"]]);
  off.brain = () => "ok"; const ro = await off.R.runTurn("t1", "main", "1", "Build me a website", null, { session: off.R.newSession("T") }); assert.ok(!ro.error); assert.ok(!JSON.stringify(off.calls).includes("injected-memory")); await tick(); assert.ok(!off.semantic.includes("Build me a website"), "flag off: no arm runs");
  assert.match(JSON.stringify(await off.R.memArmAdmin({ arm: "B" })), /HS_USE is off/);
  ok(`D1. ${engine}: arm B adds memory to the turn context only, with the message alone as the search; arm A adds nothing; the added memory is not retained; flag off ignores the setting`);
}
{
  // the append task runtime builds its request from the same turn context (contextMessages over tc.context), so the added memory is a turn context field there too
  const { contextMessages } = await import("../src/context.js");
  const ms = contextMessages([{ role: "system", content: "x" }, { role: "user", content: "Build me a website" }], { version: 2, core: "core", developer: "dev", standing: { memory_profile: "Sam, Austin." }, turn: { time: "now", injected_memory: wrapMemory("Prefers plain HTML.") }, userText: "Build me a website", modelUserText: "Build me a website" });
  assert.deepEqual(ms.map((m) => m.role), ["system", "developer", "user", "user", "user"]); assert.match(ms[2].content, /memory_profile/); assert.match(ms[3].content, /^\[BEGIN TURN CONTEXT\][\s\S]*injected_memory[\s\S]*Prefers plain HTML/); assert.ok(!ms[0].content.includes("HTML") && !ms[1].content.includes("HTML")); assert.equal(ms[4].content, "Build me a website");
  ok("D4. the turn context message carries injected_memory and the profile rides in the standing context (the append lane uses the same assembly)");
}
{
  // the turn never waits past the deadline, whatever the arm is still doing
  const W = mk({ extraEnv: { HS_USE_DEADLINE_MS: "150" }, embedDelay: 500 }), R = W.R; R.memoryMode = () => "on"; await R.memArmAdmin({ arm: "B" }); await W.seed("main", [["other", "Slow memory"]]);
  const h = R.memUseStart("Dinner?", { session: "s", turn: "tt" }); assert.equal(h.deadline, 150); const t0 = Date.now(); const j = await R.memUseJoin(h, { session: "s", turn: "tt" }); const took = Date.now() - t0;
  assert.ok(took < 400, `the join returned at the deadline (${took} ms), not when the search finished`); assert.equal(j.block, ""); assert.equal(j.info.error, "deadline"); assert.ok(j.info.waited_ms < 400);
  const { armDeadline } = await import("../src/memory-use.js"); assert.equal(armDeadline({}), 5000); assert.equal(armDeadline({ HS_USE_DEADLINE_MS: "50" }), 5000); assert.equal(armDeadline({ HS_USE_DEADLINE_MS: "900" }), 900);
  { const rc = R.mem.stats().receipts.find((x) => x.turn === "tt"); assert.ok(rc && /^on:memory/.test(rc.mode), "the arm leaves a receipt with the recall mode, even when it timed out"); }
  ok("D2b. the active arm never holds the turn past the deadline (HS_USE_DEADLINE_MS, default 5000 ms)");
}
{
  // the active arm is the only memory search of a turn
  const W = mk(), R = W.R; R.memoryMode = () => "on"; await W.seed("main", [["person", "Sam is allergic to peanuts"]]);
  await R.memArmAdmin({ arm: "A" });
  W.brain = () => "Try lemon chicken."; const r = await R.runTurn("t1", "main", "1", "Let's find a good recipe for dinner!", null, { session: R.newSession("T") }); assert.ok(!r.error);
  const call = W.mainCall(); assert.ok(!JSON.stringify(call.messages).includes("injected-memory"), "arm A does not change what the model sees");
  await tick(); await sleep(60); assert.ok(!W.semantic.includes("Let's find a good recipe for dinner!"), "arm A: no search");
  await R.memArmAdmin({ arm: "default" }); W.calls.length = 0; await R.runTurn("t1", "main", "1", "Is Sam allergic to peanuts", null, { session: R.newSession("T4") }); await until(() => W.semantic.includes("Is Sam allergic to peanuts")); await sleep(80);
  assert.equal(W.semantic.filter((t) => t === "Is Sam allergic to peanuts").length, 1, "the default arm B makes one search"); assert.match(JSON.stringify(W.mainCall().messages), /injected-memory/, "the default memory is in the turn");
  assert.ok(!("shadow" in R.memArmState()), "the arm state has no shadow setting");
  // a BYOK account never runs the arms
  const W2 = mk({ extraEnv: { BYOK: { fallback: null } } }); W2.R.memoryMode = () => "on"; assert.equal(W2.R.memUseStart("hi", { session: "s" }), null, "own AI key: memory costs their credits, so no extra calls");
  assert.equal(R.memUseStart("hi", { session: "s" }, { kind: "workflow" }), null, "only chat turns"); assert.equal(R.memUseStart("hi", { session: "s" }, { resumed: true }), null, "a resumed turn keeps its saved context");
  ok("D2. arm A makes no search, the default arm B makes one, and an own key account makes none");
}
// ================= E. the correction tool is gone =================
{
  const W = mk({}), R = W.R; R.memoryMode = () => "on";
  assert.ok(!R.availableTools(null).some((t) => t.function.name === "correct_memory"), "correct_memory is not offered");
  assert.match(await R.localToolInner("correct_memory", { reason: "yes yes", about: "x" }, { session: "s1", context: { version: 2 } }), /unknown tool correct_memory/);
  ok("E1. correct_memory is removed: a correction is an ordinary turn that the helper handles");
}
console.log("memory-use: all checks passed");