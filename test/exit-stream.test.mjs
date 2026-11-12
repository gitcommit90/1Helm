// node test/exit-stream.test.mjs
// The Browser exit node transport that replaced the WebSocket from the computer: sessions of plain requests (open, write, long-poll read, close)
// held by ExitStreams, and httpTunnel on the computer side. A fake broker WebSocket relays to a local TCP site.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { ExitStreams, MAX_STREAMS } from "../src/exit-stream.js";
import { createExitProxy, httpTunnel } from "../image/opt/1hc-browser/exit-proxy.mjs";

const listen = (srv) => new Promise((z) => srv.listen(0, "127.0.0.1", () => z(srv.address().port)));
const site = net.createServer((s) => { s.on("data", (d) => s.write(`echo:${d}`)); s.on("error", () => {}); });
const sitePort = await listen(site); let curSite = sitePort;

// A fake of what the broker's WebSocket does: first message is the hello, the answer is {ok}, then bytes flow both ways.
function fakeBroker({ refuse = "", blob = false } = {}) {
  const ls = {}; const ws = { addEventListener: (t, f) => { (ls[t] ||= []).push(f); }, sent: [], closed: false,
    send(d) {
      if (!this.hello) { this.hello = JSON.parse(d); if (refuse) return setTimeout(() => ls.message.forEach((f) => f({ data: JSON.stringify({ ok: false, reason: refuse }) })), 0);
        this.sock = net.connect(curSite, "127.0.0.1"); this.sock.on("data", (b) => ls.message.forEach((f) => f({ data: blob ? new Blob([b]) : new Uint8Array(b).buffer }))); this.sock.on("close", () => ls.close?.forEach((f) => f({})));
        return setTimeout(() => ls.message.forEach((f) => f({ data: JSON.stringify({ ok: true }) })), 0); }
      this.sent.push(Buffer.from(d)); this.sock.write(Buffer.from(d));
    },
    close() { this.closed = true; this.sock?.destroy(); } };
  return ws;
}
let broker = () => ({ ws: fakeBroker() });
const streams = new ExitStreams({ openWs: async () => broker(), sleep: (ms) => new Promise((z) => setTimeout(z, Math.min(ms, 300))) });

// The Worker side as HTTP routes (the same routing native-transport.js does).
const writeSizes = [];
let streamRoutes = false;
const worker = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), id = u.searchParams.get("id") || ""; if (process.env.DBG) console.log(u.pathname);
  if (!streamRoutes && u.pathname === "/s/echo") { res.writeHead(404); return res.end(); }
  if (streamRoutes && u.pathname === "/s/stream") {
    const r = await streams.stream(u.searchParams.get("host"), u.searchParams.get("port"));
    if (!r.ok) { res.writeHead(r.status || 503, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, reason: r.reason })); }
    res.writeHead(200, { "content-type": "application/octet-stream" }); res.flushHeaders(); r.pump(req); const { Readable } = await import("node:stream");
    const out = Readable.fromWeb(r.readable); out.pipe(res); res.on("close", () => out.destroy()); return;
  }
  if (streamRoutes && u.pathname === "/s/echo") {
    res.writeHead(200); req.on("data", (d) => res.write(d)); req.on("end", () => res.end()); return;
  }
  const body = await new Promise((z) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => z(Buffer.concat(c))); });
  if (u.pathname === "/s/open") { const h = JSON.parse(body); const r = await streams.open(h.host, h.port); res.writeHead(r.ok ? 200 : r.status, { "content-type": "application/json" }); return res.end(JSON.stringify(r.ok ? { ok: true, id: r.id } : { ok: false, reason: r.reason })); }
  if (u.pathname === "/s/r") { const r = await streams.read(id); if (r.data) { res.writeHead(200, { "x-seq": String(r.seq) }); return res.end(Buffer.from(r.data)); } res.writeHead(204, r.eof ? { "x-eof": "1", "x-seq": String(r.seq) } : {}); return res.end(); }
  if (u.pathname === "/s/w") { writeSizes.push(body.length); const w = streams.write(id, body); res.writeHead(w.ok ? 204 : w.status); return res.end(); }
  if (u.pathname === "/s/close") { streams.close(id); res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});
const wport = await listen(worker);
const base = `http://127.0.0.1:${wport}`;

