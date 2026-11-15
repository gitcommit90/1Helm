// node --import ./test/stubs/register.mjs test/browser-shadow-fields.test.mjs
// The real browser service against a real Chrome: inputs, buttons and links inside open shadow roots (web components such as Reddit's text input) get refs,
// are not counted as hidden, and click, type and fill (also the secret typing path of browser_fill_login) reach them. No model calls. Skipped when there is no Chrome.
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import http from "node:http"; import { spawn, execFileSync } from "node:child_process"; import net from "node:net";
import { mkdtempSync } from "node:fs";
import { cleanupOnExit } from "./stubs/cleanup.mjs";

const CHROME = process.env.HC_TEST_CHROME || "";
if (!fs.existsSync(CHROME) || !fs.existsSync(new URL("../node_modules/ws", import.meta.url)) || !fs.existsSync("/usr/bin/Xvfb")) { console.log("browser-shadow-fields: skipped (no Chrome, ws or Xvfb here)"); process.exit(0); }
const free = () => new Promise((z) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => z(p)); }); });
const root = cleanupOnExit(mkdtempSync("/tmp/hc-shadow-")), br = path.join(root, "browser");
fs.mkdirSync(path.join(br, "profile/Default"), { recursive: true });
const [fxp, port, cdp, v1, v2] = await Promise.all([free(), free(), free(), free(), free()]);
let dn; do { dn = 200 + Math.floor(Math.random() * 700); } while (fs.existsSync(`/tmp/.X11-unix/X${dn}`) || fs.existsSync(`/tmp/.X${dn}-lock`));
const disp = ":" + dn;

