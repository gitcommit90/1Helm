// node --import ./test/stubs/register.mjs test/audio-convert.test.mjs
// The in-Worker audio converter (src/audio-convert.js, src/audio-demux.js, decoders in src/vendor/audio): every format and the edge cases
// the demuxers must survive (fragmented mp4, HE-AAC rate, variable bit rate, odd sample rates, mono and stereo, truncated and damaged
// files, chained and unknown-size streams), what it must refuse (so the file goes to Qwen3), the piece size, and a bounded memory use on a
// long file. Fixtures (test/fixtures/audio) are 4 s of the synthetic speech of the live notes fixture, encoded with ffmpeg
// (ffmpeg encodes them from one 4 s speech clip); ref16k.wav is the same 4 s as 16 kHz mono PCM.
import assert from "node:assert"; import { readFileSync } from "node:fs";
import { convertAudio, sniff, resampler, wavHeader, PIECE_BYTES, RATE, READ_WINDOW, Unsupported, Corrupt } from "../src/audio-convert.js";
import { splitWav } from "../src/sidecar.js";

const FX = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/audio/${n}`, import.meta.url)));
async function scenario(name, fn) { await fn(); console.log("  ok", name); }
const reader = (b, log = []) => async (o, l) => { log.push([o, l]); return b.slice(o, o + l); };
// → { kind, pcm: Int16Array (all pieces), pieces: [{ n, sec }], stats }
async function convert(bytes, opts = {}) {
  const log = [], c = await convertAudio(reader(bytes, log), bytes.length, opts), parts = [], pieces = [];
  for await (const p of c.pieces) { assert.equal(String.fromCharCode(...p.data.subarray(0, 4)), "RIFF"); parts.push(p.data.subarray(44)); pieces.push({ n: p.data.length, sec: p.sec, data: p.data }); }
  const n = parts.reduce((a, p) => a + p.length, 0), all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return { kind: c.kind, pcm: new Int16Array(all.buffer, 0, n >> 1), pieces, stats: c.stats(), log };
}
const reject = async (bytes, what) => { try { await convertAudio(reader(bytes), bytes.length); } catch (e) { assert.ok(e instanceof Unsupported || e instanceof Corrupt, `${what}: ${e}`); return e; } assert.fail(`${what}: should have been rejected`); };
const sec = (r) => r.pcm.length / RATE;
// The speech's loudness over time (RMS in 100 ms frames), compared with the reference's: the same words at the same times.
const REF = (() => { const b = FX("ref16k.wav"); return new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) >> 1); })();
const env100 = (p) => { const n = Math.floor(p.length / 1600), o = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 1600; k++) s += p[i * 1600 + k] ** 2; o[i] = Math.sqrt(s / 1600); } return o; };
const corr = (a, b) => { const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, x = 0, y = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); x += (a[i] - ma) ** 2; y += (b[i] - mb) ** 2; } return s / Math.sqrt(x * y); };
const REF_ENV = env100(REF);
const sameSpeech = (r, name, min = 0.97) => { const c = corr(env100(r.pcm), REF_ENV); if (process.env.CORR) console.log("   corr", name, c.toFixed(3)); if (!process.env.CORR) assert.ok(c >= min, `${name}: loudness over time matches the source (${c.toFixed(3)})`); };
const peak = (p) => { let m = 0; for (const x of p) m = Math.max(m, Math.abs(x)); return m; };

await scenario("sniff names the container from its first bytes, not the file name", () => {
  assert.deepEqual(["m.ogg", "m.webm", "m.m4a", "m.mov", "video.mp4", "frag.mp4", "m22.mp3", "st44.mp3", "a.flac"].map((n) => sniff(FX(n).subarray(0, 16))), ["ogg", "webm", "mp4", "mp4", "mp4", "mp4", "mp3", "mp3", "flac"]);
  assert.equal(sniff(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])), "wav"); assert.equal(sniff(new Uint8Array(3)), null); assert.equal(sniff(new Uint8Array(16).fill(7)), null);
  assert.equal(sniff(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0])), null, "ADTS AAC (layer bits 00) is not an mp3 frame");
});

await scenario("every format converts to 16 kHz mono 16-bit PCM of the same length, with the same speech in it", async () => {
  const want = { "m.ogg": "ogg", "s.ogg": "ogg", "f60.ogg": "ogg", "m.webm": "webm", "s.webm": "webm", "live.webm": "webm", "st44.mp3": "mp3", "m22.mp3": "mp3", "m8.mp3": "mp3", "m16.mp3": "mp3", "m48-vbr.mp3": "mp3",
    "v.ogg": "ogg", "v.webm": "webm", "a.flac": "flac", "alac.m4a": "mp4", "m.m4a": "mp4", "m-fast.m4a": "mp4", "s.m4a": "mp4", "m22.m4a": "mp4", "m8.m4a": "mp4", "m24.m4a": "mp4", "m.mov": "mp4", "video.mp4": "mp4", "frag.mp4": "mp4", "frag2.mp4": "mp4" };
  for (const [name, kind] of Object.entries(want)) {
    const r = await convert(FX(name)); assert.equal(r.kind, kind, name);
    assert.ok(Math.abs(sec(r) - (name === "a.flac" || name === "alac.m4a" ? 1.5 : 4)) < 0.15, `${name}: ${sec(r)} s`);   // those two fixtures are 1.5 s assert.ok(peak(r.pcm) > 3000 && peak(r.pcm) < 32768, `${name}: speech level`);
    sameSpeech(r, name, name === "m8.mp3" || name === "m8.m4a" || name === "a.flac" || name === "alac.m4a" ? 0.9 : 0.97);   // 8 kHz sources lose the top of the band; the 1.5 s fixtures are compared with the start of the 4 s reference
    assert.equal(r.pieces.length, 1, name); assert.equal(r.pieces[0].n, 44 + r.pcm.length * 2, name);
  }
});

await scenario("the WAV piece header and size are the ones splitWav makes: 44 bytes, 16 kHz mono 16-bit, at most 16 MB", async () => {
  const r = await convert(FX("m.m4a")), mine = r.pieces[0].data;
  const theirs = splitWav(mine, PIECE_BYTES); assert.equal(theirs.length, 1); assert.deepEqual(theirs[0].data, mine, "splitWav accepts it as plain PCM WAV and rewrites the same bytes");
  assert.equal(PIECE_BYTES, 16 * 1024 * 1024); const h = new Uint8Array(44); wavHeader(h, 1000); assert.deepEqual(h, splitWav((() => { const w = new Uint8Array(1044); w.set(h); return w; })(), 1 << 20)[0].data.subarray(0, 44));
  const small = await convert(FX("st44.mp3"), { pieceBytes: 44 + 2 * 16000 * 1.5 });   // 1.5 s pieces
  assert.equal(small.pieces.length, 3, "4 s in 1.5 s pieces"); assert.ok(small.pieces.slice(0, 2).every((p) => p.n === 44 + 48000 && Math.abs(p.sec - 1.5) < 1e-9)); assert.ok(small.pieces[2].sec < 1.5);
  const whole = await convert(FX("st44.mp3")); assert.deepEqual(small.pcm.subarray(0, whole.pcm.length), whole.pcm, "cutting into pieces loses and repeats nothing"); assert.ok(small.pcm.subarray(whole.pcm.length).every((x) => x === 0), "only silence is added (to a short last piece)");
});

await scenario("a last piece under one second is padded with silence to one second (the model's minimum); its length in seconds stays the audio's", async () => {
  const whole = await convert(FX("st44.mp3")), n = whole.pcm.length;
  const tiny = await convert(FX("st44.mp3"), { pieceBytes: 44 + 2 * (n - 400) });   // a piece of everything but 400 samples, then those 400
  assert.equal(tiny.pieces.length, 2); assert.equal(tiny.pieces[1].n, 44 + 2 * 16000, "padded to 1 s"); assert.ok(Math.abs(tiny.pieces[1].sec - 400 / 16000) < 1e-9);
  const pad = new Int16Array(tiny.pieces[1].data.buffer, tiny.pieces[1].data.byteOffset + 44, 16000); assert.deepEqual(pad.subarray(0, 400), whole.pcm.subarray(n - 400)); assert.ok(pad.subarray(400).every((x) => x === 0));
  const ok = await convert(FX("st44.mp3"), { pieceBytes: 44 + 2 * (n - 20000) }); assert.equal(ok.pieces[1].n, 44 + 2 * 20000, "a last piece of 1.25 s is not padded");
});

await scenario("fragmented mp4 (moof boxes), mp4 with video (interleaved), a moov at the end and a QuickTime mov", async () => {
  for (const n of ["frag.mp4", "frag2.mp4"]) { const r = await convert(FX(n)); assert.ok(sec(r) > 3.9, n); sameSpeech(r, n); }
  const v = await convert(FX("video.mp4")); sameSpeech(v, "video.mp4");
  // a moov at the end is read after a hop over the mdat, and the samples by window: a few reads, none longer than a window (but the moov)
  const m = await convert(FX("m.m4a")); assert.ok(m.log.length <= 4, `${m.log.length} range reads`); assert.ok(m.log.every(([, l]) => l <= READ_WINDOW), "no read is longer than a window");
  assert.equal(m.log[0][0], 0, "starts at the head");
});

await scenario("HE-AAC: a file that announces SBR (48 kHz output from 24 kHz core frames) converts from its AAC-LC core, at the right length", async () => {
  // m24.m4a's AudioSpecificConfig is AAC-LC 24 kHz mono with the backward compatible SBR extension switched off (13 08 56 e5 00). Switching
  // it on with a 48 kHz extension rate (the last byte 98) is how HE-AAC announces itself. Symphonia has no SBR, so the config is rewritten to
  // the core and the decoder outputs 24 kHz (the speech band is all in the core).
  const b = FX("m24.m4a").slice(), at = (() => { for (let i = 0; i + 4 < b.length; i++) if (b[i] === 0x13 && b[i + 1] === 0x08 && b[i + 2] === 0x56 && b[i + 3] === 0xe5 && b[i + 4] === 0x00) return i; return -1; })(); assert.ok(at > 0, "found the config");
  const plain = await convert(b); assert.ok(Math.abs(sec(plain) - 4) < 0.1);
  b[at + 4] = 0x98;
  const r = await convert(b); assert.ok(Math.abs(sec(r) - 4) < 0.2, `${sec(r)} s (a 48 kHz output is resampled, not played as 16 kHz)`); assert.ok(peak(r.pcm) > 1000, "has sound");
});

await scenario("a resampler follows a sample rate that changes inside the file (joined mp3s at 22.05, 16 and 44.1 kHz)", async () => {
  const j = new Uint8Array(FX("m22.mp3").length + FX("m16.mp3").length + FX("st44.mp3").length); j.set(FX("m22.mp3")); j.set(FX("m16.mp3"), FX("m22.mp3").length); j.set(FX("st44.mp3"), FX("m22.mp3").length + FX("m16.mp3").length);
  const r = await convert(j); assert.ok(sec(r) > 11.9 && sec(r) < 12.6, `${sec(r)} s`);
  const one = new Int16Array(r.pcm.buffer, 0, 64000); sameSpeech({ pcm: one }, "first part", 0.95);
  assert.throws(() => resampler(11111), Unsupported); assert.throws(() => resampler(3000), Unsupported);
  const rs = resampler(44100), x = new Float32Array(44100).map((_, i) => Math.sin(2 * Math.PI * 1000 * i / 44100) * 0.5), y = rs.push(x); assert.ok(Math.abs(y.length - 16000) < 40);
  assert.ok(Math.abs(peak(y.subarray(200, 15000)) - 16384) < 400, "a 1 kHz tone keeps its level"); const hi = resampler(44100).push(new Float32Array(44100).map((_, i) => Math.sin(2 * Math.PI * 12000 * i / 44100) * 0.5)); assert.ok(peak(hi.subarray(200)) < 200, "12 kHz (above the band) is filtered out, not folded back");
  const gain = (hz, inRate = 44100) => { const o = resampler(inRate).push(Float32Array.from({ length: inRate * 2 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / inRate))).subarray(3000, 29000); return peak(o) / 16384; };
  assert.ok(gain(4000) > 0.97 && gain(6500) > 0.97 && gain(7000) > 0.9, "the speech band passes"); assert.ok(gain(8500) < 0.01 && gain(9000) < 0.01, "just above 8 kHz (which would fold into 7 to 7.5 kHz) is gone"); assert.ok(gain(5000, 48000) > 0.97 && gain(9000, 22050) < 0.01 && gain(2000, 8000) > 0.97, "other rates");
  const imp = new Float32Array(44100); imp[22050] = 1; const at = resampler(44100).push(imp); let pk = 0; for (let i = 0; i < at.length; i++) if (at[i] > at[pk]) pk = i; assert.ok(Math.abs(pk - 22050 * 16000 / 44100) <= 1, `no delay: an impulse at 0.5 s comes out at sample ${pk}, expected ${22050 * 16000 / 44100}`);
});

await scenario("chained Ogg (two Opus streams, mono then stereo), unknown-size WebM, a big ID3 tag, damaged Ogg pages", async () => {
  const chain = new Uint8Array(FX("m.ogg").length + FX("s.ogg").length); chain.set(FX("m.ogg")); chain.set(FX("s.ogg"), FX("m.ogg").length);
  const c = await convert(chain); assert.ok(Math.abs(sec(c) - 8) < 0.2, `${sec(c)} s`); sameSpeech({ pcm: c.pcm.subarray(0, 64000) }, "chain, first stream", 0.93); sameSpeech({ pcm: c.pcm.subarray(64000, 128000) }, "chain, second stream", 0.93);
  const live = await convert(FX("live.webm")); assert.ok(Math.abs(sec(live) - 4) < 0.1);
  const tag = new Uint8Array(100000 + 10); tag.set([0x49, 0x44, 0x33, 3, 0], 0); const n = 100000; tag.set([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127], 6);
  const withTag = new Uint8Array(tag.length + FX("m22.mp3").length); withTag.set(tag); withTag.set(FX("m22.mp3"), tag.length);
  const t = await convert(withTag); assert.ok(Math.abs(sec(t) - 4) < 0.1, `${sec(t)} s with a 100 KB tag`); sameSpeech(t, "tagged mp3");
  const bad = FX("m.ogg").slice(); for (let i = 3000; i < 3400; i++) bad[i] = 0x55;   // a few pages of garbage: lost, not fatal
  const d = await convert(bad); assert.ok(sec(d) > 2.5 && sec(d) < 4.1, `${sec(d)} s from a damaged Ogg`);
});

await scenario("truncated files: audio up to the cut, or a clean refusal when there's no index; never a crash", async () => {
  const cut = (n, f) => FX(n).subarray(0, Math.floor(FX(n).length * f));
  for (const n of ["st44.mp3", "m22.mp3", "m.ogg", "s.ogg", "m.webm", "live.webm", "m-fast.m4a", "frag.mp4", "frag2.mp4"]) {
    for (const f of [0.3, 0.6, 0.95]) {
      const r = await convert(cut(n, f)); const full = 4;
      assert.ok(sec(r) > 0 && sec(r) <= full + 0.1, `${n} cut at ${f}: ${sec(r)} s`); if (f === 0.6 && !/frag\.mp4/.test(n)) assert.ok(sec(r) > full * 0.35, `${n} at 0.6: ${sec(r)} s`);
    }
  }
  for (const n of ["m.m4a", "m.mov", "video.mp4", "m22.m4a"]) { const e = await reject(cut(n, 0.6), `${n}: the moov is at the end and is cut off`); assert.match(e.message, /moov/); }
  const e = await reject(FX("m-fast.m4a").subarray(0, 400), "a moov cut in half"); assert.ok(e instanceof Corrupt || e instanceof Unsupported);
  for (const n of ["m.ogg", "m.webm", "m22.mp3", "frag.mp4"]) await reject(FX(n).subarray(0, 12), `${n}: only a header`);
});

await scenario("what is refused: junk, empty, WAV, 5.1 AAC, 6-channel Opus, a video with no audio track, a recording without an index", async () => {
  await reject(new Uint8Array(0), "empty"); await reject(new Uint8Array(10), "ten bytes"); await reject(new Uint8Array(5000).map((_, i) => (i * 7) & 255), "junk");
  await reject(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, ...new Uint8Array(100)]), "wav");
  await reject(FX("six.m4a"), "5.1 AAC (the decoder reads one or two channels)"); assert.match((await reject(FX("six.ogg"), "6ch opus")).message, /6 channels/);
  assert.match((await reject(FX("video-only.mp4"), "video only")).message, /no audio track/);
  const junk = new Uint8Array(3000).map((_, i) => (i * 13 + 5) & 255); junk.set([0xff, 0xfb, 0x90, 0x00], 0); await reject(junk, "an mp3-looking start with nothing decodable");
});

await scenario("FLAC, Vorbis and ALAC: truncated and damaged files, a FLAC with a junk body, joined FLAC files", async () => {
  const flac = await convert(FX("a.flac")); assert.equal(flac.kind, "flac"); const ref = FX("a.flac");
  for (const [n, f] of [["a.flac", 0.5], ["a.flac", 0.9], ["v.ogg", 0.5], ["v.webm", 0.5], ["alac.m4a", 0.99]]) { const cut = FX(n).subarray(0, Math.floor(FX(n).length * f)); try { const r = await convert(cut); assert.ok(sec(r) > 0 && sec(r) < 4.1, `${n} cut at ${f}: ${sec(r)} s`); } catch (e) { assert.ok(e instanceof Unsupported || e instanceof Corrupt, `${n} cut at ${f}: ${e}`); } }
  const bad = FX("a.flac").slice(); for (let i = 20000; i < 20300 && i < bad.length; i++) bad[i] = 0x55; const d = await convert(bad); assert.ok(sec(d) > 0.8 && sec(d) < 1.6, `${sec(d)} s from a damaged FLAC (the frames around the damage are lost, the rest decodes)`);
  const junk = new Uint8Array(5000).map((_, i) => (i * 31 + 7) & 255); junk.set([0x66, 0x4c, 0x61, 0x43], 0); await reject(junk, "fLaC and junk");
  const two = new Uint8Array(ref.length * 2); two.set(ref); two.set(ref, ref.length); assert.ok(sec(await convert(two)) > 1.4, "a FLAC file followed by the same file again: no crash, the first file's audio comes out");
  const vo = await convert(FX("v.ogg")); sameSpeech(vo, "vorbis"); assert.deepEqual((await convert(FX("v.webm"))).pcm, vo.pcm, "the same Vorbis stream in webm and in ogg decodes to the same samples");
});

await scenario("a late mid-file failure comes out of the pieces, after the first piece was made (the caller stops with what it has)", async () => {
  const b = FX("st44.mp3"), many = new Uint8Array(b.length * 3); for (let i = 0; i < 3; i++) many.set(b, i * b.length);
  let reads = 0; const read = async (o, l) => { if (++reads > 2) throw new Error("storage went away"); return many.slice(o, o + l); };
  const c = await convertAudio(read, many.length, { pieceBytes: 44 + 2 * 16000 * 5, window: 20000 }); const got = []; await assert.rejects(async () => { for await (const p of c.pieces) got.push(p); }, /storage went away/);
  assert.ok(got.length >= 1, "the first piece was delivered");
  let n = 0; await assert.rejects(convertAudio(async (o, l) => { if (++n > 1) throw new Error("storage went away"); return many.slice(o, o + l); }, many.length, { window: 20000 }), /storage went away/);
});

await scenario("maxSec: stops after that much audio and says there was more", async () => {
  const b = FX("m16.mp3"), many = new Uint8Array(b.length * 30); for (let i = 0; i < 30; i++) many.set(b, i * b.length);   // 2 min
  const r = await convert(many, { maxSec: 50 }); assert.ok(Math.abs(sec(r) - 50) < 0.001, `${sec(r)} s`); assert.equal(r.stats.truncated, true);
  const w = await convert(many, { maxSec: 600 }); assert.equal(w.stats.truncated, false); assert.ok(sec(w) > 120);
  const exact = await convert(FX("m16.mp3"), { maxSec: 4 }); assert.equal(exact.stats.truncated, false, "a file that ends exactly at the limit is not cut");
});

await scenario("memory bound: an hour of mp3 (stereo 44.1 kHz), of Opus (900 chained streams) and, with ffmpeg here, of m4a with video, streams through; reads of a window at most, pieces of at most 16 MB, little added memory", async () => {
  const cat = (name, copies) => { const one = FX(name), big = new Uint8Array(one.length * copies); for (let i = 0; i < copies; i++) big.set(one, i * one.length); return big; };
  const inputs = [["st44.mp3 x900", cat("st44.mp3", 900)], ["m.ogg x900", cat("m.ogg", 900)]];
  try {   // ffmpeg only makes the long m4a (a 1 hour AAC file with a moov at the end and a small video track); without it that case is skipped
    const { spawnSync } = await import("node:child_process"), { mkdtempSync, readFileSync: rf, rmSync } = await import("node:fs"), { tmpdir } = await import("node:os"), d = mkdtempSync(tmpdir() + "/ac-");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "899", "-i", new URL("./fixtures/audio/ref16k.wav", import.meta.url).pathname, "-f", "lavfi", "-i", "testsrc=size=64x48:rate=2", "-t", "3600", "-c:v", "mpeg4", "-b:v", "20k", "-c:a", "aac", "-b:a", "32k", d + "/long.mp4"], { timeout: 120000 });
    if (r.status === 0) inputs.push(["long.mp4 (1 h, video)", new Uint8Array(rf(d + "/long.mp4"))]); rmSync(d, { recursive: true, force: true });
  } catch {}
  const v8 = await import("node:v8"), vm = await import("node:vm"); v8.setFlagsFromString("--expose-gc"); const gc = vm.runInNewContext("gc");   // collect before each reading, so it is live memory and not garbage
  for (const [name, big] of inputs) {
    // The readings are of process memory and move with garbage collection timing on a busy machine, so a run that is over a bound is measured again
    // (at most 3 runs). A real leak is over the bound in every run, so the check still fails for one.
    let miss = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      gc(); const base = process.memoryUsage(); let peakHeap = 0, peakExt = 0; const t0 = Date.now(), log = [], ext = [];
      const c = await convertAudio(reader(big, log), big.length); let pieces = 0, samples = 0;
      for await (const p of c.pieces) { pieces++; samples += (p.data.length - 44) / 2; assert.ok(p.data.length <= PIECE_BYTES); gc(); const m = process.memoryUsage(); peakHeap = Math.max(peakHeap, m.heapUsed); peakExt = Math.max(peakExt, m.external); ext.push(m.external); }   // the piece in hand counts
      assert.ok(samples / RATE > 3600 * 0.99 && samples / RATE < 3600 * 1.06, `${name}: ${samples / RATE} s`); assert.equal(pieces, Math.ceil(samples / ((PIECE_BYTES - 44) / 2)));
      assert.ok(log.every(([, l]) => l <= READ_WINDOW || /long\.mp4/.test(name)), "no read longer than a window (the mp4's index is read whole)"); assert.ok(log.length >= Math.floor(big.length / READ_WINDOW) / (/long/.test(name) ? 4 : 1), "read window by window");
      // what the converter adds over the test's own copy of the file
      const extra = Math.max(0, peakExt - base.external) / 1048576, heap = Math.max(0, peakHeap - base.heapUsed) / 1048576;
      console.log(`    ${name}: ${(samples / RATE / 60).toFixed(1)} min of audio in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${log.length} reads, ${pieces} pieces; added about ${extra.toFixed(0)} MB of buffers and ${heap.toFixed(0)} MB of heap at the peak${attempt > 1 ? ` (run ${attempt})` : ""}`);
      const growth = Math.max(...ext.slice(3)) - Math.max(...ext.slice(0, 3));
      if (extra < 120 && growth < 40e6 && heap < 30) { miss = null; break; }
      miss = { extra, heap, ext, growth };
    }
    if (miss) { const { extra, heap, ext, growth } = miss;
      assert.ok(extra < 120, `${name} buffers: ${extra} MB`); assert.ok(growth < 40e6, `${name}: the later pieces use no more memory than the first ones (no growth with the length) (${ext.map((x) => (x / 1048576).toFixed(0)).join(", ")} MB)`); assert.ok(heap < 30, `${name} heap: ${heap} MB`); }   // one 16 MB piece (and the next while it is made), the decoders (libopus 28 MB, Symphonia), two windows
  }
});

console.log("audio-convert: all passed");
