// Payment failed (Captain 10-06): "If payment fails, instantly it becomes readonly until its fixed." 1HC (src/pastdue.js) sends
// access = { mode: "read_only", reason: "payment_failed", message, delete_at } in the app's boot, in /state and with every refusal.
// While read-only:
//  - a banner across the top: "Your payment didn't go through. 1Helm is read-only until you update your card." + Fix payment
//    (POST /fix-payment → Stripe's page to pay the open bill with a new card, or the billing portal);
//  - every composer is disabled (its text box, attach, dictation, send later): reading, downloading and Stop still work.
// Fixed in another tab or on Stripe's page: caught up when the app comes back to the front. Sandbox (no 1HC): ?pastdue shows it.
// v3.ts only hooks in: pdInit() once, pdSet(access) when a request is refused with payment_required.
type Access = { mode?: string; status?: string; reason?: string; message?: string; delete_at?: number; paid_through?: number } | null;
type Deps = {
  api: ((path: string, body?: any) => Promise<any>) | null;   // null: design sandbox
  boot: () => any;
  note: (title: string, sub: string) => void;
};
let D: Deps | null = null;
let A: Access = null;
let busy = false;

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const MSG = "Your payment didn't go through. 1Helm is read-only until you update your card.";
const PH = "Read-only until you fix payment";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const pdReadOnly = () => A?.mode === "read_only";
const unpaid = () => pdReadOnly() && A?.reason === "payment_failed";

export function pdSet(a: Access) {
  const was = JSON.stringify(A); A = a && a.mode === "read_only" ? a : null;
  if (JSON.stringify(A) !== was) paint();
}

// ---------- the banner ----------
function banner() {
  let el = document.getElementById("pdbar");
  if (!pdReadOnly()) { el?.remove(); document.body.classList.remove("pd-on"); document.documentElement.style.removeProperty("--pdh"); return; }
  if (!el) {
    el = document.createElement("div"); el.id = "pdbar"; el.setAttribute("role", "alert");
    document.body.prepend(el);
    new ResizeObserver(() => { const h = document.getElementById("pdbar")?.offsetHeight; if (h) document.documentElement.style.setProperty("--pdh", `${h}px`); }).observe(el);
  }
  const text = unpaid() ? (A?.message || MSG) : (A?.message || "Your 1Helm plan isn't active, so 1Helm is read-only.");
  const when = unpaid() && A?.delete_at ? ` <span class="pdwhen">If it isn't fixed by ${esc(day(A.delete_at))}, everything is permanently deleted.</span>` : "";
  el.innerHTML = `<span class="pdi" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg></span>
    <span class="pdt"><b>${esc(text)}</b>${when}</span>
    <button type="button" class="pdfix" data-pdfix${busy ? ' aria-busy="true" disabled' : ""}>${busy ? "Opening…" : unpaid() ? "Fix payment" : "Reactivate"}</button>`;
  document.body.classList.add("pd-on");
  document.documentElement.style.setProperty("--pdh", `${el.offsetHeight}px`);
}

// ---------- composers: disabled while read-only ----------
function lock(f: HTMLFormElement, on: boolean) {
  f.classList.toggle("pd-off", on);
  const t = f.querySelector<HTMLTextAreaElement>("textarea");
  if (t) {
    if (on && t.dataset.pdph === undefined) { t.dataset.pdph = t.placeholder; t.placeholder = PH; }
    if (!on && t.dataset.pdph !== undefined) { t.placeholder = t.dataset.pdph; delete t.dataset.pdph; }
    t.disabled = on; t.setAttribute("aria-disabled", String(on));
  }
  // Stop stays: stopping work never costs anything.
  f.querySelectorAll<HTMLButtonElement>("button:not(.gostop)").forEach((b) => {
    if (on) { if (!b.disabled) { b.dataset.pdoff = "1"; b.disabled = true; } }
    else if (b.dataset.pdoff) { delete b.dataset.pdoff; b.disabled = b.id === "go" ? !(t?.value.trim()) : false; }
  });
}
function composers() {
  const on = pdReadOnly();
  document.querySelectorAll<HTMLFormElement>(on ? "form.composer:not(.pd-off)" : "form.composer.pd-off").forEach((f) => lock(f, on));
}
function paint() { banner(); composers(); }

async function fix() {
  if (busy) return;
  if (!D?.api) { D?.note("Fix payment", "On 1Helm this opens Stripe, where you update your card and pay."); return; }
  busy = true; banner();
  try {
    const r = await D.api("/fix-payment", {});
    if (r?.url) { location.assign(r.url); return; }
    D.note("Couldn't open the payment page", r?.error || "Try again in a minute. For help, use Contact us in Settings.");
  } catch { D.note("Couldn't open the payment page", "Try again in a minute."); }
  busy = false; banner();
}

export function pdInit(deps: Deps) {
  D = deps;
  const sandbox = !deps.api && new URLSearchParams(location.search).has("pastdue");
  pdSet(sandbox ? { mode: "read_only", status: "past_due", reason: "payment_failed", message: MSG, delete_at: Date.now() + 7 * 86400e3 } : deps.boot()?.access || null);
  document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-pdfix]")) { e.preventDefault(); fix(); } });
  addEventListener("pageshow", () => { if (busy) { busy = false; banner(); } });   // back from Stripe's page (bfcache)
  // Nothing goes out while read-only: a composer can't be submitted (Enter, a remembered draft, a card tap that types for you).
  document.addEventListener("submit", (e) => {
    if (!pdReadOnly() || !(e.target as HTMLElement).closest?.("form.composer, #nsend")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    D?.note(unpaid() ? "1Helm is read-only" : "Your plan isn't active", unpaid() ? "Fix payment at the top to update your card. Everything works again as soon as it goes through." : "Reactivate at the top to start again.");
  }, true);
  // Composers come and go with every render: lock each new one.
  new MutationObserver(() => { if (pdReadOnly()) composers(); }).observe(document.body, { childList: true, subtree: true });
  if (deps.api) document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || busy) return;
    deps.api!("/state").then((s) => { if (s && s.access) pdSet(s.access); }).catch(() => {});
  });
}
