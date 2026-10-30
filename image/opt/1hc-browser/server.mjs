// 1Helm Cloud channel computer: the real browser.
// One HTTP server on :6080 (reachable only from this channel's controller via getTcpPort; containers have no public ingress).
//   /vnc?mode=view|control  WebSocket → x11vnc (view = a view-only VNC server, control = a full one). The controller decides who may use "control".
//   /novnc/*                noVNC client files for the live pane.
//   POST /cdp/<op>          navigate | snapshot | act | back | tabs | screenshot | status | record — what the resident's browser tools call.
// Chrome, Xvfb and x11vnc start only on the first request (lazy), and Chrome's profile lives in /workspace/.browser so logins persist.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { controllerRequest } from "./request-guard.mjs";
const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require("/opt/1hc-browser/node_modules/ws");

const PORT = 6080, DISPLAY = ":99", W = 1280, H = 800, CDP_PORT = 9222;
const LAST_URL = "/workspace/.browser/last_url";
const PROFILE = "/workspace/.browser/profile", HOME = "/tmp/1hc-browser-home";
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const NOVNC = "/opt/1hc-browser/novnc";
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const log = (...a) => console.log(`[1hc-browser ${new Date().toISOString().slice(11, 23)}]`, ...a);
const procs = {};
let starting = null;

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { try { if (await fn()) return; } catch {} if (Date.now() - t0 > ms) throw new Error(`${what} did not start in ${ms} ms`); await sleep(100); }
}
const portOpen = (p) => new Promise((z) => { const s = net.connect(p, "127.0.0.1"); s.once("connect", () => { s.destroy(); z(true); }); s.once("error", () => z(false)); });
function run(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, DISPLAY, HOME, ...env }, stdio: ["ignore", "ignore", "pipe"] });
  let tail = ""; p.stderr.on("data", (d) => { tail = (tail + d).slice(-2000); });
  p.on("exit", (code) => { log(`${name} exited ${code}`); if (procs[name] === p) delete procs[name]; p.tail = tail; });
  procs[name] = p; return p;
}
async function ensureStack() {
  if (procs.xvfb && procs.chrome && procs.vncView && procs.vncCtl && await portOpen(CDP_PORT)) return { cold: false };
  if (!starting) starting = startStack().finally(() => { starting = null; });
  return await starting;
}
async function startStack() {
  const t0 = Date.now();
  fs.mkdirSync(HOME, { recursive: true }); fs.mkdirSync(PROFILE, { recursive: true });
  if (!procs.xvfb) {
    try { fs.rmSync("/tmp/.X99-lock", { force: true }); } catch {}
    run("xvfb", "Xvfb", [DISPLAY, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp", "-ac"]);
    await waitFor(() => fs.existsSync("/tmp/.X11-unix/X99"), 10e3, "display");
  }
  if (!procs.chrome || !(await portOpen(CDP_PORT))) {
    // Sentinel mode terminates HTTPS with a per-container CA; Chrome reads trust from its own NSS store, not the system bundle.
    if (fs.existsSync(CA)) {
      try { fs.mkdirSync(`${HOME}/.pki/nssdb`, { recursive: true });
        try { execFileSync("certutil", ["-N", "-d", `sql:${HOME}/.pki/nssdb`, "--empty-password"], { stdio: "ignore" }); } catch {}
        execFileSync("certutil", ["-A", "-d", `sql:${HOME}/.pki/nssdb`, "-t", "C,,", "-n", "1helm-sentinel", "-i", CA], { stdio: "ignore" }); } catch (e) { log("CA import failed", e.message); }
    }
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) try { fs.rmSync(path.join(PROFILE, f), { force: true }); } catch {}
    // The computer stops Chrome by killing it on sleep; mark the last exit clean so there's no "Restore pages?" bubble.
    try { const pf = path.join(PROFILE, "Default", "Preferences"); if (fs.existsSync(pf)) { const j = JSON.parse(fs.readFileSync(pf, "utf8")); j.profile = { ...(j.profile || {}), exit_type: "Normal", exited_cleanly: true }; fs.writeFileSync(pf, JSON.stringify(j)); } } catch {}
    run("chrome", "/opt/chrome/chrome", ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu",
      "--password-store=basic", "--test-type", "--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--noerrdialogs", "--disable-features=Translate,MediaRouter,OptimizationHints", "--disable-background-networking",
      `--user-data-dir=${PROFILE}`, "--disk-cache-dir=/tmp/1hc-chrome-cache", `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
      `--window-size=${W},${H}`, "--window-position=0,0", "--start-maximized", "--lang=en-US", "about:blank"]);
    await waitFor(() => portOpen(CDP_PORT), 20e3, "Chrome");
    // A killed Chrome restores its old tabs on the next start, and each sleep/wake adds more. The tab Chrome starts with
    // (restored or the initial about:blank) can ignore all mouse input after a wake (2026-10-01: CDP and X11 clicks both
    // never reached the page, while a new tab worked at once). So always open a fresh tab, check a test click reaches it,
    // close every other tab, and only then reopen the last page in it.
    await sleep(800);
    try {
      let fresh = null;
      for (let i = 0; i < 3 && !fresh; i++) {
        const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
        const c0 = new CDP(t.webSocketDebuggerUrl); await c0.open(); await c0.send("Runtime.enable");
        const ok = await mouseReaches(c0).catch(() => false); c0.close();
        if (ok) fresh = t; else { log(`fresh tab ${i + 1} ignored a test click; trying another`); await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`).catch(() => {}); }
      }
      const ts = await targets(); const keep = fresh ? ts.find((t) => t.id === fresh.id) || ts[0] : ts[0];
      for (const t of ts) if (t.id !== keep?.id) await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`).catch(() => {});
      resetTabs(keep?.id || null); if (keep) await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${keep.id}`).catch(() => {});
      if (!fresh) log("no tab accepted a test click after start");
    } catch (e) { log("tab reset failed", e.message); }
    // Then reopen the page that was open when the computer went to sleep, in that one tab, and wait for it to load.
    try { const last = fs.readFileSync(LAST_URL, "utf8").trim();
      if (/^https?:\/\//.test(last)) { const ts1 = await targets(); const t1 = ts1.find((t) => t.id === tabs.get("")?.current) || ts1[0];
        if (t1 && !/^https?:/.test(t1.url)) { const c0 = new CDP(t1.webSocketDebuggerUrl); await c0.open(); await c0.send("Page.enable");
          const loaded = c0.once("Page.loadEventFired", 15e3); await c0.send("Page.navigate", { url: last }).catch(() => {}); await loaded; c0.close(); log(`reopened ${last}`); } } } catch (e) { log("reopen failed", e.message); }
  }
  // Two VNC servers on the same screen: one that ignores all input (what the person sees by default), one that accepts it (only after "Take control").
  if (!procs.vncView) run("vncView", "x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", "5900", "-nopw", "-shared", "-forever", "-viewonly", "-quiet", "-noxdamage", "-cursor", "arrow"]);
  if (!procs.vncCtl) run("vncCtl", "x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", "5901", "-nopw", "-shared", "-forever", "-quiet", "-noxdamage", "-cursor", "arrow"]);
  await waitFor(async () => (await portOpen(5900)) && (await portOpen(5901)), 10e3, "VNC");
  await browserConn().catch((e) => log("browser connection failed", e.message));
  log(`stack up in ${Date.now() - t0} ms`);
  return { cold: true, start_ms: Date.now() - t0 };
}

