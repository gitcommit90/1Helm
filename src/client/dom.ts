export type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper. Attributes: on* = listeners, class/style/dataset/value/checked handled. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in e) (e as any)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c as Node | string);
  return e;
}

export const clear = (n: Node): void => { while (n.firstChild) n.removeChild(n.firstChild); };
export const add = (parent: ParentNode, ...children: Child[]): void => { for (const c of children.flat()) if (c != null && c !== false) parent.append(c as Node | string); };
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Minimal, safe Markdown → HTML (escapes first, then applies formatting). */
export type ChannelLink = { name: string; slug: string };

/** Inline formatting (applied to already HTML-escaped text). */
function inline(s: string, channels?: ChannelLink[]): string {
  let out = s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+?)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+?)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(@[a-zA-Z0-9_.-]+)/g, '$1<span class="font-medium text-accent">$2</span>');
  if (channels?.length) out = linkifyChannelMentions(out, channels);
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Turn known #channel / #slug tokens into SPA-friendly hyperlinks (Slack/Mattermost style). */
export function linkifyChannelMentions(html: string, channels: ChannelLink[]): string {
  const byKey = new Map<string, ChannelLink>();
  for (const channel of channels) {
    if (!channel?.name || !channel?.slug) continue;
    byKey.set(String(channel.name).toLowerCase(), channel);
    byKey.set(String(channel.slug).toLowerCase(), channel);
  }
  if (!byKey.size) return html;
  // Longest keys first so #career-advice beats a shorter prefix if one ever appears.
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(^|[\\s>(])#(${keys.map(escapeRegExp).join("|")})(?![a-zA-Z0-9_-])`, "gi");
  return html.replace(pattern, (full, pre: string, token: string) => {
    const channel = byKey.get(token.toLowerCase());
    if (!channel) return full;
    const href = `/c/${encodeURIComponent(channel.slug)}/chat`;
    return `${pre}<a href="${href}" class="channel-mention font-medium text-accent" data-channel-slug="${esc(channel.slug)}">#${esc(channel.name)}</a>`;
  });
}
const splitRow = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Lightweight, safe Markdown → HTML: headings, lists (ul/ol), tables, quotes, code, hr, inline. */
export function md(src: string, opts?: { channels?: ChannelLink[] }): string {
  const channels = opts?.channels;
  const fmt = (text: string): string => inline(text, channels);
  const blocks: string[] = [];
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => { blocks.push(`<pre><code>${esc(String(code).replace(/\n$/, ""))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = esc(s);
  const lines = s.split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const closeList = (): void => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushPara = (): void => { if (para.length) { out.push(`<p>${para.map(fmt).join("<br>")}</p>`); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\u0000\d+\u0000$/.test(line)) { flushPara(); closeList(); out.push(line); continue; }
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    // Headings intentionally skip channel linkify so "# Deploy Runbook" stays a title.
    if (head) { flushPara(); closeList(); const l = head[1].length; out.push(`<h${l}>${inline(head[2])}</h${l}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); closeList(); out.push("<hr>"); continue; }
    // GFM table: header row followed by a |---|---| separator
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]*-{1,}[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("|")) {
      flushPara(); closeList();
      const header = splitRow(line); i++;
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim() !== "") rows.push(splitRow(lines[++i]));
      out.push(`<table><thead><tr>${header.map((c) => `<th>${fmt(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { flushPara(); if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${fmt(ul[1])}</li>`); continue; }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { flushPara(); if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${fmt(ol[1])}</li>`); continue; }
    const bq = line.match(/^\s*&gt;\s?(.*)$/);
    if (bq) { flushPara(); closeList(); out.push(`<blockquote>${fmt(bq[1])}</blockquote>`); continue; }
    if (line.trim() === "") { flushPara(); closeList(); continue; }
    closeList(); para.push(line);
  }
  flushPara(); closeList();
  return out.join("\n").replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
}

/* Restrained stone/ink identity tones — high-contrast monogram fields. */
const PALETTE = ["#c8552f", "#3f5f73", "#8a5a3b", "#6b4f63", "#2f6b57", "#5c5346"];
export const color = (seed: string): string => PALETTE[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
export const initials = (name: string): string => name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/** Compact helm-wheel brand mark used across auth, shell, wizard, and empty states. */
export function helmMark(size = 18): SVGElement {
  return icon("helm", size);
}

/** Provider brand mark — real logos from /brand/providers when available. */
export function providerMark(kind: string, size = 16): HTMLElement {
  const key = String(kind || "custom").toLowerCase();
  const map: Record<string, string> = {
    chatgpt: "chatgpt", codex: "chatgpt", openai: "chatgpt",
    claude: "claude", anthropic: "claude",
    antigravity: "antigravity", gemini: "antigravity", google: "antigravity",
    xai: "xai", grok: "xai",
    openrouter: "openrouter",
    nvidia: "nvidia", cloudflare: "cloudflare", glm: "glm",
    custom: "custom", "openai-compat": "custom", routing: "custom",
  };
  const file = map[key] || "custom";
  const img = document.createElement("img");
  img.src = `/brand/providers/${file}.svg`;
  img.alt = key;
  img.width = size;
  img.height = size;
  img.decoding = "async";
  img.className = "provider-brand-mark";
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;
  img.style.objectFit = "contain";
  img.style.display = "block";
  // Fallback drawn glyph if asset 404s
  img.onerror = () => {
    img.onerror = null;
    const wrap = img.parentElement;
    const fallback = icon(key === "openrouter" ? "openrouter" : key === "chatgpt" || key === "codex" ? "chatgpt" : "api", size);
    if (wrap) { img.replaceWith(fallback); }
  };
  return img;
}

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.getTime() >= today.getTime() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
}
export const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();
export function dayLabel(ts: number): string {
  const d = new Date(ts); const today = new Date(); const yest = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

const ICONS: Record<string, string> = {
  menu: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 009 19.4a1.6 1.6 0 00-1.8.3l.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  thread: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4L3 21l1.1-3.2A8.4 8.4 0 1121 11.5z"/>',
  file: '<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  paperclip: '<path d="M21.4 11.05l-8.5 8.5a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
  splitRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/>',
  splitDown: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  /* Helm wheel: outer rim, hub, six spokes. */
  helm: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.8v3.2M12 17v3.2M3.8 12h3.2M17 12h3.2M6.1 6.1l2.3 2.3M15.6 15.6l2.3 2.3M6.1 17.9l2.3-2.3M15.6 8.4l2.3-2.3"/>',
  openrouter: '<path d="M5 16l7-10 7 10"/><path d="M8.5 16h7"/><circle cx="12" cy="7" r="1.2"/>',
  chatgpt: '<path d="M8.2 8.4a3.4 3.4 0 015.7-2.4 3.5 3.5 0 014.8 3.7 3.4 3.4 0 01-1.4 5.9 3.4 3.4 0 01-5.7 2.4 3.5 3.5 0 01-4.8-3.7A3.4 3.4 0 018.2 8.4z"/><path d="M9.4 10.8h5.2M9.4 13.2h3.6"/>',
  api: '<path d="M8 7h8M8 12h8M8 17h8"/><circle cx="7" cy="7" r="1.4"/><circle cx="17" cy="12" r="1.4"/><circle cx="7" cy="17" r="1.4"/>',
  hash: '<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="10" y1="4" x2="7" y2="20"/><line x1="17" y1="4" x2="14" y2="20"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
export function icon(name: keyof typeof ICONS | string, size = 16): SVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", String(size)); s.setAttribute("height", String(size));
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.style.display = "inline-block";
  s.innerHTML = ICONS[name] || "";
  return s;
}

let audioCtx: AudioContext | null = null;
export type NotificationSound = "helm" | "bell" | "chime" | "pulse";
/** Synthesized notification chirp — no asset files needed. */
export function beep(kind: "msg" | "mention" = "msg", sound: NotificationSound = "helm"): void {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    const voices: Record<NotificationSound, { notes: number[]; wave: OscillatorType; gap: number; duration: number; gain: number }> = {
      helm: { notes: kind === "mention" ? [880, 1320] : [660, 990], wave: "sine", gap: 0.09, duration: 0.16, gain: 0.12 },
      bell: { notes: kind === "mention" ? [1046.5, 1568] : [1046.5], wave: "triangle", gap: 0.13, duration: 0.32, gain: 0.1 },
      chime: { notes: kind === "mention" ? [659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99], wave: "sine", gap: 0.075, duration: 0.22, gain: 0.09 },
      pulse: { notes: kind === "mention" ? [587.33, 783.99] : [440, 587.33], wave: "square", gap: 0.065, duration: 0.1, gain: 0.045 },
    };
    const voice = voices[sound] || voices.helm;
    voice.notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = voice.wave; osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * voice.gap;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(voice.gain, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + voice.duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + voice.duration + 0.02);
    });
  } catch { /* audio not available */ }
}
