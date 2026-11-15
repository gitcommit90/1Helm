// Spend guard (1HC spendguard.js): what the person sees, in plain words, so a runaway never needs spotting.
//   · Paused card (stop.ts pausedNote): why it paused ("This looked like it was going in circles…  This task so far: about $0.18")
//     with Keep going (= stop.ts Continue: "Keep going." sent with continue=<card>, one more budget) and Stop here
//     (POST /res/<ch>/paused/<card>/stop: the card stops offering Keep going; what's done stays).
//   · "This task: about $0.03" under a task's messages (sessionDetail.usage, plus each finished turn's charge).
//     Dollars, not light/medium/heavy: the person can compare a task's cost with their provider bill.
export type Pause = { card: string; session: string; reason: string; status: string; title: string; line: string; spent: string };
type Deps = { api: (path: string, body?: any) => Promise<any>; repaint: () => void; unpause: (slug: string, sid: string, card: string, session?: any) => void; note: (t: string, s: string) => void; configureCheckins: () => void };
let D: Deps | null = null;
const P = new Map<string, Pause>();
const U = new Map<string, number>();
const BUSY = new Set<string>();
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const k = (slug: string, sid: any) => `${slug}|${sid}`;

export const pauseSet = (list: Pause[] | undefined) => { for (const p of list || []) if (p?.card) P.set(p.card, p); };
export const pauseOf = (card?: string) => card ? P.get(card) : undefined;
export const stopHereBusy = (card: string) => BUSY.has(card);

export const about = (nano: number) => !(nano > 0) ? "" : nano < 5e6 ? "less than a cent" : `about $${(nano / 1e9).toFixed(2)}`;
export const usageSet = (slug: string, sid: any, nano: number) => { U.set(k(slug, sid), Math.max(0, Number(nano) || 0)); };
export const usageAdd = (slug: string, sid: any, nano: number) => { if (nano > 0) U.set(k(slug, sid), (U.get(k(slug, sid)) || 0) + nano); };
/** Under a task's messages. Nothing until it has cost something. */
export function usageNote(slug: string, sid: any) {
  const a = about(U.get(k(slug, sid)) || 0); if (!a) return "";
  return `<div class="sg-usage" title="Estimated cost of this task so far">This task: ${esc(a)}</div>`;
}

export function sgInit(d: Deps) {
  D = d;
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-sgconfigure]')) { e.preventDefault(); e.stopPropagation(); D?.configureCheckins(); return; }
    const b = t.closest<HTMLElement>("[data-sgstop]"); if (!b || !D) return;
    e.preventDefault(); e.stopPropagation();
    const [slug, sid, card] = b.dataset.sgstop!.split("|"); if (BUSY.has(card)) return;
    BUSY.add(card); D.repaint();
    try {
      const r = await D.api(`/res/${slug}/paused/${card}/stop`, {});
      if (r?.error) D.note("Couldn't do that", String(r.error));
      else { if (r?.pause) P.set(card, r.pause); D.unpause(slug, sid, card, r?.session); }
    } catch (err: any) { D.note("Couldn't do that", err?.message || "Try again."); }
    finally { BUSY.delete(card); D.repaint(); }
  }, true);
}
