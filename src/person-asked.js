// The Captain's rule: "the user determines done." The helper never checks anything off on its own: a task (session) or a
// to-do item becomes done only when the person ticks it in the app, or when they explicitly tell the helper to in this turn.
// "Explicitly" is checked, not trusted: the helper passes person_asked, a short quote of the person's own words, and it must
// appear (case-insensitive) in a message the person sent in THIS turn: the card's first message or a steer it has read.
// Scheduled runs, follow-ups, helpers and handed-back results have no such message, so they can never mark anything done.

const norm = (s) => String(s ?? "").normalize("NFKC").replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const STOP = new Set(["the", "task", "session", "one", "for", "and", "with", "that", "this", "about"]);
export const QUOTE_MIN = 6;   // characters, so a quote can't be a lone "done" or "ok"

// The person's own words in this turn (tc = the Resident's per-turn context). [] when the run has none.
export function personWords(tc) {
  if (!tc || tc.kind !== "chat" || !tc.turn) return [];
  const out = [];
  if (!tc.handoff && tc.userText) out.push(String(tc.userText));
  const p = tc.pend;
  if (p && Array.isArray(p.items)) for (const x of p.items.slice(0, p.next ?? p.items.length)) if (x && x.type === "msg" && x.text) out.push(String(x.text));
  return out;
}

// The same check for other things only the person may ask for (an app-event workflow, composio-triggers.js): → null when the quote is
// in what they said this turn, else why not: "none" (no message from them in this run) | "empty" | "short" | "missing".
export function quoteProblem(quote, words) {
  if (!words?.length) return "none";
  const q = norm(quote).replace(/^["'`]+|["'`]+$/g, "").replace(/[\s.!?,;:]+$/, "").trim();
  if (!q) return "empty";
  if (q.length < QUOTE_MIN) return "short";
  return words.some((w) => norm(w).includes(q)) ? null : "missing";
}

// → { ok: true } or { ok: false, error } (a plain error the model relays).
export function checkQuote(quote, words) {
  if (!words?.length) return { ok: false, error: "error: there's no message from the person in this run, so nothing can be marked done. Only the person decides when something is done: leave it as it is and let them tick it in the app." };
  const q = norm(quote).replace(/^["'`]+|["'`]+$/g, "").replace(/[\s.!?,;:]+$/, "").trim();
  if (!q) return { ok: false, error: "error: person_asked is required: quote the person's own words asking you to mark it done. If they didn't ask, don't mark it done; they tick it themselves." };
  if (q.length < QUOTE_MIN) return { ok: false, error: `error: person_asked "${String(quote).slice(0, 40)}" is too short to show they asked. Quote their whole request (e.g. "mark the flights task as done").` };
  if (!words.some((w) => norm(w).includes(q))) return { ok: false, error: `error: "${String(quote).slice(0, 120)}" isn't in anything the person said in this conversation turn. Only mark something done when the person explicitly asks you to, quoting their exact words; otherwise leave it for them to tick.` };
  return { ok: true };
}

// The mark_task_done tool: offered only to the General channel's helper.
export const MARK_DONE_TOOL = { type: "function", function: { name: "mark_task_done",
  description: "Mark one of this channel's tasks as done (it moves to the person's done tasks in the app). The person decides when something is done, not you: NEVER call this on your own initiative, even when the work is clearly finished; tell them it's ready and let them tick it. Call it ONLY when the person explicitly asks you in this conversation to mark a task done or check it off (e.g. \"mark the flights task as done\"), and pass their own words in person_asked; it is refused without a matching quote, and in scheduled runs, follow-ups and helpers. The texting conversation can't be marked done.",
  parameters: { type: "object", properties: {
    task: { type: "string", description: "The task's title (or part of it) or id; \"this task\" for the current one. If several tasks match, the result lists them: ask the person which one." },
    person_asked: { type: "string", description: "A short exact quote of the person's own words asking you to mark it done, e.g. 'mark the flights one as done'" } }, required: ["task", "person_asked"] } } };
MARK_DONE_TOOL.function.description = MARK_DONE_TOOL.function.description.replace("one of this channel's tasks", "a task in this channel or another existing channel using channel");
MARK_DONE_TOOL.function.parameters.properties.channel = { type: "string", description: "Existing channel slug or exact name from list_channels; omit for General." };
MARK_DONE_TOOL.function.parameters.properties.task.description = "The task id or exact title from list_tasks; use an id if a title is ambiguous. 'this task' selects the current task only in General.";

// Which task the person meant: id, "this task", exact title, then title fragments. rows: [{ id, title, done }].
// texts: ids of texting tasks (preferred against when another open task also matches). → { row } or { error }.
export function findTask(rows, query, current = null, texts = []) {
  const raw = String(query ?? "").trim(), q = norm(raw).replace(/^["'`]+|["'`]+$/g, "").replace(/^(the )?(task|session)\s+/, "").replace(/\s+(task|session)$/, "").trim();
  if (!q) return { error: "error: say which task to mark done (its title)." };
  const byId = rows.find((r) => String(r.id) === raw); if (byId) return { row: byId };
  if (/^(this|this one|this task|current|the current task|current task|it)$/.test(q)) {
    const cur = rows.find((r) => r.id === current); return cur ? { row: cur } : { error: "error: this run isn't in a task; name the task to mark done." };
  }
  let hits = rows.filter((r) => norm(r.title) === q);
  if (!hits.length) hits = rows.filter((r) => { const t = norm(r.title); return t.includes(q) || (t.length >= 4 && q.includes(t)); });
  if (!hits.length) { const ws = q.split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !STOP.has(w)); if (ws.length) hits = rows.filter((r) => { const t = norm(r.title); return ws.every((w) => t.includes(w)); }); }
  if (!hits.length) return { error: `error: no task in this channel matches "${raw.slice(0, 80)}". Ask the person which task they mean.` };
  const open = hits.filter((r) => !r.done);
  if (!open.length) return { row: hits[0] };   // already done: the caller says so
  if (open.length === 1) return { row: open[0] };
  const plain = open.filter((r) => !texts.includes(r.id));
  if (plain.length === 1) return { row: plain[0] };
  return { error: `error: several tasks match "${raw.slice(0, 80)}": ${open.slice(0, 8).map((r) => `"${r.title}"`).join(", ")}. Ask the person which one to mark done.` };
}
