// Lean tool results (10-06): an email search used to return up to 25 messages with up to 6,000 characters of body each, and an
// app_run result up to 14,000 characters, all of it re-sent to the model on every later step. Here:
// - leanMail: one search hit = id, thread, from, subject, date, labels, unread, a ~200-char snippet, attachment names. No body.
// - cleanBody: one message's body for gmail_read: HTML to text, quoted replies / forwarded history and signatures cut, ≤ ~4k chars.
// - leanJSON: any big JSON result trimmed to its key fields (ids, names/titles/subjects, dates, people, short snippets), so the
//   full result can be kept in the work log and opened by key instead of riding in every step.
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const clip = (s, n) => { const t = one(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ---- email ----
const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", zwnj: "", zwj: "", shy: "",
  rarr: "→", larr: "←", harr: "↔", reg: "®", copy: "©", trade: "™", bull: "•", middot: "·", euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", times: "×", eacute: "é", egrave: "è", aacute: "á", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä" };
export function htmlToText(h) {
  return String(h || "")
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "\n")                                  // quoted history in HTML mail
    .replace(/<div[^>]*class="?gmail_quote[\s\S]*$/i, "\n")                                 // Gmail's quoted part runs to the end
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => { const k = e.toLowerCase(); if (k in ENT) return ENT[k]; if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 31 ? String.fromCodePoint(n) : " "; } return m; });
}
const looksHtml = (s) => (String(s).match(/<\/?(p|div|br|table|td|span|a|html|body|font|img)\b/gi) || []).length >= 3;
// Where the quoted history of a reply starts (Gmail/Apple "On … wrote:", Outlook's header block, "Original Message").
// A FORWARDED message is content, not history: everything from its marker on is kept (only lines above it are searched).
const QUOTE_START = [
  /^\s*On\s.{4,250}?\swrote:\s*$/im,
  /^\s*On\s[^\n]{4,200}\n[^\n]{0,200}wrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*_{8,}\s*$\n\s*From:/im,
  /^\s*From:\s.+\n\s*(Sent|Date):\s.+\n/im,
  /^\s*Le\s.{4,200}a écrit\s*:\s*$/im,
  /^\s*Am\s.{4,200}schrieb.{0,80}:\s*$/im,
];
const FWD = /^\s*-{2,}\s*(Forwarded message|Begin forwarded message|Weitergeleitete Nachricht)\s*-{0,}/im;
const SIG = /^--\s*$/m;   // the standard signature separator
const MOBILE = /^\s*(Sent from my (iPhone|iPad|Android|Galaxy|phone|mobile device)|Get Outlook for (iOS|Android)|Sent from (Mail|Outlook|Yahoo Mail) for \w+|Sent via \w+)\b.*$/gim;
export function cleanBody(raw, max = 4000) {
  let t = String(raw || "");
  if (looksHtml(t)) t = htmlToText(t);
  t = t.replace(/\r\n?/g, "\n").replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  const fm = FWD.exec(t), fwdAt = fm ? fm.index : -1;
  let head = fwdAt >= 0 ? t.slice(0, fwdAt) : t, fwd = fwdAt >= 0 ? t.slice(fwdAt) : "";
  const why = [];
  let cut = head.length;
  for (const re of QUOTE_START) { const m = re.exec(head); if (m && m.index > 0 && m.index < cut) cut = m.index; }
  if (cut < head.length) { head = head.slice(0, cut); fwd = ""; why.push("quoted reply"); }   // a reply quoting a forward: the history goes too
  head = head.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");                              // stray quoted lines
  const sm = SIG.exec(head); if (sm && sm.index > 20) { head = head.slice(0, sm.index); why.push("signature"); }
  t = `${head}${fwd ? `\n${fwd}` : ""}`.replace(MOBILE, "");
  t = t.split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length > max) t = `${t.slice(0, max)}…(cut: ${t.length - max} more chars)`;
  return why.length ? `${t}\n[${why.join(" and ")} left out]` : t;
}
const MAIL_LABELS = (ls) => (ls || []).filter((l) => !/^CATEGORY_/.test(l) || l === "CATEGORY_PERSONAL");
// One search hit, no body. m = a Composio Gmail message (GMAIL_FETCH_EMAILS).
export const leanMail = (m) => ({ id: m.messageId, thread: m.threadId, from: m.sender, subject: m.subject, date: m.messageTimestamp,
  unread: (m.labelIds || []).includes("UNREAD"), labels: MAIL_LABELS(m.labelIds),
  snippet: clip(m.preview?.body || (m.messageText ? cleanBody(m.messageText, 400) : ""), 200),
  ...((m.attachmentList || []).length ? { attachments: m.attachmentList.map((a) => a.filename).filter(Boolean) } : {}) });
// One message to read: headers + the cleaned body (≤ 4k).
export const readMail = (m) => ({ id: m.messageId, thread: m.threadId, from: m.sender, to: m.to, subject: m.subject, date: m.messageTimestamp,
  unread: (m.labelIds || []).includes("UNREAD"), labels: MAIL_LABELS(m.labelIds), text: cleanBody(m.messageText || m.preview?.body || ""),
  attachments: (m.attachmentList || []).map((a) => a.filename).filter(Boolean) });

