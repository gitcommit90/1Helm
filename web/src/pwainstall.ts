// Install 1Helm as an app, from a button inside the app (Captain 10-08) instead of only the browser's address-bar icon.
// - Chrome / Edge / Android: the browser's beforeinstallprompt is caught at import (v3.ts imports this module near the top, so the
//   listener is on before the UI renders), preventDefault() keeps the browser's own infobar away, and the event is kept. Our
//   Install button calls .prompt() on it inside the tap and awaits userChoice. Dismissed: the button stays (the event can only
//   prompt once, so a second tap opens our sheet with the browser-menu steps until the browser hands us a fresh event).
//   appinstalled (from our button or the browser's own UI) clears it and hides the button.
// - Safari has no beforeinstallprompt: iPhone/iPad (any browser there, Chrome included) get "Add to Home Screen" steps with the
//   Share icon; Safari 17+ on a Mac gets "File → Add to Dock". Both in our own sheet (dialog.css), never a native dialog.
// - Never shown when already running as the installed app (display-mode: standalone / navigator.standalone), and nothing pops
//   up on its own: the button sits in Settings → General → App, the desktop account menu and the phone's Settings sheet.
// The logic is createInstall(win) over a window-like object, so test/pwainstall.test.mjs drives it with fakes.

export type Kind = "" | "prompt" | "ios" | "mac" | "menu";
export type Plat = { standalone: boolean; ios: boolean; iosApp: "safari" | "chrome" | "edge" | "firefox" | "other"; ipad: boolean; mac: boolean; android: boolean };
type BIP = Event & { prompt: () => Promise<unknown>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }> };
type Win = {
  addEventListener: (t: string, f: (e: any) => void) => void;
  matchMedia?: (q: string) => { matches: boolean };
  navigator: { userAgent: string; maxTouchPoints?: number; standalone?: boolean; platform?: string };
};

// Which device / browser this is. iPadOS Safari says "Macintosh", so a Mac with a touch screen is an iPad.
export function platformOf(w: Win): Plat {
  const n = w.navigator, ua = String(n.userAgent || "");
  let standalone = n.standalone === true;
  try { standalone = standalone || !!w.matchMedia?.("(display-mode: standalone)").matches || !!w.matchMedia?.("(display-mode: window-controls-overlay)").matches || !!w.matchMedia?.("(display-mode: fullscreen)").matches; } catch { /* old browser */ }
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (n.maxTouchPoints || 0) > 1);
  const ios = ipad || /iPhone|iPod/.test(ua);
  const iosApp = !ios ? "other" : /CriOS/.test(ua) ? "chrome" : /EdgiOS/.test(ua) ? "edge" : /FxiOS/.test(ua) ? "firefox" : /Version\/[\d.]+.*Safari/.test(ua) ? "safari" : "other";
  // Safari 17+ on macOS: "Version/17.x Safari", and none of the browsers that also say "Safari".
  const sv = ua.match(/Version\/(\d+)[\d.]* Safari/);
  const mac = !ios && /Macintosh/.test(ua) && !!sv && Number(sv[1]) >= 17 && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  return { standalone, ios, iosApp, ipad, mac, android: /Android/.test(ua) };
}

export function createInstall(w: Win) {
  const plat = platformOf(w);
  let saved: BIP | null = null, seen = false, installed = false, busy = false;
  const subs = new Set<() => void>(), tell = () => subs.forEach((f) => { try { f(); } catch { /* a repaint failing never breaks the rest */ } });
  w.addEventListener("beforeinstallprompt", (e: BIP) => { e.preventDefault(); saved = e; seen = true; installed = false; tell(); });
  w.addEventListener("appinstalled", () => { saved = null; installed = true; tell(); });
  const st = () => { try { return platformOf(w).standalone; } catch { return plat.standalone; } };
  const api = {
    plat,
    // What the Install button does right now; "" = no button.
    kind(): Kind {
      if (installed || plat.standalone || st()) return "";
      if (saved) return "prompt";
      if (seen) return "menu";              // the browser offered it once this visit (then the person said Not now)
      if (plat.ios) return "ios";
      if (plat.mac) return "mac";
      return "";
    },
    // Straight from the tap: .prompt() must run inside the user's gesture, so nothing is awaited before it.
    // Returns the outcome, or the instructions sheet to open ("ios" | "mac" | "menu"), or "" when there's nothing to do.
    async install(): Promise<"accepted" | "dismissed" | "ios" | "mac" | "menu" | ""> {
      const k = api.kind();
      if (k !== "prompt") return k;
      if (busy) return "";
      const e = saved!; busy = true;
      try {
        await e.prompt();
        const c = await e.userChoice;
        saved = null;                           // one prompt per event; the browser sends a new one when it can ask again
        if (c?.outcome === "accepted") installed = true;
        tell(); return c?.outcome === "accepted" ? "accepted" : "dismissed";
      } catch {
        saved = null; tell(); return "menu";    // a used or stale event: fall back to the browser-menu steps
      } finally { busy = false; }
    },
    on(f: () => void) { subs.add(f); return () => subs.delete(f); },
  };
  return api;
}

