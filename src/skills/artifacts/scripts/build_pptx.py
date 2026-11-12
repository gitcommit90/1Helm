#!/usr/bin/env python3
"""Write the editable .pptx from the slide list export_pptx.mjs saved.

Usage: build_pptx.py <abs project dir>

Reads <project>/.src/build/pptx.json ({title, slides: [{items, notes}]}; each item a text box, rectangle, picture or empty picture
box, in pixels on the 1920x1080 slide) and writes <project>/<slug>.pptx: a 13.33 x 7.5 inch deck with real text boxes (runs with
font, size, colour, bold, italic, letter spacing), rectangles (fill, line, rounded corners, rotation), pictures, and an empty
picture placeholder for each "Screenshot or GIF goes here" box. The notes of each slide go in its speaker notes.
stdout: one JSON line { shapes, texts, pictures, placeholders, problems, overflows, fitted, smallest_fit }.
Text wider in the mapped font than in the page is made smaller for its own box (fit_item); the check reads the file back and lists text that
still overflows its box as overflows.
"""
import json
import math
import os
import sys
from pathlib import Path

if any(a in ("-h", "--help") for a in sys.argv[1:]):
    print(__doc__.strip()); sys.exit(0)

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_AUTO_SIZE, PP_ALIGN, MSO_ANCHOR
from pptx.util import Emu, Pt

PX = 6350            # EMU per slide pixel: 1920 px across 13.333 inches
PT = 0.5             # points per slide pixel
BLANK, PICTURE = 6, 8   # layouts of python-pptx's default template: Blank, Picture with Caption


# Fonts: the names are mapped to fonts that ship with PowerPoint (and have metric-compatible stand-ins in LibreOffice), not embedded.
# A typeface a computer doesn't have is replaced by whatever that program picks, which is usually wider and breaks the layout; these
# four are on every Windows and Mac PowerPoint and are as wide as the web fonts they stand for. (family) -> (PowerPoint font, bold, italic);
# bold/italic are None to keep the run's own, True to force.
SANS, NARROW, SERIF, MONO = "Arial", "Arial Narrow", "Times New Roman", "Courier New"
FONT_MAP = {}
for names, spec in [
    ("Albert Sans|Archivo|Bricolage Grotesque|DM Sans|Hanken Grotesk|Inter|Jost|Manrope|Noto Sans JP|Noto Sans SC|Quicksand|Space Grotesk|Syne|Work Sans|Chakra Petch|Tektur|Barlow", (SANS, None, None)),
    ("Archivo Narrow|Barlow Condensed|Bebas Neue|Big Shoulders Display", (NARROW, None, None)),
    ("Archivo Black|Bowlby One|Fredoka One", (SANS, True, None)),
    ("Alfa Slab One|Rozha One", (SERIF, True, None)),
    ("Bodoni Moda|Cormorant Garamond|DM Serif Display|Fraunces|Instrument Serif|Libre Baskerville|Lora|Newsreader|Noto Serif SC|Playfair Display|Source Serif 4|Yeseva One|Zilla Slab|Stardos Stencil", (SERIF, None, None)),
    ("Courier Prime|DM Mono|IBM Plex Mono|JetBrains Mono|Space Mono|Press Start 2P|VT323", (MONO, None, None)),
    ("Caveat|Caveat Brush", (SERIF, None, True)),
    ("Shrikhand", (SERIF, True, True)),
]:
    for n in names.split("|"):
        FONT_MAP[n] = spec
GENERIC = {"serif": (SERIF, None, None), "monospace": (MONO, None, None), "cursive": (SERIF, None, True)}


# The fit aims 2% inside the box: PowerPoint and LibreOffice kern pairs and round sizes differently, and a line that fits to the last pixel wraps in one of them.
FIT_SLACK = 0.98
FITTED = []   # (factor, item) of every text box written, for the report


