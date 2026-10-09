// Add to Home Screen (iPhone/iPad) and Install app (Android/desktop Chrome): the person's app opens full-screen like an app.
// - appManifest(slug): the web app manifest, served at /w/<slug>/app/manifest.webmanifest. Public and DB-free (browsers fetch
//   manifests without cookies; it holds nothing but the slug already in its address), so it answers the same for any slug.
// - pwaHead(slug): the <head> tags the app shell adds (manifest link + the iOS tags Safari still reads instead of the manifest).
// - serviceWorker(): /w/<slug>/sw.js (scope /w/<slug>/), registered by the app only when the person turns on notifications on
//   a device. It handles Web Push and notification taps and nothing else: no fetch handler, so it never sits between the app
//   and its requests and can't serve a stale app.js past an APP_V bump.
// Colors match the app's light page (#f3f2ef; v3.css --page). Icons are the 1helm-icon-* files in app-assets.
export const PWA_BG = "#f3f2ef";
export const MANIFEST_RE = /^\/w\/([a-z0-9-]+)\/app\/manifest\.webmanifest$/;
export const PWA_ICON_RE = /^\/1helm-(?:dev-)?icon(-64|-180|-192|-maskable-192|-maskable-512|-touch-180)?\.png$/;
// dev: the same artwork with a yellow "DEV" badge (1helm-dev-icon-*; distinct names so browsers fetch them fresh). Live is untouched.
// DEV_ICON_V: bump it whenever the dev icons change. It versions the dev icon URLs, the manifest link and the dev manifest id,
// so Android Chrome sees a new manifest at a new address (never its HTTP-cached copy) describing a NEW app (a WebAPK is keyed
// by the manifest id: same id = Chrome/the WebAPK server/the launcher can reuse the old install's icon).
export const DEV_ICON_V = "2";
export const iconName = (src, dev) => (dev ? `${src.replace("/1helm-icon", "/1helm-dev-icon")}?v=${DEV_ICON_V}` : src);
export function appManifest(slug, dev = false) {
  const app = `/w/${slug}/app`;
  return {
    id: dev ? `${app}?dev=${DEV_ICON_V}` : app, name: "1Helm", short_name: "1Helm", description: "Your helper, your channels and everything they've made for you.",
    start_url: app, scope: `/w/${slug}/`, display: "standalone", background_color: PWA_BG, theme_color: PWA_BG, lang: "en",
    icons: [
      { src: "/1helm-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/1helm-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/1helm-icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/1helm-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/1helm-icon-touch-180.png", sizes: "180x180", type: "image/png" },
    ].map((ic) => ({ ...ic, src: iconName(ic.src, dev) })),
  };
}
// Live: cached for an hour. Dev: no-cache, so an icon/manifest change reaches the next install right away.
export const manifestResponse = (slug, dev = false) => new Response(JSON.stringify(appManifest(slug, dev)), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": dev ? "no-cache" : "public, max-age=3600" } });
// iOS: apple-touch-icon is the home-screen picture (full-bleed square; iOS rounds it). "default" status bar = dark text on a
// light bar, with the page below it (black-translucent would put white text over the light page).
export const pwaHead = (slug, dev = false) => `<link rel="manifest" href="/w/${slug}/app/manifest.webmanifest${dev ? `?v=${DEV_ICON_V}` : ""}"><link rel="apple-touch-icon" sizes="180x180" href="${iconName("/1helm-icon-touch-180.png", dev)}">`
  + `<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="1Helm"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="application-name" content="1Helm">`;

// ---- the service worker (Web Push only; src/notify.js sends) ----
export const SW_RE = /^\/w\/([a-z0-9-]+)\/sw\.js$/;
// swQuiet(windows, payload): whether a push stays quiet (the app chimes instead of a system notification). Only a real task
// event, and only when an app window that is visible AND focused shows that same task (#/<channel>/s/<session>). A test never;
// an app left open in a background tab, another task, or another app in front: always notifies. Self-contained: SW_JS embeds
// its source, and the unit tests call it directly.
// Which task a window shows: Chrome's WindowClient.url keeps the address the page loaded with (it doesn't follow #hash
// changes), so the worker asks each visible, focused window ({t:"where"} on a MessageChannel; the app answers {hash, focus}
// from notif.ts). No answer within 500 ms (an older app, a busy tab): that window counts as not showing the task, so it notifies.
export function swQuiet(wins, d) {
  if (!d || d.test) return false;
  const sidOf = (u) => { const m = String(u || "").match(/#\/[^/?#]+\/s\/([^/?#]+)/); return m ? m[1] : ""; };
  const sid = String(d.session || sidOf(d.url));
  if (!sid) return false;
  return (wins || []).some((w) => !!w && w.visibilityState === "visible" && w.focused === true && sidOf(w.url) === sid);
}
// Every push is recorded for Settings → Notifications → This device (Cache Storage "1helm-nf", key <scope>nf-last: when it
// arrived, whether it was shown or kept quiet, any error), posted to open app windows ({t:"pushed"}), and, for tests and
// errors, sent to /api/clientlog (dev only) so "nothing arrived" can be told apart from "it arrived but the OS hid it".
// A test always shows, under its own tag (a repeat is never merged into the last one). A tap opens the task: focuses an open
// app window and points it there, else opens a new one.
export const SW_JS = `const swQuiet = ${swQuiet.toString()};
const where = (w) => new Promise((z) => { let ch = null; const done = (v) => { clearTimeout(t); try { ch && ch.port1.close(); } catch {} z(v); }; const t = setTimeout(() => done(null), 500);
  try { ch = new MessageChannel(); ch.port1.onmessage = (e) => done(e.data || null); w.postMessage({ t: "where" }, [ch.port2]); } catch { done(null); } });
const NF_CACHE = "1helm-nf", NF_KEY = () => self.registration.scope + "nf-last";
const nfLog = (body) => fetch(self.registration.scope + "api/clientlog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sw: "push", ...body }) }).catch(() => {});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const rec = { at: Date.now(), kind: "", test: false, shown: false, quiet: false, listed: null, perm: "", err: "" };
    try { rec.perm = self.Notification ? Notification.permission : ""; } catch {}
    let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { rec.err = "unreadable payload: " + (x && x.message || x); try { d = { title: "1Helm", body: e.data ? e.data.text() : "" }; } catch { d = {}; } }
    rec.kind = String(d.kind || ""); rec.test = !!d.test;
    let wins = []; try { wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); } catch {}
    try {
      const views = d.test ? [] : await Promise.all(wins.map(async (w) => {
        if (w.visibilityState !== "visible" || w.focused !== true) return { visibilityState: w.visibilityState, focused: w.focused, url: "" };
        const r = await where(w);
        return { visibilityState: w.visibilityState, focused: !!r && r.focus !== false, url: r && typeof r.hash === "string" ? r.hash : "" };
      }));
      if (swQuiet(views, d)) { rec.quiet = true; for (const w of wins) w.postMessage({ t: "push", d }); }
      else {
        const tag = d.test ? "test-" + rec.at : (d.tag ? String(d.tag) : "");
        const opts = { body: d.body || "", icon: "/1helm-icon-192.png", badge: "/1helm-icon-64.png", data: { url: d.url || "" } };
        if (tag) { opts.tag = tag; opts.renotify = !d.test; }
        await self.registration.showNotification(d.title || "1Helm", opts);
        rec.shown = true;
        try { rec.listed = tag ? (await self.registration.getNotifications({ tag })).length > 0 : null; } catch {}
      }
    } catch (x) {
      rec.err = (rec.err ? rec.err + "; " : "") + "show failed: " + (x && x.message || x);
      try { await self.registration.showNotification(d.title || "1Helm", { body: d.body || "", data: { url: d.url || "" } }); rec.shown = true; } catch {}
    }
    try { const c = await caches.open(NF_CACHE); await c.put(NF_KEY(), new Response(JSON.stringify(rec), { headers: { "content-type": "application/json" } })); } catch {}
    for (const w of wins) { try { w.postMessage({ t: "pushed", rec }); } catch {} }
    if (rec.err || rec.test) await nfLog({ rec, wins: wins.map((w) => ({ v: w.visibilityState, f: w.focused })) });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope + "app";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (w) { await w.focus(); w.postMessage({ t: "open", url }); return; }
    await self.clients.openWindow(url);
  })());
});
`;
export const swResponse = () => new Response(SW_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
