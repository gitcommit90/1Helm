// Copy and Reply on chat bubbles (the task view), and the reply pinned above the composer, like iMessage.
// Desktop: hovering (or tabbing into) a message shows two round buttons at its bubble's outer edge, in the empty side margin
// (never over its text, nothing moves). Touch: a tap on the bubble (or a long-press) opens the same two as a small labelled menu.
// Copy puts the message's text on the clipboard (plain text, cleaned of card code and Markdown marks, plus rich HTML for apps that
// paste formatting) and the button ticks "Copied". Reply pins a quote bar above the composer (who + the first lines + ✕); the next
// send carries it (v3.ts: liveReply → /stream {reply: {id, role, text}}) and the bar clears; Esc or ✕ cancels. The pin is kept per
// task (switch away and back: still there), in memory only. The sent message shows a small quote above it; tapping it scrolls
// to the original and flashes it.
// v3.ts hooks in: maActs() inside each bubble, maQuote() above a sent reply, rqHtml() above the composer, rqTake() on send,
// and maInit() once. The pure parts (copyPlain, excerpt) are tested in test/msgreply.test.mjs.

export type Role = "agent" | "user";
export type RRef = { id: string | null; role: Role; text: string };   // what the server gets (1HC reply-to.js)
export type Pin = RRef & { mr: number };   // + the local message id (scroll target in this page)
type Found = { mr: number; role: Role; id: string | null; plain: string; html: string };
type Deps = {
  key: () => string;   // the open task ("slug|sid"), "" elsewhere
  msg: (mr: number) => Found | null;   // a message of the open task by its local id
  locate: (r: { role: Role; id: string | null; text: string; mr?: number }) => number | null;   // a quote's original, by server id then text
  who: (role: Role) => string;   // "You" / the helper's name
  repaint: () => void;   // the open task's messages
  note: (title: string, sub: string) => void;
};
let D: Deps | null = null;

// ---------- pure: the text Copy puts on the clipboard, and the excerpt a reply quotes ----------
// body: the message as stored (Markdown, maybe with card code). cardText/scrubCode: genui-render's (cards → their words).
export function copyPlain(body: string, h: { cardText?: (s: string) => string; scrubCode?: (s: string) => string } = {}) {
  let t = String(body || "");
  t = (h.cardText?.(t) || h.scrubCode?.(t) || t);
  t = t.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1").replace(/<small>[\s\S]*?<\/small>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "");
  const out: string[] = []; let fence = false;
  for (let l of t.split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }   // code: keep the lines, drop the fences
    if (fence) { out.push(l); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push(""); continue; }   // a rule
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l)) continue;   // a table's divider row
    l = l.replace(/^(\s*)#{1,6}\s+/, "$1").replace(/^(\s*)>\s?/, "$1").replace(/^(\s*)[*+]\s+/, "$1- ");
    l = l.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)/g, (_, a: string, u: string) => a.trim() === u || a.trim() === u.replace(/^(https?:\/\/|mailto:)/, "") ? u : `${a} (${u})`)
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2").replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2").replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1").replace(/`([^`\n]+)`/g, "$1")
      .replace(/^(\s*)\|(.*)\|\s*$/, (_, a: string, b: string) => a + b.split("|").map(x => x.trim()).join("\t"));
    out.push(l.replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}
// One line, at most n characters (with …), for the quote bar, the sent quote and the helper's line.
export function excerpt(plain: string, n = 240) {
  const t = String(plain || "").replace(/^\s*[-*+•]\s+/gm, "").replace(/\s+/g, " ").trim();   // list bullets go; numbers stay ("the second one")
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

// ---------- HTML ----------
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>', 15),
  reply: svg('<path d="m9 14-5-5 5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>', 15),
  tick: svg('<path d="M20 6 9 17l-5-5"/>', 15),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 15),
};
const M = { open: null as number | null, copied: null as number | null, copiedT: 0 as any, top: 0 };   // the touch menu's message, the message whose Copy just ticked (local ids)
const PINS = new Map<string, Pin>();   // task → its pinned reply