def pptx_font(run):
    """(font name, bold, italic) for a run, from its family; a family not in the table is mapped by its generic fallback."""
    fam = run.get("font") or ""
    if fam in FONT_MAP:
        name, b, i = FONT_MAP[fam]
    elif fam in (SANS, NARROW, SERIF, MONO):
        name, b, i = fam, None, None
    else:
        name, b, i = GENERIC.get(run.get("gen"), (SANS, None, None))
    return name, bool(run.get("bold")) if b is None else b, bool(run.get("italic")) if i is None else i


def luminance(h):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(int(h[1:3], 16)) + 0.7152 * lin(int(h[3:5], 16)) + 0.0722 * lin(int(h[5:7], 16))


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def label_color(media, items):
    """The colour of the empty picture box's label: the box's own text colour when it reads on its background (4.5 to 1), else the slide's text
    colour that reads best (the template's own colours), else black or white."""
    bg = media.get("bg") or "#ffffff"
    own = [media.get("color")] + [r.get("color") for it in items if it["type"] == "text" for r in it["runs"]]
    for c in [c for c in own if c]:
        if contrast(c, bg) >= 4.5:
            return c
    return max(own + ["#000000", "#ffffff"], key=lambda c: contrast(c, bg)) if own else "#000000"


def rgb(h):
    return RGBColor(int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))


def emu(v):
    return Emu(int(round(v * PX)))


def add_rect(slide, it):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if it.get("radius", 0) > 0.5 else MSO_SHAPE.RECTANGLE, emu(it["x"]), emu(it["y"]), emu(it["w"]), emu(it["h"]))
    if it.get("radius", 0) > 0.5:
        shape.adjustments[0] = min(0.5, it["radius"] / max(1.0, min(it["w"], it["h"])))
    if it.get("fill"):
        shape.fill.solid(); shape.fill.fore_color.rgb = rgb(it["fill"])
    else:
        shape.fill.background()
    line = it.get("line")
    if line:
        shape.line.color.rgb = rgb(line["c"]); shape.line.width = Emu(int(line["w"] * PX))
        if line.get("dash"):
            shape.line.dash_style = MSO_LINE.DASH
    else:
        shape.line.fill.background()
    shape.shadow.inherit = False
    if it.get("rot"):
        shape.rotation = it["rot"]
    return shape


# Where the first line's baseline sits below the top of a text box, in em, for all four PowerPoint fonts. Measured: LibreOffice puts it at 0.99 em, and the
# fonts' own tables (Arial .905, Times New Roman .891 plus the line gap) put PowerPoint's at about 0.93 em; 0.96 is within 5 px of both at a 180 px title.
BASELINE_EM = 0.96


def baseline_top(it):
    """The top of the text box that puts the first line's baseline where the HTML has it, or None when the HTML's baseline is unknown.
    The page's font and PowerPoint's differ in height, so centring the box on the HTML's line box moves the letters up or down against
    the shapes drawn around them (a rule between two title lines); the baseline is what stays put."""
    base = it.get("base")
    if base is None or it.get("rot"):
        return None
    runs = [r for r in it["runs"] if r.get("t") and r.get("px")]
    if not runs:
        return None
    px = max(r["px"] for r in runs)
    multi = it.get("lines", 1) > 1 or any(r.get("br") for r in it["runs"])
    if multi:
        return None   # several lines keep the HTML box, centred: exact line spacing places the first line differently in each program
    return base - BASELINE_EM * px, 1.25 * px


# Text fit. The mapped fonts are wider than some template fonts (a condensed display face drawn in Arial Narrow, a tight serif in Times New Roman), so the same
# words can run past the box the HTML gave them. Widths come from _measure/widths.json, a table of the advance widths of the metric-compatible stand-ins
# (Liberation Sans, Sans Narrow, Serif and Mono, which match Arial, Arial Narrow, Times New Roman and Courier New; scripts/build-measure-widths.py makes it).
# The table travels with the deck templates (the deck's own copy in .src/template first, then the shared templates folder), so no system font is needed.
# Kerning is not applied (PowerPoint leaves it off by default). Without the table nothing is fitted or checked, and the export says so.
_FACES, _CACHE = {}, {}
_STAND_IN = {SANS: 1, NARROW: 1, SERIF: 1, MONO: 1}   # the four PowerPoint fonts the table covers
FIT_DIRS = []   # folders that may hold _measure/widths.json, first match wins


