// Voice memos: hold the composer's mic button to record a memo, let go to attach it. A tap still starts live dictation (dictate.ts).
// The microphone opens on pointer down, so the first word of a memo is not lost. A press released within TAP_MS is a tap: the stream is
// closed and dictate.ts handles the click as before. A longer press records 16 kHz mono PCM through the shared worklet (pcm.ts) and, on
// release, hands a WAV file to the composer's upload path (v3.ts memoAdd). Sliding off the button, Esc, or leaving the page cancels it.
import { pcmProcessor, wavOf, PCM_RATE, WAV_TYPE } from './pcm';
import { silentRelease } from './silent';
import type { Pill } from './memopill';

export const TAP_MS = 300;                       // released sooner than this: a tap (dictation)
export const MAX_MS = 10 * 60 * 1000;            // a memo ends by itself after 10 minutes, as if released
export const MIN_BYTES = PCM_RATE * 2 * 0.5;     // under half a second of audio is dropped silently
export const MAX_BYTES = PCM_RATE * 2 * (MAX_MS / 1000);
export const SLOP = 4;                           // px of tolerance when checking that the pointer is still on the button
export const MEMO_LABEL = 'Tap to dictate, hold to record a voice memo';

export const decide = (heldMs: number): 'tap' | 'hold' => (heldMs < TAP_MS ? 'tap' : 'hold');
type Rect = { left: number; right: number; top: number; bottom: number };
export const outside = (r: Rect, x: number, y: number, slop = SLOP) => x < r.left - slop || x > r.right + slop || y < r.top - slop || y > r.bottom + slop;
/** "Voice memo N.wav": N is one more than the highest memo number already in the unsent draft (1 when there is none). */
export function memoName(existing: string[]): string {
  let max = 0; for (const n of existing) { const m = /^Voice memo (\d{1,4})\.wav$/i.exec(n); if (m) max = Math.max(max, Number(m[1])); }
  return `Voice memo ${max + 1}.wav`;
}
/** The press: down, then either a tap, or a hold that ends in a release or a cancel. Pure, so the timing is testable. */
export class Gesture {
  state: 'idle' | 'down' | 'hold' = 'idle';
  down() { this.state = 'down'; }
  /** The TAP_MS timer fired. True when the press became a hold. */
  promote(): boolean { if (this.state !== 'down') return false; this.state = 'hold'; return true; }
  /** Pointer released. */
  up(): 'tap' | 'release' | 'none' { const s = this.state; this.state = 'idle'; return s === 'down' ? 'tap' : s === 'hold' ? 'release' : 'none'; }
  cancel(): boolean { const was = this.state !== 'idle'; this.state = 'idle'; return was; }
}

// ---- the browser part ----
/** The line in the recording pill: what letting go does. */
export const releaseLine = (choice: 'release' | 'manually' | null | undefined) => choice === 'release' ? 'Release to send' : choice === 'manually' ? 'Release to add' : 'Release to finish';
export const CANCEL_LINE = 'Release to cancel';
type Deps = { note: (title: string, sub: string) => void; onMemo: (key: string, wav: Blob) => void; blocked: () => boolean; choice?: () => 'release' | 'manually' | null; pill?: Pill };
type Cap = {
  key: string; btn: HTMLElement; id: number; g: Gesture; perm: string; hold: boolean; released: boolean; cancelled: boolean; done: boolean; leaving: boolean;
  stream?: MediaStream; ctx?: AudioContext; node?: AudioWorkletNode; source?: MediaStreamAudioSourceNode;
  frames: ArrayBuffer[]; bytes: number; level: number; tap?: number; max?: number; flushed?: () => void;
};
let D: Deps | null = null, cur: Cap | null = null, swallow = 0;
const PROCESSOR = pcmProcessor('memo-pcm', true);
export const memoActive = () => !!cur && !cur.cancelled && cur.hold;

