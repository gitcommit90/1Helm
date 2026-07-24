#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/gitcommit90/1Helm.git"
INSTALL_ROOT="/opt/1helm"
RELEASES_ROOT="$INSTALL_ROOT/releases"
APP_ROOT="$INSTALL_ROOT/current"
NODE_ROOT="$INSTALL_ROOT/node"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm"
SERVICE_USER="1helm"
SERVICE_FILE="/etc/systemd/system/1helm.service"
UPDATE_SERVICE_FILE="/etc/systemd/system/1helm-update.service"
UPDATE_PATH_FILE="/etc/systemd/system/1helm-update.path"
NODE_VERSION="22.23.1"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null || [[ ! -d /run/systemd/system ]]; then
  echo "1Helm's Linux installer requires a running systemd host." >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

need=(curl git tar xz sha256sum flock make c++ python3)
missing=()
for command in "${need[@]}"; do command -v "$command" >/dev/null || missing+=("$command"); done
if ((${#missing[@]})); then
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl git xz-utils ca-certificates util-linux build-essential python3
  elif command -v dnf >/dev/null; then
    dnf install -y curl git xz ca-certificates util-linux gcc-c++ make python3
  else
    echo "Install these prerequisites first: ${missing[*]} plus a C/C++ toolchain and Python 3." >&2
    exit 1
  fi
fi

NODE_TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
chmod 0755 "$TEMP_ROOT"
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

VERSION="$(curl -fsSL https://api.github.com/repos/gitcommit90/1Helm/releases/latest | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\([^"]*\)".*/\1/p' | head -n1)"
[[ -n "$VERSION" ]] || { echo "Could not resolve the latest public 1Helm release." >&2; exit 1; }
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
chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_ROOT" "$STATE_ROOT"
install -o root -g root -m 0755 "$RELEASE_ROOT/site/public/update-host.sh" "$INSTALL_ROOT/update-host.sh"

PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
ln -s "$RELEASE_ROOT" "$TEMP_ROOT/current"
mv -Tf "$TEMP_ROOT/current" "$APP_ROOT"

install -m 0644 /dev/stdin "$SERVICE_FILE" <<EOF
[Unit]
Description=1Helm durable agent workspace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_ROOT
Environment=NODE_ENV=production
Environment=PORT=8123
Environment=HELM_HOST=0.0.0.0
Environment=CTRL_DATA_DIR=$STATE_ROOT
Environment=HELM_CHANNEL_COMPUTER_BACKEND=native
Environment=HELM_INSTALL_KIND=linux-systemd
ExecStart=$NODE_LINK/bin/node --disable-warning=ExperimentalWarning src/server/index.ts
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$STATE_ROOT

[Install]
WantedBy=multi-user.target
EOF

install -m 0644 /dev/stdin "$UPDATE_SERVICE_FILE" <<EOF
[Unit]
Description=Install a verified 1Helm host update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$INSTALL_ROOT/update-host.sh
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_ROOT $STATE_ROOT
EOF

install -m 0644 /dev/stdin "$UPDATE_PATH_FILE" <<EOF
[Unit]
Description=Watch for Captain-authorized 1Helm host updates

[Path]
PathChanged=$STATE_ROOT/host-update.request
Unit=1helm-update.service

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable 1helm.service
systemctl enable --now 1helm-update.path
systemctl restart 1helm.service
healthy=0
for _ in {1..100}; do
  if curl -fsS http://127.0.0.1:8123/api/setup/status >/dev/null; then healthy=1; break; fi
  sleep 0.2
done
if [[ "$healthy" -ne 1 ]]; then
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$TEMP_ROOT/rollback"
    mv -Tf "$TEMP_ROOT/rollback" "$APP_ROOT"
    systemctl restart 1helm.service
  fi
  echo "1Helm v$VERSION did not become healthy; the previous release was restored when available." >&2
  exit 1
fi
echo "1Helm v$VERSION is running at http://localhost:8123"
echo "Linux currently uses the durable compatibility computer backend; it does not claim one isolated VM per resident."
