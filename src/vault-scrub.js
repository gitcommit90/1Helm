// Hiding saved key values. 1Helm knows every saved value exactly, so before text reaches the model or is stored anywhere, each occurrence of a
// saved value is replaced with "[NAME]" (the key's variable name). This is exact matching on the person's real values, not a guess at what
// looks like a secret (that is secrets-scrub.js, which stays as the generic backstop).
// What is matched, for each saved value:
//   - the value itself, with and without outer whitespace;
//   - base64 and base64url, with and without "=" padding, at all three byte alignments (a value inside a longer base64 text, e.g. the user:key of
//     a Basic header, encodes differently depending on where it starts), so only the characters that depend on the value alone are matched;
//   - URL encoding (percent, with "+" for spaces too), JSON escaping (a PEM's line breaks written as \n) and hex (lower and upper case);
//   - a multi-line value (a PEM key) also as its body with every line break removed, as its base64 body alone, and each long line on its own,
//     so a printed head or tail of the file is caught;
//   - the key's stand-in (1hs_...), which is not a secret but has no use outside the computer.
// Short values: a value of at least MIN_SUBSTRING (8) characters is replaced wherever it appears, in any of the forms above. A value of 4 to 7
// characters is replaced only when it stands alone (the characters before and after are not letters or digits) and only in its exact form,
// because a short string inside other text is usually something else (a number, a word). A value shorter than MIN_TOKEN (4) is never replaced.
// Pure code (WebCrypto and TextEncoder only), so it is unit tested and works in any Worker or Durable Object.
import { openSecret } from "./vault-seal.js";
import { vaultRows } from "./vault-rules.js";

