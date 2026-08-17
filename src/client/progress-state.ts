type ProgressItem = {
  id: number;
  kind: "thinking" | "tool" | "status";
  body: string;
  status: "running" | "complete" | "failed";
  created: number;
  updated: number;
};
type ProgressMessage = { id: number; progress?: ProgressItem[]; progress_count?: number };

/** Work-log interaction state survives full message-list re-renders. */
export const progressOpenByMessage = new Map<number, boolean>();
export const progressStepOpen = new Map<string, boolean>(); // `${messageId}:${progressId}`
export const progressTimelineItems = new Map<number, ProgressItem[]>();
export const progressTimelineScroll = new Map<number, { top: number; stick: boolean }>();

/** Deleted SQLite row ids may be reused. Never let an old message's expanded
 * work log attach to a later message that receives the same numeric id. */
export function clearProgressState(messageIds?: Iterable<number>): void {
  if (!messageIds) {
    progressOpenByMessage.clear();
    progressStepOpen.clear();
    progressTimelineItems.clear();
    progressTimelineScroll.clear();
    return;
  }
  const ids = new Set(Array.from(messageIds, Number));
  for (const id of ids) {
    progressOpenByMessage.delete(id);
    progressTimelineItems.delete(id);
    progressTimelineScroll.delete(id);
  }
  for (const key of progressStepOpen.keys()) {
    if (ids.has(Number(key.slice(0, key.indexOf(":"))))) progressStepOpen.delete(key);
  }
}

export function retainLoadedProgress<T extends ProgressMessage>(prior: T | undefined, next: T): T {
  const priorItems = progressTimelineItems.get(next.id) || prior?.progress || [];
  const nextItems = next.progress || [];
  if (priorItems.length <= nextItems.length || Number(next.progress_count || 0) < priorItems.length) return next;
  const incoming = new Map(nextItems.map((item) => [item.id, item]));
  const merged = priorItems.map((item) => incoming.get(item.id)
    || (item.status === "running" ? { ...item, status: "complete" as const } : item));
  for (const item of nextItems) if (!priorItems.some((priorItem) => priorItem.id === item.id)) merged.push(item);
  merged.sort((a, b) => a.id - b.id);
  progressTimelineItems.set(next.id, merged);
  return { ...next, progress: merged };
}

export function snapshotProgressOpenState(root: ParentNode | null = document): void {
  root?.querySelectorAll("details.agent-progress[data-progress-for]").forEach((node) => {
    const el = node as HTMLDetailsElement;
    const id = Number(el.dataset.progressFor);
    if (!Number.isFinite(id)) return;
    progressOpenByMessage.set(id, el.open);
    const timeline = el.querySelector(".progress-timeline") as HTMLElement | null;
    if (timeline) {
      const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 48;
      progressTimelineScroll.set(id, { top: timeline.scrollTop, stick: nearBottom });
    }
  });
  root?.querySelectorAll("details.progress-step[data-step-key]").forEach((node) => {
    const el = node as HTMLDetailsElement;
    const key = el.dataset.stepKey;
    if (key) progressStepOpen.set(key, el.open);
  });
}
