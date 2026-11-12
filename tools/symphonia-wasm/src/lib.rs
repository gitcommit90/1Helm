// Audio decoders for the in-Worker audio converter (src/audio-convert.js): Symphonia (MPL-2.0) codecs for AAC-LC, MP3, FLAC, Vorbis and
// ALAC behind a small C interface. The JavaScript side does the container work (range reads from R2) and hands over either whole packets
// (AAC, Vorbis, ALAC) or raw bytes of a stream that this file cuts into frames (MP3, FLAC). Output is planar f32 that JavaScript copies out.
use symphonia_core::codecs::audio::{AudioCodecParameters, AudioDecoder, AudioDecoderOptions};
use symphonia_core::codecs::audio::well_known::{CODEC_ID_AAC, CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP3, CODEC_ID_VORBIS};
use symphonia_core::packet::Packet;
use symphonia_core::units::{Duration, Timestamp};

const AAC: u32 = 1;
const MP3: u32 = 2;
const FLAC: u32 = 3;
const VORBIS: u32 = 4;
const ALAC: u32 = 5;
const OUT_CAP: usize = 1 << 16; // frames of output after which a push call returns and asks to be called again

struct Dec {
    kind: u32,
    dec: Box<dyn AudioDecoder>,
    params: AudioCodecParameters,
    pending: Vec<u8>,
    flac: FlacInfo,
    out: Vec<Vec<f32>>,
    rate: u32,
    channels: u32,
    tmp: Vec<Vec<f32>>,
    more: bool,
    skipped: u32,
    seen_audio: bool,
    skip: usize, // output frames still to drop from the start (the encoder delay named by a LAME tag)
}

#[derive(Default, Clone, Copy)]
struct FlacInfo { max_block: u32, channels: u32 }

static mut LAST_ERR: String = String::new();
fn set_err(s: &str) { unsafe { let p = &mut *(&raw mut LAST_ERR); p.clear(); p.push_str(s); } }

fn make(kind: u32, extra: &[u8]) -> Result<(Box<dyn AudioDecoder>, AudioCodecParameters), String> {
    let mut p = AudioCodecParameters::new();
    let o = AudioDecoderOptions::default();
    let e = |x: symphonia_core::errors::Error| x.to_string();
    match kind {
        AAC => { p.for_codec(CODEC_ID_AAC).with_extra_data(extra.to_vec().into_boxed_slice()); Ok((Box::new(symphonia_codec_aac::AacDecoder::try_new(&p, &o).map_err(e)?), p)) }
        MP3 => { p.for_codec(CODEC_ID_MP3); Ok((Box::new(symphonia_bundle_mp3::MpaDecoder::try_new(&p, &o).map_err(e)?), p)) }
        FLAC => { p.for_codec(CODEC_ID_FLAC).with_extra_data(extra.to_vec().into_boxed_slice()); Ok((Box::new(symphonia_bundle_flac::FlacDecoder::try_new(&p, &o).map_err(e)?), p)) }
        VORBIS => { p.for_codec(CODEC_ID_VORBIS).with_extra_data(extra.to_vec().into_boxed_slice()); Ok((Box::new(symphonia_codec_vorbis::VorbisDecoder::try_new(&p, &o).map_err(e)?), p)) }
        ALAC => { p.for_codec(CODEC_ID_ALAC).with_extra_data(extra.to_vec().into_boxed_slice()); Ok((Box::new(symphonia_codec_alac::AlacDecoder::try_new(&p, &o).map_err(e)?), p)) }
        _ => Err("unknown codec".into()),
    }
}

impl Dec {
    fn packet(&mut self, data: &[u8]) {
        let pk = Packet::new(0, Timestamp::ZERO, Duration::ZERO, data.to_vec());
        let Dec { dec, tmp, out, rate, channels, skipped, skip, .. } = self;
        match dec.decode(&pk) {
            Ok(b) => {
                let spec = b.spec(); let (r, c) = (spec.rate(), spec.channels().count());
                if c == 0 || b.frames() == 0 { return; }
                b.copy_to_vecs_planar(tmp);
                if out.first().map_or(true, |o| o.is_empty()) { out.clear(); out.resize(c, Vec::new()); *rate = r; *channels = c as u32; }
                if out.len() == tmp.len() {
                    let cut = (*skip).min(tmp[0].len()); *skip -= cut;
                    for (o, t) in out.iter_mut().zip(tmp.iter()) { o.extend_from_slice(&t[cut..]); }
                }
            }
            Err(_) => *skipped += 1,
        }
    }
}

