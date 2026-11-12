#!/bin/bash
# What's on this channel's computer, newest first: what the helper made (/workspace/workspace) and the person's files
# (/workspace/files: uploads, files shared with them, downloads). Hidden folders and package/cache folders are skipped.
# Usage: inventory.sh [word]   (only paths containing the word, case-insensitive)   ·   LIMIT=80 inventory.sh
set -u
LIMIT=${LIMIT:-40}; WORD=${1:-}; ROOT=${ROOT:-/workspace}
list() { # dir title
  local dir=$1 title=$2
  echo "== $title ($dir)"
  if [ ! -d "$dir" ]; then echo "(no such folder)"; echo; return; fi
  local all
  all=$(find "$dir" \( -name '.*' -o -name node_modules -o -name __pycache__ -o -name .venv -o -name venv \) -prune -o -type f -printf '%TY-%Tm-%Td %TH:%TM\t%s\t%P\n' 2>/dev/null \
    | { if [ -n "$WORD" ]; then grep -i -F -- "$WORD"; else cat; fi; } | sort -r)
  local n; n=$(printf '%s' "$all" | grep -c . || true)
  if [ "$n" = 0 ]; then echo "(nothing${WORD:+ matching \"$WORD\"})"; echo; return; fi
  printf '%s\n' "$all" | head -n "$LIMIT" | awk -F'\t' '{ s=$2; u="B"; if (s>=1024){s/=1024;u="KB"} if (s>=1024){s/=1024;u="MB"} if (s>=1024){s/=1024;u="GB"} printf (u=="B" ? "%s  %7d %-2s  %s\n" : "%s  %7.1f %-2s  %s\n"), $1, s, u, $3 }'
  [ "$n" -gt "$LIMIT" ] && echo "... and $((n - LIMIT)) more (LIMIT=$n to see all)"
  echo "$n files, $(du -sh --exclude='.*' "$dir" 2>/dev/null | cut -f1) total"; echo
}
list "$ROOT/workspace" "Made for them"
list "$ROOT/files" "Their files"
