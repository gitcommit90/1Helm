// Steerable turns (notes/steerable-turns-contract.md §3, §4): what the helper reads when the person adds to a task it is
// already working on, the synthetic result of a tool call it didn't run because a new message came first, and the one static
// system-prompt sentence about step titles. Pure text: the live input registry itself lives on the Resident
// (steerOrOpen / takeSteers / hasSteers), and the card rows in tracker.js.

import { replyLine } from "./reply-to.js";

// §4: the only prompt addition (static, inside the cached system prompt).
export const STEP_TITLE_PROMPT = "Each tool call takes step_title: a short past-tense line the person sees for that step.";

// §3: a call not run because the person sent a new message before it (classic: the tool result; pi: the block reason).
export const SKIP_REASON = "Not run: the person sent a new message before this step. Read it next and call this again only if it still fits.";
export const SKIP_TEXT = `(${SKIP_REASON})`;

// §3: more than MAX_INPUTS (tracker.js) inputs on one card → /stream answers HTTP 429 with this.
export const TOO_MANY = "That's a lot at once. Give me a moment to catch up.";

// A limit (cost cap, deadline) asked an unattended run to stop: tools off, final report.
export const LIMIT_REPORT_ASK = "(This run hit its limit. No more tools. Write your final report now: what you found or made (exact values, file paths) and what's unfinished. Plain text only: no cards, no buttons, and don't ask whether to continue.)";

const HEAD = "Read it together with everything they said in this task as one request. If it changes what they want, change course now and keep work that's still valid. Don't answer it separately; your one reply covers everything.";
export const LATE_PREFIX = "(You hadn't sent that reply yet: they added this while you were writing it. They saw your draft above as a progress note; write a reply that builds on it and covers everything.)";

// [13:34:05] in the person's time zone (24 h), UTC when the zone is unknown or invalid.
export function clock(at, tz) {
  const d = new Date(Number(at) || Date.now());
  if (tz) { try { return d.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch {} }
  return d.toISOString().slice(11, 19);
}

// One handed-back result (a helper's report or a due follow-up) as the context note the helper reads.
export function handoffNote(item) {
  const t = String(item.text ?? "");
  if (/^\(Context note/.test(t.trim())) return t.trim().slice(0, 7000);
  const f = item.from || {};
  if (f.type === "helper") {
    const st = f.status === "stopped" ? `stopped${f.why ? `: ${f.why}` : ""}` : f.status === "failed" ? `failed${f.error ? `: ${f.error}` : ""}` : "done";
    return `(Context note, not from the person: your helper${f.id != null ? ` #${f.id}` : ""} "${String(f.title || "helper").replace(/"/g, "'")}" finished (${st}). Its report:\n${t.slice(0, 6000)}\nUse it if it fits what you're doing now, and tell the person what it found in your reply.)`;
  }
  if (f.type === "followup") return `(Context note, not from the person: a follow-up you scheduled is due now: "${String(f.title || "").replace(/"/g, "'")}". ${t.slice(0, 6000)})`.replace(/\s+\)$/, ")");
  return `(Context note, not from the person: this came back while you were working:\n${t.slice(0, 6000)})`;
}

// The user-role message injected at the next step. items = input rows in arrival order: {type:"msg"|"handoff", text, at, files, from}.
// late: a steer landed while the model was writing what would have been its final answer.
export function steerText(items, { late = false, tz = null } = {}) {
  const msgs = (items || []).filter((x) => x && x.type !== "handoff"), hand = (items || []).filter((x) => x && x.type === "handoff");
  const out = [];
  if (late) out.push(LATE_PREFIX);
  if (msgs.length) {
    out.push(`(The person added this while you were working${msgs.length > 1 ? ` (${msgs.length} messages, in order)` : ""}. ${HEAD})`);
    for (const m of msgs) {
      const t = String(m.text ?? "").trim(), nf = Array.isArray(m.files) ? m.files.length : 0;
      const rl = replyLine(m.reply);   // Reply on a bubble (reply-to.js): which earlier message this answers
      out.push(`[${clock(m.at, tz)}] ${rl ? `${rl} ` : ""}${t || (nf ? `(sent ${nf === 1 ? "a file" : `${nf} files`})` : "")}`);
    }
  }
  for (const h of hand) out.push(handoffNote(h));
  return out.join("\n");
}
