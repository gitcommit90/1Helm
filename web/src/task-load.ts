// Loading a task's saved messages can fail (a slow server, a dropped phone connection). A failed load must never count as loaded:
// the task stays not-loaded, keeps whatever messages it already had, and is tried again when it is opened, when the app comes back
// to the foreground, and on the app's normal refresh, but not in a tight loop (a short wait between automatic tries).
export const LOAD_TRIES = 3;                 // tries in one load, with the waits below between them
export const LOAD_WAITS = [1000, 3000];      // ms to wait before the second and third try
export const LOAD_COOLDOWN = 10000;          // ms after a failed load before a repaint or refresh starts another one

type LoadState = { loaded?: boolean; loading?: boolean; loadFailAt?: number };

// True when a task should start loading now. force is for the person's own action (opening the task again, tapping Try again, coming back to the app).
export function loadDue(s: LoadState, now = Date.now(), force = false): boolean {
  if (s.loaded || s.loading) return false;
  return force || !s.loadFailAt || now - s.loadFailAt >= LOAD_COOLDOWN;
}

export const loadFailed = (s: LoadState & { messages: unknown[] }, now = Date.now()) => !s.loaded && !s.loading && !!s.loadFailAt && !s.messages.length && now >= s.loadFailAt;

// What a try needs from the page. A phone can freeze or hide the page for a while: the timeout of a try that was running then says nothing
// about the server, so that try doesn't count and runs again once the page is visible.
export type LoadEnv = { now: () => number; hidden: () => boolean; setTimer: (fn: () => void, ms: number) => any; clearTimer: (id: any) => void; onPause: (fn: () => void) => () => void; whenVisible: () => Promise<void> };
const browserEnv = (): LoadEnv => ({
  now: () => Date.now(), hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id),
  onPause: fn => { const v = () => { if (document.visibilityState === "hidden") fn(); }; document.addEventListener("visibilitychange", v); document.addEventListener("freeze", fn); return () => { document.removeEventListener("visibilitychange", v); document.removeEventListener("freeze", fn); }; },
  whenVisible: () => document.visibilityState !== "hidden" ? Promise.resolve() : new Promise(ok => { const v = () => { if (document.visibilityState !== "hidden") { document.removeEventListener("visibilitychange", v); ok(); } }; document.addEventListener("visibilitychange", v); }),
});
export const LOAD_LATE = 2000;   // ms a timer may fire after its time before the page is taken to have been frozen
const MAX_PAUSED = 20;           // paused tries in one load (each waits for the page to be visible)

// Runs one try after another with a timeout on each, waiting between them, and throws the last error when every try failed.
export async function withRetries<T>(run: (signal: AbortSignal) => Promise<T>, o: { tries?: number; waits?: number[]; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; env?: LoadEnv } = {}): Promise<T> {
  const tries = o.tries ?? LOAD_TRIES, waits = o.waits ?? LOAD_WAITS, ms = o.timeoutMs ?? 15000, env = o.env ?? browserEnv();
  const sleep = o.sleep ?? ((w: number) => new Promise<void>(r => setTimeout(r, w)));
  let err: unknown, paused = 0;
  for (let n = 0; n < tries;) {
    const ctl = new AbortController(), start = env.now();
    let interrupted = env.hidden();
    const off = env.onPause(() => { interrupted = true; });
    const timer = env.setTimer(() => { if (env.hidden() || env.now() - start > ms + LOAD_LATE) interrupted = true; ctl.abort(); }, ms);
    try { return await run(ctl.signal); }
    catch (e) {
      err = e;
      if (interrupted && paused++ < MAX_PAUSED) { await env.whenVisible(); continue; }   // not the server's fault: same try number, once visible
      n++; if (n < tries) await sleep(waits[Math.min(n - 1, waits.length - 1)] ?? 0);
    } finally { env.clearTimer(timer); off(); }
  }
  throw err;
}
