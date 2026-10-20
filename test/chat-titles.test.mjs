import assert from "node:assert/strict";
import { world, HANG, tick } from "./deploy-harness.mjs";
import { CHAT_TITLE_INSTRUCTION, CHAT_TITLE_TAIL, cleanChatTitle, fallbackChatTitle, claimChatTitle, applyChatTitle, chatTitleRequest, startChatTitle, nameChat, newAutoChat } from "../src/chat-titles.js";
import { labelRequest, skipLabeller, parseLabels } from "../src/tracker.js";
import { jobDef } from "../src/ee/model-jobs.js";
import { SEED } from "./helpers/seed-settings.mjs";

let checks = 0;
const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const MESSAGE = "Please help plan a vegetable garden for spring";
const labelJSON = JSON.stringify({ title: "Plan a spring vegetable garden", result: "Suggested peas and carrots", summary: "Discussed a garden.", why: {} });
const isTitleCall = (body) => String(body.messages?.at(-1)?.content).endsWith(`${CHAT_TITLE_INSTRUCTION}\n${CHAT_TITLE_TAIL}`);
function fixture(engine = "classic") {
  const W = world({ engine, openrouter: true, env: { RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0 } }), original = W.env.AI.run;
  W.labels = []; W.titleCalls = []; W.title = async () => "Spring vegetable garden plan";
  W.env.AI.run = async (model, body) => {
    if (isTitleCall(body)) { W.titleCalls.push(body); return { response: await W.title(body), usage: { prompt_tokens: 40, completion_tokens: 8 } }; }
    if (String(body.messages[0]?.content).startsWith("You label one finished task")) { W.labels.push(body); return { response: labelJSON, usage: { prompt_tokens: 500, completion_tokens: 50 } }; }
    return original(model, body);
  };
  W.brain = () => "Try peas and carrots.";
  W.latest = () => W.R.sql.exec("SELECT id FROM sessions ORDER BY created DESC, rowid DESC LIMIT 1").toArray()[0].id;
  return W;
}

