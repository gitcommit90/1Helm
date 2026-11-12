#!/bin/bash
# make_deck.sh: build, check and export a deck in one command, from the slide files new_deck.mjs started.
#
#   bash /opt/1hc/skills/artifacts/scripts/make_deck.sh <abs project dir> [--pdf] [--pptx]
#
# Reads <project>/.src/deck.json, slides/<id>.html, notes.json and media/. Steps: assemble the one self-contained file
# <project>/<slug>.html (template document, fonts and photos embedded, shell with keys, tap, full screen, counter and notes) →
# step through every slide at 1920x1080 and check it (deck_check.mjs) → page_check on the slide images → read-back of the slide
# text. --pdf also writes <slug>.pdf (one page per slide, text selectable); --pptx writes <slug>.pptx with editable text, shapes
# and pictures (export_pptx.mjs), only when the person asked for PowerPoint. Prints one line per step and ends with PASS (the file
# to share, the slide text to read back) or FAIL (what failed, the fix, and that you run this same command again).
# Reports: .src/check_report.json, .src/page_check.json, .src/readback.txt, .src/make_deck.json. Exit 0 PASS, 1 FAIL, 2 bad arguments.
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd)
case "${1:-}" in -h|--help|"") awk 'NR>1 && /^#/{sub(/^# ?/,"");print;next} NR>1{exit}' "$0"; [ -n "${1:-}" ]; exit $?;; esac
P=${1%/}; shift
case "$P" in /*) ;; *) [ -d "$P" ] && P=$(cd "$P" && pwd);; esac   # a relative project folder is resolved against the folder the command runs in
PDF=0; PPTX=0
for a in "$@"; do case "$a" in --pdf) PDF=1;; --pptx) PPTX=1;; *) echo "make_deck: unknown option $a (see --help)"; exit 2;; esac; done
case "$P" in /*) ;; *) echo "FAIL: make_deck: there is no project folder $P (run new_deck.mjs first, or give its path)"; exit 2;; esac
SRC=$P/.src; SLUG=$(basename "$P"); MAX_BYTES=12000000
[ -f "$SRC/deck.json" ] || { echo "FAIL: no $SRC/deck.json. Start the deck with: node $S/new_deck.mjs $P --template <name> --title \"<title>\" --slides <pattern>,..."; exit 2; }
J() { node -e "$1" "${@:2}"; }   # small JSON reads
STEP=0
note() { STEP=$((STEP+1)); printf '[%d] %s\n' "$STEP" "$1"; }
summary() { J 'const [f,ok,step,why,fix,out]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify({ok:ok==="1",failed_step:step||null,why:why||null,fix:fix||null,out:out||null},null,1))' "$SRC/make_deck.json" "$@" 2>/dev/null; }
die() {   # step, why, fix
  summary 0 "$1" "$2" "$3" ""
  printf '\nFAIL at %s: %s\nFix: %s\nThen run the same command again: bash %s/make_deck.sh %s%s%s\n' "$1" "$2" "$3" "$S" "$P" "$([ $PDF = 1 ] && echo ' --pdf')" "$([ $PPTX = 1 ] && echo ' --pptx')"; exit 1; }


# 1 and 2. Assemble the file, then step through every slide and check it. Slides whose only failures are text cut off or overlapping text are repaired
# (deck_repair.mjs sets the words that differ from the sample smaller, together, until the slide passes) and the deck is built and checked again, at most twice.
# 0. Impact figures. Whatever way the slide files were written (a data file, or the sample's markup filled by hand), each figure that would be cut off is sized with
# new_deck's rules before the first build (deck_repair.mjs --figures needs no browser). One that fits no size is named with the length that does.
FIGOUT=$(node "$S/deck_repair.mjs" "$P" --figures 2>/dev/null | tail -1)
FIGS=$(printf '%s' "$FIGOUT" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const p=j.problems||[];if(p.length){console.log("P\x1f"+p.slice(0,6).map(q=>"slide "+q.slide+" ("+q.id+"): the "+q.slot+" figure \""+q.value+"\" does not fit its place at the smallest readable size ("+q.width+"px wide). Shorten its \"value\" to about "+q.chars+" characters or fewer (\"3 days → 4 hours\" becomes \"3d → 4h\") and keep the unit in its label").join("; ")+(p.length>6?"; and "+(p.length-6)+" more":""))}else console.log("F\x1f"+(j.figures||[]).length)}catch{console.log("F\x1f0")}})')
case "$FIGS" in P*) die "figures" "${FIGS#P$'\x1f'}" "change those figures in the data file or the slide files (a data file: run new_deck.mjs with --redo again)";; esac
FIGN=${FIGS#F$'\x1f'}; FIGNOTE=""; [ "${FIGN:-0}" -gt 0 ] && FIGNOTE="; $FIGN impact figure(s) were wider than their place and were set smaller to fit"
REPAIRED=""; TRIES=0; PXPID=""; PXOUT="$SRC/pptx.out"; trap '[ -n "$PXPID" ] && kill "$PXPID" 2>/dev/null' EXIT
while :; do
# 1. Assemble the file.
AS=$(node "$S/assemble_deck.mjs" "$P" 2>&1 | tail -1)
read -r AOK ASLIDES ABYTES AMISS AWARN < <(printf '%s' "$AS" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?["ok",j.slides,j.bytes,(j.missing_media||[]).join(",")||"-",(j.warnings||[]).join("; ")||"-"].join(" "):"ERR "+j.error)}catch{console.log("ERR "+s.slice(0,300))}})')
[ "$AOK" = ok ] || die "assemble" "${AOK#ERR }${ASLIDES:+ $ASLIDES $ABYTES $AMISS $AWARN}" "fix that file in .src/ (deck.json, slides/<id>.html), the build is remade each run"
[ "$AMISS" = "-" ] || die "photos" "slide files refer to pictures that are not in .src/media: $AMISS" "put the files in $SRC/media/ under those names (images.py fetch --to $SRC/media \"<name>=<subject>\"), or take the <img> out of the slide"
[ "$ABYTES" -le $MAX_BYTES ] || die "size" "the deck file is $((ABYTES/1000000)) MB, over the $((MAX_BYTES/1000000)) MB limit" "use fewer or smaller photos (they are embedded as they are, up to 2560 px wide), then run again"
[ $TRIES = 0 ] && note "assembled $ASLIDES slides into $SLUG.html ($((ABYTES/1000)) KB, fonts and pictures inside, works offline)${AWARN/#-/}"

# The PowerPoint export reads the same built deck as the checks and writes to its own folder, so it runs beside them (Chrome opens the deck twice at once);
# its result is read in step 4. A failed check ends this script and stops it. A deck built again after a repair is exported again.
[ -n "$PXPID" ] && { kill "$PXPID" 2>/dev/null; wait "$PXPID" 2>/dev/null; PXPID=""; }
if [ $PPTX = 1 ]; then rm -f "$PXOUT"; node "$S/export_pptx.mjs" "$P" >"$PXOUT" 2>&1 & PXPID=$!; fi

# 2. Step through every slide and check it.
CHK=(node "$S/deck_check.mjs" "$P" --report-out "$SRC/check_report.json")
[ $PDF = 1 ] && CHK+=(--pdf "$P/$SLUG.pdf")
"${CHK[@]}" >/dev/null 2>"$SRC/check.err"
RES=$(J 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{console.log("ERR no report: "+fs.readFileSync(process.argv[2],"utf8").split("\n").filter(l=>!/Ignoring extra certs/.test(l)).slice(-4).join(" ").slice(0,400));process.exit()}
console.log([j.ok?"ok":"ERR",(j.failures||[]).join(" | ").slice(0,1800),(j.notes||[]).join(" | ").slice(0,600)].join("\x1f"))' "$SRC/check_report.json" "$SRC/check.err")
IFS=$'\x1f' read -r CST CFAIL CNOTE <<<"$RES"
if [ "$CST" != "ok" ] && [ $TRIES -lt 2 ]; then
  RPN=$(node "$S/deck_repair.mjs" "$P" 2>/dev/null | tail -1 | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.repaired||[]).length+"\x1f"+(j.repaired||[]).map(r=>"slide "+parseInt(r.id,10)+" ("+r.id.replace(/^\d+-/,"")+") "+r.units.map(u=>(u.slot||"text")+" "+u.from+"px to "+u.to+"px").join(", ")).join("; "))}catch{console.log("0\x1f")}})')
  IFS=$'\x1f' read -r RPC RPT <<<"$RPN"
  if [ "${RPC:-0}" -gt 0 ]; then TRIES=$((TRIES+1)); REPAIRED="${REPAIRED:+$REPAIRED; }$RPT"; continue; fi
fi
break
done
if [ "$CST" != "ok" ]; then
  H=""
  case "$CFAIL" in *"cut off"*|*overlaps*) H="$H cut words or items on that slide (one idea per slide; split it into two slides rather than shrink type), or pick a slide pattern with more room.";; esac
  # Text cut off: name the slide, the field of the data file and how long the words may be (deck_fit.mjs), in place of the general advice above.
  case "$CFAIL" in *"cut off"*) EX=$(node "$S/deck_fit.mjs" --explain "$P" "$CFAIL" 2>/dev/null); [ -n "$EX" ] && H=" $EX";; esac
  case "$CFAIL" in *"under "*px*) H="$H text that small can't be read from the back of a room: shorten it, or move it to the speaker notes.";; esac
  case "$CFAIL" in *placeholder*|*"template text"*|*bracketed*|*TBD*) H="$H replace every sample sentence, label and [bracket] in that slide file (new_deck.mjs --patterns <template> shows what each pattern holds).";; esac
  case "$CFAIL" in *"picture"*|*"did not load"*) H="$H the picture file is missing or damaged: fetch it again into .src/media or drop the <img>.";; esac
  case "$CFAIL" in *outside\ itself*) H="$H the slide links to a web address or a local file: remove the link or embed the file under .src/media.";; esac
  case "$CFAIL" in *"did not move"*) H="$H a slide file broke the template's slide structure: keep each slide's outer element and its class names.";; esac
  # A cut-off impact figure ("3 days → 4 hours") has one fix: a shorter "value" in the deck's data file. Name it, with the exact shorter form.
  FH=$(J 'const fs=require("fs"),[src,fail]=process.argv.slice(1),esc=(t)=>t.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;|\u00a0/g," ");
const quoted=[...fail.matchAll(/"([^"]+)"/g)].map((m)=>m[1].replace(/\s+/g," ").trim());let slides=[];try{slides=fs.readdirSync(src+"/slides").sort()}catch{}
for(const f of slides){const h=fs.readFileSync(src+"/slides/"+f,"utf8");for(const m of h.matchAll(/data-slot="stat([12])"[^>]*>([^<]*)</g)){const v=esc(m[2]).replace(/\s+/g," ").trim();if(!quoted.includes(v))continue;
const U=[[/\s*(?:days?)\b/gi,"d"],[/\s*(?:hours?|hrs?)\b/gi,"h"],[/\s*weeks?\b/gi,"w"],[/\s*(?:minutes?|mins?)\b/gi,"min"],[/\s*months?\b/gi,"mo"],[/\s*years?\b/gi,"y"]];let s=v;for(const [re,to] of U)s=s.replace(re,to);
if(s===v||s.length>=v.length){const w=v.split(" ");s=w.length>1?w.slice(0,-1).join(" "):v.slice(0,Math.max(3,v.length-4))}
let d="",t="",ti="";try{d=JSON.parse(fs.readFileSync(src+"/data_build.json","utf8")).data}catch{}try{const j=JSON.parse(fs.readFileSync(src+"/deck.json","utf8"));t=j.template;ti=j.title}catch{}
console.log([f.replace(/\.html$/,""),v,s,d,t,ti].join("\x1f"));process.exit()}}' "$SRC" "$CFAIL" 2>/dev/null)
  if [ -n "$FH" ]; then
    IFS=$'\x1f' read -r FSL FV FS FD FT FTI <<<"$FH"
    if [ -n "$FD" ]; then H="the impact figure \"$FV\" on slide $FSL is too wide for its place on the slide. The one fix: in $FD change that impact entry's \"value\" to \"$FS\" (the unit and meaning stay in its \"label\"), then run: node $S/new_deck.mjs $P --template $FT --title \"$FTI\" --data $FD --redo, and run this command again."
    else H="the impact figure \"$FV\" on slide $FSL is too wide for its place on the slide. The one fix: change its text in $SRC/slides/$FSL.html to \"$FS\" (keep its element and style)."; fi
  fi
  die "checks" "${CFAIL:-${CST#ERR }}" "${H# }${H:+ }Details: $SRC/check_report.json"
fi
note "checked every slide at 1920x1080: no cut-off or overlapping text, nothing under the size floor, pictures and fonts load, no sample text left, keys and counter work${FIGNOTE}${REPAIRED:+; text set smaller where slides first failed the cut-off or overlap check: $REPAIRED}${CNOTE:+; notes: $CNOTE}"

# 3. The automatic look at the slide images.
PC=$(python3 "$S/page_check.py" --kind deck --json-out "$SRC/page_check.json" "$SRC/validate" 2>&1); PCRC=$?
PCS=$(J 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((j.failures||[]).join(" | ").slice(0,600)+"\x1f"+(j.advisories||[]).filter(a=>!/full-bleed|edge strip/.test(a)&&!(/mostly empty/.test(a)&&new RegExp("^page ("+1+"|"+process.argv[2]+"):").test(a))).slice(0,4).join(" | ").slice(0,400))}catch{console.log("no report\x1f")}' "$SRC/page_check.json" "$ASLIDES")
IFS=$'\x1f' read -r PCF PCA <<<"$PCS"
[ $PCRC -eq 0 ] || die "page_check" "${PCF:-$(printf '%s' "$PC" | tail -2)}" "a blank slide, a repeated slide or content cut off: fix that slide"
note "page_check passed${PCA:+; look at these: $PCA}"

# 4. Exports.
OUTS="$P/$SLUG.html"
if [ $PDF = 1 ]; then [ -s "$P/$SLUG.pdf" ] || die "pdf" "the PDF was not written" "run again; if it fails again tell the person the PDF failed"; OUTS="$OUTS $P/$SLUG.pdf"; fi
if [ $PPTX = 1 ]; then
  wait "$PXPID" 2>/dev/null; PXPID=""
  PX=$(tail -1 "$PXOUT")
  PXS=$(printf '%s' "$PX" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?"ok "+j.slides+" slides, "+j.shapes+" shapes, "+j.texts+" text boxes, "+j.pictures+" pictures"+(j.fit_measured===false?"; text fit not checked, the font width table is missing, so a line may run past its box in PowerPoint":"")+(j.fitted?"; "+j.fitted+" text boxes set smaller to fit the PowerPoint fonts":"")+((j.fallbacks||[]).length?"; kept as pictures: "+j.fallbacks.join(", "):"")+((j.problems||[]).length?"; PowerPoint problems: "+j.problems.join(", "):"; no overlapping or out-of-slide text boxes")+(j.placeholders?"; "+j.placeholders+" empty picture boxes, each with its label":""):"ERR "+j.error)}catch{console.log("ERR "+s.slice(0,300))}})')
  OVF=$(printf '%s' "$PX" | J 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).overflows||[]).join("; ").slice(0,600))}catch{}})')
  [ -z "$OVF" ] || die "pptx" "text does not fit its box in the PowerPoint fonts: $OVF" "shorten that text or split the slide, then run again; the page itself is fine"
  case "$PXS" in ERR*) die "pptx" "${PXS#ERR }" "run again; if it fails again tell the person the PowerPoint export failed and offer the .html deck or a PDF";; esac
  OUTS="$OUTS $P/$SLUG.pptx"; note "exported $SLUG.pptx: ${PXS#ok }"
fi
note "exported $OUTS"

# 5. Read-back of the slide text, then the PASS line last: it is the last line of the output, so tail -3 or a cut-off view still shows it.
summary 1 "" "" "" "$OUTS"
rm -f "$SRC/data_build.json"   # the first PASS ends the build from the data file: later changes to a slide are edits of a finished deck
TITLE=$(J 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).title||""))' "$SRC/deck.json")
echo; echo "Slide text to read back against the request:"; head -c 3500 "$SRC/readback.txt"; echo
SHARE=""
for X in html pdf pptx; do [ -f "$P/$SLUG.$X" ] && case " $OUTS " in *" $P/$SLUG.$X "*) SHARE="$SHARE $P/$SLUG.$X (name \"$TITLE.$X\"),";; esac; done
printf '\nPASS: built %s (%s slides, "%s"), checked, nothing else to build or inspect. Read the slide text above against the request, then share_file each of:%s all of them are one deck and go to the person together.\n' "$SLUG" "$ASLIDES" "$TITLE" "${SHARE%,}"
