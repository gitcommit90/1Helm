// Copy and Reply on chat bubbles (the task view), and the reply pinned above the composer, like iMessage.
// Desktop: hovering or tabbing into a bubble shows its own Copy / Reply buttons. Touch: hold the bubble to reveal them.
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
  msg: (mr: number, part?: string) => Found | null;   // a rendered bubble of the open task
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
  task: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', 15),
  tick: svg('<path d="M20 6 9 17l-5-5"/>', 15),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 15),
};
const M = { open: null as string | null, copied: null as string | null, copiedT: 0 as any, top: 0 };
const HOVER_SPACE = new Set<string>();
const actionKey = (mr: number, part = "") => `${mr}:${part}`;
const PINS = new Map<string, Pin>();   // task → its pinned reply

// The two buttons in a bubble's revealed action strip. mr identifies the turn; part identifies its visible text bubble.
export function maActs(mr: number, part = "", card = "") {
  const key = actionKey(mr, part), c = M.copied === key;
  return `<span class="mact" data-mact="${key}" data-mapart="${part}"><button type="button" class="ma-copy${c ? " done" : ""}" data-macopy="${mr}" aria-label="${c ? "Copied" : "Copy message"}" title="${c ? "Copied" : "Copy"}">${c ? IC.tick : IC.copy}<span class="mal">${c ? "Copied" : "Copy"}</span></button><button type="button" class="ma-reply" data-mareply="${mr}" aria-label="Reply to this message" title="Reply">${IC.reply}<span class="mal">Reply</span></button>${card ? `<button type="button" class="ma-task" data-tkcard="${esc(card)}" aria-label="Open task card for this response" title="Task card">${IC.task}</button>` : ""}</span>`;
}
// Touch controls and temporary hover spacing are kept across repaints.
export const maOpenCls = (mr: number, part = "") => (M.open === actionKey(mr, part) ? " macts" : "") + (HOVER_SPACE.has(actionKey(mr, part)) ? " ma-space" : "");
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
export async function copyToClipboard(plain: string, html = "") {
  try {
    const CI = (window as any).ClipboardItem;
    if (CI && navigator.clipboard?.write && html) { await navigator.clipboard.write([new CI({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]); return true; }
  } catch {}
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(plain); return true; } } catch {}
  // Older browsers / no clipboard permission: preserve the original focus and selection around the copy command.
  const focused = document.activeElement as HTMLElement | null, selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const ta = document.createElement("textarea"); ta.value = plain; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  try { document.body.appendChild(ta); ta.select(); return document.execCommand("copy"); }
  catch { return false; }
  finally { ta.remove(); if (focused?.isConnected) focused.focus({ preventScroll: true }); if (selection) { selection.removeAllRanges(); ranges.forEach(r => selection.addRange(r)); } }
}
function say(t: string) {   // screen readers: "Copied"
  let el = document.getElementById("ma-live"); if (!el) { el = document.createElement("div"); el.id = "ma-live"; el.className = "sr-only"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  el.textContent = ""; setTimeout(() => { el!.textContent = t; }, 30);
}

// ---------- the touch menu ----------
// Copy feedback updates controls in place, preserving keyboard focus, selection and reading position.
function paintCopied() {
  document.querySelectorAll<HTMLElement>(".msgs [data-macopy]").forEach(button => {
    const copied = button.closest<HTMLElement>("[data-mact]")?.dataset.mact === M.copied;
    button.classList.toggle("done", copied); button.title = copied ? "Copied" : "Copy";
    button.setAttribute("aria-label", copied ? "Copied" : "Copy message");
    button.innerHTML = `${copied ? IC.tick : IC.copy}<span class="mal">${copied ? "Copied" : "Copy"}</span>`;
  });
}
function menuOpen(key: string) {
  menuClose(); M.open = key; M.top = document.getElementById("scroll")?.scrollTop ?? 0;
  document.querySelector(`[data-mact="${key}"]`)?.parentElement?.classList.add("macts");
}
function menuClose() { if (M.open == null) return; M.open = null; document.querySelectorAll(".msgs .bubble.macts").forEach(el => el.classList.remove("macts")); }
const INTERACTIVE = "a,button,input,select,textarea,label,summary,details,video,audio,img,.acard,.gu,.fcard,.mfiles,[data-fv],[role=button]";

export function maInit(deps: Deps) {
  if (D) { D = deps; return; } D = deps;
  const clearHoverSpace = () => { HOVER_SPACE.clear(); document.querySelectorAll(".bubble.ma-space").forEach(el => el.classList.remove("ma-space")); };
  // Reserve only rails the pointer has revealed during this visit to the chat.
  // Releasing an earlier rail while crossing to another bubble shifts the new
  // target under the pointer. Leaving the chat releases all temporary space.
  document.addEventListener("pointerover", e => {
    if (e.pointerType !== "mouse" || !matchMedia("(hover:hover)").matches) return;
    const bubble = (e.target as HTMLElement).closest<HTMLElement>(".msgs .bubble"), key = bubble?.querySelector<HTMLElement>("[data-mact]")?.dataset.mact;
    if (key) { HOVER_SPACE.add(key); bubble!.classList.add("ma-space"); }
  });
  document.addEventListener("pointerout", e => {
    if ((e.target as HTMLElement).closest?.(".msgs") && !(e.relatedTarget as HTMLElement | null)?.closest?.(".msgs")) clearHoverSpace();
  });
  window.addEventListener("hashchange", clearHoverSpace);
  window.addEventListener("blur", clearHoverSpace);
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const cp = t.closest<HTMLElement>("[data-macopy]");
    if (cp) { e.preventDefault(); e.stopPropagation(); const mr = +cp.dataset.macopy!, a = cp.closest<HTMLElement>("[data-mact]")!, key = a.dataset.mact!, f = D!.msg(mr, a.dataset.mapart); if (!f) return;
      void copyToClipboard(f.plain, f.html).then(ok => {
        if (!ok) { D!.note("Couldn't copy", "Your browser didn't allow it. Select the text and copy it instead."); return; }
        M.copied = key; clearTimeout(M.copiedT); paintCopied(); say("Copied");
        M.copiedT = setTimeout(() => { if (M.copied === key) { M.copied = null; paintCopied(); } }, 1600);
      }); return; }
    const rp = t.closest<HTMLElement>("[data-mareply]");
    if (rp) { e.preventDefault(); e.stopPropagation(); const mr = +rp.dataset.mareply!, f = D!.msg(mr, rp.closest<HTMLElement>("[data-mact]")?.dataset.mapart), key = D!.key(); if (!f || !key) return;
      PINS.set(key, { id: f.id, role: f.role, text: excerpt(f.plain), mr }); M.open = null; D!.repaint(); rqPaint();
      const b = document.getElementById("box") as HTMLTextAreaElement | null; if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
      return; }
    if (t.closest("[data-rqx]")) { e.preventDefault(); rqClear(); (document.getElementById("box") as HTMLTextAreaElement | null)?.focus(); return; }
    const q = t.closest<HTMLElement>("[data-mq]");
    if (q) { e.preventDefault(); const [role, id, mr] = q.dataset.mq!.split("|"); jump({ role: role as Role, id: id || null, text: q.dataset.mqt || "", mr: mr ? +mr : undefined }); return; }
    if (M.open != null && !t.closest(".mact")) menuClose();
  });
  // Long-press only. Never capture the pointer or prevent touch movement/native text selection.
  // Suppress only the held bubble's immediate compatibility click, never an unrelated next click.
  let lp: any = 0, lpAt: { x: number; y: number; key: string } | null = null, held: { key: string; until: number } | null = null;
  const cancel = () => { clearTimeout(lp); lpAt = null; };
  const targetKey = (t: HTMLElement) => t.closest(".bubble")?.querySelector<HTMLElement>("[data-mact]")?.dataset.mact;
  document.addEventListener("touchstart", e => {
    cancel(); held = null;
    const t = e.target as HTMLElement, key = targetKey(t);
    if (M.open && (!t.closest(".mact") || key !== M.open)) menuClose();
    if (e.touches.length !== 1 || !key || !t.closest(".msgs") || t.closest(INTERACTIVE) || window.getSelection()?.toString()) return;
    const p = e.touches[0]; lpAt = { x: p.clientX, y: p.clientY, key };
    lp = setTimeout(() => { if (!lpAt || !t.isConnected || window.getSelection()?.toString()) return;
      held = { key, until: Date.now() + 1200 }; menuOpen(key); try { navigator.vibrate?.(8); } catch {} }, 450);
  }, { passive: true });
  document.addEventListener("touchmove", e => { if (!lpAt) return; const p = e.touches[0]; if (e.touches.length !== 1 || Math.abs(p.clientX - lpAt.x) > 8 || Math.abs(p.clientY - lpAt.y) > 8) { cancel(); held = null; menuClose(); } }, { passive: true });
  document.addEventListener("touchend", () => { if (held) held.until = Date.now() + 700; cancel(); }, { passive: true });
  document.addEventListener("touchcancel", () => { cancel(); held = null; menuClose(); }, { passive: true });
  document.addEventListener("click", e => { const t = e.target as HTMLElement;
    if (held && Date.now() < held.until && targetKey(t) === held.key && !t.closest(INTERACTIVE)) { held = null; e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener("selectionchange", () => { if (window.getSelection()?.toString()) cancel(); });
  document.addEventListener("contextmenu", e => { if (held && Date.now() < held.until && targetKey(e.target as HTMLElement) === held.key && !(e.target as HTMLElement).closest(INTERACTIVE)) e.preventDefault(); });
  window.addEventListener("hashchange", () => { cancel(); held = null; menuClose(); });
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
  document.addEventListener("scroll", e => { const t = e.target as HTMLElement; if (t?.id !== "scroll") return; cancel(); if (M.open != null && Math.abs(t.scrollTop - M.top) > 8) menuClose(); }, true);
}
// Scroll to a quote's original and flash it.
function jump(r: { role: Role; id: string | null; text: string; mr?: number }) {
  const mr = D!.locate(r), el = mr != null ? document.querySelector<HTMLElement>(`.m[data-mr="${mr}"]`) : null;
  if (!el) { D!.note("That message is further back", "It isn't loaded in this view any more."); return; }
  el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.classList.remove("mr-flash"); void el.offsetWidth; el.classList.add("mr-flash"); setTimeout(() => el.classList.remove("mr-flash"), 1700);
}
