#!/usr/bin/env bash
set -euo pipefail

APP_SOURCE="${1:-}"
SERVICE_USER="1helm"
STATE_ROOT="/var/lib/1helm-oci-v1"
HELPER_PATH="/usr/libexec/1helm-oci-runtime"
MANIFEST_PATH="/etc/1helm/oci-runtime-v1.conf"
RECIPE_ROOT="/usr/lib/1helm-oci"
SUDOERS_PATH="/etc/sudoers.d/1helm-oci-runtime"
IMAGE_STORE="$STATE_ROOT/shared-images/sha256"

[[ "${EUID}" -eq 0 ]] || { echo "The OCI runtime installer must run as root." >&2; exit 1; }
[[ -x "$APP_SOURCE/scripts/1helm-oci-runtime" && -r "$APP_SOURCE/deploy/1helm-oci-runtime-v1.conf" && -r "$APP_SOURCE/container/Containerfile.oci" ]] \
  || { echo "The verified 1Helm release is missing its OCI runtime contract." >&2; exit 1; }
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

# Phase 5 stores sealed images independently from application releases. A
# verified digest-addressed copy is shared by every app version and retained for
# rollback. A v0.0.41-style complete archive remains accepted as the legacy
# branch. Missing or malformed split metadata never falls back to an unbound
# download.
resolve_channel_image() {
  local manifest="$APP_SOURCE/resources/channel-image.json" legacy_tar="$APP_SOURCE/container/channel-machine.oci.tar"
  local legacy_sha="$APP_SOURCE/container/channel-machine.oci.sha256" arch fields expected_image_sha image_bytes image_name image_url manifest_url
  case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "Unsupported architecture: $(uname -m)" >&2; return 1 ;; esac
  if [[ ! -f "$manifest" ]]; then
    [[ -f "$legacy_tar" && -f "$legacy_sha" ]] || { echo "The verified release has neither a split channel image manifest nor a legacy complete image." >&2; return 1; }
    expected_image_sha="$(tr -d '[:space:]' <"$legacy_sha")"
    [[ "$expected_image_sha" =~ ^[a-f0-9]{64}$ && "$(sha256sum "$legacy_tar" | awk '{print $1}')" == "$expected_image_sha" ]] \
      || { echo "The legacy sealed channel image digest does not match." >&2; return 1; }
    RESOLVED_IMAGE_TAR="$legacy_tar"
    RESOLVED_IMAGE_MANIFEST=""
    return 0
  fi
  fields="$(python3 - "$manifest" "$arch" <<'PY'
import json, os, re, sys
path, host_arch = sys.argv[1:]
try: value=json.load(open(path, encoding="utf-8"))
except (OSError, ValueError): raise SystemExit("channel image manifest is not valid JSON")
digest=str(value.get("sha256") or "")
architecture=str(value.get("architecture") or "")
version=str(value.get("version") or "")
size=value.get("bytes")
artifact=value.get("artifact") or {}
name=str(artifact.get("name") or "")
url=str(artifact.get("url") or "")
manifest_url=str(artifact.get("manifest_url") or "")
if value.get("schema") != 1 or value.get("kind") != "1helm-sealed-channel-image" or version != "1": raise SystemExit("channel image manifest schema/version mismatch")
if architecture != host_arch: raise SystemExit(f"channel image architecture {architecture} does not match host {host_arch}")
if not re.fullmatch(r"[a-f0-9]{64}", digest) or not isinstance(size, int) or size < 1: raise SystemExit("channel image byte identity is invalid")
expected=f"1Helm-channel-machine-v1-{architecture}-{digest}.oci.tar"
tag=f"channel-image-v1-{architecture}-{digest}"
base=f"https://github.com/gitcommit90/1Helm/releases/download/{tag}"
if name != expected or url != f"{base}/{expected}" or manifest_url != f"{base}/1Helm-channel-machine-v1-{architecture}-{digest}.json": raise SystemExit("channel image URLs are not immutable digest-addressed URLs")
print(digest); print(size); print(name); print(url); print(manifest_url)
PY
)" || { echo "The verified release's channel image manifest was refused." >&2; return 1; }
  mapfile -t IMAGE_FIELDS <<<"$fields"
  [[ "${#IMAGE_FIELDS[@]}" -eq 5 ]] || return 1
  expected_image_sha="${IMAGE_FIELDS[0]}"; image_bytes="${IMAGE_FIELDS[1]}"; image_name="${IMAGE_FIELDS[2]}"
  image_url="${IMAGE_FIELDS[3]}"; manifest_url="${IMAGE_FIELDS[4]}"
  local retained="$IMAGE_STORE/$expected_image_sha" retained_tar="$IMAGE_STORE/$expected_image_sha/$image_name"
  local retained_manifest="$IMAGE_STORE/$expected_image_sha/manifest.json" temp
  install -d -o root -g root -m 0700 "$IMAGE_STORE" "$retained"
  if [[ -f "$retained_tar" && ! -L "$retained_tar" && "$(stat -c %s "$retained_tar")" == "$image_bytes" \
      && "$(sha256sum "$retained_tar" | awk '{print $1}')" == "$expected_image_sha" && -f "$retained_manifest" \
      && "$(sha256sum "$retained_manifest" | awk '{print $1}')" == "$(sha256sum "$manifest" | awk '{print $1}')" ]]; then
    printf 'Reusing verified shared channel image sha256:%s.\n' "$expected_image_sha"
  elif [[ -f "$legacy_tar" && "$(stat -c %s "$legacy_tar")" == "$image_bytes" \
      && "$(sha256sum "$legacy_tar" | awk '{print $1}')" == "$expected_image_sha" ]]; then
    install -o root -g root -m 0600 "$legacy_tar" "$retained_tar"
    install -o root -g root -m 0600 "$manifest" "$retained_manifest"
    printf 'Retained offline channel image sha256:%s for shared reuse.\n' "$expected_image_sha"
  else
    temp="$(mktemp -d)"
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$temp/manifest.json" "$manifest_url" \
      || { rm -rf -- "$temp"; echo "The referenced channel image manifest could not be downloaded." >&2; return 1; }
    cmp -s "$temp/manifest.json" "$manifest" \
      || { rm -rf -- "$temp"; echo "The downloaded channel image manifest does not match the application release." >&2; return 1; }
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$temp/image.tar" "$image_url" \
      || { rm -rf -- "$temp"; echo "The referenced channel image could not be downloaded." >&2; return 1; }
    [[ "$(stat -c %s "$temp/image.tar")" == "$image_bytes" && "$(sha256sum "$temp/image.tar" | awk '{print $1}')" == "$expected_image_sha" ]] \
      || { rm -rf -- "$temp"; echo "The downloaded channel image bytes do not match their manifest." >&2; return 1; }
    install -o root -g root -m 0600 "$temp/image.tar" "$retained_tar"
    install -o root -g root -m 0600 "$temp/manifest.json" "$retained_manifest"
    rm -rf -- "$temp"
  fi
  RESOLVED_IMAGE_TAR="$retained_tar"
  RESOLVED_IMAGE_MANIFEST="$retained_manifest"
}
resolve_channel_image
expected_image_sha="$(sha256sum "$RESOLVED_IMAGE_TAR" | awk '{print $1}')"