// ---- minimal CDP client ----
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.wait = new Map(); this.ev = []; }
  open() { return new Promise((ok, bad) => { this.ws = new WebSocket(this.url, { perMessageDeflate: false });
    this.ws.once("open", ok); this.ws.once("error", bad);
    this.ws.on("message", (m) => { const d = JSON.parse(m); if (d.id && this.wait.has(d.id)) { const [z, r] = this.wait.get(d.id); this.wait.delete(d.id); d.error ? r(new Error(d.error.message)) : z(d.result); } else if (d.method) for (const l of this.ev) l(d); });
    this.ws.on("close", () => { for (const [, [, r]] of this.wait) r(new Error("browser connection closed")); this.wait.clear(); }); }); }
  send(method, params = {}, ms = 30e3, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((z, r) => { const t = setTimeout(() => { this.wait.delete(id); r(new Error(`${method} timed out`)); }, ms); this.wait.set(id, [(v) => { clearTimeout(t); z(v); }, (e) => { clearTimeout(t); r(e); }]); }); }
  once(method, ms) { return new Promise((z) => { const t = setTimeout(() => { this.ev = this.ev.filter((x) => x !== l); z(null); }, ms); const l = (d) => { if (d.method === method) { clearTimeout(t); this.ev = this.ev.filter((x) => x !== l); z(d.params); } }; this.ev.push(l); }); }
  close() { try { this.ws.close(); } catch {} }
}
// Does a real mouse press reach this tab's page? (Used once per Chrome start; the click lands on a blank page.)
async function mouseReaches(c) {
  await evalJS(c, "window.__1hcm = 0; document.addEventListener('mousedown', () => window.__1hcm++, true); 1");
  for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: 4, y: 4, button: "left", clickCount: 1 }, 5e3);
  for (let i = 0; i < 10; i++) { if ((await evalJS(c, "window.__1hcm")) > 0) return true; await sleep(50); }
  return false;
}
async function targets() { return (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter((t) => t.type === "page"); }
// Switch (2026-10-01): "_wait":"quiet" on a request = wait until the page goes quiet (no DOM changes and no requests in
// flight for QUIET ms, capped) instead of fixed sleeps, and keep one CDP connection open between requests. Same for every page.
let FAST = false; const QUIET = 300;
async function quiet(c, cap = 8e3) {
  const t0 = Date.now(); let last = Date.now(), lastMut = -1;
  while (Date.now() - t0 < cap) {
    let st; try { st = await evalJS(c, `(() => { if (!window.__1hcq) { window.__1hcq = { n: 0 }; try { new MutationObserver(() => window.__1hcq.n++).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {} } return { m: window.__1hcq.n, r: document.readyState }; })()`); } catch { st = null; }
    const busy = !st || st.r !== "complete" || (c.inflight || 0) > 0;
    if (!st || st.m !== lastMut || busy) { last = Date.now(); if (st) lastMut = st.m; }
    if (Date.now() - last >= QUIET) return Date.now() - t0;
    await sleep(60);
  }
  return Date.now() - t0;
}
// ---- One tab per task (2026-10-30) ----
// A request may carry "_tab": the calling task's key. Each key has its own tab (plus any tab that tab opens), created on its first
// request, and an op acts only on it. The profile (logins, cookies) is shared. A request with no "_tab" (the person's live pane, or an
// older Worker) acts on the tab that was last brought to the front, as before. The keys, ids and URLs here never leave this computer
// except the one tab's own page and URL in an op's answer.
const TAB_RE = /^[A-Za-z0-9_-]{1,64}$/;
const tabKey = (b) => (TAB_RE.test(String(b?._tab ?? "")) ? String(b._tab) : "");
const TABS_FILE = "/workspace/.browser/tabs.json";
const TAB_IDLE_MS = Number(process.env.TAB_IDLE_MS) || 20 * 60e3;   // a task's tabs close after this long with no browser call from it
const TAB_PIN_MS = 2 * 3600e3;                                       // a tab shown to the person (handoff) is kept this long
const TAB_MAX = 10;                                                  // most task tabs at once; the least recently used one closes to make room
const tabs = new Map();    // key -> { key, targets: Set<targetId>, current, last, url }
const owned = new Map();   // targetId -> key
const conns = new Map();   // targetId -> CDP (quiet mode keeps one connection per tab)
const chains = new Map();  // key -> promise: calls on one tab run one after the other
let front = null, pin = null, bconn = null;   // front: key last brought to the front. pin: { key, at } while a handoff shows that tab.
const mkTab = (key, id) => { const rec = { key, targets: new Set([id]), current: id, last: Date.now(), url: "" }; tabs.set(key, rec); owned.set(id, key); return rec; };
function dropTarget(id) {
  const key = owned.get(id); owned.delete(id);
  const c = conns.get(id); if (c) { clearInterval(c.reset); try { c.close(); } catch {} conns.delete(id); }
  const rec = key !== undefined ? tabs.get(key) : null;
  if (rec) { rec.targets.delete(id); if (rec.current === id) rec.current = [...rec.targets].at(-1) || null; }
}
function resetTabs(spareId) {   // Chrome just started: nothing from before exists any more
  for (const c of conns.values()) { clearInterval(c.reset); try { c.close(); } catch {} }
  tabs.clear(); owned.clear(); conns.clear(); pin = null; front = null;
  if (spareId) { mkTab("", spareId); front = ""; }
}
// A page that opens a new tab or window (target=_blank, window.open) makes that tab part of the same task: found by its opener, never by "newest tab".
function onBrowserEvent(d) {
  const i = d.params?.targetInfo;
  if (d.method === "Target.targetCreated" && i?.type === "page") {
    const key = i.openerId ? owned.get(i.openerId) : undefined;
    if (key !== undefined && !owned.has(i.targetId)) { const rec = tabs.get(key); if (rec) { rec.targets.add(i.targetId); rec.current = i.targetId; owned.set(i.targetId, key); } }
  } else if (d.method === "Target.targetDestroyed") dropTarget(d.params.targetId);
}
async function browserConn() {
  if (bconn && bconn.ws.readyState === 1) return bconn;
  const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const c = new CDP(v.webSocketDebuggerUrl); await c.open();
  c.ev.push(onBrowserEvent); c.ws.on("close", () => { if (bconn === c) bconn = null; });
  await c.send("Target.setDiscoverTargets", { discover: true });
  bconn = c; return c;
}
function serial(key, fn) {
  const run = (chains.get(key) || Promise.resolve()).then(fn);
  const tail = run.catch(() => {}); chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}
const readSaved = () => { try { return JSON.parse(fs.readFileSync(TABS_FILE, "utf8")) || {}; } catch { return {}; } };
function saveTabs(forget) {   // the last page of each task's tab, so a tab lost to a restart can be reopened where it was
  try {
    const now = Date.now(), out = {};
    for (const [k, v] of Object.entries(readSaved())) if (k !== forget && now - v.at < 24 * 3600e3) out[k] = v;
    for (const rec of tabs.values()) if (rec.key && rec.url) out[rec.key] = { url: rec.url, at: rec.last };
    const keep = Object.entries(out).sort((a, b) => b[1].at - a[1].at).slice(0, 60);
    fs.writeFileSync(TABS_FILE, JSON.stringify(Object.fromEntries(keep)));
  } catch {}
}
async function newTarget() { return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json(); }
async function closeTab(key, keepSaved) {   // closes this task's tabs only; Chrome keeps at least one page so it never exits
  const rec = tabs.get(key); if (!rec) return 0;
  const ids = [...rec.targets];
  if ((await targets()).filter((t) => !rec.targets.has(t.id)).length === 0) { const t = await newTarget(); mkTab("", t.id); }
  for (const id of ids) { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${id}`).catch(() => {}); dropTarget(id); }
  tabs.delete(key); if (front === key) front = tabs.has("") ? "" : null; if (pin?.key === key) pin = null;
  if (!keepSaved) saveTabs(key);
  return ids.length;
}
async function activateTab(rec) {
  if (pin && pin.key !== rec.key && Date.now() - pin.at < TAB_PIN_MS) return;   // a handoff keeps its tab in front for the person
  front = rec.key;
  if (rec.current) await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${rec.current}`).catch(() => {});
}
async function connectTarget(t) {
  let c = FAST ? conns.get(t.id) : null;
  if (c && c.ws.readyState === 1) return c;
  if (c) { clearInterval(c.reset); conns.delete(t.id); }
  c = new CDP(t.webSocketDebuggerUrl); await c.open(); c.targetId = t.id;
  await c.send("Page.enable"); await c.send("Runtime.enable");
  if (FAST) { const pend = new Set(); c.inflight = 0; await c.send("Network.enable");
    c.ev.push((d) => { if (d.method === "Network.requestWillBeSent" && !/^(EventSource|WebSocket)$/.test(d.params.type || "")) pend.add(d.params.requestId);
      else if (d.method === "Network.loadingFinished" || d.method === "Network.loadingFailed") pend.delete(d.params.requestId); c.inflight = pend.size; });
    c.reset = setInterval(() => { pend.clear(); c.inflight = 0; }, 15e3); c.reset.unref();   // a stuck long-poll never blocks quiet forever
    c.persistent = true; conns.set(t.id, c); c.ws.on("close", () => { clearInterval(c.reset); if (conns.get(t.id) === c) conns.delete(t.id); }); }
  return c;
}
// The tab for this key and a connection to its current page. A task with no tab yet gets a new one; a task whose tab is gone (idle
// close, Chrome restart) gets a new one that reopens its last page, with a note for the model.
async function openTab(key, ctx) {
  let ts = await targets(), rec = tabs.get(key), note = null;
  if (rec) for (const id of [...rec.targets]) if (!ts.some((t) => t.id === id)) dropTarget(id);
  if (pin?.key === key && ctx.op !== "activate") pin = null;   // the task is using its tab again
  if (!rec || !rec.current) {
    if (key && tabs.size >= TAB_MAX) {
      const old = [...tabs.values()].filter((r) => r.key && r.key !== pin?.key && !chains.has(r.key)).sort((a, b) => a.last - b.last)[0];
      if (old) await closeTab(old.key, true);
    }
    const t = await newTarget(); rec = tabs.get(key) || mkTab(key, t.id);
    if (rec.current !== t.id) { rec.targets.add(t.id); rec.current = t.id; owned.set(t.id, key); }
    ts = [...ts, t];
    const prev = key ? readSaved()[key] : null;
    if (prev && /^https?:\/\//.test(prev.url)) {
      try { const c0 = await connectTarget(t); const loaded = c0.once("Page.loadEventFired", 15e3); await c0.send("Page.navigate", { url: prev.url }).catch(() => {}); await loaded; if (!c0.persistent) c0.close(); } catch {}
      note = `The browser tab for this task was closed (it sat idle, or the computer restarted), so a new tab opened and loaded the last page again: ${prev.url}. Anything typed on that page, and its scroll position, is gone. Take a browser_snapshot before acting.`;
    }
  }
  const t = ts.find((x) => x.id === rec.current) || (await targets()).find((x) => x.id === rec.current);
  if (!t) throw new Error("the browser tab closed while it was being opened; try again");
  const c = await connectTarget(t); if (!c.persistent) ctx.opened.push(c);
  rec.last = Date.now(); await activateTab(rec);
  return { rec, c, note };
}
setInterval(() => {
  const now = Date.now(); if (pin && now - pin.at > TAB_PIN_MS) pin = null;
  for (const rec of [...tabs.values()]) if (rec.key && !chains.has(rec.key) && now - rec.last > (pin?.key === rec.key ? TAB_PIN_MS : TAB_IDLE_MS)) closeTab(rec.key, true).catch(() => {});
}, 60e3).unref();
// where: nothing (the tab's page), a CDP session id, or a frame from frames(): { session } for a frame in its own process,
// { ctx } for a cross-origin frame that shares the page's process (its own execution context, reached through the page's session).
async function evalJS(c, expr, where) { const w = typeof where === "string" ? { session: where } : (where || {}); const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, ...(w.ctx ? { contextId: w.ctx } : {}) }, 30e3, w.session); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function settle(c, ms = 10e3) {
  if (FAST) { await quiet(c, ms); return; }
  await sleep(400);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await evalJS(c, "document.readyState")) === "complete") break; } catch {} await sleep(250); }
  await sleep(300);
}

