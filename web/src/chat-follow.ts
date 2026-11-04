// One rule for the open task's scroll view (#scroll): follow the bottom only while the person is at the bottom.
// Scrolling up (wheel, touch drag, keyboard, or any other scroll that lowers scrollTop; the app hides scroll bars) stops every automatic scroll until the person is back at the bottom
// or sends a message. Our own scrolls never lower scrollTop, so only the person can move the view up.
const BOTTOM = 8;   // pixels from the bottom that still count as "at the bottom"
const F = { key: "", follow: true, hold: false, top: 0, timer: 0 };
const dist = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;
const scroller = () => document.getElementById("scroll");
const inScroll = (t: EventTarget | null) => t instanceof Node && !!(t instanceof Element ? t : t.parentElement)?.closest("#scroll");
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// After a short pause, being at the bottom again means following again (a wheel tick or drag that moved nothing).
function settle(ms = 250) {
  clearTimeout(F.timer);
  F.timer = window.setTimeout(() => { const el = scroller(); if (el && dist(el) <= BOTTOM) F.follow = true; }, ms);
}
function away() { F.follow = false; settle(); }

let ready = false;
function init() {
  if (ready) return; ready = true;
  const opt = { capture: true, passive: true } as const;
  document.addEventListener("scroll", e => {
    const el = e.target; if (!(el instanceof HTMLElement) || el.id !== "scroll") return;
    const up = el.scrollTop < F.top - 0.5; F.top = el.scrollTop;
    if (dist(el) <= BOTTOM) F.follow = true; else if (up) F.follow = false;
  }, opt);
  document.addEventListener("wheel", e => { if (e.deltaY < 0 && inScroll(e.target)) away(); }, opt);
  let y0 = 0;
  document.addEventListener("touchstart", e => { if (!inScroll(e.target)) return; y0 = e.touches[0]?.clientY ?? 0; F.hold = true; }, opt);
  document.addEventListener("touchmove", e => { if (inScroll(e.target) && (e.touches[0]?.clientY ?? 0) > y0 + 2) away(); }, opt);
  const end = () => { if (F.hold) { F.hold = false; settle(); } };
  document.addEventListener("touchend", end, opt); document.addEventListener("touchcancel", end, opt);
  document.addEventListener("keydown", e => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || !scroller()) return;
    if (["ArrowUp", "PageUp", "Home"].includes(e.key) || (e.key === " " && e.shiftKey)) away();
  }, opt);
  document.addEventListener("load", e => { if (e.target instanceof HTMLImageElement && inScroll(e.target)) followPin(); }, opt);   // an image that finishes loading below the view
}

export function followWant() { init(); return F.follow && !F.hold; }
/** Scroll to the bottom now, only if the person is following the bottom. */
export function followPin() { const el = scroller(); if (el && followWant()) { el.scrollTop = el.scrollHeight; F.top = el.scrollTop; } }
/** The person sent a message: follow the bottom again. */
export function followSent() { init(); F.follow = true; F.hold = false; }
/** After the screen is drawn from scratch. Opening a task goes to the bottom; a redraw of the same task keeps the person's place. */
export function followDrawn(key: string | null) {
  init(); const el = scroller();
  if (!key || !el) { F.key = ""; return; }
  if (key !== F.key) { F.key = key; F.follow = true; F.hold = false; }
  if (F.follow && !F.hold) el.scrollTop = el.scrollHeight; else el.scrollTop = F.top;
  F.top = el.scrollTop;
}
/** Run a repaint of the messages and keep the view: pinned when following, untouched when the person scrolled up. */
export function followKeep(paint: () => void) {
  const el = scroller(); if (!el) { paint(); return; }
  const want = followWant(), top = el.scrollTop; paint();
  if (want) { el.scrollTop = el.scrollHeight; F.top = el.scrollTop; } else if (el.scrollTop !== top) el.scrollTop = top;
}
