import assert from "node:assert/strict";
import { world } from "./deploy-harness.mjs";
import { orderTasks, SECTION_COLORS, MAX_SECTIONS } from "../src/sections.js";

let checks = 0;
const test = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const W = world(), R = W.R;
const secs = async () => (await R.sectionsGet());
const act = (b) => R.sectionsDo(b);
const view = (id) => R.sessionView(R.session(id));
const mk = (title, updated, done = 0) => { const id = R.newSession(title); R.sql.exec("UPDATE sessions SET updated=?, done=?, done_at=? WHERE id=?", updated, done, done ? updated : null, id); return id; };
const ids = (rows) => rows.map((x) => x.id);

await test("custom sections start off, with no sections, and every task has no section", async () => {
  const a = mk("First", 100);
  const st = await secs();
  assert.equal(st.on, false); assert.deepEqual(st.sections, []); assert.deepEqual(st.colors, SECTION_COLORS);
  assert.equal(view(a).section, null);
  assert.ok((await R.listSessions()).every((x) => x.section === null));
});
await test("creating a section needs the mode on; enable and disable switch it and are repeatable", async () => {
  const r = await act({ action: "create", title: "Work" }); assert.equal(r.status, 400);
  assert.equal((await act({ action: "enable" })).on, true); assert.equal((await act({ action: "enable" })).on, true);
  assert.equal((await act({ action: "disable" })).on, false);
  assert.equal((await act({ action: "enable" })).on, true);
  assert.equal((await act({ action: "nope" })).status, 400);
  assert.equal((await act(null)).status, 400);
});
await test("a new task lands in Uncategorized (no section), whichever code creates it", async () => {
  const id = R.newSession("Brand new");
  assert.equal(view(id).section, null);
  const created = await R.createSession("Made through the route"); assert.equal(created.section, null);
  const sid = (await act({ action: "create", title: "Home" })).sections[0].id;
  const id2 = R.newSession("After a section exists"); assert.equal(view(id2).section, null);
  await act({ action: "delete", id: sid });
});
let work, home, ideas;
await test("create: names are trimmed, validated and unique to Uncategorized; colors cycle through the palette; up to the maximum", async () => {
  let st = await act({ action: "create", title: "  Work  ", color: "blue" }); work = st.sections[0];
  assert.deepEqual([work.title, work.color], ["Work", "blue"]);
  st = await act({ action: "create", title: "Home" }); home = st.sections[1]; assert.ok(SECTION_COLORS.includes(home.color));
  st = await act({ action: "create", title: "Ideas", color: "pink" }); ideas = st.sections[2];
  assert.deepEqual(st.sections.map((x) => x.title), ["Work", "Home", "Ideas"]);
  for (const bad of ["", "   ", "x".repeat(61), "uncategorized", "UNCATEGORIZED", "a\nb"]) assert.equal((await act({ action: "create", title: bad })).status, 400, String(bad));
  assert.equal((await act({ action: "create", title: "X", color: "chartreuse" })).status, 400);
  for (let i = st.sections.length; i < MAX_SECTIONS; i++) await act({ action: "create", title: `S${i}` });
  assert.equal((await act({ action: "create", title: "One too many" })).status, 400);
  for (const s of (await secs()).sections.slice(3)) await act({ action: "delete", id: s.id });
  assert.equal((await secs()).sections.length, 3);
});
await test("rename and recolor a section; bad input and unknown ids are refused", async () => {
  let st = await act({ action: "update", id: work.id, title: "Work stuff", color: "teal" });
  assert.deepEqual([st.sections[0].title, st.sections[0].color], ["Work stuff", "teal"]);
  st = await act({ action: "update", id: work.id, color: "red" }); assert.equal(st.sections[0].title, "Work stuff"); assert.equal(st.sections[0].color, "red");
  assert.equal((await act({ action: "update", id: work.id, title: "" })).status, 400);
  assert.equal((await act({ action: "update", id: work.id, title: "Uncategorized" })).status, 400);
  assert.equal((await act({ action: "update", id: work.id, color: "none" })).status, 400);
  assert.equal((await act({ action: "update", id: "nope", title: "X" })).status, 404);
});
await test("reorder sections; missing ids keep their place after the listed ones, unknown ids are ignored", async () => {
  let st = await act({ action: "reorder", ids: [ideas.id, work.id, home.id] }); assert.deepEqual(st.sections.map((x) => x.id), [ideas.id, work.id, home.id]);
  st = await act({ action: "reorder", ids: [home.id, "ghost"] }); assert.deepEqual(st.sections.map((x) => x.id), [home.id, ideas.id, work.id]);
  assert.equal((await act({ action: "reorder", ids: "x" })).status, 400);
  st = await act({ action: "reorder", ids: [work.id, home.id, ideas.id] }); assert.deepEqual(st.sections.map((x) => x.id), [work.id, home.id, ideas.id]);
});
let t1, t2, t3;
await test("moving a task sets its section, moving it back to null returns it to Uncategorized, and activity time is untouched", async () => {
  t1 = mk("Task one", 1000); t2 = mk("Task two", 2000); t3 = mk("Task three", 3000);
  const before = R.session(t1).updated;
  assert.equal((await R.updateSession(t1, { section: work.id })).section, work.id);
  assert.equal(R.session(t1).updated, before);
  await R.updateSession(t2, { section: work.id }); await R.updateSession(t3, { section: home.id });
  assert.equal((await R.updateSession(t2, { section: null })).section, null);
  assert.equal((await R.updateSession(t2, { section: work.id })).section, work.id);
  const bad = await R.updateSession(t1, { section: "no-such-section" }); assert.equal(bad.status, 400); assert.equal(view(t1).section, work.id);
  assert.equal((await R.updateSession(t1, { section: 7 })).status, 400);
  assert.equal((await R.updateSession(t1, { pinned: true })).section, work.id);   // other edits leave the section alone
  assert.equal((await R.updateSession(t1, { title: "Renamed one" })).section, work.id);
  await R.updateSession(t1, { pinned: false });
});
await test("deleting a section moves its tasks to Uncategorized and leaves other sections alone", async () => {
  const st = await act({ action: "delete", id: home.id });
  assert.deepEqual(st.sections.map((x) => x.id), [work.id, ideas.id]);
  assert.equal(view(t3).section, null); assert.equal(view(t1).section, work.id);
  assert.equal((await act({ action: "delete", id: home.id })).status, 404);
  home = (await act({ action: "create", title: "Home", color: "green" })).sections.at(-1);
  await R.updateSession(t3, { section: home.id });
});
await test("switching back to the default sections keeps the sections and the assignments for when custom sections come back on", async () => {
  const off = await act({ action: "disable" });
  assert.equal(off.on, false); assert.deepEqual(off.sections.map((x) => x.id), [work.id, ideas.id, home.id]);
  assert.equal(view(t1).section, work.id); assert.equal(view(t3).section, home.id);
  const on = await act({ action: "enable" });
  assert.equal(on.on, true); assert.deepEqual(on.sections.map((x) => x.title), ["Work stuff", "Ideas", "Home"]);
  assert.equal(view(t2).section, work.id);
});
await test("a task started while custom sections are on lands in Uncategorized; the stored section is only set by moves", async () => {
  const id = R.newSession("Started later");
  assert.equal(R.session(id).section, null);
});
await test("order rule: open tasks newest activity first, then closed tasks newest activity first; never creation order", async () => {
  const rows = [
    { id: "a", updated: 100, done: 0, created: 900 }, { id: "b", updated: 500, done: 0, created: 1 }, { id: "c", updated: 300, done: 1, created: 2 },
    { id: "d", updated: 800, done: 1, created: 3 }, { id: "e", updated: 200, done: 0, created: 800 },
  ];
  assert.deepEqual(ids(orderTasks(rows)), ["b", "e", "a", "d", "c"]);
  assert.deepEqual(ids(orderTasks([{ id: "x", updated: 5, done: 0 }, { id: "y", updated: 5, done: 0 }])), ["x", "y"]);   // a tie stays stable
});
await test("order rule on real tasks in a section: activity moves a task to the top of its group, a rename does not", async () => {
  const s = (await act({ action: "create", title: "Order", color: "purple" })).sections.at(-1);
  const o1 = mk("open old", 10), o2 = mk("open new", 50), c1 = mk("closed old", 20, 1), c2 = mk("closed new", 60, 1);
  for (const id of [o1, o2, c1, c2]) await R.updateSession(id, { section: s.id });
  const inSec = async () => orderTasks((await R.listSessions()).filter((x) => x.section === s.id)).map((x) => x.title);
  assert.deepEqual(await inSec(), ["open new", "open old", "closed new", "closed old"]);
  await R.updateSession(o1, { title: "open old renamed" });   // a rename is not activity
  assert.deepEqual(await inSec(), ["open new", "open old renamed", "closed new", "closed old"]);
  R.touchSession(o1);   // new activity on the older open task
  assert.deepEqual(await inSec(), ["open old renamed", "open new", "closed new", "closed old"]);
});
await test("a done task that gets new activity: it moves to the top of the closed tasks while it stays closed, and joins the open tasks when it is reopened", async () => {
  const s = (await secs()).sections.at(-1);
  const rows = async () => orderTasks((await R.listSessions()).filter((x) => x.section === s.id)).map((x) => x.title);
  const old = (await R.listSessions()).find((x) => x.title === "closed old");
  await new Promise((r) => setTimeout(r, 3)); R.touchSession(old.id);
  assert.equal(view(old.id).done, true);
  const after = await rows();
  assert.equal(after.slice(2)[0], "closed old");   // newest activity among the closed tasks, now above "closed new"
  await R.updateSession(old.id, { done: false });   // reopened by the person: an open task, ordered with the open ones by its activity
  R.sql.exec("UPDATE sessions SET updated=? WHERE id=?", Date.now() + 10, old.id);
  assert.equal((await rows())[0], "closed old"); assert.equal(view(old.id).done, false);
});
console.log(`custom sections: ${checks} checks passed`);
