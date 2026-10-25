// Reads one slide of a built deck, inside Chrome, into a flat list of things PowerPoint can hold: text boxes (with runs, font, size,
// colour, alignment), rectangles (fill, line, rounded corners, a hard shadow as a second rectangle), pictures and empty picture
// boxes. What PowerPoint can't draw is marked as a picture to cut from the page (gradients, background images, blurs, soft shadows,
// CSS-drawn marks, SVG, canvas): export_pptx.mjs captures each one with its own paint only, so the text over it stays editable.
// A module the scripts load; you don't run it.

if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

// Runs in the page. index: 0-based slide. Returns { items, pics, fonts }. All coordinates are px on the 1920x1080 slide.
export function extractSlide(index) {
  const slide = document.querySelectorAll("[data-hc-slide]")[index];
  const SR = slide.getBoundingClientRect();
  const items = [], pics = [], fonts = new Set();
  const num = (v) => parseFloat(v) || 0;
  const rel = (r) => ({ x: r.left - SR.left, y: r.top - SR.top, w: r.width, h: r.height });
  const color = (c) => {
    const m = String(c).match(/^(?:rgba?|color\(srgb)\s*\(?([^)]*)\)?$/i);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    const scale = /^color/i.test(c) ? 255 : 1;
    return { r: Math.round(p[0] * scale), g: Math.round(p[1] * scale), b: Math.round(p[2] * scale), a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""}`;
  // Rotation of an element in degrees, from its own and its ancestors' transforms (null when a transform is more than a rotation).
  const rotation = (el) => {
    let m = new DOMMatrix();
    for (let a = el; a && a !== slide; a = a.parentElement) { const t = getComputedStyle(a).transform; if (t && t !== "none") m = new DOMMatrix(t).multiply(m); }
    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
    if (Math.abs(sx - 1) > 0.05 || Math.abs(sy - 1) > 0.05 || Math.abs(m.a * m.c + m.b * m.d) > 0.05) return null;
    return Math.abs(m.b) < 1e-4 && m.a > 0 ? 0 : (Math.atan2(m.b, m.a) * 180) / Math.PI;
  };
  const zOf = (el) => { for (let a = el; a; a = a.parentElement) { const z = getComputedStyle(a).zIndex; if (z !== "auto") return num(z); if (a === slide) break; } return 0; };
  let seq = 0;
  const push = (it, el) => { it.z = zOf(el); it.seq = seq++; items.push(it); };

  // Why an element's own paint can't be a plain rectangle, or null when it can.
  const complexity = (el, cs) => {
    if (cs.backgroundImage && cs.backgroundImage !== "none") return /gradient/.test(cs.backgroundImage) ? "gradient" : "background image";
    for (const p of ["filter", "backdropFilter", "clipPath", "maskImage", "webkitMaskImage"]) if (cs[p] && cs[p] !== "none") return p === "filter" || p === "backdropFilter" ? "blur or filter" : "mask or clip";
    if (cs.mixBlendMode && cs.mixBlendMode !== "normal") return "blend mode";
    if (rotation(el) === null) return "scaled or skewed";
    for (const ps of ["::before", "::after"]) {
      const s = getComputedStyle(el, ps), c = s.content;
      if (!c || c === "none" || c === "normal" || s.display === "none") continue;
      const bg = color(s.backgroundColor), bd = ["Top", "Right", "Bottom", "Left"].some((k) => num(s["border" + k + "Width"]) > 0 && color(s["border" + k + "Color"])?.a > 0.05);
      const txt = c.replace(/^["']|["']$/g, "").trim();
      if ((bg && bg.a > 0.05) || (s.backgroundImage && s.backgroundImage !== "none") || bd || (txt && txt !== "counter" && !/^counter/.test(txt))) return "drawn by CSS";
    }
    return null;
  };
  const softShadow = (cs) => {
    if (!cs.boxShadow || cs.boxShadow === "none") return null;
    const m = cs.boxShadow.match(/^(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+([-\d.]+)px)?/);
    return m ? { c: color(m[1]), dx: num(m[2]), dy: num(m[3]), blur: num(m[4]), spread: num(m[5]) } : { unknown: true };
  };

  const isInline = (cs) => cs.display === "inline" || cs.display === "contents";
  const textOf = (n, cs) => {
    let t = n.nodeValue.replace(/[ \t\n\r\f]+/g, " ");
    if (cs.textTransform === "uppercase") t = t.toUpperCase(); else if (cs.textTransform === "lowercase") t = t.toLowerCase();
    else if (cs.textTransform === "capitalize") t = t.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
    return t;
  };

  // The text of one block: runs gathered from its text nodes and inline children, a line break for each <br>.
  function textBlock(block) {
    const runs = [], rects = [];
    const visit = (node, inh) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) {
          const cs = getComputedStyle(ch.parentElement);
          if (cs.visibility === "hidden") continue;
          const t = textOf(ch, cs);
          if (!t.trim() && !runs.length) continue;
          const r = document.createRange(); r.selectNodeContents(ch);
          for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rects.push(q);
          const col = color(cs.webkitTextFillColor && cs.webkitTextFillColor !== "rgba(0, 0, 0, 0)" ? cs.webkitTextFillColor : cs.color) || { r: 0, g: 0, b: 0, a: 1 };
          const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
          const gen = (cs.fontFamily.split(",").map((x) => x.replace(/["']/g, "").trim()).reverse().find((x) => /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(x))) || "";
          fonts.add(fam);
          runs.push({ t, font: fam, gen, weight: num(cs.fontWeight), px: num(cs.fontSize), bold: num(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique", underline: /underline/.test(cs.textDecorationLine), color: hex(col), spacing: cs.letterSpacing === "normal" ? 0 : num(cs.letterSpacing) });
        } else if (ch.nodeType === 1) {
          if (ch.tagName === "BR") { runs.push({ br: true }); continue; }
          const cs = getComputedStyle(ch);
          if (cs.display === "none") continue;
          if (isInline(cs) && !ch.hasAttribute("data-hc-media") && !["IMG", "SVG", "svg", "CANVAS"].includes(ch.tagName)) visit(ch, cs);
        }
      }
    };
    visit(block, null);
    while (runs.length && runs[0].t !== undefined && !runs[0].t.trim()) runs.shift();
    while (runs.length && (runs.at(-1).br || (runs.at(-1).t !== undefined && !runs.at(-1).t.trim()))) runs.pop();
    if (runs.length) { runs[0].t = runs[0].t?.replace(/^\s+/, ""); const l = runs.at(-1); if (l.t !== undefined) l.t = l.t.replace(/\s+$/, ""); }
    if (!runs.some((r) => r.t && r.t.trim())) return;
    const cs = getComputedStyle(block);
    if (cs.visibility === "hidden") return;
    let marker = null;
    if (cs.display === "list-item" && cs.listStyleType !== "none") {
      const lis = [...block.parentElement.children].filter((c) => getComputedStyle(c).display === "list-item");
      marker = block.parentElement.tagName === "OL" ? `${lis.indexOf(block) + 1}. ` : "• ";
    }
    // Text set in a vertical writing mode reads top to bottom (or bottom to top for sideways-lr): it is written as a horizontal box turned a quarter turn,
    // so its length is the box's width and PowerPoint's wider font is fitted against that length, not the line's thickness.
    const vertical = /^(vertical|sideways)/.test(cs.writingMode || "") ? (cs.writingMode === "sideways-lr" ? 270 : 90) : 0;
    const rot = ((rotation(block) || 0) + vertical + 360) % 360;
    let box;
    if (vertical) {
      const r = block.getBoundingClientRect(), len = block.offsetHeight, thick = block.offsetWidth;
      box = { x: r.left - SR.left + r.width / 2 - len / 2, y: r.top - SR.top + r.height / 2 - thick / 2, w: len, h: thick };
    } else if (Math.abs(rot) > 0.5) {
      const r = block.getBoundingClientRect();
      const w = block.offsetWidth, h = block.offsetHeight;
      box = { x: r.left - SR.left + (r.width - w) / 2, y: r.top - SR.top + (r.height - h) / 2, w, h };
    } else {
      const u = rects.reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
      box = { x: u.l - SR.left, y: u.t - SR.top, w: u.r - u.l, h: u.b - u.t };
    }
    const lines = new Set(rects.map((r) => Math.round((vertical ? r.left : r.top) / 3))).size;
    // How wide the block itself is, so a box can be wider than the text when the font PowerPoint uses is wider than the page's.
    const br = block.getBoundingClientRect(), maxw = vertical ? box.w : Math.max(0, br.width - num(cs.paddingLeft) - num(cs.paddingRight) - num(cs.borderLeftWidth) - num(cs.borderRightWidth));
    const lh = cs.lineHeight === "normal" ? 0 : num(cs.lineHeight);
    const align = cs.textAlign === "center" ? "center" : cs.textAlign === "right" || cs.textAlign === "end" ? "right" : "left";
    // Where the first line's baseline is on the slide (a zero-size inline box sits on it): the export puts PowerPoint's own font on the same baseline, whatever the font's height.
    let base = null;
    if (!rot) { const probe = document.createElement("span"); probe.style.cssText = "display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline"; block.insertBefore(probe, block.firstChild); base = probe.getBoundingClientRect().bottom - SR.top; probe.remove(); }
    push({ type: "text", ...box, base, maxw, rot, runs: marker ? [{ t: marker, font: runs.find((r) => r.font)?.font, px: runs.find((r) => r.px)?.px, color: runs.find((r) => r.color)?.color, bold: false }, ...runs] : runs, align, lh, lines }, block);
  }

  function ownPaint(el, cs, r) {
    const tag = el.tagName.toLowerCase();
    const pic = (why, own, g) => {
      el.setAttribute("data-hc-pic", String(pics.length));
      const ps = (k) => getComputedStyle(el, k).color;
      pics.push({ ...g, why: `${label(el)}: ${why}`, own, before: ps("::before"), after: ps("::after") });
      push({ type: "picture", pic: pics.length - 1, ...g }, el);
    };
    if (["svg", "canvas", "video"].includes(tag)) return pic(tag === "video" ? "a video" : "a chart or drawing", false, rel(r)), "all";
    if (tag === "img") return pic("an image", false, rel(r)), "all";
    const why = complexity(el, cs);
    if (why) { const pad = 24, g = rel(r); pic(why, true, { x: g.x - pad, y: g.y - pad, w: g.w + 2 * pad, h: g.h + 2 * pad }); return "paint"; }
    const rot = rotation(el) || 0;
    let g = rel(r);
    if (Math.abs(rot) > 0.5) { const w = el.offsetWidth, h = el.offsetHeight; g = { x: g.x + (g.w - w) / 2, y: g.y + (g.h - h) / 2, w, h }; }
    const bg = color(cs.backgroundColor), sh = softShadow(cs);
    if (sh && !sh.unknown && sh.blur === 0 && !sh.spread && sh.c && sh.c.a > 0.05) push({ type: "rect", x: g.x + sh.dx, y: g.y + sh.dy, w: g.w, h: g.h, fill: hex(sh.c), line: null, radius: 0, rot }, el);
    const side = (k) => { const w = num(cs["border" + k + "Width"]), c = color(cs["border" + k + "Color"]); return w > 0 && cs["border" + k + "Style"] !== "none" && c && c.a > 0.05 ? { w, c: hex(c), dash: /dash|dot/.test(cs["border" + k + "Style"]) } : null; };
    const b = { Top: side("Top"), Right: side("Right"), Bottom: side("Bottom"), Left: side("Left") };
    const all = b.Top && b.Right && b.Bottom && b.Left && b.Top.w === b.Left.w && b.Top.c === b.Left.c && b.Right.c === b.Top.c && b.Bottom.c === b.Top.c;
    const radius = Math.min(num(cs.borderTopLeftRadius), Math.min(g.w, g.h) / 2);
    if ((bg && bg.a > 0.05) || all) push({ type: "rect", ...g, fill: bg && bg.a > 0.05 ? hex(bg) : null, line: all ? b.Top : null, radius, rot }, el);
    if (!all) {
      if (b.Top) push({ type: "rect", x: g.x, y: g.y, w: g.w, h: b.Top.w, fill: b.Top.c, line: null, radius: 0, rot: 0 }, el);
      if (b.Bottom) push({ type: "rect", x: g.x, y: g.y + g.h - b.Bottom.w, w: g.w, h: b.Bottom.w, fill: b.Bottom.c, line: null, radius: 0, rot: 0 }, el);
      if (b.Left) push({ type: "rect", x: g.x, y: g.y, w: b.Left.w, h: g.h, fill: b.Left.c, line: null, radius: 0, rot: 0 }, el);
      if (b.Right) push({ type: "rect", x: g.x + g.w - b.Right.w, y: g.y, w: b.Right.w, h: g.h, fill: b.Right.c, line: null, radius: 0, rot: 0 }, el);
    }
    return "shape";
  }

  // The solid colour behind an element: its own, else the nearest ancestor's (the slide's, in the end).
  function backdropOf(el) {
    for (let a = el; a; a = a.parentElement) { const c = color(getComputedStyle(a).backgroundColor); if (c && c.a > 0.95) return hex(c); }
    return null;
  }
  function walk(el) {
    const cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
    if (cs.display === "none" || cs.display === "contents" || ["script", "style", "noscript", "template", "head", "meta", "link"].includes(tag)) return;
    if (num(cs.opacity) < 0.02) return;
    const r = el.getBoundingClientRect();
    if (el.hasAttribute("data-hc-media")) {
      // the box's own text colour and, when it has one, its frame colour, so the label and the dashed frame in the .pptx use the template's colours
      const bd = color(cs.borderTopColor), fg = color(cs.color);
      push({ type: "media", ...rel(r), label: el.textContent.trim(), color: fg ? hex(fg) : null, frame: bd && bd.a > 0.05 && num(cs.borderTopWidth) > 0 ? hex(bd) : null, bg: backdropOf(el) }, el); return;
    }
    if (cs.visibility !== "hidden" && r.width >= 1 && r.height >= 1 && ownPaint(el, cs, r) === "all") return;
    // a block's own text and inline children become one text box; block children are walked on their own
    if (!isInline(cs) && ([...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()) || [...el.children].some((c) => isInline(getComputedStyle(c)) && c.textContent.trim()))) textBlock(el);
    for (const c of el.children) walk(c);
  }
  // The slide's backdrop: its own colour, or the nearest solid colour behind it.
  for (let a = slide; a; a = a.parentElement) {
    const c = color(getComputedStyle(a).backgroundColor);
    if (c && c.a > 0.95) { items.push({ type: "rect", x: 0, y: 0, w: SR.width, h: SR.height, fill: hex(c), line: null, radius: 0, rot: 0, z: -1e9, seq: -1 }); break; }
  }
  walk(slide);
  items.sort((a, b) => a.z - b.z || a.seq - b.seq);
  return { items, pics, fonts: [...fonts], left: SR.left, top: SR.top };
}
