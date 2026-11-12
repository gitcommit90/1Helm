// 1HC plan usage meter and credit notices. The runaway guard remains core.
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Settings → Usage: the monthly plan allowance and credits. */
export function monthLine(month: any, fallbackPct: number) {
  if (!month) return { pct: fallbackPct, text: "" };
  return { pct: Math.max(0, Math.min(100, Number(month.pct) || 0)), text: `${month.used} of ${month.allowance} used this month.` };
}

/** The 50% / 80% credit notice and BYOK fallback notice. */
export function noticeShow(n: any) {
  if (!n?.text || document.getElementById("sgnotice")) return;
  const el = document.createElement("div"); el.id = "sgnotice"; el.setAttribute("role", "status");
  el.innerHTML = `<span class="sgn-i" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><p>${esc(n.text)}</p><button type="button" data-sgseen>Got it</button>`;
  document.body.appendChild(el);
}

export function sgBillingInit(api: (path: string, body?: any) => Promise<any>) {
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    if (!t.closest("[data-sgseen]")) return;
    e.preventDefault(); document.getElementById("sgnotice")?.remove();
    api("/usage/notice", {}).catch(() => {});
  }, true);
}
