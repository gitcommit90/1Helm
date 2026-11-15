import type { MarkedExtension } from "marked";
// LaTeX in a reply: $..$ and \(..\) inline, $$..$$ and \[..\] display. A $ opens math only when a non-space follows it and closes it only after a non-space and
// before a non-digit, so "$5 and $10" stays text. Code spans and blocks are tokenized by marked before this runs, so they are never touched.
const RULES: [RegExp, boolean][] = [[/^\$\$([\s\S]+?)\$\$/, true], [/^\\\[([\s\S]+?)\\\]/, true], [/^\\\(([\s\S]+?)\\\)/, false], [/^\$(?!\s)((?:\\.|[^\\$`\n])*?(?:\\.|[^\s\\$`]))\$(?!\d)/, false]];
export const mathMatch = (src: string) => { for (const [re, d] of RULES) { const m = re.exec(src); if (m) return { raw: m[0], tex: m[1].trim(), display: d }; } };
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
export const mathExt: MarkedExtension = { extensions: [{
  name: "math", level: "inline",
  start: (src: string) => src.search(/\\[$(\[]|\$/) < 0 ? undefined : src.search(/\\[$(\[]|\$/),
  tokenizer: (src: string) => { const m = mathMatch(src); return m && { type: "math", ...m }; },
  renderer: (t: any) => `<span class="tex${t.display ? " d" : ""}" data-t="${esc(t.tex)}">${esc(t.raw)}</span>`,
}] };
// The reply HTML holds each formula as plain text in span.tex. Once Temml is loaded the observer swaps in MathML before the next paint, so a repaint
// while streaming does not flash the source; until then (or when Temml rejects a formula) the original text stays.
let tex: ((s: string, d: boolean) => string) | null = null, loading = false;
const paint = () => {
  const els = document.querySelectorAll<HTMLElement>("span.tex:not([data-ok])"); if (!els.length) return;
  if (!tex) {
    if (!loading) { loading = true; import(/* @vite-ignore */ new URL(`math.js?v=${encodeURIComponent(String((window as any).__1HC?.v || ""))}`, import.meta.url).href).then(m => { tex = m.default; paint(); }, () => {}); }
    return;
  }
  for (const el of els) { el.dataset.ok = "1"; try { el.innerHTML = tex(el.dataset.t!, el.classList.contains("d")); } catch { /* keeps the original text */ } }
};
export const initChatMath = () => new MutationObserver(paint).observe(document.body, { childList: true, subtree: true });
