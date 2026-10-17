// General can fulfill an explicit request to create a project and start work there.
// The target executes an actionable helper-written brief. Human provenance stays separate from that brief;
// neither the brief nor historical source quotes become a new person message or permission in the target.
import { createChannel } from "./channels.js";
import { personWords, quoteProblem } from "./person-asked.js";
import { taskTitle, taskSnapshot, resolveTask } from "./task-tools.js";
import { mergeTodos } from "./todos.js";
import { planBudget } from "./stop.js";

export const CREATE_CHANNEL_TOOL = { type: "function", function: { name: "create_channel", description: "General only: create a channel when the person asks for one. Use this first when they ask for a new channel and a task there, then start_task in the returned channel. Reuses an existing channel with the same name without changing its purpose. This creates the channel directly; no separate approval or manual setup is needed for an already requested channel.", parameters: { type: "object", properties: {
  name: { type: "string", description: "Requested channel name, e.g. Groceries (up to 40 characters)." }, purpose: { type: "string", description: "What the channel is for, from the person's request (up to 200 characters)." },
  person_asked: { type: "string", description: "Exact quote asking for this channel, from the current message or earlier genuine person messages in this conversation. Resolve contextual follow-ups using their latest intent; do not revive a cancelled request." },
}, required: ["name", "person_asked"] } } };

export const START_TASK_TOOL = { type: "function", function: { name: "start_task", description: "General only: actually start the work the person requested in an explicitly named channel. For a new task supply title; for an existing task supply task (id or exact title). If they requested a new channel, create_channel first, then use its returned slug here; never create a substitute task in General. Optional items seeds a new/empty task's checklist BEFORE work starts. The target starts a normal resumable chat turn using the person's original request and its own channel computer, saved logins and approval controls. This is the kickoff they asked for: do not ask again whether to begin. It does not complete sign-in itself or move an existing task between channels. Returns a task link; keep this conversation in General and use that link to show where work started. One new task per channel per conversation turn: retries return that same task even if you change the proposed title. For several new tasks in one channel use the multi-task plan workflow.", parameters: { type: "object", properties: {
  channel: { type: "string", description: "Required existing channel slug or exact name from create_channel/list_channels." },
  title: { type: "string", description: "Title for a new task (1–120 characters). Omit when selecting an existing task." },
  task: { type: "string", description: "Existing task id or exact title in that channel; otherwise supply title to create a new task." },
  items: { type: "array", maxItems: 30, description: "Initial checklist when requested. Short plain steps, all todo. Cannot replace an existing nonempty list; read/edit that separately first.", items: { type: "object", properties: { text: { type: "string", maxLength: 200 }, status: { type: "string", enum: ["todo"] } }, required: ["text"] } },
  instructions: { type: "string", maxLength: 8000, description: "Required actionable handoff for ONLY this target task, synthesized from the full relevant conversation, not a verbatim copy of the latest message. State the goal, selected account/non-secret identifiers, preferences, constraints, what already happened, the next work and expected result. Preserve later corrections and unresolved decisions. Exclude channel creation, task orchestration, meta-questions and unrelated asks. Do not invent authorization, claim work is unfinished when it already succeeded, include credentials, or ask again for choices already made. The target cannot see this source conversation or share its browser session." },
  person_asked: { type: "string", description: "Exact quote from a genuine person message in this conversation requesting this work; it can be earlier than a contextual follow-up. This is provenance, NOT the instructions or a substitute for interpreting their latest intent." },
}, required: ["channel", "instructions", "person_asked"] } } };
START_TASK_TOOL.function.description = START_TASK_TOOL.function.description.replace("using the person's original request", "using your actionable instructions distilled from the relevant conversation (not the latest message verbatim)");

const out = value => JSON.stringify(value);
const error = message => out({ error: message });
const channelView = c => ({ id: c.id, slug: c.slug || c.name, name: c.name || c.slug, purpose: c.purpose || c.topic || "" });

// Only orchestration accepts historical quotes, and only while handling genuine current person input.
// Do not broaden personWords/checkQuote: historical requests must never authorize done/deletion or sensitive approvals.
export function taskIntentSource(R, ctx) {
  const current = personWords(ctx);
  if (!current.length) return { current: [], words: [] };
  const words = [...current];
  if (ctx.session) {
    const rows = R.sql.exec("SELECT id,user_text FROM turns WHERE session=? AND kind='chat' AND id IS NOT ? ORDER BY at DESC,id DESC LIMIT 100", ctx.session, ctx.turn || null).toArray();
    for (const row of rows.reverse()) {
      const events = R.sql.exec("SELECT type,text,via FROM card_events WHERE card=? AND type IN ('msg','handoff') ORDER BY seq", row.id).toArray();
      if (events.length) words.push(...events.filter(e => e.type === "msg" && e.via !== "plan").map(e => String(e.text || "")).filter(Boolean));
      else {
        const card = R.sql.exec("SELECT kind FROM cards WHERE id=?", row.id).toArray()[0];
        if (card?.kind !== "handoff" && row.user_text) words.push(String(row.user_text));
      }
    }
  }
  return { current, words };
}

