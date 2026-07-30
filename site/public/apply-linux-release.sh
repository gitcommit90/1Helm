#!/usr/bin/env bash
set -euo pipefail

# Apply one already downloaded, SHA-verified, built, and retained 1Helm Linux
# release as a single root transaction outside an older updater unit's mount
# namespace. No URL, command, or arbitrary destination is accepted here.

INSTALL_ROOT="/opt/1helm"
RELEASES_ROOT="$INSTALL_ROOT/releases"
APP_ROOT="$INSTALL_ROOT/current"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm-oci-v1"
SERVICE_USER="1helm"
SERVICE_NAME="1helm.service"
PORT="8123"
RELEASE_ROOT="$(readlink -f "${1:-}" 2>/dev/null || true)"
TARGET_VERSION="${2:-}"
STATUS_FILE="$STATE_ROOT/host-update-status.json"
HOST_CONTRACT_PATHS=(
  /usr/libexec/1helm-oci-runtime
  /etc/1helm/oci-runtime-v1.conf
  /etc/sudoers.d/1helm-oci-runtime
  /etc/tmpfiles.d/1helm-oci.conf
  /usr/lib/1helm-oci/Containerfile.oci
  /etc/systemd/system/1helm.service
  /etc/systemd/system/1helm-update.service
  /etc/systemd/system/1helm-update.path
  /opt/1helm/update-host.sh
  /opt/1helm/uninstall-host.sh
)
HOST_UNITS=(1helm.service 1helm-update.path)
TRANSACTION_ACTIVE=0
ROLLING_BACK=0
TEMP_ROOT=""
PREVIOUS_RELEASE=""

[[ "${EUID}" -eq 0 ]] || { echo "The Linux release transaction must run as root." >&2; exit 1; }
[[ "$RELEASE_ROOT" == "$RELEASES_ROOT/"* && -d "$RELEASE_ROOT" ]] \
  || { echo "The Linux release transaction requires a verified retained release." >&2; exit 1; }
[[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "The Linux release transaction requires an exact version." >&2; exit 1; }
PACKAGE_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$RELEASE_ROOT/package.json" 2>/dev/null || true)"
[[ "$PACKAGE_VERSION" == "$TARGET_VERSION" ]] \
  || { echo "The retained release does not match the requested version." >&2; exit 1; }
[[ -x "$RELEASE_ROOT/site/public/install-oci-runtime.sh" \
   && -x "$RELEASE_ROOT/site/public/install-linux-units.sh" \
   && -x "$RELEASE_ROOT/site/public/update-host.sh" \
   && -x "$RELEASE_ROOT/site/public/uninstall-host.sh" \
   && -x "$RELEASE_ROOT/scripts/1helm-oci-runtime" \
   && -r "$RELEASE_ROOT/deploy/1helm-oci-runtime-v1.conf" \
   && -r "$RELEASE_ROOT/container/Containerfile.oci" ]] \
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
  systemctl disable --now 1helm-update.path >/dev/null 2>&1 || true
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  for path in "${HOST_CONTRACT_PATHS[@]}"; do
    encoded="${path#/}"
    rm -f -- "$path"
    if [[ -e "$TEMP_ROOT/files/$encoded" || -L "$TEMP_ROOT/files/$encoded" ]]; then
      install -d -m 0755 "$(dirname "$path")"
      cp -a -- "$TEMP_ROOT/files/$encoded" "$path"
    fi
  done
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$TEMP_ROOT/rollback-current"
    mv -Tf "$TEMP_ROOT/rollback-current" "$APP_ROOT"
  fi
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
  local command_status=$?
  trap - EXIT
  if [[ "$TRANSACTION_ACTIVE" -eq 1 && "$ROLLING_BACK" -eq 0 ]]; then
    if rollback_host_contract; then
      write_status "error" "1Helm v$TARGET_VERSION failed its host health transaction; the prior healthy release was restored." "Host update failed and was rolled back." || true
    else
      write_status "error" "1Helm v$TARGET_VERSION failed and the prior host could not be proven healthy after rollback." "Host update and rollback health check failed." || true
    fi
  fi
  [[ -z "$TEMP_ROOT" ]] || rm -rf -- "$TEMP_ROOT"
  exit "$command_status"
}
trap cleanup_transaction EXIT

PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
[[ "$PREVIOUS_RELEASE" == "$RELEASES_ROOT/"* && -d "$PREVIOUS_RELEASE" ]] \
  || { echo "The currently installed 1Helm release is not inside the verified release store." >&2; exit 1; }
snapshot_host_contract
TRANSACTION_ACTIVE=1
write_status "installing" "The host verified v$TARGET_VERSION and is applying one atomic runtime and application transaction."
HELM_HOST_APPLY_DELEGATED=1 "$RELEASE_ROOT/site/public/install-oci-runtime.sh" "$RELEASE_ROOT"
ln -s "$RELEASE_ROOT" "$TEMP_ROOT/current"
mv -Tf "$TEMP_ROOT/current" "$APP_ROOT"
HELM_HOST_APPLY_DELEGATED=1 "$RELEASE_ROOT/site/public/install-linux-units.sh" "$RELEASE_ROOT"
write_status "restarting" "The host installed v$TARGET_VERSION and is restarting 1Helm."
systemctl restart "$SERVICE_NAME"
healthy=0
for _ in {1..300}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/setup/status" >/dev/null; then healthy=1; break; fi
  sleep 0.2
done
[[ "$healthy" -eq 1 ]] || { echo "1Helm v$TARGET_VERSION failed its host health check." >&2; exit 1; }
TRANSACTION_ACTIVE=0
write_status "current" "This 1Helm host is running v$TARGET_VERSION."
