// Dev-only diagnostic for the app page (app-detail.ts): what actually got drawn in the person's browser. One call site
// (openAppDetail) → two beacons to POST <api>/clientlog: ~0.4 s after opening and 2 s after. Layout facts only: no response
// bodies, no tokens, nothing personal beyond the workspace slug, the app opened and the browser's userAgent.
// The server logs it to the Worker tail (TEST_MODE only) and stores nothing. Removable: delete this file and its one call.
type Rep = Record<string, unknown>;
type Sess = { at: number; app: string; from: string; api: string; errors: Rep[]; done: boolean };
let cur: Sess | null = null, hooked = false;
const on = () => /^(dev\.|localhost$|127\.0\.0\.1$)/.test(location.hostname);
const cut = (s: unknown, n = 300) => String(s ?? "").slice(0, n);
const errOf = (e: any, kind: string): Rep => e instanceof Error || (e && typeof e === "object" && "message" in e)
  ? { kind, name: cut(e.name, 60), msg: cut(e.message), stack: String(e.stack || "").split("\n").slice(0, 6).map(l => cut(l.trim(), 200)) }
  : { kind, msg: cut(e) };
function note(r: Rep) { if (cur && !cur.done && cur.errors.length < 12) cur.errors.push({ ...r, t: Math.round(performance.now() - cur.at) }); }
function hook() {
  if (hooked) return; hooked = true;
  window.addEventListener("error", e => note(e.error ? errOf(e.error, "error") : { kind: "error", msg: cut(e.message), src: cut(e.filename, 160), line: e.lineno }), true);
  window.addEventListener("unhandledrejection", e => note(errOf(e.reason, "rejection")));
  // app-detail.ts catches its own drawing errors and console.error()s them ("app page: …"): those never reach window "error".
  const ce = console.error.bind(console);
  console.error = (...a: unknown[]) => { try { if (cur && !cur.done) note({ kind: "console", args: a.slice(0, 4).map(x => x instanceof Error ? errOf(x, "e") : cut(typeof x === "object" ? safeJson(x) : x, 200)) }); } catch {} ce(...a); };
}
const safeJson = (x: unknown) => { try { return JSON.stringify(x); } catch { return String(x); } };

