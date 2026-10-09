#!/bin/bash
# Render an office file (.docx/.doc/.odt/.rtf, .pptx, .xlsx) to PDF with headless LibreOffice,
# then rasterize every page to PNG with pdftoppm. These page images and the PDF text are what the
# render gate checks: they show the file the way a reader opens it, not the way the generator meant it.
#
# usage: render_docx.sh <file> <out_dir> [dpi=100] [timeout_seconds=120]
# Writes <out_dir>/<name>.pdf and <out_dir>/page-*.png (the dir's old page-*.png are removed first),
# then prints one JSON line: {"ok":true,"pdf":...,"pages":N,"pngs":[...]}. Exit 1 with {"ok":false,"error":...}.
set -u
case "${1:-}" in -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0;; esac
src=${1:-}; out=${2:-}; dpi=${3:-100}; limit=${4:-120}
die() { printf '{"ok":false,"error":"%s"}\n' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; exit 1; }
[ -n "$src" ] && [ -n "$out" ] || die "usage: render_docx.sh <file> <out_dir> [dpi] [timeout_seconds]"
[ -f "$src" ] || die "no such file: $src"
command -v soffice >/dev/null || die "soffice (LibreOffice) is not installed"
command -v pdftoppm >/dev/null || die "pdftoppm (poppler) is not installed"
mkdir -p "$out" || die "cannot create $out"
src=$(readlink -f "$src"); out=$(readlink -f "$out")
name=$(basename "${src%.*}")
pdf="$out/$name.pdf"

if [ "${src##*.}" = "pdf" ]; then
  cp -f "$src" "$pdf" 2>/dev/null || true
else
  rm -f "$pdf"
  # Decks: Impress needs a UI file the -nogui package leaves out (lo_impress_ui.sh writes it when missing).
  bash "$(dirname "$0")/lo_impress_ui.sh" >/dev/null 2>&1 || true
  # A private profile per run: two LibreOffice runs sharing one profile block each other.
  prof=$(mktemp -d /tmp/lo-render-XXXXXX)
  export HOME=${HOME:-/tmp}; [ -w "$HOME" ] || export HOME=/tmp
  timeout "$limit" soffice --headless --norestore "-env:UserInstallation=file://$prof" \
    --convert-to pdf --outdir "$out" "$src" >"$prof.log" 2>&1
  rc=$?
  # soffice can hang after it has stored the file; judge by the output, not the exit code.
  if [ ! -s "$pdf" ]; then
    msg="LibreOffice produced no PDF (exit $rc): $(tail -c 300 "$prof.log" | tr '\n' ' ')"
    rm -rf "$prof" "$prof.log"; die "$msg"
  fi
  rm -rf "$prof" "$prof.log"
fi

pages=$(pdfinfo "$pdf" 2>/dev/null | awk '/^Pages:/{print $2}')
[ -n "$pages" ] && [ "$pages" -gt 0 ] 2>/dev/null || die "the PDF does not open (pdfinfo failed): $pdf"
rm -f "$out"/page-*.png
pdftoppm -png -r "$dpi" "$pdf" "$out/page" || die "pdftoppm failed on $pdf"
pngs=$(ls "$out"/page-*.png 2>/dev/null | sort -V | sed 's/.*/"&"/' | paste -sd, -)
n=$(ls "$out"/page-*.png 2>/dev/null | wc -l)
[ "$n" = "$pages" ] || die "rasterized $n page(s) but the PDF has $pages"
printf '{"ok":true,"pdf":"%s","pages":%s,"pngs":[%s]}\n' "$pdf" "$pages" "$pngs"
