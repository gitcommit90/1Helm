type Message = { id: number; channel_id: number; parent_id: number | null; body: string; created: number; reply_count: number; last_reply: number | null; author: unknown; attachments: unknown[]; workflow_id?: number | null };
type ApiOptions = { method?: string; body?: unknown };
type WorkflowUiDeps = {
  api: <T>(path: string, options?: ApiOptions) => Promise<T>;
  h: any;
  clear: (element: Element) => void;
  icon: (name: string, size?: number) => SVGElement;
  md: (source: string) => string;
  timeLabel: (timestamp: number) => string;
};
let ui: WorkflowUiDeps;
export function configureWorkflowUi(value: WorkflowUiDeps): void { ui = value; }
const api = <T>(path: string, options?: ApiOptions): Promise<T> => ui.api<T>(path, options);
const h = (tag: string, attrs?: Record<string, unknown>, ...children: any[]): HTMLElement => ui.h(tag, attrs, ...children);
const clear = (element: Element): void => ui.clear(element);
const icon = (name: string, size?: number): SVGElement => ui.icon(name, size);
const md = (source: string): string => ui.md(source);
const timeLabel = (timestamp: number): string => ui.timeLabel(timestamp);

export type WorkflowRefreshOptions = {
  preserveExisting?: boolean;
  isCurrent?: () => boolean;
  onPaint?: () => void;
};

type AgentWorkflow = { id: number; channel_id: number; agent_id: number; name: string; prompt: string; interval_seconds: number; next_run: number; last_run: number | null; run_count: number; max_runs: number; status: "active" | "paused" | "complete" | "failed"; last_error: string };
type WorkflowRun = Message & { thread: { id: number; status: string; title: string; summary: string; updated_at: number } | null };
type WorkflowModelChannel = { id: number; agent?: { kind?: string; workflow_model?: string } | null };
type WorkflowRoutingModel = { id: string; name?: string };

export function workflowModelSettings(channel: WorkflowModelChannel, isAdmin: boolean, onChanged: () => void): { card: HTMLElement | null; fill: (groups: Array<{ label: string; models: WorkflowRoutingModel[] }>) => void } {
  if (channel.agent?.kind !== "channel") return { card: null, fill: () => undefined };
  const select = h("select", { class: "field", "aria-label": "Workflow model", dataset: { continuityKey: `channel-settings-workflow-model-${channel.id}` } }, h("option", { value: "" }, "Follow channel model")) as HTMLSelectElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const save = async (): Promise<void> => {
    select.disabled = true;
    try { await api(`/api/channels/${channel.id}/agent-policy`, { method: "PATCH", body: { workflow_model: select.value } }); status.textContent = select.value ? "Future workflow runs will use this model." : "Workflows will follow the channel model."; onChanged(); }
    catch (error) { status.textContent = (error as Error).message; }
    finally { select.disabled = false; }
  };
  const card = h("div", { class: "card space-y-3 p-4" },
    h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Workflow model"), h("p", { class: "mt-1 text-sm text-muted" }, "Use a different model for every current and future recurring workflow run in this channel. Follow channel model keeps the current behavior.")),
    h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Model", select),
    h("div", { class: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, isAdmin ? h("button", { class: "btn-primary text-sm", onclick: () => { void save(); } }, "Save workflow model") : null));
  return { card, fill: (groups) => { clear(select); select.append(h("option", { value: "", selected: !channel.agent?.workflow_model }, "Follow channel model")); for (const group of groups) select.append(h("optgroup", { label: group.label }, ...group.models.map((model) => h("option", { value: model.id, selected: model.id === channel.agent?.workflow_model }, model.name || model.id)))); } };
}

export function skipperCallApprovalQuestions(message: any, onUpdated: () => void): HTMLElement | null {
  const interview = message.questions;
  if (interview?.kind !== "skipper_call_approval" || !interview.questions?.length) return null;
  const answer = interview.answers?.[0]?.values?.[0] || "";
  if (interview.status !== "pending") return h("div", { class: "mt-3 rounded-lg border border-line bg-raised/40 p-3" }, h("div", { class: "flex items-center gap-2 text-xs font-semibold text-fg" }, icon(answer === "Deny" ? "x" : "check", 14), answer || "Skipper call resolved"));
  const status = h("p", { class: "min-h-5 text-xs text-muted" }), buttons: HTMLButtonElement[] = [];
  const choose = async (label: string): Promise<void> => {
    buttons.forEach((button) => { button.disabled = true; }); status.textContent = "Saving…";
    try { const result = await api<{ questions?: unknown }>(`/api/messages/${message.id}/questions/answer`, { body: { answers: [{ question_id: "q1", values: [label], custom: "" }] } }); if (result.questions) { message.questions = result.questions; onUpdated(); } }
    catch (error) { status.textContent = (error as Error).message; buttons.forEach((button) => { button.disabled = false; }); }
  };
  return h("div", { class: "mt-3 rounded-xl border border-accent/30 bg-accent-soft p-3.5" }, h("div", { class: "flex items-center gap-2 font-semibold text-fg" }, icon("help", 16), "Call Skipper?"), h("p", { class: "mt-1 text-sm leading-5 text-muted" }, interview.intro || "This resident wants to call Skipper into the thread."), h("div", { class: "mt-3 flex flex-wrap gap-2" }, ...interview.questions[0].options.map((option: { label: string }) => { const button = h("button", { class: option.label === "Deny" ? "btn-subtle text-sm" : "btn-primary text-sm", type: "button", onclick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); void choose(option.label); } }, option.label) as HTMLButtonElement; buttons.push(button); return button; })), status);
}

