// The text part of browser_screenshot look:true. The channel computer's browser server runs OCR (RapidOCR, PP-OCRv6 small) on the
// screenshot and returns ocr: { lines: [{ text, x, y, w, h, conf }], ms } in the CSS pixels click_at uses. An older image has no ocr
// field, so every function here treats a missing or failed OCR as "no text section".

export const OCR_TEXT_MAX = 6000;       // characters of "Text on screen"
export const OCR_POSITIONS_MAX = 2500;  // characters of "Text positions"
const LABEL_MAX = 40;                   // a line longer than this is a sentence, not a label to click
const FIND_MATCHES_MAX = 8;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Clean lines in reading order: rows top to bottom, lines inside a row left to right.
export function ocrLines(ocr) {
  const raw = Array.isArray(ocr?.lines) ? ocr.lines : [];
  const lines = [];
  for (const l of raw.slice(0, 500)) {
    const text = String(l?.text ?? "").replace(/\s+/g, " ").trim(), x = num(l?.x), y = num(l?.y), w = num(l?.w), h = num(l?.h);
    if (!text || x === null || y === null || w === null || h === null) continue;
    lines.push({ text: text.slice(0, 300), x, y, w, h, cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) });
  }
  lines.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const l of lines) { const r = rows.at(-1); if (r && Math.abs(l.cy - r.cy) <= Math.min(l.h, r.items[0].h) / 2) { r.items.push(l); r.cy = (r.cy * (r.items.length - 1) + l.cy) / r.items.length; } else rows.push({ cy: l.cy, items: [l] }); }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}

// Lines of the same row go on one output line, separated by three spaces.
export function textOnScreen(lines, max = OCR_TEXT_MAX) {
  const out = []; let row = [], cy = null;
  for (const l of lines) { if (row.length && Math.abs(l.cy - cy) > Math.min(l.h, row.at(-1).h) / 2) { out.push(row.map((x) => x.text).join("   ")); row = []; } row.push(l); cy = l.cy; }
  if (row.length) out.push(row.map((x) => x.text).join("   "));
  let s = out.join("\n");
  if (s.length > max) s = s.slice(0, max).replace(/\n[^\n]*$/, "") + "\n(more text on screen was cut)";
  return s;
}

// Short lines (buttons, links, labels) with the centre point click_at can take.
export function textPositions(lines, max = OCR_POSITIONS_MAX) {
  const out = []; let n = 0;
  for (const l of lines) {
    if (l.text.length > LABEL_MAX) continue;
    const s = `"${l.text}" (${l.cx}, ${l.cy})`;
    if (n + s.length + 1 > max) { out.push("(more positions cut)"); break; }
    out.push(s); n += s.length + 1;
  }
  return out.join("\n");
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const squash = (s) => norm(s).replace(/ /g, "");
// OCR lines that contain the phrase → [{ text, x, y }]. When the phrase is only part of a line (two buttons read as one line), the
// point is where that part sits along the line, found by character position; a whole-line match gives the line's centre.
export function findInOcr(lines, phrase) {
  const want = squash(phrase); if (!want) return [];
  const hits = [];
  for (const l of lines) {
    const hay = squash(l.text), i = hay.indexOf(want); if (i < 0) continue;
    const frac = hay.length ? (i + want.length / 2) / hay.length : 0.5;
    hits.push({ text: l.text, x: Math.round(l.x + l.w * frac), y: l.cy, whole: hay.length === want.length, len: hay.length });
  }
  hits.sort((a, b) => a.len - b.len || a.y - b.y || a.x - b.x);   // a line that is the phrase first
  return hits.slice(0, FIND_MATCHES_MAX);
}

// The page position, so a look that misses something says the page is longer than the picture. view = the browser's { h, scroll_y, page_h }.
export function pagePosition(view) {
  const h = num(view?.h), y = num(view?.scroll_y), total = num(view?.page_h);
  if (h === null || y === null || total === null || total <= 0) return null;
  const top = Math.max(0, Math.round(y)), bottom = Math.min(Math.round(total), Math.round(y + h)), above = top, below = Math.max(0, Math.round(total) - bottom);
  return { top, bottom, total: Math.round(total), above, below, more: above > 20 || below > 20 };
}
export function pageLine(pos) {
  if (!pos) return "";
  if (!pos.more) return `Page position: the whole page (${pos.total} px tall) is in view.`;
  const dir = [pos.above > 20 ? `${pos.above} px above (scroll up)` : "", pos.below > 20 ? `${pos.below} px below (scroll down)` : ""].filter(Boolean).join(" and ");
  return `Page position: this look shows y=${pos.top} to ${pos.bottom} of a ${pos.total} px tall page. There is more page ${dir}; what you are looking for may be out of view. Use browser_act scroll, then look again.`;
}
