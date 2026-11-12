// Demuxers for the in-Worker audio converter (audio-convert.js). Each one reads the file by range (Source), a window at a time, and
// yields the compressed audio packets one by one, so memory stays at a few windows however long the file is. They only look at the
// container; the decoders (src/vendor/audio) and the 16 kHz mono WAV pieces are audio-convert.js.
// A demuxer throws Unsupported for a file it must not convert (a codec the decoders lack, more than 2 Opus channels, no audio track, no index),
// and Corrupt for a damaged one; the caller treats both as "send the original file to the next speech model".

export class Unsupported extends Error { constructor(m) { super(m); this.name = "Unsupported"; } }
export class Corrupt extends Error { constructor(m) { super(m); this.name = "Corrupt"; } }

// A file read by range: read(offset, length) → Uint8Array (R2 get with a range; fewer bytes than asked at the end).
// get() returns a view of exactly [off, off + len), clipped to the file. A miss reads a whole window (so a sequential reader makes one
// read per window); a request longer than a window, or { peek: true }, reads just those bytes and keeps no window. A window is never
// reused after it is replaced, so a returned view stays valid for as long as the caller keeps it.
export class Source {
  constructor(read, size, { window = 1 << 20 } = {}) { this.read = read; this.size = size; this.win = window; this.buf = null; this.at = 0; this.reads = 0; this.bytes = 0; }
  async fetch(off, len) { const b = await this.read(off, len); this.reads++; this.bytes += b.length; return b; }
  async get(off, len, { peek = false } = {}) {
    if (!(off >= 0) || off >= this.size || !(len > 0)) return new Uint8Array(0);
    len = Math.min(len, this.size - off);
    const w = this.buf; if (w && off >= this.at && off + len <= this.at + w.length) return w.subarray(off - this.at, off - this.at + len);
    if (peek || len > this.win) return this.fetch(off, len);
    this.buf = await this.fetch(off, Math.min(this.win, this.size - off)); this.at = off;
    return this.buf.subarray(0, Math.min(len, this.buf.length));
  }
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => (b[o] * 16777216) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const ascii = (b, o, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; };

// ---- Ogg Opus and Vorbis ----
// Yields { head: { codec: "opus", channels, preSkip } } or { head: { codec: "vorbis", extra } } at the start of each stream (a chained file has
// several), then { packet } for each audio packet. extra is the Vorbis identification and setup headers in Xiph lacing, as Matroska stores them.
const lace = (n) => { const o = []; while (n >= 255) { o.push(255); n -= 255; } o.push(n); return o; };
export function xiphHeaders(h) {   // [ident, comment, setup] → the laced form
  const sizes = [...lace(h[0].length), ...lace(h[1].length)], out = new Uint8Array(1 + sizes.length + h[0].length + h[1].length + h[2].length); out[0] = 2; out.set(sizes, 1);
  let o = 1 + sizes.length; for (const x of h) { out.set(x, o); o += x.length; } return out;
}
export async function* oggAudio(src) {
  const size = src.size, streams = new Map(); let pos = 0, active = null, started = false, sawOther = false;
  const resync = async (from) => {   // the next "OggS" at or after from
    for (let p = from; p < size; p += 65536) { const b = await src.get(p, 65536 + 3); for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53) return p + i; }
    return -1;
  };
  while (pos + 27 <= size) {
    const h = await src.get(pos, 27 + 255); if (h.length < 27) break;
    if (!(h[0] === 0x4f && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53 && h[4] === 0)) { pos = await resync(pos + 1); if (pos < 0) break; continue; }
    const flags = h[5], serial = h[14] | (h[15] << 8) | (h[16] << 16) | (h[17] << 24), nseg = h[26];
    if (h.length < 27 + nseg) break;
    let payload = 0; for (let i = 0; i < nseg; i++) payload += h[27 + i];
    const total = 27 + nseg + payload, page = await src.get(pos, total);
    if (page.length < total) break;   // truncated in the middle of a page
    let st = streams.get(serial);
    if (flags & 2) { st = { mode: null, n: 0, cur: [], eos: false, hdr: [] }; streams.set(serial, st); if (serial === active) active = null; }   // a new stream with the serial number of the one that just ended (files joined by cat)
    if (st) {
      if (!(flags & 1) && st.cur.length) st.cur = [];   // a packet that should have continued but didn't: a lost page
      let q = 27 + nseg;
      for (let i = 0; i < nseg; i++) {
        const lace = h[27 + i]; st.cur.push(page.subarray(q, q + lace)); q += lace;
        if (lace === 255) continue;
        const n = st.cur.reduce((a, c) => a + c.length, 0); let pk;
        if (st.cur.length === 1) pk = st.cur[0]; else { pk = new Uint8Array(n); let o = 0; for (const c of st.cur) { pk.set(c, o); o += c.length; } }
        st.cur = []; st.n++;
        if (st.n === 1) {
          if (ascii(pk, 0, 8) === "OpusHead" && pk.length >= 19 && (active === null || streams.get(active)?.eos)) {
            const channels = pk[9], preSkip = pk[10] | (pk[11] << 8);
            if (channels < 1 || channels > 2) throw new Unsupported(`Opus with ${channels} channels`);
            st.mode = "opus"; active = serial; started = true; yield { head: { codec: "opus", channels, preSkip } };
          } else if (pk.length >= 30 && pk[0] === 1 && ascii(pk, 1, 6) === "vorbis" && (active === null || streams.get(active)?.eos)) {
            st.mode = "vorbis"; active = serial; started = true; st.hdr = [pk.slice()];
          } else { st.mode = "other"; if (!started) sawOther = true; }
        } else if (st.mode === "opus" && st.n > 2 && pk.length) yield { packet: pk };
        else if (st.mode === "vorbis") {
          if (st.n <= 3) { st.hdr.push(pk.slice()); if (st.n === 3) yield { head: { codec: "vorbis", extra: xiphHeaders(st.hdr) } }; }
          else if (pk.length) yield { packet: pk };
        }
        // for Opus, st.n === 2 is OpusTags
      }
      if (flags & 4) { st.eos = true; st.cur = []; }
    }
    pos += total;
  }
  if (!started) throw new Unsupported(sawOther ? "the Ogg file isn't Opus or Vorbis (FLAC or another codec)" : "no Opus or Vorbis stream in the Ogg file");
}

