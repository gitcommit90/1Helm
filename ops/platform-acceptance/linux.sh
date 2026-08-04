#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE="${HELM_CANDIDATE_ARCHIVE:?exact Linux candidate archive is required}"
OFFLINE_ARCHIVE="${HELM_CANDIDATE_OFFLINE_ARCHIVE:?exact Linux offline candidate archive is required}"
MANIFEST="${HELM_CANDIDATE_MANIFEST:?exact candidate manifest is required}"
PROVENANCE="${HELM_CANDIDATE_PROVENANCE:?exact hosted provenance bundle is required}"
OUTPUT="${HELM_ACCEPTANCE_OUTPUT:?acceptance output is required}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).version' "$MANIFEST")"
DIGEST="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).artifact.sha256' "$MANIFEST")"
OFFLINE_DIGEST="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).offline_bundle.sha256' "$MANIFEST")"
IMAGE_DIGEST="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).sealed_oci.sha256' "$MANIFEST")"
COMMIT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).source.commit' "$MANIFEST")"
CI_RUN="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).ci.run_id' "$MANIFEST")"

[[ "$GITHUB_REPOSITORY" == "gitcommit90/1Helm" && "$GITHUB_EVENT_NAME" == "workflow_run" \
   && "$GITHUB_REF" == "refs/heads/main" && "$GITHUB_SHA" == "$COMMIT" \
   && "${HELM_EXPECTED_COMMIT:?}" == "$COMMIT" && "${HELM_EXPECTED_CI_RUN_ID:?}" == "$CI_RUN" ]] \
  || { echo "Linux acceptance refused an untrusted candidate identity." >&2; exit 1; }
export HELM_ACCEPTANCE_PLATFORM=linux
export HELM_ACCEPTANCE_STARTED_AT="$STARTED_AT"
export HELM_PHASE4_RUNNER_LABEL=ubuntu-latest
node "$ROOT/scripts/pending-acceptance-evidence.mjs"
[[ "$(id -u)" -ne 0 ]] || { echo "Linux acceptance must begin as the hosted ordinary runner user." >&2; exit 1; }

# This lane performs a REAL root install of 1Helm on its runner: it binds port
# 8123, writes /var/lib/1helm-oci-v1, and installs the 1helm systemd units. That
# is only safe on a disposable GitHub-hosted runner that holds no user or
# production data. Refuse anywhere that looks persistent, self-hosted, or
# already-inhabited so a misrouted job can never clobber a real host's live
# 1Helm or standalone state. Blocked evidence was already retained above.
[[ "${RUNNER_ENVIRONMENT:-}" == "github-hosted" ]] \
  || { echo "Linux acceptance refuses to boot a real 1Helm outside a disposable GitHub-hosted runner." >&2; exit 1; }
for guarded in /var/lib/1helm-oci-v1 /var/lib/1helm-standalone /opt/1helm; do
  [[ ! -e "$guarded" ]] \
    || { echo "Linux acceptance refuses to run where 1Helm host state already exists: $guarded" >&2; exit 1; }
done
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE '[:.]8123[[:space:]]'; then
  echo "Linux acceptance refuses to run while port 8123 is already in use." >&2
  exit 1
fi
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$DIGEST" ]] \
  || { echo "Linux candidate digest mismatch." >&2; exit 1; }
[[ "$(sha256sum "$OFFLINE_ARCHIVE" | awk '{print $1}')" == "$OFFLINE_DIGEST" ]] \
  || { echo "Linux offline candidate digest mismatch." >&2; exit 1; }
node -e 'import("./scripts/candidate-manifest.mjs").then(({candidateIdentityFromArchive})=>{const x=candidateIdentityFromArchive(process.argv[1]); if(x.commit!==process.argv[2]) process.exit(2)})' "$ARCHIVE" "$COMMIT"
gh attestation verify "$ARCHIVE" --bundle "$PROVENANCE" \
  --repo gitcommit90/1Helm --signer-workflow gitcommit90/1Helm/.github/workflows/candidate.yml \
  --source-ref refs/heads/main --source-digest "$COMMIT" --deny-self-hosted-runners
gh attestation verify "$OFFLINE_ARCHIVE" --bundle "$PROVENANCE" \
  --repo gitcommit90/1Helm --signer-workflow gitcommit90/1Helm/.github/workflows/candidate.yml \
  --source-ref refs/heads/main --source-digest "$COMMIT" --deny-self-hosted-runners

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
prefix="$(tar -tzf "$OFFLINE_ARCHIVE" | awk -F/ '/^[^/]+\/site\/public\/install\.sh$/ && !found { print $1; found=1 }')"
[[ -n "$prefix" ]] || { echo "Candidate installer is missing." >&2; exit 1; }
tar -xzf "$OFFLINE_ARCHIVE" -C "$work" "$prefix/site/public/install.sh"

# The hosted VM is disposable and contains no user or production data. Its
# first installation is therefore an actual clean systemd installation.
sudo env HELM_RELEASE_SHA256="$OFFLINE_DIGEST" bash "$work/$prefix/site/public/install.sh" "$OFFLINE_ARCHIVE"
sudo systemctl is-active --quiet 1helm.service
curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/clean-health.json"
[[ "$(readlink -f /opt/1helm/current)" == "/opt/1helm/releases/$VERSION-$OFFLINE_DIGEST" ]]
RETAINED_IMAGE="/var/lib/1helm-oci-v1/shared-images/sha256/$IMAGE_DIGEST"
[[ -d "$RETAINED_IMAGE" && "$(find "$RETAINED_IMAGE" -maxdepth 1 -type f -name '*.oci.tar' -exec sha256sum {} \; | awk '{print $1}')" == "$IMAGE_DIGEST" ]]

