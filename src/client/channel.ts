import { api, downloadAuthenticatedFile, openAuthenticatedFile, uploadFile, type ActivityItem, type AgentTemplate, type Channel, type ChannelFile, type GlobalThread, type MemoryItem, type Message, type ThreadState, type RoutingModel } from "./api.ts";
import { h, clear, icon, md, timeLabel } from "./dom.ts";
import { S, avatar, appAlert, appConfirm, appPrompt } from "./app.ts";

export type ChannelView = "chat" | "board" | "threads" | "files" | "terminal" | "memory" | "activity" | "settings";

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
      const result = await api<{ channel: Channel }>("/api/channels", { body: { name: name.value, purpose: purpose.value, template: selectedTemplate } });
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

export function renderThreads(container: HTMLElement, channelId: number, onOpen: (thread: ThreadState) => void): void {
  panelLoading(container, "Threads", "Focused sessions with durable status and rolling summaries.");
  void api<{ threads: ThreadState[] }>(`/api/channels/${channelId}/threads`).then(({ threads }) => {
    const list = h("div", { class: "space-y-2" });
    if (!threads.length) list.append(empty("No sessions yet", "Start a top-level message in Chat to open a focused session."));
    for (const thread of threads) {
      list.append(h("article", { class: "card flex w-full min-w-0 items-start gap-2.5 p-3" },
        h("span", { class: "mt-0.5 shrink-0 text-accent" }, icon("thread")),
        h("button", { class: "min-w-0 flex-1 text-left", type: "button", dataset: { threadOpen: String(thread.id) }, onclick: () => onOpen(thread) },
          h("div", { class: "truncate font-semibold text-fg hover:text-accent" }, thread.title),
          h("div", { class: "md mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted", html: md(thread.summary || "No summary yet.") }),
          followupMeta(thread),
          h("div", { class: "mt-2 flex items-center gap-2 text-xs text-faint" }, statusPath(thread.status, thread.updated_at), h("span", {}, `· Updated ${timeLabel(thread.updated_at)}`)))));
    }
    panelContent(container, "Threads", "Focused sessions with durable status and rolling summaries.", list);
    startBoardCountdownTicker(list);
  }).catch((error) => panelError(container, error));
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
export function renderBoard(container: HTMLElement, channelId: number, onOpen: (root: Message) => void): void {
  clear(container);
  container.append(h("div", { class: "board-shell" },
    h("div", { class: "board-header" },
      h("div", { class: "min-w-0" },
        h("h2", { class: "font-display text-xl leading-tight text-fg sm:text-[1.45rem]" }, "Board"),
        h("p", { class: "mt-0.5 text-xs text-muted sm:text-sm" }, "Sessions by status. Scheduled = durable agent wake with live countdown.")),
      h("span", { class: "board-header-hint" }, "Loading…"))));

  void api<{ threads: ThreadState[] }>(`/api/channels/${channelId}/threads`).then(({ threads }) => {
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
      dataset: { threadOpen: String(thread.id) },
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
      h("div", { class: "board-lane-cards" }, ...scheduled.map(threadCard),
        scheduled.length ? null : h("p", { class: "px-1 py-6 text-center text-xs leading-5 text-faint" }, "No scheduled wakes")));

    const lanes = statuses.map(({ status, label }) => {
      const laneThreads = grouped.get(status) || [];
      return h("section", { class: `board-lane board-lane-${status}`, dataset: { boardStatus: status } },
        h("div", { class: "board-lane-heading" },
          h("h3", { class: "font-semibold text-fg" }, label),
          h("span", { class: "font-mono text-[10px] text-faint" }, String(laneThreads.length))),
        h("div", { class: "board-lane-cards" }, ...laneThreads.map(threadCard),
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
  }).catch((error) => panelError(container, error));
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
): void {
  panelLoading(container, "Threads", "Sessions across every agent channel. Filter to only unread activity.");
  const path = opts.unreadOnly ? "/api/threads?unread=1" : "/api/threads";
  void api<{ threads: GlobalThread[] }>(path).then(({ threads }) => {
    const toolbar = h("div", { class: "mb-3" },
      h("p", { class: "text-sm text-muted" }, opts.unreadOnly ? "Showing threads with new activity since you last read the channel. Use the top-bar Unread control to change the filter." : "All focused sessions, newest first."));
    const list = h("div", { class: "space-y-2" });
    if (!threads.length) {
      list.append(empty(
        opts.unreadOnly ? "No unread threads" : "No sessions yet",
        opts.unreadOnly ? "Catch up is clear. Turn off the Unread filter to browse everything." : "Start a top-level message in any agent channel to open a focused session.",
      ));
    }
    for (const thread of threads) {
      list.append(h("article", {
        class: `card flex w-full min-w-0 items-start gap-2.5 p-3 ${thread.unread ? "border-accent/35 bg-accent-soft/30" : ""}`,
      },
        h("span", { class: "mt-0.5 shrink-0 text-accent" }, icon("thread")),
        h("button", {
          class: "min-w-0 flex-1 text-left", type: "button",
          dataset: { globalThreadOpen: String(thread.id) },
          onclick: () => opts.onOpen(thread),
        },
          h("div", { class: "flex min-w-0 items-center gap-2" },
            h("span", { class: `truncate ${thread.unread ? "font-semibold text-fg" : "font-semibold text-fg hover:text-accent"}` }, thread.title || "Untitled session"),
            thread.unread ? h("span", { class: "shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" }, "Unread") : null),
          h("div", { class: "mt-1 flex flex-wrap items-center gap-2 text-xs text-muted" },
            h("span", { class: "font-mono text-accent" }, `#${thread.channel_name}`),
            h("span", {}, `· Updated ${timeLabel(thread.updated_at)}`)),
          h("div", { class: "md mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted", html: md(thread.summary || "No summary yet.") }),
          h("div", { class: "mt-2 flex items-center gap-2 text-xs text-faint" }, statusPath(thread.status, thread.updated_at)))));
    }
    clear(container);
    container.append(h("div", { class: "mx-auto w-full max-w-5xl p-6" },
      h("div", { class: "mb-2" },
        h("h2", { class: "font-display text-[1.75rem] leading-tight text-fg" }, "Threads"),
        h("p", { class: "mt-1.5 text-sm text-muted" }, "Sessions across every agent channel. Filter to only unread activity.")),
      toolbar, list));
  }).catch((error) => panelError(container, error));
}

export function renderFiles(container: HTMLElement, channelId: number): void {
  panelLoading(container, "Files", "Same tree the channel terminal sees as /workspace. Uploads also appear under files/.");
  void api<{ files: ChannelFile[] }>(`/api/channels/${channelId}/files`).then(({ files }) => {
    const list = h("div", { class: "overflow-hidden rounded-lg border border-line bg-surface" });
    if (!files.length) list.append(empty("No files yet", "Ask the resident agent to create something in /workspace, or attach a file in Chat."));
    for (const file of files) {
      const display = file.path.startsWith("files/") ? file.path : file.path;
      const row = h("div", { class: "flex items-center gap-3 border-b border-line px-4 py-3 last:border-0" },
        h("span", { class: file.kind === "directory" ? "text-muted" : "text-accent" }, icon("file")),
        h("div", { class: "min-w-0 flex-1" },
          h("div", { class: "truncate font-mono text-sm text-fg" }, "/" + display),
          h("div", { class: "text-xs text-muted" }, file.kind === "directory" ? "Folder" : `${formatBytes(file.size)} · changed ${timeLabel(file.modified)} · ${file.path.startsWith("files/") ? "uploads/files" : "workspace"}`)),
        file.kind === "file" ? h("div", { class: "flex shrink-0 items-center gap-2" },
          h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void openAuthenticatedFile(`/api/channels/${channelId}/files/content?path=${encodeURIComponent(file.path)}`).catch((error) => appAlert((error as Error).message)); } }, "Open"),
          h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => { void downloadAuthenticatedFile(`/api/channels/${channelId}/files/content?path=${encodeURIComponent(file.path)}&download=1`, file.name).catch((error) => appAlert((error as Error).message)); } }, "Download")) : null);
      list.append(row);
    }
    const fileInput = h("input", { type: "file", multiple: true, class: "hidden" }) as HTMLInputElement;
    const uploadStatus = h("span", { class: "text-xs text-muted" });
    const uploadButton = h("button", { class: "btn-primary text-sm", onclick: () => fileInput.click() }, icon("plus"), "Upload");
    fileInput.onchange = async () => {
      const chosen = Array.from(fileInput.files || []);
      if (!chosen.length) return;
      uploadButton.setAttribute("disabled", "true"); uploadStatus.textContent = `Uploading ${chosen.length} file${chosen.length === 1 ? "" : "s"}…`;
      try {
        for (const file of chosen) {
          const upload = await uploadFile(file);
          await api(`/api/channels/${channelId}/files/upload`, { body: upload });
        }
        renderFiles(container, channelId);
      } catch (error) { uploadStatus.textContent = (error as Error).message; uploadButton.removeAttribute("disabled"); }
    };
    panelContent(container, "Files", "Same tree the channel terminal sees as /workspace. Uploads also appear under files/.", h("div", {}, h("div", { class: "mb-4 flex items-center justify-end gap-3" }, uploadStatus, uploadButton, fileInput), list));
  }).catch((error) => panelError(container, error));
}

