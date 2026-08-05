#!/usr/bin/env bash
set -euo pipefail

# Preserve exact artifact checks while making silent `[[ ... ]]` failures
# diagnosable from the job log. Without this, a failed launch/version/state
# assertion surfaces only as "exit code 1" after minutes of signature output.
trap 'status=$?; echo "::error::macOS acceptance failed at line ${LINENO} (exit ${status}): ${BASH_COMMAND}" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOWNLOAD="${HELM_MAC_CANDIDATE_DOWNLOAD:?exact Mac candidate directory is required}"
OUTPUT="${HELM_ACCEPTANCE_OUTPUT:?acceptance output is required}"
MANIFEST="$DOWNLOAD/candidate-evidence/mac-candidate.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[[ ! -e "$HOME/Library/Application Support/1Helm-OCI-v1" ]] \
  || { echo "Dedicated Mac account has acceptance residue before this job." >&2; exit 1; }
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).version' "$MANIFEST")"
COMMIT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).commit' "$MANIFEST")"
CI_RUN="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).source_ci.run_id' "$MANIFEST")"
DMG="$DOWNLOAD/1Helm-$VERSION-arm64.dmg"
ZIP="$DOWNLOAD/1Helm-$VERSION-mac-arm64.zip"

[[ "$GITHUB_REPOSITORY" == "gitcommit90/1Helm" && "$GITHUB_EVENT_NAME" == workflow_run \
   && "$GITHUB_REF" == refs/heads/main && "$GITHUB_SHA" == "$COMMIT" \
   && "$COMMIT" == "${HELM_EXPECTED_COMMIT:?}" && "$CI_RUN" == "${HELM_EXPECTED_CI_RUN_ID:?}" ]] \
  || { echo "macOS acceptance refused an untrusted candidate identity." >&2; exit 1; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]]
export HELM_ACCEPTANCE_PLATFORM=macos
export HELM_ACCEPTANCE_STARTED_AT="$STARTED_AT"
node "$ROOT/scripts/pending-acceptance-evidence.mjs"
[[ "$(id -u)" -ne 0 ]] || { echo "macOS acceptance must run as the dedicated ordinary user." >&2; exit 1; }

artifact_field() {
  node -p 'const m=JSON.parse(require("fs").readFileSync(process.argv[1])); const a=m.artifacts.find(x=>x.role===process.argv[2]); if(!a)process.exit(2); a[process.argv[3]]' "$MANIFEST" "$1" "$2"
}
wait_for_setup_health() {
  local output="$1" port
  for _ in {1..180}; do
    while IFS= read -r port; do
      [[ "$port" =~ ^[0-9]+$ ]] || continue
      if curl -fsS "http://127.0.0.1:$port/api/setup/status" >"$output.tmp"; then
        mv "$output.tmp" "$output"
        return 0
      fi
      rm -f -- "$output.tmp"
    done < <(lsof -nP -a -u "$(id -un)" -c 1Helm -iTCP -sTCP:LISTEN 2>/dev/null \
      | awk '/127\.0\.0\.1:/ {split($9,a,":"); print a[length(a)]}' || true)
    sleep 1
  done
  return 1
}
DMG_SHA="$(artifact_field mac_dmg sha256)"; ZIP_SHA="$(artifact_field mac_updater_zip sha256)"
[[ "$(shasum -a 256 "$DMG" | awk '{print $1}')" == "$DMG_SHA" ]]
[[ "$(shasum -a 256 "$ZIP" | awk '{print $1}')" == "$ZIP_SHA" ]]
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"