def _table():
    """The width table (dict of faces), or None when no copy of it can be read."""
    if "table" not in _CACHE:
        here = Path(__file__).resolve().parent
        dirs = FIT_DIRS + [Path(p) for p in (os.environ.get("HC_DECK_TEMPLATES"), here.parent.parent.parent.parent / "app-assets" / "deck-templates", "/opt/1hc/deck-templates") if p]
        table = None
        for d in dirs:
            try:
                t = json.loads((Path(d) / "_measure" / "widths.json").read_text())
                if t.get("version") == 1 and t.get("faces"):
                    table = t["faces"]; break
            except Exception:
                continue
        _CACHE["table"] = table
    return _CACHE["table"]


def _face(name, bold, italic):
    """(widths by code point, units per em) for a PowerPoint font face, or None when the table is missing."""
    key = (name, bool(bold), bool(italic))
    if key in _FACES:
        return _FACES[key]
    face = None
    t = _table()
    f = t.get(f"{name}|{int(bool(bold))}|{int(bool(italic))}") if t else None
    if f:
        widths = {}
        for w, spans in f["w"].items():
            for span in spans.split(","):
                lo, _, hi = span.partition("-")
                for cp in range(int(lo, 16), int(hi or lo, 16) + 1):
                    widths[cp] = int(w)
        face = (widths, f["upm"])
    _FACES[key] = face
    return face


def char_em(ch, name, bold, italic):
    """Advance width of one character in em, in the mapped font."""
    face = _face(name, bold, italic)
    if face is None:
        return None
    widths, upm = face
    w = widths.get(ord(ch))
    if w is None:
        return 1.0 if ord(ch) >= 0x2E80 else 0.55   # a character the table lacks: a wide one for CJK, else an average Latin letter
    return w / upm


def measure(cells, scale=1.0):
    """Width in slide pixels of a list of (char, px, spacing px, font, bold, italic), or None when no stand-in font is installed."""
    total = 0.0
    for ch, px, sp, name, b, i in cells:
        w = char_em(ch, name, b, i)
        if w is None:
            return None
        total += w * px * scale + sp * scale
    return total


def wrap(paragraphs, width, scale=1.0):
    """Greedy word wrap of paragraphs (lists of cells) at width; returns (line count, widest line, widest word), or None without a stand-in font."""
    n, widest, word_max = 0, 0.0, 0.0
    for cells in paragraphs:
        words, cur, gap = [], [], []   # words as (gap before it, the word's cells)
        for c in cells:
            if c[0] == " ":
                if cur:
                    words.append((gap, cur)); cur, gap = [], []
                gap.append(c)
            else:
                cur.append(c)
        if cur:
            words.append((gap, cur))
        lines, line_w = 1, 0.0
        for gap, wd in words:
            w, g = measure(wd, scale), measure(gap, scale)
            if w is None or g is None:
                return None
            word_max = max(word_max, w)
            if line_w and line_w + g + w > width + 0.01:
                lines += 1; widest = max(widest, line_w); line_w = w
            else:
                line_w += (g if line_w else 0) + w
        widest = max(widest, line_w)
        n += lines
    return n, widest, word_max


def item_cells(it):
    """The text of an item as paragraphs (split at line breaks) of (char, px, spacing, font, bold, italic) cells, runs mapped to their PowerPoint font."""
    paras, cells = [], []
    for r in it["runs"]:
        if r.get("br"):
            paras.append(cells); cells = []
            continue
        if not r.get("t"):
            continue
        name, b, i = pptx_font(r)
        px, sp = r.get("px") or 0, r.get("spacing") or 0
        cells += [(ch, px, sp, name, b, i) for ch in r["t"].replace("\n", " ")]
    paras.append(cells)
    return paras


