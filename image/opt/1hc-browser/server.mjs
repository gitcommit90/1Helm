// 1Helm Cloud channel computer: the real browser.
// One HTTP server on :6080 (reachable only from this channel's controller via getTcpPort; containers have no public ingress).
//   /vnc?mode=view|control  WebSocket → x11vnc (view = a view-only VNC server, control = a full one). The controller decides who may use "control".
//   /novnc/*                noVNC client files for the live pane.
//   POST /cdp/<op>          navigate | snapshot | act | back | tabs | screenshot | status — what the resident's browser tools call.
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
      currentTarget = keep?.id || null; seenTargets.clear(); if (keep) { seenTargets.add(keep.id); await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${keep.id}`).catch(() => {}); }
      if (!fresh) log("no tab accepted a test click after start");
    } catch (e) { log("tab reset failed", e.message); }
    // Then reopen the page that was open when the computer went to sleep, in that one tab, and wait for it to load.
    try { const last = fs.readFileSync(LAST_URL, "utf8").trim();
      if (/^https?:\/\//.test(last)) { const ts1 = await targets(); const t1 = ts1.find((t) => t.id === currentTarget) || ts1[0];
        if (t1 && !/^https?:/.test(t1.url)) { const c0 = new CDP(t1.webSocketDebuggerUrl); await c0.open(); await c0.send("Page.enable");
          const loaded = c0.once("Page.loadEventFired", 15e3); await c0.send("Page.navigate", { url: last }).catch(() => {}); await loaded; c0.close(); log(`reopened ${last}`); } } } catch (e) { log("reopen failed", e.message); }
  }
  // Two VNC servers on the same screen: one that ignores all input (what the person sees by default), one that accepts it (only after "Take control").
  if (!procs.vncView) run("vncView", "x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", "5900", "-nopw", "-shared", "-forever", "-viewonly", "-quiet", "-noxdamage", "-cursor", "arrow"]);
  if (!procs.vncCtl) run("vncCtl", "x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", "5901", "-nopw", "-shared", "-forever", "-quiet", "-noxdamage", "-cursor", "arrow"]);
  await waitFor(async () => (await portOpen(5900)) && (await portOpen(5901)), 10e3, "VNC");
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
let currentTarget = null;
// Switch (2026-10-01): "_wait":"quiet" on a request = wait until the page goes quiet (no DOM changes and no requests in
// flight for QUIET ms, capped) instead of fixed sleeps, and keep one CDP connection open between requests. Same for every page.
let FAST = false, live = null; const QUIET = 300;
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
async function page() {
  if (FAST && live && live.ws.readyState === 1) {   // reuse the open connection unless a new tab appeared or ours is gone
    const ts0 = await targets();
    if (!ts0.find((t) => !seenTargets.has(t.id)) && ts0.some((t) => t.id === currentTarget)) return live;
  }
  if (live) { clearInterval(live.reset); try { live.close(); } catch {} live = null; }
  let ts = await targets();
  if (!ts.length) { await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" }); ts = await targets(); }
  // Follow the newest tab (links that open a new tab), otherwise stay on the one we used last.
  const known = ts.find((t) => t.id === currentTarget);
  const t = known && ts[0].id !== currentTarget && !seenTargets.has(ts[0].id) ? ts[0] : known || ts[0];
  for (const x of ts) seenTargets.add(x.id);
  currentTarget = t.id;
  const c = new CDP(t.webSocketDebuggerUrl); await c.open();
  await c.send("Page.enable"); await c.send("Runtime.enable");
  if (t.id !== ts[0].id || !known) await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${t.id}`).catch(() => {});
  if (FAST) { const pend = new Set(); c.inflight = 0; await c.send("Network.enable");
    c.ev.push((d) => { if (d.method === "Network.requestWillBeSent" && !/^(EventSource|WebSocket)$/.test(d.params.type || "")) pend.add(d.params.requestId);
      else if (d.method === "Network.loadingFinished" || d.method === "Network.loadingFailed") pend.delete(d.params.requestId); c.inflight = pend.size; });
    c.reset = setInterval(() => { pend.clear(); c.inflight = 0; }, 15e3); c.reset.unref();   // a stuck long-poll never blocks quiet forever
    c.persistent = true; live = c; }
  return c;
}
const seenTargets = new Set();
async function evalJS(c, expr, sessionId) { const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, 30e3, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
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
  const clean = (s, m = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, m);
  const label = (el) => { const id = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    return clean(el.getAttribute('aria-label') || (id && id.innerText) || el.closest('label')?.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.innerText || el.value || el.getAttribute('name') || ''); };
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
        else if (tag === 'input' || tag === 'textarea') { const ac = (el.getAttribute('autocomplete') || '') + ' ' + (el.name || ''); const hide = el.type === 'password' || /cc-|card|cvc|cvv|exp/i.test(ac);
          extra = el.value ? ' value="' + (hide ? '•••• (filled)' : clean(el.value, 60)) + '"' : ''; }
        else if (tag === 'select') extra = ' selected="' + clean(el.options[el.selectedIndex]?.text, 60) + '" options: ' + [...el.options].slice(0, 12).map((o) => clean(o.text, 30)).join(' | ');
        if (el.disabled) extra += ' (disabled)';
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
  for (const f of out) { if (!frameNo.has(f.id)) frameNo.set(f.id, nextFrame++); f.n = frameNo.get(f.id); }
  return out;
}
const FRAME_JS = (n) => SNAPSHOT_JS.replace("const ref = 'e' + (++n)", `const ref = 'f${n}e' + (++n)`);
async function snapshot(c) {
  const s = await evalJS(c, SNAPSHOT_JS);
  let text = s.text, extra = "";
  for (const f of await frames(c).catch(() => [])) {
    try {
      const r = await evalJS(c, FRAME_JS(f.n), f.session);
      if (!r || !r.refs) continue;   // invisible or non-interactive frames (analytics, captcha shells) are left out
      extra += `\n--- inside frame f${f.n} (${new URL(f.url).host}) ---\n${r.text}`;
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
  const r = await evalJS(c, BOX_JS(ref), f.session); if (!r) throw new Error(`no element ${ref} in frame now — take a new snapshot`);
  // Content quads are viewport coordinates. A tall iframe (Stripe Checkout is taller than the screen) can leave the
  // field off-screen even after scrolling inside the frame, so scroll the page until the point is visible.
  const at = async () => { const q = (await c.send("DOM.getContentQuads", { backendNodeId: owner.backendNodeId })).quads[0]; return { x: q[0] + r.x, y: q[1] + r.y }; };
  let p = await at();
  const vh = (await c.send("Page.getLayoutMetrics")).cssVisualViewport.clientHeight;
  if (p.y < 20 || p.y > vh - 20) { await evalJS(c, `window.scrollBy(0, ${Math.round(p.y - vh / 2)})`); await sleep(150); p = await at(); }
  return { ...r, ...p, session: f.session };
}
async function click(c, x, y) {
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const KEYS = { Enter: [13, "\r"], Tab: [9, "\t"], Escape: [27], Backspace: [8], ArrowDown: [40], ArrowUp: [38], ArrowLeft: [37], ArrowRight: [39], PageDown: [34], PageUp: [33], Home: [36], End: [35], Space: [32, " "] };
async function press(c, key) {
  const k = KEYS[key]; if (!k) throw new Error(`unsupported key ${key}; use one of ${Object.keys(KEYS).join(", ")}`);
  await c.send("Input.dispatchKeyEvent", { type: k[1] ? "keyDown" : "rawKeyDown", key, code: key, windowsVirtualKeyCode: k[0], ...(k[1] ? { text: k[1] } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: k[0] });
}
const OPS = {
  async status() { const up = !!procs.chrome && await portOpen(CDP_PORT); if (!up) return { running: false }; const ts = await targets(); return { running: true, tabs: ts.map((t) => ({ title: t.title, url: t.url })) }; },
  async navigate(b, c) {
    let u; try { u = new URL(String(b.url)); } catch { throw new Error("url must be a full http(s) URL"); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error("only http(s) URLs without embedded credentials");
    const r = await c.send("Page.navigate", { url: u.href }); if (r.errorText) throw new Error(`navigation failed: ${r.errorText}`);
    await settle(c, 15e3); return await snapshot(c);
  },
  async snapshot(b, c) { if (FAST) await quiet(c, 1.5e3); return await snapshot(c); },
  async back(b, c) { await evalJS(c, "history.back()"); await settle(c); return await snapshot(c); },
  async screenshot(b, c) { const r = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 78 }); const loc = await evalJS(c, "({url: location.href, title: document.title})").catch(() => ({})); return { jpeg_base64: r.data, url: loc.url, title: loc.title }; },
  async act(b, c) {
    const acts = Array.isArray(b.actions) ? b.actions : []; if (!acts.length || acts.length > 20) throw new Error("actions: 1–20 steps");
    let done = 0; const before = await snapshot(c).catch(() => null);
    const h0 = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries.length;
    for (const a of acts) {
      const kind = String(a.kind || "");
      if (kind === "click") {
        const p = await box(c, a.ref);
        // Off-screen controls (e.g. Stripe's hidden "AI agent" steering checkbox) can't take a mouse click; click them in the page.
        if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) await evalJS(c, `(() => { const e = document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]'); e && e.click(); })()`, p.session);
        else await click(c, p.x, p.y);
        await settle(c, 8e3);
      }
      else if (kind === "fill" || kind === "type") {
        const p = await box(c, a.ref); await click(c, p.x, p.y);
        // A mouse click can miss (animated or partly hidden forms, tall iframes). Focus the element directly in its own
        // frame as well, then type, then read the value back so a miss is reported instead of silently ignored.
        const sel = `document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]')`;
        const text = String(a.text ?? "");
        await evalJS(c, `(() => { const e = ${sel}; if (!e) return; e.focus(); if (${kind === "fill"}) { if ('value' in e) e.select?.(); else document.execCommand('selectAll'); } })()`, p.session);
        await c.send("Input.insertText", { text });
        await sleep(80);
        const got = await evalJS(c, `(() => { const e = ${sel}; return e ? ('value' in e ? e.value : e.innerText) : null; })()`, p.session);
        const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, "");   // fields format input: "2015550123" → "(201) 555-0123"
        if (got != null && norm(text) && !norm(got).includes(norm(text).slice(0, 30))) throw new Error(`typing into ${a.ref} did not take${b.secret ? "" : ` (field shows "${String(got).slice(0, 40)}")`}. It may be hidden until an earlier step is done; take a new snapshot`);
        if (a.submit) { await press(c, "Enter"); await settle(c, 8e3); }
      } else if (kind === "select") {
        const fs_ = await frameOf(c, a.ref);
        const ok = await evalJS(c, `(() => { const e = document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]'); if (!e || e.tagName !== 'SELECT') return false; const o = [...e.options].find((o) => o.text.trim() === ${JSON.stringify(String(a.text ?? ""))} || o.value === ${JSON.stringify(String(a.text ?? ""))}); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, fs_?.session);
        if (!ok) throw new Error(`could not select "${a.text}" in ${a.ref}`);
      } else if (kind === "press") { await press(c, String(a.key || "Enter")); await settle(c, 8e3); }
      else if (kind === "scroll") { await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: W / 2, y: H / 2, deltaX: 0, deltaY: a.direction === "up" ? -600 : 600 }); await sleep(400); }
      else if (kind === "wait") await sleep(Math.min(10e3, Number(a.ms) || 1000));
      else if (kind === "select_or_fill") {   // expiry month/year can be a dropdown or a text box
        const fs_ = await frameOf(c, a.ref), sel = `document.querySelector('[data-1hc="${String(a.ref).replace(/[^a-z0-9]/gi, "")}"]')`;
        const isSel = await evalJS(c, `(${sel})?.tagName === 'SELECT'`, fs_?.session);
        if (isSel) { const t = JSON.stringify(String(a.text ?? "")); const ok = await evalJS(c, `(() => { const e = ${sel}; const want = ${t}; const o = [...e.options].find((o) => o.value === want || o.text.trim() === want || o.value === String(Number(want)) || o.value.endsWith(want.slice(-2)) && o.value.length <= 4); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, fs_?.session); if (!ok) throw new Error(`could not choose that option in ${a.ref}`); }
        else { a.kind = "fill"; acts.splice(acts.indexOf(a) + 1, 0, a); done--; }
      }
      else throw new Error(`unknown action kind "${kind}" (click, fill, type, select, press, scroll, wait)`);
      done++;
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
    let after = await snapshot(c);
    for (let i = 0; i < (FAST ? 0 : 6) && before && after.snapshot === before.snapshot && after.url === before.url; i++) { await sleep(2000); after = await snapshot(c); }
    // Tell the model plainly when its steps had no visible effect, so it can't narrate a success that didn't happen.
    const changed = !before || before.snapshot !== after.snapshot || before.url.replace(/[?#]$/, "") !== after.url.replace(/[?#]$/, "");
    // Pages passed through during the steps (e.g. /checkout/success before an automatic redirect home).
    const hist = (await c.send("Page.getNavigationHistory").catch(() => ({ entries: [] }))).entries;
    const visited = hist.slice(Math.max(0, h0 - 1)).map((e) => e.url).filter((u, i, a) => u !== a[i - 1]);
    return { completed: done, page_changed: changed, ...(visited.length > 1 ? { visited } : {}), ...after };
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
    if (m && req.method === "POST" && OPS[m[1]]) {
      if (!controllerRequest(req.headers)) return send(403, { error: "forbidden" });
      let body = ""; for await (const ch of req) body += ch; const b = body ? JSON.parse(body) : {};
      if (m[1] === "status") return send(200, await OPS.status());
      FAST = b._wait === "quiet";
      const boot = await ensureStack(); const c = await page();
      try { const out = await OPS[m[1]](b, c); if (out?.url && /^https?:/.test(out.url)) { try { fs.writeFileSync(LAST_URL, out.url); } catch {} } return send(200, { ok: true, ...(boot.cold ? { browser_started_ms: boot.start_ms } : {}), ...out }); } finally { if (!c.persistent) c.close(); }
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
