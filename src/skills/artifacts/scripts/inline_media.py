#!/usr/bin/env python3
"""Embed local images into HTML source files as data: URIs.

Usage: inline_media.py --media <abs media dir> [--max-px 2560] [--quality 85] FILE.html [FILE.html ...]

In each file, every reference of the form  src="media/NAME"  or  url('media/NAME')  (quotes optional; srcset is not
handled) whose NAME exists in --media is replaced by the image's bytes as a data: URI, and an <img> also gets
data-media="NAME" so you can tell later which file it came from. Photos (JPEG, or PNG without transparency) wider or taller
than --max-px are scaled down and saved as JPEG at --quality; PNG charts with transparency and SVGs keep their format.
Files are rewritten in place. A reference whose file is missing is reported and left as is (the render gate then fails
on it), so nothing is silently dropped.

To swap an image later: put  src="media/NEW.jpg"  back in place of the old data URI (or url('media/NEW.jpg')) and run
this again.

stdout: one JSON line { ok, files:[{file, inlined, missing:[...]}], bytes_added }.
"""
import argparse
import base64
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

REF = re.compile(r"""(?P<pre>\bsrc\s*=\s*|url\(\s*)(?P<q>["']?)media/(?P<name>[A-Za-z0-9._ -]+?)(?P=q)(?P<post>\s*\)?)""")
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml"}


def encode(path, max_px, quality):
    ext = path.suffix.lower()
    if ext not in MIME:
        raise ValueError(f"unsupported image type {ext}")
    if ext in (".svg", ".gif"):
        return MIME[ext], path.read_bytes()
    im = Image.open(path)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if ext == ".png" and has_alpha:
        if max(im.size) > max_px:
            im.thumbnail((max_px, max_px), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            return "image/png", buf.getvalue()
        return "image/png", path.read_bytes()
    if max(im.size) <= max_px and ext in (".jpg", ".jpeg"):
        return "image/jpeg", path.read_bytes()
    if max(im.size) > max_px:
        im.thumbnail((max_px, max_px), Image.LANCZOS)
    if ext == ".png" and max(im.size) <= max_px and im.mode in ("RGB", "L"):
        # A chart or diagram without alpha: keep PNG so lines and text stay crisp.
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return "image/png", buf.getvalue()
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return "image/jpeg", buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", required=True)
    ap.add_argument("--max-px", type=int, default=2560)
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    media = Path(a.media)
    if not media.is_dir():
        print(json.dumps({"ok": False, "error": f"no media folder {media}"}))
        return 2
    cache, report, added = {}, [], 0
    for f in a.files:
        p = Path(f)
        html = p.read_text(encoding="utf-8")
        missing, count = [], 0

        def repl(m):
            nonlocal count
            name = m.group("name")
            src = media / name
            if not src.is_file():
                missing.append(name)
                return m.group(0)
            if name not in cache:
                mime, data = encode(src, a.max_px, a.quality)
                cache[name] = f"data:{mime};base64,{base64.b64encode(data).decode()}"
            count += 1
            q = m.group("q") or ('"' if m.group("pre").startswith("src") else "'")
            tagged = f' data-media="{name}"' if m.group("pre").startswith("src") else ""
            return f"{m.group('pre')}{q}{cache[name]}{q}{m.group('post')}" if not tagged else f"{m.group('pre')}{q}{cache[name]}{q}{tagged}{m.group('post')}"

        new = REF.sub(repl, html)
        if new != html:
            added += len(new) - len(html)
            p.write_text(new, encoding="utf-8")
        report.append({"file": str(p), "inlined": count, "missing": missing})
    ok = not any(r["missing"] for r in report)
    print(json.dumps({"ok": ok, "files": report, "bytes_added": added}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
