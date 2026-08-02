#!/usr/bin/env bash
# Deploy 1helm.com from an exact Git commit.
#
# The site is a release-directory deployment on this host: each release is an
# immutable `git archive` of one commit under /opt/1helm-site/releases/<sha>,
# `current` points at the live one, and 1helm-site.service runs
# `node site/server.mjs` from there behind 1helm-site-cloudflared.service.
#
# This exists because the site gates a release. install.ps1 and install.sh are
# served from here, and install.sh resolves /api/releases/linux/latest to find
# the archive - so a release published without deploying the site leaves Windows
# with no installer and Linux unable to resolve a version.
#
#     scripts/deploy-site.sh <commit-ish>
#
# Rolls back to the previous release automatically if the new one fails to
# answer, so a bad deploy cannot leave 1helm.com down.
set -euo pipefail

SITE_ROOT=/opt/1helm-site
RELEASES="$SITE_ROOT/releases"
CURRENT="$SITE_ROOT/current"
UNIT=1helm-site.service
PORT=8130

[[ "${EUID}" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
COMMITISH="${1:-}"
[[ -n "$COMMITISH" ]] || { echo "usage: $0 <commit-ish>" >&2; exit 1; }

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

SHA="$(git rev-parse --verify "$COMMITISH^{commit}")"
# A deployed site must be reproducible from a pushed commit, otherwise the live
# surface cannot be traced back to reviewed source.
git merge-base --is-ancestor "$SHA" origin/main 2>/dev/null \
  || { echo "Refusing to deploy $SHA: it is not an ancestor of origin/main." >&2; exit 1; }

TARGET="$RELEASES/$SHA"
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"

echo "repo      : $REPO"
echo "commit    : $SHA"
echo "previous  : ${PREVIOUS:-<none>}"

if [[ -d "$TARGET" ]]; then
  echo "release directory already exists; reusing it"
else
  install -d -m 0755 "$TARGET"
  git archive --format=tar "$SHA" | tar -x -C "$TARGET"
  # The site serves the product's own public assets from ../public, so a bare
  # archive of site/ alone would 404 icons and schemas.
  [[ -d "$TARGET/site" && -f "$TARGET/site/server.mjs" ]] \
    || { echo "archive is missing site/server.mjs" >&2; rm -rf -- "$TARGET"; exit 1; }
  for required in site/public/install.sh site/public/install.ps1 site/public/keepalive/keepalive-install.ps1; do
    [[ -e "$TARGET/$required" ]] || { echo "archive is missing $required" >&2; rm -rf -- "$TARGET"; exit 1; }
  done
fi

ln -sfn "$TARGET" "$SITE_ROOT/.current-next"
mv -Tf "$SITE_ROOT/.current-next" "$CURRENT"
systemctl restart "$UNIT"

healthy=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 0.5
done

if [[ "$healthy" -ne 1 ]]; then
  echo "New release did not answer on :$PORT - rolling back." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$SITE_ROOT/.current-next"
    mv -Tf "$SITE_ROOT/.current-next" "$CURRENT"
    systemctl restart "$UNIT"
    echo "Rolled back to $PREVIOUS." >&2
  fi
  systemctl status "$UNIT" --no-pager -l >&2 || true
  exit 1
fi

echo "deployed  : $SHA"
for path in /health /install.sh /install.ps1 /keepalive/keepalive-install.ps1 /api/releases/linux/latest; do
  printf '  %-38s %s\n' "$path" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$path")"
done
