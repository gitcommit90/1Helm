// Hands-on browser mode (2026-11-01, task cu-escalate).
// The cheap path stays as it is: browser_task hands a form to the browser worker, a text-only menu picker. When that path fails,
// the main model takes over the browser itself and sees the page. The trigger comes only from facts, never from what a model said:
//   1. a browser_task or background browser job ends with any status other than done (a person's own stop is not a failure), or
//   2. the main model's own browser_act comes back with an error.
// From then on, for the rest of that turn in that task, each browser_snapshot and browser_act result also shows the page (a small
// screenshot when the model takes images, else the vision description that browser_screenshot look:true gives), and browser_task and
// start_browser_task are not offered. A task that never fails sees none of this.
export const HANDS_ON_KEEP = 2;          // screenshots kept in the model's input; older ones are replaced by a short note
export const HANDS_ON_WIDTH = 1000;      // the screenshot is scaled to about this many pixels across
export const HANDS_ON_NEXT_MS = 30 * 60e3;   // a failed background job's hands-on mode waits this long for the task's next turn
export const HANDS_ON_HIDDEN = new Set(["browser_task", "start_browser_task"]);

// Job statuses: done is success. stopped means the person (or a restart check) stopped it, which is not a failure of the cheap path.
export const jobNeedsHands = (status) => !!status && status !== "done" && status !== "stopped";
// An error from the model's own browser_act. A refusal because someone else holds the browser is not a page failure.
export const actErrorNeedsHands = (r) => !!r && r.ok === false && !r.browser_busy && !r.taken_over && !r.owner_lost;

export const HANDS_ON_REFUSAL = "browser_task and start_browser_task are off for the rest of this turn. The browser worker already failed on this page, so you have the browser yourself now. Use browser_snapshot to read the page and browser_act to fill and click. Each result also shows the page.";
export const HANDS_ON_UNCERTAIN_TAIL = "\n(The last browser action may or may not have happened. You have the browser now, in this task's own tab. Call browser_snapshot to see the page, check what the form shows, and continue with browser_act yourself. Each result also shows the page. Do not repeat the action without checking.)";
export const HANDS_ON_JOB_TAIL = "\n(The browser worker did not finish. You have the browser now. Call browser_snapshot to see the page and continue with browser_act yourself. Each result also shows the page.)";
export const HANDS_ON_ACT_TAIL = "\n(You have the browser yourself. Call browser_snapshot to see where the page is now. From here each browser_snapshot and browser_act result also shows the page, and browser_task is off for this turn.)";
export const HANDS_ON_PIC_TEXT = "(Not from the person: a screenshot of the browser page as it is after your last browser step. The person does not see it.)";
export const HANDS_ON_SAVED_NOTE = "(Not from the person: a screenshot of the browser page was shown to you here. Call browser_snapshot to look at the page again.)";
export const HANDS_ON_DROPPED_NOTE = "(An older screenshot of the browser page was removed from your input. Only the latest ones are kept.)";
export const HANDS_ON_PIC_FOLLOWS = "\n(A screenshot of the page follows in the next message.)";

// The message that carries a screenshot, and the list of such messages the turn keeps. Adding one beyond the cap turns the oldest
// into a short text note, so context does not grow. Returns the messages that were dropped.
export const handsOnMessage = (part) => ({ role: "user", content: [{ type: "text", text: HANDS_ON_PIC_TEXT }, part] });
export function keepLatestPictures(list, msg, keep = HANDS_ON_KEEP) {
  list.push(msg); const dropped = [];
  while (list.length > Math.max(1, keep)) { const old = list.shift(); old.content = HANDS_ON_DROPPED_NOTE; dropped.push(old); }
  return dropped;
}
export const imageParts = (messages) => (messages || []).reduce((n, m) => n + (Array.isArray(m?.content) ? m.content.filter((p) => p?.type === "image_url").length : 0), 0);
