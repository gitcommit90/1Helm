#!/usr/bin/env python3
"""Writes app-assets/deck-templates/_measure/figure-widths.json: for every deck template, how wide its big impact figure (the "stat1" text of the
project pattern) is, character by character, in the template's own display font. new_deck.mjs reads it to pick the biggest size at which a figure
such as "3 days -> 4 hours" fits its column, so no browser is needed to size a figure. Widths are advance widths in em, from the template's embedded
font file (fonts.json, the face nearest the figure's weight); a character the font lacks (e.g. the arrow) is 1 em. A template whose figure font is a
system font (no embedded file) gets the wider of DejaVu Sans Bold and Liberation Sans Bold, which is what the channel computer falls back to.
Kept per template: the text transform (uppercase) and the letter spacing in px (a fixed length in the template's style, so it does not shrink with the figure). Kerning is ignored (it only narrows text).

  python3 scripts/build-figure-widths.py
"""
import base64, io, json, re, subprocess
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent / "app-assets" / "deck-templates"
CHARS = [chr(c) for c in range(0x20, 0x7f)] + list("→×±≈€£¥°·–—’…½¾↑↓← ")


def system_font(pattern):
    p = subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True).stdout.strip()
    return TTFont(p) if p else None


def widths(font):
    cmap, hm, upm = font.getBestCmap(), font["hmtx"].metrics, font["head"].unitsPerEm
    return {c: (hm[cmap[ord(c)]][0] / upm if ord(c) in cmap else None) for c in CHARS}


def main():
    out = {}
    sysfonts = [f for f in (system_font("DejaVu Sans:bold"), system_font("Liberation Sans:bold")) if f]
    for d in sorted(ROOT.iterdir()):
        slide = next(iter(sorted(d.glob("slides/*project*.html"))), None) if d.is_dir() else None
        if not slide:
            continue
        html = slide.read_text()
        style = re.search(r'data-slot="stat1"[^>]*style="([^"]*)"', html).group(1)
        get = lambda k: (re.search(r'(?:^|;)' + k + r':([^;]*)', style) or [None, ""])[1].strip()
        fam = [x.strip().strip("'\"") for x in get("font-family").split(",")][0]
        wt, size = int(get("font-weight") or 400), float(get("font-size").replace("px", ""))
        ls = get("letter-spacing")
        ls_px = 0.0 if ls in ("", "normal") else float(ls.replace("px", ""))
        faces = [f for f in json.loads((d / "fonts.json").read_text()) if f["family"] == fam and f["style"] == "normal"]
        if faces:
            rng = lambda f: [int(x) for x in f["weight"].split()] * 2
            f = min(faces, key=lambda f: 0 if rng(f)[0] <= wt <= rng(f)[1] else min(abs(rng(f)[0] - wt), abs(rng(f)[1] - wt)))
            font = TTFont(io.BytesIO(base64.b64decode((ROOT / "_fonts" / (f["id"] + ".b64")).read_text())))
            if "fvar" in font:   # a variable font: measure at the figure's weight
                axes = {a.axisTag: a for a in font["fvar"].axes}
                loc = {"wght": min(max(wt, axes["wght"].minValue), axes["wght"].maxValue)} if "wght" in axes else {}
                font = instancer.instantiateVariableFont(font, {**loc, **{t: a.defaultValue for t, a in axes.items() if t not in loc}})
            w = widths(font)
            src = fam
        else:
            ws = [widths(f) for f in sysfonts]
            w = {c: max((x[c] for x in ws if x[c] is not None), default=None) for c in CHARS}
            src = "system sans bold"
        out[d.name] = {"font": src, "upper": get("text-transform") == "uppercase", "ls_px": round(ls_px, 3),
                       "w": {c: (round(v, 3) if v is not None else 1.0) for c, v in w.items()}}
    (ROOT / "_measure" / "figure-widths.json").write_text(json.dumps({"version": 1, "templates": out}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(out)} templates")


main()
