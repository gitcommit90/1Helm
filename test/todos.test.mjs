// node --import ./test/stubs/register.mjs test/todos.test.mjs
// The helper's to-do list (update_todos) through the real Resident (node:sqlite as its SQLite) and the real turn loop, both
// engines (classic + pi), with the model scripted: each model call returns the next scripted step (tool calls or a reply).
// Checks: the tool replaces the list, keeps ids, caps items/characters and "one doing at a time"; the stream carries
// {t:"todos", items}; no status line or step for it; the session detail API returns it; a person's tick (POST) wins over the
// helper's stale copy in the next tool call and shows in the next message's context; per-task isolation; texting tasks too.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import { Resident } from "../src/resident.js";
import { mergeTodos, todoContextNote, TODO_TOOL, TODO_MAX_ITEMS, TODO_MAX_CHARS } from "../src/todos.js";

const D1 = { prepare: () => { const o = { bind: () => o, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return o; } };
const env = { DB: D1, GATEWAY_HOST: "owner.example.com", APP_HOST: "owner.example.com", MEMORY: "off", GENUI: "off", WORKMEM: "off" };
// Scripted calls bypass billing, not the real loop's account-policy lookup.
env.LEDGER = {idFromName: n => n, get: () => ({spendPreferences: async () => ({enabled:true})})};
function resident() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: () => {} }, env);
  R.systemPrompt = async () => "SYSTEM";
  R.script = []; R.calls = [];
  // Each model call: record what the model saw, run the step's side effect (e.g. the person ticks mid-turn), return its output.
  R.callModel = async (messages, _w, _onText, noTools) => {
    R.calls.push(structuredClone(messages));
    if (noTools) return { content: "- notes", calls: [], inTok: 10, cached: 0, outTok: 3, charge: 0, finish: "stop" };   // hand-off notes
    const step = R.script.shift() || { reply: "Done." };
    if (step.before) await step.before();
    const calls = (step.todos ? [step.todos] : []).map((items, i) => ({ id: `c${R.calls.length}-${i}`, type: "function", function: { name: "update_todos", arguments: JSON.stringify({ items }) } }));
    return { content: step.reply || "", calls, inTok: 10, cached: 0, outTok: 3, charge: 0, finish: calls.length ? "tool_calls" : "stop" };
  };
  return R;
}
async function turn(R, text, session = "new", opts = {}) {
  const rd = (await R.chatStream("t1", "main", "1", text, { session, ...opts })).getReader();
  let out = ""; for (;;) { const { done, value } = await rd.read(); if (done) break; out += new TextDecoder().decode(value); }
  const evs = out.trim().split("\n").map((l) => JSON.parse(l)); assert.ok(evs.some((e) => e.t === "done"), out);
  return { evs, session: evs.find((e) => e.t === "session").session.id };
}
const userOf = (msgs) => msgs.filter((m) => m.role === "user").find((m) => typeof m.content === "string" && !m.content.startsWith("(Context note"));
const lastUser = (msgs) => [...msgs].reverse().find((m) => m.role === "user");
const toolOut = (msgs) => [...msgs].reverse().find((m) => m.role === "tool")?.content ?? "";
async function scenario(name, fn) { await fn(); console.log("  ok", name); }

