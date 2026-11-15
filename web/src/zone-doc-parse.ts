// Reading a .docx for the editable view, with the browser's own DOMParser: the body's paragraphs in document order (the numbering the server uses), their runs, headings by
// paragraph style, lists by numbering, tables as cells that hold paragraphs, and pictures as pictures. What the view can't edit safely (the rule below is the same one the server
// applies: 1HC src/zone-docx.js protectedWhy) stays as plain text and is never sent back.
import { zipEntries, zipRead, type ZEntry } from "./zone-doc-zip";
import { RPR_NAMES, kidsOf, tidy, type Dflt, type Doc, type Flag, type Para, type PView, type Run } from "./zone-doc-model";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", MC = "http://schemas.openxmlformats.org/markup-compatibility/2006", A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", VML = "urn:schemas-microsoft-com:vml";
export const DOCX_MAX = 25 * 1024 * 1024, XML_CAP = 40 * 1024 * 1024, IMG_CAP = 12 * 1024 * 1024, IMG_TOTAL = 48 * 1024 * 1024;

type Props = Record<string, Record<string, string>>;
export type TableInfo = { id: number; parent: number; cols: number[]; rows: { ct: number; span: number }[][] };
export type Parsed = {
  doc: Doc; base: Para[]; tables: TableInfo[]; page: { w: number; ml: number; mr: number; mt: number; mb: number };
  look: (p: Para, rpr: string) => string; paraCss: (p: Para) => string; dflt: Dflt; markers: (paras: Para[]) => string[]; font: string; baseCss: string; urls: string[];
  notes: { protectedParas: number };
};