const openWorkflowByChannel = new Map<number, number>();
const isCurrent = (options: WorkflowRefreshOptions): boolean => options.isCurrent?.() !== false;

/** Durable Captain grant shown in channel Settings; the runtime permission
 * question and this control operate on the same server record. */
export function channelTextingSettings(channelId: number, channelName: string, isAdmin: boolean): HTMLElement | null {
  if (channelName === "main") return null;
  const body = h("div", { class: "flex flex-wrap items-center gap-3" }, h("span", { class: "text-sm text-muted" }, "Loading…"));
  const card = h("div", { class: "card space-y-3 p-4" },
    h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Texting"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "When enabled, this channel's agent can send iMessages via Photon — always and only to the configured Captain phone. The agent can also request this itself with a one-time permission question.")), body);
  const paint = async (): Promise<void> => {
    try {
      const grant = await api<{ granted: boolean; created: number | null; photon_configured: boolean }>(`/api/channels/${channelId}/captain-texting`);
      clear(body);
      if (!grant.photon_configured) { body.append(h("span", { class: "text-sm text-muted" }, "Photon/iMessage is not connected. Connect it in Settings → Connections first.")); return; }
      body.append(h("div", { class: "flex flex-wrap items-center gap-3" },
        h("span", { class: `chip ${grant.granted ? "border-ok/30 bg-ok/10 text-ok" : "border-line text-muted"}` }, grant.granted ? "Enabled" : "Not enabled"),
        grant.granted && grant.created ? h("span", { class: "text-xs text-faint" }, `Granted ${timeLabel(grant.created)}`) : null,
        isAdmin ? h("button", { class: grant.granted ? "btn-subtle text-xs" : "btn-primary text-xs", type: "button", onclick: async () => {
          try { await api(`/api/channels/${channelId}/captain-texting`, { method: grant.granted ? "DELETE" : "POST" }); await paint(); }
          catch (value) { clear(body); body.append(h("span", { class: "text-sm text-danger" }, (value as Error).message)); }
        } }, grant.granted ? "Revoke" : "Enable texting") : null));
    } catch (value) { clear(body); body.append(h("span", { class: "text-sm text-danger" }, (value as Error).message)); }
  };
  void paint();
  return card;
}

export function skipperCallSettings(channel: { id: number; name: string; can_manage?: boolean; call_skipper_without_confirmation?: boolean }, onChanged: () => void): HTMLElement {
  const enabled = h("input", { type: "checkbox", checked: channel.call_skipper_without_confirmation !== false, class: "accent-accent", disabled: !channel.can_manage ? true : undefined }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  enabled.onchange = async () => {
    const next = enabled.checked; enabled.disabled = true; status.textContent = "Saving…";
    try { await api(`/api/channels/${channel.id}`, { method: "PATCH", body: { call_skipper_without_confirmation: next } }); status.textContent = next ? "Residents call Skipper immediately." : "Each thread asks before its first Skipper call."; onChanged(); }
    catch (error) { enabled.checked = !next; status.textContent = (error as Error).message; }
    finally { enabled.disabled = !channel.can_manage; }
  };
  return h("div", { class: "card space-y-3 p-4" },
    h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Skipper calls"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Turn this off to approve or deny calls from this resident inside each thread.")),
    h("label", { class: "flex items-center gap-3 rounded-lg border border-line bg-panel p-3 text-sm font-semibold text-fg" }, enabled, "Call Skipper without confirmation"), status);
}

