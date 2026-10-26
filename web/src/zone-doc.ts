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

/**
 * Code that finds content a template keeps invisible until an entrance animation reveals it, and that no animation is going to reveal (the
 * element still has opacity 0, nothing is running on it, and its name, class or attributes say it is an entrance effect: data-anim, data-delay,
 * "reveal", "fade", "stagger" and so on). A template whose animation rule covers only some values of its attribute (an item with a delay or an
 * effect name the style sheet does not define) leaves that item blank for good. The same text is in the in-frame script (zone-bridge.ts) and in
 * the deck's own bridge (deck_bridge.js in 1HC), so a deck shows every item in the Zone, in the strip and in Present.
 */
export const UNSTICK_JS = `function unstick(s){var all=s?s.querySelectorAll("*"):[],n=0;for(var i=0;i<all.length;i++){var e=all[i];if(e.hasAttribute("data-hc-unstuck")||/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(e.tagName))continue;
var cs=getComputedStyle(e);if(cs.opacity!=="0"||cs.display==="none"||cs.visibility==="hidden")continue;if(e.getAnimations&&e.getAnimations().length)continue;
var h=e.className&&e.className.baseVal!==undefined?e.className.baseVal:String(e.className||"");for(var j=0;j<e.attributes.length;j++)h+=" "+e.attributes[j].name+" "+e.attributes[j].value.slice(0,40);
if(!/anim|delay|reveal|fade|stagger|enter|appear|aos|wow|in-view/i.test(h))continue;
if(!(e.textContent.trim()||e.querySelector("img,svg,canvas,video")||/^(IMG|SVG|CANVAS|VIDEO)$/i.test(e.tagName)))continue;
e.setAttribute("data-hc-unstuck","");e.style.setProperty("opacity","1","important");n++}return n}`;

/**
 * One slide of a deck as a page of its own (for the strip's small pictures): the template's document, the slide shown, every item showing, nothing moving.
 * The script steps the template to slide k with the arrow keys, one press at a time and only when the slide shown has not changed (a template ignores a key
 * while its own move is running, so a row of presses would reach only the first slide), then jumps every animation that ends to its end (an item a
 * template starts invisible and an entrance animation shows would stay blank otherwise) and pauses the ones that never end. The page is transparent
 * until then, so a small picture never shows a slide half way in.
 */
export function thumbDoc(text: string, index: number): string | null {
  const p = deckParts(text); if (!p) return null;
  const js = `(function(){var k=${index | 0},d=document,r=d.documentElement,t0=Date.now(),tries=0,W=window.__hcst||setTimeout;r.style.opacity="0";
function sl(){return [].slice.call(d.querySelectorAll("[data-hc-slide]"))}
function shown(){var s=sl(),i;for(i=0;i<s.length;i++)if(/(^|\s)(active|is-active|current)(\s|$)/.test(s[i].className))return i;
 var best=0,area=0;for(i=0;i<s.length;i++){var b=s[i].getBoundingClientRect(),c=getComputedStyle(s[i]);if(c.visibility==="hidden"||c.display==="none"||+c.opacity<=.5)continue;
  var a=Math.max(0,Math.min(b.right,innerWidth)-Math.max(b.left,0))*Math.max(0,Math.min(b.bottom,innerHeight)-Math.max(b.top,0));if(a>area){area=a;best=i}}return best}
${UNSTICK_JS}
function fin(){try{d.getAnimations().forEach(function(a){try{if(isFinite(a.effect.getComputedTiming().endTime))a.finish();else a.pause()}catch(e){}})}catch(e){}}
function show(){fin();unstick(sl()[k]);r.style.opacity=""}
function step(){var c=shown();if(c===k){fin();W(show,120);return}
 if(Date.now()-t0>4000+k*300||tries>k*40+40){show();return}
 tries++;d.dispatchEvent(new KeyboardEvent("keydown",{key:c<k?"ArrowRight":"ArrowLeft",bubbles:true,cancelable:true}));fin();W(step,40)}
function go(){W(step,60)}
if(d.readyState==="complete")go();else addEventListener("load",go);W(function(){r.style.opacity=""},6000+k*400)})();`;
  const css = `<style>*,*::before,*::after{transition:none!important}html,body{overflow:hidden!important}</style>`;
  // A template ignores keys for a while after each move (about a second in some), so the timers it waits on are short here: the picture is of a still slide.
  // window.__hcst keeps the real setTimeout for the script above. This goes in first, before any script of the template.
  const shim = `<script>(function(){var st=window.setTimeout;window.__hcst=st;window.setTimeout=function(f,ms){var a=[].slice.call(arguments,2);return st.apply(window,[f,ms>30?20:ms].concat(a))}})();</script>`;
  const h = /<head[^>]*>/i.exec(p.doc), doc = h ? p.doc.slice(0, h.index + h[0].length) + shim + p.doc.slice(h.index + h[0].length) : shim + p.doc;
  return before(before(doc, "</head>", css), "</body>", inScript(js));
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