# Resolve the newest immutable public Stable release distinct from this
# candidate version. Candidate versions normally remain unchanged during
# preview phases, so `releases/latest` can legitimately be the same version.
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
[[ "$PREVIOUS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$PREVIOUS_VERSION" != "$VERSION" ]] \
  || { echo "A distinct previous Stable version is required for Linux updater acceptance." >&2; exit 1; }
PREVIOUS_NAME="1Helm-$PREVIOUS_VERSION-linux-node.tgz"
readarray -t previous_asset < <(node - "$work/previous-release.json" "$PREVIOUS_NAME" <<'NODE'
const fs = require("fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const asset = (release.assets || []).find((item) => item.name === process.argv[3]);
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(String(asset.digest || ""))) process.exit(2);
console.log(asset.browser_download_url);
console.log(asset.digest.slice(7));
NODE
)
[[ "${#previous_asset[@]}" -eq 2 ]] || { echo "Prior Stable Linux asset lacks digest-qualified metadata." >&2; exit 1; }
PREVIOUS_URL="${previous_asset[0]}"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/$PREVIOUS_NAME" "$PREVIOUS_URL"
PREVIOUS_DIGEST="$(sha256sum "$work/$PREVIOUS_NAME" | awk '{print $1}')"
[[ "$PREVIOUS_DIGEST" == "${previous_asset[1]}" ]] || { echo "Prior Stable Linux digest mismatch." >&2; exit 1; }
previous_prefix="$(tar -tzf "$work/$PREVIOUS_NAME" | awk -F/ '/^[^/]+\/site\/public\/install\.sh$/ && !found { print $1; found=1 }')"
tar -xzf "$work/$PREVIOUS_NAME" -C "$work" "$previous_prefix/site/public/install.sh"
sudo env HELM_RELEASE_SHA256="$PREVIOUS_DIGEST" bash "$work/$previous_prefix/site/public/install.sh" "$work/$PREVIOUS_NAME"
[[ "$(node -p 'require("/opt/1helm/current/package.json").version')" == "$PREVIOUS_VERSION" ]]

MARKER=/var/lib/1helm-oci-v1/phase4-acceptance-state
openssl rand -hex 32 | sudo tee "$MARKER" >/dev/null
sudo chown 1helm:1helm "$MARKER"
STATE_BEFORE="$(sudo sha256sum "$MARKER" | awk '{print $1}')"
CANDIDATE_RELEASE="/opt/1helm/releases/$VERSION-$DIGEST"
sudo mkdir -p "$CANDIDATE_RELEASE.tmp"
sudo tar -xzf "$ARCHIVE" -C "$CANDIDATE_RELEASE.tmp" --strip-components=1
sudo chown -R 1helm:1helm "$CANDIDATE_RELEASE.tmp"
sudo mv "$CANDIDATE_RELEASE.tmp" "$CANDIDATE_RELEASE"
sudo "$CANDIDATE_RELEASE/site/public/apply-linux-release.sh" "$CANDIDATE_RELEASE" "$VERSION"
[[ "$(node -p 'require("/opt/1helm/current/package.json").version')" == "$VERSION" ]]
sudo systemctl is-active --quiet 1helm.service
curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/update-health.json"

# Exercise the candidate's real atomic host transaction with a derived local
# startup-failure fixture. The fixture is never uploaded as candidate bytes.
[[ "$(readlink -f /opt/1helm/current)" == "$CANDIDATE_RELEASE" ]]
FAILURE_RELEASE="/opt/1helm/releases/$VERSION-$DIGEST-phase4-failure"
sudo cp -a "$CANDIDATE_RELEASE" "$FAILURE_RELEASE"
printf '%s\n' 'throw new Error("Phase 4 controlled startup failure");' | sudo tee "$FAILURE_RELEASE/src/server/index.ts" >/dev/null
if sudo "$CANDIDATE_RELEASE/site/public/apply-linux-release.sh" "$FAILURE_RELEASE" "$VERSION"; then
  echo "Controlled failure unexpectedly passed." >&2
  exit 1
fi
[[ "$(readlink -f /opt/1helm/current)" == "$CANDIDATE_RELEASE" ]]
sudo systemctl is-active --quiet 1helm.service
curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/rollback-health.json"
STATE_AFTER="$(sudo sha256sum "$MARKER" | awk '{print $1}')"
[[ "$STATE_BEFORE" == "$STATE_AFTER" ]]
[[ -d "$RETAINED_IMAGE" && "$(find "$RETAINED_IMAGE" -maxdepth 1 -type f -name '*.oci.tar' -exec sha256sum {} \; | awk '{print $1}')" == "$IMAGE_DIGEST" ]]
sudo rm -rf -- "$FAILURE_RELEASE"

export HELM_PREVIOUS_VERSION="$PREVIOUS_VERSION"
export HELM_STATE_BEFORE_SHA256="$STATE_BEFORE"
export HELM_STATE_AFTER_SHA256="$STATE_AFTER"
export HELM_MACHINE_OS_VERSION="$(. /etc/os-release; printf '%s' "$PRETTY_NAME")"
node "$ROOT/scripts/linux-acceptance-evidence.mjs"
