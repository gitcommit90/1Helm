import { api, downloadAuthenticatedFile, openAuthenticatedFile, uploadFileWithProgress, groupRoutingModels, routingModelGroupKey, type ActivityItem, type AgentTemplate, type Channel, type ChannelFile, type GlobalThread, type MemoryItem, type Message, type TextConversation, type ThreadState, type RoutingModel } from "./api.ts";
import { h, clear, icon, md, timeLabel } from "./dom.ts";
import { S } from "./state.ts";
import { avatar } from "./avatar-ui.ts";
import { appAlert, appConfirm, appPrompt } from "./dialogs.ts";
import { NOTIFICATION_SOUNDS, channelNotificationPreference, previewNotification, setChannelNotificationPreference } from "./notifications.ts";
import { channelTextingSettings, skipperCallSettings } from "./workflows.ts";
import { authenticatedAssetSrc } from "./avatar-assets.ts";
import { bindResidentFileUploads } from "./file-uploads.ts";
export type ChannelView = "chat" | "texts" | "board" | "workflows" | "threads" | "cowork" | "notes" | "files" | "terminal" | "memory" | "activity" | "settings";
type RenderRefreshOptions = { preserveExisting?: boolean; isCurrent?: () => boolean; onPaint?: () => void };
function refreshIsCurrent(options: RenderRefreshOptions): boolean {
  return options.isCurrent?.() !== false;
}
export function openCreateChannel(onCreated: (channel: Channel) => void): void {
  const name = h("input", { class: "field", placeholder: "launch", autocomplete: "off" }) as HTMLInputElement;
  const purpose = h("textarea", { class: "field min-h-28", placeholder: "This channel owns planning and coordinating the product launch." }) as HTMLTextAreaElement;
  const status = h("div", { class: "min-h-5 text-sm text-danger" });
  const templates = h("div", { class: "grid gap-2 sm:grid-cols-2" });
  let selectedTemplate = "general";
  const submit = h("button", { class: "btn-primary px-4 py-2" }, "Create channel") as HTMLButtonElement;
  const close = (): void => overlay.remove();
  const create = async (): Promise<void> => {
    status.textContent = "";
      submit.disabled = true; submit.textContent = "Preparing agent and private computer…";
    try {
      const result = await api<{ channel: Channel; computer_ready?: boolean }>("/api/channels", { body: { name: name.value, purpose: purpose.value, template: selectedTemplate } });
      close(); onCreated(result.channel);
    } catch (error) {
      status.textContent = (error as Error).message;
      submit.disabled = false; submit.textContent = "Create channel";
    }
  };
  submit.onclick = () => { void create(); };
  purpose.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void create(); });
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-6", onclick: (event: MouseEvent) => { if (event.target === overlay) close(); } },
    h("section", { class: "card mobile-sheet w-full max-w-lg overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl" },
      h("div", { class: "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6" },
        h("div", {}, h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, "Create an agent channel"), h("p", { class: "mt-1.5 text-sm text-muted" }, "It comes with one resident agent, its own private Linux computer, files, threads, and memory. Skipper handles the infrastructure.")),
        h("button", { class: "grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover sm:h-8 sm:w-8", "aria-label": "Close", onclick: close }, icon("x"))),
      h("div", { class: "max-h-[70dvh] space-y-4 overflow-y-auto p-4 sm:p-6" },
        h("div", {}, h("span", { class: "eyebrow mb-2 block text-muted" }, "Start from a lightweight role"), templates, h("span", { class: "mt-1 block text-xs text-muted" }, "Templates are only a starting kit. The agent keeps learning, gaining skills, and growing with this channel.")),
        h("label", { class: "block" }, h("span", { class: "eyebrow mb-2 block text-muted" }, "Channel name"), name),
        h("label", { class: "block" }, h("span", { class: "mb-1 block text-sm font-semibold text-fg" }, "What is this channel all about?"), purpose, h("span", { class: "mt-1 block text-xs text-muted" }, "This becomes the resident agent's durable purpose and operating context.")),
        status),
      h("div", { class: "flex items-center justify-end gap-2 border-t border-line px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" }, h("button", { class: "btn-ghost min-h-11 sm:min-h-0", onclick: close }, "Cancel"), submit)));
  document.body.append(overlay);
  void api<{ templates: AgentTemplate[] }>("/api/agent-templates").then(({ templates: options }) => {
    const draw = (): void => {
      clear(templates);
      for (const template of options) templates.append(h("button", { class: `rounded-lg border p-3 text-left transition ${selectedTemplate === template.slug ? "border-accent bg-accent-soft" : "border-line bg-raised hover:border-accent/40"}`, type: "button", dataset: { template: template.slug }, onclick: () => { selectedTemplate = template.slug; if (!purpose.value.trim()) purpose.placeholder = template.purpose_hint; draw(); } },
        h("div", { class: "font-semibold text-fg" }, template.name), h("div", { class: "mt-1 text-xs leading-5 text-muted" }, template.description)));
    };
    draw();
  });
  name.focus();
}

function statusPath(status: string, updatedAt: number): HTMLElement {
  const steps = ["open", "waiting", "resolved"];
  const idx = steps.indexOf(status);
  const isFailed = status === "failed";
  const isArchived = status === "archived";
  const isActive = !isFailed && !isArchived && Date.now() - updatedAt < 5 * 60 * 1000;
  const stepEl = (label: string, active: boolean, current: boolean, pulse: boolean) =>
    h("div", { class: "flex items-center gap-1.5" },
      h("span", { class: `h-2 w-2 rounded-full ${active ? (pulse ? "animate-pulse bg-amber-400" : "bg-ok") : "bg-line"}` }),
      h("span", { class: `font-mono text-[10px] uppercase tracking-[0.12em] ${current ? "text-fg" : "text-faint"}` }, label));
  const connector = (active: boolean) => h("div", { class: `h-px w-6 ${active ? "bg-ok" : "bg-line"}` });
  const parts: HTMLElement[] = [];
  for (let i = 0; i < steps.length; i++) {
    const active = i <= idx;
    const current = i === idx;
    parts.push(stepEl(steps[i], active, current, current && isActive));
    if (i < steps.length - 1) parts.push(connector(i < idx));
  }
  if (isFailed) parts.push(h("span", { class: "chip border-danger/30 bg-danger/10 text-danger text-xs" }, "failed"));
  if (isArchived) parts.push(h("span", { class: "chip border-line text-muted text-xs" }, "archived"));
  return h("div", { class: "flex flex-wrap items-center gap-1.5" }, ...parts);
}

/** Real countdown from durable followup.due_at (ms epoch). Updates in place once/sec. */
function formatCountdown(dueAt: number, nowMs = Date.now()): string {
  const remaining = Math.max(0, Math.floor((dueAt - nowMs) / 1000));
  if (remaining <= 0) return "due now";
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function followupCountdownEl(dueAt: number): HTMLElement {
  const el = h("span", {
    class: "board-countdown font-mono text-[11px] tabular-nums tracking-wide text-accent",
    dataset: { dueAt: String(dueAt) },
    title: `Wakes at ${new Date(dueAt).toLocaleString()}`,
  }, formatCountdown(dueAt)) as HTMLElement;
  return el;
}

function followupMeta(thread: ThreadState, opts?: { onBumped?: () => void }): HTMLElement | null {
  const f = thread.followup;
  if (!f?.due_at) return null;
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
  return h("div", {
    class: "board-followup mt-2.5 rounded-md border border-accent/25 bg-accent-soft/40 px-2 py-1.5",
    onclick: (event: MouseEvent) => event.stopPropagation(),
  },
    h("div", { class: "flex items-center justify-between gap-2" },
      h("span", { class: "font-mono text-[9px] uppercase tracking-[0.14em] text-muted" }, "Next check"),
      followupCountdownEl(Number(f.due_at))),
    f.reason
      ? h("div", { class: "mt-1 line-clamp-2 text-[11px] leading-4 text-muted" }, f.reason)
      : null,
    h("div", { class: "mt-1.5 flex items-center justify-between gap-2" },
      h("div", { class: "font-mono text-[9px] text-faint" }, `attempt ${Number(f.attempts || 0) + 1}/${f.max_attempts || "?"} · #${f.id}`),
      bump),
  );
}

/** Tick all .board-countdown nodes under root once per second while Board is open. */
let boardCountdownTimer: number | null = null;
function startBoardCountdownTicker(root: HTMLElement): void {
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
      node.textContent = formatCountdown(due, nowMs);
      node.classList.toggle("board-countdown-due", due <= nowMs);
    }
  };
  tick();
  boardCountdownTimer = window.setInterval(tick, 1000);
}

export function renderThreads(container: HTMLElement, channelId: number, onOpen: (thread: ThreadState) => void, refresh: RenderRefreshOptions = {}): void {
  if (!refresh.preserveExisting) panelLoading(container, "Threads", "Focused sessions with durable status and rolling summaries.");
  void api<{ threads: ThreadState[] }>(`/api/channels/${channelId}/threads`).then(({ threads }) => {
    if (!refreshIsCurrent(refresh)) return;
    const list = h("div", { class: "space-y-2" });
    if (!threads.length) list.append(empty("No sessions yet", "Start a top-level message in Chat to open a focused session."));
    for (const thread of threads) {
      list.append(h("article", { class: "card flex w-full min-w-0 items-start gap-2.5 p-3" },
        h("span", { class: "mt-0.5 shrink-0 text-accent" }, icon("thread")),
        h("button", { class: "min-w-0 flex-1 text-left", type: "button", dataset: { threadOpen: String(thread.id), continuityKey: `channel-thread-${thread.id}` }, onclick: () => onOpen(thread) },
          h("div", { class: "truncate font-semibold text-fg hover:text-accent" }, thread.title),
          h("div", { class: "md mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted", html: md(thread.summary || "No summary yet.") }),
          followupMeta(thread),
          h("div", { class: "mt-2 flex items-center gap-2 text-xs text-faint" }, statusPath(thread.status, thread.updated_at), h("span", {}, `· Updated ${timeLabel(thread.updated_at)}`)))));
    }
    panelContent(container, "Threads", "Focused sessions with durable status and rolling summaries.", list);
    startBoardCountdownTicker(list);
    refresh.onPaint?.();
  }).catch((error) => { if (refreshIsCurrent(refresh)) panelError(container, error); });
}

/**
 * A read-only re-presentation of channel threads. Thread status is owned by
 * the existing agent/system flow; the board deliberately contains no move or
 * status controls.
 *
 * Full-bleed inside #channelview (not the max-w-5xl document panels) so lanes
 * use the whole Board tab height/width.
 *
 * **Scheduled** is not a human-editable status — it is derived from durable
 * `agent_followups` rows (next pending due_at). Cards with a pending wake sit
 * only in Scheduled so the Captain can see the real countdown.
 */
