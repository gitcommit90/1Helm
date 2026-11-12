// Storage meter for an owner who pays Cloudflare directly. Billing controls live in ee/storage-billing.ts.
type Summary = { used: number; limit: number; pct: number; full: boolean; by: Record<string, number>; labels?: Record<string, string>; notice?: { title: string; text: string } | null };
type Deps = { api: ((path: string, body?: any) => Promise<any>) | null; repaint: () => void; openUsage: () => void; boot: () => Summary | null };
let D: Deps | null = null, current: Summary | null = null, loading = false;
const KINDS = ["files", "computer", "pages", "other"];
const LABEL: Record<string, string> = { files: "Files", computer: "Computer", pages: "Pages & shares", other: "Other" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function fmtBytes(b: number) {
  b = Math.max(0, Number(b) || 0);
  if (b >= 1e12) { const v = b / 1e12; return `${+v.toFixed(v >= 10 ? 0 : 1)} TB`; }
  if (b >= 1e9) { const v = b / 1e9; return `${v >= 100 ? Math.round(v) : +v.toFixed(1)} GB`; }
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}
async function load() {
  if (loading || !D?.api) return;
  loading = true;
  try { const r = await D.api("/storage"); if (r && typeof r.used === "number") current = r; } catch {}
  loading = false; D?.repaint();
}
export function storCard(): string {
  const d = current || D?.boot(); if (!d) return "";
  const pct = Math.max(0, Math.min(100, Number(d.pct) || 0)), warn = d.full ? " full" : pct >= 80 ? " warn" : "";
  const segs = KINDS.map(k => ({ k, w: d.limit ? Math.min(100, (d.by?.[k] || 0) / d.limit * 100) : 0 })).filter(s => s.w > 0);
  const line = d.full ? "Full. New files and computer saves are paused. Raise this server's storage limit or delete files you don't need. Nothing has been deleted."
    : pct >= 80 ? "Getting full. You can raise this server's storage limit or delete files you don't need." : "Files, the computer's saved work and published pages count toward this server's storage limit.";
  return `<div class="sc stc" id="stcard"><div class="susage"><div class="sut"><b>Storage</b><span class="stu${warn}">${esc(fmtBytes(d.used))} of ${esc(fmtBytes(d.limit))}</span></div>
    <p class="stline${warn}">${esc(line)}</p><div class="stbar${warn}" role="img" aria-label="${esc(`${fmtBytes(d.used)} of ${fmtBytes(d.limit)} used`)}">${segs.map(s => `<i class="stk-${s.k}" style="width:${s.w.toFixed(2)}%"></i>`).join("")}</div>
    <ul class="stleg">${KINDS.map(k => `<li><i class="stk-${k}" aria-hidden="true"></i><span>${esc(d.labels?.[k] || LABEL[k])}</span><b>${esc(fmtBytes(d.by?.[k] || 0))}</b></li>`).join("")}</ul></div></div>`;
}
function banner(title: string, text: string, seen = false) {
  document.getElementById("stnotice")?.remove();
  const el = document.createElement("div"); el.id = "stnotice"; el.setAttribute("role", "status");
  el.innerHTML = `<span class="stn-i" aria-hidden="true">●</span><p>${title ? `<b>${esc(title)}</b> ` : ""}${esc(text)}</p><span class="stn-b"><button type="button" class="stn-open" data-stnopen>View storage</button><button type="button" class="stn-x" data-stnx>Not now</button></span>`;
  (el as any)._seen = seen;
  document.body.appendChild(el);
}
export function storNotice(n: Summary["notice"]) { if (n?.text) banner(n.title, n.text, true); }
export function storFull(msg?: string) { banner("Your storage is full", msg || "Nothing new can be saved until you raise this server's storage limit or delete files you don't need. Nothing has been deleted."); load(); }
export function storInit(d: Deps) {
  D = d; current = d.boot(); load();
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement, open = t.closest("[data-stnopen]"), close = t.closest("[data-stnx]");
    if (!open && !close) return;
    e.preventDefault(); const el = document.getElementById("stnotice");
    if ((el as any)?._seen) D?.api?.("/storage/notice", {}).catch(() => {});
    el?.remove();
    if (open) { D?.openUsage(); setTimeout(() => document.getElementById("stcard")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60); }
  }, true);
}
