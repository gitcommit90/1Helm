import { api, type Message, type ThreadState } from "./api.ts";
import { h, icon, timeLabel } from "./dom.ts";
import { appAlert } from "./dialogs.ts";
import { formatBoardFollowupCountdown } from "./thread-formatters.ts";


export function openSessionComposer(channelId: number, onOpen: (root: Message) => void): void {
  const input = h("textarea", {
    class: "field min-h-32 resize-y", rows: 5,
    placeholder: "Describe the work you want to start…",
    "aria-label": "New session message",
  }) as HTMLTextAreaElement;
  const status = h("p", { class: "min-h-5 text-sm text-danger", role: "status" });
  const close = (): void => overlay.remove();
  const send = h("button", { class: "btn-primary min-h-11 px-4 text-sm", type: "button" }, icon("send", 15), "Send") as HTMLButtonElement;
  const submit = async (): Promise<void> => {
    const body = input.value.trim();
    if (!body) { status.textContent = "Write a message before starting a session."; input.focus(); return; }
    status.textContent = "";
    send.disabled = true; send.textContent = "Starting…";
    try {
      const result = await api<{ message: Message }>(`/api/channels/${channelId}/messages`, { body: { body } });
      close();
      onOpen(result.message);
    } catch (error) {
      status.textContent = (error as Error).message || "Could not start a session.";
      send.disabled = false; send.replaceChildren(icon("send", 15), "Send");
    }
  };
  send.onclick = () => { void submit(); };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { close(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
  });
  const overlay = h("div", {
    class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-6",
    onclick: (event: MouseEvent) => { if (event.target === overlay) close(); },
  },
  h("section", { class: "card mobile-sheet w-full max-w-lg overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl" },
    h("div", { class: "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6" },
      h("div", {}, h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, "Start a session"), h("p", { class: "mt-1.5 text-sm text-muted" }, "Your first message starts a focused session.")),
      h("button", { class: "grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover sm:h-8 sm:w-8", type: "button", "aria-label": "Close", onclick: close }, icon("x"))),
    h("div", { class: "space-y-3 p-4 sm:p-6" }, input, status),
    h("div", { class: "flex items-center justify-end gap-2 border-t border-line px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" },
      h("button", { class: "btn-ghost min-h-11 px-4 text-sm sm:min-h-0", type: "button", onclick: close }, "Cancel"), send)));
  document.body.append(overlay);
  input.focus();
}


/** Real countdown from durable followup.due_at (ms epoch). Updates in place once/sec. */
function followupCountdownEl(dueAt: number): HTMLElement {
  const el = h("span", {
    class: "board-countdown font-mono text-[11px] tabular-nums tracking-wide text-accent",
    dataset: { dueAt: String(dueAt) },
    title: `Wakes at ${new Date(dueAt).toLocaleString()}`,
  }, formatBoardFollowupCountdown(dueAt)) as HTMLElement;
  return el;
}
export function followupMeta(thread: ThreadState, opts?: { onBumped?: () => void; onCancelled?: () => void }): HTMLElement | null {
  const f = thread.followup;
  if (!f?.due_at) return null;
  const running = f.status === "running";
  const bump = h("button", {
    class: "board-check-now btn-ghost min-h-8 shrink-0 px-2 py-1 text-[11px] font-semibold",
    type: "button",
    title: "Drop countdown to zero and wake the agent now (same path as the timer)",
  }, "Check now") as HTMLButtonElement;
  bump.onclick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (bump.disabled) return;
    bump.disabled = true;
    bump.textContent = "Waking…";
    void api<{ ok: boolean; due_at?: number; error?: string }>(`/api/threads/${thread.id}/check-now`, { method: "POST", body: {} })
      .then(() => {
        // Countdown → due now immediately in the open Board DOM.
        const card = bump.closest(".board-card, article");
        for (const node of (card || document).querySelectorAll<HTMLElement>(".board-countdown[data-due-at]")) {
          node.dataset.dueAt = String(Date.now());
          node.textContent = "due now";
          node.classList.add("board-countdown-due");
        }
        bump.textContent = "Woke";
        opts?.onBumped?.();
      })
      .catch((error) => {
        bump.disabled = false;
        bump.textContent = "Check now";
        void appAlert((error as Error).message || "Could not wake the agent.");
      });
  };
  const cancel = h("button", {
    class: "board-cancel-followup btn-ghost min-h-8 shrink-0 px-1.5 py-1 text-[11px] font-semibold text-danger",
    type: "button",
    title: "Cancel only this scheduled wake",
    "aria-label": "Cancel follow-up",
  }, "Cancel") as HTMLButtonElement;
  cancel.onclick = (event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation(); if (cancel.disabled) return; cancel.disabled = true;
    void api<{ ok: boolean; followup: ThreadState["followup"] }>(`/api/threads/${thread.id}/followups/${f.id}/cancel`, { method: "POST", body: {} })
      .then((result) => { thread.followup = result.followup || null; opts?.onCancelled?.(); })
      .catch((error) => { cancel.disabled = false; void appAlert((error as Error).message || "Could not cancel the follow-up."); });
  };
  return h("div", {
    class: "board-followup mt-2.5 rounded-md border border-accent/25 bg-accent-soft/40 px-2 py-1.5",
    onclick: (event: MouseEvent) => event.stopPropagation(),
  },
    h("div", { class: "flex items-center justify-between gap-2" },
      h("span", { class: "font-mono text-[9px] uppercase tracking-[0.14em] text-muted" }, running ? "Checking now" : "Next check"),
      running ? h("span", { class: "font-mono text-[11px] text-accent" }, "working") : followupCountdownEl(Number(f.due_at))),
    f.reason
      ? h("div", { class: "mt-1 line-clamp-2 text-[11px] leading-4 text-muted" }, f.reason)
      : null,
    h("div", { class: "mt-1.5 flex flex-wrap items-center justify-between gap-2" },
      h("div", { class: "min-w-0 font-mono text-[9px] text-faint" }, `attempt ${Number(f.attempts || 0) + (running ? 0 : 1)}/${f.max_attempts || "?"} · #${f.id}`),
      h("div", { class: "flex items-center gap-1" }, cancel, running ? null : bump)),
  );
}
/** Tick all .board-countdown nodes under root once per second while Board is open. */
let boardCountdownTimer: number | null = null;
export function startBoardCountdownTicker(root: HTMLElement): void {
  if (boardCountdownTimer != null) {
    window.clearInterval(boardCountdownTimer);
    boardCountdownTimer = null;
  }
  const tick = (): void => {
    if (!root.isConnected) {
      if (boardCountdownTimer != null) window.clearInterval(boardCountdownTimer);
      boardCountdownTimer = null;
      return;
    }
    const nowMs = Date.now();
    for (const node of root.querySelectorAll<HTMLElement>(".board-countdown[data-due-at]")) {
      const due = Number(node.dataset.dueAt || 0);
      if (!due) continue;
      node.textContent = formatBoardFollowupCountdown(due, nowMs);
      node.classList.toggle("board-countdown-due", due <= nowMs);
    }
  };
  tick();
  boardCountdownTimer = window.setInterval(tick, 1000);
}

