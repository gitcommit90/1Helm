#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/gitcommit90/1Helm.git"
INSTALL_ROOT="/opt/1helm"
RELEASES_ROOT="$INSTALL_ROOT/releases"
APP_ROOT="$INSTALL_ROOT/current"
NODE_ROOT="$INSTALL_ROOT/node"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm-oci-v1"
SERVICE_USER="1helm"
NODE_VERSION="22.23.1"
RELEASE_VERSION="0.0.28"
HOST_CONTRACT_PATHS=(
  /usr/libexec/1helm-oci-runtime
  /etc/1helm/oci-runtime-v1.conf
  /etc/sudoers.d/1helm-oci-runtime
  /etc/tmpfiles.d/1helm-oci.conf
  /usr/lib/1helm-oci/Containerfile.oci
  /usr/lib/1helm-oci/channel-machine.oci.tar
  /usr/lib/1helm-oci/channel-machine.oci.sha256
  /etc/systemd/system/1helm.service
  /etc/systemd/system/1helm-update.service
  /etc/systemd/system/1helm-update.path
  /opt/1helm/update-host.sh
  /opt/1helm/uninstall-host.sh
)
HOST_UNITS=(1helm.service 1helm-update.path)
TRANSACTION_ACTIVE=0
ROLLING_BACK=0

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null || [[ ! -d /run/systemd/system ]]; then
  echo "1Helm's Linux installer requires a running systemd host." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null; then
  echo "1Helm's isolated Linux host currently requires Ubuntu or Debian with apt and systemd." >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

need=(curl git tar xz sha256sum flock make c++ python3 podman crun fuse-overlayfs setfacl getfacl sudo visudo)
missing=()
for command in "${need[@]}"; do command -v "$command" >/dev/null || missing+=("$command"); done
if ((${#missing[@]})) || ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl git xz-utils ca-certificates util-linux build-essential python3 \
    python3-venv acl crun fuse-overlayfs podman uidmap sudo rsync
fi

NODE_TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
TEMP_ROOT="$(mktemp -d)"
chmod 0755 "$TEMP_ROOT"

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
  systemctl disable --now 1helm-update.path >/dev/null 2>&1 || true
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
  if [[ "$(cat "$RUNTIME_BACKUP/units/1helm.service.active" 2>/dev/null || true)" == "active" ]]; then
    restored_healthy=0
    for _ in {1..300}; do
      if curl -fsS http://127.0.0.1:8123/api/setup/status >/dev/null; then restored_healthy=1; break; fi
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
curl -fsSLo "$TEMP_ROOT/$NODE_TARBALL" "https://nodejs.org/dist/v${NODE_VERSION}/$NODE_TARBALL"
curl -fsSLo "$TEMP_ROOT/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
NODE_SUM="$(awk -v file="$NODE_TARBALL" '$2 == file { print $1 }' "$TEMP_ROOT/SHASUMS256.txt")"
[[ "$NODE_SUM" =~ ^[a-f0-9]{64}$ ]] || { echo "Node's signed release manifest did not contain exactly one checksum for $NODE_TARBALL." >&2; exit 1; }
printf '%s  %s\n' "$NODE_SUM" "$NODE_TARBALL" | (cd "$TEMP_ROOT" && sha256sum -c -)

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$STATE_ROOT" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$INSTALL_ROOT" "$RELEASES_ROOT" "$NODE_ROOT" "$STATE_ROOT"

NODE_RELEASE="$NODE_ROOT/v$NODE_VERSION-$NODE_ARCH"
if [[ ! -x "$NODE_RELEASE/bin/node" ]]; then
  NODE_STAGE="$TEMP_ROOT/node"
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$NODE_STAGE"
  tar -xJf "$TEMP_ROOT/$NODE_TARBALL" -C "$NODE_STAGE" --strip-components=1
  chown -R "$SERVICE_USER:$SERVICE_USER" "$NODE_STAGE"
  mv "$NODE_STAGE" "$NODE_RELEASE"
fi
ln -sfn "$NODE_RELEASE" "$TEMP_ROOT/node-current"
mv -Tf "$TEMP_ROOT/node-current" "$NODE_LINK"

VERSION="$RELEASE_VERSION"
git clone --depth 1 --branch "v$VERSION" "$REPO" "$TEMP_ROOT/source"
RELEASE_SHA="$(git -C "$TEMP_ROOT/source" rev-parse HEAD)"
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "Could not resolve the checked-out release commit." >&2; exit 1; }
RELEASE_ROOT="$RELEASES_ROOT/$VERSION-${RELEASE_SHA:0:12}"
chown -R "$SERVICE_USER:$SERVICE_USER" "$TEMP_ROOT/source"
runuser -u "$SERVICE_USER" -- env HOME="$STATE_ROOT" PATH="$NODE_LINK/bin:/usr/bin:/bin" PUPPETEER_SKIP_DOWNLOAD=1 "$NODE_LINK/bin/npm" --prefix "$TEMP_ROOT/source" ci
runuser -u "$SERVICE_USER" -- env HOME="$STATE_ROOT" PATH="$NODE_LINK/bin:/usr/bin:/bin" "$NODE_LINK/bin/npm" --prefix "$TEMP_ROOT/source" run build
if [[ -e "$RELEASE_ROOT" ]]; then
  EXISTING_SHA="$(runuser -u "$SERVICE_USER" -- git -C "$RELEASE_ROOT" rev-parse HEAD 2>/dev/null || true)"
  [[ "$EXISTING_SHA" == "$RELEASE_SHA" ]] || { echo "Existing release directory does not match v$VERSION." >&2; exit 1; }
else
  mv "$TEMP_ROOT/source" "$RELEASE_ROOT"
fi
# The application owns the top-level state directory, while the OCI helper
# deliberately owns its persistent runtime subtree as root.  A repeat install
# must never recursively rewrite existing channel storage ownership.
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_ROOT"
PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
[[ "$PREVIOUS_RELEASE" == "$RELEASES_ROOT/"* && -d "$PREVIOUS_RELEASE" ]] || PREVIOUS_RELEASE=""
snapshot_host_contract
TRANSACTION_ACTIVE=1
"$RELEASE_ROOT/site/public/install-oci-runtime.sh" "$RELEASE_ROOT"

ln -s "$RELEASE_ROOT" "$TEMP_ROOT/current"
mv -Tf "$TEMP_ROOT/current" "$APP_ROOT"
"$RELEASE_ROOT/site/public/install-linux-units.sh" "$RELEASE_ROOT"
systemctl enable --now 1helm-update.path
systemctl restart 1helm.service
healthy=0
for _ in {1..300}; do
  if curl -fsS http://127.0.0.1:8123/api/setup/status >/dev/null; then healthy=1; break; fi
  sleep 0.2
done
if [[ "$healthy" -ne 1 ]]; then
  echo "1Helm v$VERSION did not become healthy; the previous release was restored when available." >&2
  exit 1
fi
TRANSACTION_ACTIVE=0
echo "1Helm v$VERSION is running at http://localhost:8123"
echo "Every ordinary channel now receives its own persistent OCI container."
