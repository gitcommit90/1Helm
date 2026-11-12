// One shared secret detector (nosecrets, 10-07). The skills evals found "password Tulip-2219" in an account's memory recall: a
// password typed in chat had been retained like any other fact. Everything that keeps or summarizes what was said runs its text
// through scrubSecrets() first, which replaces each secret's VALUE with SECRET_MARK and keeps the words around it ("my password is
// [secret removed]"), so memory still knows a password was shared, not what it was:
//   - the memory ledger (memory.js Memory.put + its recall receipts), so every row: turns, hand-off notes, facts, Contacts mirror;
//   - Hindsight retain (the memory retain: content, context, metadata), so every item: turns, facts, upkeep, unfinished work;
//   - the background memory jobs' input (Resident.memjobTurns) and the hand-off notes when they're written;
//   - the work log's summaries (worklog.js insertRow, partialText) and recall_history's results;
//   - Notebook writes (Archive noteAdd/noteEdit scrub; remember and the Notebook API refuse, pointing to Passwords & keys).
// The live conversation (msgs, turns.user_text) keeps the raw text: the current task may need what the person just typed.
// What counts: passwords / PINs in context, API keys and tokens (known prefixes, Bearer, JWTs, private keys, URL credentials,
// long random tokens), card numbers (Luhn) and CVVs, SSNs and passport / license / tax / bank numbers in context, IBANs (mod 97),
// and one-time codes in context. Tuned for few false positives on prices, dates, phone numbers, order and tracking numbers.
// Pure functions, no imports: safe to use anywhere (Worker, Durable Objects, tests).

export const SECRET_MARK = "[secret removed]";
export const SECRET_NOTE = "That looks like a password, key, card number or code. Secrets aren't kept in memory or the Notebook: save it in Settings → Passwords & keys instead (a saved login is typed in for the person without the helper ever seeing it).";

// Words that follow "password is" / "pin:" but aren't the secret ("the password is wrong").
const STOP = new Set(("a an the my your our his her their its this that it same different wrong incorrect invalid correct right expired " +
  "required needed necessary optional saved stored hidden encrypted secure safe weak strong long short too very not no also just still now " +
  "set changed reset updated new old temporary case sensitive case-sensitive below above here there attached included enclosed in on at for " +
  "to of from by with and or but if when what which who how where why being been be going gone working broken locked blocked fine ok okay good " +
  "bad easy hard simple complicated complex visible shown sent coming ready done same as like something nothing anything everything one " +
  "manager managers resets field box protected please thanks thank sorry yes yeah nope unknown forgotten lost expiring expire expires about " +
  "almost probably definitely somewhere written mine hers theirs known outdated compromised leaked unchanged longer shorter stronger weaker " +
  "insecure generated random unique managed synced shared private personal confidential sensitive important typed entered accepted rejected " +
  "denied failing failed valid enabled disabled missing empty blank it's i you we they he she me us them who's what's there's " +
  "free available included expensive cheap worth great nice cool").split(/\s+/));
