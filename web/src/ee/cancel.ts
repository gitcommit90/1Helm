// Cancel plan (Captain 10-06): "If a user cancels, cancel at the end of their paid period, with reminders leading up to it that their
// data will be fully deleted with no recovery option because we don't store your data. No refunds. No trials."
// Settings → Usage: a quiet "Cancel plan" → our ask() names the date the plan ends and says everything is then permanently deleted,
// no recovery, no refunds → 1HC sets Stripe cancel_at_period_end (src/cancel.js). While cancelling, a banner across the top of the
// app: "Your plan ends on <date>. Everything will be permanently deleted then." with Keep my plan (also in Settings → Usage).
// v3.ts only hooks in: bcxUsage() inside the usage card, bcxInit() once. Sandbox (no 1HC): the same flow on a pretend plan.
import { ask } from "../dialog";

type State = { cancelling: boolean; ends_at?: number };
type Deps = {
  api: ((path: string, body?: any) => Promise<any>) | null;   // null: design sandbox, a pretend plan
  repaint: () => void;                                        // Settings, if it's open
  note: (title: string, sub: string) => void;
};
let D: Deps | null = null;
let ST: State = { cancelling: false };
let busy = "";

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
export const bcxDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });

// Sandbox: a plan that renews in 18 days.
let mockEnd = 0;
async function mock(path: string, body?: any): Promise<any> {
  await new Promise(z => setTimeout(z, 350));
  if (!mockEnd) mockEnd = Date.now() + 18 * 86400e3;
  if (path.startsWith("/plan/cancel") && body === undefined) return { ...ST, can_cancel: true, period_end: mockEnd };
  if (path === "/plan/cancel") return { cancelling: true, ends_at: mockEnd };
  if (path === "/plan/keep") return { cancelling: false };
  return { error: "unknown" };
}
const call = (path: string, body?: any) => (D?.api || mock)(path, body);

function set(s: State) {
  ST = s.cancelling && s.ends_at ? { cancelling: true, ends_at: s.ends_at } : { cancelling: false };
  banner(); D?.repaint();
}

// ---------- the banner ----------
function banner() {
  let el = document.getElementById("bcxbar");
  if (!ST.cancelling) { el?.remove(); document.body.classList.remove("bcx-on"); document.documentElement.style.removeProperty("--bcxh"); return; }
  if (!el) {
    el = document.createElement("div"); el.id = "bcxbar"; el.setAttribute("role", "status");
    document.body.prepend(el);
    new ResizeObserver(() => { const h = document.getElementById("bcxbar")?.offsetHeight; if (h) document.documentElement.style.setProperty("--bcxh", `${h}px`); }).observe(el);
  }
  el.innerHTML = `<span class="bcxi" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3 2"/></svg></span>
    <span class="bcxt"><b>Your plan ends on ${esc(bcxDate(ST.ends_at!))}.</b> Everything will be permanently deleted then.</span>
    <button type="button" class="bcxkeep" data-bcxkeep${busy === "keep" ? ' aria-busy="true" disabled' : ""}>${busy === "keep" ? "Keeping…" : "Keep my plan"}</button>`;
  document.body.classList.add("bcx-on");
  document.documentElement.style.setProperty("--bcxh", `${el.offsetHeight}px`);
}

// ---------- Settings → Usage ----------
/** The usage card: "foot" = inside its button row (Cancel plan, on the right); "card" = under it (while cancelling: the end date and Keep my plan). */
export function bcxUsage(where: "foot" | "card"): string {
  if (where === "card") return !ST.cancelling ? "" : `<div class="bcxset"><p><b>Your plan ends on ${esc(bcxDate(ST.ends_at!))}.</b> Then your account and everything in it is permanently deleted. We don't keep a copy, so it can't be recovered.</p>
    <button type="button" class="sa blue" data-bcxkeep${busy === "keep" ? ' aria-busy="true" disabled' : ""}>${busy === "keep" ? "Keeping…" : "Keep my plan"}</button></div>`;
  return ST.cancelling ? "" : `<button type="button" class="sa mute bcxcan" data-bcxcancel${busy === "cancel" ? ' aria-busy="true" disabled' : ""}>${busy === "cancel" ? "One moment…" : "Cancel plan"}</button>`;
}

async function doCancel() {
  if (busy) return;
  busy = "cancel"; D?.repaint();
  let end = 0;
  try {
    const s = await call("/plan/cancel?fresh=1");
    if (s?.cancelling) { busy = ""; set(s); return; }
    if (!s?.can_cancel || !s.period_end) { busy = ""; D?.repaint(); D?.note("Can't cancel right now", s?.error || "There's no active plan to cancel. For help, use Contact us in Settings."); return; }
    end = s.period_end;
  } catch { busy = ""; D?.repaint(); D?.note("Can't cancel right now", "Try again in a minute."); return; }
  busy = ""; D?.repaint();
  const ok = await ask({ title: "Cancel your plan?",
    body: `Your plan stays active until ${bcxDate(end)}. Then your account and ALL of its data are permanently deleted: chats, tasks, files, notes and connected apps. We don't keep a copy, so nothing can be recovered. There are no refunds.`,
    confirm: "Cancel plan", cancel: "Keep my plan", danger: true });
  if (!ok) return;
  busy = "cancel"; D?.repaint();
  try {
    const r = await call("/plan/cancel", { tz: TZ });
    busy = "";
    if (r?.error || !r?.cancelling) { D?.repaint(); D?.note("Couldn't cancel", r?.error || "Try again in a minute."); return; }
    set(r);
    D?.note("Plan cancelled", `It ends on ${bcxDate(r.ends_at)}.`);
  } catch { busy = ""; D?.repaint(); D?.note("Couldn't cancel", "Try again in a minute."); }
}

async function doKeep() {
  if (busy) return;
  busy = "keep"; banner(); D?.repaint();
  try {
    const r = await call("/plan/keep", {});
    busy = "";
    if (r?.error) { banner(); D?.repaint(); D?.note("Couldn't keep your plan", r.error); return; }
    set({ cancelling: false });
    D?.note("You're keeping your plan", "Nothing will be deleted.");
  } catch { busy = ""; banner(); D?.repaint(); D?.note("Couldn't keep your plan", "Try again in a minute."); }
}

export function bcxInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-bcxcancel]")) { e.preventDefault(); doCancel(); }
    else if (t.closest("[data-bcxkeep]")) { e.preventDefault(); doKeep(); }
  });
  const load = () => call("/plan/cancel").then((s) => { if (s && !s.error && !!s.cancelling !== ST.cancelling) set(s); }).catch(() => {});
  load();
  // Cancelled or kept somewhere else (another tab, Stripe's page): catch up when the app comes back to the front.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !busy) load(); });
}
