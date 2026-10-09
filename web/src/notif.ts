// Settings → Notifications (Captain 10-06). The switches saved on the server per account (1HC src/notify.js):
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
// v3.ts hooks in: nfInit() once, nfHtml() as the section, nfSeen() from its refresh.

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
};
let D: Deps | null = null;
const P: { prefs: Prefs; loaded: boolean; key: string | null; texting: boolean; dev: "off" | "on" | "busy" | "test"; ep: string; why: string; err: string; hasSub: boolean; devices: number; last: PushRec | null; testAt: number } =
  { prefs: { needs: true, finished: true, sound: true, needs_text: true, meetings: true }, loaded: false, key: null, texting: false, dev: "off", ep: "", why: "", err: "", hasSub: false, devices: 0, last: null, testAt: 0 };
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
function deviceWhy(): string {
  if (!D?.live) return "";
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
  const u = navigator.userAgent, b = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Browser";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) || ios() ? "iPad" : /Android/.test(u) ? "Android" : /Mac OS X/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : "";
  return `${b}${os ? ` on ${os}` : ""}${standalone() ? " (app)" : ""}`;
}
// quiet: from the location & mic sheet (it says what happened itself) or the silent re-subscribe; no toasts of its own.
// Notification.requestPermission() is reached synchronously, so it still counts as inside the tap that called this.
async function deviceOn(quiet = false) {
  if (!D?.live) { P.dev = "on"; D?.repaint(); return; }
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
  P.dev = "test"; D.repaint();
  const r = await call("/notif/test", { endpoint: P.ep }).catch(() => ({ error: "Check your connection and try again." }));
  P.dev = "on"; D.repaint();
  if (r.error) D.note("Couldn't send a test", r.error, true);
  else if (!r.ok) D.note("The test didn't go through", "Your browser's push service said no. Turn this device off and on again.", true);
  else {
    D.note("Test sent", "It should pop up in a few seconds.");
    const at = P.testAt = Date.now();
    setTimeout(async () => { if (P.testAt !== at) return; await readLast(); if (!(P.last && P.last.at >= at - 5000)) D?.repaint(); }, 15000);
  }
}
// The last push this device's service worker received (it keeps one record: see pwa.js in 1HC).
async function readLast() {
  if (!D?.live || !("caches" in window)) return;
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
  if (D?.live && !canPush()) return "";
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
  const sub = await currentSub();
  const d = await call(`/notif${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`).catch(() => null);
  if (!d || d.error) return;
  await readLast(); P.hasSub = !!(sub && d.push?.this_device); P.devices = Number(d.push?.devices || 0);
  P.prefs = d.prefs; P.key = d.push?.key || null; P.texting = !!d.texting; P.loaded = true;
  if (P.dev !== "busy" && P.dev !== "test") { P.dev = sub && d.push?.this_device ? "on" : "off"; P.ep = sub && d.push?.this_device ? sub.endpoint : ""; }
  P.why = P.dev === "on" ? "" : deviceWhy();
  D.repaint();
  heal();
}
// Notifications are allowed here but this context isn't signed up (an installed app on iPhone or a Mac's Dock keeps its own
// subscriptions; a browser can drop one): sign it up again silently, the same way the switch in Settings does. Once per load,
// and never after the person turned "This device" off by hand.
let healed = false;
function heal() {
  if (healed || !D?.live || !canPush() || Notification.permission !== "granted" || !P.key || P.hasSub || P.dev !== "off" || lsGet(OFF) === "1") return;
  healed = true; void deviceOn(true);
}
// For the location & mic sheet (devperm.ts): this context's notification permission, asking from inside a tap, and whether
// another device of this person already gets notifications (so the installed app can say it needs its own OK).
export const nfPerm = (): "granted" | "denied" | "prompt" | "unsupported" =>
  !D?.live || !canPush() ? "unsupported" : Notification.permission === "default" ? "prompt" : Notification.permission;
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
let ac: AudioContext | null = null, lastChime = 0;
function audio() { try { ac ||= new (window.AudioContext || (window as any).webkitAudioContext)(); if (ac.state === "suspended") ac.resume().catch(() => {}); return ac; } catch { return null; } }
/** A soft chime: "needs" rises (two notes), "finished" settles (two notes down). Quiet, short, sine. */
export function nfChime(kind: "needs" | "finished") {
  if (!P.prefs.sound) return false;
  const now = Date.now(); if (now - lastChime < 4000) return false; lastChime = now;
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
export function nfSeen(chans: { sessions: { id: string; state: string; done?: boolean }[] }[], onScreen: string | null) {
  const now = Date.now(), fresh = now - lastSeenAt > 20e3; lastSeenAt = now;   // back from a hidden tab: start over quietly (the push already told them)
  let kind: "needs" | "finished" | null = null;
  for (const c of chans) for (const v of c.sessions || []) {
    const id = String(v.id), prev = seen.get(id), st = v.state; seen.set(id, st);
    if (fresh || prev === undefined || prev === st || (id === onScreen && document.hasFocus())) continue;
    if (st === "waiting" && P.prefs.needs) kind = "needs";
    else if (prev === "working" && (st === "ready" || st === "watching") && !v.done && P.prefs.finished && kind !== "needs") kind = "finished";
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
    if (m.t === "push" && (m.d?.kind === "needs" || m.d?.kind === "finished")) nfChime(m.d.kind);
    if (m.t === "pushed" && m.rec && typeof m.rec.at === "number") {
      P.last = m.rec; D?.repaint();
      if (m.rec.test && P.testAt && m.rec.at >= P.testAt - 5000) D?.note(m.rec.shown ? "The test reached this device" : "The test couldn't be shown", m.rec.shown ? "Didn't see it? Steps are below." : "Steps to fix it are below.", !m.rec.shown);
    }
    if (m.t === "open" && typeof m.url === "string") { try { const u = new URL(m.url, location.href); if (u.origin === location.origin) { if (u.pathname === location.pathname) location.hash = u.hash; else location.assign(u.href); } } catch {} }
  });
}
