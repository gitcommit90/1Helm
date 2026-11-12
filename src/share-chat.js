// Shared chats: a static copy of one chat that anyone with the link can read (the "Share" button in the chat header).
//
// This file holds the pure parts: turning the app's sessionDetail into a snapshot, and drawing a snapshot as a page. The storage, the
// token and the routes are in src/share.js (rows in D1 share_chats, the snapshot and its pictures in R2 under t/<tenant>/chats/<id>/<version>/).
//
// What a snapshot holds: the title (a Live notes turn shows its meeting notes under a small "Live notes" label, but not its "Update your meeting notes?" card), the person's messages and the helper's replies in order with their times, the pictures the chat
// shows (copied, so they still display), and a name tile for every other file. It never holds work steps, tool cards, permission cards,
// plans, offers, interview cards or any card with buttons, and none of the hidden data: system prompts, model names, costs, memory,
// tool arguments or results. snapshotFromDetail copies fields one by one from the same turns the app loads, so a field that is not named
// here cannot end up in the snapshot.
//
// The page is drawn on the server with no scripts. Message text goes through the same markdown library the app uses (vendored in
// src/vendor/marked), with raw HTML escaped and only http, https and mailto links kept, and the stylesheet is the app's own chat rules.
import { Marked } from "./vendor/marked/marked.esm.js";
import { CHAT_CSS } from "./share-chat-css.js";
import { progressKeep, mustShow } from "./progress-dedupe.js";
import { cardsToText } from "./genui.js";

// A reply made of cards is shown as the text of its static parts (Say, Tip, Big, Bars, Rows, Meter). Anything the person could tap or fill in
// (buttons, options, forms, an email draft to approve, a file card with Open) is left out, so the page never shows a control or its labels.
const none = () => "";
const NO_CONTROLS = { Buttons: none, Button: none, Options: none, Option: none, Form: none, Stepper: none, Choice: none, Field: none, Email: none, File: none };

export const SNAPSHOT_VERSION = 1;
export const CHAT_IMG_MAX_BYTES = 10 * 1024 * 1024;     // one picture
export const CHAT_IMG_TOTAL_BYTES = 30 * 1024 * 1024;   // all pictures of one chat
export const CHAT_IMG_MAX = 60;
export const CHAT_JSON_MAX_BYTES = 8 * 1024 * 1024;     // the text of the whole chat
export const CHAT_TEXT_MAX = 200_000;                   // one message
export const CHATS_PER_TENANT = 200;
const INTERRUPTED = "1Helm restarted while I was working on this, so I stopped before replying. Send it again and I'll pick it back up.";

const str = (x) => (typeof x === "string" ? x : x == null ? "" : String(x));
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

