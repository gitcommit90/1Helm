#!/usr/bin/env python3
"""Find free-to-use photos and download one safely.

  images.py search "<words>" [--max 8] [--license reuse|any] [--min-width 0] [--source all|openverse|commons]
      Searches Openverse (openly licensed images from Flickr, Wikimedia and others) and Wikimedia Commons. Prints JSON:
      a list of {title, image_url, page_url, creator, license, license_url, credit, width, height, source}.
      --license reuse (default): CC0, public domain, CC BY, CC BY-SA only (fine to reuse, adapt and publish, with credit).
      --license any: also NonCommercial / NoDerivatives licences (personal, unchanged use only; the result says so).
  images.py get <image_url> <dest_file> [--page <page_url>] [--min-width 0]
      Downloads one image the way a page elsewhere would request it (a cross-origin referer, bounded timeouts), checks that
      the bytes really are an image, prints JSON {ok, path, format, width, height, bytes} or {ok:false, error}.
      Rejects HTML, tiny files, anything not PNG/JPEG/GIF/WEBP; with --jpeg, converts WEBP/PNG to JPEG and scales anything over 2560 px down.
  images.py fetch --to <media dir> "<name>=<subject words>" ["<name>=<subject words>" ...] [--min-width 1200]
      Search + pick + download + credit in one go, for files you make: for each name, searches (reusable licences only), picks
      the best-matching landscape result wide enough (the first name, or one containing "cover" or "hero", needs 1600 px and a wide
      shape), retrying with fewer words when nothing fits, downloads it
      as <media dir>/<name>.jpg, never the same photo twice, and adds a row to <media dir>/SOURCES.md. Prints one line per photo
      (file, size, title, credit) and a ready "Photos: ..." credits line. A name with no usable result is reported, not faked.
Standard library only (Pillow, when installed, adds the width/height check and --jpeg).
"""
import json, re, sys, html, urllib.parse, urllib.request, argparse, os

UA = "1Helm-helper/1.0 (https://1helm.com; image search for a person's own project)"
REUSE = {"cc0", "pdm", "by", "by-sa"}
COUNTRIES = {"japan", "france", "italy", "spain", "china", "india", "usa", "america", "england", "britain", "uk", "germany", "mexico",
             "canada", "australia", "greece", "portugal", "thailand", "korea", "vietnam", "the", "a", "an"}
MAX_PX = 2560   # fetch/--jpeg: photos bigger than this are scaled down (still sharp on a full-bleed 1280x720 slide at 2x)
LIC_NAMES = {"cc0": "CC0", "pdm": "Public domain", "by": "CC BY", "by-sa": "CC BY-SA", "by-nc": "CC BY-NC", "by-nd": "CC BY-ND",
             "by-nc-sa": "CC BY-NC-SA", "by-nc-nd": "CC BY-NC-ND"}


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", str(s or "")))).strip()


