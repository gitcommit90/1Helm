// The computer's browser exit proxy (only used while the person has turned on "Browser exit node" for this channel computer).
// Chrome is started with --proxy-server=http://127.0.0.1:<port>, which is this server. Each browser connection becomes a session of plain
// requests to http://tsproxy.internal/s/* (open, write, read, close). The Worker intercepts that host, so the requests reach the platform's isolated Tailscale
// broker, and the broker dials the site through the exit node the person picked. Nothing here dials a public site directly,
// except hosts on the `direct` list: those are the hosts Sentinel guards (saved-key hosts and 1Helm's own hosts), which keep their
// existing path through Sentinel so a real saved key still never sits inside the computer.
// A connection that cannot be carried gets a 502 with a plain reason. There is no fallback to the computer's own internet connection.
import http from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";

export const EXIT_PROXY_PORT = 3129;
const WRITE_REQUEST_BYTES = 512 * 1024, WRITE_HOLD_BYTES = 4 << 20, BULK_BYTES = 16 * 1024;
export const exitMessage = (reason) => `The browser's exit node is unavailable: ${reason || "no reason was given"} The page was not loaded, and no direct connection was used.`;

// The tunnel opener: ordinary requests to the platform (the container's outbound interception does not carry WebSocket upgrades).
// base is "http://tsproxy.internal". Each connection is a session: open, then a write request per chunk and long-poll read requests
// (the server side is src/exit-stream.js). Returns { ok, reason, detail, socket }.
export function sessionTunnel(base, { fetchFn = globalThis.fetch, timeoutMs = 45e3 } = {}) {
  return async (host, port) => {
    let r, j = null, text = "";
    try {
      r = await fetchFn(`${base}/s/open`, { method: "POST", body: JSON.stringify({ host, port }), signal: AbortSignal.timeout(timeoutMs) });
      text = await r.text(); try { j = JSON.parse(text); } catch {}
    } catch (e) { return { ok: false, reason: "1Helm could not reach the exit node.", detail: `open request failed: ${String(e?.cause?.message || e?.message || e).slice(0, 120)}` }; }
    if (!j?.ok || !j.id) return { ok: false, reason: String(j?.reason || "The exit node is unavailable.").slice(0, 200), detail: `open HTTP ${r.status}: ${text.slice(0, 120)}` };
    const q = `?id=${encodeURIComponent(j.id)}`; let over = false, paused = false, wakers = [];
    const wakeAll = () => { const z = wakers; wakers = []; for (const f of z) f(); };
    const sendClose = () => fetchFn(`${base}/s/close${q}`, { method: "POST", signal: AbortSignal.timeout(5e3) }).catch(() => {});
    const finishSession = () => { if (over) return; over = true; wakeAll(); sendClose(); };
    // Writes: the browser's chunks queue up and go out together, one request at a time (so the order holds). While a request is in flight the next bytes
    // pile up and leave as one bigger request, instead of one request per chunk. The browser is only held back when more than WRITE_HOLD_BYTES wait.
    let pend = [], pendBytes = 0, sending = false, held = null, idleWaiters = [];
    const pump = async () => {
      if (sending) return; sending = true;
      try {
        while (pend.length && !over) {
          const parts = []; let n = 0;
          while (pend.length && n < WRITE_REQUEST_BYTES) { const c = pend.shift(); parts.push(c); n += c.length; }
          pendBytes -= n; if (held && pendBytes <= WRITE_HOLD_BYTES) { const h = held; held = null; h(null); }
          const w = await fetchFn(`${base}/s/w${q}`, { method: "POST", body: parts.length === 1 ? parts[0] : Buffer.concat(parts), signal: AbortSignal.timeout(timeoutMs) });
          await w.arrayBuffer().catch(() => {});
          if (w.status !== 204) throw new Error(`write refused (HTTP ${w.status})`);
        }
      } catch (e) { if (!over) sock.destroy(e); }
      finally { sending = false; if (!pend.length) { const z = idleWaiters; idleWaiters = []; for (const f of z) f(); } }
    };
    const flushed = () => (pend.length || sending) ? new Promise((z) => { idleWaiters.push(z); }) : Promise.resolve();
    const sock = new Duplex({
      allowHalfOpen: false,
      read() { paused = false; wakeAll(); },
      write(chunk, _enc, cb) { pend.push(chunk); pendBytes += chunk.length; pump(); if (pendBytes > WRITE_HOLD_BYTES) held = cb; else cb(); },
      // The browser closing its side ends the session (a browser connection is closed by Chrome, not half-closed). Bytes already queued go out first.
      final(cb) { flushed().then(() => { finishSession(); cb(); sock.destroy(); }); },
      destroy(err, cb) { finishSession(); if (held) { const h = held; held = null; h(null); } cb(err); },
    });
    // Reads: long polls. The Worker numbers each answer that carries bytes (x-seq), so a second poll can run beside the first while the site is sending a lot
    // (a download), and the answers are put back in order here. With a Worker that sends no numbers, only one poll runs.
    let nextSeq = 0, eofAt = -1, bulk = false, pollers = 0;
    const ready = new Map();
    const deliver = () => {
      while (ready.has(nextSeq)) { const b = ready.get(nextSeq); ready.delete(nextSeq); nextSeq++; if (!sock.push(b)) paused = true; }
      if (eofAt >= 0 && nextSeq >= eofAt && !over) { over = true; sock.push(null); sendClose(); }
    };
    const poll = async () => {
      pollers++;
      try {
        while (!over) {
          if (paused) { await new Promise((z) => { wakers.push(z); }); continue; }
          let g; try { g = await fetchFn(`${base}/s/r${q}`, { signal: AbortSignal.timeout(timeoutMs) }); } catch (e) { if (!over) sock.destroy(new Error(`read request failed: ${String(e?.cause?.message || e?.message || e).slice(0, 100)}`)); return; }
          const sq = g.headers.get("x-seq"), seq = sq == null ? null : Number(sq);
          if (g.status === 204) { await g.arrayBuffer().catch(() => {}); if (g.headers.get("x-eof")) { if (seq == null) { over = true; sock.push(null); sendClose(); return; } eofAt = seq; deliver(); return; } continue; }
          if (g.status !== 200) { await g.arrayBuffer().catch(() => {}); if (!over) sock.destroy(new Error(`read refused (HTTP ${g.status})`)); return; }
          const buf = Buffer.from(await g.arrayBuffer());
          if (seq == null) { if (buf.length && !sock.push(buf)) paused = true; }
          else { ready.set(seq, buf); if (buf.length >= BULK_BYTES && !bulk) { bulk = true; if (pollers < 2 && !over) poll(); } deliver(); }
        }
      } finally { pollers--; }
    };
    poll();
    return { ok: true, socket: sock };
  };
}