await scenario("tool shape: description carries when to use it; schema is the whole list", async () => {
  const f = TODO_TOOL.function; assert.equal(f.name, "update_todos");
  assert.deepEqual(f.parameters.required, ["items"]); assert.deepEqual(f.parameters.properties.items.items.properties.status.enum, ["todo", "doing", "done"]);
  for (const w of [/multi-step/, /one item "doing"/, /WHOLE list/, /Don't use it for quick one-step/, /person ticked/, /never mark items done yourself/, /ready for them to tick/, /person_asked/]) assert.match(f.description, w);
  assert.ok(!/"done" as soon as it's finished/.test(f.description), "the helper is no longer told to tick items");
});

await scenario("merge: replaces, keeps ids by id or text, caps items + characters, one doing", () => {
  const m = mergeTodos({ items: [...Array.from({ length: 35 }, (_, i) => ({ text: `Step ${i + 1}`, status: i < 2 ? "doing" : "todo" })), { text: "x".repeat(500), status: "todo" }] });
  assert.equal(m.items.length, TODO_MAX_ITEMS); assert.deepEqual(m.items.map((x) => x.id).slice(0, 3), ["1", "2", "3"]);
  assert.equal(m.items.filter((x) => x.status === "doing").length, 1); assert.equal(m.items[1].status, "todo");
  assert.ok(m.notes.some((n) => /at most 30/.test(n)) && m.notes.some((n) => /one item/.test(n)));
  const long = mergeTodos({ items: [{ text: "y".repeat(500), status: "in_progress" }, { text: "  ", status: "done" }, "plain string step"] });
  assert.equal(long.items.length, 2); assert.equal(long.items[0].text.length, TODO_MAX_CHARS); assert.equal(long.items[0].status, "doing"); assert.equal(long.items[1].text, "plain string step");
  const prev = { items: [{ id: "1", text: "Find flights", status: "doing", by: "helper", at: 1 }, { id: "2", text: "Book hotel", status: "todo", by: "helper", at: 1 }], seen: 5, next: 3 };
  const again = mergeTodos({ items: [{ text: "book HOTEL", status: "doing" }, { id: "1", text: "Find flights (direct)", status: "done" }, { id: "99", text: "Pack", status: "todo" }] }, prev);
  // Only the person ticks done: the helper's "done" keeps item 1 as it was ("doing"), marked ready to tick, and it doesn't
  // count against "one doing at a time".
  assert.deepEqual(again.items.map((x) => [x.id, x.status, !!x.ready]), [["2", "doing", false], ["1", "doing", true], ["3", "todo", false]]); assert.equal(again.next, 4);
  assert.ok(again.notes.some((n) => /Only the person ticks items done, so "Find flights \(direct\)" was left as it was/.test(n)), again.notes.join(" | "));
  const asked = mergeTodos({ items: [{ id: "1", text: "Find flights", status: "done" }] }, prev, 6, { allowDone: true });
  assert.deepEqual(asked.items.map((x) => [x.status, !!x.ready]), [["done", false]], "an explicit (verified) ask lets it through");
  assert.match(mergeTodos({ items: "nope" }).error, /must be a list/);
  assert.equal(todoContextNote([]), "");
});

for (const engine of ["classic", "pi"]) {
  await scenario(`${engine}: the tool writes the list, streams it, returns it; detail API has it; no step line`, async () => {
    const R = resident(); R.put("engine", engine);
    R.script = [
      { reply: "Let me plan.", todos: [{ text: "Find flights", status: "doing" }, { text: "Compare prices", status: "todo" }, { text: "Book the cheapest", status: "todo" }, { text: "Hotel near the venue", status: "todo" }, { text: "Send you the summary", status: "todo" }] },
      { todos: [{ id: "1", text: "Find flights", status: "done" }, { id: "2", text: "Compare prices", status: "doing" }, { id: "3", text: "Book the cheapest", status: "todo" }, { id: "5", text: "Send you the summary", status: "todo" }] },
      { reply: "Working on it: flights found." },
    ];
    const { evs, session } = await turn(R, "Plan my trip to Denver: flights, hotel, then send me a summary");
    assert.equal(R.sql.exec("SELECT engine FROM turns").one().engine, engine);
    const td = evs.filter((e) => e.t === "todos");
    assert.equal(td.length, 2, "one stream event per update");
    assert.deepEqual(td[0].items.map((x) => x.status), ["doing", "todo", "todo", "todo", "todo"]); assert.deepEqual(Object.keys(td[0].items[0]).sort(), ["id", "status", "text"]);
    assert.deepEqual(td[1].items.map((x) => `${x.id}:${x.status}${x.ready ? ":ready" : ""}`), ["1:doing:ready", "2:doing", "3:todo", "5:todo"], "the whole list replaces the old one (item 4 removed); the helper's 'done' stays doing, ready to tick");
    assert.ok(!evs.some((e) => e.t === "status" && /to-do/.test(e.line)), "no status line for the list");
    // The model saw the stored truth as the tool result.
    const res1 = toolOut(R.calls[1]); assert.match(res1, /^Saved\. To-do list \(0 of 5 done\)/); assert.match(res1, /\(id 1\) \[doing\] Find flights/);
    assert.match(toolOut(R.calls[2]), /0 of 4 done, 1 ready for the person to tick/); assert.match(toolOut(R.calls[2]), /\(id 1\) \[doing, ready for the person to tick\] Find flights/);
    assert.match(toolOut(R.calls[2]), /Only the person ticks items done/);
    const d = await R.sessionDetail(session);
    assert.deepEqual(d.todos.map((x) => x.text), ["Find flights", "Compare prices", "Book the cheapest", "Send you the summary"]);
    assert.ok(d.turns.every((t) => !t.steps.some((s) => s.tool === "update_todos")), "update_todos is not a step in the chat");
    // Next message: the list is in the per-turn context, not in the system prompt.
    R.script = [{ reply: "On it." }];
    await turn(R, "how's it going?", session);
    const msgs = R.calls.at(-1), u = lastUser(msgs).content;
    assert.equal(msgs[0].content, "SYSTEM");
    assert.match(u, /^how's it going\?/); assert.match(u, /your to-do list for this task, which the person sees in the app; only they tick items done \(0 of 4 done\)/); assert.match(u, /\(id 2\) \[doing\] Compare prices/);
    // Earlier turns in the history stay exactly as they were (stable prefix): no list in them.
    assert.ok(msgs.slice(1, -1).every((m) => !/to-do list for this task/.test(String(m.content))), "history carries no list");
  });
}

await scenario("a person's tick: kept over the helper's stale copy, visible in the next tool result and the next message", async () => {
  const R = resident();
  R.script = [{ todos: [{ text: "Call the bank", status: "doing" }, { text: "Cancel the old card", status: "todo" }, { text: "Order a new card", status: "todo" }] }, { reply: "Started." }];
  const { session } = await turn(R, "Sort out my lost card");
  // Between turns: the person ticks item 1 in the app. Then a new turn; mid-turn they also tick item 2.
  assert.deepEqual((await R.tickTodo(session, "1", "done")).todos.map((x) => x.status), ["done", "todo", "todo"]);
  let s2 = [];
  R.script = [
    { before: async () => { await R.tickTodo(session, "2", "done"); }, todos: [{ id: "1", text: "Call the bank", status: "done" }, { id: "2", text: "Cancel the old card", status: "doing" }, { id: "3", text: "Order a new card", status: "todo" }] },
    { reply: "Ok." },
  ];
  const { evs } = await turn(R, "I called them already, keep going", session);
  const ctxMsg = lastUser(R.calls.at(-2)).content;
  assert.match(ctxMsg, /\(id 1\) \[done\] Call the bank/, "the tick made before the turn is in the message context");
  const out = toolOut(R.calls.at(-1));
  assert.match(out, /\(id 2\) \[done\] Cancel the old card/, "the helper's stale 'doing' doesn't undo the person's tick");
  assert.match(out, /The person marked "Cancel the old card" done themselves; kept their change\./);
  s2 = evs.filter((e) => e.t === "todos");
  assert.deepEqual(s2.map((e) => e.by), ["person", "helper"], "the person's tick streams to whoever is watching the running turn");
  // Once the helper has seen it, it may change it again (e.g. unticks something that turned out not done).
  R.script = [{ todos: [{ id: "1", text: "Call the bank", status: "done" }, { id: "2", text: "Cancel the old card", status: "todo" }, { id: "3", text: "Order a new card", status: "doing" }] }, { reply: "Ok." }];
  await turn(R, "actually the cancel didn't go through", session);
  assert.deepEqual(R.todoItems(session).map((x) => x.status), ["done", "todo", "doing"]);
  // Untick from the app.
  assert.deepEqual((await R.tickTodo(session, "1", "todo")).todos.map((x) => x.status), ["todo", "todo", "doing"]);
  assert.match((await R.tickTodo(session, "9", "done")).error, /No such item/); assert.match((await R.tickTodo(session, "1", "doing")).error, /done or todo/);
});

await scenario("per-task isolation: another task has no list, no context note, can't be ticked", async () => {
  const R = resident();
  R.script = [{ todos: [{ text: "A", status: "doing" }, { text: "B", status: "todo" }] }, { reply: "ok" }];
  const a = (await turn(R, "task A")).session;
  R.script = [{ reply: "hi" }];
  const b = (await turn(R, "task B")).session;
  assert.notEqual(a, b);
  assert.ok(!/to-do list/.test(lastUser(R.calls.at(-1)).content), "task B's message has no list");
  assert.deepEqual((await R.sessionDetail(b)).todos, []); assert.equal((await R.sessionDetail(a)).todos.length, 2);
  assert.match((await R.tickTodo(b, "1", "done")).error, /No such item/);
  R.script = [{ todos: [{ text: "Only B", status: "doing" }] }, { reply: "ok" }];
  await turn(R, "plan B", b);
  assert.deepEqual(R.todoItems(a).map((x) => x.text), ["A", "B"]); assert.deepEqual(R.todoItems(b).map((x) => x.text), ["Only B"]);
  // An empty list clears it (the app hides the button).
  R.script = [{ todos: [] }, { reply: "cleared" }];
  await turn(R, "never mind", b);
  assert.deepEqual(R.todoItems(b), []); assert.match(toolOut(R.calls.at(-1)), /cleared/);
  // A run with no task gets a clear error, never someone else's list.
  assert.match(await R.localTool("update_todos", { items: [{ text: "x", status: "todo" }] }, { session: null }), /belongs to a task/);
  await R.reset(a); assert.deepEqual(R.todoItems(a), []);
});

await scenario("texting tasks: the list is kept on the 'Text with ...' task and comes back on the next text", async () => {
  const R = resident(); R.deliverTextReply = async () => {};
  R.script = [{ todos: [{ text: "Check the weather", status: "doing" }, { text: "Pick a trail", status: "todo" }] }, { reply: "Checking." }];
  const r = await R.textTurn("t1", "main", "1", "plan a hike saturday"); await R._lastTextRun;
  const sid = r.session; assert.equal(R.session(sid).title, "Text with Skipper");
  assert.deepEqual(R.todoItems(sid).map((x) => x.status), ["doing", "todo"]);
  await R.tickTodo(sid, "1", "done");
  R.script = [{ reply: "Trail next." }];
  await R.textTurn("t1", "main", "1", "and?"); await R._lastTextRun;
  const u = lastUser(R.calls.at(-1)).content;
  assert.match(u, /^and\?/); assert.match(u, /\(id 1\) \[done\] Check the weather/); assert.match(u, /came by text/);
});
console.log("todos: all ok");