function box(sel: string): Rep | null {
  const el = document.querySelector<HTMLElement>(sel); if (!el) return null;
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return { d: cs.display, v: cs.visibility, o: cs.opacity, h: cs.height, pos: cs.position, ov: cs.overflow, z: cs.zIndex, tf: cs.transform === "none" ? undefined : cut(cs.transform, 80),
    r: [r.left, r.top, r.width, r.height].map(Math.round), sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop || undefined, cls: cut(el.className, 80), kids: el.childElementCount };
}
const who = (el: Element | null) => el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}` : null;
const mq = (q: string) => matchMedia(q).matches;
const OVERLAYS = ["#appw", "#setw", "#smenuw", "#pkw", "#tdpw", "#tkm", "#tkfs", "#lw", ".dlgw", ".drawer", "#sheet", "#m"];

// Which stylesheets are in use, and do they know the app page's header (an old cached style.css wouldn't)?
function cssInfo(): Rep {
  const hrefs: string[] = []; let apdbk = false, apdtop = false;
  for (const sh of Array.from(document.styleSheets)) {
    if (sh.href) hrefs.push(cut(sh.href.replace(location.origin, ""), 80));
    try { for (const r of Array.from(sh.cssRules)) { const t = (r as CSSStyleRule).selectorText || ""; if (t.includes(".apdbk")) apdbk = true; if (t.includes(".apdtop")) apdtop = true; } } catch {}
  }
  return { hrefs: hrefs.slice(0, 6), apdbk, apdtop };
}
function report(s: Sess, phase: string): Rep {
  const w = document.getElementById("appdw"), top = w?.querySelector(".apdtop"), back = w?.querySelector<HTMLElement>(".apdtop .apdbk"), body = w?.querySelector(".apdbody");
  const res = performance.getEntriesByType("resource").filter(e => e.startTime >= s.at - 5 && /\/apps\/[a-z0-9_]+$/.test(e.name) && e.name.endsWith("/" + s.app)) as PerformanceResourceTiming[];
  const f = res[res.length - 1];
  const at = (el: Element | null | undefined) => { const r = el?.getBoundingClientRect(); if (!el || !r || !r.width) return null; const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h && el.contains(h) ? "self" : who(h); };
  const vv = window.visualViewport;
  return {
    k: "appdetail", phase, t: Math.round(performance.now() - s.at), ws: cut((window as any).__1HC?.slug, 64), app: s.app, from: s.from || "none",
    v: cut(document.querySelector<HTMLScriptElement>('script[src*="app.js"]')?.src.match(/[?&]v=([^&]+)/)?.[1], 20),
    stages: {
      shell: !!w?.querySelector(".apdpanel"), shown: !!w?.classList.contains("on"), header: !!top, back: !!back, headerText: cut((top as HTMLElement | null)?.innerText, 80),
      fetched: f ? { status: (f as any).responseStatus ?? null, ms: Math.round(f.duration), size: f.transferSize, n: res.length } : null,
      body: !body ? "missing" : body.querySelector(".apderr") ? "error" : body.querySelector(".apdgrid .apdsk") ? "loading" : body.querySelector(".apdgrid") ? "full" : body.querySelector(".apdhero") ? "hero-only" : body.childElementCount ? "other" : "empty",
      bodyLen: body?.innerHTML.length ?? null, errText: cut((body?.querySelector(".apderr") as HTMLElement | null)?.innerText, 160) || undefined,
    },
    errors: s.errors,
    vp: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vv: vv ? [vv.width, vv.height, vv.scale, vv.offsetTop].map(n => Math.round(n * 100) / 100) : null, sy: scrollY, de: [document.documentElement.clientWidth, document.documentElement.clientHeight] },
    mq: { phone767: mq("(max-width:767px)"), w860: mq("(max-width:860px)"), w1024: mq("(max-width:1024px)"), dark: mq("(prefers-color-scheme:dark)"), reduce: mq("(prefers-reduced-motion:reduce)"), coarse: mq("(pointer:coarse)"), hover: mq("(hover:hover)"), standalone: mq("(display-mode:standalone)") },
    theme: document.documentElement.dataset.theme || null,
    el: { root: box("#appdw"), backdrop: box("#appdw .apdback"), panel: box("#appdw .apdpanel"), header: box("#appdw .apdtop"), btn: box("#appdw .apdtop .apdbk"), body: box("#appdw .apdbody"), hero: box("#appdw .apdhero"), grid: box("#appdw .apdgrid") },
    panelStyle: cut(w?.querySelector<HTMLElement>(".apdpanel")?.style.cssText, 200),
    hit: { btn: at(back), header: at(top), panel: at(w?.querySelector(".apdpanel")) },   // what's on top at the Back button's centre and the panel's centre
    overlays: OVERLAYS.flatMap(sel => Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(e => e.classList.contains("on") || e.classList.contains("open") || (e.childElementCount && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0)).map(who)).slice(0, 12),
    css: cssInfo(),
    fonts: (document as any).fonts?.status ?? null, vis: document.visibilityState,
    ua: cut(navigator.userAgent, 200),
  };
}
function send(s: Sess, phase: string) {
  let body = "";
  try {
    const r = report(s, phase); body = JSON.stringify(r);
    if (body.length > 7800) { r.errors = s.errors.slice(0, 3); body = JSON.stringify(r); }
    if (body.length > 7800) { delete r.el; body = JSON.stringify(r); }
  } catch (e: any) { body = JSON.stringify({ k: "appdetail", phase, app: s.app, reportFailed: cut(e?.message) }); }
  try { fetch(`${s.api}/clientlog`, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => {}); } catch {}
}

// Called once per open, at the start of openAppDetail (so anything that throws after this is caught by the listeners above).
export function appPageDiag(app: string, from: string, api: string | null) {
  try {
    if (!api || !on()) return;
    hook();
    if (cur) cur.done = true;
    const s: Sess = cur = { at: performance.now(), app, from, api, errors: [], done: false };
    setTimeout(() => send(s, "open"), 400);
    setTimeout(() => { send(s, "late"); s.done = true; if (cur === s) cur = null; }, 2000);
  } catch {}
}

// Deploy-safe Phase 0: a reply stream that broke before its end ("stream_lost") and what the app did next ("resumed" = it found the
// turn again and kept streaming; "resuming" = the helper was restarting and picking up where it left off; "ended" = the turn had
// finished or stopped; "gave_up" = no answer for ~90 s). Dev only, one small line each, so dev can count losses vs recoveries.
export function streamNote(api: string | null | undefined, r: Rep) {
  try {
    if (!api || !on()) return;
    const body = JSON.stringify({ k: "stream", ...r, ws: cut((window as any).__1HC?.slug, 64), t: Date.now(), vis: document.visibilityState });
    fetch(`${api}/clientlog`, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => {});
  } catch {}
}