// 1. A browser connection through the proxy and the HTTP tunnel reaches the site and comes back.
const tun0 = httpTunnel(base); assert.equal(tun0.mode(), "unknown");
const proxy = createExitProxy({ openTunnel: tun0 });
const pport = await listen(proxy);
{
  const sock = await new Promise((z, bad) => { const r = http.request({ host: "127.0.0.1", port: pport, method: "CONNECT", path: "www.reddit.com:443" }); r.on("connect", (res, s) => res.statusCode === 200 ? z(s) : bad(new Error("status " + res.statusCode))); r.on("error", bad); r.end(); });
  sock.write("hello one"); const got = await new Promise((z) => sock.once("data", z));
  assert.equal(String(got), "echo:hello one");
  sock.write("hello two"); assert.equal(String(await new Promise((z) => sock.once("data", z))), "echo:hello two");
  sock.destroy();
  await new Promise((z) => setTimeout(z, 1000));
  assert.equal(streams.size, 0, "closing the connection closes the session");
  const st = proxy.exitStats(); assert.ok(st.connections >= 1 && st.slowest[0].host === "www.reddit.com" && st.slowest[0].up > 0 && st.slowest[0].down > 0 && st.slowest[0].ttfb_ms != null, "connection stats: " + JSON.stringify(st.slowest[0]));
  assert.equal(proxy.exitStats({ reset: true }).connections >= 1, true); assert.equal(proxy.exitStats().connections, 0);
}
// 1b. Blob frames (a WebSocket from fetch in Workers defaults to binaryType "blob") are read, in order, not turned into empty reads.
{
  broker = () => ({ ws: fakeBroker({ blob: true }) });
  const o = await streams.open("example.org", 80); assert.ok(o.ok);
  assert.equal(streams.write(o.id, Buffer.from("blob test")).ok, true);
  let got = ""; for (let i = 0; i < 20 && !got; i++) { const r = await streams.read(o.id); if (r.data) got = Buffer.from(r.data).toString(); }
  assert.equal(got, "echo:blob test"); streams.close(o.id);
}
// 2. A refused open gives the broker's reason to the browser as a 502, and no session is left.
{
  broker = () => ({ ws: fakeBroker({ refuse: "That address is not public." }) });
  const r = await new Promise((z, bad) => { const q = http.request({ host: "127.0.0.1", port: pport, method: "CONNECT", path: "10.0.0.1:80" }); q.on("connect", (res, s, head) => { let b = String(head); s.on("data", (d) => b += d); s.on("end", () => z({ status: res.statusCode, b })); }); q.on("error", bad); q.end(); });
  assert.equal(r.status, 502); assert.match(r.b, /That address is not public\./); assert.match(r.b, /no direct connection was used/);
  assert.equal(streams.size, 0);
}
// 3. The Worker being unreachable is a refusal with a detail, never a direct connection.
{
  const t = await httpTunnel("http://127.0.0.1:1")("example.org", 443);
  assert.equal(t.ok, false); assert.match(t.reason, /could not reach the exit node/); assert.match(t.detail, /open request failed/);
}
// 4. Limits: a bad address, too many sessions, idle sessions are swept, an oversized queue ends the session.
{
  broker = () => ({ ws: fakeBroker() });
  assert.equal((await streams.open("", 80)).ok, false);
  let t = 0; const S = new ExitStreams({ openWs: async () => broker(), now: () => t });
  const ids = []; for (let i = 0; i < MAX_STREAMS; i++) { const r = await S.open("a.example", 80); assert.ok(r.ok); ids.push(r.id); }
  assert.equal((await S.open("a.example", 80)).status, 503);
  t += 200e3; S.sweep(); assert.equal(S.size, 0);
  assert.equal((await S.read(ids[0])).eof, true, "a swept session reads as ended");
  assert.equal(S.write(ids[0], new Uint8Array(1)).ok, false);
}
// 5. A big download arrives complete and in order (two polls run beside each other), and many small writes are sent as few requests, in order.
{
  const crypto = await import("node:crypto");
  const big = crypto.randomBytes(12 << 20), want = crypto.createHash("sha256").update(big).digest("hex");
  const bigSite = net.createServer((s) => { s.on("error", () => {}); let off = 0; const go = () => { while (off < big.length) { const n = Math.min(64 * 1024 + (off % 7919), big.length - off); const ok = s.write(big.subarray(off, off + n)); off += n; if (!ok) return s.once("drain", go); } s.end(); }; go(); });
  curSite = await listen(bigSite); broker = () => ({ ws: fakeBroker() });
  const t = await httpTunnel(base)("big.example", 80); assert.ok(t.ok);
  const h = crypto.createHash("sha256"); let n = 0;
  await new Promise((z, bad) => { t.socket.on("data", (d) => { h.update(d); n += d.length; }); t.socket.on("end", z); t.socket.on("error", bad); });
  assert.equal(n, big.length); assert.equal(h.digest("hex"), want, "download bytes in order");
  bigSite.close();
  curSite = sitePort; broker = () => ({ ws: fakeBroker() });
  const e = await httpTunnel(base)("echo.example", 80); assert.ok(e.ok);
  writeSizes.length = 0; let echoed = ""; e.socket.on("data", (d) => { echoed += d; });
  for (let i = 0; i < 200; i++) e.socket.write(`${i},`);
  for (let i = 0; i < 100 && !echoed.endsWith(",") ; i++) await new Promise((z) => setTimeout(z, 50));
  await new Promise((z) => setTimeout(z, 200));
  assert.equal(echoed.replace(/echo:/g, ""), Array.from({ length: 200 }, (_, i) => `${i},`).join(""), "writes arrive in order");
  assert.ok(writeSizes.length < 200, `writes were coalesced (${writeSizes.length} requests)`);
  e.socket.destroy();
}
// 6. The streaming tunnel: one request per connection, chosen only when the platform answers while the request body is open. Same results as the session tunnel.
{
  streamRoutes = true; broker = () => ({ ws: fakeBroker() });
  const crypto = await import("node:crypto"); let said = "";
  const tun = httpTunnel(base, { log: (l) => { said += l; } });
  const e = await tun("echo.example", 80); assert.ok(e.ok, "stream open"); assert.match(said, /streaming/);
  let echoed = ""; e.socket.on("data", (d) => { echoed += d; });
  e.socket.write("one"); await new Promise((z) => setTimeout(z, 100)); e.socket.write("two");
  for (let i = 0; i < 40 && !echoed.includes("echo:two"); i++) await new Promise((z) => setTimeout(z, 50));
  assert.ok(echoed.includes("echo:one") && echoed.includes("echo:two"), "stream echo " + echoed);
  e.socket.destroy(); await new Promise((z) => setTimeout(z, 1500)); assert.equal(streams.size, 0, "closing the stream closes the session");
  broker = () => ({ ws: fakeBroker({ refuse: "No exit node is selected." }) });
  const bad = await tun("x.example", 80); assert.equal(bad.ok, false); assert.equal(bad.reason, "No exit node is selected."); assert.ok(!bad.retry);
  const big = crypto.randomBytes(12 << 20), want = crypto.createHash("sha256").update(big).digest("hex");
  const bigSite = net.createServer((sk) => { sk.on("error", () => {}); let off = 0; const go = () => { while (off < big.length) { const k = Math.min(64 * 1024, big.length - off); const ok = sk.write(big.subarray(off, off + k)); off += k; if (!ok) return sk.once("drain", go); } sk.end(); }; go(); });
  curSite = await listen(bigSite); broker = () => ({ ws: fakeBroker() });
  const t = await tun("big.example", 80); assert.ok(t.ok);
  const h = crypto.createHash("sha256"); let n = 0;
  await new Promise((z, b2) => { t.socket.on("data", (d) => { h.update(d); n += d.length; }); t.socket.on("end", z); t.socket.on("error", b2); });
  assert.equal(n, big.length); assert.equal(h.digest("hex"), want, "stream download in order"); bigSite.close(); curSite = sitePort;
  // A platform without the capability test route gets the session tunnel.
  streamRoutes = false; broker = () => ({ ws: fakeBroker() }); let said2 = "";
  const old = await httpTunnel(base, { log: (l) => { said2 += l; } })("echo.example", 80); assert.ok(old.ok); assert.match(said2, /session requests/); old.socket.destroy();
}
proxy.close(); worker.close(); site.close();
console.log("PASS: exit stream transport");
process.exit(0);
