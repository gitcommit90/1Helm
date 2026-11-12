// Settings → Notifications. The switches saved on the server per account (1HC src/notify.js):
//   A task needs you (a question, an approval, something to sign) · A task is finished · Meeting reminders for notes (meetings.ts,
//   2026-10-08: a calendar meeting starts → "Take notes?") · Sounds (a soft sound in the app).
// "This device": Web Push through a push-only service worker (/w/<slug>/sw.js), on/off per device, with a test button.
// "Also by text": when texting is connected, "a task needs you" can also come as a text (one per task per change).
// Sounds: the app watches its task list (the 6-second refresh) and plays a soft chime when a task starts waiting on the person
// or finishes, unless that task is the one on screen. A push that arrives while the app is on screen plays it too (no system
// notification then: the service worker hands it to the app). At most one chime every few seconds.
// Diagnostics under This device: the permission, whether this device is signed up, and the last push it received (the service
// worker records each one in Cache Storage and posts {t:"pushed"}), so "nothing arrived" can be told apart from "it arrived but
// the system hid it" (then: where to look in the system's notification settings).
// In the 1Helm phone app (iPhone, Android) "This device" uses the phone's own notifications instead of Web Push: see "the 1Helm phone app" below.
// In the 1Helm Mac app (Electron: no Web Push there) "This device" means: while the app runs, even with its window closed, the page
// shows a macOS notification itself when a task starts waiting on you or finishes (nfSeen). See "the 1Helm Mac app" below.
// v3.ts hooks in: nfInit() once, nfHtml() as the section, nfSeen() from its refresh.

import { soundOk, silentInit } from "./silent";

type Prefs = { needs: boolean; finished: boolean; sound: boolean; needs_text: boolean; meetings: boolean };
type Live = { api: string; slug: string } | null;
type PushRec = { at: number; kind: string; test: boolean; shown: boolean; quiet: boolean; listed: boolean | null; perm: string; err: string };
type Deps = {
  live: Live;
  texting: boolean;
  ambient: boolean;
  repaint: () => void;                                        // Settings, if it's open on this section
  note: (title: string, sub: string, bad?: boolean) => void;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  helper: () => string;
  look?: boolean;                                             // a dev "view as": never asks
  blocked?: () => boolean;                                    // another permission sheet is open (devperm.ts): wait for it
};
let D: Deps | null = null;
const P: { prefs: Prefs; loaded: boolean; key: string | null; app: boolean; texting: boolean; dev: "off" | "on" | "busy" | "test"; ep: string; why: string; err: string; hasSub: boolean; devices: number; last: PushRec | null; testAt: number } =
  { prefs: { needs: true, finished: true, sound: true, needs_text: true, meetings: true }, loaded: false, key: null, app: false, texting: false, dev: "off", ep: "", why: "", err: "", hasSub: false, devices: 0, last: null, testAt: 0 };
// "This device" switched off by hand in Settings: then a granted permission without a subscription is on purpose (no self-heal).
const OFF = "1hc.nf.off";
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function call(path: string, body?: any) {
  if (!D?.live) { await new Promise(z => setTimeout(z, 250)); return path === "/notif" && body ? { prefs: { ...P.prefs, ...body } } : { ok: true }; }   // sandbox: pretend
  const r = await fetch(`${D.live.api}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` })); if (!r.ok && !d.error) d.error = `HTTP ${r.status}`; return d;
}

// ---------- this device (Web Push) ----------
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
const ios = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const scope = () => `/w/${D!.live!.slug}/`;

