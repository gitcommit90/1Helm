// Seeing the screen when the text outline is not enough (task browser-vision).
// The outline names links, buttons and fields, but not a canvas, a big clickable picture or an icon-only button. This module decides when to
// look at the screen, turns what a vision model and OCR find into click positions, and converts the positions a model gives back into the
// 1280x800 page. The look itself uses the saved "look" job (Moondream, Models page) and is billed on the ledger like browser_screenshot look:true.
import { ocrLines } from "./ocr-look.js";
import { lookMoondream, moondreamRun, pointsToPixels, lookReserve } from "./sidecar.js";

export const PAGE_W = 1280, PAGE_H = 800;     // the browser's virtual screen
export const VISION_LOOKS_MAX = 8;             // looks one browser_task may take
export const VISION_OCR_ITEMS = 12;            // OCR texts offered as click positions
export const VISION_TARGETS = 3;               // described icons that get a position
const LABEL_MAX = 40;

// The pixel size of a JPEG, from its header.
export function jpegSize(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1]; if (m === 0xff) { i++; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

// ---- when to look ----
// Controls with no name: a button, link, tab or menu item whose outline line has an empty name. A dropdown's own arrow button is not counted
// (the menu already names it).
export function unnamedControls(outline) {
  let n = 0, combo = false;
  for (const l of String(outline || "").split("\n")) {
    const m = l.match(/^\[(?:f\d+)?e\d+\] (.+?) "([^"]*)"/); if (!m) continue;
    const role = m[1], label = m[2];
    if (/combobox|^select$/.test(role)) { combo = true; continue; }
    if (!label.trim() && /^(button|link|tab|menuitem)$/.test(role)) { if (!combo) n++; continue; }
    if (!/^(option|button)$/.test(role)) combo = false;
  }
  return n;
}
// The reasons to look at the screen, from facts only. hints = the browser's { canvas, clickable_images } (null when unknown),
// stalled = the last action changed nothing, or the helper asked to look again.
export function visionReasons({ hints = null, outline = "", stalled = false } = {}) {
  const why = [];
  if (Number(hints?.canvas) > 0) why.push("a canvas");
  if (Number(hints?.clickable_images) > 0) why.push("large clickable pictures");
  const u = unnamedControls(outline); if (u > 0) why.push(`${u} control${u > 1 ? "s" : ""} with no name`);
  if (stalled) why.push("a last action that changed nothing");
  return why;
}
// A worker history line that says the page did not move.
export const lastStepStalled = (hist) => /no visible change|no progress|Looked again$/.test(String(hist?.at?.(-1) || ""));

