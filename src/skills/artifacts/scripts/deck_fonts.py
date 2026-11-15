#!/usr/bin/env python3
"""Cut a template's fonts down to the characters a deck uses and write them as @font-face rules with base64 woff2 data.

Usage: deck_fonts.py <fonts dir>      (JSON on stdin: {"faces": [{family, style, weight, id}], "text": "...", "html": "..."})

<fonts dir>/<id>.b64 holds each face, base64 woff2 (Basic Latin and Latin-1 already). A face is cut to ASCII, Latin-1, common
punctuation and every character in "text", keeping its variable axes and layout features. stdout: one JSON line
{ css, bytes, faces, warnings }. A face that can't be cut is embedded whole, with a warning.
"""
import base64
import io
import json
import sys
from pathlib import Path

if any(a in ("-h", "--help") for a in sys.argv[1:]):
    print(__doc__.strip()); sys.exit(0)

from fontTools import subset
from fontTools.ttLib import TTFont


def main():
    fonts_dir = Path(sys.argv[1])
    job = json.load(sys.stdin)
    chars = {chr(c) for c in range(0x20, 0x7F)} | {c for c in "–—‘’“”…·•€£¥ →←↑↓×−"}
    chars |= {c for c in job.get("text", "") if ord(c) >= 0x20}
    codes = sorted(ord(c) for c in chars)
    warnings, rules, total = [], [], 0
    for face in job["faces"]:
        raw = base64.b64decode((fonts_dir / f"{face['id']}.b64").read_bytes())
        try:
            opts = subset.Options()
            opts.flavor = "woff2"
            opts.layout_features = ["*"]
            opts.hinting = False
            opts.desubroutinize = True
            opts.notdef_outline = True
            font = TTFont(io.BytesIO(raw))
            sub = subset.Subsetter(opts)
            sub.populate(unicodes=codes)
            sub.subset(font)
            out = io.BytesIO()
            font.flavor = "woff2"
            font.save(out)
            data = out.getvalue()
        except Exception as e:  # noqa: BLE001
            warnings.append(f"{face['family']}: embedded whole ({e})")
            data = raw
        total += len(data)
        rules.append("@font-face{font-family:'%s';font-style:%s;font-weight:%s;font-display:block;src:url(data:font/woff2;base64,%s) format('woff2');}\n"
                     % (face["family"].replace("'", ""), face["style"], face["weight"], base64.b64encode(data).decode()))
    print(json.dumps({"css": "".join(rules), "bytes": total, "faces": len(rules), "warnings": warnings}))


main()