work="$(mktemp -d)"
apps="$HOME/Applications"
installed="$apps/1Helm.app"
DATA_ROOT="$HOME/Library/Application Support/1Helm-OCI-v1"
completed=0
mount=""
cleanup() {
  [[ -z "$mount" ]] || hdiutil detach "$mount" >/dev/null 2>&1 || true
  [[ ! -d "$installed" ]] || rm -rf -- "$installed"
  [[ "$completed" -ne 1 || ! -d "$DATA_ROOT" ]] || rm -rf -- "$DATA_ROOT"
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir -p "$apps" "$work/update" "$work/previous"
[[ ! -e "$installed" ]] || { echo "Dedicated Mac account already has a 1Helm app installed." >&2; exit 1; }
attach="$(hdiutil attach "$DMG" -nobrowse)"
mount="$(printf '%s\n' "$attach" | awk 'index($0,"/Volumes/"){print substr($0,index($0,"/Volumes/")); exit}')"
[[ -d "$mount/1Helm.app" ]]
codesign --verify --deep --strict --verbose=2 "$mount/1Helm.app"
xcrun stapler validate "$mount/1Helm.app"
spctl --assess --type execute --verbose=4 "$mount/1Helm.app"
ditto "$mount/1Helm.app" "$installed"
hdiutil detach "$mount" >/dev/null; mount=""
ditto -x -k "$ZIP" "$work/update"
codesign --verify --deep --strict --verbose=2 "$work/update/1Helm.app"
xcrun stapler validate "$work/update/1Helm.app"
spctl --assess --type execute --verbose=4 "$work/update/1Helm.app"
[[ "$(defaults read "$installed/Contents/Info" CFBundleShortVersionString)" == "$VERSION" ]]

# Real clean launch on the dedicated account. The app uses the isolated account's
# normal Application Support path, so this exercises shipped path semantics.
[[ ! -e "$DATA_ROOT" ]] || { echo "Dedicated Mac account is not clean; Application Support already exists." >&2; exit 1; }
mkdir -p "$DATA_ROOT"
printf '%s\n' server >"$DATA_ROOT/desktop-mode"
open -n "$installed" --args --1helm-background
wait_for_setup_health "$work/clean-health.json"
osascript -e 'tell application id "com.gitcommit90.1helm" to quit' || true
for _ in {1..30}; do pgrep -x -U "$(id -u)" 1Helm >/dev/null || break; sleep 1; done
! pgrep -x -U "$(id -u)" 1Helm >/dev/null

# Reset the dedicated account, install the latest immutable prior Stable DMG,
# then apply the exact candidate updater ZIP while Application Support remains.
rm -rf -- "$installed" "$DATA_ROOT"
gh api "repos/$GITHUB_REPOSITORY/releases?per_page=20" >"$work/releases.json"
node - "$work/releases.json" "$VERSION" >"$work/previous-release.json" <<'NODE'
const fs = require("fs");
const releases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const current = process.argv[3];
const release = releases.find((item) => !item.draft && !item.prerelease
  && /^v\d+\.\d+\.\d+$/.test(String(item.tag_name || ""))
  && String(item.tag_name).slice(1) !== current);
if (!release) process.exit(2);
process.stdout.write(JSON.stringify(release));
NODE
PREVIOUS_VERSION="$(node -p 'String(JSON.parse(require("fs").readFileSync(process.argv[1])).tag_name||"").replace(/^v/,"")' "$work/previous-release.json")"
[[ "$PREVIOUS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$PREVIOUS_VERSION" != "$VERSION" ]]
PREVIOUS_NAME="1Helm-$PREVIOUS_VERSION-arm64.dmg"
previous_metadata="$(node - "$work/previous-release.json" "$PREVIOUS_NAME" <<'NODE'
const fs = require("fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const asset = (release.assets || []).find((item) => item.name === process.argv[3]);
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(String(asset.digest || ""))) process.exit(2);
console.log(asset.browser_download_url);
console.log(asset.digest.slice(7));
NODE
)"
PREVIOUS_URL="$(printf '%s\n' "$previous_metadata" | sed -n '1p')"
PREVIOUS_SHA="$(printf '%s\n' "$previous_metadata" | sed -n '2p')"
[[ "$PREVIOUS_URL" == https://github.com/gitcommit90/1Helm/releases/download/v* && "$PREVIOUS_SHA" =~ ^[a-f0-9]{64}$ ]] \
  || { echo "Prior Stable Mac asset lacks digest-qualified metadata." >&2; exit 1; }
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/previous/$PREVIOUS_NAME" "$PREVIOUS_URL"
[[ "$(shasum -a 256 "$work/previous/$PREVIOUS_NAME" | awk '{print $1}')" == "$PREVIOUS_SHA" ]]
previous_attach="$(hdiutil attach "$work/previous/$PREVIOUS_NAME" -nobrowse)"
mount="$(printf '%s\n' "$previous_attach" | awk 'index($0,"/Volumes/"){print substr($0,index($0,"/Volumes/")); exit}')"
codesign --verify --deep --strict --verbose=2 "$mount/1Helm.app"
xcrun stapler validate "$mount/1Helm.app"
spctl --assess --type execute --verbose=4 "$mount/1Helm.app"
ditto "$mount/1Helm.app" "$installed"
hdiutil detach "$mount" >/dev/null; mount=""
mkdir -p "$DATA_ROOT"
printf '%s\n' server >"$DATA_ROOT/desktop-mode"
printf '%s\n' "phase4-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" >"$DATA_ROOT/phase4-acceptance-state"
STATE_BEFORE="$(shasum -a 256 "$DATA_ROOT/phase4-acceptance-state" | awk '{print $1}')"
open -n "$installed" --args --1helm-background
wait_for_setup_health "$work/prior-health.json"
osascript -e 'tell application id "com.gitcommit90.1helm" to quit' || true
for _ in {1..30}; do pgrep -x -U "$(id -u)" 1Helm >/dev/null || break; sleep 1; done
! pgrep -x -U "$(id -u)" 1Helm >/dev/null
rm -rf -- "$installed"
ditto "$work/update/1Helm.app" "$installed"
[[ "$(defaults read "$installed/Contents/Info" CFBundleShortVersionString)" == "$VERSION" ]]
open -n "$installed" --args --1helm-background
wait_for_setup_health "$work/update-health.json"
STATE_AFTER="$(shasum -a 256 "$DATA_ROOT/phase4-acceptance-state" | awk '{print $1}')"
[[ "$STATE_BEFORE" == "$STATE_AFTER" ]]
osascript -e 'tell application id "com.gitcommit90.1helm" to quit' || true
for _ in {1..30}; do pgrep -x -U "$(id -u)" 1Helm >/dev/null || break; sleep 1; done
! pgrep -x -U "$(id -u)" 1Helm >/dev/null

export HELM_STATE_BEFORE_SHA256="$STATE_BEFORE" HELM_STATE_AFTER_SHA256="$STATE_AFTER"
export HELM_PREVIOUS_VERSION="$PREVIOUS_VERSION"
export HELM_MACHINE_OS_VERSION="$(sw_vers -productVersion)"
node "$ROOT/scripts/macos-acceptance-evidence.mjs"
completed=1
