// The recording pill for voice memos (voicememo.ts): while a memo records, a pill covers the composer's text row (same place and size, nothing
// moves), shows a pulsing dot, the elapsed time, a waveform that follows the microphone level and one line telling what letting go does.
// The composer's border glows in the record color with the voice level. The pill is a fixed element placed over the text row, so the composer's
// own layout is never touched and the draft text stays underneath. Styles are in dictate.css.
export type PillEnd = 'done' | 'cancel' | 'quiet';
export type Pill = {
  show(btn: HTMLElement, line: string): void;
  set(o: { line?: string; leaving?: boolean }): void;
  level(v: number): void;
  end(kind: PillEnd): void;
};
export const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const BAR = 3, GAP = 2, STEP_MS = 70, HIDE_MS = 1500;
let el: HTMLElement | null = null, host: HTMLElement | null = null, btnEl: HTMLElement | null = null, raf = 0, cleanup = 0;
let cv: HTMLCanvasElement | null = null, tEl: HTMLElement | null = null, lEl: HTMLElement | null = null, sr: HTMLElement | null = null;
let t0 = 0, lvl = 0, smooth = 0, glow = 0, lastStep = 0, shown = '', leaving = false, color = '#dc2626';
let hist: number[] = [];
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function place() {
  if (!el || !host || !btnEl) return;
  const hr = host.getBoundingClientRect(), cs = getComputedStyle(host), ta = host.querySelector('textarea');
  let l: number, t: number, w: number, h: number;
  if (host.classList.contains('composer')) {   // main composer: from the left padding to the mic button, the full inner height
    const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0, pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const mic = btnEl.getBoundingClientRect(); l = hr.left + bl + pl; t = hr.top + bt + pt; w = mic.left - 2 - l; h = hr.height - 2 * bt - pt - pb;
  } else { const r = (ta || host).getBoundingClientRect(); l = r.left; t = r.top; w = r.width; h = r.height; }   // new task box: over its text area
  el.style.left = `${l}px`; el.style.top = `${t}px`; el.style.width = `${Math.max(0, w)}px`; el.style.height = `${h}px`; el.style.borderRadius = `${Math.min(h / 2, 22)}px`;
}
function draw() {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); g.fillStyle = color;
  const n = Math.max(1, Math.floor((w + GAP) / (BAR + GAP))), still = reduced();
  for (let i = 0; i < n; i++) {
    // Newest sample on the right. With reduced motion nothing scrolls: each bar keeps its place and takes the current level, shaped by a fixed pattern.
    const v = still ? smooth * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.7))) : (hist[hist.length - n + i] ?? 0);
    const bh = Math.max(3, Math.min(h, v * h)), x = w - (n - i) * (BAR + GAP) + GAP;
    g.globalAlpha = still ? 1 : 0.45 + 0.55 * ((i + 1) / n);
    g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, (h - bh) / 2, BAR, bh, BAR / 2) : g.rect(x, (h - bh) / 2, BAR, bh); g.fill();
  }
  g.globalAlpha = 1;
}
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  smooth += (lvl - smooth) * (lvl > smooth ? 0.45 : 0.12);   // quick to rise, slow to fall, so the bars and the glow do not flicker
  glow += (smooth - glow) * 0.18;
  if (host) host.style.setProperty('--vml', leaving ? '0' : glow.toFixed(3));
  if (now - lastStep >= STEP_MS) { lastStep = now; hist.push(Math.sqrt(smooth)); if (hist.length > 400) hist.splice(0, hist.length - 400); }
  const t = clock(performance.now() - t0); if (t !== shown && tEl) { shown = t; tEl.textContent = t; }
  place(); draw();
}
function stop() {
  cancelAnimationFrame(raf); raf = 0;
  if (host) { host.classList.remove('vmglow'); host.style.removeProperty('--vml'); }
  host = null; btnEl = null;
}

export const memoPill: Pill = {
  show(btn, line) {
    clearTimeout(cleanup); el?.remove(); stop();
    const h = btn.closest<HTMLElement>('form'); if (!h) return;
    host = h; btnEl = btn; leaving = false; lvl = smooth = glow = 0; hist = []; shown = ''; t0 = performance.now(); lastStep = 0;
    color = getComputedStyle(document.documentElement).getPropertyValue('--rec').trim() || '#dc2626';
    el = document.createElement('div'); el.className = 'vmpill'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="vmdot" aria-hidden="true"></span><span class="vmt" aria-hidden="true">0:00</span><canvas class="vmwave" aria-hidden="true"></canvas><span class="vmline" aria-hidden="true"></span><span class="dsr"></span>';
    tEl = el.querySelector('.vmt'); lEl = el.querySelector('.vmline'); cv = el.querySelector('canvas'); sr = el.querySelector('.dsr'); lEl!.textContent = line;
    document.body.appendChild(el); host.classList.add('vmglow'); place();
    setTimeout(() => { if (sr && el) sr.textContent = 'Recording voice memo'; }, 60);   // text added after the pill exists, so screen readers announce it
    raf = requestAnimationFrame(frame);
  },
  set(o) {
    if (!el) return;
    if (o.line !== undefined && lEl) lEl.textContent = o.line;
    if (o.leaving !== undefined) { leaving = o.leaving; el.classList.toggle('leaving', leaving); }
  },
  level(v) { lvl = v; },
  end(kind) {
    if (!el) return;
    const e = el; stop(); e.classList.add('out');
    if (kind !== 'quiet' && sr) sr.textContent = kind === 'done' ? 'Voice memo recorded' : 'Voice memo canceled';
    clearTimeout(cleanup); cleanup = window.setTimeout(() => { e.remove(); if (el === e) el = null; }, HIDE_MS);
  },
};
