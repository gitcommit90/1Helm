// Copyright (c) 2026 Bruno Delorence. MIT License.
// Ported to plain TypeScript from the Effort slider (https://brunodelorence.com/components/effort-slider). The full license text is in THIRD-PARTY-NOTICES.md.

/*
 * Effort slider: how hard a model should think, in named steps. Bruno's track, step dots, fill, gliding thumb and step name are kept.
 *
 * - The thumb glides to each stop on an exponential ease (each frame closes the same share of the gap, a time constant of 56 ms), written as one custom
 *   property, --pos, from 0 to 1. Under reduced motion it jumps.
 * - It is a real slider: the thumb has role="slider" and takes arrows, Page Up/Down, Home and End; the track takes a click or a drag, which the thumb
 *   follows and then snaps to the nearest stop.
 * - The step's name changes letter by letter: the old one rises and blurs away while the new one comes up into focus.
 * - Changed from the original: the thumb is a plain round dot in the app's colours (no brain), the last step looks like every other step (Bruno's "Plain"
 *   last-step payoff: no night sky, rays or flash), the track takes the width of its column, and it sits in the page, not in a floating card. The other
 *   themes, the demo that plays on its own, the help bubble and the end labels are not ported.
 * - Here the steps are given by the caller: the levels a service lists for a model, with "Default" first. A slider with one step is shown but can't be moved.
 * - The change is reported once: when a drag ends, or at once for a click or a key. While the pointer is down nothing is reported and `efsPressed()` is true,
 *   so the caller can keep the page from being redrawn under the pointer.
 */

export type EfsStep = { value: string; label: string };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** The thumb's ease: each frame closes the gap by 1 - e^(-dt / TAU). */
const TAU = 56;

