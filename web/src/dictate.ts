// Voice dictation for the composers (#box in a task or on Home, #nbox in New task), desktop and phone.
// Tap the mic → the browser asks for the microphone → the mic becomes a red stop pill with a live timer and a level ring,
// and the box reads "Listening…" → tap again (or 5 minutes pass) → "Transcribing…" → the words land in the box at the cursor,
// never sent: the person reads them and sends. Esc cancels and throws the recording away. The audio goes to the server's
// POST /api/transcribe (Workers AI Whisper) and is never stored. No native dialogs: problems show as the app's own toast.
// v3.ts only hooks in: dictBtn() where the mic button goes, and dictInit() once in live mode.
type Deps = { api: string; note: (title: string, sub: string) => void };
type Key = "box" | "nbox";
let D: Deps | null = null;
const MAX_SEC = 300, WARN_SEC = 270, MIN_MS = 600;
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const S = {
  phase: "idle" as "idle" | "starting" | "rec" | "busy",
  key: "box" as Key, hash: "", t0: 0, gen: 0,
  stream: null as MediaStream | null, rec: null as MediaRecorder | null, chunks: [] as Blob[],
  ctx: null as AudioContext | null, raf: 0, tick: 0, abort: null as AbortController | null, lvl: 0, icon: "",
};
const MIC_LABEL = "Talk instead of typing";
// The button v3.ts puts in a composer. Painted to match the current dictation, so a re-render keeps the recording UI.
export function dictBtn(key: Key, icon: string) {
  S.icon = icon;
  return `<button type="button" class="cbtn mic dict" data-dict="${key}" title="${MIC_LABEL}" aria-label="${MIC_LABEL}">${icon}</button>`;
}

const btn = () => document.querySelector<HTMLButtonElement>(`[data-dict="${S.key}"]`);
const box = () => document.getElementById(S.key) as HTMLTextAreaElement | null;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const secs = () => (performance.now() - S.t0) / 1000;
const STOP = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2.5" fill="currentColor"/></svg>`;

// Paint the active composer (button, status line, box hidden while listening) from S. Idempotent: safe after a re-render.
function paint() {
  const b = btn(), t = box(), form = (t?.closest("form") || b?.closest("form")) as HTMLElement | null;
  for (const x of document.querySelectorAll<HTMLButtonElement>("[data-dict]")) if (x !== b || S.phase === "idle") idleBtn(x);
  for (const f of document.querySelectorAll<HTMLElement>("form.dicting")) if (f !== form || S.phase === "idle") { f.classList.remove("dicting", "dbusy"); f.querySelector(".dictst")?.remove(); }
  if (S.phase === "idle" || !b || !form) return;
  const recording = S.phase === "rec", s = recording ? secs() : 0;
  b.classList.add("on"); b.classList.toggle("rec", recording); b.classList.toggle("busy", S.phase !== "rec");
  b.setAttribute("aria-pressed", "true"); b.disabled = S.phase === "busy";
  const label = recording ? `Stop recording, ${fmt(s)}` : S.phase === "busy" ? "Transcribing" : "Starting the microphone";
  if (b.getAttribute("aria-label") !== label) { b.setAttribute("aria-label", label); b.title = recording ? "Stop and transcribe" : label; }
  const inner = recording ? `${STOP}<span class="dtime">${fmt(s)}</span>` : `<span class="dspin"></span>`;
  if (b.dataset.view !== (recording ? "rec" : "spin")) { b.innerHTML = inner; b.dataset.view = recording ? "rec" : "spin"; }
  else if (recording) { const tm = b.querySelector(".dtime"); if (tm && tm.textContent !== fmt(s)) tm.textContent = fmt(s); }
  b.style.setProperty("--lvl", S.lvl.toFixed(3));
  form.classList.add("dicting"); form.classList.toggle("dbusy", S.phase === "busy");
  let st = form.querySelector<HTMLElement>(".dictst");
  if (!st) { st = document.createElement("div"); st.className = "dictst"; st.setAttribute("role", "status"); st.setAttribute("aria-live", "polite"); (t ?? b).before(st); }
  const words = S.phase === "busy" ? "Transcribing…" : S.phase === "starting" ? "Starting the microphone…" : s >= WARN_SEC ? `Listening… stops at ${fmt(MAX_SEC)}` : "Listening…";
  const html = `<span class="dwave${S.phase === "busy" ? " busy" : ""}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="dwords">${esc(words)}</span>${recording ? `<span class="dhint">Esc to cancel</span>` : ""}`;
  if (st.dataset.w !== words) { st.innerHTML = html; st.dataset.w = words; }
  st.style.setProperty("--lvl", S.lvl.toFixed(3));
}
function idleBtn(x: HTMLButtonElement) {
  if (!x.classList.contains("on") && !x.dataset.view) return;
  x.classList.remove("on", "rec", "busy"); x.removeAttribute("aria-pressed"); x.disabled = false; delete x.dataset.view;
  x.setAttribute("aria-label", MIC_LABEL); x.title = MIC_LABEL; x.style.removeProperty("--lvl"); if (S.icon) x.innerHTML = S.icon;
}

