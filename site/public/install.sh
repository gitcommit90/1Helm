#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="/opt/1helm"
RELEASES_ROOT="$INSTALL_ROOT/releases"
APP_ROOT="$INSTALL_ROOT/current"
NODE_ROOT="$INSTALL_ROOT/node"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm-oci-v1"
SERVICE_USER="1helm"
NODE_VERSION="22.23.1"
RELEASE_METADATA_URL="https://1helm.com/api/releases/linux/latest"
HOST_CONTRACT_PATHS=(
  /usr/libexec/1helm-oci-runtime
  /etc/1helm/oci-runtime-v1.conf
  /etc/sudoers.d/1helm-oci-runtime
  /etc/apparmor.d/local/crun
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

# No compiler is probed or installed. The Linux release arrives with its native
# addons already compiled against the oldest supported glibc, so nothing on this
# machine builds 1Helm and the C/C++ toolchain package is no longer a host
# dependency. python3 and python3-venv stay: install-oci-runtime.sh requires
# python3 and durable memory creates its own virtual environment at first use.
need=(curl tar xz sha256sum flock python3 podman crun fuse-overlayfs setfacl getfacl sudo visudo)
missing=()
for command in "${need[@]}"; do command -v "$command" >/dev/null || missing+=("$command"); done
if ((${#missing[@]})) || ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl xz-utils ca-certificates util-linux python3 \
    python3-venv acl aardvark-dns crun fuse-overlayfs netavark podman uidmap sudo rsync
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

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$TEMP_ROOT/release.json" "$RELEASE_METADATA_URL"
RELEASE_OUTPUT="$("$NODE_LINK/bin/node" - "$TEMP_ROOT/release.json" <<'NODE'
const fs = require("node:fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = String(release.version || "");
const url = String(release.url || "");
const sha256 = String(release.sha256 || "");
const name = `1Helm-${version}-linux-node.tgz`;
const expectedUrl = `https://github.com/gitcommit90/1Helm/releases/download/v${version}/${name}`;
if (!/^\d+\.\d+\.\d+$/.test(version) || url !== expectedUrl || !/^[a-f0-9]{64}$/.test(sha256)) process.exit(2);
console.log(version);
console.log(url);
console.log(sha256);
NODE
)" || { echo "1helm.com did not return a complete stable Linux release." >&2; exit 1; }
mapfile -t RELEASE <<<"$RELEASE_OUTPUT"
[[ "${#RELEASE[@]}" -eq 3 ]] || { echo "1helm.com returned incomplete Linux release metadata." >&2; exit 1; }
VERSION="${RELEASE[0]}"
RELEASE_URL="${RELEASE[1]}"
RELEASE_SHA256="${RELEASE[2]}"
RELEASE_ARCHIVE="$TEMP_ROOT/1Helm-$VERSION-linux-node.tgz"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$RELEASE_ARCHIVE" "$RELEASE_URL"
printf '%s  %s\n' "$RELEASE_SHA256" "$(basename "$RELEASE_ARCHIVE")" \
  | (cd "$TEMP_ROOT" && sha256sum -c -)

RELEASE_STAGE="$TEMP_ROOT/source"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$RELEASE_STAGE"
tar -xzf "$RELEASE_ARCHIVE" -C "$RELEASE_STAGE" --strip-components=1
PACKAGE_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$RELEASE_STAGE/package.json" 2>/dev/null || true)"
[[ "$PACKAGE_VERSION" == "$VERSION" ]] || {
  echo "This archive contains 1Helm ${PACKAGE_VERSION:-an unreadable version} but the release metadata resolved v$VERSION." >&2
  echo "Nothing was installed. Retry, or report the mismatch if it persists: the published artifact does not match its release." >&2
  exit 1
}
[[ -x "$RELEASE_STAGE/site/public/apply-linux-release.sh" \
   && -x "$RELEASE_STAGE/site/public/install-oci-runtime.sh" \
   && -x "$RELEASE_STAGE/site/public/install-linux-units.sh" \
   && -x "$RELEASE_STAGE/site/public/uninstall-host.sh" \
   && -x "$RELEASE_STAGE/scripts/1helm-oci-runtime" \
   && -r "$RELEASE_STAGE/deploy/1helm-oci-runtime-v1.conf" \
   && -r "$RELEASE_STAGE/container/Containerfile.oci" \
   && -f "$RELEASE_STAGE/container/channel-machine.oci.tar" \
   && -f "$RELEASE_STAGE/container/channel-machine.oci.sha256" \
   && -x "$RELEASE_STAGE/resources/cloudflared-linux-$NODE_ARCH" ]] \
  || { echo "The verified Linux artifact is missing its complete OCI runtime contract." >&2; exit 1; }
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_STAGE"

# The release arrives ready to run: no npm ci, no npm run build, no compiler and
# no npm registry on the install path. The archive carries its own production
# node_modules whose native addons were compiled against the oldest supported
# glibc, plus every built client asset. This fails closed instead of falling
# back to an on-host build: the host no longer installs a compiler, so a
# fallback would spend several minutes reaching the same failure with a worse
# message.
verify_ready_to_run() {
  local candidate="$1"
  [[ -d "$candidate/node_modules" && -f "$candidate/resources/linux-native-modules.json" ]] \
    || { echo "This 1Helm archive carries no vendored node_modules, so it predates ready-to-run Linux releases." >&2
         echo "Download the current release; this installer no longer builds 1Helm on your machine." >&2
         return 1; }
  [[ -s "$candidate/public/bundle.js" && -s "$candidate/public/app.css" ]] \
    || { echo "This 1Helm archive is missing its built client assets (public/bundle.js, public/app.css)." >&2
         echo "Download the current release; this installer no longer builds 1Helm on your machine." >&2
         return 1; }
  if ! "$NODE_LINK/bin/node" - "$candidate" "$NODE_ARCH" <<'NODE'
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const [, , releaseRoot, hostArch] = process.argv;
const manifest = JSON.parse(readFileSync(join(releaseRoot, "resources/linux-native-modules.json"), "utf8"));
if (manifest.platform !== "linux" || manifest.arch !== hostArch) {
  throw new Error(`release ships ${manifest.platform}-${manifest.arch} native addons, host is linux-${hostArch}`);
}
if (String(manifest.nodeAbi) !== process.versions.modules) {
  throw new Error(`release native addons target Node ABI ${manifest.nodeAbi}, installed Node reports ${process.versions.modules}`);
}
const required = "node_modules/node-pty/build/Release/pty.node";
const paths = (manifest.modules || []).map((entry) => String(entry.path));
if (!paths.includes(required)) throw new Error(`manifest does not list ${required}`);
for (const relative of paths) {
  const file = join(releaseRoot, relative);
  if (!existsSync(file)) throw new Error(`missing native addon ${relative}`);
  process.dlopen({ exports: {} }, file);
}
if (typeof require(join(releaseRoot, "node_modules/node-pty")).spawn !== "function") {
  throw new Error("node-pty did not expose spawn()");
}
console.log(`verified ${paths.length} prebuilt native addons including a loadable node-pty`);
NODE
  then
    echo "The Linux native addons shipped with this release cannot be loaded on this host, so" >&2
    echo "terminals and channel computers would not work. The installation was refused." >&2
    return 1
  fi
}
verify_ready_to_run "$RELEASE_STAGE" || exit 1

RELEASE_ROOT="$RELEASES_ROOT/$VERSION-$RELEASE_SHA256"
if [[ -e "$RELEASE_ROOT" ]]; then
  EXISTING_VERSION="$("$NODE_LINK/bin/node" -p 'require(process.argv[1]).version' "$RELEASE_ROOT/package.json" 2>/dev/null || true)"
  [[ "$EXISTING_VERSION" == "$VERSION" \
     && -f "$RELEASE_ROOT/container/channel-machine.oci.tar" \
     && -f "$RELEASE_ROOT/container/channel-machine.oci.sha256" \
     && -x "$RELEASE_ROOT/resources/cloudflared-linux-$NODE_ARCH" ]] \
    || { echo "Existing release directory does not match the verified v$VERSION Linux artifact." >&2; exit 1; }
  # A retained directory from an interrupted earlier run can be incomplete even
  # though its name carries the verified digest. Prove it is still runnable
  # before any host file is touched.
  verify_ready_to_run "$RELEASE_ROOT" || exit 1
else
  mv "$RELEASE_STAGE" "$RELEASE_ROOT"
fi
# The application owns the top-level state directory, while the OCI helper
# deliberately owns its persistent runtime subtree as root.  A repeat install
# must never recursively rewrite existing channel storage ownership.
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_ROOT"
PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
[[ "$PREVIOUS_RELEASE" == "$RELEASES_ROOT/"* && -d "$PREVIOUS_RELEASE" ]] || PREVIOUS_RELEASE=""
snapshot_host_contract
TRANSACTION_ACTIVE=1
# v0.0.30's otherwise accepted Linux artifact wrote this Podman selector with
# a trailing newline. Fresh Ubuntu 24.04 rejects that byte sequence, so the
# bootstrap repairs it before invoking either that helper or a newer one. An
# existing non-netavark selection remains untouched.
NETWORK_BACKEND_FILE="$STATE_ROOT/runtime/oci/storage/defaultNetworkBackend"
if [[ ! -e "$NETWORK_BACKEND_FILE" || (-f "$NETWORK_BACKEND_FILE" && "$(cat "$NETWORK_BACKEND_FILE")" == netavark) ]]; then
  install -d -o root -g root -m 0700 "$(dirname "$NETWORK_BACKEND_FILE")"
  printf '%s' netavark >"$NETWORK_BACKEND_FILE"
  chmod 0600 "$NETWORK_BACKEND_FILE"
fi
"$RELEASE_ROOT/site/public/install-oci-runtime.sh" "$RELEASE_ROOT"

ln -s "$RELEASE_ROOT" "$TEMP_ROOT/current"
mv -Tf "$TEMP_ROOT/current" "$APP_ROOT"
"$RELEASE_ROOT/site/public/install-linux-units.sh" "$RELEASE_ROOT"
systemctl enable --now 1helm-update.path

# Stop first so the port check below sees the truth, then refuse to start on top
# of a foreign listener. WSL 2 puts every distribution in ONE shared network
# namespace, so a service in another distribution - or on Windows itself - can
# own 8123 here. Without this check the readiness probe is answered by that
# foreign listener and the install reports success while 1helm.service
# crash-loops on EADDRINUSE. The probe binds the port the way the service will
# rather than parsing `ss`, which is not guaranteed to be installed and would
# otherwise skip this check in silence; `ss` is used only to name the culprit.
systemctl stop 1helm.service >/dev/null 2>&1 || true
if ! "$NODE_LINK/bin/node" -e '
const server = require("node:net").createServer();
server.once("error", (error) => { console.error(error.code || error.message); process.exit(1); });
server.listen(8123, () => server.close(() => process.exit(0)));' >/dev/null 2>&1; then
  echo "Port 8123 is already in use before 1Helm started, so 1helm.service cannot bind it." >&2
  echo "On Windows/WSL every distribution shares one network namespace: check for another 1Helm" >&2
  echo "installation, another WSL distribution, or a Windows process listening on 8123." >&2
  command -v ss >/dev/null 2>&1 && ss -ltnp 2>/dev/null | grep -E "[:.]8123[[:space:]]" >&2 || true
  exit 1
fi
systemctl start 1helm.service

# Readiness must prove THIS service is healthy, not merely that something
# answered on 8123.
healthy=0
unit_state=""
for _ in {1..300}; do
  unit_state="$(systemctl is-active 1helm.service 2>/dev/null || true)"
  if [[ "$unit_state" == "active" ]] && curl -fsS http://127.0.0.1:8123/api/setup/status >/dev/null; then healthy=1; break; fi
  [[ "$unit_state" == "failed" ]] && break
  sleep 0.2
done
if [[ "$healthy" -ne 1 ]]; then
  echo "1Helm v$VERSION did not become healthy; the previous release was restored when available." >&2
  echo "1helm.service reports '${unit_state:-unknown}'. Recent journal:" >&2
  journalctl -u 1helm.service -n 40 --no-pager >&2 2>/dev/null || true
  exit 1
fi
TRANSACTION_ACTIVE=0
echo "1Helm v$VERSION is running at http://localhost:8123"
echo "Every ordinary channel now receives its own persistent OCI container."