// The streaming tunnel: one request per browser connection. The request body carries the browser's bytes and the response body carries the site's, so there is no
// polling and no request per chunk. The platform refuses before any byte flows (a plain JSON status), the same refusals as /s/open.
// A network failure of the request itself (not a refusal) returns { retry: true } so the caller can use the session tunnel instead.
export function streamTunnel(base, { fetchFn = globalThis.fetch, timeoutMs = 45e3 } = {}) {
  return async (host, port) => {
    const ac = new AbortController(); let reqCtl = null, held = null;
    const body = new ReadableStream({ start(c) { reqCtl = c; c.enqueue(new Uint8Array(1)); /* ready mark: the request line goes out at once */ }, pull() { const h = held; held = null; h?.(null); } }, { highWaterMark: 256 * 1024, size: (c) => c.byteLength });
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let r;
    try { r = await fetchFn(`${base}/s/stream?host=${encodeURIComponent(host)}&port=${port}`, { method: "POST", body, duplex: "half", signal: ac.signal }); }
    catch (e) { clearTimeout(timer); return { ok: false, retry: true, reason: "1Helm could not reach the exit node.", detail: `stream request failed: ${String(e?.cause?.message || e?.message || e).slice(0, 120)}` }; }
    clearTimeout(timer);
    if (r.status !== 200) {
      let text = "", j = null; try { text = await r.text(); j = JSON.parse(text); } catch {}
      ac.abort();
      return { ok: false, reason: String(j?.reason || "The exit node is unavailable.").slice(0, 200), detail: `stream HTTP ${r.status}: ${text.slice(0, 120)}` };
    }
    let over = false, wake = null, marked = false;
    const sock = new Duplex({
      allowHalfOpen: false,
      read() { const z = wake; wake = null; z?.(); },
      write(chunk, _enc, cb) { try { reqCtl.enqueue(chunk); } catch { return cb(new Error("connection closed")); } if (reqCtl.desiredSize > 0) cb(); else held = cb; },
      final(cb) { try { reqCtl.close(); } catch {} cb(); setTimeout(() => sock.destroy(), 0); },
      destroy(err, cb) { over = true; wake?.(); if (held) { const h = held; held = null; h(null); } try { reqCtl.close(); } catch {} ac.abort(); cb(err); },
    });
    (async () => {
      const rd = r.body.getReader();
      try {
        for (;;) {
          const x = await rd.read();
          if (x.done) { if (!over) { over = true; sock.push(null); } return; }
          let v = x.value; if (!marked && v?.length) { marked = true; v = v.subarray(1); }   // the ready mark
          if (v?.length && !sock.push(Buffer.from(v.buffer, v.byteOffset, v.byteLength))) await new Promise((z) => { wake = z; });
          if (over) return;
        }
      } catch (e) { if (!over) sock.destroy(new Error(`stream read failed: ${String(e?.cause?.message || e?.message || e).slice(0, 100)}`)); }
    })();
    return { ok: true, socket: sock };
  };
}

