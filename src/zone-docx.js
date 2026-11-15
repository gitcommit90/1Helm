// Zone: direct text edits of a Word document (.docx) in the Worker, with no model and no converter. A .docx is a zip file, and its body is
// the text of one part, word/document.xml. Changing a paragraph needs only two small things: a zip reader and writer (below, about 100
// lines, using the platform's own deflate streams) and a text edit of that one XML part. Every other part of the zip is copied as it is,
// byte for byte (still compressed), so styles, pictures, headers, footers, numbering and comments cannot be disturbed.
//
// The person double-clicks a paragraph on the page picture (the app's Word-to-PDF preview), so the app knows the paragraph's text as the
// PDF shows it, not its place in the XML. The server finds the paragraph by that text (and which occurrence of it, n), then changes only the
// characters that differ between the old and the new text, inside the text runs they were in, so each run keeps its own formatting.
// Everything is plain string work on text that is never executed; new text is escaped as XML.
import { ZoneError } from "./zone-edit.js";

const bad = (m, status = 400) => { throw new ZoneError(status, m); };
export const DOCX_MAX = 25 * 1024 * 1024;     // a document bigger than this is not edited here
export const XML_MAX = 40 * 1024 * 1024;      // word/document.xml after inflating (a zip bomb stops here)
export const TEXT_MAX = 5000;
export const PART = "word/document.xml";

// ---- zip ----
const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
let CRC; const crc32 = (b) => { if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const dec = new TextDecoder("utf-8", { fatal: false }), enc = new TextEncoder();
export function readZip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 22 || b.length > DOCX_MAX) bad("That document is too big to edit here.", 413);
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { e = i; break; }
  if (e < 0) bad("That file isn't a Word document the Zone can edit.", 415);
  const n = u16(b, e + 10), cdSize = u32(b, e + 12), cdOff = u32(b, e + 16);
  if (n === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff || cdOff + cdSize > b.length) bad("That file isn't a Word document the Zone can edit.", 415);
  const out = []; let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) bad("That file isn't a Word document the Zone can edit.", 415);
    const nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), lho = u32(b, p + 42);
    if (lho + 30 > b.length || u32(b, lho) !== 0x04034b50) bad("That file isn't a Word document the Zone can edit.", 415);
    const ldata = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28), csize = u32(b, p + 20);
    if (ldata + csize > b.length) bad("That file isn't a Word document the Zone can edit.", 415);
    const flags = u16(b, p + 8); if (flags & 1) bad("An encrypted document can't be edited here.", 415);
    out.push({ name: dec.decode(b.subarray(p + 46, p + 46 + nl)), made: u16(b, p + 4), flags: flags & 0x0800, method: u16(b, p + 10), time: u16(b, p + 12), date: u16(b, p + 14), crc: u32(b, p + 16), csize, usize: u32(b, p + 24), iattr: u16(b, p + 36), eattr: u32(b, p + 38), raw: b.subarray(ldata, ldata + csize) });
    p += 46 + nl + el + cl;
  }
  return out;
}
async function pipe(bytes, stream, cap) {
  const w = stream.writable.getWriter(); const wr = w.write(bytes).then(() => w.close()); wr.catch(() => {});
  const rd = stream.readable.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (cap && n > cap) { try { await rd.cancel(); } catch {} bad("That document is too big to edit here.", 413); } parts.push(value); }
  await wr.catch(() => {});
  const o = new Uint8Array(n); let k = 0; for (const x of parts) { o.set(x, k); k += x.length; } return o;
}
export async function entryBytes(en, cap = XML_MAX) {
  if (en.method === 0) return en.raw.slice();
  if (en.method !== 8) bad("That document uses a compression the Zone can't read.", 415);
  if (en.usize > cap) bad("That document is too big to edit here.", 413);
  const o = await pipe(en.raw, new DecompressionStream("deflate-raw"), cap);
  if (o.length !== en.usize || crc32(o) !== en.crc) bad("That document is damaged.", 415);
  return o;
}
// A new entry for a part: deflated when that is smaller, else stored.
export async function newEntry(old, bytes) {
  let method = 8, raw; try { raw = await pipe(bytes, new CompressionStream("deflate-raw")); } catch { raw = null; }
  if (!raw || raw.length >= bytes.length) { method = 0; raw = bytes; }
  return { ...old, method, crc: crc32(bytes), csize: raw.length, usize: bytes.length, raw };
}
export function writeZip(entries) {
  const names = entries.map((e) => enc.encode(e.name)); let size = 22; entries.forEach((e, i) => { size += 30 + names[i].length + e.raw.length + 46 + names[i].length; });
  const o = new Uint8Array(size), dv = new DataView(o.buffer); let p = 0; const offs = [];
  const w16 = (v) => { dv.setUint16(p, v, true); p += 2; }, w32 = (v) => { dv.setUint32(p, v >>> 0, true); p += 4; };
  entries.forEach((e, i) => { offs.push(p); w32(0x04034b50); w16(20); w16(e.flags); w16(e.method); w16(e.time); w16(e.date); w32(e.crc); w32(e.csize); w32(e.usize); w16(names[i].length); w16(0); o.set(names[i], p); p += names[i].length; o.set(e.raw, p); p += e.raw.length; });
  const cd = p;
  entries.forEach((e, i) => { w32(0x02014b50); w16(e.made || 20); w16(20); w16(e.flags); w16(e.method); w16(e.time); w16(e.date); w32(e.crc); w32(e.csize); w32(e.usize); w16(names[i].length); w16(0); w16(0); w16(0); w16(e.iattr || 0); w32(e.eattr || 0); w32(offs[i]); o.set(names[i], p); p += names[i].length; });
  const cdSize = p - cd;
  w32(0x06054b50); w16(0); w16(0); w16(entries.length); w16(entries.length); w32(cdSize); w32(cd); w16(0);
  return o;
}