export function renderBoard(container: HTMLElement, channelId: number, onOpen: (root: Message) => void, refresh: RenderRefreshOptions = {}): void {
  if (!refresh.preserveExisting) {
    clear(container);
    container.append(h("div", { class: "board-shell" },
      h("div", { class: "board-header" },
        h("div", { class: "min-w-0" },
          h("h2", { class: "font-display text-xl leading-tight text-fg sm:text-[1.45rem]" }, "Board"),
          h("p", { class: "mt-0.5 text-xs text-muted sm:text-sm" }, "Sessions by status. Scheduled = durable agent wake with live countdown.")),
        h("span", { class: "board-header-hint" }, "Loading…"))));
  }

  void api<{ threads: ThreadState[] }>(`/api/channels/${channelId}/threads`).then(({ threads }) => {
    if (!refreshIsCurrent(refresh)) return;
    const statuses: { status: ThreadState["status"]; label: string }[] = [
      { status: "open", label: "Open" },
      { status: "waiting", label: "Waiting" },
      { status: "resolved", label: "Resolved" },
      { status: "failed", label: "Failed" },
      { status: "archived", label: "Archived" },
    ];
    const hasPendingFollowup = (thread: ThreadState): boolean =>
      Boolean(thread.followup && thread.followup.status === "pending" && Number(thread.followup.due_at) > 0);

    const scheduled = threads
      .filter(hasPendingFollowup)
      .slice()
      .sort((a, b) => Number(a.followup!.due_at) - Number(b.followup!.due_at));

    const grouped = new Map<ThreadState["status"], ThreadState[]>();
    for (const { status } of statuses) grouped.set(status, []);
    for (const thread of threads.slice().sort((a, b) => b.updated_at - a.updated_at)) {
      // Exclusive: pending wakes live only in Scheduled (not also Open/Waiting).
      if (hasPendingFollowup(thread)) continue;
      grouped.get(thread.status)?.push(thread);
    }

    const threadCard = (thread: ThreadState): HTMLElement => h("button", {
      class: `board-card${hasPendingFollowup(thread) ? " board-card-scheduled" : ""}`,
      type: "button",
      dataset: { threadOpen: String(thread.id), continuityKey: `board-thread-${thread.id}` },
      onclick: () => onOpen(thread.root),
    },
    h("div", { class: "truncate text-[13px] font-semibold leading-snug text-fg" }, thread.title || "Untitled session"),
    h("div", { class: "md mt-1 line-clamp-2 text-[13px] leading-snug text-muted", html: md(thread.summary || "No summary yet.") }),
    followupMeta(thread),
    h("div", { class: "mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint" },
      statusPath(thread.status, thread.updated_at),
      h("span", {}, `· Updated ${timeLabel(thread.updated_at)}`)));

    const incoming = h("section", { class: "board-lane board-lane-incoming" },
      h("div", { class: "board-lane-heading" },
        h("div", { class: "min-w-0" }, h("h3", { class: "font-semibold text-fg" }, "Incoming"), h("p", { class: "mt-0.5 text-[11px] text-muted" }, "Compose only")),
        h("span", { class: "font-mono text-[10px] text-faint" }, "—")),
      h("div", { class: "board-lane-incoming-body" },
        h("p", { class: "text-sm leading-5 text-muted" }, "Start work here. Sending creates an Open session."),
        h("button", { class: "btn-primary min-h-11 w-full px-4 text-sm", type: "button", onclick: () => openBoardComposer(channelId, onOpen) }, icon("plus", 16), "New")));

    const scheduledLane = h("section", { class: "board-lane board-lane-scheduled", dataset: { boardStatus: "scheduled" } },
      h("div", { class: "board-lane-heading" },
        h("div", { class: "min-w-0" },
          h("h3", { class: "font-semibold text-fg" }, "Scheduled"),
          h("p", { class: "mt-0.5 text-[11px] text-muted" }, "Agent wake · live countdown")),
        h("span", { class: "font-mono text-[10px] text-faint" }, String(scheduled.length))),
      h("div", { class: "board-lane-cards", dataset: { continuityKey: "board-lane-scheduled" } }, ...scheduled.map(threadCard),
        scheduled.length ? null : h("p", { class: "px-1 py-6 text-center text-xs leading-5 text-faint" }, "No scheduled wakes")));

    const lanes = statuses.map(({ status, label }) => {
      const laneThreads = grouped.get(status) || [];
      return h("section", { class: `board-lane board-lane-${status}`, dataset: { boardStatus: status } },
        h("div", { class: "board-lane-heading" },
          h("h3", { class: "font-semibold text-fg" }, label),
          h("span", { class: "font-mono text-[10px] text-faint" }, String(laneThreads.length))),
        h("div", { class: "board-lane-cards", dataset: { continuityKey: `board-lane-${status}` } }, ...laneThreads.map(threadCard),
          laneThreads.length ? null : h("p", { class: "px-1 py-6 text-center text-xs leading-5 text-faint" }, "No sessions")));
    });

    clear(container);
    const shell = h("div", { class: "board-shell" },
      h("div", { class: "board-header" },
        h("div", { class: "min-w-0" },
          h("h2", { class: "font-display text-xl leading-tight text-fg sm:text-[1.45rem]" }, "Board"),
          h("p", { class: "mt-0.5 text-xs text-muted sm:text-sm" }, "Sessions by status. Scheduled = durable agent wake with live countdown.")),
        h("span", { class: "board-header-hint" }, `${threads.length} session${threads.length === 1 ? "" : "s"}${scheduled.length ? ` · ${scheduled.length} scheduled` : ""}`)),
      h("div", { class: "board-scroll" }, h("div", { class: "board-lanes" }, incoming, scheduledLane, ...lanes)));
    container.append(shell);
    startBoardCountdownTicker(shell);
    refresh.onPaint?.();
  }).catch((error) => { if (refreshIsCurrent(refresh)) panelError(container, error); });
}

function openBoardComposer(channelId: number, onOpen: (root: Message) => void): void {
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
      h("div", {}, h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, "Start a session"), h("p", { class: "mt-1.5 text-sm text-muted" }, "Your first message opens a new thread in the Open lane.")),
      h("button", { class: "grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover sm:h-8 sm:w-8", type: "button", "aria-label": "Close", onclick: close }, icon("x"))),
    h("div", { class: "space-y-3 p-4 sm:p-6" }, input, status),
    h("div", { class: "flex items-center justify-end gap-2 border-t border-line px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" },
      h("button", { class: "btn-ghost min-h-11 px-4 text-sm sm:min-h-0", type: "button", onclick: close }, "Cancel"), send)));
  document.body.append(overlay);
  input.focus();
}

/** Workspace-wide threads inbox (sidebar Threads control). */
export function renderGlobalThreads(
  container: HTMLElement,
  opts: { unreadOnly: boolean; onToggleUnread: (next: boolean) => void; onOpen: (thread: GlobalThread) => void },
  refresh: RenderRefreshOptions = {},
): void {
  if (!refresh.preserveExisting) panelLoading(container, "Threads", "Sessions across every agent channel. Filter to only unread activity.");
  const path = opts.unreadOnly ? "/api/threads?unread=1" : "/api/threads";
  void api<{ threads: GlobalThread[] }>(path).then(({ threads }) => {
    if (!refreshIsCurrent(refresh)) return;
    const toolbar = h("div", { class: "mb-2" },
      h("p", { class: "text-xs text-muted" }, opts.unreadOnly ? "Unread activity across your channels." : `${threads.length} session${threads.length === 1 ? "" : "s"} · newest first`));
    const list = h("div", { class: "overflow-hidden rounded-lg border border-line bg-surface", dataset: { globalThreadsList: "compact" } });
    if (!threads.length) {
      list.append(empty(
        opts.unreadOnly ? "No unread threads" : "No sessions yet",
        opts.unreadOnly ? "Catch up is clear. Turn off the Unread filter to browse everything." : "Start a top-level message in any agent channel to open a focused session.",
      ));
    }
    for (const thread of threads) {
      list.append(h("article", { class: `border-b border-line last:border-0 ${thread.unread ? "bg-accent-soft/30" : "hover:bg-hover"}` },
        h("button", {
          class: "flex w-full min-w-0 items-start gap-2.5 px-3 py-2 text-left", type: "button",
          dataset: { globalThreadOpen: String(thread.id), continuityKey: `global-thread-${thread.id}` },
          onclick: () => opts.onOpen(thread),
        },
          h("span", { class: `mt-1.5 h-2 w-2 shrink-0 rounded-full ${thread.unread ? "bg-danger" : "bg-line"}`, "aria-label": thread.unread ? "Unread" : undefined }),
          h("span", { class: "min-w-0 flex-1" },
            h("span", { class: "flex min-w-0 items-baseline gap-2" },
              h("span", { class: `truncate text-sm text-fg ${thread.unread ? "font-bold" : "font-semibold"}` }, thread.title || "Untitled session"),
              h("span", { class: "shrink-0 font-mono text-[11px] text-accent" }, `#${thread.channel_name}`),
              h("span", { class: "ml-auto shrink-0 text-[11px] text-faint" }, timeLabel(thread.updated_at))),
            h("span", { class: "mt-0.5 flex min-w-0 items-center gap-2" },
              h("div", { class: "md min-w-0 flex-1 truncate text-xs text-muted", html: md(thread.summary || "No summary yet.") }),
              h("span", { class: "shrink-0 rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-faint" }, thread.status))))));
    }
    clear(container);
    container.append(h("div", { class: "mx-auto w-full max-w-5xl p-6" },
      h("div", { class: "mb-2" },
        h("h2", { class: "font-display text-[1.75rem] leading-tight text-fg" }, "Threads"),
        h("p", { class: "mt-1.5 text-sm text-muted" }, "Sessions across every agent channel. Filter to only unread activity.")),
      toolbar, list));
    refresh.onPaint?.();
  }).catch((error) => { if (refreshIsCurrent(refresh)) panelError(container, error); });
}