function paint() {
  const c = cur, on = !!c && !c.cancelled && c.hold && !c.released;
  for (const b of document.querySelectorAll<HTMLElement>('[data-dict]')) {
    const mine = on && b === c!.btn;
    b.classList.toggle('mrec', mine); b.classList.toggle('mleave', mine && c!.leaving);
    if (mine) b.style.setProperty('--lvl', String(c!.level));
    else if (b.classList.contains('mrec') || b.dataset.mlvl) b.style.setProperty('--lvl', '0');
    b.dataset.mlvl = mine ? '1' : '';
  }
}
function teardown(c: Cap) {
  clearTimeout(c.tap); clearTimeout(c.max);
  c.stream?.getTracks().forEach(t => t.stop()); c.source?.disconnect(); c.node?.disconnect(); c.ctx?.close().catch(() => {});
  c.stream = undefined; c.source = undefined; c.node = undefined; c.ctx = undefined;
}
async function permission(): Promise<string> {
  try { return (await (navigator.permissions as any).query({ name: 'microphone' })).state; } catch { return 'unknown'; }
}
async function open(c: Cap) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { c.cancelled = true; return; }
  silentRelease();
  const perm = permission(); perm.then(p => { c.perm = p; });
  let ctx: AudioContext;
  try { ctx = c.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { c.cancelled = true; return; }
  try {
    const media = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }));
    const mod = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    media.catch(() => {}); mod.catch(() => {});
    const [stream] = await Promise.all([media, mod, ctx.resume().catch(() => {})]);
    c.stream = stream;
    if (c.cancelled || c.done || (c.released && !c.hold) || (cur !== c && !c.hold)) { teardown(c); return; }   // a tap, or cancelled meanwhile
    if (c.released) {   // let go before the microphone was ready (the browser's permission prompt, usually): nothing was recorded
      teardown(c); c.done = true;
      D?.pill?.end('quiet');
      if (c.perm !== 'granted') D?.note('Hold again to record', 'The microphone is on now.');
      return;
    }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const node = c.node = new AudioWorkletNode(ctx, 'memo-pcm');
    node.port.onmessage = e => {
      if (c.cancelled) return;
      if (e.data.type === 'level') { c.level = Math.min(1, e.data.value * 4); D?.pill?.level(c.level); if (c.hold && !c.released) c.btn.style.setProperty('--lvl', String(c.level)); }
      else if (e.data.type === 'audio') { c.frames.push(e.data.pcm); c.bytes += e.data.pcm.byteLength; if (c.bytes >= MAX_BYTES && c.hold && !c.released) autoStop(c); }
      else if (e.data.type === 'flushed') c.flushed?.();
    };
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (cur === c && c.hold && !c.released && !c.cancelled) cancel(c); }));
    c.source = ctx.createMediaStreamSource(stream); c.source.connect(node);
    const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination);
  } catch (e: any) {
    teardown(c);
    if (c.hold && !c.cancelled && !c.done) D?.note('Microphone is off', e?.name === 'NotAllowedError' ? 'Allow microphone access for this site and try again.' : 'Could not start the microphone. Check your audio device and try again.');
    if (c.hold) D?.pill?.end('quiet');
    c.done = true; if (cur === c && !c.hold) cur = null; paint();
  }
}
function cancel(c: Cap) {
  if (c.cancelled || c.done) return;
  if (c.hold) D?.pill?.end('cancel');
  c.cancelled = true; c.g.cancel(); c.frames = []; c.bytes = 0; teardown(c); swallow = performance.now() + 800; paint();
}
async function finish(c: Cap) {
  c.released = true; paint();
  clearTimeout(c.max);
  if (!c.node) { return; }   // not ready yet: open() sees `released` and drops it
  const flushed = new Promise<void>(res => { c.flushed = res; setTimeout(res, 1200); });
  c.node.port.postMessage('stop'); await flushed;
  const frames = c.frames, bytes = c.bytes; teardown(c); c.done = true; c.frames = [];
  if (c.cancelled || bytes < MIN_BYTES) { D?.pill?.end('quiet'); return; }
  D?.onMemo(c.key, wavOf(frames)); D?.pill?.end('done');
}
function autoStop(c: Cap) { c.g.up(); swallow = performance.now() + 800; void finish(c); }

