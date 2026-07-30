#!/usr/bin/env bash
set -euo pipefail

# Install the root-owned Linux service contract from an already verified 1Helm
# release. Fresh installs and host updates share this exact path so an update
# can replace service/runtime settings instead of only changing the `current`
# symlink beneath an obsolete unit.

RELEASE_ROOT="${1:-}"
INSTALL_ROOT="/opt/1helm"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm-oci-v1"
SERVICE_USER="1helm"

# Bridge upgrades from v0.0.11's too-narrow ProtectSystem=strict namespace.
# The retained release has already been SHA-verified and built by the root
# updater; only its fixed unit installer can be delegated.
if [[ "${HELM_HOST_APPLY_DELEGATED:-}" != "1" ]] \
    && awk -F: '$1 == "0" && $3 ~ /(^|\/)1helm-update\.service(\/|$)/ { found=1 } END { exit found ? 0 : 1 }' /proc/self/cgroup; then
  RESOLVED_RELEASE="$(readlink -f "$RELEASE_ROOT" 2>/dev/null || true)"
  [[ "$RESOLVED_RELEASE" == /opt/1helm/releases/* && -d "$RESOLVED_RELEASE" ]] \
    || { echo "The updater can delegate only a verified retained 1Helm release." >&2; exit 1; }
  DELEGATE_UNIT="1helm-linux-units-apply-${RANDOM}-$$"
  exec systemd-run --quiet --collect --wait --pipe --unit="$DELEGATE_UNIT" \
    --property=Type=oneshot --property=NoNewPrivileges=false --property=PrivateTmp=true --property=ProtectHome=true \
    --setenv=HELM_HOST_APPLY_DELEGATED=1 \
    "$RESOLVED_RELEASE/site/public/install-linux-units.sh" "$RESOLVED_RELEASE"
fi

[[ "${EUID}" -eq 0 ]] || { echo "The Linux service installer must run as root." >&2; exit 1; }
[[ -n "$RELEASE_ROOT" && -d "$RELEASE_ROOT" ]] || { echo "A verified 1Helm release directory is required." >&2; exit 1; }
[[ -x "$RELEASE_ROOT/site/public/update-host.sh" && -x "$RELEASE_ROOT/site/public/apply-linux-release.sh" && -x "$RELEASE_ROOT/site/public/install-oci-runtime.sh" && -x "$RELEASE_ROOT/site/public/uninstall-host.sh" ]] \
  || { echo "The verified 1Helm release is missing its host lifecycle scripts." >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "The 1Helm service account does not exist." >&2; exit 1; }

install -o root -g root -m 0755 "$RELEASE_ROOT/site/public/update-host.sh" "$INSTALL_ROOT/update-host.sh"
install -o root -g root -m 0755 "$RELEASE_ROOT/site/public/uninstall-host.sh" "$INSTALL_ROOT/uninstall-host.sh"

install -m 0644 /dev/stdin /etc/systemd/system/1helm.service <<EOF
[Unit]
Description=1Helm durable agent workspace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_ROOT/current
Environment=NODE_ENV=production
Environment=PORT=8123
Environment=HELM_HOST=0.0.0.0
Environment=CTRL_DATA_DIR=$STATE_ROOT
Environment=HELM_CHANNEL_COMPUTER_BACKEND=oci
Environment=HELM_OCI_HELPER=/usr/libexec/1helm-oci-runtime
Environment=HELM_INSTALL_KIND=linux-systemd
ExecStart=$NODE_LINK/bin/node --disable-warning=ExperimentalWarning src/server/index.ts
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=false
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
# The root-owned helper keeps persistent Podman state beneath STATE_ROOT and
# libpod scratch beneath /run/1helm-oci. Podman's OCI/network backends also
# require these narrow ephemeral host runtime trees inside this mount
# namespace; no persistent system configuration directory is writable.
ReadWritePaths=$STATE_ROOT /run/1helm-oci /run/containers /run/crun /run/libpod /run/lock /run/netns /sys/fs/cgroup
Delegate=yes

[Install]
WantedBy=multi-user.target
EOF

install -m 0644 /dev/stdin /etc/systemd/system/1helm-update.service <<EOF
[Unit]
Description=Install a verified 1Helm host update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$INSTALL_ROOT/update-host.sh
NoNewPrivileges=false
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
# Runtime and unit files are installed by atomic rename and removed during a
# failed-update rollback, so their exact parent directories—not merely the old
# files—must be writable inside this root-owned transaction.
ReadWritePaths=$INSTALL_ROOT $STATE_ROOT /run/1helm-oci /usr/libexec /usr/lib/1helm-oci /etc/1helm /etc/default /etc/systemd/system /etc/sudoers.d /etc/subuid /etc/subgid
EOF

install -m 0644 /dev/stdin /etc/systemd/system/1helm-update.path <<EOF
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
systemctl enable 1helm-update.path