// ---- MP3 ----
const BR1: [u32; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR2: [u32; 15] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// (frame length, sample rate, channels) of a Layer III frame header at b[0..4], or None.
fn mp3_header(b: &[u8]) -> Option<(usize, u32, u32)> {
    if b.len() < 4 || b[0] != 0xff || (b[1] & 0xe0) != 0xe0 { return None; }
    let v = (b[1] >> 3) & 3; if v == 1 || ((b[1] >> 1) & 3) != 1 { return None; }
    let bi = (b[2] >> 4) as usize; let si = ((b[2] >> 2) & 3) as usize; if bi == 0 || bi == 15 || si == 3 { return None; }
    let sr = match v { 3 => [44100, 48000, 32000][si], 2 => [22050, 24000, 16000][si], _ => [11025, 12000, 8000][si] };
    let br = if v == 3 { BR1[bi] } else { BR2[bi] };
    let len = ((if v == 3 { 144 } else { 72 }) * br * 1000 / sr + ((b[2] >> 1) & 1) as u32) as usize;
    Some((len, sr, if (b[3] >> 6) == 3 { 1 } else { 2 }))
}
// The encoder delay a LAME (or ffmpeg) Xing/Info tag names, plus the decoder's own 529 samples; 0 when there is none.
fn mp3_delay(f: &[u8]) -> usize {
    let v = (f[1] >> 3) & 3; let mono = (f[3] >> 6) == 3; let crc = if f[1] & 1 == 0 { 2 } else { 0 };
    let at = 4 + crc + if v == 3 { if mono { 17 } else { 32 } } else if mono { 9 } else { 17 };
    if f.len() < at + 12 || !(&f[at..at + 4] == b"Xing" || &f[at..at + 4] == b"Info") { return 0; }
    let flags = u32::from_be_bytes([f[at + 4], f[at + 5], f[at + 6], f[at + 7]]); let mut p = at + 8;
    if flags & 1 != 0 { p += 4; } if flags & 2 != 0 { p += 4; } if flags & 4 != 0 { p += 100; } if flags & 8 != 0 { p += 4; }
    if f.len() < p + 24 || !(&f[p..p + 4] == b"LAME" || &f[p..p + 4] == b"Lavf" || &f[p..p + 4] == b"Lavc") { return 0; }
    let d = ((f[p + 21] as usize) << 4) | ((f[p + 22] as usize) >> 4);
    if d > 4000 { 0 } else { d + 529 }
}
fn mp3_is_info(f: &[u8]) -> bool {   // a Xing, Info or VBRI frame holds no audio
    let v = (f[1] >> 3) & 3; let mono = (f[3] >> 6) == 3; let crc = if f[1] & 1 == 0 { 2 } else { 0 };
    let side = if v == 3 { if mono { 17 } else { 32 } } else if mono { 9 } else { 17 };
    let at = 4 + crc + side;
    (f.len() >= at + 4 && (&f[at..at + 4] == b"Xing" || &f[at..at + 4] == b"Info")) || (f.len() >= 40 && &f[36..40] == b"VBRI")
}

// ---- FLAC ----
fn crc8(b: &[u8]) -> u8 { let mut c = 0u8; for &x in b { c ^= x; for _ in 0..8 { c = if c & 0x80 != 0 { (c << 1) ^ 0x07 } else { c << 1 }; } } c }
// The length of a FLAC frame header at b[0..], when it is a plausible one for this stream (CRC-8 right, fields allowed and matching the
// stream's STREAMINFO), else None.
fn flac_header(b: &[u8], fi: &FlacInfo) -> Option<usize> {
    if b.len() < 6 || b[0] != 0xff || (b[1] & 0xfe) != 0xf8 { return None; }
    let bs = b[2] >> 4; let sr = b[2] & 15; let ca = b[3] >> 4; let ss = (b[3] >> 1) & 7;
    if bs == 0 || sr == 15 || ca > 10 || ss == 3 || (b[3] & 1) != 0 { return None; }
    let ch = if ca < 8 { ca as u32 + 1 } else { 2 }; if fi.channels != 0 && ch != fi.channels { return None; }
    let first = b[4]; let extra = if first & 0x80 == 0 { 0 } else if first & 0xe0 == 0xc0 { 1 } else if first & 0xf0 == 0xe0 { 2 } else if first & 0xf8 == 0xf0 { 3 } else if first & 0xfc == 0xf8 { 4 } else if first & 0xfe == 0xfc { 5 } else if first == 0xfe { 6 } else { return None };
    let mut p = 5 + extra; if b.len() < p { return None; }
    let blk = match bs { 1 => 192, 2..=5 => 576 << (bs - 2), 6 => { if b.len() < p + 1 { return None; } p += 1; b[p - 1] as u32 + 1 }, 7 => { if b.len() < p + 2 { return None; } p += 2; ((b[p - 2] as u32) << 8 | b[p - 1] as u32) + 1 }, _ => 256 << (bs - 8) };
    if fi.max_block != 0 && blk > fi.max_block { return None; }
    p += match sr { 12 => 1, 13 | 14 => 2, _ => 0 };
    if b.len() < p + 1 || crc8(&b[..p]) != b[p] { return None; }
    Some(p + 1)
}

fn drain(d: &mut Dec, flush: bool) {
    d.more = false;
    let mut pos = 0usize;
    let buf = std::mem::take(&mut d.pending);
    match d.kind {
        MP3 => {
            let mut i = 0usize;
            while i + 4 <= buf.len() {
                let Some((len, sr, ch)) = mp3_header(&buf[i..]) else { i += 1; continue };
                if i + len > buf.len() { break; }   // the rest of this frame has not arrived (a truncated last frame is dropped)
                if i + len + 4 > buf.len() { if !flush { break; } }
                else if mp3_header(&buf[i + len..]).is_none() { i += 1; continue; }   // the next header must follow where this frame ends
                let have = d.out.first().map_or(0, |o| o.len());
                if have >= OUT_CAP || (have > 0 && (sr != d.rate || ch != d.channels)) { d.more = true; break; }
                if have == 0 && d.rate != 0 && (sr != d.rate || ch != d.channels) { if let Ok((nd, np)) = make(MP3, &[]) { d.dec = nd; d.params = np; } }   // a joined stream at another rate starts a fresh decoder
                if d.rate == 0 || have == 0 { d.rate = sr; d.channels = ch; }
                let frame = &buf[i..i + len];
                if mp3_is_info(frame) { if !d.seen_audio { d.skip = mp3_delay(frame); } } else { d.seen_audio = true; d.packet(frame); }
                i += len;
            }
            pos = if flush && !d.more { buf.len() } else { i.min(buf.len()) };
        }
        FLAC => {
            let fi = d.flac; let mut i = 0usize;
            loop {
                if d.out.first().map_or(0, |o| o.len()) >= OUT_CAP { d.more = true; break; }
                // a frame starts at the first plausible header from i, and ends where the next plausible header starts
                let mut s = i; let mut start = None;
                while s + 16 <= buf.len() || (flush && s + 6 <= buf.len()) { if buf[s] == 0xff && flac_header(&buf[s..], &fi).is_some() { start = Some(s); break; } s += 1; }
                let Some(st) = start else { i = if flush { buf.len() } else { s }; break };
                let hl = flac_header(&buf[st..], &fi).unwrap();
                let mut e = st + hl.max(8); let mut end = None;
                while e + 16 <= buf.len() || (flush && e + 6 <= buf.len()) { if buf[e] == 0xff && flac_header(&buf[e..], &fi).is_some() { end = Some(e); break; } e += 1; }
                match end {
                    Some(en) => { d.packet(&buf[st..en]); i = en; }
                    None => { if flush { d.packet(&buf[st..]); i = buf.len(); } else { i = st; } break; }
                }
            }
            pos = i;
        }
        _ => { pos = buf.len(); }
    }
    d.pending = buf[pos.min(buf.len())..].to_vec();
}

// ---- the C interface ----
#[no_mangle] pub extern "C" fn sym_alloc(n: usize) -> *mut u8 { let mut v = Vec::<u8>::with_capacity(n.max(1)); let p = v.as_mut_ptr(); std::mem::forget(v); p }
#[no_mangle] pub unsafe extern "C" fn sym_dealloc(p: *mut u8, n: usize) { drop(Vec::from_raw_parts(p, 0, n.max(1))); }
#[no_mangle] pub extern "C" fn sym_err_ptr() -> *const u8 { unsafe { (&*(&raw const LAST_ERR)).as_ptr() } }
#[no_mangle] pub extern "C" fn sym_err_len() -> usize { unsafe { (&*(&raw const LAST_ERR)).len() } }

// A decoder for codec kind (1 AAC, 2 MP3, 3 FLAC, 4 Vorbis, 5 ALAC) with the codec's setup bytes (AAC AudioSpecificConfig, FLAC STREAMINFO,
// Vorbis ident and setup headers, ALAC magic cookie). 0 on failure, with the reason in sym_err.
#[no_mangle] pub unsafe extern "C" fn sym_new(kind: u32, extra: *const u8, len: usize) -> *mut Dec {
    let e = if len == 0 { &[][..] } else { std::slice::from_raw_parts(extra, len) };
    match make(kind, e) {
        Ok((dec, params)) => {
            let mut flac = FlacInfo::default();
            if kind == FLAC && e.len() >= 18 { flac.max_block = (e[2] as u32) << 8 | e[3] as u32; flac.channels = ((e[12] >> 1) & 7) as u32 + 1; }
            Box::into_raw(Box::new(Dec { kind, dec, params, pending: Vec::new(), flac, out: Vec::new(), rate: 0, channels: 0, tmp: Vec::new(), more: false, skipped: 0, seen_audio: false, skip: 0 }))
        }
        Err(m) => { set_err(&m); std::ptr::null_mut() }
    }
}
#[no_mangle] pub unsafe extern "C" fn sym_free(d: *mut Dec) { if !d.is_null() { drop(Box::from_raw(d)); } }
// Packets: n packets laid end to end in data, their lengths as u32 in lens. Returns the output frames waiting.
#[no_mangle] pub unsafe extern "C" fn sym_packets(d: *mut Dec, data: *const u8, lens: *const u32, n: usize) -> usize {
    let d = &mut *d; let lens = std::slice::from_raw_parts(lens, n); let mut at = 0usize;
    for &l in lens { let l = l as usize; let pk = std::slice::from_raw_parts(data.add(at), l); at += l; if l > 0 { d.packet(pk); } }
    d.out.first().map_or(0, |o| o.len())
}
// Stream bytes (MP3, FLAC): appended, cut into frames and decoded. Returns the output frames waiting. When sym_more says 1, call again with len 0 after taking the output.
#[no_mangle] pub unsafe extern "C" fn sym_push(d: *mut Dec, data: *const u8, len: usize, flush: u32) -> usize {
    let d = &mut *d; if len > 0 { d.pending.extend_from_slice(std::slice::from_raw_parts(data, len)); }
    drain(d, flush != 0);
    d.out.first().map_or(0, |o| o.len())
}
#[no_mangle] pub unsafe extern "C" fn sym_more(d: *const Dec) -> u32 { (*d).more as u32 }
#[no_mangle] pub unsafe extern "C" fn sym_skipped(d: *const Dec) -> u32 { (*d).skipped }
#[no_mangle] pub unsafe extern "C" fn sym_rate(d: *const Dec) -> u32 { (*d).rate }
#[no_mangle] pub unsafe extern "C" fn sym_channels(d: *const Dec) -> u32 { (*d).out.len() as u32 }
#[no_mangle] pub unsafe extern "C" fn sym_plane(d: *const Dec, ch: usize) -> *const f32 { (&(*d).out)[ch].as_ptr() }
#[no_mangle] pub unsafe extern "C" fn sym_clear(d: *mut Dec) { let d = &mut *d; for o in d.out.iter_mut() { o.clear(); } }
