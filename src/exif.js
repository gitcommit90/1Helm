// Capture metadata from a photo or a video, with no model call (Memory envelope, the design notes, the photo and video
// adapter). The whole file is covered: the reader walks the file's own structure (JPEG segments, PNG and WebP chunks, the boxes of HEIC,
// AVIF, MP4 and QuickTime, the IFDs of TIFF and DNG) through ranged reads, so it reads every metadata block wherever it sits and skips the
// image and video data. Pages of 1 MB are read on demand and at most 8 are held at once, so memory does not grow with the file size.
// (Captain 2026-10-14: read the full file, store every tag present.)
//
// → { format, tags, takenAt, takenHow, offsetMin, lat, lng, make, model }
//   tags: every tag found, exactly as written, under a readable key: EXIF IFD0, IFD1, Exif, GPS, Interop and SubIFD tags ("ifd0_make",
//         "exif_lens_model", "gps_altitude", "gps_h_positioning_error"; an unnamed tag is "<ifd>_tag_<hex id>"), XMP ("xmp"), IPTC ("iptc_city"),
//         PNG text and time chunks ("png_text_<keyword>"), QuickTime keys and user data ("qt_com_apple_quicktime_location_iso6709",
//         "qt_udta_cxyz", "qt_mvhd_creation_time"). Numbers are written as numbers, rationals as "numerator/denominator", text as text, and
//         bytes that are not text as "hex:<bytes>". Values with several parts are separated by spaces; a repeated IPTC field is a JSON array.
//   takenAt, offsetMin, lat, lng, make, model: derived from the tags (1HC's reading of them, kept beside the tags, which stay unchanged).
// Anything unreadable gives nulls: a file with no metadata is still a file.
const utf8 = new TextDecoder("utf-8"), latin1 = new TextDecoder("latin1");
export const PAGE = 1 << 20, PAGES_KEPT = 8;

// A reader over get({ offset, length }) → Uint8Array | null, with a small page cache. rd(offset, length) → Uint8Array | null (null outside the file).
export function pager(get, size, page = PAGE, keep = PAGES_KEPT) {
  const cache = new Map();
  const pg = async (i) => {
    if (cache.has(i)) { const v = cache.get(i); cache.delete(i); cache.set(i, v); return v; }
    const v = (await get({ offset: i * page, length: Math.min(page, size - i * page) })) || new Uint8Array(0);
    cache.set(i, v); if (cache.size > keep) cache.delete(cache.keys().next().value); return v;
  };
  return async (off, len) => {
    if (!(off >= 0) || !(len >= 0) || off + len > size) return null; if (len === 0) return new Uint8Array(0);
    const out = new Uint8Array(len); let o = 0;
    while (o < len) { const i = Math.floor((off + o) / page), p = await pg(i), s = off + o - i * page, n = Math.min(len - o, p.length - s); if (n <= 0) return null; out.set(p.subarray(s, s + n), o); o += n; }
    return out;
  };
}
const bufReader = (buf) => async (off, len) => (off >= 0 && len >= 0 && off + len <= buf.length ? buf.subarray(off, off + len) : null);
const u16be = (b, o) => (b[o] << 8) | b[o + 1], u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const fourcc = (b, o) => latin1.decode(b.subarray(o, o + 4));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const keyOf = (s) => { const k = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); return /^[a-z]/.test(k) ? k : `k_${k}`; };
const isText = (b) => b.every((x, i) => (x >= 0x20 && x < 0x7f) || x === 9 || x === 10 || x === 13 || (x === 0 && b.subarray(i).every((y) => y === 0)));
const bytesValue = (b) => (b.length && isText(b) ? latin1.decode(b).replace(/\0+$/, "") : `hex:${hex(b)}`);