// ---- picture size and click positions ----
// A frame says how the numbers a model gives relate to the page: w x h is the picture the model was shown (or the page itself when
// it got text), viewW x viewH the page's own size in the pixels click_at takes.
export const identityFrame = (view) => ({ w: Number(view?.w) || PAGE_W, h: Number(view?.h) || PAGE_H, viewW: Number(view?.w) || PAGE_W, viewH: Number(view?.h) || PAGE_H });
export function frameOf(bytes, view) {
  const v = identityFrame(view), size = bytes ? jpegSize(bytes) : null;
  return size?.width && size?.height ? { w: size.width, h: size.height, viewW: v.viewW, viewH: v.viewH } : v;
}
// The sentence that tells the model its picture's size and what click_at takes.
export const frameText = (f) => `The picture is ${f.w}x${f.h} pixels (the page is ${f.viewW}x${f.viewH}). For click_at, give x and y in the picture's pixels, or as fractions from 0 to 1 of its width and height; both are converted.`;
// One click_at action in the model's numbers → page pixels. { x, y, how } or { error }.
export function convertClick(a, frame) {
  const f = frame || identityFrame(), x = Number(a?.x), y = Number(a?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return { error: "click_at needs x and y, zero or more" };
  const clamp = (v, max) => Math.min(Math.max(Math.round(v), 0), max);
  if (x <= 1 && y <= 1) return { x: clamp(x * f.viewW, f.viewW), y: clamp(y * f.viewH, f.viewH), how: "fractions" };   // 0 to 1 of the picture
  if (f.w !== f.viewW && x <= f.w && y <= f.h) return { x: clamp(x * f.viewW / f.w, f.viewW), y: clamp(y * f.viewH / f.h, f.viewH), how: "picture pixels" };
  return { x: Math.round(x), y: Math.round(y), how: "page pixels" };   // already page pixels (or outside the picture, so they can only be page pixels)
}
// The actions of a browser_act call with every click_at converted. Returns { actions, notes }; the input is not changed.
export function convertActions(actions, frame) {
  const notes = []; if (!Array.isArray(actions)) return { actions, notes };
  const out = actions.map((a) => {
    if (!a || a.kind !== "click_at") return a;
    const c = convertClick(a, frame); if (c.error) return a;   // the browser reports the error as before
    if (c.how !== "page pixels" && (c.x !== Math.round(Number(a.x)) || c.y !== Math.round(Number(a.y)))) notes.push(`click_at (${a.x}, ${a.y}) was read as ${c.how} and sent as page pixels (${c.x}, ${c.y})`);
    return { ...a, x: c.x, y: c.y };
  });
  return { actions: out, notes };
}

// ---- menu items for the browser_task worker ----
const shortLabel = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 60);
// OCR texts that the outline does not already offer as a named control become "Click at (x, y)" items, in page pixels.
export function ocrClickItems(lines, outline, frame, max = VISION_OCR_ITEMS) {
  const f = frame || identityFrame(), sx = f.viewW / f.w, sy = f.viewH / f.h, out = [], seen = new Set(), o = String(outline || "").toLowerCase();
  for (const l of lines || []) {
    const t = shortLabel(l.text); if (!t || t.length > LABEL_MAX || t.length < 2) continue;
    if (o.includes(`"${t.toLowerCase()}"`) || seen.has(t.toLowerCase())) continue; seen.add(t.toLowerCase());
    const x = Math.round(l.cx * sx), y = Math.round(l.cy * sy);
    out.push({ label: `Click at (${x}, ${y}): text "${t}" read on the screen`, act: [{ kind: "click_at", x, y, label: t }] });
    if (out.length >= max) break;
  }
  return out;
}
// Described things the vision model pointed at: [{ what, points: [[x, y]] }] in picture pixels → items in page pixels.
export function pointClickItems(found, frame) {
  const f = frame || identityFrame(), sx = f.viewW / f.w, sy = f.viewH / f.h, out = [];
  for (const t of found || []) for (const [px, py] of (t.points || []).slice(0, 1)) {
    const x = Math.round(px * sx), y = Math.round(py * sy), what = shortLabel(t.what);
    if (what) out.push({ label: `Click at (${x}, ${y}): ${what} (found on the screen by a vision model)`, act: [{ kind: "click_at", x, y, label: what }] });
  }
  return out;
}
// Add the items to a closed menu from buildMenu(): new ids continue the numbering, labels that are dead (did nothing) are left out.
export function addVisionItems(built, items, dead) {
  let i = Object.keys(built.menu).length + 100;   // ids stay unique even when the special items already hold the next numbers
  for (const it of items || []) {
    if (dead?.has(it.label) || Object.values(built.menu).includes(it.label)) continue;
    const id = `a${++i}`; built.menu[id] = it.label; built.act[id] = it.act;
  }
  return built;
}
// What to ask the vision model about icon-only controls, and how its answer becomes a list of things to point at.
export const TARGET_QUESTION = `Name up to ${VISION_TARGETS} buttons, icons or clickable areas on this screen that have no text label, one per line, each as a short description such as "magnifier icon at the top right". Reply with the lines only.`;
export const parseTargets = (answer) => String(answer || "").split(/\n|;/).map((s) => s.replace(/^\s*(?:[-*\d.)]+\s*)/, "").trim()).filter((s) => s.length >= 3 && s.length <= 80).slice(0, VISION_TARGETS);

