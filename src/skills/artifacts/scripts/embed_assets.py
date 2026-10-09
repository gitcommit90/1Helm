#!/usr/bin/env python3
"""embed_assets.py: turn an authored HTML page into one self-contained file.

You write the page with ordinary relative references (<img src="media/hero.jpg">,
url('media/texture.png'), <link rel="stylesheet" href="style.css">). This writes a copy where
every one of them is embedded: images become data: URIs (photos are resized so their long side
is at most --max-px and saved as JPEG; PNG/SVG/GIF/WebP keep their format), and local
stylesheets are inlined. Remote http(s) references are left alone and reported, because a PDF
or a shared page must not depend on them; fix them in the source.

Usage:
  python3 embed_assets.py SOURCE.html OUT.html [--max-px 2000] [--quality 84]

Only files inside SOURCE's own folder (and its parent when SOURCE sits in .src/) are read.
Prints a JSON summary; exit 1 when a reference is missing or outside the folder, 2 on bad input.
"""
import argparse, base64, io, json, mimetypes, os, re, sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

ATTR_RE = re.compile(r"""(<(?:img|source|image|use)\b[^>]*?\s(?:src|href|xlink:href)\s*=\s*)(["'])(.*?)\2""", re.I | re.S)
SRCSET_RE = re.compile(r"""\ssrcset\s*=\s*(["']).*?\1""", re.I | re.S)
CSS_URL_RE = re.compile(r"""url\(\s*(['"]?)(.*?)\1\s*\)""", re.I)
LINK_CSS_RE = re.compile(r"""<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>""", re.I)
HREF_RE = re.compile(r"""href\s*=\s*(["'])(.*?)\1""", re.I)
PHOTO_EXT = {".jpg", ".jpeg"}


def roots_for(src):
    own = os.path.dirname(os.path.abspath(src))
    roots = [own]
    if os.path.basename(own) == ".src":
        roots.append(os.path.dirname(own))
    return [os.path.realpath(r) for r in roots]


def resolve(ref, base, roots):
    path = os.path.realpath(os.path.join(base, ref.split("#")[0].split("?")[0]))
    if not any(path == r or path.startswith(r + os.sep) for r in roots):
        return None, "outside the artifact folder"
    if not os.path.isfile(path):
        return None, "file not found"
    return path, None


def data_uri(path, max_px, quality):
    ext = os.path.splitext(path)[1].lower()
    raw = open(path, "rb").read()
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if Image is not None and ext in PHOTO_EXT | {".png", ".webp"} and mime.startswith("image/"):
        im = Image.open(io.BytesIO(raw))
        w, h = im.size
        scale = min(1.0, max_px / float(max(w, h)))
        if ext in PHOTO_EXT or scale < 1.0:
            if scale < 1.0:
                im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            buf = io.BytesIO()
            if ext in PHOTO_EXT or (im.mode in ("RGB", "L") and ext == ".webp"):
                im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
                mime = "image/jpeg"
            else:
                im.save(buf, "PNG", optimize=True)
                mime = "image/png"
            raw = buf.getvalue()
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}", len(raw)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("out")
    ap.add_argument("--max-px", type=int, default=2000)
    ap.add_argument("--quality", type=int, default=84)
    a = ap.parse_args()
    if not os.path.isfile(a.source):
        print(json.dumps({"ok": False, "error": f"source not found: {a.source}"}))
        return 2
    base = os.path.dirname(os.path.abspath(a.source))
    roots = roots_for(a.source)
    html = open(a.source, encoding="utf-8").read()
    report = {"embedded": [], "remote": [], "problems": []}
    cache = {}

    def embed(ref, where):
        ref = ref.strip()
        if not ref or ref.startswith(("data:", "#", "about:", "blob:")):
            return None
        if re.match(r"^(https?:)?//", ref, re.I):
            report["remote"].append(ref[:120])
            return None
        if ref.startswith("file:"):
            report["problems"].append({"ref": ref[:120], "why": "file:// reference; use a relative path"})
            return None
        if ref not in cache:
            path, why = resolve(ref, base, roots)
            if why:
                report["problems"].append({"ref": ref[:120], "why": why})
                cache[ref] = None
            else:
                uri, n = data_uri(path, a.max_px, a.quality)
                cache[ref] = uri
                report["embedded"].append({"ref": ref, "bytes": n, "in": where})
        return cache[ref]

    def inline_link(m):
        tag = m.group(0)
        h = HREF_RE.search(tag)
        if not h or re.match(r"^(https?:)?//", h.group(2), re.I):
            if h:
                report["remote"].append(h.group(2)[:120])
            return tag
        path, why = resolve(h.group(2), base, roots)
        if why:
            report["problems"].append({"ref": h.group(2)[:120], "why": why})
            return tag
        css = open(path, encoding="utf-8").read()
        return "<style>\n" + css + "\n</style>"

    html = LINK_CSS_RE.sub(inline_link, html)
    html = SRCSET_RE.sub("", html)  # srcset would bypass the embedded src
    html = ATTR_RE.sub(lambda m: m.group(1) + m.group(2) + (embed(m.group(3), "attr") or m.group(3)) + m.group(2), html)
    html = CSS_URL_RE.sub(lambda m: "url(" + m.group(1) + (embed(m.group(2), "css") or m.group(2)) + m.group(1) + ")", html)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, "w", encoding="utf-8").write(html)
    report["ok"] = not report["problems"]
    report["out"] = os.path.abspath(a.out)
    report["out_bytes"] = len(html.encode("utf-8"))
    print(json.dumps(report, indent=1))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
