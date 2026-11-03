/* Copyright (c) 2026 Bruno Delorence. MIT License (see THIRD-PARTY-NOTICES.md).
   Ported from Bruno's sidebar-nav "gliding hover" (components-src/bd/sidebar-nav) to plain TypeScript.
   One highlight slides behind the side panel rows as the pointer moves. Nothing else about the rows changes. */

const ROWS = ".new, .navrow, .search, .sess, .drow, .sidesrch";
let mark: HTMLElement | null = null, lit: HTMLElement | null = null, wired = false;
const mouse = () => matchMedia("(hover:hover) and (pointer:fine)").matches;
const still = () => matchMedia("(prefers-reduced-motion:reduce)").matches;

function side() { return document.getElementById("side"); }

/** Called after every side panel redraw: makes sure the highlight element exists and is hidden. */
export function sideGlideSync() {
  const s = side();
  if (!s) return;
  if (!wired) { wired = true; wire(s); }
  if (!mark || mark.parentElement !== s) {
    mark = document.createElement("div");
    mark.className = "bdsn-mark";
    mark.setAttribute("aria-hidden", "true");
    s.prepend(mark);
  }
  hide();
}

function hide() { lit = null; if (mark) mark.style.opacity = "0"; }

function show(row: HTMLElement) {
  const s = side();
  if (!s || !mark) return;
  const sr = s.getBoundingClientRect(), r = row.getBoundingClientRect();
  let top = r.top, bottom = r.bottom;
  const list = row.closest<HTMLElement>(".sessions");
  if (list) { const l = list.getBoundingClientRect(); top = Math.max(top, l.top); bottom = Math.min(bottom, l.bottom); }
  if (bottom - top < 4) { hide(); return; }
  const first = !lit && mark.style.opacity !== "1";
  if (first || still()) mark.style.transition = "none";   // appears in place; no glide from the last spot, or with reduced motion
  mark.style.top = `${top - sr.top + s.scrollTop}px`;
  mark.style.left = `${r.left - sr.left}px`;
  mark.style.width = `${r.width}px`;
  mark.style.height = `${bottom - top}px`;
  mark.style.borderRadius = getComputedStyle(row).borderRadius;
  mark.style.opacity = "1";
  if (first || still()) { void mark.offsetHeight; mark.style.transition = ""; }
  lit = row;
}

function wire(s: HTMLElement) {
  const rowOf = (t: EventTarget | null) => t instanceof Element ? t.closest<HTMLElement>(ROWS) : null;
  s.addEventListener("pointerover", e => {
    if (e.pointerType === "touch" || e.pointerType === "pen" || !mouse()) return;
    const row = rowOf(e.target);
    if (row && s.contains(row) && row !== lit && !row.matches(".on, :focus-within:has(input:focus)")) show(row);
    else if (row && row.matches(".on")) hide();
  });
  s.addEventListener("pointerleave", hide);
  s.addEventListener("pointerdown", hide);
  s.addEventListener("scroll", hide, true);
}
