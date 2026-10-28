// Storage + plans in Settings → Usage (Captain 10-06): "any plan should be able to visualize their storage usage and just like usage
// credits, have a button to buy more storage/upgrade storage."
//   - A storage meter ("38.2 GB of 250 GB") with the breakdown by kind (Files, Computer, Pages & shares, Other).
//   - Add storage: "+100 GB for $2/month", a stepper for blocks, remove a block (refused below what's used, in plain words).
//   - Change plan: an in-app picker that shows each plan's included storage (Stripe's portal can't change a plan that also has storage).
//   - The one-time 80% / full notice, and the "storage is full" banner when an upload is refused, both with an Add storage button.
// 1HC side: src/storage.js + src/plan-change.js (GET /storage, POST /storage/blocks, /storage/notice, /plan/change {plan}).
// v3.ts only hooks in: storCard() under the usage card, storPlans() inside it, storInit() once, storNotice() at boot, storFull() on a 507.
// Sandbox (no 1HC): the same screens on a pretend Plus plan.
import { ask } from "../dialog";

type Plan = { key: string; name: string; price: number; usage: number; storage_gb: number; storage_text: string };
type Data = { used: number; limit: number; pct: number; full: boolean; by: Record<string, number>; labels?: Record<string, string>; included_gb: number; blocks: number; block_gb: number; block_usd: number;
  used_text?: string; limit_text?: string; notice?: { level: number; title: string; text: string } | null; plans?: Plan[]; plan?: string; next_plan?: { plan: string; name: string; at: number | null } | null };
type Deps = {
  api: ((path: string, body?: any) => Promise<any>) | null;   // null: design sandbox
  repaint: () => void;                                         // Settings, if open
  note: (title: string, sub: string, ok?: boolean) => void;
  openUsage: () => void;                                       // Settings → Usage (General on a computer, the top on a phone)
  planName: () => string;                                      // the current plan's name (boot)
  boot: () => any;                                             // BOOT.account.storage (summary) for the first paint
  reload: () => void;                                          // after an upgrade: reload with ?plan=changed
  switchToByok?: () => void;                                   // Change plan → Bring your own key is a switch now (byok-billing.ts asks, with the amounts)
};
let D: Deps | null = null;
let DATA: Data | null = null, loaded = false, loading = false;
const ST = { open: "" as "" | "add" | "plans", want: 0, busy: "", err: "" };