// ---- TIFF (EXIF) ----
const TIFF_NAMES = {
  ifd: { 0x00fe: "new_subfile_type", 0x0100: "image_width", 0x0101: "image_length", 0x0102: "bits_per_sample", 0x0103: "compression", 0x0106: "photometric_interpretation", 0x010e: "image_description",
    0x010f: "make", 0x0110: "model", 0x0111: "strip_offsets", 0x0112: "orientation", 0x0115: "samples_per_pixel", 0x0116: "rows_per_strip", 0x0117: "strip_byte_counts", 0x011a: "x_resolution",
    0x011b: "y_resolution", 0x011c: "planar_configuration", 0x0128: "resolution_unit", 0x0131: "software", 0x0132: "datetime", 0x013b: "artist", 0x013e: "white_point", 0x013f: "primary_chromaticities",
    0x014a: "sub_ifds", 0x0201: "jpeg_interchange_format", 0x0202: "jpeg_interchange_format_length", 0x0211: "ycbcr_coefficients", 0x0213: "ycbcr_positioning", 0x0214: "reference_black_white",
    0x02bc: "xmp", 0x4746: "rating", 0x8298: "copyright", 0x83bb: "iptc", 0x8769: "exif_ifd_pointer", 0x8773: "icc_profile", 0x8825: "gps_ifd_pointer", 0xc612: "dng_version", 0xc614: "unique_camera_model" },
  exif: { 0x829a: "exposure_time", 0x829d: "f_number", 0x8822: "exposure_program", 0x8824: "spectral_sensitivity", 0x8827: "iso", 0x8830: "sensitivity_type", 0x8832: "recommended_exposure_index",
    0x9000: "exif_version", 0x9003: "datetime_original", 0x9004: "datetime_digitized", 0x9010: "offset_time", 0x9011: "offset_time_original", 0x9012: "offset_time_digitized", 0x9101: "components_configuration",
    0x9102: "compressed_bits_per_pixel", 0x9201: "shutter_speed_value", 0x9202: "aperture_value", 0x9203: "brightness_value", 0x9204: "exposure_bias_value", 0x9205: "max_aperture_value",
    0x9206: "subject_distance", 0x9207: "metering_mode", 0x9208: "light_source", 0x9209: "flash", 0x920a: "focal_length", 0x9214: "subject_area", 0x927c: "maker_note", 0x9286: "user_comment",
    0x9290: "subsec_time", 0x9291: "subsec_time_original", 0x9292: "subsec_time_digitized", 0xa000: "flashpix_version", 0xa001: "color_space", 0xa002: "pixel_x_dimension", 0xa003: "pixel_y_dimension",
    0xa004: "related_sound_file", 0xa005: "interop_ifd_pointer", 0xa20e: "focal_plane_x_resolution", 0xa20f: "focal_plane_y_resolution", 0xa210: "focal_plane_resolution_unit", 0xa215: "exposure_index",
    0xa217: "sensing_method", 0xa300: "file_source", 0xa301: "scene_type", 0xa401: "custom_rendered", 0xa402: "exposure_mode", 0xa403: "white_balance", 0xa404: "digital_zoom_ratio",
    0xa405: "focal_length_in_35mm_film", 0xa406: "scene_capture_type", 0xa407: "gain_control", 0xa408: "contrast", 0xa409: "saturation", 0xa40a: "sharpness", 0xa40c: "subject_distance_range",
    0xa420: "image_unique_id", 0xa430: "camera_owner_name", 0xa431: "body_serial_number", 0xa432: "lens_specification", 0xa433: "lens_make", 0xa434: "lens_model", 0xa435: "lens_serial_number", 0xa460: "composite_image" },
  gps: { 0x00: "version_id", 0x01: "latitude_ref", 0x02: "latitude", 0x03: "longitude_ref", 0x04: "longitude", 0x05: "altitude_ref", 0x06: "altitude", 0x07: "timestamp", 0x08: "satellites",
    0x09: "status", 0x0a: "measure_mode", 0x0b: "dop", 0x0c: "speed_ref", 0x0d: "speed", 0x0e: "track_ref", 0x0f: "track", 0x10: "img_direction_ref", 0x11: "img_direction", 0x12: "map_datum",
    0x13: "dest_latitude_ref", 0x14: "dest_latitude", 0x15: "dest_longitude_ref", 0x16: "dest_longitude", 0x17: "dest_bearing_ref", 0x18: "dest_bearing", 0x19: "dest_distance_ref",
    0x1a: "dest_distance", 0x1b: "processing_method", 0x1c: "area_information", 0x1d: "date_stamp", 0x1e: "differential", 0x1f: "h_positioning_error" },
  interop: { 0x01: "interop_index", 0x02: "interop_version" },
};
const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