// The answer parts of a turn, the same split the app makes (web/src/progress-dedupe.ts splitParts): earlier narration that the
// server marked as progress belongs to the work steps and is left out, a part with a question, a link or code stays.
function answerParts(parts, flags) {
  const xs = (parts || []).map((x) => str(x)), keep = progressKeep(xs), out = [];
  const last = xs.map((x, i) => (keep[i] && x.trim() ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  xs.forEach((x, i) => {
    if (!keep[i] || !x.trim()) return;
    const isProg = Array.isArray(flags) ? flags.includes(i) && i !== last : i !== last && !mustShow(x);
    if (!isProg) out.push(x.trim());
  });
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
// A file the chat shows: a picture (shown if it can be copied) or any other file (a name tile with no link).
const fileItem = (f) => f && f.name ? { k: "file", name: clip(str(f.name), 200), mime: clip(str(f.mime), 100), bytes: Number(f.bytes) || 0, ref: f.id && f.image ? { kind: "file", id: str(f.id) } : null } : null;

// sessionDetail → { messages, refs }. refs lists the pictures to copy: each item with a ref gets its copy (or becomes a name tile).
export function snapshotFromDetail(d) {
  const messages = [];
  const push = (role, at, text, items, extra = {}) => {
    text = clip(str(text), CHAT_TEXT_MAX).replace(/\s+$/, "");
    items = items.filter(Boolean);
    if (!text.trim() && !items.length) return;
    messages.push({ role, at: Number(at) || 0, text, items, ...extra });
  };
  for (const t of d?.turns || []) {
    if (!t) continue;
    const live = t.kind === "livenote";
    // The person's messages of this turn: the first one plus anything added while the helper worked.
    const users = Array.isArray(t.msgs) ? t.msgs : t.kind === "chat" ? [{ text: t.user_text, at: t.at, files: t.attached }] : [];
    users.forEach((x, i) => {
      const files = (x.files?.length || i) ? x.files || [] : t.attached || [];
      // A message sent as a reply to an earlier message shows that message's words above it, cut to the length the app shows.
      const quote = x.reply && str(x.reply.text).trim() ? { quote: clip(str(x.reply.text).replace(/\s+/g, " ").trim(), 120) } : {};
      push("user", x.at || t.at, x.text, files.map(fileItem), quote);
    });
    // The helper's reply: the answer parts, else the saved reply, shown as the app shows it (cards become their plain text).
    const sp = Array.isArray(t.parts) && (t.parts.length > 1 || t.progress?.length) ? answerParts(t.parts, t.progress) : null;
    let body = sp?.length ? sp.join("\n\n") : str(t.reply) || (t.error === "interrupted" ? INTERRUPTED : "");
    body = body.trim() === "Stopped." ? "Stopped." : cardsToText(body, NO_CONTROLS);
    // A Live notes turn that holds the "Update your meeting notes?" card has no message text in the app, only that card (it has buttons).
    if (live && t.livenote?.refine) body = "";
    const items = [
      ...(t.images || []).map((x) => x && x.id ? { k: "img", shot: true, name: "", caption: [x.caption, hostOf(x.url)].filter(Boolean).filter((v, j, a) => a.indexOf(v) === j).join(" · ").slice(0, 200), ref: { kind: "shot", id: str(x.id) } } : null),
      ...(t.shared || []).map(fileItem),
    ];
    push("agent", (Number(t.at) || 0) + (Number(t.total_ms) || 0), body, items, live ? { label: "Live notes" } : {});
  }
  return { messages };
}

// ---- pictures: only formats every browser draws; the bytes decide, never the stored type ----
export function sniffImage(b) {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  const at = (i, s) => [...s].every((c, j) => u[i + j] === c.charCodeAt(0));
  if (u.length > 12 && u[0] === 0x89 && at(1, "PNG")) return "image/png";
  if (u.length > 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return "image/jpeg";
  if (u.length > 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (u.length > 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (u.length > 12 && at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return "image/avif";
  return null;
}
export const IMG_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

// ---- markdown ----
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const cleanHref = (h) => { const x = str(h).replace(/[\u0000- \u007f-\u009f]+/g, ""); return SAFE_HREF.test(x) ? str(h).trim() : ""; };
// Tags a reply may use with no attributes; any other raw HTML is shown as text.
const PLAIN_TAG = /^<\/?(?:br|small|sub|sup|b|i|strong|em|u|kbd|mark|del|s|code|details|summary)\s*\/?>$/i;
const marked = new Marked({ gfm: true, breaks: true, async: false, renderer: {
  html(token) { const t = str(token.text); return PLAIN_TAG.test(t.trim()) ? t.trim() : esc(t); },
  link(token) {
    const inner = this.parser.parseInline(token.tokens), href = cleanHref(token.href);
    return href ? `<a href="${esc(href)}"${token.title ? ` title="${esc(token.title)}"` : ""} target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
  },
  image(token) {
    const src = cleanHref(token.href), name = str(token.text || token.title || "Image");
    if (!src || /^mailto:/i.test(src)) return esc(name);
    return `<a class="chat-image-link" href="${esc(src)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(name)}"><span class="chat-image-tile" title="${esc(name)}"><img src="${esc(src)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer"><span class="chat-image-name">${esc(name)}</span></span></a>`;
  },
  code(token) { return `<div class="chat-code chat-code-block"><pre><code${token.lang ? ` class="language-${esc(String(token.lang).split(/\s/)[0].replace(/[^\w+#.-]/g, ""))}"` : ""}>${esc(token.text)}\n</code></pre></div>`; },
  codespan(token) { return `<span class="chat-code chat-code-inline"><code>${esc(token.text)}</code></span>`; },
} });
export const renderMarkdown = (text) => marked.parse(str(text), { async: false });

// ---- the page ----
const KIND = {
  doc: ["Doc", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'],
  sheet: ["Sheet", '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'],
  pdf: ["PDF", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 15.5h7"/>'],
  image: ["Image", '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>'],
  code: ["Code", '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'],
};
function fkind(name, mime = "") {
  const e = (str(name).match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (/^image\//.test(mime) || /^(png|jpe?g|gif|webp|heic|heif|svg)$/.test(e)) return "image";
  if (e === "pdf" || mime === "application/pdf") return "pdf";
  if (/^(xlsx?|csv|tsv|numbers|ods)$/.test(e)) return "sheet";
  if (/^(js|ts|py|json|html?|css|sh|zip|xml|sql|ipynb)$/.test(e)) return "code";
  return "doc";
}
const KB = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);
const svg = (d, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

// A name tile (no link, no download) or, for a picture that was copied, a tile showing it.
function tile(it, base, mine) {
  const k = fkind(it.name, it.mime), kind = KIND[k][0], title = `${esc(it.name)} · ${kind}${it.bytes ? ` · ${KB(it.bytes)}` : ""}`;
  const prev = it.k === "img" && Number.isInteger(it.n)
    ? `<span class="chat-tile-preview photo"><img src="${base}/img/${it.n}" alt="${esc(it.name || it.caption || "Picture")}" loading="lazy"></span>`
    : `<span class="chat-tile-preview"><span class="aico k-${k}">${svg(KIND[k][1], 28)}</span></span>`;
  return `<div class="fcard chat-tile${mine ? " mine" : ""}" title="${title}"><span class="chat-tile-open">${prev}<span class="chat-tile-name">${esc(it.name)}</span></span><span class="chat-tile-actions"><span class="chat-tile-kind">${kind}</span></span></div>`;
}
// A screenshot the helper took: the picture with its caption (the app's .shot tile).
const shot = (it, base) => `<div class="shot"><img src="${base}/img/${it.n}" alt="${esc(it.caption || "Screenshot")}" loading="lazy">${it.caption ? `<span>${esc(it.caption)}</span>` : ""}</div>`;

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
export const dayText = (ms) => DAY.format(new Date(Number(ms) || 0));

const PAGE_CSS = `
html{color-scheme:light dark}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.sch-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:14px 28px;border-bottom:1px solid var(--line);background:var(--sheet)}
.sch-head h1{margin:0;font:600 16px/1.3 var(--sans);min-width:0;overflow-wrap:anywhere;flex:1 1 240px}
.sch-head span{color:var(--mute);font-size:13px}
.sch-main{flex:1}
.sch-day{align-self:center;margin:18px 0 4px;color:var(--mute);font-size:12px}
.sch-empty{color:var(--mute);text-align:center;padding:48px 16px}
.sch-foot{text-align:center;color:var(--mute);font-size:12px;padding:10px 16px 18px}
.msgs .bubble .body .chat-code-block{padding-top:12px}
.msgs .bubble .body pre{margin:0;overflow-x:auto}
.msgs .bubble .body a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.sch-label{color:var(--mute);font-size:12px;font-weight:500;margin:0 0 4px 6px}
.sch-quote{max-width:min(86%,420px);margin:0 0 4px;padding:4px 10px;border-left:3px solid var(--line2);color:var(--mute);font-size:13px;line-height:1.4;overflow-wrap:anywhere}
.msgs .body img{max-width:120px;max-height:120px}
.msgs .bubble .body blockquote{margin:.65em 0;padding-left:12px;border-left:3px solid var(--line2);color:var(--ink2)}
.msgs .bubble .body hr{border:0;border-top:1px solid var(--line2);margin:1em 0}
@media (max-width:767px){.sch-head{padding:12px 16px}}
`;

const TOKENS = `:root{--page:#f3f2ef;--sheet:#fff;--chip:#fff;--hover:#e9e8e4;--line:#e7e5e0;--line2:#d9d6cf;--ink:#1c1b19;--ink2:#44423d;--mute:#77746c;--faint:#a8a49b;--abub:#f3f2ef;--ubub:var(--ink);--uink:var(--sheet);--accent:var(--ink);--shadow:0 1px 2px rgba(28,27,25,.04),0 4px 16px rgba(28,27,25,.06);--sans:"Instrument Sans",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--serif:"Instrument Serif","Iowan Old Style",Georgia,serif}
@media (prefers-color-scheme:dark){:root{--page:#121212;--sheet:#1b1b1c;--chip:#262628;--hover:#202022;--line:#2a2a2c;--line2:#38383b;--ink:#f1f0ee;--ink2:#cfcdc8;--mute:#96938c;--faint:#65635e;--abub:#262628;--ubub:#f1f0ee;--uink:#1b1b1c;--shadow:0 1px 2px rgba(0,0,0,.3),0 4px 16px rgba(0,0,0,.25)}}
@font-face{font-family:"Instrument Sans";src:url("/fonts/instrument-sans.woff2") format("woff2");font-weight:400 700;font-display:swap}
@font-face{font-family:"Instrument Serif";src:url("/fonts/instrument-serif.woff2") format("woff2");font-weight:400;font-display:swap}
*{box-sizing:border-box}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
`;

// snapshot → the whole page. base: the path the pictures live under ("<address>/c/<token>", relative is fine).
export function renderChatPage(snap, { base = "" } = {}) {
  const title = str(snap.title).trim() || "Chat";
  let lastDay = "", html = "";
  const msgs = snap.messages || [];
  msgs.forEach((m, i) => {
    const day = m.at ? dayText(m.at) : "", newDay = !!day && day !== lastDay;
    if (newDay) { html += `<time class="sch-day" datetime="${esc(new Date(m.at).toISOString().slice(0, 10))}">${esc(day)}</time>`; lastDay = day; }
    const first = !msgs[i - 1] || msgs[i - 1].role !== m.role || newDay;
    const imgs = (m.items || []).filter((it) => it.k === "img" && Number.isInteger(it.n));
    const tiles = (m.items || []).filter((it) => !(it.k === "img" && Number.isInteger(it.n)));
    if (m.role === "user") {
      const all = [...imgs, ...tiles];
      html += `<div class="m user${first ? " first" : ""}">${m.quote ? `<div class="sch-quote">${esc(m.quote)}</div>` : ""}${all.length ? `<div class="mfiles">${all.map((it) => tile(it, base, true)).join("")}</div>` : ""}${m.text.trim() ? `<div class="bubble">${esc(m.text)}</div>` : ""}</div>`;
    } else {
      const shots = imgs.filter((it) => it.shot), pics = imgs.filter((it) => !it.shot);
      const grid = [...pics.map((it) => tile(it, base, false)), ...tiles.map((it) => tile(it, base, false))];
      html += `<div class="m agent${first ? " first" : ""}">${m.label && (m.text.trim() || shots.length || grid.length) ? `<div class="sch-label">${esc(m.label)}</div>` : ""}${m.text.trim() ? `<div class="reply-slot"><div class="bubble"><div class="body">${renderMarkdown(m.text)}</div></div></div>` : ""}${shots.map((it) => shot(it, base)).join("")}${grid.length ? `<div class="chat-file-grid">${grid.join("")}</div>` : ""}</div>`;
    }
  });
  if (!html) html = `<p class="sch-empty">There are no messages in this chat yet.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<style>${TOKENS}${CHAT_CSS}${PAGE_CSS}</style></head>
<body><header class="sch-head"><h1>${esc(title)}</h1><span>Shared on ${esc(dayText(snap.shared_at))}</span></header><main class="sch-main"><div class="msgs">${html}</div></main><footer class="sch-foot">A copy of a chat shared from 1Helm. Messages sent after it was shared are not included.</footer></body></html>`;
}

export const CHAT_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const chatHeaders = (extra = {}) => ({ "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": CHAT_PAGE_CSP, ...extra });
