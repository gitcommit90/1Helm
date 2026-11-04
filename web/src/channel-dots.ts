// Keeps the channel list dots (the desktop rail's corner dot and the phone channel list's dot) in step with the tasks, without redrawing the list.
// A background refresh that only repaints the open page (Home, Notebook, Contacts, Library, Scheduled, or a task with text in the box) used to leave
// these dots as they were at the last full draw, so a channel could get an unread task, and a chime, and show no dot. The dots are absolutely
// positioned, so adding or removing one never moves anything.
export type DotKind = "New reply" | null;
export function paintChannelDots(root: ParentNode, kindOf: (slug: string) => DotKind) {
  for (const b of Array.from(root.querySelectorAll<HTMLElement>("#rail .chs .ch[data-ch]"))) {
    const k = kindOf(b.dataset.ch || ""), tile = b.querySelector<HTMLElement>(".tile"), pip = b.querySelector<HTMLElement>(".pip");
    if (!tile) continue;
    if (!k) { pip?.remove(); continue; }
    if (pip) { if (pip.title !== k) pip.title = k; continue; }
    const i = tile.ownerDocument.createElement("i"); i.className = "pip"; i.title = k; tile.appendChild(i);
  }
  for (const a of Array.from(root.querySelectorAll<HTMLElement>("#chlist a.chr[data-mch]"))) {
    const slug = (a.getAttribute("href") || "").replace(/^#\//, ""), on = !!kindOf(slug), dot = a.querySelector<HTMLElement>(":scope > .udot");
    if (!on) { dot?.remove(); continue; }
    if (dot) continue;
    const i = a.ownerDocument.createElement("i"); i.className = "udot"; a.insertBefore(i, a.firstChild);
  }
}
