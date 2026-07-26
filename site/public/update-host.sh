#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="gitcommit90/1Helm"
INSTALL_ROOT="/opt/1helm"
RELEASES_ROOT="$INSTALL_ROOT/releases"
APP_ROOT="$INSTALL_ROOT/current"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm"
SERVICE_USER="1helm"
REQUEST_FILE="$STATE_ROOT/host-update.request"
STATUS_FILE="$STATE_ROOT/host-update-status.json"
LOCK_FILE="$INSTALL_ROOT/host-update.lock"
SERVICE_NAME="1helm.service"
PORT="8123"
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

if [[ "${EUID}" -ne 0 ]]; then
  echo "The 1Helm host updater must run as root through systemd." >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0
[[ -f "$REQUEST_FILE" ]] || exit 0

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
chmod 0755 "$TEMP_ROOT"
rm -f -- "$REQUEST_FILE"

json_string() {
  "$NODE_LINK/bin/node" -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
}

write_status() {
  local state="$1" version="${2:-}" message="${3:-}" error="${4:-}"
  local candidate="$TEMP_ROOT/status.json"
  printf '{"mode":"linux-systemd","status":%s,"version":%s,"checked_at":%s,"message":%s,"error":%s}\n' \
    "$(json_string "$state")" \
    "$([[ -n "$version" ]] && json_string "$version" || printf null)" \
    "$(( $(date +%s) * 1000 ))" \
    "$(json_string "$message")" \
    "$([[ -n "$error" ]] && json_string "$error" || printf null)" >"$candidate"
  chown "$SERVICE_USER:$SERVICE_USER" "$candidate"
  chmod 0600 "$candidate"
  mv -f -- "$candidate" "$STATUS_FILE"
}

fail() {
  local message="$1"
  if [[ "$TRANSACTION_ACTIVE" -eq 1 && "$ROLLING_BACK" -eq 0 ]]; then
    rollback_host_contract || message="$message The prior host contract could not be fully restored."
  fi
  write_status "error" "${TARGET_VERSION:-}" "$message" "$message"
  echo "$message" >&2
  exit 1
}

snapshot_host_contract() {
  RUNTIME_BACKUP="$TEMP_ROOT/runtime-backup"
  install -d -m 0700 "$RUNTIME_BACKUP/files" "$RUNTIME_BACKUP/units"
  for path in "${HOST_CONTRACT_PATHS[@]}"; do
    if [[ -e "$path" || -L "$path" ]]; then
      encoded="${path#/}"
      install -d -m 0700 "$RUNTIME_BACKUP/files/$(dirname "$encoded")"
      cp -a -- "$path" "$RUNTIME_BACKUP/files/$encoded"
    fi
  done
  for unit in "${HOST_UNITS[@]}"; do
    systemctl is-enabled "$unit" >"$RUNTIME_BACKUP/units/$unit.enabled" 2>/dev/null || true
    systemctl is-active "$unit" >"$RUNTIME_BACKUP/units/$unit.active" 2>/dev/null || true
  done
}

rollback_host_contract() {
  local path encoded unit enabled active restored_healthy=1
  ROLLING_BACK=1
  systemctl disable --now 1helm-update.path 1helm-lxc-net.service >/dev/null 2>&1 || true
  systemctl stop 1helm.service >/dev/null 2>&1 || true
  for path in "${HOST_CONTRACT_PATHS[@]}"; do
    encoded="${path#/}"
    rm -f -- "$path"
    if [[ -e "$RUNTIME_BACKUP/files/$encoded" || -L "$RUNTIME_BACKUP/files/$encoded" ]]; then
      install -d -m 0755 "$(dirname "$path")"
      cp -a -- "$RUNTIME_BACKUP/files/$encoded" "$path"
    fi
  done
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$TEMP_ROOT/rollback-current"
    mv -Tf "$TEMP_ROOT/rollback-current" "$APP_ROOT"
  else
    rm -f -- "$APP_ROOT"
  fi
  systemctl daemon-reload
  for unit in "${HOST_UNITS[@]}"; do
    enabled="$(cat "$RUNTIME_BACKUP/units/$unit.enabled" 2>/dev/null || true)"
    active="$(cat "$RUNTIME_BACKUP/units/$unit.active" 2>/dev/null || true)"
    [[ "$enabled" == "enabled" ]] && systemctl enable "$unit" >/dev/null 2>&1 || true
    [[ "$active" == "active" ]] && systemctl start "$unit" >/dev/null 2>&1 || true
  done
  if [[ "$(cat "$RUNTIME_BACKUP/units/$SERVICE_NAME.active" 2>/dev/null || true)" == "active" ]]; then
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
  fi
  rm -rf -- "$TEMP_ROOT"
  exit "$status"
}
trap cleanup_transaction EXIT

