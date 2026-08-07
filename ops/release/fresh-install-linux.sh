#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${HELM_RELEASE_ARCHIVE:?Linux release archive is required}"
VERSION="${HELM_RELEASE_VERSION:?release version is required}"
DIGEST="${HELM_RELEASE_SHA256:?release SHA-256 is required}"

[[ "$(id -u)" -eq 0 ]] || { echo "Run the Linux install check as root." >&2; exit 1; }
[[ "${RUNNER_NAME:-}" == "1helm-linux-fresh" ]] \
  || { echo "This check runs only on the dedicated clean Linux host." >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$DIGEST" =~ ^[a-f0-9]{64}$ ]]
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$DIGEST" ]]

work="$(mktemp -d)"
cleanup() {
  systemctl disable --now 1helm-update.path 1helm.service >/dev/null 2>&1 || true
  rm -f -- /etc/systemd/system/1helm.service /etc/systemd/system/1helm-update.service /etc/systemd/system/1helm-update.path
  rm -f -- /etc/sudoers.d/1helm-oci-runtime /etc/1helm/oci-runtime-v1.conf /usr/libexec/1helm-oci-runtime
  rm -rf -- /opt/1helm /var/lib/1helm-oci-v1 /usr/lib/1helm-oci "$work"
  systemctl daemon-reload >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
work="$(mktemp -d)"
trap cleanup EXIT

prefix="$(tar -tzf "$ARCHIVE" | awk -F/ '/^[^/]+\/site\/public\/install\.sh$/ && !found {print $1; found=1}')"
[[ -n "$prefix" ]]
tar -xzf "$ARCHIVE" -C "$work" "$prefix/site/public/install.sh"
HELM_RELEASE_SHA256="$DIGEST" bash "$work/$prefix/site/public/install.sh" "$ARCHIVE"

systemctl is-active --quiet 1helm.service
curl -fsS http://127.0.0.1:8123/api/setup/status >"$work/health.json"
node -e 'const value=require(process.argv[1]); if(value.needs_setup!==true)process.exit(1)' "$work/health.json"
[[ "$(/opt/1helm/node-current/bin/node -p 'require("/opt/1helm/current/package.json").version')" == "$VERSION" ]]

printf 'Linux fresh install passed for 1Helm %s.\n' "$VERSION"