// rd: a reader over the bytes that hold the TIFF block; base: where the TIFF header starts. Adds to out.tags; returns the parsed values per IFD
// for the derived fields ({ ifd0: { tag: { type, v } }, exif, gps, ... }), or null.
async function parseTiff(rd, base, out) {
  const h = await rd(base, 8); if (!h) return null;
  const le = h[0] === 0x49 && h[1] === 0x49; if (!le && !(h[0] === 0x4d && h[1] === 0x4d)) return null;
  const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength), U16 = (b, o) => dv(b).getUint16(o, le), U32 = (b, o) => dv(b).getUint32(o, le);
  if (U16(h, 2) === 43) { out.tags.tiff_note = "BigTIFF: not read"; return null; }
  if (U16(h, 2) !== 42) return null;
  const vals = {}, seen = new Set();
  const decode = (type, b, count) => {
    const d = dv(b), n = [];
    if (type === 2) return utf8.decode(b).replace(/\0+$/, "");
    if (type === 7) return bytesValue(b);   // UNDEFINED: text when it is text, else hex
    for (let i = 0; i < count; i++) {
      if (type === 1) n.push(b[i]); else if (type === 3) n.push(d.getUint16(i * 2, le)); else if (type === 4 || type === 13) n.push(d.getUint32(i * 4, le)); else if (type === 6) n.push(d.getInt8(i));
      else if (type === 8) n.push(d.getInt16(i * 2, le)); else if (type === 9) n.push(d.getInt32(i * 4, le)); else if (type === 11) n.push(d.getFloat32(i * 4, le)); else if (type === 12) n.push(d.getFloat64(i * 8, le));
      else if (type === 5) n.push(`${d.getUint32(i * 8, le)}/${d.getUint32(i * 8 + 4, le)}`); else if (type === 10) n.push(`${d.getInt32(i * 8, le)}/${d.getInt32(i * 8 + 4, le)}`);
    }
    return n;
  };
  const walk = async (off, name, chain) => {
    if (!off || seen.has(off)) return; seen.add(off);   // a pointer loop is read once
    const nb = await rd(base + off, 2); if (!nb) return; const n = U16(nb, 0), ents = await rd(base + off + 2, n * 12); if (!ents) return;
    const table = TIFF_NAMES[/^(ifd|sub)\d*$/.test(name) ? "ifd" : name] || {}, mine = (vals[name] = {});
    for (let k = 0; k < n; k++) {
      const e = ents.subarray(k * 12, k * 12 + 12), tag = U16(e, 0), type = U16(e, 2), count = U32(e, 4), size = (SZ[type] || 0) * count;
      const key = `${name}_${table[tag] || `tag_${tag.toString(16).padStart(4, "0")}`}`;
      if (!SZ[type]) { out.tags[key] = `type ${type}: not read`; continue; }
      const b = size <= 4 ? e.subarray(8, 8 + size) : await rd(base + U32(e, 8), size); if (!b) { out.tags[key] = "value outside the file"; continue; }
      const v = tag === 0x02bc && (type === 1 || type === 7) ? utf8.decode(b).replace(/\0+$/, "") : decode(type, b, count); mine[tag] = { type, v };   // XMP inside TIFF: text
      out.tags[key] = Array.isArray(v) ? v.join(" ") : v;
      if (tag === 0x02bc && typeof v === "string") out.tags.xmp = (out.tags.xmp || "") + v;
    }
    const sub = async (tag, to) => { const p = mine[tag]?.v; if (Array.isArray(p)) for (const [i, x] of p.entries()) await walk(x, to.includes("#") ? to.replace("#", String(i)) : to, false); };
    await sub(0x8769, "exif"); await sub(0x8825, "gps"); await sub(0xa005, "interop"); await sub(0x014a, "sub#");
    if (chain) { const nx = await rd(base + off + 2 + n * 12, 4); if (nx) await walk(U32(nx, 0), `ifd${Number(name.slice(3)) + 1}`, true); }
  };
  await walk(U32(h, 4), "ifd0", true);
  return vals;
}

