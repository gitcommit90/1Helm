#!/usr/bin/env python3
"""Advance widths for the faces a deck template sets its text in, for scripts/build-text-fit.mjs (it writes <template>/fit.json).

stdin: {"root": "<deck-templates folder>", "template": "<name>", "keys": ["Family|weight|style", ...]}
stdout: {"faces": {"Family|weight|style": {"w": {char: em}, "fb": em}}}

Each key is a face as Chrome reports it for a piece of text. When the template embeds that family (fonts.json), the width of each character comes from
the embedded font file, the face nearest the weight and style (a variable font is measured at the weight). A family the template does not embed (a system font)
gets the wider of DejaVu Sans and Liberation Sans at the nearest of regular and bold, which is what the channel computer falls back to. "fb" is the width
used for a character the font lacks (the em width of "M"). Characters kept: U+0020 to U+007E, Latin-1 and Latin Extended-A letters, and common punctuation and arrows.
Kerning is ignored (it only narrows text).
"""
import base64, io, json, subprocess, sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

CHARS = [chr(c) for c in range(0x20, 0x7f)] + [chr(c) for c in range(0xa0, 0x180)] + list("–—‘’“”…·•€£¥→←↑↓×−±≈°½¾№™")


def system_font(pattern):
    p = subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True).stdout.strip()
    return TTFont(p, fontNumber=0) if p else None


def widths(font):
    cmap, hm, upm = font.getBestCmap(), font["hmtx"].metrics, font["head"].unitsPerEm
    return {c: (hm[cmap[ord(c)]][0] / upm if ord(c) in cmap else None) for c in CHARS}


def main():
    job = json.load(sys.stdin)
    root, tpl = Path(job["root"]), job["template"]
    faces = json.loads((root / tpl / "fonts.json").read_text())
    cache, out = {}, {}
    for key in job["keys"]:
        fam, wt, style = key.split("|")
        wt = int(float(wt))
        cand = [f for f in faces if f["family"] == fam]
        if cand:
            same = [f for f in cand if f["style"] == style] or cand
            def rng(f):
                r = [int(x) for x in f["weight"].split()]
                return (r[0], r[-1])
            f = min(same, key=lambda f: 0 if rng(f)[0] <= wt <= rng(f)[1] else min(abs(rng(f)[0] - wt), abs(rng(f)[1] - wt)))
            ck = (f["id"], wt)
            if ck not in cache:
                font = TTFont(io.BytesIO(base64.b64decode((root / "_fonts" / (f["id"] + ".b64")).read_text())))
                if "fvar" in font:
                    axes = {a.axisTag: a for a in font["fvar"].axes}
                    loc = {"wght": min(max(wt, axes["wght"].minValue), axes["wght"].maxValue)} if "wght" in axes else {}
                    font = instancer.instantiateVariableFont(font, {**loc, **{t: a.defaultValue for t, a in axes.items() if t not in loc}})
                cache[ck] = widths(font)
            w = cache[ck]
        else:
            bold = wt >= 600
            ck = ("system", bold)
            if ck not in cache:
                sysf = [x for x in (system_font("DejaVu Sans:" + ("bold" if bold else "regular")), system_font("Liberation Sans:" + ("bold" if bold else "regular"))) if x]
                ws = [widths(x) for x in sysf]
                cache[ck] = {c: max((x[c] for x in ws if x[c] is not None), default=None) for c in CHARS}
            w = cache[ck]
        fb = w.get("M") or 0.9
        out[key] = {"w": {c: round(v, 3) for c, v in w.items() if v is not None}, "fb": round(fb, 3)}
    print(json.dumps({"faces": out}, ensure_ascii=False))


main()
