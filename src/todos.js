// To-do list per task (session): the helper keeps it with update_todos, the person follows along in the app (checklist button
// in the task header) and can tick or untick items. One row per task in the Resident's SQLite (table todos, created by the Resident).
//   items: [{ id, text, status: "todo"|"doing"|"done", by: "helper"|"person", at: the rev it last changed}]
// The helper marks each item "done" as it finishes it; an item sent as "done" is stored as done (by: "helper"). Old stored rows may still
// carry ready: true; it is ignored.
// Done items stay done: a later helper list that sends an item the helper side finished (checked off by the helper or by the app) as todo or
// doing doesn't reopen it, and the result says so. A person's own tick or untick is handled as described below.
// Moving on: when a different item becomes "doing" (even if the helper leaves the old one "doing" too), the item that was "doing" is marked done by the app (mergeTodos).
//   rev: bumped on every change   seen: the rev the helper last saw (its tool result, or the list in its message)
// The helper always sends the whole list (it replaces the old one). A person's tick made after the helper last saw the list wins
// over the helper's stale copy, and the tool result says so; once the helper has seen it, the helper may change it again.
export const TODO_MAX_ITEMS = 30, TODO_MAX_CHARS = 200;
const STATUS = { todo: "todo", doing: "doing", done: "done", pending: "todo", open: "todo", not_started: "todo", in_progress: "doing", "in-progress": "doing", active: "doing", working: "doing", completed: "done", complete: "done", finished: "done" };

export const TODO_TOOL = { type: "function", function: { name: "update_todos",
  description: "Keep a to-do list for this task. The person sees it live in the app (a checklist button in the task's header). Use it for multi-step work (about 3 or more distinct steps, or when the person gives you several things to do): write the steps when you start, then call it again as you go, marking exactly one item \"doing\" while you work on it. Mark each item \"done\" as soon as you finish it, and before your final reply make sure every finished item is marked \"done\". An item that is already done stays done if a later list sends it as \"todo\" or \"doing\" (only the person can untick it). Send the WHOLE list every time; it replaces the old one: keep each item's id, keep the order, and add or remove items as the plan changes. Items are short, plain steps the person understands, not technical detail (at most 30 items, 200 characters each). Don't use it for quick one-step requests, simple questions or chat. When a later message starts new multi-step work, replace a finished list with a new one; an empty list clears it. Returns the current list, including items the person ticked or unticked themselves (their change is kept if you hadn't seen it yet).",
  parameters: { type: "object", properties: { person_asked: { type: "string", description: "Only when editing another task's list: a short exact quote of the person's request. Leave out otherwise." }, items: { type: "array", maxItems: TODO_MAX_ITEMS, description: "The whole list, in order", items: { type: "object", properties: {
    id: { type: "string", description: "The item's id from the current list; leave out for a new item" },
    text: { type: "string", description: "A short, plain step, e.g. 'Compare prices on 3 sites'" },
    status: { type: "string", enum: ["todo", "doing", "done"] } }, required: ["text", "status"] } } }, required: ["items"] } } };
TODO_TOOL.function.description += " To edit another task at the person's request, pass task (exact title or id) and, from General, channel (existing slug/name). Read it with read_task/list_tasks first, then send todo_revision as expected_revision and quote the requested change in person_asked. Preserve all unrelated items; an empty list deletes them. These targeted edits change the saved list only; they do not start work there or switch this conversation.";
Object.assign(TODO_TOOL.function.parameters.properties, {
  channel: { type: "string", description: "General only: target channel slug or exact name from list_channels. Omit for this channel." },
  task: { type: "string", description: "Task id or exact title; required for another channel, otherwise defaults to this task." },
  expected_revision: { type: "integer", minimum: 0, description: "Required for another task: its current todo_revision from read_task/list_tasks. If it changed, read again and preserve the newer list." },
});
TODO_TOOL.function.parameters.properties.person_asked.description = "Exact quote of the person's request. Required to edit another task's list; leave out for this task's list.";

const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
export const publicItems = (items) => (items || []).map(({ id, text, status }) => ({ id, text, status }));