// ---- XMP, IPTC ----
const IPTC_NAMES = { "2:5": "object_name", "2:15": "category", "2:20": "supplemental_category", "2:25": "keywords", "2:40": "special_instructions", "2:55": "date_created", "2:60": "time_created",
  "2:62": "digital_creation_date", "2:63": "digital_creation_time", "2:80": "byline", "2:85": "byline_title", "2:90": "city", "2:92": "sublocation", "2:95": "province_state", "2:100": "country_code",
  "2:101": "country", "2:103": "transmission_reference", "2:105": "headline", "2:110": "credit", "2:115": "source", "2:116": "copyright", "2:120": "caption", "2:122": "writer" };
function parseIptc(b, out) {
  const seen = {};
  for (let o = 0; o + 5 <= b.length; ) {
    if (b[o] !== 0x1c) { o++; continue; }
    const rec = b[o + 1], ds = b[o + 2], len = u16be(b, o + 3); if (len & 0x8000) break;   // an extended length dataset: the rest is not IIM text
    const v = utf8.decode(b.subarray(o + 5, o + 5 + len)), k = `iptc_${IPTC_NAMES[`${rec}:${ds}`] || `${rec}_${ds}`}`;
    (seen[k] ||= []).push(v); o += 5 + len;
  }
  for (const [k, v] of Object.entries(seen)) out.tags[k] = v.length === 1 ? v[0] : JSON.stringify(v);
}
function parsePhotoshop(b, out) {   // APP13 "Photoshop 3.0\0" then 8BIM resources; 0x0404 is IPTC
  for (let o = 0; o + 12 <= b.length; ) {
    if (latin1.decode(b.subarray(o, o + 4)) !== "8BIM") break;
    const id = u16be(b, o + 4), nl = b[o + 6], np = (nl + 1) % 2 ? nl + 2 : nl + 1, so = o + 6 + np, size = u32be(b, so), data = b.subarray(so + 4, so + 4 + size);
    if (id === 0x0404) parseIptc(data, out);
    o = so + 4 + size + (size % 2);
  }
}
const EXIF_HDR = "Exif\0\0", XMP_HDR = "http://ns.adobe.com/xap/1.0/\0", XMP_EXT = "http://ns.adobe.com/xmp/extension/\0";
const starts = (b, s) => b.length >= s.length && latin1.decode(b.subarray(0, s.length)) === s;

