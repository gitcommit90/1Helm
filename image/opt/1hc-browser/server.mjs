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
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { controllerRequest } from "./request-guard.mjs";
const require = createRequire(import.meta.url);
const wsLib = require(process.env.HC_WS || "/opt/1hc-browser/node_modules/ws");
const { WebSocketServer, WebSocket } = wsLib;
import { createExitProxy, httpTunnel, exitMessage, EXIT_PROXY_PORT } from "./exit-proxy.mjs";

// The HC_ variables exist so a test can run this server against a local Chrome in a scratch folder; in the container none is set.
const PORT = Number(process.env.HC_PORT) || 6080, DISPLAY = process.env.HC_DISPLAY || ":99", W = 1280, H = 800, CDP_PORT = Number(process.env.HC_CDP_PORT) || 9222;
const VNC_VIEW = Number(process.env.HC_VNC_VIEW) || 5900, VNC_CTL = Number(process.env.HC_VNC_CTL) || 5901;
const BROWSER_DIR = process.env.HC_BROWSER_DIR || "/workspace/.browser", CHROME = process.env.HC_CHROME || "/opt/chrome/chrome";
const LAST_URL = `${BROWSER_DIR}/last_url`;
const PROFILE = `${BROWSER_DIR}/profile`, HOME = process.env.HC_HOME || "/tmp/1hc-browser-home";
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const NOVNC = "/opt/1hc-browser/novnc";
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const log = (...a) => console.log(`[1hc-browser ${new Date().toISOString().slice(11, 23)}]`, ...a);
const procs = {};
// A socket error inside the exit proxy or a request must never end this service (it would drop the proxy while Chrome still points at it).
process.on("uncaughtException", (e) => { console.log(`[1hc-browser] uncaught: ${e?.stack || e}`); });
process.on("unhandledRejection", (e) => { console.log(`[1hc-browser] unhandled rejection: ${e?.stack || e}`); });
let starting = null;
// Browser exit node (the person's own Tailscale exit node). The computer writes this file at wake and on every change of the setting:
// { on: true, direct: [hosts that keep their path through Sentinel] }. While on, Chrome only talks to the exit proxy (exit-proxy.mjs) and
// a failure to reach the exit node is an error, never a direct connection. See src/browser-exit.js.
const EXIT_CONF = process.env.HC_EXIT_CONF || "/tmp/1hc-exit-proxy.json", EXIT_PORT = Number(process.env.HC_EXIT_PORT) || EXIT_PROXY_PORT;
const EXIT_BASE = process.env.HC_EXIT_BASE || "http://tsproxy.internal", EXIT_STATUS = process.env.HC_EXIT_STATUS || "http://tsproxy.internal/status";
let exitConf = { on: false, direct: [] }, exitSrv = null, lastNav = null;
function readExitConf() { try { const j = JSON.parse(fs.readFileSync(EXIT_CONF, "utf8")); return { on: j.on === true, direct: Array.isArray(j.direct) ? j.direct.map((h) => String(h).toLowerCase()).slice(0, 200) : [] }; } catch { return { on: false, direct: [] }; } }
async function ensureExitProxy() {
  const dkey = JSON.stringify(exitConf.direct);
  if (exitSrv && exitSrv.listening && exitSrv.directKey === dkey) { return; }
  if (exitSrv) stopExitProxy();
  const direct = new Set(exitConf.direct);
  const tunnel = httpTunnel(EXIT_BASE, { log: (l) => exitLog(l, true) });
  tunnel.check().then(() => exitLog(`exit tunnel mode: ${tunnel.mode()}`, true)).catch(() => {});   // asked at start, so the mode is in the event log before the first page
  const srv = createExitProxy({ openTunnel: tunnel, direct: (h) => direct.has(String(h).toLowerCase()), log: exitLog });
  await new Promise((ok, bad) => { srv.once("error", bad); srv.listen(EXIT_PORT, "127.0.0.1", ok); });
  srv.directKey = dkey; exitSrv = srv; log(`exit proxy listening on ${EXIT_PORT}`);
  srv.on("close", () => { if (exitSrv === srv) { exitSrv = null; exitLog("exit proxy closed"); } });
  srv.on("error", (e) => exitLog(`exit proxy server error: ${String(e?.message || e)}`));
  srv.on("clientError", (_e, sock) => { try { sock.destroy(); } catch {} });
}
// Exit proxy problems go to the console and, rate limited, to the computer's event log (http://computer.internal/exit-log) so they show in its status.
const exitRecent = []; let exitLogAt = 0;
function exitLog(line, force = false) {
  log(line); exitRecent.push(`${new Date().toISOString().slice(11, 19)} ${String(line).slice(0, 200)}`); if (exitRecent.length > 20) exitRecent.shift();
  if (!force && Date.now() - exitLogAt < 5e3) return; exitLogAt = Date.now();
  fetch("http://computer.internal/exit-log", { method: "POST", body: String(line).slice(0, 200), signal: AbortSignal.timeout(5e3) }).catch(() => {});
}
function stopExitProxy() { try { exitSrv?.closeAllConnections?.(); exitSrv?.close(); } catch {} exitSrv = null; }
// Asks the platform whether browser traffic can leave through the exit node right now: { ok, reason }.
// A "yes" is remembered for 10 s: the exit proxy itself refuses every connection when the exit node is down, so the check only gives the early plain error.
let exitStatusOkAt = 0;
async function exitStatus() {
  if (Date.now() - exitStatusOkAt < 10e3) return { ok: true, reason: "" };
  const r = await exitStatus0(); if (r.ok) exitStatusOkAt = Date.now(); return r;
}
async function exitStatus0() {
  try { const r = await fetch(EXIT_STATUS, { signal: AbortSignal.timeout(25e3) }); const j = await r.json(); return { ok: j.ok === true, reason: String(j.reason || "") }; }
  catch { return { ok: false, reason: "1Helm could not check the exit node." }; }
}

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
  // Chrome may already be running with --proxy-server (it survives a restart of this service, or the proxy may have stopped): the proxy must be listening whenever the setting is on.
  exitConf = readExitConf();
  if (exitConf.on) await ensureExitProxy().catch((e) => exitLog(`exit proxy did not start: ${String(e?.message || e)}`)); else stopExitProxy();
  // A Chrome that was started with a different proxy setting than the file says now is stopped, so it never keeps a stale proxy (or none) after a change.
  if (procs.chrome && procs.chrome.exitOn !== undefined && procs.chrome.exitOn !== exitConf.on) { const p = procs.chrome; p.kill("SIGTERM"); await waitFor(() => procs.chrome !== p, 8e3, "Chrome stop").catch(() => { try { p.kill("SIGKILL"); } catch {} delete procs.chrome; }); }
  if (procs.xvfb && procs.chrome && procs.vncView && procs.vncCtl && await portOpen(CDP_PORT)) return { cold: false };
  if (!starting) starting = startStack().finally(() => { starting = null; });
  return await starting;
}
async function startStack() {
  const t0 = Date.now();
  fs.mkdirSync(HOME, { recursive: true }); fs.mkdirSync(PROFILE, { recursive: true });
  if (!procs.xvfb) {
    try { fs.rmSync(`/tmp/.X${DISPLAY.slice(1)}-lock`, { force: true }); } catch {}
    run("xvfb", "Xvfb", [DISPLAY, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp", "-ac"]);
    await waitFor(() => fs.existsSync(`/tmp/.X11-unix/X${DISPLAY.slice(1)}`), 10e3, "display");
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
    run("chrome", CHROME, ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu",
      "--password-store=basic", "--test-type", "--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--noerrdialogs", "--disable-features=Translate,MediaRouter,OptimizationHints", "--disable-background-networking",
      `--user-data-dir=${PROFILE}`, `--disk-cache-dir=${HOME}/chrome-cache`, `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
      `--window-size=${W},${H}`, "--window-position=0,0", "--start-maximized", "--lang=en-US",
      ...(exitConf.on ? [`--proxy-server=http://127.0.0.1:${EXIT_PORT}`] : []), "about:blank"]);
    procs.chrome.exitOn = exitConf.on;
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
  if (!procs.vncView) run("vncView", "x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", String(VNC_VIEW), "-nopw", "-shared", "-forever", "-viewonly", "-quiet", "-noxdamage", "-cursor", "arrow"]);
  if (!procs.vncCtl) run("vncCtl", "x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", String(VNC_CTL), "-nopw", "-shared", "-forever", "-quiet", "-noxdamage", "-cursor", "arrow"]);
  await waitFor(async () => (await portOpen(VNC_VIEW)) && (await portOpen(VNC_CTL)), 10e3, "VNC");
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
async function quiet(c, cap = 8e3, loose = false) {
  const t0 = Date.now(); let last = Date.now(), lastMut = -1;
  while (Date.now() - t0 < cap) {
    let st; try { st = await evalJS(c, `(() => { if (!window.__1hcq) { window.__1hcq = { n: 0 }; try { new MutationObserver(() => window.__1hcq.n++).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {} } return { m: window.__1hcq.n, r: document.readyState }; })()`); } catch { st = null; }
    const busy = !st || (loose ? st.r === "loading" : (st.r !== "complete" || (c.inflight || 0) > 0));   // loose (navigation): the page only has to be parsed, requests still running (ads, trackers, late images) do not hold it
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
const TABS_FILE = `${BROWSER_DIR}/tabs.json`;
const TAB_IDLE_MS = Number(process.env.TAB_IDLE_MS) || 20 * 60e3;   // a task's tabs close after this long with no browser call from it
const TAB_PIN_MS = 2 * 3600e3;                                       // a tab shown to the person (handoff) is kept this long
const TAB_MAX = 10;                                                  // most task tabs at once; the least recently used one closes to make room
const tabs = new Map();    // key -> { key, targets: Set<targetId>, current, last, url }
const owned = new Map();   // targetId -> key
const conns = new Map();   // targetId -> CDP (quiet mode keeps one connection per tab)
const chains = new Map();  // key -> promise: calls on one tab run one after the other
let front = null, pin = null, bconn = null, pageOpens = 0;   // front: key last brought to the front. pin: { key, at } while a handoff shows that tab.
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
    if (key !== undefined && !owned.has(i.targetId)) { const rec = tabs.get(key); if (rec) { rec.targets.add(i.targetId); rec.current = i.targetId; owned.set(i.targetId, key); pageOpens++; } }
  } else if (d.method === "Target.targetDestroyed") dropTarget(d.params.targetId);
}
async function browserConn() {
  if (bconn && bconn.ws.readyState === 1) return bconn;
  const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const c = new CDP(v.webSocketDebuggerUrl); await c.open();
  c.ev.push(onBrowserEvent, onDownloadEvent); c.ws.on("close", () => { if (bconn === c) bconn = null; });
  await c.send("Target.setDiscoverTargets", { discover: true });
  // "default" keeps the managed policy's download folder; eventsEnabled makes Chrome report each download's name, size and state to this connection.
  await c.send("Browser.setDownloadBehavior", { behavior: "default", eventsEnabled: true }).catch((e) => log("download events not enabled", e.message));
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
  // A JavaScript dialog freezes the page (a click that opens an alert never returns). Answer it at once and keep a record for the effects list:
  // alerts and "leave this page" boxes are accepted, confirm and prompt boxes are cancelled.
  c.dialogs = [];
  c.ev.push((d) => { if (d.method !== "Page.javascriptDialogOpening") return; const q = d.params || {}, accept = q.type === "alert" || q.type === "beforeunload";
    c.dialogs.push({ type: q.type, message: String(q.message || "").replace(/\s+/g, " ").slice(0, 120), handled: accept ? "accepted" : "cancelled", at: Date.now() }); if (c.dialogs.length > 20) c.dialogs.shift();
    c.send("Page.handleJavaScriptDialog", { accept }, 5e3, d.sessionId).catch(() => {}); });
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
// After browser_navigate: the page is usable once it is parsed (DOMContentLoaded) and its DOM has stopped changing for a moment, at most 1.5 s after that.
// The load event and open requests are not waited for: an ad-heavy page can keep loading for tens of seconds. A later snapshot waits a little more if the page is still loading.
async function settleNav(c, parseCap = 15e3, quietCap = 1.5e3) {
  await sleep(150);
  const t0 = Date.now();
  while (Date.now() - t0 < parseCap) { try { const st = await evalJS(c, "document.readyState + ' ' + location.protocol"); if (!st.startsWith("loading") && !st.endsWith("about:")) break; } catch {} await sleep(50); }
  await quiet(c, quietCap, true);
}
async function settle(c, ms = 10e3) {
  if (FAST) { await quiet(c, ms); return; }
  await sleep(400);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await evalJS(c, "document.readyState")) === "complete") break; } catch {} await sleep(250); }
  await sleep(300);
}