// Page → readable outline for a text-only model. Interactive elements get refs like [e7] that browser_act uses.
const SNAPSHOT_JS = String.raw`(() => {
  const MAX = 14000; let n = 0, out = [], len = 0;
  document.querySelectorAll('[data-1hc]').forEach((e) => e.removeAttribute('data-1hc'));
  const INTER = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=switch],[role=textbox],[contenteditable=""],[contenteditable=true]';
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const tagOf = (el) => el.tagName.toLowerCase(), IN_FRAME = window.top !== window;
  const clean = (s, m = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, m);
  const label = (el) => { const id = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    return clean(el.getAttribute('aria-label') || (id && id.innerText) || el.closest('label')?.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.innerText || (tagOf(el) === 'input' && /^(button|submit|reset)$/.test(el.type) ? el.value : '') || el.getAttribute('name') || ''); };
  const push = (s) => { if (len > MAX) return; out.push(s); len += s.length + 1; };
  const walk = (node, depth) => {
    if (len > MAX) return;
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'svg', 'template', 'head'].includes(tag)) continue;
      const lab = (tag === 'input' && ['checkbox', 'radio'].includes(el.type)) ? (el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'))) : null;
      if (!vis(el) && !(lab && vis(lab)) && !['details'].includes(tag)) { if (el.children.length) walk(el, depth); continue; }
      if (el.matches(INTER)) {
        const ref = 'e' + (++n); el.setAttribute('data-1hc', ref);
        const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (el.type || 'text') + ' input' : tag);
        let extra = '';
        if (tag === 'input' && ['checkbox', 'radio'].includes(el.type)) extra = el.checked ? ' (checked)' : ' (unchecked)';
        else if (tag === 'input' || tag === 'textarea') { const ac = [el.getAttribute('autocomplete'), el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' '); const hide = IN_FRAME || el.type === 'password' || /cc-|card|cvc|cvv|cvn|csc|exp|\bpan\b/i.test(ac) || /^\d[\d\s.-]{11,}$/.test(el.value || '');
          extra = el.value ? ' value="' + (hide ? '•••• (filled)' : clean(el.value, 60)) + '"' : ''; }
        else if (tag === 'select') extra = ' selected="' + clean(el.options[el.selectedIndex]?.text, 60) + '" options: ' + [...el.options].slice(0, 12).map((o) => clean(o.text, 30)).join(' | ');
        if (el.disabled) extra += ' (disabled)';
        { const acv = (tag === 'input' || tag === 'textarea') && el.getAttribute('autocomplete'); if (acv && /^cc-|postal-code|^name$/.test(acv)) extra += ' autocomplete=' + acv.slice(0, 20); }
        push('[' + ref + '] ' + role + ' "' + label(el) + '"' + extra + (tag === 'a' ? ' → ' + clean(el.getAttribute('href'), 80) : ''));
        if (tag === 'select' || tag === 'a' || tag === 'button') continue;
      } else if (/^h[1-6]$/.test(tag)) { push('#'.repeat(+tag[1]) + ' ' + clean(el.innerText, 160)); continue; }
      else if (tag === 'iframe') { push('[iframe ' + clean(el.getAttribute('title') || el.src, 80) + ' — its contents are not readable here; use the live view]'); continue; }
      let text = ''; for (const c of el.childNodes) if (c.nodeType === 3) text += c.textContent;
      text = clean(text, 300); if (text.length > 1) push(text);
      walk(el, depth + 1);
    }
  };
  walk(document.body || document.documentElement, 0);
  return { url: location.href, title: document.title, refs: n, truncated: len > MAX, text: out.join('\n') };
})()`;
// Cross-origin iframes (Stripe Checkout, card forms, embedded widgets) are separate targets. Attach to them so their
// fields get refs like f2e5. Frame numbers stay stable per frame id for the life of the browser.
const frameNo = new Map(); let nextFrame = 1;
// Chrome reports each attached frame once per connection, so the connection keeps the live set (new frames arrive
// as events; detached ones are dropped).
async function frames(c) {
  if (!c.frames) {
    c.frames = new Map();
    c.ev.push((d) => {
      if (d.method === "Target.attachedToTarget" && d.params.targetInfo.type === "iframe") c.frames.set(d.params.targetInfo.targetId, { session: d.params.sessionId, id: d.params.targetInfo.targetId, url: d.params.targetInfo.url });
      else if (d.method === "Target.detachedFromTarget") for (const [k, f] of c.frames) if (f.session === d.params.sessionId) c.frames.delete(k);
    });
    await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  }
  if (!FAST) await sleep(250);   // let frames created by the last action report in
  const out = [...c.frames.values()];
  // A cross-origin frame on the same site as the page (e.g. secure.shop.com inside www.shop.com) runs in the page's own process, so it is not a
  // target of its own. Reach it through an execution context made for that frame.
  try {
    const walk = async (t) => { for (const ch of t.childFrames || []) { const fr = ch.frame;
      if (!c.frames.has(fr.id)) {
        c.worlds ||= new Map(); let w = c.worlds.get(fr.id);
        if (!w || w.loader !== fr.loaderId) { const r = await c.send("Page.createIsolatedWorld", { frameId: fr.id, worldName: "1hc", grantUniveralAccess: true }).catch(() => null); w = r && { ctx: r.executionContextId, loader: fr.loaderId }; if (w) c.worlds.set(fr.id, w); }
        if (w) out.push({ id: fr.id, ctx: w.ctx, url: fr.url });
      }
      await walk(ch); } };
    await walk((await c.send("Page.getFrameTree")).frameTree);
  } catch {}
  for (const f of out) { if (!frameNo.has(f.id)) frameNo.set(f.id, nextFrame++); f.n = frameNo.get(f.id); }
  return out;
}
const FRAME_JS = (n) => SNAPSHOT_JS.replace("const ref = 'e' + (++n)", `const ref = 'f${n}e' + (++n)`);
async function snapshot(c) {
  const s = await evalJS(c, SNAPSHOT_JS);
  let text = s.text, extra = "";
  for (const f of await frames(c).catch(() => [])) {
    try {
      const r = await evalJS(c, FRAME_JS(f.n), f);
      if (!r || !r.refs) continue;   // invisible or non-interactive frames (analytics, captcha shells) are left out
      extra += `\n--- inside frame f${f.n} (${(() => { try { return new URL(f.url).host; } catch { return ""; } })()}) ---\n${r.text}`;
    } catch {}
  }
  if (extra) text = text.replace(/\[iframe ([^\]]*?) — its contents are not readable here; use the live view\]/g, "[iframe $1 — its fields are listed below]") + extra;
  if (text.length > 22000) text = text.slice(0, 22000) + "\n[page outline truncated — scroll or act to see more]";
  return { url: s.url, title: s.title, snapshot: text + (s.truncated ? "\n[page outline truncated — scroll or act to see more]" : "") };
}
const BOX_JS = (ref) => `(() => { let e = document.querySelector('[data-1hc="${String(ref).replace(/[^a-z0-9]/gi, "")}"]'); if (!e) return null; const r0 = e.getBoundingClientRect(); if ((r0.width < 2 || r0.height < 2 || getComputedStyle(e).opacity === '0') && e.type && /checkbox|radio/.test(e.type)) e = e.closest('label') || document.querySelector('label[for="' + CSS.escape(e.id) + '"]') || e; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, tag: e.tagName.toLowerCase() }; })()`;
async function frameOf(c, ref) {
  const m = String(ref).match(/^f(\d+)e\d+$/); if (!m) return null;
  const id = [...frameNo].find(([, n]) => n === Number(m[1]))?.[0];
  const f = id && (await frames(c)).find((x) => x.id === id);
  if (!f) throw new Error(`frame f${m[1]} is gone — take a new snapshot`);
  return f;
}
async function box(c, ref) {
  const f = await frameOf(c, ref);
  if (!f) { const r = await evalJS(c, BOX_JS(ref)); if (!r) throw new Error(`no element ${ref} on the page now — take a new snapshot`); return r; }
  // Bring the iframe into view in the page, then the element inside it; page point = iframe content origin + element point.
  await c.send("DOM.enable").catch(() => {});
  const owner = await c.send("DOM.getFrameOwner", { frameId: f.id });
  await c.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: owner.backendNodeId }).catch(() => {});
  const r = await evalJS(c, BOX_JS(ref), f); if (!r) throw new Error(`no element ${ref} in frame now — take a new snapshot`);
  // Content quads are viewport coordinates. A tall iframe (Stripe Checkout is taller than the screen) can leave the
  // field off-screen even after scrolling inside the frame, so scroll the page until the point is visible.
  const at = async () => { const q = (await c.send("DOM.getContentQuads", { backendNodeId: owner.backendNodeId })).quads[0]; return { x: q[0] + r.x, y: q[1] + r.y }; };
  let p = await at();
  const vh = (await c.send("Page.getLayoutMetrics")).cssVisualViewport.clientHeight;
  if (p.y < 20 || p.y > vh - 20) { await evalJS(c, `window.scrollBy(0, ${Math.round(p.y - vh / 2)})`); await sleep(150); p = await at(); }
  return { ...r, ...p, session: f.session, fr: f };
}
async function click(c, x, y) {
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function clickRef(c, ref) {
  const p = await box(c, ref);
  // Off-screen controls (e.g. Stripe's hidden "AI agent" steering checkbox) can't take a mouse click; click them in the page.
  if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) await evalJS(c, `(() => { const e = document.querySelector('[data-1hc="${String(ref).replace(/[^a-z0-9]/gi, "")}"]'); e && e.click(); })()`, p.fr);
  else await click(c, p.x, p.y);
}
// upload {ref, path | paths}: put files from the computer into a page. The ref is a file input (set directly), or a button or link that opens
// the browser's file chooser (the chooser is intercepted and answered with the files, so sites that hide the real input work too).
const WAIT_MAX = 10e3, UPLOAD_MAX = 10;
async function upload(c, a) {
  const raw = a.paths ?? a.path, list = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!list.length) throw new Error("upload needs path: the file's path on the computer (relative to /workspace or absolute)");
  if (list.length > UPLOAD_MAX) throw new Error(`upload takes at most ${UPLOAD_MAX} files at once`);
  const files = list.map((x) => {
    const f = path.resolve("/workspace", x); let st; try { st = fs.statSync(f); } catch { throw new Error(`upload: no file at ${x} on the computer`); }
    if (!st.isFile()) throw new Error(`upload: ${x} is a folder, not a file`);
    if (f === "/workspace/.browser" || f.startsWith("/workspace/.browser/")) throw new Error("upload: the browser's own profile folder can't be uploaded");
    return f;
  });
  const fr = await frameOf(c, a.ref), session = fr?.session, sel = `document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]')`;
  const info = await evalJS(c, `(() => { const e = ${sel}; return e ? { file: e.tagName === 'INPUT' && e.type === 'file', multiple: !!e.multiple } : null; })()`, fr);
  if (!info) throw new Error(`no element ${a.ref} on the page now — take a new snapshot`);
  const word = files.length === 1 ? "1 file" : `${files.length} files`;
  if (info.file) {
    if (files.length > 1 && !info.multiple) throw new Error(`${a.ref} takes one file; ${files.length} were given`);
    const o = await c.send("Runtime.evaluate", { expression: sel, returnByValue: false, ...(fr?.ctx ? { contextId: fr.ctx } : {}) }, 30e3, session);
    if (!o.result?.objectId) throw new Error(`no element ${a.ref} on the page now — take a new snapshot`);
    await c.send("DOM.enable").catch(() => {});
    await c.send("DOM.setFileInputFiles", { files, objectId: o.result.objectId }, 30e3, session);
    return `attached ${word} to the file input ${a.ref}`;
  }
  await c.send("Page.setInterceptFileChooserDialog", { enabled: true });
  try {
    const opened = c.once("Page.fileChooserOpened", 5e3);
    await clickRef(c, a.ref);
    const ev = await opened;
    if (!ev) throw new Error(`${a.ref} is not an upload control: clicking it did not open a file chooser. Pick the button or link that adds a file, or a file input`);
    if (files.length > 1 && ev.mode !== "selectMultiple") throw new Error(`the file chooser from ${a.ref} takes one file; ${files.length} were given`);
    await c.send("DOM.enable").catch(() => {});
    await c.send("DOM.setFileInputFiles", { files, backendNodeId: ev.backendNodeId });
    return `attached ${word} through the file chooser that ${a.ref} opened`;
  } finally { await c.send("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {}); }
}
// ---- Typing into one field, including card fields that live in cross-origin iframes.
// The field is named by a ref from the outline. It can be on the page, in a frame (refs like f2e5), or a placeholder input that the page swaps for a
// hosted iframe when it gets focus or its first keystroke (Stripe Elements, Braintree, Adyen and processor tokenizers do this). When the ref's element
// is replaced, hidden, or does not take the text, the field's replacement is looked up in the page's frames and the text is typed there instead.
// The typed text only ever goes into Input.insertText; it is never put in an expression, an error, a log line or an outline.
const FIELD_RE = {
  number: /cc-number|card.?number|cardnumber|\bpan\b|credit.?card|numero|card.?no\b/i,
  expiry: /cc-exp|expir|\bexp\b|mm.{0,3}yy|exp.?date|valid.?thru/i,
  cvc: /cc-csc|cvc|cvv|cvn|\bcsc\b|security.?code|verification/i,
  name: /cc-name|card.?holder|name.?on.?card|cardholder/i,
  zip: /postal|zip/i,
};
const FIELD_WORDS = { number: "card number", expiry: "expiry", cvc: "security code", name: "cardholder name", zip: "ZIP" };
const classify = (hint) => Object.keys(FIELD_RE).find((k) => FIELD_RE[k].test(hint || "")) || null;
const FIND_JS = (n, kind) => `(() => {
  const RE = ${JSON.stringify(Object.fromEntries(Object.entries(FIELD_RE).map(([k, v]) => [k, v.source])))}, kind = ${JSON.stringify(kind)};
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const all = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]),textarea,select,[contenteditable=""],[contenteditable=true]')].filter((e) => !e.disabled && vis(e));
  const hint = (e) => [e.getAttribute('autocomplete'), e.name, e.id, e.getAttribute('placeholder'), e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('data-elements-stable-field-name')].join(' ');
  let best = null, score = -1;
  for (const e of all) { const sc = kind && new RegExp(RE[kind], 'i').test(hint(e)) ? 2 : (all.length === 1 ? 1 : 0); if (sc > score) { best = e; score = sc; } }
  if (!best || score < 1) return null;
  best.setAttribute('data-1hc', 'f${n}e990'); const r = best.getBoundingClientRect(); return { ref: 'f${n}e990', score, count: all.length, x: r.left, y: r.top };
})()`;
async function ownerRect(c, f) {
  await c.send("DOM.enable").catch(() => {});
  const owner = await c.send("DOM.getFrameOwner", { frameId: f.id });
  const q = (await c.send("DOM.getContentQuads", { backendNodeId: owner.backendNodeId })).quads[0];
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}
// Where is the page's own element for this ref (viewport pixels), and what does it say it is? Never reads its value.
const ORIG_JS = (ref) => `(() => { const e = document.querySelector('[data-1hc="${String(ref).replace(/[^a-z0-9]/gi, "")}"]'); if (!e) return null; const r = e.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, hint: [e.getAttribute('autocomplete'), e.name, e.id, e.getAttribute('placeholder'), e.getAttribute('aria-label'), e.getAttribute('title')].join(' ') }; })()`;
const STATE_JS = (ref) => `(() => { const e = document.querySelector('[data-1hc="${String(ref).replace(/[^a-z0-9]/gi, "")}"]'); if (!e || !e.isConnected) return { gone: true }; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { gone: false, hidden: r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0' }; })()`;
// Find the frame field that replaced (or sits where) the page's field was. Returns { ref, fr } or null after waiting up to ms for a frame to appear.
async function findSwapped(c, kind, orig, ms) {
  const t0 = Date.now();
  for (;;) {
    const fl = await frames(c).catch(() => []), found = [];
    for (const f of fl) {
      let hit = null; try { hit = await evalJS(c, FIND_JS(f.n, kind), f); } catch {}
      if (!hit) continue;
      let over = false;
      if (orig) { try { const o = await ownerRect(c, f); over = orig.cx >= o.l - 40 && orig.cx <= o.r + 40 && orig.cy >= o.t - 40 && orig.cy <= o.b + 40; } catch {} }
      found.push({ ref: hit.ref, fr: f, score: hit.score, over });
    }
    const pool = found.some((x) => x.over) ? found.filter((x) => x.over) : found;
    pool.sort((x, y) => y.score - x.score);
    if (pool[0] && (pool[0].score > 1 || pool.length === 1 || pool[0].over)) return pool[0];
    if (Date.now() - t0 > ms) return null;
    await sleep(300);
  }
}
async function fillField(c, a, kind, secret) {
  const text = String(a.text ?? "");
  const q = (r) => String(r).replace(/[^a-z0-9]/gi, "");
  const isFrameRef = (r) => /^f\d+e\d+$/.test(String(r));
  let ref = String(a.ref), orig = null, swapped = false, tried = false;
  const fieldKind = a.field && FIELD_RE[a.field] ? a.field : null;
  const word = FIELD_WORDS[fieldKind] || (secret ? "secret" : "");
  const handoff = () => new Error(`could not type the ${word ? word + " " : ""}field ${a.ref}${secret ? `: it is inside a hosted payment frame that this browser cannot type into. Do not retry or take another snapshot. Use browser_handoff so the person enters this field themselves` : "; it may be hidden until an earlier step is done, so take a new snapshot"}`);
  if (!isFrameRef(ref)) orig = await evalJS(c, ORIG_JS(ref)).catch(() => null);
  const wantKind = fieldKind || classify(orig?.hint);
  let p = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { p = await box(c, ref); } catch (e) {
      if (tried || isFrameRef(ref) && !secret) throw e;
      tried = true; const sw = await findSwapped(c, wantKind, orig, 3e3); if (!sw) throw secret ? handoff() : e; ref = sw.ref; swapped = true; continue;
    }
    const sel = `document.querySelector('[data-1hc="${q(ref)}"]')`;
    await click(c, p.x, p.y);
    await evalJS(c, `(() => { const e = ${sel}; if (!e) return; e.focus(); if (${kind === "fill"}) { if ('value' in e) e.select?.(); else document.execCommand('selectAll'); } })()`, p.fr);
    // A page that swaps its field for a hosted iframe does it on focus: give it a moment, then see whether this field is still there.
    if (!swapped && !isFrameRef(ref)) {
      await sleep(FAST ? 150 : 350);
      const st = await evalJS(c, STATE_JS(ref)).catch(() => null);
      if (st && (st.gone || st.hidden)) { tried = true; const sw = await findSwapped(c, wantKind, orig, 3e3); if (!sw) throw secret ? handoff() : new Error(`${a.ref} went away when it was focused; take a new snapshot`); ref = sw.ref; swapped = true; continue; }
    }
    // Type in the frame's own session when it has one (out-of-process iframe); otherwise in the page, where the focused frame gets the text.
    if (p.session) { try { await c.send("Input.insertText", { text }, 30e3, p.session); } catch { await c.send("Input.insertText", { text }); } }
    else await c.send("Input.insertText", { text });
    await sleep(80);
    const got = await evalJS(c, `(() => { const e = ${sel}; return e ? ('value' in e ? e.value : e.innerText) : null; })()`, p.fr);
    const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/gi, "");   // fields format input: "2015550123" → "(201) 555-0123"
    const masked = got != null && String(got) !== "" && !/[a-z0-9]/i.test(String(got));   // a hosted field that shows only dots took the text
    const missed = got == null ? !isFrameRef(ref) && !swapped && !tried : (!masked && norm(text) && !norm(got).includes(norm(text).slice(0, 30)));
    if (!missed) return;
    // The page may have replaced the field with the first keystroke: look for the frame field once.
    if (!tried && !isFrameRef(ref)) { tried = true; const sw = await findSwapped(c, wantKind, orig, 2e3); if (sw) { ref = sw.ref; swapped = true; continue; } }
    if (secret) throw handoff();
    throw new Error(`typing into ${a.ref} did not take (field shows "${String(got).slice(0, 40)}"). It may be hidden until an earlier step is done; take a new snapshot`);
  }
  throw handoff();
}
const KEYS = { Enter: [13, "\r"], Tab: [9, "\t"], Escape: [27], Backspace: [8], ArrowDown: [40], ArrowUp: [38], ArrowLeft: [37], ArrowRight: [39], PageDown: [34], PageUp: [33], Home: [36], End: [35], Space: [32, " "] };
async function press(c, key) {
  const k = KEYS[key]; if (!k) throw new Error(`unsupported key ${key}; use one of ${Object.keys(KEYS).join(", ")}`);
  await c.send("Input.dispatchKeyEvent", { type: k[1] ? "keyDown" : "rawKeyDown", key, code: key, windowsVirtualKeyCode: k[0], ...(k[1] ? { text: k[1] } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: k[0] });
}

// ---- OCR: one warm Python process (RapidOCR + onnxruntime, PP-OCRv6 small models; /opt/1hc-browser/ocr.py), started on the first {ocr: true}
// screenshot. Calls run one at a time. A call that takes longer than OCR_TIMEOUT_MS kills the process (the next call starts a fresh one).
// Failures come back as { error }, never as a failed screenshot. Boxes are returned in CSS pixels (the numbers click_at takes).
const OCR_PY = process.env.OCR_PYTHON || "/opt/python/bin/python3", OCR_SCRIPT = "/opt/1hc-browser/ocr.py", OCR_DIR = "/tmp/1hc-ocr";
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 25e3;
let ocrProc = null, ocrChain = Promise.resolve(), ocrSeq = 0;
function ocrStart() {
  const p = spawn(OCR_PY, ["-I", OCR_SCRIPT], { env: { PATH: process.env.PATH, HOME: HOME, LANG: "C.UTF-8", OMP_NUM_THREADS: "4" }, stdio: ["pipe", "pipe", "pipe"] });
  p.waiters = new Map(); p.buf = ""; p.err = "";
  const done = (id, v) => { const w = p.waiters.get(id); if (w) { p.waiters.delete(id); w(v); } };
  p.stdout.on("data", (d) => { p.buf += d; let i; while ((i = p.buf.indexOf("\n")) >= 0) { const line = p.buf.slice(0, i); p.buf = p.buf.slice(i + 1); try { const m = JSON.parse(line); if (m.ready) done("ready", m); else done(m.id, m); } catch {} } });
  p.stderr.on("data", (d) => { p.err = (p.err + d).slice(-1000); });
  const gone = (why) => { if (ocrProc === p) ocrProc = null; for (const id of [...p.waiters.keys()]) done(id, { error: why }); };
  p.on("error", (e) => gone(`could not start OCR: ${e.message}`));
  p.on("exit", (code) => gone(`OCR process exited ${code}${p.err ? `: ${p.err.trim().split("\n").pop().slice(0, 160)}` : ""}`));
  p.stdin.on("error", () => {});
  return p;
}
const ocrWait = (p, id, ms) => new Promise((z) => { const t = setTimeout(() => { p.waiters.delete(id); z({ error: `OCR timed out after ${ms} ms` }); }, ms); p.waiters.set(id, (v) => { clearTimeout(t); z(v); }); });
async function ocrRun(path_, ms) {
  const t0 = Date.now();
  if (!ocrProc) ocrProc = ocrStart();
  const p = ocrProc;
  if (!p.ready) { const r = await ocrWait(p, "ready", ms); if (r.error) { try { p.kill("SIGKILL"); } catch {} if (ocrProc === p) ocrProc = null; return r; } p.ready = true; }
  const id = ++ocrSeq, w = ocrWait(p, id, Math.max(1e3, ms - (Date.now() - t0)));
  try { p.stdin.write(JSON.stringify({ id, path: path_ }) + "\n"); } catch (e) { return { error: `OCR write failed: ${e.message}` }; }
  const r = await w;
  if (r.error && /timed out/.test(r.error)) { try { p.kill("SIGKILL"); } catch {} if (ocrProc === p) ocrProc = null; }
  return r;
}
function jpegDims(buf) {
  for (let i = 2; i + 9 < buf.length;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }; i += 2 + buf.readUInt16BE(i + 2); }
  return null;
}
function ocrJpeg(buf, cssWidth) {
  const job = ocrChain.then(async () => {
    const t0 = Date.now(), f = `${OCR_DIR}/${process.pid}-${Date.now()}.jpg`;
    try {
      fs.mkdirSync(OCR_DIR, { recursive: true }); fs.writeFileSync(f, buf);
      const r = await ocrRun(f, OCR_TIMEOUT_MS);
      if (r.error) return { error: String(r.error).slice(0, 200), ms: Date.now() - t0 };
      const d = jpegDims(buf), k = d && cssWidth > 0 ? cssWidth / d.w : 1;   // picture pixels → CSS pixels (1 unless the page is zoomed or scaled)
      const lines = (r.lines || []).map((l) => ({ text: l.text, x: Math.round(l.x * k), y: Math.round(l.y * k), w: Math.round(l.w * k), h: Math.round(l.h * k), conf: l.conf }));
      return { lines, ms: r.ms ?? Date.now() - t0 };
    } catch (e) { return { error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 }; }
    finally { try { fs.unlinkSync(f); } catch {} }
  });
  ocrChain = job.catch(() => {});
  return job;
}
// ---- Screen recording: ffmpeg grabs the Xvfb screen (the Chrome window) to H.264 mp4 in the background, so other ops keep working.
// While it runs the video is a fragmented mp4 (/workspace/recordings/.<name>.part.mp4) that stays playable if anything dies; stop remuxes it into
// <name>.mp4 with the index up front. It ends by itself after REC_MAX_S. The state is saved in /workspace/.browser/recording.json, so a stop
// after the server or the whole computer restarted still finishes the file. Chrome restarting does not touch it (ffmpeg reads the display).
const REC_DIR = "/workspace/recordings", REC_STATE = "/workspace/.browser/recording.json", REC_MAX_S = 180, REC_FPS = 15;
let rec = null, ffbin = null;
function ffmpegBin() {
  if (ffbin) return ffbin;
  const tryRun = (b) => { try { execFileSync(b, ["-version"], { stdio: "ignore" }); return b; } catch { return null; } };
  ffbin = tryRun("ffmpeg");
  if (!ffbin) for (const base of ["/opt/python/lib"]) { try { for (const v of fs.readdirSync(base)) { const d = `${base}/${v}/site-packages/imageio_ffmpeg/binaries`; if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (/^ffmpeg/.test(f) && (ffbin = tryRun(`${d}/${f}`))) break; } } catch {} }
  return ffbin;
}
const recState = () => { try { return JSON.parse(fs.readFileSync(REC_STATE, "utf8")); } catch { return null; } };
const recClear = () => { try { fs.rmSync(REC_STATE, { force: true }); } catch {} };
const recName = (v) => String(v || "").replace(/\.mp4$/i, "").replace(/[^A-Za-z0-9._ -]+/g, "").trim().replace(/^\.+/, "").slice(0, 60);
const recFree = (base) => { let name = base, n = 1; while (fs.existsSync(`${REC_DIR}/${name}.mp4`)) name = `${base}-${++n}`; return name; };
async function recStart(b) {
  if (rec && rec.exited === undefined) return { ok: false, error: `Already recording (started ${Math.round((Date.now() - rec.started) / 1000)} s ago). Call browser_record stop first.` };
  const old = recState(); if (rec || (old && fs.existsSync(old.part))) return { ok: false, error: "An earlier recording has not been stopped yet. Call browser_record stop first (it saves what was captured), then start again." };
  const bin = ffmpegBin(); if (!bin) return { ok: false, error: "Recording is not available: there is no ffmpeg on this computer." };
  await ensureStack();
  fs.mkdirSync(REC_DIR, { recursive: true });
  const base = recName(b.name) || `recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "").replace("T", "-")}`;
  const name = recFree(base);
  const part = `${REC_DIR}/.${name}.part.mp4`, final = `${REC_DIR}/${name}.mp4`;
  const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", String(REC_FPS), "-video_size", `${W}x${H}`, "-i", DISPLAY, "-t", String(REC_MAX_S),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-g", String(REC_FPS * 2), "-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-flush_packets", "1", part], { env: { ...process.env, DISPLAY }, stdio: ["pipe", "ignore", "pipe"] });
  const r = { p, part, final, name, started: Date.now(), max_s: REC_MAX_S, tail: "" };
  p.stderr.on("data", (d) => { r.tail = (r.tail + d).slice(-1500); }); p.stdin.on("error", () => {});
  p.on("exit", (code) => { r.exited = code ?? -1; r.ended = Date.now(); log(`recording ${name} ffmpeg exited ${code}`); });
  p.on("error", (e) => { r.exited = -1; r.ended = Date.now(); r.tail = e.message; });
  r.guard = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, (REC_MAX_S + 20) * 1e3); r.guard.unref();   // ffmpeg stopped answering: it never runs past the limit
  rec = r;
  try { fs.writeFileSync(REC_STATE, JSON.stringify({ name, part, final, started: r.started, max_s: REC_MAX_S, pid: p.pid })); } catch {}
  await sleep(700); if (r.exited !== undefined) { rec = null; recClear(); return { ok: false, error: `The recorder stopped at once: ${r.tail.trim().split("\n").pop() || "unknown error"}` }; }
  return { recording: true, name, will_save_as: final, max_seconds: REC_MAX_S, fps: REC_FPS, size: `${W}x${H}` };
}
async function recStop(b = {}) {
  const st = rec ? { name: rec.name, part: rec.part, final: rec.final, started: rec.started, max_s: rec.max_s } : recState();   // (a state file with no running recorder means a restart)
  if (!st) return { ok: false, error: "No recording is running. Start one with browser_record start." };
  { const nn = recName(b.name); if (nn && nn !== st.name) { st.name = recFree(nn); st.final = `${REC_DIR}/${st.name}.mp4`; } }   // a name given at stop wins
  const r = rec, bin = ffmpegBin(); let stoppedBy = "stop", ended = Date.now();
  if (r) {
    clearTimeout(r.guard);
    if (r.exited === undefined) { try { r.p.stdin.write("q\n"); } catch {} const t0 = Date.now(); while (r.exited === undefined && Date.now() - t0 < 8e3) await sleep(100);
      if (r.exited === undefined) { try { r.p.kill("SIGINT"); } catch {} while (r.exited === undefined && Date.now() - t0 < 12e3) await sleep(100); }
      if (r.exited === undefined) { try { r.p.kill("SIGKILL"); } catch {} await sleep(300); } ended = Date.now(); }
    else { ended = r.ended || ended; stoppedBy = r.exited === 0 && (ended - r.started) / 1000 >= r.max_s - 2 ? "time limit" : r.exited === 0 ? "stop" : "recorder error"; }
  } else { stoppedBy = "restart";
    if (st.pid) { const alive = () => { try { return fs.readFileSync(`/proc/${st.pid}/cmdline`, "utf8").includes("x11grab"); } catch { return false; } };   // this server restarted but the old ffmpeg may still be running
      if (alive()) { try { process.kill(st.pid, "SIGINT"); } catch {} for (let i = 0; i < 80 && alive(); i++) await sleep(100); if (alive()) { try { process.kill(st.pid, "SIGKILL"); } catch {} await sleep(300); } } }
  }   // nothing running here any more: the computer or this server restarted since the recording began
  rec = null; recClear();
  const partBytes = fs.existsSync(st.part) ? fs.statSync(st.part).size : 0;
  const out = { name: st.name, path: st.final, stopped_by: stoppedBy, wall_seconds: Math.round((ended - st.started) / 100) / 10, max_seconds: st.max_s, ...(r?.tail && stoppedBy === "recorder error" ? { recorder_error: r.tail.trim().split("\n").pop().slice(0, 200) } : {}) };
  if (partBytes < 1000 || !bin) { try { fs.rmSync(st.part, { force: true }); } catch {} return { ...out, path: null, duration_s: 0, bytes: 0, frames: 0, ...(bin ? {} : { error: "no ffmpeg to finish the file" }) }; }
  const mux = await new Promise((z) => { let err = ""; const q = spawn(bin, ["-hide_banner", "-y", "-stats", "-i", st.part, "-c", "copy", "-movflags", "+faststart", st.final], { stdio: ["ignore", "ignore", "pipe"] });
    q.stderr.on("data", (d) => { err = (err + d).slice(-4000); }); q.on("exit", (c) => z({ code: c, err })); q.on("error", (e) => z({ code: -1, err: e.message })); setTimeout(() => { try { q.kill("SIGKILL"); } catch {} }, 60e3).unref(); });
  const t = [...mux.err.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  if (mux.code !== 0 || !fs.existsSync(st.final)) return { ...out, path: null, duration_s: 0, bytes: 0, frames: 0, error: `could not finish the video file: ${mux.err.trim().split("\n").pop()?.slice(0, 200)}` };
  // A copy does not report frames in every ffmpeg build, so count them by decoding the finished file (fast; a few seconds at most).
  const cnt = await new Promise((z) => { let err = ""; const q = spawn(bin, ["-hide_banner", "-i", st.final, "-an", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    q.stderr.on("data", (d) => { err = (err + d).slice(-4000); }); q.on("exit", () => z(err)); q.on("error", () => z("")); setTimeout(() => { try { q.kill("SIGKILL"); } catch {} }, 60e3).unref(); });
  const counted = Number([...cnt.matchAll(/frame=\s*(\d+)/g)].pop()?.[1] || 0), tt = [...cnt.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop() || t;
  const dur = tt ? Number(tt[1]) * 3600 + Number(tt[2]) * 60 + Number(tt[3]) : counted / REC_FPS, frames = counted || Math.round(dur * REC_FPS);
  try { fs.rmSync(st.part, { force: true }); } catch {}
  return { ...out, duration_s: Math.round(dur * 10) / 10, bytes: fs.statSync(st.final).size, frames, fps: REC_FPS, width: W, height: H, codec: "h264 yuv420p" };
}
const OPS = {
  // With a "_tab" key it answers for that task's tabs only ("tab" is its current page, or null when it has none). Without one, every tab, as before.
  async status(b = {}) {
    const key = tabKey(b), up = !!procs.chrome && await portOpen(CDP_PORT); if (!up) return { running: false, ...(key ? { tab: null } : {}) };
    const ts = await targets(); if (!key) return { running: true, tabs: ts.map((t) => ({ title: t.title, url: t.url })) };
    const rec = tabs.get(key), mine = rec ? ts.filter((t) => rec.targets.has(t.id)) : [], cur = mine.find((t) => t.id === rec?.current);
    return { running: true, tabs: mine.map((t) => ({ title: t.title, url: t.url })), tab: cur ? { url: cur.url, title: cur.title } : null };
  },
  // Bring this task's tab to the front; pin: keep it there for the person (handoff) until the task uses the browser again.
  async activate(b, c, ctx) { if (b.pin === true) pin = { key: ctx.key, at: Date.now() }; else if (pin?.key === ctx.key) pin = null; front = ctx.key; await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${c.targetId}`).catch(() => {}); return { activated: true, pinned: pin?.key === ctx.key }; },
  async navigate(b, c) {
    let u; try { u = new URL(String(b.url)); } catch { throw new Error("url must be a full http(s) URL"); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error("only http(s) URLs without embedded credentials");
    const r = await c.send("Page.navigate", { url: u.href }); if (r.errorText) throw new Error(`navigation failed: ${r.errorText}`);
    await settle(c, 15e3); return await snapshot(c);
  },
  async snapshot(b, c) { if (FAST) await quiet(c, 1.5e3); return await snapshot(c); },
  async back(b, c, ctx) {
    // A tab a page opened has no history to go back to: close it and return to the task's other tab.
    const rec = tabs.get(ctx.key);
    if (rec && rec.targets.size > 1 && (await evalJS(c, "history.length").catch(() => 2)) <= 1) {
      const id = c.targetId; await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${id}`).catch(() => {}); dropTarget(id);
      const t = (await targets()).find((x) => x.id === rec.current);
      if (t) { const c2 = await connectTarget(t); if (!c2.persistent) ctx.opened.push(c2); await activateTab(rec); await settle(c2); return { ...(await snapshot(c2)), closed_tab: true }; }
    }
    await evalJS(c, "history.back()"); await settle(c); return await snapshot(c);
  },
  async screenshot(b, c) {
    const r = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
    const loc = await evalJS(c, "({url: location.href, title: document.title, view: {w: innerWidth, h: innerHeight, scroll_x: Math.round(scrollX), scroll_y: Math.round(scrollY), page_h: Math.round(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))}})").catch(() => ({}));
    const out = { jpeg_base64: r.data, url: loc.url, title: loc.title, ...(loc.view ? { view: loc.view } : {}) };
    if (b.ocr === true) out.ocr = await ocrJpeg(Buffer.from(r.data, "base64"), loc.view?.w);
    return out;
  },
  async act(b, c, ctx = { key: "", opened: [] }) {
    const acts = Array.isArray(b.actions) ? b.actions : []; if (!acts.length || acts.length > 20) throw new Error("actions: 1–20 steps");
    let done = 0, uploaded = false, switched = false; const notes = []; const before = await snapshot(c).catch(() => null);
    // A click can open a new tab or window. The opener relationship (onBrowserEvent) put it in this task's tab set and made it current;
    // from then on the rest of this call, and the answer, are about that tab.
    const follow = async () => {
      const rec = tabs.get(ctx.key); if (!rec?.current || rec.current === c.targetId) return false;
      const t = (await targets()).find((x) => x.id === rec.current); if (!t) return false;
      const c2 = await connectTarget(t); if (!c2.persistent) ctx.opened.push(c2);
      c = c2; await activateTab(rec); await settle(c, 10e3); switched = true; return true;
    };
    const h0 = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries.length;
    for (const a of acts) {
      const kind = String(a.kind || "");
      if (kind === "click") { await clickRef(c, a.ref); await settle(c, 8e3); }
      else if (kind === "click_at") {
        // A pixel position in the page (viewport, CSS pixels: the same numbers a screenshot of the page uses), for things with no ref such as a canvas.
        const x = Number(a.x), y = Number(a.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > W || y > H) throw new Error(`click_at needs x between 0 and ${W} and y between 0 and ${H}`);
        await click(c, x, y);
        await settle(c, 8e3);
      }
      else if (kind === "fill" || kind === "type") { await fillField(c, a, kind, !!b.secret); if (a.submit) { await press(c, "Enter"); await settle(c, 8e3); }
      } else if (kind === "select") {
        const fs_ = await frameOf(c, a.ref);
        const ok = await evalJS(c, `(() => { const e = document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]'); if (!e || e.tagName !== 'SELECT') return false; const o = [...e.options].find((o) => o.text.trim() === ${JSON.stringify(String(a.text ?? ""))} || o.value === ${JSON.stringify(String(a.text ?? ""))}); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, fs_);
        if (!ok) throw new Error(`could not select "${a.text}" in ${a.ref}`);
      } else if (kind === "press") { await press(c, String(a.key || "Enter")); await settle(c, 8e3); }
      else if (kind === "scroll") { await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: W / 2, y: H / 2, deltaX: 0, deltaY: a.direction === "up" ? -600 : 600 }); await sleep(400); }
      else if (kind === "wait") { const want = Number(a.ms) || 1000, ms = Math.min(WAIT_MAX, Math.max(0, want)); if (want > WAIT_MAX) notes.push(`wait shortened from ${want} to ${WAIT_MAX} ms (the most one wait step waits; use several wait steps, or check the page between waits)`); await sleep(ms); }
      else if (kind === "upload") { notes.push(await upload(c, a)); uploaded = true; await settle(c, 8e3); }
      else if (kind === "select_or_fill") {   // expiry month/year can be a dropdown or a text box
        const fs_ = await frameOf(c, a.ref), sel = `document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]')`;
        const isSel = await evalJS(c, `(${sel})?.tagName === 'SELECT'`, fs_);
        if (isSel) { const t = JSON.stringify(String(a.text ?? "")); const ok = await evalJS(c, `(() => { const e = ${sel}; const want = ${t}; const o = [...e.options].find((o) => o.value === want || o.text.trim() === want || o.value === String(Number(want)) || o.value.endsWith(want.slice(-2)) && o.value.length <= 4); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, fs_); if (!ok) throw new Error(`could not choose that option in ${a.ref}`); }
        else { a.kind = "fill"; acts.splice(acts.indexOf(a) + 1, 0, a); done--; }
      }
      else throw new Error(`unknown action kind "${kind}" (click, click_at, fill, type, select, press, scroll, wait, upload)`);
      done++;
      if (await follow()) { const rest = acts.length - acts.indexOf(a) - 1; notes.push(`this step opened a new tab, and it is now this task's current tab${rest > 0 ? `; the other ${rest} step(s) were not run because their refs belong to the earlier page (use the refs below)` : ""}`); break; }
    }
    // Payment/submit buttons often call an API for several seconds before the page moves on. After clicking one,
    // watch for a navigation for up to 20 s so the result reflects what actually happened.
    // Quiet mode: one general rule for every page. If the steps started a navigation, wait for quiet up to 15 s; otherwise up to 3 s.
    if (FAST) { const n = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries.length; await quiet(c, n > h0 ? 15e3 : 3e3); }
    const lastClick = FAST ? null : [...acts].reverse().find((a) => a.kind === "click");
    if (lastClick && before) {
      const line = before.snapshot.split("\n").find((l) => l.startsWith(`[${lastClick.ref}] `)) || "";
      if (/\b(pay|place order|buy|purchase|submit|confirm|complete order|checkout)\b/i.test(line)) {
        for (let i = 0; i < 20; i++) { const n = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries.length; if (n > h0) { await settle(c, 10e3); break; } await sleep(1000); }
      }
    }
    await follow();   // a tab opened late (a timer, a slow redirect)
    let after = await snapshot(c);
    for (let i = 0; i < (FAST || switched ? 0 : 6) && before && after.snapshot === before.snapshot && after.url === before.url; i++) { await sleep(2000); after = await snapshot(c); }
    // Tell the model plainly when its steps had no visible effect, so it can't narrate a success that didn't happen.
    const changed = uploaded || switched || !before || before.snapshot !== after.snapshot || before.url.replace(/[?#]$/, "") !== after.url.replace(/[?#]$/, "");
    // Pages passed through during the steps (e.g. /checkout/success before an automatic redirect home).
    const hist = switched ? [] : (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries;
    const visited = hist.slice(Math.max(0, h0 - 1)).map((e) => e.url).filter((u, i, a) => u !== a[i - 1]);
    return { completed: done, page_changed: changed, ...(switched ? { new_tab: true } : {}), ...(notes.length ? { notes } : {}), ...(visited.length > 1 ? { visited } : {}), ...after };
  },
};

const MIME = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  try {
    if (u.pathname === "/health") return send(200, { ok: true });
    const nv = u.pathname.match(/\/novnc\/(.+)$/);
    if (nv) {
      const f = path.normalize(path.join(NOVNC, nv[1])); if (!f.startsWith(NOVNC + "/") || !fs.existsSync(f)) return send(404, { error: "not found" });
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "public, max-age=3600" }); return fs.createReadStream(f).pipe(res);
    }
    const m = u.pathname.match(/^\/cdp\/([a-z]+)$/);
    if (m && req.method === "POST" && (OPS[m[1]] || m[1] === "record" || m[1] === "closetab")) {
      if (!controllerRequest(req.headers)) return send(403, { error: "forbidden" });
      let body = ""; for await (const ch of req) body += ch; const b = body ? JSON.parse(body) : {};
      if (m[1] === "record") { const r = b.action === "stop" ? await recStop(b) : b.action === "start" ? await recStart(b) : { ok: false, error: "action must be start or stop" }; return send(200, { ok: r.ok !== false, ...r }); }
      if (m[1] === "status") return send(200, await OPS.status(b));
      FAST = b._wait === "quiet";
      const key = tabKey(b);
      if (m[1] === "closetab") return send(200, { ok: true, closed: key && (await portOpen(CDP_PORT)) ? await closeTab(key) : 0 });   // a task that is done; other tasks' tabs stay
      const boot = await ensureStack();
      const k = key || (front !== null && tabs.has(front) ? front : "");   // no key: the tab in front (the person's view, or an older Worker)
      const out = await serial(k, async () => {
        const ctx = { key: k, op: m[1], opened: [] };
        try {
          const { rec, c, note } = await openTab(k, ctx);
          const out = await OPS[m[1]](b, c, ctx);
          if (out?.url && /^https?:/.test(out.url)) { try { fs.writeFileSync(LAST_URL, out.url); } catch {} if (out.url !== rec.url) { rec.url = out.url; saveTabs(); } }
          return { ...out, ...(note ? { tab_note: note } : {}) };
        } finally { for (const c of ctx.opened) c.close(); }
      });
      return send(200, { ok: true, ...(boot.cold ? { browser_started_ms: boot.start_ms } : {}), ...out });
    }
    send(404, { error: "not found" });
  } catch (e) { send(500, { ok: false, error: e.message }); }
});
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
server.on("upgrade", async (req, sock, head) => {
  const u = new URL(req.url, "http://x");
  if (!u.pathname.endsWith("/vnc") || !controllerRequest(req.headers)) return sock.destroy();
  try { await ensureStack(); } catch (e) { log("stack failed", e.message); return sock.destroy(); }
  const port = u.searchParams.get("mode") === "control" ? 5901 : 5900;
  wss.handleUpgrade(req, sock, head, (ws) => {
    const t = net.connect(port, "127.0.0.1"); t.setNoDelay(true);
    t.on("data", (d) => ws.readyState === 1 && ws.send(d));
    ws.on("message", (d) => t.write(d));
    const end = () => { try { t.destroy(); } catch {} try { ws.close(); } catch {} };
    t.on("close", end); t.on("error", end); ws.on("close", end); ws.on("error", end);
  });
});
server.listen(PORT, "0.0.0.0", () => log(`listening on ${PORT}`));
