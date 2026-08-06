#!/usr/bin/env bash
set -euo pipefail

trap 'status=$?; echo "::error::Linux rehearsal failed at line ${LINENO}: ${BASH_COMMAND}" >&2; exit "$status"' ERR

ARCHIVE="${HELM_CANDIDATE_ARCHIVE:?candidate Linux archive is required}"
OFFLINE_ARCHIVE="${HELM_CANDIDATE_OFFLINE_ARCHIVE:?candidate offline archive is required}"
VERSION="${HELM_EXPECTED_VERSION:?candidate version is required}"
DIGEST="${HELM_CANDIDATE_SHA256:?candidate SHA-256 is required}"
OFFLINE_DIGEST="${HELM_CANDIDATE_OFFLINE_SHA256:?candidate offline SHA-256 is required}"
STATE_ROOT=/var/lib/1helm-oci-v1
MARKER="$STATE_ROOT/dress-rehearsal-state"

[[ "$(id -u)" -eq 0 ]] || { echo "Linux rehearsal must run on the dedicated root-owned test host." >&2; exit 1; }
[[ "${RUNNER_NAME:-}" == 1helm-linux-fresh ]] \
  || { echo "Linux rehearsal refuses to run outside the dedicated 1helm-linux-fresh test host." >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$DIGEST" ]]
[[ "$(sha256sum "$OFFLINE_ARCHIVE" | awk '{print $1}')" == "$OFFLINE_DIGEST" ]]

work="$(mktemp -d)"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

# Install the currently published Stable release first. Its digest comes from
# GitHub's immutable release metadata and the archive is cached only after the
# downloaded bytes match it.
curl_args=(-fsSL --http1.1 --retry 2 --retry-all-errors --connect-timeout 15 --max-time 900)
[[ -z "${GH_TOKEN:-}" ]] || curl_args+=(-H "Authorization: Bearer $GH_TOKEN")
curl "${curl_args[@]}" -H 'Accept: application/vnd.github+json' \
  https://api.github.com/repos/gitcommit90/1Helm/releases/latest >"$work/stable.json"
mapfile -t stable < <(python3 - "$work/stable.json" <<'PY'
import json, re, sys
release = json.load(open(sys.argv[1], encoding="utf-8"))
version = str(release.get("tag_name", "")).removeprefix("v")
if not re.fullmatch(r"\d+\.\d+\.\d+", version): raise SystemExit(2)
name = f"1Helm-{version}-linux-node.tgz"
asset = next((a for a in release.get("assets", []) if a.get("name") == name), None)
digest = str((asset or {}).get("digest", ""))
if not asset or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest): raise SystemExit(2)
print(version); print(name); print(digest[7:]); print(asset["browser_download_url"])
PY
)
[[ "${#stable[@]}" -eq 4 ]]
STABLE_VERSION="${stable[0]}"
STABLE_NAME="${stable[1]}"
STABLE_DIGEST="${stable[2]}"
STABLE_ARCHIVE="/var/cache/1helm-rehearsal/$STABLE_NAME"
install -d -m 0700 /var/cache/1helm-rehearsal
if [[ ! -f "$STABLE_ARCHIVE" || "$(sha256sum "$STABLE_ARCHIVE" | awk '{print $1}')" != "$STABLE_DIGEST" ]]; then
  rm -f -- "$STABLE_ARCHIVE"
  curl "${curl_args[@]}" -o "$STABLE_ARCHIVE.tmp" "${stable[3]}"
  [[ "$(sha256sum "$STABLE_ARCHIVE.tmp" | awk '{print $1}')" == "$STABLE_DIGEST" ]]
  mv "$STABLE_ARCHIVE.tmp" "$STABLE_ARCHIVE"
fi

stable_prefix="$(tar -tzf "$STABLE_ARCHIVE" | awk -F/ '/^[^/]+\/site\/public\/install\.sh$/ && !found {print $1; found=1}')"
[[ -n "$stable_prefix" ]]
tar -xzf "$STABLE_ARCHIVE" -C "$work" "$stable_prefix/site/public/install.sh"
HELM_RELEASE_SHA256="$STABLE_DIGEST" bash "$work/$stable_prefix/site/public/install.sh" "$STABLE_ARCHIVE"
systemctl is-active --quiet 1helm.service
curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/stable-health.json"
[[ "$(/opt/1helm/node-current/bin/node -p 'require("/opt/1helm/current/package.json").version')" == "$STABLE_VERSION" ]]

