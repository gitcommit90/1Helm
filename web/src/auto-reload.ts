// New build pick-up. The page loads app.js?v=<APP_V> (cached as immutable), so an open tab keeps old code after a deploy. Every
// /w/<slug>/api response carries x-app-v: <APP_V> (proto src/asset-version.js withAppV). When it differs from the build this page
// loaded with, the page reloads once, silently, at the first safe moment. No banner, no toast, no text. The hash route survives a reload.
// Loop guard: the build we reloaded for is kept in sessionStorage, so a page that still reports a different build after its reload
// (e.g. a deploy still rolling out) never reloads again for that build.
export type ReloadDeps = {
  loaded: string;                 // the build this page loaded with
  safe: () => boolean;            // nothing unsent or in progress, and the page is idle or hidden
  reload: () => void;
  get: () => string | null;       // the build already reloaded for (sessionStorage)
  set: (v: string) => void;
};

export function createReloader(d: ReloadDeps) {
  let pending = "";
  return {
    /** An API response reported this build (null when the header is missing). Returns true when a reload is now due. */
    seen(v: string | null | undefined): boolean {
      v = v ? String(v).trim() : "";
      if (!v || !d.loaded || v === d.loaded || v === d.get()) return !!pending;
      pending = v; return true;
    },
    due: () => pending,
    /** Reload when one is due and it is safe. Returns true when it reloaded. */
    tick(): boolean {
      if (!pending || pending === d.get() || !d.safe()) return false;
      d.set(pending); pending = ""; d.reload(); return true;
    },
  };
}

const FIELD = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]):not([type=hidden]), [contenteditable=""], [contenteditable="true"]';
const OPEN = '[aria-modal="true"], #setw.on, #nt.on, #appw.on, #fv, .pkpop, [data-unsaved]';

/** The page-level part of "safe": unsent text, a modal or sheet. Typing is covered by the idle wait (no key or tap for 5 s) in installAutoReload. App state (uploads, recording) comes from `busy`. */
export function pageSafe(doc: Document, busy: () => boolean): boolean {
  if (busy()) return false;
  for (const f of doc.querySelectorAll<HTMLInputElement>(FIELD)) if (!f.readOnly && !f.disabled && f.getAttribute("aria-hidden") !== "true" && (f.value ?? f.textContent ?? "").trim()) return false;
  if (doc.querySelector(OPEN)) return false;
  return true;
}

const IDLE_MS = 5000, POLL_MS = 3000;

/** Wire it to the page: read x-app-v from every API response, then check again on a timer, when the tab hides and when it regains focus. */
export function installAutoReload(o: { api: string; loaded: string; busy: () => boolean }) {
  if (!o.loaded) return;
  let last = Date.now(), timer: any = 0;
  const ss = { get: () => { try { return sessionStorage.getItem("1h-reload-v"); } catch { return null; } }, set: (v: string) => { try { sessionStorage.setItem("1h-reload-v", v); } catch {} } };
  const R = createReloader({ loaded: o.loaded, get: ss.get, set: ss.set, reload: () => location.reload(),
    safe: () => pageSafe(document, o.busy) && (document.hidden || Date.now() - last >= IDLE_MS) });
  const tick = () => { if (R.tick()) return; if (R.due() && !timer) timer = setInterval(() => { if (R.tick() || !R.due()) { clearInterval(timer); timer = 0; } }, POLL_MS); };
  for (const ev of ["keydown", "pointerdown", "input", "wheel"]) addEventListener(ev, () => { last = Date.now(); }, { capture: true, passive: true });
  const f = window.fetch.bind(window);
  // An installed app that comes back from the background (or from the back/forward cache, or after the network returns) has not made an
  // API call yet, so it cannot know a new build exists. Ask once, right away, through the patched fetch below, then act on the answer.
  let asked = 0;
  const resume = () => { tick(); if (document.hidden || Date.now() - asked < 2000) return; asked = Date.now(); window.fetch(o.api + "/permissions", { credentials: "same-origin", cache: "no-store" }).catch(() => {}); };
  document.addEventListener("visibilitychange", resume); addEventListener("focus", resume); addEventListener("pageshow", resume); addEventListener("online", resume);
  window.fetch = (async (input: any, init?: any) => {
    const r = await f(input, init);
    try { const u = typeof input === "string" ? input : input?.url || String(input); if (u.startsWith(o.api) && R.seen(r.headers.get("x-app-v"))) tick(); } catch {}
    return r;
  }) as typeof fetch;
}