# Ubuntu ships an AppArmor attachment for /usr/bin/crun whose nominally
# unconfined profile can still inherit the outer container host's address-family
# restrictions. On a nested systemd host that manifests inside every resident
# as EPERM from socket(2), even though the 1Helm host itself has internet. Add
# only the missing address-family grants to crun's supported local include; the
# outer host/container profile remains the isolation boundary.
NESTED_CRUN_PROFILE="/etc/apparmor.d/local/crun"
NESTED_CRUN_MARKER="# Managed by 1Helm: allow resident OCI network sockets on nested hosts."
container_virt="$(systemd-detect-virt --container 2>/dev/null || true)"
apparmor_enabled="$(cat /sys/module/apparmor/parameters/enabled 2>/dev/null || true)"
# An outer container host can expose the AppArmor kernel module flag without
# mounting securityfs in this guest. In that state apparmor_parser cannot reload
# a profile and Podman is not using AppArmor here, so there is nothing to patch.
if [[ -n "$container_virt" && "$container_virt" != none && "$apparmor_enabled" =~ ^[Yy]$ \
    && -r /sys/kernel/security/apparmor/profiles && -r /etc/apparmor.d/crun ]]; then
  command -v apparmor_parser >/dev/null || { echo "Nested AppArmor OCI setup requires apparmor_parser." >&2; exit 1; }
  if [[ ! -e "$NESTED_CRUN_PROFILE" ]]; then
    install -d -o root -g root -m 0755 "$(dirname "$NESTED_CRUN_PROFILE")"
    profile_candidate="$(mktemp)"
    printf '%s\nnetwork inet,\nnetwork inet6,\n' "$NESTED_CRUN_MARKER" >"$profile_candidate"
    install -o root -g root -m 0644 "$profile_candidate" "$NESTED_CRUN_PROFILE"
    rm -f -- "$profile_candidate"
  elif ! grep -Eq '^[[:space:]]*network[[:space:]]+inet[[:space:]]*,' "$NESTED_CRUN_PROFILE" \
      || ! grep -Eq '^[[:space:]]*network[[:space:]]+inet6[[:space:]]*,' "$NESTED_CRUN_PROFILE"; then
    echo "The existing AppArmor local/crun policy does not permit resident IPv4 and IPv6 sockets; 1Helm left the custom policy unchanged." >&2
    exit 1
  fi
  apparmor_parser -r /etc/apparmor.d/crun