write_status "checking" "" "The 1Helm host is checking the stable release metadata."
curl -fsSL --proto '=https' --tlsv1.2 \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: 1Helm-host-updater' \
  "https://api.github.com/repos/$REPOSITORY/releases/latest" \
  -o "$TEMP_ROOT/release.json" || fail "The host could not reach the 1Helm release service."

RELEASE_OUTPUT="$("$NODE_LINK/bin/node" - "$TEMP_ROOT/release.json" <<'NODE'
const fs = require("node:fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = String(release.tag_name || "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version) || release.draft || release.prerelease) process.exit(2);
const name = `1Helm-${version}-linux-node.tgz`;
const asset = (release.assets || []).find((candidate) => candidate.name === name);
const digest = String(asset?.digest || "");
const url = String(asset?.browser_download_url || "");
const expectedUrl = `https://github.com/gitcommit90/1Helm/releases/download/v${version}/${name}`;
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(digest) || url !== expectedUrl) process.exit(3);
console.log(version);
console.log(url);
console.log(digest.slice(7));
NODE
)" || fail "The latest release does not contain a digest-qualified Linux host artifact."
mapfile -t RELEASE <<<"$RELEASE_OUTPUT"
[[ "${#RELEASE[@]}" -eq 3 ]] || fail "The latest release returned incomplete Linux host metadata."

TARGET_VERSION="${RELEASE[0]}"
ARTIFACT_URL="${RELEASE[1]}"
EXPECTED_SHA="${RELEASE[2]}"
CURRENT_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$APP_ROOT/package.json" 2>/dev/null || true)"
VERSION_ORDER="$("$NODE_LINK/bin/node" -e '
const parse = (value) => /^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : null;
const current = parse(process.argv[1]); const target = parse(process.argv[2]);
if (!current || !target) process.exit(2);
for (let index = 0; index < 3; index += 1) {
  if (current[index] !== target[index]) { process.stdout.write(current[index] > target[index] ? "1" : "-1"); process.exit(0); }
}
process.stdout.write("0");
' "$CURRENT_VERSION" "$TARGET_VERSION")" || fail "The host could not compare installed and released 1Helm versions."
if [[ "$VERSION_ORDER" != "-1" ]]; then
  # Stable metadata can briefly lag an independently staged or newly
  # published host. Never downgrade. When the application source is already
  # current/newer, only finish its own retained host-runtime contract.
  TARGET_VERSION="$CURRENT_VERSION"
  # Older updaters can switch application source before they know about a new
  # root-owned runtime/unit contract. Let the newly installed updater finish
  # that migration from the already verified, retained release without
  # downloading or running any new remote content.
  if [[ -x /usr/libexec/1helm-lxc-runtime ]] \
      && [[ "$(/usr/libexec/1helm-lxc-runtime version 2>/dev/null || true)" == "1helm-lxc-runtime-v1" ]] \
      && grep -qx 'Environment=HELM_CHANNEL_COMPUTER_BACKEND=lxc' /etc/systemd/system/1helm.service 2>/dev/null; then
    write_status "current" "$TARGET_VERSION" "This 1Helm host is up to date."
    exit 0
  fi
  RELEASE_ROOT="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
  [[ "$RELEASE_ROOT" == "$RELEASES_ROOT/"* && -d "$RELEASE_ROOT" ]] \
    || fail "The current 1Helm release is not inside the verified release store."
  [[ -x "$RELEASE_ROOT/site/public/migrate-linux-host-contract.sh" && -x "$RELEASE_ROOT/site/public/install-lxc-runtime.sh" && -x "$RELEASE_ROOT/site/public/install-linux-units.sh" && -x "$RELEASE_ROOT/site/public/uninstall-host.sh" && -x "$RELEASE_ROOT/scripts/1helm-lxc-runtime" && -x "$RELEASE_ROOT/scripts/1helm-lxc-net" ]] \
    || fail "The current verified release is missing its isolated LXC runtime contract."
  write_status "installing" "$TARGET_VERSION" "The application is current; the host is migrating its verified runtime contract."
  MIGRATION_UNIT="1helm-host-contract-migration-${TARGET_VERSION//./-}-$$"
  systemd-run --quiet --collect --wait --pipe --unit="$MIGRATION_UNIT" \
    --property=Type=oneshot --property=NoNewPrivileges=false --property=PrivateTmp=true --property=ProtectHome=true \
    "$RELEASE_ROOT/site/public/migrate-linux-host-contract.sh" "$RELEASE_ROOT" "$TARGET_VERSION" \
    || exit 1
  exit 0
