// The app's Scheduled list for one channel (boot and the poll): what is scheduled now, then recently ended jobs for its Past section.
// Ended = status complete (stopped by the person, finished, follow-up canceled or run, app event removed) or failed (stopped after errors).
// Bound: ended within the last 30 days, newest 20 per channel. The first part is exactly what the app showed before.
export const PAST_DAYS = 30, PAST_MAX = 20;
const live = (w) => (w.kind === "workflow" && (w.status === "active" || w.status === "paused")) || (w.kind === "followup" && w.status === "active");
const done = (w) => (w.status === "complete" || w.status === "failed") && (w.kind === "workflow" || w.kind === "followup");
// Plain reason an ended job ended, from its status and last_error (app-events.js writes "stopped: ..." / "couldn't be set up").
export function endedWhy(w) {
  const e = String(w.last_error || "");
  if (w.status === "failed") return "Stopped after errors";
  if (/^stopped:/.test(e)) return "Its app event was removed";
  if (/couldn't be set up/.test(e)) return "Couldn't be set up";
  if (w.max_runs > 0 && w.run_count >= w.max_runs) return "Finished";
  return w.kind === "followup" ? "Canceled" : "Stopped by you";
}
const view = (w) => ({ id: w.id, kind: w.kind, name: w.name, every: w.interval_seconds, when: w.when || null, next: w.next_run, runs: w.run_count, status: w.status, session: w.session || null,
  ...(w.event ? { on: w.event.label, account: w.event.account || null } : {}) });   // runs when an app event happens (app-events.js)
export function jobsView(wfs, now = Date.now()) {
  const past = wfs.filter(done).map((w) => ({ w, at: Number(w.updated || w.last_run || 0) })).filter((x) => x.at > now - PAST_DAYS * 86400e3).sort((a, b) => b.at - a.at).slice(0, PAST_MAX)
    .map(({ w, at }) => ({ ...view(w), next: null, ended: at, why: endedWhy(w) }));
  return [...wfs.filter(live).map(view), ...past];
}
