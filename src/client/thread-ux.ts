type AgentReply = { id: number };
type ThreadRoot = { id: number };
type Request = <T = unknown>(path: string, options: { body: Record<string, unknown> }) => Promise<T>;
type Alert = (message: string) => Promise<unknown>;

export function handoffIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = '<path d="M3 12h9m-3-3 3 3-3 3"/><path d="M15 17V7m0 5h6m0-5v10"/>';
  return svg;
}

function legacyCopyText(value: string): boolean {
  const input = document.createElement("textarea"); input.value = value; input.style.position = "fixed"; input.style.opacity = "0";
  document.body.append(input); input.select();
  try { return document.execCommand("copy"); }
  catch { return false; }
  finally { input.remove(); }
}

export async function copyThreadNumber(button: HTMLButtonElement, threadNumber: number, makeIcon: (name: string, size: number) => Node, alert: Alert): Promise<void> {
  const value = String(threadNumber);
  let copied = false;
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); copied = true; }
    catch { /* Electron can expose Clipboard API while rejecting its write permission; use the synchronous renderer fallback. */ }
  }
  if (!copied) copied = legacyCopyText(value);
  if (!copied) { await alert(`Thread number: ${value}`); return; }
  button.title = "Copied"; button.setAttribute("aria-label", "Copied"); button.replaceChildren(makeIcon("check", 13));
  window.setTimeout(() => { if (!button.isConnected) return; button.title = "Copy thread number"; button.setAttribute("aria-label", "Copy thread number"); button.replaceChildren(makeIcon("copy", 13)); }, 1200);
}

export function createRetryAgentReply(request: Request, toast: (message: string) => void, alert: Alert): (message: AgentReply) => Promise<void> {
  const active = new Set<number>();
  return async (message) => {
    if (active.has(message.id)) return;
    active.add(message.id);
    try {
      const key = typeof crypto?.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await request(`/api/messages/${message.id}/retry`, { body: { idempotency_key: key } });
      toast("Retry started with the currently selected model");
    } catch (error) { await alert((error as Error).message); }
    finally { active.delete(message.id); }
  };
}

export async function handoffThread(button: HTMLButtonElement, rootId: number, confirm: (message: string) => Promise<boolean>, request: Request, accept: (root: ThreadRoot) => Promise<void>, toast: (message: string) => void, alert: Alert): Promise<void> {
  if (button.disabled || !(await confirm("Hand off this thread in a new thread?"))) return;
  button.disabled = true; button.setAttribute("aria-busy", "true");
  try {
    const result = await request<{ root: ThreadRoot }>(`/api/messages/${rootId}/handoff`, { body: {} });
    await accept(result.root);
    toast("Thread handed off for confirmation");
  } catch (error) { await alert((error as Error).message); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); }
}

type ThreadUxRuntime = { request: Request; toast: (message: string) => void; alert: Alert; confirm: (message: string) => Promise<boolean>; currentRoot: () => number | null; accept: (root: ThreadRoot) => Promise<void> };
let runtime: ThreadUxRuntime | null = null;
let configuredRetry: ((message: AgentReply) => Promise<void>) | null = null;
export function configureThreadUx(next: ThreadUxRuntime): void { runtime = next; configuredRetry = createRetryAgentReply(next.request, next.toast, next.alert); }
export async function retryAgentReply(message: AgentReply): Promise<void> { if (!configuredRetry) throw new Error("Thread UX is not initialized."); await configuredRetry(message); }
export async function handoffCurrentThread(button: HTMLButtonElement): Promise<void> { const rootId = runtime?.currentRoot(); if (!runtime || !rootId) return; await handoffThread(button, rootId, runtime.confirm, runtime.request, runtime.accept, runtime.toast, runtime.alert); }
export type SilentFollowupActivity = {
  turn_id: number;
  message_id: number;
  followup_id: number;
  source_followup_id: number | null;
  lineage_id: number;
  started_at: number;
  finished_at: number;
  state: string;
  continuation_disposition: string;
  continuation_evidence: string;
  continuation_followup_id: number | null;
  error: string;
  progress: Array<{ id: number; kind: "thinking" | "tool" | "status"; body: string; status: "running" | "complete" | "failed"; created: number; updated: number }>;
  progress_count: number;
};

type ThreadMessage = { id: number };
type Ui = {
  h: (...args: any[]) => HTMLElement;
  icon: (name: string, size?: number) => SVGElement;
  timeLabel: (timestamp: number) => string;
  sameDay: (a: number, b: number) => boolean;
  renderMessage: (message: any) => HTMLElement;
  renderProgress: (check: SilentFollowupActivity) => HTMLElement | null;
};

const groupOpen = new Map<string, boolean>();
const checkOpen = new Map<number, boolean>();

function statusFor(check: SilentFollowupActivity): { label: string; tone: string } {
  if (check.error || check.state === "failed") return { label: "Failed", tone: "text-danger" };
  if (check.continuation_disposition === "continued") return { label: "Re-armed", tone: "text-accent" };
  if (check.continuation_disposition === "completed") return { label: "Completed", tone: "text-ok" };
  if (check.continuation_disposition === "blocked") return { label: "Needs input", tone: "text-amber-600 dark:text-amber-300" };
  return { label: check.state ? check.state[0].toUpperCase() + check.state.slice(1) : "Checked", tone: "text-muted" };
}