// The helper's new list (tool arguments) merged with what's stored. Returns { items, next, notes } or { error }.
export function mergeTodos(input, prev = { items: [], seen: 0, next: 1 }, now = (prev.rev || 0) + 1, opts = {}) {
  let list = input?.items;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch {} }
  if (!Array.isArray(list)) return { error: "error: items must be a list of { id?, text, status } (send [] to clear the list)" };
  const notes = [], old = prev.items || [], used = new Set(), out = [], kept = new Set();
  let next = Math.max(1, Number(prev.next) || 1), cut = 0, dropped = 0;
  for (const raw of list) {
    const x = typeof raw === "string" ? { text: raw } : raw; if (!x || typeof x !== "object") continue;
    let text = clean(x.text ?? x.content ?? x.title); if (!text) continue;
    if (out.length >= TODO_MAX_ITEMS) { dropped++; continue; }
    if (text.length > TODO_MAX_CHARS) { text = text.slice(0, TODO_MAX_CHARS - 1).trimEnd() + "…"; cut++; }
    let status = STATUS[clean(x.status).toLowerCase().replace(/ /g, "_")] || "todo";
    const want = x.id == null ? "" : clean(x.id);
    let p = want ? old.find((o) => o.id === want && !used.has(o.id)) : null;
    if (!p) p = old.find((o) => !used.has(o.id) && o.text.toLowerCase() === text.toLowerCase());
    const id = p ? p.id : String(next++); used.add(id);
    // The person ticked/unticked this after the helper last saw the list: their change stands.
    if (p && p.by === "person" && p.at > (prev.seen || 0) && p.status !== status) {
      notes.push(`The person marked "${p.text}" ${p.status === "done" ? "done" : "not done"} themselves; kept their change.`);
      kept.add(id); out.push({ id, text, status: p.status, by: "person", at: p.at }); continue;
    }
    // An item the helper side already has done stays done when a
    // later helper list sends it as todo or doing. Only the person can untick it (that path is the person's tick, not this merge).
    if (p && p.status === "done" && p.by !== "person" && status !== "done") {
      notes.push(`"${p.text}" is already done; kept it done.`);
      out.push({ id, text, status: "done", by: p.by || "helper", at: p.at }); continue;
    }
    const item = { id, text, status, by: p && p.status === status ? p.by : "helper", at: p && p.status === status ? p.at : now };
    out.push(item);
  }
  // Moving on: when a different item becomes the active ("doing") one, the item that was active before is marked done. That
  // includes the common case where the helper starts the next item but leaves the previous one as "doing" too. If several
  // items are newly "doing", the first one is the active one and the one-doing rule below resets the rest.
  // Items that were never active stay as they are, an item the person ticked or unticked in this merge keeps their choice,
  // and done items are never reopened.
  const wasActive = (id) => old.some((o) => o.id === id && o.status === "doing");
  const nowDoing = out.find((x) => x.status === "doing" && !wasActive(x.id));
  if (nowDoing) {
    const wasDoing = old.find((o) => o.status === "doing" && o.id !== nowDoing.id && out.some((x) => x.id === o.id)), was = wasDoing && out.find((x) => x.id === wasDoing.id);
    if (was && was.status !== "done" && !kept.has(was.id)) {
      was.status = "done"; was.by = "helper"; was.at = now;
      notes.push(`"${was.text}" was the active item and you moved on to "${nowDoing.text}", so it was marked done automatically.`);
    }
  }
  const doing = out.filter((x) => x.status === "doing");
  if (doing.length > 1) { for (const x of doing.slice(1)) { x.status = "todo"; x.by = "helper"; x.at = now; } notes.push(`Only one item can be "doing" at a time: kept "${doing[0].text}" and set the others back to todo.`); }
  if (dropped) notes.push(`The list holds at most ${TODO_MAX_ITEMS} items; ${dropped} extra item(s) were left off. Combine steps.`);
  if (cut) notes.push(`${cut} item(s) were longer than ${TODO_MAX_CHARS} characters and were shortened. Keep items short.`);
  return { items: out, next, notes };
}

// One line per item, with the id the helper reuses.
export function todoLines(items) { return items.map((x) => `(id ${x.id}) [${x.status}] ${x.text}`).join("\n"); }
const doneCount = (items) => items.filter((x) => x.status === "done").length;

// What update_todos returns: the truth, as stored now.
export function todoResult(items, notes = []) {
  if (!items.length) return `To-do list cleared; the checklist is hidden in the app.${notes.length ? `\n${notes.join("\n")}` : ""}`;
  const d = doneCount(items);
  return `Saved. To-do list (${d} of ${items.length} done${d === items.length ? ", all done" : ""}), as the person sees it:\n${todoLines(items)}${notes.length ? `\n\n${notes.join("\n")}` : ""}`;
}

// The list as it enters the helper's next message (the per-turn context, never the system prompt).
export function todoContextNote(items) {
  if (!items?.length) return "";
  const d = doneCount(items);
  if (d === items.length) return `\n\n(Context note, not from the person: your to-do list for this task is all done (${d} of ${d}: ${items.map((x) => x.text).join("; ").slice(0, 600)}). If this message starts new multi-step work, replace it with a new list using update_todos.)`;
  return `\n\n(Context note, not from the person: your to-do list for this task, which the person sees in the app (${d} of ${items.length} done). Mark each item done with update_todos as soon as you finish it, and before your final reply make sure every finished item is marked done. Continue this list; don't start a new one unless the work changed:\n${todoLines(items)})`;
}
