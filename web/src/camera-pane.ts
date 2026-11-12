// In-app camera for the composer's add-files button on phones (touch screens only; desktop keeps the Library popover).
// The + opens a small menu: Camera, Photos, Files and Library. Photos and Files are the system file pickers, Library is the
// existing Library picker. Camera opens a live viewfinder in a rounded panel over the chat: a round back button, a white
// shutter and a round "more" button (Flip camera when the phone has two cameras, and Choose from photos).
// The shutter draws the current video frame, at the camera's full size, to a canvas and makes a JPEG File. camera-pane.ts never
// uploads: it hands that File to deps.attach, which is the same upload path the file inputs, paste and drop use (chips with a
// thumbnail, removable before sending), so there is no Retake step: removing the chip and tapping Camera again is the retake.
// The camera stops (every track) whenever the panel closes, the page goes to the background, or the route changes.
// If getUserMedia is missing, refused or fails, the panel closes and the phone's own camera opens through an input with
// capture, with at most one plain note.
export type CamDeps = {
  phone: () => boolean;                                          // the phone layout (same test as the Library sheet)
  attach: (key: string, files: File[]) => void;                  // v3.ts upload(key, slug, files)
  pick: (key: string, accept: string, multiple: boolean, capture?: string) => void;   // v3.ts pickFiles: a hidden file input, clicked at once
  library: (key: string, btn: HTMLElement) => void;              // v3.ts pkOpen
  note: (title: string, sub: string, action: string) => void;    // v3.ts note()
};
let D: CamDeps | null = null;
const svg = (d: string, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const P = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>',
  files: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  library: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  flip: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
};
const touch = () => (navigator.maxTouchPoints || 0) > 0 || matchMedia("(pointer:coarse)").matches;
/** True where the + opens the menu: a touch phone (a narrow desktop window or a tablet keeps the Library popover). */
export const camPhone = () => !!D && D.phone() && touch();
// Photos and Files (and the camera panel's "Choose from photos") are labels that wrap their own visually hidden file input, so the person's tap is the tap
// on the input and iOS anchors its picker popover to that visible row. The row stays on screen until the picker returns (change, cancel, or the page
// coming back to the front), and then closes. A file input only exists inside an open menu or panel, never after it closes.
const FIN = "input[data-cmp-fin]";
/** Text-entry controls: the ones that open the keyboard. */
export const TEXT_ENTRY = "textarea,input:not([type=file]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]),[contenteditable]:not([contenteditable=false])";
const finLabel = (cls: string, id: string, label: string, p: string, accept: string, multiple: boolean, size = 22) =>
  `<label class="${cls}" role="menuitem" tabindex="0" data-cmp-do="${id}">${svg(p, size)}<span>${label}</span><input type="file" class="cmp-fin" tabindex="-1" aria-hidden="true" data-cmp-fin="${id}"${accept ? ` accept="${accept}"` : ""}${multiple ? " multiple" : ""}></label>`;
