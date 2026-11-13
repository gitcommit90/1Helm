// Pencil marks on a file open in the Zone (an HTML deck, a web page, a .docx, a PDF report or a generated image). The app sends them in the
// message's `annotations` field: { source, marked, marks: [...], zone: {...} }. `source` is the Library file, `marked` is a screenshot of what the person
// was looking at with the numbered marks drawn on it. Each mark is { n, color, note } and, from the Zone's Pencil, also
//   kind  "point" (a click) or "box" (a click and drag), unit (the slide or page number, 1 for a page or an image),
//   x, y, w, h  in the file's own pixels (a slide 1920 by 1080, a web page's CSS pixels from its top left, a PDF page's points, an image's pixels),
//   pct  { x, y, w, h } the same place as percent of the unit, el  the elements the HTML bridge found under it ({ slot, n, sel, tag, text, label }).
// zone is { kind, name, of, units: [{ unit, w, h }] }. Nothing here calls a model, so it works on every plan.
// cleanMark and cleanZone check and keep these fields (the route, and what the tracker stores with the message); marksNote writes the plain lines the helper reads.
const clip = (s, n) => String(s ?? "").slice(0, n);
const one = (s, n) => clip(String(s ?? "").replace(/\s+/g, " ").trim().replace(/"/g, "'"), n);
const finite = (v, lim = 1e7) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
const KINDS = ["image", "deck", "page", "report", "doc", "sheet"];
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;

// One element the bridge named. → clean object or null.
function cleanEl(e) {
  if (!e || typeof e !== "object") return null;
  const o = { tag: one(e.tag, 20).toLowerCase().replace(/[^a-z0-9]/g, "") };
  if (typeof e.slot === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(e.slot)) { o.slot = e.slot; if (Number.isInteger(e.n) && e.n >= 0 && e.n < 1000) o.n = e.n; }
  else if (typeof e.sel === "string" && /^\d{1,4}(\/\d{1,4}){0,40}$/.test(e.sel)) o.sel = e.sel;
  if (e.label) o.label = one(e.label, 60);
  o.text = one(e.text, 80);
  return o;
}
// The extra fields of a mark, when it has them. → { ok, extra } (ok false: the fields are there but wrong).
function cleanExtra(m) {
  if (m.kind == null && m.unit == null && m.x == null && m.pct == null && m.el == null) return { ok: true, extra: {} };
  if (m.kind !== "point" && m.kind !== "box") return { ok: false };
  if (!Number.isSafeInteger(m.unit) || m.unit < 1 || m.unit > 99999) return { ok: false };
  if (![m.x, m.y].every((v) => finite(v)) || (m.w != null && !finite(m.w)) || (m.h != null && !finite(m.h))) return { ok: false };
  const extra = { kind: m.kind, unit: m.unit, x: r1(m.x), y: r1(m.y), w: r1(m.w ?? 0), h: r1(m.h ?? 0) };
  if (m.pct != null) {
    const p = m.pct; if (typeof p !== "object" || ![p.x, p.y, p.w ?? 0, p.h ?? 0].every((v) => finite(v, 1000))) return { ok: false };
    extra.pct = { x: r2(p.x), y: r2(p.y), w: r2(p.w ?? 0), h: r2(p.h ?? 0) };
  }
  if (m.el != null) {
    if (!Array.isArray(m.el) || m.el.length > 6) return { ok: false };
    extra.el = m.el.map(cleanEl).filter(Boolean);
  }
  return { ok: true, extra };
}
// → the clean mark, or null when it is not valid. A mark with only n, color and note (the old image editor) stays exactly that.
export function cleanMark(m) {
  if (!m || typeof m !== "object" || !Number.isSafeInteger(m.n) || m.n < 1 || m.n > 99 || typeof m.color !== "string" || m.color.length > 24) return null;
  if (m.note != null && (typeof m.note !== "string" || m.note.length > 500)) return null;
  const x = cleanExtra(m); if (!x.ok) return null;
  return { n: m.n, color: m.color, note: m.note ?? "", ...x.extra };
}
// zone: undefined (none) → undefined; wrong → null; right → the clean object.
export function cleanZone(z) {
  if (z == null) return undefined;
  if (typeof z !== "object" || Array.isArray(z) || !KINDS.includes(z.kind)) return null;
  if (!Array.isArray(z.units) || z.units.length > 4) return null;
  const units = [];
  for (const u of z.units) { if (!u || !Number.isSafeInteger(u.unit) || u.unit < 1 || u.unit > 99999 || !finite(u.w) || !finite(u.h)) return null; units.push({ unit: u.unit, w: r1(u.w), h: r1(u.h) }); }
  const of = Number.isSafeInteger(z.of) && z.of >= 1 && z.of <= 99999 ? z.of : null;
  return { kind: z.kind, name: one(z.name, 200), of, units };
}
// What the tracker stores with the message: the same fields, as they arrived (cleaned), so the chat shows the marks again after a reload.
export function marksStored(a) {
  const id = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
  if (!a || typeof a !== "object" || !id(a.source) || !id(a.marked) || !Array.isArray(a.marks)) return null;
  const marks = a.marks.slice(0, 20).map(cleanMark).filter(Boolean);
  const z = cleanZone(a.zone);
  return { source: a.source, marked: a.marked, marks, ...(z ? { zone: z } : {}) };
}

// ---- the plain lines the helper reads ----
const unitWord = (kind) => (kind === "deck" ? "slide" : kind === "sheet" ? "sheet" : kind === "report" || kind === "doc" ? "page" : "");
const num = (v) => String(Math.round(Number(v) * 10) / 10).replace(/\.0$/, "");
const pn = (v) => String(Math.round(Number(v) * 100) / 100);
// Where one mark is: kind, slide or page, the pixels and the percent. e.g. "a point on slide 2 at x 640, y 312 (33.3% across, 28.9% down)".
export function markWhere(m, z) {
  if (!m || (m.kind !== "point" && m.kind !== "box")) return "";
  const uw = unitWord(z?.kind), on = uw ? ` on ${uw} ${m.unit}` : "", p = m.pct;
  if (m.kind === "point") return `a point${on} at x ${num(m.x)}, y ${num(m.y)}${p ? ` (${pn(p.x)}% across, ${pn(p.y)}% down)` : ""}`;
  return `a box${on} from x ${num(m.x)}, y ${num(m.y)}, ${num(m.w)} wide and ${num(m.h)} tall${p ? ` (${pn(p.x)}% across and ${pn(p.y)}% down, ${pn(p.w)}% wide and ${pn(p.h)}% tall)` : ""}`;
}
function elPhrase(e) {
  const what = e.label ? `the ${e.label}` : `a ${e.tag || "element"}`;
  const at = e.slot ? ` (data-slot "${e.slot}"${e.n ? `, number ${e.n + 1}` : ""})` : e.sel ? ` (path ${e.sel})` : "";
  return `${what}${at}${e.text ? `, reading "${e.text}"` : ""}`;
}
const spaceWord = { deck: "a slide is 1920 by 1080", page: "a web page's own pixels, from its top left corner", report: "a PDF page's own points (72 to an inch)", doc: "a page's own points (72 to an inch)", image: "the picture's own pixels", sheet: "the sheet's own pixels from its top left corner, at 100% zoom (the cells under each mark are named)" };
// The whole note for a send of marks on a Zone file. src: the Library file row (id, name); marked: the screenshot's row.
export function marksNote(an, src, marked) {
  const z = an.zone || {}, kind = z.kind || "page", of = z.of && unitWord(kind) ? `, ${z.of} ${unitWord(kind)}s` : "";
  const head = `The person marked up the file ${one(src?.name || z.name, 120)} (Library file ${src?.id || an.source}${of}) with the Pencil in the canvas. The picture that came with this message (file ${marked?.id || an.marked}) is a screenshot of what they were looking at, with each mark drawn and numbered on it. Each mark is a place to look at or change. Coordinates are in the file's own pixels from its top left corner (${spaceWord[kind] || "pixels"}) and as percent, so they do not depend on zoom or window size.`;
  const lines = (an.marks || []).slice(0, 20).map((m) => {
    const w = markWhere(m, z), note = String(m.note ?? "").trim();
    const els = (m.el || []).slice(0, 4).map(elPhrase);
    const under = els.length ? ` ${m.kind === "box" ? "Inside it" : "Under it"}: ${els.join("; ")}.` : "";
    return clip(`Mark ${m.n}${w ? `, ${w}` : ""}. ${note ? `Note: "${one(note, 500)}".` : "No note."}${under}`, 520);
  });
  return `${head}${lines.length ? `\n${lines.join("\n")}` : ""}`;
}