// One look at the worker's page: a screenshot with OCR, the vision model's caption and its list of unlabelled controls, and a position for each.
// Billed on the ledger (reserve, then settle at what the calls cost); an out-of-credits or failed look returns null and the worker goes on with the text menu.
// → { caption, items, frame, nano } | null
export async function observeScreen(res, C, { ownerToken = null, tab = "", meta = {}, outline = "" } = {}) {
  const r = await C.browser("screenshot", { ocr: true }, ownerToken, tab);
  if (!r?.ok || !r.jpeg_base64 || !/^https?:/.test(String(r.url || ""))) return null;
  const bytes = Uint8Array.from(atob(r.jpeg_base64), (c) => c.charCodeAt(0)), frame = frameOf(bytes, r.view), L = res.ledger(), rid = `look:${crypto.randomUUID()}`;
  let ceiling = 0, held; try { ceiling = (await lookReserve(res.env)) * 2; held = await L.reserve(rid, ceiling); } catch { return null; }
  if (!held?.ok) return null;
  let nano = 0, out = null;
  try {
    const image = { data: bytes, mime: "image/jpeg" }, m = { ...meta, kind: "browser-look" };
    const v = await lookMoondream(res.env, m, image, { question: TARGET_QUESTION, find: "", width: frame.w, height: frame.h }); nano += v.nano;
    const targets = parseTargets(v.answer), found = [];
    if (targets.length) {
      let b64 = ""; for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const dataUrl = `data:image/jpeg;base64,${btoa(b64)}`;
      const rs = await Promise.allSettled(targets.map((t) => moondreamRun(res.env, m, { task: "point", image: dataUrl, target: t })));
      rs.forEach((x, i) => { nano += x.status === "fulfilled" ? x.value.nano : Math.ceil(Number(x.reason?.nano) || 0); if (x.status === "fulfilled") found.push({ what: targets[i], points: pointsToPixels(x.value.out?.points, { width: frame.w, height: frame.h }) }); });
    }
    const lines = r.ocr && typeof r.ocr === "object" && !r.ocr.error ? ocrLines(r.ocr) : [];
    out = { caption: v.description || "", items: [...pointClickItems(found, frame), ...ocrClickItems(lines, outline, frame)], frame };
  } catch { out = null; }
  nano = Math.max(0, Math.min(ceiling, Math.ceil(nano)));
  await L.settle(rid, nano).catch(() => {});
  return out ? { ...out, nano } : (nano ? { caption: "", items: [], frame, nano } : null);
}

// What is at a screen point, as the browser reads it in plain code (visible text, aria-label, value, title, of the element and its clickable
// ancestor; same-origin frames and open shadow roots followed). → { text } | { error }. An older browser service ignores the request and gives
// no probe, which counts as unreadable, so the click is not made.
export async function probePoint(C, { ownerToken = null, tab = "", x, y } = {}) {
  try {
    const r = await C.browser("screenshot", { probe_at: [x, y] }, ownerToken, tab), p = r?.probe;
    if (!r?.ok || !p || typeof p !== "object") return { error: "the browser could not read what is at that point" };
    if (p.error) return { error: String(p.error).slice(0, 100) };
    return { text: String(p.text ?? "").slice(0, 400) };
  } catch (e) { return { error: String(e?.message || e).slice(0, 100) }; }
}
// Put what the browser read at a worker's click_at point into the action, so the payment checks see it. Returns { acts } or { error }.
export async function checkClickAt(C, acts, opts) {
  const out = [];
  for (const a of acts) {
    if (a?.kind !== "click_at") { out.push(a); continue; }
    const p = await probePoint(C, { ...opts, x: a.x, y: a.y }); if (p.error) return { error: p.error };
    out.push({ ...a, pageText: p.text });
  }
  return { acts: out };
}
