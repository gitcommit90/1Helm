// A zip file written straight into an R2 multipart upload, in a form that can stop and start again (data-export.js, "Export my data").
// Memory is bounded: at most a few parts (the part size is chosen by the caller, 8 to 64 MiB) are held at once, so an account of any size can be exported.
//
// What the file looks like: every entry is stored without compression, with its sizes and checksum in a data descriptor after the bytes
// (so an entry can be written while its bytes are still being read), and every size and offset is written in the zip64 form, so there is no
// 4 GiB or 65,535 entry limit. Python's zipfile, Info-ZIP unzip, 7-Zip, macOS and Windows open it.
//
// How it resumes: R2 needs every part of a multipart upload to be the same size except the last one, so the writer cuts the stream into
// exact PART sized parts and uploads each one as soon as it is full. The bytes that do not fill a part yet (the tail) and the central
// directory records of the finished entries are copied to small scratch objects at every checkpoint, and the numbers needed to carry on
// (upload id, the uploaded parts, the entry being written with its running checksum) are in `state`, which the caller saves. A caller
// that starts again with the last saved state continues byte for byte. A part uploaded after the last checkpoint is simply uploaded again.
// The scratch objects and the zip are outside t/<tenant>/ (see data-export.js), so they never count against the person's storage.
import { stPut, stDelete, stComplete } from "./storage.js";

export const PART = 8 * 1024 * 1024;
const enc = new TextEncoder();

let TABLES = null;
const tables = () => {
  if (TABLES) return TABLES;
  const T = new Uint32Array(256 * 8);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  for (let n = 0; n < 256; n++) { let c = T[n]; for (let t = 1; t < 8; t++) { c = T[c & 255] ^ (c >>> 8); T[t * 256 + n] = c >>> 0; } }
  return (TABLES = T);
};
// Running CRC-32 (eight bytes at a time): crc32(0, a) then crc32(thatValue, b) is the CRC of a followed by b.
export function crc32(crc, bytes) {
  const T = tables(), n = bytes.length; let c = ~crc >>> 0, i = 0;
  for (; i + 8 <= n; i += 8) {
    const a = (c ^ bytes[i] ^ (bytes[i + 1] << 8) ^ (bytes[i + 2] << 16) ^ (bytes[i + 3] << 24)) >>> 0;
    c = T[1792 + (a & 255)] ^ T[1536 + ((a >>> 8) & 255)] ^ T[1280 + ((a >>> 16) & 255)] ^ T[1024 + (a >>> 24)] ^ T[768 + bytes[i + 4]] ^ T[512 + bytes[i + 5]] ^ T[256 + bytes[i + 6]] ^ T[bytes[i + 7]];
  }
  for (; i < n; i++) c = T[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
const dos = (ms) => { const d = new Date(Number.isFinite(ms) ? ms : 0), y = Math.max(1980, d.getUTCFullYear());
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() }; };
const concat = (list, len) => { const o = new Uint8Array(len ?? list.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of list) { o.set(x, p); p += x.length; } return o; };
const u8 = (n) => new Uint8Array(n);
function view(len) { const b = u8(len); return [b, new DataView(b.buffer)]; }
const big = (n) => BigInt(Math.max(0, Math.floor(n)));

// The bytes of each zip structure (all little endian).
export function localHeader(name, at) {
  const nm = enc.encode(name), { time, date } = dos(at), [b, v] = view(30 + nm.length + 20);
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, 45, true); v.setUint16(6, 0x0808, true);   // bit 3 (data descriptor) and bit 11 (UTF-8 name)
  v.setUint16(8, 0, true); v.setUint16(10, time, true); v.setUint16(12, date, true);           // stored, no compression
  v.setUint16(26, nm.length, true); v.setUint16(28, 20, true); b.set(nm, 30);
  v.setUint16(30 + nm.length, 1, true); v.setUint16(32 + nm.length, 16, true);                  // zip64 extra, sizes follow in the descriptor
  return b;
}
export function dataDescriptor(crc, size) {
  const [b, v] = view(24); v.setUint32(0, 0x08074b50, true); v.setUint32(4, crc >>> 0, true); v.setBigUint64(8, big(size), true); v.setBigUint64(16, big(size), true); return b;
}
export function centralRecord({ name, off, crc, len, at }) {
  const nm = enc.encode(name), { time, date } = dos(at), [b, v] = view(46 + nm.length + 28);
  v.setUint32(0, 0x02014b50, true); v.setUint16(4, 0x033f, true); v.setUint16(6, 45, true); v.setUint16(8, 0x0808, true); v.setUint16(10, 0, true);
  v.setUint16(12, time, true); v.setUint16(14, date, true); v.setUint32(16, crc >>> 0, true); v.setUint32(20, 0xffffffff, true); v.setUint32(24, 0xffffffff, true);
  v.setUint16(28, nm.length, true); v.setUint16(30, 28, true); v.setUint32(38, (0o100644 << 16) >>> 0, true); v.setUint32(42, 0xffffffff, true); b.set(nm, 46);
  const x = 46 + nm.length; v.setUint16(x, 1, true); v.setUint16(x + 2, 24, true); v.setBigUint64(x + 4, big(len), true); v.setBigUint64(x + 12, big(len), true); v.setBigUint64(x + 20, big(off), true);
  return b;
}
export function endRecords(entries, cdOffset, cdSize) {
  const [a, v] = view(56 + 20 + 22);
  v.setUint32(0, 0x06064b50, true); v.setBigUint64(4, 44n, true); v.setUint16(12, 45, true); v.setUint16(14, 45, true); v.setUint32(16, 0, true); v.setUint32(20, 0, true);
  v.setBigUint64(24, big(entries), true); v.setBigUint64(32, big(entries), true); v.setBigUint64(40, big(cdSize), true); v.setBigUint64(48, big(cdOffset), true);
  v.setUint32(56, 0x07064b50, true); v.setUint32(60, 0, true); v.setBigUint64(64, big(cdOffset + cdSize), true); v.setUint32(72, 1, true);
  v.setUint32(76, 0x06054b50, true); v.setUint16(80, 0, true); v.setUint16(82, 0, true); v.setUint16(84, 0xffff, true); v.setUint16(86, 0xffff, true); v.setUint32(88, 0xffffffff, true); v.setUint32(92, 0xffffffff, true); v.setUint16(96, 0, true);
  return a;
}

