#!/usr/bin/env bash
set -euo pipefail

DIST="${HELM_RELEASE_DIST:?Mac release directory is required}"
VERSION="${HELM_RELEASE_VERSION:?release version is required}"
DMG="$DIST/1Helm-$VERSION-arm64.dmg"
ZIP="$DIST/1Helm-$VERSION-mac-arm64.zip"

[[ "${RUNNER_NAME:-}" == "1helm-macos-phase4" ]] \
  || { echo "This check runs only as the dedicated Mac test user." >&2; exit 1; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 && "$(id -u)" -ne 0 ]]
[[ -s "$DMG" && -s "$ZIP" ]]

apps="$HOME/Applications"
installed="$apps/1Helm.app"
data="$HOME/Library/Application Support/1Helm-OCI-v1"
work="$(mktemp -d)"
mount=""
cleanup() {
  [[ -z "$mount" ]] || hdiutil detach "$mount" >/dev/null 2>&1 || true
  osascript -e 'tell application id "com.gitcommit90.1helm" to quit' >/dev/null 2>&1 || true
  rm -rf -- "$installed" "$data" "$work"
}
trap cleanup EXIT
# This account exists only for clean 1Helm installation checks. A cancelled job
# may leave this exact app or data directory behind, so clear that residue.
cleanup
work="$(mktemp -d)"
trap cleanup EXIT

xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"
attach="$(hdiutil attach "$DMG" -nobrowse)"
mount="$(printf '%s\n' "$attach" | awk 'index($0,"/Volumes/"){print substr($0,index($0,"/Volumes/")); exit}')"
[[ -d "$mount/1Helm.app" ]]
codesign --verify --deep --strict --verbose=2 "$mount/1Helm.app"
xcrun stapler validate "$mount/1Helm.app"
spctl --assess --type execute --verbose=4 "$mount/1Helm.app"
mkdir -p "$apps"
ditto "$mount/1Helm.app" "$installed"
hdiutil detach "$mount" >/dev/null
mount=""
[[ "$(defaults read "$installed/Contents/Info" CFBundleShortVersionString)" == "$VERSION" ]]

mkdir -p "$data"
printf '%s\n' server >"$data/desktop-mode"
open -n "$installed" --args --1helm-background
for _ in {1..180}; do
  port="$(lsof -nP -a -u "$(id -un)" -c 1Helm -iTCP -sTCP:LISTEN 2>/dev/null | awk '/127\.0\.0\.1:/ {split($9,a,":"); print a[length(a)]; exit}')"
  if [[ "$port" =~ ^[0-9]+$ ]] && curl -fsS "http://127.0.0.1:$port/api/setup/status" >"$work/health.json"; then break; fi
  sleep 1
done
[[ -s "$work/health.json" ]]
node -e 'const value=require(process.argv[1]); if(value.needs_setup!==true)process.exit(1)' "$work/health.json"

printf 'Mac fresh install passed for 1Helm %s.\n' "$VERSION"
