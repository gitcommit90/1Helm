#!/usr/bin/env bash
set -euo pipefail

APP_SOURCE="${1:-}"
SERVICE_USER="1helm"
STATE_ROOT="/var/lib/1helm-oci-v1"
HELPER_PATH="/usr/libexec/1helm-oci-runtime"
MANIFEST_PATH="/etc/1helm/oci-runtime-v1.conf"
RECIPE_ROOT="/usr/lib/1helm-oci"
SUDOERS_PATH="/etc/sudoers.d/1helm-oci-runtime"

[[ "${EUID}" -eq 0 ]] || { echo "The OCI runtime installer must run as root." >&2; exit 1; }
[[ -x "$APP_SOURCE/scripts/1helm-oci-runtime" && -r "$APP_SOURCE/deploy/1helm-oci-runtime-v1.conf" && -r "$APP_SOURCE/container/Containerfile.oci" ]] \
  || { echo "The verified 1Helm release is missing its OCI runtime contract." >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "The 1Helm service account does not exist." >&2; exit 1; }
command -v apt-get >/dev/null || { echo "The OCI Linux runtime currently requires Ubuntu or Debian with apt." >&2; exit 1; }

missing=()
for command in crun find flock getfacl podman python3 setfacl sha256sum stat sudo tar visudo; do command -v "$command" >/dev/null || missing+=("$command"); done
if ((${#missing[@]})); then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y acl ca-certificates crun fuse-overlayfs podman python3 sudo uidmap util-linux
fi
for command in crun find flock getfacl podman python3 setfacl sha256sum stat sudo tar visudo; do command -v "$command" >/dev/null || { echo "Missing OCI prerequisite after setup: $command" >&2; exit 1; }; done
[[ "$(stat -fc %T /sys/fs/cgroup)" == cgroup2fs ]] || { echo "1Helm OCI resource controls require cgroup v2." >&2; exit 1; }

install -d -o root -g root -m 0755 /etc/1helm "$RECIPE_ROOT" /usr/libexec
install -d -o root -g root -m 0711 "$STATE_ROOT/runtime/oci" "$STATE_ROOT/runtime/oci/channels"
install -d -o root -g root -m 0700 "$STATE_ROOT/runtime/oci/storage" "$STATE_ROOT/runtime/oci/backups" "$STATE_ROOT/runtime/oci/networks"
install -o root -g root -m 0644 "$APP_SOURCE/deploy/1helm-oci-runtime-v1.conf" "$MANIFEST_PATH"
install -o root -g root -m 0644 "$APP_SOURCE/container/Containerfile.oci" "$RECIPE_ROOT/Containerfile.oci"
install -o root -g root -m 0755 "$APP_SOURCE/scripts/1helm-oci-runtime" "$HELPER_PATH"

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
printf '%s ALL=(root) NOPASSWD: %s *\n' "$SERVICE_USER" "$HELPER_PATH" >"$TEMP_ROOT/sudoers"
visudo -cf "$TEMP_ROOT/sudoers" >/dev/null
install -o root -g root -m 0440 "$TEMP_ROOT/sudoers" "$SUDOERS_PATH"

"$HELPER_PATH" ready >/dev/null
sudo -u "$SERVICE_USER" sudo -n "$HELPER_PATH" version | grep -qx '1helm-oci-runtime-v1'
printf 'Installed %s with native cgroup-v2 resource controls and runtime-owned channel storage.\n' "$($HELPER_PATH version)"