def fit_item(it):
    """A copy of a text item whose runs are scaled down (all together, whole pixels) just enough that the text in the mapped font fits the box the HTML gave it:
    a single line within its width, several lines within the box width and in no more lines than the HTML had. Never grows text. Returns (item, factor)."""
    runs = [r for r in it["runs"] if r.get("t") and r.get("px")]
    if not runs:
        return it, 1.0
    multi = it.get("lines", 1) > 1 or any(r.get("br") for r in it["runs"])
    width, _ = box_width(it, multi)
    width *= FIT_SLACK
    paras = item_cells(it)
    # The page's own line count: the box height over the line height when both are known (a rotated block or a small raised letter can make the
    # measured count too big), else the measured count.
    lh = it.get("lh") or 0
    want = (max(len(paras), int(round(it["h"] / lh))) if lh else max(it.get("lines", 1), len(paras))) if multi else 1
    top = max(r["px"] for r in runs)

    def ok(scale):
        got = wrap(paras, width, scale) if multi else None
        if multi:
            return got is not None and got[0] <= want and got[2] <= width + 0.01 and got[1] <= width + 0.01
        w = measure([c for p in paras for c in p], scale)
        return w is not None and w <= width + 0.01
    if ok(1.0) or (measure(paras[0] or [(" ", 1, 0, SANS, False, False)]) is None):
        return it, 1.0
    size = int(top)
    while size > 1 and not ok(size / top):
        size -= 1
    f = size / top
    out = dict(it)
    out["runs"] = [dict(r, px=max(1, int(r["px"] * f)) if r.get("px") else r.get("px"), spacing=(r.get("spacing") or 0) * f) if not r.get("br") else r for r in it["runs"]]
    out["fit"] = f
    return out, f


def box_width(it, multi):
    """(width of the PowerPoint text box in px, left edge shift) for a text item: a single line is the HTML width plus 8; several lines are wider, up to the block's own width."""
    w = min(max(it["w"] * 1.3 + 6, it["w"] * 1.03), max(it.get("maxw", 0), it["w"] * 1.03)) if multi else it["w"] + 8
    return w, 0


def add_text(slide, it):
    it, fitted = fit_item(it)   # text wider in the mapped font than in the page is made smaller, for this box only
    FITTED.append((fitted, it))
    runs = it["runs"]
    multi = it.get("lines", 1) > 1 or any(r.get("br") for r in runs)
    # A box a little wider than the text (up to the block's own width): PowerPoint's font may be wider than the page's, and a box cut
    # to the exact width would break words. One line never wraps; several lines wrap inside the wider box.
    w, _ = box_width(it, multi)
    x = it["x"]
    if not it.get("rot"):
        x = x - (w - it["w"]) if it["align"] == "right" else x - (w - it["w"]) / 2 if it["align"] == "center" else x
    placed = baseline_top(it)
    y, h = placed if placed else (it["y"], max(it["h"], 10))
    box = slide.shapes.add_textbox(emu(x), emu(y), emu(w), emu(max(h, 10)))
    tf = box.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.word_wrap = multi
    tf.auto_size = MSO_AUTO_SIZE.NONE   # never shrink or grow: the box is the HTML's own, so two boxes never meet
    tf.vertical_anchor = MSO_ANCHOR.TOP if placed else MSO_ANCHOR.MIDDLE   # placed by baseline; without one the text sits at the middle of the HTML's own line box
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}[it["align"]]
    if it.get("lh") and multi:   # one line keeps the font's own single spacing, centred in its box
        p.line_spacing = Pt(it["lh"] * PT)
    for r in runs:
        if r.get("br"):
            p.add_line_break(); continue
        if not r.get("t"):
            continue
        run = p.add_run(); run.text = r["t"]
        f = run.font
        name, bold, italic = pptx_font(r)
        f.name = name
        if r.get("px"): f.size = Pt(max(1, round(r["px"] * PT * 2) / 2))
        f.bold = bold; f.italic = italic
        if r.get("underline"): f.underline = True
        if r.get("color"): f.color.rgb = rgb(r["color"])
        if r.get("spacing"): run._r.get_or_add_rPr().set("spc", str(int(round(r["spacing"] * PT * 100))))
    if it.get("rot"):
        box.rotation = it["rot"]
    return box


