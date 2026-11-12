// Contacts import, the parsing half (no DOM): vCard 2.1 / 3.0 / 4.0 and Google / Outlook CSV → plain contacts, then a plan
// against the person's existing Contacts (new / will merge / skipped). Runs in the browser; the file never leaves it. Only the
// rows the person keeps go to 1HC's /api/contacts/import (src/contacts-import.js there, which dedupes and merges again).
// Plain TypeScript that node can run directly (test/contacts-parse.test.mjs): no enums, no DOM.
import { parseCsv } from "./pwimport.ts";

export type CPhone = { v: string; t: string; k: string };   // as written, its label ("mobile", "work", "pref home"), E.164 key
export type CMail = { v: string; t: string };
export type CAddr = { v: string; t: string };
export type CRel = { name: string; t: string };
export type CRaw = {
  name: string; aka: string[]; phones: CPhone[]; emails: CMail[]; bday: string; addrs: CAddr[]; org: string; title: string; note: string;
  related: CRel[]; photo: { mime: string; b64: string } | null; company: boolean; first: string; last: string;
};
export type Kind = "vcard" | "google" | "outlook" | "csv";
export const CT_MAX = 5000;

// ---------- phones (same rules as 1HC contacts-import.js e164) ----------
export function e164(raw: string): string {
  const s = String(raw || "").trim().replace(/^tel:/i, "").replace(/[;,]?\s*(?:ext\.?|extension|x|#|;ext=)\s*\d{1,6}\s*$/i, "").replace(/;ext=\d+$/i, "");
  const plus = /^\s*\+/.test(s), d = s.replace(/\D/g, "");
  if (d.length < 5 || d.length > 15) return "";
  if (plus) return d.length >= 8 ? `+${d}` : "";
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d[0] === "1" && /^[2-9]/.test(d[1])) return `+${d}`;
  if (d.startsWith("011") && d.length > 10) return `+${d.slice(3)}`;
  if (d.startsWith("00") && d.length > 9) return `+${d.slice(2)}`;
  return d;
}
export function phoneShow(raw: string): string {
  const k = e164(raw);
  return /^\+1[2-9]\d{9}$/.test(k) ? `(${k.slice(2, 5)}) ${k.slice(5, 8)}-${k.slice(8)}` : String(raw).replace(/^tel:/i, "").replace(/\s+/g, " ").trim();
}
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const normName = (s: string) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const blank = (): CRaw => ({ name: "", aka: [], phones: [], emails: [], bday: "", addrs: [], org: "", title: "", note: "", related: [], photo: null, company: false, first: "", last: "" });
// The one to show: preferred, then (phones) a mobile, then the first that isn't a fax or pager.
export function pickPhone(c: CRaw) { const l = c.phones; return l.find(x => /\bpref/.test(x.t)) || l.find(x => /mobile|cell|iphone/.test(x.t)) || l.find(x => !/fax|pager/.test(x.t)) || l[0]; }
export function pickEmail(c: CRaw) { const l = c.emails; return l.find(x => /\bpref/.test(x.t)) || l[0]; }

// ---------- labels ----------
// Apple's "_$!<Mobile>!$_" → "mobile"; vCard TYPE lists → one short label ("pref mobile", "work fax", "home").
const appleLabel = (s: string) => s.replace(/^_\$!<(.*)>!\$_$/, "$1").trim().toLowerCase();
function phoneLabel(types: string[]): string {
  const t = new Set(types.map(x => x.toLowerCase()));
  const base = t.has("cell") || t.has("mobile") || t.has("iphone") ? "mobile" : t.has("main") ? "main" : t.has("pager") ? "pager" : "";
  const where = t.has("work") ? "work" : t.has("home") ? "home" : t.has("other") ? "other" : "";
  const fax = t.has("fax") ? "fax" : "";
  const custom = types.find(x => !/^(voice|cell|mobile|iphone|main|pager|work|home|other|fax|pref|internet|x400|text|msg|video|bbs|modem|car|isdn|pcs|textphone)$/i.test(x)) || "";
  const label = fax ? [where, fax].filter(Boolean).join(" ") : base || where || custom.toLowerCase();
  return (t.has("pref") ? "pref " : "") + label;
}
function plainLabel(types: string[]): string {
  const t = types.map(x => x.toLowerCase()).filter(x => !/^(internet|x400|pref|voice|postal|parcel|dom|intl)$/.test(x));
  return (types.some(x => /^pref$/i.test(x)) ? "pref " : "") + (t[0] || "");
}

// ---------- birthdays → "Mar 22, 1985" or "Mar 22" ----------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function bdayOf(raw: string): string {
  const s = String(raw || "").trim(); if (!s) return "";
  const out = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${MON[m - 1]} ${d}${y && y !== 1604 && y > 1800 ? `, ${y}` : ""}` : "";   // Apple writes 1604 for "no year"
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/); if (m) return out(+m[1], +m[2], +m[3]);
  m = s.match(/^--(\d{2})-?(\d{2})$/); if (m) return out(0, +m[1], +m[2]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) { if (+m[1] === 0 || +m[2] === 0) return ""; let y = +m[3]; if (m[3].length === 2) y = y === 0 ? 0 : y + (y > 30 ? 1900 : 2000); return out(y, +m[1], +m[2]); }   // Outlook 3/22/1985 (0/0/00 = none)
  m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?:,? (\d{4}))?$/); if (m) { const i = MON.findIndex(x => x.toLowerCase() === m![1].toLowerCase()); if (i >= 0) return out(m[3] ? +m[3] : 0, i + 1, +m[2]); }
  return s.length <= 30 && /\d/.test(s) ? s : "";
}

// ---------- vCard ----------
type Prop = { group: string; name: string; params: Record<string, string[]>; types: string[]; value: string };
// Logical lines: unfold "CRLF + space/tab" (2.1, 3.0, 4.0) and quoted-printable soft breaks ("=" at the end of a line).
function logicalLines(text: string): string[] {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\r|\n/), out: string[] = [];
  const isQP = (l: string) => { const c = colonAt(l); return c > 0 && /(^|;)(encoding=)?quoted-printable(;|$)/i.test(l.slice(0, c)); };
  for (const l of raw) {
    const n = out.length;
    if (n && out[n - 1].endsWith("=") && isQP(out[n - 1])) { out[n - 1] = out[n - 1].slice(0, -1) + l; continue; }   // QP soft break first (Android doesn't indent the next line)
    if (n && /^[ \t]/.test(l)) { out[n - 1] += l.slice(1); continue; }
    if (l.trim()) out.push(l);
  }
  return out;
}
// The colon that ends the name+params part (one inside a quoted param value doesn't count).
function colonAt(l: string): number { let q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') q = !q; else if (c === ":" && !q) return i; } return -1; }
function parseProp(line: string): Prop | null {
  const c = colonAt(line); if (c < 1) return null;
  const head = line.slice(0, c), value = line.slice(c + 1);
  const bits = head.split(";"), nm = bits[0].trim(), dot = nm.lastIndexOf(".");
  const params: Record<string, string[]> = {}, types: string[] = [];
  for (const b of bits.slice(1)) {
    const eq = b.indexOf("=");
    if (eq < 0) { const v = b.trim(); if (!v) continue; if (/^(quoted-printable|base64|b|8bit|7bit)$/i.test(v)) (params.encoding ||= []).push(v.toLowerCase()); else types.push(v); continue; }   // 2.1 bare params: TEL;CELL;PREF
    const k = b.slice(0, eq).trim().toLowerCase(), vs = b.slice(eq + 1).replace(/^"|"$/g, "").split(",").map(x => x.trim()).filter(Boolean);
    (params[k] ||= []).push(...vs);
    if (k === "type") types.push(...vs);
    if (k === "pref") types.push("pref");
  }
  return { group: dot > 0 ? nm.slice(0, dot).toLowerCase() : "", name: (dot > 0 ? nm.slice(dot + 1) : nm).toUpperCase(), params, types, value };
}
function bytesToText(bytes: number[], charset: string): string {
  const u8 = Uint8Array.from(bytes);
  try { return new TextDecoder(charset || "utf-8").decode(u8); } catch { return new TextDecoder("utf-8").decode(u8); }
}
function qpDecode(s: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; continue; }
    const code = s.charCodeAt(i); if (code < 128) bytes.push(code); else for (const b of new TextEncoder().encode(s[i])) bytes.push(b);
  }
  return bytesToText(bytes, charset);
}
// Split a structured value (N, ADR, ORG) on unescaped ";" and unescape each part.
const unesc = (s: string) => s.replace(/\\([nN,;:\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
function parts(v: string): string[] { const out: string[] = []; let cur = ""; for (let i = 0; i < v.length; i++) { if (v[i] === "\\" && i + 1 < v.length) { cur += v[i] + v[i + 1]; i++; continue; } if (v[i] === ";") { out.push(cur); cur = ""; continue; } cur += v[i]; } out.push(cur); return out.map(x => unesc(x).trim()); }
function listVals(v: string): string[] { const out: string[] = []; let cur = ""; for (let i = 0; i < v.length; i++) { if (v[i] === "\\" && i + 1 < v.length) { cur += v[i] + v[i + 1]; i++; continue; } if (v[i] === ",") { out.push(cur); cur = ""; continue; } cur += v[i]; } out.push(cur); return out.map(x => unesc(x).trim()).filter(Boolean); }
// "Mr." / "Mrs." / "Ms." / "Miss" add nothing to a name; "Dr." and the like stay ("Dr. Patel").
const plainPrefix = (p = "") => /^(mr|mrs|ms|miss|mx)\.?$/i.test(p.trim()) ? "" : p.trim();
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ").replace(/^,\s*|,\s*$/g, "").trim();
// Android's relation type numbers (ContactsContract.CommonDataKinds.Relation).
const ANDROID_REL: Record<string, string> = { "1": "assistant", "2": "brother", "3": "child", "4": "partner", "5": "father", "6": "friend", "7": "manager", "8": "mother", "9": "parent", "10": "partner", "11": "referred by", "12": "relative", "13": "sister", "14": "spouse" };

export function parseVcf(text: string): CRaw[] {
  const out: CRaw[] = []; let cur: CRaw | null = null, props: Prop[] = [], depth = 0;
  const finish = () => {
    if (!cur) return; const c = cur;
    const labels: Record<string, string> = {};
    for (const p of props) if (p.name === "X-ABLABEL" && p.group) labels[p.group] = appleLabel(p.value);
    let fn = "", n: string[] = [], showAs = "", bdayAlt = "";
    for (const p of props) {
      const enc = (p.params.encoding || [])[0] || "", charset = (p.params.charset || [])[0] || "utf-8";
      const isB = /^(b|base64)$/i.test(enc);
      let v = /quoted-printable/i.test(enc) ? qpDecode(p.value, charset) : p.value;
      const types = p.group && labels[p.group] ? [...p.types, labels[p.group]] : p.types;
      switch (p.name) {
        case "FN": fn = unesc(v).trim(); break;
        case "N": n = parts(v); break;
        case "NICKNAME": c.aka.push(...listVals(v)); break;
        case "TEL": { const val = unesc(v).replace(/^tel:/i, "").trim(); if (val) c.phones.push({ v: val, t: phoneLabel(types), k: e164(val) }); break; }
        case "EMAIL": { const val = unesc(v).replace(/^mailto:/i, "").trim().toLowerCase(); if (emailOk(val)) c.emails.push({ v: val, t: plainLabel(types) }); break; }
        case "BDAY": c.bday = bdayOf(unesc(v)); break;
        case "ADR": { const a = parts(v); const street = oneLine([a[2], a[1]].filter(Boolean).join(", ")), city = a[3] || "", reg = a[4] || "", zip = a[5] || "", ctry = a[6] || "";
          const line = [street, city, [reg, zip].filter(Boolean).join(" "), ctry].filter(Boolean).join(", ") || oneLine(a[0] || "");
          if (line) c.addrs.push({ v: line, t: plainLabel(types) }); break; }
        case "ORG": { const o = parts(v).filter(Boolean); c.org = o[0] || ""; break; }
        case "TITLE": c.title = unesc(v).trim(); break;
        case "ROLE": if (!c.title) c.title = unesc(v).trim(); break;
        case "NOTE": c.note = unesc(v).trim(); break;
        case "X-ABSHOWAS": showAs = v.trim().toUpperCase(); break;
        case "RELATED": case "X-ABRELATEDNAMES": {
          const val = unesc(v).trim(), isText = p.name === "X-ABRELATEDNAMES" || /^text$/i.test((p.params.value || [])[0] || "") || !/^(urn:|https?:|mailto:|tel:|sip:)/i.test(val);
          if (val && isText) c.related.push({ name: val, t: (types.map(x => appleLabel(x)).find(x => !/^(pref|text)$/i.test(x)) || "").toLowerCase() }); break; }
        case "X-ANDROID-CUSTOM": {
          const a = parts(v), kind = a[0] || "";
          if (/\/nickname$/.test(kind) && a[1]) c.aka.push(a[1]);
          else if (/\/relation$/.test(kind) && a[1]) c.related.push({ name: a[1], t: a[2] === "0" ? (a[3] || "").toLowerCase() : ANDROID_REL[a[2]] || "" });
          else if (/\/contact_event$/.test(kind) && a[2] === "3" && a[1]) bdayAlt = a[1];
          break; }
        case "PHOTO": {
          const val = v.trim();
          const m = val.match(/^data:(image\/[a-z0-9.+-]+)?(;base64)?,(.*)$/is);
          if (m && m[2]) c.photo = { mime: (m[1] || "image/jpeg").toLowerCase(), b64: m[3].replace(/\s+/g, "") };
          else if (isB && val && !/^https?:/i.test(val)) { const t = ((p.params.type || [])[0] || (p.params.mediatype || [])[0] || p.types.find(x => /jpe?g|png|gif|bmp|heic|webp/i.test(x)) || "jpeg").toLowerCase(); c.photo = { mime: t.includes("/") ? t : `image/${t === "jpg" ? "jpeg" : t}`, b64: val.replace(/\s+/g, "") }; }
          break; }
      }
    }
    if (!c.bday && bdayAlt) c.bday = bdayOf(bdayAlt);
    c.first = n[1] || ""; c.last = n[0] || "";
    const fromN = [plainPrefix(n[3]), n[1], n[2], n[0], n[4]].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    c.company = showAs === "COMPANY" || (!fn && !fromN && !!c.org) || (!!c.org && fn === c.org && !fromN);
    c.name = (c.company && c.org ? c.org : fn || fromN || c.org).trim();
    if (c.photo && c.photo.b64.length > 3e6) c.photo = null;   // a 2 MB+ picture isn't a contact photo
    c.aka = [...new Set(c.aka.map(x => x.trim()).filter(Boolean))];
    out.push(c); cur = null; props = [];
  };
  for (const l of logicalLines(text)) {
    const u = l.trim().toUpperCase();
    if (u === "BEGIN:VCARD") { depth++; if (depth === 1) { cur = blank(); props = []; } continue; }   // a nested AGENT card is skipped
    if (u === "END:VCARD") { if (depth === 1) finish(); depth = Math.max(0, depth - 1); continue; }
    if (depth !== 1 || !cur) continue;
    const p = parseProp(l); if (p) props.push(p);
  }
  return out;
}

// ---------- CSV (Google Contacts, Outlook, and plain spreadsheets with obvious headers) ----------
export function parseContactsCsv(text: string): { kind: Kind; rows: CRaw[] } | { error: string } {
  const all = parseCsv(text);
  if (all.length < 2) return { error: "That file has no contacts in it." };
  const head = all[0].map(h => h.trim().toLowerCase().replace(/\s+/g, " "));
  const has = (h: string) => head.includes(h);
  const kind: Kind = head.some(h => /^(e-mail|phone|email) \d+ - (value|type|label)$/.test(h)) || has("given name") || has("organization name") || has("organization 1 - name") ? "google"
    : has("e-mail address") || has("mobile phone") || has("business phone") || has("home phone") ? "outlook" : "csv";
  const at = (r: string[], h: string) => { const i = head.indexOf(h); return i >= 0 ? (r[i] || "").trim() : ""; };
  const first = (r: string[], ...hs: string[]) => { for (const h of hs) { const v = at(r, h); if (v) return v; } return ""; };
  const multi = (v: string) => v.split(/\s*:::\s*/).map(x => x.trim()).filter(Boolean);   // Google joins several values with " ::: "
  const gLabel = (v: string) => { const pref = /^\*/.test(v.trim()); const l = v.replace(/^\*\s*/, "").trim().toLowerCase(); return (pref ? "pref " : "") + l; };
  const titleIsPrefix = has("job title");
  const rows: CRaw[] = [];
  for (const r of all.slice(1)) {
    const c = blank();
    const pre = plainPrefix(first(r, "name prefix", ...(titleIsPrefix ? ["title"] : []))), given = first(r, "first name", "given name"), mid = first(r, "middle name", "additional name"), fam = first(r, "last name", "family name"), suf = first(r, "name suffix", "suffix");
    c.first = given; c.last = fam;
    const full = [pre, given, mid, fam, suf].filter(Boolean).join(" ");
    c.name = first(r, "name", "full name", "display name") || full || first(r, "file as");
    for (const a of multi(first(r, "nickname"))) c.aka.push(a);
    c.org = first(r, "organization name", "organization 1 - name", "company", "organization");
    c.title = first(r, "organization title", "organization 1 - title", "job title", ...(titleIsPrefix ? [] : ["title"]));
    c.bday = bdayOf(first(r, "birthday"));
    c.note = first(r, "notes", "note");
    head.forEach((h, i) => {
      const v = (r[i] || "").trim(); if (!v) return;
      let m: RegExpMatchArray | null;
      if ((m = h.match(/^phone (\d+) - value$/))) { const lab = gLabel(at(r, `phone ${m[1]} - label`) || at(r, `phone ${m[1]} - type`)); for (const x of multi(v)) c.phones.push({ v: x, t: phoneLabel(lab.split(/\s+/)), k: e164(x) }); }
      else if ((m = h.match(/^e-?mail (\d+) - value$/))) { const lab = gLabel(at(r, `e-mail ${m[1]} - label`) || at(r, `e-mail ${m[1]} - type`) || at(r, `email ${m[1]} - label`)); for (const x of multi(v)) if (emailOk(x.toLowerCase())) c.emails.push({ v: x.toLowerCase(), t: lab }); }
      else if ((m = h.match(/^address (\d+) - formatted$/))) { const lab = gLabel(at(r, `address ${m[1]} - label`) || at(r, `address ${m[1]} - type`)); for (const x of multi(v)) c.addrs.push({ v: oneLine(x), t: lab }); }
      else if ((m = h.match(/^relation (\d+) - value$/))) { const lab = gLabel(at(r, `relation ${m[1]} - label`) || at(r, `relation ${m[1]} - type`)).replace(/^pref /, ""); for (const x of multi(v)) c.related.push({ name: x, t: lab }); }
      else if (kind !== "google" && (m = h.match(/^(?:(business|home|other|mobile|primary|car|assistant's|company main|radio|callback|isdn|ttytdd) )?(phone|fax|pager|telephone)(?: \d)?$/)) && !/^e-?mail/.test(h)) {
        const t = h.startsWith("mobile") ? "mobile" : h.includes("fax") ? `${m[1] === "business" ? "work" : m[1] || ""} fax`.trim() : h === "pager" ? "pager" : m[1] === "business" ? "work" : m[1] === "primary" ? "pref" : m[1] || "";
        c.phones.push({ v, t, k: e164(v) });
      }
      else if (kind !== "google" && /^(e-?mail( \d)? address|e-?mail|email address|email \d)$/.test(h)) { if (emailOk(v.toLowerCase())) c.emails.push({ v: v.toLowerCase(), t: "" }); }
      else if (kind === "csv" && /^(mobile|cell|cell phone|phone number|tel)$/.test(h)) c.phones.push({ v, t: /mobile|cell/.test(h) ? "mobile" : "", k: e164(v) });
      else if (kind === "csv" && /^(address|home address|street address)$/.test(h)) c.addrs.push({ v: oneLine(v), t: h.startsWith("home") ? "home" : "" });
    });
    // Outlook's split addresses: Home / Business / Other street, city, state, postal code, country.
    for (const [w, t] of [["home", "home"], ["business", "work"], ["other", "other"]] as const) {
      const st = [at(r, `${w} street`), at(r, `${w} street 2`), at(r, `${w} street 3`)].filter(Boolean).join(", "), city = at(r, `${w} city`), reg = at(r, `${w} state`), zip = at(r, `${w} postal code`), ctry = at(r, `${w} country/region`) || at(r, `${w} country`);
      const line = [oneLine(st), city, [reg, zip].filter(Boolean).join(" "), ctry].filter(Boolean).join(", "); if (line && /[a-z0-9]/i.test(line)) c.addrs.push({ v: line, t });
    }
    if (kind === "outlook") { const sp = at(r, "spouse"); if (sp) c.related.push({ name: sp, t: "spouse" }); for (const ch of at(r, "children").split(/[,;]/).map(x => x.trim()).filter(Boolean)) c.related.push({ name: ch, t: "child" }); const mg = at(r, "manager's name"); if (mg) c.related.push({ name: mg, t: "manager" }); const as = at(r, "assistant's name"); if (as) c.related.push({ name: as, t: "assistant" }); }
    c.company = !full && !c.name && !!c.org;
    if (!c.name) c.name = c.org;
    c.aka = [...new Set(c.aka)];
    rows.push(c);
  }
  if (!head.some(h => /phone|e-?mail|mobile|cell|tel/.test(h)) && (kind === "csv" || !head.some(h => /name/.test(h)))) return { error: "That spreadsheet doesn't look like contacts: it needs columns like Name, Phone or Email. Export from Google Contacts (Google CSV) or Outlook (CSV), or use a vCard (.vcf)." };
  return { kind, rows };
}

// ---------- read any supported file ----------
// Outlook on Windows saves CSV as Windows-1252 (or UTF-16 for "Unicode"); everything else is UTF-8.
export function decodeBytes(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return cp1252(b); }
}
// Windows-1252 by hand (some TextDecoders treat it as Latin-1, which turns "—" and "’" into control characters).
const W1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
function cp1252(b: Uint8Array): string { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...Array.from(b.subarray(i, i + 8192), (x) => x >= 0x80 && x < 0xa0 ? W1252.charCodeAt(x - 0x80) : x)); return s; }
export function readContactsFile(name: string, text: string): { kind: Kind; rows: CRaw[] } | { error: string } {
  const t = text.replace(/^﻿/, "");
  if (/^\s*BEGIN:VCARD/i.test(t) || /\.vcf$|\.vcard$/i.test(name)) {
    const rows = parseVcf(t);
    return rows.length ? { kind: "vcard", rows } : { error: "No contacts in that file. It should be a vCard (.vcf) from your phone, iCloud, Google or Outlook." };
  }
  if (/\.csv$/i.test(name) || /,/.test(t.split(/\r?\n/)[0] || "")) return parseContactsCsv(t);
  return { error: "That isn't a contacts file. Pick a vCard (.vcf) or a Google / Outlook contacts CSV." };
}

// ---------- the plan: what happens to each contact ----------
export type Existing = { sid: string; name: string; phone?: string; email?: string; phones?: string[]; emails?: string[]; aka?: string[]; rel?: string };   // phones/emails: every number a contact has
export type Row = { c: CRaw; rel: string; group: string; match: { sid: string; name: string; by: "email" | "phone" } | null; maybe: { sid: string; name: string } | null; photo?: string };
export type Plan = { kind: Kind; rows: Row[]; skipped: { name: string; reason: string }[]; combined: number; total: number; notes: number; me: string };
const FAMILY = /\b(spouse|wife|husband|partner|mother|mom|mum|father|dad|parent|child|son|daughter|kid|brother|sister|sibling|relative|grand\w*|aunt|uncle|cousin|niece|nephew|in-law|stepmother|stepfather|stepson|stepdaughter|fianc\w*)\b/;
export function relLabel(t: string): string {
  const s = t.toLowerCase().replace(/^pref /, "").trim(); if (!s || s === "related" || s === "other") return "";
  const map: Record<string, string> = { "domestic partner": "partner", mom: "mother", mum: "mother", dad: "father", kid: "child", "referred by": "" };
  const w = s in map ? map[s] : s; return w ? `Your ${w}` : "";
}
const groupFor = (c: CRaw, rel: string) => FAMILY.test(rel.toLowerCase()) ? "Family" : /friend/i.test(rel) ? "Friends" : /assistant|manager|boss|coworker|colleague/i.test(rel) ? "Work" : c.company ? "Services" : c.org ? "Work" : "Friends";
// Same rules as 1HC: an email or a mobile / unlabeled number is personal; a home / work / main line is often shared (a family
// landline, an office number), so it only joins two people whose names are compatible (same first name, or a shared alias).
export const sharedLine = (t: string) => /\b(home|work|main|fax|pager|other|company|business|office)\b/.test(t || "") && !/mobile|cell|iphone/.test(t || "");
export function sameish(a: { name: string; aka?: string[] }, b: { name: string; aka?: string[] }) {
  const w = (x: { name: string; aka?: string[] }) => [x.name, ...(x.aka || [])].map(s => normName(s).split(" ").filter(Boolean)).filter(v => v.length);
  const na = w(a), nb = w(b); return na.some(x => nb.some(y => x[0] === y[0] || x.join(" ") === y.join(" ")));
}
// Two cards in one file are the same person when they share an email or a personal number (see sharedLine): combine them.
function combine(a: CRaw, b: CRaw) {
  const pk = new Set(a.phones.map(p => p.k || p.v)), ek = new Set(a.emails.map(e => e.v));
  for (const p of b.phones) { if (!pk.has(p.k || p.v)) { a.phones.push(p); continue; } const q = a.phones.find(x => (x.k || x.v) === (p.k || p.v)); if (q && sharedLine(q.t) && !sharedLine(p.t)) q.t = p.t; }   // the same number as a mobile: it's personal
  for (const e of b.emails) if (!ek.has(e.v)) a.emails.push(e);
  for (const x of b.addrs) if (!a.addrs.some(y => y.v === x.v)) a.addrs.push(x);
  for (const r of b.related) if (!a.related.some(y => y.name === r.name)) a.related.push(r);
  if (b.name && normName(b.name) !== normName(a.name)) a.aka.push(b.name);
  a.aka = [...new Set([...a.aka, ...b.aka])];
  for (const k of ["bday", "org", "title"] as const) if (!a[k] && b[k]) a[k] = b[k];
  if (b.note && b.note !== a.note) a.note = a.note ? `${a.note}\n${b.note}` : b.note;
  if (!a.photo && b.photo) a.photo = b.photo;
}

export function planContacts(kind: Kind, raw: CRaw[], existing: Existing[], me: { name?: string; email?: string } = {}): Plan | { error: string } {
  const skipped: Plan["skipped"] = [], keep: CRaw[] = [], key = new Map<string, CRaw>(); let combined = 0;
  for (const c of raw) {
    for (const p of c.phones) if (!p.k) p.k = e164(p.v);
    c.phones = c.phones.filter(p => p.k);   // "555", "call me": not a number
    if (!c.name && !c.phones.length && !c.emails.length) { skipped.push({ name: c.org || "(blank card)", reason: "No name, email or phone" }); continue; }
    if (!c.name) c.name = c.emails[0]?.v || phoneShow(c.phones[0].v);
    const ks = [...c.emails.map(e => `e:${e.v}`), ...c.phones.map(p => `t:${p.k}`)];
    const into = c.emails.map(e => key.get(`e:${e.v}`)).find(Boolean) || c.phones.map(p => { const x = key.get(`t:${p.k}`); return x && (!sharedLine(p.t) || sameish(c, x)) ? x : undefined; }).find(Boolean);
    if (into) { combine(into, c); combined++; for (const k of ks) if (!key.has(k)) key.set(k, into); continue; }
    for (const k of ks) if (!key.has(k)) key.set(k, c);
    keep.push(c);
  }
  if (keep.length > CT_MAX) return { error: `That file has ${keep.length.toLocaleString()} contacts. 1Helm imports up to ${CT_MAX.toLocaleString()}: export a smaller group (a list or label) and import it in parts.` };
  // Your own card ("My Card"): found by your email, or your first name on a card that lists related people. It isn't imported,
  // but its related names say who people are to you ("Sam" listed as spouse → Sam is "Your spouse").
  const myEmail = (me.email || "").toLowerCase(), myFirst = normName(me.name || "").split(" ")[0];
  const meCard = keep.find(c => myEmail && c.emails.some(e => e.v === myEmail)) || (myFirst ? keep.find(c => c.related.length && normName(c.first || c.name).split(" ")[0] === myFirst) : undefined);
  const rels = new Map<CRaw, string>();
  if (meCard) {
    for (const r of meCard.related) {
      const n = normName(r.name), lab = relLabel(r.t); if (!n || !lab) continue;
      const exact = keep.filter(c => c !== meCard && normName(c.name) === n), byFirst = keep.filter(c => c !== meCard && normName(c.first || c.name.split(" ")[0]) === n), byAka = keep.filter(c => c !== meCard && c.aka.some(a => normName(a) === n));
      const hit = exact.length === 1 ? exact[0] : byFirst.length === 1 ? byFirst[0] : byAka.length === 1 ? byAka[0] : null;
      if (hit && !rels.has(hit)) rels.set(hit, lab);
    }
    skipped.push({ name: meCard.name, reason: "That's you (your own card)" });
  }
  const byEmail = new Map<string, Existing>(), byPhone = new Map<string, Existing>(), byName = new Map<string, Existing[]>();
  for (const x of existing) {
    for (const m of [x.email, ...(x.emails || [])]) if (m && !byEmail.has(m.trim().toLowerCase())) byEmail.set(m.trim().toLowerCase(), x);
    for (const ph of [x.phone, ...(x.phones || [])]) { const k = ph ? e164(ph) : ""; if (k && !byPhone.has(k)) byPhone.set(k, x); }   // a match through any of their numbers
    for (const n of new Set([x.name, ...(x.aka || [])].map(normName).filter(s => s.includes(" ") || s === normName(x.name)))) (byName.get(n) || byName.set(n, []).get(n)!).push(x);
  }
  const rows: Row[] = [];
  for (const c of keep) {
    if (c === meCard) continue;
    const e = c.emails.map(m => byEmail.get(m.v)).find(Boolean), p = e ? undefined : c.phones.map(x => { const h = byPhone.get(x.k); return h && (!sharedLine(x.t) || sameish(c, h)) ? h : undefined; }).find(Boolean);
    const hit = e || p, names = hit ? [] : [...new Set([c.name, ...c.aka.filter(a => a.includes(" "))].flatMap(x => byName.get(normName(x)) || []))];   // same full name or alias: only a suggestion
    const rel = rels.get(c) || "";
    rows.push({ c, rel, group: groupFor(c, rel), match: hit ? { sid: hit.sid, name: hit.name, by: e ? "email" : "phone" } : null, maybe: names.length === 1 ? { sid: names[0].sid, name: names[0].name } : null });
  }
  rows.sort((a, b) => a.c.name.localeCompare(b.c.name, undefined, { sensitivity: "base" }));
  return { kind, rows, skipped, combined, total: raw.length, notes: rows.filter(r => r.c.note).length, me: meCard?.name || "" };
}

// What goes to /api/contacts/import for one row (the file's photo only as the small JPEG the page made).
export function payload(r: Row, o: { notes: boolean; into?: string }) {
  const c = r.c;
  return { name: c.name, aka: c.aka, phones: c.phones.map(p => ({ v: p.v, t: p.t })), emails: c.emails, addrs: c.addrs, org: c.org, title: c.title, bday: c.bday,
    related: c.related, rel: r.rel, group: r.group, ...(o.notes && c.note ? { note: c.note } : {}), ...(r.photo ? { photo: r.photo } : {}), ...(o.into ? { into: o.into } : {}) };
}
