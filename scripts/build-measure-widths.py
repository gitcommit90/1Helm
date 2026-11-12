#!/usr/bin/env python3
"""Writes app-assets/deck-templates/_measure/widths.json: the advance width of every character in the sixteen faces the PowerPoint export measures
text with (Arial, Arial Narrow, Times New Roman and Courier New, each regular, bold, italic and bold italic), taken from their metric-compatible
stand-ins Liberation Sans, Liberation Sans Narrow, Liberation Serif and Liberation Mono. Only widths of U+0020 to U+2BFF are kept (no glyph shapes), grouped by width and
written as code point ranges, so the table is small and travels with every deck template as a text file (build_pptx.py reads it; no system fonts needed).

  python3 scripts/build-measure-widths.py <dir with LiberationSans-*.ttf, LiberationSansNarrow-*.ttf, LiberationSerif-*.ttf, LiberationMono-*.ttf>
The font licenses are kept next to the table (_measure/LICENSE-liberation.txt and LICENSE-liberation-sans-narrow.txt).
"""
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

FAMILIES = {"Arial": "LiberationSans", "Arial Narrow": "LiberationSansNarrow", "Times New Roman": "LiberationSerif", "Courier New": "LiberationMono"}
STYLES = {(0, 0): "Regular", (1, 0): "Bold", (0, 1): "Italic", (1, 1): "BoldItalic"}


def ranges(cps):
    out, start, prev = [], None, None
    for c in sorted(cps):
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append((start, prev)); start = prev = c
    if start is not None:
        out.append((start, prev))
    return ",".join(f"{a:x}" if a == b else f"{a:x}-{b:x}" for a, b in out)


def main():
    src = Path(sys.argv[1])
    faces = {}
    for name, stem in FAMILIES.items():
        for (b, i), style in STYLES.items():
            f = TTFont(src / f"{stem}-{style}.ttf")
            cmap, hm, upm = f.getBestCmap(), f["hmtx"].metrics, f["head"].unitsPerEm
            by = {}
            for cp, g in cmap.items():
                if 0x20 <= cp <= 0x2BFF:
                    by.setdefault(hm[g][0], []).append(cp)
            faces[f"{name}|{b}|{i}"] = {"upm": upm, "w": {str(w): ranges(cps) for w, cps in sorted(by.items())}}
    out = Path(__file__).resolve().parent.parent / "app-assets" / "deck-templates" / "_measure" / "widths.json"
    out.write_text(json.dumps({"version": 1, "faces": faces}, separators=(",", ":")) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


main()
