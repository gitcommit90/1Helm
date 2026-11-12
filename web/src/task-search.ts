// Ranked task search in the channel sidebar (and the phone's task drawer). While the person types, the app filters locally and at once. After a pause the
// server ranks every task of the channel (title, the person's messages and the helper's replies), and the list shows those tasks, most likely first.
// This module owns only the timing and the stale-answer rule, so it can be tested without a page:
//   - input(channel, query) is called on every keystroke. It forgets any ranked list for another query, and starts one request after `delay` ms with no further input.
//   - an answer is used only if no input came after its request started (a newer keystroke makes every older answer stale, and aborts its request);
//   - a failed request is ignored, so the local result stays;
//   - ranked(channel, query) is the task ids to show for exactly that channel and query, or null when the local filter should show.
export type RankedHit = { id: string; score?: number; snippet?: string | null };
export type RankedSearch = {
  input(channel: string, query: string): void;
  ranked(channel: string, query: string): string[] | null;
  clear(): void;
};
export const MIN_QUERY = 2, DEFAULT_DELAY = 300;
export const normQuery = (q: string) => String(q ?? "").trim();
export function createRankedSearch(o: {
  fetchRanked: (channel: string, query: string, signal: AbortSignal) => Promise<RankedHit[]>;
  onChange: () => void;                 // a ranked list arrived: paint the lists again
  delay?: number;
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (t: any) => void;
}): RankedSearch {
  const setT = o.setTimer || ((fn, ms) => setTimeout(fn, ms)), clearT = o.clearTimer || ((t) => clearTimeout(t)), delay = o.delay ?? DEFAULT_DELAY;
  let seq = 0, timer: any = null, ctl: AbortController | null = null, shown: { ch: string; q: string; ids: string[] } | null = null;
  const stop = () => { if (timer != null) { clearT(timer); timer = null; } if (ctl) { ctl.abort(); ctl = null; } };
  return {
    input(ch, raw) {
      const q = normQuery(raw), mine = ++seq; stop();
      if (shown && (shown.ch !== ch || shown.q !== q)) shown = null;
      if ([...q].length < MIN_QUERY || (shown && shown.ch === ch && shown.q === q)) return;
      timer = setT(() => {
        timer = null; const c = new AbortController(); ctl = c;
        o.fetchRanked(ch, q, c.signal).then(hits => {
          if (mine !== seq || c.signal.aborted) return;   // the person typed since: this answer is for an older query
          ctl = null; shown = { ch, q, ids: hits.map(h => String(h.id)) }; o.onChange();
        }, () => { if (ctl === c) ctl = null; });          // a failed call keeps the local result, silently
      }, delay);
    },
    ranked(ch, raw) { const q = normQuery(raw); return shown && shown.ch === ch && shown.q === q ? shown.ids : null; },
    clear() { seq++; stop(); shown = null; },
  };
}
// The rows of a ranked answer: the tasks the channel has, in the server's order. An id the app does not know yet is skipped.
export function rankedRows<T extends { id: string }>(sessions: T[], ids: string[]): T[] {
  const by = new Map(sessions.map(s => [s.id, s])); return ids.map(id => by.get(id)).filter((s): s is T => !!s);
}
