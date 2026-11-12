#!/usr/bin/env bash
# validate_pdf.sh <pdf> <source.html> <out-dir ending in /validate>
#
# Mechanical checks on a rendered PDF, then a fresh raster of every page:
#   - it is a real PDF with a positive page count (pdfinfo)
#   - every <img> and CSS url(...) in the source is an embedded data: URI
#   - every page rasterises to <out-dir>/page-N.png (pdftoppm, 150 dpi)
# The out-dir is wiped first, so keep reports outside it.
# Exit 0 = PASS; any failure prints FAIL: <reason> and exits 1. Run it until it passes,
# then check the PNGs (page_check.py) and read the text back (readback.py).
set -euo pipefail
case "${1:-}" in -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0;; esac

fail() { echo "FAIL: $*" >&2; exit 1; }

[ "$#" -eq 3 ] || { echo "usage: validate_pdf.sh <pdf> <html> <out-dir>" >&2; exit 2; }
PDF="$1"; HTML="$2"; OUT="$3"

for cmd in python3 pdfinfo pdftoppm awk; do
  command -v "$cmd" >/dev/null 2>&1 || fail "required command not found: $cmd"
done
[ -f "$PDF" ] || fail "PDF missing: $PDF"
[ -f "$HTML" ] || fail "HTML missing: $HTML"
[ "$(basename "$OUT")" = "validate" ] || fail "out-dir must end in /validate"
[ ! -e "$OUT" ] || [ -d "$OUT" ] || fail "out-dir exists but is not a directory: $OUT"
rm -rf "$OUT"; mkdir -p "$OUT"
echo "OK: inputs found; validation folder ready: $OUT"

# Integrity and page count.
head -c 4 "$PDF" | grep -q '^%PDF' || fail "not a PDF"
echo "size=$(wc -c <"$PDF") bytes"
PDFINFO=$(pdfinfo "$PDF") || fail "pdfinfo failed"
printf '%s\n' "$PDFINFO" | grep -E '^(Pages|Page size|Title):' || true
LAST=$(printf '%s\n' "$PDFINFO" | awk '/^Pages:/ {print $2; exit}')
case "$LAST" in ''|*[!0-9]*) fail "could not read the page count" ;; esac
[ "$LAST" -gt 0 ] || fail "the PDF has no pages"
echo "OK: PDF is valid with $LAST page(s)"

# Every image in the source must travel inside the file. Parsed with a real HTML
# parser so quoting, case and line breaks in attributes don't fool it.
COUNTS=$(python3 -I - "$HTML" <<'PY'
import re, sys
from html.parser import HTMLParser
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I)
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.imgs = self.data_imgs = 0; self.css = []; self.in_style = False
    def handle_starttag(self, tag, attrs):
        a = {k.lower(): v or "" for k, v in attrs}
        if tag == "style": self.in_style = True
        if tag == "img":
            self.imgs += 1
            if a.get("src", "").strip().lower().startswith("data:"): self.data_imgs += 1
        if "style" in a: self.css.append(a["style"])
    def handle_startendtag(self, tag, attrs): self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        if tag == "style": self.in_style = False
    def handle_data(self, d):
        if self.in_style: self.css.append(d)
p = P(); p.feed(open(sys.argv[1], encoding="utf-8", errors="replace").read())
urls = [m.group(2).strip() for c in p.css for m in CSS_URL.finditer(c)]
urls = [u for u in urls if u and not u.startswith("#")]
print(p.imgs, p.data_imgs, len(urls), sum(u.lower().startswith("data:") for u in urls))
PY
)
set -- $COUNTS
echo "imgs=$1 data-uri-imgs=$2 css-urls=$3 css-data-uris=$4"
[ "$1" -eq "$2" ] || fail "$(( $1 - $2 )) <img> tag(s) are not data: URIs; embed them"
[ "$3" -eq "$4" ] || fail "$(( $3 - $4 )) CSS url(...) reference(s) are not data: URIs; embed them"
echo "OK: every image in the source is embedded"

# Rasterise every page from the PDF bytes themselves.
pdftoppm -png -r 150 -f 1 -l "$LAST" "$PDF" "$OUT/page"
N=0
for png in "$OUT"/page-*.png; do
  [ -f "$png" ] || continue
  N=$((N + 1))
  SZ=$(wc -c <"$png")
  echo "$png $SZ bytes"
  [ "$SZ" -ge 20000 ] || echo "WARN: $png is under 20 KB; it may be blank" >&2
done
[ "$N" -eq "$LAST" ] || fail "rendered $N page image(s), expected $LAST"
echo "OK: rendered $N page image(s) from the PDF"
echo "PASS: mechanical PDF checks done; now run page_check.py on $OUT and readback.py on the PDF."