// ---- WebM / Matroska with Opus, Vorbis, AAC or FLAC ----
// Yields { head } (like oggAudio; AAC and FLAC heads carry extra too) once the tracks are known, then { packet } for each block of the chosen track.
const EBML_ENTER = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0, 0xe1]);   // Segment, Cluster, Tracks, TrackEntry, BlockGroup, Audio: read their children in line, so unknown sizes (live recordings) need no special case
export async function* webmAudio(src) {
  const size = src.size, first = await src.get(0, 4);
  if (!(first.length === 4 && first[0] === 0x1a && first[1] === 0x45 && first[2] === 0xdf && first[3] === 0xa3)) throw new Unsupported("not a WebM file");
  const tracks = []; let cur = null, pos = 0, chosen = null, headSent = false, sawAudio = null;
  const choose = () => {
    const audio = tracks.filter((t) => t.type === 2); if (!audio.length) throw new Unsupported("no audio track");
    const t = audio.find((x) => x.codec === "A_OPUS" || x.codec === "A_VORBIS" || x.codec === "A_FLAC" || x.codec.startsWith("A_AAC")); if (!t) throw new Unsupported(`WebM audio codec ${audio[0].codec || "unknown"}`);
    const cp = t.priv; chosen = t.no;
    if (t.codec === "A_VORBIS") { if (!cp || cp.length < 30) throw new Unsupported("WebM Vorbis without its headers"); return { codec: "vorbis", extra: cp }; }
    if (t.codec === "A_FLAC") { if (!cp || cp.length < 42 || ascii(cp, 0, 4) !== "fLaC") throw new Unsupported("WebM FLAC without its headers"); return { codec: "flac", extra: cp.subarray(8, 42) }; }
    if (t.codec.startsWith("A_AAC")) { if (!cp || cp.length < 2) throw new Unsupported("WebM AAC without its config"); return { codec: "aac", extra: aacCore(cp) }; }
    let channels = t.channels || 2, preSkip = 0;
    if (cp && cp.length >= 19 && ascii(cp, 0, 8) === "OpusHead") { channels = cp[9]; preSkip = cp[10] | (cp[11] << 8); }
    if (channels < 1 || channels > 2) throw new Unsupported(`Opus with ${channels} channels`);
    return { codec: "opus", channels, preSkip };
  };
  const vint = (b, p, keep) => {   // → { v, len, unknown } or null
    const f = b[p]; if (f === undefined || f === 0) return null; let len = 1, mask = 0x80; while (!(f & mask)) { len++; mask >>= 1; }
    if (p + len > b.length) return null;
    let v = keep ? f : f & (mask - 1), ones = (f & (mask - 1)) === mask - 1;
    for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 255) ones = false; }
    return { v, len, unknown: !keep && ones };
  };
  const findCluster = async (from) => {
    for (let p = from; p < size; p += 65536) { const b = await src.get(p, 65536 + 3); for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0x1f && b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75) return p + i; }
    return -1;
  };
  while (pos < size) {
    const h = await src.get(pos, 16); if (h.length < 2) break;
    const id = vint(h, 0, true), sz = id && id.len <= 4 ? vint(h, id.len, false) : null;
    if (!id || id.len > 4 || !sz) { pos = await findCluster(pos + 1); if (pos < 0) break; continue; }
    const ds = pos + id.len + sz.len;
    if (EBML_ENTER.has(id.v)) {
      if (id.v === 0xae) { cur = { no: -1, type: 0, codec: "", priv: null, channels: 0 }; tracks.push(cur); }
      else if (id.v === 0x1f43b675 && chosen === null) { const hd = choose(); headSent = true; yield { head: hd }; }
      pos = ds; continue;
    }
    if (sz.unknown) break;   // an unknown-size element we can't enter
    const end = ds + sz.v;
    if (cur && [0xd7, 0x83, 0x86, 0x63a2, 0x9f].includes(id.v) && sz.v <= 4096) {
      const d = await src.get(ds, sz.v); if (d.length < sz.v) break;
      if (id.v === 0x86) cur.codec = ascii(d, 0, d.length).replace(/\0+$/, "");
      else if (id.v === 0x63a2) cur.priv = d.slice();
      else { let n = 0; for (const x of d) n = n * 256 + x; if (id.v === 0xd7) cur.no = n; else if (id.v === 0x83) cur.type = n; else cur.channels = n; }
    } else if (id.v === 0xa3 || id.v === 0xa1) {
      if (chosen === null) { const hd = choose(); headSent = true; yield { head: hd }; }
      if (sz.v > (16 << 20)) { pos = end; continue; }
      const d = await src.get(ds, sz.v); if (d.length < sz.v) break;   // truncated block
      const tn = vint(d, 0, false);
      if (tn && tn.v === chosen && d.length >= tn.len + 3) {
        const flags = d[tn.len + 2], lacing = (flags >> 1) & 3, body = d.subarray(tn.len + 3);
        for (const f of unlace(body, lacing, vint)) if (f.length) yield { packet: f };
      } else if (tn && sawAudio === null) sawAudio = true;
    }
    pos = end;
  }
  if (!headSent) { const hd = choose(); yield { head: hd }; }
}
function* unlace(b, lacing, vint) {
  if (lacing === 0) { yield b; return; }
  if (!b.length) return;
  const n = b[0] + 1; let p = 1; const sizes = [];
  if (lacing === 2) { const each = Math.floor((b.length - 1) / n); for (let i = 0; i < n; i++) sizes.push(each); }
  else if (lacing === 1) { for (let i = 0; i < n - 1; i++) { let s = 0, c; do { c = b[p++]; s += c; } while (c === 255 && p < b.length); sizes.push(s); } }
  else { const f = vint(b, p, false); if (!f) return; p += f.len; let prev = f.v; sizes.push(prev); for (let i = 1; i < n - 1; i++) { const d = vint(b, p, false); if (!d) return; p += d.len; prev += d.v - (2 ** (7 * d.len - 1) - 1); sizes.push(prev); } }
  if (lacing !== 2) { const used = sizes.reduce((a, c) => a + c, 0); sizes.push(b.length - p - used); }
  for (const s of sizes) { if (s < 0 || p + s > b.length) return; yield b.subarray(p, p + s); p += s; }
}

