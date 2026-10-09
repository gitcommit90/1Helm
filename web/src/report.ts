// Help & support → Report an issue (Captain 10-06): a short form in our own sheet. What happened, an optional screenshot
// (pick a picture, or "Capture this screen" where the browser can capture its own tab), and the page it was on. The app adds
// its version (APP_V), the device and window size, and its last log lines (kept here from the moment the app loads).
// Sent to 1HC POST <api>/report (src/reports.js): D1 + R2. Then: "Thanks, we got it."
// Contact us: an email to the configured support address with the workspace address in the body (rpMailto).
// v3.ts hooks in: rpInit() once; any element with data-rpopen opens the form.

type Deps = { live: { api: string; slug: string; email?: string } | null; before?: () => void; note: (title: string, sub: string) => void };
let D: Deps | null = null;
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ---------- the last log lines (errors and warnings), from app start ----------
const LOG: string[] = [], MAX = 30;
const t = () => new Date().toISOString().slice(11, 19);
const str = (x: unknown) => { try { return x instanceof Error ? `${x.name}: ${x.message}${x.stack ? ` @ ${String(x.stack).split("\n")[1]?.trim() || ""}` : ""}` : typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); } };
function log(kind: string, args: unknown[]) { LOG.push(`${t()} ${kind} ${args.map(str).join(" ").slice(0, 400)}`); if (LOG.length > MAX) LOG.splice(0, LOG.length - MAX); }
for (const k of ["error", "warn"] as const) { const orig = console[k].bind(console); console[k] = (...a: unknown[]) => { try { log(k, a); } catch {} orig(...a); }; }
addEventListener("error", (e) => log("uncaught", [e.error || e.message, e.filename ? `${e.filename.split("/").pop()}:${e.lineno}` : ""]));
addEventListener("unhandledrejection", (e) => log("rejection", [(e as PromiseRejectionEvent).reason]));
export const rpLogs = () => LOG.slice();

// ---------- facts sent with every report ----------
const clientV = () => { const s = [...document.scripts].find(x => /\/app\.js\?v=/.test(x.src))?.src || ""; return s.match(/[?&]v=([^&]+)/)?.[1] || ""; };
const viewport = () => `${innerWidth}×${innerHeight} @${devicePixelRatio || 1}x${matchMedia("(pointer: coarse)").matches ? " · touch" : ""}${matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone ? " · installed app" : ""}`;
const route = () => location.hash || "#/";

export function rpMailto(slug: string, support = "support@example.com") {
  const body = `\n\n\n—\nMy 1Helm: ${slug ? `${location.host}/w/${slug}` : "(design sandbox)"}\nPage: ${route()}`;
  return `mailto:${encodeURIComponent(support)}?subject=${encodeURIComponent("1Helm help")}&body=${encodeURIComponent(body)}`;
}

// ---------- the sheet ----------
const R: { el: HTMLElement | null; shot: { type: string; data: string; url: string; name: string } | null; busy: "" | "send" | "cap" | "pic"; done: boolean; err: string; prev: HTMLElement | null } =
  { el: null, shot: null, busy: "", done: false, err: "", prev: null };
const canCapture = () => !!(navigator.mediaDevices as any)?.getDisplayMedia && !matchMedia("(pointer: coarse)").matches;
const camI = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>`;
const picI = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>`;
const okI = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

