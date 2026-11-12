// Photo and video adapter (ENVELOPE.md): when a photo was taken, where, and with what, read from the file's own metadata (exif.js) with
// no model call, then merged with the sidecar's picture description (sidecar.js) into one Library file item.
//   - The whole file's metadata is read (exif.js walks the file's structure with ranged reads and skips the image and video data), and
//     every tag goes into the envelope's raw block exactly as written.
//   - GPS is stored exactly as the file gave it (decimal degrees computed at full precision, and the file's own degrees, minutes and
//     seconds in raw). A city level place name is looked up by the same free OpenStreetMap lookup location.js uses (only a spot rounded to
//     2 decimals is sent to it) and kept beside the coordinates, marked as geocoded (derived).
//   - A camera clock with no zone ("exif-local") is read in the person's time zone, which is right for most photos taken at home.
import { makeEnvelope, placeText } from "../memory-envelope.js";
import { readMetadata } from "../exif.js";

export const modality = "photo";
const ext = (name) => String(name || "").toLowerCase().split(".").pop();
export const isPhoto = (mime, name) => /^image\//i.test(String(mime || "")) || ["jpg", "jpeg", "heic", "heif", "tif", "tiff", "webp", "png", "dng"].includes(ext(name));
export const isVideo = (mime, name) => /^video\//i.test(String(mime || "")) || ["mp4", "mov", "m4v", "3gp"].includes(ext(name));

// The person's UTC offset in minutes at an instant.
export function offsetMin(ms, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000);
  } catch { return 0; }
}

// get({ offset, length }) → Uint8Array | null. → the metadata of the whole file (exif.js readMetadata), or null.
export async function readMediaMeta(get, { mime, name, bytes }) {
  if (!isPhoto(mime, name) && !isVideo(mime, name)) return null;
  return readMetadata(get, bytes);
}

// fileSource: the files table's source column → the envelope source. "upload" (the person uploaded it) is user, "helper" (the helper made
// it) is assistant; anything else is left empty.
export const fileSource = (s) => (s === "upload" ? "user" : s === "helper" ? "assistant" : null);
export function mediaEnvelope({ meta, tz, uploadedAt, place = "", label = null, fileId, mime, name, hash = null, source = "user" }) {
  const video = isVideo(mime, name);
  let start = meta?.takenAt ?? null, how = meta?.takenHow || null, offset = meta?.offsetMin ?? null, tzSource = offset != null || how === "exif-gps-utc" || how === "video-mvhd-utc" ? "source" : "unknown";
  if (start != null && how === "exif-local") { offset = offsetMin(start, tz); start -= offset * 60e3; tzSource = "assumed"; }   // the camera clock, read in the person's zone
  if (start == null) { start = Number(uploadedAt) || null; how = "upload"; tzSource = "account"; }
  // The zone name is kept only where it is the person's own zone (assumed for a camera clock with no zone, or the account for an upload time). A zone the
  // file gave is its offset, and the person's zone is never written beside it, so when_tz and when_offset can't contradict each other.
  const geo = meta?.lat != null && meta?.lng != null ? { lat: meta.lat, lng: meta.lng, place: place || null, placeFrom: "geocoded", label, how: video ? "video" : "exif" } : null;
  const device = [meta?.make, meta?.model].filter(Boolean).join(" ").replace(/^(\S+) \1 /i, "$1 ").trim() || null;
  return makeEnvelope({ kind: mime || null, kind1hc: "media", modality: video ? "video" : "image", when: { start, tz: tzSource === "assumed" || tzSource === "account" ? tz : null, offset, tzSource, how }, where: geo, from: { device }, source, links: { file: fileId },
    privacy: { location: geo ? "on" : "off" }, id: { record: `file:${fileId}`, dedupe: hash ? `sha256:${hash}` : null }, ingest: { at: uploadedAt }, raw: meta?.tags || {} });
}

export const GENERATED = "[Written by 1Helm from the file's metadata]";   // marks 1HC's own line, so it is never read as the file's content
// The details line that goes in front of the picture's description, so the time and place are in the text Hindsight reads.
export function mediaDetails(e, { tz } = {}) {
  if (!e) return "";
  const what = e.modality === "video" ? "Video" : "Photo", bits = [];
  if (e.when.start != null && e.when.how !== "upload") bits.push(`taken ${localStamp(e.when.start, tz, e.when.offset)}`);   // in the photo's own offset when the file has one
  else if (e.when.start != null) bits.push(`uploaded ${localStamp(e.when.start, tz)} (no capture time in the file)`);
  const p = placeText(e); if (p) bits.push(`in ${p}`);
  if (e.from.device) bits.push(`with ${e.from.device}`);
  return bits.length ? `${GENERATED} ${what} ${bits.join(" ")}.` : "";
}
function localStamp(ms, tz, off = null) {
  const o = off ?? offsetMin(ms, tz), d = new Date(ms + o * 60e3), a = Math.abs(o);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} (UTC${o < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")})`;
}