// ---- MP4 / M4A / MOV with AAC or ALAC ----
// A box list over bytes [s, e) of b: { type, hs (header start), body, end }. A box that runs past e is cut at e (a truncated file).
function* boxes(b, s, e) {
  while (s + 8 <= e) {
    let size = u32(b, s), hl = 8; const type = fourcc(b, s + 4);
    if (size === 1) { if (s + 16 > e) return; size = u32(b, s + 8) * 4294967296 + u32(b, s + 12); hl = 16; } else if (size === 0) size = e - s;
    if (size < hl) return;
    const end = Math.min(e, s + size); yield { type, hs: s, body: s + hl, end }; s += size;
  }
}
function descriptors(b, s, e, out) {   // MPEG-4 descriptors inside esds: ES (3) → DecoderConfig (4) → DecoderSpecificInfo (5)
  while (s + 2 <= e) {
    const tag = b[s++]; let len = 0, c, k = 0; do { c = b[s++]; len = (len << 7) | (c & 127); k++; } while ((c & 128) && k < 4 && s < e);
    const end = Math.min(e, s + len);
    if (tag === 3) { let p = s + 2; const fl = b[p++]; if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + b[p]; if (fl & 0x20) p += 2; descriptors(b, p, end, out); }
    else if (tag === 4) { out.oti = b[s]; descriptors(b, s + 13, end, out); }
    else if (tag === 5) out.asc = b.slice(s, end);
    s = end;
  }
}
function parseMoov(b) {   // b is the moov box's bytes (header included)
  const tracks = [], trex = new Map(); let fragmented = false;
  const moov = [...boxes(b, 0, b.length)].find((x) => x.type === "moov"); if (!moov) throw new Corrupt("no moov box");
  for (const bx of boxes(b, moov.body, moov.end)) {
    if (bx.type === "mvex") { fragmented = true; for (const t of boxes(b, bx.body, bx.end)) if (t.type === "trex" && t.end - t.body >= 24) trex.set(u32(b, t.body + 4), { size: u32(b, t.body + 16) }); }
    if (bx.type !== "trak") continue;
    const t = { id: 0, handler: "", entry: null, esds: null, alac: null, timescale: 0, startMedia: undefined, sizes: null, fixedSize: 0, count: 0, stsc: [], offsets: null };
    const walk = (s, e, parent) => {
      for (const c of boxes(b, s, e)) {
        if (c.type === "tkhd") t.id = u32(b, c.body + (b[c.body] === 1 ? 20 : 12));
        else if (c.type === "hdlr" && parent === "mdia") t.handler = fourcc(b, c.body + 8);   // the media handler, not minf's data handler
        else if (c.type === "stsd") {
          if (c.end - c.body < 16) continue;
          const eb = [...boxes(b, c.body + 8, c.end)][0]; if (!eb) continue;
          t.entry = eb.type;
          if (eb.type === "alac") {
            const ver = u16(b, eb.body + 8), head = ver === 1 ? 52 : ver === 2 ? u32(b, eb.body + 28) : 36, a = [...boxes(b, eb.hs + head, eb.end)].find((x) => x.type === "alac");
            if (a) t.alac = b.slice(a.hs, a.end);   // the box with its 12 byte header: the decoder skips it
          }
          if (eb.type === "mp4a") {
            const ver = u16(b, eb.body + 8); const head = ver === 1 ? 52 : ver === 2 ? u32(b, eb.body + 28) : 36;
            const find = (s2, e2) => { for (const x of boxes(b, s2, e2)) { if (x.type === "esds") return x; if (x.type === "wave") { const r = find(x.body, x.end); if (r) return r; } } return null; };
            let es = find(eb.hs + head, eb.end);
            if (!es) for (let i = eb.body; i + 8 < eb.end; i++) if (fourcc(b, i) === "esds") { es = { body: i + 4, end: Math.min(eb.end, i - 4 + u32(b, i - 4)) }; break; }
            if (es) { const out = {}; descriptors(b, es.body + 4, es.end, out); t.esds = out; }
          }
        }
        else if (c.type === "stsz") { t.fixedSize = u32(b, c.body + 4); t.count = u32(b, c.body + 8); if (!t.fixedSize) { const n = Math.min(t.count, Math.floor((c.end - c.body - 12) / 4)); t.sizes = new Uint32Array(n); for (let i = 0; i < n; i++) t.sizes[i] = u32(b, c.body + 12 + i * 4); t.count = n; } }
        else if (c.type === "stsc") { const n = Math.min(u32(b, c.body + 4), Math.floor((c.end - c.body - 8) / 12)); for (let i = 0; i < n; i++) t.stsc.push([u32(b, c.body + 8 + i * 12), u32(b, c.body + 12 + i * 12)]); }
        else if (c.type === "stco" || c.type === "co64") { const w = c.type === "stco" ? 4 : 8, n = Math.min(u32(b, c.body + 4), Math.floor((c.end - c.body - 8) / w)); t.offsets = new Float64Array(n); for (let i = 0; i < n; i++) t.offsets[i] = w === 4 ? u32(b, c.body + 8 + i * 4) : u32(b, c.body + 8 + i * 8) * 4294967296 + u32(b, c.body + 12 + i * 8); }
        else if (c.type === "mdhd") t.timescale = u32(b, c.body + (b[c.body] === 1 ? 20 : 12));
        else if (c.type === "elst" && t.startMedia === undefined) {   // the first edit that plays media: its start is the encoder delay (priming) that is not played
          const v = b[c.body], n = u32(b, c.body + 4), w = v === 1 ? 20 : 12;
          for (let i = 0; i < Math.min(n, 8) && c.body + 8 + (i + 1) * w <= c.end; i++) { const q = c.body + 8 + i * w, mt = v === 1 ? u32(b, q + 8) * 4294967296 + u32(b, q + 12) : u32(b, q + 4); if (mt < 0xfffffff0 && !(v === 1 && u32(b, q + 8) === 0xffffffff)) { t.startMedia = mt; break; } }
        }
        else if (["mdia", "minf", "stbl", "edts"].includes(c.type)) walk(c.body, c.end, c.type);
      }
    };
    walk(bx.body, bx.end, "trak"); tracks.push(t);
  }
  return { tracks, trex, fragmented };
}
// The first audio track we can decode: AAC in an "mp4a" entry or ALAC. Another audio codec in the file is Unsupported.
function pickAudio(tracks) {
  const audio = tracks.filter((t) => t.handler === "soun"); if (!audio.length) throw new Unsupported("no audio track");
  for (const t of audio) {
    if (t.entry === "alac" && t.alac) return { t, codec: "alac", extra: t.alac, skipSec: t.startMedia !== undefined && t.timescale ? t.startMedia / t.timescale : null };
    if (t.entry !== "mp4a" || !t.esds?.asc?.length) continue;
    const oti = t.esds.oti; if (oti !== undefined && !(oti === 0x40 || (oti >= 0x66 && oti <= 0x68))) continue;
    return { t, codec: "aac", extra: aacCore(t.esds.asc), skipSec: t.startMedia !== undefined && t.timescale ? t.startMedia / t.timescale : null };
  }
  throw new Unsupported(`MP4 audio codec ${audio[0].entry || "unknown"}`);
}
// The AudioSpecificConfig for the AAC-LC core. HE-AAC (SBR, with or without PS) announces an extension that the decoder doesn't implement; its
// core is plain AAC-LC at half the rate, which carries the speech, so the config is rewritten as that core and the decoder reports the core's rate.
export function aacCore(asc) {
  let pos = 0; const bits = (n) => { let v = 0; for (let i = 0; i < n; i++) { const by = asc[pos >> 3]; if (by === undefined) throw new Unsupported("short AAC config"); v = v * 2 + ((by >> (7 - (pos & 7))) & 1); pos++; } return v; };
  const objType = () => { let t = bits(5); if (t === 31) t = 32 + bits(6); return t; };
  const freq = () => { const i = bits(4); return { i, hz: i === 15 ? bits(24) : 0 }; };
  let t = objType(); if (t !== 2 && t !== 5 && t !== 29) return asc;   // another profile: the decoder refuses it by name
  const f = freq(), ch = bits(4); if (t !== 2) { freq(); t = objType(); if (t !== 2) return asc; }
  const frameLong = bits(1);   // 1 = 960 sample frames (refused by the decoder)
  let n = 0; const out = new Uint8Array(8); const put = (v, k) => { for (let i = k - 1; i >= 0; i--) { out[n >> 3] |= ((v >> i) & 1) << (7 - (n & 7)); n++; } };
  put(2, 5); put(f.i, 4); if (f.i === 15) put(f.hz, 24); put(ch, 4); put(frameLong, 1); put(0, 2);
  return out.slice(0, (n + 7) >> 3);
}
function* tableSamples(t) {   // the samples a plain (not fragmented) track lists: { off, size }, in file order
  if (!t.offsets || !t.count) return;
  let si = 0, run = 0; const runs = t.stsc.length ? t.stsc : [[1, 1]];
  for (let c = 0; c < t.offsets.length && si < t.count; c++) {
    while (run + 1 < runs.length && runs[run + 1][0] <= c + 1) run++;
    let off = t.offsets[c];
    for (let k = 0; k < runs[run][1] && si < t.count; k++, si++) { const size = t.fixedSize || t.sizes[si]; yield { off, size }; off += size; }
  }
}
function* fragSamples(b, moofStart, trackId, trex) {   // the samples of one moof for one track (ISO 14496-12 tfhd, trun)
  const moof = [...boxes(b, 0, b.length)].find((x) => x.type === "moof"); if (!moof) return;
  let next = null;
  for (const traf of boxes(b, moof.body, moof.end)) {
    if (traf.type !== "traf") continue;
    let tfhd = null, runs = [];
    for (const c of boxes(b, traf.body, traf.end)) {
      if (c.type === "tfhd") {
        const fl = (b[c.body + 1] << 16) | (b[c.body + 2] << 8) | b[c.body + 3]; let p = c.body + 8;
        tfhd = { id: u32(b, c.body + 4), base: null, size: null, fl };
        if (fl & 1) { tfhd.base = u32(b, p) * 4294967296 + u32(b, p + 4); p += 8; }
        if (fl & 2) p += 4; if (fl & 8) p += 4; if (fl & 0x10) tfhd.size = u32(b, p);
      } else if (c.type === "trun") runs.push(c);
    }
    if (!tfhd || tfhd.id !== trackId) { continue; }
    let base = tfhd.base ?? moofStart, cursor = next ?? base;
    const dsize = tfhd.size ?? trex.get(trackId)?.size ?? 0;
    for (const r of runs) {
      const fl = (b[r.body + 1] << 16) | (b[r.body + 2] << 8) | b[r.body + 3], n = u32(b, r.body + 4); let p = r.body + 8, off = cursor;
      if (fl & 1) { off = base + (u32(b, p) | 0); p += 4; }
      if (fl & 4) p += 4;
      const stride = ((fl & 0x100) ? 4 : 0) + ((fl & 0x200) ? 4 : 0) + ((fl & 0x400) ? 4 : 0) + ((fl & 0x800) ? 4 : 0);
      for (let i = 0; i < n && p + stride <= r.end; i++) {
        let q = p; if (fl & 0x100) q += 4; const size = (fl & 0x200) ? u32(b, q) : dsize; p += stride;
        yield { off, size }; off += size;
      }
      cursor = off;
    }
    next = cursor;
  }
}