const SESSION_STATE_LABEL: Record<string, string> = {
  working: "Working", needs_you: "Needs you", scheduled: "Scheduled", failed: "Failed", complete: "Complete", idle: "Idle", archived: "Archived",
};
const SESSION_STATE_ORDER: Record<string, number> = { needs_you: 0, failed: 1, working: 2, scheduled: 3, idle: 4, complete: 5, archived: 6 };
export function sessionState(thread: ThreadState): string { return thread.operational_state || (thread.status === "resolved" ? "complete" : thread.status === "archived" ? "archived" : thread.status === "failed" ? "failed" : "idle"); }
function summaryField(summary: string, label: string): string {
  const match = String(summary || "").match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|$)`, "i"));
  return match ? match[1].replace(/[*_`#]/g, "").trim() : "";
}
function sessionCurrentLine(thread: ThreadState): string {
  return summaryField(thread.summary, "Latest outcome") || summaryField(thread.summary, "Goal") || "Session details are being prepared.";
}
export function boardSessionCard(thread: ThreadState, onOpen: (thread: ThreadState) => void, compact = false): HTMLElement {
  const state = sessionState(thread);
  const label = SESSION_STATE_LABEL[state] || "Idle";
  const current = sessionCurrentLine(thread);
  return h("article", { class: `session-card session-card-${state}${compact ? " session-card-compact" : ""}`, dataset: { sessionState: state } },
    h("button", { class: "session-card-open", type: "button", dataset: { threadOpen: String(thread.id), continuityKey: `session-thread-${thread.id}` }, onclick: () => onOpen(thread) },
      h("div", { class: "session-card-heading" },
        h("span", { class: `session-state-mark session-state-mark-${state}`, title: label }),
        h("span", { class: "min-w-0 flex-1 truncate font-semibold text-fg" }, thread.title || "Untitled session"),
        h("span", { class: `session-state-label session-state-label-${state}` }, label)),
      compact ? null : h("p", { class: "mt-1 line-clamp-2 text-[13px] leading-5 text-muted" }, current),
      h("div", { class: "mt-2 flex items-center justify-between gap-2 text-[11px] text-faint" },
        h("span", {}, `Updated ${timeLabel(thread.updated_at)}`),
        thread.followup?.status === "pending" ? followupCountdownEl(Number(thread.followup.due_at)) : null)),
    thread.followup && ["pending", "running"].includes(thread.followup.status) ? followupMeta(thread) : null);
}
