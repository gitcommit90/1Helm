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

// → { bytes, recs } : the document with each edit applied in order (edit: { op: "text", page, was, n, text })
export async function applyDocxEdits(buf, edits) {
  const entries = readZip(buf), i = entries.findIndex((e) => e.name === PART);
  if (i < 0) bad("That file isn't a Word document the Zone can edit.", 415);
  let xml = dec.decode(await entryBytes(entries[i])); const recs = [];
  for (const e of edits) {
    if (!e || typeof e !== "object" || e.op !== "text") bad("Only text can be changed in a Word document here.");
    const r = editParagraph(xml, e); xml = r.xml;
    recs.push({ slide: Number.isInteger(e.page) && e.page >= 1 && e.page <= 99999 ? e.page : null, op: "text", doc: true, was: r.was.slice(0, 200), now: r.now.slice(0, 200) });
  }
  const bytes = enc.encode(xml); if (bytes.length > XML_MAX) bad("That document is too big to edit here.", 413);
  entries[i] = await newEntry(entries[i], bytes);
  return { bytes: writeZip(entries), recs };
}
export const isDocx = (name) => /\.(docx|docm)$/i.test(String(name || ""));
