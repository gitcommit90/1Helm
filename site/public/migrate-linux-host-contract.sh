#!/usr/bin/env bash
set -euo pipefail

# Run one already verified 1Helm release's root-owned Linux runtime migration
# outside the deliberately read-only updater service namespace. The caller is
# /opt/1helm/update-host.sh, itself installed root-owned from a digest-qualified
# release. This script accepts no URL, command, or arbitrary destination.

INSTALL_ROOT="/opt/1helm"
RELEASES_ROOT="$INSTALL_ROOT/releases"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm"
SERVICE_USER="1helm"
SERVICE_NAME="1helm.service"
PORT="8123"
RELEASE_ROOT="$(readlink -f "${1:-}" 2>/dev/null || true)"
TARGET_VERSION="${2:-}"
STATUS_FILE="$STATE_ROOT/host-update-status.json"
HOST_CONTRACT_PATHS=(
  /usr/libexec/1helm-lxc-runtime
  /usr/libexec/1helm-lxc-net
  /etc/1helm/lxc-unprivileged.conf
  /etc/1helm/lxc-idmap
  /etc/sudoers.d/1helm-lxc-runtime
  /etc/default/lxc-net
  /etc/subuid
  /etc/subgid
  /etc/systemd/system/1helm-lxc-net.service
  /etc/systemd/system/1helm.service
  /etc/systemd/system/1helm-update.service
  /etc/systemd/system/1helm-update.path
  /opt/1helm/update-host.sh
  /opt/1helm/uninstall-host.sh
)
HOST_UNITS=(1helm-lxc-net.service 1helm.service 1helm-update.path)
TRANSACTION_ACTIVE=0
ROLLING_BACK=0
TEMP_ROOT=""

[[ "${EUID}" -eq 0 ]] || { echo "The Linux host-contract migration must run as root." >&2; exit 1; }
[[ "$RELEASE_ROOT" == "$RELEASES_ROOT/"* && -d "$RELEASE_ROOT" ]] \
  || { echo "The host-contract migration requires a verified retained 1Helm release." >&2; exit 1; }
[[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "The host-contract migration requires an exact release version." >&2; exit 1; }
PACKAGE_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$RELEASE_ROOT/package.json" 2>/dev/null || true)"
[[ "$PACKAGE_VERSION" == "$TARGET_VERSION" ]] \
  || { echo "The retained release does not match the requested host-contract version." >&2; exit 1; }
[[ -x "$RELEASE_ROOT/site/public/install-lxc-runtime.sh" && -x "$RELEASE_ROOT/site/public/install-linux-units.sh" && -x "$RELEASE_ROOT/site/public/uninstall-host.sh" && -x "$RELEASE_ROOT/scripts/1helm-lxc-runtime" && -x "$RELEASE_ROOT/scripts/1helm-lxc-net" ]] \
  || { echo "The verified release is missing its Linux host contract." >&2; exit 1; }

TEMP_ROOT="$(mktemp -d)"
chmod 0700 "$TEMP_ROOT"

json_string() {
  "$NODE_LINK/bin/node" -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
}

write_status() {
  local state="$1" message="$2" error="${3:-}" candidate="$TEMP_ROOT/status.json"
  printf '{"mode":"linux-systemd","status":%s,"version":%s,"checked_at":%s,"message":%s,"error":%s}\n' \
    "$(json_string "$state")" "$(json_string "$TARGET_VERSION")" "$(( $(date +%s) * 1000 ))" \
    "$(json_string "$message")" "$([[ -n "$error" ]] && json_string "$error" || printf null)" >"$candidate"
  chown "$SERVICE_USER:$SERVICE_USER" "$candidate"
  chmod 0600 "$candidate"
  mv -f -- "$candidate" "$STATUS_FILE"
}

snapshot_host_contract() {
  install -d -m 0700 "$TEMP_ROOT/files" "$TEMP_ROOT/units"
  local path encoded unit
  for path in "${HOST_CONTRACT_PATHS[@]}"; do
    if [[ -e "$path" || -L "$path" ]]; then
      encoded="${path#/}"
      install -d -m 0700 "$TEMP_ROOT/files/$(dirname "$encoded")"
      cp -a -- "$path" "$TEMP_ROOT/files/$encoded"
    fi
  done
  for unit in "${HOST_UNITS[@]}"; do
    systemctl is-enabled "$unit" >"$TEMP_ROOT/units/$unit.enabled" 2>/dev/null || true
    systemctl is-active "$unit" >"$TEMP_ROOT/units/$unit.active" 2>/dev/null || true
  done
}

rollback_host_contract() {
  local path encoded unit enabled active restored_healthy=1
  ROLLING_BACK=1
  systemctl disable --now 1helm-update.path 1helm-lxc-net.service >/dev/null 2>&1 || true
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  for path in "${HOST_CONTRACT_PATHS[@]}"; do
    encoded="${path#/}"
    rm -f -- "$path"
    if [[ -e "$TEMP_ROOT/files/$encoded" || -L "$TEMP_ROOT/files/$encoded" ]]; then
      install -d -m 0755 "$(dirname "$path")"
      cp -a -- "$TEMP_ROOT/files/$encoded" "$path"
    fi
  done
  systemctl daemon-reload
  for unit in "${HOST_UNITS[@]}"; do
    enabled="$(cat "$TEMP_ROOT/units/$unit.enabled" 2>/dev/null || true)"
    active="$(cat "$TEMP_ROOT/units/$unit.active" 2>/dev/null || true)"
    [[ "$enabled" == "enabled" ]] && systemctl enable "$unit" >/dev/null 2>&1 || true
    [[ "$active" == "active" ]] && systemctl start "$unit" >/dev/null 2>&1 || true
  done
  if [[ "$(cat "$TEMP_ROOT/units/$SERVICE_NAME.active" 2>/dev/null || true)" == "active" ]]; then
    restored_healthy=0
    for _ in {1..300}; do
      if curl -fsS "http://127.0.0.1:$PORT/api/setup/status" >/dev/null; then restored_healthy=1; break; fi
      sleep 0.2
    done
  fi
  TRANSACTION_ACTIVE=0
  ROLLING_BACK=0
  [[ "$restored_healthy" -eq 1 ]]
}

cleanup_transaction() {
  local status=$?
  trap - EXIT
  if [[ "$TRANSACTION_ACTIVE" -eq 1 && "$ROLLING_BACK" -eq 0 ]]; then
    rollback_host_contract || true
    write_status "error" "The verified Linux host-contract migration failed and the prior contract was restored." "Host-contract migration failed." || true
  fi
  [[ -z "$TEMP_ROOT" ]] || rm -rf -- "$TEMP_ROOT"
  exit "$status"
}
trap cleanup_transaction EXIT

snapshot_host_contract
TRANSACTION_ACTIVE=1
write_status "installing" "The host is installing 1Helm v$TARGET_VERSION's verified isolated runtime contract."
"$RELEASE_ROOT/site/public/install-lxc-runtime.sh" "$RELEASE_ROOT"
"$RELEASE_ROOT/site/public/install-linux-units.sh" "$RELEASE_ROOT"
write_status "restarting" "The verified host runtime is installed and 1Helm is restarting."
systemctl restart "$SERVICE_NAME"
healthy=0
for _ in {1..300}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/setup/status" >/dev/null; then healthy=1; break; fi
  sleep 0.2
done
[[ "$healthy" -eq 1 ]] || { echo "The migrated 1Helm host failed its health check." >&2; exit 1; }
TRANSACTION_ACTIVE=0
write_status "current" "This 1Helm host and its isolated runtime are up to date."
