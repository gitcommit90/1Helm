// Order by recent activity. A task's `updated` time is set by the server when the person sends a message (the turn starts) and again when the helper
// replies, finishes a helper or a live note, so one number covers activity from either side. Newest first; ties keep a fixed order by id.
export type Active = { id: any; updated: number };
export const byActivity = (a: Active, b: Active) => (Number(b.updated) || 0) - (Number(a.updated) || 0) || String(a.id).localeCompare(String(b.id));
export const sortByActivity = <T extends Active>(rows: T[]): T[] => [...rows].sort(byActivity);

// Channel rail groups: 0 General, 1 pinned, 2 channels with an unread reply (the yellow dot), 3 the rest.
export type RailChannel = { slug: string; pinned?: number; ord?: number; sessions: { done?: boolean; unread?: boolean; updated: number }[] };
const lit = (x: { done?: boolean; unread?: boolean }) => !x.done && !!x.unread;
export const unreadAt = (c: RailChannel) => c.sessions.reduce((m, x) => lit(x) ? Math.max(m, Number(x.updated) || 0) : m, 0);
export const chGroupOf = (c: RailChannel): 0 | 1 | 2 | 3 => c.slug === "main" ? 0 : c.pinned ? 1 : c.sessions.some(lit) ? 2 : 3;
/** Sorts the list in place: General, pinned (oldest pin first), channels with an unread reply (latest unread reply first), then the rest in creation order. */
export function sortRail<T extends RailChannel>(list: T[]): T[] {
  const k = (c: T) => { const g = chGroupOf(c); return [g, g === 1 ? c.pinned! : g === 2 ? -unreadAt(c) : c.ord ?? 0]; };
  return list.sort((a, b) => k(a)[0] - k(b)[0] || k(a)[1] - k(b)[1]);
}
/** A thin line where one group ends and the next begins. No line from General straight to the rest. */
export const railSepBefore = (list: RailChannel[], i: number) => i > 0 && chGroupOf(list[i - 1]) < chGroupOf(list[i]) && !(chGroupOf(list[i - 1]) === 0 && chGroupOf(list[i]) === 3);