const PW_KEY = String.raw`(?:pass(?:word|wd|code|phrase)s?|pwd|pw|p\/w|pin(?:\s?(?:code|number|#))?)`;
const VERB = String.raw`(?:\s*[:=]\s*|\s+-{1,2}\s+|\s*-?>\s*|\s*→\s*|\s+(?:is|was|=|will be|should be|would be|is now|is still|is set to|is just)\s*:?\s*)`;
// "password for chase.com is …", "wifi password: …", "the pin to the safe is …": up to three short words between key and verb.
const FOR = String.raw`(?:\s+(?:for|to|of|on|at|into)\s+(?:the\s+|my\s+|our\s+)?[^\s:=,;]{1,40}(?:\s+[^\s:=,;]{1,30}){0,2}?)?`;
const QUOTED = String.raw`(["'“‘\`])([^"'”’\`\n]{3,80})\1`;
const BARE = String.raw`([^\s"'“”‘’\`]{3,80})`;
const RX = {
  pwSep: new RegExp(String.raw`\b${PW_KEY}${FOR}${VERB}(?:${QUOTED}|${BARE})`, "gi"),
  // No verb: "password Tulip-2219", "pw: hunter2", "pin 4821" — the value has to look like a credential (see credLike).
  pwBare: new RegExp(String.raw`\b${PW_KEY}\s+${BARE}`, "gi"),
  passSep: /(?<!\b(?:boarding|bus|day|season|ski|park|parking|backstage|hall|annual|guest|press|train|rail|transit|metro|fast|free|gym|visitor|day-)\s?)\bpass\b(\s*[:=]\s*|\s+(?:is|was)\s+)(?:(["'“‘`])([^"'”’`\n]{3,80})\1|([^\s"'“”‘’`]{3,80}))/gi,
  passBare: /(?<!\b(?:boarding|bus|day|season|ski|park|parking|backstage|hall|annual|guest|press|train|rail|transit|metro|fast|free|gym|visitor)\s?)\bpass\s+([^\s"'“”‘’`]{6,80})/gi,
  // Credentials typed as "user / pass" after "login": "login: joe@x.com / Tulip-2219".
  loginPair: /\b(?:login|log-in|credentials?|creds)\b\s*(?:is|are|[:=])?\s*[^\s/"'<>()[\]]{2,60}\s+[/|]\s+([^\s"'“”‘’`<>()[\]]{4,80})/gi,
};
// Known key / token shapes: matched anywhere.
const KEY_RX = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, "private_key"],
  [/\bsk-(?:ant-|proj-|or-v1-|live-|svcacct-)?[A-Za-z0-9_-]{16,}/g, "api_key"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, "api_key"],
  [/\b(?:whsec|ak|ck|key|api|tok|secret)_[A-Za-z0-9]{20,}/g, "api_key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, "api_key"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, "api_key"],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, "api_key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "api_key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "api_key"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "api_key"],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, "token"],
  [/\bhf_[A-Za-z0-9]{30,}/g, "api_key"],
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "api_key"],
  [/\bsq0(?:atp|csp)-[A-Za-z0-9_-]{20,}/g, "api_key"],
  [/\bnpm_[A-Za-z0-9]{30,}/g, "api_key"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "token"],
];
// Value groups: [regex, kind, group of the value to replace (0 = whole match)].
const CTX_RX = [
  [/\b(?:authorization:\s*)?bearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi, "token", 1],
  [/\b(?:basic)\s+([A-Za-z0-9+/]{16,}={0,2})(?![A-Za-z0-9+/=])/gi, "token", 1],
  [/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]{1,64}:([^\s@/]{3,128})@/gi, "password", 1],
  [/[?&#](?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|auth|x-amz-signature|x-goog-signature)=([^&\s#"'<>]{8,})/gi, "token", 1],
  // "api key: abc…", "my token is …", "secret = …", "client secret …": a value of 12+ characters with letters and digits.
  [/\b(?:api[ _-]?key|access[ _-]?key(?:[ _-]?id)?|secret(?:[ _-]?(?:access[ _-]?)?key)?|client[ _-]?secret|auth(?:entication)?[ _-]?token|access[ _-]?token|refresh[ _-]?token|bearer[ _-]?token|session[ _-]?token|personal access token|private[ _-]?key|token|app[ _-]?password|recovery (?:key|code)s?|backup codes?|seed phrase|mnemonic)\b(?:\s+(?:for|to|of)\s+[^\s:=,;]{1,30})?(?:\s*[:=]\s*|\s+(?:is|was)\s*:?\s*|\s+)(["'“‘`]?)([A-Za-z0-9][A-Za-z0-9._~+/=-]{11,})\1/gi, "api_key", 2],
  // Card security code: "CVV 123", "security code: 1234", "cvc is 321".
  [/\b(?:cvv2?|cvc2?|csc|cid|card (?:security )?code|security code on (?:the|my) card)\b\s*(?:[:#=]|is|was|number|no\.?)?\s*:?\s*(\d{3,4})\b/gi, "card_cvv", 1],
  // SSN: in context (with or without dashes), and the dashed shape alone (area 001-899 minus 666, group and serial never zero).
  [/\b(?:ssn|ss#|social security(?: number| no\.?| #)?|social(?: number)?)\b\s*(?:[:#=]|is|was|number)?\s*:?\s*(\d{3}[- ]?\d{2}[- ]?\d{4})\b/gi, "ssn", 1],
  [/(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g, "ssn", 0],
  // ID and bank numbers in context: a value with at least 4 digits.
  [/\b(?:passport|driver'?s?\s+licen[cs]e|driving\s+licen[cs]e|licen[cs]e\s+(?:no\.?|number|#)|dl\s*(?:no\.?|number|#)|national\s+(?:id|insurance)(?:\s+number)?|id\s+(?:no\.?|number|#)|tax\s+id|taxpayer\s+id|itin|ein|nino|aadhaar|routing(?:\s+(?:no\.?|number|#))?|aba\s+number|(?:bank\s+)?account\s+(?:no\.?|number|#)|acct\.?(?:\s*(?:no\.?|number|#))?|iban)\b(?:\s+(?:number|no\.?|#))?\s*(?:[:#=]|is|was)?\s*:?\s*([A-Z]{0,3}\d[\d -]{2,30}\d[A-Z]?)(?![\w-])/gi, "id_number", 1],
  // One-time codes: "verification code 482913", "your OTP is 1234", "2FA code: 55 21 90", "482913 is your Google verification code".
  [/\b(?:otp|2fa|mfa|totp|one[- ]time\s+(?:pass)?(?:code|password|pin)|verification\s+(?:code|pin|number)|verify\s+code|security\s+code|auth(?:entication|orization|enticator)?\s+code|log[- ]?in\s+code|sign[- ]?in\s+code|access\s+code|sms\s+code|text(?:ed)?\s+code|(?:confirmation|confirm)\s+pin|two[- ]factor(?:\s+code)?|(?:[4-8]|four|five|six|seven|eight)[- ]digit\s+code|passcode|code\s+(?:they|it|google|apple|the bank|my bank)\s+(?:sent|texted|emailed))\b[^\d\n]{0,24}?(\d{3,4}[ -]\d{3,4}|\d{4,8}|(?=[A-Z]*\d)[A-Z0-9]{6,8})(?![\w-])/gi, "otp", 1],
  [/\b(\d{4,8}|\d{3}[ -]\d{3})\s+is\s+your\s+(?:[\w.-]+\s+){0,3}(?:verification|security|login|sign[- ]in|one[- ]time|confirmation|access|authentication)?\s*(?:code|otp|pin|passcode)\b/gi, "otp", 1],
  [/\bG-(\d{5,8})\b(?=[^\n]{0,40}\b(?:code|verification)\b)/g, "otp", 1],
  // "the code is 482913" (six digits, when "code" isn't a zip / promo / error / booking code).
  [/(?<!\b(?:zip|area|postal|post|promo|promotion|promotional|discount|coupon|gift|referral|invite|invitation|error|status|exit|country|dial|product|item|tracking|booking|confirmation|reservation|order|source|qr|bar|dress|tax|sort|swift|airport|flight|course|class|zone|style|color|colour|hs|naics|sic|icd|cpt|room|door|gate|lock|share|voucher|reference|ref)\s)\bcode\b\s*(?:[:=]|is|was)\s*(\d{6})\b/gi, "otp", 1],
];
// Card numbers: 13-19 digits, grouped as cards are (4-4-4-4, 4-6-5 Amex, 4-4-4-4-3) or unbroken, a real issuer start, Luhn-valid,
// and not labelled as an order / tracking / phone / reference number.
const CARD_RX = /(?<![\w.-])(?:\d{4}([ -])\d{4}\1\d{4}\1\d{4}(?:\1\d{1,3})?|\d{4}([ -])\d{6}\2\d{4,5}|\d{13,19})(?![\w-])/g;
const NOT_CARD = /\b(?:order|tracking|track|shipment|confirmation|conf|invoice|inv|receipt|ref|reference|booking|reservation|ticket|case|claim|policy|member|account id|customer|phone|tel|mobile|cell|fax|call|text|isbn|ean|upc|serial|imei|sku|model|part|transaction|txn|id)\b[^\d\n]{0,20}$/i;
// IBAN: two letters, two check digits, 11-30 more (grouped in fours or not), valid mod 97.
const IBAN_RX = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?)\b/g;
// Long random tokens with no known prefix: 32+ characters mixing upper, lower and digits, not a URL path segment or a word chain.
const LONG_RX = /(?<![\w/\\.@%+-])[A-Za-z0-9_+-]{32,512}={0,2}(?![\w/\\=+-])/g;

export function luhnOk(digits) {
  const d = String(digits).replace(/\D/g, ""); if (d.length < 13 || d.length > 19) return false;
  let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
  return s % 10 === 0;
}
// Issuer starts: Visa 4, Mastercard 51-55 / 2221-2720, Amex 34/37, Discover 6011/65/644-649, Diners 36/38/300-305, JCB 35, UnionPay 62.
const issuerOk = (d) => /^(?:4|5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720)|3[47]|3(?:0[0-5]|[68])|35|6(?:011|5|4[4-9]|2))/.test(d) && (d[0] !== "3" || d.length >= 14) && (d[0] !== "4" || [13, 16, 19].includes(d.length));
function ibanOk(s) {
  const t = s.replace(/ /g, ""); if (t.length < 15 || t.length > 34) return false;
  const r = (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of r) m = (m * 10 + Number(ch)) % 97; return m === 1;
}
// A value with no verb before it ("password Tulip-2219") counts only when it looks like a credential.
function credLike(v) {
  if (v.length < 4 || STOP.has(v.toLowerCase()) || /^[[(<{/\\]|:\/\/|\/\w+\//.test(v)) return false;
  if (/^\d+$/.test(v)) return v.length <= 8;   // a PIN
  const L = /[A-Za-z]/.test(v), D = /\d/.test(v);
  return (L && D) || (v.length >= 8 && L && /[A-Za-z0-9][!@#$%^&*+=~?|][A-Za-z0-9]/.test(v)) || (v.length >= 6 && /[a-z][A-Z]/.test(v.slice(1)));
}
// A value after a verb ("my password is sunflower") counts unless it's an ordinary word that describes the password instead.
function valueOk(v) {
  const w = v.toLowerCase().replace(/[.,;:!?)]+$/, "");
  if (!w || w.length < 3 || STOP.has(w) || /^[[(/<\\~]|:\/\//.test(w)) return false;
  if (/^[a-z]+(?:ing|ed|ly)$/.test(w) && w === v.replace(/[.,;:!?)]+$/, "")) return false;   // "expiring", "changed", "probably": describes it
  if (/^(?:https?:|www\.)/.test(w) || /^\$?\d+(?:[.,]\d+)?%?$/.test(w) && w.length < 4) return false;
  return true;
}
const trimEnd = (s) => s.replace(/[.,;:!?)\]}>'"’”]+$/, "");
function longTokenOk(t) {
  if (t.length < 32) return false;
  const up = (t.match(/[A-Z]/g) || []).length, lo = (t.match(/[a-z]/g) || []).length, dg = (t.match(/\d/g) || []).length;
  if (up < 3 || lo < 3 || dg < 3) return false;
  if (/[a-z]{8,}/.test(t) || /[A-Z]{10,}/.test(t)) return false;   // word chains, CONSTANT_NAMES
  if (/^[0-9a-f-]+$/i.test(t)) return false;                       // hex: hashes, UUIDs, commit ids
  if (/^(?:1[A-Za-z0-9_-]{27,43}|0B[A-Za-z0-9_-]{26})$/.test(t)) return false;   // Google Drive / Docs file ids
  const f = {}; for (const c of t) f[c] = (f[c] || 0) + 1; let e = 0; for (const n of Object.values(f)) { const p = n / t.length; e -= p * Math.log2(p); }
  return e >= 4;
}

// → [{ start, end, kind }] spans of secret VALUES, sorted, non-overlapping.
export function findSecrets(text) {
  const s = String(text ?? ""); if (s.length < 4) return [];
  const out = [];
  const push = (start, end, kind) => { if (end > start) out.push({ start, end, kind }); };
  const group = (m, gi) => { const v = m[gi]; if (v == null) return null; const off = m.index + m[0].lastIndexOf(v); return { v, off }; };
  for (const [re, kind] of KEY_RX) for (const m of s.matchAll(re)) { if (kind === "api_key" && !/\d/.test(m[0].replace(/^[a-z]+[-_]/i, ""))) continue; push(m.index, m.index + m[0].length, kind); }
  for (const [re, kind, gi] of CTX_RX) for (const m of s.matchAll(re)) {
    if (!gi) { push(m.index, m.index + m[0].length, kind); continue; }
    const g = group(m, gi); if (!g) continue; let v = trimEnd(g.v);
    if ((kind === "api_key" || kind === "token") && !(/\d/.test(v) && /[A-Za-z]/.test(v))) continue;
    if (kind === "id_number" && (v.match(/\d/g) || []).length < 4) continue;
    if (kind === "otp" && /^(?:19|20)\d{2}$/.test(v)) continue;   // a year
    push(g.off, g.off + v.length, kind);
  }
  for (const m of s.matchAll(RX.pwSep)) {
    const quoted = m[2] != null, v = quoted ? m[2] : trimEnd(m[3] || ""); if (!v || (!quoted && !valueOk(v))) continue;
    const off = m.index + m[0].lastIndexOf(v); push(off, off + v.length, /\bpin\b/i.test(m[0].slice(0, 12)) ? "pin" : "password");
  }
  for (const m of s.matchAll(RX.pwBare)) { const v = trimEnd(m[1]); if (!credLike(v)) continue; const off = m.index + m[0].lastIndexOf(m[1]); push(off, off + v.length, /^pin/i.test(m[0]) ? "pin" : "password"); }
  for (const m of s.matchAll(RX.passSep)) { if (m[0].startsWith("PASS")) continue; const sep = /[:=]/.test(m[1]), quoted = m[3] != null, v = quoted ? m[3] : trimEnd(m[4] || ""); if (!v || (!quoted && !(sep ? valueOk(v) : credLike(v)))) continue; const off = m.index + m[0].lastIndexOf(v); push(off, off + v.length, "password"); }
  for (const m of s.matchAll(RX.passBare)) { if (m[0].startsWith("PASS")) continue; const v = trimEnd(m[1]); if (!credLike(v) || /^\d+$/.test(v)) continue; const off = m.index + m[0].lastIndexOf(m[1]); push(off, off + v.length, "password"); }
  for (const m of s.matchAll(RX.loginPair)) { const v = trimEnd(m[1]); if (!credLike(v)) continue; const off = m.index + m[0].lastIndexOf(m[1]); push(off, off + v.length, "password"); }
  for (const m of s.matchAll(CARD_RX)) {
    const d = m[0].replace(/\D/g, ""); if (!issuerOk(d) || !luhnOk(d) || /^(\d)\1+$/.test(d)) continue;
    if (NOT_CARD.test(s.slice(Math.max(0, m.index - 40), m.index))) continue;
    push(m.index, m.index + m[0].length, "card_number");
  }
  for (const m of s.matchAll(IBAN_RX)) if (/\d{4}/.test(m[1].slice(4).replace(/ /g, "")) && ibanOk(m[1])) push(m.index, m.index + m[1].length, "id_number");
  for (const m of s.matchAll(LONG_RX)) if (longTokenOk(m[0]) && !/[?&][\w.-]{1,30}=$/.test(s.slice(Math.max(0, m.index - 32), m.index))) push(m.index, m.index + m[0].length, "token");
  // Merge overlaps (the first kind found for a span wins; key shapes run first).
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const x of out) { const last = merged.at(-1); if (last && x.start < last.end) { last.end = Math.max(last.end, x.end); continue; } merged.push({ ...x }); }
  // Never treat our own marker (an earlier scrub) as a secret.
  const marks = []; for (let i = s.indexOf(SECRET_MARK); i >= 0; i = s.indexOf(SECRET_MARK, i + 1)) marks.push([i, i + SECRET_MARK.length]);
  return marks.length ? merged.filter((x) => !marks.some(([a, b]) => x.start < b && x.end > a)) : merged;
}
export const hasSecret = (text) => findSecrets(text).length > 0;
// The kinds found, for counts and plain notes (never the values).
export function secretKinds(text) { const k = {}; for (const x of findSecrets(text)) k[x.kind] = (k[x.kind] || 0) + 1; return k; }
// Each secret value → SECRET_MARK; everything around it stays.
export function scrubSecrets(text) {
  if (text == null) return text;
  const s = String(text), spans = findSecrets(s); if (!spans.length) return s;
  let out = "", at = 0; for (const x of spans) { out += s.slice(at, x.start) + SECRET_MARK; at = x.end; }
  return out + s.slice(at);
}
// Every string inside a JSON-like value (logs, step records). → [value, how many strings changed]
export function scrubDeep(v) {
  let n = 0;
  const walk = (x) => typeof x === "string" ? (() => { const y = scrubSecrets(x); if (y !== x) n++; return y; })() : Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x;
  const out = walk(v); return [out, n];
}