fi

install -d -o root -g root -m 0755 /etc/1helm "$RECIPE_ROOT" /usr/libexec
install -d -o root -g root -m 0711 "$STATE_ROOT/runtime/oci" "$STATE_ROOT/runtime/oci/channels"
install -d -o root -g root -m 0700 "$STATE_ROOT/runtime/oci/storage" "$STATE_ROOT/runtime/oci/backups" "$STATE_ROOT/runtime/oci/networks"
install -o root -g root -m 0644 "$APP_SOURCE/deploy/1helm-oci-runtime-v1.conf" "$MANIFEST_PATH"
install -o root -g root -m 0644 "$APP_SOURCE/container/Containerfile.oci" "$RECIPE_ROOT/Containerfile.oci"
# The root-owned helper intentionally rejects a symlinked image archive. Keep
# the fixed recipe path a regular, immutable-by-service file even when its
# verified source came from the shared digest-addressed image store.
install -o root -g root -m 0600 "$RESOLVED_IMAGE_TAR" "$RECIPE_ROOT/channel-machine.oci.tar"
printf '%s\n' "$expected_image_sha" >"$RECIPE_ROOT/channel-machine.oci.sha256"
chmod 0644 "$RECIPE_ROOT/channel-machine.oci.sha256"
if [[ -n "$RESOLVED_IMAGE_MANIFEST" ]]; then
  ln -sfn "$RESOLVED_IMAGE_MANIFEST" "$RECIPE_ROOT/channel-machine.oci.json"
elif [[ -f "$APP_SOURCE/container/channel-machine.oci.json" ]]; then
  install -o root -g root -m 0644 "$APP_SOURCE/container/channel-machine.oci.json" "$RECIPE_ROOT/channel-machine.oci.json"
fi
install -o root -g root -m 0755 "$APP_SOURCE/scripts/1helm-oci-runtime" "$HELPER_PATH"

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
printf 'Defaults:%s !mail_badpass\n%s ALL=(root) NOPASSWD: %s *\n' \
  "$SERVICE_USER" "$SERVICE_USER" "$HELPER_PATH" >"$TEMP_ROOT/sudoers"
visudo -cf "$TEMP_ROOT/sudoers" >/dev/null
install -o root -g root -m 0440 "$TEMP_ROOT/sudoers" "$SUDOERS_PATH"

"$HELPER_PATH" ready >/dev/null
sudo -u "$SERVICE_USER" sudo -n "$HELPER_PATH" version | grep -qx '1helm-oci-runtime-v1'
printf 'Installed %s with native cgroup-v2 resource controls and runtime-owned channel storage.\n' "$($HELPER_PATH version)"
