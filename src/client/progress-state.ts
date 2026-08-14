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