function body(): string {
  if (R.done) return `<div class="rpdone"><span class="rpok">${okI}</span><h2 id="rpt">Thanks, we got it.</h2>
    <p>We read every report.${D?.live?.email ? ` If we need more, we'll email you at ${esc(D.live.email)}.` : ""}</p>
    <div class="rpbtns"><button type="button" class="dlgb ok" data-rpx>Done</button></div></div>`;
  const s = R.shot, busy = R.busy;
  return `<h2 id="rpt">Report an issue</h2>
    <label class="rplab" for="rptx">What happened?</label>
    <textarea id="rptx" class="rptx" rows="4" maxlength="4000" placeholder="What did you do, what did you expect, and what happened instead?"${busy === "send" ? " disabled" : ""}></textarea>
    <div class="rplab">Screenshot <span>(optional)</span></div>
    ${s ? `<div class="rpshot"><img src="${s.url}" alt="Screenshot to send"><span class="rpsn">${esc(s.name)}</span><button type="button" class="sa mute" data-rprm${busy ? " disabled" : ""}>Remove</button></div>`
      : `<div class="rppick"><label class="sa rpbtn${busy ? " off" : ""}">${picI}<span>${busy === "pic" ? "Adding…" : "Add a screenshot"}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/*" data-rpfile${busy ? " disabled" : ""}></label>
        ${canCapture() ? `<button type="button" class="sa rpbtn" data-rpcap${busy ? " disabled" : ""}>${camI}<span>${busy === "cap" ? "Capturing…" : "Capture this screen"}</span></button>` : ""}</div>`}
    <p class="rpfine">We also send the page you were on (<code>${esc(route())}</code>), the app version, your device and window size, and the app's last error messages. Nothing else.</p>
    ${R.err ? `<p class="rperr" role="alert">${esc(R.err)}</p>` : ""}
    <div class="rpbtns"><button type="button" class="dlgb no" data-rpx${busy === "send" ? " disabled" : ""}>Cancel</button><button type="button" class="dlgb ok" data-rpsend${busy ? " disabled" : ""}>${busy === "send" ? "Sending…" : "Send report"}</button></div>`;
}
function paint(focus = false) {
  if (!R.el) return;
  const box = R.el.querySelector(".rpbox")!, ta = box.querySelector<HTMLTextAreaElement>("#rptx"), keep = ta?.value ?? "";
  box.innerHTML = body();
  const nta = box.querySelector<HTMLTextAreaElement>("#rptx"); if (nta) nta.value = keep;
  if (focus) (nta || box.querySelector<HTMLElement>("[data-rpx]"))?.focus({ preventScroll: true });
}
export function rpOpen() {
  D?.before?.();
  if (R.el) return;
  R.shot = null; R.busy = ""; R.done = false; R.err = "";
  R.prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement("div"); el.className = "dlgw rpw";
  el.innerHTML = `<div class="dlgback" data-rpx></div><div class="dlg rpbox" role="dialog" aria-modal="true" aria-labelledby="rpt" tabindex="-1"></div>`;
  R.el = el; document.body.appendChild(el); paint();
  void el.offsetWidth; el.classList.add("on");
  setTimeout(() => R.el?.querySelector<HTMLElement>("#rptx")?.focus({ preventScroll: true }), 30);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.closest("[data-rpx]")) { if (R.busy !== "send") close(); return; }
    if (t.closest("[data-rprm]")) { if (R.shot) URL.revokeObjectURL(R.shot.url); R.shot = null; paint(); return; }
    if (t.closest("[data-rpcap]")) { capture(); return; }
    if (t.closest("[data-rpsend]")) { send(); return; }
  });
  el.addEventListener("change", (e) => { const i = (e.target as HTMLElement).closest<HTMLInputElement>("[data-rpfile]"); if (i?.files?.[0]) pick(i.files[0]); });
}
function close() {
  const el = R.el; if (!el) return; R.el = null;
  if (R.shot) URL.revokeObjectURL(R.shot.url); R.shot = null;
  el.classList.remove("on"); el.classList.add("off"); setTimeout(() => el.remove(), 300);
  if (R.prev?.isConnected) R.prev.focus({ preventScroll: true });
}
export const rpIsOpen = () => !!R.el;

// A picture → at most ~2400 px on its long side, JPEG when it's big (keeps uploads small); small PNGs go as they are.
async function shrink(blob: Blob): Promise<{ type: string; blob: Blob }> {
  if (blob.size < 1.5e6 && /^image\/(png|jpeg|webp)$/.test(blob.type)) return { type: blob.type, blob };
  const bmp = await createImageBitmap(blob), k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const out = await new Promise<Blob | null>(z => c.toBlob(z, "image/jpeg", 0.85)); if (!out) throw new Error("Couldn't read that picture.");
  return { type: "image/jpeg", blob: out };
}
const b64 = (b: Blob) => new Promise<string>((z, no) => { const r = new FileReader(); r.onload = () => z(String(r.result).replace(/^data:[^,]*,/, "")); r.onerror = () => no(r.error); r.readAsDataURL(b); });
async function setShot(blob: Blob, name: string) {
  const s = await shrink(blob);
  if (s.blob.size > 6e6) throw new Error("That picture is too big. Try a smaller one.");
  if (R.shot) URL.revokeObjectURL(R.shot.url);
  R.shot = { type: s.type, data: await b64(s.blob), url: URL.createObjectURL(s.blob), name };
}
async function pick(f: File) {
  if (!/^image\//.test(f.type)) { R.err = "Pick a picture (PNG, JPEG or WebP)."; paint(); return; }
  R.busy = "pic"; R.err = ""; paint();
  try { await setShot(f, f.name || "screenshot"); } catch (e: any) { R.err = e?.message || "Couldn't read that picture."; }
  R.busy = ""; paint();
}
// This tab, as it looks without our sheet and Settings on top: the browser asks which tab (this one is offered first).
async function capture() {
  R.busy = "cap"; R.err = ""; paint();
  let stream: MediaStream | null = null;
  try {
    stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude" });
    document.documentElement.classList.add("rpcapturing");
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play();
    await new Promise(z => setTimeout(z, 450));   // our sheet and Settings fade out first
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>(z => c.toBlob(z, "image/png"));
    if (!blob) throw new Error("The capture came back empty.");
    await setShot(blob, "This screen");
  } catch (e: any) { if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") R.err = `Couldn't capture the screen. ${e?.message || ""} You can add a screenshot instead.`.trim(); }
  finally { stream?.getTracks().forEach(t => t.stop()); document.documentElement.classList.remove("rpcapturing"); }
  R.busy = ""; paint();
}
async function send() {
  if (R.busy || R.done || !R.el) return;
  const text = (R.el.querySelector<HTMLTextAreaElement>("#rptx")?.value || "").trim();
  if (!text) { R.err = "Tell us what happened first."; paint(); R.el.querySelector<HTMLElement>("#rptx")?.focus(); return; }
  R.busy = "send"; R.err = ""; paint();
  const payload = { text, route: route(), viewport: viewport(), ua: navigator.userAgent, logs: rpLogs(), client_v: clientV(), ...(R.shot ? { shot: { type: R.shot.type, data: R.shot.data } } : {}) };
  let r: any;
  try {
    if (!D?.live) { await new Promise(z => setTimeout(z, 500)); r = { ok: true }; }
    else { const res = await fetch(`${D.live.api}/report`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); r = await res.json().catch(() => ({ error: `HTTP ${res.status}` })); }
  } catch { r = { error: "Check your connection and try again." }; }
  R.busy = "";
  if (!r?.ok) { R.err = r?.error || "Couldn't send that. Try again in a minute."; paint(); return; }
  R.done = true; paint(true);
}

// Keys while the sheet is open: Esc closes it (and nothing under it), ⌘/Ctrl+Enter sends, Tab stays inside. No app shortcut sees
// them (registered at import, before the app's own window listeners; v3.ts imports this module right after dialog.ts).
addEventListener("keydown", (e) => {
  const el = R.el; if (!el) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); if (R.busy !== "send") close(); }
  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  else if (e.key === "Tab") { const f = [...el.querySelectorAll<HTMLElement>("textarea:not(:disabled),button:not(:disabled),input:not(:disabled)")]; if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); } }
}, true);

export function rpInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest?.("[data-rpopen]"); if (!t) return;
    e.preventDefault(); e.stopPropagation(); rpOpen();
  }, true);
}