let PEND: { close: () => void; timer: any; away: boolean } | null = null;
function pendEnd() { if (PEND) { clearTimeout(PEND.timer); const c = PEND.close; PEND = null; c(); } }
function pendStart(i: HTMLInputElement) {
  const inPane = !!i.closest("#cmp-pane"); PEND = { close: () => (inPane ? camClose() : camMenuClose()), timer: 0, away: false };
}
function pendBack() {
  if (!PEND) return; clearTimeout(PEND.timer);
  PEND.timer = setTimeout(() => { const i = document.querySelector<HTMLInputElement>(FIN); if (!i?.files?.length) pendEnd(); }, 3000);   // back from the picker and no change came: nothing was chosen
}
export function camInit(d: CamDeps) {
  D = d;
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", e => {
    const i = e.target as HTMLInputElement; if (!i?.matches?.(FIN)) return;
    const files = [...(i.files || [])], inPane = !!i.closest("#cmp-pane"), key = inPane ? S.key : M.key; PEND = null;
    if (inPane) camClose(); else camMenuClose();
    if (files.length) D!.attach(key, files);
  }, true);
  document.addEventListener("cancel", e => { if ((e.target as HTMLElement)?.matches?.(FIN)) pendEnd(); }, true);
  window.addEventListener("blur", () => { if (PEND) PEND.away = true; });
  window.addEventListener("focus", pendBack);
  // A text field about to take the keyboard: no file input may exist then. iOS counts every other field in the page when the keyboard opens and adds its
  // previous/next arrow bar, so the menu (and its file inputs) closes on the touch that reaches a text field, and again when the field takes focus.
  const toText = (e: Event) => { const t = e.target as HTMLElement | null; if (t?.matches?.(TEXT_ENTRY) && !t.closest("#cmp-menu,#cmp-pane")) { pendEnd(); camMenuClose(); } };
  document.addEventListener("pointerdown", toText, true); document.addEventListener("focusin", toText, true);
  document.addEventListener("pointerdown", () => { if (PEND?.away) pendEnd(); }, true);   // the picker has returned and the person touches the page: nothing was chosen
  document.addEventListener("visibilitychange", () => { if (document.hidden) { if (PEND) PEND.away = true; } else pendBack(); });
  document.addEventListener("keydown", e => { const l = (e.target as HTMLElement)?.closest?.<HTMLElement>("label.cmp-item"); if (l && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); l.querySelector<HTMLInputElement>(FIN)?.click(); } }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden && !PEND) camClose(); });
  window.addEventListener("pagehide", () => { if (!PEND) camClose(); });
  window.addEventListener("hashchange", () => { camMenuClose(); camClose(); });
  window.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (document.getElementById("cmp-pane")) { e.preventDefault(); e.stopImmediatePropagation(); if (S.more) moreSet(false); else camClose(); }
    else if (document.getElementById("cmp-menu")) { e.preventDefault(); e.stopImmediatePropagation(); camMenuClose(true); }
  }, true);
}

