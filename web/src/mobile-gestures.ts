// Touch-only gestures. Nothing is claimed until the intended axis wins; native scrolling,
// pinch zoom, cancellation and accessible click/keyboard controls keep their own paths.
export const phoneGesture = () => matchMedia("(max-width: 767px)").matches && (window.visualViewport?.scale ?? 1) <= 1.01;
const controls = "input,textarea,select,button,a,label,summary,[contenteditable]:not([contenteditable=false]),[role=button],[role=checkbox],[role=radio],[role=switch],[role=slider],video,audio,canvas,iframe,pre,table,.bfstack";
// Action rows occupy most of a sheet: they can start a pull-down while an ordinary
// tap still activates them. Editable controls and value selectors keep their touch behavior.
const valueControls = controls.replace("button,a,", "").replace("[role=button],", "") + ",[aria-pressed]";
export const gestureValueControl = (target: Element) => !!target.closest(valueControls);
export function gestureControl(target: Element, allowLinks = false) {
  return !!target.closest(allowLinks ? controls.replace("button,a,", "button,") : controls);
}
export function scrollerOwns(target: Element, boundary: HTMLElement, axis: "x" | "y") {
  for (let el: Element | null = target; el; el = el.parentElement) {
    const s = getComputedStyle(el), scroll = axis === "x" ? s.overflowX : s.overflowY;
    if (/(auto|scroll)/.test(scroll) && (axis === "x"
      ? el.scrollWidth > el.clientWidth + 1
      : el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0)) return true;
    if (el === boundary) break;
  }
  return false;
}
type Swipe = {
  axis: "x" | "y";
  direction: 1 | -1;
  distance: number;
  valid?: () => boolean;
  move: (distance: number) => void;
  finish: (commit: boolean) => void;
};
export function bindTouchSwipe(el: HTMLElement, start: (target: Element, touch: Touch) => Swipe | null) {
  let swipe: Swipe | null = null, x = 0, y = 0, id = 0, time = 0, distance = 0, claimed = false, blockClickUntil = 0;
  const reset = (commit = false) => {
    const old = swipe, moved = claimed; swipe = null; claimed = false;
    if (moved) blockClickUntil = Date.now() + 450;
    old?.finish(commit);
  };
  el.addEventListener("touchstart", e => {
    reset();
    blockClickUntil = 0; // a new finger contact is an intentional tap, not the previous swipe's compatibility click
    if (!phoneGesture() || e.touches.length !== 1 || !(e.target instanceof Element) || window.getSelection()?.toString()) return;
    const t = e.touches[0]; swipe = start(e.target, t); if (!swipe) return;
    x = t.clientX; y = t.clientY; id = t.identifier; time = Date.now(); distance = 0;
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (!swipe) return;
    if (!phoneGesture() || !el.isConnected || window.getSelection()?.toString() || e.touches.length !== 1 || e.touches[0].identifier !== id || swipe.valid?.() === false) { reset(); return; }
    const t = e.touches[0], dx = t.clientX - x, dy = t.clientY - y;
    const along = (swipe.axis === "x" ? dx : dy) * swipe.direction, across = Math.abs(swipe.axis === "x" ? dy : dx);
    if (!claimed) {
      if (Math.max(Math.abs(along), across) < 10) return;
      if (along <= 0 || along < across * 1.5) { reset(); return; }
      claimed = true;
    }
    if (!e.cancelable) { reset(); return; } // the browser already owns this scroll
    e.preventDefault(); distance = Math.max(0, along); swipe.move(distance);
  }, { passive: false });
  el.addEventListener("touchend", e => {
    if (!swipe) return;
    const complete = e.touches.length === 0 && e.changedTouches.length === 1 && e.changedTouches[0].identifier === id;
    const fast = distance >= 48 && distance / Math.max(1, Date.now() - time) > 0.55;
    reset(complete && claimed && phoneGesture() && el.isConnected && swipe.valid?.() !== false && (distance >= swipe.distance || fast));
  });
  el.addEventListener("touchcancel", () => reset());
  el.addEventListener("click", e => {
    if (e.detail && Date.now() < blockClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

export function bindSheetDismiss(el: HTMLElement, close: () => void) {
  bindTouchSwipe(el, target => {
    const grab = !!target.closest(".grab");
    if (!grab && (gestureValueControl(target) || scrollerOwns(target, el, "y") || scrollerOwns(target, el, "x"))) return null;
    return { axis: "y", direction: 1, distance: Math.max(72, Math.min(140, el.offsetHeight * 0.25)),
      move: dy => { el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`; },
      finish: commit => { el.style.transition = ""; el.style.transform = ""; if (commit) close(); } };
  });
}