def ink_boxes(items):
    """The text boxes of one slide as (left, top, right, bottom, text) in slide pixels, each cut to the height of its lines (a box is taller
    than its letters: two boxes may touch while their letters do not)."""
    out = []
    for it in items:
        if it["type"] != "text":
            continue
        px = max([r.get("px") or 0 for r in it["runs"]] or [0])
        lines = max(1, round(it["h"] / (px * 1.2))) if px else 1   # from the box height, since a small suffix next to a big number can look like a second line
        h = min(it["h"], lines * px * 0.85) if px else it["h"]   # the letters of a line fill about 85% of the font size
        y = it["y"] + (it["h"] - h) / 2
        out.append((it["x"], y, it["x"] + it["w"], y + h, "".join(r.get("t", "") for r in it["runs"]).strip()[:24]))
    return out


def shape_paragraphs(shape):
    """The text of a written text box as paragraphs of (char, px, spacing px, font, bold, italic) cells, read back from the file: the size is the run's
    size in points over PT, the font its name, the spacing its spc in hundredths of a point over PT."""
    ns = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    paras, cells = [], []
    for p in shape.text_frame._txBody.iter(ns + "p"):
        for el in p:
            if el.tag == ns + "br":
                paras.append(cells); cells = []
            elif el.tag == ns + "r":
                rpr, t = el.find(ns + "rPr"), el.find(ns + "t")
                if rpr is None or t is None or not t.text:
                    continue
                latin = rpr.find(ns + "latin")
                name = latin.get("typeface") if latin is not None else SANS
                px = int(rpr.get("sz", "1800")) / 100 / PT
                sp = int(rpr.get("spc", "0")) / 100 / PT
                cells += [(ch, px, sp, name if name in _STAND_IN else SANS, rpr.get("b") == "1", rpr.get("i") == "1") for ch in t.text]
        paras.append(cells); cells = []
    return [c for c in paras if c]


def overflows(slide, n):
    """Text boxes whose text, in the PowerPoint font written for it, does not fit the box: a single line wider than its box, a word wider than a
    wrapping box, or wrapped lines taller than the box. Read back from the file, so it judges what was written."""
    out = []
    for sh in slide.shapes:
        if not sh.has_text_frame or not sh.text_frame.text.strip():
            continue
        paras = shape_paragraphs(sh)
        if not paras:
            continue
        width, height = sh.width / PX, sh.height / PX
        tol = 0.01 * width + 1
        tf = sh.text_frame
        px = max(c[1] for p in paras for c in p)
        label = "".join(c[0] for c in paras[0])[:24]
        if not tf.word_wrap:
            lines = [measure(p) for p in paras]
            if None in lines:
                continue
            if max(lines) > width + tol:
                out.append(f'slide {n}: the text "{label}" is {max(lines):.0f} px wide in {paras[0][0][3]} but its box is {width:.0f} px')
        else:
            got = wrap(paras, width)
            if got is None:
                continue
            ls = sh.text_frame.paragraphs[0].line_spacing
            lh = ls.pt / PT if ls is not None and hasattr(ls, "pt") else 1.2 * px
            if got[2] > width + tol:
                out.append(f'slide {n}: a word of "{label}" is {got[2]:.0f} px wide in {paras[0][0][3]} but its box is {width:.0f} px')
            elif got[0] * lh > height + tol + lh * 0.25:
                out.append(f'slide {n}: the text "{label}" takes {got[0]} lines in {paras[0][0][3]} but its box holds {height / lh:.1f}')
    return out


