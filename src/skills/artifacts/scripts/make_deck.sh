#!/bin/bash
# make_deck.sh: build, check and export a deck in one command, from the slide files new_deck.mjs started.
#
#   bash /opt/1hc/skills/artifacts/scripts/make_deck.sh <abs project dir> [--no-cover-image] [--no-restraint] [--pdf] [--html]
#
# Reads <project>/.src/slides/ (deck.json, deck.css, <id>.html; photos as media/<file> from .src/media/) and .src/style_plan.json.
# Steps: placeholder scan → embed photos and fonts (in a build copy, so the slide files stay small) → assemble .src/index.html →
# render + deck gates (render_audit) → page_check → build <slug>.pptx (photo credits in each slide's speaker notes) (+ <slug>.pdf with --pdf, <slug>.html with --html) →
# read-back. Prints one line per step and ends with PASS (the file to share and the slide text to read back) or FAIL (what
# failed, the fix, and that you run this same command again). Reports: .src/render_report.json, .src/page_check.json,
# .src/readback.txt, .src/make_deck.json. --no-cover-image only when no fitting cover photo exists (say so in your reply);
# --no-restraint only when editing an older deck whose untouched slides predate the restraint gate.
# Exit 0 PASS, 1 FAIL, 2 bad arguments.
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd)
case "${1:-}" in -h|--help|"") awk 'NR>1 && /^#/{sub(/^# ?/,"");print;next} NR>1{exit}' "$0"; [ -n "${1:-}" ]; exit $?;; esac
P=${1%/}; shift
COVER=--require-cover-image; RESTRAINT=--require-restraint; PDF=0; HTML=0
for a in "$@"; do case "$a" in --no-cover-image) COVER="";; --no-restraint) RESTRAINT="";; --pdf) PDF=1;; --html) HTML=1;; *) echo "make_deck: unknown option $a (see --help)"; exit 2;; esac; done
case "$P" in /*) ;; *) echo "make_deck: the project folder must be an absolute path"; exit 2;; esac
SRC=$P/.src; SL=$SRC/slides; B=$SRC/build; SLUG=$(basename "$P")
[ -f "$SL/deck.json" ] || { echo "FAIL: no $SL/deck.json. Start the deck with: node $S/new_deck.mjs $P --title \"<title>\" --slides cover,...,closing"; exit 2; }
[ -f "$SRC/style_plan.json" ] || { echo "FAIL: no $SRC/style_plan.json. Start the deck with new_deck.mjs (it writes the plan)."; exit 2; }
J() { node -e "$1" "${@:2}"; }   # small JSON reads
TITLE=$(J 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d.main_title||""))' "$SL/deck.json")
[ -n "$TITLE" ] || TITLE=$SLUG
STEP=0
note() { STEP=$((STEP+1)); printf '[%d] %s\n' "$STEP" "$1"; }
summary() { J 'const [f,ok,step,why,fix,out]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify({ok:ok==="1",failed_step:step||null,why:why||null,fix:fix||null,out:out||null},null,1))' "$SRC/make_deck.json" "$@" 2>/dev/null; }
die() {   # step, why, fix
  summary 0 "$1" "$2" "$3" ""
  printf '\nFAIL at %s: %s\nFix: %s\nThen run the same command again: bash %s/make_deck.sh %s\n' "$1" "$2" "$3" "$S" "$P"; exit 1; }

# 1. The slide files: every slide in deck.json exists, nothing left from the skeletons.
MISSING=$(J 'const fs=require("fs"),p=require("path");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((d.slides||[]).map(s=>s.id).filter(id=>!fs.existsSync(p.join(p.dirname(process.argv[1]),id+".html"))).join(" "))' "$SL/deck.json")
[ -z "$MISSING" ] || die "slide files" "deck.json lists slides with no file: $MISSING" "write .src/slides/<id>.html for each, or remove them from deck.json"
TODOS=$(sed -E 's#data:[^"'"'"')]+#data:#g' "$SL"/*.html 2>/dev/null | grep -n -E 'FILL IN|\bTODO\b|\bTBD\b|lorem ipsum' | sed -E 's/[[:space:]]+/ /g' | cut -c1-140 | head -8)
[ -z "$TODOS" ] || die "slide files" "skeleton text is still there:
$TODOS" "replace every FILL IN line with the real content (write_file the whole slide file)"
note "slide files: $(ls "$SL"/*.html | wc -l | tr -d ' ') written, nothing left to fill in"

# 2. Embed photos and fonts into a build copy, then assemble .src/index.html.
rm -rf "$B"; mkdir -p "$B"; cp "$SL"/*.html "$SL/deck.css" "$SL/deck.json" "$B"/
IM=$(python3 "$S/inline_media.py" --media "$SRC/media" "$B"/*.html 2>&1); IMRC=$?
MISS=$(printf '%s' "$IM" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.trim().split("\n").pop());console.log([...new Set((j.files||[]).flatMap(f=>(f.missing||[]).map(m=>require("path").basename(f.file)+": media/"+m)))].join(", "))}catch{console.log("")}})')
[ $IMRC -eq 0 ] || [ -n "$MISS" ] || die "photos" "inline_media.py failed: $(printf '%s' "$IM" | tail -3)" "check the media/ names in the slide files"
[ -z "$MISS" ] || die "photos" "missing photo files: $MISS" "download them into $SRC/media/ under those names (images.py fetch --to $SRC/media \"<name>=<subject>\"), or change the slide to a photo you have, or drop the <img>"
FONTS=$(node "$S/embed_deck_fonts.mjs" --slides "$B" 2>&1 | tail -1)
FW=$(printf '%s' "$FONTS" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?(j.warnings||[]).join("; "):"ERR "+(j.error||s))}catch{console.log("ERR "+s.slice(0,200))}})')
case "$FW" in ERR*) die "fonts" "embed_deck_fonts.mjs: ${FW#ERR }" "check the two font tokens in deck.css's :root block (keep the style plan's families)";; esac
AS=$(node "$S/assemble_deck.mjs" --slides "$B" --out "$SRC/index.html" 2>/dev/null | tail -1)
AOK=$(printf '%s' "$AS" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?"ok "+j.count:"ERR "+j.error)}catch{console.log("ERR "+s.slice(0,300))}})')
case "$AOK" in ERR*) die "assemble" "${AOK#ERR }" "fix that slide file in .src/slides/ (the build copy is remade each run)";; esac
cp "$B/deck.json" "$SL/deck.json"   # the derived fields (slide headings) feed the .pptx speaker notes
note "photos and fonts embedded${FW:+ (font warning: $FW)}; assembled ${AOK#ok } slides into .src/index.html"

# 3. Render every slide and run the deck gates.
read -r FD FB < <(J 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(p.fonts.display.replace(/ /g,"_")+" "+p.fonts.body.replace(/ /g,"_"))' "$SRC/style_plan.json")
FD=${FD//_/ }; FB=${FB//_/ }
node "$S/render_audit.mjs" --html "$SRC/index.html" --png-dir "$SRC/validate" --page-selector "section.slide" --structure-check \
  --require-webfonts --fonts "$FD:400,$FB:400" --style-plan "$SRC/style_plan.json" \
  --require-fill $COVER $RESTRAINT --require-text-floor --hermetic --gate --report-out "$SRC/render_report.json" >/dev/null 2>"$B/render.err"
RA=$(J 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{console.log("ERR no report: "+fs.readFileSync(process.argv[2],"utf8").split("\n").filter(l=>!/Ignoring extra certs/.test(l)).slice(-3).join(" ").slice(0,300));process.exit()}
const g=(j.gate_failures||[]).map(x=>typeof x==="string"?x:JSON.stringify(x));const adv=(j.advisories||[]).map(x=>typeof x==="string"?x:JSON.stringify(x));
const ov=(j.overflow||[]).map(o=>"slide "+(o.index+1)+" overflows by "+Math.max(o.overflowY_px||0,o.overflowX_px||0)+"px");
console.log([j.ok?"ok":"ERR",[...g,...(j.ok?[]:ov)].join(" | ").slice(0,900),adv.slice(0,4).join(" | ").slice(0,500),j.pages||(j.pngs||[]).length||""].join("\x1f"))' "$SRC/render_report.json" "$B/render.err")
IFS=$'\x1f' read -r RST RFAIL RADV RPAGES <<<"$RA"
if [ "$RST" != "ok" ]; then
  H=""
  case "$RFAIL" in *overflow*) H="$H overflow: cut words or items on that slide, or switch it to a roomier layout (never shrink type).";; esac
  case "$RFAIL" in *fill*|*dead\ space*|*packed*) H="$H fill: give that slide more substance, a photo (a lockup class) or a bigger layout.";; esac
  case "$RFAIL" in *furniture*|*uppercase*|*track*) H="$H restraint: remove uppercase, letter-spacing and pill/badge/tag/kicker classes.";; esac
  case "$RFAIL" in *cover*) H="$H cover: the cover needs its photo (media/cover.jpg in the cover's <style>); with no fitting photo at all, re-run with --no-cover-image and say so.";; esac
  case "$RFAIL" in *broken*|*image*) H="$H images: check the photo file exists in .src/media/ and opens.";; esac
  case "$RFAIL" in *font*) H="$H fonts: keep the style plan's two families in deck.css's :root block.";; esac
  die "render gates" "${RFAIL:-${RA#ERR }}" "${H# }${H:+ }Details: $SRC/render_report.json"
fi
note "render gates passed (${RPAGES:-?} slide images in .src/validate)${RADV:+; advisories: $RADV}"

# 4. The automatic look at the slide images.
PC=$(python3 "$S/page_check.py" --kind deck --json-out "$SRC/page_check.json" "$SRC/validate" 2>&1); PCRC=$?
PCS=$(J 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((j.failures||[]).join(" | ").slice(0,600)+"\x1f"+(j.advisories||[]).filter(a=>!/full-bleed|edge strip/.test(a)).slice(0,4).join(" | ").slice(0,400))}catch{console.log("no report\x1f")}' "$SRC/page_check.json")
IFS=$'\x1f' read -r PCF PCA <<<"$PCS"
[ $PCRC -eq 0 ] || die "page_check" "${PCF:-$(printf '%s' "$PC" | tail -2)}" "a blank slide or cut-off content: fix that slide's content or photo"
note "page_check passed${PCA:+; check these: $PCA}"

# 5. Export.
rm -f "$P/$SLUG.pptx"
BP=$(python3 "$S/build_pptx.py" "$SLUG" "$TITLE" --project-dir "$P" 2>&1) || die "build_pptx" "$(printf '%s' "$BP" | tail -2)" "re-run; if it fails again tell the person the PowerPoint export failed and offer a PDF"
# (zipfile, not `unzip -l | grep -q`: under pipefail grep's early exit makes unzip die of SIGPIPE and a good file look empty; dev 10-07)
NMEDIA=$(python3 -c 'import sys,zipfile; print(sum(n.startswith("ppt/media/") for n in zipfile.ZipFile(sys.argv[1]).namelist()))' "$P/$SLUG.pptx" 2>/dev/null || echo 0)
[ "${NMEDIA:-0}" -gt 0 ] || die "build_pptx" "the .pptx has no slide images" "re-run this command; if it fails again tell the person the PowerPoint export failed and offer a PDF"
OUTS="$P/$SLUG.pptx"
CRED=$(printf '%s' "$BP" | tail -1 | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).credited_slides||0)}catch{console.log(0)}})')
if [ $PDF = 1 ]; then
  node "$S/render_audit.mjs" --html "$SRC/index.html" --pdf "$P/$SLUG.pdf" --page-selector "section.slide" --fonts "$FD:400,$FB:400" --hermetic --report-out "$SRC/render_pdf_report.json" >/dev/null 2>&1 \
    && [ -s "$P/$SLUG.pdf" ] || die "pdf export" "render_audit could not write the PDF (see $SRC/render_pdf_report.json)" "re-run this command"
  OUTS="$OUTS $P/$SLUG.pdf"
fi
[ $HTML = 1 ] && cp "$SRC/index.html" "$P/$SLUG.html" && OUTS="$OUTS $P/$SLUG.html"
note "exported $OUTS (photo credits from .src/media/SOURCES.md in the speaker notes of ${CRED:-0} slides)"

# 6. Read-back of the slide text.
RB=$(python3 "$S/readback.py" "$SRC/index.html" --out "$SRC/readback.txt" --max-chars 3500 2>&1); RBRC=$?
[ $RBRC -eq 0 ] || die "readback" "$(printf '%s' "$RB" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(0,s.indexOf("\n}")+2));console.log((j.placeholders||[]).map(p=>p.where+": "+p.found).join(", ")||j.error)}catch{console.log(s.slice(0,300))}})')" "remove the leftover placeholder text from those slides"
summary 1 "" "" "" "$OUTS"
printf '\nPASS: %s (%s slides, "%s").\nNext: read the slide text below against the request (count, every planned point, no invented fact), then\nshare_file path=%s name="%s.pptx"\n\n' "$OUTS" "${RPAGES:-?}" "$TITLE" "$P/$SLUG.pptx" "$TITLE"
printf '%s\n' "$RB" | awk 'f{print} /^}$/{f=1}' | sed '/^$/N;/^\n$/D'