const letters = (text: string) => [...text].map((c, i) => `<span class="efs-letter" style="--i:${i}">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("");

/** The slider's markup. `id` must be unique on the page; `thumbAttr` is extra attributes for the thumb (e.g. a data attribute that finds it again after a redraw). */
export function efsHtml(o: { id: string; label: string; steps: EfsStep[]; index: number; thumbAttr?: string }): string {
  const count = Math.max(o.steps.length, 2), last = count - 1, index = clamp(o.index, 0, o.steps.length - 1), still = o.steps.length < 2;
  const name = o.steps[index]?.label || "";
  const dots = o.steps.map((_, i) => `<span class="efs-dot" style="--stop:${i / last}"></span>`).join("");
  return `<div class="efs${still ? " efs-still" : ""}" data-efs="${esc(o.id)}" data-steps="${esc(JSON.stringify(o.steps))}" data-index="${index}" style="--pos:${(index / last).toFixed(4)}">
  <div class="efs-header"><span class="efs-name" id="${esc(o.id)}-label">${esc(o.label)}</span><span class="efs-level" aria-hidden="true"><span class="efs-in efs-first">${letters(name)}</span></span></div>
  <div class="efs-control">
    <div class="efs-track" aria-hidden="true"><div class="efs-fill"></div>${dots}</div>
    <div class="efs-rail"><span class="efs-thumb" role="slider" tabindex="${still ? -1 : 0}" ${o.thumbAttr || ""} aria-labelledby="${esc(o.id)}-label" aria-valuemin="0" aria-valuemax="${o.steps.length - 1}" aria-valuenow="${index}" aria-valuetext="${esc(name)}" aria-orientation="horizontal"${still ? ' aria-disabled="true"' : ""}></span></div>
  </div>
</div>`;
}

let pressed = 0;
/** True while a pointer is down on any slider: the page must not be redrawn then. */
export const efsPressed = () => pressed > 0;

class Slider {
  private steps: EfsStep[]; private last: number; private index: number; private still: boolean;
  private thumb: HTMLElement; private control: HTMLElement; private rail: HTMLElement; private level: HTMLElement;
  private pos: number; private target: number; private frame = 0; private dragging = false; private from = 0;
  constructor(readonly root: HTMLElement, private onChange: (value: string) => void) {
    this.steps = JSON.parse(root.dataset.steps || "[]"); this.still = this.steps.length < 2; this.last = Math.max(this.steps.length, 2) - 1;
    this.index = clamp(Number(root.dataset.index) || 0, 0, Math.max(this.steps.length - 1, 0));
    this.thumb = root.querySelector(".efs-thumb")!; this.control = root.querySelector(".efs-control")!; this.rail = root.querySelector(".efs-rail")!; this.level = root.querySelector(".efs-level")!;
    this.pos = this.target = this.index / this.last;
    if (this.still) return;
    this.control.addEventListener("pointerdown", e => this.down(e));
    this.control.addEventListener("pointermove", e => this.move(e));
    this.control.addEventListener("pointerup", () => this.up(false));
    this.control.addEventListener("pointercancel", () => this.up(true));
    this.thumb.addEventListener("keydown", e => this.key(e));
  }
  destroy() { cancelAnimationFrame(this.frame); this.frame = 0; if (this.dragging) { this.dragging = false; pressed = Math.max(0, pressed - 1); } }
  private reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private glide() {
    if (this.frame) return;
    const reduced = this.reduced(); let before = performance.now();
    const step = (now: number) => {
      const gap = this.target - this.pos, share = reduced ? 1 : 1 - Math.exp(-Math.min(64, Math.max(0, now - before)) / TAU);
      before = now;
      this.pos = Math.abs(gap) < 0.0004 ? this.target : this.pos + gap * share;
      this.root.style.setProperty("--pos", this.pos.toFixed(4));
      this.frame = this.pos === this.target ? 0 : requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
  /** The pointer's place along the rail (the track less half a thumb at each end), 0 to 1. */
  private along(clientX: number) { const r = this.rail.getBoundingClientRect(); return r.width ? clamp((clientX - r.left) / r.width, 0, 1) : 0; }
  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault(); this.thumb.focus({ preventScroll: true });
    try { this.control.setPointerCapture(e.pointerId); } catch {}
    this.dragging = true; pressed++; this.from = this.index;
    this.lead(e.clientX);
  }
  private move(e: PointerEvent) { if (this.dragging) this.lead(e.clientX); }
  private lead(x: number) { const at = this.along(x); this.target = at; this.glide(); this.show(Math.round(at * this.last)); }
  private up(cancel: boolean) {
    if (!this.dragging) return;
    this.dragging = false; pressed = Math.max(0, pressed - 1);
    if (cancel) this.show(this.from);
    this.target = this.index / this.last; this.glide();
    if (this.index !== this.from) this.onChange(this.steps[this.index].value);
  }
  private key(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const from = this.index, moves: Record<string, number> = { ArrowRight: from + 1, ArrowUp: from + 1, PageUp: from + 1, ArrowLeft: from - 1, ArrowDown: from - 1, PageDown: from - 1, Home: 0, End: this.last };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const before = this.index; this.show(moves[e.key]);
    if (!this.dragging) { this.target = this.index / this.last; this.glide(); }
    if (this.index !== before) this.onChange(this.steps[this.index].value);
  }
  /** Shows a step (thumb value, name) without reporting it. */
  private show(next: number) {
    next = clamp(next, 0, this.steps.length - 1);
    if (next === this.index) return;
    this.index = next; this.root.dataset.index = String(next);
    const name = this.steps[next].label;
    this.thumb.setAttribute("aria-valuenow", String(next)); this.thumb.setAttribute("aria-valuetext", name);
    this.name(name);
  }
  /** The step's name, changed letter by letter: the old one leaves, the new one arrives. */
  private name(text: string) {
    const reduced = this.reduced();
    for (const old of Array.from(this.level.children) as HTMLElement[]) {
      if (reduced) { old.remove(); continue; }
      old.className = "efs-out"; old.addEventListener("animationend", ev => { if (ev.target === old.lastElementChild) old.remove(); });
    }
    const span = document.createElement("span"); span.className = "efs-in"; span.innerHTML = letters(text); this.level.appendChild(span);
  }
}

const LIVE = new Map<HTMLElement, Slider>();
/** After each paint: starts the sliders that are new on the page and stops the ones whose markup is gone. */
export function efsMount(scope: ParentNode, onChange: (id: string, value: string) => void) {
  for (const [el, s] of LIVE) if (!el.isConnected) { s.destroy(); LIVE.delete(el); }
  scope.querySelectorAll<HTMLElement>("[data-efs]").forEach(el => { if (!LIVE.has(el)) LIVE.set(el, new Slider(el, v => onChange(el.dataset.efs!, v))); });
}
