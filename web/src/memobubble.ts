// Voice memo bubble: an Apple Messages style audio pill that plays in place (v3.ts fileCard).
// All state lives here, keyed by file id, so a chat repaint (which replaces the HTML) draws the same bubble again.
const N = 36, a = new Audio(), pos = new Map<string, number>(), peaks = new Map<string, number[]>(), busy = new Set<string>();
let cur = "";
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const total = (len: string) => { const [m, s] = len.split(":"); return +m * 60 + +s; };
const ICON = (pause: boolean) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${pause ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>' : '<path d="M8 5.5v13l11-6.5z"/>'}</svg>`;

function parts(id: string, len: string) {
  const dur = cur === id && isFinite(a.duration) ? a.duration : total(len), t = pos.get(id) || 0, p = Math.min(1, t / dur), pk = peaks.get(id), playing = cur === id && !a.paused;
  const bars = Array.from({ length: N }, (_, i) => `<i${i < p * N ? ' class="on"' : ""} style="height:${pk ? Math.max(12, Math.round(pk[i] * 100)) : 14}%"></i>`).join("");
  return { bars, playing, p, time: p > 0 || playing ? "-" + clock(Math.max(0, dur - t)) : len, label: playing ? "Pause" : `Play voice memo, ${len}` };
}
export function memoBubble(id: string, url: string, mine: boolean, len: string) {
  const x = parts(id, len);
  return `<div class="vmb${mine ? " mine" : ""}" data-vmb="${id}" data-url="${url}" data-len="${len}"><button type="button" class="vmb-play" aria-label="${x.label}">${ICON(x.playing)}</button><div class="vmb-wave" aria-hidden="true">${x.bars}</div><span class="vmb-t">${x.time}</span></div>`;
}
function sync(el: HTMLElement) {
  const x = parts(el.dataset.vmb!, el.dataset.len!), b = el.querySelector(".vmb-play")!;
  el.querySelector(".vmb-wave")!.innerHTML = x.bars; el.querySelector(".vmb-t")!.textContent = x.time;
  b.innerHTML = ICON(x.playing); b.setAttribute("aria-label", x.label);
}
const syncAll = (id: string) => document.querySelectorAll<HTMLElement>(`.vmb[data-vmb="${CSS.escape(id)}"]`).forEach(sync);

// Peaks come from the file itself: 16 kHz mono 16-bit WAV, samples start after the 44-byte header.
async function load(id: string, url: string) {
  if (peaks.has(id) || busy.has(id)) return;
  busy.add(id);
  try {
    const buf = await (await fetch(url)).arrayBuffer(), s = new Int16Array(buf, 44, Math.max(0, (buf.byteLength - 44) >> 1)), step = Math.max(1, Math.floor(s.length / N)), pk: number[] = [];
    for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step; j < Math.min(s.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(s[j])); pk.push(m); }
    const top = Math.max(...pk) || 1; peaks.set(id, pk.map(m => m / top)); syncAll(id);
  } catch { /* the flat bars stay */ }
  busy.delete(id);
}
function seek(el: HTMLElement, e: PointerEvent) {
  const id = el.dataset.vmb!, r = el.querySelector(".vmb-wave")!.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), dur = cur === id && isFinite(a.duration) ? a.duration : total(el.dataset.len!);
  pos.set(id, f * dur); if (cur === id) a.currentTime = f * dur; syncAll(id);
}
function toggle(el: HTMLElement) {
  const id = el.dataset.vmb!;
  if (cur === id && !a.paused) { a.pause(); return; }
  if (cur !== id) { const old = cur; cur = id; a.src = el.dataset.url!; a.currentTime = pos.get(id) || 0; if (old) syncAll(old); }
  a.play().catch(() => {});
}
if (typeof document !== "undefined") {
  for (const ev of ["play", "pause", "timeupdate", "loadedmetadata"]) a.addEventListener(ev, () => { if (cur) { if (ev === "timeupdate") pos.set(cur, a.currentTime); syncAll(cur); } });
  a.addEventListener("ended", () => { pos.delete(cur); a.currentTime = 0; syncAll(cur); });
  document.addEventListener("click", e => { const b = (e.target as HTMLElement).closest(".vmb-play"); if (b) toggle(b.closest<HTMLElement>(".vmb")!); });
  document.addEventListener("pointerdown", e => { const w = (e.target as HTMLElement).closest<HTMLElement>(".vmb-wave"); if (w) { w.setPointerCapture(e.pointerId); seek(w.parentElement!, e); } });
  document.addEventListener("pointermove", e => { const w = (e.target as HTMLElement).closest<HTMLElement>(".vmb-wave"); if (w && e.buttons) seek(w.parentElement!, e); });
  const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { const el = x.target as HTMLElement; load(el.dataset.vmb!, el.dataset.url!); } }));
  new MutationObserver(() => document.querySelectorAll(".vmb").forEach(el => io.observe(el))).observe(document.documentElement, { childList: true, subtree: true });
}