/** Private Captain ↔ Skipper conversations originated through Photon. */
export function renderTexts(container: HTMLElement, selectedId?: number, onSelect?: (id: number) => void, refresh: RenderRefreshOptions = {}): void {
  if (!refresh.preserveExisting) panelLoading(container, "Texts", "Your direct, channel-free conversations with Skipper.");
  void api<{ conversations: TextConversation[] }>("/api/texts").then(async ({ conversations }) => {
    if (!refreshIsCurrent(refresh)) return;
    const selected = conversations.find((conversation) => conversation.id === selectedId) || conversations[0];
    const sidebar = h("aside", { class: "min-h-0 overflow-y-auto border-b border-line bg-raised/55 md:border-b-0 md:border-r", dataset: { continuityKey: "texts-conversations" } });
    sidebar.append(h("div", { class: "border-b border-line px-4 py-3" }, h("div", { class: "eyebrow text-muted" }, "Conversations"), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, "Send /new from your phone to start another.")));
    const list = h("div", { class: "p-2", dataset: { textsThreadList: "" } });
    if (!conversations.length) list.append(empty("No text threads yet", "Text your 1Helm number. Your first message starts a private conversation with Skipper."));
    for (const conversation of conversations) list.append(h("button", {
      class: `mb-1 block w-full rounded-lg border px-3 py-2.5 text-left ${selected?.id === conversation.id ? "border-accent/30 bg-accent-soft" : "border-transparent hover:border-line hover:bg-hover"}`,
      type: "button", dataset: { textConversation: String(conversation.id) }, onclick: () => onSelect?.(conversation.id),
    }, h("span", { class: "flex items-center gap-2" }, h("span", { class: "min-w-0 flex-1 truncate text-sm font-semibold text-fg" }, conversation.title || "Text with Skipper"), conversation.active ? h("span", { class: "h-1.5 w-1.5 rounded-full bg-ok", title: "Current thread" }) : null),
    h("span", { class: "mt-1 block truncate text-xs text-muted" }, conversation.last_body || conversation.summary || "Conversation"),
    h("span", { class: "mt-1 block font-mono text-[10px] text-faint" }, `${conversation.message_count || 0} messages · ${timeLabel(conversation.updated)}`)));
    sidebar.append(list);
    const conversationPanel = h("section", { class: "flex min-h-0 min-w-0 flex-col bg-surface" });
    if (!selected) {
      conversationPanel.append(h("div", { class: "grid min-h-[24rem] flex-1 place-items-center p-8 text-center" }, h("div", {}, h("div", { class: "text-accent" }, icon("chat", 28)), h("h3", { class: "mt-3 font-display text-xl text-fg" }, "Text Skipper to begin"), h("p", { class: "mt-2 max-w-sm text-sm leading-6 text-muted" }, "Once Photon receives your message, this inbox appears automatically and keeps the conversation available on desktop."))));
    } else {
      const detail = await api<{ conversation: TextConversation }>(`/api/texts/${selected.id}`);
      if (!refreshIsCurrent(refresh)) return;
      const messages = detail.conversation.messages || [];
      const stream = h("div", { class: "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6", dataset: { textsMessages: String(selected.id), continuityKey: `texts-messages-${selected.id}` } });
      for (const message of messages) {
        const captain = message.author.kind === "user" || message.transport === "inbound";
        stream.append(h("div", { class: `flex ${captain ? "justify-end" : "justify-start"}` },
          h("article", { class: `max-w-[min(88%,44rem)] rounded-xl border px-3.5 py-2.5 ${captain ? "border-accent/25 bg-accent-soft" : "border-line bg-raised/60"}` },
            h("div", { class: "mb-1 flex items-center gap-2 font-mono text-[10px] text-faint" }, h("span", { class: "font-semibold text-muted" }, captain ? "You" : "Skipper"), h("span", {}, "·"), h("span", {}, message.transport === "inbound" ? "Phone" : message.transport === "outbound" ? "iMessage reply" : "1Helm"), h("span", {}, "·"), h("span", {}, timeLabel(message.created))),
            h("div", { class: "md text-sm leading-6 text-fg", html: md(message.body) }))));
      }
      const input = h("textarea", { class: "max-h-40 min-h-12 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-fg outline-none placeholder:text-faint", rows: 2, placeholder: "Continue with Skipper in 1Helm…", dataset: { textsComposer: String(selected.id) } }) as HTMLTextAreaElement;
      const status = h("span", { class: "text-xs text-muted", role: "status" });
      const send = h("button", { class: "btn-primary shrink-0", type: "button" }, "Send") as HTMLButtonElement;
      const submit = async (): Promise<void> => {
        const body = input.value.trim(); if (!body || send.disabled) return;
        send.disabled = true; input.disabled = true; status.textContent = "Sending to Skipper…";
        try { await api(`/api/texts/${selected.id}`, { body: { body } }); input.value = ""; onSelect?.(selected.id); }
        catch (error) { status.textContent = (error as Error).message; send.disabled = false; input.disabled = false; input.focus(); }
      };
      send.onclick = () => { void submit(); };
      input.onkeydown = (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } };
      conversationPanel.append(h("div", { class: "flex min-h-14 items-center gap-3 border-b border-line px-4 py-3" }, h("span", { class: "text-accent" }, icon("chat", 18)), h("div", { class: "min-w-0" }, h("h3", { class: "truncate font-semibold text-fg" }, selected.title || "Text with Skipper"), h("p", { class: "truncate text-xs text-muted" }, selected.active ? "Current thread · phone and desktop share context" : "Closed with /new · still resumable in 1Helm"))), stream,
        h("div", { class: "border-t border-line bg-surface p-3 sm:p-4" }, h("div", { class: "mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-raised/45 p-2.5 focus-within:border-accent/50" }, input, send), h("div", { class: "mx-auto mt-1.5 flex max-w-3xl justify-between px-1" }, h("span", { class: "text-[11px] text-faint" }, "Desktop messages stay in 1Helm; return to your phone anytime."), status)));
      if (!refresh.preserveExisting) requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
    }
    clear(container);
    container.append(h("div", { class: "flex h-full min-h-0 flex-col" }, h("header", { class: "border-b border-line px-4 py-3" }, h("h2", { class: "font-display text-xl text-fg" }, "Texts"), h("p", { class: "mt-0.5 text-xs text-muted" }, "One continuous thread with Skipper until you send /new.")), h("div", { class: "grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]" }, sidebar, conversationPanel)));
    refresh.onPaint?.();
  }).catch((error) => { if (refreshIsCurrent(refresh)) panelError(container, error); });
}

function workspaceIcon(file: ChannelFile, size = 18): SVGElement {
  if (file.kind === "directory") return icon("folder", size);
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return icon("image", size);
  if (["js", "jsx", "ts", "tsx", "html", "css", "json", "yaml", "yml", "py", "rb", "go", "rs", "sh", "sql"].includes(ext)) return icon("code", size);
  if (["excalidraw", "whiteboard"].includes(ext)) return icon("board", size);
  if (["deck", "slides", "ppt", "pptx"].includes(ext)) return icon("presentation", size);
  return icon("fileText", size);
}

function coworkPath(path: string): { section: "notes" | "whiteboards" | "code" | "docs" | "presentations"; path: string } | null {
  const section = path.split("/")[0] as "notes" | "whiteboards" | "code" | "docs" | "presentations";
  return ["notes", "whiteboards", "code", "docs", "presentations"].includes(section) ? { section, path } : null;
}

type FileBrowserSurface = { node: HTMLElement; reload: () => Promise<void> };
const fileBrowserSurfaces = new Map<number, FileBrowserSurface>();
const CORE_WORKSPACE_FOLDERS = ["notes", "whiteboards", "code", "docs", "presentations"] as const;