export function memoInit(deps: Deps) {
  D = deps;
  const dict = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.<HTMLElement>('[data-dict]') || null;
  window.addEventListener('pointerdown', e => {
    const b = dict(e.target); if (!b) return;
    if ((e.pointerType === 'mouse' && e.button !== 0) || D!.blocked()) return;
    if (cur && !cur.cancelled && !cur.done) return;
    try { b.setPointerCapture(e.pointerId); } catch {}
    const c: Cap = { key: b.dataset.dict!, btn: b, id: e.pointerId, g: new Gesture(), perm: 'unknown', hold: false, released: false, cancelled: false, done: false, leaving: false, frames: [], bytes: 0, level: 0 };
    cur = c; c.g.down();
    c.tap = window.setTimeout(() => {
      if (!c.g.promote()) return;
      c.hold = true;
      D!.pill?.show(c.btn, releaseLine(D!.choice?.()));
      try { if (typeof navigator.vibrate === 'function') navigator.vibrate(10); } catch {}   // Android and Chrome only
      c.max = window.setTimeout(() => { if (cur === c && !c.released && !c.cancelled) autoStop(c); }, MAX_MS);
      paint();
    }, TAP_MS);
    void open(c);
  }, true);
  window.addEventListener('pointermove', e => {
    const c = cur; if (!c || c.cancelled || c.done || e.pointerId !== c.id || c.released) return;
    // Sliding off the button does not cancel yet: the pill says "Release to cancel", and sliding back on keeps the memo.
    if (!c.hold) { if (outside(c.btn.getBoundingClientRect(), e.clientX, e.clientY)) cancel(c); return; }
    const off = outside(c.btn.getBoundingClientRect(), e.clientX, e.clientY);
    if (off !== c.leaving) { c.leaving = off; D?.pill?.set({ leaving: off, line: off ? CANCEL_LINE : releaseLine(D?.choice?.()) }); paint(); }
  }, true);
  const up = (e: PointerEvent) => {
    const c = cur; if (!c || e.pointerId !== c.id) return;
    try { c.btn.releasePointerCapture(e.pointerId); } catch {}
    clearTimeout(c.tap);
    if (c.cancelled || c.done || c.released) { swallow = performance.now() + 800; cur = null; paint(); return; }
    const out = c.g.up();
    if (out === 'tap') { c.cancelled = true; teardown(c); cur = null; return; }   // the click that follows starts dictation (dictate.ts)
    if (out === 'release' && c.leaving) { cancel(c); cur = null; paint(); return; }   // let go away from the button: canceled
    if (out === 'release') { swallow = performance.now() + 800; if (c.ctx?.state === 'suspended') c.ctx.resume().catch(() => {}); void finish(c).then(() => { if (cur === c) cur = null; paint(); }); return; }
    cur = null;
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', e => { const c = cur; if (c && e.pointerId === c.id) { cancel(c); cur = null; paint(); } }, true);
  // A press that turned into a memo (or a cancel) must not also start or stop dictation.
  window.addEventListener('click', e => { if (dict(e.target) && performance.now() < swallow) { e.preventDefault(); e.stopImmediatePropagation(); swallow = 0; } }, true);
  window.addEventListener('contextmenu', e => { if (dict(e.target)) e.preventDefault(); }, true);   // phones: holding must not open a menu
  window.addEventListener('keydown', e => {
    const c = cur; if (!c || c.cancelled || c.done || e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation(); cancel(c);
  }, true);
  const stopAll = () => { const c = cur; if (c && !c.cancelled && !c.done && !c.released) { cancel(c); paint(); } };
  window.addEventListener('blur', stopAll); window.addEventListener('pagehide', stopAll); window.addEventListener('hashchange', stopAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
}
export { WAV_TYPE };
