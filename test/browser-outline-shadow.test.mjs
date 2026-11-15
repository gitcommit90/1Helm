// node --import ./test/stubs/register.mjs test/browser-outline-shadow.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import http from "node:http"; import { spawn, execFileSync } from "node:child_process"; import net from "node:net";
import { mkdtempSync } from "node:fs";
import { cleanupOnExit } from "./stubs/cleanup.mjs";

const CHROME = process.env.HC_TEST_CHROME || "";
if (!fs.existsSync(CHROME) || !fs.existsSync(new URL("../node_modules/ws", import.meta.url)) || !fs.existsSync("/usr/bin/Xvfb")) { console.log("browser-outline-shadow: skipped (no Chrome, ws or Xvfb here)"); process.exit(0); }
const free = () => new Promise((z) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => z(p)); }); });
const root = cleanupOnExit(mkdtempSync("/tmp/hc-outshadow-")), br = path.join(root, "browser");
fs.mkdirSync(path.join(br, "profile/Default"), { recursive: true });
const [fxp, port, cdp, v1, v2] = await Promise.all([free(), free(), free(), free(), free()]);
let dn; do { dn = 200 + Math.floor(Math.random() * 700); } while (fs.existsSync(`/tmp/.X11-unix/X${dn}`) || fs.existsSync(`/tmp/.X${dn}-lock`));
const disp = ":" + dn;

