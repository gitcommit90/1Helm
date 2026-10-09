// The task header on a tablet / desktop (≥768px): it never runs off the edge or under the floating computer button.
// The header's right padding reserves the computer button's corner. When the actions don't fit, they fold into a ⋯ menu, least needed
// first: the helper's name chip (just hidden: the side panel shows it), Pin, Mark done, Delete, Activity, the to-do list, the focus timer,
// and last Live notes. The title, the status pill, Stop and ⋯ always stay. The title shrinks with an ellipsis, but while something can
// still fold it keeps at least ~170px. Action labels never truncate: an action is either shown whole or in the menu.
// The phone header (.mh) has its own fold (mhFit in v3.ts).
const TITLE_MIN = 170;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);

const head = () => document.querySelector<HTMLElement>("#stage>header.th");
let mo: MutationObserver | null = null, ro: ResizeObserver | null = null, raf = 0, watched: HTMLElement | null = null;
const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(hFit); };

export function hFit() {
  const h = head(); if (!h) return;
  const more = h.querySelector<HTMLElement>("[data-hmore]"), t = h.querySelector<HTMLElement>("h1"); if (!more || !t) return;
  const items = [...h.querySelectorAll<HTMLElement>(".ho[data-ho]")].sort((a, b) => +a.dataset.ho! - +b.dataset.ho!);
  items.forEach(x => x.classList.remove("hhid")); more.hidden = true;
  const cs = getComputedStyle(h), limit = h.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 0.5;
  const kids = () => [...h.querySelectorAll<HTMLElement>("button, .meta, .who-chip")];
  const over = () => kids().some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > limit; });
  const tight = () => over() || (t.clientWidth < TITLE_MIN && t.scrollWidth > t.clientWidth + 1);
  if (tight()) {
    more.hidden = false;
    for (const x of items) { if (!tight()) break; if (x.dataset.ho === "0" || x.querySelector("button")) x.classList.add("hhid"); }
  }
  const folded = items.filter(x => x.classList.contains("hhid") && x.querySelector("button"));
  more.hidden = !folded.length;
  // something folded is live (recording, working, a timer running): a dot on ⋯ says so
  more.classList.toggle("lit", folded.some(x => !!x.querySelector(".ln-rec, .tk-dot, .pmbtn:not(.idle)")));
  if (!folded.length && document.getElementById("hmenu")) closeMenu();
}
// Called after every render of the desktop stage.
export function hWatch() {
  const h = head(); if (!h) { watched = null; return; }
  mo ??= new MutationObserver(later); ro ??= new ResizeObserver(later);
  if (watched !== h) { mo.disconnect(); ro.disconnect(); mo.observe(h, { childList: true, subtree: true, characterData: true }); ro.observe(h); watched = h; }
  hFit();
}

// A folded button still owns its popover (focus timer, to-do list): it opens under ⋯ instead of at a zero-size spot.
export function anchorRect(b: HTMLElement): DOMRect {
  const r = b.getBoundingClientRect(); if (r.width || r.height) return r;
  const m = document.querySelector<HTMLElement>("#stage>header [data-hmore]:not([hidden])"); return m ? m.getBoundingClientRect() : r;
}

// ---- the ⋯ menu: the folded actions, in the header's order ----
const folded = () => [...document.querySelectorAll<HTMLElement>("#stage>header .ho.hhid")]
  .map(x => x.querySelector<HTMLElement>("button")).filter((b): b is HTMLElement => !!b);
const labelOf = (b: HTMLElement) => {
  if (b.matches(".hpin")) return b.textContent!.trim() === "Pinned" ? "Unpin" : "Pin";
  if (b.matches(".hdone")) return b.classList.contains("on") ? "Reopen" : "Mark done";
  if (b.matches(".hdel")) return "Delete";
  return (b.getAttribute("aria-label") || b.textContent || b.title || "").trim();
};
function closeMenu(focusBack = false) {
  const m = document.getElementById("hmenu"); if (!m) return; m.remove();
  const btn = document.querySelector<HTMLElement>("#stage>header [data-hmore]"); btn?.setAttribute("aria-expanded", "false"); if (focusBack) btn?.focus();
}
function openMenu(at: HTMLElement) {
  closeMenu(); const bs = folded(); if (!bs.length) return;
  const m = document.createElement("div"); m.id = "hmenu"; m.className = "hmenu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "More actions");
  m.innerHTML = bs.map((b, i) => `<button type="button" role="menuitem" class="hmi${b.matches(".hdel") ? " bad" : ""}" data-hmi="${i}">${b.querySelector("svg")?.outerHTML ?? ""}<span>${esc(labelOf(b))}</span>${b.querySelector(".ln-rec, .tk-dot") ? `<i class="hmdot"></i>` : ""}</button>`).join("");
  document.body.appendChild(m); at.setAttribute("aria-expanded", "true");
  const r = at.getBoundingClientRect(), w = m.offsetWidth, hh = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + 6 + hh > innerHeight - 8 ? Math.max(8, r.top - hh - 6) : r.bottom + 6}px`;
  m.addEventListener("click", e => { e.stopPropagation(); const x = (e.target as HTMLElement).closest<HTMLElement>("[data-hmi]"); if (!x) return; const b = bs[+x.dataset.hmi!]; closeMenu(); b?.click(); });
  m.addEventListener("keydown", e => {
    const its = [...m.querySelectorAll<HTMLElement>("[data-hmi]")], i = its.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); its[(i + (e.key === "ArrowDown" ? 1 : its.length - 1)) % its.length]?.focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); its[e.key === "Home" ? 0 : its.length - 1]?.focus(); }
    else if (e.key === "Tab") closeMenu();
  });
  m.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}
export function hInit() {
  window.addEventListener("click", e => {
    const t = e.target as HTMLElement, b = t.closest?.<HTMLElement>("[data-hmore]");
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); document.getElementById("hmenu") ? closeMenu() : openMenu(b); return; }
    if (!t.closest?.("#hmenu")) closeMenu();
  }, true);
  window.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("hmenu")) { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(true); } }, true);
  window.addEventListener("resize", () => closeMenu()); window.addEventListener("hashchange", () => closeMenu());
}