// ---------- the 1Helm phone app (iPhone, Android) ----------
// Inside the app there is no Web Push. The app's push plugin (Capacitor PushNotifications, reachable from this page) asks the
// phone, gets an address from Apple or Google, and 1HC hands it to the 1Helm push relay (1HC src/native-push.js). The switch,
// the test and the location & mic sheet work the same way. A notification for a task opens that task in the app.
const capPush = (): any => { const C = (window as any).Capacitor; return C?.isNativePlatform?.() ? (C.Plugins?.PushNotifications || null) : null; };
const inApp = () => !!capPush();
const appPlatform = () => ((window as any).Capacitor?.getPlatform?.() === "android" ? "android" : "ios");
const APPTOK = "1hc.nf.app.token", APPEP = "1hc.nf.app.ep";
let appPerm: "granted" | "denied" | "prompt" = "prompt";
const permOf = (r: any) => (r?.receive === "granted" ? "granted" : r?.receive === "denied" ? "denied" : "prompt");
async function appPermNow() { try { appPerm = permOf(await capPush().checkPermissions()); } catch { /* keep the last one */ } return appPerm; }
let tokWait: ((t: string | null) => void) | null = null, listening = false;
function appListen() {
  silentInit();
  if (listening || !inApp()) return; listening = true; const N = capPush();
  N.addListener("registration", (t: any) => { const v = String(t?.value || ""); if (v) lsSet(APPTOK, v); tokWait?.(v || null); tokWait = null; });
  N.addListener("registrationError", () => { tokWait?.(null); tokWait = null; });
  N.addListener("pushNotificationActionPerformed", (a: any) => { const url = a?.notification?.data?.url; if (typeof url === "string" && url) openHere(url); });
  // While 1Helm is open the phone doesn't show it: the app does, as one of its own notes (and the soft sound).
  // A push for the task on screen shows nothing (the person is already looking at it), the same rule as the web and Mac paths.
  N.addListener("pushNotificationReceived", (n: any) => {
    if (!D || pushOnScreen(n?.data)) return;
    const title = String(n?.title || "1Helm"), kind = n?.data?.kind === "finished" || (n?.data?.kind !== "needs" && /^Finished:/.test(title)) ? "finished" : "needs";
    D.note(title, String(n?.body || "")); nfChime(kind);
  });
}
// register() answers with the phone's address through the "registration" event (or "registrationError").
function appToken(): Promise<string | null> {
  return new Promise((done) => {
    tokWait = done;
    setTimeout(() => { if (tokWait === done) { tokWait = null; done(null); } }, 15000);
    Promise.resolve(capPush().register()).catch(() => { if (tokWait === done) { tokWait = null; done(null); } });
  });
}
function appWhy(): string {
  if (!P.app) return "Notifications aren't available right now.";
  if (appPerm !== "denied") return "";
  return appPlatform() === "android" ? "Notifications are off for 1Helm. Open Settings → Apps → 1Helm → Notifications and turn them on, then come back."
    : "Notifications are off for 1Helm. Open Settings → Notifications → 1Helm and turn on Allow Notifications, then come back.";
}
async function appOn(quiet = false) {
  if (!D?.live) return;
  P.dev = "busy"; P.err = ""; P.why = ""; D.repaint();
  try {
    appListen();
    let perm = await appPermNow();
    if (perm === "prompt") perm = appPerm = permOf(await capPush().requestPermissions());
    lsSet(OFF, null);
    if (perm !== "granted") { P.dev = "off"; P.why = appWhy() || "Notifications weren't allowed, so nothing changed."; D.repaint(); return; }
    const token = await appToken();
    if (!token) throw new Error("This phone couldn't sign up for notifications. Try again in a minute.");
    const r = await call("/notif/app", { platform: appPlatform(), token, label: deviceLabel() });
    if (r.error) throw new Error(r.error);
    lsSet(APPEP, String(r.endpoint || "")); P.ep = String(r.endpoint || ""); P.dev = "on"; P.hasSub = true; D.repaint();
    if (!quiet) D.note("Notifications are on for this phone", "Tap Send a test to see one.");
  } catch (e: any) { P.dev = "off"; P.err = e?.message || "Something went wrong."; D.repaint(); if (!quiet) D.note("Couldn't turn on notifications", P.err, true); }
}
async function appOff() {
  if (!D?.live) return;
  P.dev = "busy"; D.repaint();
  const token = lsGet(APPTOK);
  if (token) await call("/notif/app/off", { platform: appPlatform(), token }).catch(() => null);
  lsSet(APPEP, null); P.ep = ""; P.dev = "off"; P.hasSub = false; P.testAt = 0; lsSet(OFF, "1"); D.repaint();
}
// ---------- the 1Helm Mac app ----------
// The app adds "1HelmDesktop" to its user agent and keeps this page running with its window closed (no background throttling).
// On/off is per Mac (localStorage); the notifications come from this page, so nothing is signed up on the server.
const inDesktop = () => /\b1HelmDesktop\b/.test(navigator.userAgent) && "Notification" in window;
const DESK = "1hc.nf.desktop";
async function deskOn(quiet = false) {
  if (!D) return;
  P.dev = "busy"; P.err = ""; D.repaint();
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  lsSet(OFF, null);
  if (perm !== "granted") { P.dev = "off"; P.why = deskWhy() || "Notifications weren't allowed, so nothing changed."; D.repaint(); return; }
  lsSet(DESK, "1"); P.dev = "on"; P.hasSub = true; P.why = ""; D.repaint();
  if (!quiet) D.note("Notifications are on for this Mac", "Tap Send a test to see one.");
}
function deskOff() { lsSet(DESK, null); lsSet(OFF, "1"); P.dev = "off"; P.hasSub = false; P.testAt = 0; D?.repaint(); }
const deskWhy = () => Notification.permission === "denied" ? "Notifications are off for 1Helm. Open System Settings → Notifications → 1Helm and turn on Allow notifications, then come back." : "";
function deskShow(title: string, body: string, url: string, tag: string) {
  try {
    const n = new Notification(title, { body, tag, silent: !P.prefs.sound });
    n.onclick = () => { window.focus(); if (url) openHere(url); n.close(); };
  } catch { /* the system refused it */ }
}
// The task a push is about: its session id, from data.session or from the #/<channel>/s/<id> end of data.url.
const TASKHASH = /#\/[^/]+\/s\/([^/?#]+)/;
const pushTask = (d: any): string => { const m = TASKHASH.exec(String(d?.url || "")); return String(d?.session || (m ? decodeURIComponent(m[1]) : "")); };
/** True when the push is for the task that is open and in front right now. */
export function pushOnScreen(d: any): boolean {
  const id = pushTask(d); if (!id) return false;
  const m = TASKHASH.exec(location.hash || "");
  return !!m && decodeURIComponent(m[1]) === id && document.visibilityState !== "hidden";
}
function openHere(raw: string) { try { const u = new URL(raw, location.href); if (u.origin === location.origin) { if (u.pathname === location.pathname) location.hash = u.hash; else location.assign(u.href); } } catch { /* not a link */ } }
function deviceWhy(): string {
  if (!D?.live) return "";
  if (inApp()) return appWhy();
  if (inDesktop()) return deskWhy();
  if (!canPush()) return ios() && !standalone() ? "On iPhone and iPad: tap Share, then Add to Home Screen, and open 1Helm from there to turn this on." : "This browser can't show notifications.";
  if (Notification.permission === "denied") return "Notifications are blocked for 1Helm in this browser. Allow them in the browser's site settings, then come back.";
  if (!P.key) return "Notifications aren't available right now.";
  return "";
}
async function currentSub(): Promise<PushSubscription | null> {
  if (!D?.live || !canPush()) return null;
  try { const reg = await navigator.serviceWorker.getRegistration(scope()); return (await reg?.pushManager.getSubscription()) || null; } catch { return null; }
}
const keyBytes = (b64: string) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
function deviceLabel() {
  if (inApp()) return appPlatform() === "android" ? "Android app" : "iPhone app";
  if (inDesktop()) return "Mac app";
  const u = navigator.userAgent, b = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Browser";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) || ios() ? "iPad" : /Android/.test(u) ? "Android" : /Mac OS X/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : "";
  return `${b}${os ? ` on ${os}` : ""}${standalone() ? " (app)" : ""}`;
}
// quiet: from the location & mic sheet (it says what happened itself) or the silent re-subscribe; no toasts of its own.
// Notification.requestPermission() is reached synchronously, so it still counts as inside the tap that called this.
async function deviceOn(quiet = false) {
  if (!D?.live) { P.dev = "on"; D?.repaint(); return; }
  if (inApp()) return appOn(quiet);
  if (inDesktop()) return deskOn(quiet);
  P.why = deviceWhy(); if (P.why) { D.repaint(); return; }
  P.dev = "busy"; P.err = ""; D.repaint();
  try {
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    lsSet(OFF, null);
    if (perm !== "granted") { P.dev = "off"; P.why = deviceWhy() || "Notifications weren't allowed, so nothing changed."; D.repaint(); return; }
    const reg = await navigator.serviceWorker.register(`${scope()}sw.js`, { scope: scope() });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with another key (keys rotated) can't receive our pushes: start over.
    const want = P.key!; if (sub && sub.options?.applicationServerKey) { const have = new Uint8Array(sub.options.applicationServerKey as ArrayBuffer), w = keyBytes(want); if (have.length !== w.length || have.some((x, i) => x !== w[i])) { await sub.unsubscribe(); sub = null; } }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(want) });
    const r = await call("/notif/sub", { sub: sub.toJSON(), label: deviceLabel() });
    if (r.error) throw new Error(r.error);
    P.ep = sub.endpoint; P.dev = "on"; P.hasSub = true; D.repaint();
    if (!quiet) D.note("Notifications are on for this device", "Tap Send a test to see one.");
  } catch (e: any) { P.dev = "off"; P.err = e?.message || "Something went wrong."; D.repaint(); if (!quiet) D.note("Couldn't turn on notifications", P.err, true); }
}
async function deviceOff() {
  if (!D?.live) { P.dev = "off"; D?.repaint(); return; }
  if (inApp()) return appOff();
  if (inDesktop()) return deskOff();
  P.dev = "busy"; D.repaint();
  const sub = await currentSub(), ep = sub?.endpoint || P.ep;
  try { await sub?.unsubscribe(); } catch {}
  if (ep) await call("/notif/unsub", { endpoint: ep }).catch(() => null);
  P.ep = ""; P.dev = "off"; P.hasSub = false; P.testAt = 0; lsSet(OFF, "1"); D.repaint();
}
async function deviceTest() {
  if (!D?.live) {   // sandbox: pretend it went out and came back shown, so the help under This device can be seen
    const at = P.testAt = Date.now(); P.last = { at, kind: "test", test: true, shown: true, quiet: false, listed: null, perm: "granted", err: "" }; D?.repaint();
    D?.note("Test sent", "In the app, it pops up on this device."); return;
  }
  if (P.dev !== "on") return;
  if (inDesktop()) { deskShow("Notifications are on", `This is how ${D.helper()} will reach you on this Mac.`, "", `test-${Date.now()}`); D.note("Test sent", "It shows in the top-right corner of your screen."); return; }
  P.dev = "test"; D.repaint();
  const r = await call("/notif/test", { endpoint: P.ep }).catch(() => ({ error: "Check your connection and try again." }));
  P.dev = "on"; D.repaint();
  if (r.error) D.note("Couldn't send a test", r.error, true);
  else if (!r.ok) D.note("The test didn't go through", "Your browser's push service said no. Turn this device off and on again.", true);
  else {
    if (inApp()) { D.note("Test sent", "While 1Helm is open it shows here. With 1Helm closed, it comes as a notification."); return; }
    D.note("Test sent", "It should pop up in a few seconds.");
    const at = P.testAt = Date.now();
    setTimeout(async () => { if (P.testAt !== at) return; await readLast(); if (!(P.last && P.last.at >= at - 5000)) D?.repaint(); }, 15000);
  }
}
// The last push this device's service worker received (it keeps one record: see pwa.js in 1HC).
async function readLast() {
  if (!D?.live || inApp() || inDesktop() || !("caches" in window)) return;
  try { const r = await (await caches.open("1helm-nf")).match(`${location.origin}${scope()}nf-last`); P.last = r ? await r.json() : null; } catch {}
}
const sysApp = () => { const u = navigator.userAgent; return /Edg\//.test(u) ? "Microsoft Edge" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Google Chrome" : /Safari\//.test(u) ? "Safari" : "your browser"; };
// Where to look when a notification arrived but didn't show: the system's own settings, by platform (from the user agent).
// Shown in full under This device (never in a toast: toasts are one line and would cut it off).
function sysWhere() {
  const u = navigator.userAgent, app = sysApp(), named = app === "your browser" ? app : `${app} (or your browser)`;
  if (ios()) return "Open Settings → Notifications → 1Helm and turn on Allow Notifications. Also turn off Focus / Do Not Disturb.";
  if (/Android/.test(u)) return `Open Settings → Apps → ${app.replace("Google ", "")} → Notifications and turn them on. Also turn off Do not disturb.`;
  if (/Mac OS X/.test(u)) return `Open System Settings → Notifications → ${named} and turn on Allow notifications, with style Banners or Alerts. Also turn off Focus / Do Not Disturb.`;
  if (/Windows/.test(u)) return `Open Settings → System → Notifications → ${named} and turn notifications on. Also turn off Do not disturb.`;
  return `Check this device's notification settings for ${app} and make sure notifications are allowed. Also turn off Do Not Disturb.`;
}
const when = (t: number) => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return (today ? "today " : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " ") + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
function diagHtml(): string {
  if (D?.live && (inApp() || inDesktop() || !canPush())) return "";
  const perm = D?.live ? Notification.permission : "granted", L = P.last;
  const permT = perm === "granted" ? "allowed" : perm === "denied" ? "blocked" : "not asked yet";
  const lastT = !L ? "none yet" : `${when(L.at)}${L.test ? " (a test)" : ""}, ${L.err && !L.shown ? "couldn't be shown" : L.quiet ? "kept quiet (you were looking at that task)" : "shown"}`;
  // say: what happened to the test. help: where to look in the system's settings, in full, until the next test.
  let say = "", help = "";
  const waited = P.testAt && Date.now() - P.testAt > 14000, arrived = L && P.testAt && L.at >= P.testAt - 5000;
  if (arrived && L!.shown) { say = `The test reached this device and ${sysApp() === "your browser" ? "the browser" : sysApp()} showed it.`; help = "Didn't see it?"; }
  else if (arrived && !L!.shown) { say = `The test reached this device but couldn't be shown${L!.err ? ` (${L!.err})` : ""}.`; help = "To let it show:"; }
  else if (waited) say = `The test hasn't reached this device yet. ${sysApp() === "your browser" ? "The browser" : sysApp()} has to be running and online; if it still doesn't come, turn this device off and on again.`;
  else if (P.testAt) { say = "Test sent. It should pop up in a few seconds."; help = "Didn't see it?"; }
  else if (L && L.test && L.shown && P.dev === "on") help = "Didn't see the last test?";
  return `<div class="nfdiag" data-nfdiag><span>Permission: <b>${permT}</b></span><span>This device signed up: <b>${P.hasSub && P.dev !== "off" || !D?.live && P.dev === "on" ? "yes" : "no"}</b></span><span>Last one received: <b>${esc(lastT)}</b></span>${say ? `<p>${esc(say)}</p>` : ""}${help ? `<p class="nfhelp" data-nfhelp><b>${esc(help)}</b> ${esc(sysWhere())}</p>` : ""}</div>`;
}
// Loads the switches and this device's state (Settings opened on Notifications, and once at start for the sound switch).
export async function nfLoad(force = false) {
  if (!D?.live) { P.loaded = true; return; }
  if (P.loaded && !force) return;
  if (inApp()) { appListen(); await appPermNow(); }
  const native = inApp() || inDesktop();
  const sub = native ? null : await currentSub(), ep = inApp() ? (appPerm === "granted" ? lsGet(APPEP) || "" : "") : sub?.endpoint || "";
  const d = await call(`/notif${ep ? `?endpoint=${encodeURIComponent(ep)}` : ""}`).catch(() => null);
  if (!d || d.error) return;
  await readLast(); P.hasSub = !!(ep && d.push?.this_device); P.devices = Number(d.push?.devices || 0);
  P.prefs = d.prefs; P.key = d.push?.key || null; P.app = !!d.push?.app; P.texting = !!d.texting; P.loaded = true;
  if (inDesktop()) { P.hasSub = lsGet(DESK) === "1" && Notification.permission === "granted"; if (P.dev !== "busy") P.dev = P.hasSub ? "on" : "off"; }
  else if (P.dev !== "busy" && P.dev !== "test") { P.dev = ep && d.push?.this_device ? "on" : "off"; P.ep = ep && d.push?.this_device ? ep : ""; }
  P.why = P.dev === "on" ? "" : deviceWhy();
  D.repaint();
  heal();
  autoAsk();
}
// Notifications are on by default, so a device that hasn't decided yet gets the browser's own permission request, with no text of
// our own. Chrome and Edge allow the request as soon as the page has loaded. Safari (and every browser on iPhone and iPad) and Firefox
// only allow it from a tap or key press, so there it waits for the first one. Asked once per device and display mode: a dismissed
// request is not repeated by itself, and Settings → Notifications still turns it on. Never asked in view-as, after "This device"
// was switched off by hand, when every notification switch is off, or while the location & mic sheet is open (that sheet asks too).
const ASKED = () => `1hc.nf.asked${standalone() ? ".app" : ""}`;
const needsGesture = () => { const u = navigator.userAgent; return ios() || /Firefox\/|FxiOS/.test(u) || (/Safari\//.test(u) && !/Chrom(e|ium)|CriOS|Edg|OPR|Android/.test(u)); };
const askWanted = () => !!D?.live && !D.look && !inApp() && (inDesktop() || canPush()) && Notification.permission === "default" && (inDesktop() || !!P.key) && P.loaded && P.dev === "off"
  && (P.prefs.needs || P.prefs.finished || P.prefs.meetings !== false) && lsGet(OFF) !== "1" && lsGet(ASKED()) === null;
let armed = false;
function autoAsk() {
  if (!askWanted()) return;
  if (!needsGesture()) { lsSet(ASKED(), "1"); void deviceOn(true); return; }
  if (armed) return; armed = true;
  const tap = (e: Event) => {
    if (e.type === "keydown" && (e as KeyboardEvent).key !== "Enter" && (e as KeyboardEvent).key !== " ") return;
    if (D?.blocked?.()) return;   // keep waiting: the sheet's own button will ask
    removeEventListener("click", tap, true); removeEventListener("keydown", tap, true); armed = false;
    if (!askWanted()) return;
    lsSet(ASKED(), "1"); void deviceOn(true);   // requestPermission() is reached inside this tap
  };
  addEventListener("click", tap, true); addEventListener("keydown", tap, true);
}
// Notifications are allowed here but this context isn't signed up (an installed app on iPhone or a Mac's Dock keeps its own
// subscriptions; a browser can drop one): sign it up again silently, the same way the switch in Settings does. Once per load,
// and never after the person turned "This device" off by hand.
let healed = false;
function heal() {
  if (healed || !D?.live || P.hasSub || P.dev !== "off" || lsGet(OFF) === "1") return;
  if (inApp()) { if (appPerm === "granted" && P.app) { healed = true; void appOn(true); } return; }   // e.g. signed in to another workspace
  if (inDesktop()) return;
  if (!canPush() || Notification.permission !== "granted" || !P.key) return;
  healed = true; void deviceOn(true);
}
// For the location & mic sheet (devperm.ts): this context's notification permission, asking from inside a tap, and whether
// another device of this person already gets notifications (so the installed app can say it needs its own OK).
export const nfPerm = (): "granted" | "denied" | "prompt" | "unsupported" =>
  !D?.live ? "unsupported" : inApp() ? (P.app ? appPerm : "unsupported") : inDesktop() ? (Notification.permission === "default" ? "prompt" : Notification.permission) : !canPush() ? "unsupported" : Notification.permission === "default" ? "prompt" : Notification.permission;
export const nfAsk = (): Promise<boolean> => deviceOn(true).then(() => P.dev === "on");
export const nfElsewhere = () => P.devices > 0 && !P.hasSub;

// ---------- the section ----------
const sw = (k: string, on: boolean, label: string, busy = false) => `<button type="button" class="tg${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-nf="${k}"${busy ? " disabled" : ""}><i></i></button>`;
export function nfHtml(): string {
  if (!D) return "";
  if (D.live && !P.loaded) nfLoad();
  const p = P.prefs, row = D.srow, any = p.needs || p.finished || (D.ambient && p.meetings !== false);
  const devSub = P.dev === "busy" ? "One moment…" : P.dev === "on" || P.dev === "test" ? `On · ${esc(deviceLabel())}` : P.why ? esc(P.why) : "Off";
  const devRight = P.why && P.dev === "off" ? "" : sw("device", P.dev === "on" || P.dev === "test", "Notifications on this device", P.dev === "busy");
  return `<h2>Notifications</h2><p class="slead">Choose when 1Helm lets you know. ${esc(D.helper())} never messages you on its own: these are only about tasks you started${D.ambient ? ", and meetings on your calendar if you keep that on" : ""}.</p>
    <div class="sc">${row("", "A task needs you", "A question, an approval, or something to sign", sw("needs", p.needs, "A task needs you"))}
      ${row("", "A task is finished", "So you can take a look and check it off", sw("finished", p.finished, "A task is finished"))}
      ${D.ambient ? row("", "Meeting reminders for notes", "When a Google Calendar or Outlook meeting with a video link or other people starts: “Take notes?”", sw("meetings", p.meetings !== false, "Meeting reminders for notes")) : ""}
      ${row("", "Sounds", "A soft sound in the app when one of these happens", sw("sound", p.sound, "Sounds"))}</div>
    <h3>This device</h3>
    <div class="sc nfdev">${row("", "Notifications on this device", devSub, devRight)}
      ${P.dev === "on" || P.dev === "test" ? `<div class="sfoot nffoot"><button type="button" class="sa" data-nftest${P.dev === "test" ? " disabled" : ""}>${P.dev === "test" ? "Sending…" : "Send a test"}</button>${any ? "" : `<span class="nfhint">Both switches above are off, so only tests come through.</span>`}</div>` : ""}${diagHtml()}</div>
    ${D.texting ? `<h3>By text</h3>
    <div class="sc">${P.texting || !D.live ? row("", "Also text me when a task needs you", "Only when you're not watching that task in the app", sw("needs_text", p.needs && p.needs_text, "Also text me when a task needs you", !p.needs))
      : row("", "Also text me when a task needs you", "Set up Texting first, then switch this on.", `<button type="button" class="sa blue" data-sgo="texting">Set up</button>`)}</div>` : ""}
    <p class="sfine">In the app, tasks that need you always get a dot. Notifications on this device show unless you're looking at that very task.</p>`;
}
async function toggle(k: keyof Prefs | "device") {
  if (!D) return;
  if (k === "device") return P.dev === "on" ? deviceOff() : P.dev === "off" ? deviceOn() : undefined;
  const before = { ...P.prefs }; P.prefs = { ...P.prefs, [k]: !P.prefs[k] }; D.repaint();
  const r = await call("/notif", { [k]: P.prefs[k] }).catch(() => ({ error: "Check your connection and try again." }));
  if (r?.prefs) { P.prefs = r.prefs; D.repaint(); }
  else { P.prefs = before; D.repaint(); D.note("Couldn't save that", r?.error || "Try again in a minute.", true); }
}

// ---------- sounds ----------
// A chime stays silent when the phone is silenced (src/silent.ts).
let ac: AudioContext | null = null, lastChime = 0;
function audio() { try { ac ||= new (window.AudioContext || (window as any).webkitAudioContext)(); if (ac.state === "suspended") ac.resume().catch(() => {}); return ac; } catch { return null; } }
/** A soft chime: "needs" rises (two notes), "finished" settles (two notes down). Quiet, short, sine. */
export function nfChime(kind: "needs" | "finished") {
  if (!P.prefs.sound) return false;
  const now = Date.now(); if (now - lastChime < 4000) return false; lastChime = now;
  if (!soundOk(1000)) return false;
  const a = audio(); if (!a || a.state !== "running") return false;
  const notes = kind === "needs" ? [659.25, 987.77] : [880, 659.25], t0 = a.currentTime + 0.01;
  notes.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain(), t = t0 + i * 0.14;
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.62);
  });
  (window as any).__nfChimes = ((window as any).__nfChimes || 0) + 1;   // e2e checks read this
  return true;
}
// The refresh's view of every task (server states). A task that started waiting, or went from working to done, chimes once.
const seen = new Map<string, string>(); let lastSeenAt = 0;
// The words of the Mac notification: the same title and body the phones get from the server push (notify.js notifyTask).
// The server supplies the reply line (notif_body) and the reason wording (notif_why); the fallbacks match an older server's push text.
export function deskText(k: "needs" | "finished", helper: string, v: { title?: string; notif_body?: string; notif_why?: string }) {
  const title = String(v.title || "your task").replace(/\s+/g, " ").trim();
  if (k === "needs") return { title: `${helper} ${v.notif_why || "needs you"}`.slice(0, 120), body: title.slice(0, 140) };
  return { title: `Finished: ${title}`.slice(0, 120), body: String(v.notif_body || "").slice(0, 140) || `${helper} is done. Take a look.` };
}
export function nfSeen(chans: { slug?: string; sessions: { id: string; state: string; done?: boolean; title?: string; notif_body?: string; notif_why?: string }[] }[], onScreen: string | null) {
  const now = Date.now(), fresh = now - lastSeenAt > 20e3; lastSeenAt = now;   // back from a hidden tab: start over quietly (the push already told them)
  const desk = inDesktop() && lsGet(DESK) === "1" && Notification.permission === "granted", away = !document.hasFocus() || document.visibilityState !== "visible";
  let kind: "needs" | "finished" | null = null;
  for (const c of chans) for (const v of c.sessions || []) {
    const id = String(v.id), prev = seen.get(id), st = v.state; seen.set(id, st);
    if (fresh || prev === undefined || prev === st || (id === onScreen && document.hasFocus())) continue;
    let k: "needs" | "finished" | null = null;
    if (st === "waiting" && P.prefs.needs) k = kind = "needs";
    else if (prev === "working" && (st === "ready" || st === "watching") && !v.done && P.prefs.finished) { k = "finished"; if (kind !== "needs") kind = "finished"; }
    // The Mac app: a notification of its own for each task, while 1Helm isn't the window in front (the same rule as Web Push).
    if (k && desk && away && D?.live) {
      const url = c.slug ? `${location.origin}${location.pathname}#/${c.slug}/s/${id}` : "", t = deskText(k, D.helper(), v);
      deskShow(t.title, t.body, url, `task-${id}`);
    }
  }
  if (kind) nfChime(kind);
}