// ---- containers ----
async function jpeg(rd, size, out) {
  let off = 2;
  while (off + 4 <= size) {
    const h = await rd(off, 4); if (!h || h[0] !== 0xff) break; const m = h[1];
    if (m === 0xff) { off += 1; continue; } if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { off += 2; continue; } if (m === 0xd9 || m === 0xda) break;   // image data starts: no metadata after it in the JPEG structure
    const len = u16be(h, 2); if (len < 2) break;
    if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) {
      const d = await rd(off + 4, len - 2);
      if (d && m === 0xe1 && starts(d, EXIF_HDR)) out.v.push(await parseTiff(bufReader(d), 6, out));
      else if (d && m === 0xe1 && starts(d, XMP_HDR)) out.tags.xmp = (out.tags.xmp || "") + utf8.decode(d.subarray(XMP_HDR.length));
      else if (d && m === 0xe1 && starts(d, XMP_EXT)) out.tags.xmp_extended = (out.tags.xmp_extended || "") + utf8.decode(d.subarray(XMP_EXT.length + 40));
      else if (d && m === 0xed && starts(d, "Photoshop 3.0\0")) parsePhotoshop(d.subarray(14), out);
      else if (d && m === 0xfe) out.tags.jpeg_comment = utf8.decode(d);
    }
    off += 2 + len;
  }
}
async function png(rd, size, out) {
  for (let off = 8; off + 8 <= size; ) {
    const h = await rd(off, 8); if (!h) break; const len = u32be(h, 0), type = fourcc(h, 4);
    if (type === "IEND") break;
    if (["eXIf", "tEXt", "zTXt", "iTXt", "tIME"].includes(type)) {
      const d = await rd(off + 8, len);
      if (d && type === "eXIf") out.v.push(await parseTiff(bufReader(d), starts(d, EXIF_HDR) ? 6 : 0, out));
      else if (d && type === "tIME") out.tags.png_time = `${u16be(d, 0)}-${d[2]}-${d[3]} ${d[4]}:${d[5]}:${d[6]}`;
      else if (d) {
        const z = d.indexOf(0), kw = latin1.decode(d.subarray(0, z)); let text = null;
        if (type === "tEXt") text = latin1.decode(d.subarray(z + 1));
        else if (type === "zTXt") text = await inflate(d.subarray(z + 2));
        else { const comp = d[z + 1], a = d.indexOf(0, z + 3), b = d.indexOf(0, a + 1), body = d.subarray(b + 1); text = comp ? await inflate(body) : utf8.decode(body); }
        const k = kw === "XML:com.adobe.xmp" ? "xmp" : `png_text_${keyOf(kw)}`; out.tags[k] = text ?? `hex:${hex(d)}`;
      }
    }
    off += 12 + len;
  }
}
async function inflate(b) {
  try { return utf8.decode(new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer())); } catch { return null; }
}
async function webp(rd, size, out) {
  for (let off = 12; off + 8 <= size; ) {
    const h = await rd(off, 8); if (!h) break; const type = fourcc(h, 0), len = h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] << 24);
    if (type === "EXIF") { const d = await rd(off + 8, len); if (d) out.v.push(await parseTiff(bufReader(d), starts(d, EXIF_HDR) ? 6 : 0, out)); }
    else if (type === "XMP ") { const d = await rd(off + 8, len); if (d) out.tags.xmp = utf8.decode(d); }
    off += 8 + len + (len % 2);
  }
}
// ISO base media (HEIC, AVIF, MP4, QuickTime): boxes in [start, end).
async function boxes(rd, start, end, cb) {
  for (let off = start; off + 8 <= end; ) {
    const h = await rd(off, 8); if (!h) break; let sz = u32be(h, 0), hdr = 8; const type = fourcc(h, 4);
    if (sz === 1) { const l = await rd(off + 8, 8); if (!l) break; sz = Number(new DataView(l.buffer, l.byteOffset, 8).getBigUint64(0)); hdr = 16; } else if (sz === 0) sz = end - off;
    if (sz < hdr || off + sz > end) break;
    await cb(type, off + hdr, off + sz); off += sz;
  }
}
const XMP_UUID = "be7acfcb97a942e89c71999491e3afac";
async function bmff(rd, size, out) {
  await boxes(rd, 0, size, async (t, s, e) => {
    if (t === "ftyp") { const b = await rd(s, Math.min(8, e - s)); if (b) out.tags.ftyp_major_brand = fourcc(b, 0); }
    else if (t === "meta") await heifMeta(rd, s, e, out);
    else if (t === "moov") await moov(rd, s, e, out);
    else if (t === "uuid") { const u = await rd(s, 16); if (u && hex(u) === XMP_UUID) { const d = await rd(s + 16, e - s - 16); if (d) out.tags.xmp = utf8.decode(d); } }
  });
}
async function heifMeta(rd, s, e, out) {
  const buf = await rd(s, e - s); if (!buf) return; const r = bufReader(buf), items = new Map(), locs = new Map(); let idat = null;
  const uint = (b, o, n) => (n === 0 ? 0 : n === 2 ? u16be(b, o) : n === 4 ? u32be(b, o) : Number(new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0)));
  await boxes(r, 4, buf.length, async (t, bs, be) => {
    const b = buf.subarray(bs, be), v = b[0];
    if (t === "iinf") {
      const first = v === 0 ? 6 : 8;
      await boxes(bufReader(b), first, b.length, async (t2, s2, e2) => {
        if (t2 !== "infe") return; const x = b.subarray(s2, e2), iv = x[0]; if (iv < 2) return;
        const id = iv === 2 ? u16be(x, 4) : u32be(x, 4), p = iv === 2 ? 8 : 10, type = fourcc(x, p), rest = x.subarray(p + 4), z = rest.indexOf(0);
        const ct = type === "mime" ? latin1.decode(rest.subarray(z + 1, rest.indexOf(0, z + 1) < 0 ? rest.length : rest.indexOf(0, z + 1))) : "";
        items.set(id, { type, ct });
      });
    } else if (t === "iloc") {
      const os = b[4] >> 4, ls = b[4] & 15, bos = b[5] >> 4, is = v === 1 || v === 2 ? b[5] & 15 : 0; let o = 6; const n = v < 2 ? u16be(b, o) : u32be(b, o); o += v < 2 ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const id = v < 2 ? u16be(b, o) : u32be(b, o); o += v < 2 ? 2 : 4; let cm = 0; if (v === 1 || v === 2) { cm = u16be(b, o) & 15; o += 2; }
        o += 2; const baseOff = uint(b, o, bos); o += bos; const ec = u16be(b, o); o += 2; const ex = [];
        for (let j = 0; j < ec; j++) { o += is; const eo = uint(b, o, os); o += os; const el = uint(b, o, ls); o += ls; ex.push([baseOff + eo, el]); }
        locs.set(id, { cm, ex });
      }
    } else if (t === "idat") idat = b;
  });
  for (const [id, it] of items) {
    const want = it.type === "Exif" || (it.type === "mime" && /xmp|rdf/i.test(it.ct)); const l = locs.get(id); if (!want || !l) continue;
    const parts = []; for (const [o, len] of l.ex) parts.push(l.cm === 1 ? idat?.subarray(o, o + len) : await rd(o, len || 0));
    if (parts.some((p) => !p)) continue; const d = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { d.set(p, k); k += p.length; }
    if (it.type === "Exif") out.v.push(await parseTiff(bufReader(d), 4 + u32be(d, 0), out)); else out.tags.xmp = utf8.decode(d);
  }
}
async function moov(rd, s, e, out) {
  const keys = [];
  const dataValue = (b) => {   // an ilst 'data' box body: type, locale, value
    const type = u32be(b, 0) & 0xffffff, v = b.subarray(8), dvw = new DataView(v.buffer, v.byteOffset, v.byteLength);
    if (type === 1) return utf8.decode(v); if (type === 2) return new TextDecoder("utf-16be").decode(v);
    if (type === 23 && v.length === 4) return dvw.getFloat32(0); if (type === 24 && v.length === 8) return dvw.getFloat64(0);
    if ((type === 21 || type === 22) && [1, 2, 4, 8].includes(v.length)) { const s2 = type === 21; return v.length === 1 ? (s2 ? dvw.getInt8(0) : v[0]) : v.length === 2 ? (s2 ? dvw.getInt16(0) : dvw.getUint16(0)) : v.length === 4 ? (s2 ? dvw.getInt32(0) : dvw.getUint32(0)) : String(s2 ? dvw.getBigInt64(0) : dvw.getBigUint64(0)); }
    return `hex:${hex(v)}`;
  };
  const meta = async (ms, me) => {
    const head = await rd(ms + 4, 4); const start = head && ["hdlr", "keys", "ilst"].includes(fourcc(head, 0)) ? ms : ms + 4;   // QuickTime meta is a plain box, iTunes meta a full box
    await boxes(rd, start, me, async (t, bs, be) => {
      const b = await rd(bs, be - bs); if (!b) return;
      if (t === "keys") { const n = u32be(b, 4); for (let i = 0, o = 8; i < n && o + 8 <= b.length; i++) { const sz = u32be(b, o); keys.push(latin1.decode(b.subarray(o + 8, o + sz))); o += sz; } }
      else if (t === "ilst") await boxes(bufReader(b), 0, b.length, async (it, is, ie) => {
        const idx = u32be(b, is - 8 + 4), name = keys.length && idx >= 1 && idx <= keys.length ? keys[idx - 1] : it.replace(/©/g, "c");
        await boxes(bufReader(b), is, ie, async (dt, ds, de) => { if (dt === "data") out.tags[`qt_${keyOf(name)}`] = dataValue(b.subarray(ds, de)); });
      });
    });
  };
  const walk = async (ws, we) => boxes(rd, ws, we, async (t, bs, be) => {
    if (t === "mvhd") {
      const b = await rd(bs, Math.min(be - bs, 32)); if (!b) return; const v = b[0], d = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const [c, m, ts, du] = v === 1 ? [Number(d.getBigUint64(4)), Number(d.getBigUint64(12)), d.getUint32(20), Number(d.getBigUint64(24))] : [d.getUint32(4), d.getUint32(8), d.getUint32(12), d.getUint32(16)];
      Object.assign(out.tags, { qt_mvhd_creation_time: c, qt_mvhd_modification_time: m, qt_mvhd_timescale: ts, qt_mvhd_duration: du });
    } else if (t === "meta") await meta(bs, be);
    else if (t === "udta") await boxes(rd, bs, be, async (ut, us, ue) => {
      if (ut === "meta") return meta(us, ue);
      if (ut === "XMP_") { const d = await rd(us, ue - us); if (d) out.tags.xmp = utf8.decode(d); return; }
      if (ut.charCodeAt(0) !== 0xa9) return; const d = await rd(us, ue - us); if (!d || d.length < 4) return;
      out.tags[`qt_udta_${keyOf(ut.replace(/©/g, "c"))}`] = fourcc(d, 4) === "data" ? dataValue(d.subarray(8)) : utf8.decode(d.subarray(4, 4 + u16be(d, 0)));
    });
    else if (t === "trak") await walk(bs, be);
  });
  await walk(s, e);
}