// ---------- the instructions sheet (our own; dialog.css) ----------
const I = (p: string, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const PI_ICON = '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/><path d="M10 18h4"/>';
const SHARE = I('<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>');
const ADDSQ = I('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>');
const DOTS = I('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>');
const CHECK = I('<path d="M20 6 9 17l-5-5"/>');
const MENUBAR = I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h4"/>');
const step = (n: number, icon: string, html: string) => `<li class="pistep"><span class="pinum">${n}</span><span class="pitx">${html}</span><span class="piic">${icon}</span></li>`;

export function sheetHtml(kind: "ios" | "mac" | "menu", p: Plat): string {
  if (kind === "ios") {
    const where = p.iosApp === "safari" ? (p.ipad ? "at the top of Safari, next to the address" : "in the bar at the bottom of Safari")
      : p.iosApp === "chrome" ? "in Chrome's address bar (or under ⋯ at the bottom)" : p.iosApp === "edge" || p.iosApp === "firefox" ? "in the browser's menu (☰ or ⋯)" : "in your browser's toolbar";
    return `<div class="dlggrab" aria-hidden="true"></div><h2 id="pit">Add 1Helm to your Home Screen</h2>
      <p>It opens full-screen like any other app, with its own icon.</p>
      <ol class="pisteps">${step(1, SHARE, `Tap <b>Share</b> ${where}.`)}${step(2, ADDSQ, `Scroll down and tap <b>Add to Home Screen</b>.`)}${step(3, CHECK, `Tap <b>Add</b>, then open 1Helm from your Home Screen.`)}</ol>
      ${p.iosApp === "safari" || p.iosApp === "other" ? "" : `<p class="pifine">Don't see it? Open this page in Safari and add it from there.</p>`}
      <div class="dlgbtns"><button class="dlgb ok" data-piok>Got it</button></div>`;
  }
  if (kind === "mac") return `<div class="dlggrab" aria-hidden="true"></div><h2 id="pit">Add 1Helm to your Dock</h2>
      <p>It opens in its own window, from the Dock or Launchpad, like any other app.</p>
      <ol class="pisteps">${step(1, MENUBAR, `In the menu bar at the top of your screen, choose <b>File</b> → <b>Add to Dock</b>. (Or click <b>Share</b> in Safari's toolbar → <b>Add to Dock</b>.)`)}${step(2, CHECK, `Click <b>Add</b>.`)}</ol>
      <div class="dlgbtns"><button class="dlgb ok" data-piok>Got it</button></div>`;
  const how = p.android ? `Tap <b>⋮</b> at the top right of Chrome, then <b>Add to Home screen</b> → <b>Install</b>.`
    : `Click the install icon at the right end of the address bar. Or open the browser's menu (<b>⋮</b> or <b>⋯</b>): in Chrome it's <b>Cast, save and share</b> → <b>Install page as app</b>, in Edge <b>Apps</b> → <b>Install this site as an app</b>.`;
  return `<div class="dlggrab" aria-hidden="true"></div><h2 id="pit">Install 1Helm</h2>
      <p>${p.android ? "It opens full-screen from your Home screen, like any other app." : "It opens in its own window, from your Dock, taskbar or Start menu."}</p>
      <ol class="pisteps">${step(1, DOTS, how)}${step(2, CHECK, `Choose <b>Install</b>.`)}</ol>
      <div class="dlgbtns"><button class="dlgb ok" data-piok>Got it</button></div>`;
}

// ---------- the app's side ----------
// Started at import, so beforeinstallprompt is caught even if it fires before the UI renders.
const PI = typeof window !== "undefined" && typeof document !== "undefined" ? createInstall(window as unknown as Win) : null;
export const piKind = (): Kind => PI?.kind() ?? "";
export const piOn = (f: () => void) => PI?.on(f);
// The button's words, for the three places it lives.
export const piLabel = (k: Kind) => k === "prompt" ? "Install" : "Show me how";
export const piSub = (k: Kind, phone: boolean) => k === "ios" ? "Add it to your Home Screen from the Share menu"
  : k === "mac" ? "Add it to your Dock from Safari's File menu"
  : phone ? "Opens full-screen from your Home screen, like any other app" : "Opens in its own window, from your Dock or taskbar";

let sheet: HTMLElement | null = null, prev: HTMLElement | null = null;
function openSheet(kind: "ios" | "mac" | "menu") {
  if (sheet || !PI) return;
  prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement("div"); el.className = "dlgw piw";
  el.innerHTML = `<div class="dlgback" data-piok></div><div class="dlg pibox" role="dialog" aria-modal="true" aria-labelledby="pit" tabindex="-1">${sheetHtml(kind, PI.plat)}</div>`;
  sheet = el; document.body.appendChild(el); void el.offsetWidth; el.classList.add("on");
  setTimeout(() => sheet?.querySelector<HTMLElement>("[data-piok]:not(.dlgback)")?.focus({ preventScroll: true }), 30);
  el.addEventListener("click", (e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest("[data-piok]")) closeSheet(); });
}
function closeSheet() {
  const el = sheet; if (!el) return; sheet = null;
  el.classList.remove("on"); el.classList.add("off"); setTimeout(() => el.remove(), 300);
  if (prev?.isConnected) prev.focus({ preventScroll: true });
}
export const piSheetOpen = () => !!sheet;
// Esc closes the sheet; Tab stays inside. Registered at import, before the app's own keys.
if (typeof document !== "undefined") addEventListener("keydown", (e) => {
  if (!sheet) return; e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); closeSheet(); }
  else if (e.key === "Tab") { e.preventDefault(); sheet.querySelector<HTMLElement>("button")?.focus(); }
}, true);

// The tap on any Install button. note: the app's toast.
export function piInstall(note: (title: string, sub: string) => void) {
  if (!PI) return;
  void PI.install().then((r) => {
    if (r === "accepted") note("Installing 1Helm", "Open it from your Dock, taskbar or Home Screen. This tab keeps working too.");
    else if (r === "ios" || r === "mac" || r === "menu") openSheet(r);
    // dismissed: nothing pops up; the button stays where it was
  });
}
