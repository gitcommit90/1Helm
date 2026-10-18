// Browser transport only. Closing a reader never sends Stop or replays a message.
export const STREAM_IDLE_MS = 45000, STREAM_HEADERS_MS = 15000, STREAM_CHECK_MS = 15000;
type State = { epoch: number; leases: Set<Lease>; progress: number; revision: number; checked: number; checking: boolean; waiting: string };
export type Lease = { state: State; epoch: number; controller: AbortController; pending: boolean };
const states = new WeakMap<object, State>();
export const streamState = (owner: object) => {
  let s = states.get(owner);
  if (!s) { s = { epoch: 0, leases: new Set(), progress: Date.now(), revision: 0, checked: 0, checking: false, waiting: "" }; states.set(owner, s); }
  return s;
};
export function streamLease(owner: object): Lease {
  const state = streamState(owner), lease = { state, epoch: state.epoch, controller: new AbortController(), pending: false };
  state.leases.add(lease); return lease;
}
export const streamCurrent = (lease: Lease) => lease.epoch === lease.state.epoch && !lease.controller.signal.aborted;
export const streamRelease = (lease: Lease) => { lease.state.leases.delete(lease); lease.controller.abort(); };
export function streamInvalidate(owner: object) {
  const state = streamState(owner); state.epoch++; state.waiting = "";
  for (const lease of state.leases) lease.controller.abort(); state.leases.clear();
}
export function streamProgress(owner: object, event: any) {
  if (event.t === "hb") return;
  const s = streamState(owner); s.progress = Date.now(); s.revision++; s.waiting = event.t === "model_wait" && event.phase === "waiting" ? "waiting" : "";
}
export function streamCheckDue(owner: object, server: any, now = Date.now()) {
  const s = streamState(owner);
  return !s.checking && ![...s.leases].some(l => l.pending) && now - s.checked >= STREAM_CHECK_MS && (server?.state !== "working" || now - s.progress >= STREAM_IDLE_MS);
}
export async function streamFetch(url: string, init: RequestInit, lease: Lease, deadline = Infinity, headersMs = STREAM_HEADERS_MS) {
  const controller = new AbortController(), ms = Math.min(headersMs, deadline - Date.now());
  if (ms <= 0) throw new Error("Connection check timed out");
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...init, signal: AbortSignal.any([lease.controller.signal, controller.signal]) }); }
  finally { clearTimeout(timer); }
}
async function readChunk(reader: ReadableStreamDefaultReader<string>, lease: Lease, ms: number) {
  if (ms <= 0) throw new Error("Connection check timed out");
  let timer: ReturnType<typeof setTimeout> | undefined, aborted: (() => void) | undefined;
  const read = reader.read();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Connection went quiet")), ms);
    aborted = () => reject(new Error("Connection replaced"));
    lease.controller.signal.addEventListener("abort", aborted, { once: true });
  });
  try { return await Promise.race([read, timeout]); }
  finally { clearTimeout(timer); if (aborted) lease.controller.signal.removeEventListener("abort", aborted); }
}
export async function streamErrorBody(response: Response, lease: Lease, budget = STREAM_HEADERS_MS): Promise<any> {
  if (!response.body) return {};
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(), deadline = Date.now() + budget;
  let text = "";
  try {
    while (streamCurrent(lease)) {
      const chunk = await readChunk(reader, lease, deadline - Date.now());
      if (chunk.done) return JSON.parse(text);
      text += chunk.value; if (text.length > 64000) return {};
    }
    return {};
  } catch { return {}; }
  finally { void reader.cancel().catch(() => {}); }
}
export async function readStream(response: Response, on: (event: any) => boolean | void, lease: Lease, options: { idleMs?: number; deadline?: () => number } = {}) {
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      if (!streamCurrent(lease)) return;
      const ms = Math.min(options.idleMs ?? STREAM_IDLE_MS, (options.deadline?.() ?? Infinity) - Date.now());
      const chunk = await readChunk(reader, lease, ms);
      if (!streamCurrent(lease)) return;
      if (chunk.done) return;
      buffer += chunk.value;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
        if (!line) continue;
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (!streamCurrent(lease)) return;
        if (on(event) === true) return; // terminal event is sufficient; never wait for a lost EOF
      }
    }
  } finally { void reader.cancel().catch(() => {}); }
}
