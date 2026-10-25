// Zone A direct edits: the person edits text, a picture, a style or a slide background of a Library .html file (an HTML deck or a plain
// page) in the canvas, with no model. Everything here is a plain string transform on the file's text (never executed, never injected
// anywhere), plus zoneEditFile, which the Resident runs: it reads the file, applies the edits, stores the result as a new version of the
// same Library file and keeps a small record of the edits so the helper knows before it rebuilds the deck from its .src folder.
import { extOf } from "./files.js";
import { stPut, stDelete } from "./storage.js";
import { applyDocxEdits, isDocx, DOCX_MAX } from "./zone-docx.js";

export class ZoneError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m, status = 400) => { throw new ZoneError(status, m); };

// ---- a tolerant HTML tokenizer: element ranges ----
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const OPEN_RE = /<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/y, CLOSE_RE = /<\/([a-zA-Z][^\s/>]*)[^>]*>/y;
// Opening one of these closes an open element of the same family first (the browser does the same), so element paths match the page.
const CLOSES = { p: ["p"], li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"] };
const STOP = { li: ["ul", "ol"], tr: ["table", "tbody", "thead", "tfoot"], td: ["tr", "table"], th: ["tr", "table"], dt: ["dl"], dd: ["dl"], p: [], option: ["select"] };

// → { root, all } where each node is { tag, s, oe, cs, e, ao, attrs, kids, parent }: s = "<", oe = after the opening tag, cs = start of the
// closing tag (= oe for a void element), e = after the closing tag, ao = where the attribute text starts, kids = element children only.
export function parseHtml(s) {
  const root = { tag: "#root", s: 0, oe: 0, cs: s.length, e: s.length, ao: 0, attrs: "", kids: [], parent: null }, all = [], stack = [root];
  let i = 0;
  const popTo = (k, at) => { while (stack.length > k) { const n = stack.pop(); n.cs = at; n.e = at; } };
  while (i < s.length) {
    const lt = s.indexOf("<", i); if (lt < 0) break;
    if (s.startsWith("<!--", lt)) { const x = s.indexOf("-->", lt + 4); i = x < 0 ? s.length : x + 3; continue; }
    const c = s[lt + 1];
    if (c === "!" || c === "?") { const x = s.indexOf(">", lt); i = x < 0 ? s.length : x + 1; continue; }
    if (c === "/") {
      CLOSE_RE.lastIndex = lt; const m = CLOSE_RE.exec(s); if (!m) { i = lt + 1; continue; }
      const name = m[1].toLowerCase(); let k = stack.length - 1; while (k > 0 && stack[k].tag !== name) k--;
      if (k > 0) { popTo(k + 1, lt); const n = stack.pop(); n.cs = lt; n.e = lt + m[0].length; }
      i = lt + m[0].length; continue;
    }
    OPEN_RE.lastIndex = lt; const m = OPEN_RE.exec(s); if (!m) { i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    if (CLOSES[tag]) {   // an element of the same family still open (before a boundary) ends here
      for (let k = stack.length - 1; k > 0; k--) {
        if (STOP[tag].includes(stack[k].tag)) break;
        if (CLOSES[tag].includes(stack[k].tag)) { popTo(k, lt); break; }
      }
    }
    const parent = stack[stack.length - 1];
    const node = { tag, s: lt, oe: lt + m[0].length, cs: lt + m[0].length, e: lt + m[0].length, ao: lt + 1 + m[1].length, attrs: m[2], kids: [], parent };
    parent.kids.push(node); all.push(node);
    i = node.oe;
    if (VOID.has(tag) || /\/\s*$/.test(m[2])) continue;
    if (RAW.has(tag)) {
      const x = s.toLowerCase().indexOf("</" + tag, node.oe);
      if (x < 0) { node.cs = node.e = s.length; i = s.length; } else { const g = s.indexOf(">", x); node.cs = x; node.e = g < 0 ? s.length : g + 1; i = node.e; }
      continue;
    }
    stack.push(node);
  }
  popTo(1, s.length);
  return { root, all };
}

// ---- attributes of an opening tag ----
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/dg;
function attrsOf(node) {
  const out = []; ATTR_RE.lastIndex = 0; let m;
  while ((m = ATTR_RE.exec(node.attrs))) {
    const q = m[2] != null ? '"' : m[3] != null ? "'" : "", g = m[2] != null ? 2 : m[3] != null ? 3 : m[4] != null ? 4 : 0;
    out.push({ name: m[1].toLowerCase(), value: g ? m[g] : "", q, ts: node.ao + m.indices[0][0], te: node.ao + m.indices[0][1], vs: g ? node.ao + m.indices[g][0] : -1, ve: g ? node.ao + m.indices[g][1] : -1 });
  }
  return out;
}
const getAttr = (node, name) => attrsOf(node).find((a) => a.name === name)?.value ?? null;
// → the new text; the value is written as given (callers only pass values with no quote characters)
function setAttr(s, node, name, value) {
  const a = attrsOf(node).find((x) => x.name === name);
  if (a && a.q) return s.slice(0, a.vs) + value + s.slice(a.ve);
  if (a) return s.slice(0, a.ts) + `${name}="${value}"` + s.slice(a.te);
  let pos = node.oe - 1; const t = node.attrs.match(/\/\s*$/); if (t) pos = node.ao + node.attrs.length - t[0].length;
  return s.slice(0, pos) + ` ${name}="${value}"` + s.slice(pos);
}
function dropAttr(s, node, name) { const a = attrsOf(node).find((x) => x.name === name); return a ? s.slice(0, a.ts).replace(/\s+$/, "") + s.slice(a.te) : s; }

// ---- inline style ----
function splitDecls(v) {   // on ";", but not inside (), quotes or an entity such as &quot;
  const out = []; let cur = "", depth = 0, q = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "&") { const m = /&#?\w+;/y; m.lastIndex = i; const x = m.exec(v); if (x) { cur += x[0]; i += x[0].length - 1; continue; } }
    if (q) { if (ch === q) q = ""; } else if (ch === '"' || ch === "'") q = ch; else if (ch === "(") depth++; else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && !q && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const declName = (d) => d.slice(0, Math.max(0, d.indexOf(":"))).trim().toLowerCase();
// props: { name: value | null } (null removes). → the new style attribute text
export function mergeStyle(old, props) {
  const decls = splitDecls(old || "");
  for (const [k, v] of Object.entries(props)) {
    const idx = decls.map((d, i) => (declName(d) === k ? i : -1)).filter((i) => i >= 0);
    if (v == null) { for (const i of idx.reverse()) decls.splice(i, 1); continue; }
    if (idx.length) { decls[idx[0]] = `${k}:${v}`; for (const i of idx.slice(1).reverse()) decls.splice(i, 1); } else decls.push(`${k}:${v}`);
  }
  return decls.join(";");
}
function styleOf(node) { return getAttr(node, "style") || ""; }
function setStyle(s, node, props) { const v = mergeStyle(styleOf(node), props); return v ? setAttr(s, node, "style", v) : dropAttr(s, node, "style"); }

const LEN = /^-?\d+(\.\d+)?(px|em|rem|%|pt|vw|vh)?$/, NUM = /^\d+(\.\d+)?$/;
const COLOR = (v) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^(rgb|hsl)a?\(\s*[\d.%\s,/-]+\)$/i.test(v) || /^[a-z]{3,30}$/i.test(v);
const STYLE_PROPS = {
  "font-size": (v) => LEN.test(v), "font-weight": (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/.test(v), "font-style": (v) => /^(normal|italic|oblique)$/.test(v),
  color: COLOR, "text-align": (v) => /^(left|right|center|justify|start|end)$/.test(v), "line-height": (v) => NUM.test(v) || LEN.test(v) || v === "normal",
  "letter-spacing": (v) => LEN.test(v) || v === "normal", "background-color": COLOR, width: (v) => LEN.test(v) || v === "auto", height: (v) => LEN.test(v) || v === "auto",
  opacity: (v) => NUM.test(v) && Number(v) <= 1,
};
export function cleanCss(css) {
  if (!css || typeof css !== "object" || Array.isArray(css)) bad("Send the style changes as an object of property and value.");
  const out = {}, keys = Object.keys(css); if (!keys.length || keys.length > 12) bad("Send between 1 and 12 style properties.");
  for (const k of keys) {
    const name = k.toLowerCase(), ok = STYLE_PROPS[name]; if (!ok) bad(`The style property "${String(k).slice(0, 40)}" can't be changed here.`);
    if (css[k] === null || css[k] === "") { out[name] = null; continue; }
    const v = String(css[k]).trim();
    if (v.length > 60 || /[;{}<>\\"'&]/.test(v) || /url\s*\(/i.test(v) || !ok(v)) bad(`"${v.slice(0, 40)}" isn't a valid value for ${name}.`);
    out[name] = v;
  }
  return out;
}
const cleanColor = (v) => { const x = String(v ?? "").trim(); if (x.length > 60 || /[;{}<>\\"'&]/.test(x) || /url\s*\(/i.test(x) || !COLOR(x)) bad(`"${x.slice(0, 40)}" isn't a valid colour.`); return x; };

// ---- text ----
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => { if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); try { return String.fromCodePoint(n); } catch { return m; } } return ENT[e.toLowerCase()] ?? m; });
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (t, n) => { const x = String(t ?? ""); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
export function textOf(s, node) {
  let out = "", pos = node.oe;
  const add = (a, b) => { out += decode(s.slice(a, b).replace(/<!--[\s\S]*?-->/g, "")); };
  const walk = (n, from) => { let p = from; for (const k of n.kids) { add(p, k.s); if (k.tag === "br") out += "\n"; else if (!RAW.has(k.tag)) walk(k, k.oe); p = k.e; } add(p, n.cs); };
  walk(node, pos);
  return out.replace(/[ \t\r]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

// ---- finding the element an edit is about ----
function descendants(n, out = []) { for (const k of n.kids) { out.push(k); descendants(k, out); } return out; }
function walkPath(root, sel) {
  if (!/^\d{1,4}(\/\d{1,4}){0,40}$/.test(sel)) bad("That element path isn't valid.");
  let n = root; for (const x of sel.split("/")) { n = n.kids[Number(x)]; if (!n) bad("That element is not in the file any more. Select it again."); }
  return n;
}
function resolve(s, edit, isDeck) {
  const { root: top, all } = parseHtml(s);
  let root;
  if (isDeck) {
    const k = Number(edit.slide); if (!Number.isInteger(k) || k < 1 || k > 9999) bad("Which slide? Send slide as a number from 1.");
    root = all.find((n) => getAttr(n, "data-hc-slide") === String(k - 1)); if (!root) bad(`Slide ${k} isn't in this deck.`);
  } else {
    if (edit.slide != null) bad("This file is a page, not a deck; send slide as null.");
    root = all.find((n) => n.tag === "body") || top;
  }
  return { root, all, ...pick(root, edit) };
}
function pick(root, edit) {
  if (edit.sel != null && edit.sel !== "") return { node: walkPath(root, String(edit.sel)) };
  if (edit.slot) {
    const slot = String(edit.slot), n = Number.isInteger(edit.n) && edit.n >= 0 ? edit.n : 0;
    const hit = [root, ...descendants(root)].filter((x) => getAttr(x, "data-slot") === slot);
    if (!hit[n]) bad(`There is no "${slot.slice(0, 40)}" element there. Select it again.`);
    return { node: hit[n] };
  }
  if (edit.sel === "") return { node: root };
  return bad("An edit needs a slot or an element path.");
}

// ---- one edit on a document string → { text, rec } ----
const rec = (edit, op, was, now) => ({ slide: edit.slide ?? null, ...(edit.slot ? { slot: String(edit.slot).slice(0, 40) } : edit.sel != null && edit.sel !== "" ? { sel: String(edit.sel).slice(0, 120) } : {}), op, was: clip(was, 200), now: clip(now, 200) });
const MIMES = { "image/png": [[0x89, 0x50, 0x4e, 0x47]], "image/jpeg": [[0xff, 0xd8, 0xff]], "image/gif": [[0x47, 0x49, 0x46, 0x38]], "image/webp": [[0x52, 0x49, 0x46, 0x46]] };
export const MAX_IMAGE = 4 * 1024 * 1024;
function checkImage(mime, data) {
  if (!MIMES[mime]) bad("Only PNG, JPEG, WebP and GIF pictures can be dropped in.", 415);
  const b64 = String(data ?? "").replace(/\s+/g, ""); if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1) bad("The picture data isn't valid base64.", 400);
  const size = Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0); if (size > MAX_IMAGE) bad("That picture is over 4 MB.", 413);
  let raw; try { raw = Uint8Array.from(atob(b64.slice(0, 16).padEnd(16, "=")), (c) => c.charCodeAt(0)); } catch { bad("The picture data isn't valid base64.", 400); }
  const webp = String.fromCharCode(...raw.slice(8, 12)) === "WEBP";
  if (!MIMES[mime].every((m) => m.every((x, i) => raw[i] === x)) || (mime === "image/webp" && !webp)) bad("The picture's bytes don't match its type.", 415);
  return b64;
}
export function applyOne(s, edit, isDeck) {
  if (!edit || typeof edit !== "object") bad("Each edit must be an object.");
  const op = edit.op;
  if (op === "bg") {
    const value = cleanColor(edit.value);
    let node;
    if (isDeck) node = resolve(s, { slide: edit.slide, sel: "" }, true).node;
    else { node = parseHtml(s).all.find((n) => n.tag === "body"); if (!node) bad("This page has no body to colour."); }
    const was = (splitDecls(styleOf(node)).find((d) => declName(d) === "background") || "").replace(/^[^:]*:/, "");
    return { text: setStyle(s, node, { background: value, "background-color": null, "background-image": null }), rec: rec({ slide: edit.slide ?? null }, "bg", was, value) };
  }
  if (op !== "text" && op !== "style" && op !== "image") bad("Unknown edit.");
  const { node } = resolve(s, edit, isDeck);
  if (op === "style") {
    const css = cleanCss(edit.css), cur = splitDecls(styleOf(node)), val = (k) => (cur.find((d) => declName(d) === k) || "").replace(/^[^:]*:\s*/, "");
    const was = Object.keys(css).map((k) => `${k}: ${val(k) || "(unset)"}`).join(", "), now = Object.keys(css).map((k) => `${k}: ${css[k] ?? "(unset)"}`).join(", ");
    return { text: setStyle(s, node, css), rec: rec(edit, "style", was, now) };
  }
  if (op === "image") {
    const b64 = checkImage(String(edit.mime || ""), edit.data), src = `data:${edit.mime};base64,${b64}`;
    if (node.tag === "img") { let t = setAttr(s, node, "src", src); const again = parseHtml(t).all.find((n) => n.s === node.s); return { text: again && getAttr(again, "srcset") != null ? dropAttr(t, again, "srcset") : t, rec: rec(edit, "image", "a picture", "a new picture") }; }
    if (VOID.has(node.tag) || RAW.has(node.tag)) bad("A picture can't go in that element.");
    const img = `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`;
    let t = s.slice(0, node.oe) + img + s.slice(node.cs);
    const again = parseHtml(t).all.find((n) => n.s === node.s);
    return { text: setStyle(t, again, { border: "0" }), rec: rec(edit, "image", node.kids.some((k) => k.tag === "img") ? "a picture" : "an empty picture box", "a new picture") };
  }
  // text
  if (typeof edit.text !== "string" || edit.text.length > 20000) bad("Send the new text as a string of up to 20000 characters.");
  if (VOID.has(node.tag) || RAW.has(node.tag)) bad("That element has no text to change.");
  const text = edit.text.replace(/\r\n?/g, "\n"), was = textOf(s, node), others = node.kids.filter((k) => k.tag !== "br");
  if (!others.length) {
    const inner = esc(text).replace(/\n/g, "<br>");
    return { text: s.slice(0, node.oe) + inner + s.slice(node.cs), rec: rec(edit, "text", was, text) };
  }
  const segs = []; let p = node.oe; for (const k of node.kids) { segs.push([p, k.s]); p = k.e; } segs.push([p, node.cs]);
  const runs = segs.filter(([a, b]) => s.slice(a, b).replace(/<!--[\s\S]*?-->/g, "").trim() !== "");
  if (runs.length !== 1 || node.kids.some((k) => k.tag === "br")) bad("This element has mixed content; ask the helper to change it.");
  const [a, b] = runs[0], m = s.slice(a, b).match(/^(\s*)[\s\S]*?(\s*)$/);
  return { text: s.slice(0, a) + m[1] + esc(text).replace(/\n/g, " ") + m[2] + s.slice(b), rec: rec(edit, "text", was, text) };
}

// ---- a deck's document: `var DOC = "<js string>";` in the shell ----
const asJs = (v) => JSON.stringify(v).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--").replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => "\\u" + c.charCodeAt(0).toString(16));
export { asJs };
export function locateDoc(text) {
  const k = text.indexOf("var DOC = \""); if (k < 0) return null;
  const start = k + "var DOC = ".length; let i = start + 1;
  while (i < text.length) { const c = text[i]; if (c === "\\") i += 2; else if (c === '"') break; else i++; }
  if (i >= text.length) return null;
  const lit = text.slice(start, i + 1);
  let doc; try { doc = JSON.parse(lit.replace(/<\\!--/g, "<!--")); } catch { return null; }
  return typeof doc === "string" ? { start, end: i + 1, doc } : null;
}
// → { text, recs }: the whole file with every edit applied in order (a deck's edits go into its DOC string)
export function applyEdits(text, edits) {
  const loc = locateDoc(text), recs = [];
  let body = loc ? loc.doc : text;
  for (const e of edits) { const r = applyOne(body, e, !!loc); body = r.text; recs.push(r.rec); }
  return { text: loc ? text.slice(0, loc.start) + asJs(body) + text.slice(loc.end) : body, recs, deck: !!loc };
}

// ---- the edit record (so the helper knows before it rebuilds from .src) ----
const KEY = (id) => `zone_edits:${id}`;
export function readRecord(R, id) { try { const r = JSON.parse(R.getRaw(KEY(id)) || "null"); return r && Array.isArray(r.edits) ? r : null; } catch { return null; } }
const q1 = (t) => String(t ?? "").replace(/\s+/g, " ").replace(/"/g, "'");
// The line the model reads, or "" (no edits, or the file moved on since: a helper rebuild made a newer version).
export function zoneEditsLine(R, fileId) {
  const r = readRecord(R, fileId); if (!r || !r.edits.length) return "";
  let row; try { row = R.sql.exec("SELECT version,name FROM files WHERE id=? AND deleted=0", String(fileId)).toArray()[0]; } catch { return ""; }
  if (!row || Number(row.version || 1) !== Number(r.v)) return "";
  const what = r.doc ? "document" : r.deck ? "deck" : "page", parts = [];
  for (const e of r.edits.slice(-30)) {
    const where = e.doc ? `a paragraph${e.slide ? ` on page ${e.slide}` : ""}` : `${e.slide ? `slide ${e.slide} ` : ""}${e.slot || (e.sel ? `element ${e.sel}` : e.op === "bg" ? "background" : "page")}`;
    parts.push(e.op === "text" ? `${where} "${q1(clip(e.was, 80))}" is now "${q1(clip(e.now, 120))}"` : e.op === "image" ? `${where} has a new picture` : e.op === "bg" ? `${where} is now ${q1(e.now)}` : `${where} style ${q1(e.now)}`);
  }
  return `(Since the ${what} was built, the person edited it by hand in the canvas, in "${q1(row.name)}" (Library file ${fileId}): ${parts.join(", ")}. These edits are in the current Library file but not in the ${what}'s .src folder; keep them when you rebuild.)`;
}
// Every file with a current record, the file named first. "" when there's nothing.
export function zoneEditsNote(R, firstId) {
  const ids = []; if (firstId) ids.push(String(firstId));
  try { for (const x of R.sql.exec("SELECT k FROM kv WHERE k LIKE 'zone_edits:%'").toArray()) { const id = String(x.k).slice(11); if (!ids.includes(id)) ids.push(id); } } catch {}
  return ids.slice(0, 4).map((id) => zoneEditsLine(R, id)).filter(Boolean).join("\n");
}

// ---- the Resident's work ----
const fail = (status, error, extra = {}) => ({ error, status, ...extra });
// body: { base, edits: [...] } or { base, restore: "previous" } → { ok, file, applied } | { ok, file, restored } | { error, status, version? }
export async function zoneEditFile(R, fileId, base, body) {
  const id = String(fileId || ""), row = await R.fileRow(id); if (!row) return fail(404, "No such file.");
  const cur = Number(row.version || 1);
  if (Number(base) !== cur) return fail(409, "The file changed since you opened it.", { version: cur });
  if (body?.restore != null) return zoneRestore(R, row, body.restore);
  const edits = body?.edits;
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 20) return fail(400, "Send between 1 and 20 edits.");
  const docx = isDocx(row.name);
  if (!docx && !["html", "htm"].includes(extOf(row.name))) return fail(400, "Only a page, a deck (.html) or a Word document (.docx) can be edited here.");
  let out;
  try {
    if (docx && Number(row.bytes) > DOCX_MAX) return fail(413, "That document is too big to edit here.");
    const o = await R.env.WS.get(row.r2key); if (!o) return fail(404, `"${row.name}" is missing from storage.`);
    const buf = new Uint8Array(await o.arrayBuffer());
    if (docx) { const d = await applyDocxEdits(buf, edits); out = { bytes: d.bytes, recs: d.recs, deck: false, doc: true }; }
    else out = applyEdits(new TextDecoder().decode(buf), edits);
  } catch (e) { if (e instanceof ZoneError) return fail(e.status, e.message); throw e; }
  const bytes = out.doc ? out.bytes : new TextEncoder().encode(out.text), v = cur + 1, tenant = R.get("tenant"), channel = R.get("channel"), key = `t/${tenant}/files/${channel}/${row.id}.v${v}`;
  try { await stPut(R.env, key, bytes, { httpMetadata: { contentType: row.mime }, customMetadata: { name: String(row.name).slice(0, 200) } }, { check: true, size: bytes.length }); }
  catch (e) { if (e.code === "storage_full") return fail(507, e.toolNote || e.message || "Storage is full."); throw e; }
  const now = await R.fileRow(id);   // the bytes were stored across an await: nothing else may have saved a version meanwhile
  if (!now || Number(now.version || 1) !== cur) { await stDelete(R.env, [{ key, size: bytes.length }]).catch(() => {}); return fail(409, "The file changed since you opened it.", { version: now ? Number(now.version || 1) : null }); }
  await R.putVersion(now, { key, bytes: bytes.length, synced: 0 });
  const old = readRecord(R, id), keep = old && Number(old.v) === cur ? old.edits : [];
  R.put(KEY(id), JSON.stringify({ v, deck: out.deck, ...(out.doc ? { doc: true } : {}), at: Date.now(), edits: [...keep, ...out.recs].slice(-30) }));
  await R.fileUpdated(now, { r2key: key, bytes: bytes.length, path: null }, {}, "");
  if (out.doc) { try { const pv = R.filePreview(id).catch(() => {}); R.ctx?.waitUntil?.(pv); } catch {} }   // the page pictures of the new version are made now, so the canvas finds them ready
  try {   // a running computer gets the bytes now (appFileSave does the same); else the next file sync does
    if (R.env.CHANNEL_COMPUTER) { const C = R.computer(); if ((await C.sleepState())?.running) { const x = await C.putFile(`files/${row.name}`, key); if (x?.ok) R.sql.exec("UPDATE files SET synced=1 WHERE id=?", id); } }
  } catch (e) { console.log("zone edit to computer", String(e?.message || e).slice(0, 120)); }
  return { ok: true, file: R.fileView(R.sql.exec("SELECT * FROM files WHERE id=?", id).one()), applied: edits.length };
}
// Restore the previous version: the same swap share_file's restore does, counted as a new version (current + 1) whose bytes are the earlier ones.
async function zoneRestore(R, row, what) {
  if (what !== "previous") return fail(400, 'restore must be "previous".');
  if (!row.prev_key) return fail(400, "no earlier version kept");
  const to = { key: row.prev_key, bytes: row.prev_bytes ?? 0 }, v = Number(row.version || 1) + 1;
  R.sql.exec("UPDATE files SET r2key=?, bytes=?, prev_key=?, prev_bytes=?, view_key=NULL, version=?, at=?, synced=0 WHERE id=?", to.key, to.bytes, row.r2key, row.bytes, v, Date.now(), row.id);
  if (row.view_key) { try { await stDelete(R.env, [row.view_key]); } catch {} }
  R.sidecarKick?.(R.sql.exec("SELECT * FROM files WHERE id=?", row.id).one());
  await R.fileUpdated(row, { r2key: to.key, bytes: to.bytes, path: null }, {}, "");
  return { ok: true, file: R.fileView(R.sql.exec("SELECT * FROM files WHERE id=?", row.id).one()), restored: true };
}
// → { version, has_previous, previous_at } | { error, status }
export async function zoneInfo(R, fileId) {
  const row = await R.fileRow(String(fileId || "")); if (!row) return fail(404, "No such file.");
  let at = null; if (row.prev_key) { try { const h = await R.env.WS.head(row.prev_key); const u = h?.uploaded; at = u ? new Date(u).getTime() : null; } catch {} }
  return { version: Number(row.version || 1), has_previous: !!row.prev_key, previous_at: at };
}
