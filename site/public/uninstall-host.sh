#!/usr/bin/env bash
set -euo pipefail

# Remove the Linux host application and only containers whose exact names and
# in-guest owner markers belong to this installation. Durable workspace state
# remains under /var/lib/1helm-oci-v1 for a deliberate reinstall or backup.

INSTALL_ROOT="/opt/1helm"
STATE_ROOT="/var/lib/1helm-oci-v1"
HELPER="/usr/libexec/1helm-oci-runtime"
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
systemctl disable --now 1helm-update.path 2>/dev/null || true
rm -f -- /etc/systemd/system/1helm.service /etc/systemd/system/1helm-update.service /etc/systemd/system/1helm-update.path
rm -f -- /etc/sudoers.d/1helm-oci-runtime /etc/1helm/oci-runtime-v1.conf /usr/libexec/1helm-oci-runtime /usr/lib/1helm-oci/Containerfile.oci /usr/lib/1helm-oci/channel-machine.oci.tar /usr/lib/1helm-oci/channel-machine.oci.sha256 /usr/lib/1helm-oci/channel-machine.oci.json
managed_crun_profile="$(mktemp)"
printf '%s\nnetwork inet,\nnetwork inet6,\n' '# Managed by 1Helm: allow resident OCI network sockets on nested hosts.' >"$managed_crun_profile"
if [[ -f /etc/apparmor.d/local/crun ]] && cmp -s "$managed_crun_profile" /etc/apparmor.d/local/crun; then
  rm -f -- /etc/apparmor.d/local/crun
  command -v apparmor_parser >/dev/null 2>&1 && [[ -r /etc/apparmor.d/crun ]] && apparmor_parser -r /etc/apparmor.d/crun || true
fi
rm -f -- "$managed_crun_profile"
rm -f -- "$INSTALL_ROOT/update-host.sh" "$INSTALL_ROOT/uninstall-host.sh"
systemctl daemon-reload
printf 'Removed the 1Helm services and %s owned channel container(s). Preserved %s and versioned release files for recovery.\n' "${#MACHINES[@]}" "$STATE_ROOT"