def check(path, slides):
    """Opens the written file again and looks for what would show in PowerPoint: a shape outside the slide, two text boxes on top of each
    other, a slide whose empty picture box is missing. Returns the problems (an empty list is a pass). No renderer is needed."""
    prs = Presentation(path)
    problems, over = [], []
    W, H = prs.slide_width, prs.slide_height
    for n, (slide, s) in enumerate(zip(prs.slides, slides), 1):
        for sh in slide.shapes:
            if sh.left is None:
                continue
            left, top, width, height = sh.left, sh.top, sh.width, sh.height
            if abs(math.sin(math.radians(getattr(sh, "rotation", 0) or 0))) > 0.7:   # a quarter turn swaps the sides around the centre
                left, top, width, height = left + (width - height) / 2, top + (height - width) / 2, height, width
            if left < -PX * 4 or top < -PX * 4 or left + width > W + PX * 4 or top + height > H + PX * 4:
                problems.append(f"slide {n}: a shape sticks out of the slide")
        boxes = ink_boxes(s["items"])
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
                if w > 2 and h > 2 and h > 0.15 * min(a[3] - a[1], b[3] - b[1]):
                    problems.append(f'slide {n}: the text boxes "{a[4]}" and "{b[4]}" overlap')
        over.extend(overflows(slide, n))
        want = 1 if any(i["type"] == "media" for i in s["items"]) else 0
        if want != sum(1 for sh in slide.placeholders if sh.placeholder_format.idx == 1):
            problems.append(f"slide {n}: the empty picture box is missing")
    return problems, over


def main():
    project = Path(sys.argv[1])
    data = json.loads((project / ".src" / "build" / "pptx.json").read_text())
    FIT_DIRS.append(project / ".src" / "template")
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)
    count = {"shapes": 0, "texts": 0, "pictures": 0, "placeholders": 0}
    for s in data["slides"]:
        media = [i for i in s["items"] if i["type"] == "media"]
        slide = prs.slides.add_slide(prs.slide_layouts[PICTURE if media else BLANK])
        holder = None
        if media:
            for ph in list(slide.placeholders):
                if ph.placeholder_format.idx == 1:
                    holder = ph
                else:
                    ph._element.getparent().remove(ph._element)
            m = media[0]
            holder.left, holder.top, holder.width, holder.height = emu(m["x"]), emu(m["y"]), emu(m["w"]), emu(m["h"])
            count["placeholders"] += 1
        for it in s["items"]:
            if it["type"] == "rect":
                add_rect(slide, it); count["shapes"] += 1
            elif it["type"] == "text":
                add_text(slide, it); count["texts"] += 1
            elif it["type"] == "picture":
                slide.shapes.add_picture(it["file"], emu(it["x"]), emu(it["y"]), emu(it["w"]), emu(it["h"])); count["pictures"] += 1
            elif it["type"] == "media" and it is not media[0]:
                add_rect(slide, {**it, "fill": None, "line": {"w": 3, "c": it.get("frame") or label_color(it, s["items"]), "dash": True}, "radius": 12}); count["shapes"] += 1
        if holder is not None:   # the box is marked with a dashed frame and its label, under the empty picture box: a picture put in the box covers both
            m = media[0]
            add_rect(slide, {**m, "fill": None, "line": {"w": 3, "c": m.get("frame") or label_color(m, s["items"]), "dash": True}, "radius": 12}); count["shapes"] += 1
            label = slide.shapes.add_textbox(emu(m["x"]), emu(m["y"]), emu(m["w"]), emu(m["h"]))
            tf = label.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.margin_left = tf.margin_right = emu(24)
            run = tf.paragraphs[0].add_run(); run.text = (m.get("label") or "Screenshot or GIF goes here").strip()
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
            run.font.name = SANS; run.font.size = Pt(18); run.font.color.rgb = rgb(label_color(m, s["items"]))
            count["texts"] += 1
            tree = slide.shapes._spTree
            tree.remove(holder._element); tree.append(holder._element)
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = s["notes"]
    if data.get("title"):
        prs.core_properties.title = data["title"]
    out = str(project / f"{project.name}.pptx")
    prs.save(out)
    problems, over = check(out, data["slides"])
    count["problems"] = problems[:12]
    count["overflows"] = over[:12]
    count["fit_measured"] = _table() is not None   # false: the width table is missing, so nothing was fitted or checked
    count["fitted"] = sum(1 for f, _ in FITTED if f < 1)
    count["smallest_fit"] = round(min([f for f, _ in FITTED] + [1.0]), 2)
    print(json.dumps(count))


main()