# Put one byte-identical marker in 1Helm's durable data, then apply the exact
# candidate through the same atomic Linux updater used by the product.
install -d -o 1helm -g 1helm -m 0700 "$STATE_ROOT"
printf 'dress-rehearsal-%s\n' "${GITHUB_RUN_ID:-local}" >"$MARKER"
chown 1helm:1helm "$MARKER"
STATE_BEFORE="$(sha256sum "$MARKER" | awk '{print $1}')"
CANDIDATE_RELEASE="/opt/1helm/releases/$VERSION-$DIGEST"
rm -rf -- "$CANDIDATE_RELEASE.tmp" "$CANDIDATE_RELEASE"
mkdir -p "$CANDIDATE_RELEASE.tmp"
tar -xzf "$ARCHIVE" -C "$CANDIDATE_RELEASE.tmp" --strip-components=1
chown -R 1helm:1helm "$CANDIDATE_RELEASE.tmp"
mv "$CANDIDATE_RELEASE.tmp" "$CANDIDATE_RELEASE"

IMAGE_DIGEST="$(/opt/1helm/node-current/bin/node -p 'require(process.argv[1]).sha256' "$CANDIDATE_RELEASE/resources/channel-image.json")"
IMAGE_BYTES="$(/opt/1helm/node-current/bin/node -p 'require(process.argv[1]).bytes' "$CANDIDATE_RELEASE/resources/channel-image.json")"
IMAGE_NAME="$(/opt/1helm/node-current/bin/node -p 'require(process.argv[1]).artifact.name' "$CANDIDATE_RELEASE/resources/channel-image.json")"
RETAINED_IMAGE="$STATE_ROOT/shared-images/sha256/$IMAGE_DIGEST"
image_member="$(tar -tzf "$OFFLINE_ARCHIVE" | awk '/^[^/]+\/container\/channel-machine\.oci\.tar$/ && !found {print; found=1}')"
[[ -n "$image_member" ]]
install -d -m 0700 "$RETAINED_IMAGE"
tar -xOzf "$OFFLINE_ARCHIVE" "$image_member" >"$RETAINED_IMAGE/image.tmp"
[[ "$(stat -c %s "$RETAINED_IMAGE/image.tmp")" == "$IMAGE_BYTES" ]]
[[ "$(sha256sum "$RETAINED_IMAGE/image.tmp" | awk '{print $1}')" == "$IMAGE_DIGEST" ]]
install -m 0600 "$RETAINED_IMAGE/image.tmp" "$RETAINED_IMAGE/$IMAGE_NAME"
install -m 0600 "$CANDIDATE_RELEASE/resources/channel-image.json" "$RETAINED_IMAGE/manifest.json"
rm -f -- "$RETAINED_IMAGE/image.tmp"

"$CANDIDATE_RELEASE/site/public/apply-linux-release.sh" "$CANDIDATE_RELEASE" "$VERSION"
systemctl is-active --quiet 1helm.service
curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/candidate-health.json"
[[ "$(/opt/1helm/node-current/bin/node -p 'require("/opt/1helm/current/package.json").version')" == "$VERSION" ]]
[[ "$(sha256sum "$MARKER" | awk '{print $1}')" == "$STATE_BEFORE" ]]

# A cold start must recover, and the scoped uninstaller must stop the app while
# leaving the user's durable data intact for reinstall or recovery.
systemctl restart 1helm.service
for _ in {1..60}; do curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/restart-health.json" && break; sleep 1; done
test -s "$work/restart-health.json"
"$CANDIDATE_RELEASE/site/public/uninstall-host.sh"
! systemctl is-active --quiet 1helm.service
[[ -d "$STATE_ROOT" ]]
[[ "$(sha256sum "$MARKER" | awk '{print $1}')" == "$STATE_BEFORE" ]]

printf 'Linux passed: Stable %s -> candidate %s; start, data preservation, and uninstall all worked.\n' \
  "$STABLE_VERSION" "$VERSION"