// The two buttons, inside a bubble (absolutely placed: outside the bubble on desktop, a menu on touch). mr = local message id.
export function maActs(mr: number) {
  const c = M.copied === mr;
  return `<span class="mact" data-mact="${mr}"><button type="button" class="ma-copy${c ? " done" : ""}" data-macopy="${mr}" aria-label="${c ? "Copied" : "Copy message"}" title="${c ? "Copied" : "Copy"}">${c ? IC.tick : IC.copy}<span class="mal">${c ? "Copied" : "Copy"}</span></button><button type="button" class="ma-reply" data-mareply="${mr}" aria-label="Reply to this message" title="Reply">${IC.reply}<span class="mal">Reply</span></button></span>`;
}
// Class for a message whose touch menu is open (kept across repaints).
export const maOpenCls = (mr: number) => (M.open === mr ? " macts" : "");
// The quote above a sent reply. mr: the original's local id when this page knows it.
export function maQuote(r: { role: Role; id?: string | null; text: string; mr?: number } | undefined) {
  if (!r?.text || !D) return "";
  const who = D.who(r.role);
  return `<button type="button" class="mq" data-mq="${esc(r.role)}|${esc(r.id || "")}|${r.mr ?? ""}" data-mqt="${esc(r.text.slice(0, 120))}" aria-label="Replying to ${esc(who)}: ${esc(excerpt(r.text, 80))}. Show that message">${IC.reply}<span class="mqw">${esc(who)}</span><span class="mqt">${esc(excerpt(r.text, 120))}</span></button>`;
}
// The bar above the composer (its wrapper is always there, so a pin can paint into it).
export function rqHtml(key = D?.key() || "") {
  const p = key ? PINS.get(key) : undefined;
  return `<div class="rq" id="rq-box">${p && D ? rqInner(p) : ""}</div>`;
}
const rqInner = (p: Pin) => { const who = D!.who(p.role);
  return `<div class="rqin" role="group" aria-label="Replying to ${esc(who)}"><button type="button" class="rqq" data-mq="${p.role}|${esc(p.id || "")}|${p.mr}" data-mqt="${esc(p.text.slice(0, 120))}" title="Show that message"><span class="rqico">${IC.reply}</span><span class="rqtx"><b>Replying to ${esc(who)}</b><span>${esc(p.text)}</span></span></button><button type="button" class="rqx" data-rqx aria-label="Cancel reply" title="Cancel reply (Esc)">${IC.x}</button></div>`; };
function rqPaint() { const el = document.getElementById("rq-box"); if (el) el.outerHTML = rqHtml(); }
export const rqGet = (key = D?.key() || "") => (key ? PINS.get(key) || null : null);
export function rqClear(key = D?.key() || "") { if (PINS.delete(key)) rqPaint(); }
// On send: the pin of this task (and the bar clears). The server gets { id, role, text }.
export function rqTake(key = D?.key() || ""): Pin | null { const p = rqGet(key); if (p) { PINS.delete(key); rqPaint(); } return p; }
// Put a taken pin back (a send that couldn't go: "still uploading" and the like never take it; this is for a send-later that failed).
export function rqPut(key: string, p: Pin) { PINS.set(key, p); rqPaint(); }
export const refOf = (p: Pin | null | undefined): RRef | null => (p ? { id: p.id, role: p.role, text: p.text } : null);