// ---------- the menu ----------
const M = { key: "box", btn: null as HTMLElement | null };
export function camMenuClose(focus = false) {
  const w = document.getElementById("cmp-menu"); if (!w) return;
  M.btn?.setAttribute("aria-expanded", "false"); w.remove(); if (focus && M.btn?.isConnected) M.btn.focus({ preventScroll: true });
}
export function camMenu(key: string, btn: HTMLElement) {
  if (!D) return; pendEnd(); camMenuClose(); Object.assign(M, { key, btn });
  const item = (id: string, label: string, p: string) => `<button type="button" class="cmp-item" role="menuitem" data-cmp-do="${id}">${svg(p, 22)}<span>${label}</span></button>`;
  const w = document.createElement("div"); w.id = "cmp-menu";
  w.innerHTML = `<div class="cmp-scrim" data-cmp-scrim></div><div class="cmp-pop" role="menu" aria-label="Add files">${item("camera", "Camera", P.camera)}${finLabel("cmp-item", "photos", "Photos", P.photos, "image/*,video/*", true)}${finLabel("cmp-item", "files", "Files", P.files, "", true)}${item("library", "Library", P.library)}</div>`;
  document.body.appendChild(w);
  const pop = w.querySelector<HTMLElement>(".cmp-pop")!, r = btn.getBoundingClientRect(), h = pop.offsetHeight;
  pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - pop.offsetWidth - 12))}px`;
  if (r.top - 12 >= h + 8 || r.top > innerHeight - r.bottom) { pop.style.bottom = `${innerHeight - r.top + 8}px`; pop.style.maxHeight = `${Math.max(120, r.top - 20)}px`; pop.classList.add("up"); }
  else { pop.style.top = `${r.bottom + 8}px`; pop.style.maxHeight = `${Math.max(120, innerHeight - r.bottom - 20)}px`; }
  btn.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => w.classList.add("on")); pop.querySelector<HTMLElement>(".cmp-item")?.focus({ preventScroll: true });
}

// ---------- the camera panel ----------
type St = { stream: MediaStream | null; tok: number; facing: "environment" | "user"; cams: number; busy: boolean; more: boolean; key: string; native: boolean };
const S: St = { stream: null, tok: 0, facing: "environment", cams: 0, busy: false, more: false, key: "box", native: false };
const stop = () => { const s = S.stream; S.stream = null; s?.getTracks().forEach(t => { try { t.stop(); } catch {} }); };
export function camClose() {
  S.tok++; stop(); S.more = false;
  const p = document.getElementById("cmp-pane"); if (!p) return;
  const v = p.querySelector("video"); if (v) { v.pause(); v.srcObject = null; }
  p.remove(); document.documentElement.classList.remove("cmp-open");
}
// The phone's own camera, through an input with capture. Called from a tap when possible; after an await the tap may no longer count
// (iOS), so then the one note carries a button that is a real tap.
function native(key: string) {
  const ok = (navigator as any).userActivation ? (navigator as any).userActivation.isActive : true;
  const go = () => D!.pick(key, "image/*", false, "environment");
  S.key = key;
  if (ok) { go(); D!.note("Camera not available", "Your phone's camera app opens instead.", ""); }
  else D!.note("Camera not available", "Use your phone's camera app instead.", `<button type="button" class="tview" data-cmp-native>Open camera</button>`);
}
const sizeOf = (s: MediaStream) => s.getVideoTracks()[0]?.getSettings?.() || {};
async function open(facing: "environment" | "user", deviceId?: string): Promise<MediaStream> {
  const md = navigator.mediaDevices, big = { width: { ideal: 3840 }, height: { ideal: 3840 } };
  const tries: MediaStreamConstraints[] = deviceId ? [{ video: { deviceId: { exact: deviceId }, ...big } }, { video: { deviceId: { exact: deviceId } } }]
    : [{ video: { facingMode: facing, ...big } }, { video: { facingMode: facing } }, { video: true }];
  let err: any;
  for (const c of tries) { try { return await md.getUserMedia(c); } catch (e: any) { err = e; if (e?.name === "NotAllowedError" || e?.name === "SecurityError" || e?.name === "NotReadableError") break; } }
  throw err;
}
async function attachStream(stream: MediaStream, tok: number): Promise<boolean> {
  if (tok !== S.tok || document.hidden) { stream.getTracks().forEach(t => t.stop()); if (tok === S.tok) camClose(); return false; }   // closed, or sent to the background, while the prompt was up
  S.stream = stream; const v = document.querySelector<HTMLVideoElement>("#cmp-pane video"); if (!v) { stop(); return false; }
  v.srcObject = stream; v.muted = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
  const f = sizeOf(stream).facingMode; if (f === "user" || f === "environment") S.facing = f;
  document.getElementById("cmp-pane")!.classList.toggle("front", S.facing === "user");
  v.play().catch(() => {});   // not awaited: it settles only once frames arrive, and the panel must not wait on that
  try { S.cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput").length; } catch { S.cams = 0; }
  if (tok !== S.tok) return false;
  document.getElementById("cmp-pane")?.classList.add("live"); moreFill(); return true;
}
export async function camOpen(key: string) {
  if (!D) return; camMenuClose(); camClose();
  S.key = key; S.facing = "environment"; S.cams = 0; S.busy = false;
  if (!navigator.mediaDevices?.getUserMedia) { native(key); return; }
  const tok = ++S.tok;
  const p = document.createElement("div"); p.id = "cmp-pane"; p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); p.setAttribute("aria-label", "Camera");
  p.innerHTML = `<div class="cmp-scrim" data-cmp-x></div><div class="cmp-panel"><video playsinline muted autoplay disablepictureinpicture></video><i class="cmp-flash"></i>
    <button type="button" class="cmp-b cmp-back" data-cmp-x aria-label="Back">${svg(P.back, 24)}</button>
    <button type="button" class="cmp-shutter" data-cmp-shot aria-label="Take photo"><i></i></button>
    <button type="button" class="cmp-b cmp-more" data-cmp-more aria-label="More" aria-haspopup="menu" aria-expanded="false">${svg(P.more, 24)}</button>
    <div class="cmp-mm" role="menu" aria-label="Camera options" hidden></div></div>`;
  document.body.appendChild(p); document.documentElement.classList.add("cmp-open");
  requestAnimationFrame(() => p.classList.add("on")); p.querySelector<HTMLElement>(".cmp-shutter")?.focus({ preventScroll: true });
  try { const st = await open("environment"); await attachStream(st, tok); }
  catch { if (tok !== S.tok) return; camClose(); native(key); }
}
function moreFill() {
  const m = document.querySelector<HTMLElement>("#cmp-pane .cmp-mm"); if (!m || PEND) return;
  const it = (id: string, label: string, p: string) => `<button type="button" class="cmp-item" role="menuitem" data-cmp-do="${id}">${svg(p, 22)}<span>${label}</span></button>`;
  m.innerHTML = `${S.cams > 1 ? it("flip", "Flip camera", P.flip) : ""}${finLabel("cmp-item", "choose", "Choose from photos", P.photos, "image/*,video/*", true)}`;
}
function moreSet(on: boolean) {
  const m = document.querySelector<HTMLElement>("#cmp-pane .cmp-mm"), b = document.querySelector<HTMLElement>("#cmp-pane .cmp-more"); if (!m || !b) return;
  S.more = on; m.hidden = !on; b.setAttribute("aria-expanded", String(on)); if (on) { moreFill(); m.querySelector<HTMLElement>(".cmp-item")?.focus({ preventScroll: true }); }
}
async function flip() {
  const tok = ++S.tok, v = document.querySelector<HTMLVideoElement>("#cmp-pane video"), old = S.stream, oldId = old ? sizeOf(old).deviceId : undefined, want = S.facing === "user" ? "environment" : "user";
  stop(); document.getElementById("cmp-pane")?.classList.remove("live"); if (v) v.srcObject = null;
  try {
    let st = await open(want);
    if (oldId && sizeOf(st).deviceId === oldId) {   // the browser ignored facingMode: take the next camera in the list
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"), i = cams.findIndex(d => d.deviceId === oldId), next = cams[(i + 1) % cams.length];
      if (next && next.deviceId !== oldId) { st.getTracks().forEach(t => t.stop()); st = await open(want, next.deviceId); S.facing = want; }
    } else S.facing = want;
    await attachStream(st, tok);
  } catch { if (tok !== S.tok) return; camClose(); native(S.key); }
}
async function shoot() {
  const v = document.querySelector<HTMLVideoElement>("#cmp-pane video"), p = document.getElementById("cmp-pane"); if (!v || !p || S.busy || !S.stream || !v.videoWidth) return;
  S.busy = true; const key = S.key;
  try {
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise(z => c.toBlob(z, "image/jpeg", 0.92)); if (!blob) throw new Error("no image");
    p.classList.add("shot");
    const d = new Date(), z2 = (n: number) => String(n).padStart(2, "0");
    const file = new File([blob], `Photo ${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())} ${z2(d.getHours())}.${z2(d.getMinutes())}.${z2(d.getSeconds())}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    camClose(); D!.attach(key, [file]);
  } catch { S.busy = false; }
}
function onClick(e: MouseEvent) {
  if (!D) return; const t = e.target as HTMLElement; if (!t.closest) return;
  const act = t.closest<HTMLElement>("[data-cmp-do]")?.dataset.cmpDo;
  if (t.closest("#cmp-menu") || t.closest("#cmp-pane")) e.stopPropagation();
  if (t.matches("input[type=file]")) return;   // the synthetic click a label sends to its own input: let the picker open
  if (act === "photos" || act === "files" || act === "choose") { const i = t.closest("label")?.querySelector<HTMLInputElement>(FIN); if (i) { pendStart(i); return; } }   // the tap itself opens the picker; the menu or panel stays until it returns
  if (t.closest("[data-cmp-scrim]")) { e.preventDefault(); camMenuClose(); return; }
  if (t.closest("#cmp-menu") && act) {
    e.preventDefault(); const key = M.key, btn = M.btn; camMenuClose();
    if (act === "camera") void camOpen(key);
    else if (act === "library" && btn) D.library(key, btn);
    return;
  }
  if (!t.closest("#cmp-pane")) { if (t.closest("[data-cmp-native]")) { e.preventDefault(); D.pick(S.key, "image/*", false, "environment"); } return; }
  if (t.closest("[data-cmp-x]")) { e.preventDefault(); camClose(); return; }
  if (t.closest("[data-cmp-shot]")) { e.preventDefault(); void shoot(); return; }
  if (t.closest("[data-cmp-more]")) { e.preventDefault(); moreSet(!S.more); return; }
  if (act === "flip") { e.preventDefault(); moreSet(false); void flip(); return; }
  if (S.more) moreSet(false);
}