// Can a request be answered while its body is still being sent (the streaming tunnel needs it)? Asked once from the platform and remembered; a failure is asked again after ten minutes.
async function duplexWorks(base, fetchFn) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8e3); let ctl = null;
  try {
    const body = new ReadableStream({ start(c) { ctl = c; c.enqueue(new Uint8Array([1, 2, 3, 4])); } });
    const r = await fetchFn(`${base}/s/echo?mode=duplex`, { method: "POST", body, duplex: "half", signal: ac.signal });
    if (r.status !== 200) return false;
    const rd = r.body.getReader(); const a = await rd.read(); if (a.done || !a.value?.length) return false;
    ctl.enqueue(new Uint8Array([5, 6])); const b = await rd.read(); const ok = !b.done && b.value?.length > 0;
    ctl.close(); ctl = null; while (!(await rd.read()).done);   // end the request and read the answer to its end, so the connection is left clean
    return ok;
  } catch { return false; } finally { clearTimeout(t); try { ctl?.close(); } catch {} ac.abort(); }
}

// The tunnel the exit proxy uses: streaming when the platform answers while the request body is still open, else the session tunnel. Never a direct connection.
export function httpTunnel(base, { fetchFn = globalThis.fetch, timeoutMs = 45e3, stream = true, log = () => {} } = {}) {
  const session = sessionTunnel(base, { fetchFn, timeoutMs }), streaming = streamTunnel(base, { fetchFn, timeoutMs });
  let verdict = null, askedAt = 0;
  const canStream = async () => {
    if (verdict === true) return true;
    if (verdict === false && Date.now() - askedAt < 600e3) return false;
    verdict ||= duplexWorks(base, fetchFn).then((ok) => { askedAt = Date.now(); verdict = ok; log(`exit tunnel: ${ok ? "streaming" : "session requests (streaming unavailable)"}`); return ok; });
    return verdict === true || (verdict instanceof Promise ? await verdict : false);
  };
  const tunnel = async (host, port) => {
    if (stream && await canStream()) {
      const t = await streaming(host, port);
      if (!t.retry) return t;
      verdict = false; askedAt = Date.now();
    }
    return session(host, port);
  };
  // mode(): "streaming", "session" or "unknown" (not asked yet). check(): asks now (and logs the answer once through log).
  tunnel.mode = () => verdict === true ? "streaming" : verdict === false ? "session" : "unknown";
  tunnel.check = () => (stream ? canStream() : Promise.resolve(false));
  return tunnel;
}

const hostPort = (s, dflt) => { const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(String(s || "")); return m ? { host: m[1], port: Number(m[2] || dflt) } : null; };