function panel(container: HTMLElement, title: string, subtitle: string, content: HTMLElement): void {
  clear(container);
  container.append(h("div", { class: "mx-auto w-full max-w-5xl p-6" },
    h("div", { class: "mb-6" }, h("h2", { class: "font-display text-[1.75rem] leading-tight text-fg" }, title), h("p", { class: "mt-1.5 text-sm text-muted" }, subtitle)), content));
}
function loading(container: HTMLElement, title: string, subtitle: string): void { panel(container, title, subtitle, h("div", { class: "py-12 text-center text-sm text-muted" }, "Loading…")); }
function error(container: HTMLElement, value: unknown): void { container.replaceChildren(h("div", { class: "m-6 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger" }, (value as Error).message)); }
function empty(title: string, copy: string): HTMLElement { return h("div", { class: "py-14 text-center" }, h("div", { class: "font-display text-xl text-fg" }, title), h("p", { class: "mx-auto mt-2 max-w-md text-sm leading-6 text-muted" }, copy)); }

function cadence(seconds: number): string {
  if (seconds % 86_400 === 0) { const days = seconds / 86_400; return days === 1 ? "daily" : `every ${days} days`; }
  if (seconds % 3_600 === 0) { const hours = seconds / 3_600; return hours === 1 ? "hourly" : `every ${hours} hours`; }
  if (seconds % 60 === 0) { const minutes = seconds / 60; return minutes === 1 ? "every minute" : `every ${minutes} minutes`; }
  return `every ${seconds.toLocaleString()}s`;
}

function statusChip(status: string): HTMLElement {
  const tone = status === "active" || status === "open" ? "border-ok/30 bg-ok/10 text-ok" : status === "failed" ? "border-danger/30 bg-danger/10 text-danger" : "border-line text-muted";
  return h("span", { class: `chip shrink-0 text-xs ${tone}` }, status);
}

/** Sole visual home of recurring workflows and their chronological runs. */
export function renderWorkflows(container: HTMLElement, channelId: number, isAdmin: boolean, onOpenRun: (root: any) => void, refresh: WorkflowRefreshOptions = {}): void {
  const openId = openWorkflowByChannel.get(channelId);
  if (openId != null) { renderHistory(container, channelId, openId, isAdmin, onOpenRun, refresh); return; }
  const subtitle = "Recurring work, delivered here. Each run is a real session with the resident agent.";
  if (!refresh.preserveExisting) loading(container, "Workflows", subtitle);
  void api<{ workflows: AgentWorkflow[] }>(`/api/workflows?channel_id=${channelId}`).then(({ workflows }) => {
    if (!isCurrent(refresh)) return;
    const list = h("div", { class: "space-y-2" });
    if (!workflows.length) list.append(empty("No workflows yet", "Ask the resident to repeat an outcome on a schedule. Every run will land here."));
    for (const workflow of workflows) {
      const rerender = (): void => renderWorkflows(container, channelId, isAdmin, onOpenRun, { ...refresh, preserveExisting: false });
      const control = isAdmin && (workflow.status === "active" || workflow.status === "paused")
        ? h("button", {
          class: "btn-subtle shrink-0 text-xs", type: "button",
          onclick: async (event: MouseEvent) => {
            event.stopPropagation();
            try { await api(`/api/workflows/${workflow.id}`, { method: "PATCH", body: { channel_id: channelId, status: workflow.status === "active" ? "paused" : "active" } }); rerender(); }
            catch (value) { error(container, value); }
          },
        }, workflow.status === "active" ? "Pause" : "Resume") : null;
      list.append(h("article", { class: "card flex w-full min-w-0 items-start gap-2.5 p-3" },
        h("span", { class: "mt-0.5 shrink-0 text-accent" }, icon("history", 18)),
        h("button", { class: "min-w-0 flex-1 text-left", type: "button", dataset: { workflowOpen: String(workflow.id), continuityKey: `workflow-${workflow.id}` }, onclick: () => { openWorkflowByChannel.set(channelId, workflow.id); rerender(); } },
          h("div", { class: "flex min-w-0 items-center gap-2" }, h("span", { class: "truncate font-semibold text-fg hover:text-accent" }, workflow.name), statusChip(workflow.status)),
          h("div", { class: "mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted" }, workflow.prompt),
          h("div", { class: "mt-2 text-xs text-faint" }, `${cadence(workflow.interval_seconds)} · ${workflow.run_count}${workflow.max_runs ? ` / ${workflow.max_runs}` : ""} run${workflow.run_count === 1 ? "" : "s"}${workflow.status === "active" ? ` · next ${new Date(workflow.next_run).toLocaleString()}` : ""}${workflow.last_error ? ` · ${workflow.last_error}` : ""}`)),
        control));
    }
    panel(container, "Workflows", subtitle, list);
    refresh.onPaint?.();
  }).catch((value) => { if (isCurrent(refresh)) error(container, value); });
}

