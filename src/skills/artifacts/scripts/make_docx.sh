#!/bin/bash
# make_docx.sh: build, check and read back a Word document in one command, from the generator you wrote.
#
#   bash /opt/1hc/skills/artifacts/scripts/make_docx.sh <abs project dir>
#
# Runs <project>/.src/build_doc.py (python-docx; it saves <project>/<slug>.docx, slug = the folder name, or one other .docx there), then checks: the
# file opens and has a title property → render_docx.sh (LibreOffice → PDF → page PNGs in .src/validate) → page_check →
# read-back (fails on leftover placeholders). Prints one line per step and ends with PASS (the file to share and its text to
# read back) or FAIL (what failed, the fix, then run this same command again). Reports: .src/page_check.json,
# .src/readback.txt, .src/make_docx.json. Exit 0 PASS, 1 FAIL, 2 bad arguments.
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd)
case "${1:-}" in -h|--help|"") awk 'NR>1 && /^#/{sub(/^# ?/,"");print;next} NR>1{exit}' "$0"; [ -n "${1:-}" ]; exit $?;; esac
P=${1%/}; shift
[ $# -eq 0 ] || { echo "make_docx: unknown option $1 (see --help)"; exit 2; }
case "$P" in /*) ;; *) echo "make_docx: the project folder must be an absolute path"; exit 2;; esac
SRC=$P/.src; SLUG=$(basename "$P"); DOCX=$P/$SLUG.docx
[ -f "$SRC/build_doc.py" ] || { echo "FAIL: no $SRC/build_doc.py. Write the generator there first (the document reference)."; exit 2; }
J() { node -e "$1" "${@:2}"; }
# A page_check warning, with what it usually means, so it's fixed in one edit (or left alone) instead of investigated.
pc_hint() { case "$1" in *"mostly empty"*) echo " (a mostly empty page is nearly always a forced break before a short last section: page_break_before, add_page_break, add_section(NEW_PAGE) or a .page/break-before in CSS; remove it, or leave it if the page is meant to be short)";; *"flat box"*) echo " (a big flat box: an image that didn't load or an empty panel)";; esac; }
STEP=0
note() { STEP=$((STEP+1)); printf '[%d] %s\n' "$STEP" "$1"; }
summary() { J 'const [f,ok,step,why,fix,out]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify({ok:ok==="1",failed_step:step||null,why:why||null,fix:fix||null,out:out||null},null,1))' "$SRC/make_docx.json" "$@" 2>/dev/null; }
die() { summary 0 "$1" "$2" "$3" ""
  printf '\nFAIL at %s: %s\nFix: %s\nThen run the same command again: bash %s/make_docx.sh %s\n' "$1" "$2" "$3" "$S" "$P"; exit 1; }

rm -f "$DOCX"; T0=$(mktemp); trap 'rm -f "$T0"' EXIT
BD=$(cd "$P" && python3 .src/build_doc.py 2>&1) || die "build_doc.py" "$(printf '%s' "$BD" | grep -v '^\s*$' | tail -4 | cut -c1-300)" "fix the generator (python-docx and the standard library only, unless you pip-installed something)"
if [ ! -s "$DOCX" ]; then   # saved under another name: take the one .docx this run wrote in the project folder
  NEWD=$(find "$P" -maxdepth 1 -name '*.docx' -newer "$T0" 2>/dev/null)
  [ -n "$NEWD" ] && [ "$(printf '%s\n' "$NEWD" | wc -l)" -eq 1 ] && DOCX=$NEWD
fi
[ -s "$DOCX" ] || die "build_doc.py" "it ran but saved no .docx in $P" "save the document as $DOCX (doc.save(\"$DOCX\"))"
TT=$(python3 - "$DOCX" <<'PY' 2>&1
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1]); core = z.read("docProps/core.xml").decode("utf8", "replace") if "docProps/core.xml" in z.namelist() else ""
m = re.search(r"<dc:title>([^<]*)</dc:title>", core); print((m.group(1).strip() if m else "") or "NO_TITLE")
PY
) || die "open" "$DOCX isn't a valid Word file: $(printf '%s' "$TT" | tail -1)" "fix the generator"
[ "$TT" != "NO_TITLE" ] || die "title" "the document has no title property" "set doc.core_properties.title = \"...\" in build_doc.py"
note "built $DOCX (title: $TT)"

RD=$(bash "$S/render_docx.sh" "$DOCX" "$SRC/validate" 2>&1 | tail -1)
PAGES=$(printf '%s' "$RD" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?j.pages:"ERR "+j.error)}catch{console.log("ERR "+s.slice(0,300))}})')
case "$PAGES" in ERR*) die "render" "${PAGES#ERR }" "LibreOffice couldn't open it: simplify what build_doc.py writes (images as PNG/JPEG, no exotic fields)";; esac
note "LibreOffice render: $PAGES pages (.src/validate)"

python3 "$S/page_check.py" --kind doc --json-out "$SRC/page_check.json" "$SRC/validate" >/dev/null 2>&1; PCRC=$?
PCS=$(J 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((j.failures||[]).join(" | ").slice(0,600)+"\x1f"+(j.advisories||[]).slice(0,4).join(" | ").slice(0,400))}catch{console.log("no report\x1f")}' "$SRC/page_check.json")
IFS=$'\x1f' read -r PCF PCA <<<"$PCS"
[ $PCRC -eq 0 ] || die "page_check" "$PCF" "a blank page is usually a stray page break; content cut at the edge needs smaller images or wider margins"
note "page_check passed${PCA:+; warnings (not failures): $PCA$(pc_hint "$PCA")}"

RB=$(python3 "$S/readback.py" "$DOCX" --out "$SRC/readback.txt" --max-chars 7000 2>&1); RBRC=$?
[ $RBRC -eq 0 ] || die "readback" "$(printf '%s' "$RB" | head -c 600)" "remove the leftover placeholder text in build_doc.py"
summary 1 "" "" "" "$DOCX"
printf '\nPASS: %s (%s pages).\nNext: read the text below against the request and the outline (every section, numbers match the data, nothing invented), then\nshare_file path=%s name="%s.docx"\n\n' "$DOCX" "$PAGES" "$DOCX" "$TT"
printf '%s\n' "$RB" | awk 'f{print} /^}$/{f=1}' | sed '/^$/N;/^\n$/D'
