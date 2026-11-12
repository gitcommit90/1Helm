// The Browser exit node transport between a channel computer and its Tailscale broker. The computer's outbound requests to tsproxy.internal go through
// the container's HTTP interception, which does not carry WebSocket upgrades (error "Invalid Upgrade header"), so each browser
// connection is a short session of ordinary requests instead: open (the Worker dials the broker over a WebSocket and relays the broker's answer),
// write (bytes to the site), read (a long poll that returns the bytes the site sent, or the end of the connection) and close.
// This class holds only the sessions and their queues. The caller supplies openWs, which returns { ws } (an accepted WebSocket-like object with
// addEventListener, send and close) or { reason, status }. The broker keeps its own rules (a public destination only, the exit node chosen by the person).
export const MAX_STREAMS = 64, MAX_QUEUE_BYTES = 32 << 20, READ_WAIT_MS = 20e3, IDLE_MS = 120e3, READ_CHUNK_BYTES = 1024 * 1024, OPEN_WAIT_MS = 40e3;
// Binary frames arrive as an ArrayBuffer, or as a Blob when the WebSocket's binaryType is "blob" (the Workers default for a WebSocket from fetch:
// new Uint8Array(blob) is an empty array, which is how the first version returned empty reads). Blobs are read in arrival order.
const asBytes = (d) => typeof d === "string" ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : d instanceof ArrayBuffer ? new Uint8Array(d) : null;

export class ExitStreams {
  constructor({ openWs, now = Date.now, sleep = (ms) => new Promise((z) => setTimeout(z, ms)) }) { this.openWs = openWs; this.now = now; this.sleep = sleep; this.map = new Map(); }
  get size() { return this.map.size; }
  async open(host, port) {
    host = String(host || "").slice(0, 255); port = Number(port);
    if (!host || !(port > 0 && port < 65536)) return { ok: false, reason: "The browser asked for an address that cannot be used.", status: 400 };
    this.sweep();
    if (this.map.size >= MAX_STREAMS) return { ok: false, reason: "Too many browser connections are open.", status: 503 };
    const o = await this.openWs();
    if (!o.ws) return { ok: false, reason: o.reason || "The exit node is unavailable.", status: o.status || 503 };
    const ws = o.ws, st = { ws, q: [], bytes: 0, closed: false, waiters: [], rseq: 0, last: this.now(), hello: false, chain: Promise.resolve() };
    try { ws.binaryType = "arraybuffer"; } catch {}
    const wake = () => { const w = st.waiters; st.waiters = []; for (const f of w) f(); };
    const end = () => { if (st.closed) return; st.closed = true; try { ws.close(1000, "done"); } catch {} wake(); };
    st.end = end;
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => { resolve({ ok: false, reason: "The exit node did not answer in time." }); end(); }, OPEN_WAIT_MS);
      const finish = (v) => { clearTimeout(timer); resolve(v); };
      ws.addEventListener("message", (e) => {
        if (!st.hello) { st.hello = true; let r = null; try { r = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)); } catch {} return finish(r && typeof r === "object" ? r : { ok: false, reason: "The exit node gave an unreadable answer." }); }
        const add = (b) => { if (!b?.length) return; st.q.push(b); st.bytes += b.length; st.last = this.now(); if (st.bytes > MAX_QUEUE_BYTES) end(); wake(); };
        const b = asBytes(e.data);
        if (b) { st.chain = st.chain.then(() => add(b)); return; }
        if (typeof e.data?.arrayBuffer === "function") st.chain = st.chain.then(() => e.data.arrayBuffer()).then((ab) => add(new Uint8Array(ab))).catch(() => end());
      });
      const gone = () => { st.chain = st.chain.then(() => { st.closed = true; wake(); });  if (!st.hello) { st.hello = true; finish({ ok: false, reason: "The exit node connection closed." }); } };
      ws.addEventListener("close", gone); ws.addEventListener("error", gone);
      try { ws.send(JSON.stringify({ host, port })); } catch { gone(); }
    });
    if (!reply.ok) { end(); return { ok: false, reason: String(reply.reason || "The exit node could not open the connection.").slice(0, 200), status: 502 }; }
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.map.set(id, st);
    return { ok: true, id };
  }
  // A long poll: waits for bytes, the end of the connection, or READ_WAIT_MS. { data } has bytes, { eof } means the connection is over, neither means "ask again".
  // Every answer that carries bytes gets the next number in seq (the queue is emptied in one step, so the number follows the byte order), and an eof carries the
  // count of byte answers before it. A client may keep two reads in flight and use seq to put the answers back in order; a client that keeps one in flight can ignore it.
  async read(id) {
    const st = this.map.get(id); if (!st) return { eof: true, seq: 0 };
    st.last = this.now();
    if (!st.q.length && !st.closed) await Promise.race([new Promise((z) => { st.waiters.push(z); }), this.sleep(READ_WAIT_MS)]);
    st.last = this.now();
    if (st.q.length) {
      let n = 0; const parts = [];
      while (st.q.length && n < READ_CHUNK_BYTES) { const b = st.q.shift(); parts.push(b); n += b.length; st.bytes -= b.length; }
      let out = parts[0]; if (parts.length > 1) { out = new Uint8Array(n); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; } }
      return { data: out, seq: st.rseq++ };
    }
    if (st.closed) { st.eofAt ||= this.now(); return { eof: true, seq: st.rseq }; }
    return {};
  }
  // One streaming request per browser connection: open the connection, then return { ok, readable, pump }. readable is the site's bytes (it ends when the site or the
  // browser closes), and pump(body) sends the request body's chunks to the site, in order, and ends the connection when the body ends. Same session, same limits as open().
  async stream(host, port) {
    const o = await this.open(host, port); if (!o.ok) return o;
    const id = o.id, self = this;
    // The first byte (0) is only a ready mark, so the response starts at once even when the site says nothing yet. The reader drops it.
    const readable = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(1)); },
      async pull(c) {
        for (;;) {
          const r = await self.read(id);
          if (r.data) return c.enqueue(r.data);
          if (r.eof) { self.close(id); return c.close(); }
        }
      },
      cancel() { self.close(id); },
    });
    const pump = async (body, onChunk = () => {}) => {
      try {
        let first = true;   // the request body starts with a ready mark byte, not browser data
        if (body) for await (let ch of body) { onChunk(); if (first) { first = false; ch = ch.subarray(1); } if (ch.length && !self.write(id, ch).ok) break; }
      } catch {}
      self.close(id);
    };
    return { ok: true, id, readable, pump };
  }
  write(id, bytes) {
    const st = this.map.get(id); if (!st || st.closed) return { ok: false, status: 410 };
    st.last = this.now();
    try { st.ws.send(bytes); } catch { st.end(); return { ok: false, status: 410 }; }
    return { ok: true };
  }
  close(id) { const st = this.map.get(id); if (st) { st.end(); this.map.delete(id); } }
  // Sessions nobody has read or written for IDLE_MS are closed.
  sweep() { const t = this.now(); for (const [id, st] of this.map) if (t - st.last > IDLE_MS || (st.eofAt && t - st.eofAt > 10e3)) { st.end(); this.map.delete(id); } }
}
