// CAF v1, Apple Core Audio Format specification, Audio Description/Data/Packet Table sections.
// Reads metadata and packets by range. Native voice notes use Opus; ALAC and packed PCM use the same existing conversion path.
import { Source, Unsupported, Corrupt } from "./audio-demux.js";

const tag = (b, at = 0) => String.fromCharCode(...b.subarray(at, at + 4));
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const exact = async (src, at, n) => { const b = await src.get(at, n); if (b.length !== n) throw new Corrupt("truncated CAF chunk"); return b; };
const safe64 = (v, label) => { if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Corrupt(`invalid CAF ${label}`); return Number(v); };

export async function openCaf(src) {
  const h = await exact(src, 0, 8);
  if (tag(h) !== "caff" || view(h).getUint16(4) !== 1) throw new Unsupported("not CAF version 1");
  let desc = null, data = null, table = null, cookie = null, chunks = 0;
  for (let at = 8; at < src.size;) {
    if (++chunks > 1024) throw new Unsupported("too many CAF chunks");
    const ch = await exact(src, at, 12), type = tag(ch), rawSize = view(ch).getBigInt64(4), start = at + 12;
    const len = rawSize === -1n && type === "data" ? src.size - start : safe64(rawSize, "chunk size");
    if (len > src.size - start) throw new Corrupt("CAF chunk extends past the file");
    if (at === 8 && (type !== "desc" || len !== 32)) throw new Corrupt("CAF must start with its audio description");
    if (type === "desc") {
      if (desc || len !== 32) throw new Corrupt("invalid CAF audio description");
      const b = await exact(src, start, 32), v = view(b);
      desc = { rate: v.getFloat64(0), codec: tag(b, 8), flags: v.getUint32(12), bytes: v.getUint32(16), frames: v.getUint32(20), channels: v.getUint32(24), bits: v.getUint32(28) };
    } else if (type === "data") {
      if (data || len < 4) throw new Corrupt("invalid CAF audio data");
      data = { start: start + 4, len: len - 4 }; // the edit count is metadata, never a codec packet
    } else if (type === "pakt") {
      if (table || len < 24) throw new Corrupt("invalid CAF packet table");
      const b = await exact(src, start, 24), v = view(b);
      table = { start: start + 24, end: start + len, count: safe64(v.getBigInt64(0), "packet count"), valid: safe64(v.getBigInt64(8), "frame count"), priming: v.getInt32(16), remainder: v.getInt32(20) };
      if (table.count > 2000000 || table.priming < 0 || table.remainder < 0) throw new Unsupported("CAF packet table exceeds conversion limits");
    } else if (type === "kuki") {
      if (cookie || len > 65536) throw new Unsupported("invalid CAF codec configuration");
      cookie = (await exact(src, start, len)).slice();
    }
    at = start + len;
  }
  if (!desc || !data || !data.len) throw new Corrupt("CAF has no audio data");
  const d = desc;
  if (!Number.isInteger(d.rate) || d.rate < 4000 || d.rate > 192000 || d.channels < 1 || d.channels > 2) throw new Unsupported("CAF sample rate or channel count");
  if (table && (table.priming > d.rate * 10 || table.remainder > d.rate * 10)) throw new Unsupported("CAF audio trim exceeds conversion limits");
  if (d.codec === "lpcm") {
    const width = d.bytes / d.channels, floating = !!(d.flags & 1);
    if (d.frames !== 1 || (d.flags & ~3) || !Number.isInteger(width) || d.bits !== width * 8 || !(floating ? [4, 8].includes(width) : [1, 2, 3, 4].includes(width))) throw new Unsupported("CAF PCM sample layout");
    if (data.len % d.bytes) throw new Corrupt("incomplete CAF PCM frame");
    const frames = data.len / d.bytes;
    if (table && (table.priming + table.valid + table.remainder !== frames)) throw new Corrupt("CAF PCM frame count mismatch");
    return { ...d, width, floating, data, table };
  }
  if (d.codec !== "opus" && d.codec !== "alac") throw new Unsupported(`CAF codec ${d.codec || "unknown"} is not supported for voice transcription`);
  if (d.bits || d.bytes > (1 << 20) || d.frames > d.rate) throw new Unsupported("CAF compressed packet layout");
  if ((!d.bytes || !d.frames) && !table) throw new Corrupt("variable CAF packets require a packet table");
  let extra;
  if (d.codec === "alac") {
    if (cookie?.length === 24) { extra = new Uint8Array(36); view(extra).setUint32(0, 36); extra.set([97, 108, 97, 99], 4); extra.set(cookie, 12); }
    else if (cookie && cookie.length >= 48 && tag(cookie, 4) === "frma" && tag(cookie, 8) === "alac" && tag(cookie, 16) === "alac") extra = cookie.slice(12, 48);
    else throw new Unsupported("CAF ALAC configuration");
  }
  const count = table?.count || (d.bytes ? data.len / d.bytes : 0);
  if (!Number.isInteger(count) || count < 1 || count > 2000000) throw new Corrupt("CAF packet count");
  // Separate windows keep interleaved packet-table/audio reads bounded without reloading the table for each packet.
  const index = new Source(src.read, src.size, { window: 65536 });
  async function* packets() {
    let at = table?.start || 0, off = data.start, frames = 0;
    const integer = async () => {
      let n = 0;
      for (let k = 0; k < 5 && at < table.end; k++) { const b = (await exact(index, at++, 1))[0]; n = n * 128 + (b & 127); if (!(b & 128)) return n; }
      throw new Corrupt("invalid CAF packet table integer");
    };
    for (let i = 0; i < count; i++) {
      const bytes = d.bytes || await integer(), samples = d.frames || await integer();
      if (!bytes || bytes > (d.codec === "opus" ? 7680 : 1 << 20) || !samples || samples > d.rate) throw new Unsupported("CAF packet exceeds decoder limits");
      if (off + bytes > data.start + data.len) throw new Corrupt("CAF packet extends past audio data");
      yield await exact(src, off, bytes); off += bytes; frames += samples;
    }
    if (off !== data.start + data.len || (table && frames !== table.priming + table.valid + table.remainder)) throw new Corrupt("CAF packet table does not match the audio data");
  }
  return { ...d, extra, table, packets: packets() };
}

export async function* cafPcmFrames(src, caf) {
  const { data, table, bytes, width, channels, floating, flags, rate } = caf;
  const little = !!(flags & 2), skip = table?.priming || 0, endFrame = skip + (table?.valid ?? data.len / bytes);
  const step = Math.max(1, Math.floor(65536 / bytes));
  for (let frame = skip; frame < endFrame; frame += step) {
    const n = Math.min(step, endFrame - frame), b = await exact(src, data.start + frame * bytes, n * bytes), v = view(b);
    const ch = Array.from({ length: channels }, () => new Float32Array(n));
    for (let f = 0; f < n; f++) for (let c = 0; c < channels; c++) {
      const at = (f * channels + c) * width;
      let x;
      if (floating) x = width === 4 ? v.getFloat32(at, little) : v.getFloat64(at, little);
      else if (width === 1) x = v.getInt8(at) / 128;
      else if (width === 2) x = v.getInt16(at, little) / 32768;
      else if (width === 4) x = v.getInt32(at, little) / 2147483648;
      else { const u = little ? b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) : b[at + 2] | (b[at + 1] << 8) | (b[at] << 16); x = (u << 8 >> 8) / 8388608; }
      if (!Number.isFinite(x)) throw new Corrupt("CAF PCM contains nonfinite samples");
      ch[c][f] = x;
    }
    yield { channels: ch, rate };
  }
}