const PAGES = {
  // Mimics Reddit's login: hosts with open shadow roots and slots, light DOM labels and text projected into slots, a display:contents wrapper,
  // nested hosts (a button host inside another host's shadow root, with its label in the light DOM of the inner host), a text node projected into a slot.
  "/reddit": `<style>body *{font:16px sans-serif} faceplate-tracker{display:contents} .box{display:block;margin:6px 20px;width:300px}</style>
<script>
const def = (n, html, init) => customElements.define(n, class extends HTMLElement { constructor(){ super(); this.attachShadow({mode:'open'}).innerHTML = html; } connectedCallback(){ if (init) init(this.shadowRoot, this); } });
def('auth-flow-modal', '<div><slot name=title></slot><slot></slot></div>');
def('faceplate-text-input', '<label><span><slot name=label></slot></span><input style="width:250px;height:30px"></label>', (r, h) => { const i = r.querySelector('input'); i.name = h.getAttribute('name'); i.type = h.getAttribute('type') || 'text'; if (h.getAttribute('autocomplete')) i.autocomplete = h.getAttribute('autocomplete'); });
def('faceplate-button', '<button type=button style="height:30px"><slot></slot></button>');
def('login-actions', '<div><faceplate-button id=go><slot name=go></slot></faceplate-button><slot></slot></div>');
def('x-note', '<p><slot></slot></p>');
</script>
<auth-flow-modal class=box>
  <h1 slot=title>Log In</h1>
  <p>By continuing, you agree to our User Agreement and acknowledge our Privacy Policy.</p>
  <faceplate-tracker><a href="/auth/google">Continue with Google</a></faceplate-tracker>
  <faceplate-text-input name=username autocomplete=username><span slot=label>Email or username</span></faceplate-text-input>
  <faceplate-text-input name=password type=password autocomplete=current-password><span slot=label>Password</span></faceplate-text-input>
  <x-note>Plain slotted text node</x-note>
  <login-actions><span slot=go>Log In</span><a href="/forgot">Forgot password?</a></login-actions>
</auth-flow-modal>`,
  "/login2": `<form><input type=search placeholder="Search"><input name=e type=text aria-label="Email address"><input type=password name=pw aria-label="Password"></form>`,
  "/step1": `<input type=search placeholder="Search site"><input name=login_id autocomplete=username placeholder="Phone, email or username">`,
  "/nofields": `<h1>Welcome</h1><a href="/x">Sign in</a><input name=q placeholder="Search">`,
  // An ad-heavy page: the content is in the HTML, but an async script and images keep loading for 8 s (the load event waits for them).
  "/heavy": `<h1>Heavy page</h1><p>Article text that is there at once.</p><a href="/x">Read more</a><script async src="/slow.js"></script>${"<img src=/slow.png?1 width=1 height=1><img src=/slow.png?2 width=1 height=1><img src=/slow.png?3 width=1 height=1>"}`,
  "/plain": `<h1>Plain page</h1><p>Some body text here.</p><a href="/x">A link</a><label>Name <input name=n></label><button>Go</button>`,
};
const fx = http.createServer((q, r) => { if (/^\/slow\./.test(q.url)) { setTimeout(() => { try { r.writeHead(200, { "content-type": q.url.includes(".js") ? "text/javascript" : "image/gif" }); r.end(""); } catch {} }, 8000).unref(); return; } const p = PAGES[q.url.split("?")[0]]; if (!p) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": "text/html" }); r.end(`<!doctype html><meta charset=utf-8><body style="margin:0;font:16px sans-serif">${p}`); }).listen(fxp, "127.0.0.1");
const site = `http://127.0.0.1:${fxp}`;
// x11vnc is not what this test is about, and it exits at once on some hosts: a stand-in that only listens on the port keeps the stack start going.
fs.mkdirSync(path.join(root, "bin")); fs.writeFileSync(path.join(root, "bin/x11vnc"), `#!${process.execPath}\nconst a = process.argv; require("net").createServer(() => {}).listen(Number(a[a.indexOf("-rfbport") + 1]), "127.0.0.1");\n`, { mode: 0o755 });
const srv = spawn("node", [process.env.HC_TEST_SERVER || new URL("../image/opt/1hc-browser/server.mjs", import.meta.url).pathname], { env: { ...process.env, PATH: path.join(root, "bin") + ":" + process.env.PATH, HC_PORT: String(port), HC_DISPLAY: disp, HC_CDP_PORT: String(cdp), HC_VNC_VIEW: String(v1), HC_VNC_CTL: String(v2), HC_BROWSER_DIR: br, HC_HOME: path.join(root, "home"), HC_CHROME: CHROME, HC_WS: new URL("../node_modules/ws", import.meta.url).pathname }, stdio: "ignore", detached: true });
// Everything the test starts (the service, Chrome, Xvfb and the x11vnc stand-ins) runs in the service's own process group, and the group is killed on every way out:
// normal end, a failed assertion, a timeout, Ctrl-C or SIGTERM. The pkill lines catch anything that left the group; the temp folder is removed by cleanupOnExit.
const stop = () => {
  try { process.kill(-srv.pid, "SIGKILL"); } catch {}
  for (const pat of [root, `Xvfb ${disp} `]) { try { execFileSync("pkill", ["-9", "-f", pat], { stdio: "ignore" }); } catch {} }
  try { fx.close(); } catch {}
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { stop(); process.exit(1); });
const watchdog = setTimeout(() => { console.error("browser-outline-shadow: timed out after 150 s"); stop(); process.exit(1); }, 150e3);
const ok = (n) => console.log("  ok", n);
const call = async (op, b = {}) => await new Promise((z, bad) => { const rq = http.request({ host: "127.0.0.1", port, path: `/cdp/${op}`, method: "POST", headers: { "x-1helm-controller": "1" } }, (res) => { let t = ""; res.on("data", (d) => { t += d; }); res.on("end", () => { try { z(JSON.parse(t)); } catch (e) { bad(e); } }); }); rq.on("error", bad); rq.end(JSON.stringify({ _tab: "t1", ...b })); })   // the browser service accepts only the controller's own requests (no fetch: it adds sec-fetch headers);
const post = async (op, b = {}) => { const r = await call(op, b); assert.ok(r.ok, JSON.stringify(r).slice(0, 300)); return r; };
for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); break; } catch { await new Promise((z) => setTimeout(z, 200)); } }
const refOf = (snap, re) => snap.split("\n").find((l) => re.test(l))?.match(/\[([a-z0-9]+)\]/)?.[1];
try {
  const plain = await post("navigate", { url: site + "/plain" });
  for (const re of [/^# Plain page/m, /Some body text here\./, /link "A link"/, /text input "Name"/, /button "Go"/]) assert.match(plain.snapshot, re, "plain page outline:\n" + plain.snapshot);
  console.log("  ok plain page outline is complete");
  const page = await post("navigate", { url: site + "/reddit" });
  const s = page.snapshot;
  for (const re of [/^# Log In/m, /By continuing, you agree to our User Agreement/, /link "Continue with Google"/, /text input "Email or username"/, /password input "Password"/,
    /Plain slotted text node/, /button "Log In"/, /link "Forgot password\?"/]) assert.match(s, re, "shadow/slot page outline lacks " + re + ":\n" + s);
  assert.ok(!/not listed: [^\]]*hidden/.test(s), "nothing visible is counted hidden:\n" + s);
  assert.equal((s.match(/Log In/g) || []).length, 2, "each text appears once (heading and button), not twice:\n" + s);
  console.log("  ok slotted light DOM text, links, labels, nested hosts and shadow inputs are all listed");
  const u = refOf(s, /text input "Email or username"/), p = refOf(s, /password input "Password"/), b = refOf(s, /button "Log In"/);
  assert.ok(u && p && b && new Set([u, p, b]).size === 3);
  const r = await post("act", { actions: [{ kind: "fill", ref: u, text: "someone" }, { kind: "click", ref: b }] });
  assert.match(r.snapshot, /text input "Email or username" value="someone"/, r.snapshot);
  console.log("  ok refs from the outline reach the shadow input and the nested button");
  // browser_fill_login with no refs: the service finds the sign-in fields (shadow inputs included) and answers refs only.
  const lf = await post("login_fields");
  assert.equal(lf.username_ref, u); assert.equal(lf.password_ref, p); assert.deepEqual(Object.keys(lf).sort(), ["ok", "password_ref", "username_ref"]);
  console.log("  ok login_fields finds the shadow username and password fields");
  await post("navigate", { url: site + "/login2" }); const l2 = await post("login_fields");
  const s2 = (await post("snapshot")).snapshot;
  assert.equal(l2.username_ref, refOf(s2, /text input "Email address"/), "the email field, not the search box"); assert.equal(l2.password_ref, refOf(s2, /password input "Password"/));
  await post("navigate", { url: site + "/step1" }); const l3 = await post("login_fields"), s3 = (await post("snapshot")).snapshot;
  assert.equal(l3.password_ref, null); assert.equal(l3.username_ref, refOf(s3, /Phone, email or username/), "first step: the username field only");
  await post("navigate", { url: site + "/nofields" }); const l4 = await post("login_fields");
  assert.equal(l4.username_ref, null); assert.equal(l4.password_ref, null);
  console.log("  ok login_fields skips search boxes, handles a username-only step and answers null when there are no fields");
  // browser_navigate returns when the page is usable (parsed, DOM quiet), not when every ad and image has loaded.
  const t0 = Date.now(); const heavy = await post("navigate", { url: site + "/heavy" }); const ms = Date.now() - t0;
  console.log("  heavy page navigate ms:", ms);
  assert.match(heavy.snapshot, /# Heavy page/); assert.match(heavy.snapshot, /Article text that is there at once\./); assert.match(heavy.snapshot, /link "Read more"/);
  assert.ok(ms < 4000, "navigate did not wait for the 8 s of loading subresources: " + ms + " ms");
  console.log("  ok navigate returns on a heavy page without waiting for the load event");
} finally { try { fx.closeAllConnections(); } catch {} clearTimeout(watchdog); stop(); }
console.log("browser-outline-shadow: all ok");
