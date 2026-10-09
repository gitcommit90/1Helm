#!/usr/bin/env python3
"""page_check.py: automatic look at rendered page images (PNG/JPEG) before a file is shared.

You can't see images yet, so this script does the mechanical part of looking: for every page image it flags
  - a blank page (nothing on it),
  - ink in the outer edge strip of a page whose border is otherwise plain (text or a table cut off at the paper edge),
  - a mostly empty page (advisory: a stray page break or an unfilled section),
  - a large flat box of one colour that isn't the background (advisory: an image slot that never filled),
  - two consecutive identical pages (advisory: a duplicated page or slide).
It can't judge taste, wording or whether a photo fits; the text read-back (readback.py) and the gates cover the rest.

Usage:
  python3 page_check.py [--kind doc|deck|web] [--json-out FILE] PNG_OR_DIR [...]
  A directory means every page-*.png (else every *.png) in it, in name order.
Exit 0 when nothing failed (advisories never fail), 1 when a page failed, 2 on bad input.
--kind deck: full-bleed slides are normal, so edge ink is only flagged on slides with a plain border.
--kind web: one tall screenshot per width; the mostly-empty, edge and flat-box checks are skipped (render_audit's
  --full-page run catches a page wider than the screen).
"""
import argparse, glob, hashlib, json, os, sys

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover
    print(json.dumps({"ok": False, "error": "needs Pillow and numpy (python3 -m pip install pillow numpy)"}))
    sys.exit(2)

TOL = 28            # a pixel counts as ink when any channel differs from the background by more than this
EDGE_FRAC = 0.012   # width of the outer strip checked for cut-off content, as a share of the page's short side
SAMPLE_MAX = 900    # pages are scaled down to this long side first; plenty for these checks and fast


def pages_from(args):
    out = []
    for a in args:
        if os.path.isdir(a):
            found = sorted(glob.glob(os.path.join(a, "page-*.png"))) or sorted(glob.glob(os.path.join(a, "*.png")))
            out += found
        elif os.path.isfile(a):
            out.append(a)
        else:
            raise SystemExit(json.dumps({"ok": False, "error": f"not found: {a}"}))
    if not out:
        raise SystemExit(json.dumps({"ok": False, "error": "no page images found"}))
    return out


def check(path, kind):
    im = Image.open(path).convert("RGB")
    full_w, full_h = im.size
    im.thumbnail((SAMPLE_MAX, SAMPLE_MAX))
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    # Background = the most common (coarsely binned) colour around the border.
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    binned = border // 8
    keys, counts = np.unique(binned, axis=0, return_counts=True)
    bg = keys[counts.argmax()] * 8 + 4
    diff = np.abs(a - bg).max(axis=2) > TOL          # True where a pixel is ink
    plain_border = 1.0 - np.concatenate([diff[0], diff[-1], diff[:, 0], diff[:, -1]]).mean()
    total = w * h
    ink_pct = 100.0 * diff.mean()
    fails, adv = [], []

    if ink_pct < 0.1:
        fails.append("blank page: nothing visible on it")
    elif ink_pct < 2 and kind != "web":
        adv.append(f"mostly empty page ({ink_pct:.1f}% ink): a stray page break or an unfilled section?")

    # Content cut at the paper edge: only meaningful when the border is mostly plain background.
    if kind == "web":
        pass   # a page scrolls and heroes run edge to edge; sideways overflow is render_audit's page_overflow_x check
    elif plain_border >= 0.85 and ink_pct >= 0.1:
        e = max(2, int(min(w, h) * EDGE_FRAC))
        for side, strip in (("top", diff[:e]), ("bottom", diff[-e:]), ("left", diff[:, :e]), ("right", diff[:, -e:])):
            if strip.mean() > 0.004:
                msg = f"ink in the {side} edge strip: something may be cut off at the {side} of the page"
                (adv if kind == "deck" else fails).append(msg)
    elif plain_border < 0.85:
        adv.append("full-bleed edge (a photo or colour runs to the edge): fine for a cover, check it was meant")

    # A large flat box of one non-background colour: often an image slot that never filled.
    if kind != "web" and diff.any():
        q = (a[diff] // 4)
        keys, counts = np.unique(q, axis=0, return_counts=True)
        top = counts.argmax()
        if counts[top] / total > 0.12:
            mask = np.all(a // 4 == keys[top], axis=2)
            ys, xs = np.nonzero(mask)
            x0, x1 = np.percentile(xs, [1, 99]); y0, y1 = np.percentile(ys, [1, 99])   # ignore stray anti-aliased pixels
            box = (x1 - x0 + 1) * (y1 - y0 + 1)
            if counts[top] / box > 0.85 and box / total < 0.95:
                adv.append(f"large flat box of one colour ({100 * counts[top] / total:.0f}% of the page): an empty image slot or a placeholder panel?")

    digest = hashlib.sha1(a.tobytes()).hexdigest()
    return {"file": path, "size": [full_w, full_h], "ink_pct": round(float(ink_pct), 2), "failures": fails, "advisories": adv}, digest


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--kind", choices=["doc", "deck", "web"], default="doc")
    ap.add_argument("--json-out")
    a = ap.parse_args()
    pages, prev = [], None
    for i, p in enumerate(pages_from(a.paths), 1):
        r, d = check(p, a.kind)
        r["page"] = i
        if prev is not None and d == prev:
            r["advisories"].append(f"identical to page {i - 1}: a duplicated page or slide?")
        prev = d
        pages.append(r)
    failures = [f"page {r['page']}: {m}" for r in pages for m in r["failures"]]
    advisories = [f"page {r['page']}: {m}" for r in pages for m in r["advisories"]]
    report = {"ok": not failures, "pages": len(pages), "failures": failures, "advisories": advisories,
              "per_page": [{k: r[k] for k in ("page", "file", "ink_pct")} for r in pages]}
    s = json.dumps(report, indent=1)
    if a.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(a.json_out)), exist_ok=True)
        open(a.json_out, "w").write(s)
    print(s)
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
