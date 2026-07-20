#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/1Helm
pid_for(){ ss -tlnp 2>/dev/null | rg ":$1\\b" | rg -o 'pid=[0-9]+' | head -1 | cut -d= -f2 || true; }
for port in 8123 8124; do
  p=$(pid_for "$port")
  if [[ -z "$p" ]]; then echo "port $port: down"; continue; fi
  cwd=$(readlink -f /proc/$p/cwd 2>/dev/null || echo '?')
  echo "port $port: pid=$p cwd=$cwd"
  tr '\0' '\n' </proc/$p/environ 2>/dev/null | rg '^(PORT|CTRL_DATA_DIR)=' || true
  if [[ "$cwd" != "$ROOT" ]]; then
    echo "ERROR: expected cwd $ROOT" >&2
    exit 2
  fi
done
echo "OK: both listeners use $ROOT"