const PAGES = {
  "/login": `<style>.box{display:block;margin:20px;width:300px}</style>
<script>
class TI extends HTMLElement { connectedCallback(){ const r=this.shadowRoot||this.attachShadow({mode:'open'}); const t=this.getAttribute('type')||'text'; r.innerHTML='<label>'+(this.getAttribute('label')||'')+'<input type="'+t+'" name="'+(this.getAttribute('name')||'')+'" style="width:250px;height:30px"></label>'; } }
customElements.define('faceplate-text-input', TI);
class BTN extends HTMLElement { constructor(){ super(); const r=this.attachShadow({mode:'open'}); r.innerHTML='<button type=button style="height:30px">Log In</button><a href="#forgot">Forgot password?</a><div style="display:none"><input aria-label="Hidden trap"></div>'; r.querySelector('button').addEventListener('click',()=>{ document.getElementById('o').textContent='submitted:'+document.querySelector('faceplate-text-input[name=u]').shadowRoot.querySelector('input').value+'|'+document.querySelector('faceplate-text-input[name=p]').shadowRoot.querySelector('input').value; }); } }
customElements.define('login-actions', BTN);
</script>
<faceplate-text-input class=box name=u label="Email or username"></faceplate-text-input>
<faceplate-text-input class=box name=p type=password label="Password"></faceplate-text-input>
<login-actions class=box></login-actions><div id=o></div>`,
};
const fx = http.createServer((q, r) => { const p = PAGES[q.url.split("?")[0]]; if (!p) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": "text/html" }); r.end(`<!doctype html><meta charset=utf-8><body style="margin:0;font:16px sans-serif">${p}`); }).listen(fxp, "127.0.0.1");
const site = `http://127.0.0.1:${fxp}`;
// x11vnc is not what this test is about, and it exits at once on some hosts: a stand-in that only listens on the port keeps the stack start going.
fs.mkdirSync(path.join(root, "bin")); fs.writeFileSync(path.join(root, "bin/x11vnc"), `#!${process.execPath}\nconst a = process.argv; require("net").createServer(() => {}).listen(Number(a[a.indexOf("-rfbport") + 1]), "127.0.0.1");\n`, { mode: 0o755 });
const srv = spawn("node", [new URL("../image/opt/1hc-browser/server.mjs", import.meta.url).pathname], { env: { ...process.env, PATH: path.join(root, "bin") + ":" + process.env.PATH, HC_PORT: String(port), HC_DISPLAY: disp, HC_CDP_PORT: String(cdp), HC_VNC_VIEW: String(v1), HC_VNC_CTL: String(v2), HC_BROWSER_DIR: br, HC_HOME: path.join(root, "home"), HC_CHROME: CHROME, HC_WS: new URL("../node_modules/ws", import.meta.url).pathname }, stdio: "ignore", detached: true });
// Everything the test starts (the service, Chrome, Xvfb and the x11vnc stand-ins) runs in the service's own process group, and the group is killed on every way out:
// normal end, a failed assertion, a timeout, Ctrl-C or SIGTERM. The pkill lines catch anything that left the group; the temp folder is removed by cleanupOnExit.
const stop = () => {
  try { process.kill(-srv.pid, "SIGKILL"); } catch {}
  for (const pat of [root, `Xvfb ${disp} `]) { try { execFileSync("pkill", ["-9", "-f", pat], { stdio: "ignore" }); } catch {} }
  try { fx.close(); } catch {}
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { stop(); process.exit(1); });
const watchdog = setTimeout(() => { console.error("browser-shadow-fields: timed out after 150 s"); stop(); process.exit(1); }, 150e3);
const ok = (n) => console.log("  ok", n);
const call = async (op, b = {}) => await new Promise((z, bad) => { const rq = http.request({ host: "127.0.0.1", port, path: `/cdp/${op}`, method: "POST", headers: { "x-1helm-controller": "1" } }, (res) => { let t = ""; res.on("data", (d) => { t += d; }); res.on("end", () => { try { z(JSON.parse(t)); } catch (e) { bad(e); } }); }); rq.on("error", bad); rq.end(JSON.stringify({ _tab: "t1", ...b })); })   // the browser service accepts only the controller's own requests (no fetch: it adds sec-fetch headers);
const post = async (op, b = {}) => { const r = await call(op, b); assert.ok(r.ok, JSON.stringify(r).slice(0, 300)); return r; };
for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); break; } catch { await new Promise((z) => setTimeout(z, 200)); } }
const refOf = (snap, re) => snap.split("\n").find((l) => re.test(l))?.match(/\[([a-z0-9]+)\]/)?.[1];
try {
  const page = await post("navigate", { url: site + "/login" });
  const u = refOf(page.snapshot, /text input "Email or username"/), p = refOf(page.snapshot, /password input "Password"/), b = refOf(page.snapshot, /button "Log In"/), l = refOf(page.snapshot, /link "Forgot password\?"/);
  assert.ok(u && p && b && l, "inputs, button and link in shadow roots have refs:\n" + page.snapshot);
  assert.equal(new Set([u, p, b, l]).size, 4);
  assert.match(page.snapshot, /not listed: 1 hidden control \(hidden by style 1\)/, "only the display:none trap input in a shadow root is hidden, the visible shadow fields are not:\n" + page.snapshot);
  ok("outline lists shadow-root input, password input, button and link with refs");
  const r1 = await post("act", { actions: [{ kind: "fill", ref: u, text: "visible-user" }] });
  assert.match(r1.snapshot, /text input "Email or username" value="visible-user"/); ok("fill reaches a shadow-root input");
  // The secret path (browser_fill_login types with secret: true): the value never appears in the result.
  const r2 = await post("act", { actions: [{ kind: "fill", ref: p, text: "S3cretPass!" }], secret: true });
  assert.ok(!JSON.stringify(r2).includes("S3cretPass!"), "the secret is not in the reply");
  assert.match(r2.snapshot, /password input "Password" value="•••• \(filled\)"/); ok("secret typing fills a shadow-root password and keeps it out of the reply");
  const r3 = await post("act", { actions: [{ kind: "click", ref: b }] });
  assert.match(r3.snapshot, /submitted:visible-user\|S3cretPass!/, "both values reached the real inputs and the click worked\n" + r3.snapshot); ok("click reaches a shadow-root button, and both fields hold the typed values");
} finally { clearTimeout(watchdog); stop(); }
console.log("browser-shadow-fields: all ok");
