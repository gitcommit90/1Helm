// A button that opens the app's own listbox menu where a native <select> would be.
// pickHtml draws the closed control; one document-level handler (installed on import) opens the menu for any .pkb.
// Choosing an option sets the button's data-value and text and dispatches a bubbling "change" on the button, as a select does.
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
type Opt = [value: string, label: string];
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** `attrs` carries the caller's own data attribute(s). The hidden .pks line holds the longest label so the width does not change with the choice. */
export function pickHtml(o: { attrs: string; label: string; value: string; options: Opt[]; disabled?: boolean }) {
  const cur = o.options.find(x => x[0] === o.value) || o.options[0] || ["", ""], longest = o.options.reduce((a, x) => x[1].length > a.length ? x[1] : a, "");
  return `<button type="button" class="pkb" aria-haspopup="listbox" aria-expanded="false" ${o.attrs} aria-label="${esc(o.label)}" data-value="${esc(cur[0])}" data-options="${esc(JSON.stringify(o.options))}"${o.disabled ? " disabled" : ""}><span>${esc(cur[1])}</span><i class="pks" aria-hidden="true">${esc(longest)}</i></button>`;
}

let menu: HTMLElement | null = null, from: HTMLElement | null = null, key = "";
// The page is redrawn from text while the menu is open, so the opener may be replaced: find its copy by its own data attributes (unique per control).
const live = () => from && (from.isConnected ? from : document.querySelector<HTMLElement>(key));
function close(refocus = false) {
  const t = live(); menu?.remove(); menu = null; t?.setAttribute("aria-expanded", "false");
  if (refocus) t?.focus({ preventScroll: true });
  from = null;
}
const items = () => [...menu!.querySelectorAll<HTMLElement>("[data-i]")];
function open(b: HTMLElement) {
  close();
  const opts: Opt[] = JSON.parse(b.dataset.options || "[]"), r = b.getBoundingClientRect();
  const m = menu = document.createElement("div"); from = b;
  key = ".pkb" + [...b.attributes].filter(a => a.name.startsWith("data-") && a.name !== "data-value" && a.name !== "data-options").map(a => `[${a.name}="${a.value.replace(/["\\]/g, "\\$&")}"]`).join("");
  m.className = "delmenu pkm"; m.setAttribute("role", "listbox"); m.setAttribute("aria-label", b.getAttribute("aria-label") || "");
  m.innerHTML = opts.map(([v, t], i) => `<button type="button" role="option" class="delmi" data-i="${i}" aria-selected="${v === b.dataset.value}"><i class="pkc">${v === b.dataset.value ? CHECK : ""}</i><span>${esc(t)}</span></button>`).join("");
  m.style.minWidth = `${r.width}px`; document.body.appendChild(m);
  const below = innerHeight - r.bottom - 12, above = r.top - 12, up = m.scrollHeight + 12 > below && above > below, room = up ? above : below;
  m.style.maxHeight = `${room}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${up ? r.top - 4 - m.offsetHeight : r.bottom + 4}px`;
  b.setAttribute("aria-expanded", "true");
  const cur = items().find(x => x.getAttribute("aria-selected") === "true") || items()[0];
  m.scrollTop = cur.offsetTop - (m.clientHeight - cur.offsetHeight) / 2;
  cur.focus({ preventScroll: true });
  m.onclick = e => {
    const it = (e.target as Element).closest<HTMLElement>("[data-i]"); if (!it) return;
    const [v, t] = opts[+it.dataset.i!], c = live();
    close(true);
    if (c && v !== c.dataset.value) { c.dataset.value = v; c.firstElementChild!.textContent = t; c.dispatchEvent(new Event("change", { bubbles: true })); }
  };
}
const target = (e: Event) => e.target as Element;
document.addEventListener("click", e => {
  const b = target(e).closest<HTMLElement>(".pkb"); if (!b || (b as HTMLButtonElement).disabled) return;
  e.preventDefault(); if (menu && from === b) close(true); else open(b);
});
document.addEventListener("pointerdown", e => { if (menu && !target(e).closest(".pkm,.pkb")) close(); }, true);
for (const ev of ["resize", "scroll"] as const) window.addEventListener(ev, e => { if (menu && !(e.target instanceof Node && menu.contains(e.target))) close(); }, true);
document.addEventListener("keydown", e => {
  if (!menu) { const b = target(e).closest<HTMLElement>(".pkb"); if (b && e.key === "ArrowDown" && !(b as HTMLButtonElement).disabled) { e.preventDefault(); open(b); } return; }
  const k = e.key, list = items(), i = list.indexOf(document.activeElement as HTMLElement);
  if (k === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
  else if (k === "Tab") close(true);
  else if (k === "ArrowDown" || k === "ArrowUp" || k === "Home" || k === "End") {
    e.preventDefault(); list[k === "Home" ? 0 : k === "End" ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + (k === "ArrowDown" ? 1 : -1)))].focus();
  }
}, true);