/** Traditional two-pane browser over the channel's one authoritative /workspace. */
export function renderFiles(container: HTMLElement, channelId: number, initialPath = "", onOpenCowork?: (path: string) => void, preserveExisting = false): void {
  const cached = fileBrowserSurfaces.get(channelId);
  if (cached) {
    clear(container); container.append(cached.node);
    if (!preserveExisting) void cached.reload();
    return;
  }
  let currentPath = initialPath.replace(/^\/?workspace\/?/, "").replace(/^\/+|\/+$/g, "");
  let selected: ChannelFile | null = null;
  let filter = "";
  let sort: "name" | "modified" | "size" = "name";
  const root = h("section", { class: "file-browser flex h-full min-h-[32rem] flex-col bg-surface", dataset: { fileBrowser: String(channelId) } });
  const heading = h("span", { class: "truncate font-semibold text-fg" }, "/workspace");
  const status = h("span", { class: "min-h-5 min-w-0 flex-1 truncate text-xs text-muted", role: "status" });
  const search = h("input", { class: "field h-9 min-w-0 text-xs", type: "search", placeholder: "Search this folder", "aria-label": "Search current folder" }) as HTMLInputElement;
  const tree = h("div", { class: "min-h-0 flex-1 overflow-y-auto p-2", dataset: { fileFolderTree: "" } });
  const main = h("div", { class: "min-h-0 flex-1 overflow-y-auto", dataset: { fileDirectory: "" } });
  const info = h("aside", { class: "hidden min-h-0 w-60 shrink-0 overflow-y-auto border-l border-line bg-raised/35 p-4 xl:block", dataset: { fileMetadata: "" } });
  const crumbs = h("nav", { class: "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-xs", "aria-label": "File breadcrumbs", dataset: { fileBreadcrumbs: "" } });
  const fileInput = h("input", { type: "file", multiple: true, class: "hidden" }) as HTMLInputElement;
  let directoryCache: ChannelFile[] | null = null;
  let rootEntries: ChannelFile[] = [];
  let otherExpanded = false;
  let mirrorRefresh: Promise<void> | null = null;
  const open = (entry: ChannelFile): void => {
    if (entry.kind === "directory") { currentPath = entry.path; selected = null; void load(); return; }
    const target = coworkPath(entry.path);
    if (target && onOpenCowork) { onOpenCowork(entry.path); return; }
    void openAuthenticatedFile(`/api/channels/${channelId}/files/content?path=${encodeURIComponent(entry.path)}`).catch((error) => appAlert((error as Error).message));
  };
  const mutate = async (action: "rename" | "move" | "duplicate" | "delete"): Promise<void> => {
    if (!selected) return;
    try {
      if (action === "rename") {
        const name = await appPrompt(`Rename ${selected.kind === "directory" ? "folder" : "file"}`, selected.name);
        if (!name || name === selected.name) return;
        await api(`/api/channels/${channelId}/files/entries`, { method: "PATCH", body: { path: selected.path, name } });
      } else if (action === "move") {
        const parent = await appPrompt("Move to folder inside /workspace (leave empty for the top level)", selected.path.split("/").slice(0, -1).join("/"));
        if (parent == null) return;
        await api(`/api/channels/${channelId}/files/entries`, { method: "PATCH", body: { path: selected.path, parent } });
      } else if (action === "duplicate") {
        await api(`/api/channels/${channelId}/files/duplicate`, { body: { path: selected.path } });
      } else {
        if (!(await appConfirm(`Delete “${selected.name}”${selected.kind === "directory" ? " and everything inside it" : ""}? This cannot be undone.`))) return;
        await api(`/api/channels/${channelId}/files/entries`, { method: "DELETE", body: { path: selected.path } });
      }
      selected = null; status.textContent = ""; await load();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  const drawTree = (directories: ChannelFile[]): void => {
    clear(tree);
    const core = new Set<string>(CORE_WORKSPACE_FOLDERS);
    const rootName = (path: string): string => path.split("/")[0] || "";
    const appendDirectory = (directory: ChannelFile, depth: number, group: "workspace" | "core" | "other"): void => {
      tree.append(h("button", {
        class: `mb-0.5 flex min-h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-xs ${currentPath === directory.path ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover hover:text-fg"}`,
        style: `padding-left:${8 + depth * 14}px`, type: "button", dataset: { fileTreePath: directory.path || "/", fileTreeGroup: group },
        onclick: () => { currentPath = directory.path; selected = null; void load(); },
      }, h("span", { class: currentPath === directory.path ? "text-accent" : "text-faint" }, icon(currentPath === directory.path ? "folderOpen" : "folder", 15)), h("span", { class: "truncate" }, directory.name)));
    };
    appendDirectory({ path: "", name: "workspace", size: 0, modified: 0, kind: "directory" }, 0, "workspace");
    for (const folder of CORE_WORKSPACE_FOLDERS) {
      const entry = directories.find((directory) => directory.path === folder)
        || { path: folder, name: folder, size: 0, modified: 0, kind: "directory" as const };
      appendDirectory(entry, 1, "core");
    }
    for (const folder of CORE_WORKSPACE_FOLDERS) {
      for (const child of directories.filter((directory) => directory.path.startsWith(`${folder}/`))) {
        appendDirectory(child, child.path.split("/").length, "core");
      }
    }
    const otherDirectories = directories.filter((directory) => !core.has(rootName(directory.path)));
    const otherRootFiles = rootEntries.filter((entry) => entry.kind === "file" && !core.has(rootName(entry.path)));
    const otherActive = Boolean(currentPath && !core.has(rootName(currentPath)));
    if (otherActive) otherExpanded = true;
    tree.append(h("button", {
      class: `mb-0.5 mt-2 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs ${otherActive ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover hover:text-fg"}`,
      type: "button", dataset: { fileOtherToggle: "" }, "aria-expanded": String(otherExpanded),
      onclick: () => { otherExpanded = !otherExpanded; drawTree(directories); },
    }, h("span", { class: `text-[10px] transition-transform ${otherExpanded ? "rotate-90" : ""}` }, "›"), h("span", { class: "text-faint" }, icon(otherExpanded ? "folderOpen" : "folder", 15)), h("span", { class: "truncate font-medium" }, "Other")));
    if (!otherExpanded) return;
    for (const directory of otherDirectories) appendDirectory(directory, directory.path.split("/").length, "other");
    for (const file of otherRootFiles) {
      tree.append(h("button", {
        class: `mb-0.5 flex min-h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-xs ${selected?.path === file.path ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover hover:text-fg"}`,
        style: "padding-left:22px", type: "button", dataset: { fileTreePath: file.path, fileTreeGroup: "other" },
        onclick: () => { selected = file; redrawSelection(); }, ondblclick: () => open(file),
      }, h("span", { class: "text-faint" }, workspaceIcon(file, 15)), h("span", { class: "truncate" }, file.name)));
    }
    if (!otherDirectories.length && !otherRootFiles.length) tree.append(h("p", { class: "px-6 py-2 text-[11px] text-faint", dataset: { fileOtherEmpty: "" } }, "No other files"));
  };
  const drawInfo = (): void => {
    clear(info);
    if (!selected) { info.append(h("div", { class: "grid h-full place-items-center text-center text-xs leading-5 text-faint" }, "Select an item to see details and actions.")); return; }
    info.append(h("div", { class: "mx-auto grid h-14 w-14 place-items-center rounded-xl bg-accent-soft text-accent" }, workspaceIcon(selected, 28)),
      h("h3", { class: "mt-3 break-words text-sm font-semibold text-fg" }, selected.name),
      h("dl", { class: "mt-4 space-y-3 text-xs" },
        h("div", {}, h("dt", { class: "text-faint" }, "Kind"), h("dd", { class: "mt-0.5 text-muted" }, selected.kind === "directory" ? "Folder" : "File")),
        h("div", {}, h("dt", { class: "text-faint" }, "Location"), h("dd", { class: "mt-0.5 break-all font-mono text-muted" }, `/workspace/${selected.path}`)),
        h("div", {}, h("dt", { class: "text-faint" }, "Size"), h("dd", { class: "mt-0.5 text-muted" }, selected.kind === "directory" ? "—" : formatBytes(selected.size))),
        h("div", {}, h("dt", { class: "text-faint" }, "Modified"), h("dd", { class: "mt-0.5 text-muted" }, timeLabel(selected.modified)))),
      h("div", { class: "mt-5 grid gap-2" },
        h("button", { class: "btn-primary text-xs", type: "button", onclick: () => open(selected!) }, selected.kind === "directory" ? "Open folder" : coworkPath(selected.path) && onOpenCowork ? "Open in Cowork" : "Open"),
        h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void mutate("rename"); } }, "Rename"),
        h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void mutate("move"); } }, "Move"),
        h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void mutate("duplicate"); } }, "Duplicate"),
        selected.kind === "file" ? h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void downloadAuthenticatedFile(`/api/channels/${channelId}/files/content?path=${encodeURIComponent(selected!.path)}&download=1`, selected!.name).catch((error) => appAlert((error as Error).message)); } }, "Download") : null,
        selected.kind === "file" && /\.md$/i.test(selected.name) ? h("button", { class: "btn-subtle text-xs", type: "button", dataset: { downloadDocx: "" }, onclick: () => { void downloadAuthenticatedFile(`/api/channels/${channelId}/files/docx?path=${encodeURIComponent(selected!.path)}`, selected!.name.replace(/\.md$/i, ".docx")).catch((error) => appAlert(`DOCX download failed: ${(error as Error).message}`)); } }, "Download - DOCX") : null,
        h("button", { class: "btn-ghost text-xs text-danger", type: "button", onclick: () => { void mutate("delete"); } }, "Delete")));
  };
  const refreshDirectories = async (): Promise<void> => {
    try {
      directoryCache = (await api<{ directories: ChannelFile[] }>(`/api/channels/${channelId}/files/directories`)).directories;
      drawTree(directoryCache);
    } catch { /* the current directory remains usable while the tree retries */ }
  };
  const redrawSelection = (): void => {
    main.querySelectorAll<HTMLElement>("[data-file-path]").forEach((node) => node.classList.toggle("is-selected", node.dataset.filePath === selected?.path));
    drawInfo();
  };
  const load = async (options: { refreshTree?: boolean } = {}): Promise<void> => {
    const requestedPath = currentPath;
    try {
      const result = await api<{ path?: string; files: ChannelFile[] }>(`/api/channels/${channelId}/files?path=${encodeURIComponent(requestedPath)}`);
      if (requestedPath !== currentPath) return;
      if (!requestedPath) rootEntries = result.files;
      currentPath = result.path ?? requestedPath; heading.textContent = `/workspace${currentPath ? `/${currentPath}` : ""}`; main.dataset.fileDirectory = currentPath || "/";
      if (directoryCache) drawTree(directoryCache);
      else void refreshDirectories();
      clear(crumbs);
      const segments = currentPath ? currentPath.split("/") : [];
      const addCrumb = (label: string, path: string): void => {
        if (crumbs.childNodes.length) crumbs.append(h("span", { class: "text-faint" }, "/"));
        crumbs.append(h("button", { class: `shrink-0 rounded px-1.5 py-1 ${path === currentPath ? "text-fg" : "text-accent hover:bg-hover"}`, type: "button", onclick: () => { currentPath = path; selected = null; void load(); } }, label));
      };
      addCrumb("workspace", ""); segments.forEach((segment, index) => addCrumb(segment, segments.slice(0, index + 1).join("/")));
      let files = result.files.filter((entry) => !filter || entry.name.toLowerCase().includes(filter));
      files = files.slice().sort((a, b) => Number(a.kind !== "directory") - Number(b.kind !== "directory") || (sort === "modified" ? b.modified - a.modified : sort === "size" ? b.size - a.size : a.name.localeCompare(b.name)));
      clear(main);
      if (!files.length) main.append(empty(result.files.length ? "No matches" : "This folder is empty", result.files.length ? "Try a different search." : "Create a folder or file, upload something, or let the resident agent add it."));
      else main.append(h("div", { class: "file-grid", role: "list" }, ...files.map((entry) => h("button", {
        class: `file-grid-item ${selected?.path === entry.path ? "is-selected" : ""}`, type: "button", role: "listitem", dataset: { filePath: entry.path, fileKind: entry.kind },
        onclick: () => { selected = entry; redrawSelection(); }, ondblclick: () => open(entry),
      }, h("span", { class: `file-grid-icon ${entry.kind === "directory" ? "is-folder" : "is-file"}` }, workspaceIcon(entry, 27)), h("span", { class: "min-w-0 flex-1 text-left" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, entry.name), h("span", { class: "mt-0.5 block truncate text-[11px] text-muted" }, entry.kind === "directory" ? "Folder" : `${formatBytes(entry.size)} · ${timeLabel(entry.modified)}`)), h("span", { class: "file-grid-kind" }, entry.kind === "directory" ? "Folder" : (entry.name.split(".").pop()?.toUpperCase() || "File"))))));
      drawInfo(); status.textContent = `${result.files.length} item${result.files.length === 1 ? "" : "s"}`;
    } catch (error) { panelError(main, error); }
  };
  const refreshMirror = (): Promise<void> => {
    if (mirrorRefresh) return mirrorRefresh;
    status.textContent = "Refreshing from the channel computer…";
    mirrorRefresh = api(`/api/channels/${channelId}/files/refresh`, { method: "POST" })
      .then(async () => { directoryCache = null; await Promise.all([load(), refreshDirectories()]); })
      .catch((error) => { status.textContent = `Showing cached files · ${(error as Error).message}`; })
      .finally(() => { mirrorRefresh = null; });
    return mirrorRefresh;
  };
  search.oninput = () => { filter = search.value.trim().toLowerCase(); void load(); };
  const sortSelect = h("select", { class: "field h-9 w-auto min-w-28 text-xs", "aria-label": "Sort files", onchange: (event: Event) => { sort = (event.target as HTMLSelectElement).value as typeof sort; void load(); } }, h("option", { value: "name" }, "Name"), h("option", { value: "modified" }, "Modified"), h("option", { value: "size" }, "Size"));
  const newFolder = async (): Promise<void> => { const name = await appPrompt("Folder name"); if (!name) return; try { await api(`/api/channels/${channelId}/files/directories`, { body: { path: currentPath, name } }); directoryCache = null; await load(); } catch (error) { status.textContent = (error as Error).message; } };
  const newFile = async (): Promise<void> => { const name = await appPrompt("File name", "untitled.md"); if (!name) return; try { await api(`/api/channels/${channelId}/files/entries`, { body: { parent: currentPath, name, content: "" } }); await load(); } catch (error) { status.textContent = (error as Error).message; } };
  bindResidentFileUploads({ channelId, channelName: () => S.channels.find((channel) => channel.id === channelId)?.name || String(channelId), path: () => currentPath, fileInput, status, origin: root, uploadFile: uploadFileWithProgress, importFile: async (upload, path) => { await api(`/api/channels/${channelId}/files/upload`, { body: { ...upload, path } }); }, onComplete: async () => { directoryCache = null; await Promise.all([load(), refreshDirectories()]); } });
  root.append(
    h("header", { class: "flex min-h-14 flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4" }, h("span", { class: "text-accent" }, icon("folderOpen", 20)), heading, h("div", { class: "flex-1" }), status, h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void newFile(); } }, icon("plus", 14), "New file"), h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void newFolder(); } }, icon("folder", 14), "New folder"), h("button", { class: "btn-primary text-xs", type: "button", onclick: () => fileInput.click() }, "Upload"), fileInput),
    h("div", { class: "flex min-h-0 flex-1" },
      h("aside", { class: "hidden min-h-0 w-60 shrink-0 flex-col border-r border-line bg-raised/35 md:flex" }, h("div", { class: "border-b border-line p-3" }, h("div", { class: "eyebrow text-muted" }, "Folders")), tree),
      h("section", { class: "flex min-h-0 min-w-0 flex-1 flex-col" }, h("div", { class: "flex flex-wrap items-center gap-2 border-b border-line bg-raised/25 px-3 py-2" }, crumbs, h("div", { class: "w-full sm:w-48" }, search), sortSelect), main), info));
  fileBrowserSurfaces.set(channelId, { node: root, reload: async () => { await load(); void refreshMirror(); } });
  clear(container); container.append(root); void load(); void refreshMirror();
}