export const MIN_SUBSTRING = 8, MIN_TOKEN = 4, LINE_MIN = 16;
const enc = new TextEncoder();
const toBin = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
const hex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, "0")).join("");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const b64url = (s) => s.replace(/\+/g, "-").replace(/\//g, "_");

// The parts of a base64 encoding that depend only on these bytes, at each of the three alignments.
export function base64Forms(bytes) {
  const out = new Set();
  for (let k = 0; k < 3; k++) {
    const full = btoa(toBin(new Uint8Array([...new Array(k).fill(65), ...bytes]))).replace(/=+$/, "");
    const total = k + bytes.length, rem = total % 3;
    let s = full.slice([0, 2, 3][k]);                      // the characters that also carry the filler bytes
    if (rem) s = s.slice(0, -1);   // the last character mixes in the next byte
    if (s.length >= 8) { out.add(s); out.add(b64url(s)); }
  }
  const std = btoa(toBin(bytes)); out.add(std); out.add(std.replace(/=+$/, "")); out.add(b64url(std)); out.add(b64url(std).replace(/=+$/, ""));
  return [...out].filter((x) => x.length >= 8);
}

// Every form a value can show up in. value: the saved text.
export function valueForms(value) {
  const v = String(value ?? ""), trimmed = v.replace(/^[\s​﻿ ]+|[\s​﻿ ]+$/g, "");
  const out = new Set();
  for (const x of new Set([v, trimmed])) {
    if (!x) continue;
    out.add(x);
    const bytes = enc.encode(x);
    out.add(pct(x)); out.add(encodeURIComponent(x)); out.add(encodeURIComponent(x).replace(/%20/g, "+"));
    out.add(JSON.stringify(x).slice(1, -1));
    out.add(hex(bytes)); out.add(hex(bytes).toUpperCase());
    for (const b of base64Forms(bytes)) out.add(b);
    if (/[\r\n]/.test(x)) {
      const lines = x.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const body = lines.filter((l) => !/^-----/.test(l));
      const joined = body.join("");
      if (joined.length >= MIN_SUBSTRING) out.add(joined);
      if (lines.length > 1) out.add(lines.join("\\n"));
      for (const l of lines) if (l.length >= LINE_MIN) out.add(l);
      if (joined.length >= MIN_SUBSTRING) { try { for (const b of base64Forms(enc.encode(joined))) out.add(b); } catch {} }
    }
  }
  return [...out].filter((s) => s.length >= MIN_SUBSTRING);
}

// entries: [{ name, value, standin? }]. → { scrub(text), scrubDeep(x), find(text) -> names, names }
export function makeScrubber(entries = []) {
  const long = [], short = [], stand = [], by = new Map();
  for (const e of entries) {
    const value = String(e.value ?? ""), t = value.replace(/^[\s​﻿ ]+|[\s​﻿ ]+$/g, "");
    if (e.standin) { stand.push([String(e.standin), e.name]); }
    if (t.length >= MIN_SUBSTRING || value.length >= MIN_SUBSTRING) for (const f of valueForms(value)) { if (!by.has(f)) by.set(f, e.name); long.push(f); }
    else if (t.length >= MIN_TOKEN) { if (!by.has(t)) by.set(t, e.name); short.push(t); }
  }
  const forms = [...new Set(long)].sort((a, b) => b.length - a.length);
  const shortForms = [...new Set(short)].sort((a, b) => b.length - a.length);
  const reLong = forms.length ? new RegExp(forms.map(reEsc).join("|"), "g") : null;
  const reShort = shortForms.length ? new RegExp(`(?<![A-Za-z0-9])(?:${shortForms.map(reEsc).join("|")})(?![A-Za-z0-9])`, "g") : null;
  const standMap = new Map(stand), reStand = stand.length ? new RegExp(stand.map(([s]) => reEsc(s)).join("|"), "g") : null;
  const mark = (n) => `[${n}]`;
  const scrub = (text) => {
    if (typeof text !== "string" || !text) return text;
    let s = text;
    if (reLong) s = s.replace(reLong, (m) => mark(by.get(m)));
    if (reShort) s = s.replace(reShort, (m) => mark(by.get(m)));
    if (reStand) s = s.replace(reStand, (m) => mark(standMap.get(m)));
    return s;
  };
  const find = (text) => {
    const found = new Set(); if (typeof text !== "string" || !text) return [];
    if (reLong) for (const m of text.matchAll(reLong)) found.add(by.get(m[0]));
    if (reShort) for (const m of text.matchAll(reShort)) found.add(by.get(m[0]));
    if (reStand) for (const m of text.matchAll(reStand)) found.add(standMap.get(m[0]));
    return [...found];
  };
  const scrubDeep = (x, depth = 0) => {
    if (typeof x === "string") return scrub(x);
    if (!x || typeof x !== "object" || depth > 40) return x;
    if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return x;   // binary (images, files) is not text: left alone
    if (Array.isArray(x)) return x.map((v) => scrubDeep(v, depth + 1));
    const o = {}; for (const [k, v] of Object.entries(x)) o[scrub(k)] = scrubDeep(v, depth + 1); return o;
  };
  const parse = (h) => { try { const x = JSON.parse(h || "[]"); return Array.isArray(x) ? x : []; } catch { return Array.isArray(h) ? h : []; } };
  const keys = entries.map((e) => ({ name: e.name, label: e.label || e.name, hosts: parse(e.hosts) }));
  return { scrub, scrubDeep, find, names: entries.map((e) => e.name), keys, size: entries.length, empty: !entries.length };
}
export const NO_SCRUB = makeScrubber([]);

// Opens one account's saved values and keeps a scrubber for them. state is kept by the caller (one per Durable Object); it only reopens
// a value whose sealed text is new, and only rebuilds the scrubber when the set of saved keys changed. A read that fails keeps the last scrubber.
export async function loadScrubber(env, tenant, state = {}) {
  let rows;
  try { rows = await vaultRows(env, tenant, ["name", "standin", "sealed", "hosts", "label"]); }
  catch { return state.scrubber || NO_SCRUB; }
  const sig = rows.map((r) => `${r.name}\u0000${r.standin}\u0000${r.sealed}\u0000${r.hosts}\u0000${r.label}`).sort().join("\u0001");
  if (state.sig === sig && state.scrubber) return state.scrubber;
  state.opened ||= new Map();
  const entries = [];
  for (const r of rows) {
    let v = state.opened.get(r.sealed);
    if (v == null) { try { v = await openSecret(env, r.sealed); state.opened.set(r.sealed, v); } catch { continue; } }
    entries.push({ name: r.name, value: v, standin: r.standin, hosts: r.hosts, label: r.label });
  }
  if (state.opened.size > rows.length + 20) { const keep = new Set(rows.map((r) => r.sealed)); for (const k of [...state.opened.keys()]) if (!keep.has(k)) state.opened.delete(k); }
  state.sig = sig; state.scrubber = makeScrubber(entries);
  return state.scrubber;
}
