// Meeting reminders for notes (the server's meetings.js, Captain 2026-10-08): "Your 2:00 “Weekly sync” is starting. Take notes?"
// - The push (service worker) opens #/meet/<id>; the in-app banner shows the same thing while the app is open: from a minute before
//   the meeting until 10 minutes after it started, until Take notes or Not now (Not now hides it on every device).
// - Take notes: the server makes one task named after the meeting (a second device gets the same one), the app opens it and shows
//   the Live notes Start sheet with "A meeting tab" picked (the browser's share picker opens from the sheet's Start tap).
// - The app asks GET /api/meetings/soon on open, every 3 minutes while it's visible and when it comes back (it also tells the server
//   the app is open and its time zone, so "2:00" is theirs); each reminder knows its own time, so the banner shows on time without
//   asking more often. A dev "view as" never asks or shows anything.
// v3.ts: mtInit(deps) once.
type Alert = { id: string; title: string; body: string; name: string; start_at: number; alert_at: number; link: string; app: string; taken: { channel: string; session: string } | null };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  open: (slug: string, sid: string, title: string) => void;   // add the task to its channel's list (if new) and go there
  start: (slug: string, sid: string) => Promise<void>;        // the Live notes Start sheet (a meeting tab picked)
  note: (title: string, sub: string) => void;
  look?: boolean;
};
let D: Deps | null = null;
const M = { list: [] as Alert[], skew: 0, at: 0, busy: "", gone: new Set<string>() };
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const CAL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 14v3l2 1"/></svg>';
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
export const MEET_HASH = /^#\/meet\/(ma[0-9a-f]{24})$/;

// The reminder to show now (pure): the first one not taken or put away, from its alert time to 10 minutes after its start.
export function dueAlert(list: Alert[], now: number, gone: Set<string> = new Set()): Alert | null {
  return list.find((a) => !a.taken && !gone.has(a.id) && now >= a.alert_at && now < a.start_at + 10 * 60e3) || null;
}

async function poll() {
  if (!D || D.look) return; M.at = Date.now();
  try { const r = await D.api(`/meetings/soon?tz=${encodeURIComponent(tz())}`); if (r && Array.isArray(r.alerts)) { M.list = r.on ? r.alerts : []; if (r.now) M.skew = r.now - Date.now(); paint(); } } catch {}
}
function paint() {
  const a = dueAlert(M.list, Date.now() + M.skew, M.gone);
  let el = document.getElementById("mtban");
  if (!a) { el?.remove(); return; }
  const sig = `${a.id}|${M.busy}`;
  if (el?.dataset.sig === sig) return;
  if (!el) { el = document.createElement("div"); el.id = "mtban"; document.body.appendChild(el); }
  el.dataset.sig = sig; el.className = "mt-ban"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-labelledby", "mtbt"); el.setAttribute("aria-describedby", "mtbd");
  el.innerHTML = `<span class="mt-ic">${CAL}</span><div class="mt-tx"><b id="mtbt">${esc(a.title)}.</b><span id="mtbd">Take notes?</span></div><div class="mt-acts"><button type="button" class="mt-go" data-mtgo="${esc(a.id)}"${M.busy ? " disabled" : ""}>${M.busy === a.id ? "Opening…" : "Take notes"}</button><button type="button" class="mt-no" data-mtno="${esc(a.id)}"${M.busy ? " disabled" : ""}>Not now</button></div>`;
}
// Take notes on a reminder: its task (made once), opened, then the Start sheet.
async function take(id: string) {
  if (!D || M.busy) return; M.busy = id; paint();
  try {
    const r = await D.api(`/meetings/${id}/take`, {});
    if (!r || r.error || !r.session) { D.note("Couldn't open that meeting", r?.error === "payment_required" ? (r.message || "1Helm is read-only right now.") : r?.error || "Try again in a moment."); return; }
    M.gone.add(id); const a = M.list.find((x) => x.id === id); if (a) a.taken = { channel: r.channel, session: r.session }; paint();
    D.open(r.channel, r.session, r.title || "Meeting");
    // the task's header (and its Live notes button) is there once the task view has painted
    for (let i = 0; i < 40 && !document.querySelector(`[data-lnbtn="${CSS.escape(`${r.channel}|${r.session}`)}"]`); i++) await new Promise((z) => setTimeout(z, 100));
    await D.start(r.channel, r.session);
  } catch { D.note("Couldn't open that meeting", "Check your connection and try again."); }
  finally { M.busy = ""; paint(); }
}
async function later(id: string) { M.gone.add(id); paint(); try { await D?.api(`/meetings/${id}/dismiss`, {}); } catch {} }
// #/meet/<id> (a tapped notification): Take notes on it.
function route() { const m = location.hash.match(MEET_HASH); if (m) void take(m[1]); }

export function mtInit(d: Deps) {
  D = d; if (d.look) return;
  setTimeout(poll, 2500);
  setInterval(() => { if (document.visibilityState === "visible" && Date.now() - M.at > 3 * 60e3) void poll(); }, 30e3);
  setInterval(paint, 5000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - M.at > 60e3) void poll(); paint(); });
  window.addEventListener("hashchange", route); setTimeout(route, 300);
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const g = t.closest<HTMLElement>("[data-mtgo]"); if (g) { e.preventDefault(); void take(g.dataset.mtgo!); return; }
    const n = t.closest<HTMLElement>("[data-mtno]"); if (n) { e.preventDefault(); void later(n.dataset.mtno!); }
  });
}
// Tests / the design sandbox: show a reminder without the server.
export function mtSeed(list: Alert[]) { M.list = list; M.skew = 0; paint(); }