fi

write_status "downloading" "$TARGET_VERSION" "The 1Helm host is downloading and verifying v$TARGET_VERSION."
ARTIFACT="$TEMP_ROOT/1helm.tgz"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$ARTIFACT" "$ARTIFACT_URL" \
  || fail "The host could not download 1Helm v$TARGET_VERSION."
printf '%s  %s\n' "$EXPECTED_SHA" "$(basename "$ARTIFACT")" \
  | (cd "$TEMP_ROOT" && sha256sum -c -) \
  || fail "The downloaded 1Helm artifact failed SHA-256 verification."

STAGE="$TEMP_ROOT/source"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$STAGE"
tar -xzf "$ARTIFACT" -C "$STAGE" --strip-components=1 \
  || fail "The verified 1Helm artifact could not be extracted."
PACKAGE_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$STAGE/package.json" 2>/dev/null || true)"
[[ "$PACKAGE_VERSION" == "$TARGET_VERSION" ]] \
  || fail "The verified Linux artifact version does not match its release tag."
[[ -x "$STAGE/site/public/update-host.sh" ]] \
  || fail "The verified Linux artifact is missing its host updater."
[[ -x "$STAGE/site/public/apply-linux-release.sh" && -x "$STAGE/site/public/migrate-linux-host-contract.sh" && -x "$STAGE/site/public/install-lxc-runtime.sh" && -x "$STAGE/site/public/install-linux-units.sh" && -x "$STAGE/site/public/uninstall-host.sh" && -x "$STAGE/scripts/1helm-lxc-runtime" && -x "$STAGE/scripts/1helm-lxc-net" ]] \
  || fail "The verified Linux artifact is missing its isolated LXC runtime contract."
chown -R "$SERVICE_USER:$SERVICE_USER" "$STAGE"

write_status "installing" "$TARGET_VERSION" "The host verified v$TARGET_VERSION and is preparing an atomic installation."
runuser -u "$SERVICE_USER" -- env HOME="$STATE_ROOT" PATH="$NODE_LINK/bin:/usr/bin:/bin" \
  PUPPETEER_SKIP_DOWNLOAD=1 "$NODE_LINK/bin/npm" --prefix "$STAGE" ci \
  || fail "The verified 1Helm release dependencies could not be installed."
runuser -u "$SERVICE_USER" -- env HOME="$STATE_ROOT" PATH="$NODE_LINK/bin:/usr/bin:/bin" \
  "$NODE_LINK/bin/npm" --prefix "$STAGE" run build \
  || fail "The verified 1Helm release could not be built on this host."

RELEASE_ROOT="$RELEASES_ROOT/$TARGET_VERSION-$EXPECTED_SHA"
if [[ -e "$RELEASE_ROOT" ]]; then
  EXISTING_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$RELEASE_ROOT/package.json" 2>/dev/null || true)"
  [[ "$EXISTING_VERSION" == "$TARGET_VERSION" ]] \
    || fail "An existing host release directory does not match v$TARGET_VERSION."
else
  mv -- "$STAGE" "$RELEASE_ROOT"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_ROOT"

# One verified transient root transaction owns the runtime files, current
# symlink, unit migration, restart, health check, and rollback together. This
# also escapes v0.0.11's obsolete ProtectSystem=strict mount namespace before
# the first host file is replaced.
APPLY_UNIT="1helm-release-apply-${TARGET_VERSION//./-}-$$"
if ! systemd-run --quiet --collect --wait --pipe --unit="$APPLY_UNIT" \
    --property=Type=oneshot --property=NoNewPrivileges=false --property=PrivateTmp=true --property=ProtectHome=true \
    "$RELEASE_ROOT/site/public/apply-linux-release.sh" "$RELEASE_ROOT" "$TARGET_VERSION"; then
  echo "1Helm v$TARGET_VERSION failed its atomic host transaction; the transaction's visible status records whether rollback was proven healthy." >&2
  exit 1
fi
exit 0