// ---- What an action did (2026-11-03) ----
// "Nothing visible changed" used to be a guess from two copies of the outline. It was wrong whenever the effect was not in the outline: a download,
// a window the browser blocked, a request that saved something, a change inside a frame. Now every act watches the tab through CDP while it runs
// (the page and every frame, including frames in their own process) and the answer lists what happened. Only addresses without query strings
// leave this computer in that list (host and path).
const DOWNLOADS_DIR = process.env.HC_DOWNLOADS || "/workspace/files/downloads";
const hostPath = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return String(u || "").slice(0, 60); } };
const dls = new Map();   // guid -> { name, from, bytes, total, state, at }; fed by the browser connection's download events
function onDownloadEvent(d) {
  const p = d.params || {};
  if (d.method === "Browser.downloadWillBegin") { dls.set(p.guid, { guid: p.guid, name: p.suggestedFilename || "download", from: hostPath(p.url), bytes: 0, total: 0, state: "inProgress", at: Date.now() }); if (dls.size > 60) dls.delete(dls.keys().next().value); }
  else if (d.method === "Browser.downloadProgress") { const r = dls.get(p.guid); if (!r) return; r.bytes = p.receivedBytes || r.bytes; r.total = p.totalBytes || r.total; r.state = p.state; if (p.filePath) r.name = path.basename(p.filePath); }
}
const dlSince = (t) => [...dls.values()].filter((r) => r.at >= t);
async function waitDownloads(since, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms && dlSince(since).some((r) => r.state === "inProgress")) await sleep(200); }
const DL_WAIT = Number(process.env.HC_DL_WAIT) || 60e3;   // the longest an act waits for a download it started
const FX_SKIP_TYPES = /^(Image|Font|Media|Stylesheet|Ping|CSPViolationReport|Preflight|Manifest|TextTrack|SignedExchange|Prefetch)$/;
const FX_JS = `(() => { if (!window.__1hcfx) { const s = window.__1hcfx = { n: 0 }; try { new MutationObserver((ms) => { for (const m of ms) if (!(m.type === 'attributes' && /^data-1hc/.test(m.attributeName || ''))) s.n++; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {} } return window.__1hcfx.n; })()`;
async function startEffects(c) {
  const fx = { t0: Date.now(), navs: [], reqs: [], windows: [], chooser: 0, quiet: false, open: new Set(), opens0: pageOpens, handled: 0, mut0: null, blockedOpened: [], errs: [] };
  fx.on = (d) => {
    const p = d.params || {}, key = (d.sessionId || "") + (p.requestId || "");
    if (d.method === "Page.frameNavigated") { const f = p.frame; if (f && /^https?:/.test(f.url || "")) fx.navs.push({ main: !f.parentId, url: hostPath(f.url) }); }
    else if (d.method === "Page.navigatedWithinDocument") { if (/^https?:/.test(p.url || "")) fx.navs.push({ main: true, same: true, url: hostPath(p.url) }); }
    else if (d.method === "Network.requestWillBeSent") { if (!p.redirectResponse && !FX_SKIP_TYPES.test(p.type || "") && /^https?:/.test(p.request?.url || "")) { fx.reqs.push(`${p.request.method} ${hostPath(p.request.url)}`); fx.open.add(key); } }
    else if (d.method === "Network.loadingFinished" || d.method === "Network.loadingFailed") fx.open.delete(key);
    else if (d.method === "Page.windowOpen") { if (p.url) fx.windows.push(String(p.url)); }
    else if (d.method === "Page.fileChooserOpened") { if (!fx.quiet) fx.chooser++; }
    else if (d.method === "Runtime.exceptionThrown") {   // an error the page's own script did not catch (e.g. "nm is not defined"): the step reached the page, and the page failed
      const x = p.exceptionDetails || {}, msg = String(x.exception?.description || x.exception?.value || x.text || "").split("\n")[0].slice(0, 160);
      if (msg && !fx.errs.includes(msg)) fx.errs.push(msg);
    }
  };
  fx.reset = () => { fx.t0 = Date.now(); fx.navs = []; fx.reqs = []; fx.windows = []; fx.chooser = 0; fx.open.clear(); fx.opens0 = pageOpens; fx.handled = 0; fx.errs = []; };
  fx.stop = () => { c.ev = c.ev.filter((x) => x !== fx.on); c.send("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {}); };
  fx.intercept = () => c.send("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {});   // a click that opens the native file chooser is reported instead of leaving a dialog on the screen
  c.ev.push(fx.on);
  await c.send("Network.enable").catch(() => {}); await fx.intercept();
  return fx;
}
// Count of DOM changes per frame, counted by a MutationObserver that lives in an isolated world of each frame (the page's own scripts cannot see it).
async function fxMut(c) {
  const out = new Map(); c.fxw ||= new Map();
  const read = async (frameId, loader, session) => {
    let w = c.fxw.get(frameId);
    if (!w || w.loader !== loader) { const r = await c.send("Page.createIsolatedWorld", { frameId, worldName: "1hc-fx" }, 8e3, session).catch(() => null); w = r && { ctx: r.executionContextId, loader }; if (w) c.fxw.set(frameId, w); else c.fxw.delete(frameId); }
    if (!w) return;
    const r = await c.send("Runtime.evaluate", { expression: FX_JS, returnByValue: true, contextId: w.ctx }, 8e3, session).catch(() => null);
    if (typeof r?.result?.value === "number") out.set(frameId + ":" + loader, r.result.value);
  };
  const trees = [];
  try { trees.push({ t: (await c.send("Page.getFrameTree")).frameTree }); } catch {}
  await Promise.all([...(c.frames?.values() || [])].filter((f) => f.session).map(async (f) => { try { trees.push({ t: (await c.send("Page.getFrameTree", {}, 8e3, f.session)).frameTree, session: f.session }); } catch {} }));
  const jobs = []; const walk = (t, session) => { jobs.push(read(t.frame.id, t.frame.loaderId, session)); for (const ch of t.childFrames || []) walk(ch, session); };
  for (const x of trees) walk(x.t, x.session);
  await Promise.all(jobs); return out;
}
const mutDiff = (a, b) => { let n = 0; if (!a || !b) return 0; for (const [k, v] of b) n += Math.max(0, v - (a.get(k) || 0)); return n; };
// A window.open that the browser did not open (no user gesture left, e.g. called after a slow request) leaves no tab and no sign on the page.
// The page meant to show something, so open that address as a tab of this task and say so.
async function openBlocked(fx, ctx) {
  const opened = pageOpens - fx.opens0, blocked = fx.windows.slice(Math.max(fx.handled, opened)); fx.handled = fx.windows.length;
  for (const u of blocked.slice(0, 1)) {
    if (!/^https?:/.test(u)) continue;
    try { const r = await (await browserConn()).send("Target.createTarget", { url: u }); const rec = tabs.get(ctx.key);
      if (rec && r.targetId) { rec.targets.add(r.targetId); rec.current = r.targetId; owned.set(r.targetId, ctx.key); fx.blockedOpened.push(hostPath(u)); } } catch {}
  }
  return blocked.map(hostPath);
}
// A tab that shows a PDF in Chrome's viewer has no readable outline and no download. Save a copy through the page's own session (its cookies) into the downloads folder.
const pdfSaved = new Map();   // url -> { name, at }
async function savePdfView(c) {
  try {
    const info = await evalJS(c, "({ type: document.contentType, url: location.href })");
    if (info?.type !== "application/pdf" || !/^https?:/.test(info.url)) return null;
    const prev = pdfSaved.get(info.url); if (prev && Date.now() - prev.at < 10 * 60e3 && fs.existsSync(path.join(DOWNLOADS_DIR, prev.name))) return { name: prev.name, again: true };
    const b64 = await evalJS(c, `fetch(location.href, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error('status ' + r.status); return r.blob(); }).then((b) => { if (b.size > 40e6) throw new Error('too big'); return new Promise((z) => { const f = new FileReader(); f.onload = () => z(String(f.result).split(',')[1] || ''); f.readAsDataURL(b); }); })`);
    if (!b64) return null;
    let base = ""; try { base = decodeURIComponent(new URL(info.url).pathname.split("/").filter(Boolean).pop() || ""); } catch {}
    base = base.replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "document"; if (!/\.pdf$/i.test(base)) base += ".pdf";
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    let name = base; for (let i = 2; fs.existsSync(path.join(DOWNLOADS_DIR, name)); i++) name = base.replace(/\.pdf$/i, "") + ` (${i}).pdf`;
    const buf = Buffer.from(b64, "base64"); fs.writeFileSync(path.join(DOWNLOADS_DIR, name), buf);
    pdfSaved.set(info.url, { name, at: Date.now() }); if (pdfSaved.size > 50) pdfSaved.delete(pdfSaved.keys().next().value);
    return { name, bytes: buf.length };
  } catch { return null; }
}

// Finds the element a ref names, also inside open shadow roots (web components keep their real inputs there). Used by every ref-based action.
const DEEPQ_SRC = "(r) => { const sel = '[data-1hc=\"' + r + '\"]'; const find = (root, d) => { const h = root.querySelector(sel); if (h) return h; if (d > 8) return null; for (const e of root.querySelectorAll('*')) if (e.shadowRoot) { const x = find(e.shadowRoot, d + 1); if (x) return x; } return null; }; return find(document, 0); }";
const DQ = (r) => `(${DEEPQ_SRC})(${JSON.stringify(String(r))})`;
// Page → readable outline for a text-only model. Interactive elements get refs like [e7] that browser_act uses.
const SNAPSHOT_JS = String.raw`(() => {
  const MAX = 200000, BUDGET = __BUDGET__; let n = 0, out = [], len = 0; const WANT = __WANT__, REFP = __REFP__;
  // Refs are numbered per element and kept while the element lives, so a ref the model already holds keeps its meaning after the page changes.
  const reg = window.__1hcRefs || (window.__1hcRefs = { map: new WeakMap(), n: 0 });
  const refOf = (el) => { let k = reg.map.get(el); if (!k) { k = ++reg.n; reg.map.set(el, k); } return REFP + 'e' + k; };
  const hid = { css: 0, zero: 0, aria: 0 }, VH = window.innerHeight || 800, VW = window.innerWidth || 1280;
  const DLG = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]';
  // Choices of a dropdown: the first 12, then up to 8 more that match a value the job needs (so a 250-item list still shows "United States").
  const low = (s) => String(s).toLowerCase();
  const wanted = (o) => WANT.some((w) => low(o) === low(w) || (w.length >= 3 && o.length >= 3 && (low(o).includes(low(w)) || low(w).includes(low(o)))));
  const pickOpts = (arr) => { const seen = new Set(), all = arr.filter((t) => t && !seen.has(t) && seen.add(t)); return all.slice(0, 12).concat(all.slice(12).filter(wanted).slice(0, 8)); };
  const backingSelect = (el) => { for (let p = el.parentElement, k = 0; p && k < 3; p = p.parentElement, k++) { const ss = p.querySelectorAll('select'); if (ss.length === 1 && p.querySelectorAll('input:not([type=hidden]),[role=combobox]').length === 1) return ss[0]; if (ss.length > 1) break; } return null; };
  const comboOpts = (el) => {
    const bs = backingSelect(el); if (bs) return [...bs.options].map((o) => clean(o.text, 30));
    if (el.list && el.list.options) return [...el.list.options].map((o) => clean(o.value || o.text, 30));
    for (const id of ((el.getAttribute('aria-controls') || '') + ' ' + (el.getAttribute('aria-owns') || '')).split(/\s+/)) { const lb = id && document.getElementById(id); if (!lb) continue;
      const items = lb.querySelectorAll('[role=option],option'); const list = items.length ? items : lb.querySelectorAll('li'); if (list.length) return [...list].map((o) => clean(o.textContent, 30)); }
    return [];
  };
  const clearMarks = (root, d) => { root.querySelectorAll('[data-1hc]').forEach((e) => e.removeAttribute('data-1hc')); if (d < 8) root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) clearMarks(e.shadowRoot, d + 1); }); }; clearMarks(document, 0);
  const rootOf = (el) => { const r = el.getRootNode && el.getRootNode(); return r && r.host ? r : document; };
  const inShadow = (el) => rootOf(el) !== document;
  const deepActive = () => { let a = document.activeElement; for (let k = 0; a && a.shadowRoot && a.shadowRoot.activeElement && k < 8; k++) a = a.shadowRoot.activeElement; return a; };
  const INTER = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=switch],[role=slider],[role=textbox],[contenteditable=""],[contenteditable=true]';
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'contents') return s.visibility !== 'hidden'; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };   // display:contents (web component wrappers) has no box of its own, its children do
  const boxOf = (el) => { for (let k = 0; el && k < 20 && getComputedStyle(el).display === 'contents'; k++) el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null; return el; };
  const tagOf = (el) => el.tagName.toLowerCase(), IN_FRAME = window.top !== window;
  const clean = (s, m = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, m);
  // The text a node shows, following slots (the light DOM nodes assigned to them) and open shadow roots, so a label whose words are slotted in still reads.
  const deepText = (nd, d = 0) => { if (d > 12) return ''; if (nd.nodeType === 3) return nd.textContent; if (nd.nodeType !== 1) return ''; const t = nd.localName; if (t === 'script' || t === 'style' || t === 'template' || t === 'svg') return '';
    let kids; if (t === 'slot') { try { kids = nd.assignedNodes({ flatten: true }); } catch { kids = []; } } else kids = nd.shadowRoot ? nd.shadowRoot.childNodes : nd.childNodes;
    let o = ''; for (const k of kids) o += ' ' + deepText(k, d + 1); return o; };
  const label = (el) => { const id = el.id && rootOf(el).querySelector('label[for="' + CSS.escape(el.id) + '"]'); const hostLab = inShadow(el) ? (() => { const h = rootOf(el).host; return h.getAttribute('label') || h.getAttribute('aria-label') || h.getAttribute('placeholder') || h.getAttribute('name') || ''; })() : '';
    return clean(el.getAttribute('aria-label') || (id && clean(deepText(id))) || (el.closest('label') && clean(deepText(el.closest('label')))) || el.getAttribute('placeholder') || hostLab || el.getAttribute('title') || el.getAttribute('alt') || clean(el.innerText) || (el.shadowRoot || el.querySelector('slot') ? clean(deepText(el)) : '') || (tagOf(el) === 'input' && /^(button|submit|reset)$/.test(el.type) ? el.value : '') || el.getAttribute('name') || ''); };
  // Each line is kept with where it sits: rank 0 an open dialog or the focused control, 1 a control on screen, 2 text on screen, 3 within one screen height of the view, 4 the rest.
  // The top of the outline holds the best ranks, printed in page order; the other lines follow after a marker, also in page order.
  const push = (s, el, kind, dlg) => { if (len > MAX) return;
    const r = (boxOf(el) || el).getBoundingClientRect(), on = r.bottom > 0 && r.top < VH && r.right > 0 && r.left < VW, near = r.bottom > -VH && r.top < 2 * VH && r.right > -VW / 2 && r.left < 1.5 * VW;
    const rank = dlg || (kind === 'i' && el === deepActive()) ? 0 : on ? (kind === 'i' ? 1 : 2) : near ? 3 : 4;
    out.push({ s, rank, where: on || near ? 'near' : r.bottom <= 0 ? 'above' : r.top >= VH ? 'below' : 'side' }); len += s.length + 1; };
  const countInter = (el, d = 0) => { let k = el.matches(INTER) ? 1 : 0; const all = [el, ...el.querySelectorAll('*')]; k += el.querySelectorAll(INTER).length; if (d < 8) for (const x of all) if (x.shadowRoot) for (const y of x.shadowRoot.children) k += countInter(y, d + 1); return k; };
  const kidsOf = (node) => [...node.children];
  // A <slot> has no box. What it shows is the light DOM nodes assigned to it (elements and bare text), or its own fallback content when none are assigned; nested slots are flattened.
  const walkSlot = (slot, dlg) => { let nodes = []; try { nodes = slot.assignedNodes({ flatten: true }); } catch {} for (const nd of nodes) { if (nd.nodeType === 3) { const t = clean(nd.textContent, 300); if (t.length > 1) push(t, slot, 't', dlg); } else if (nd.nodeType === 1) walkList([nd], dlg); } };
  const walk = (node, dlg) => walkList(kidsOf(node), dlg);
  const walkList = (list, dlg) => {
    if (len > MAX) return;
    for (const el of list) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'svg', 'template', 'head'].includes(tag)) continue;
      if (tag === 'slot') { walkSlot(el, dlg); continue; }
      if (el.getAttribute('aria-hidden') === 'true') { hid.aria += countInter(el); continue; }
      const lab = (tag === 'input' && ['checkbox', 'radio'].includes(el.type)) ? (el.closest('label') || (el.id && rootOf(el).querySelector('label[for="' + CSS.escape(el.id) + '"]'))) : null;
      const hostSeen = inShadow(el) && el.matches(INTER) && (() => { let h = rootOf(el).host; for (let k = 0; h && k < 8 && !vis(h); k++) h = rootOf(h) !== document ? rootOf(h).host : h.parentElement; return !!h && h !== document.body; })() && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';   // a field inside a visible web component, drawn with no box of its own
      if (!vis(el) && !(lab && vis(lab)) && !hostSeen && !['details'].includes(tag)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none') { hid.css += countInter(el); continue; }
        if (el.matches(INTER)) hid[cs.visibility === 'hidden' || cs.opacity === '0' ? 'css' : 'zero']++;
        if (el.children.length || el.shadowRoot) walkInside(el, dlg); continue; }
      let d = dlg; if (!dlg && el.matches(DLG)) { d = true; push('[open dialog "' + label(el) + '"]', el, 'h', true); }
      if (el.matches(INTER)) {
        const ref = refOf(el); n++; el.setAttribute('data-1hc', ref);
        const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (el.type || 'text') + ' input' : tag);
        let extra = '';
        if (tag === 'input' && ['checkbox', 'radio'].includes(el.type)) extra = el.checked ? ' (checked)' : ' (unchecked)';
        else if (tag === 'input' || tag === 'textarea') { const ac = [el.getAttribute('autocomplete'), el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' '); const hide = IN_FRAME || el.type === 'password' || /cc-|card|cvc|cvv|cvn|csc|exp|\bpan\b/i.test(ac) || /^\d[\d\s.-]{11,}$/.test(el.value || '');
          extra = el.value ? ' value="' + (hide ? '•••• (filled)' : clean(el.value, 60)) + '"' : ''; }
        else if (tag === 'select') extra = ' selected="' + clean(el.options[el.selectedIndex]?.text, 60) + '" options: ' + [...el.options].slice(0, 12).map((o) => clean(o.text, 30)).join(' | ');
        if ((role === 'combobox' || el.getAttribute('list') || (tag === 'input' && backingSelect(el))) && tag !== 'select') {
          if (tag !== 'input' && tag !== 'textarea') { const t = clean(el.innerText, 60); if (t) extra += ' value="' + t + '"'; }
          const co = pickOpts(comboOpts(el)); if (co.length) extra += ' options: ' + co.join(' | '); }
        if (el.disabled) extra += ' (disabled)';
        { const hp = el.getAttribute('aria-haspopup'); if (hp && hp !== 'false') extra += ' (has popup)'; if (el.getAttribute('aria-expanded') === 'false') extra += ' (collapsed)'; }
        if (role === 'slider' && tag !== 'input') { const v = el.getAttribute('aria-valuenow'); if (v) extra += ' value="' + clean(v, 20) + '"'; }
        { const acv = (tag === 'input' || tag === 'textarea') && el.getAttribute('autocomplete'); if (acv && /^cc-|postal-code|^name$/.test(acv)) extra += ' autocomplete=' + acv.slice(0, 20); }
        push('[' + ref + '] ' + role + ' "' + label(el) + '"' + extra + (tag === 'a' ? ' → ' + clean(el.getAttribute('href'), 80) : ''), lab && !vis(el) ? lab : el, 'i', d);
        if (tag === 'select' || tag === 'a' || tag === 'button') continue;
      } else if (/^h[1-6]$/.test(tag)) { push('#'.repeat(+tag[1]) + ' ' + clean(el.innerText, 160), el, 't', d); continue; }
      else if (tag === 'iframe') { push('[iframe ' + clean(el.getAttribute('title') || el.src, 80) + ' — its contents are not readable here; use the live view]', el, 'i', d); continue; }
      let text = ''; for (const c of el.childNodes) if (c.nodeType === 3) text += c.textContent;
      text = clean(text, 300); if (text.length > 1 && !(el.shadowRoot && el.shadowRoot.querySelector('slot'))) push(text, el, 't', d);   // a host's own text shows through its slot, listed there
      walkInside(el, d);
    }
  };
  const walkInside = (el, d) => { if (el.shadowRoot) { walk(el.shadowRoot, d); if (el.children.length && !el.shadowRoot.querySelector('slot')) walk(el, d); } else walk(el, d); };
  walk(document.body || document.documentElement, false);
  // Pick what goes first: best rank first until the budget is used, then print the pick and the rest, each in page order.
  let pick = out.map(() => true), left = { near: 0, above: 0, below: 0, side: 0 };
  if (len > BUDGET) { pick = out.map(() => false); let used = 0; for (let r = 0; r <= 4; r++) for (let i = 0; i < out.length; i++) if (out[i].rank === r && !pick[i] && used + out[i].s.length + 1 <= BUDGET) { pick[i] = true; used += out[i].s.length + 1; } }
  const first = [], rest = []; out.forEach((o, i) => { if (pick[i]) first.push(o.s); else { rest.push(o.s); left[o.where]++; } });
  let sig = 5381; for (const o of out) for (let i = 0; i < o.s.length; i++) sig = ((sig * 33) ^ o.s.charCodeAt(i)) >>> 0;
  return { url: location.href, title: document.title, refs: n, truncated: len > MAX, text: first.join('\n'), rest: rest.join('\n'), total: out.length, shown: first.length, left, hidden: hid, sig: sig + ':' + out.length };
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
      if (d.method === "Target.attachedToTarget" && d.params.targetInfo.type === "iframe") { c.frames.set(d.params.targetInfo.targetId, { session: d.params.sessionId, id: d.params.targetInfo.targetId, url: d.params.targetInfo.url });
        for (const m of ["Page.enable", "Network.enable"]) c.send(m, {}, 10e3, d.params.sessionId).catch(() => {}); }   // navigations, requests and dialogs inside the frame reach the effects list
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
const OUTLINE_CHARS = 22000, FIRST_CHARS = 18000;   // the first part of the outline (best-ranked lines) is kept under the size of one window
const snapJS = (c, prefix = "") => SNAPSHOT_JS.replace("__WANT__", () => JSON.stringify(c.want || [])).replace("__REFP__", () => JSON.stringify(prefix)).replace("__BUDGET__", String(FIRST_CHARS));
const FRAME_JS = (n, c) => snapJS(c, `f${n}`);
// The outline is cut into windows of lines, never in the middle of a line. The refs stay valid on the whole page, so a ref listed further
// down can be used by browser_act without reading its window first; from_line reads a later window. The hash is of the whole outline.
// <outline-build>
// The outline text is: one header line when something is left out (counts by reason and how to read more), the lines picked to come first
// (open dialog and focused control, then controls and text on screen, then lines near the view, filled up to the budget; page order), then
// frames, then a marker and the remaining lines (page order). Pure functions, loaded by test/browser-outline.test.mjs between the markers.
const OUTLINE_MARK = "[the lines below are further down the page or off screen, in page order; their refs already work in browser_act]";
const hiddenWords = (h) => [["hidden by style", h.css], ["aria-hidden", h.aria], ["zero size", h.zero]].filter(([, n]) => n > 0).map(([w, n]) => `${w} ${n}`).join(", ");
function outlineHeader(meta, fromLine) {
  const rest = meta.total - meta.shown, h = meta.hidden || {}, hn = (h.css || 0) + (h.aria || 0) + (h.zero || 0);
  if (!rest && !hn) return "";
  const bits = [];
  if (rest) {
    const l = meta.left || {}, why = [["near the screen", l.near], ["below the screen", l.below], ["above the screen", l.above], ["to the side", l.side]].filter(([, n]) => n > 0).map(([w, n]) => `${n} ${w}`).join(", ");
    bits.push(`${meta.shown} of ${meta.total} lines come first (open dialog and focused control, then what is on screen, then what is near; page order within that). ${rest} more line${rest === 1 ? "" : "s"} follow after a marker: ${why}. To read them call browser_snapshot with from_line: ${fromLine}`);
  } else bits.push(`all ${meta.total} lines are listed`);
  if (hn) bits.push(`not listed: ${hn} hidden control${hn === 1 ? "" : "s"} (${hiddenWords(h)})`);
  return `[outline: ${bits.join("; ")}]`;
}
// Put the pieces together. main = the page's own pick ({ text, rest, total, shown, left, hidden }), extra = frame text already formatted. Returns { text, header }.
function assembleOutline(main, extra) {
  const first = main.text + (extra || ""), pre = first.split("\n").length;
  const header = outlineHeader(main, (outlineHeader(main, 0) ? 1 : 0) + pre);
  const body = first + (main.rest ? `\n${OUTLINE_MARK}\n${main.rest}` : "");
  return { text: header ? `${header}\n${body}` : body, header };
}
// What changed between two outlines of the same tab. A line with a ref is matched by its ref (so a changed value or label is "changed"); other lines are matched by their text.
const outlineLines = (full) => String(full || "").split("\n").filter((l) => l && !/^\[outline: /.test(l) && l !== OUTLINE_MARK);
function diffOutline(prev, cur) {
  const refOf = (l) => l.match(/^\[((?:f\d+)?e\d+)\] /)?.[1];
  const pm = new Map(), cm = new Map(), pt = new Map(), ct = new Map();
  for (const l of prev) { const r = refOf(l); if (r) pm.set(r, l); else pt.set(l, (pt.get(l) || 0) + 1); }
  for (const l of cur) { const r = refOf(l); if (r) cm.set(r, l); else ct.set(l, (ct.get(l) || 0) + 1); }
  const added = [], changed = [], removed = [], pt2 = new Map(pt), ct2 = new Map(ct);
  for (const l of cur) { const r = refOf(l); if (r) { if (!pm.has(r)) added.push(l); else if (pm.get(r) !== l) changed.push(l); } else if ((pt.get(l) || 0) < (ct.get(l) || 0)) { added.push(l); ct.set(l, ct.get(l) - 1); } }
  for (const l of prev) { const r = refOf(l); if (r) { if (!cm.has(r)) removed.push(l); } else if ((ct2.get(l) || 0) < (pt2.get(l) || 0)) { removed.push(l); pt2.set(l, pt2.get(l) - 1); } }
  return { added, changed, removed };
}
const CHANGE_CAP = 60;
function formatChanges(d, total) {
  const sec = (name, ls) => ls.length ? `${name}:\n${ls.slice(0, CHANGE_CAP).join("\n")}${ls.length > CHANGE_CAP ? `\n(and ${ls.length - CHANGE_CAP} more)` : ""}\n` : "";
  const body = sec("Added", d.added) + sec("Changed (as they are now)", d.changed) + sec("Removed (no longer on the page)", d.removed);
  return `[outline changes since your last look at this tab; the whole outline has ${total} lines and browser_snapshot lists it. Refs you already have still work unless listed as removed]\n` + (body || "No outline line changed.\n");
}
// The text of the change list, or null when the whole outline should be returned (no earlier outline, another page, or a list longer than the outline).
function changesFor(prev, cur) {
  if (!prev || !cur || prev.url !== cur.url || !prev.lines?.length) return null;
  const text = formatChanges(diffOutline(prev.lines, cur.lines), cur.lines.length);
  return text.length >= cur.size ? null : text;
}
// </outline-build>
const seenOutline = new Map();   // target id -> { url, lines, size }: the last outline given out for that tab
const strip = (u) => String(u || "").replace(/[?#]$/, "");
const outlineRec = (o) => ({ url: strip(o.url), lines: outlineLines(o.full), size: o.snapshot.length });
const remember = (c, o) => { if (!c?.targetId || !o?.full) return; seenOutline.set(c.targetId, outlineRec(o)); if (seenOutline.size > 100) seenOutline.delete(seenOutline.keys().next().value); };
async function snapshot(c, from = 0) {
  const s = await evalJS(c, snapJS(c));
  let extra = "", sigs = s.sig || "";
  for (const f of await frames(c).catch(() => [])) {
    try {
      const r = await evalJS(c, FRAME_JS(f.n, c), f);
      if (!r || (!r.refs && !String(r.text || "").trim() && !String(r.rest || "").trim())) continue;   // invisible frames with nothing to read (analytics, captcha shells) are left out; a frame with only text is listed
      extra += `\n--- inside frame f${f.n} (${(() => { try { return new URL(f.url).host; } catch { return ""; } })()}) ---\n${r.text}${r.rest ? `\n${OUTLINE_MARK}\n${r.rest}` : ""}`; sigs += "|" + (r.sig || "");
    } catch {}
  }
  const fix = (t) => t.replace(/\[iframe ([^\]]*?) — its contents are not readable here; use the live view\]/g, "[iframe $1 — its text and fields are listed below, if it has any]");
  if (extra) { s.text = fix(s.text); if (s.rest) s.rest = fix(s.rest); }
  const text = assembleOutline(s, extra).text + (s.truncated ? "\n[the page has more elements than the outline holds; the rest of the page is not listed]" : "");
  const lines = text.split("\n"), start = Math.max(0, Math.min(lines.length, Math.floor(Number(from)) || 0)), out = []; let size = 0;
  for (let i = start; i < lines.length; i++) { if (out.length && size + lines[i].length + 1 > OUTLINE_CHARS) break; out.push(lines[i]); size += lines[i].length + 1; }
  const next = start + out.length;
  let shown = out.join("\n");
  if (start > 0) shown = `[outline lines ${start + 1} to ${next} of ${lines.length}]\n` + shown;
  if (next < lines.length) shown += `\n[outline continues: ${lines.length - next} more line(s) not shown here. Their refs already work in browser_act. To read them, call browser_snapshot with from_line: ${next}]`;
  const o = { url: s.url, title: s.title, snapshot: shown };
  // The hash is of a fingerprint of the page's lines in page order: the order the lines are printed in changes when the page scrolls, and the page has not changed then.
  Object.defineProperty(o, "full", { value: text }); Object.defineProperty(o, "hash", { value: crypto.createHash("sha1").update(sigs).digest("hex") });   // not sent to the Worker
  return o;
}
// Finds the sign-in fields on the page the way a person would: the visible password field, and the username or email field that goes with it, also inside open shadow roots.
// Only fields the last snapshot gave a ref to are looked at (visible ones). Answers refs and never values. No password field on the page (a first step that asks only
// for the email) still finds the one username or email field.
const FIND_LOGIN_JS = String.raw`(() => {
  const all = []; const collect = (root, d) => { for (const e of root.querySelectorAll('[data-1hc]')) all.push(e); if (d < 8) for (const e of root.querySelectorAll('*')) if (e.shadowRoot) collect(e.shadowRoot, d + 1); }; collect(document, 0);
  const inputs = all.filter((e) => /^(input|textarea)$/i.test(e.tagName) && !e.disabled && !e.readOnly);
  const order = new Map(); { let i = 0; const ord = (root, d) => { for (const e of root.querySelectorAll('*')) { order.set(e, i++); if (d < 8 && e.shadowRoot) ord(e.shadowRoot, d + 1); } }; ord(document, 0); }
  const labelOf = (e) => { const r = e.getRootNode(); const l = (e.id && r.querySelector && r.querySelector('label[for="' + CSS.escape(e.id) + '"]')) || e.closest('label'); const h = r && r.host ? [r.host.getAttribute('label'), r.host.getAttribute('aria-label'), r.host.getAttribute('name'), r.host.getAttribute('placeholder')].join(' ') : '';
    let lt = ''; if (l) { const dt = (n, k) => { if (k > 10) return ''; if (n.nodeType === 3) return n.textContent; if (n.nodeType !== 1) return ''; const kids = n.localName === 'slot' ? n.assignedNodes({ flatten: true }) : n.shadowRoot ? n.shadowRoot.childNodes : n.childNodes; let o = ''; for (const c of kids) o += ' ' + dt(c, k + 1); return o; }; lt = dt(l, 0); }
    return [e.getAttribute('aria-label'), lt, e.placeholder, h].join(' '); };
  const hints = (e) => [e.getAttribute('autocomplete'), e.name, e.id, labelOf(e)].join(' ').toLowerCase();
  const pw = inputs.filter((e) => e.type === 'password').sort((a, b) => (/current-password/.test(b.autocomplete) ? 1 : 0) - (/current-password/.test(a.autocomplete) ? 1 : 0) || order.get(a) - order.get(b));
  const password = pw[0] || null;
  const BAD = /search|captcha|otp|one-time|verification|\bcode\b|first.?name|last.?name|zip|postal|card|cvc|phone-?code|new-password|confirm|coupon|promo/;
  const cand = inputs.filter((e) => e !== password && !/^(password|checkbox|radio|file|submit|button|reset|hidden|image|search|number|date|range|color)$/.test(e.type) && !BAD.test(hints(e)));
  const scored = cand.map((e) => { const h = hints(e); let sc = 0; if (/\busername\b|\bemail\b|webauthn/.test(e.getAttribute('autocomplete') || '')) sc += 10; if (e.type === 'email') sc += 4;
    if (/user|e-?mail|login|account|identifier|phone|mobile|member/.test(h)) sc += 5;
    if (password) { if (e.form && e.form === password.form) sc += 3; if (e.getRootNode() === password.getRootNode()) sc += 1; const o1 = order.get(e), o2 = order.get(password); if (o1 < o2) sc += 2; if (o1 < o2 && o2 - o1 < 80) sc += 1; }
    return { e, sc }; }).sort((a, b) => b.sc - a.sc);
  let username = null;
  if (scored.length && (scored[0].sc >= (password ? 3 : 5))) username = scored[0].e;
  const ref = (e) => (e ? e.getAttribute('data-1hc') : null);
  return { username: ref(username), password: ref(password) };
})()`;
const BOX_JS = (ref) => `(() => { let e = ${DQ(String(ref).replace(/[^a-z0-9]/gi, ""))}; if (!e) return null; const r0 = e.getBoundingClientRect(); if ((r0.width < 2 || r0.height < 2 || getComputedStyle(e).opacity === '0') && e.type && /checkbox|radio/.test(e.type)) e = e.closest('label') || document.querySelector('label[for="' + CSS.escape(e.id) + '"]') || e; { const rt = e.getRootNode && e.getRootNode(); const q0 = e.getBoundingClientRect(); if ((q0.width < 2 || q0.height < 2) && rt && rt.host) { let h = rt.host; while (h && h.getBoundingClientRect().width < 2) { const r2 = h.getRootNode && h.getRootNode(); h = r2 && r2.host ? r2.host : h.parentElement; } if (h) e = h; } } e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, tag: e.tagName.toLowerCase() }; })()`;
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
  if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) await evalJS(c, `(() => { const e = ${DQ(String(ref).replace(/[^a-z0-9]/gi, ""))}; e && e.click(); })()`, p.fr);
  else await click(c, p.x, p.y);
}
// select {ref, text} on a dropdown that is not a native SELECT (combobox, listbox, jQuery-UI style list, often backed by a hidden select).
// Opens the list if needed, finds the item by exact then case-insensitive text (also in a backing select), scrolls it into view, clicks it with a
// real mouse click, then reads back what the page shows and reports it (a mismatch is text, never an error). The ref can be the input or its arrow button.
// <choice-read> (test/browser-choice-read.test.mjs loads the text between the choice-read and choice-judge markers; keep each block free of outside names)
const CUSTOM_JS = (ref, want, step) => String.raw`(() => {
  const want = ${JSON.stringify(want)}, step = ${JSON.stringify(step)};
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim(), lo = (s) => norm(s).toLowerCase();
  let e = ${DQ(String(ref).replace(/[^a-z0-9]/gi, ""))}; if (!e) return { error: 'gone' };
  if (!e.matches('input,select,textarea,[role=combobox]')) { const p = e.parentElement; const c = p && p.querySelector('input:not([type=hidden]),[role=combobox]'); if (c) e = c; }
  const vis = (x) => { const r = x.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(x); return s.visibility !== 'hidden' && s.display !== 'none'; };
  let bs = null; for (let p = e.parentElement, k = 0; p && k < 3 && !bs; p = p.parentElement, k++) { const ss = p.querySelectorAll('select'); if (ss.length === 1) bs = ss[0]; else if (ss.length > 1) break; }
  const scopes = []; for (const id of ((e.getAttribute('aria-controls') || '') + ' ' + (e.getAttribute('aria-owns') || '')).split(/\s+/)) { const x = id && document.getElementById(id); if (x) scopes.push(x); }
  const items = () => { let l = []; for (const s of scopes) l = l.concat([...s.querySelectorAll('[role=option],li,[role=menuitem]')]);
    if (!l.length) l = [...document.querySelectorAll('[role=option],.ui-menu-item,[role=listbox] li')];
    return l.filter(vis); };
  if (step === 'find') {
    document.querySelectorAll('[data-1hc-opt]').forEach((x) => x.removeAttribute('data-1hc-opt'));
    const l = items(); const hit = l.find((x) => norm(x.textContent) === norm(want)) || l.find((x) => lo(x.textContent) === lo(want));
    if (!hit) return { found: false, open: l.length, backing: !!bs && [...bs.options].some((o) => lo(o.text) === lo(want) || o.value === want) };
    hit.scrollIntoView({ block: 'center', inline: 'center' }); hit.setAttribute('data-1hc-opt', '1'); const b = hit.getBoundingClientRect();
    return { found: true, x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  if (step === 'backing') {   // no visible item: set the backing select directly and show the text in the visible field
    const o = bs && [...bs.options].find((o) => lo(o.text) === lo(want) || o.value === want); if (!o) return false;
    bs.value = o.value; bs.dispatchEvent(new Event('input', { bubbles: true })); bs.dispatchEvent(new Event('change', { bubbles: true }));
    if ('value' in e && e.tagName === 'INPUT') { e.value = o.text.trim(); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  if (step === 'click') { const x = document.querySelector('[data-1hc-opt]'); x && x.click(); return !!x; }
  if (step === 'read') {   // what the page shows after the pick: the field's own value, the control's displayed value element, the marked option, the backing select
    const shown = [e.value, e.innerText, e.getAttribute('aria-valuetext')].map(norm).filter(Boolean);
    const sel = bs && bs.selectedIndex >= 0 ? norm(bs.options[bs.selectedIndex].text) : '';
    const NEAR = '[class*="single-value" i],[class*="singleValue" i],[class*="selected-value" i],[class*="selectedValue" i],[class*="chosen" i],[class*="multi-value__label" i],[class*="multiValue" i]';
    const near = []; for (let p = e, k = 0; p && k < 4 && !near.length; p = p.parentElement, k++) for (const x of p.querySelectorAll(NEAR)) { if (!vis(x) || x.closest('[role=listbox]') || /placeholder/i.test(String(x.className))) continue; const t = norm(x.innerText || x.textContent); if (t) near.push(t); }
    const marked = []; for (const s of scopes) for (const x of s.querySelectorAll('[aria-selected="true"]')) { const t = norm(x.textContent); if (t) marked.push(t); }
    document.querySelectorAll('[data-1hc-opt]').forEach((x) => x.removeAttribute('data-1hc-opt'));
    return { shown, near: near.slice(0, 5), marked: marked.slice(0, 5), backing: sel };
  }
})()`;
// </choice-read>
async function chooseCustom(c, a, fs_) {
  const want = String(a.text ?? ""), r = (step) => evalJS(c, CUSTOM_JS(a.ref, want, step), fs_);
  if (!want) throw new Error(`select needs text: the choice to pick in ${a.ref}`);
  let f = await r("find");
  if (f.error) throw new Error(`no element ${a.ref} on the page now — take a new snapshot`);
  if (!f.found) {   // the list is closed: open it, then look again
    try { await clickRef(c, a.ref); } catch {}
    await sleep(350); f = await r("find");
  }
  if (!f.found && !f.backing) {   // an autocomplete list that filters as you type
    try { await fillField(c, { ref: a.ref, text: want }, "fill", false); } catch {}
    await sleep(500); f = await r("find");
  }
  let how;
  if (f.found) {
    if (fs_) await r("click");
    else { const p = { x: f.x, y: f.y }; if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) await r("click"); else await click(c, p.x, p.y); }
    how = "clicked the item";
  } else if (f.backing && await r("backing")) how = "set the backing select";
  else throw new Error(`could not find "${want}" in the dropdown ${a.ref}${f.open ? ` (the open list has ${f.open} items, none with that text; use the exact text of a choice)` : " (the list did not open or has no such item)"}`);
  await sleep(300);
  return describePick(want, a.ref, how, judgeChoice(want, await r("read")));
}
// <choice-judge>
// What the page shows after a pick, decided from the text read in the page. Pure. v = { shown: [], near: [], marked: [], backing: "" }.
// The field's own value, the control's displayed value element (React-Select style controls show the choice in a sibling element, and the
// input stays empty), the option marked selected and the backing select all count. A mismatch is reported as text, never thrown,
// because the page may show the choice somewhere the read did not look.
function judgeChoice(want, v) {
  const norm = (x) => String(x || "").replace(/\s+/g, " ").trim(), lo = (x) => norm(x).toLowerCase(), w = lo(want);
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []).map(norm).filter(Boolean);
  const shown = arr(v?.shown), near = arr(v?.near), marked = arr(v?.marked), backing = norm(v?.backing);
  const hold = (t) => w.length >= 3 && lo(t).includes(w);   // a displayed item such as "Western Governors University (WGU)" holds the wanted text
  const where = shown.some((t) => lo(t) === w) ? "the field" : near.some((t) => lo(t) === w || hold(t)) ? "the displayed value" : marked.some((t) => lo(t) === w || hold(t)) ? "the marked option" : lo(backing) === w ? "the hidden list behind the field" : "";
  return { ok: !!where, where, seen: near[0] || shown[0] || marked[0] || backing || "" };
}
function describePick(want, ref, how, j) {
  if (j.ok) return `chose "${want}" in ${ref} (${how}; the page shows it in ${j.where})`;
  return `picked "${want}" in ${ref} (${how}), but the page does not clearly show it: ${j.seen ? `the field area shows "${j.seen.slice(0, 60)}"` : "no selected text was visible next to the field"}. Take a new snapshot to check before picking again; many dropdowns show the choice somewhere else on the page.`;
}
// </choice-judge>
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
  const fr = await frameOf(c, a.ref), session = fr?.session, sel = `${DQ(String(a.ref).replace(/[^a-z0-9]/gi, ""))}`;
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
const ORIG_JS = (ref) => `(() => { const e = ${DQ(String(ref).replace(/[^a-z0-9]/gi, ""))}; if (!e) return null; const r = e.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, hint: [e.getAttribute('autocomplete'), e.name, e.id, e.getAttribute('placeholder'), e.getAttribute('aria-label'), e.getAttribute('title')].join(' ') }; })()`;
const STATE_JS = (ref) => `(() => { const e = ${DQ(String(ref).replace(/[^a-z0-9]/gi, ""))}; if (!e || !e.isConnected) return { gone: true }; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); const rt = e.getRootNode && e.getRootNode(), hostOk = !!(rt && rt.host && rt.host.getBoundingClientRect().width >= 2 && s.visibility !== 'hidden' && s.display !== 'none'); return { gone: false, hidden: !hostOk && (r.width < 2 || r.height < 2) || s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0' }; })()`;
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
    const sel = `${DQ(q(ref))}`;
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
// <key-combos> (test/browser-actions.test.mjs loads the text between the key-combos markers; keep it free of outside names)
// A key or a combination: "Enter", "Shift+Tab", "Control+A", "Control+Shift+K", "F5". Modifiers are Control (Ctrl), Shift and Alt (Option).
// This is Linux Chrome, where shortcuts use Control, so Cmd, Command, Meta, Super, Win and CmdOrCtrl in a combination all become Control.
// A letter, digit or symbol is only accepted together with Control or Alt, as a shortcut: plain text goes in with type or fill, so the
// checks on what the person's details look like (cards, passwords, ID numbers) always see it.
const NAMED_KEYS = { Enter: [13, "\r"], Tab: [9, "\t"], Escape: [27], Backspace: [8], Delete: [46], Insert: [45], ArrowDown: [40], ArrowUp: [38], ArrowLeft: [37], ArrowRight: [39], PageDown: [34], PageUp: [33], Home: [36], End: [35], Space: [32, " "] };
for (let i = 1; i <= 12; i++) NAMED_KEYS["F" + i] = [111 + i];
const KEY_ALIASES = { esc: "Escape", return: "Enter", del: "Delete", ins: "Insert", back: "Backspace", spacebar: "Space", pgdn: "PageDown", pgup: "PageUp", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const MOD_ALIASES = { control: "Control", ctrl: "Control", cmd: "Control", command: "Control", meta: "Control", super: "Control", win: "Control", cmdorctrl: "Control", commandorcontrol: "Control", mod: "Control", shift: "Shift", alt: "Alt", option: "Alt", opt: "Alt" };
const MOD_BITS = { Alt: 1, Control: 2, Shift: 8 }, MOD_ORDER = ["Control", "Alt", "Shift"];
const SYMBOLS = { "+": ["Equal", 187], "-": ["Minus", 189], "=": ["Equal", 187], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], ";": ["Semicolon", 186], "'": ["Quote", 222], ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], "\\": ["Backslash", 220], "`": ["Backquote", 192] };
const SHORTCUT_COMMANDS = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo", y: "redo" };
function parseKeyCombo(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("press needs a key, such as Enter, Tab, Control+A or Shift+Tab");
  let key, mods;
  if (raw === "+") { key = "+"; mods = []; }
  else if (raw.endsWith("++")) { key = "+"; mods = raw.slice(0, -2).split("+"); }
  else { const parts = raw.split("+"); key = parts.pop().trim(); mods = parts; }
  const held = new Set();
  for (const m of mods) {
    const name = MOD_ALIASES[m.trim().toLowerCase()];
    if (!name) throw new Error(`unknown modifier "${m}" in "${raw}"; use Control, Shift or Alt`);
    held.add(name);
  }
  const modList = MOD_ORDER.filter((m) => held.has(m));
  if (!key) throw new Error(`no key in "${raw}"`);
  const name = Object.keys(NAMED_KEYS).find((n) => n.toLowerCase() === key.toLowerCase()) || KEY_ALIASES[key.toLowerCase()] || null;
  let def;
  const shortcut = held.has("Control") || held.has("Alt");
  if (name) def = { key: name === "Space" ? " " : name, code: name, vk: NAMED_KEYS[name][0], text: shortcut ? "" : NAMED_KEYS[name][1] || "" };
  else if ([...key].length === 1) {
    if (!shortcut) throw new Error(`press does not type text ("${raw}"). Use type or fill to enter text. press is for keys such as Enter or Tab and shortcuts such as Control+A`);
    const lower = key.toLowerCase();
    if (/^[a-z]$/.test(lower)) def = { key: held.has("Shift") ? lower.toUpperCase() : lower, code: "Key" + lower.toUpperCase(), vk: lower.toUpperCase().charCodeAt(0), text: "", lower };
    else if (/^[0-9]$/.test(key)) def = { key, code: "Digit" + key, vk: 48 + Number(key), text: "" };
    else if (SYMBOLS[key]) def = { key, code: SYMBOLS[key][0], vk: SYMBOLS[key][1], text: "" };
    else throw new Error(`unsupported key "${key}" in "${raw}"`);
  } else throw new Error(`unsupported key "${key}"; use a name such as Enter, Tab, Escape, ArrowDown, PageDown, Backspace, Delete, Home, End, F1 to F12, or a letter with Control or Alt (Control+A)`);
  let command = def.lower && SHORTCUT_COMMANDS[def.lower];
  if (!(command && held.has("Control") && !held.has("Alt"))) command = null;
  if (command && held.has("Shift")) command = def.lower === "z" ? "redo" : null;
  const bits = modList.reduce((n, m) => n | MOD_BITS[m], 0);
  return { mods: modList, bits, key: def.key, code: def.code, vk: def.vk, text: def.text, commands: command ? [command] : [], label: [...modList, name || key].join("+") };
}
// </key-combos>
async function press(c, spec) {
  const p = parseKeyCombo(spec), mk = { Control: ["Control", "ControlLeft", 17], Alt: ["Alt", "AltLeft", 18], Shift: ["Shift", "ShiftLeft", 16] };
  let bits = 0;
  for (const m of p.mods) { bits |= MOD_BITS[m]; const [key, code, vk] = mk[m]; await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: bits }); }
  const base = { key: p.key, code: p.code, windowsVirtualKeyCode: p.vk, modifiers: p.bits };
  await c.send("Input.dispatchKeyEvent", { ...base, type: p.text ? "keyDown" : "rawKeyDown", ...(p.text ? { text: p.text } : {}), ...(p.commands.length ? { commands: p.commands } : {}) });
  await c.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  for (const m of [...p.mods].reverse()) { const [key, code, vk] = mk[m]; bits &= ~MOD_BITS[m]; await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: bits }); }
}
// Mouse steps beyond a plain click: a pointer position from a ref (scrolled into view first) or from x and y (the same 1280x800 page space as click_at).
async function pointOf(c, a, rk, rx, ry, what) {
  if (a[rk] !== undefined && a[rk] !== null && a[rk] !== "") {
    const p = await box(c, a[rk]);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) throw new Error(`${what}: ${a[rk]} is outside the visible screen even after scrolling to it; take a new snapshot`);
    return { x: p.x, y: p.y };
  }
  const x = Number(a[rx]), y = Number(a[ry]);
  if (a[rx] === undefined || a[ry] === undefined || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > W || y > H) throw new Error(`${what} needs ${rk} (a ref from the outline), or ${rx} and ${ry} with x between 0 and ${W} and y between 0 and ${H}`);
  return { x, y };
}
const mouse = (c, type, x, y, extra = {}) => c.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
async function hoverAt(c, x, y) {
  await mouse(c, "mouseMoved", Math.max(0, x - 6), Math.max(0, y - 4)); await mouse(c, "mouseMoved", x, y);
}
async function clickTimes(c, x, y, button, count) {
  await hoverAt(c, x, y);
  for (let n = 1; n <= count; n++) {
    await mouse(c, "mousePressed", x, y, { button, buttons: button === "right" ? 2 : 1, clickCount: n });
    await mouse(c, "mouseReleased", x, y, { button, buttons: 0, clickCount: n });
  }
}
// Press at the start, move in small steps (so sliders, sortable lists and resize handles see a real drag), release at the end. A page that uses HTML5
// drag and drop takes over the drag at the first move: the browser hands the dragged data over (Input.setInterceptDrags), and the drag enter,
// over and drop events are then sent to the end point. Returns true when the page used drag and drop.
async function dragBetween(c, from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(8, Math.min(30, Math.round(dist / 15)));
  let data = null; const onEv = (d) => { if (d.method === "Input.dragIntercepted") data = d.params.data; };
  c.ev.push(onEv);
  try {
    await c.send("Input.setInterceptDrags", { enabled: true }).catch(() => {});
    await hoverAt(c, from.x, from.y);
    await mouse(c, "mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
    await sleep(60);
    for (let i = 1; i <= steps; i++) {
      await mouse(c, "mouseMoved", from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, { button: "left", buttons: 1 });
      if (i === 1) await sleep(30);
      if (data) break;
    }
    if (!data) await sleep(80);
    if (data) {
      const ev = (type) => c.send("Input.dispatchDragEvent", { type, x: to.x, y: to.y, data });
      await ev("dragEnter"); await sleep(40); await ev("dragOver"); await sleep(40); await ev("dragOver"); await ev("drop");
      return true;
    }
    await mouse(c, "mouseReleased", to.x, to.y, { button: "left", buttons: 0, clickCount: 1 });
    return false;
  } finally {
    c.ev = c.ev.filter((x) => x !== onEv);
    await c.send("Input.setInterceptDrags", { enabled: false }).catch(() => {});
  }
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
// What the page shows that the text outline cannot name: big canvases, and big clickable pictures that are not inside a link or button.
// Added to the reply of navigate, snapshot, act and back as "hints" (no extra call), so the app can decide when to look at the screen (src/browser-vision.js).
const VISION_HINTS_JS = "(() => { const vw = innerWidth, vh = innerHeight; const seen = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return 0; const w = Math.min(r.right, vw) - Math.max(r.left, 0), h = Math.min(r.bottom, vh) - Math.max(r.top, 0); if (w <= 0 || h <= 0) return 0; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return 0; return w * h; }; let canvas = 0, clickable_images = 0; for (const e of document.querySelectorAll('canvas')) if (seen(e) >= 20000) canvas++; for (const e of document.querySelectorAll('img,svg,[role=img]')) { if (seen(e) < 40000 || e.closest('a,button,[role=button],[role=link]')) continue; if (getComputedStyle(e).cursor === 'pointer' || e.closest('[onclick]')) clickable_images++; } return { canvas, clickable_images }; })()";
// What is at a screen point, read in plain code (no model): the visible text, aria-label, value, title and alt of the element there and of its
// nearest clickable ancestor. Follows into same-origin frames and open shadow roots. A cross-origin frame, an empty point or any failure
// gives { error }, which the app treats as "do not click". Used by the screenshot op with probe_at: [x, y] (src/browser-vision.js).
const POINT_INFO_JS = "((x, y) => { try { let doc = document, depth = 0, el = null; for (;;) { let e = doc.elementFromPoint(x, y); if (!e) return { error: 'nothing is at that point' }; for (let k = 0; e.shadowRoot && k < 5; k++) { const i = e.shadowRoot.elementFromPoint(x, y); if (!i || i === e) break; e = i; } if (e.tagName === 'IFRAME' || e.tagName === 'FRAME') { let d = null; try { d = e.contentDocument; } catch (_) {} if (!d) return { error: 'the point is inside a cross-origin frame' }; if (++depth > 5) return { error: 'frames nested too deep' }; const r = e.getBoundingClientRect(); x -= r.left + e.clientLeft; y -= r.top + e.clientTop; doc = d; continue; } el = e; break; } const CL = 'a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[onclick]'; const txt = (n) => [n.innerText || n.textContent || '', n.getAttribute('aria-label') || '', n.value || '', n.getAttribute('title') || '', n.getAttribute('alt') || ''].join(' ').replace(/\\s+/g, ' ').trim().slice(0, 200); let anc = null; for (let n = el, k = 0; n && k < 12; k++, n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) { if (n.matches && n.matches(CL)) { anc = n; break; } } return { tag: String(el.tagName).toLowerCase(), text: [txt(el), anc && anc !== el ? txt(anc) : ''].join(' ').trim().slice(0, 400) }; } catch (e) { return { error: String(e && e.message || e).slice(0, 100) }; } })";
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
    // Exit node on: the platform says first whether the exit node can carry the page. A "no" is an error, never a direct load.
    const T = { url: `${u.host}${u.pathname}`.slice(0, 80), exit: exitConf.on, at: Date.now() }, lap = (k) => { T[k] = Date.now() - T.at - (T.sum || 0); T.sum = (T.sum || 0) + T[k]; };
    if (exitConf.on) { const st = await exitStatus(); lap("status_ms"); if (!st.ok) throw new Error(exitMessage(st.reason)); }
    const r = await c.send("Page.navigate", { url: u.href }); lap("navigate_ms");
    if (r.errorText) throw new Error(exitConf.on && /ERR_(TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED|PROXY_)/.test(r.errorText) ? exitMessage(exitSrv?.exitState?.lastReason || "the connection through it failed.") : `navigation failed: ${r.errorText}`);
    await settleNav(c); lap("settle_ms"); const pdf = await savePdfView(c); lap("pdf_ms"); const o = await snapshot(c); lap("snapshot_ms"); remember(c, o);
    T.total_ms = Date.now() - T.at; delete T.sum; lastNav = T; log(`navigate timing ${JSON.stringify(T)}`);
    return { ...o, ...(pdf ? { saved_pdf: pdf.name } : {}) };
  },
  // Where the saved-login fields are on the page now (refs only, never values): the main page and every frame the snapshot gave refs in. The password field wins; the username
  // is taken from the same frame, else from the main page.
  async login_fields(b, c) {
    await snapshot(c);   // marks the visible controls with their refs
    const found = [{ where: null, r: await evalJS(c, FIND_LOGIN_JS).catch(() => ({})) }];
    for (const f of await frames(c).catch(() => [])) { const r = await evalJS(c, FIND_LOGIN_JS, f).catch(() => null); if (r && (r.username || r.password)) found.push({ where: f, r }); }
    const pick = found.find((x) => x.r.password) || found.find((x) => x.r.username) || found[0];
    return { username_ref: pick.r.username || null, password_ref: pick.r.password || null };
  },
  async snapshot(b, c) { if (FAST) await quiet(c, 1.5e3); else if ((await evalJS(c, "document.readyState").catch(() => "complete")) !== "complete") await quiet(c, 2e3);   // a page still loading gets a moment to finish
    const o = await snapshot(c, b.from_line); remember(c, o); return o; },
  async back(b, c, ctx) {
    // A tab a page opened has no history to go back to: close it and return to the task's other tab.
    const rec = tabs.get(ctx.key);
    if (rec && rec.targets.size > 1 && (await evalJS(c, "history.length").catch(() => 2)) <= 1) {
      const id = c.targetId; await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${id}`).catch(() => {}); dropTarget(id);
      const t = (await targets()).find((x) => x.id === rec.current);
      if (t) { const c2 = await connectTarget(t); if (!c2.persistent) ctx.opened.push(c2); await activateTab(rec); await settle(c2); const o = await snapshot(c2); remember(c2, o); return { ...o, closed_tab: true }; }
    }
    await evalJS(c, "history.back()"); await settle(c); const o = await snapshot(c); remember(c, o); return o;
  },
  async screenshot(b, c) {
    const loc = await evalJS(c, "({url: location.href, title: document.title, view: {w: innerWidth, h: innerHeight, scroll_x: Math.round(scrollX), scroll_y: Math.round(scrollY), page_h: Math.round(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))}})").catch(() => ({}));
    // max_width (optional): the picture of the viewport is scaled down to about that many pixels across (the model looks at it; coordinates in the outline do not change).
    if (Array.isArray(b.probe_at)) { const px = Number(b.probe_at[0]), py = Number(b.probe_at[1]); return { url: loc.url, title: loc.title, probe: Number.isFinite(px) && Number.isFinite(py) ? await evalJS(c, `${POINT_INFO_JS}(${px}, ${py})`).catch((e) => ({ error: String(e.message || e).slice(0, 100) })) : { error: "no point" } }; }   // no picture: only what is at the point
    const mw = Number(b.max_width), vw = loc.view?.w || W, vh = loc.view?.h || H;
    const clip = Number.isFinite(mw) && mw >= 200 && mw < vw ? { x: loc.view?.scroll_x || 0, y: loc.view?.scroll_y || 0, width: vw, height: vh, scale: mw / vw } : null;
    const r = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 78, ...(clip ? { clip } : {}) });
    const out = { jpeg_base64: r.data, url: loc.url, title: loc.title, ...(loc.view ? { view: loc.view } : {}) };
    if (b.ocr === true) out.ocr = await ocrJpeg(Buffer.from(r.data, "base64"), loc.view?.w);
    return out;
  },
  async act(b, c, ctx = { key: "", opened: [] }) {
    await browserConn().catch(() => {});   // the connection that reports downloads
    const fx = await startEffects(c);
    try { return await this.actRun(b, c, ctx, fx); } finally { fx.stop(); }
  },
  async actRun(b, c, ctx, fx) {
    const c0 = c, acts = Array.isArray(b.actions) ? b.actions : []; if (!acts.length || acts.length > 20) throw new Error("actions: 1–20 steps");
    let done = 0, uploaded = false, switched = false; const notes = []; const before = await snapshot(c).catch(() => null);
    const prevSeen = seenOutline.get(c.targetId) || (before ? outlineRec(before) : null);   // what this tab's outline was when it was last given out
    fx.reset(); fx.mut0 = await fxMut(c).catch(() => null);   // from here on, everything the page does is the steps' effect
    // A click can open a new tab or window. The opener relationship (onBrowserEvent) put it in this task's tab set and made it current;
    // from then on the rest of this call, and the answer, are about that tab.
    const follow = async () => {
      const rec = tabs.get(ctx.key); if (!rec?.current || rec.current === c.targetId) return false;
      const t = (await targets()).find((x) => x.id === rec.current); if (!t) return false;
      // A tab that turns into a download closes itself while we look at it: keep the task's earlier tab then; the download is in the effects list.
      const prev = c; let c2;
      try { c2 = await connectTarget(t); if (!c2.persistent) ctx.opened.push(c2); c2.want = c.want; c = c2; await activateTab(rec); await settle(c, 10e3); switched = true; return true; }
      catch { c = prev; fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`).catch(() => {}); dropTarget(t.id); const back = [...rec.targets].includes(prev.targetId) ? prev.targetId : rec.current; rec.current = back; return false; }
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
      else if ((kind === "fill" || kind === "type") && (a.ref === undefined || a.ref === null || a.ref === "")) throw new Error(`${kind} needs the ref of the field (from the outline). A field that a click or double click just opened is in the result's outline lines, or take a browser_snapshot to get its ref`);
      else if (kind === "fill" || kind === "type") { await fillField(c, a, kind, !!b.secret); if (a.submit) { await press(c, "Enter"); await settle(c, 8e3); }
      } else if (kind === "select") {
        const fs_ = await frameOf(c, a.ref);
        const ok = await evalJS(c, `(() => { const e = ${DQ(String(a.ref).replace(/[^a-z0-9]/gi, ""))}; if (!e || e.tagName !== 'SELECT') return null; const o = [...e.options].find((o) => o.text.trim() === ${JSON.stringify(String(a.text ?? ""))} || o.value === ${JSON.stringify(String(a.text ?? ""))}); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, fs_);
        if (ok === null) { notes.push(await chooseCustom(c, a, fs_)); await settle(c, 3e3); }   // not a native select: a combobox, listbox or script-made list
        else if (!ok) throw new Error(`could not select "${a.text}" in ${a.ref}`);
            } else if (kind === "press") { await press(c, String(a.key || "Enter")); await settle(c, 8e3); }
      else if (kind === "hover") { const p = await pointOf(c, a, "ref", "x", "y", "hover"); await hoverAt(c, p.x, p.y); await sleep(400); await settle(c, 3e3); }
      else if (kind === "double_click") { const p = await pointOf(c, a, "ref", "x", "y", "double_click"); await clickTimes(c, p.x, p.y, "left", 2); await settle(c, 8e3); }
      else if (kind === "right_click") { const p = await pointOf(c, a, "ref", "x", "y", "right_click"); await clickTimes(c, p.x, p.y, "right", 1); await sleep(250); await settle(c, 3e3); }
      else if (kind === "drag") {
        const from = await pointOf(c, a, "ref", "x", "y", "drag (start)"), to = await pointOf(c, a, "to_ref", "to_x", "to_y", "drag (end)");
        if (Math.hypot(to.x - from.x, to.y - from.y) < 2) throw new Error("drag starts and ends at the same place; give a different end point");
        if (await dragBetween(c, from, to)) notes.push("the page uses drag and drop; the drop was sent to the end point");
        await settle(c, 5e3);
      }
      else if (kind === "scroll") { await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: W / 2, y: H / 2, deltaX: 0, deltaY: a.direction === "up" ? -600 : 600 }); await sleep(400); }
      else if (kind === "wait") { const want = Number(a.ms) || 1000, ms = Math.min(WAIT_MAX, Math.max(0, want)); if (want > WAIT_MAX) notes.push(`wait shortened from ${want} to ${WAIT_MAX} ms (the most one wait step waits; use several wait steps, or check the page between waits)`); await sleep(ms); }
      else if (kind === "upload") { fx.quiet = true; try { notes.push(await upload(c, a)); } finally { fx.quiet = false; await fx.intercept(); } uploaded = true; await settle(c, 8e3); }
      else if (kind === "select_or_fill") {   // expiry month/year can be a dropdown or a text box
        const fs_ = await frameOf(c, a.ref), sel = `${DQ(String(a.ref).replace(/[^a-z0-9]/gi, ""))}`;
        const isSel = await evalJS(c, `(${sel})?.tagName === 'SELECT'`, fs_);
        if (isSel) { const t = JSON.stringify(String(a.text ?? "")); const ok = await evalJS(c, `(() => { const e = ${sel}; const want = ${t}; const o = [...e.options].find((o) => o.value === want || o.text.trim() === want || o.value === String(Number(want)) || o.value.endsWith(want.slice(-2)) && o.value.length <= 4); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, fs_); if (!ok) throw new Error(`could not choose that option in ${a.ref}`); }
        else { a.kind = "fill"; acts.splice(acts.indexOf(a) + 1, 0, a); done--; }
      }
      else throw new Error(`unknown action kind "${kind}" (click, click_at, hover, drag, double_click, right_click, fill, type, select, press, scroll, wait, upload)`);
      done++;
      if (await follow()) { const rest = acts.length - acts.indexOf(a) - 1; notes.push(`this step opened a new tab, and it is now this task's current tab${rest > 0 ? `; the other ${rest} step(s) were not run because their refs belong to the earlier page (use the refs below)` : ""}`); break; }
    }
    // Payment/submit buttons often call an API for several seconds before the page moves on. After clicking one,
    // watch for a navigation for up to 20 s so the result reflects what actually happened.
    // Quiet mode: one general rule for every page. If the steps started a navigation, wait for quiet up to 15 s; otherwise up to 3 s.
    if (FAST) { const n = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries.length; await quiet(c, n > h0 ? 15e3 : 3e3); }
    const lastClick = FAST ? null : [...acts].reverse().find((a) => a.kind === "click");
    if (lastClick && before) {
      const line = before.full.split("\n").find((l) => l.startsWith(`[${lastClick.ref}] `)) || "";
      if (/\b(pay|place order|buy|purchase|submit|confirm|complete order|checkout)\b/i.test(line)) {
        for (let i = 0; i < 20; i++) { const n = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries.length; if (n > h0) { await settle(c, 10e3); break; } await sleep(1000); }
      }
    }
    // Anything the steps started is collected here: a window the page tried to open, a download, requests still in flight.
    const late = async () => { const popups = await openBlocked(fx, ctx); if (popups.length) fx.popups = [...(fx.popups || []), ...popups];
      await follow(); };   // a tab opened late (a timer, a slow redirect) or one made for a blocked window
    const collect = async (after) => {
      let mut = 0; if (!switched) { try { mut = mutDiff(fx.mut0, await fxMut(c0)); } catch {} }
      const d = dlSince(fx.t0), dialogs = c0.dialogs.filter((x) => x.at >= fx.t0);
      const e = { outline_changed: !!(before && after && before.hash !== after.hash), address_changed: !!(before && after && before.url.replace(/[?#]$/, "") !== after.url.replace(/[?#]$/, "")),
        ...(uploaded ? { uploaded: true } : {}), ...(switched ? { new_tab: true } : {}),
        ...(d.length ? { downloads: d.map((r) => ({ name: r.name, bytes: r.bytes || r.total || 0, state: r.state === "inProgress" ? "in_progress" : r.state })) } : {}),
        ...(fx.navs.length ? { navigations: fx.navs.slice(0, 6) } : {}), ...(fx.popups?.length ? { popups_blocked: fx.popups.slice(0, 3), popup_opened_for_you: fx.blockedOpened.length > 0 } : {}),
        ...(dialogs.length ? { dialogs: dialogs.map(({ type, message, handled }) => ({ type, message, handled })) } : {}), ...(fx.chooser ? { file_chooser: true } : {}),
        ...(fx.errs.length ? { page_errors: fx.errs.slice(0, 3) } : {}), ...(fx.reqs.length ? { requests: { count: fx.reqs.length, items: fx.reqs.slice(0, 4) } } : {}), ...(mut ? { mutations: mut } : {}) };
      e.visible = !!(e.outline_changed || e.address_changed || e.uploaded || e.new_tab || e.downloads || e.navigations || e.popups_blocked || e.dialogs || e.file_chooser);
      return e;
    };
    await late();
    let after = await snapshot(c), eff = await collect(after);
    // No visible effect yet: give the page time (12 s, and while a request is still in flight up to 40 s), then look again.
    const w0 = Date.now();
    for (let i = 0; !(FAST || switched) && before && !eff.visible && (Date.now() - w0 < 12e3 || (fx.open.size > 0 && Date.now() - w0 < 40e3)); i++) { await sleep(2000); await late(); after = await snapshot(c); eff = await collect(after); }
    await waitDownloads(fx.t0, DL_WAIT);
    if (dlSince(fx.t0).length) eff = await collect(after);   // the finished state and size
    if (switched || eff.new_tab) { const pdf = await savePdfView(c); if (pdf) { eff.pdf_saved = pdf.name; eff.visible = true; } }
    else { const pdf = eff.outline_changed || eff.address_changed ? await savePdfView(c) : null; if (pdf) { eff.pdf_saved = pdf.name; eff.visible = true; } }
    if (eff.pdf_saved) { await waitDownloads(fx.t0, 1e3); }
    // Pages passed through during the steps (e.g. /checkout/success before an automatic redirect home).
    const hist = switched ? [] : (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries;
    const visited = hist.slice(Math.max(0, h0 - 1)).map((e) => e.url).filter((u, i, a) => u !== a[i - 1]);
    // Only what changed in the outline, unless this is a new page or tab, or the change list is not shorter than the whole outline. The full outline stays in `snapshot`.
    const cur = outlineRec(after); let outline_changes = null;
    if (!switched && !eff.address_changed && !eff.navigations?.some((x) => x.main && !x.same)) outline_changes = changesFor(prevSeen, cur);
    seenOutline.set(c.targetId, cur);
    return { completed: done, page_changed: eff.visible, effects: eff, ...(outline_changes ? { outline_changes } : {}), ...(switched ? { new_tab: true } : {}), ...(notes.length ? { notes } : {}), ...(visited.length > 1 ? { visited } : {}), ...after };
  },
};

const MIME = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  try {
    if (u.pathname === "/health") return send(200, { ok: true });
    // The setting changed (or the computer just woke): read the file again. Chrome only reads its proxy at launch, so a change stops it,
    // and the next browser call starts it again with or without the exit proxy (it reopens the last page).
    if (u.pathname === "/exit-mode" && req.method === "POST") {
      let body = ""; for await (const ch of req) body += ch; const b = body ? JSON.parse(body) : {};
      const next = { on: b.on === true, direct: Array.isArray(b.direct) ? b.direct.map((h) => String(h).toLowerCase()).slice(0, 200) : [] };
      fs.writeFileSync(EXIT_CONF, JSON.stringify(next));
      const changed = next.on !== exitConf.on || JSON.stringify(next.direct) !== JSON.stringify(exitConf.direct);
      if (changed && procs.chrome) { const p = procs.chrome; p.kill("SIGTERM"); await waitFor(() => procs.chrome !== p, 8e3, "Chrome stop").catch(() => { try { p.kill("SIGKILL"); } catch {} delete procs.chrome; }); }
      exitConf = next; if (!next.on) stopExitProxy();
      return send(200, { ok: true, on: next.on, restarted: changed });
    }
    const nv = u.pathname.match(/\/novnc\/(.+)$/);
    if (nv) {
      const f = path.normalize(path.join(NOVNC, nv[1])); if (!f.startsWith(NOVNC + "/") || !fs.existsSync(f)) return send(404, { error: "not found" });
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "public, max-age=3600" }); return fs.createReadStream(f).pipe(res);
    }
    const m = u.pathname.match(/^\/cdp\/([a-z_]+)$/);
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
          c.want = Array.isArray(b.want) ? b.want.slice(0, 20).map((x) => String(x).slice(0, 80)) : [];   // values the job needs: the outline lists matching dropdown choices
          const out = await OPS[m[1]](b, c, ctx);
          if (/^(navigate|snapshot|act|back)$/.test(m[1]) && out && /^https?:/.test(out.url || "")) { const h = await Promise.race([evalJS(c, VISION_HINTS_JS), new Promise((z) => setTimeout(() => z(null), 1500))]).catch(() => null); if (h) out.hints = h; }
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
  const port = u.searchParams.get("mode") === "control" ? VNC_CTL : VNC_VIEW;
  wss.handleUpgrade(req, sock, head, (ws) => {
    const t = net.connect(port, "127.0.0.1"); t.setNoDelay(true);
    t.on("data", (d) => ws.readyState === 1 && ws.send(d));
    ws.on("message", (d) => t.write(d));
    const end = () => { try { t.destroy(); } catch {} try { ws.close(); } catch {} };
    t.on("close", end); t.on("error", end); ws.on("close", end); ws.on("error", end);
  });
});
server.listen(PORT, "0.0.0.0", () => log(`listening on ${PORT}`));