// openTunnel: (host, port) → Promise<{ ok, reason?, socket? }>. direct: (host) → true for hosts that keep their own path (Sentinel).
export function createExitProxy({ openTunnel, direct = () => false, log = () => {} }) {
  const state = { lastReason: "", lastFailAt: 0, lastOkAt: 0, open: 0 };
  // What each browser connection cost, for the dev probe (the last 300): open_ms is the time to get the tunnel (the platform's dial through the exit node), ttfb_ms is the time from
  // the browser's first byte to the site's first answer byte, total_ms the connection's life, and up/down the bytes each way.
  const conns = []; let statsFrom = Date.now();
  const note = (c) => { conns.push(c); if (conns.length > 300) conns.shift(); };
  const meter = (host, port, openMs, browser, tunnel) => {
    const c = { host, port, at: Date.now() - statsFrom, open_ms: openMs, ttfb_ms: null, total_ms: null, up: 0, down: 0 }; let t0 = Date.now(), tUp = 0;
    browser.on("data", (d) => { c.up += d.length; if (!tUp) tUp = Date.now(); });
    tunnel.on("data", (d) => { c.down += d.length; if (c.ttfb_ms == null && tUp) c.ttfb_ms = Date.now() - tUp; });
    tunnel.once("close", () => { c.total_ms = Date.now() - t0; note(c); });
  };
  const q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : null;
  const stats = ({ reset = false } = {}) => {
    const ok = conns.filter((c) => c.total_ms != null && !c.refused), opens = ok.map((c) => c.open_ms).sort((a, b) => a - b), tt = ok.map((c) => c.ttfb_ms).filter((x) => x != null).sort((a, b) => a - b);
    const out = { since_ms: Date.now() - statsFrom, connections: conns.length, refused: conns.filter((c) => c.refused).length, open_ms: { p50: q(opens, 0.5), p90: q(opens, 0.9), max: opens.at(-1) ?? null }, ttfb_ms: { p50: q(tt, 0.5), p90: q(tt, 0.9), max: tt.at(-1) ?? null },
      up: ok.reduce((a, c) => a + c.up, 0), down: ok.reduce((a, c) => a + c.down, 0), mode: openTunnel.mode?.() || "unknown",
      slowest: [...conns].sort((a, b) => (b.total_ms || 0) - (a.total_ms || 0)).slice(0, 8), refused_hosts: [...new Set(conns.filter((c) => c.refused).map((c) => c.host))].slice(0, 10) };
    if (reset) { conns.length = 0; statsFrom = Date.now(); }
    return out;
  };
  const track = (sock) => { state.open++; sock.once("close", () => { state.open--; }); };
  const open = async (host, port) => {
    const tOpen = Date.now(); const r = await open0(host, port); r.open_ms = Date.now() - tOpen;
    if (!r.ok) note({ host, port, at: Date.now() - statsFrom, open_ms: r.open_ms, refused: true, total_ms: 0, up: 0, down: 0 });
    return r;
  };
  const open0 = async (host, port) => {
    if (direct(host)) {
      return await new Promise((z) => { const s = net.connect(port, host); s.once("connect", () => z({ ok: true, socket: s })); s.once("error", () => z({ ok: false, reason: `${host} could not be reached.` })); });
    }
    const t = await openTunnel(host, port);
    if (t.ok) state.lastOkAt = Date.now(); else { state.lastReason = t.reason || ""; state.lastFailAt = Date.now(); log(`exit tunnel to ${host}:${port} refused: ${t.reason}${t.detail ? " (" + t.detail + ")" : ""}`); }
    return t;
  };
  const refuse = (socket, reason) => {
    const body = exitMessage(reason);
    try { socket.end(`HTTP/1.1 502 Bad Gateway\r\nx-1helm-exit: unavailable\r\ncontent-type: text/plain\r\nconnection: close\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); } catch {}
  };
  const server = http.createServer(async (req, res) => {
    // A plain http:// request sent to the proxy in absolute form.
    let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    if (u.protocol !== "http:") { res.writeHead(400); return res.end(); }
    const sock = req.socket; sock.pause();
    const t = await open(u.hostname, Number(u.port || 80));
    if (!t.ok) return refuse(sock, t.reason);
    track(t.socket); meter(u.hostname, Number(u.port || 80), t.open_ms, sock, t.socket);
    const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) { const k = req.rawHeaders[i]; if (/^(proxy-|connection$|keep-alive$)/i.test(k)) continue; lines.push(`${k}: ${req.rawHeaders[i + 1]}`); }
    lines.push("Connection: close", "", "");
    t.socket.write(lines.join("\r\n"));
    req.pipe(t.socket); t.socket.pipe(sock);
    sock.on("close", () => t.socket.destroy()); t.socket.on("close", () => sock.destroy());
    t.socket.on("error", () => sock.destroy()); sock.on("error", () => t.socket.destroy());
    sock.resume();
  });
  server.on("connect", async (req, socket, head) => {
    const hp = hostPort(req.url, 443);
    socket.on("error", () => {});
    if (!hp || !hp.host || !(hp.port > 0)) return refuse(socket, "The browser asked for an address that cannot be used.");
    socket.pause();
    const t = await open(hp.host, hp.port);
    if (!t.ok) return refuse(socket, t.reason);
    track(t.socket); meter(hp.host, hp.port, t.open_ms, socket, t.socket);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) t.socket.write(head);
    socket.pipe(t.socket); t.socket.pipe(socket);
    const end = () => { try { socket.destroy(); } catch {} try { t.socket.destroy(); } catch {} };
    socket.on("close", end); t.socket.on("close", end); socket.on("error", end); t.socket.on("error", end);
    socket.resume();
  });
  server.exitState = state; server.exitStats = stats;
  return server;
}
