// Toast stack, ported to plain TypeScript from Bruno Delorence's toast-stack component (components-src/bd/toast-stack).
// Copyright (c) 2026 Bruno Delorence. MIT License. (Full MIT text: THIRD-PARTY-NOTICES.md.)
//
// Toasts pile up above the bottom corner like a deck of cards: the newest in front, each one behind a little smaller, higher and
// fainter. Hovering the stack (or tabbing into it) fans it out into a list. Unlike Bruno's component, toasts here keep their own
// height (the app's toasts differ in length), so every toast's place is worked out from its measured height and handed to the
// stylesheet as custom properties. The look is in toast-stack.css (classes prefixed bdts-). The toast's content, buttons and timing
// belong to the callers (toast() and note() in v3.ts); this file only places them.

type Item = { el: HTMLElement; inner: HTMLElement; timer: number; leaving: boolean; at: number; drag?: boolean; stay?: boolean; onSwipe?: () => void };

const SHOW_MS = 5000;     // how long a toast stays, as before
const AFTER_HOVER_MS = 2500; // what each toast gets once the pointer leaves, as before
const EXIT_MS = 380;
const LIMIT = 4;          // the most toasts held: a new one past it sends the oldest away
const VISIBLE = 3;        // how many show while the stack is closed
const GAP = 10;           // between toasts when fanned out
const PEEK = 10;          // how far each toast behind shows above the one in front

let root: HTMLElement | null = null;
const items: Item[] = []; // newest first
let hovered = false, focused = false, tapped = false;
let clicked: HTMLElement | null = null; // the toast a click is happening in, so hideToast() inside its handler means that toast

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isOpen = () => hovered || focused || tapped;

function mount(): HTMLElement {
  if (root && root.isConnected) return root;
  root = document.createElement("div"); root.id = "toast"; root.setAttribute("role", "status");
  root.addEventListener("pointerenter", e => { if (e.pointerType === "touch") return; hovered = true; sync(); });
  root.addEventListener("pointerleave", e => { if (e.pointerType === "touch") return; hovered = false; sync(); });
  root.addEventListener("pointerdown", e => { if (e.pointerType === "touch" && !tapped) { tapped = true; sync(); } });
  root.addEventListener("focusin", e => { if ((e.target as HTMLElement).matches(":focus-visible")) { focused = true; sync(); } });
  root.addEventListener("focusout", e => { if (!root!.contains(e.relatedTarget as Node | null)) { focused = false; sync(); } });
  document.body.appendChild(root);
  return root;
}

// A tap outside the stack closes it, and a click inside records which toast it was in.
window.addEventListener("click", e => {
  clicked = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".bdts-t") ?? null;
  if (clicked) setTimeout(() => { clicked = null; }, 0);
}, true);
window.addEventListener("pointerdown", e => {
  if (tapped && root && !root.contains(e.target as Node)) { tapped = false; sync(); }
}, true);

// Swiping a toast away (touch and pen). A press that moves less than SLOP is a tap and nothing here touches it. Past SLOP, the
// toast follows the finger: down (up when it sits in the top half of the screen) or sideways. Let go past DIST, or fast, and it
// leaves in that direction; otherwise it springs back. The click that ends a drag is swallowed so a button under the finger stays unpressed.
const SLOP = 10, DIST = 64, FLICK = 0.5;
let swallow = 0;
window.addEventListener("click", e => { if (swallow > Date.now()) { e.stopPropagation(); e.preventDefault(); swallow = 0; } }, true);

type Drag = { el: HTMLElement; x0: number; y0: number; t0: number; id: number; on: boolean; dx: number; dy: number; down: boolean };
function swipeable(el: HTMLElement, onGone: () => void, canStart: () => boolean = () => true, hold?: (on: boolean) => void) {
  let d: Drag | null = null;
  el.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" || !e.isPrimary || !canStart()) return;
    const r = el.getBoundingClientRect();
    d = { el, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, id: e.pointerId, on: false, dx: 0, dy: 0, down: r.top + r.height / 2 >= window.innerHeight / 2 };
  });
  el.addEventListener("pointermove", e => {
    if (!d || e.pointerId !== d.id) return;
    let dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.hypot(dx, dy) < SLOP) return;
      const away = d.down ? dy > 0 : dy < 0;
      if (Math.abs(dy) > Math.abs(dx) && !away) { d = null; return; }   // moving toward the screen's middle is not a swipe away
      d.on = true; try { el.setPointerCapture(d.id); } catch { /* the pointer is already gone */ }
      el.setAttribute("data-drag", ""); hold?.(true);
    }
    if (Math.abs(dy) > Math.abs(dx)) dx = 0; else dy = 0;
    if (dy && (d.down ? dy < 0 : dy > 0)) dy = 0;
    d.dx = dx; d.dy = dy; el.style.setProperty("--dx", `${dx}px`); el.style.setProperty("--dy", `${dy}px`);
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!d || e.pointerId !== d.id) return;
    const g = d; d = null;
    if (!g.on) return;
    swallow = Date.now() + 80;
    el.removeAttribute("data-drag");
    const dist = Math.max(Math.abs(g.dx), Math.abs(g.dy)), speed = dist / Math.max(1, e.timeStamp - g.t0);
    if (!cancelled && (dist >= DIST || (speed >= FLICK && dist >= 20))) {
      const w = window.innerWidth, h = window.innerHeight;
      el.setAttribute("data-swiped", "");
      el.style.setProperty("--dx", g.dx ? `${Math.sign(g.dx) * w}px` : "0px");
      el.style.setProperty("--dy", g.dy ? `${Math.sign(g.dy) * h}px` : "0px");
      onGone();
    } else {
      el.style.removeProperty("--dx"); el.style.removeProperty("--dy"); hold?.(false);
    }
  };
  el.addEventListener("pointerup", e => end(e, false));
  el.addEventListener("pointercancel", e => end(e, true));
}

