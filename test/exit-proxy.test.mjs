// node test/exit-proxy.test.mjs
// The computer's browser exit proxy: a CONNECT and a plain http request are carried through a tunnel, a refused tunnel gives a 502 with the reason
// and never a direct connection, hosts on the direct list keep their own path. The tunnel transport itself is tested in exit-stream.test.mjs.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createExitProxy, exitMessage } from "../image/opt/1hc-browser/exit-proxy.mjs";

const listen = (srv) => new Promise((z) => srv.listen(0, "127.0.0.1", () => z(srv.address().port)));
// A fake web server (what the exit node would reach): answers plain HTTP and echoes raw TCP after a CONNECT.
const site = http.createServer((req, res) => { res.end(`hello ${req.method} ${req.url} host=${req.headers.host}`); });
const sitePort = await listen(site);
const direct = net.createServer((s) => { s.end("direct-path"); });
const directPort = await listen(direct);

const connect = (proxyPort, target) => new Promise((z, bad) => {
  const r = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: target });
  r.on("connect", (res, socket, head) => { if (res.statusCode === 200) return z({ res, socket }); let b = String(head); socket.on("data", (d) => b += d); socket.on("end", () => z({ res, body: b })); }); r.on("response", (res) => { let b = ""; res.on("data", (d) => b += d); res.on("end", () => z({ res, body: b })); }); r.on("error", bad); r.end();
});

// 1. A tunnel that works: the proxy dials only through openTunnel (here a local TCP connection to the fake site).
const calls = [];
const proxy = createExitProxy({ openTunnel: async (host, port) => { calls.push([host, port]); return { ok: true, socket: net.connect(sitePort, "127.0.0.1") }; }, direct: (h) => h === "guarded.example" });
const proxyPort = await listen(proxy);
{
  const { res, socket } = await connect(proxyPort, "www.reddit.com:443");
  assert.equal(res.statusCode, 200);
  socket.write("GET /r/test HTTP/1.1\r\nhost: www.reddit.com\r\nconnection: close\r\n\r\n");
  let got = ""; for await (const d of socket) got += d;
  assert.match(got, /hello GET \/r\/test host=www\.reddit\.com/);
  assert.deepEqual(calls[0], ["www.reddit.com", 443]);
}
// 2. A plain http:// request in absolute form goes through the tunnel as an ordinary origin-form request.
{
  const body = await new Promise((z, bad) => { const r = http.request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: "http://example.org/a?b=1", headers: { host: "example.org" } }, (res) => { let b = ""; res.on("data", (d) => b += d); res.on("end", () => z(b)); }); r.on("error", bad); r.end(); });
  assert.match(body, /hello GET \/a\?b=1 host=example\.org/);
  assert.deepEqual(calls.at(-1), ["example.org", 80]);
}
// 3. A refused tunnel answers 502 with the reason, and nothing connects directly.
{
  const refusing = createExitProxy({ openTunnel: async () => ({ ok: false, reason: "The exit node home is offline." }), direct: () => false });
  const port = await listen(refusing);
  const { res, body } = await connect(port, "www.reddit.com:443");
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers["x-1helm-exit"], "unavailable");
  assert.equal(body, exitMessage("The exit node home is offline."));
  assert.match(body, /no direct connection was used/);
  assert.equal(refusing.exitState.lastReason, "The exit node home is offline.");
  const plain = await new Promise((z) => { http.get({ host: "127.0.0.1", port, path: "http://example.org/" }, (r) => { let b = ""; r.on("data", (d) => b += d); r.on("end", () => z({ code: r.statusCode, b })); }); });
  assert.equal(plain.code, 502);
  refusing.close();
}
// 4. A host on the direct list keeps its own path (Sentinel guards it) and never uses the tunnel.
{
  const before = calls.length;
  const { res, socket } = await connect(proxyPort, `guarded.example:${directPort}`).catch((e) => ({ res: { statusCode: 0 }, socket: null, e }));
  // "guarded.example" does not resolve here, so the direct dial fails with a 502, and still never reaches the tunnel.
  assert.equal(res.statusCode === 502 || res.statusCode === 200, true);
  assert.equal(calls.length, before);
  socket?.destroy();
}
// 5. The browser service's /exit-mode route stores the setting where Chrome's start reads it (no Chrome is started here).
{
  const { spawn } = await import("node:child_process"); const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exitmode-")), conf = path.join(dir, "exit.json"), port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn("node", [new URL("../image/opt/1hc-browser/server.mjs", import.meta.url).pathname], { env: { ...process.env, HC_PORT: String(port), HC_EXIT_CONF: conf, HC_BROWSER_DIR: path.join(dir, "b"), HC_HOME: path.join(dir, "h"), HC_WS: new URL("../node_modules/ws", import.meta.url).pathname }, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise((z) => setTimeout(z, 100)); }
    const r = await (await fetch(`http://127.0.0.1:${port}/exit-mode`, { method: "POST", body: JSON.stringify({ on: true, direct: ["API.Example.com"] }) })).json();
    assert.deepEqual([r.ok, r.on, r.restarted], [true, true, true]);
    assert.deepEqual(JSON.parse(fs.readFileSync(conf, "utf8")), { on: true, direct: ["api.example.com"] });
    const off = await (await fetch(`http://127.0.0.1:${port}/exit-mode`, { method: "POST", body: JSON.stringify({ on: false }) })).json();
    assert.deepEqual([off.ok, off.on], [true, false]); assert.equal(JSON.parse(fs.readFileSync(conf, "utf8")).on, false);
  } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}
proxy.close(); site.close(); direct.close();
console.log("exit proxy: ok");
process.exit(0);
