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
  write_status "error" "${TARGET_VERSION:-}" "$message" "$message"
  echo "$message" >&2
  exit 1
}

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
if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  write_status "current" "$TARGET_VERSION" "This 1Helm host is up to date."
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

PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT" 2>/dev/null || true)"
ln -s "$RELEASE_ROOT" "$TEMP_ROOT/current"
mv -Tf "$TEMP_ROOT/current" "$APP_ROOT"
install -o root -g root -m 0755 "$RELEASE_ROOT/site/public/update-host.sh" "$INSTALL_ROOT/update-host.sh"

write_status "restarting" "$TARGET_VERSION" "The host installed v$TARGET_VERSION and is restarting 1Helm."
systemctl restart "$SERVICE_NAME"
healthy=0
for _ in {1..150}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/setup/status" >/dev/null; then healthy=1; break; fi
  sleep 0.2
done
if [[ "$healthy" -ne 1 ]]; then
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$TEMP_ROOT/rollback"
    mv -Tf "$TEMP_ROOT/rollback" "$APP_ROOT"
    systemctl restart "$SERVICE_NAME"
    for _ in {1..100}; do
      curl -fsS "http://127.0.0.1:$PORT/api/setup/status" >/dev/null && break
      sleep 0.2
    done
  fi
  fail "1Helm v$TARGET_VERSION failed its host health check; the previous release was restored when available."
fi
write_status "current" "$TARGET_VERSION" "This 1Helm host is running v$TARGET_VERSION."