const live = () => items.filter(i => !i.leaving);

/** Works out each toast's place (its index, its height, how far up it goes when fanned out) and the open state. */
function place() {
  if (!root) return;
  const open = isOpen(), now = live();
  const fh = now[0]?.inner.offsetHeight ?? 0;
  let up = 0;
  now.forEach((it, i) => {
    const h = it.inner.offsetHeight;
    const s = it.el.style;
    s.setProperty("--i", String(i)); s.setProperty("--h", `${h}px`); s.setProperty("--fh", `${fh}px`); s.setProperty("--up", `${up}px`);
    it.el.toggleAttribute("data-front", i === 0);
    it.el.toggleAttribute("data-hidden", i >= VISIBLE);
    up += h + GAP;
  });
  for (const it of items) if (it.leaving) it.el.style.setProperty("--i", String(it.at));
  root.toggleAttribute("data-open", open && now.length > 0);
  root.classList.toggle("on", now.length > 0);
}

/** Starts or stops the timers: they wait while the stack is open, and each toast gets a short wait once it closes. */
const waited = new WeakSet<Item>(); // toasts that have been through an open stack: they get the shorter wait
function sync() {
  place();
  const open = isOpen();
  for (const it of items) {
    if (it.leaving || it.drag || it.stay) continue;   // a staying toast leaves only when it is dismissed
    if (open) { clearTimeout(it.timer); it.timer = 0; waited.add(it); continue; }
    if (!it.timer) it.timer = window.setTimeout(() => leave(it), waited.has(it) ? AFTER_HOVER_MS : SHOW_MS);
  }
}

function leave(it: Item) {
  if (it.leaving) return;
  clearTimeout(it.timer);
  it.at = live().indexOf(it); it.leaving = true;
  it.el.setAttribute("data-leaving", "fade"); it.el.setAttribute("inert", "");
  place();
  const done = () => {
    it.el.remove(); ro.unobserve(it.inner);
    const k = items.indexOf(it); if (k >= 0) items.splice(k, 1);
    if (!live().length) { hovered = focused = tapped = false; }
    place();
  };
  if (reduced()) done(); else window.setTimeout(done, EXIT_MS);
  if (!live().length) { hovered = focused = tapped = false; }
  sync();
}

const ro = new ResizeObserver(() => place());

/** Adds a toast in front of the others. `html` is the toast's content, exactly as the callers build it. */
/** `stay`: no timer, the toast stays until it is dismissed (a button, tsHide or a swipe, which also runs `onSwipe`). */
export function tsShow(html: string, opts: { stay?: boolean; onSwipe?: () => void } = {}) {
  const host = mount();
  const el = document.createElement("div"); el.className = "bdts-t"; el.setAttribute("data-new", "");
  const inner = document.createElement("div"); inner.className = "bdts-in"; inner.innerHTML = html;
  el.appendChild(inner); host.appendChild(el);
  const it: Item = { el, inner, timer: 0, leaving: false, at: 0, stay: !!opts.stay, onSwipe: opts.onSwipe };
  swipeable(el, () => { try { it.onSwipe?.(); } catch { /* the swipe still dismisses */ } leave(it); }, () => el.hasAttribute("data-front") || isOpen(),
    on => { it.drag = on; if (on) { clearTimeout(it.timer); it.timer = 0; } else sync(); });
  items.unshift(it); ro.observe(inner);
  const staying = live();
  place();
  void el.offsetWidth; el.removeAttribute("data-new");   // it springs in from below
  if (staying.length > LIMIT) for (const old of staying.slice(LIMIT)) leave(old);
  sync();
}

/** Takes one toast away (an element in it, or a selector for what is in it), or every toast without an argument. */
export function tsHide(target?: Element | string | null) {
  let el: Element | null | undefined;
  if (typeof target === "string") el = root?.querySelector(target);
  else el = target;
  const own = el?.closest?.(".bdts-t") ?? (target === undefined ? clicked : null);
  if (own) { const it = items.find(i => i.el === own); if (it) leave(it); return; }
  if (target !== undefined && target !== null) return;
  for (const it of live()) leave(it);
}

/** Lets a single toast outside the stack (the computer overlay's) be swiped away; `gone` runs once it has been. */
export function swipeAway(el: HTMLElement, gone: () => void) { swipeable(el, () => { window.setTimeout(gone, reduced() ? 0 : 260); }); }
