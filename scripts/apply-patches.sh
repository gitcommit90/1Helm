#!/usr/bin/env bash
# Applies patches/mem0ai-*.patch to node_modules/mem0ai (npm runs it after every install). Safe to run again: it skips a patch already applied.
set -eu
cd "$(dirname "$0")/.."
for p in patches/mem0ai-*.patch; do
  patch -R -p1 -s --dry-run -d node_modules/mem0ai < "$p" >/dev/null 2>&1 || patch -p1 -s -d node_modules/mem0ai < "$p"
done