// → { codec: "aac" | "alac", extra, skipSec (the edit list's start: seconds of encoder delay to drop), packets: async iterable of Uint8Array }. Reads the moov (at the start or the end of the file) and then the samples
// by range, so a video file's interleaved picture data is skipped unread when the next audio chunk is far off.
export async function openMp4(src) {
  const size = src.size; const head = await src.get(0, 12);
  if (head.length < 12 || !(fourcc(head, 4) === "ftyp" || fourcc(head, 4) === "moov" || fourcc(head, 4) === "mdat" || fourcc(head, 4) === "free" || fourcc(head, 4) === "wide" || fourcc(head, 4) === "styp")) throw new Unsupported("not an MP4 file");
  let pos = 0, moov = null, scanFrom = 0;
  for (let n = 0; pos + 8 <= size && n < 200000; n++) {
    const h = await src.get(pos, 16, { peek: true }); if (h.length < 8) break;
    let bs = u32(h, 0), hl = 8; const type = fourcc(h, 4);
    if (bs === 1) { if (h.length < 16) break; bs = u32(h, 8) * 4294967296 + u32(h, 12); hl = 16; } else if (bs === 0) bs = size - pos;
    if (bs < hl) break;
    if (type === "moov") {
      if (bs > (256 << 20)) throw new Unsupported("the MP4 index is too big");
      const b = await src.get(pos, Math.min(bs, size - pos), { peek: true }); if (b.length < Math.min(bs, size - pos)) throw new Corrupt("truncated moov");
      moov = parseMoov(b.slice()); scanFrom = pos + bs; break;
    }
    pos += bs;
  }
  if (!moov) throw new Unsupported("no moov box in the file (an unfinished recording)");
  const { t: track, codec, extra, skipSec } = pickAudio(moov.tracks), self = src;
  const sample = async (off, len) => { const d = await self.get(off, len); return d.length === len ? d : null; };
  async function* packets() {
    for (const s of tableSamples(track)) { if (!s.size) continue; const d = await sample(s.off, s.size); if (!d) return; yield d; }
    if (!moov.fragmented) return;
    // The fragments after the moov, read in windows like the samples they point at (a fragmented file has one moof per second or two).
    for (let p = scanFrom, n = 0; p + 8 <= size && n < 1000000; n++) {
      const h = await self.get(p, 16); if (h.length < 8) return;
      let bs = u32(h, 0), hl = 8; const type = fourcc(h, 4);
      if (bs === 1) { if (h.length < 16) return; bs = u32(h, 8) * 4294967296 + u32(h, 12); hl = 16; } else if (bs === 0) bs = size - p;
      if (bs < hl) return;
      if (type === "moof") {
        if (bs > (64 << 20)) return;
        const mb = await self.get(p, bs); if (mb.length < bs) return;
        for (const s of fragSamples(mb, p, track.id, moov.trex)) { if (!s.size) continue; const d = await sample(s.off, s.size); if (!d) return; yield d; }
      }
      p += bs;
    }
  }
  return { codec, extra, skipSec, packets: packets() };
}

// ---- native FLAC ----
// → { extra: the 34 byte STREAMINFO, start: where the first frame is }. The frames are cut out of the byte stream by the decoder module.
export async function openFlac(src) {
  const h = await src.get(0, 4); if (!(h.length === 4 && ascii(h, 0, 4) === "fLaC")) throw new Unsupported("not a FLAC file");
  let pos = 4, info = null;
  for (let n = 0; n < 1000; n++) {
    const b = await src.get(pos, 4); if (b.length < 4) throw new Corrupt("FLAC metadata cut off");
    const last = b[0] & 0x80, type = b[0] & 0x7f, len = (b[1] << 16) | (b[2] << 8) | b[3];
    if (type === 0) { if (len !== 34) throw new Corrupt("FLAC STREAMINFO of the wrong size"); const d = await src.get(pos + 4, 34); if (d.length < 34) throw new Corrupt("FLAC metadata cut off"); info = d.slice(); }
    pos += 4 + len; if (last) break;
  }
  if (!info) throw new Corrupt("FLAC without STREAMINFO");
  return { extra: info, start: pos };
}
