#!/bin/sh
# ---------------------------------------------------------------------------
# 1Helm WSL keepalive - in-distro anchor + service watchdog.
#
# Runs INSIDE the WSL distro, as root, started by keepalive-run.ps1 via:
#     wsl.exe -d <distro> -u root --exec /bin/sh <this> <service> <interval>
#
# It has exactly two jobs:
#   1. EXIST. WSL tears a distro down ~15s after its last session closes.
#      As long as this process is alive the distro stays booted.
#   2. WATCH. Make sure the 1Helm systemd unit is actually active, and start
#      it again if something inside the distro killed it.
#
# Deliberately /bin/sh + coreutils only: no bash-isms, no extra packages.
# ---------------------------------------------------------------------------
SERVICE="${1:-1helm.service}"
INTERVAL="${2:-20}"
TAG="1helm-keepalive"

log() { logger -t "$TAG" -- "$*" 2>/dev/null || true; }

log "anchor started (pid $$) service=$SERVICE interval=${INTERVAL}s"

# Give systemd a moment to finish booting on a cold distro start before the
# first verdict, otherwise we race the unit's own auto-start.
i=0
while [ "$i" -lt 30 ]; do
    [ "$(systemctl is-system-running 2>/dev/null)" = "starting" ] || break
    i=$((i + 1))
    sleep 1
done

while :; do
    if ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
        log "$SERVICE is not active - starting it"
        systemctl start "$SERVICE" >/dev/null 2>&1 || log "failed to start $SERVICE"
    fi
    sleep "$INTERVAL"
done
