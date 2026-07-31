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
[[ -f "$APP_SOURCE/container/channel-machine.oci.tar" && -f "$APP_SOURCE/container/channel-machine.oci.sha256" ]] \
  || { echo "The verified 1Helm release is missing its sealed channel computer image (container/channel-machine.oci.tar)." >&2; exit 1; }
expected_image_sha="$(tr -d '[:space:]' <"$APP_SOURCE/container/channel-machine.oci.sha256")"
[[ "$expected_image_sha" =~ ^[a-f0-9]{64}$ ]] || { echo "The sealed channel image digest file is invalid." >&2; exit 1; }
actual_image_sha="$(sha256sum "$APP_SOURCE/container/channel-machine.oci.tar" | awk '{print $1}')"
[[ "$actual_image_sha" == "$expected_image_sha" ]] || { echo "The sealed channel image digest does not match." >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "The 1Helm service account does not exist." >&2; exit 1; }
command -v apt-get >/dev/null || { echo "The OCI Linux runtime currently requires Ubuntu or Debian with apt." >&2; exit 1; }

missing=()
for command in crun find flock getfacl iptables podman python3 setfacl sha256sum stat sudo tar visudo; do command -v "$command" >/dev/null || missing+=("$command"); done
if ((${#missing[@]})) || ! dpkg-query -W -f='${Status}\n' netavark aardvark-dns 2>/dev/null | grep -c '^install ok installed$' | grep -qx 2; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y acl aardvark-dns ca-certificates crun fuse-overlayfs iptables netavark podman python3 sudo uidmap util-linux
fi
for command in crun find flock getfacl iptables podman python3 setfacl sha256sum stat sudo tar visudo; do command -v "$command" >/dev/null || { echo "Missing OCI prerequisite after setup: $command" >&2; exit 1; }; done
[[ "$(stat -fc %T /sys/fs/cgroup)" == cgroup2fs ]] || { echo "1Helm OCI resource controls require cgroup v2." >&2; exit 1; }

install -d -o root -g root -m 0755 /etc/1helm "$RECIPE_ROOT" /usr/libexec
install -d -o root -g root -m 0711 "$STATE_ROOT/runtime/oci" "$STATE_ROOT/runtime/oci/channels"
install -d -o root -g root -m 0700 "$STATE_ROOT/runtime/oci/storage" "$STATE_ROOT/runtime/oci/backups" "$STATE_ROOT/runtime/oci/networks"
install -o root -g root -m 0644 "$APP_SOURCE/deploy/1helm-oci-runtime-v1.conf" "$MANIFEST_PATH"
install -o root -g root -m 0644 "$APP_SOURCE/container/Containerfile.oci" "$RECIPE_ROOT/Containerfile.oci"
install -o root -g root -m 0644 "$APP_SOURCE/container/channel-machine.oci.tar" "$RECIPE_ROOT/channel-machine.oci.tar"
install -o root -g root -m 0644 "$APP_SOURCE/container/channel-machine.oci.sha256" "$RECIPE_ROOT/channel-machine.oci.sha256"
if [[ -f "$APP_SOURCE/container/channel-machine.oci.json" ]]; then
  install -o root -g root -m 0644 "$APP_SOURCE/container/channel-machine.oci.json" "$RECIPE_ROOT/channel-machine.oci.json"
fi
install -o root -g root -m 0755 "$APP_SOURCE/scripts/1helm-oci-runtime" "$HELPER_PATH"

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
printf '%s ALL=(root) NOPASSWD: %s *\n' "$SERVICE_USER" "$HELPER_PATH" >"$TEMP_ROOT/sudoers"
visudo -cf "$TEMP_ROOT/sudoers" >/dev/null
install -o root -g root -m 0440 "$TEMP_ROOT/sudoers" "$SUDOERS_PATH"

"$HELPER_PATH" ready >/dev/null
sudo -u "$SERVICE_USER" sudo -n "$HELPER_PATH" version | grep -qx '1helm-oci-runtime-v1'
printf 'Installed %s with native cgroup-v2 resource controls and runtime-owned channel storage.\n' "$($HELPER_PATH version)"
