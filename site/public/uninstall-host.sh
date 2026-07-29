#!/usr/bin/env bash
set -euo pipefail

# Remove the Linux host application and only containers whose exact names and
# in-guest owner markers belong to this installation. Durable workspace state
# remains under /var/lib/1helm for a deliberate reinstall or manual backup.

INSTALL_ROOT="/opt/1helm"
STATE_ROOT="/var/lib/1helm"
HELPER="/usr/libexec/1helm-lxc-runtime"
NODE="$INSTALL_ROOT/node-current/bin/node"

[[ "${EUID}" -eq 0 ]] || { echo "Run this uninstaller with sudo." >&2; exit 1; }
[[ -x "$NODE" && -x "$HELPER" ]] || { echo "A complete 1Helm Linux installation was not found." >&2; exit 1; }
INSTALLATION_ID="$("$NODE" --input-type=module - "$STATE_ROOT/ctrl-pane.db" <<'NODE'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const value = String(db.prepare("SELECT installation_id FROM workspace WHERE id=1").get()?.installation_id || "");
if (!/^[a-f0-9]{16}$/.test(value)) process.exit(2);
process.stdout.write(value);
NODE
)"
[[ "$INSTALLATION_ID" =~ ^[a-f0-9]{16}$ ]] || { echo "Could not verify this installation's machine identity." >&2; exit 1; }
systemctl stop 1helm.service 2>/dev/null || true
MACHINES_JSON="$($HELPER list "1helm-$INSTALLATION_ID-channel-")"
mapfile -t MACHINES < <("$NODE" -e 'for (const name of JSON.parse(process.argv[1])) { if (!/^1helm-[a-f0-9]{16}-channel-[0-9]+$/.test(name)) process.exit(2); console.log(name); }' "$MACHINES_JSON")
for name in "${MACHINES[@]}"; do
  channel_id="${name##*-}"
  "$HELPER" delete "$name" "$INSTALLATION_ID:$channel_id"
done
[[ "$($HELPER list "1helm-$INSTALLATION_ID-channel-")" == "[]" ]] || { echo "Some owned channel containers remained; application files were not removed." >&2; exit 1; }
systemctl disable --now 1helm-update.path 1helm-lxc-net.service 2>/dev/null || true
rm -f -- /etc/systemd/system/1helm.service /etc/systemd/system/1helm-update.service /etc/systemd/system/1helm-update.path /etc/systemd/system/1helm-lxc-net.service
rm -f -- /etc/sudoers.d/1helm-lxc-runtime /etc/1helm/lxc-runtime-v2.conf /usr/libexec/1helm-lxc-runtime /usr/libexec/1helm-lxc-net
rm -f -- "$INSTALL_ROOT/update-host.sh" "$INSTALL_ROOT/uninstall-host.sh"
systemctl daemon-reload
printf 'Removed the 1Helm services and %s owned channel container(s). Preserved %s and versioned release files for recovery.\n' "${#MACHINES[@]}" "$STATE_ROOT"