type ChannelNoteView = { name: string; size: number; modified: number; content?: string };
type NoteSurface = { node: HTMLElement; setClose: (onClose?: () => void) => void; reload: () => Promise<void> };

/** Notes are a long-lived editor, not disposable render output. Shell refreshes
 * (including event-socket reconnects) move this node instead of recreating it,
 * preserving the active note, draft, focus, selection, and preview mode. */
const noteSurfaces = new Map<number, NoteSurface>();

/** Dock-ready Notes surface; app.ts only needs to mount this function for a tab or side dock. */
export function renderNotes(container: HTMLElement, channelId: number, onClose?: () => void): void {
  const cached = noteSurfaces.get(channelId);
  if (cached) {
    cached.setClose(onClose);
    clear(container);
    container.append(cached.node);
    void cached.reload().catch(() => undefined);
    return;
  }
  let notes: ChannelNoteView[] = [];
  let active: ChannelNoteView | null = null;
  let savedContent = "";
  let loadingNote = false;
  let closeHandler = onClose;
  let previewing = false;
  let filter = "";
  const editor = h("textarea", { class: "note-editor min-h-[24rem] flex-1 resize-none bg-surface px-5 py-4 font-mono text-sm leading-6 text-fg outline-none placeholder:text-faint", placeholder: "Choose a note, or create one.", disabled: true, "aria-label": "Note content", spellcheck: "true" }) as HTMLTextAreaElement;
  const preview = h("div", { class: "md note-preview hidden min-h-[24rem] flex-1 overflow-y-auto px-6 py-5 text-sm leading-6 text-fg", dataset: { notePreview: "" } });
  const title = h("div", { class: "truncate font-semibold text-fg" }, "No note selected");
  const saveStatus = h("span", { class: "text-xs text-muted", role: "status" });
  const saveButton = h("button", { class: "btn-primary text-sm", type: "button", disabled: true }, "Save") as HTMLButtonElement;
  const renameButton = h("button", { class: "btn-subtle text-sm", type: "button", disabled: true }, "Rename") as HTMLButtonElement;
  const editButton = h("button", { class: "note-mode-active rounded px-2.5 py-1 text-xs font-semibold", type: "button", "aria-pressed": "true" }, "Write") as HTMLButtonElement;
  const previewButton = h("button", { class: "rounded px-2.5 py-1 text-xs font-semibold text-muted hover:text-fg", type: "button", "aria-pressed": "false", dataset: { notePreviewToggle: "" } }, "Preview") as HTMLButtonElement;
  const list = h("div", { class: "min-h-0 flex-1 overflow-y-auto px-2 pb-3", dataset: { noteList: "" } });
  const search = h("input", { class: "field h-9 bg-surface text-xs", type: "search", placeholder: "Find a note", "aria-label": "Find a note" }) as HTMLInputElement;
  const dirty = (): boolean => Boolean(active) && editor.value !== savedContent;
  const updateEditorState = (): void => {
    saveButton.disabled = !active || !dirty();
    saveStatus.textContent = dirty() ? "Unsaved changes" : active ? `Saved · ${formatBytes(active.size)}` : "";
    if (previewing) preview.innerHTML = md(editor.value || "_This note is empty._");
  };
  const confirmDiscard = async (): Promise<boolean> => !dirty() || appConfirm("Discard the unsaved changes to this note?");
  const drawList = (): void => {
    clear(list);
    const visible = notes.filter((note) => !filter || note.name.toLowerCase().includes(filter));
    if (!notes.length) list.append(empty("No notes yet", "Create a note for plans, meetings, or working context."));
    else if (!visible.length) list.append(h("p", { class: "px-2 py-8 text-center text-xs leading-5 text-faint" }, "No notes match that search."));
    for (const note of visible) list.append(h("button", { class: `group mb-1 flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition ${active?.name === note.name ? "border-accent/30 bg-accent-soft" : "border-transparent hover:border-line hover:bg-hover"}`, type: "button", dataset: { noteName: note.name }, onclick: async () => {
      if (loadingNote || active?.name === note.name || !(await confirmDiscard())) return;
      loadingNote = true;
      try {
        const result = await api<{ note: ChannelNoteView }>(`/api/channels/${channelId}/notes/${encodeURIComponent(note.name)}`);
        active = result.note; savedContent = result.note.content || ""; editor.value = savedContent; editor.disabled = false;
        title.textContent = result.note.name; renameButton.disabled = false; previewButton.disabled = false; drawList(); updateEditorState(); editor.focus();
      } catch (error) { void appAlert((error as Error).message); }
      finally { loadingNote = false; }
    } }, h("span", { class: `mt-0.5 shrink-0 ${active?.name === note.name ? "text-accent" : "text-faint group-hover:text-muted"}` }, icon("file", 16)),
    h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, note.name.replace(/\.md$/i, "")), h("span", { class: "mt-0.5 block truncate text-[11px] text-muted" }, `${timeLabel(note.modified)} · ${formatBytes(note.size)}`))));
  };
  const reloadList = async (selectName?: string): Promise<void> => {
    const result = await api<{ notes: ChannelNoteView[] }>(`/api/channels/${channelId}/notes`);
    notes = result.notes;
    if (active) active = notes.find((note) => note.name === (selectName || active?.name)) || active;
    drawList();
  };
  const save = async (): Promise<void> => {
    if (!active || !dirty()) return;
    saveButton.disabled = true; saveStatus.textContent = "Saving…";
    try {
      const result = await api<{ note: ChannelNoteView }>(`/api/channels/${channelId}/notes/${encodeURIComponent(active.name)}`, { method: "PATCH", body: { content: editor.value } });
      active = result.note; savedContent = result.note.content ?? editor.value; editor.value = savedContent; await reloadList(active.name); updateEditorState();
    } catch (error) { saveStatus.textContent = (error as Error).message; updateEditorState(); }
  };
  saveButton.onclick = () => { void save(); };
  renameButton.onclick = async () => {
    if (!active || !(await confirmDiscard())) return;
    const name = await appPrompt("Rename note", active.name);
    if (!name || name === active.name) return;
    renameButton.disabled = true;
    try {
      const oldName = active.name;
      const result = await api<{ note: ChannelNoteView }>(`/api/channels/${channelId}/notes/${encodeURIComponent(oldName)}`, { method: "PATCH", body: { name } });
      active = result.note; savedContent = result.note.content || ""; editor.value = savedContent; title.textContent = result.note.name; await reloadList(result.note.name); updateEditorState();
    } catch (error) { void appAlert((error as Error).message); }
    finally { renameButton.disabled = !active; }
  };
  const insertFormatting = (before: string, after = before, placeholder = "text"): void => {
    if (!active) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end) || placeholder;
    editor.setRangeText(`${before}${selected}${after}`, start, end, "end");
    editor.focus();
    editor.dispatchEvent(new Event("input"));
  };
  const prefixLines = (prefix: string): void => {
    if (!active) return;
    const start = editor.value.lastIndexOf("\n", Math.max(0, editor.selectionStart - 1)) + 1;
    const selectionEnd = editor.selectionEnd;
    const nextBreak = editor.value.indexOf("\n", selectionEnd);
    const end = nextBreak < 0 ? editor.value.length : nextBreak;
    const text = editor.value.slice(start, end) || "Text";
    editor.setRangeText(text.split("\n").map((line) => `${prefix}${line}`).join("\n"), start, end, "select");
    editor.focus();
    editor.dispatchEvent(new Event("input"));
  };
  const setPreview = (next: boolean): void => {
    previewing = next;
    editor.classList.toggle("hidden", next);
    preview.classList.toggle("hidden", !next);
    editButton.className = `${next ? "text-muted hover:text-fg" : "note-mode-active"} rounded px-2.5 py-1 text-xs font-semibold`;
    previewButton.className = `${next ? "note-mode-active" : "text-muted hover:text-fg"} rounded px-2.5 py-1 text-xs font-semibold`;
    editButton.setAttribute("aria-pressed", String(!next));
    previewButton.setAttribute("aria-pressed", String(next));
    updateEditorState();
    if (!next) editor.focus();
  };
  editButton.onclick = () => setPreview(false);
  previewButton.onclick = () => setPreview(true);
  search.oninput = () => { filter = search.value.trim().toLowerCase(); drawList(); };
  editor.oninput = updateEditorState;
  editor.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); void save(); }
    else if (key === "b") { event.preventDefault(); insertFormatting("**", "**", "bold text"); }
    else if (key === "i") { event.preventDefault(); insertFormatting("*", "*", "italic text"); }
  });
  const newButton = h("button", { class: "btn-primary text-sm", type: "button", onclick: async () => {
    if (!(await confirmDiscard())) return;
    const name = await appPrompt("New note name", "Untitled");
    if (!name) return;
    try {
      const result = await api<{ note: ChannelNoteView }>(`/api/channels/${channelId}/notes`, { body: { name, content: "" } });
      active = result.note; savedContent = result.note.content || ""; editor.value = savedContent; editor.disabled = false; title.textContent = result.note.name; renameButton.disabled = false; previewButton.disabled = false; setPreview(false); await reloadList(result.note.name); updateEditorState(); editor.focus();
    } catch (error) { void appAlert((error as Error).message); }
  } }, icon("plus"), "New note");
  const closeButton = h("button", { class: "btn-subtle text-sm", type: "button", "aria-label": "Close notes", onclick: async () => { if (closeHandler && await confirmDiscard()) closeHandler(); } }, icon("x"), "Close") as HTMLButtonElement;
  const formatting = h("div", { class: "flex min-w-0 flex-wrap items-center gap-1 border-b border-line bg-raised/40 px-3 py-2", role: "toolbar", "aria-label": "Note formatting" },
    h("button", { class: "note-format-button", type: "button", title: "Heading", onclick: () => prefixLines("## ") }, "H"),
    h("button", { class: "note-format-button font-bold", type: "button", title: "Bold", onclick: () => insertFormatting("**", "**", "bold text") }, "B"),
    h("button", { class: "note-format-button italic", type: "button", title: "Italic", onclick: () => insertFormatting("*", "*", "italic text") }, "I"),
    h("button", { class: "note-format-button", type: "button", title: "Bulleted list", onclick: () => prefixLines("- ") }, "• List"),
    h("button", { class: "note-format-button", type: "button", title: "Numbered list", onclick: () => prefixLines("1. ") }, "1. List"),
    h("button", { class: "note-format-button font-mono", type: "button", title: "Inline code", onclick: () => insertFormatting("`", "`", "code") }, "Code"),
    h("button", { class: "note-format-button", type: "button", title: "Link", onclick: () => insertFormatting("[", "](https://)", "link text") }, "Link"));
  clear(container);
  const node = h("section", { class: "flex h-full min-h-[32rem] flex-col bg-surface", dataset: { notesSurface: String(channelId) } },
    h("div", { class: "mobile-surface-topbar flex items-start gap-3 border-b border-line bg-surface px-4 py-3" },
      h("div", { class: "min-w-0 flex-1" }, h("h2", { class: "font-display text-xl text-fg" }, "Notes"), h("p", { class: "mt-0.5 text-xs text-muted" }, "Fast Markdown notes shared with this channel's /workspace/notes.")),
      newButton, closeButton),
    h("div", { class: "grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]" },
      h("aside", { class: "flex min-h-0 flex-col border-b border-line bg-raised/55 md:border-b-0 md:border-r" },
        h("div", { class: "space-y-2 p-3" }, h("div", { class: "flex items-center justify-between gap-2" }, h("span", { class: "eyebrow text-muted" }, "All notes"), h("span", { class: "font-mono text-[10px] text-faint" }, "Markdown")), search), list),
      h("div", { class: "flex min-h-0 min-w-0 flex-col" },
        h("div", { class: "flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-4 py-2" }, title, h("div", { class: "flex-1" }), h("div", { class: "flex rounded-md bg-raised p-0.5" }, editButton, previewButton), saveStatus, renameButton, saveButton),
        formatting,
        h("div", { class: "flex min-h-0 flex-1 flex-col overflow-hidden" }, editor, preview))));
  closeButton.classList.toggle("hidden", !closeHandler);
  const surface: NoteSurface = {
    node,
    setClose: (next) => { closeHandler = next; closeButton.classList.toggle("hidden", !next); },
    reload: reloadList,
  };
  noteSurfaces.set(channelId, surface);
  container.append(node);
  void reloadList().catch((error) => panelError(container, error));
}

