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
  for (const w of [/multi-step/, /one item "doing"/, /WHOLE list/, /Don't use it for quick one-step/, /person ticked/, /Mark each item "done" as soon as you finish it/, /before your final reply make sure every finished item is marked "done"/, /person_asked/]) assert.match(f.description, w);
  assert.ok(!/ready to tick|never mark items done|Only the person ticks/.test(f.description), "no only-the-person-ticks rule is left");
  assert.ok(!/tell them it's ready/.test(f.description) , "the helper is not told to announce ticking");
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
  // The helper's "done" on item 1 while moving on to item 2: item 1 was the active one, so the app marks it done.
  assert.deepEqual(again.items.map((x) => [x.id, x.status, !!x.ready]), [["2", "doing", false], ["1", "done", false], ["3", "todo", false]]); assert.equal(again.next, 4);
  const moved = mergeTodos({ items: [{ id: "1", text: "Find flights", status: "doing" }, { id: "2", text: "Book hotel", status: "doing" }] }, prev);
  assert.deepEqual(moved.items.map((x) => [x.id, x.status]), [["1", "done"], ["2", "doing"]], "move-on rule still checks off the previous doing item");
  assert.ok(moved.notes.some((n) => /marked done automatically/.test(n)), moved.notes.join(" | "));
  const held = mergeTodos({ items: [{ id: "1", text: "Find flights", status: "done" }] }, prev);
  assert.deepEqual(held.items.map((x) => [x.status, x.by, !!x.ready]), [["done", "helper", false]], "a helper done with no person_asked is stored as done");
  assert.ok(!held.notes.some((n) => /person ticks|ready/i.test(n)), held.notes.join(" | "));
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
    assert.deepEqual(td[1].items.map((x) => `${x.id}:${x.status}${x.ready ? ":ready" : ""}`), ["1:done", "2:doing", "3:todo", "5:todo"], "the whole list replaces the old one (item 4 removed); item 1 was active and the helper moved on, so it is done");
    assert.ok(!evs.some((e) => e.t === "status" && /to-do/.test(e.line)), "no status line for the list");
    // The model saw the stored truth as the tool result.
    const res1 = toolOut(R.calls[1]); assert.match(res1, /^Saved\. To-do list \(0 of 5 done\)/); assert.match(res1, /\(id 1\) \[doing\] Find flights/);
    assert.match(toolOut(R.calls[2]), /1 of 4 done/); assert.match(toolOut(R.calls[2]), /\(id 1\) \[done\] Find flights/);
    const d = await R.sessionDetail(session);
    assert.deepEqual(d.todos.map((x) => x.text), ["Find flights", "Compare prices", "Book the cheapest", "Send you the summary"]);
    assert.ok(d.turns.every((t) => !t.steps.some((s) => s.tool === "update_todos")), "update_todos is not a step in the chat");
    // Next message: the list is in the per-turn context, not in the system prompt.
    R.script = [{ reply: "Flights are found and I am comparing prices." }];
    await turn(R, "how's it going?", session);
    const msgs = R.calls.at(-1), u = lastUser(msgs).content;
    assert.equal(msgs[0].content, "SYSTEM");
    assert.match(u, /^how's it going\?/); assert.match(u, /your to-do list for this task, which the person sees in the app \(1 of 4 done\)/); assert.match(u, /\(id 2\) \[doing\] Compare prices/);
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

// Moving on: a new "doing" item checks off the previously active one.
{
  const st = (items) => items.map((x) => x.status).join(",");
  let m = mergeTodos({ items: [{ text: "a", status: "doing" }, { text: "b", status: "todo" }, { text: "c", status: "todo" }] });
  let prev = { items: m.items, seen: 1, next: m.next, rev: 1 };
  m = mergeTodos({ items: m.items.map((x, i) => ({ id: x.id, text: x.text, status: i === 1 ? "doing" : "todo" })) }, prev, 2);
  assert.strictEqual(st(m.items), "done,doing,todo"); assert.ok(m.notes.some((n) => /marked done automatically/.test(n)));
  // Items never active stay as they are when the active one jumps ahead.
  prev = { items: m.items, seen: 2, next: m.next, rev: 2 };
  m = mergeTodos({ items: m.items.map((x, i) => ({ id: x.id, text: x.text, status: i === 2 ? "doing" : x.status === "done" ? "done" : "todo" })) }, prev, 3);
  assert.strictEqual(st(m.items), "done,done,doing");
  // Same item stays active: nothing changes. Done items are not reopened.
  prev = { items: m.items, seen: 3, next: m.next, rev: 3 };
  m = mergeTodos({ items: m.items.map((x) => ({ id: x.id, text: x.text, status: x.status })) }, prev, 4);
  assert.strictEqual(st(m.items), "done,done,doing");
  // The person's unticked item (unseen by the helper) keeps their choice even if it was the active one.
  const base = mergeTodos({ items: [{ text: "a", status: "doing" }, { text: "b", status: "todo" }] });
  const pa = { items: base.items.map((x, i) => i === 0 ? { ...x, status: "todo", by: "person", at: 5 } : x), seen: 1, next: base.next, rev: 5 };
  m = mergeTodos({ items: [{ id: base.items[0].id, text: "a", status: "doing" }, { id: base.items[1].id, text: "b", status: "doing" }] }, pa, 6);
  assert.strictEqual(st(m.items).split(",")[0], "todo");
  // Helper starts B but leaves A as doing (real dev run): A is done, B is doing.
  const c1 = mergeTodos({ items: [{ text: "A", status: "doing" }, { text: "B", status: "todo" }, { text: "C", status: "todo" }] });
  const p1 = { items: c1.items, seen: 1, next: c1.next, rev: 1 };
  const c2 = mergeTodos({ items: c1.items.map((x, i) => ({ id: x.id, text: x.text, status: i < 2 ? "doing" : "todo" })) }, p1, 2);
  assert.strictEqual(st(c2.items), "done,doing,todo"); assert.strictEqual(c2.items[0].by, "helper");
  assert.ok(c2.notes.some((n) => /"A" was the active item and you moved on to "B", so it was marked done automatically/.test(n)), c2.notes.join(" | "));
  assert.ok(!c2.notes.some((n) => /Only one item/.test(n)));
  // Several newly doing items: only the first stays doing, the rest go back to todo.
  const c3 = mergeTodos({ items: c1.items.map((x) => ({ id: x.id, text: x.text, status: "doing" })) }, p1, 2);
  assert.strictEqual(st(c3.items), "done,doing,todo"); assert.ok(c3.notes.some((n) => /Only one item/.test(n)));
  console.log("todos autocheck merge ok");
}

// Done stays done: replay of the dev run where the model re-sent a stale list on every call (session 60b18260 r2).
{
  const st = (items) => items.map((x) => x.status).join(",");
  const send = (prev, sts, now) => mergeTodos({ items: prev.items.map((x, i) => ({ id: x.id, text: x.text, status: sts[i] })) }, prev, now);
  const c1 = mergeTodos({ items: [{ text: "A", status: "doing" }, { text: "B", status: "todo" }, { text: "C", status: "todo" }] });
  assert.strictEqual(st(c1.items), "doing,todo,todo");
  const c2 = send({ items: c1.items, seen: 1, next: c1.next, rev: 1 }, ["doing", "doing", "todo"], 2);
  assert.strictEqual(st(c2.items), "done,doing,todo"); assert.ok(c2.notes.some((n) => /"A" was the active item/.test(n)));
  const c3 = send({ items: c2.items, seen: 2, next: c2.next, rev: 2 }, ["doing", "doing", "doing"], 3);
  assert.strictEqual(st(c3.items), "done,done,doing");
  assert.deepEqual(c3.notes.filter((n) => /kept it done/.test(n)), ['"A" is already done; kept it done.']);
  assert.ok(c3.notes.some((n) => /"B" was the active item and you moved on to "C"/.test(n)), c3.notes.join(" | "));
  assert.ok(!c3.notes.some((n) => /Only one item/.test(n)));
  const c4 = send({ items: c3.items, seen: 3, next: c3.next, rev: 3 }, ["doing", "todo", "todo"], 4);
  assert.strictEqual(st(c4.items), "done,done,todo", "C goes to todo as sent: nothing new became doing, so nothing is auto-done");
  assert.deepEqual(c4.notes, ['"A" is already done; kept it done.', '"B" is already done; kept it done.']);
  // A person's untick (seen by the helper) can still be changed by the helper; the person's own done is not covered by this rule.
  console.log("todos keep-done replay ok");
}
