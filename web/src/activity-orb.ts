/*!
Thinking orbs engine, https://github.com/Jakubantalik/Libraries.dev
MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { paintFrame } from './vendor/thinking-orbs/engine/core';
import { MODE_FRAMES } from './vendor/thinking-orbs/engine/registry';
import { resolvePreset } from './vendor/thinking-orbs/presets';
import type { OrbState } from './vendor/thinking-orbs/types';

export type ActivityState = 'working' | 'searching' | 'solving' | 'listening' | 'connecting' | 'composing' | 'breathing';
export function orb(state: ActivityState = 'working', paused = false, theme?: 'dark' | 'light') {
  return `<activity-orb state="${state}"${paused ? ' paused' : ''}${theme ? ` theme="${theme}"` : ''} aria-hidden="true"></activity-orb>`;
}

// One clock and frame scheduler for the whole app. Shadow DOM protects each
// canvas from chat's in-place HTML updates; connected/disconnected callbacks
// also cover innerHTML replacements in the activity panel.
const mounted = new Set<ActivityOrb>();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const scheme = matchMedia('(prefers-color-scheme: dark)');
let raf = 0, lastFrame = 0;
const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && scheme.matches);
const running = () => !document.hidden && !reduced.matches && [...mounted].some(o => o.visible && !o.hasAttribute('paused'));
function schedule() { if (!raf && running()) raf = requestAnimationFrame(frame); }
function frame(now: number) {
  raf = 0;
  if (now - lastFrame >= 1000 / 30) {
    lastFrame = now;
    for (const o of mounted) if (o.visible && !o.hasAttribute('paused')) o.paint(now / 1000);
  }
  schedule();
}
function refresh() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  for (const o of mounted) o.paint(reduced.matches || o.hasAttribute('paused') ? .6 : performance.now() / 1000);
  schedule();
}
const visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
  for (const e of entries) { const o = e.target as ActivityOrb; o.visible = e.isIntersecting; }
  if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
  schedule();
});
const themes = new MutationObserver(refresh);
function connectGlobals() {
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  reduced.addEventListener('change', refresh);
  scheme.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('resize', refresh);
}
function disconnectGlobals() {
  themes.disconnect();
  reduced.removeEventListener('change', refresh);
  scheme.removeEventListener('change', refresh);
  document.removeEventListener('visibilitychange', refresh);
  window.removeEventListener('resize', refresh);
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
class ActivityOrb extends HTMLElement {
  static observedAttributes = ['state', 'paused', 'theme'];
  visible = !visibility;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:20px;height:20px';
    this.canvas.setAttribute('part', 'canvas');
    shadow.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }
  connectedCallback() {
    if (!mounted.size) connectGlobals();
    mounted.add(this); visibility?.observe(this);
    this.paint(reduced.matches || this.hasAttribute('paused') ? .6 : performance.now() / 1000);
    schedule();
  }
  disconnectedCallback() {
    mounted.delete(this); visibility?.unobserve(this);
    if (!mounted.size) disconnectGlobals();
    else if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.paint(reduced.matches || this.hasAttribute('paused') ? .6 : performance.now() / 1000);
    if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
    schedule();
  }
  paint(seconds: number) {
    if (!this.ctx) return;
    const dpr = Math.min(2, devicePixelRatio || 1), pixels = Math.round(20 * dpr);
    if (this.canvas.width !== pixels || this.canvas.height !== pixels) { this.canvas.width = pixels; this.canvas.height = pixels; }
    const state = this.getAttribute('state') as OrbState;
    const preset = resolvePreset(['working', 'searching', 'solving', 'listening', 'connecting', 'composing', 'breathing'].includes(state) ? state : 'working', 20);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, 20, 20);
    // A slower shared clock keeps movement restrained at inline size.
    const t = reduced.matches || this.hasAttribute('paused') ? .6 : seconds * preset.speed * .68;
    paintFrame(this.ctx, MODE_FRAMES[preset.mode](20, t, preset.opts), this.getAttribute('theme') === 'dark' || (this.getAttribute('theme') !== 'light' && dark()));
  }
}
if (!customElements.get('activity-orb')) customElements.define('activity-orb', ActivityOrb);
