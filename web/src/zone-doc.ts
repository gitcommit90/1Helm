// Zone helpers that need no page and no network: which Library files the Zone can open, how a deck file is built (a shell page whose script
// holds the template's whole document as one string), and the labels and element paths the Zone and the server agree on.
// The server (1HC src/zone-edit.js) finds an element the same way: a slide is the element with data-hc-slide="<index>", an element is its
// data-slot (and which one of that slot, n), or "sel", the 0-based index among ELEMENT children at each level from the slide root (or from <body>
// of a plain page). The in-frame script (zone-bridge.ts) builds these values, so a selection and an edit always name the same element.

export type ZKind = "deck" | "page" | "report" | "doc";
export type ZFile = { name?: string; mime?: string; tags?: string[] };

/** deck: an HTML deck (the Library tag "deck", set when share_file gives the files make_deck.sh built); page: any other .html; report: a PDF; doc: a Word document (shown through the server's PDF preview of it). */
export function zoneKind(f: ZFile | null | undefined): ZKind | null {
  const n = f?.name || "";
  if (/\.html?$/i.test(n)) return f?.tags?.includes("deck") ? "deck" : "page";
  if (/\.(docx|docm|doc|odt|rtf)$/i.test(n)) return "doc";
  if (/\.pdf$/i.test(n) || f?.mime === "application/pdf") return "report";
  return null;
}

// A deck is `var DOC = "<json string>";` inside the shell. assemble_deck.mjs writes the string with JSON.stringify and then escapes "</" and "<!--"
// (and U+2028/9) so the page can hold it. These two functions read and write that exact form.
const LSEP = new RegExp("[\\u2028\\u2029]", "g");
export const asJs = (s: string) => JSON.stringify(s).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--").replace(LSEP, c => "\\u" + c.charCodeAt(0).toString(16));
export function deckParts(text: string): { pre: string; doc: string; post: string } | null {
  const k = text.indexOf("var DOC = "); if (k < 0) return null;
  const i = k + 10; if (text[i] !== '"') return null;
  let j = i + 1; while (j < text.length) { const c = text[j]; if (c === "\\") { j += 2; continue; } if (c === '"') break; j++; }
  if (j >= text.length) return null;
  try { return { pre: text.slice(0, i), doc: JSON.parse(text.slice(i, j + 1).replace(/<\\!--/g, "<!--")), post: text.slice(j + 1) }; } catch { return null; }
}
const before = (html: string, tag: string, add: string) => { const i = html.toLowerCase().lastIndexOf(tag); return i < 0 ? html + add : html.slice(0, i) + add + html.slice(i); };
const inScript = (js: string) => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`;

/**
 * What the Zone puts in the frame. A deck: the in-frame script goes into the template's document and a small relay into the shell (the template's
 * document is a frame of its own, in another origin, so it can only talk to the shell). A page: the script goes at the end of the page.
 * Nothing is saved: this text is only what the frame shows.
 */
export function patchForZone(kind: ZKind, text: string, js: { bridge: string; relay: string; css?: string }): string | null {
  if (kind === "page") return before(text, "</body>", inScript(js.bridge));
  const p = deckParts(text); if (!p) return null;
  const doc = before(p.doc, "</body>", inScript(js.bridge));
  const shell = before(p.pre + asJs(doc) + p.post, "</body>", (js.css ? `<style>${js.css}</style>` : "") + inScript(js.relay));
  return shell;
}

/** One slide of a deck as a page of its own (for the strip's small pictures): the template's document, the slide shown, nothing moving. */
export function thumbDoc(text: string, index: number): string | null {
  const p = deckParts(text); if (!p) return null;
  const js = `(function(){var k=${index | 0};function go(){var d=document;for(var i=0;i<k;i++){d.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))}}if(document.readyState==="complete")go();else addEventListener("load",go)})();`;
  const css = `<style>*,*::before,*::after{transition:none!important;animation:none!important}html,body{overflow:hidden!important}</style>`;
  return before(before(p.doc, "</head>", css), "</body>", inScript(js));
}

// ---- what a person reads: the element's name ----
const SLOT: Record<string, string> = { title: "Title", body: "Body text", media: "Picture box", label: "Label", problem: "Problem", built: "What was built", impact: "Impact", stat1: "Figure 1", stat2: "Figure 2", stat1_label: "Figure 1 label", stat2_label: "Figure 2 label", "stat1-box": "Figure 1", "stat2-box": "Figure 2" };
export function labelFor(o: { slot?: string | null; tag: string; text?: string }): string {
  if (o.slot) return SLOT[o.slot] || o.slot.replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());
  const t = o.tag.toLowerCase();
  if (/^h[1-6]$/.test(t)) return "Heading";
  if (t === "img") return "Picture";
  if (t === "svg" || t === "canvas") return "Graphic";
  if (t === "button" || t === "a") return "Button";
  const w = (o.text || "").replace(/\s+/g, " ").trim();
  if (w) return w.length > 24 ? w.slice(0, 23).trimEnd() + "…" : w;
  return "Shape";
}
export const chipLabel = (kind: ZKind, slide: number | null, of: number | null, el: string | null) =>
  [slide ? `${kind === "deck" ? "Slide" : "Page"} ${slide}` : "", el || ""].filter(Boolean).join(" · ") || (kind === "report" ? "Report" : kind === "doc" ? "Document" : kind === "deck" ? "Deck" : "Page");
/** Words that can be edited in place: a .docx (a .doc, .odt or .rtf opens, but only the helper can change it). */
export const docEditable = (name: string | undefined) => /\.(docx|docm)$/i.test(name || "");
