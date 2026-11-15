// Notebook article editing in place. The page is drawn from Markdown, the person edits the drawn text, and this file turns the edited HTML back into
// Markdown. It covers exactly what a page uses: paragraphs, line breaks, bold, italic, inline code, links, bullet and numbered lists (one level of
// nesting), and sub-headings. A section that holds anything else (tables, quotes, code blocks, images) is reported by wkRichOk so it keeps the plain editor.

const OK_TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "A", "UL", "OL", "LI", "CODE", "H3", "H4", "H5", "H6", "DIV", "SPAN"]);
const parse = (h: string): HTMLElement => { const d = new DOMParser().parseFromString(`<body>${h}</body>`, "text/html"); return d.body; };

// True when every element in the HTML is one the in-place editor can turn back into Markdown.
export function wkRichOk(html: string): boolean {
  const body = parse(html); return ![...body.querySelectorAll("*")].some(e => !OK_TAGS.has(e.tagName));
}

// Characters that would start Markdown formatting are escaped, so typed text never becomes formatting by accident. An underscore inside a word is
// left alone because Markdown does not read it as emphasis, and that keeps words like portfolio_site unchanged.
const esc = (t: string) => t.replace(/[\\`[\]<*_]|&(?=#?\w+;)/g, (m, o: number) => {
  if (m !== "*" && m !== "_") return `\\${m}`;
  const a = t[o - 1], b = t[o + 1], space = (c?: string) => c !== undefined && /\s/.test(c);
  if (space(a) && space(b)) return m;   // a lone * or _ between spaces can't open or close emphasis
  return m === "_" && /[A-Za-z0-9]/.test(a ?? "") && /[A-Za-z0-9]/.test(b ?? "") ? m : `\\${m}`;   // an underscore inside a word is not emphasis
});
// A line that begins like a heading, list or quote would turn into one, so its first character is escaped.
const lineStart = (l: string) => l.replace(/^(#{1,6} )/, "\\$1").replace(/^([-+*] )/, "\\$1").replace(/^(>)/, "\\$1").replace(/^(\d+)([.)] )/, "$1\\$2");
const squash = (t: string) => t.replace(/[\s\u00a0]+/g, " ");

// A mark wraps the text, but the spaces at its ends stay outside, because "** x**" is not bold in Markdown.
function wrap(s: string, m: string): string {
  const core = s.replace(/^\s+|\s+$/g, ""); if (!core) return s;
  const a = /^\s+/.exec(s)?.[0] ?? "", b = /\s+$/.exec(s)?.[0] ?? ""; return `${a}${m}${core}${m}${b}`;
}
const urlOut = (u: string) => /[\s()<>]/.test(u) ? `<${u.replace(/[<>]/g, encodeURIComponent)}>` : u;

function inline(n: Node): string {
  if (n.nodeType === 3) return esc(squash(n.textContent || ""));
  if (n.nodeType !== 1) return "";
  const e = n as HTMLElement, tag = e.tagName, kids = () => [...e.childNodes].map(inline).join("");
  if (tag === "BR") return "\n";
  if (tag === "STRONG" || tag === "B") return wrap(kids(), "**");
  if (tag === "EM" || tag === "I") return wrap(kids(), "*");
  if (tag === "CODE") { const t = squash(e.textContent || ""), f = t.includes("`") ? "``" : "`"; return t.trim() ? `${f}${t}${f}` : ""; }
  if (tag === "A") {
    const href = e.getAttribute("href") || "", text = e.textContent || "";
    if (!href) return kids();
    if (text === href || `mailto:${text}` === href) return text;   // a bare address stays a bare address
    const inner = kids(); return inner.trim() ? `[${inner}](${urlOut(href)})` : "";
  }
  return kids();
}
// Text of one paragraph: spaces collapsed, no space around a line break, no blank lines.
const para = (nodes: Node[]) => nodes.map(inline).join("").split("\n").map(l => l.replace(/ {2,}/g, " ").trim()).join("\n").replace(/^\n+|\n+$/g, "").replace(/\n{2,}/g, "\n").split("\n").map(lineStart).join("\n");

const BLOCK = new Set(["P", "UL", "OL", "LI", "DIV", "H3", "H4", "H5", "H6"]);
function list(e: HTMLElement, indent: string): string {
  const ord = e.tagName === "OL", start = ord ? Number(e.getAttribute("start")) || 1 : 0, out: string[] = [];
  [...e.children].filter(c => c.tagName === "LI").forEach((li, i) => {
    const mark = ord ? `${start + i}. ` : "- ", pad = " ".repeat(mark.length), inl: Node[] = [], subs: string[] = [];
    for (const c of li.childNodes) { if (c.nodeType === 1 && /^(UL|OL)$/.test((c as HTMLElement).tagName)) subs.push(list(c as HTMLElement, indent + pad)); else if (c.nodeType === 1 && (c as HTMLElement).tagName === "P") { if (inl.length) inl.push(document.createElement("br")); inl.push(...(c as HTMLElement).childNodes); } else inl.push(c); }
    const t = para(inl); if (!t && !subs.length) return;
    out.push(`${indent}${mark}${t.replace(/\n/g, `\n${indent}${pad}`)}`, ...subs);
  });
  return out.join("\n");
}
function blocks(root: Node): string[] {
  const out: string[] = []; let buf: Node[] = [];
  const flush = () => { const t = para(buf); if (t) out.push(t); buf = []; };
  for (const c of root.childNodes) {
    const e = c as HTMLElement, tag = c.nodeType === 1 ? e.tagName : "";
    if (!BLOCK.has(tag)) { buf.push(c); continue; }
    flush();
    if (tag === "UL" || tag === "OL") { const l = list(e, ""); if (l) out.push(l); }
    else if (/^H[3-6]$/.test(tag)) { const t = para([...e.childNodes]); if (t) out.push(`${"#".repeat(Number(tag[1]))} ${t.replace(/\n/g, " ")}`); }
    else if ([...e.children].some(k => BLOCK.has(k.tagName))) out.push(...blocks(e));
    else { const t = para([...e.childNodes]); if (t) out.push(t); }
  }
  flush(); return out;
}
// The Markdown for the edited HTML (an element, or a string of HTML).
export function wkMdFromHtml(src: Node | string): string {
  return blocks(typeof src === "string" ? parse(src) : src).join("\n\n");
}