const kids = (el: Element | null | undefined, name: string): Element[] => (el ? [...el.children].filter(c => c.namespaceURI === W && c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] || null;
const wa = (el: Element | null | undefined, name = "val") => (el ? el.getAttributeNS(W, name) ?? el.getAttribute("w:" + name) : null);
const off = (v: string | null | undefined) => v === "0" || v === "false" || v === "off";
const num = (v: string | null | undefined, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const tw = (v: string | null | undefined) => num(v) / 15;   // twips to CSS pixels (1/20 point, 96 pixels to 72 points)

const BOX = new Set(["body", "tbl", "tr", "tc", "document"]);
const ATTR_NAME = /^[A-Za-z_][\w.:-]*$/, ATTR_VAL = /^[^"<>&]*$/;
/** A run's w:rPr as the text the server accepts back (each child as <name attrs/>), or null when it holds anything else. */
export function rprOf(el: Element | null | undefined): string | null {
  if (!el) return "";
  let out = "";
  for (const k of el.children) {
    if (!(k.namespaceURI === W ? RPR_NAMES.has(k.tagName) : /^w14:[A-Za-z]+$/.test(k.tagName)) || k.children.length) return null;
    for (const n of k.childNodes) if (n.nodeType !== 8 && !(n.nodeType === 3 && !(n.nodeValue || "").trim())) return null;
    let at = ""; for (const a of k.attributes) { if (!ATTR_NAME.test(a.name) || !ATTR_VAL.test(a.value)) return null; at += ` ${a.name}="${a.value}"`; }
    out += `<${k.tagName}${at}/>`;
  }
  return out;
}
const TRACKED = /^(ins|del|moveFrom|moveTo)$/;
/** "" when the paragraph can be edited, else why not. */
export function protectedWhy(p: Element): string {
  for (let a = p.parentElement; a; a = a.parentElement) if (a.namespaceURI !== W || !BOX.has(a.localName)) return "inside " + a.tagName;
  for (const k of p.children) {
    if (k.namespaceURI === W && k.localName === "pPr") { for (const x of k.children) { if (x.localName === "sectPr" || x.localName === "pPrChange") return "a change"; if (x.localName === "rPr") for (const y of x.children) if (TRACKED.test(y.localName)) return "a tracked change"; } continue; }
    if (k.namespaceURI !== W) return "holds " + k.tagName;
    if (k.localName === "bookmarkStart" || k.localName === "bookmarkEnd" || k.localName === "proofErr") continue;
    if (k.localName !== "r") return "holds " + k.tagName;
    for (const x of k.children) {
      if (x.namespaceURI !== W) return "holds " + x.tagName;
      if (x.localName === "rPr") { if (rprOf(x) === null) return "formatting"; continue; }
      if (x.localName === "t" || x.localName === "tab" || x.localName === "lastRenderedPageBreak") continue;
      if (x.localName === "br" && !/^(page|column)$/.test(wa(x, "type") || "")) continue;
      return "holds " + x.tagName;
    }
  }
  return "";
}
const inFallback = (e: Element) => { for (let a: Element | null = e; a; a = a.parentElement) if (a.namespaceURI === MC && a.localName === "Fallback") return true; return false; };
export const bodyParas = (root: Element) => [...root.getElementsByTagNameNS(W, "p")].filter(p => !inFallback(p));

// ---- styles and numbering ----
type Style = { id: string; name: string; type: string; basedOn: string; p: Element | null; r: Element | null };
const propsOf = (el: Element | null | undefined): Props => { const o: Props = {}; if (!el) return o; for (const k of el.children) { const a: Record<string, string> = {}; for (const x of k.attributes) a[x.localName] = x.value; o[k.localName] = a; } return o; };
const merge = (...ps: Props[]): Props => Object.assign({}, ...ps);
const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
export function fmtNum(n: number, fmt: string): string {
  if (fmt === "decimalZero") return (n < 10 ? "0" : "") + n;
  if (fmt === "lowerLetter" || fmt === "upperLetter") { let s = "", x = n; while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); } return fmt === "upperLetter" ? s.toUpperCase() : s; }
  if (fmt === "lowerRoman" || fmt === "upperRoman") { let s = "", x = n; for (const [v, r] of ROMAN) while (x >= v) { s += r; x -= v; } return fmt === "upperRoman" ? s.toUpperCase() : s; }
  if (fmt === "none") return "";
  return String(n);
}
const HILITE: Record<string, string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const FONTS: [RegExp, string][] = [[/times|georgia|cambria|garamond|palatino|book|serif$/i, "serif"], [/courier|consolas|mono|menlo/i, "monospace"]];
const fontCss = (n: string) => { const g = FONTS.find(([re]) => re.test(n))?.[1] || "sans-serif"; return `"${n.replace(/["\\<>]/g, "")}",${g}`; };

/** The CSS of run properties (bold, italic, underline, size, colour, and so on). */
export function runCss(p: Props, base: string): string {
  const on = (k: string) => !!p[k] && !off(p[k].val), s: string[] = [];
  if (on("b")) s.push("font-weight:700"); if (on("i")) s.push("font-style:italic");
  const dec: string[] = []; if (p.u && p.u.val !== "none") dec.push("underline"); if (on("strike") || on("dstrike")) dec.push("line-through"); if (dec.length) s.push("text-decoration:" + dec.join(" "));
  if (p.sz?.val) s.push(`font-size:${(num(p.sz.val) / 2 * 96 / 72).toFixed(2)}px`);
  if (p.color?.val && p.color.val !== "auto" && /^[0-9a-f]{6}$/i.test(p.color.val)) s.push("color:#" + p.color.val);
  if (p.highlight?.val && HILITE[p.highlight.val]) s.push("background:" + HILITE[p.highlight.val]);
  if (p.vertAlign?.val === "superscript") s.push("vertical-align:super;font-size:.75em"); else if (p.vertAlign?.val === "subscript") s.push("vertical-align:sub;font-size:.75em");
  if (on("caps")) s.push("text-transform:uppercase"); if (on("smallCaps")) s.push("font-variant:small-caps"); if (on("vanish")) s.push("display:none");
  const f = p.rFonts?.ascii || p.rFonts?.hAnsi; if (f && f !== base) s.push("font-family:" + fontCss(f));
  return s.join(";");
}

export async function parseDocx(buf: ArrayBuffer, hold: { urls: string[] }): Promise<Parsed> {
  if (buf.byteLength > DOCX_MAX) throw new Error("That document is too big to edit here.");
  const ents = zipEntries(buf), byName = new Map<string, ZEntry>(ents.map(e => [e.name, e]));
  const text = async (n: string, must = false) => { const e = byName.get(n); if (!e) { if (must) throw new Error("That isn't a Word document."); return ""; } return new TextDecoder().decode(await zipRead(e, XML_CAP)); };
  const xml = (s: string) => { const d = new DOMParser().parseFromString(s, "application/xml"); if (d.getElementsByTagName("parsererror").length) throw new Error("That document's text can't be read."); return d; };
  const dom = xml(await text("word/document.xml", true)), styles = xml((await text("word/styles.xml")) || `<w:styles xmlns:w="${W}"/>`), numbering = xml((await text("word/numbering.xml")) || `<w:numbering xmlns:w="${W}"/>`);
  const rels = new Map<string, string>(); { const rt = await text("word/_rels/document.xml.rels"); if (rt) for (const r of xml(rt).documentElement.children) { const id = r.getAttribute("Id"), t = r.getAttribute("Target"); if (id && t) rels.set(id, t); } }
  const root = dom.documentElement, body = kid(root, "body"); if (root.tagName !== "w:document" || !body) throw new Error("That isn't a Word document the Zone can edit.");

  // styles
  const S = new Map<string, Style>(); for (const s of kids(styles.documentElement, "style")) { const id = wa(s, "styleId"); if (id) S.set(id, { id, name: wa(kid(s, "name")) || "", type: wa(s, "type") || "", basedOn: wa(kid(s, "basedOn")) || "", p: kid(s, "pPr"), r: kid(s, "rPr") }); }
  const dd = kid(styles.documentElement, "docDefaults"), ddR = propsOf(kid(kid(dd, "rPrDefault"), "rPr")), ddP = propsOf(kid(kid(dd, "pPrDefault"), "pPr"));
  const chain = (id: string) => { const out: Style[] = []; for (let s = S.get(id), n = 0; s && n < 12; s = S.get(s.basedOn), n++) out.unshift(s); return out; };
  const styleR = (id: string) => merge(...chain(id).map(s => propsOf(s.r))), styleP = (id: string) => merge(...chain(id).map(s => propsOf(s.p)));
  const baseFont = ddR.rFonts?.ascii || ddR.rFonts?.hAnsi || "", baseSz = ddR.sz?.val ? num(ddR.sz.val) / 2 * 96 / 72 : 14.67;
  const headOf = (id: string) => { const c = chain(id); for (const s of c.reverse()) { const m = /^heading\s*(\d)$/i.exec(s.name) || /^Heading(\d)$/i.exec(s.id); if (m) return +m[1]; if (/^title$/i.test(s.name)) return 1; } return 0; };
  const HEADSZ = [0, 32, 26, 24, 22, 22, 22, 22, 22, 22];

  // numbering
  type Lvl = { fmt: string; text: string; start: number; left: number; hang: number };
  const abs = new Map<string, Lvl[]>(), nums = new Map<string, { abs: string; start: Map<number, number> }>();
  for (const a of kids(numbering.documentElement, "abstractNum")) { const l: Lvl[] = []; for (const v of kids(a, "lvl")) { const ind = kid(kid(v, "pPr"), "ind"); l[num(wa(v, "ilvl"))] = { fmt: wa(kid(v, "numFmt")) || "decimal", text: wa(kid(v, "lvlText")) || "", start: num(wa(kid(v, "start")), 1), left: tw(wa(ind, "left") || wa(ind, "start")), hang: tw(wa(ind, "hanging")) }; } abs.set(wa(a, "abstractNumId") || "", l); }
  for (const n of kids(numbering.documentElement, "num")) { const st = new Map<number, number>(); for (const o of kids(n, "lvlOverride")) { const s = kid(o, "startOverride"); if (s) st.set(num(wa(o, "ilvl")), num(wa(s))); } nums.set(wa(n, "numId") || "", { abs: wa(kid(n, "abstractNumId")) || "", start: st }); }

  // pictures
  let imgBytes = 0;
  const imgUrl = async (id: string | null): Promise<string> => {
    const t = id ? rels.get(id) : ""; if (!t) return ""; const name = t.startsWith("/") ? t.slice(1) : "word/" + t.replace(/^\.\//, ""), ext = name.split(".").pop()!.toLowerCase(), mime = MIME[ext], e = byName.get(name);
    if (!mime || !e || e.usize > IMG_CAP || imgBytes + e.usize > IMG_TOTAL) return ""; imgBytes += e.usize;
    try { const u = URL.createObjectURL(new Blob([await zipRead(e, IMG_CAP) as BlobPart], { type: mime })); hold.urls.push(u); return u; } catch { return ""; }
  };

  // the paragraphs, in document order, with the table cells around them
  const all = bodyParas(root), paras: Para[] = [], tables: TableInfo[] = []; let ct = 0, nextPid = 0, nextCell = 1;
  const view = (p: Element): PView => {
    const pPr = kid(p, "pPr"), sid = wa(kid(pPr, "pStyle")) || "", sp = styleP(sid), dp = propsOf(pPr), eff = merge(ddP, sp, dp);
    let numPr = kid(pPr, "numPr"), numId = wa(kid(numPr, "numId")), ilvl = num(wa(kid(numPr, "ilvl")));
    if (!numPr) { for (const s of chain(sid).reverse()) { const n = kid(kid(s.p, "numPr"), "numId"); if (n) { numId = wa(n); ilvl = num(wa(kid(kid(s.p, "numPr"), "ilvl"))); break; } } }
    const list = numId && numId !== "0" && nums.has(numId) ? { id: numId, lvl: Math.max(0, Math.min(8, ilvl)) } : null, lv = list ? abs.get(nums.get(list.id)!.abs)?.[list.lvl] : null;
    const ind = eff.ind || {}, sps = eff.spacing || {}, left = ind.left != null || ind.start != null ? tw(ind.left ?? ind.start) : lv ? lv.left : 0;
    const first = ind.hanging != null ? -tw(ind.hanging) : ind.firstLine != null ? tw(ind.firstLine) : lv ? -lv.hang : 0;
    const line = sps.line && (!sps.lineRule || sps.lineRule === "auto") ? num(sps.line) / 240 : 0;
    return { head: headOf(sid), list, jc: eff.jc?.val || "", ind: left, first, before: sps.before != null ? tw(sps.before) : 0, after: sps.after != null ? tw(sps.after) : 8, style: sid, line };
  };
  const walkProt = async (el: Element, out: { t: string; r: string; img?: string; w?: number; h?: number }[], ex: { w: number; h: number }) => {
    for (const k of el.children) {
      if (k.namespaceURI === MC && k.localName === "Fallback") continue;
      if (k.namespaceURI === WP && k.localName === "extent") { ex.w = num(k.getAttribute("cx")) / 9525; ex.h = num(k.getAttribute("cy")) / 9525; continue; }
      if (k.namespaceURI === A && k.localName === "blip") { const u = await imgUrl(k.getAttributeNS(R, "embed")); out.push({ t: u ? "" : "[picture]", r: "", ...(u ? { img: u, w: ex.w, h: ex.h } : {}) }); continue; }
      if (k.namespaceURI === VML && k.localName === "imagedata") { const u = await imgUrl(k.getAttributeNS(R, "id")); out.push({ t: u ? "" : "[picture]", r: "", ...(u ? { img: u } : {}) }); continue; }
      if (k.namespaceURI !== W) { await walkProt(k, out, ex); continue; }
      const n = k.localName;
      if (n === "pPr" || n === "del" || n === "instrText" || n === "delText" || n === "rPr" || n === "sectPr") continue;
      if (n === "t") { out.push({ t: k.textContent || "", r: curRpr }); continue; }
      if (n === "tab" || n === "ptab") { out.push({ t: "\t", r: curRpr }); continue; }
      if (n === "br" || n === "cr") { out.push({ t: "\n", r: curRpr }); continue; }
      if (n === "r") { const prev = curRpr; curRpr = rprOf(kid(k, "rPr")) ?? ""; await walkProt(k, out, ex); curRpr = prev; continue; }
      if (n === "p" && out.length) out.push({ t: "\n", r: "" });
      await walkProt(k, out, ex);
    }
  };
  let curRpr = "";
  const addPara = async (p: Element, nested: boolean) => {
    const why = nested ? "inside" : protectedWhy(p), prot = !!why, v = view(p);
    if (!prot) {
      const runs: Run[] = []; let caret = "";
      for (const r of kids(p, "r")) { const rpr = rprOf(kid(r, "rPr")) ?? ""; caret = rpr; let t = ""; for (const x of r.children) { if (x.localName === "t") t += x.textContent || ""; else if (x.localName === "tab") t += "\t"; else if (x.localName === "br") t += "\n"; } if (t) runs.push({ t, r: rpr }); }
      paras.push({ pid: nextPid++, orig: paras.length, runs: tidy(runs), caret, prot: false, nested: false, ct, v, plain: "", imgs: [] }); return;
    }
    const pr: { t: string; r: string; img?: string }[] = []; curRpr = ""; if (!nested) await walkProt(p, pr, { w: 0, h: 0 });
    paras.push({ pid: nextPid++, orig: paras.length, runs: [], caret: "", prot: true, nested, ct, v, plain: pr.map(x => x.t).join(""), imgs: pr.filter(x => x.img).map(x => x.img!), protRuns: pr });
  };
  const walk = async (el: Element) => {
    for (const k of el.children) {
      if (k.namespaceURI === MC && k.localName === "Fallback") continue;
      if (k.namespaceURI === W && k.localName === "p") {
        await addPara(k, false);
        for (const q of bodyParas(k)) if (q !== k) await addPara(q, true);   // a text box's own paragraphs: numbered, drawn inside this one
      } else if (k.namespaceURI === W && k.localName === "tbl") {
        const grid = kids(kid(k, "tblGrid"), "gridCol").map(g => tw(wa(g, "w"))), t: TableInfo = { id: tables.length, parent: ct, cols: grid, rows: [] }; tables.push(t); const outer = ct;
        for (const tr of kids(k, "tr")) { const row: { ct: number; span: number }[] = []; t.rows.push(row); for (const tc of kids(tr, "tc")) { ct = nextCell++; row.push({ ct, span: Math.max(1, num(wa(kid(kid(tc, "tcPr"), "gridSpan")), 1)) }); await walk(tc); } }
        ct = outer;
      } else if (k.namespaceURI !== W || !["pPr", "sectPr", "tblPr", "trPr", "tcPr", "tblGrid"].includes(k.localName)) await walk(k);
    }
  };
  await walk(body);
  if (paras.length !== all.length) throw new Error("That document's paragraphs can't be matched.");
  const sect = [...body.getElementsByTagNameNS(W, "sectPr")].filter(s => s.parentElement === body).pop(), pgSz = kid(sect, "pgSz"), pgMar = kid(sect, "pgMar");
  const page = { w: pgSz ? tw(wa(pgSz, "w")) : 816, ml: pgMar ? tw(wa(pgMar, "left")) : 96, mr: pgMar ? tw(wa(pgMar, "right")) : 96, mt: pgMar ? tw(wa(pgMar, "top")) : 96, mb: pgMar ? tw(wa(pgMar, "bottom")) : 96 };
  const base = paras.map(p => ({ ...p }));

  // looks
  const cache = new Map<string, string>(), effStyle = (p: Para): Props => { const hs = p.v.head, sty = merge(ddR, styleR(p.v.style)); if (hs > 0) { if (!sty.b) sty.b = {}; if (!sty.sz) sty.sz = { val: String(HEADSZ[Math.min(9, hs)]) }; } return sty; };
  const look = (p: Para, rpr: string) => { const key = p.v.style + "|" + p.v.head + "|" + rpr; let c = cache.get(key); if (c == null) { const rs = kidsOf(rpr), props: Props = {}; for (const k of rs) { const a: Record<string, string> = {}; for (const m of k.raw.matchAll(/([A-Za-z_][\w.:-]*)="([^"]*)"/g)) a[m[1].replace(/^.*:/, "")] = m[2]; props[k.name.replace(/^.*:/, "")] = a; } const rsid = props.rStyle?.val; c = runCss(merge(effStyle(p), rsid ? styleR(rsid) : {}, props), baseFont); cache.set(key, c); } return c; };
  const dflt: Dflt = (p, f: Flag) => { const s = effStyle(p), k = f === "b" ? s.b : f === "i" ? s.i : s.u; return f === "u" ? !!k && k.val !== "none" : !!k && !off(k.val); };
  const paraCss = (p: Para) => { const v = p.v, s: string[] = []; if (v.jc) s.push("text-align:" + ({ both: "justify", center: "center", right: "right", end: "right", left: "left", start: "left" } as Record<string, string>)[v.jc]); if (v.ind) s.push(`margin-left:${v.ind.toFixed(1)}px`); if (v.first) s.push(`text-indent:${v.first.toFixed(1)}px`); s.push(`margin-top:${v.before.toFixed(1)}px;margin-bottom:${v.after.toFixed(1)}px`); if (v.line) s.push(`line-height:${v.line.toFixed(3)}`); return s.join(";"); };
  const markers = (ps: Para[]): string[] => {
    const cnt = new Map<string, number[]>(), out: string[] = [];
    for (const p of ps) {
      const l = p.v.list; if (!l || p.nested) { out.push(""); continue; }
      const lv = abs.get(nums.get(l.id)!.abs) || [], def = lv[l.lvl], c = cnt.get(l.id) || [];
      if (!def) { out.push(""); continue; }
      if (def.fmt === "bullet") { const ch = def.text; out.push(!ch || /[\uF000-\uF0FF]/.test(ch) || ch === "o" ? (["•", "◦", "▪"][Math.min(2, l.lvl)]) : ch === "§" ? "▪" : ch); continue; }
      c[l.lvl] = (c[l.lvl] === undefined ? (nums.get(l.id)!.start.get(l.lvl) ?? def.start) : c[l.lvl] + 1); for (let k = l.lvl + 1; k < 9; k++) c[k] = undefined as any; cnt.set(l.id, c);
      out.push(def.text.replace(/%(\d)/g, (_x, n) => { const i = +n - 1, d2 = lv[i]; return fmtNum(c[i] ?? (d2?.start ?? 1), d2?.fmt || "decimal"); }) || fmtNum(c[l.lvl], def.fmt));
    }
    return out;
  };
  const font = baseFont ? fontCss(baseFont) : "";
  return { doc: { paras, nextPid }, base, tables, page, look, paraCss, dflt, markers, font, urls: hold.urls, baseCss: `font-size:${baseSz.toFixed(2)}px`, notes: { protectedParas: paras.filter(p => p.prot && !p.nested).length } };
}
