#!/usr/bin/env bash
set -euo pipefail
ROOT=/root/1Helm
cwd=$(pwd -P)
if [[ "$cwd" == "$ROOT" ]]; then
  echo "assert-codex-cwd: OK ($cwd)"
  exit 0
fi
echo "assert-codex-cwd: work in $ROOT only (got $cwd)" >&2
exit 1
