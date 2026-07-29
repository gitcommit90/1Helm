#!/usr/bin/env bash
set -euo pipefail

# Install or refresh only 1Helm's root-owned unprivileged LXC boundary. This
# script is shipped inside a digest-qualified 1Helm release; it never evaluates
# downloaded code. The only network payloads are immutable image archives whose
# SHA-256 values are pinned below and rechecked by the runtime on every create.

APP_SOURCE="${1:-}"
INSTALL_ROOT="/opt/1helm"
RUNTIME_ROOT="$INSTALL_ROOT/runtime/lxc"
LXC_ROOT="/var/lib/1helm-lxc"
CACHE_BASE="/var/cache/1helm-lxc"
NETWORK_STATE="$LXC_ROOT/network"
HELPER_PATH="/usr/libexec/1helm-lxc-runtime"
NETWORK_HELPER_PATH="/usr/libexec/1helm-lxc-net"
CONFIG_PATH="/etc/1helm/lxc-unprivileged.conf"
RUNTIME_MANIFEST_PATH="/etc/1helm/lxc-runtime-v2.conf"
IDMAP_PATH="/etc/1helm/lxc-idmap"
SUDOERS_PATH="/etc/sudoers.d/1helm-lxc-runtime"
SERVICE_USER="1helm"

# v0.0.11's updater unit made the exact destination files writable under
# ProtectSystem=strict. Atomic replacement still requires write access to each
# parent directory, so an upgrade from that unit must hand the complete,
# digest-qualified release transaction to a short-lived root unit outside the
# old mount namespace. Fresh installs and newer updater units run directly.
if [[ "${HELM_HOST_APPLY_DELEGATED:-}" != "1" ]] \
    && awk -F: '$1 == "0" && $3 ~ /(^|\/)1helm-update\.service(\/|$)/ { found=1 } END { exit found ? 0 : 1 }' /proc/self/cgroup; then
  RELEASE_ROOT="$(readlink -f "$APP_SOURCE" 2>/dev/null || true)"
  [[ "$RELEASE_ROOT" == /opt/1helm/releases/* && -d "$RELEASE_ROOT" ]] \
    || { echo "The updater can delegate only a verified retained 1Helm release." >&2; exit 1; }
  [[ -x "$RELEASE_ROOT/site/public/apply-linux-release.sh" ]] \
    || { echo "The retained release is missing its atomic Linux transaction." >&2; exit 1; }
  TARGET_VERSION="$(/opt/1helm/node-current/bin/node -p 'require(process.argv[1]).version' "$RELEASE_ROOT/package.json" 2>/dev/null || true)"
  [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || { echo "The retained release has no valid package version." >&2; exit 1; }
  LEGACY_UPDATER_PID="$(systemctl show --property=MainPID --value 1helm-update.service 2>/dev/null || true)"
  legacy_updater_pid_is_exact() {
    local pid="${1:-}" main_pid command_line
    [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) && [[ -r "/proc/$pid/cgroup" && -r "/proc/$pid/cmdline" ]] || return 1
    main_pid="$(systemctl show --property=MainPID --value 1helm-update.service 2>/dev/null || true)"
    [[ "$main_pid" == "$pid" ]] || return 1
    awk -F: '$1 == "0" && $3 ~ /(^|\/)1helm-update\.service(\/|$)/ { found=1 } END { exit found ? 0 : 1 }' "/proc/$pid/cgroup" || return 1
    command_line="$(tr '\0' '\n' <"/proc/$pid/cmdline")"
    grep -Fxq '/opt/1helm/update-host.sh' <<<"$command_line"
  }
  legacy_updater_pid_is_exact "$LEGACY_UPDATER_PID" \
    || { echo "The legacy updater handoff could not validate its exact systemd main process." >&2; exit 1; }
  DELEGATE_UNIT="1helm-release-apply-${TARGET_VERSION//./-}-${RANDOM}-$$"
  if systemd-run --quiet --collect --wait --pipe --unit="$DELEGATE_UNIT" \
    --property=Type=oneshot --property=NoNewPrivileges=false --property=PrivateTmp=true --property=ProtectHome=true \
    "$RELEASE_ROOT/site/public/apply-linux-release.sh" "$RELEASE_ROOT" "$TARGET_VERSION"; then
    exit 0
  fi
  # The delegated transaction has already restored the exact prior release,
  # reloaded its units, proved its HTTP health, and written the visible error.
  # Stop only the still-identical legacy updater main process with SIGKILL so
  # its EXIT trap cannot attempt a second rollback from the obsolete namespace
  # or overwrite that stronger evidence.
  if legacy_updater_pid_is_exact "$LEGACY_UPDATER_PID"; then
    kill -KILL "$LEGACY_UPDATER_PID"
  else
    echo "The failed release was rolled back, but the legacy updater process identity changed before it could be stopped." >&2
  fi
  exit 1
fi

[[ "${EUID}" -eq 0 ]] || { echo "The LXC runtime installer must run as root." >&2; exit 1; }
[[ -f "$APP_SOURCE/scripts/1helm-lxc-runtime" && -f "$APP_SOURCE/scripts/1helm-lxc-net" && -f "$APP_SOURCE/deploy/1helm-lxc-unprivileged.conf" && -f "$APP_SOURCE/deploy/1helm-lxc-runtime-v2.conf" ]] \
  || { echo "The verified 1Helm release is missing its LXC runtime files." >&2; exit 1; }
# shellcheck source=/dev/null
source "$APP_SOURCE/deploy/1helm-lxc-runtime-v2.conf"
[[ "${ONEHELM_LXC_RUNTIME_VERSION:-}" == "1helm-lxc-runtime-v2" \
   && "${ONEHELM_LXC_STATE_PATH:-}" == "/var/lib/1helm-lxc/machines" \
   && "${ONEHELM_LXC_IMAGE_SET:-}" =~ ^ubuntu-noble-[0-9]{8}-[0-9]{4}$ \
   && "${ONEHELM_LXC_IMAGE_RELEASE:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ \
   && "${ONEHELM_LXC_AMD64_ROOTFS_SHA256:-}" =~ ^[a-f0-9]{64}$ \
   && "${ONEHELM_LXC_AMD64_META_SHA256:-}" =~ ^[a-f0-9]{64}$ \
   && "${ONEHELM_LXC_ARM64_ROOTFS_SHA256:-}" =~ ^[a-f0-9]{64}$ \
   && "${ONEHELM_LXC_ARM64_META_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] \
  || { echo "The verified release has an invalid LXC runtime manifest." >&2; exit 1; }
LXC_PATH="$ONEHELM_LXC_STATE_PATH"
IMAGE_BUILD="$ONEHELM_LXC_IMAGE_BUILD"
IMAGE_RELEASE="$ONEHELM_LXC_IMAGE_RELEASE"
case "$(uname -m)" in
  x86_64|amd64)
    IMAGE_ARCH="amd64"
    ROOTFS_SHA256="$ONEHELM_LXC_AMD64_ROOTFS_SHA256"
    META_SHA256="$ONEHELM_LXC_AMD64_META_SHA256"
    ;;
  aarch64|arm64)
    IMAGE_ARCH="arm64"
    ROOTFS_SHA256="$ONEHELM_LXC_ARM64_ROOTFS_SHA256"
    META_SHA256="$ONEHELM_LXC_ARM64_META_SHA256"
    ;;
  *) echo "Unsupported LXC architecture: $(uname -m)" >&2; exit 1 ;;
esac
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "The 1Helm service account does not exist." >&2; exit 1; }
command -v apt-get >/dev/null || { echo "The isolated Linux runtime currently requires Ubuntu or Debian with apt." >&2; exit 1; }
missing=()
for command in curl sha256sum lxc-create lxc-attach lxc-info lxc-start lxc-stop lxc-destroy newuidmap newgidmap sudo visudo dnsmasq iptables nft; do
  command -v "$command" >/dev/null || missing+=("$command")
done
if ((${#missing[@]})) || ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates xz-utils util-linux build-essential python3 python3-venv \
    lxc lxc-templates lxcfs uidmap sudo rsync dnsmasq-base iproute2 iptables nftables
fi
for command in curl sha256sum lxc-create lxc-attach lxc-info lxc-start lxc-stop lxc-destroy newuidmap newgidmap sudo visudo dnsmasq iptables nft python3; do
  command -v "$command" >/dev/null || { echo "Missing LXC prerequisite after host setup: $command" >&2; exit 1; }
done
python3 -c 'import ensurepip' >/dev/null 2>&1 || { echo "Python venv support is unavailable after host setup." >&2; exit 1; }

# The service unit names these exact writable roots. They must exist before
# systemd creates the service's mount namespace, even before the first channel
# computer is provisioned.
install -d -o root -g root -m 0711 "$LXC_ROOT" "$LXC_PATH"
install -d -o root -g root -m 0700 "$CACHE_BASE"
install -d -o root -g root -m 0755 "$NETWORK_STATE" "$NETWORK_STATE/misc"

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
ASSET_URL="https://github.com/gitcommit90/1Helm/releases/download/v$IMAGE_RELEASE/1Helm-$IMAGE_RELEASE-lxc-ubuntu-noble-$IMAGE_ARCH"
ASSET_DIR="$RUNTIME_ROOT/images/$ONEHELM_LXC_IMAGE_SET/$IMAGE_ARCH"
install -d -o root -g root -m 0700 "$ASSET_DIR"
for asset in rootfs.tar.xz meta.tar.xz; do
  expected="$ROOTFS_SHA256"
  [[ "$asset" == meta.tar.xz ]] && expected="$META_SHA256"
  if [[ -f "$ASSET_DIR/$asset" ]] && printf '%s  %s\n' "$expected" "$ASSET_DIR/$asset" | sha256sum -c - >/dev/null 2>&1; then
    continue
  fi
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --max-time 1800 -o "$TEMP_ROOT/$asset" "$ASSET_URL-$asset"
  printf '%s  %s\n' "$expected" "$TEMP_ROOT/$asset" | sha256sum -c - >/dev/null \
    || { echo "Pinned LXC $asset failed SHA-256 verification." >&2; exit 1; }
  candidate_asset="$ASSET_DIR/.${asset}.candidate.$$"
  install -o root -g root -m 0600 "$TEMP_ROOT/$asset" "$candidate_asset"
  mv -f -- "$candidate_asset" "$ASSET_DIR/$asset"
done

range_overlaps_nonroot() {
  local file="$1" start="$2" end="$3"
  awk -F: -v start="$start" -v end="$end" '$1 != "root" && NF >= 3 { row_start=$2+0; row_end=row_start+$3-1; if (row_start<=end && row_end>=start) found=1 } END { exit found ? 0 : 1 }' "$file"
}
namespace_covers_range() {
  local file="$1" start="$2" end="$3"
  awk -v start="$start" -v end="$end" 'NF >= 3 { row_start=$1+0; row_end=row_start+$3-1; if (row_start<=start && row_end>=end) found=1 } END { exit found ? 0 : 1 }' "$file"
}
root_covers_range() {
  local file="$1" start="$2" end="$3"
  awk -F: -v start="$start" -v end="$end" '$1 == "root" && NF >= 3 { row_start=$2+0; row_end=row_start+$3-1; if (row_start<=start && row_end>=end) found=1 } END { exit found ? 0 : 1 }' "$file"
}
IDMAP_START=""
IDMAP_COUNT=""
if [[ -r "$IDMAP_PATH" ]]; then
  saved="$(tr -d '[:space:]' <"$IDMAP_PATH")"
  candidate="${saved%%:*}"
  candidate_count="${saved#*:}"
  [[ "$candidate_count" != "$saved" ]] || candidate_count=65536
  if [[ "$candidate" =~ ^[0-9]+$ && "$candidate_count" =~ ^(65535|65536)$ ]] && ((candidate >= 1)); then
    candidate_end=$((candidate + candidate_count - 1))
    if root_covers_range /etc/subuid "$candidate" "$candidate_end" \
      && root_covers_range /etc/subgid "$candidate" "$candidate_end" \
      && namespace_covers_range /proc/self/uid_map "$candidate" "$candidate_end" \
      && namespace_covers_range /proc/self/gid_map "$candidate" "$candidate_end" \
      && ! range_overlaps_nonroot /etc/subuid "$candidate" "$candidate_end" \
      && ! range_overlaps_nonroot /etc/subgid "$candidate" "$candidate_end"; then
      IDMAP_START="$candidate"
      IDMAP_COUNT="$candidate_count"
    fi
  fi
fi
if [[ -z "$IDMAP_START" ]]; then
  # Prefer any already delegated full range. Nested unprivileged hosts commonly
  # expose only local IDs 0..65535; reserving local root leaves the safe and
  # sufficient 1..65535 range demonstrated by nested LXC.
  while IFS=: read -r owner candidate candidate_count; do
    [[ "$owner" == root && "$candidate" =~ ^[0-9]+$ && "$candidate_count" =~ ^[0-9]+$ ]] || continue
    ((candidate_count >= 65535)) || continue
    for wanted_count in 65536 65535; do
      ((candidate_count >= wanted_count)) || continue
      candidate_end=$((candidate + wanted_count - 1))
      if root_covers_range /etc/subgid "$candidate" "$candidate_end" \
        && namespace_covers_range /proc/self/uid_map "$candidate" "$candidate_end" \
        && namespace_covers_range /proc/self/gid_map "$candidate" "$candidate_end" \
        && ! range_overlaps_nonroot /etc/subuid "$candidate" "$candidate_end" \
        && ! range_overlaps_nonroot /etc/subgid "$candidate" "$candidate_end"; then
        IDMAP_START="$candidate"
        IDMAP_COUNT="$wanted_count"
        break 2
      fi
    done
  done </etc/subuid
fi
if [[ -z "$IDMAP_START" ]]; then
  # Nested unprivileged hosts expose local IDs rather than their parent IDs in
  # /proc/self/*id_map. Preserve local root (0) and delegate the remaining
  # 1..65535 IDs to each 1Helm child. This is the supported nested-LXC shape.
  candidate=1
  candidate_count=65535
  candidate_end=$((candidate + candidate_count - 1))
  if namespace_covers_range /proc/self/uid_map "$candidate" "$candidate_end" \
    && namespace_covers_range /proc/self/gid_map "$candidate" "$candidate_end" \
    && ! range_overlaps_nonroot /etc/subuid "$candidate" "$candidate_end" \
    && ! range_overlaps_nonroot /etc/subgid "$candidate" "$candidate_end"; then
    IDMAP_START="$candidate"
    IDMAP_COUNT="$candidate_count"
    grep -Fxq "root:$candidate:$candidate_count" /etc/subuid || printf 'root:%s:%s\n' "$candidate" "$candidate_count" >>/etc/subuid
    grep -Fxq "root:$candidate:$candidate_count" /etc/subgid || printf 'root:%s:%s\n' "$candidate" "$candidate_count" >>/etc/subgid
  fi
fi
if [[ -z "$IDMAP_START" ]]; then
  candidate=100000
  candidate_count=65536
  while ((candidate < 100000000)); do
    candidate_end=$((candidate + candidate_count - 1))
    if namespace_covers_range /proc/self/uid_map "$candidate" "$candidate_end" \
      && namespace_covers_range /proc/self/gid_map "$candidate" "$candidate_end" \
      && ! awk -F: -v start="$candidate" -v end="$candidate_end" 'NF >= 3 { row_start=$2+0; row_end=row_start+$3-1; if (row_start<=end && row_end>=start) found=1 } END { exit found ? 0 : 1 }' /etc/subuid \
      && ! awk -F: -v start="$candidate" -v end="$candidate_end" 'NF >= 3 { row_start=$2+0; row_end=row_start+$3-1; if (row_start<=end && row_end>=start) found=1 } END { exit found ? 0 : 1 }' /etc/subgid; then
        IDMAP_START="$candidate"
        IDMAP_COUNT="$candidate_count"
        break
    fi
    candidate=$((candidate + 65536))
  done
  [[ -n "$IDMAP_START" ]] || { echo "No collision-free unprivileged subordinate range is available for 1Helm LXC in this host namespace." >&2; exit 1; }
  printf 'root:%s:%s\n' "$IDMAP_START" "$IDMAP_COUNT" >>/etc/subuid
  printf 'root:%s:%s\n' "$IDMAP_START" "$IDMAP_COUNT" >>/etc/subgid
fi
install -d -o root -g root -m 0755 /etc/1helm
install -o root -g root -m 0644 "$APP_SOURCE/deploy/1helm-lxc-runtime-v2.conf" "$RUNTIME_MANIFEST_PATH"
printf '%s:%s\n' "$IDMAP_START" "$IDMAP_COUNT" >"$TEMP_ROOT/lxc-idmap"
install -o root -g root -m 0600 "$TEMP_ROOT/lxc-idmap" "$IDMAP_PATH"
sed -E -e "s/^lxc\.idmap = u 0 [0-9]+ (65535|65536)$/lxc.idmap = u 0 $IDMAP_START $IDMAP_COUNT/" \
    -e "s/^lxc\.idmap = g 0 [0-9]+ (65535|65536)$/lxc.idmap = g 0 $IDMAP_START $IDMAP_COUNT/" \
    "$APP_SOURCE/deploy/1helm-lxc-unprivileged.conf" >"$TEMP_ROOT/lxc-unprivileged.conf"
grep -qx "lxc.idmap = u 0 $IDMAP_START $IDMAP_COUNT" "$TEMP_ROOT/lxc-unprivileged.conf"
grep -qx "lxc.idmap = g 0 $IDMAP_START $IDMAP_COUNT" "$TEMP_ROOT/lxc-unprivileged.conf"
install -o root -g root -m 0644 "$TEMP_ROOT/lxc-unprivileged.conf" "$CONFIG_PATH"
install -o root -g root -m 0755 "$APP_SOURCE/scripts/1helm-lxc-runtime" "$HELPER_PATH"
install -o root -g root -m 0755 "$APP_SOURCE/scripts/1helm-lxc-net" "$NETWORK_HELPER_PATH"

install -m 0644 /dev/stdin /etc/default/lxc-net <<'EOF'
USE_LXC_BRIDGE="true"
LXC_BRIDGE="lxcbr0"
LXC_ADDR="10.0.3.1"
LXC_NETMASK="255.255.255.0"
LXC_NETWORK="10.0.3.0/24"
LXC_DHCP_RANGE="10.0.3.2,10.0.3.254"
LXC_DHCP_MAX="253"
LXC_DHCP_CONFILE=""
LXC_DOMAIN=""
EOF
install -m 0644 /dev/stdin /etc/systemd/system/1helm-lxc-net.service <<EOF
[Unit]
Description=1Helm private LXC bridge
After=network-online.target
Wants=network-online.target
Before=1helm.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$NETWORK_HELPER_PATH start
ExecStop=$NETWORK_HELPER_PATH stop

[Install]
WantedBy=multi-user.target
EOF
printf '%s ALL=(root) NOPASSWD: %s *\n' "$SERVICE_USER" "$HELPER_PATH" >"$TEMP_ROOT/sudoers"
visudo -cf "$TEMP_ROOT/sudoers" >/dev/null
install -o root -g root -m 0440 "$TEMP_ROOT/sudoers" "$SUDOERS_PATH"
systemctl daemon-reload
systemctl enable --now 1helm-lxc-net.service
"$NETWORK_HELPER_PATH" start
"$HELPER_PATH" ready >/dev/null
sudo -u "$SERVICE_USER" sudo -n "$HELPER_PATH" version | grep -qx '1helm-lxc-runtime-v2'
printf 'Installed %s with Ubuntu Noble image %s (%s).\n' "$ONEHELM_LXC_RUNTIME_VERSION" "$IMAGE_BUILD" "$IMAGE_ARCH"
