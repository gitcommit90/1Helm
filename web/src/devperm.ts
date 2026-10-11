// Location + microphone, asked ONCE up front so a task never stops for them (Captain 10-07: "coffee recs" shouldn't end in
// "where ya at?"). Browsers never grant either silently: their own prompt has to appear once, so we ask at a calm moment.
// - The sheet "Let 1Helm use your location and microphone": once per device after sign-in (onboarding asks the same thing as a
//   step; same origin, same flag). Skipped silently when the browser already allows both (Permissions API), or blocks both.
//   Allow calls getUserMedia({audio}) (tracks stopped at once) and getCurrentPosition right inside the tap, so the installed app
//   and iOS Safari see a real user gesture. Not now just closes it; Settings → Location & mic has the same controls.
//   It appears only at a calm moment and only a deliberate Allow or Not now dismisses it for good (see dpSheetMaybe, openSheet).
// - Location while it's allowed: a coarse fix (lat/lng rounded to 2 decimals, about 1 km) when the app opens, when it comes back
//   into focus with a fix older than 15 minutes, and with each message (dpLoc() → /stream { loc }). POST /api/location names the
//   place (1HC location.js). Never asks the browser on its own: only when the permission is already "granted".
// - "Share my location" on a card (Button action share_location): dpShareNow(), inside the tap.
// - Settings → Location & mic: each permission's state; location sharing on/off (off forgets the saved one), Update now,
//   Forget my location; Turn on (the browser asks) or how to allow it when the browser blocked it.
// v3.ts hooks in: dpInit() once, dpSheetMaybe() after boot, dpSec() as the "device" section, dpLoc() in the stream body,
// dpShareNow() for the card button.
type PS = "granted" | "denied" | "prompt" | "unknown";
type Fix = { lat: number; lng: number; at: number; place?: string };
type Deps = {
  api: string | null;                                           // the workspace API base (live), null in the sandbox
  note: (title: string, sub: string, bad?: boolean) => void;   // the app's own toast (no native dialogs)
  repaint: () => void;                                          // Settings, if it's open on this section
  shown: () => boolean;                                         // Settings is open on this section
  helper: () => string;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  sa: (label: string, attr: string, cls?: string) => string;
  look?: boolean;                                               // a dev "view as": never asks, never sends
  nf?: { perm: () => "granted" | "denied" | "prompt" | "unsupported"; ask: () => Promise<boolean>; elsewhere: () => boolean };   // notif.ts
};
let D: Deps | null = null;
const FRESH_MS = 15 * 60e3;
const K = { asked: "1hc.dp.asked", fix: "1hc.loc", off: "1hc.loc.off" };
// The installed app (home screen, Dock, Chrome/Edge app window) is its own context: on iPhone and in Mac Safari it has its own
// permissions and storage, and even where storage is shared the grants may not be. So "asked" is kept per display mode, and next
// to it what was allowed when the person chose (K.asked + ".on"): if one of those is back to "not asked yet" here, the grant didn't
// carry over and the sheet asks again. Onboarding writes the same mode-scoped flag and successful-grant list.
const isApp = () => { try { return (navigator as any).standalone === true || ["standalone", "window-controls-overlay", "fullscreen"].some((m) => matchMedia(`(display-mode: ${m})`).matches); } catch { return false; } };
const askedKey = () => (isApp() ? `${K.asked}.app` : K.asked);
type Item = "loc" | "mic" | "nf";
const nfSt = (): PS | "unsupported" => { const p = D?.nf?.perm() ?? "unsupported"; return p; };
// An unsupported permission query is not a revocation. Remember successful access
// for display, but never use that historical grant to silently activate hardware.
const rememberedGrants = (): Item[] => { try { const raw = ls.get(`${askedKey()}.grants`); const v = raw === null ? askedOn() : JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const allowed = (k: "loc" | "mic") => P[k] === "granted" || (P[k] === "unknown" && rememberedGrants().includes(k));
const grantedNow = (): Item[] => [...(allowed("loc") ? ["loc" as Item] : []), ...(allowed("mic") ? ["mic" as Item] : []), ...(nfSt() === "granted" ? ["nf" as Item] : [])];
const rememberGrants = () => ls.set(`${askedKey()}.grants`, JSON.stringify(grantedNow()));
const markAsked = () => { ls.set(askedKey(), "1"); ls.set(`${askedKey()}.on`, JSON.stringify(grantedNow())); };
const askedOn = (): Item[] => { try { const v = JSON.parse(ls.get(`${askedKey()}.on`) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode: fine, just not remembered */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* same */ } },
};
const P: { loc: PS; mic: PS; busy: "" | "both" | "loc" | "mic" | "forget"; saved: { place: string; at: number } | null; savedLoaded: boolean; inflight: Promise<Fix | null> | null } =
  { loc: "unknown", mic: "unknown", busy: "", saved: null, savedLoaded: false, inflight: null };
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const I = (p: string, s = 17) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const DP_ICON = {
  loc: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
};
const ic = { loc: I(DP_ICON.loc, 20), mic: I(DP_ICON.mic, 20), bell: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 20), sloc: I(DP_ICON.loc), smic: I(DP_ICON.mic), check: I('<path d="M20 6 9 17l-5-5"/>', 15) };
const coarse = (x: number) => Math.round(x * 100) / 100;
const off = () => ls.get(K.off) === "1";
const cached = (): Fix | null => { try { const f = JSON.parse(ls.get(K.fix) || "null"); return f && Number.isFinite(f.lat) && Number.isFinite(f.lng) && Number(f.at) > 0 ? f : null; } catch { return null; } };
const hasGeo = () => typeof navigator !== "undefined" && !!navigator.geolocation;
const hasMic = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

// ---------- permission states (Permissions API; "unknown" where a browser can't say, e.g. Firefox's microphone) ----------
async function query(name: string): Promise<PS> {
  try { const s = await navigator.permissions.query({ name } as any); s.onchange = () => { (name === "geolocation" ? (P.loc = s.state as PS) : (P.mic = s.state as PS)); rememberGrants(); changed(); }; return s.state as PS; }
  catch { return "unknown"; }
}
export async function dpStates() {
  const [l, m] = await Promise.all([hasGeo() ? query("geolocation") : Promise.resolve("denied" as PS), hasMic() ? query("microphone") : Promise.resolve("denied" as PS)]);
  P.loc = l; P.mic = m; rememberGrants(); return { loc: l, mic: m };
}
function changed() { if (P.loc === "granted" && !off()) void refresh(); if (D?.shown()) D.repaint(); }

// ---------- location ----------
// Ask the device for a fix. Call it straight from a tap when it may prompt; otherwise only while the permission is granted.
function getFix(): Promise<Fix | null> {
  if (!hasGeo()) return Promise.resolve(null);
  if (P.inflight) return P.inflight;
  P.inflight = new Promise<Fix | null>((done) => {
    navigator.geolocation.getCurrentPosition(
      (p) => { P.loc = "granted"; rememberGrants(); done({ lat: coarse(p.coords.latitude), lng: coarse(p.coords.longitude), at: Date.now() }); },
      (e) => { if (e?.code === 1) { P.loc = "denied"; rememberGrants(); } done(null); },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60e3 });
  }).then(async (f) => { P.inflight = null; if (f) await keep(f); return f; });
  return P.inflight;
}
async function keep(f: Fix) {
  const old = cached(); if (old && old.lat === f.lat && old.lng === f.lng && old.place) f.place = old.place;
  ls.set(K.fix, JSON.stringify(f));
  if (!D?.api || D.look) return;
  try {
    const r = await fetch(`${D.api}/location`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: f.lat, lng: f.lng, at: f.at }) });
    const d = await r.json().catch(() => ({}));
    if (d?.location) { f.place = d.location.place || f.place || ""; P.saved = { place: f.place || "", at: d.location.at }; ls.set(K.fix, JSON.stringify(f)); }
  } catch { /* offline: the next message carries it */ }
  if (D?.shown()) D.repaint();
}
// A fresh fix when it's stale, only if the browser already allows it (never a prompt in the middle of something).
async function refresh(force = false) {
  if (D?.look || off() || P.loc !== "granted") return null;
  const f = cached(); if (!force && f && Date.now() - f.at < FRESH_MS) return f;
  return getFix();
}
// What rides with a message: the cached fix (refreshing it in the background when stale). Null when location is off or unknown.
export function dpLoc(): { lat: number; lng: number; at: number } | null {
  if (D?.look || off() || P.loc === "denied") return null;
  const f = cached(); if (!f) { void refresh(); return null; }
  if (Date.now() - f.at >= FRESH_MS) void refresh();
  return P.loc === "granted" || P.loc === "unknown" ? { lat: f.lat, lng: f.lng, at: f.at } : null;
}
// The card's "Share my location" (inside the tap). True once a fix is saved; false (with a toast saying why) otherwise.
export async function dpShareNow(): Promise<boolean> {
  if (!hasGeo()) { D?.note("Location isn't available here", "This browser can't share a location. Type the area instead.", true); return false; }
  const f = await getFix();
  if (f) return true;
  D?.note(P.loc === "denied" ? "Location is blocked for 1Helm" : "Couldn't get your location", P.loc === "denied" ? HOW.loc : "Try again in a moment, or type the area instead.", true);
  return false;
}

