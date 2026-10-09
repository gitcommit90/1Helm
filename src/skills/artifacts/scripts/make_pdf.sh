#!/bin/bash
# make_pdf.sh: build, check and read back a PDF in one command, from the page you wrote.
#
#   bash /opt/1hc/skills/artifacts/scripts/make_pdf.sh <abs project dir> [--fonts "Family:wt,..."] [--page-selector ".page"]
#
# Reads <project>/.src/page.html (photos and charts as media/<file> from .src/media/). Steps: placeholder scan → embed images
# (embed_assets.py → .src/index.html) → render <slug>.pdf + PDF gates (render_audit: overflow, page geometry, 8pt text floor,
# image sharpness) → validate_pdf.sh (integrity, page PNGs) → page_check → read-back. Prints one line per step and ends with
# PASS (the file to share and its text to read back) or FAIL (what failed, the fix, then run this same command again).
# --fonts defaults to every family named first in a font-family rule of page.html, at 400. Reports: .src/render_report.json,
# .src/page_check.json, .src/readback.txt, .src/make_pdf.json. Exit 0 PASS, 1 FAIL, 2 bad arguments.
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd)
case "${1:-}" in -h|--help|"") awk 'NR>1 && /^#/{sub(/^# ?/,"");print;next} NR>1{exit}' "$0"; [ -n "${1:-}" ]; exit $?;; esac
P=${1%/}; shift
FONTS=""; SEL=".page"
while [ $# -gt 0 ]; do case "$1" in --fonts) FONTS=${2:-}; shift 2;; --page-selector) SEL=${2:-.page}; shift 2;; *) echo "make_pdf: unknown option $1 (see --help)"; exit 2;; esac; done
case "$P" in /*) ;; *) echo "make_pdf: the project folder must be an absolute path"; exit 2;; esac
SRC=$P/.src; SLUG=$(basename "$P"); PDF=$P/$SLUG.pdf
[ -f "$SRC/page.html" ] || { echo "FAIL: no $SRC/page.html. Write the page there first (the pdf reference has the page setup)."; exit 2; }
J() { node -e "$1" "${@:2}"; }
# A page_check warning, with what it usually means, so it's fixed in one edit (or left alone) instead of investigated.
pc_hint() { case "$1" in *"mostly empty"*) echo " (a mostly empty page is nearly always a forced break before a short last section: page_break_before, add_page_break, add_section(NEW_PAGE) or a .page/break-before in CSS; remove it, or leave it if the page is meant to be short)";; *"flat box"*) echo " (a big flat box: an image that didn't load or an empty panel)";; esac; }
STEP=0
note() { STEP=$((STEP+1)); printf '[%d] %s\n' "$STEP" "$1"; }
summary() { J 'const [f,ok,step,why,fix,out]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify({ok:ok==="1",failed_step:step||null,why:why||null,fix:fix||null,out:out||null},null,1))' "$SRC/make_pdf.json" "$@" 2>/dev/null; }
die() { summary 0 "$1" "$2" "$3" ""
  printf '\nFAIL at %s: %s\nFix: %s\nThen run the same command again: bash %s/make_pdf.sh %s\n' "$1" "$2" "$3" "$S" "$P"; exit 1; }

TODOS=$(grep -n -E 'FILL IN|\bTODO\b|\bTBD\b|lorem ipsum' "$SRC/page.html" | sed -E 's/[[:space:]]+/ /g' | cut -c1-140 | head -6)
[ -z "$TODOS" ] || die "page.html" "unfinished text:
$TODOS" "replace it with the real content"
EA=$(python3 "$S/embed_assets.py" "$SRC/page.html" "$SRC/index.html" 2>&1) || die "embed images" "$(printf '%s' "$EA" | tail -3 | cut -c1-400)" "check the media/ names in page.html match files in .src/media/"
note "images embedded into .src/index.html"

if [ -z "$FONTS" ]; then
  FONTS=$(J 'const s=require("fs").readFileSync(process.argv[1],"utf8");const f=new Set();for(const m of s.matchAll(/font-family\s*:\s*([^;}"]+|"[^"]+"[^;}]*)/g)){const first=m[1].split(",")[0].trim().replace(/^["\x27]|["\x27]$/g,"");if(first&&!/^(serif|sans-serif|monospace|inherit|var\()/.test(first))f.add(first)}console.log([...f].map(x=>x+":400").join(","))' "$SRC/page.html")
fi
node "$S/render_audit.mjs" --html "$SRC/index.html" --pdf "$PDF" --page-selector "$SEL" ${FONTS:+--fonts "$FONTS"} \
  --require-geometry --require-text-floor --require-image-resolution --hermetic --gate --report-out "$SRC/render_report.json" >/dev/null 2>"$SRC/render.err"
RA=$(J 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{console.log("ERR\x1fno report: "+fs.readFileSync(process.argv[2],"utf8").split("\n").filter(l=>!/Ignoring extra certs/.test(l)).slice(-3).join(" ").slice(0,300));process.exit()}
const t=(x)=>typeof x==="string"?x:JSON.stringify(x);console.log([j.ok?"ok":"ERR",(j.gate_failures||[]).map(t).join(" | ").slice(0,900),(j.advisories||[]).map(t).slice(0,4).join(" | ").slice(0,500),j.pages||""].join("\x1f"))' "$SRC/render_report.json" "$SRC/render.err")
IFS=$'\x1f' read -r RST RFAIL RADV RPAGES <<<"$RA"
[ "$RST" = "ok" ] || die "render gates" "$RFAIL" "overflow or a page taller than its box: cut content or move a section to the next .page; text below 8pt: put the size back and cut; images wider than their pixels: a bigger photo or show it smaller; a broken image: check the media/ name. Details: $SRC/render_report.json"
note "rendered $PDF, gates passed${RADV:+; advisories: $RADV}"

VP=$(bash "$S/validate_pdf.sh" "$PDF" "$SRC/index.html" "$SRC/validate" 2>&1) || die "validate_pdf" "$(printf '%s' "$VP" | grep -m1 FAIL || printf '%s' "$VP" | tail -1)" "a non-embedded image: run this command again after fixing the media/ name; otherwise fix page.html"
RPAGES=$(ls "$SRC/validate"/page-*.png 2>/dev/null | wc -l | tr -d " ")
note "PDF opens ($RPAGES pages), every image embedded, page images in .src/validate"

python3 "$S/page_check.py" --kind doc --json-out "$SRC/page_check.json" "$SRC/validate" >/dev/null 2>&1; PCRC=$?
PCS=$(J 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((j.failures||[]).join(" | ").slice(0,600)+"\x1f"+(j.advisories||[]).slice(0,4).join(" | ").slice(0,400))}catch{console.log("no report\x1f")}' "$SRC/page_check.json")
IFS=$'\x1f' read -r PCF PCA <<<"$PCS"
[ $PCRC -eq 0 ] || die "page_check" "$PCF" "a blank page is usually a trailing page break; content cut at the edge needs more padding or less content"
note "page_check passed${PCA:+; warnings (not failures): $PCA$(pc_hint "$PCA")}"

RB=$(python3 "$S/readback.py" "$PDF" --out "$SRC/readback.txt" --max-chars 7000 2>&1); RBRC=$?
[ $RBRC -eq 0 ] || die "readback" "$(printf '%s' "$RB" | head -c 600)" "remove the leftover placeholder text from page.html"
summary 1 "" "" "" "$PDF"
printf '\nPASS: %s (%s pages).\nNext: read the text below against the request and the outline (every section, numbers match the data, nothing invented), then\nshare_file path=%s name="<readable name>.pdf"\n\n' "$PDF" "$RPAGES" "$PDF"
printf '%s\n' "$RB" | awk 'f{print} /^}$/{f=1}' | sed '/^$/N;/^\n$/D'
