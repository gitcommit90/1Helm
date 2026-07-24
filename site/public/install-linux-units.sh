#!/usr/bin/env bash
set -euo pipefail

# Install the root-owned Linux service contract from an already verified 1Helm
# release. Fresh installs and host updates share this exact path so an update
# can migrate service/runtime settings instead of only changing the `current`
# symlink beneath an obsolete unit.

RELEASE_ROOT="${1:-}"
INSTALL_ROOT="/opt/1helm"
NODE_LINK="$INSTALL_ROOT/node-current"
STATE_ROOT="/var/lib/1helm"
SERVICE_USER="1helm"

[[ "${EUID}" -eq 0 ]] || { echo "The Linux service installer must run as root." >&2; exit 1; }
[[ -n "$RELEASE_ROOT" && -d "$RELEASE_ROOT" ]] || { echo "A verified 1Helm release directory is required." >&2; exit 1; }
[[ -x "$RELEASE_ROOT/site/public/update-host.sh" && -x "$RELEASE_ROOT/site/public/migrate-linux-host-contract.sh" && -x "$RELEASE_ROOT/site/public/uninstall-host.sh" ]] \
  || { echo "The verified 1Helm release is missing its host lifecycle scripts." >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "The 1Helm service account does not exist." >&2; exit 1; }

install -o root -g root -m 0755 "$RELEASE_ROOT/site/public/update-host.sh" "$INSTALL_ROOT/update-host.sh"
install -o root -g root -m 0755 "$RELEASE_ROOT/site/public/uninstall-host.sh" "$INSTALL_ROOT/uninstall-host.sh"

install -m 0644 /dev/stdin /etc/systemd/system/1helm.service <<EOF
[Unit]
Description=1Helm durable agent workspace
After=network-online.target 1helm-lxc-net.service
Wants=network-online.target 1helm-lxc-net.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_ROOT/current
Environment=NODE_ENV=production
Environment=PORT=8123
Environment=HELM_HOST=0.0.0.0
Environment=CTRL_DATA_DIR=$STATE_ROOT
Environment=HELM_CHANNEL_COMPUTER_BACKEND=lxc
Environment=HELM_LXC_HELPER=/usr/libexec/1helm-lxc-runtime
Environment=HELM_INSTALL_KIND=linux-systemd
ExecStart=$NODE_LINK/bin/node --disable-warning=ExperimentalWarning src/server/index.ts
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=false
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$STATE_ROOT /var/lib/1helm-lxc /var/cache/1helm-lxc /run/lxc /sys/fs/cgroup
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
ReadWritePaths=$INSTALL_ROOT $STATE_ROOT /var/lib/1helm-lxc /var/cache/1helm-lxc /run/lxc /usr/libexec/1helm-lxc-runtime /usr/libexec/1helm-lxc-net /etc/1helm /etc/default/lxc-net /etc/systemd/system/1helm-lxc-net.service /etc/systemd/system/1helm.service /etc/systemd/system/1helm-update.service /etc/systemd/system/1helm-update.path /etc/sudoers.d/1helm-lxc-runtime /etc/subuid /etc/subgid
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