function renderHistory(container: HTMLElement, channelId: number, workflowId: number, isAdmin: boolean, onOpenRun: (root: any) => void, refresh: WorkflowRefreshOptions): void {
  if (!refresh.preserveExisting) loading(container, "Workflows", "Loading recent runs…");
  let loaded: WorkflowRun[] = [];
  let workflow: AgentWorkflow | null = null;
  let total = 0;
  let hasMore = false;
  const paint = (loadingOlder = false, previousHeight = 0): void => {
    if (!workflow || !isCurrent(refresh)) return;
    const back = h("button", { class: "btn-subtle min-h-9 shrink-0 text-xs", type: "button", onclick: () => { openWorkflowByChannel.delete(channelId); renderWorkflows(container, channelId, isAdmin, onOpenRun, { ...refresh, preserveExisting: false }); } }, "← All workflows");
    const list = h("div", { class: "space-y-2" });
    if (!loaded.length) list.append(empty("No runs yet", workflow.status === "active" ? `First run ${new Date(workflow.next_run).toLocaleString()}.` : "This workflow has not produced a run."));
    if (hasMore) {
      const older = h("button", { class: "btn-subtle mx-auto flex min-h-9 text-xs", type: "button", disabled: loadingOlder }, loadingOlder ? "Loading older runs…" : "Load 50 older runs") as HTMLButtonElement;
      older.onclick = async () => {
        const before = loaded[0]?.id;
        if (!before) return;
        older.disabled = true; older.textContent = "Loading older runs…";
        const oldHeight = container.scrollHeight;
        try {
          const page = await api<{ workflow: AgentWorkflow; runs: WorkflowRun[]; total: number; has_more: boolean }>(`/api/workflows/${workflowId}/runs?limit=50&before=${before}`);
          if (!isCurrent(refresh)) return;
          loaded = [...page.runs, ...loaded]; total = page.total; hasMore = page.has_more;
          paint(false, oldHeight);
        } catch (value) { error(container, value); }
      };
      list.append(older);
    }
    const firstRunNumber = Math.max(1, total - loaded.length + 1);
    for (let i = 0; i < loaded.length; i++) {
      const run = loaded[i], previous = i > 0 ? loaded[i - 1] : null;
      if (!previous || new Date(previous.created).toDateString() !== new Date(run.created).toDateString()) list.append(h("div", { class: "flex items-center gap-3 pt-2" }, h("div", { class: "h-px flex-1 bg-line" }), h("span", { class: "shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint" }, new Date(run.created).toLocaleDateString()), h("div", { class: "h-px flex-1 bg-line" })));
      list.append(h("button", { class: "card block w-full min-w-0 p-3 text-left transition hover:border-accent/40", type: "button", dataset: { threadOpen: String(run.id), continuityKey: `workflow-run-${run.id}` }, onclick: () => onOpenRun(run) },
        h("div", { class: "flex flex-wrap items-center gap-2 text-xs text-faint" }, h("span", { class: "font-semibold text-fg" }, `Run ${firstRunNumber + i}`), h("span", {}, timeLabel(run.created)), run.thread ? statusChip(run.thread.status) : null, h("span", {}, `· ${run.reply_count} repl${run.reply_count === 1 ? "y" : "ies"}`)),
        h("div", { class: "md mt-1.5 line-clamp-3 text-[13px] leading-snug text-muted", html: md(run.thread?.summary || run.body || "No summary yet.") })));
    }
    const showing = total > loaded.length ? `showing latest ${loaded.length} of ${total} runs` : `${total} run${total === 1 ? "" : "s"}`;
    panel(container, workflow.name, `${cadence(workflow.interval_seconds)} · ${showing}`, h("div", { class: "space-y-3" }, back, list));
    if (previousHeight) requestAnimationFrame(() => { container.scrollTop += container.scrollHeight - previousHeight; });
    else if (!refresh.preserveExisting) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    refresh.onPaint?.();
  };
  void api<{ workflow: AgentWorkflow; runs: WorkflowRun[]; total: number; has_more: boolean }>(`/api/workflows/${workflowId}/runs?limit=50`).then((page) => {
    if (!isCurrent(refresh)) return;
    workflow = page.workflow; loaded = page.runs; total = page.total; hasMore = page.has_more; paint();
  }).catch((value) => { if (isCurrent(refresh)) error(container, value); });
}