const GB = 1e9;
const KINDS = ["files", "computer", "pages", "other"];
const LABEL: Record<string, string> = { files: "Files", computer: "Computer", pages: "Pages & shares", other: "Other" };
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function fmtBytes(b: number) {
  b = Math.max(0, Number(b) || 0);
  if (b >= 1000 * GB) { const v = b / (1000 * GB); return `${+v.toFixed(v >= 10 ? 0 : 1)} TB`; }
  if (b >= GB) { const v = b / GB; return `${v >= 100 ? Math.round(v) : +v.toFixed(1)} GB`; }
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}
const gbText = (gb: number) => gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000} TB` : `${gb} GB`;
const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" });

// ---------- sandbox ----------
const MOCK_PLANS: Plan[] = [["personal", "Personal", 30, 20, 100], ["plus", "Plus", 50, 40, 250], ["power", "Power", 90, 80, 500], ["max", "Max", 170, 160, 1000], ["byok", "Bring your own key", 10, 0, 100]]
  .map(([key, name, price, usage, gb]) => ({ key, name, price, usage, storage_gb: gb, storage_text: gbText(gb as number) } as Plan));
let mockD: Data = { used: 38.2e9, limit: 250e9, pct: 15.2, full: false, by: { files: 30.1e9, computer: 6e9, pages: 1.2e9, other: 0.9e9 }, included_gb: 250, blocks: 0, block_gb: 100, block_usd: 2, plans: MOCK_PLANS, plan: "plus", next_plan: null };
async function mock(path: string, body?: any): Promise<any> {
  await new Promise(z => setTimeout(z, 350));
  const lim = () => { mockD.limit = (mockD.included_gb + mockD.blocks * 100) * GB; mockD.pct = Math.floor(mockD.used / mockD.limit * 1000) / 10; mockD.full = mockD.used >= mockD.limit; };
  if (path === "/storage" && body === undefined) return { ...mockD };
  if (path === "/storage/blocks") { const w = Number(body.blocks); if ((mockD.included_gb + w * 100) * GB < mockD.used) return { error: "You're using more than that." }; mockD.blocks = w; lim(); return { ok: true, blocks: w, storage: { ...mockD } }; }
  if (path === "/plan/change") { const p = MOCK_PLANS.find(x => x.key === body.plan)!, cur = MOCK_PLANS.find(x => x.key === mockD.plan)!;
    if (p.price > cur.price) { mockD.plan = p.key; mockD.included_gb = p.storage_gb; mockD.next_plan = null; lim(); return { ok: true, upgraded: true, plan: p.key }; }
    mockD.next_plan = p.key === cur.key ? null : { plan: p.key, name: p.name, at: Date.now() + 18 * 86400e3 }; return { ok: true, plan: p.key, ...(p.key === cur.key ? { kept: true } : { scheduled: true, from: mockD.next_plan!.at }) }; }
  if (path === "/storage/notice") return { ok: true };
  return { error: "unknown" };
}
const call = (path: string, body?: any) => (D?.api || mock)(path, body);

function data(): Data | null { return DATA || (D?.api ? D.boot() : mockD) || null; }
let lastTry = 0;
async function load(force = false) {
  if (loading || (loaded && !force) || (!force && Date.now() - lastTry < 30e3)) return; loading = true; lastTry = Date.now();   // a failing fetch isn't retried on every repaint
  try { const d = await call("/storage"); if (d && !d.error && typeof d.used === "number") { DATA = d; loaded = true; } } catch {}
  loading = false; D?.repaint();
}

// ---------- the card ----------
/** Settings → Usage: the storage meter, its breakdown, and Add storage (with the block stepper when open). */
export function storCard(): string {
  if (!loaded) load();
  const d = data(); if (!d) return "";
  const pct = Math.max(0, Math.min(100, d.pct || 0)), warn = d.full ? " full" : pct >= 80 ? " warn" : "";
  const segs = KINDS.map(k => ({ k, w: d.limit ? Math.min(100, (d.by?.[k] || 0) / d.limit * 100) : 0 })).filter(s => s.w > 0);
  const extra = d.blocks ? ` + ${d.blocks} × ${d.block_gb} GB extra ($${d.blocks * d.block_usd}/month)` : "";
  const line = d.full ? "Full. New files and computer saves are paused until you add storage or delete files you don't need. Nothing has been deleted."
    : pct >= 80 ? `Getting full. Your plan includes ${gbText(d.included_gb)}${extra}.` : `Your plan includes ${gbText(d.included_gb)}${extra}. Files, the computer's saved work and published pages all count.`;
  return `<div class="sc stc" id="stcard"><div class="susage"><div class="sut"><b>Storage</b><span class="stu${warn}">${esc(fmtBytes(d.used))} of ${esc(fmtBytes(d.limit))}</span></div>
      <p class="stline${warn}">${esc(line)}</p>
      <div class="stbar${warn}" role="img" aria-label="${esc(`${fmtBytes(d.used)} of ${fmtBytes(d.limit)} used`)}">${segs.map(s => `<i class="stk-${s.k}" style="width:${s.w.toFixed(2)}%"></i>`).join("")}</div>
      <ul class="stleg">${KINDS.map(k => `<li><i class="stk-${k}" aria-hidden="true"></i><span>${esc(d.labels?.[k] || LABEL[k])}</span><b>${esc(fmtBytes(d.by?.[k] || 0))}</b></li>`).join("")}</ul></div>
    <div class="sfoot"><button type="button" class="sa blue" data-stadd aria-expanded="${ST.open === "add"}">${d.blocks ? "Add or remove storage" : "Add storage"}</button></div>
    ${ST.open === "add" ? stepper(d) : ""}</div>`;
}
function stepper(d: Data): string {
  const cur = d.blocks, want = ST.want, diff = want - cur, total = (d.included_gb + want * d.block_gb) * GB;
  const below = want < cur && total < d.used;
  const btn = diff > 0 ? `Add ${diff * d.block_gb} GB · $${diff * d.block_usd}/month` : diff < 0 ? `Remove ${-diff * d.block_gb} GB` : "No change";
  return `<div class="stadd"><p class="stoffer"><b>+${d.block_gb} GB for $${d.block_usd}/month</b><span>Add or remove anytime. Adding is charged now for the rest of this month, then monthly with your plan. Removing credits your next bill.</span></p>
    <div class="ststep" role="group" aria-label="Extra storage"><button type="button" class="stpm" data-stm aria-label="One block less"${want <= 0 || ST.busy ? " disabled" : ""}>−</button>
      <output aria-live="polite"><b>${want ? `${want} × ${d.block_gb} GB` : "No extra storage"}</b><span>${want ? `$${want * d.block_usd}/month` : "Just what your plan includes"}</span></output>
      <button type="button" class="stpm" data-stp aria-label="One block more"${want >= 100 || ST.busy ? " disabled" : ""}>+</button></div>
    <p class="stsum">Your storage would be <b>${esc(fmtBytes(total))}</b>${below ? "" : `, with ${esc(fmtBytes(d.used))} used`}.</p>
    ${below ? `<p class="sterr" role="alert">You're using ${esc(fmtBytes(d.used))}, so your storage can't go below that. Delete files you don't need first, then remove the block.</p>` : ""}
    ${ST.err ? `<p class="sterr" role="alert">${esc(ST.err)}</p>` : ""}
    <div class="sbtns"><button type="button" class="sprim" data-stsave${!diff || below || ST.busy ? " disabled" : ""}${ST.busy === "blocks" ? ' aria-busy="true"' : ""}>${ST.busy === "blocks" ? "One moment…" : btn}</button><button type="button" class="sa" data-stclose>Cancel</button></div></div>`;
}

/** Inside the usage card: the plan picker (Change plan), each plan with its included storage. */
export function storPlans(): string {
  if (ST.open !== "plans") return "";
  if (!loaded) load();
  const d = data(), plans = d?.plans || [], cur = d?.plan || "";
  if (!plans.length) return `<div class="stplans"><p class="stmuted">${loaded ? "Plans aren't available right now. Try again in a minute." : "Loading plans…"}</p></div>`;
  const base = plans.find(p => p.key === "personal")?.usage || plans[0].usage, next = d?.next_plan;
  return `<div class="stplans" role="radiogroup" aria-label="Plans">${next ? `<p class="stnext">${esc(next.name)} starts${next.at ? ` on ${esc(dateText(next.at))}` : " on your next bill"}. You keep ${esc(plans.find(p => p.key === cur)?.name || "your plan")} until then.</p>` : ""}
    ${plans.map(p => { const on = p.key === cur, pend = next?.plan === p.key, x = p.usage / base;
      return `<button type="button" class="stplan${on ? " on" : ""}" role="radio" aria-checked="${on}" data-stplan="${esc(p.key)}"${ST.busy ? " disabled" : ""}>
        <span class="stpn"><b>${esc(p.name)}</b>${on ? `<em>Current</em>` : pend ? `<em class="pend">Next bill</em>` : ""}</span>
        <span class="stpd">${p.key === "byok" ? "AI on your own key, credits for the rest" : x === 1 ? "The base amount of usage" : `${x}× the usage of Personal`} · <b>${esc(p.storage_text)}</b> storage</span>
        <span class="stpp">$${p.price}<small>/month</small></span></button>`; }).join("")}
    <p class="stfine">Bigger plans start right away (you're charged the difference for the rest of this month). Smaller plans start on your next bill, except Bring your own key, which starts right away. ${D?.api ? `<button type="button" class="stlink" data-stbilling>Manage billing</button>` : ""}</p></div>`;
}
export const storPlansOpen = () => ST.open === "plans";
export function storTogglePlans() { ST.open = ST.open === "plans" ? "" : "plans"; ST.err = ""; if (ST.open) load(); D?.repaint(); }

// ---------- the banner: the 80% / full notice, and "storage is full" after a refused upload ----------
function banner(title: string, text: string, onSeen?: () => void) {
  document.getElementById("stnotice")?.remove();
  const el = document.createElement("div"); el.id = "stnotice"; el.setAttribute("role", "status");
  el.innerHTML = `<span class="stn-i" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></span>
    <p>${title ? `<b>${esc(title)}</b> ` : ""}${esc(text)}</p><span class="stn-b"><button type="button" class="stn-add" data-stnadd>Add storage</button><button type="button" class="stn-x" data-stnx>Not now</button></span>`;
  (el as any)._seen = onSeen;
  document.body.appendChild(el);
}
/** The one-time 80% / full notice from boot (account.storage.notice). */
export function storNotice(n: Data["notice"]) { if (n?.text) banner(n.title, n.text, () => { call("/storage/notice", {}).catch(() => {}); }); }
/** An upload (or anything else) was refused because storage is full (HTTP 507). */
export function storFull(msg?: string) { if (msg) banner("", msg); else banner("Your storage is full.", "Nothing new can be saved until you add storage or delete files you don't need. Nothing has been deleted."); load(true); }

// ---------- actions ----------
function openAdd() { const d = data(); if (!d) return; ST.open = "add"; ST.want = d.blocks + (d.full || d.pct >= 80 || !d.blocks ? 1 : 0); ST.err = ""; D?.repaint(); load(true); }   // fresh numbers while it's open
async function saveBlocks() {
  const d = data(); if (!d || ST.busy) return;
  const diff = ST.want - d.blocks; if (!diff) return;
  if (diff > 0) {
    const ok = await ask({ title: `Add ${diff * d.block_gb} GB of storage?`, body: `$${diff * d.block_usd}/month more, billed with your plan. You're charged now for the rest of this month. You can remove it anytime.`, confirm: `Add ${diff * d.block_gb} GB` });
    if (!ok) return;
  }
  ST.busy = "blocks"; ST.err = ""; D?.repaint();
  try {
    const r = await call("/storage/blocks", { blocks: ST.want });
    if (r?.error) { ST.err = r.error; if (r.storage) DATA = { ...(DATA || {}), ...r.storage } as Data; }
    else { DATA = { ...(DATA || {}), ...r.storage } as Data; ST.open = ""; document.getElementById("stnotice")?.remove();
      D?.note(diff > 0 ? "Storage added" : "Storage removed", `You now have ${fmtBytes(DATA!.limit)}${DATA!.blocks ? ` (${DATA!.blocks} × ${DATA!.block_gb} GB extra, $${DATA!.blocks * DATA!.block_usd}/month)` : ""}.`, true); }
  } catch { ST.err = "Couldn't change your storage. Try again in a minute."; }
  ST.busy = ""; D?.repaint();
}
async function pickPlan(key: string) {
  const d = data(); if (!d || ST.busy) return;
  const plans = d.plans || [], p = plans.find(x => x.key === key), cur = plans.find(x => x.key === d.plan); if (!p || !cur) return;
  const pending = d.next_plan?.plan;
  if (key === cur.key && !pending) return;
  // Bring your own key from a full plan starts right away and turns the unused plan usage into credits (byok.ts asks, with the amounts).
  if (key === "byok" && cur.key !== "byok" && D?.switchToByok) { D.switchToByok(); return; }
  const up = p.price > cur.price;
  // Bring your own key (byok.ts): what changes, and the zero-data-retention caveat, before they switch to or from it.
  const byok = key === "byok" ? " The AI then runs on your own key (add it in Settings → Use my own AI key), and the computer, browser and memory are paid from credits you add. 1Helm's zero-data-retention guarantee doesn't cover the AI part on your own key."
    : cur.key === "byok" && key !== cur.key ? " Your helper goes back to 1Helm's AI, and your own key is no longer used." : "";
  const ok = await ask(key === cur.key ? { title: `Stay on ${cur.name}?`, body: `Your switch to ${d.next_plan!.name} is cancelled. Nothing is charged.`, confirm: `Stay on ${cur.name}` }
    : up ? { title: `Switch to ${p.name}?`, body: `$${p.price}/month with ${p.storage_text} of storage. You're charged the difference for the rest of this month now, and get the extra usage and storage right away.${byok}`, confirm: `Switch to ${p.name}` }
    : { title: `Switch to ${p.name}?`, body: `$${p.price}/month with ${p.storage_text} of storage, from your next bill. You keep ${cur.name} until then. Nothing is charged now.${byok}`, confirm: `Switch to ${p.name}` });
  if (!ok) return;
  ST.busy = "plan"; ST.err = ""; D?.repaint();
  try {
    const r = await call("/plan/change", { plan: key });
    if (r?.error) D?.note("Your plan didn't change", r.error);
    else if (r.upgraded) { if (D?.api) { D.reload(); return; } D?.note(`You're on ${p.name}`, "The extra usage and storage apply right away.", true); }
    else if (r.kept) D?.note(`You're staying on ${cur.name}`, "Nothing changed on your bill.", true);
    else D?.note(`${p.name} starts on your next bill`, `${r.from ? `${dateText(r.from)}. ` : ""}You keep ${cur.name} until then.`, true);
    await load(true);
  } catch { D?.note("Your plan didn't change", "Try again in a minute."); }
  ST.busy = ""; D?.repaint();
}

export function storInit(d: Deps) {
  D = d;
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-stnadd]")) { e.preventDefault(); const el = document.getElementById("stnotice"); (el as any)?._seen?.(); el?.remove(); D?.openUsage(); setTimeout(() => { openAdd(); setTimeout(() => document.getElementById("stcard")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60); }, 30); return; }
    if (t.closest("[data-stnx]")) { e.preventDefault(); const el = document.getElementById("stnotice"); (el as any)?._seen?.(); el?.remove(); return; }
    if (t.closest("[data-stadd]")) { e.preventDefault(); if (ST.open === "add") { ST.open = ""; D?.repaint(); } else openAdd(); return; }
    if (t.closest("[data-stclose]")) { e.preventDefault(); ST.open = ""; ST.err = ""; D?.repaint(); return; }
    if (t.closest("[data-stp]")) { e.preventDefault(); ST.want = Math.min(100, ST.want + 1); ST.err = ""; D?.repaint(); return; }
    if (t.closest("[data-stm]")) { e.preventDefault(); ST.want = Math.max(0, ST.want - 1); ST.err = ""; D?.repaint(); return; }
    if (t.closest("[data-stsave]")) { e.preventDefault(); saveBlocks(); return; }
    const pl = t.closest<HTMLElement>("[data-stplan]"); if (pl) { e.preventDefault(); pickPlan(pl.dataset.stplan!); return; }
    if (t.closest("[data-stbilling]") && D?.api) {
      e.preventDefault(); const b = t.closest<HTMLElement>("[data-stbilling]")!; b.setAttribute("aria-busy", "true");
      try { const r = await D.api("/portal", {}); if (r?.url) location.assign(r.url); else D.note("Couldn't open billing", r?.error || "Try again in a minute."); }
      catch { D.note("Couldn't open billing", "Try again in a minute."); } finally { b.removeAttribute("aria-busy"); }
    }
  }, true);
}