// ---- the derived fields ----
const ratio = (x) => { const [a, b] = String(x).split("/").map(Number); return b ? a / b : NaN; };
const dms = (v, ref) => { if (!Array.isArray(v) || v.length < 3) return null; const x = ratio(v[0]) + ratio(v[1]) / 60 + ratio(v[2]) / 3600; return Number.isFinite(x) ? (/^[SW]/i.test(String(ref || "")) ? -x : x) : null; };
function exifTime(s, off) {   // "2026:10:03 14:22:05" with an optional "+01:00" → epoch ms; with no offset the time is the camera's local clock
  const m = String(s || "").match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/); if (!m || m[1] === "0000") return null;   // EXIF writes unknown dates as zeros
  const o = String(off || "").match(/^([+-])(\d{2}):?(\d{2})$/), min = o ? (o[1] === "-" ? -1 : 1) * (+o[2] * 60 + +o[3]) : null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (min ?? 0) * 60e3;
  return Number.isFinite(t) ? { ms: t, offsetMin: min } : null;
}
// The decimal degrees are derived beside the file's own values and kept whatever they are (0,0 and out of range included, Captain
// 2026-10-14); whether a place name is looked up for them is decided later (memory-envelope.js geoValid).
const geoOk = (a, b) => a != null && b != null && Number.isFinite(a) && Number.isFinite(b);
function derive(out) {
  const r = { takenAt: null, takenHow: null, offsetMin: null, lat: null, lng: null, make: null, model: null }, T = out.tags;
  for (const vals of out.v.filter(Boolean)) {
    const ifd0 = vals.ifd0 || {}, ex = vals.exif || {}, gps = vals.gps || {}, g = (t, k) => t[k]?.v;
    if (r.takenAt == null) {
      const orig = exifTime(g(ex, 0x9003) || g(ifd0, 0x0132), g(ex, 0x9011) || g(ex, 0x9010)), gd = String(g(gps, 0x1d) || "").match(/^(\d{4}):(\d{2}):(\d{2})$/), gt = g(gps, 0x07);
      if (orig && orig.offsetMin != null) Object.assign(r, { takenAt: orig.ms, takenHow: "exif", offsetMin: orig.offsetMin });
      else if (gd && Array.isArray(gt) && gt.length >= 3) Object.assign(r, { takenAt: Date.UTC(+gd[1], +gd[2] - 1, +gd[3], ratio(gt[0]), ratio(gt[1]), Math.floor(ratio(gt[2]))), takenHow: "exif-gps-utc" });
      else if (orig) Object.assign(r, { takenAt: orig.ms, takenHow: "exif-local" });   // the camera's clock with no zone: read as UTC, the caller shifts it by the person's zone
    }
    if (r.lat == null) { const a = dms(g(gps, 0x02), g(gps, 0x01)), b = dms(g(gps, 0x04), g(gps, 0x03)); if (geoOk(a, b)) Object.assign(r, { lat: a, lng: b }); }
    if (r.make == null && typeof g(ifd0, 0x010f) === "string") r.make = g(ifd0, 0x010f).trim() || null;
    if (r.model == null && typeof g(ifd0, 0x0110) === "string") r.model = g(ifd0, 0x0110).trim() || null;
  }
  // QuickTime: Apple's creationdate key or ©day (ISO 8601 with an offset), else the mvhd creation time (seconds since 1904, UTC; 0 means not set)
  if (r.takenAt == null) {
    const c = String(T.qt_com_apple_quicktime_creationdate || T.qt_udta_cday || "").match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}:?\d{2}|Z)?/);
    if (c) { const z = !c[2] ? "Z" : c[2].length === 5 ? `${c[2].slice(0, 3)}:${c[2].slice(3)}` : c[2], t = Date.parse(`${c[1]}${z}`); if (Number.isFinite(t)) Object.assign(r, { takenAt: t, takenHow: "video", offsetMin: !c[2] ? null : z === "Z" ? 0 : (z[0] === "-" ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(4, 6)) }); }
    else if (Number(T.qt_mvhd_creation_time) > 0) Object.assign(r, { takenAt: (Number(T.qt_mvhd_creation_time) - 2082844800) * 1000, takenHow: "video-mvhd-utc" });
  }
  if (r.lat == null) { const g6709 = String(T.qt_com_apple_quicktime_location_iso6709 || T.qt_udta_cxyz || "").match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/); if (g6709) { const a = Number(g6709[1]), b = Number(g6709[2]); if (geoOk(a, b)) Object.assign(r, { lat: a, lng: b }); } }
  r.make ??= String(T.qt_com_apple_quicktime_make || T.qt_udta_cmak || "").trim() || null; r.model ??= String(T.qt_com_apple_quicktime_model || T.qt_udta_cmod || "").trim() || null;
  return r;
}