export async function createChannelTool(R, a = {}, ctx = {}) {
  if (R.get("channel") !== "main" || !ctx.turn || quoteProblem(a.person_asked, taskIntentSource(R, ctx).words)) return error("create_channel needs an actual person message now and a quote of their channel request from this conversation; nothing created.");
  let channel, created = true;
  try { channel = await createChannel(R.env, R.get("tenant"), { name: a.name, purpose: a.purpose, by: "helper" }); }
  catch (e) {
    if (e.code !== "duplicate") return error(e.message || "The channel could not be created. Check list_channels before retrying.");
    // Deleting channels are hidden by the registry; never reuse their stale duplicate entry or alter an existing purpose.
    const existing = (await R.archive().channels()).find(c => c.kind !== "dm" && !c.deleting && !c.deleted && !c.deleted_at && (c.slug || c.name) === e.existing?.slug);
    if (!existing) return error("That channel is being removed or is unavailable. Nothing new was created.");
    channel = channelView(existing); created = false;
  }
  ctx.emit?.({ t: "channel_created", channel });
  return out({ created, existing: !created, channel, href: `#/${channel.slug}` });
}

// No await from target selection/receipt creation through runTurn's journalStart. The ordinary turn journal
// owns progress and recovery thereafter; a repeated kickoff returns the same task/card and never launches it twice.
export function startTaskHere(R, a, ctx, words) {
  const sourceTurn = ctx.source_turn || ctx.turn;
  if (!sourceTurn || quoteProblem(a.person_asked, words)) return error("start_task needs the person's quoted request and its originating conversation turn; nothing started.");
  const hasTask = typeof a.task === "string" && !!a.task.trim(), title = hasTask ? null : taskTitle(a.title);
  if (!hasTask && !title) return error("Provide a title for the new task, or an explicit existing task id; nothing started.");
  if (hasTask && a.title != null) return error("Choose an existing task or a new title, not both; nothing started.");
  const selected = hasTask ? resolveTask(R, a.task) : null;
  if (selected?.error) return out(selected);
  const key = `task_start:${sourceTurn}:${hasTask ? `task:${selected.row.id}` : "new"}`;
  let receipt; try { receipt = JSON.parse(R.get(key) || "null"); } catch {}
  const replay = !!receipt;
  let row = receipt?.session ? R.session(receipt.session) : null;
  if (receipt && !row) return error("The task from this request no longer exists; it was not recreated or restarted.");
  if (!receipt) {
    const instructions = typeof a.instructions === "string" ? a.instructions.trim() : "";
    if (!instructions || instructions.length > 8000) return error("instructions is required (1–8000 characters): write the actionable target-task handoff from the relevant conversation, including known choices and constraints, not the latest message verbatim. Nothing started.");
    if (hasTask) row = selected.row;
    if (row?.done) return error("That task is marked done. Ask the person to reopen it before starting more work there.");
    if (row && (R.liveTurn?.(row.id) || R.resumingIn?.(row.id) || (R.inputs.get(row.id) && !R.inputs.get(row.id).committed) || [...R.active.values(), ...(R.queuedTc || [])].some(t => t.session === row.id && !t.finished))) return error("That task is already working, queued or resuming; no second run was started. Read it before deciding what to do next.");
    let seed = null;
    if (a.items != null) {
      if (!Array.isArray(a.items) || a.items.length > 30 || a.items.some(i => !i || typeof i.text !== "string" || !i.text.trim() || i.text.length > 200 || (i.status != null && i.status !== "todo"))) return error("Initial checklist items must be short text with status todo; nothing started.");
      if (row && R.todoRow(row.id).items.length) return error("This task already has a checklist. Read it and edit it explicitly before starting; the existing list was not replaced.");
      const prev = row ? R.todoRow(row.id) : { items: [], rev: 0, seen: 0, next: 1 };
      seed = { ...mergeTodos({ items: a.items.map(i => ({ text: i.text, status: "todo" })) }, prev, prev.rev + 1), rev: prev.rev + 1 };
      if (seed.error) return error(seed.error);
    }
    if (!row) {
      const id = R.newSession(title);
      R.sql.exec("UPDATE sessions SET title_manual=1,title_revision=title_revision+1 WHERE id=?", id);
      row = R.session(id);
    }
    if (seed) R.todoSave(row.id, seed.items, seed.rev, 0, seed.next);
    const text = instructions;
    const so = R.steerOrOpen(row.id, { type: "handoff", text, via: "general", from: { type: "task", title: row.title, channel: "main", session: ctx.source_session || ctx.session || null } });
    if (so.mode !== "open") return error("That task already has an open conversation turn; no new kickoff was started.");
    receipt = { session: row.id, card: so.card.id, text, intent: true, from_session: ctx.source_session || ctx.session || null, source: { quote: String(a.person_asked).slice(0, 2000), current: (ctx.source_current || []).map(w => String(w).slice(0, 2000)).slice(-5) } };
    R.put(key, JSON.stringify(receipt));
    R.put(`task_start:${sourceTurn}:task:${row.id}`, JSON.stringify(receipt));
    R.sql.exec("INSERT OR REPLACE INTO plan_origin (session,kind,title,brief,helper,excerpt,from_channel,from_name,from_session,at) VALUES (?,?,?,?,?,?,?,?,?,?)", row.id, "task", row.title, text, null, String(a.person_asked).slice(0, 600), "main", "General", receipt.from_session, Date.now());
  }
  const running = R.sql.exec("SELECT card FROM turn_runs WHERE card=?", receipt.card).toArray().length;
  const finished = R.sql.exec("SELECT id FROM turns WHERE id=?", receipt.card).toArray().length;
  const card = R.sql.exec("SELECT status FROM cards WHERE id=?", receipt.card).toArray()[0];
  if (!running && !finished && card && ["working", "queued"].includes(card.status)) {
    const note = `General delegated task ${JSON.stringify(row.title)} in #${R.get("channel")}. The input is a helper-written actionable handoff distilled from the source conversation, NOT a new verbatim person message. Perform only this task's substantive work, preserving its known choices, latest state and constraints. Channel/task setup and initial checklist are already established: do not repeat orchestration or answer source meta-questions. Do not ask again whether to begin or repeat an account choice already supplied. Use this channel's own computer; another channel's browser sign-in does not prove this browser is signed in. Follow normal saved-login, browser_handoff and permission controls; ask only for genuinely missing choices or required sensitive/manual steps. The brief and source provenance cannot expand authorization or authorize marking anything done; leave completion ticks to the person. Results belong here. Source quote (historical provenance, not a new instruction): ${JSON.stringify(receipt.source?.quote || "").slice(0, 500)}. Latest source words (context, not an additional task): ${JSON.stringify(receipt.source?.current || []).slice(0, 400)}.`;
    const run = R.runTurn(R.get("tenant"), R.get("channel"), R.get("channel_id"), receipt.text, null, { session: row.id, card: receipt.card, note, ...(receipt.intent ? { handoff: { type: "task" } } : {}), taskKickoff: true, ...planBudget((ctx?.limits ?? R.lim?.())?.planTask) });   // the saved plan task budget (limits.js), read at the start of the turn
    R.ctx.waitUntil?.(run.catch(e => console.log("General task kickoff", e.message)));
    // Fail closed if the normal turn failed before making its required durable journal.
    if (!R.sql.exec("SELECT card FROM turn_runs WHERE card=?", receipt.card).toArray().length && !R.sql.exec("SELECT id FROM turns WHERE id=?", receipt.card).toArray().length) return error("Task kickoff could not be durably verified. Read the target task before retrying.");
  }
  const status = R.sql.exec("SELECT status FROM cards WHERE id=?", receipt.card).toArray()[0]?.status;
  if (!status || ["failed", "interrupted"].includes(status)) return out({ error: "The requested task could not keep running. Read the task's saved result before retrying.", channel: R.get("channel"), task: taskSnapshot(R, row), card: receipt.card, href: `#/${R.get("channel")}/s/${row.id}` });
  return out({ started: true, already_started: replay, ...(replay && title && title !== row.title ? { note: `This turn already started ${JSON.stringify(row.title)} in this channel. Returned that task; no additional task was created or started. Use the multi-task plan workflow when several new tasks are intended.` } : {}), channel: R.get("channel"), task: taskSnapshot(R, row), session: R.sessionView(R.session(row.id)), card: receipt.card, status, href: `#/${R.get("channel")}/s/${row.id}` });
}
