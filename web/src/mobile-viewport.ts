// A phone keyboard can resize and pan the visible viewport without resizing the
// layout viewport. Keep the whole chat, including its header, in the visible area.
const viewport = window.visualViewport;
const mobile = matchMedia("(max-width:599px),(max-height:499px)");
const root = document.documentElement;
let frame = 0;

function fit() {
  frame = 0;
  coverFit();
  if (!mobile.matches || !viewport) {
    root.style.removeProperty("--mobile-viewport-top");
    root.style.removeProperty("--mobile-viewport-height");
    return;
  }
  // Let the browser pan and magnify the existing layout during pinch zoom.
  // Retain the last unzoomed dimensions until the scale returns to normal.
  if (Math.abs(viewport.scale - 1) > 0.01 || viewport.height <= 0) return;
  root.style.setProperty("--mobile-viewport-top", `${viewport.offsetTop}px`);
  root.style.setProperty("--mobile-viewport-height", `${viewport.height}px`);
}

function schedule() { if (!frame) frame = requestAnimationFrame(fit); }
viewport?.addEventListener("resize", schedule);
viewport?.addEventListener("scroll", schedule);
window.addEventListener("resize", schedule);
window.addEventListener("pageshow", schedule);
mobile.addEventListener("change", schedule);
fit();

// Typing and the on-screen keyboard (Android keeps a text field focused after the keyboard is hidden and after a tap on the page behind it).
const isEditable = (a: Element | null): a is HTMLElement => !!a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a as HTMLElement).isContentEditable);
const touchScreen = matchMedia("(pointer:coarse)");

// 1. The keyboard went away (the window got taller with the same width) while a field still has focus: the field is let go. Otherwise the screen
// drawn for the new size (the tablet layout comes back above 500px high) focuses the message box again and the keyboard reopens by itself.
// The keyboard opened (the window got shorter): the layout may switch, the screen is drawn again and the box is replaced, so the field that had
// focus is remembered for that. The browser can let go of a field that the new layout hides before the resize event arrives, so a field that lost
// focus with nothing else taking it counts as the one being typed in.
let lastHeight = innerHeight, lastWidth = innerWidth, letGo = false, lost: { el: HTMLElement; t: number } | null = null, typing: HTMLElement | null = null, typingTimer = 0;
document.addEventListener("focusout", e => {
  const el = e.target as Element;
  lost = isEditable(el) && !(e as FocusEvent).relatedTarget && !letGo ? { el, t: performance.now() } : null;
}, true);
const letGoOf = (el: HTMLElement) => { letGo = true; try { el.blur(); } finally { letGo = false; } };
window.addEventListener("resize", () => {
  const grew = innerHeight - lastHeight, same = innerWidth === lastWidth;
  lastHeight = innerHeight; lastWidth = innerWidth;
  const a = document.activeElement;
  if (same && grew > 120 && touchScreen.matches) { lost = null; typing = null; if (isEditable(a)) letGoOf(a); return; }
  if (isEditable(a)) { typing = a; clearTimeout(typingTimer); typingTimer = setTimeout(() => { typing = null; }, 1000); }
});
/** The text field being typed in when the window last changed size, for one second. */
export const typingAtResize = () => typing ?? (lost && performance.now() - lost.t < 800 ? lost.el : null);

// 2. A tap (not a scroll or a drag) on the page outside the field closes the keyboard on the first tap. Taps inside a field, on a label, in the
// message form (attach, microphone, send keep the keyboard) or on another field leave it open. A click that moved focus somewhere on purpose is left alone.
let down: { el: HTMLElement; x: number; y: number; t: number } | null = null;
document.addEventListener("pointerdown", e => {
  const a = document.activeElement;
  down = e.pointerType !== "mouse" && e.isPrimary && isEditable(a) ? { el: a, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
}, true);
document.addEventListener("click", e => {
  const d = down; down = null;
  if (!d || document.activeElement !== d.el || e.timeStamp - d.t > 600 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
  const t = e.target as Element | null;
  if (!t || t.closest("input,textarea,select,label,[contenteditable],#send")) return;
  letGoOf(d.el);
});

// 3. A keyboard that covers the page without resizing it (the visual viewport shrinks, the layout does not) would hide the box being typed in on the
// tablet layout. The page is then given the visible height and the box is scrolled into view.
function coverFit() {
  const covered = viewport && !mobile.matches && Math.abs(viewport.scale - 1) <= 0.01 && innerHeight - viewport.height > 120 && isEditable(document.activeElement);
  if (!covered) { if (root.style.getPropertyValue("--kb-height")) root.style.removeProperty("--kb-height"); return; }
  root.style.setProperty("--kb-height", `${viewport!.height}px`);
  // The viewport meta asks Android to resize only the visual viewport (interactive-widget=resizes-visual), so the layout, its media queries and the
  // scroll position stay as they are. The field is scrolled up inside its own scroll area when the keyboard would cover it.
  const el = document.activeElement as HTMLElement, vh = viewport!.height - viewport!.offsetTop;
  const over = el.getBoundingClientRect().bottom - (vh - 12);
  if (over > 0) {
    let p: HTMLElement | null = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    if (p) p.scrollTop += over; else el.scrollIntoView({ block: "nearest" });
  }
}
document.addEventListener("focusin", schedule);
document.addEventListener("focusout", () => setTimeout(schedule, 0));