def openverse(q, n, lic):
    params = {"q": q, "page_size": str(min(max(n * 2, 10), 20))}
    if lic == "reuse":
        params["license"] = ",".join(sorted(REUSE))
    d = get_json("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(params))
    out = []
    for r in d.get("results", []):
        code = str(r.get("license", "")).lower()
        out.append({"title": r.get("title") or "", "image_url": r.get("url"), "page_url": r.get("foreign_landing_url"),
                    "creator": r.get("creator") or "unknown", "license": f"{LIC_NAMES.get(code, code.upper())} {r.get('license_version') or ''}".strip(),
                    "license_code": code, "license_url": r.get("license_url"), "width": r.get("width"), "height": r.get("height"),
                    "source": f"openverse/{r.get('source') or r.get('provider') or ''}".rstrip("/")})
    return out


def commons_code(short):
    s = str(short or "").lower().replace(" ", "-")
    if "public-domain" in s or s in ("pd", "pdm") or s.startswith("pd-"): return "pdm"
    if s.startswith("cc0"): return "cc0"
    m = re.match(r"cc-(by(?:-nc)?(?:-sa|-nd)?)", s)
    return m.group(1) if m else s


def commons(q, n, lic):
    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": "6", "gsrsearch": f"{q} filetype:bitmap",
              "gsrlimit": str(min(max(n * 2, 10), 30)), "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": "1920"}
    d = get_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    pages = sorted((d.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    out = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]; md = ii.get("extmetadata") or {}
        short = (md.get("LicenseShortName") or {}).get("value", ""); code = commons_code(short)
        if lic == "reuse" and code not in REUSE: continue
        out.append({"title": strip_tags((md.get("ObjectName") or {}).get("value")) or p.get("title", "").replace("File:", ""),
                    "image_url": ii.get("thumburl") or ii.get("url"), "page_url": ii.get("descriptionurl"),
                    "creator": strip_tags((md.get("Artist") or {}).get("value")) or "unknown", "license": short or "see page",
                    "license_code": code, "license_url": (md.get("LicenseUrl") or {}).get("value"),
                    "width": ii.get("thumbwidth") or ii.get("width"), "height": ii.get("thumbheight") or ii.get("height"), "source": "wikimedia-commons"})
    return out


def search(a):
    mixed, errors = find(a.query, a.max, a.license, a.source, a.min_width)
    print(json.dumps({"query": a.query, "results": mixed[: a.max], "errors": errors}, indent=1, ensure_ascii=False))
    return 0 if mixed else 1


def find(query, n, lic="reuse", source="all", min_width=0):
    res, errors = [], []
    for name, fn in (("openverse", openverse), ("commons", commons)):
        if source not in ("all", name): continue
        try: res += fn(query, n, lic)
        except Exception as e: errors.append(f"{name}: {e.__class__.__name__}: {e}"[:200])
    seen, out = set(), []
    for r in res:
        u = r.get("image_url")
        if not u or not str(u).startswith("https://") or u in seen: continue
        if min_width and (r.get("width") or 0) < min_width: continue
        seen.add(u)
        r["reuse_ok"] = r["license_code"] in REUSE
        if not r["reuse_ok"]: r["note"] = "NonCommercial or NoDerivatives: personal use only, unchanged, never in anything sold or published for business"
        r["credit"] = f"{r['title'] or 'Photo'} by {r['creator']}, {r['license']}" + (f" ({r['page_url']})" if r.get("page_url") else "")
        out.append(r)
    # Interleave sources so one doesn't crowd out the other, keeping each source's own order.
    by = {}
    for r in out: by.setdefault(r["source"].split("/")[0], []).append(r)
    mixed = []
    while any(by.values()):
        for k in list(by):
            if by[k]: mixed.append(by[k].pop(0))
    return mixed, errors


MAGIC = [(b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpeg"), (b"GIF87a", "gif"), (b"GIF89a", "gif")]


def sniff(b):
    for sig, f in MAGIC:
        if b.startswith(sig): return f
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return "webp"
    return None


def get(a):
    r = download(a.url, a.dest, a.page, a.min_width, a.jpeg)
    print(json.dumps(r)); return 0 if r["ok"] else 1


def download(u, dest, page=None, min_width=0, jpeg=False):
    if not u.startswith("https://") or re.match(r"https://[^/]*@", u):
        return {"ok": False, "error": "only plain https image links"}
    host = urllib.parse.urlparse(u).hostname or ""
    ref = "https://1helm.com/" if not host.endswith("1helm.com") else "https://example.org/"
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (compatible; " + UA + ")", "Referer": ref,
                                             "Accept": "image/png,image/jpeg,image/gif,image/webp,image/*;q=0.5"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ctype = r.headers.get("Content-Type", ""); data = r.read(30 * 1024 * 1024 + 1)
    except Exception as e:
        return {"ok": False, "error": f"download failed: {e}"[:300]}
    fmt = sniff(data)
    if len(data) > 30 * 1024 * 1024: err = "over 30 MB"
    elif not fmt: err = f"not a PNG/JPEG/GIF/WEBP image (content-type {ctype or 'none'})"
    elif len(data) < 2048: err = "too small to be a real photo (a placeholder or tracking pixel?)"
    else: err = None
    if err: return {"ok": False, "error": err}
    os.makedirs(os.path.dirname(os.path.abspath(dest)) or ".", exist_ok=True)
    w = h = None
    try:
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(data)); im.load(); w, h = im.size
        if min_width and w < min_width:
            return {"ok": False, "error": f"only {w}px wide, need {min_width}"}
        big = max(w, h) > MAX_PX
        if jpeg and (fmt in ("webp", "png", "gif") or big):   # fetch: JPEG, at most MAX_PX on the long side (a 5550 px original is 8 MB)
            if not dest.lower().endswith((".jpg", ".jpeg")): dest = os.path.splitext(dest)[0] + ".jpg"
            im = im.convert("RGB")
            if big: im.thumbnail((MAX_PX, MAX_PX)); w, h = im.size
            im.save(dest, "JPEG", quality=86); fmt = "jpeg"; data = open(dest, "rb").read()
        else:
            open(dest, "wb").write(data)
    except ImportError:
        open(dest, "wb").write(data)
    except Exception as e:
        return {"ok": False, "error": f"the file isn't a readable image: {e}"[:300]}
    return {"ok": True, "path": dest, "format": fmt, "width": w, "height": h, "bytes": len(data), "page_url": page}


STOP = {"the", "a", "an", "of", "in", "at", "on", "and", "with", "photo", "view", "wide", "tall"}


def words(t):
    return {w for w in re.findall(r"[a-z0-9]+", str(t or "").lower()) if len(w) > 2 and w not in STOP}


def short_credit(r):
    title = re.sub(r"\.(jpe?g|png|webp|gif|tiff?)$", "", re.sub(r"^File:", "", str(r.get("title") or "Photo")), flags=re.I)
    creator = re.sub(r"\s+", " ", str(r.get("creator") or "unknown")).strip()[:48]
    return f"{title[:40].rstrip(' ,-')} by {creator} ({r.get('license') or 'see source'})"


def fetch(a):
    import concurrent.futures, threading
    specs = []
    for i, spec in enumerate(a.specs):
        name, sep, query = spec.partition("=")
        name = re.sub(r"[^a-z0-9-]+", "-", name.strip().lower()).strip("-")
        if not sep or not name or not query.strip():
            print(json.dumps({"ok": False, "error": f'bad spec "{spec}": use "<name>=<subject words>", e.g. "cover=Kiyomizu-dera Kyoto"'})); return 2
        cover = i == 0 or "cover" in name or "hero" in name
        specs.append((name, query.strip(), max(a.min_width, 1600) if cover else a.min_width, cover))
    os.makedirs(a.to, exist_ok=True)
    found = list(concurrent.futures.ThreadPoolExecutor(6).map(lambda sp: find(sp[1], 12, "reuse", "all", 0), specs))
    used, lock = set(), threading.Lock()

    def one(k):
        name, query, minw, cover = specs[k]; res, errors = found[k]; q = words(query)
        # The place or thing must be in the title: a photo titled for another place is a wrong photo, not a near miss (dev 10-07:
        # "traditional wooden machiya street in Gion Kyoto Japan" picked "Takayama, Part I"). Proper nouns carry it (countries don't).
        proper = [w for w in re.findall(r"\b[A-Z][\w'-]+", query) if w.lower() not in COUNTRIES]
        def fits(r):
            if (r.get("width") or 0) < minw: return False
            t = words(r.get("title")); return not proper or any(words(p) & t for p in proper)
        cands = [r for r in res if fits(r)]
        # Too specific or nothing titled for it: the proper nouns alone, then fewer words.
        ws = query.split()
        for alt in dict.fromkeys([" ".join(proper), " ".join(ws[:4]), " ".join(ws[:2])]):
            if cands or not alt or alt == query: continue
            res2, err2 = find(alt, 12, "reuse", "all", 0); errors += err2
            cands = [r for r in res2 if fits(r)]
        # A cover or hero is wide: a portrait photo only when no landscape one is left.
        if cover and any((r.get("width") or 0) >= 1.15 * (r.get("height") or 1) for r in cands):
            cands = [r for r in cands if (r.get("width") or 0) >= 1.15 * (r.get("height") or 1)]
        # Best match first: the query's words in the title, then landscape, then width up to 2560.
        cands.sort(key=lambda r: (-len(q & words(r.get("title"))), (r.get("height") or 0) > (r.get("width") or 1), -min(r.get("width") or 0, 2560)))
        tried = []
        for r in cands[:5]:
            with lock:
                if r["image_url"] in used: continue
                used.add(r["image_url"])
            d = download(r["image_url"], os.path.join(a.to, name + ".jpg"), r.get("page_url"), minw, True)
            if d["ok"]:
                return {"name": name, "ok": True, "file": d["path"], "size": f'{d["width"]}x{d["height"]}', "title": r.get("title"), "credit": short_credit(r),
                        "row": f'| {os.path.basename(d["path"])} | {r.get("title")} | {r.get("creator")} | {r.get("license")} | {r.get("page_url")} |'}
            tried.append(d["error"][:80])
        why = f"no reusable result {minw}px wide or more" if not cands else "downloads failed: " + "; ".join(tried[:2])
        return {"name": name, "ok": False, "query": query, "error": why + ("; search errors: " + "; ".join(errors) if errors else "")}

    out = list(concurrent.futures.ThreadPoolExecutor(6).map(one, range(len(specs))))
    src = os.path.join(a.to, "SOURCES.md")
    rows = open(src, encoding="utf-8").read().splitlines() if os.path.exists(src) else ["| file | title | creator | licence | source page |", "|---|---|---|---|---|"]
    for r in out:
        if r["ok"]:
            rows = [l for l in rows if not l.startswith(f'| {os.path.basename(r["file"])} |')] + [r["row"]]
    open(src, "w", encoding="utf-8").write("\n".join(rows) + "\n")
    for r in out:
        r.pop("row", None)
        print(json.dumps(r, ensure_ascii=False))
    good = [r for r in out if r["ok"]]
    if good: print("credits line: Photos: " + "; ".join(r["credit"] for r in good) + ". (also in " + src + ")")
    bad = [r["name"] for r in out if not r["ok"]]
    if bad: print("not found: " + ", ".join(bad) + ". Try other words for those (the place's English or local name, a narrower view), or leave the photo out.")
    return 0 if not bad else 1


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("search"); s.add_argument("query"); s.add_argument("--max", type=int, default=8)
    s.add_argument("--license", choices=["reuse", "any"], default="reuse"); s.add_argument("--min-width", type=int, default=0)
    s.add_argument("--source", choices=["all", "openverse", "commons"], default="all")
    g = sp.add_parser("get"); g.add_argument("url"); g.add_argument("dest"); g.add_argument("--page", default=None)
    g.add_argument("--min-width", type=int, default=0); g.add_argument("--jpeg", action="store_true")
    f = sp.add_parser("fetch"); f.add_argument("specs", nargs="+"); f.add_argument("--to", required=True); f.add_argument("--min-width", type=int, default=1200)
    a = p.parse_args()
    sys.exit(search(a) if a.cmd == "search" else get(a) if a.cmd == "get" else fetch(a))


if __name__ == "__main__":
    main()