function rangeFor(checks: SilentFollowupActivity[], ui: Ui): string {
  const first = checks[0].finished_at || checks[0].started_at;
  const last = checks[checks.length - 1].finished_at || checks[checks.length - 1].started_at;
  if (checks.length === 1) return ui.timeLabel(last);
  if (ui.sameDay(first, last)) return `${ui.timeLabel(first)}–${ui.timeLabel(last)}`;
  return `${new Date(first).toLocaleString()}–${new Date(last).toLocaleString()}`;
}

function renderCheck(check: SilentFollowupActivity, index: number, ui: Ui): HTMLElement {
  const { h } = ui;
  const status = statusFor(check);
  const evidence = check.error || check.continuation_evidence;
  const details = h("details", { class: "rounded-lg border border-line/80 bg-surface/80", dataset: { followupCheck: String(check.turn_id) }, open: checkOpen.get(check.turn_id) || undefined },
    h("summary", { class: "flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs hover:bg-hover/60" },
      h("span", { class: "w-14 shrink-0 font-mono text-[10px] text-faint" }, ui.timeLabel(check.finished_at || check.started_at)),
      h("span", { class: "min-w-0 flex-1 font-semibold text-fg" }, `Check ${index + 1}`),
      h("span", { class: `shrink-0 font-medium ${status.tone}` }, status.label)),
    h("div", { class: "border-t border-line/70 px-3 pb-3 pt-2" },
      evidence ? h("p", { class: `break-words text-xs leading-5 ${check.error ? "text-danger" : "text-muted"}` }, evidence) : null,
      ui.renderProgress(check))) as HTMLDetailsElement;
  details.addEventListener("toggle", () => checkOpen.set(check.turn_id, details.open));
  return details;
}

function renderGroup(checks: SilentFollowupActivity[], ui: Ui): HTMLElement {
  const { h } = ui;
  const first = checks[0];
  const latest = checks[checks.length - 1];
  const key = `${first.lineage_id}:${first.turn_id}`;
  const status = statusFor(latest);
  const details = h("details", {
    class: "mx-4 my-2 overflow-hidden rounded-xl border border-accent/25 bg-raised/45 shadow-sm",
    dataset: { followupActivity: key }, open: groupOpen.get(key) || undefined,
  },
    h("summary", { class: "flex cursor-pointer select-none items-center gap-3 px-3 py-3 hover:bg-hover/60" },
      h("span", { class: "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" }, ui.icon("history", 15)),
      h("span", { class: "min-w-0 flex-1" },
        h("span", { class: "block text-xs font-semibold text-fg" }, `Follow-up activity · ${checks.length} ${checks.length === 1 ? "check" : "checks"}`),
        h("span", { class: "mt-0.5 block truncate font-mono text-[10px] text-faint" }, rangeFor(checks, ui))),
      h("span", { class: `shrink-0 text-[10px] sm:text-[11px] ${status.tone}` }, `Latest: ${status.label}`)),
    h("div", { class: "space-y-2 border-t border-line/70 p-2" }, ...checks.map((check, index) => renderCheck(check, index, ui)))) as HTMLDetailsElement;
  details.addEventListener("toggle", () => groupOpen.set(key, details.open));
  return details;
}

/** Merge visible replies and silent checks by their existing message ids. Only
 * adjacent checks in the same persisted follow-up lineage collapse together. */
export function renderThreadTimelineRows(messages: ThreadMessage[], activity: SilentFollowupActivity[], ui: Ui): HTMLElement[] {
  type Item = { kind: "message"; order: number; message: ThreadMessage } | { kind: "activity"; order: number; check: SilentFollowupActivity };
  const items: Item[] = [...messages.map((message) => ({ kind: "message" as const, order: message.id, message })), ...activity.map((check) => ({ kind: "activity" as const, order: check.message_id, check }))]
    .sort((a, b) => a.order - b.order || (a.kind === "message" ? -1 : 1));
  const rows: HTMLElement[] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index];
    if (item.kind === "message") { rows.push(ui.renderMessage(item.message)); index++; continue; }
    const checks = [item.check]; index++;
    while (index < items.length && items[index].kind === "activity" && (items[index] as Extract<Item, { kind: "activity" }>).check.lineage_id === item.check.lineage_id) {
      checks.push((items[index] as Extract<Item, { kind: "activity" }>).check); index++;
    }
    rows.push(renderGroup(checks, ui));
  }
  return rows;
}

/** Refresh helper for the live event path; it only re-reads the normal thread projection. */
export async function fetchSilentFollowupActivity(rootId: number, request: <T>(path: string) => Promise<T>): Promise<SilentFollowupActivity[]> {
  const data = await request<{ followup_activity?: SilentFollowupActivity[] }>(`/api/messages/${rootId}/thread?progress=summary`);
  return data.followup_activity || [];
}