const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await new Promise((r) => setTimeout(r, 200 * (i + 1))); } } throw e; };
const readAll = async (o) => new Uint8Array(await o.arrayBuffer());

// How many part buffers there are at most for a part size (the one being filled, or the ones being uploaded). 48 MiB of part buffers for the small
// sizes (five 8 MiB buffers), and one buffer (no overlap) for 32 and 64 MiB, so a 128 MB Worker has room for the files being read as well.
export const bufferCount = (part) => Math.max(1, Math.min(5, Math.floor((48 * 1024 * 1024) / part)));

// env.WS is the bucket. key: the zip. scratch: the prefix for tail and central directory objects. state: the saved numbers (a fresh {} to start).
// Parts are uploaded while the next bytes are still being collected (up to bufferCount - 1 uploads at a time). checkpoint() and finish() wait for every upload
// first, so a saved state always describes whole uploaded parts plus the tail.
export class ZipOut {
  constructor(env, { key, scratch, state = {}, part = PART }) {
    this.env = env; this.key = key; this.scratch = scratch; this.part = state.part || part; this.state = state; state.part = this.part;   // a resumed upload keeps the part size it started with
    state.parts ||= []; state.size ||= 0; state.entries ||= 0; state.cdSegs ||= 0; state.cdBytes ||= 0; state.tailLen ||= 0; state.cur ||= null;
    this.buf = null; this.bufLen = 0; this.cdPending = []; this.partsSince = 0; this.mpu = null;
    this.free = []; this.flying = []; this.landed = new Map(); this.err = null; this.nextPart = state.parts.length + 1;
  }
  _grab() { return this.free.pop() || new Uint8Array(this.part); }
  async open() {
    const s = this.state;
    if (!s.uploadId) { this.mpu = await this.env.WS.createMultipartUpload(this.key, { httpMetadata: { contentType: "application/zip" } }); s.uploadId = this.mpu.uploadId; return this; }
    this.mpu = this.env.WS.resumeMultipartUpload(this.key, s.uploadId);
    if (s.tailLen > 0) {
      const o = await this.env.WS.get(`${this.scratch}/tail-${s.tailSeq}`); if (!o) throw new Error("export scratch is missing (tail)");
      const t = await readAll(o); if (t.length !== s.tailLen) throw new Error("export scratch is damaged (tail)");
      this.buf = this._grab(); this.buf.set(t); this.bufLen = t.length;
    }
    if (s.parts.length * this.part + this.bufLen !== s.size) throw new Error("export state does not add up");
    return this;
  }
  _fly(n, buf, len) {
    const p = (async () => {
      try { const r = await retry(() => this.mpu.uploadPart(n, buf.subarray(0, len))); this.landed.set(n, r.etag); this.partsSince++; if (len === this.part) this.free.push(buf); }
      catch (e) { this.err ||= e; }
    })();
    this.flying.push(p); return p;
  }
  async _room() {   // keep the number of uploads in flight within the buffers there is room for
    const max = bufferCount(this.part) - 1;
    while (this.flying.length > max) { await this.flying.shift(); }
    if (this.err) throw this.err;
  }
  async _push(bytes) {
    this.state.size += bytes.length;
    let at = 0;
    while (at < bytes.length) {
      if (!this.buf) { this.buf = this._grab(); this.bufLen = 0; }
      const n = Math.min(this.part - this.bufLen, bytes.length - at);
      this.buf.set(bytes.subarray(at, at + n), this.bufLen); this.bufLen += n; at += n;
      if (this.bufLen === this.part) {
        const buf = this.buf, num = this.nextPart++; this.buf = null; this.bufLen = 0;
        this._fly(num, buf, this.part); await this._room();
      }
    }
  }
  // Wait for every upload in flight and record them in the state (in part order).
  async settle() {
    while (this.flying.length) await this.flying.shift();
    if (this.err) throw this.err;
    for (const n of [...this.landed.keys()].sort((a, b) => a - b)) {
      if (n !== this.state.parts.length + 1) throw new Error("export parts are out of order");
      this.state.parts.push([n, this.landed.get(n)]);
    }
    this.landed.clear();
  }
  async begin(name, at = 0) {
    if (this.state.cur) throw new Error("an entry is already open");
    const off = this.state.size; this.state.cur = { name, off, crc: 0, len: 0, at };
    await this._push(localHeader(name, at));
  }
  async write(bytes) {
    const c = this.state.cur; if (!c) throw new Error("no open entry");
    if (!bytes.length) return;
    c.crc = crc32(c.crc, bytes); c.len += bytes.length; await this._push(bytes);
  }
  async end() {
    const c = this.state.cur; if (!c) throw new Error("no open entry");
    await this._push(dataDescriptor(c.crc, c.len)); this.cdPending.push(centralRecord(c)); this.state.entries++; this.state.cur = null;
  }
  async entry(name, bytes, at = 0) { await this.begin(name, at); await this.write(bytes); await this.end(); }
  // Make everything so far survive a restart: the bytes not yet in a part, and the central directory records of the finished entries. seq is the caller's
  // checkpoint number; the caller saves `state` (with its own numbers) after this returns, then calls dropOld(previous seq).
  async checkpoint(seq) {
    const s = this.state; await this.settle();
    if (this.cdPending.length) {
      const seg = concat(this.cdPending); await stPut(this.env, `${this.scratch}/cd-${s.cdSegs + 1}`, seg); s.cdSegs++; s.cdBytes += seg.length; this.cdPending = [];
    }
    if (this.bufLen > 0) { await stPut(this.env, `${this.scratch}/tail-${seq}`, this.buf.subarray(0, this.bufLen)); s.tailSeq = seq; } else s.tailSeq = null;
    s.tailLen = this.bufLen; this.partsSince = 0;
  }
  async dropOld(seq) { if (seq) await stDelete(this.env, [`${this.scratch}/tail-${seq}`]).catch(() => {}); }
  // The central directory, the end records, the last part, and the upload is complete. → { size, entries }
  async finish() {
    const s = this.state; if (s.cur) throw new Error("an entry is still open");
    const entries = s.entries, cdOffset = s.size;
    for (let k = 1; k <= s.cdSegs; k++) { const o = await this.env.WS.get(`${this.scratch}/cd-${k}`); if (!o) throw new Error("export scratch is missing (directory)"); await this._push(await readAll(o)); }
    if (this.cdPending.length) { await this._push(concat(this.cdPending)); this.cdPending = []; }
    const cdSize = s.size - cdOffset;
    await this._push(endRecords(entries, cdOffset, cdSize));
    if (this.bufLen > 0) { const buf = this.buf, num = this.nextPart++, len = this.bufLen; this.buf = null; this.bufLen = 0; this._fly(num, buf, len); }
    await this.settle();
    if (s.parts.length > 10000) throw new Error("the zip needs more than 10,000 parts");
    const o = await stComplete(this.env, this.key, this.mpu, s.parts.map(([partNumber, etag]) => ({ partNumber, etag })));
    return { size: Number(o?.size ?? s.size), entries };
  }
  async abort() { try { await Promise.allSettled(this.flying); } catch {} try { await (this.mpu || this.env.WS.resumeMultipartUpload(this.key, this.state.uploadId)).abort(); } catch {} }
}