await test("the model is sent the message and the instruction, and the answer is cleaned to 3 to 7 words", async () => {
  assert.equal(CHAT_TITLE_INSTRUCTION, "Title this in 3-7 words");
  assert.deepEqual(chatTitleRequest("Hello there friend").messages, [{ role: "user", content: "Hello there friend\n\nTitle this in 3-7 words\nReply with the title only." }]);
  assert.equal(chatTitleRequest("x".repeat(9000)).messages[0].content.length, 4000 + `\n\n${CHAT_TITLE_INSTRUCTION}\n${CHAT_TITLE_TAIL}`.length);
  assert.equal(chatTitleRequest("a b c", 50).max_tokens, 50);
  assert.equal(cleanChatTitle('**"Garden plans for spring"** 🌱'), "Garden plans for spring");
  assert.equal(cleanChatTitle("Title: Spring vegetable garden plan."), "Spring vegetable garden plan");
  assert.equal(cleanChatTitle("“Balcony herbs in small pots”\nI chose this because it names the topic."), "Balcony herbs in small pots");
  assert.equal(cleanChatTitle("Don't overwater your basil"), "Don't overwater your basil");
  assert.equal(cleanChatTitle("Café résumé tips 2026"), "Café résumé tips 2026");
  assert.equal(cleanChatTitle("<think>hmm</think>One two three"), "One two three");
  for (const text of [null, {}, "", "🌱", "Garden", "Garden plans", "One two three four five six seven eight", "x ".repeat(3) + "y".repeat(80)]) assert.equal(cleanChatTitle(text), null);
  assert.equal(cleanChatTitle("a b c d e f g"), "a b c d e f g");
});
await test("chat_title is its own Models page job, and the label job is renamed but keeps its id", async () => {
  assert.deepEqual([jobDef("chat_title").kind, jobDef("chat_title").group, jobDef("chat_title").label], ["chore", "background", "Chat titles"]);
  assert.equal(jobDef("label").label, "Task summaries");
  assert.equal(SEED.jobs.chat_title.model, SEED.jobs.label.model); assert.equal(SEED.jobs.chat_title.effort, SEED.jobs.label.effort);
  assert.deepEqual(SEED.jobs.chat_title.fallbacks, SEED.jobs.label.fallbacks); assert.equal(SEED.jobs.chat_title.timeout_ms, SEED.jobs.label.timeout_ms);
});
await test("end-of-task labels no longer name chats, and tiny chat tasks are labelled", async () => {
  const input = { kind: "chat", title: "Garden plans", msgs: [{ at: 1, text: MESSAGE }], reply: "Try peas.", steps: [], handoffs: [] };
  assert.equal(skipLabeller(input), false); assert.equal(skipLabeller({ ...input, kind: "helper" }), true); assert.equal(skipLabeller({ ...input, kind: "workflow" }), true);
  assert.ok(!/chat_title/.test(JSON.stringify(labelRequest({ ...input, chatTitle: true }))));
  assert.equal(parseLabels(JSON.stringify({ title: "A title", result: "A result", chat_title: "Garden plans here" })).chat_title, undefined);
});
for (const engine of ["classic", "pi"]) await test(`${engine}: the name is replaced while the turn is still running, billed once, and the card keeps its own labels`, async () => {
  const W = fixture(engine), R = W.R; let release; W.brain = () => new Promise((resolve) => { release = resolve; W.brain = () => "Try peas and carrots."; });
  const run = R.chat("t1", "main", "1", MESSAGE, { session: "new" });
  await W.until(() => !!release);   // the helper is waiting for its model, so the turn has not finished
  const s = W.latest(); await W.until(() => R.session(s).title_revision === 1);
  assert.equal(R.session(s).title, "Spring vegetable garden plan"); assert.equal(R.session(s).title_manual, 0);
  assert.equal(W.titleCalls.length, 1); assert.equal(W.titleCalls[0].messages.at(-1).content, `${MESSAGE}\n\n${CHAT_TITLE_INSTRUCTION}\n${CHAT_TITLE_TAIL}`);
  release("Try peas and carrots."); const result = await run; await W.settle(); assert.ok(!result.error);
  assert.equal(R.session(s).title, "Spring vegetable garden plan"); assert.equal(R.session(s).title_revision, 1);
  assert.equal(W.cards()[0].title, "Plan a spring vegetable garden");
  assert.equal(W.labels.length, 1); assert.ok(!/chat_title/.test(JSON.stringify(W.labels[0])));
  assert.equal(W.ledger.log.filter(([op, id]) => op === "reserve" && id.startsWith("title:")).length, 1);
  assert.equal(W.ledger.log.filter(([op, id]) => op === "settle" && id.startsWith("title:")).length, 1);
  assert.equal(W.ledger.log.filter(([op, id]) => op === "reserve" && id.startsWith("sum:")).length, 1);
  assert.equal((await R.listSessions()).find((x) => x.id === s).title, "Spring vegetable garden plan");
  await R.chat("t1", "main", "1", "Thanks", { session: s }); await W.settle();
  assert.equal(W.titleCalls.length, 1); assert.equal(R.session(s).title_revision, 1);
});
await test("a rename before the instant title returns wins", async () => {
  const W = fixture(), R = W.R; let release; W.title = () => new Promise((resolve) => { release = resolve; });
  const run = R.chat("t1", "main", "1", MESSAGE, { session: "new" }); await W.until(() => !!release);
  const s = W.latest(); await R.updateSession(s, { title: "My garden notes" }); release("Spring vegetable garden plan"); await run; await W.settle();
  assert.equal(R.session(s).title, "My garden notes"); assert.equal(R.session(s).title_manual, 1); assert.equal(R.session(s).title_revision, 1);
});
await test("a rename after the instant title sticks", async () => {
  const W = fixture(), R = W.R; await R.chat("t1", "main", "1", MESSAGE, { session: "new" }); await W.settle();
  const s = W.latest(); assert.equal(R.session(s).title, "Spring vegetable garden plan");
  await R.updateSession(s, { title: "My garden notes" }); await R.chat("t1", "main", "1", "More please", { session: s }); await W.settle();
  assert.equal(R.session(s).title, "My garden notes"); assert.equal(R.session(s).title_manual, 1); assert.equal(W.titleCalls.length, 1);
});
await test("the instant title never touches texting or default threads, named chats, or a file-only first message", async () => {
  const W = fixture(), R = W.R, before = () => W.titleCalls.length;
  const named = (await R.createSession("My chosen name", MESSAGE)).id, existing = R.newSession("Existing task"), main = R.defaultSession();
  const texts = R.resolveSession("new", MESSAGE).id; R.put("texts_session", texts);
  const fileOnly = R.resolveSession("new", "report.pdf", "").id;
  assert.equal(R.getRaw(`chat_title_pending:${fileOnly}`), undefined);
  for (const id of [named, existing, main, texts, fileOnly]) assert.equal(startChatTitle(R, id), null);
  assert.equal(before(), 0); assert.equal(R.session(fileOnly).title, "Report pdf");
  const manual = R.resolveSession("new", MESSAGE).id; await R.updateSession(manual, { title: "Manual garden" }); assert.equal(startChatTitle(R, manual), null);
  const removed = R.resolveSession("new", MESSAGE).id; await R.removeSession(removed); assert.equal(startChatTitle(R, removed), null);
  await W.settle(); assert.equal(before(), 0);
  assert.equal(R.session(named).title, "My chosen name"); assert.equal(R.session(existing).title, "Existing task"); assert.equal(R.session(texts).title_revision, 0);
});
await test("the claim is taken before the call, so a restart or a second message never pays twice", async () => {
  const W = fixture(), R = W.R; let release; W.title = () => new Promise((resolve) => { release = resolve; });
  const s = (await R.createSession(null, MESSAGE)).id; assert.ok(R.getRaw(`chat_title_pending:${s}`));
  const run = startChatTitle(R, s); assert.ok(run); assert.equal(R.getRaw(`chat_title_pending:${s}`), undefined);
  assert.equal(startChatTitle(R, s), null); await W.until(() => !!release);
  W.kill(); const R2 = W.boot(); assert.equal(startChatTitle(R2, s), null); assert.equal(W.titleCalls.length, 1);
  assert.match(R2.session(s).title, /^[\p{L}\p{N} ]+$/u);   // the placeholder stays; the old object's late answer cannot write
});
await test("provider failure, a malformed answer and a denied budget leave the placeholder", async () => {
  for (const title of [async () => { throw Error("fixture provider unavailable"); }, async () => "Hmm", async () => "One two three four five six seven eight nine", async () => "🌱"]) {
    const W = fixture(); W.title = title;
    const s = (await W.R.createSession(null, MESSAGE)).id, before = W.R.session(s).title;
    await startChatTitle(W.R, s); await W.settle();
    assert.equal(W.R.session(s).title, before); assert.equal(W.R.session(s).title_revision, 0);
  }
  let calls = 0; const claim = { id: "s", title: "x", revision: 0, text: MESSAGE };
  assert.equal(await nameChat({ claim, env: { OPENROUTER_API_KEY: "k", MODEL_SETTINGS: SEED, AI: { run: async () => { calls++; } } }, ledger: { reserve: async () => ({ ok: false }) } }), null); assert.equal(calls, 0);
});
await test("own AI key: no platform billing, and a failed call leaves no answer", async () => {
  const original = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Spring vegetable garden plan" } }] }); };
    const env = { BYOK: { base: "https://llm.example.com/v1", model: "own-main", fast: "own-fast", key: "test-only" }, ROUTER_MODE: "two", AI: { run: async () => assert.fail("no platform AI fallback") } };
    const ledger = { reserve: async () => assert.fail("an own-key title must not reserve platform credits") };
    assert.equal(await nameChat({ claim: { id: "s", title: "x", revision: 0, text: MESSAGE }, env, ledger }), "Spring vegetable garden plan");
    assert.equal(calls.length, 1); assert.equal(calls[0].body.model, "own-fast");
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    assert.equal(await nameChat({ claim: { id: "s", title: "x", revision: 0, text: MESSAGE }, env, ledger }), null);
  } finally { globalThis.fetch = original; }
});
await test("the call keeps the privacy policy and is reserved and settled under its own id", async () => {
  const original = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Spring vegetable garden plan" } }], usage: { cost: 0.0001 } }); };
    const led = []; const ledger = { reserve: async (id, n) => { led.push(["reserve", id, n]); return { ok: true }; }, settle: async (id, n) => { led.push(["settle", id, n]); return {}; } };
    const answer = await nameChat({ claim: { id: "s", title: "x", revision: 0, text: MESSAGE }, ledger, meta: { tenant: "t1" }, env: { OPENROUTER_API_KEY: "fixture", MODEL_SETTINGS: SEED, ROUTER_MODE: "two" } });
    assert.equal(answer, "Spring vegetable garden plan"); assert.ok(calls[0].provider.zdr); assert.equal(calls[0].provider.data_collection, "deny");
    assert.equal(calls[0].messages.at(-1).content, `${MESSAGE}\n\n${CHAT_TITLE_INSTRUCTION}\n${CHAT_TITLE_TAIL}`);
    assert.match(led[0][1], /^title:/); assert.deepEqual(led[1], ["settle", led[0][1], Math.ceil(Math.ceil(0.0001 * 1e9) * 1.15)]);
  } finally { globalThis.fetch = original; }
});
await test("send-later: a new chat is named, a replayed send pays once, an existing or renamed chat keeps its name", async () => {
  const W = fixture(), R = W.R; R.laterTimer = () => {};
  const send = async (session, cid) => { const added = await R.laterAdd("t1", "main", "1", { session, text: MESSAGE, due: Date.now() + 3600000, cid }); assert.ok(added.item, added.error); return added.item; };
  const first = await send("new", "title-later-new"), delivered = await R.laterSend(first.id); await W.settle();
  assert.equal(R.session(delivered.session.id).title, "Spring vegetable garden plan"); assert.equal(W.titleCalls.length, 1); assert.equal(W.turns().length, 1);
  R.sql.exec("UPDATE later SET status='pending' WHERE id=?", first.id);
  const replay = await R.laterSend(first.id); await W.settle(); assert.equal(replay.mode, "dup"); assert.equal(W.titleCalls.length, 1); assert.equal(W.turns().length, 1);
  const old = R.newSession("An explicit old name"), missing = await send(old, "title-later-deleted"); await R.removeSession(old);
  const moved = await R.laterSend(missing.id); await W.settle(); assert.equal(moved.moved, true);
  assert.equal(R.session(moved.session.id).title, "Spring vegetable garden plan"); assert.equal(W.titleCalls.length, 2);
  const named = R.newSession("Chosen scheduled chat"), keep = await send(named, "title-later-existing");
  await R.updateSession(named, { title: "My exact chosen name" }); await R.laterSend(keep.id); await W.settle();
  assert.equal(R.session(named).title, "My exact chosen name"); assert.equal(W.titleCalls.length, 2);
});
console.log(`PASS chat titles: ${checks} groups`);
process.exit(0);
