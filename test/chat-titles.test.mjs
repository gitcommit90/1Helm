import assert from "node:assert/strict";
import { world, HANG, tick } from "./deploy-harness.mjs";
import { CHAT_TITLE_PROMPT, cleanChatTitle, fallbackChatTitle, claimChatTitle, applyChatTitle } from "../src/chat-titles.js";
import { summarizeCard, skipLabeller, parseLabels } from "../src/tracker.js";
import { SEED } from "./helpers/seed-settings.mjs";

let checks = 0;
const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const valid = (title) => { assert.ok(cleanChatTitle(title)); assert.match(title, /^[\p{L}\p{M}\p{N} ]+$/u); };
const input = { kind: "chat", chatTitle: true, title: "Garden plans", msgs: [{ at: 1, text: "Please help plan a vegetable garden for spring" }], reply: "Try peas and carrots.", steps: [] };
const labelJSON = (title = "Spring vegetable garden") => JSON.stringify({ title: "Plan a spring vegetable garden", result: "Suggested peas and carrots", summary: "Discussed a garden.", why: {}, chat_title: title });
function fixture(engine = "classic") {
  const W = world({ engine, openrouter: true, env: { RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0 } }), original = W.env.AI.run;
  W.labels = []; W.label = async () => labelJSON();
  W.env.AI.run = async (model, body) => {
    if (String(body.messages[0]?.content).startsWith("You label one finished task")) {
      W.labels.push(body);
      return { response: await W.label(body), usage: { prompt_tokens: 500, completion_tokens: 50 } };
    }
    return original(model, body);
  };
  W.brain = () => "Try peas and carrots.";
  return W;
}