// A re-render (refresh() redraws an empty composer) swaps the elements: re-apply, keeping focus on the stop button.
let mo: MutationObserver | null = null, moQ = 0;
function watch(on: boolean) {
  if (!on) { mo?.disconnect(); mo = null; return; }
  mo ??= new MutationObserver(() => { if (moQ) return; moQ = requestAnimationFrame(() => { moQ = 0; resync(); }); });
  mo.observe(document.body, { childList: true, subtree: true });
}
function resync() {
  if (S.phase === "idle") return;
  const b = btn();
  if (!b) { if (S.phase !== "busy") cancel(); return; }   // the composer went away (New task closed, a page without one)
  const lost = !document.activeElement || document.activeElement === document.body;
  paint(); if (lost && S.phase === "rec") b.focus({ preventScroll: true });
}

function release() {
  cancelAnimationFrame(S.raf); clearInterval(S.tick); S.raf = 0; S.tick = 0; S.lvl = 0;
  S.stream?.getTracks().forEach(t => t.stop()); S.stream = null;   // the mic light goes off right away
  S.ctx?.close().catch(() => {}); S.ctx = null;
}
function reset() { release(); S.rec = null; S.chunks = []; S.abort = null; S.phase = "idle"; watch(false); paint(); }
export function cancel() {
  if (S.phase === "idle") return;
  S.gen++; S.abort?.abort();
  if (S.rec && S.rec.state !== "inactive") { S.rec.ondataavailable = null; S.rec.onstop = null; try { S.rec.stop(); } catch { /* already stopped */ } }
  const hadFocus = S.phase === "rec"; reset(); if (hadFocus) btn()?.focus({ preventScroll: true });
}

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
const pickType = () => typeof MediaRecorder.isTypeSupported === "function" ? TYPES.find(t => MediaRecorder.isTypeSupported(t)) : undefined;

async function start(key: Key) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    D!.note("Talking isn't available here", "This browser can't record from the microphone. Try Chrome, Safari or Edge, or type instead."); return;
  }
  const gen = ++S.gen; Object.assign(S, { phase: "starting", key, hash: location.hash, chunks: [], lvl: 0 }); watch(true); paint();
  // The AudioContext is made inside the tap, so iOS lets it run (it only drives the level ring).
  try { S.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { S.ctx = null; }
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e: any) {
    if (gen !== S.gen) return; reset();
    const n = e?.name || "";
    if (n === "NotAllowedError" || n === "SecurityError") D!.note("The microphone is off for 1Helm", "To talk instead of typing, allow the microphone for this site in your browser's settings, then tap the mic again.");
    else if (n === "NotFoundError" || n === "OverconstrainedError") D!.note("No microphone found", "Plug in or turn on a microphone, then tap the mic again.");
    else D!.note("Couldn't start the microphone", "Another app may be using it. Close that app, then tap the mic again.");
    return;
  }
  if (gen !== S.gen) { stream.getTracks().forEach(t => t.stop()); return; }   // cancelled while the browser was asking
  S.stream = stream;
  let rec: MediaRecorder;
  try { const type = pickType(); rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined); }
  catch { reset(); D!.note("Talking isn't available here", "This browser can't record from the microphone. Try typing instead."); return; }
  S.rec = rec;
  rec.ondataavailable = e => { if (e.data?.size) S.chunks.push(e.data); };
  rec.onstop = () => { if (gen === S.gen) finish(gen, rec.mimeType); };
  rec.start(1000);
  S.phase = "rec"; S.t0 = performance.now();
  if (S.ctx) try {
    S.ctx.resume().catch(() => {});
    const an = S.ctx.createAnalyser(); an.fftSize = 512; S.ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const loop = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / buf.length), target = Math.min(1, rms * 5); S.lvl += (target - S.lvl) * (target > S.lvl ? .5 : .15);
      const b = btn(); if (b) b.style.setProperty("--lvl", S.lvl.toFixed(3)); document.querySelector<HTMLElement>(".dicting .dictst")?.style.setProperty("--lvl", S.lvl.toFixed(3));
      S.raf = requestAnimationFrame(loop); };
    S.raf = requestAnimationFrame(loop);
  } catch { /* no level ring: recording still works */ }
  S.tick = window.setInterval(() => { if (S.phase !== "rec") return; if (location.hash !== S.hash) { cancel(); return; } if (secs() >= MAX_SEC) stop(); else paint(); }, 250);
  paint(); btn()?.focus({ preventScroll: true });
}