export function nfInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement, b = t.closest<HTMLElement>("[data-nf]");
    if (b) { e.preventDefault(); if (!(b as HTMLButtonElement).disabled) toggle(b.dataset.nf as any); return; }
    if (t.closest("[data-nftest]")) { e.preventDefault(); deviceTest(); }
  });
  // Browsers only let a page play sound after a tap or key: get the audio ready on the first one.
  const wake = () => { audio(); removeEventListener("pointerdown", wake, true); removeEventListener("keydown", wake, true); };
  addEventListener("pointerdown", wake, true); addEventListener("keydown", wake, true);
  if (!D.live) return;
  nfLoad();
  // From the service worker: "which task is on screen?", a push for the task you're looking at (chime), what a push did
// (diagnostics), or a tapped notification (open that task here).
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    const m = e.data || {};
    // The service worker asks which task is on screen (a window's address doesn't follow the #hash), to keep quiet only for that one.
    if (m.t === "where" && e.ports?.[0]) { e.ports[0].postMessage({ t: "here", hash: location.hash, focus: document.hasFocus() && document.visibilityState === "visible" }); return; }
    if (m.t === "push" && (m.d?.kind === "needs" || m.d?.kind === "finished") && !pushOnScreen(m.d)) nfChime(m.d.kind);
    if (m.t === "pushed" && m.rec && typeof m.rec.at === "number") {
      P.last = m.rec; D?.repaint();
      if (m.rec.test && P.testAt && m.rec.at >= P.testAt - 5000) D?.note(m.rec.shown ? "The test reached this device" : "The test couldn't be shown", m.rec.shown ? "Didn't see it? Steps are below." : "Steps to fix it are below.", !m.rec.shown);
    }
    if (m.t === "open" && typeof m.url === "string") openHere(m.url);
  });
}