export function renderMemory(container: HTMLElement, channelId: number, refresh: RenderRefreshOptions = {}): void {
  if (!refresh.preserveExisting) panelLoading(container, "Memory / Knowledge", "Provider-neutral continuity owned by this channel, with provenance.");
  const load = (): void => {
    void api<{ memory: MemoryItem[] }>(`/api/channels/${channelId}/memory`).then(({ memory }) => {
      if (!refreshIsCurrent(refresh)) return;
      const current = memory.filter((item) => item.status === "current");
      const list = h("div", { class: "space-y-2" });
      if (!current.length) list.append(empty("No durable knowledge yet", "Record decisions, facts, preferences, and artifact references worth carrying into future sessions. Session recaps live in Threads, not here."));
      for (const item of current) list.append(h("article", { class: "card p-4" },
        h("div", { class: "mb-2 flex items-center gap-2" }, h("span", { class: "chip border-accent/30 text-accent" }, item.kind.replace("_", " ")), h("span", { class: "text-xs text-muted" }, `${item.author_type} · ${item.scope} · ${timeLabel(item.created)}`), h("div", { class: "flex-1" }),
          item.kind !== "summary" ? h("button", { class: "btn-ghost text-xs", onclick: async () => { await api(`/api/memory/${item.id}`, { method: "DELETE" }); load(); } }, "Supersede") : null),
        h("div", { class: "md text-sm text-fg", html: md(item.content) })));
      const add = h("button", { class: "btn-primary text-sm", onclick: () => addMemory(channelId, load) }, icon("plus"), "Record knowledge");
      panelContent(container, "Memory / Knowledge", "Provider-neutral continuity owned by this channel, with provenance.", h("div", {}, h("div", { class: "mb-4 flex justify-end" }, add), list));
      refresh.onPaint?.();
    }).catch((error) => { if (refreshIsCurrent(refresh)) panelError(container, error); });
  };
  load();
}

async function addMemory(channelId: number, onDone: () => void): Promise<void> {
  const kind = await appPrompt("Memory type: decision, fact, preference, or artifact_ref", "decision");
  if (!kind) return;
  const content = await appPrompt("What should this channel retain?");
  if (!content) return;
  void api(`/api/channels/${channelId}/memory`, { body: { kind: kind.trim(), content: content.trim() } }).then(onDone).catch((error) => appAlert((error as Error).message));
}

/** Activity is the ops log for a channel — not chat. Group + label kinds so Skipper's
 * background passes (audits, improvements, skills) are readable instead of a raw dump. */
const ACTIVITY_SKIPPER = new Set(["thread_audit", "improvement", "skill", "collaboration", "handoff"]);
const ACTIVITY_WORK = new Set(["tool", "tool_result", "escalation", "followup", "memory"]);
const ACTIVITY_SYSTEM = new Set(["agent_status", "lifecycle", "profile"]);
ACTIVITY_SKIPPER.add("computer");

type ActivityFilter = "all" | "skipper" | "work" | "system";
const activityFilters = new Map<number, ActivityFilter>();

function activityBucket(kind: string): ActivityFilter {
  if (ACTIVITY_SKIPPER.has(kind)) return "skipper";
  if (ACTIVITY_WORK.has(kind)) return "work";
  if (ACTIVITY_SYSTEM.has(kind)) return "system";
  return "work";
}

function activityKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    thread_audit: "Thread audit",
    improvement: "Behavior improvement",
    skill: "Skill",
    collaboration: "Collaboration",
    handoff: "Hand-back",
    tool: "Action",
    tool_result: "Tool finished",
    escalation: "Escalation",
    followup: "Follow-up",
    memory: "Memory",
    agent_status: "Agent status",
    lifecycle: "Lifecycle",
    profile: "Profile",
    computer: "Computer care",
  };
  return labels[kind] || kind.replace(/_/g, " ");
}

function activityActorLabel(actor: string): string {
  if (actor === "skipper") return "Skipper";
  if (actor === "agent") return "Resident";
  if (actor === "human") return "Captain";
  if (actor === "system") return "System";
  return actor;
}

function activityStatusTone(status: string): string {
  if (status === "failed") return "bg-danger";
  if (status === "running" || status === "open" || status === "pending" || status === "working" || status === "waiting") return "bg-amber-400";
  if (status === "quiet") return "bg-line";
  return "bg-ok";
}

function activityStatusLabel(status: string): string {
  if (!status || status === "complete") return "";
  if (status === "quiet") return "quiet check";
  return status.replace(/_/g, " ");
}