await test("exact requested prompt and Unicode/digits/plain-title validation", async () => {
  assert.equal(CHAT_TITLE_PROMPT, "Summarize the chat into a concise 2-4 word title\nAvoid emojis, quotes, or special formatting.");
  assert.equal(cleanChatTitle('**"Garden plans"** 🌱'), "Garden plans");
  assert.equal(cleanChatTitle("Café résumé 2026"), "Café résumé 2026");
  assert.equal(cleanChatTitle("東京 旅行"), "東京 旅行");
  for (const text of [null, {}, "", "🌱", "Garden", "One two three four five", "x".repeat(81) + " title"]) assert.equal(cleanChatTitle(text), null);
  for (const text of ["", "hi", "🌱", "Please help plan a vegetable garden for spring", "x".repeat(1000), "longword".repeat(3) + " " + "longword".repeat(3) + " " + "longword".repeat(3) + " " + "longword".repeat(3)]) valid(fallbackChatTitle(text));
});
await test("short first chat requests title, ordinary short labels remain free", async () => {
  assert.equal(skipLabeller(input), false);
  assert.equal(skipLabeller({ ...input, chatTitle: false }), true);
  assert.equal(skipLabeller({ ...input, kind: "helper" }), true);
});
await test("chat title belongs to the initial label JSON schema; malformed trailing title remains fallback", async () => {
  // Observed provider response to the previous ambiguous "separate string"
  // instruction: valid card JSON followed by a non-JSON chat_title line.
  const malformed = '{"title":"Advise balcony herbs in pots","result":"Gave pot advice","summary":"Discussed herbs.","why":{}}\n\nchat_title: "Balcony herb pot advice"';
  assert.equal(parseLabels(malformed).chat_title, undefined);
  const env = { MODEL: "fixture", AI: { run: async (_model, body) => {
    assert.match(body.messages[0].content, /Reply with JSON only: \{"title","chat_title","result","summary","why"\}/);
    assert.match(body.messages[0].content, /chat_title: a string property inside that same JSON object/);
    assert.ok(body.messages[0].content.endsWith(CHAT_TITLE_PROMPT));
    return { response: malformed };
  } } };
  const labels = await summarizeCard({ env, input });
  assert.equal(labels.chat_title, fallbackChatTitle(input.msgs[0].text));
});
for (const engine of ["classic", "pi"]) await test(`${engine}: completed short turn names actual chat, bills once, preserves distinct card label`, async () => {
  const W = fixture(engine), R = W.R, s = R.resolveSession("new", input.msgs[0].text).id;
  valid(R.session(s).title);
  const result = await R.runTurn("t1", "main", "1", input.msgs[0].text, null, { session: s });
  await W.settle(); assert.equal(result.error, null);
  assert.equal(R.session(s).title, "Spring vegetable garden"); assert.equal(R.session(s).title_revision, 1);
  assert.equal(R.session(s).title_manual, 0);
  assert.equal(W.cards()[0].title, "Plan a spring vegetable garden");
  assert.equal(W.labels.length, 1); assert.ok(W.labels[0].messages[0].content.includes(CHAT_TITLE_PROMPT));
  assert.match(W.labels[0].messages[1].content, /Try peas and carrots/);
  assert.equal(W.ledger.log.filter(([op, id]) => op === "reserve" && id.startsWith("sum:")).length, 1);
  assert.equal((await R.listSessions()).find((x) => x.id === s).title, "Spring vegetable garden");
  assert.equal((await R.sessionDetail(s)).session.title, "Spring vegetable garden");
  await R.runTurn("t1", "main", "1", "Thanks", null, { session: s }); await W.settle();
  assert.equal(W.labels.length, 1); assert.equal(R.session(s).title_revision, 1);
});
await test("manual rename while label in flight wins; title metadata does not change task order", async () => {
  const W = fixture(), R = W.R, s = (await R.createSession(null, input.msgs[0].text)).id;
  let release; W.label = () => new Promise((resolve) => { release = resolve; });
  const run = R.runTurn("t1", "main", "1", input.msgs[0].text, null, { session: s });
  await W.until(() => !!release);
  await R.updateSession(s, { title: "My garden notes" }); release(labelJSON()); await run; await W.settle();
  assert.equal(R.session(s).title, "My garden notes"); assert.equal(R.session(s).title_manual, 1); assert.equal(R.session(s).title_revision, 1);
  const s2 = R.resolveSession("new", "Garden layout").id, before = { ...R.session(s2) }, claim = claimChatTitle(R, s2);
  applyChatTitle(R, claim, "Spring vegetable garden"); const after = { ...R.session(s2) };
  delete before.title; delete before.title_revision; delete after.title; delete after.title_revision; assert.deepEqual(after, before);
  applyChatTitle(R, claim, "Stale delayed result"); assert.equal(R.session(s2).title, "Spring vegetable garden");
});
await test("pending claim survives reboot, cannot rename existing or explicit conversations", async () => {
  const W = fixture(), s = (await W.R.createSession(null, "Garden layout")).id;
  W.kill(); const R = W.boot(); assert.ok(claimChatTitle(R, s)); assert.equal(claimChatTitle(R, s), null);
  const named = (await R.createSession("My chosen name", "Garden layout")).id;
  for (const id of [named, R.newSession("Existing task"), R.defaultSession()]) assert.equal(claimChatTitle(R, id), null);
  const manual = R.resolveSession("new", "Garden layout").id; await R.updateSession(manual, { title: "Manual garden" }); assert.equal(claimChatTitle(R, manual), null);
  const texts = R.resolveSession("new", "Garden layout").id; R.put("texts_session", texts); assert.equal(claimChatTitle(R, texts), null);
  const removed = R.resolveSession("new", "Garden layout").id; await R.removeSession(removed); assert.equal(claimChatTitle(R, removed), null);
  W.kill(); const R2 = W.boot(); assert.equal(claimChatTitle(R2, s), null); valid(R2.session(s).title);
});
await test("provider failure, malformed/overlong output and denied budget preserve clean fallback", async () => {
  for (const label of [async () => { throw Error("fixture provider unavailable"); }, async () => "not JSON", async () => labelJSON("One two three four five"), async () => labelJSON("🌱")]) {
    const W = fixture(); W.label = label;
    const s = W.R.resolveSession("new", input.msgs[0].text).id, before = W.R.session(s).title;
    const result = await W.R.runTurn("t1", "main", "1", input.msgs[0].text, null, { session: s }); await W.settle();
    assert.equal(result.error, null); assert.equal(W.R.session(s).title, before); valid(before);
  }
  let calls = 0;
  const denied = await summarizeCard({ input, env: { AI: { run: async () => { calls++; } }, MODEL: "test" }, ledger: { reserve: async () => ({ ok: false }) } });
  assert.equal(calls, 0); assert.equal(denied.title_src, "auto");
});
await test("latest steer is supplied to first title request", async () => {
  const W = fixture(), R = W.R, s = R.resolveSession("new", "Plan a vegetable garden").id;
  let release; W.brain = () => new Promise((resolve) => { release = resolve; });
  const run = R.runTurn("t1", "main", "1", "Plan a vegetable garden", null, { session: s });
  await W.until(() => !!release); R.steerOrOpen(s, { type: "msg", text: "Actually focus on balcony herbs" });
  W.brain = () => "Try basil and parsley."; release("I will consider vegetables."); await run; await W.settle();
  assert.match(W.labels[0].messages[1].content, /Actually focus on balcony herbs/);
  assert.match(W.labels[0].messages[1].content, /Try basil and parsley/);
});
await test("title chore inherits BYOK fast model, zero platform billing and no platform fallback", async () => {
  const original = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ choices: [{ finish_reason: "stop", message: { content: labelJSON() } }] }); };
    const env = { BYOK: { base: "https://llm.example.com/v1", model: "own-main", fast: "own-fast", key: "test-only" }, ROUTER_MODE: "two", AI: { run: async () => assert.fail("no platform AI fallback") } };
    const ledger = { reserve: async () => assert.fail("BYOK title must not reserve platform credits") };
    const labels = await summarizeCard({ input, env, ledger });
    assert.equal(labels.chat_title, "Spring vegetable garden"); assert.equal(labels.billed, false); assert.equal(labels.charge_nano, 0);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://llm.example.com/v1/chat/completions"); assert.equal(calls[0].body.model, "own-fast");
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    const failure = await summarizeCard({ input, env, ledger }); valid(failure.chat_title); assert.equal(failure.title_src, "auto");
  } finally { globalThis.fetch = original; }
});
await test("title chore retains platform privacy policy and bounded timeout", async () => {
  const original = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ choices: [{ finish_reason: "stop", message: { content: labelJSON() } }], usage: { cost: 0.0001 } }); };
    const labels = await summarizeCard({ input, env: { OPENROUTER_API_KEY: "fixture", MODEL_SETTINGS: SEED, ROUTER_MODE: "two" } });
    assert.equal(labels.chat_title, "Spring vegetable garden"); assert.ok(calls[0].provider.zdr); assert.equal(calls[0].provider.data_collection, "deny");
    globalThis.fetch = (url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal.reason)));   // the provider never answers; the label call must give up at its own timeout
    const failure = await summarizeCard({ input, timeoutMs: 10, env: { OPENROUTER_API_KEY: "fixture", MODEL_SETTINGS: SEED } });
    assert.equal(failure.title_src, "auto"); valid(failure.chat_title);
  } finally { globalThis.fetch = original; }
});
await test("late completed labels update the chat and cannot overwrite a later manual name", async () => {
  const W = fixture(), R = W.R, s = R.resolveSession("new", "Plan a vegetable garden").id;
  let release; W.label = () => new Promise((resolve) => { release = resolve; });
  const result = await R.runTurn("t1", "main", "1", "Plan a vegetable garden", null, { session: s });
  assert.equal(result.error, null); await W.until(() => !!release); assert.equal(R.session(s).title_revision, 0);
  await R.updateSession(s, { title: "My saved garden" }); release(labelJSON()); await W.settle();
  assert.equal(R.session(s).title, "My saved garden"); assert.equal(R.session(s).title_revision, 1);
  assert.equal(W.cards()[0].title, "Plan a spring vegetable garden");
});
await test("restart before reply retains title eligibility and resumes the original turn", async () => {
  const W = fixture(), s = W.R.resolveSession("new", "Plan a vegetable garden").id;
  W.brain = () => HANG; W.R.runTurn("t1", "main", "1", "Plan a vegetable garden", null, { session: s }).catch(() => {});
  await W.until(() => W.calls.some((c) => c.who === "main")); W.kill(); const R = W.boot(); await tick(10);
  W.brain = () => "Try peas and carrots."; await R.alarm(); await W.settle(R); for (const run of R._resumeRuns || []) await run;
  assert.equal(W.turns().length, 1); assert.equal(R.session(s).title, "Spring vegetable garden"); assert.equal(W.labels.length, 1);
});
await test("send-later new/deleted chat uses generated title; saved delivery and explicit existing name survive replay", async () => {
  const W = fixture(), R = W.R;
  R.laterTimer = () => {};
  const send = async (session, cid) => {
    const added = await R.laterAdd("t1", "main", "1", { session, text: input.msgs[0].text, due: Date.now() + 3600000, cid });
    assert.ok(added.item, added.error); return added.item;
  };
  const first = await send("new", "title-later-new"), delivered = await R.laterSend(first.id); await W.settle();
  assert.equal(R.session(delivered.session.id).title, "Spring vegetable garden");
  assert.equal(W.labels.length, 1); assert.equal(W.turns().length, 1);
  // Crash after delivery before the schedule row was finalized: the saved
  // session and stable input cid reuse the same conversation and generation.
  R.sql.exec("UPDATE later SET status='pending' WHERE id=?", first.id);
  const replay = await R.laterSend(first.id); await W.settle();
  assert.equal(replay.mode, "dup"); assert.equal(replay.session.id, delivered.session.id);
  assert.equal(W.turns().length, 1); assert.equal(W.labels.length, 1);
  const old = R.newSession("An explicit old name"), missing = await send(old, "title-later-deleted"); await R.removeSession(old);
  const moved = await R.laterSend(missing.id); await W.settle(); assert.equal(moved.moved, true);
  assert.equal(R.session(moved.session.id).title, "Spring vegetable garden"); assert.equal(W.labels.length, 2);
  const named = R.newSession("Chosen scheduled chat"), keep = await send(named, "title-later-existing");
  await R.updateSession(named, { title: "My exact chosen name" }); await R.laterSend(keep.id); await W.settle();
  assert.equal(R.session(named).title, "My exact chosen name"); assert.equal(W.labels.length, 2);
});
console.log(`PASS chat titles: ${checks} groups`);
// The deliberate killed-model fixture leaves the old request's timeout alive.
process.exit(0);