export function renderMemory(container: HTMLElement, channelId: number): void {
  panelLoading(container, "Memory / Knowledge", "Provider-neutral continuity owned by this channel, with provenance.");
  const load = (): void => {
    void api<{ memory: MemoryItem[] }>(`/api/channels/${channelId}/memory`).then(({ memory }) => {
      const current = memory.filter((item) => item.status === "current");
      const list = h("div", { class: "space-y-2" });
      if (!current.length) list.append(empty("No durable knowledge yet", "Record decisions, facts, preferences, and artifact references worth carrying into future sessions. Session recaps live in Threads, not here."));
      for (const item of current) list.append(h("article", { class: "card p-4" },
        h("div", { class: "mb-2 flex items-center gap-2" }, h("span", { class: "chip border-accent/30 text-accent" }, item.kind.replace("_", " ")), h("span", { class: "text-xs text-muted" }, `${item.author_type} · ${item.scope} · ${timeLabel(item.created)}`), h("div", { class: "flex-1" }),
          item.kind !== "summary" ? h("button", { class: "btn-ghost text-xs", onclick: async () => { await api(`/api/memory/${item.id}`, { method: "DELETE" }); load(); } }, "Supersede") : null),
        h("div", { class: "md text-sm text-fg", html: md(item.content) })));
      const add = h("button", { class: "btn-primary text-sm", onclick: () => addMemory(channelId, load) }, icon("plus"), "Record knowledge");
      panelContent(container, "Memory / Knowledge", "Provider-neutral continuity owned by this channel, with provenance.", h("div", {}, h("div", { class: "mb-4 flex justify-end" }, add), list));
    }).catch((error) => panelError(container, error));
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
      h("div", { class: "text-sm leading-5 text-fg" }, item.summary),
      h("div", { class: "mt-1 text-xs text-muted" }, meta)));
  if (!item.action_id) return h("div", { class: `rounded-lg border ${border}` }, headline);

  const evidence: HTMLElement[] = [];
  if (item.action_input) evidence.push(
    h("div", {}, h("div", { class: "mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Input"),
      h("pre", { class: "m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted" }, item.action_input)));
  if (item.action_result) evidence.push(
    h("div", {}, h("div", { class: "mb-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint" }, "Outcome evidence"),
      h("pre", { class: "m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted" }, item.action_result)));
  return h("details", { class: `overflow-hidden rounded-lg border ${border}`, dataset: { actionId: String(item.action_id) } },
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

export function renderActivity(container: HTMLElement, channelId: number): void {
  panelLoading(container, "Activity", "Ops log for this channel — tools, escalations, and Skipper's background checks (not the chat stream).");
  void api<{ activity: ActivityItem[] }>(`/api/channels/${channelId}/activity`).then(({ activity }) => {
    let filter: ActivityFilter = "all";
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
          onclick: () => { filter = item.id; paint(); },
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
  }).catch((error) => panelError(container, error));
}

export function renderChannelSettings(container: HTMLElement, channel: Channel, onChanged: (deleted?: boolean) => void): void {
  const nameField = h("input", {
    class: "field font-mono",
    value: channel.name,
    autocomplete: "off",
    spellcheck: "false",
    disabled: channel.name === "main" || !channel.can_manage ? true : undefined,
  }) as HTMLInputElement;
  const purpose = h("textarea", { class: "field min-h-24" }, channel.purpose || "") as HTMLTextAreaElement;
  const provider = h("select", { class: "field" }, h("option", { value: "" }, "Loading providers…")) as HTMLSelectElement;
  const model = h("select", { class: "field" }, h("option", { value: channel.agent?.model || "" }, channel.agent?.model || "Choose a model")) as HTMLSelectElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  let loadSequence = 0;
  let modelLoading = false;
  let changeModelButton: HTMLButtonElement | null = null;
  let routedModels: RoutingModel[] = [];
  const providerKey = (item: RoutingModel): string => item.kind === "route" ? "routes" : String(item.providerType || item.providerName || "models");
  const loadModels = async (): Promise<void> => {
    const family = provider.value;
    const sequence = ++loadSequence;
    clear(model); model.append(h("option", { value: "" }, family ? "Choose a model" : "Choose a provider"));
    model.disabled = !family; modelLoading = false; if (changeModelButton) changeModelButton.disabled = !family;
    if (!family) return;
    try {
      if (!routedModels.length) routedModels = (await api<{ models: RoutingModel[] }>("/api/workspace/model-policy")).models;
      if (sequence !== loadSequence || provider.value !== family) return;
      const models = routedModels.filter((item) => providerKey(item) === family);
      clear(model); model.append(...models.map((item) => h("option", { value: item.id, selected: item.id === channel.agent?.model }, item.name || item.id)));
      status.textContent = `${models.length} models available.`;
    } catch (error) {
      if (sequence === loadSequence) status.textContent = (error as Error).message;
    } finally {
      if (sequence === loadSequence) { modelLoading = false; model.disabled = false; if (changeModelButton) changeModelButton.disabled = false; }
    }
  };
  provider.onchange = () => { void loadModels(); };
  void api<{ models: RoutingModel[] }>("/api/workspace/model-policy").then(({ models }) => {
    routedModels = models;
    const groups = new Map<string, string>();
    for (const item of models) groups.set(providerKey(item), item.kind === "route" ? "Named routes" : String(item.providerName || item.providerType || "Provider"));
    const current = models.find((item) => item.id === channel.agent?.model);
    clear(provider); provider.append(h("option", { value: "" }, "Choose a provider"), ...[...groups].map(([value, label]) => h("option", { value, selected: current ? providerKey(current) === value : false }, label)));
    void loadModels();
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
  const currentAvatar = channel.agent?.runtime?.avatar || "";
  const drawAvatarPreview = (value: string): void => {
    clear(avatarPreview);
    if (value.startsWith("color:")) {
      // Solid color is the entire avatar plate — no initials on top.
      avatarPreview.append(h("div", { class: "h-12 w-12 rounded-xl identity-solid", style: `background:${value.slice(6)}`, title: channel.agent?.name || "Agent" }));
    } else if (value.startsWith("data:image/") || value.startsWith("/")) {
      avatarPreview.append(h("img", { class: "h-12 w-12 rounded-xl object-cover identity-photo", src: value, alt: "Agent" }));
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
  const computer = channel.computer;
  const computerKind = computer?.backend === "apple" ? "Isolated Linux VM"
    : computer?.backend === "lxc" ? "Unprivileged LXC"
      : computer?.backend === "wsl" ? "Private WSL 2"
        : "Development backend";
  const computerCard = computer ? h("div", { class: "card p-4" },
    h("div", { class: "flex flex-wrap items-center gap-2" },
      h("h3", { class: "font-semibold text-fg" }, "This channel's computer"),
      h("span", { class: "chip border-accent/25" }, computerKind),
      h("span", { class: "chip" }, computer.observed_state)),
    h("p", { class: "mt-2 text-sm leading-6 text-muted" }, "Skipper provisions, wakes, monitors, updates, repairs, and sizes this computer automatically. The storage figure is 1Helm's managed writable allocation."),
    h("div", { class: "mt-3 grid gap-2 text-xs text-muted sm:grid-cols-4" },
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, `${computer.cpus} CPU${computer.cpus === 1 ? "" : "s"}`), "Automatically managed"),
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, `${Math.max(1, Math.round(computer.memory_bytes / 1073741824))} GiB RAM`), "Automatically managed"),
      h("div", {}, h("span", { class: "block font-semibold text-fg" }, `${Math.max(1, Math.round(computer.disk_bytes / 1073741824))} GiB storage`), "Managed writable allocation"),
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
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Agent avatar"), h("p", { class: "mt-1 text-sm text-muted" }, "Pick a flat color or upload a custom image for this resident agent.")),
      agentAvatar, h("div", { class: "mt-2" }, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Default colors"), avatarColorRow)),
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Serving model"), h("p", { class: "mt-1 text-sm text-muted" }, "The model provides replaceable intelligence. Changing it never creates a new agent or discards channel-owned state.")),
      h("div", { class: "grid grid-cols-1 gap-3 sm:grid-cols-2" }, provider, model),
      h("div", { class: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, S.me.is_admin ? changeModelButton : null)),
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Permanent skill arsenal"), h("p", { class: "mt-1 text-sm text-muted" }, "Skipper provisioned these skills for this agent. New grants stay permanently, and the agent still knows what else exists in the workspace catalog."), assignedSkills),
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Capabilities"), h("div", { class: "mt-3 flex flex-wrap gap-2" }, ...(channel.agent?.capabilities || []).map((capability) => h("span", { class: "chip" }, capability))), h("p", { class: "mt-3 text-xs text-muted" }, "The resident agent is channel-scoped. It calls @skipper for host-level, cross-channel, credential, guest-expert, or missing-capability work.")),
    computerCard,
    lifecycle));
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
