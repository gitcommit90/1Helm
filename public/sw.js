/* 1Helm shell service worker — offline shell only; never pin API/WS or stale JS. */
const CACHE = "1helm-shell-v5";
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-sailboat-192.png",
  "/icons/icon-sailboat-512.png",
  "/icons/icon-sailboat-512-maskable.png",
  "/brand/1helm-sailboat.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isApiOrRealtime(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws") || url.protocol === "ws:" || url.protocol === "wss:";
}

/** Stamped app bundles and CSS must always come from network — never long-lived Cache Storage. */
function isVersionedAsset(url) {
  return /\.(?:js|css)$/.test(url.pathname) || url.searchParams.has("v");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApiOrRealtime(url)) return;
  if (isVersionedAsset(url)) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())),
    );
    return;
  }

  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then(async (r) => r || await caches.match("/") || new Response("1Helm is offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const payload = event.data?.json?.() || {};
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((client) => client.visibilityState === "visible")) return;
    const channelSlug = String(payload.channelSlug || "");
    const rootMessageId = Number(payload.rootMessageId || 0);
    const url = channelSlug
      ? `/c/${encodeURIComponent(channelSlug)}/${rootMessageId ? `thread/${rootMessageId}` : "chat"}`
      : "/";
    await self.registration.showNotification(String(payload.title || "1Helm"), {
      body: String(payload.body || "New activity"),
      icon: "/icons/icon-sailboat-192.png",
      badge: "/icons/icon-sailboat-192.png",
      tag: `1helm-message-${Number(payload.messageId || 0) || Date.now()}`,
      renotify: false,
      silent: payload.sound === false,
      data: { url, channelId: Number(payload.channelId || 0), rootMessageId: rootMessageId || null },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(String(event.notification.data?.url || "/"), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      try {
        const navigated = await existing.navigate(target);
        if (navigated) return navigated.focus();
      } catch { /* fall through to a new target window */ }
      const opened = await self.clients.openWindow(target);
      return opened || existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