// ---------- the sheet ----------
let sheet: HTMLElement | null = null, prev: HTMLElement | null = null;
let items: Item[] = ["loc", "mic"];   // what the open sheet asks for
const NAME: Record<Item, string> = { loc: "location", mic: "microphone", nf: "notifications" };
const list = (xs: Item[]) => { const n = xs.map((x) => NAME[x]); return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`; };
const sheetBody = () => {
  const h = esc(D?.helper() || "Your helper"), app = isApp();
  const row = (k: Item) => k === "loc" ? `<div class="dprow"><span class="dpic">${ic.loc}</span><span class="dptx"><b>Location</b><span>What's near you, like coffee nearby or today's weather. Only a rough area (about 1 km) is shared.</span></span></div>`
    : k === "mic" ? `<div class="dprow"><span class="dpic">${ic.mic}</span><span class="dptx"><b>Microphone</b><span>Talk instead of typing, any time, without a pop-up.</span></span></div>`
    : `<div class="dprow"><span class="dpic">${ic.bell}</span><span class="dptx"><b>Notifications</b><span>A heads-up when a task needs you or is finished, even with the app closed.</span></span></div>`;
  const elsewhere = app && (!!P.saved || !!D?.nf?.elsewhere());
  return `<div class="dlggrab" aria-hidden="true"></div>
  <h2 id="dpt">${app ? "Turn these on for the 1Helm app" : "Let 1Helm use your location and microphone"}</h2>
  <p>${elsewhere ? "You allowed these in your browser; the installed app needs its own OK. " : ""}So ${h} never has to stop and ask in the middle of a task.</p>
  <div class="dprows">${items.map(row).join("")}</div>
  <p class="dpfine">${app ? `The app asks once for each. Change it anytime in Settings → Location & mic${items.includes("nf") ? " and Notifications" : ""}.` : "Your browser asks once for each. Change it anytime in Settings → Location & mic."}</p>
  <div class="dlgbtns"><button class="dlgb no" data-dpno>Not now</button><button class="dlgb ok" data-dpyes${P.busy ? " disabled" : ""}>${P.busy ? (app ? "Waiting for your OK…" : "Waiting for your browser…") : `Allow ${list(items)}`}</button></div>`;
};
// Only a deliberate choice closes it and counts as "asked": Allow or Not now (Esc closes it too, but it'll ask again next visit).
// A tap on the backdrop just nudges the card. For TAP_GUARD ms after it appears every tap and key on it is ignored, and a
// button only counts when the finger/mouse went down on it after that, so a tap already under way can't land on Allow or Not now.
const TAP_GUARD = 400;
let armAt = 0, downOk = false;
function openSheet() {
  if (sheet) return;
  prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  prev?.blur();                                                    // the phone keyboard goes away; nothing typed lands under the sheet
  const el = document.createElement("div"); el.className = "dlgw dpw";
  el.innerHTML = `<div class="dlgback" data-dpback></div><div class="dlg dpbox" role="dialog" aria-modal="true" aria-labelledby="dpt" tabindex="-1">${sheetBody()}</div>`;
  sheet = el; armAt = performance.now() + TAP_GUARD; downOk = false;
  document.body.appendChild(el); void el.offsetWidth; el.classList.add("on");
  // Focus the card itself, not Allow: a stray Enter or Space can't pick for the person. Tab reaches the buttons.
  el.querySelector<HTMLElement>(".dpbox")?.focus({ preventScroll: true });
  el.addEventListener("pointerdown", (e) => { downOk = performance.now() >= armAt; if (!downOk) e.preventDefault(); }, true);
  el.addEventListener("click", (e) => {
    e.stopPropagation(); const t = e.target as HTMLElement;
    if (performance.now() < armAt || (e.detail > 0 && !downOk)) { e.preventDefault(); return; }   // too soon: a tap that was already on its way
    if (t.closest("[data-dpyes]")) { allowBoth("sheet"); return; }
    if (t.closest("[data-dpno]") && !P.busy) { markAsked(); closeSheet(); return; }
    if (!t.closest(".dpbox")) nudge();
  });
}
function nudge() {
  const b = sheet?.querySelector<HTMLElement>(".dpbox"); if (!b) return;
  b.classList.remove("dpnudge"); void b.offsetWidth; b.classList.add("dpnudge");
}
function closeSheet() {
  const el = sheet; if (!el) return; sheet = null;
  el.classList.remove("on"); el.classList.add("off"); setTimeout(() => el.remove(), 300);
  if (prev?.isConnected && !matchMedia("(pointer:coarse)").matches) prev.focus({ preventScroll: true });   // no keyboard popping up on a phone
}
const paintSheet = () => { const b = sheet?.querySelector(".dpbox"); if (b) b.innerHTML = sheetBody(); };
// Both at once, straight from the tap (the browser shows its own prompt for each, one after the other).
function allowBoth(from: "sheet" | "settings") {
  if (P.busy) return;
  P.busy = "both"; markAsked(); ls.del(K.off); paintSheet(); D?.repaint();
  // Notifications first (Safari only lets a tap ask for it), then the microphone and location, all from this same tap.
  const want = from === "sheet" ? items : (["loc", "mic"] as Item[]);
  const nf = want.includes("nf") && D?.nf ? D.nf.ask() : Promise.resolve(false);
  const mic = want.includes("mic") ? askMic() : Promise.resolve(P.mic === "granted"), loc = want.includes("loc") && hasGeo() ? getFix() : Promise.resolve(null);
  Promise.all([mic, loc, nf]).then(async ([m, l, n]) => {
    P.busy = ""; await dpStates(); D?.repaint();
    markAsked(); if (from === "sheet") closeSheet();
    if (isApp() && from === "sheet") {   // the installed app's sheet can cover any of the three: one plain sentence for what happened
      const ok = (k: Item) => k === "loc" ? !!l || P.loc === "granted" : k === "mic" ? m : n || nfSt() === "granted";
      const on = want.filter(ok), offs = want.filter((k) => !ok(k)), cap = (x: string) => x[0].toUpperCase() + x.slice(1);
      if (!offs.length) D?.note("All set for the 1Helm app", `${D.helper()} won't need to ask in the middle of a task.`);
      else if (!on.length) D?.note(`${cap(list(offs))} ${offs.length > 1 ? "are" : "is"} still off`, "The app didn't get an OK. Settings shows how to turn them on.", true);
      else D?.note(`${cap(list(on))} ${on.length > 1 ? "are" : "is"} on`, `${cap(list(offs))} ${offs.length > 1 ? "are" : "is"} still off. Settings can turn ${offs.length > 1 ? "them" : "it"} on.`, true);
      D?.repaint(); return;
    }
    const L = !!l || P.loc === "granted", M = m;
    if (L && M) D?.note("Location and microphone are on", `${D.helper()} won't need to ask in the middle of a task.`);
    else if (L) D?.note("Location is on, the microphone is off", P.mic === "denied" ? HOW.mic : "You can turn the microphone on in Settings → Location & mic.", true);
    else if (M) D?.note("The microphone is on, location is off", P.loc === "denied" ? HOW.loc : "You can turn location on in Settings → Location & mic.", true);
    else D?.note("Location and microphone are still off", "Your browser didn't allow them. Settings → Location & mic shows how to turn them on.", true);
    D?.repaint();
  });
}
function askMic(): Promise<boolean> {
  if (!hasMic()) return Promise.resolve(false);
  return navigator.mediaDevices.getUserMedia({ audio: true })
    .then((s) => { s.getTracks().forEach((t) => t.stop()); P.mic = "granted"; rememberGrants(); return true; })   // the mic light goes off at once
    .catch((e) => { if (e?.name === "NotAllowedError" || e?.name === "SecurityError") { P.mic = "denied"; rememberGrants(); } return false; });
}
// When it may appear: a calm moment, never mid-gesture (Captain 10-08: it popped up a second after a refresh while he was
// tapping something else, and that tap dismissed it on three devices). Calm = no pointer, touch, wheel or key input for CALM_MS,
// the page visible and focused, no menu, sheet, picker or dialog open, nothing being typed. It keeps waiting all session for that
// moment (a cheap check a few times a second); if it never comes, it asks on the next visit. Input is tracked from import time, so
// a person who refreshes and starts clicking right away is never interrupted.
const CALM_MS = 3000;
let lastInput = performance.now();
const bump = () => { lastInput = performance.now(); };
for (const ev of ["pointerdown", "pointermove", "touchstart", "touchmove", "wheel", "keydown"]) addEventListener(ev, bump, { capture: true, passive: true });
const OVERLAY = '[role=dialog],[role=menu],[role=listbox],[aria-modal=true],[aria-haspopup][aria-expanded=true],#smenuw,#pkw,#tdpw,#tkm,#tkfs,#lw,#sheet,#appw,#setw,.dlgw,.sopen';
const shown = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
function busyScreen(blocked: () => boolean) {
  if (blocked() || document.visibilityState !== "visible" || !document.hasFocus()) return true;
  if ([...document.querySelectorAll(OVERLAY)].some(shown)) return true;
  const a = document.activeElement as HTMLElement | null;   // typing: a draft in the composer, or any other field focused
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) {
    if (a.id !== "box" || ((a as HTMLTextAreaElement).value || "").trim()) return true;   // the home page focuses an empty composer by itself
  }
  return false;
}
export const dpCalm = (blocked: () => boolean = () => false) => performance.now() - lastInput >= CALM_MS && !busyScreen(blocked);
// After boot: once per device, until the person picks Allow or Not now (closing it any other way doesn't count). Skipped silently
// when there's nothing to ask (both allowed, or both blocked by the browser).
let waiting = false;
export async function dpSheetMaybe(blocked: () => boolean = () => false) {
  if (!D || D.look || waiting || sheet || (!hasGeo() && !hasMic() && !isApp())) return;
  waiting = true;
  try {
    const want = await toAsk(); if (!want) return;
    while (!dpCalm(blocked)) await new Promise((r) => setTimeout(r, 250));
    const now = await toAsk(); if (!now || sheet) return;   // it may have been answered meanwhile (another tab, Settings)
    items = now; openSheet();
  } finally { waiting = false; }
}
// What the sheet should ask for in this context right now, from the real permission states (null: nothing, don't show it).
// In the browser it's location + microphone, as always. In the installed app it's whichever of location, microphone and
// notifications isn't allowed yet and can still be asked (one the person blocked can only be changed in Settings).
async function toAsk(): Promise<Item[] | null> {
  const st = await dpStates(), nf = nfSt(), app = isApp();
  if (app) loadSaved();   // a location saved from another device: the sheet can say the app needs its own OK
  const can = (k: Item) => k === "loc" ? hasGeo() && !allowed("loc") && (st.loc === "prompt" || st.loc === "unknown")
    : k === "mic" ? hasMic() && !allowed("mic") && (st.mic === "prompt" || st.mic === "unknown") : app && nf === "prompt";
  const open: Item[] = (["loc", "mic", "nf"] as Item[]).filter(can);
  const asked = ls.get(askedKey()) === "1";
  if (!open.length) { if (!asked) markAsked(); return null; }   // nothing left to ask here: remember what's allowed
  if (asked) {
    // Asked before in this display mode: only again when something that was allowed then is "not asked yet" now (it didn't
    // carry over, e.g. shared storage but separate grants). "unknown" (a browser that can't say) never counts as lost.
    const lost = askedOn().filter((k) => (k === "loc" ? st.loc : k === "mic" ? st.mic : nf) === "prompt");
    if (!lost.length) { ls.set(`${askedKey()}.on`, JSON.stringify(grantedNow())); return null; }
  }
  return app ? open : (["loc", "mic"] as Item[]).filter((k) => k === "loc" ? hasGeo() : hasMic());
}
export const dpSheetOpen = () => !!sheet;