// get({ offset, length }) → Uint8Array | null; size: the file's size in bytes. → the metadata, or null when the file holds none.
export async function readMetadata(get, size) {
  size = Number(size) || 0; if (size < 8) return null;
  const rd = pager(get, size), h = await rd(0, Math.min(16, size)); if (!h) return null;
  const out = { tags: {}, v: [] }; let format = null;
  if (h[0] === 0xff && h[1] === 0xd8) { format = "jpeg"; await jpeg(rd, size, out); }
  else if (h[0] === 0x89 && fourcc(h, 1) === "PNG\r") { format = "png"; await png(rd, size, out); }
  else if (fourcc(h, 0) === "RIFF" && fourcc(h, 8) === "WEBP") { format = "webp"; await webp(rd, size, out); }
  else if ((h[0] === 0x49 && h[1] === 0x49) || (h[0] === 0x4d && h[1] === 0x4d)) { format = "tiff"; out.v.push(await parseTiff(rd, 0, out)); }
  else if (["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(fourcc(h, 4))) { format = "bmff"; await bmff(rd, size, out); }
  if (!Object.keys(out.tags).length) return null;
  return { format, tags: out.tags, ...derive(out) };
}
// The same over bytes already in memory.
export const readMetadataBytes = (bytes) => { const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []); return readMetadata(async ({ offset, length }) => b.subarray(offset, offset + length), b.length); };