function stop() {
  if (S.phase !== "rec" || !S.rec) return;
  S.phase = "busy"; cancelAnimationFrame(S.raf); clearInterval(S.tick); S.lvl = 0; paint();
  try { S.rec.stop(); } catch { reset(); return; }   // → onstop → finish()
  S.stream?.getTracks().forEach(t => t.stop());   // the mic light goes off now, not when the last chunk arrives
}

async function finish(gen: number, mime: string) {
  const seconds = secs(); release();
  const type = (mime || S.chunks[0]?.type || "audio/webm").split(";")[0], blob = new Blob(S.chunks, { type }); S.chunks = [];
  if (seconds * 1000 < MIN_MS || blob.size < 200) { reset(); D!.note("Didn't catch anything", "Tap the mic, talk, then tap again when you're done."); return; }
  S.abort = new AbortController();
  let text = "", err = "";
  try {
    const r = await fetch(`${D!.api}/transcribe`, { method: "POST", credentials: "same-origin", body: blob, signal: S.abort.signal,
      headers: { "content-type": type, "x-audio-seconds": seconds.toFixed(1) } });
    const d = await r.json().catch(() => ({}));
    if (r.ok && typeof d.text === "string" && d.text.trim()) text = d.text.trim(); else err = d.error || "Couldn't hear that, try again.";
  } catch (e: any) { if (gen !== S.gen || e?.name === "AbortError") return; err = "Couldn't reach 1Helm. Check your connection and try again."; }
  if (gen !== S.gen) return;
  const key = S.key; reset();
  if (err) { D!.note(err === "Couldn't hear that, try again." ? "Couldn't hear that" : "Couldn't transcribe that", err === "Couldn't hear that, try again." ? "Try again, a little closer to the microphone." : err); return; }
  insert(key, text);
}

// At the cursor (the end, if the person never moved it), with a space either side as needed. Not sent: they review it.
function insert(key: Key, text: string) {
  const t = document.getElementById(key) as HTMLTextAreaElement | null; if (!t) return;
  const v = t.value, a = Math.min(t.selectionStart ?? v.length, v.length), z = Math.min(t.selectionEnd ?? v.length, v.length);
  const pre = v.slice(0, a), post = v.slice(z);
  const add = (pre && !/\s$/.test(pre) ? " " : "") + text + (post && !/^\s/.test(post) ? " " : "");
  t.value = pre + add + post;
  const at = (pre + add).length;
  t.focus({ preventScroll: true }); t.setSelectionRange(at, at);
  t.dispatchEvent(new Event("input", { bubbles: true }));   // v3's input handler grows the box and lights up Send
  t.scrollTop = t.scrollHeight;   // a long dictation: show its end, where the cursor is
}

export function dictInit(deps: Deps) {
  D = deps;
  window.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest?.<HTMLButtonElement>("[data-dict]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const key = b.dataset.dict as Key;
    if (S.phase === "idle") start(key);
    else if (S.key === key && S.phase === "rec") stop();
  });
  // Esc cancels and discards (and doesn't also close New task); captured before v3's own Esc handling.
  window.addEventListener("keydown", e => {
    if (e.key !== "Escape" || S.phase === "idle") return;
    e.preventDefault(); e.stopImmediatePropagation(); cancel();
  }, true);
  window.addEventListener("hashchange", () => { if (S.phase === "rec" || S.phase === "starting") cancel(); });
  window.addEventListener("pagehide", () => cancel());
}
