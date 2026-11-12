#!/usr/bin/env python3
"""List and filter the photos in this channel's files by when and where they were taken.

  photos.py list [--after YYYY-MM-DD] [--before YYYY-MM-DD] [--near LAT,LNG --radius KM] [--name WORDS] [--limit 50]
                 [--root /workspace] [--json]
      Scans /workspace/files (their uploads, attachments, downloads) and /workspace/workspace (what you made), newest
      first by the date the photo was taken (from its camera data), else by when the file arrived (marked "added").
      One line per photo: path | taken or added | place (lat,lng) | WxH | camera.
      --near keeps photos whose camera GPS is within --radius km (default 5) of LAT,LNG; photos with no GPS are left out.
      --name keeps photos whose file name contains every word (case-insensitive).
  photos.py info <path>
      JSON with everything readable from one photo: taken time, GPS, size, camera, orientation, and the file's dates.
  photos.py stats [--root /workspace]
      How many photos, the date range, how many have a taken date and GPS, and how many couldn't be read (HEIC needs
      `python3 -m pip install pillow-heif` once).
Reads camera data with Pillow; never changes or moves a file.
"""
import argparse, datetime as dt, json, math, os, sys

EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".tif", ".tiff"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".cache"}
try:
    from PIL import Image, ExifTags
except ImportError:  # still lists files by name and date
    Image = None
HEIF = False
if Image is not None:
    try:
        import pillow_heif  # optional: pip install pillow-heif
        pillow_heif.register_heif_opener(); HEIF = True
    except Exception:
        pass


def walk(root):
    for sub in ("files", "workspace"):
        base = os.path.join(root, sub)
        for d, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if not x.startswith(".") and x not in SKIP_DIRS]
            for f in files:
                if os.path.splitext(f)[1].lower() in EXTS and not f.startswith("."):
                    yield os.path.join(d, f)


def _ratio(x):
    try: return float(x)
    except Exception:
        try: return x[0] / x[1]
        except Exception: return None


def _gps(g):
    try:
        def dms(v): return _ratio(v[0]) + _ratio(v[1]) / 60 + _ratio(v[2]) / 3600
        lat, lng = dms(g[2]), dms(g[4])
        if str(g.get(1, "N")).upper().startswith("S"): lat = -lat
        if str(g.get(3, "E")).upper().startswith("W"): lng = -lng
        if abs(lat) < 1e-9 and abs(lng) < 1e-9: return None
        return round(lat, 6), round(lng, 6)
    except Exception:
        return None


def read(path):
    st = os.stat(path)
    r = {"path": path, "added": dt.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"), "bytes": st.st_size,
         "taken": None, "gps": None, "size": None, "camera": None, "readable": Image is not None}
    if Image is None: return r
    try:
        with Image.open(path) as im:
            r["size"] = f"{im.size[0]}x{im.size[1]}"
            ex = im.getexif()
            if ex:
                tags = {ExifTags.TAGS.get(k, k): v for k, v in ex.items()}
                sub = ex.get_ifd(0x8769) if hasattr(ex, "get_ifd") else {}
                t = (sub or {}).get(36867) or (sub or {}).get(36868) or tags.get("DateTime")
                if t:
                    try: r["taken"] = dt.datetime.strptime(str(t).strip()[:19], "%Y:%m:%d %H:%M:%S").strftime("%Y-%m-%d %H:%M")
                    except ValueError: pass
                g = ex.get_ifd(0x8825) if hasattr(ex, "get_ifd") else None
                if g: r["gps"] = _gps(g)
                cam = " ".join(str(tags.get(k, "")).strip() for k in ("Make", "Model")).strip()
                r["camera"] = cam or None
                r["orientation"] = tags.get("Orientation")
    except Exception as e:
        r["readable"] = False; r["error"] = ("HEIC/HEIF: run python3 -m pip install pillow-heif once to read it"
                                             if path.lower().endswith((".heic", ".heif")) and not HEIF else str(e)[:120])
    return r


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def when(r): return r["taken"] or r["added"]


def cmd_list(a):
    rows = [read(p) for p in walk(a.root)]
    if a.name:
        words = a.name.lower().split(); rows = [r for r in rows if all(w in os.path.basename(r["path"]).lower() for w in words)]
    if a.after: rows = [r for r in rows if when(r)[:10] >= a.after]
    if a.before: rows = [r for r in rows if when(r)[:10] <= a.before]
    if a.near:
        c = tuple(float(x) for x in a.near.split(","))
        rows = [dict(r, km=round(km(c, r["gps"]), 2)) for r in rows if r["gps"]]
        rows = [r for r in rows if r["km"] <= a.radius]
    rows.sort(key=when, reverse=True)
    total = len(rows); rows = rows[: a.limit]
    if a.json: print(json.dumps({"total": total, "photos": rows}, indent=1)); return 0
    for r in rows:
        t = f"taken {r['taken']}" if r["taken"] else f"added {r['added']}"
        g = f"{r['gps'][0]},{r['gps'][1]}" + (f" ({r['km']} km)" if "km" in r else "") if r["gps"] else "no place"
        print(" | ".join([r["path"], t, g, r["size"] or "?", r["camera"] or "-"] + ([r["error"]] if r.get("error") else [])))
    print(f"{total} photo(s){' (showing ' + str(len(rows)) + ')' if total > len(rows) else ''}")
    return 0


def cmd_info(a):
    if not os.path.isfile(a.path): print(json.dumps({"error": f"no file {a.path}"})); return 1
    print(json.dumps(read(a.path), indent=1)); return 0


def cmd_stats(a):
    rows = [read(p) for p in walk(a.root)]
    taken = sorted(r["taken"] for r in rows if r["taken"])
    print(json.dumps({"photos": len(rows), "with_taken_date": len(taken), "with_gps": sum(1 for r in rows if r["gps"]),
                      "unreadable": sum(1 for r in rows if not r["readable"]), "heic_support": HEIF,
                      "taken_range": [taken[0], taken[-1]] if taken else None}, indent=1))
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    l = sp.add_parser("list"); l.add_argument("--after"); l.add_argument("--before"); l.add_argument("--near")
    l.add_argument("--radius", type=float, default=5.0); l.add_argument("--name"); l.add_argument("--limit", type=int, default=50)
    l.add_argument("--root", default="/workspace"); l.add_argument("--json", action="store_true")
    i = sp.add_parser("info"); i.add_argument("path")
    s = sp.add_parser("stats"); s.add_argument("--root", default="/workspace")
    a = p.parse_args()
    sys.exit({"list": cmd_list, "info": cmd_info, "stats": cmd_stats}[a.cmd](a))


if __name__ == "__main__":
    main()