// ---------- Settings → Location & mic ----------
const HOW = {
  loc: "Your browser is blocking location for 1Helm. Open this site's settings (the icon next to the address, or Settings → Safari → Location on an iPhone), set Location to Allow, then come back.",
  mic: "Your browser is blocking the microphone for 1Helm. Open this site's settings (the icon next to the address, or Settings → Safari → Microphone on an iPhone), set Microphone to Allow, then come back.",
};
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const sw = (on: boolean, label: string, attr: string) => `<button class="tg${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attr}><i></i></button>`;
const okPill = (t: string) => `<span class="sok">${ic.check}${esc(t)}</span>`;
function loadSaved() {
  if (P.savedLoaded || !D?.api) return; P.savedLoaded = true;
  fetch(`${D.api}/location`, { credentials: "same-origin" }).then((r) => r.json()).then((d) => { P.saved = d?.location || null; if (D?.shown()) D.repaint(); }).catch(() => {});
}
export function dpSec(): string {
  if (!D) return "";
  loadSaved();
  // Re-read the browser's answers when the section opens (at most every 5 s; one repaint only if something changed).
  if (!P.busy && !dpSec.asking && Date.now() - dpSec.at > 5000) { dpSec.asking = true; dpSec.at = Date.now(); const was = `${P.loc}${P.mic}`;
    void dpStates().then(() => { dpSec.asking = false; if (`${P.loc}${P.mic}` !== was && D?.shown()) D.repaint(); }); }
  const h = esc(D.helper()), { srow, sa } = D, sharing = allowed("loc") && !off(), f = cached();
  const where = P.saved?.place || f?.place || "", when = P.saved?.at || f?.at || 0;
  const locSub = P.busy === "both" || P.busy === "loc" ? "Waiting for your browser…"
    : allowed("loc") ? (off() ? `Allowed on this device, but not shared with ${h}` : P.loc === "unknown" ? "Allowed on this device" : `On. ${h} knows roughly where you are`)
    : P.loc === "denied" ? "Blocked in this browser" : !hasGeo() ? "Not available in this browser" : "Off. Turn it on so you're never asked mid-task";
  const locRight = allowed("loc") ? sw(sharing, `Share my location with ${D.helper()}`, "data-dp=\"locsw\"")
    : P.loc === "denied" ? sa("How to allow", 'data-dp="lochow"') : hasGeo() ? sa("Turn on", 'data-dp="loc"', "blue") : "";
  const micSub = P.busy === "both" || P.busy === "mic" ? "Waiting for your browser…"
    : allowed("mic") ? (P.mic === "unknown" ? "Allowed on this device" : "On. Talk instead of typing works right away") : P.mic === "denied" ? "Blocked in this browser" : !hasMic() ? "Not available in this browser" : "Off. Your browser asks the first time you tap the mic";
  const micRight = allowed("mic") ? okPill("On") : P.mic === "denied" ? sa("How to allow", 'data-dp="michow"') : hasMic() ? sa("Turn on", 'data-dp="mic"', "blue") : "";
  const both = !allowed("loc") && !allowed("mic") && (P.loc === "prompt" || P.loc === "unknown") && (P.mic === "prompt" || P.mic === "unknown") && hasGeo() && hasMic() && !P.busy;
  return `<h2>Location & mic</h2><p class="slead">So ${h} knows what's near you and hears you when you talk, without stopping to ask in the middle of a task. Each browser and device keeps its own permission.</p>
    ${both ? `<div class="sadd dpboth">${sa("Allow location and microphone", 'data-dp="both"', "blue")}</div>` : ""}
    <h3>Location</h3>
    <div class="sc">${srow(ic.sloc, "Location", esc(locSub), locRight, ' data-dprow="loc"')}
      ${sharing && (where || when) ? srow("", where ? `Near ${esc(where)}` : "Location saved", `${when ? `Updated ${ago(when)} · ` : ""}a rough area, about 1 km`, sa("Update now", 'data-dp="locnow"')) : ""}
      ${P.saved || f ? srow("", "Forget my location", `Deletes the location 1Helm keeps for your account. ${h} goes by your home in the Notebook, then your time zone.`, sa(P.busy === "forget" ? "Forgetting…" : "Forget", 'data-dp="forget"', "mute")) : ""}</div>
    <h3>Microphone</h3>
    <div class="sc">${srow(ic.smic, "Microphone", esc(micSub), micRight, ' data-dprow="mic"')}</div>
    <p class="sfine">Only a rough area is shared, never your exact address, and 1Helm keeps just the latest one. The microphone is used only while you're talking to ${h}. To block either completely, change it in your browser's site settings.</p>`;
}
dpSec.asking = false; dpSec.at = 0;
async function forget() {
  P.busy = "forget"; D?.repaint();
  ls.del(K.fix);
  try { if (D?.api) await fetch(`${D.api}/location/forget`, { method: "POST", credentials: "same-origin" }); P.saved = null; D?.note("Location forgotten", `${D.helper()} goes by your home in the Notebook, then your time zone.`); }
  catch { D?.note("Couldn't forget it just now", "Check your connection and try again.", true); }
  P.busy = ""; D?.repaint();
}
// Esc closes the sheet without counting as a choice; Tab stays inside. Registered at import, before the app's own keys (v3.ts imports this early).
addEventListener("keydown", (e) => {
  if (!sheet) return; e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); if (!P.busy && performance.now() >= armAt) closeSheet(); }   // closes, asks again next visit
  else if ((e.key === "Enter" || e.key === " ") && performance.now() < armAt) e.preventDefault();   // a key already on its way
  else if (e.key === "Tab") { const f = [...sheet.querySelectorAll<HTMLElement>("button:not(:disabled)")]; if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); } }
}, true);
export function dpInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-dp]"); if (!t || P.busy) return;
    e.preventDefault(); const k = t.dataset.dp;
    if (k === "both") { allowBoth("settings"); return; }
    if (k === "loc") { P.busy = "loc"; ls.del(K.off); D?.repaint(); void getFix().then((f) => { P.busy = ""; void dpStates().then(() => D?.repaint()); if (!f) D?.note(P.loc === "denied" ? "Location is blocked for 1Helm" : "Couldn't get your location", P.loc === "denied" ? HOW.loc : "Try again in a moment.", true); else D?.note("Location is on", `${D.helper()} knows roughly where you are now.`); }); return; }
    if (k === "mic") { P.busy = "mic"; D?.repaint(); void askMic().then((ok) => { P.busy = ""; void dpStates().then(() => D?.repaint()); if (ok) D?.note("The microphone is on", "Tap the mic in the message box to talk instead of typing."); else D?.note(P.mic === "denied" ? "The microphone is blocked for 1Helm" : "Couldn't turn on the microphone", P.mic === "denied" ? HOW.mic : "Another app may be using it. Try again.", true); }); return; }
    if (k === "lochow") { D?.note("Location is blocked for 1Helm", HOW.loc, true); return; }
    if (k === "michow") { D?.note("The microphone is blocked for 1Helm", HOW.mic, true); return; }
    if (k === "locsw") { if (off()) { ls.del(K.off); D?.repaint(); void getFix(); } else { ls.set(K.off, "1"); void forget(); } return; }
    if (k === "locnow") { void getFix().then((f) => { if (!f) D?.note("Couldn't update your location", "Try again in a moment.", true); }); return; }
    if (k === "forget") { void forget(); return; }
  });
  if (D.look) return;
  // A fresh fix while the app is in use: on open, and when it comes back into focus with a stale one. Only while granted.
  void dpStates().then(() => { const f = cached(); if (!off() && allowed("loc") && f && Date.now() - f.at < FRESH_MS) void keep(f); return refresh(); });
  const back = () => { if (document.visibilityState === "visible") void dpStates().then(() => refresh()); };
  document.addEventListener("visibilitychange", back); addEventListener("focus", back);
}
