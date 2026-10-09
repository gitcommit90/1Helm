// To-do list per task (session): the helper keeps it with update_todos, the person follows along in the app (checklist button
// in the task header) and can tick or untick items. One row per task in the Resident's SQLite (table todos, created by the Resident).
//   items: [{ id, text, status: "todo"|"doing"|"done", by: "helper"|"person", at: the rev it last changed, ready?: true }]
// The Captain's rule, "the user determines done": only the person ticks items done. An item the helper sends as "done" keeps
// its status and gets ready: true ("ready for you to tick" in the app); ready items don't count against "one doing at a time".
// The one exception is an explicit request: person_asked, a quote verified against the person's messages in this turn
// (person-asked.js), lets the helper's "done" through for that call.
//   rev: bumped on every change   seen: the rev the helper last saw (its tool result, or the list in its message)
// The helper always sends the whole list (it replaces the old one). A person's tick made after the helper last saw the list wins
// over the helper's stale copy, and the tool result says so; once the helper has seen it, the helper may change it again.
export const TODO_MAX_ITEMS = 30, TODO_MAX_CHARS = 200;
const STATUS = { todo: "todo", doing: "doing", done: "done", pending: "todo", open: "todo", not_started: "todo", in_progress: "doing", "in-progress": "doing", active: "doing", working: "doing", completed: "done", complete: "done", finished: "done" };

export const TODO_TOOL = { type: "function", function: { name: "update_todos",
  description: "Keep a to-do list for this task. The person sees it live in the app (a checklist button in the task's header) and ticks items off themselves; many people rely on it to stay oriented, so keep it true. Use it for multi-step work (about 3 or more distinct steps, or when the person gives you several things to do): write the steps when you start, then call it again as you go, marking exactly one item \"doing\" while you work on it. Only the person ticks items done: never mark items done yourself. When an item is finished, leave it as \"doing\" (or as it was), move on to the next, and tell them it's ready for them to tick; an item you send as \"done\" keeps its status and shows as ready to tick. Only when the person explicitly asks you in this conversation to tick specific items (e.g. \"check off the flights\") send those as \"done\" with their own words in person_asked. Send the WHOLE list every time; it replaces the old one: keep each item's id, keep the order, and add or remove items as the plan changes. Items are short, plain steps the person understands, not technical detail (at most 30 items, 200 characters each). Don't use it for quick one-step requests, simple questions or chat. When a later message starts new multi-step work, replace a finished list with a new one; an empty list clears it. Returns the current list, including items the person ticked or unticked themselves (their change is kept if you hadn't seen it yet).",
  parameters: { type: "object", properties: { person_asked: { type: "string", description: "Only when the person explicitly asked you to tick items done: a short exact quote of their words, e.g. 'tick off the hotel'. Leave out otherwise." }, items: { type: "array", maxItems: TODO_MAX_ITEMS, description: "The whole list, in order", items: { type: "object", properties: {
    id: { type: "string", description: "The item's id from the current list; leave out for a new item" },
    text: { type: "string", description: "A short, plain step, e.g. 'Compare prices on 3 sites'" },
    status: { type: "string", enum: ["todo", "doing", "done"] } }, required: ["text", "status"] } } }, required: ["items"] } } };

const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
export const publicItems = (items) => (items || []).map(({ id, text, status, ready }) => ({ id, text, status, ...(ready && status !== "done" ? { ready: true } : {}) }));

// The helper's new list (tool arguments) merged with what's stored. Returns { items, next, notes } or { error }.
// opts.allowDone: the person explicitly asked (verified person_asked), so the helper's "done" counts. opts.quoteError: the
// reason a person_asked quote was rejected, said in the result.
export function mergeTodos(input, prev = { items: [], seen: 0, next: 1 }, now = (prev.rev || 0) + 1, opts = {}) {
  let list = input?.items;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch {} }
  if (!Array.isArray(list)) return { error: "error: items must be a list of { id?, text, status } (send [] to clear the list)" };
  const notes = [], old = prev.items || [], used = new Set(), out = [], held = [];
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
      out.push({ id, text, status: p.status, by: "person", at: p.at }); continue;
    }
    // Only the person ticks done: the helper's "done" leaves the item as it was, marked ready for them to tick.
    let ready = !!(p && p.ready && p.status === status);   // still ready while the helper leaves it as it was
    if (status === "done" && !opts.allowDone && !(p && p.status === "done")) { status = p ? p.status : "todo"; if (!(p && p.ready)) held.push(text); ready = true; }
    const item = { id, text, status, by: p && p.status === status ? p.by : "helper", at: p && p.status === status ? p.at : now };
    if (ready) item.ready = true;
    out.push(item);
  }
  if (opts.quoteError) notes.push(`person_asked wasn't accepted: ${opts.quoteError.replace(/^error: /, "")}`);
  if (held.length) notes.push(`Only the person ticks items done, so ${held.map((t) => `"${t}"`).join(", ")} ${held.length > 1 ? "were" : "was"} left as ${held.length > 1 ? "they were" : "it was"} and show${held.length > 1 ? "" : "s"} as ready for them to tick. Don't mark items done yourself: leave a finished item as "doing" and tell the person it's ready for them to tick.`);
  const doing = out.filter((x) => x.status === "doing" && !x.ready);
  if (doing.length > 1) { for (const x of doing.slice(1)) { x.status = "todo"; x.by = "helper"; x.at = now; } notes.push(`Only one item can be "doing" at a time: kept "${doing[0].text}" and set the others back to todo.`); }
  if (dropped) notes.push(`The list holds at most ${TODO_MAX_ITEMS} items; ${dropped} extra item(s) were left off. Combine steps.`);
  if (cut) notes.push(`${cut} item(s) were longer than ${TODO_MAX_CHARS} characters and were shortened. Keep items short.`);
  return { items: out, next, notes };
}

// One line per item, with the id the helper reuses.
export function todoLines(items) { return items.map((x) => `(id ${x.id}) [${x.status}${x.ready && x.status !== "done" ? ", ready for the person to tick" : ""}] ${x.text}`).join("\n"); }
const doneCount = (items) => items.filter((x) => x.status === "done").length;

// What update_todos returns: the truth, as stored now.
export function todoResult(items, notes = []) {
  if (!items.length) return `To-do list cleared; the checklist is hidden in the app.${notes.length ? `\n${notes.join("\n")}` : ""}`;
  const d = doneCount(items), r = items.filter((x) => x.ready && x.status !== "done").length;
  return `Saved. To-do list (${d} of ${items.length} done${d === items.length ? ", all done" : ""}${r ? `, ${r} ready for the person to tick` : ""}), as the person sees it:\n${todoLines(items)}${notes.length ? `\n\n${notes.join("\n")}` : ""}`;
}

// The list as it enters the helper's next message (the per-turn context, never the system prompt).
export function todoContextNote(items) {
  if (!items?.length) return "";
  const d = doneCount(items);
  if (d === items.length) return `\n\n(Context note, not from the person: your to-do list for this task is all done (${d} of ${d}: ${items.map((x) => x.text).join("; ").slice(0, 600)}). If this message starts new multi-step work, replace it with a new list using update_todos.)`;
  return `\n\n(Context note, not from the person: your to-do list for this task, which the person sees in the app; only they tick items done (${d} of ${items.length} done). Continue this list with update_todos as you work; don't start a new one unless the work changed:\n${todoLines(items)})`;
}
