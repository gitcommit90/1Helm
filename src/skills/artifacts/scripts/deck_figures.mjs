// Sizing the impact figures ("3 days → 4 hours") of a project slide to their place on the stage. A module new_deck.mjs and deck_repair.mjs load; you don't run it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES } from "./deck_templates_dir.mjs";
import { unesc } from "./deck_fit.mjs";

if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const L = readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = L.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(L.slice(0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

// Text width of a figure on the stage: the advance width of each character in the template's own display font (_measure/figure-widths.json, made by
// scripts/build-figure-widths.py), with its letter spacing (a fixed number of px that does not shrink with the type) and capitals, and 3% to spare. Without the table (an old template folder) a rough width
// that is wider than most glyphs is used. FIG is the template the deck uses; the project slide is the same size in every template (a 780px column).
export const FIG = { name: "", root: TEMPLATES };
let figTable;
function figModel() {
  if (figTable === undefined || figTable.root !== FIG.root) {
    let all = null; try { all = JSON.parse(readFileSync(join(FIG.root, "_measure", "figure-widths.json"), "utf8")).templates; } catch {}
    figTable = { root: FIG.root, all };
  }
  return figTable.all?.[FIG.name] || null;
}
const roughW = (c) => /[0-9]/.test(c) ? 0.62 : /[A-Z]/.test(c) ? 0.72 : /[a-z]/.test(c) ? 0.56 : c === " " ? 0.3 : /[\u2192\u00d7]/.test(c) ? 0.95 : 0.4;
const textW = (t, px) => {
  const m = figModel(), tt = m?.upper ? t.toUpperCase() : t;
  return [...tt].reduce((a, c) => a + (m ? (m.w[c] ?? m.w[c.toLowerCase()] ?? 1) : roughW(c)) * px + (m?.ls_px || 0), 0) * 1.03;
};
// A before and after wraps only at the arrow ("3 days →" then "4 hours"): the other spaces of the figure are non-breaking.
export const figureText = (v) => String(v).includes("\u2192") ? String(v).split(/\s*\u2192\s*/).map((x) => x.replace(/ /g, "\u00a0")).join("\u00a0\u2192 ") : String(v);
function linesAt(text, px, width) {
  let lines = 1, cur = 0;
  for (const w of figureText(text).split(" ")) { const ww = textW(w, px), sp = cur ? textW(" ", px) : 0; if (cur && cur + sp + ww > width) { lines++; cur = ww; } else cur += sp + ww; }
  return lines;
}
// The biggest size, at most the template's own, at which every figure fits on one line of its share of the 780px column and stays at 64px or more;
// a figure too long for that wraps (at the arrow, or at a space of a figure with no arrow) onto two lines at the biggest size that fits, down to 40px.
// One that fits in neither way is refused by new_deck with the length that does fit (fitFigures returns ok:false and the longest length that fits).
export function fitFigures(values, base, count) {
  const width = Math.floor((780 - 64 * (count - 1)) / count), fits = (px, n) => values.every((v) => linesAt(v, px, width) <= n && figureText(v).split(" ").every((w) => textW(w, px) <= width));
  let px = base;
  while (px > 64 && !fits(px, 1)) px -= 4;
  if (fits(px, 1)) return { px, width, wrap: false, ok: true };
  px = Math.min(base, 96);
  while (px > 40 && !fits(px, 2)) px -= 4;
  if (!fits(px, 2) && count === 2) {   // two figures that cannot share the row: one above the other, each with the whole column
    const one = fitFigures(values, base, 1); return { ...one, stack: true };
  }
  return { px, width, wrap: true, ok: fits(px, 2) };
}
export const sizeFigure = (open, fit) => fit.px === Number((open.match(/font-size:(\d+)px/) || [])[1]) && !fit.wrap ? open : open.replace(/font-size:\d+px/, `font-size:${fit.px}px`).replace(/white-space:nowrap;/, fit.wrap ? "white-space:normal;" : "white-space:nowrap;");


const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A slide file written any way (new_deck --data, or the sample's markup filled by hand): read each impact figure from its data-slot="stat1" / "stat2" element and, when
// the figures as they stand would be cut off, set them with the rules new_deck uses (fitFigures: the biggest size from the template's own down to 64px on one line, or two lines down to 40px, or two figures stacked).
// Figures that already fit are left as they are. `base` is the template's own size (the sample slide's). -> { html, changed: [{ slot, value, from, to }], problems: [{ slot, value, chars }] }
// The open tag of a figure at the fit's size and wrapping, whatever style it had (a hand-written slide may lack either declaration).
const setFigure = (open, fit) => {
  const decl = `font-size:${fit.px}px;white-space:${fit.wrap ? "normal" : "nowrap"}`;
  if (!/\sstyle="/.test(open)) return open.replace(/^<([a-zA-Z][\w:-]*)/, `<$1 style="${decl}"`);
  return open.replace(/(\sstyle=")([^"]*)(")/, (x, a, v, c) => a + v.replace(/(?:^|;)\s*(?:font-size|white-space)\s*:[^;]*/gi, "").replace(/^;/, "").replace(/;+\s*$/, "") + (v.trim() ? ";" : "") + decl + c);
};
const STAT = /(<p\b[^>]*\sdata-slot="stat([12])"[^>]*>)([\s\S]*?)(<\/p>)/g;
const px = (open) => Number((open.match(/font-size:(\d+(?:\.\d+)?)px/) || [])[1]) || 0;
export function fitFigureSlide(html, base) {
  const found = [...html.matchAll(STAT)];
  if (!found.length) return { html, changed: [], problems: [] };
  const vals = found.map((m) => unesc(m[3]).replace(/[\s\u00a0]+/g, " ").trim()), count = Math.max(...found.map((m) => Number(m[2])), found.length);
  if (vals.some((v) => !v)) return { html, changed: [], problems: [] };
  const width = Math.floor((780 - 64 * (count - 1)) / count);
  const wrapNow = found.map((m) => !/white-space:\s*nowrap/.test(m[1]));
  const stacked = /data-slot="impact" style="[^"]*flex-direction:column/.test(html);
  const fine = found.every((m, k) => { const p = px(m[1]); if (!p) return true; const w = stacked ? 780 : width; return linesAt(vals[k], p, w) <= (wrapNow[k] ? 2 : 1) && figureText(vals[k]).split(" ").every((x) => textW(x, p) <= w); });
  if (fine) return { html, changed: [], problems: [] };
  const fit = fitFigures(vals, base, count);
  if (!fit.ok) {
    const problems = vals.map((v, k) => ({ v, k })).filter(({ v }) => !fitFigures([v], base, count).ok).map(({ v, k }) => {
      let n = v.length; while (n > 3 && !fitFigures([v.slice(0, n)], base, count).ok) n--;
      return { slot: `impact ${found[k][2]}`, value: v, chars: n, width: fit.width };
    });
    return { html, changed: [], problems: problems.length ? problems : [{ slot: "impact", value: vals.join(" / "), chars: 0, width: fit.width }] };
  }
  const changed = []; let out = html;
  for (const m of found) {
    const k = found.indexOf(m), from = px(m[1]);
    const open = setFigure(m[1], fit);
    out = out.replace(m[0], open + esc(figureText(vals[k])) + m[4]);
    if (from !== fit.px) changed.push({ slot: `impact ${m[2]}`, value: vals[k], from, to: fit.px });
  }
  for (const m of found) if (fit.px < base) out = out.replace(new RegExp(`(<div data-slot="stat${m[2]}-box" style="[^"]*?)max-width:none`), `$1max-width:${fit.width}px`);
  if (fit.stack && count === 2) out = out.replace(/(<div data-slot="impact" style="[^"]*?)display:flex;gap:\d+px/, "$1display:flex;flex-direction:column;gap:28px");
  return { html: out, changed, problems: [] };
}