function activityCard(item: ActivityItem): HTMLElement {
  const bucket = activityBucket(item.kind);
  const statusExtra = activityStatusLabel(item.status);
  const meta = [
    activityKindLabel(item.kind),
    activityActorLabel(item.actor_type),
    statusExtra,
    timeLabel(item.created),
  ].filter(Boolean).join(" · ");
  const border = bucket === "skipper"
    ? "border-accent/25 bg-accent-soft/20"
    : "border-line bg-surface";
  const headline = h("div", { class: `flex gap-3 ${item.action_id ? "px-4 py-3" : "rounded-lg px-4 py-3"}` },
    h("span", { class: `mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${activityStatusTone(item.status)}`, title: item.status || "complete" }),
    h("div", { class: "min-w-0 flex-1" },
      h("div", { class: "md text-sm leading-5 text-fg", html: md(item.summary) }),
      h("div", { class: "mt-1 text-xs text-muted" }, meta)));
  if (!item.action_id) return h("div", { class: `rounded-lg border ${border}` }, headline);

  const evidence: HTMLElement[] = [];
  if (item.action_input) evidence.push(
    h("div", {}, h("div", { class: "mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Input"),
      h("pre", { class: "m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted" }, item.action_input)));
  if (item.action_result) evidence.push(
    h("div", {}, h("div", { class: "mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Outcome evidence"),
      h("pre", { class: "m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted" }, item.action_result)));
  return h("details", { class: `overflow-hidden rounded-lg border ${border}`, dataset: { actionId: String(item.action_id), continuityKey: `activity-action-${item.action_id}` } },
    h("summary", { class: "cursor-pointer select-none list-none" }, headline),
    h("div", { class: "space-y-3 border-t border-line/70 bg-raised/30 px-4 py-3" },
      ...(evidence.length ? evidence : [h("p", { class: "text-xs text-muted" }, item.status === "running" ? "The action is still running; evidence will appear here when it settles." : "No additional output was retained for this action.")])));
}

function activitySection(title: string, copy: string, items: ActivityItem[]): HTMLElement {
  const body = h("div", { class: "space-y-2" });
  if (!items.length) {
    body.append(h("p", { class: "rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted" }, "Nothing in this section yet."));
  } else {
    for (const item of items) body.append(activityCard(item));
  }
  return h("section", { class: "space-y-3" },
    h("div", {},
      h("h3", { class: "text-sm font-semibold tracking-wide text-fg" }, title),
      h("p", { class: "mt-0.5 text-xs text-muted" }, copy)),
    body);
}

export function renderActivity(container: HTMLElement, channelId: number, refresh: RenderRefreshOptions = {}): void {
  if (!refresh.preserveExisting) panelLoading(container, "Activity", "Ops log for this channel — tools, escalations, and Skipper's background checks (not the chat stream).");
  void api<{ activity: ActivityItem[] }>(`/api/channels/${channelId}/activity`).then(({ activity }) => {
    if (!refreshIsCurrent(refresh)) return;
    let filter: ActivityFilter = activityFilters.get(channelId) || "all";
    const root = h("div", { class: "space-y-5" });

    const paint = (): void => {
      clear(root);
      const counts = { all: activity.length, skipper: 0, work: 0, system: 0 };
      for (const item of activity) counts[activityBucket(item.kind)]++;

      const filters: { id: ActivityFilter; label: string }[] = [
        { id: "all", label: `All · ${counts.all}` },
        { id: "skipper", label: `Skipper · ${counts.skipper}` },
        { id: "work", label: `Work · ${counts.work}` },
        { id: "system", label: `System · ${counts.system}` },
      ];
      const chips = h("div", { class: "flex flex-wrap gap-2" },
        ...filters.map((item) => h("button", {
          type: "button",
          class: `btn-subtle min-h-11 shrink-0 text-sm sm:min-h-0 ${filter === item.id ? "border-accent/40 bg-accent-soft text-accent" : ""}`,
          "aria-pressed": String(filter === item.id),
          dataset: { continuityKey: `activity-filter-${channelId}-${item.id}` },
          onclick: () => { filter = item.id; activityFilters.set(channelId, filter); paint(); },
        }, item.label)));

      const blurb = h("p", { class: "text-sm leading-6 text-muted" },
        "Chat is conversation. Activity is the machine log: when tools run, when agents wake, and when Skipper quietly audits threads, improves behavior, or grants skills. On #main, Skipper also posts workspace-wide pass summaries (including quiet checks that changed nothing).");

      if (!activity.length) {
        root.append(blurb, chips, empty("No activity yet", "Tool use, escalations, and Skipper background passes will show up here."));
        return;
      }

      const skipperItems = activity.filter((item) => activityBucket(item.kind) === "skipper");
      const workItems = activity.filter((item) => activityBucket(item.kind) === "work");
      const systemItems = activity.filter((item) => activityBucket(item.kind) === "system");

      root.append(blurb, chips);

      if (filter === "all" || filter === "skipper") {
        root.append(activitySection(
          "Skipper · background",
          "Periodic thread-status audits, silent behavior improvements, skill grants, and hand-backs. Quiet checks mean Skipper looked and left things alone.",
          skipperItems,
        ));
      }
      if (filter === "all" || filter === "work") {
        root.append(activitySection(
          "Work · tools & escalations",
          "What agents actually did in this channel — one outcome-first row per action, expandable evidence, follow-ups, memory writes, and direct Skipper escalations.",
          workItems,
        ));
      }
      if (filter === "all" || filter === "system") {
        root.append(activitySection(
          "System · lifecycle",
          "Agent ready/working flips, channel archive/restore, and profile edits. Usually noise compared to Skipper and Work.",
          systemItems,
        ));
      }
    };

    paint();
    panelContent(container, "Activity", "Ops log for this channel — tools, escalations, and Skipper's background checks (not the chat stream).", root);
    refresh.onPaint?.();
  }).catch((error) => { if (refreshIsCurrent(refresh)) panelError(container, error); });
}

export function renderChannelSettings(container: HTMLElement, channel: Channel, onChanged: (deleted?: boolean) => void, onPaint?: () => void): void {
  const nameField = h("input", {
    class: "field font-mono",
    value: channel.name,
    autocomplete: "off",
    spellcheck: "false",
    dataset: { continuityKey: `channel-settings-name-${channel.id}` },
    disabled: channel.name === "main" || !channel.can_manage ? true : undefined,
  }) as HTMLInputElement;
  const purpose = h("textarea", { class: "field min-h-24", "aria-label": "Channel purpose", dataset: { continuityKey: `channel-settings-purpose-${channel.id}` } }, channel.purpose || "") as HTMLTextAreaElement;
  const provider = h("select", { class: "field", "aria-label": "Serving provider", dataset: { continuityKey: `channel-settings-provider-${channel.id}` } }, h("option", { value: "" }, "Loading providers…")) as HTMLSelectElement;
  const model = h("select", { class: "field", "aria-label": "Serving model", dataset: { continuityKey: `channel-settings-model-${channel.id}` } }, h("option", { value: channel.agent?.model || "" }, channel.agent?.model || "Choose a model")) as HTMLSelectElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const notificationPreference = channelNotificationPreference(channel.id);
  const channelMuted = h("input", { type: "checkbox", checked: notificationPreference.muted, class: "accent-accent" }) as HTMLInputElement;
  const channelSound = h("select", { class: "field" }, ...NOTIFICATION_SOUNDS.map((item) => h("option", { value: item.value, selected: item.value === notificationPreference.sound }, item.label))) as HTMLSelectElement;
  const notificationStatus = h("p", { class: "min-h-5 text-sm text-muted" });
  const saveChannelNotifications = async (): Promise<void> => {
    channelMuted.disabled = true; channelSound.disabled = true; notificationStatus.textContent = "Saving…";
    try {
      await setChannelNotificationPreference(channel.id, { muted: channelMuted.checked, sound: channelSound.value as typeof notificationPreference.sound });
      notificationStatus.textContent = channelMuted.checked ? `#${channel.name} is muted for your account.` : `#${channel.name} will use ${channelSound.selectedOptions[0]?.textContent || "this sound"}.`;
    } catch (error) { notificationStatus.textContent = (error as Error).message; }
    finally { channelMuted.disabled = false; channelSound.disabled = channelMuted.checked; }
  };
  channelMuted.onchange = () => { channelSound.disabled = channelMuted.checked; void saveChannelNotifications(); };
  channelSound.onchange = () => { previewNotification(channelSound.value as typeof notificationPreference.sound); void saveChannelNotifications(); };
  channelSound.disabled = channelMuted.checked;
  let loadSequence = 0;
  let modelLoading = false;
  let changeModelButton: HTMLButtonElement | null = null;
  let routedModels: RoutingModel[] = [];
  const loadModels = async (): Promise<void> => {
    const family = provider.value;
    const sequence = ++loadSequence;
    clear(model); model.append(h("option", { value: "" }, family ? "Choose a model" : "Choose a provider"));
    model.disabled = !family; modelLoading = false; if (changeModelButton) changeModelButton.disabled = !family;
    if (!family) return;
    try {
      if (!routedModels.length) routedModels = (await api<{ models: RoutingModel[] }>("/api/workspace/model-policy")).models;
      if (sequence !== loadSequence || provider.value !== family) return;
      const models = routedModels.filter((item) => routingModelGroupKey(item) === family);
      clear(model); model.append(...models.map((item) => h("option", { value: item.id, selected: item.id === channel.agent?.model }, item.name || item.id)));
      status.textContent = `${models.length} models available.`;
    } catch (error) {
      if (sequence === loadSequence) status.textContent = (error as Error).message;
    } finally {
      if (sequence === loadSequence) { modelLoading = false; model.disabled = false; if (changeModelButton) changeModelButton.disabled = false; }
    }
  };
  provider.onchange = () => { void loadModels(); };
  void api<{ models: RoutingModel[] }>("/api/workspace/model-policy").then(async ({ models }) => {
    routedModels = models;
    const current = models.find((item) => item.id === channel.agent?.model);
    clear(provider); provider.append(h("option", { value: "" }, "Choose a provider"), ...groupRoutingModels(models).map((group) => h("option", { value: group.key, selected: current ? routingModelGroupKey(current) === group.key : false }, group.label)));
    await loadModels();
    onPaint?.();
  }).catch((error) => { status.textContent = (error as Error).message; });
  const saveName = async (): Promise<void> => {
    if (channel.name === "main") { status.textContent = "#main cannot be renamed."; return; }
    if (!channel.can_manage) { status.textContent = "Only this channel's creator can rename it."; return; }
    try {
      await api(`/api/channels/${channel.id}`, { method: "PATCH", body: { name: nameField.value } });
      status.textContent = "Channel renamed.";
      onChanged();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  const savePurpose = async (): Promise<void> => {
    try { await api(`/api/channels/${channel.id}`, { method: "PATCH", body: { purpose: purpose.value } }); status.textContent = "Purpose saved."; onChanged(); }
    catch (error) { status.textContent = (error as Error).message; }
  };
  const saveModel = async (): Promise<void> => {
    if (modelLoading) { status.textContent = "Wait for this provider's models to finish loading."; return; }
    try { await api(`/api/channels/${channel.id}/agent-policy`, { method: "PATCH", body: { provider_id: channel.agent?.provider_id || S.providers[0]?.id || null, model: model.value } }); status.textContent = "Future turns will use the new model. Identity, files, threads, and memory are unchanged."; onChanged(); }
    catch (error) { status.textContent = (error as Error).message; }
  };
  changeModelButton = h("button", { class: "btn-primary text-sm", onclick: () => { void saveModel(); } }, "Change model") as HTMLButtonElement;

  // Agent avatar presets + upload
  const agentAvatar = h("div", { class: "flex items-center gap-3" });
  const avatarPreview = h("div", { class: "h-12 w-12 shrink-0" });
  const avatarFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", class: "hidden" }) as HTMLInputElement;
  const avatarColors = ["#c8552f", "#4f6d7a", "#8a6b7c", "#a67c52", "#7a6a4f", "#2e7d4f", "#2166b8", "#64748b"];
  const avatarColorRow = h("div", { class: "flex flex-wrap gap-2" });
  const avatarCharacterRow = h("div", { class: "grid grid-cols-3 gap-2 sm:grid-cols-5" });
  const currentAvatar = channel.agent?.runtime?.avatar || "";
  const drawAvatarPreview = (value: string): void => {
    clear(avatarPreview);
    const character = /^agent:([1-9]):(#[0-9a-f]{6})$/i.exec(value);
    if (character) {
      avatarPreview.append(h("div", { class: "h-12 w-12 overflow-hidden rounded-xl identity-solid", style: `background:${character[2]}`, title: channel.agent?.name || "Agent" },
        h("img", { class: "h-full w-full object-contain", src: `/agent-avatars/agent-${character[1]}.png`, alt: "" })));
    } else if (value.startsWith("color:")) {
      // Solid color is the entire avatar plate — no initials on top.
      avatarPreview.append(h("div", { class: "h-12 w-12 rounded-xl identity-solid", style: `background:${value.slice(6)}`, title: channel.agent?.name || "Agent" }));
    } else if (value.startsWith("data:image/") || value.startsWith("/")) {
      avatarPreview.append(h("img", { class: "h-12 w-12 rounded-xl object-cover identity-photo", src: authenticatedAssetSrc(value), alt: "Agent" }));
    } else {
      avatarPreview.append(avatar(channel.agent?.name || "A", "bot", 12));
    }
  };
  drawAvatarPreview(currentAvatar);
  const saveAvatar = async (value: string): Promise<void> => {
    try {
      await api(`/api/channels/${channel.id}/agent-avatar`, { method: "PATCH", body: { avatar: value } });
      drawAvatarPreview(value);
      status.textContent = "Agent avatar saved.";
      // Refresh channel + bot state so chat avatars update without a page reload.
      onChanged();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  for (const hex of avatarColors) avatarColorRow.append(h("button", { class: "h-8 w-8 rounded-lg border border-line shadow-sm transition hover:scale-105", style: `background:${hex}`, title: hex, onclick: () => { void saveAvatar(`color:${hex}`); } }));
  for (let character = 1; character <= 9; character++) {
    const color = avatarColors[(character - 1) % avatarColors.length];
    avatarCharacterRow.append(h("button", {
      class: "h-12 w-12 overflow-hidden rounded-xl border border-line shadow-sm transition hover:scale-105",
      style: `background:${color}`,
      title: `Resident character ${character}`,
      onclick: () => { void saveAvatar(`agent:${character}:${color}`); },
    }, h("img", { class: "h-full w-full object-contain", src: `/agent-avatars/agent-${character}.png`, alt: `Resident character ${character}` })));
  }
  avatarFile.onchange = async () => {
    const image = avatarFile.files?.[0]; if (!image) return;
    const reader = new FileReader();
    reader.onload = () => { void saveAvatar(String(reader.result)); };
    reader.readAsDataURL(image);
  };
  agentAvatar.append(avatarPreview, h("div", { class: "flex flex-wrap gap-2" }, h("label", { class: "btn-subtle cursor-pointer text-sm" }, "Upload", avatarFile), currentAvatar ? h("button", { class: "btn-ghost text-sm", onclick: () => { void saveAvatar(""); } }, "Reset") : null));

  const lifecycle = channel.name === "main" || !channel.can_manage ? null : h("div", { class: "card border-danger/30 p-4" },
    h("h3", { class: "font-semibold text-fg" }, "Lifecycle"),
    h("p", { class: "mt-1 text-sm leading-5 text-muted" }, channel.status === "archived" ? "This agent world is paused. Restore reuses the same identity, workspace, memory, and threads." : "Archive pauses work while preserving the complete agent world."),
    h("div", { class: "mt-4 flex flex-wrap gap-2" },
      channel.status === "archived"
        ? h("button", { class: "btn-primary text-sm", onclick: async () => { await api(`/api/channels/${channel.id}/restore`, { body: {} }); onChanged(); } }, "Restore same world")
        : h("button", { class: "btn-subtle text-sm", onclick: async () => { if (await appConfirm(`Archive #${channel.name}? Its agent world will be preserved and paused.`)) { await api(`/api/channels/${channel.id}/archive`, { body: {} }); onChanged(); } } }, "Archive channel"),
      channel.status === "archived" ? h("button", { class: "btn-danger text-sm", onclick: async () => {
        const confirmation = await appPrompt(`Permanent deletion removes the agent, workspace, files, memory, sessions, and channel.\n\nType **${channel.name}** to confirm:`);
        if (confirmation !== channel.name) return;
        await api(`/api/channels/${channel.id}`, { method: "DELETE", body: { confirm: confirmation } }); onChanged(true);
      } }, icon("trash", 14), "Delete permanently") : null));

  const assignedSkills = h("div", { class: "mt-3 flex flex-wrap gap-2", dataset: { assignedSkills: "" } }, ...((channel.agent?.skills || []).map((skill) => h("span", { class: "chip border-accent/25", dataset: { assignedSkill: skill.slug } }, skill.name))));

  const textingCard = channelTextingSettings(channel.id, channel.name, Boolean(S.me.is_admin));
  const computer = channel.computer;
  const computerKind = computer?.backend === "apple" ? "Isolated Linux VM"
    : computer?.backend === "oci" ? "Private OCI container"
      : "Development backend";
  const computerCard = computer ? h("div", { class: "card p-4" },
    h("div", { class: "flex flex-wrap items-center gap-2" },
      h("h3", { class: "font-semibold text-fg" }, "This channel's computer"),
      h("span", { class: "chip border-accent/25" }, computerKind),
      h("span", { class: "chip" }, computer.observed_state)),
    h("p", { class: "mt-2 text-sm leading-6 text-muted" }, "Skipper provisions, wakes, monitors, updates, repairs, and sizes this computer automatically. The mirror quota protects host sync; it is not the VM's disk capacity."),
    h("div", { class: "mt-3 grid gap-2 text-xs text-muted sm:grid-cols-5" },
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, `${computer.cpus} CPU${computer.cpus === 1 ? "" : "s"}`), "Automatically managed"),
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, `${Math.max(1, Math.round(computer.memory_bytes / 1073741824))} GiB RAM`), "Automatically managed"),
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, `${Math.max(1, Math.round(computer.mirror_quota_bytes / 1073741824))} GiB mirror quota`), "Host-sync safety limit"),
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, computer.pressure?.diskUsedPercent != null ? `${Math.round(computer.pressure.diskUsedPercent)}% disk used` : "Disk use unknown"), computer.guest_disk_capacity_status === "known" ? "Guest capacity known" : "VM capacity not reported"),
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, computer.home_mount === "none" ? "Host home private" : "Needs attention"), "No whole-home mount")),
    computer.obligations?.length ? h("p", { class: "mt-3 text-xs text-muted" }, `${computer.obligations.length} active obligation${computer.obligations.length === 1 ? "" : "s"}; Skipper will keep or wake the computer as needed.`) : null,
    computer.last_error ? h("p", { class: "mt-3 text-sm text-danger" }, computer.last_error) : null) : null;
  panelContent(container, "Channel settings", "Name, purpose, replaceable model policy, permanent skills, scoped capabilities, and lifecycle.", h("div", { class: "space-y-4" },
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Channel name"), h("p", { class: "mt-1 text-sm text-muted" }, channel.name === "main" ? "#main is fixed." : "Sidebar label and URL slug. The resident @mention stays the same.")),
      h("div", { class: "flex flex-col gap-2 sm:flex-row sm:items-center" },
        h("div", { class: "flex min-w-0 flex-1 items-center gap-1" }, h("span", { class: "text-muted" }, "#"), nameField),
        channel.name === "main" || !channel.can_manage
          ? null
          : h("button", { class: "btn-primary text-sm", onclick: () => { void saveName(); } }, "Rename"))),
    h("div", { class: "card space-y-3 p-4" }, h("h3", { class: "font-semibold text-fg" }, "Purpose"), purpose, h("div", { class: "flex justify-end" }, h("button", { class: "btn-primary text-sm", onclick: () => { void savePurpose(); } }, "Save purpose"))),
    h("div", { class: "card space-y-3 p-4", dataset: { channelNotifications: "" } },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Notification sound"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Private to your account. Global mute in Settings → Notifications always takes priority.")),
      h("label", { class: "flex items-center gap-3 rounded-lg border border-line bg-panel p-3 text-sm font-semibold text-fg" }, channelMuted, `Mute #${channel.name}`),
      h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Ping sound", channelSound),
      notificationStatus),
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Agent avatar"), h("p", { class: "mt-1 text-sm text-muted" }, "Pick a resident character on a flat color, a plain color, or upload a custom image.")),
      agentAvatar,
      h("div", { class: "mt-2" }, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Resident characters"), avatarCharacterRow),
      h("div", { class: "mt-2" }, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Plain colors"), avatarColorRow)),
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Serving model"), h("p", { class: "mt-1 text-sm text-muted" }, "The model provides replaceable intelligence. Changing it never creates a new agent or discards channel-owned state.")),
      h("div", { class: "grid grid-cols-1 gap-3 sm:grid-cols-2" }, provider, model),
      h("div", { class: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, S.me.is_admin ? changeModelButton : null)),
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Assigned skills"), h("p", { class: "mt-1 text-sm text-muted" }, "This resident starts with a small shared core plus skills for its channel template. It can search the complete workspace catalog and ask Skipper for another skill when needed."), assignedSkills),
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Capabilities"), h("div", { class: "mt-3 flex flex-wrap gap-2" }, ...(channel.agent?.capabilities || []).map((capability) => h("span", { class: "chip" }, capability))), h("p", { class: "mt-3 text-xs text-muted" }, "The resident agent is channel-scoped. It calls @skipper for host-level, cross-channel, credential, guest-expert, or missing-capability work.")),
    channel.agent?.kind === "channel" ? skipperCallSettings(channel, onChanged) : null,
    textingCard,
    computerCard,
    lifecycle));
  onPaint?.();
  if (channel.agent?.provider_id) void loadModels();
}
function panelLoading(container: HTMLElement, title: string, subtitle: string): void { panelContent(container, title, subtitle, h("div", { class: "py-12 text-center text-sm text-muted" }, "Loading…")); }
function panelError(container: HTMLElement, error: unknown): void { container.replaceChildren(h("div", { class: "m-6 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger" }, (error as Error).message)); }
function panelContent(container: HTMLElement, title: string, subtitle: string, content: HTMLElement): void {
  clear(container);
  container.append(h("div", { class: "mx-auto w-full max-w-5xl p-6" }, h("div", { class: "mb-6" }, h("h2", { class: "font-display text-[1.75rem] leading-tight text-fg" }, title), h("p", { class: "mt-1.5 text-sm text-muted" }, subtitle)), content));
}
function empty(title: string, copy: string): HTMLElement { return h("div", { class: "py-14 text-center" }, h("div", { class: "font-display text-xl text-fg" }, title), h("p", { class: "mx-auto mt-2 max-w-md text-sm leading-6 text-muted" }, copy)); }
function formatBytes(size: number): string { return size < 1024 ? `${size} B` : size < 1_048_576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1_048_576).toFixed(1)} MB`; }
