// Markdown to plain text for places that cannot show it: push notification titles and bodies, text messages.
// Keeps the words, drops the syntax. A lone "*" with spaces around it (math, e.g. "2 * 3") is kept.
export function plainText(input) {
  let s = String(input ?? "").replace(/\r\n?/g, "\n");
  const esc = []; s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, (_, c) => `\uE000${esc.push(c) - 1}\uE001`);   // escaped characters stay literal
  s = s.replace(/```[^\n]*\n?([\s\S]*?)(```|$)/g, "$1");                 // code fences: keep the code
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^<>\n]*>/g, "");   // HTML comments and tags
  s = s.replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1");                    // images: alt text
  s = s.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1").replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/g, "$1");   // links and reference links: text
  s = s.replace(/^[ \t]*\[[^\]\n]+\]:[ \t]+\S+.*$/gm, "");               // link reference definitions
  s = s.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "");                    // horizontal rules
  s = s.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, "");   // table separator rows
  s = s.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, r) => r.split("|").map((c) => c.trim()).filter(Boolean).join(" "));   // table rows
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "").replace(/[ \t]+#+[ \t]*$/gm, "");   // headings
  s = s.replace(/^[ \t]*(?:>[ \t]?)+/gm, "");                            // blockquotes
  s = s.replace(/^[ \t]*(?:[-+*•][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,3}[.)][ \t]+)/gm, "");   // list markers and task boxes
  s = s.replace(/`+([^`\n]+)`+/g, "$1").replace(/`+/g, "");              // inline code
  s = s.replace(/~~([^~\n]+)~~/g, "$1");                                  // strikethrough
  for (let i = 0; i < 2; i++) {                                           // emphasis, also nested (***x***, **_x_**)
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, "$1")
      .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w])/g, "$1$2");
  }
  s = s.replace(/\uE000(\d+)\uE001/g, (_, i) => esc[Number(i)]);
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// One line for a notification: plain text first, then whitespace folded, then cut to max.
export function plainLine(input, max = 140) { return plainText(input).replace(/\s+/g, " ").trim().slice(0, max); }