// ---- document.xml: paragraphs and their text pieces ----
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unesc = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => { if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); try { return String.fromCodePoint(n); } catch { return m; } } return ENT[e.toLowerCase()] ?? m; });
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// → [{ ts: [{ os, oe, cs, ce, text }], units: [{ ch, el, i } | { ch: "\t" | "\n" | "-", fixed: true }], text }] in document order.
// A paragraph's own text only (a text box's paragraphs are their own paragraphs); the second copy of a text box that Word keeps for old
// readers (mc:Fallback) is skipped, so a paragraph is listed once, as it is drawn. Only text inside a run (w:r) counts: w:tab inside a
// paragraph's tab-stop list is not a tab character.
export function paragraphs(xml) {
  const stack = [], paras = [], pst = []; let fb = 0, cur = null, m; TAG.lastIndex = 0;
  while ((m = TAG.exec(xml))) {
    if (!m[2]) continue;
    const name = m[2], close = m[1] === "/", self = m[4] === "/";
    if (close) {
      let k = stack.length - 1; while (k >= 0 && stack[k].name !== name) k--;
      if (k < 0) continue;
      const n = stack[k]; stack.length = k;
      if (name === "mc:Fallback") fb--;
      else if (name === "w:p") { pst.pop(); cur = pst[pst.length - 1] || null; }
      else if (name === "w:t" && n.t) { n.t.ce = m.index; n.t.text = unesc(xml.slice(n.t.cs, n.t.ce)); }
      continue;
    }
    if (name === "w:p" && !self) { const pr = { ts: [], parts: [], skip: fb > 0 }; if (!pr.skip) paras.push(pr); pst.push(pr); cur = pr; }
    else if (name === "mc:Fallback" && !self) fb++;
    let t = null;
    if (cur && !cur.skip && stack.some((s) => s.name === "w:r" && s.p === cur)) {
      if (name === "w:t" && !self) { t = { os: m.index, oe: m.index + m[0].length, cs: m.index + m[0].length, ce: -1, text: "" }; cur.ts.push(t); cur.parts.push({ t }); }
      else if (name === "w:tab") cur.parts.push({ fixed: "\t" });
      else if (name === "w:cr") cur.parts.push({ fixed: "\n" });
      else if (name === "w:br" && !/w:type\s*=\s*["'](page|column)["']/.test(m[3])) cur.parts.push({ fixed: "\n" });
      else if (name === "w:noBreakHyphen") cur.parts.push({ fixed: "-" });
    }
    if (!self) stack.push({ name, p: cur, t });
  }
  return paras.filter((p) => p.ts.every((t) => t.ce >= 0)).map((p) => {
    const units = [];
    for (const x of p.parts) { if (x.fixed) units.push({ ch: x.fixed, fixed: true }); else for (let i = 0; i < x.t.text.length; i++) units.push({ ch: x.t.text[i], el: x.t, i }); }
    return { ts: p.ts, units, text: units.map((u) => u.ch).join("") };
  });
}

// ---- finding the paragraph the person means ----
const WS = /\s/, ALNUM = /[\p{L}\p{N}]/u;
const collapse = (s) => String(s).replace(/\s+/g, " ").trim();
const keyOf = (s) => { let k = ""; for (const ch of String(s).normalize("NFKC")) if (ALNUM.test(ch)) k += ch; return k; };
// A leading list marker (a bullet or a number) that the page shows but the text itself does not hold.
const MARKER = /^\s*(?:[•◦▪■●○–—·*\-]|\(?\d{1,3}[.)]|\(?[A-Za-z][.)])\s+/;
// → { p, from, to, units } : the paragraph, and which collapsed characters the person's text covers
export function findParagraph(paras, was, n = null) {
  const w0 = collapse(was); if (!keyOf(w0)) bad("Select the text again.");
  const cols = paras.map((p) => collapseUnits(p.units)), hits = [];
  const tryWith = (w) => {
    const wk = keyOf(w), out = [];
    cols.forEach((c, i) => { if (c.text === w) out.push({ i, from: 0, to: c.text.length, rank: 0 }); });
    if (!out.length) cols.forEach((c, i) => { if (keyOf(c.text) === wk) out.push({ i, from: 0, to: c.text.length, rank: 1 }); });
    if (!out.length) cols.forEach((c, i) => { let at = -1; while ((at = c.text.indexOf(w, at + 1)) >= 0) out.push({ i, from: at, to: at + w.length, rank: 2 }); });
    if (!out.length && wk.length >= 3) cols.forEach((c, i) => { const ks = c.keys.map((x) => x.k).join(""); let at = -1; while ((at = ks.indexOf(wk, at + 1)) >= 0) out.push({ i, from: c.keys[at].c, to: c.keys[at + wk.length - 1].c + 1, rank: 3 }); });
    return out;
  };
  let marker = "", found = []; const mm = w0.match(MARKER);
  if (mm && keyOf(w0.slice(mm[0].length))) { marker = mm[0]; found = tryWith(collapse(w0.slice(mm[0].length))); }
  if (!found.length) { marker = ""; found = tryWith(w0); }
  hits.push(...found);
  if (!hits.length) bad("Couldn't find that text in the document's body. Headers, footers and some text boxes can't be edited here; ask the helper.", 422);
  if (hits.length > 1 && !Number.isInteger(n)) bad("That text appears more than once. Select it again.", 409);
  const h = hits[Number.isInteger(n) && n >= 0 ? n : 0]; if (!h) bad("That text isn't in the document that many times. Select it again.", 409);
  return { p: paras[h.i], col: cols[h.i], from: h.from, to: h.to, marker };
}
// units → { text: collapsed text, chars: [{ ch, us: [unit indexes] }], keys: [{ k, c }] }
function collapseUnits(units) {
  const chars = [];
  units.forEach((u, i) => { if (WS.test(u.ch)) { const l = chars[chars.length - 1]; if (l && l.ch === " ") l.us.push(i); else chars.push({ ch: " ", us: [i] }); } else chars.push({ ch: u.ch, us: [i] }); });
  while (chars.length && chars[0].ch === " ") chars.shift();
  while (chars.length && chars[chars.length - 1].ch === " ") chars.pop();
  const keys = []; chars.forEach((c, ci) => { if (c.ch !== " ") for (const ch of c.ch.normalize("NFKC")) if (ALNUM.test(ch)) keys.push({ k: ch, c: ci }); });
  return { text: chars.map((c) => c.ch).join(""), chars, keys };
}

// ---- changing the text ----
const clean = (t) => String(t).replace(/\r\n?|\n/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/\s+/g, " ").trim();
const isHi = (c) => { const x = c.charCodeAt(0); return x >= 0xd800 && x <= 0xdbff; }, isLo = (c) => { const x = c.charCodeAt(0); return x >= 0xdc00 && x <= 0xdfff; };
// The changed stretches of old → new as [{ a0, a1, text }]: old characters a0..a1 become text. Words are compared first (so a change at two
// places leaves everything between them alone, tabs included), then the characters inside each changed stretch.
function hunks(a, b) {
  const tok = (s) => s.match(/\s+|\S+/g) || [], ta = tok(a), tb = tok(b);
  let list;
  if (ta.length * tb.length > 4e6) list = [[0, ta.length, 0, tb.length]];
  else {
    const n = ta.length, m = tb.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ta[i] === tb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    list = []; let i = 0, j = 0, s0 = -1, t0 = -1;
    const flush = () => { if (s0 >= 0) { list.push([s0, i, t0, j]); s0 = -1; } };
    while (i < n || j < m) {
      if (i < n && j < m && ta[i] === tb[j]) { flush(); i++; j++; }
      else { if (s0 < 0) { s0 = i; t0 = j; } if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) j++; else i++; }
    }
    flush();
  }
  const offs = (t) => { const o = [0]; for (const x of t) o.push(o[o.length - 1] + x.length); return o; }, oa = offs(ta), ob = offs(tb);
  return list.map(([s0, s1, t0, t1]) => {
    let a0 = oa[s0], a1 = oa[s1], b0 = ob[t0], b1 = ob[t1], pre = 0;
    const max = Math.min(a1 - a0, b1 - b0); while (pre < max && a[a0 + pre] === b[b0 + pre]) pre++;
    let suf = 0; while (suf < max - pre && a[a1 - 1 - suf] === b[b1 - 1 - suf]) suf++;
    if (pre > 0 && isHi(b[b0 + pre - 1])) pre--;
    if (suf > 0 && isLo(b[b1 - suf])) suf--;
    return { a0: a0 + pre, a1: a1 - suf, text: b.slice(b0 + pre, b1 - suf) };
  }).filter((h) => h.a1 > h.a0 || h.text);
}
// → { sp: splices on the XML text, target: the paragraph's text as it should read afterwards }
function planEdit(xml, hit, now) {
  const { p, col, from, to, marker } = hit, oldChars = col.chars;
  let nw = clean(now);
  if (marker && nw.startsWith(marker.trim())) nw = nw.slice(marker.trim().length).trim();
  const a = col.text, target = a.slice(0, from) + nw + a.slice(to);   // the whole paragraph as it should read
  if (target === a) bad("Nothing changed.");
  const touch = new Map(), get = (el) => { if (!touch.has(el)) touch.set(el, { del: new Set(), ins: [] }); return touch.get(el); };
  for (const h of hunks(a, target)) {
    const unitsOf = oldChars.slice(h.a0, h.a1).flatMap((c) => c.us);
    for (const ui of unitsOf) if (p.units[ui].fixed) bad("That text has a tab or a line break in the part you changed. Ask the helper to change it.");
    let at;   // where the new text goes: where the first removed character was, else right after the character before it
    if (unitsOf.length) { const u = p.units[unitsOf[0]]; at = { el: u.el, i: u.i }; }
    else {
      const prev = h.a0 > 0 ? p.units[oldChars[h.a0 - 1].us[oldChars[h.a0 - 1].us.length - 1]] : null, next = oldChars[h.a0] ? p.units[oldChars[h.a0].us[0]] : null;
      if (prev && !prev.fixed) at = { el: prev.el, i: prev.i + 1 };   // after the character before it, so it takes that run's look
      else if (next && !next.fixed) at = { el: next.el, i: next.i };   // else before the character after it (the one before is a tab or a break)
      else bad("That paragraph has no text run to put the text in. Ask the helper to change it.");
    }
    for (const ui of unitsOf) { const u = p.units[ui]; get(u.el).del.add(u.i); }
    if (h.text) get(at.el).ins.push({ i: at.i, text: h.text });
  }
  const sp = [];
  for (const [el, t] of touch) {
    let s = ""; for (let i = 0; i <= el.text.length; i++) { for (const x of t.ins) if (x.i === i) s += x.text; if (i < el.text.length && !t.del.has(i)) s += el.text[i]; }
    const open = xml.slice(el.os, el.oe), keep = /^\s|\s$|\s\s/.test(s) && !/xml:space\s*=/.test(open);
    sp.push({ at: el.os, end: el.ce, open: keep ? open.replace(/^<w:t/, '<w:t xml:space="preserve"') : open, body: esc(s) });
  }
  return { sp, target };
}
// → { xml, was, now } with the paragraph's text changed; every other byte of the part is as it was
export function editParagraph(xml, edit) {
  if (typeof edit?.was !== "string" || !edit.was.trim() || edit.was.length > 4000) bad("Select the text again.");
  if (typeof edit.text !== "string" || edit.text.length > TEXT_MAX) bad(`Send the new text as a string of up to ${TEXT_MAX} characters.`);
  const paras = paragraphs(xml), hit = findParagraph(paras, edit.was, edit.n ?? null), idx = paras.indexOf(hit.p);
  const { sp, target } = planEdit(xml, hit, edit.text); let out = xml;
  for (const s of sp.sort((x, y) => y.at - x.at)) out = out.slice(0, s.at) + s.open + s.body + out.slice(s.end);
  // safety: the same paragraphs, the one edited now reading as planned, every other paragraph unchanged
  const after = paragraphs(out); let okay = after.length === paras.length && collapse(after[idx]?.text ?? "") === target;
  if (okay) for (let i = 0; i < paras.length; i++) if (i !== idx && after[i].text !== paras[i].text) { okay = false; break; }
  if (!okay) bad("That change couldn't be applied safely. Ask the helper to make it.", 422);
  return { xml: out, was: collapse(paras[idx].text), now: target };
}

// ---- paragraphs by index (the editable view in the Zone, zone-docedit.ts in the app) ----
// The view numbers the body's w:p elements in document order (a paragraph in a table cell counts, one in mc:Fallback does not). Each op names a
// paragraph by that index, as the document stands after the ops before it in the same request. A paragraph is "editable" only when it holds
// nothing but runs of text, tabs and line breaks (plus bookmarks) and sits in the body or a table cell; anything else (a picture, a field, a link,
// a text box, a content control, a tracked change, a section break) is "protected": it is shown but never changed, and an op that would change it is refused.
// Edits are plain string splices on the XML text at element offsets, so every other byte of the part stays as it was.
export const OPS_MAX = 400, PARA_MAX = 20000, BATCH_CHARS = 2_000_000, RPR_MAX = 2000;
const ctl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const bad422 = (m) => bad(m, 422);

// → a tree of the elements of an XML text: { name, attrs, os, oe (end of the open tag), cs, ce (start of the close tag), end, self, parent, kids }
export function xmlTree(xml) {
  const root = { name: "#root", attrs: "", os: 0, oe: 0, cs: 0, ce: xml.length, end: xml.length, self: false, parent: null, kids: [] };
  let cur = root, m; TAG.lastIndex = 0;
  while ((m = TAG.exec(xml))) {
    if (!m[2]) continue;
    const name = m[2], close = m[1] === "/", self = m[4] === "/";
    if (close) { let n = cur; while (n && n !== root && n.name !== name) n = n.parent; if (!n || n === root) continue; n.ce = m.index; n.end = m.index + m[0].length; n.closed = true; cur = n.parent; continue; }
    const oe = m.index + m[0].length, node = { name, attrs: m[3], os: m.index, oe, cs: oe, ce: oe, end: oe, self, closed: self, parent: cur, kids: [] };
    cur.kids.push(node); if (!self) cur = node;
  }
  if (cur !== root) bad("That document's text is damaged.", 415);
  return root;
}
const plist = (root) => { const out = []; (function walk(n, fb) { for (const k of n.kids) { const f = fb || k.name === "mc:Fallback"; if (k.name === "w:p" && !f) out.push(k); walk(k, f); } })(root, false); return out; };
const BOX = new Set(["w:body", "w:tbl", "w:tr", "w:tc", "w:document", "#root"]);
const RPR = new Set(["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath"]);
const ORDER = [...RPR];
const ATTRS = /^(?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"<>&]*")*\s*$/;
// the children of a run's w:rPr, each as { name, raw }, or null when it holds anything this view can't carry along unchanged
function rprKids(raw) {
  if (typeof raw !== "string" || raw.length > RPR_MAX) return null;
  if (!raw) return [];
  let t; try { t = xmlTree(`<x>${raw}</x>`); } catch { return null; }
  const x = t.kids[0]; if (!x || t.kids.length !== 1 || x.end !== raw.length + 7) return null;
  const out = []; let at = 3;
  for (const k of x.kids) {
    if (!(RPR.has(k.name) || /^w14:[A-Za-z]+$/.test(k.name)) || k.kids.length || k.ce !== k.cs || k.os !== at || !ATTRS.test(k.attrs)) return null;
    out.push({ name: k.name, raw: `<${k.name}${k.attrs.replace(/\s+$/, "")}/>` }); at = k.end;
  }
  return at === raw.length + 3 ? out : null;
}
const normRpr = (s) => s.trim().replace(/>\s+</g, "><");   // a pretty-printed w:rPr reads the same as a compact one
const idx = (n) => { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length : i; };
const isOn = (raw, name) => name === "w:u" ? !/w:val\s*=\s*"none"/.test(raw) : !/w:val\s*=\s*"(?:0|false|off)"/.test(raw);
// The rPr children with bold, italic and underline set (true or false) or left alone (undefined). An element that already says the same stays as it is.
export function composeRpr(rpr, flags) {
  let ks = rprKids(rpr); if (!ks) bad422("That text's formatting can't be changed here.");
  for (const [f, name] of [["b", "w:b"], ["i", "w:i"], ["u", "w:u"]]) {
    const v = flags?.[f]; if (v === undefined || v === null) continue;
    const cur = ks.find((k) => k.name === name); if (cur && isOn(cur.raw, name) === v) continue;
    ks = ks.filter((k) => k.name !== name);
    const raw = name === "w:u" ? `<w:u w:val="${v ? "single" : "none"}"/>` : v ? `<${name}/>` : `<${name} w:val="0"/>`;
    let at = ks.findIndex((k) => idx(k.name) > idx(name)); if (at < 0) at = ks.length; ks.splice(at, 0, { name, raw });
  }
  return ks.map((k) => k.raw).join("");
}
const flagOf = (rpr, name) => { const k = (rprKids(rpr) || []).find((x) => x.name === name); return !!k && isOn(k.raw, name); };
const PBREAK = /w:type\s*=\s*["'](page|column)["']/;
// "" when the paragraph can be edited, else why not
function protectedWhy(p, xml) {
  for (let a = p.parent; a; a = a.parent) if (!BOX.has(a.name)) return `inside ${a.name}`;
  if (!p.self && !p.closed) return "damaged";
  for (const k of p.kids) {
    if (k.name === "w:pPr") { for (const x of k.kids) { if (x.name === "w:sectPr") return "a section break"; if (x.name === "w:pPrChange") return "a tracked change"; if (x.name === "w:rPr") for (const y of x.kids) if (/^w:(ins|del|moveFrom|moveTo)$/.test(y.name)) return "a tracked change"; } continue; }
    if (k.name === "w:bookmarkStart" || k.name === "w:bookmarkEnd" || k.name === "w:proofErr") continue;
    if (k.name !== "w:r") return `holds ${k.name}`;
    for (const x of k.kids) {
      if (x.name === "w:rPr") { if (x.self ? false : !rprKids(normRpr(xml.slice(x.cs, x.ce)))) return "formatting it can't carry"; continue; }
      if (x.name === "w:t" || x.name === "w:tab" || x.name === "w:lastRenderedPageBreak") continue;
      if (x.name === "w:br" && !PBREAK.test(x.attrs)) continue;
      return `holds ${x.name}`;
    }
  }
  return "";
}
// A new paragraph may follow this one when it sits in the body or a cell and has no paragraph inside it, and its properties can be copied whole.
function insertableAfter(p) {
  for (let a = p.parent; a; a = a.parent) if (!BOX.has(a.name)) return false;
  let ok = true; (function walk(n) { for (const k of n.kids) { if (k.name === "w:p") ok = false; walk(k); } })(p);
  const pr = p.kids.find((k) => k.name === "w:pPr"); if (pr && pr.kids.some((x) => x.name === "w:sectPr" || x.name === "w:pPrChange" || (x.name === "w:rPr" && x.kids.some((y) => /^w:(ins|del|moveFrom|moveTo)$/.test(y.name))))) ok = false;
  return ok;
}
// a run's text and formatting
function runInfo(r, xml) {
  let rpr = "", text = "";
  for (const x of r.kids) {
    if (x.name === "w:rPr") rpr = x.self ? "" : normRpr(xml.slice(x.cs, x.ce));
    else if (x.name === "w:t") text += x.self ? "" : unesc(xml.slice(x.cs, x.ce));
    else if (x.name === "w:tab") text += "\t";
    else if (x.name === "w:br") text += "\n";
  }
  return { node: r, rpr, text };
}
const paraText = (p, xml) => p.kids.filter((k) => k.name === "w:r").map((r) => runInfo(r, xml).text).join("");
const cleanText = (t) => String(t).replace(/\r\n?/g, "\n").replace(ctl, "");
function runXml(rpr, text) {
  let inner = rpr ? `<w:rPr>${rpr}</w:rPr>` : "";
  for (const part of text.split(/(\t|\n)/)) {
    if (part === "\t") inner += "<w:tab/>"; else if (part === "\n") inner += "<w:br/>";
    else if (part) inner += `<w:t${/^\s|\s$|\s\s/.test(part) ? ' xml:space="preserve"' : ""}>${esc(part)}</w:t>`;
  }
  return `<w:r>${inner}</w:r>`;
}
// → the XML of runs sent by the app: [{ t, r }] (t: text, r: the run's rPr children, as the app read them)
function runsXml(runs, budget) {
  if (!Array.isArray(runs)) bad("Send the runs as a list.");
  let out = "", n = 0;
  for (const x of runs) {
    if (!x || typeof x !== "object" || typeof x.t !== "string") bad("Each run needs a text.");
    const t = cleanText(x.t), rpr = x.r == null ? "" : x.r; n += t.length; budget.n += t.length;
    if (n > PARA_MAX || budget.n > BATCH_CHARS) bad("That is too much text for one change.", 413);
    if (!t) continue;
    const ks = rprKids(rpr); if (!ks) bad("A run's formatting isn't one this view can write.");
    out += runXml(ks.map((k) => k.raw).join(""), t);
  }
  return out;
}
const at = (ps, i) => { if (!Number.isInteger(i) || i < 0 || i >= ps.length) bad422("That paragraph isn't in the document any more. Reload it."); return ps[i]; };
const first = (p, xml) => { const r = p.kids.find((k) => k.name === "w:r"); return r ? runInfo(r, xml).rpr : ""; };
// → { xml, was, now }
function opRuns(xml, e, budget) {
  const ps = plist(xmlTree(xml)), p = at(ps, e.p), w = protectedWhy(p, xml); if (w) bad422(`That paragraph can't be edited here (${w}).`);
  const body = runsXml(e.runs, budget), was = paraText(p, xml);
  const pPr = p.kids.find((k) => k.name === "w:pPr"), starts = p.kids.filter((k) => k.name === "w:bookmarkStart"), ends = p.kids.filter((k) => k.name === "w:bookmarkEnd");
  const raw = (k) => xml.slice(k.os, k.end), open = p.self ? `<w:p${p.attrs.replace(/\s+$/, "")}>` : xml.slice(p.os, p.oe);
  const next = open + (pPr ? raw(pPr) : "") + starts.map(raw).join("") + body + ends.map(raw).join("") + "</w:p>";
  const out = xml.slice(0, p.os) + next + xml.slice(p.end);
  return { xml: out, was, now: runsText(e.runs) };
}
const runsText = (runs) => runs.map((x) => cleanText(x.t)).join("");
function opInsert(xml, e, budget) {
  const ps = plist(xmlTree(xml)), p = at(ps, e.after);
  if (!insertableAfter(p)) bad422("A paragraph can't be added after that one here.");
  const pPr = p.kids.find((k) => k.name === "w:pPr"), rpr = first(p, xml);
  let body = e.runs == null ? "" : runsXml(e.runs, budget), now = e.runs == null ? "" : runsText(e.runs);
  if (!body && rprKids(rpr)?.length) body = `<w:r><w:rPr>${rpr}</w:rPr></w:r>`;
  return { xml: xml.slice(0, p.end) + `<w:p>${pPr ? xml.slice(pPr.os, pPr.end) : ""}${body}</w:p>` + xml.slice(p.end), was: "", now };
}
function opDelete(xml, e) {
  const ps = plist(xmlTree(xml)), p = at(ps, e.p), w = protectedWhy(p, xml); if (w) bad422(`That paragraph can't be removed here (${w}).`);
  const sib = p.parent.kids, k = sib.indexOf(p);
  if (sib.filter((x) => x.name === "w:p").length < 2 && p.parent.name === "w:tc") bad422("A table cell keeps at least one paragraph.");
  if (p.parent.name === "w:tc" && k === sib.length - 1 && sib[k - 1]?.name !== "w:p") bad422("A table cell must end with a paragraph.");
  if (p.parent.name === "w:body" && sib.filter((x) => x.name === "w:p" || x.name === "w:tbl").length < 2) bad422("A document keeps at least one paragraph.");
  return { xml: xml.slice(0, p.os) + xml.slice(p.end), was: paraText(p, xml), now: "" };
}
// bold, italic or underline (true, false, or "toggle") on characters from..to of the paragraph's text (a tab or a line break counts as one)
function opFormat(xml, e) {
  const ps = plist(xmlTree(xml)), p = at(ps, e.p), w = protectedWhy(p, xml); if (w) bad422(`That paragraph can't be formatted here (${w}).`);
  const runs = p.kids.filter((k) => k.name === "w:r").map((r) => runInfo(r, xml)), total = runs.reduce((n, r) => n + r.text.length, 0);
  if (!Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from < 0 || e.to > total || e.from >= e.to) bad422("Select some text in that paragraph again.");
  const want = {}; let any = false;
  for (const [f, name] of [["b", "w:b"], ["i", "w:i"], ["u", "w:u"]]) {
    const v = e[f]; if (v === undefined || v === null) continue;
    if (v !== true && v !== false && v !== "toggle") bad("Bold, italic and underline are true, false or \"toggle\"."); any = true;
    if (v === "toggle") { let all = true, hit = false; let o = 0; for (const r of runs) { const a = Math.max(e.from, o), b = Math.min(e.to, o + r.text.length); o += r.text.length; if (b > a) { hit = true; if (!flagOf(r.rpr, name)) all = false; } } want[f] = !(hit && all); } else want[f] = v;
  }
  if (!any) bad("Say which of bold, italic and underline to change.");
  const sp = []; let o = 0;
  for (const r of runs) {
    const s = o, t = o + r.text.length; o = t; if (t <= e.from || s >= e.to || !r.text) continue;
    const a = Math.max(e.from, s) - s, b = Math.min(e.to, t) - s, rp = composeRpr(r.rpr, want);
    if (rp === (rprKids(r.rpr) || []).map((k) => k.raw).join("")) continue;   // already as asked
    sp.push({ at: r.node.os, end: r.node.end, text: (a ? runXml(r.rpr, r.text.slice(0, a)) : "") + runXml(rp, r.text.slice(a, b)) + (b < r.text.length ? runXml(r.rpr, r.text.slice(b)) : "") });
  }
  let out = xml; for (const x of sp.sort((m, n) => n.at - m.at)) out = out.slice(0, x.at) + x.text + out.slice(x.end);
  return { xml: out, was: paraText(p, xml), now: paraText(plist(xmlTree(out))[e.p], out) };
}
/** Every paragraph the editable view numbers, with its text and whether it can be edited: [{ i, text, editable, why }]. */
export function inspectParagraphs(xml) { return plist(xmlTree(xml)).map((p, i) => { const why = protectedWhy(p, xml); return { i, text: paraText(p, xml), editable: !why, why }; }); }

const INDEXED = new Set(["runs", "insert", "delete", "format"]);
// → { bytes, recs } : the document with each edit applied in order. An edit is the older text-match { op: "text", page, was, n, text }, or one of the ops by paragraph index:
//   { op: "runs", p, runs: [{ t, r }] }  { op: "insert", after, runs? }  { op: "delete", p }  { op: "format", p, from, to, b?, i?, u? }
export async function applyDocxEdits(buf, edits) {
  const entries = readZip(buf), i = entries.findIndex((e) => e.name === PART);
  if (i < 0) bad("That file isn't a Word document the Zone can edit.", 415);
  if (!Array.isArray(edits) || edits.length > OPS_MAX) bad(`Send up to ${OPS_MAX} edits at a time.`);
  let xml = dec.decode(await entryBytes(entries[i])); const recs = [], budget = { n: 0 };
  for (const e of edits) {
    if (!e || typeof e !== "object") bad("Only text can be changed in a Word document here.");
    if (e.op === "text") {
      const r = editParagraph(xml, e); xml = r.xml;
      recs.push({ slide: Number.isInteger(e.page) && e.page >= 1 && e.page <= 99999 ? e.page : null, op: "text", doc: true, was: r.was.slice(0, 200), now: r.now.slice(0, 200) }); continue;
    }
    if (!INDEXED.has(e.op)) bad("Only text can be changed in a Word document here.");
    const r = e.op === "runs" ? opRuns(xml, e, budget) : e.op === "insert" ? opInsert(xml, e, budget) : e.op === "delete" ? opDelete(xml, e) : opFormat(xml, e);
    xml = r.xml; if (xml.length > XML_MAX) bad("That document is too big to edit here.", 413);
    if (r.was !== r.now) recs.push({ slide: null, op: "text", doc: true, was: r.was.slice(0, 200), now: r.now.slice(0, 200) });
  }
  const bytes = enc.encode(xml); if (bytes.length > XML_MAX) bad("That document is too big to edit here.", 413);
  entries[i] = await newEntry(entries[i], bytes);
  return { bytes: writeZip(entries), recs };
}
export const isDocx = (name) => /\.(docx|docm)$/i.test(String(name || ""));
