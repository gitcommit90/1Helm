// Offers to save a secret typed or pasted into the message box (the composer prompt, secret-prompt.ts).
// A port of the key, token and password rules of the server's shared detector (src/secrets-scrub.js findSecrets): the same patterns,
// so the box and the server agree on what looks like a key. Card numbers, ID numbers and one-time codes are left out here, because a
// saved key is not the place for them. Everything runs in the browser, and nothing typed is sent anywhere to be checked.
// → [{ start, end, kind }] spans of secret values, sorted and not overlapping.
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
// Value groups: [regex, kind, group of the value (0 = whole match)].
const CTX_RX: any[] = [
  [/\b(?:authorization:\s*)?bearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi, "token", 1],
  [/\b(?:basic)\s+([A-Za-z0-9+/]{16,}={0,2})(?![A-Za-z0-9+/=])/gi, "token", 1],
  [/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]{1,64}:([^\s@/]{3,128})@/gi, "password", 1],
  [/[?&#](?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|auth|x-amz-signature|x-goog-signature)=([^&\s#"'<>]{8,})/gi, "token", 1],
  [/\b(?:api[ _-]?key|access[ _-]?key(?:[ _-]?id)?|secret(?:[ _-]?(?:access[ _-]?)?key)?|client[ _-]?secret|auth(?:entication)?[ _-]?token|access[ _-]?token|refresh[ _-]?token|bearer[ _-]?token|session[ _-]?token|personal access token|private[ _-]?key|token|app[ _-]?password|recovery (?:key|code)s?|backup codes?|seed phrase|mnemonic)\b(?:\s+(?:for|to|of)\s+[^\s:=,;]{1,30})?(?:\s*[:=]\s*|\s+(?:is|was)\s*:?\s*|\s+)(["'“‘`]?)([A-Za-z0-9][A-Za-z0-9._~+/=-]{11,})\1/gi, "api_key", 2],
];
const LONG_RX = /(?<![\w/\\.@%+-])[A-Za-z0-9_+-]{32,512}={0,2}(?![\w/\\=+-])/g;
function credLike(v) {
  if (v.length < 4 || STOP.has(v.toLowerCase()) || /^[[(<{/\\]|:\/\/|\/\w+\//.test(v)) return false;
  if (/^\d+$/.test(v)) return v.length <= 8;   // a PIN
  const L = /[A-Za-z]/.test(v), D = /\d/.test(v);
  return (L && D) || (v.length >= 8 && L && /[A-Za-z0-9][!@#$%^&*+=~?|][A-Za-z0-9]/.test(v)) || (v.length >= 6 && /[a-z][A-Z]/.test(v.slice(1)));
}
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
export type SecretSpan = { start: number; end: number; kind: string };
export function findSecrets(text: string): SecretSpan[] {
  const s = String(text ?? ""); if (s.length < 8) return [];
  const out: SecretSpan[] = [];
  const push = (start: number, end: number, kind: string) => { if (end > start) out.push({ start, end, kind }); };
  const group = (m: any, gi: number) => { const v = m[gi]; if (v == null) return null; const off = m.index + m[0].lastIndexOf(v); return { v, off }; };
  for (const [re, kind] of KEY_RX as any[]) for (const m of s.matchAll(re) as any) { if (kind === "api_key" && !/\d/.test(m[0].replace(/^[a-z]+[-_]/i, ""))) continue; push(m.index, m.index + m[0].length, kind); }
  for (const [re, kind, gi] of CTX_RX) for (const m of s.matchAll(re) as any) {
    if (!gi) { push(m.index, m.index + m[0].length, kind); continue; }
    const g = group(m, gi); if (!g) continue; const v = trimEnd(g.v);
    if ((kind === "api_key" || kind === "token") && !(/\d/.test(v) && /[A-Za-z]/.test(v))) continue;
    push(g.off, g.off + v.length, kind);
  }
  for (const m of s.matchAll((RX as any).pwSep) as any) {
    const quoted = m[2] != null, v = quoted ? m[2] : trimEnd(m[3] || ""); if (!v || (!quoted && !valueOk(v))) continue;
    const off = m.index + m[0].lastIndexOf(v); push(off, off + v.length, /\bpin\b/i.test(m[0].slice(0, 12)) ? "pin" : "password");
  }
  for (const m of s.matchAll((RX as any).pwBare) as any) { const v = trimEnd(m[1]); if (!credLike(v)) continue; const off = m.index + m[0].lastIndexOf(m[1]); push(off, off + v.length, /^pin/i.test(m[0]) ? "pin" : "password"); }
  for (const m of s.matchAll((RX as any).passSep) as any) { if (m[0].startsWith("PASS")) continue; const sep = /[:=]/.test(m[1]), quoted = m[3] != null, v = quoted ? m[3] : trimEnd(m[4] || ""); if (!v || (!quoted && !(sep ? valueOk(v) : credLike(v)))) continue; const off = m.index + m[0].lastIndexOf(v); push(off, off + v.length, "password"); }
  for (const m of s.matchAll((RX as any).passBare) as any) { if (m[0].startsWith("PASS")) continue; const v = trimEnd(m[1]); if (!credLike(v) || /^\d+$/.test(v)) continue; const off = m.index + m[0].lastIndexOf(m[1]); push(off, off + v.length, "password"); }
  for (const m of s.matchAll((RX as any).loginPair) as any) { const v = trimEnd(m[1]); if (!credLike(v)) continue; const off = m.index + m[0].lastIndexOf(m[1]); push(off, off + v.length, "password"); }
  for (const m of s.matchAll(LONG_RX) as any) if (longTokenOk(m[0]) && !/[?&][\w.-]{1,30}=$/.test(s.slice(Math.max(0, m.index - 32), m.index))) push(m.index, m.index + m[0].length, "token");
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: SecretSpan[] = [];
  for (const x of out) { const last = merged.at(-1); if (last && x.start < last.end) { last.end = Math.max(last.end, x.end); continue; } merged.push({ ...x }); }
  return merged;
}
export const hasSecret = (text: string) => findSecrets(text).length > 0;