// ---- any JSON result ----
const DROP_KEY = /^(payload|raw|html|htmlBody|body_html|bodyHtml|headers|parts|data|base64|thumbnail\w*|icon\w*|etag|kind|selfLink|_links|avatar\w*|image\w*|logo\w*|blocks|attachments?_?data|messageText)$/i;
const KEY_HINT = /(^|_)(id|uid|key|name|title|subject|summary|from|sender|to|author|owner|organizer|email|user|date|time|timestamp|created|updated|start|end|due|status|state|url|link|snippet|preview|description|text|count|total|type|label|channel|amount|price|location)s?($|_)/i;
const isMail = (o) => o && typeof o === "object" && "messageId" in o && ("subject" in o || "sender" in o);
function shrink(v, d, o) {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > o.str ? `${v.slice(0, o.str)}…` : v;
  if (Array.isArray(v)) {
    const out = v.slice(0, o.items).map((x) => (isMail(x) ? leanMail(x) : shrink(x, d + 1, o)));
    if (v.length > o.items) out.push(`…${v.length - o.items} more`);
    return out;
  }
  if (typeof v === "object") {
    if (d > o.depth) return "{…}";
    const ent = Object.entries(v).filter(([k]) => !DROP_KEY.test(k));
    const keyish = ent.filter(([k, x]) => KEY_HINT.test(k) || (x && typeof x === "object")), keep = (keyish.length >= 2 ? keyish : ent).slice(0, o.keys);
    return Object.fromEntries(keep.map(([k, x]) => [k, shrink(x, d + 1, o)]));
  }
  return v;
}
// → { text, lean: bool }. A result already under max is returned as it is.
export function leanJSON(body, max = 6000) {
  const s = typeof body === "string" ? body : JSON.stringify(body);
  if (s.length <= max) return { text: s, lean: false };
  let v; try { v = typeof body === "string" ? JSON.parse(body) : body; } catch { return { text: `${s.slice(0, max)}…(cut)`, lean: true }; }
  for (const o of [{ str: 240, items: 25, keys: 14, depth: 4 }, { str: 140, items: 15, keys: 10, depth: 3 }, { str: 90, items: 10, keys: 8, depth: 3 }, { str: 60, items: 6, keys: 6, depth: 2 }]) {
    const t = JSON.stringify(shrink(v, 0, o)); if (t.length <= max) return { text: t, lean: true };
  }
  return { text: `${JSON.stringify(shrink(v, 0, { str: 60, items: 6, keys: 6, depth: 2 })).slice(0, max)}…(cut)`, lean: true };
}

// ---- text a provider wrote for the model, not data (composio builtins audit 10-08) ----
// Some no-sign-in providers put prompt text inside their results: trivago's `system_message` ("You are a helpful travel assistant…
// You must present…", "CRITICAL FORMATTING RULES"), Malwarebytes' trailing "User Guidance: … DO NOT … DO …". Those fields and tails are
// dropped from app_run results before the helper sees them (the result is data; only the person gives instructions).
const DIRECTIVE_KEYS = /^(system_?message|system_?prompt|assistant_?instructions?|llm_?instructions?|model_?instructions?|instructions_?for_?(?:the_?)?(?:ai|assistant|model|llm)|user_?guidance|ai_?guidance|prompt_?guidance)$/i;
const DIRECTIVE_TAIL = /\n\s*(?:User Guidance|Guidance for (?:the )?(?:AI|assistant|model)|Instructions for (?:the )?(?:AI|assistant|model)|CRITICAL FORMATTING RULES)\s*:[\s\S]*$/i;
const DIRECTIVE_TEXT = /^\s*(?:You are (?:a|an) [\w\s-]{0,40}assistant\b|CRITICAL FORMATTING RULES\b|IMPORTANT INSTRUCTIONS? (?:FOR|TO) (?:THE )?(?:AI|ASSISTANT|MODEL)\b)/i;
// → { value, dropped } (dropped = how many fields or tails were removed).
export function stripDirectives(v, d = 0, st = { dropped: 0 }) {
  if (d > 12) return { value: v, dropped: st.dropped };
  const go = (x) => stripDirectives(x, d + 1, st).value;
  let out = v;
  if (typeof v === "string") {
    if (DIRECTIVE_TEXT.test(v) && v.length > 80) { st.dropped++; out = "[removed: instructions the provider wrote for an AI]"; }
    else if (DIRECTIVE_TAIL.test(v)) { st.dropped++; out = v.replace(DIRECTIVE_TAIL, ""); }
  } else if (Array.isArray(v)) out = v.map(go);
  else if (v && typeof v === "object") out = Object.fromEntries(Object.entries(v).filter(([k]) => { if (DIRECTIVE_KEYS.test(k)) { st.dropped++; return false; } return true; }).map(([k, x]) => [k, go(x)]));
  return { value: out, dropped: st.dropped };
}