// ---------- clipboard ----------
async function clip(plain: string, html: string) {
  try {
    const CI = (window as any).ClipboardItem;
    if (CI && navigator.clipboard?.write && html) { await navigator.clipboard.write([new CI({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]); return true; }
  } catch {}
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(plain); return true; } } catch {}
  try {   // older browsers / no permission: a hidden textarea and the copy command
    const ta = document.createElement("textarea"); ta.value = plain; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}
function say(t: string) {   // screen readers: "Copied"
  let el = document.getElementById("ma-live"); if (!el) { el = document.createElement("div"); el.id = "ma-live"; el.className = "sr-only"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  el.textContent = ""; setTimeout(() => { el!.textContent = t; }, 30);
}

// ---------- the touch menu ----------
// Our own repaints (menu open/close, Copied tick) keep the chat where it is: the chat's repaint snaps to the bottom when it's
// within 140px of it, and that scroll used to close the menu the moment a long-press opened it (a reply near the bottom).
function paint() {
  const sc = document.getElementById("scroll"), top = sc?.scrollTop ?? 0;
  D?.repaint(); if (sc && sc.scrollTop !== top) sc.scrollTop = top;
  M.top = sc?.scrollTop ?? 0;
}
function menuOpen(mr: number) {
  M.open = mr; paint();
  // Above the bubble when there's room in the scroller, else below it.
  requestAnimationFrame(() => {
    const m = document.querySelector<HTMLElement>(`.m[data-mr="${mr}"]`), sc = document.getElementById("scroll"), a = m?.querySelector<HTMLElement>(".mact"); if (!m || !a) return;
    const b = a.parentElement!.getBoundingClientRect(), top = sc ? sc.getBoundingClientRect().top : 0;
    a.classList.toggle("below", b.top - top < 56);
  });
}
function menuClose() { if (M.open == null) return; M.open = null; paint(); }
const TOUCH = () => matchMedia("(hover: none)").matches;
const INTERACTIVE = "a,button,input,select,textarea,label,summary,details,video,audio,img,.acard,.gu,.fcard,.mfiles,[data-fv],[role=button]";

export function maInit(deps: Deps) {
  if (D) { D = deps; return; } D = deps;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const cp = t.closest<HTMLElement>("[data-macopy]");
    if (cp) { e.preventDefault(); e.stopPropagation(); const mr = +cp.dataset.macopy!, f = D!.msg(mr); if (!f) return;
      void clip(f.plain, f.html).then(ok => {
        if (!ok) { D!.note("Couldn't copy", "Your browser didn't allow it. Select the text and copy it instead."); return; }
        M.copied = mr; M.open = null; clearTimeout(M.copiedT); paint(); say("Copied");
        M.copiedT = setTimeout(() => { if (M.copied === mr) { M.copied = null; paint(); } }, 1600);
      }); return; }
    const rp = t.closest<HTMLElement>("[data-mareply]");
    if (rp) { e.preventDefault(); e.stopPropagation(); const mr = +rp.dataset.mareply!, f = D!.msg(mr), key = D!.key(); if (!f || !key) return;
      PINS.set(key, { id: f.id, role: f.role, text: excerpt(f.plain), mr }); M.open = null; D!.repaint(); rqPaint();
      const b = document.getElementById("box") as HTMLTextAreaElement | null; if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
      return; }
    if (t.closest("[data-rqx]")) { e.preventDefault(); rqClear(); (document.getElementById("box") as HTMLTextAreaElement | null)?.focus(); return; }
    const q = t.closest<HTMLElement>("[data-mq]");
    if (q) { e.preventDefault(); const [role, id, mr] = q.dataset.mq!.split("|"); jump({ role: role as Role, id: id || null, text: q.dataset.mqt || "", mr: mr ? +mr : undefined }); return; }
    // Touch: a tap on a bubble (not on a link, a button, a card) opens its menu; any other tap closes it.
    if (TOUCH()) {
      const bub = t.closest<HTMLElement>(".msgs .m .bubble"), m = bub?.closest<HTMLElement>(".m[data-mr]");
      if (bub && m && bub.querySelector(".mact") && !t.closest(INTERACTIVE) && !String(getSelection?.() || "").trim()) { const mr = +m.dataset.mr!; if (M.open === mr) menuClose(); else menuOpen(mr); return; }
      if (M.open != null && !t.closest(".mact")) menuClose();
    }
  });
  // Long-press (touch): the same menu, without the click that follows.
  let lp: any = 0, lpAt: { x: number; y: number } | null = null, lpFired = false;
  document.addEventListener("touchstart", e => {
    const t = e.target as HTMLElement, bub = t.closest<HTMLElement>(".msgs .m .bubble"), m = bub?.closest<HTMLElement>(".m[data-mr]");
    lpFired = false; clearTimeout(lp); if (!bub || !m || !bub.querySelector(".mact") || t.closest(".mact") || t.closest("a,button,input,textarea")) return;
    const p = e.touches[0]; lpAt = { x: p.clientX, y: p.clientY };
    lp = setTimeout(() => { lpFired = true; menuOpen(+m.dataset.mr!); try { navigator.vibrate?.(8); } catch {} }, 450);
  }, { passive: true });
  document.addEventListener("touchmove", e => { if (!lpAt) return; const p = e.touches[0]; if (Math.abs(p.clientX - lpAt.x) > 8 || Math.abs(p.clientY - lpAt.y) > 8) { clearTimeout(lp); lpAt = null; } }, { passive: true });
  document.addEventListener("touchend", () => { clearTimeout(lp); lpAt = null; }, { passive: true });
  document.addEventListener("click", e => { if (lpFired) { lpFired = false; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("contextmenu", e => { if (lpFired && (e.target as HTMLElement).closest?.(".msgs .m .bubble")) e.preventDefault(); });
  // Esc: closes the touch menu, else cancels the pinned reply (while typing in the box, not while dictating: Esc stops that).
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (M.open != null) { menuClose(); return; }
    const t = e.target as HTMLElement;
    if (!(t.id === "box" || t.closest?.("#rq-box"))) return;
    if (document.querySelector("form.dicting")) return;
    if (rqGet()) { e.preventDefault(); rqClear(); if (t.id !== "box") (document.getElementById("box") as HTMLTextAreaElement | null)?.focus(); }
  });
  // Scrolling the chat closes the menu (a real scroll by the person: not the repaint that opened it).
  document.addEventListener("scroll", e => { const t = e.target as HTMLElement; if (M.open != null && t?.id === "scroll" && Math.abs(t.scrollTop - M.top) > 8) menuClose(); }, true);
}
// Scroll to a quote's original and flash it.
function jump(r: { role: Role; id: string | null; text: string; mr?: number }) {
  const mr = D!.locate(r), el = mr != null ? document.querySelector<HTMLElement>(`.m[data-mr="${mr}"]`) : null;
  if (!el) { D!.note("That message is further back", "It isn't loaded in this view any more."); return; }
  el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.classList.remove("mr-flash"); void el.offsetWidth; el.classList.add("mr-flash"); setTimeout(() => el.classList.remove("mr-flash"), 1700);
}
