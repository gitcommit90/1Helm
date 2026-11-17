#!/bin/bash
# Disk guard helpers, sourced by init.sh and save.sh. The computer has one disk that holds the system, the downloaded layers, the
# writable upper folder behind /workspace, /tmp, logs and the save output, so nothing may fill it without anyone noticing.
S=/var/1hc RESERVE=/var/1hc/reserve BLOG=/var/log/1hc-browser.log
# Download caches that are rebuilt on use. The pack leaves them out (save.sh) and the guard deletes them first. Never ms-playwright:
# the browsers a helper installed must survive sleep, so it is only deleted at the full level.
CACHE_REL=(.home/.cache/pip .home/.cache/uv .home/.npm/_cacache .home/.cache/go-build)
# Numbers as a process on the computer experiences them. While the reserve file exists its blocks are not available to writes, so the
# usable total and the used bytes both leave it out and free is what df shows as available. Writes fail when free reaches 0, which is
# 100 percent of the usable total, so the levels below are measured against the usable total.
disk_read() { local r=0; [ -f $RESERVE ] && r=$(stat -c %s $RESERVE); read -r T U F < <(df -B1 --output=size,used,avail / | tail -1); T=$((T-r)); U=$((U-r)); }
disk_level() { disk_read; if [ $((U*100/T)) -ge 97 ] || [ $F -lt 300000000 ]; then L=full; elif [ $((U*100/T)) -ge 85 ]; then L=low; else L=ok; fi; }
disk_reserve() { [ -f $RESERVE ] || fallocate -l 1G $RESERVE 2>/dev/null || rm -f $RESERVE; }
# Keeps the last 1 MB in place (the writer keeps its open append handle). Without "now" it only acts above 4 MB.
cap_log() { [ "${1:-}" = now ] || [ "$(stat -c %s $BLOG 2>/dev/null || echo 0)" -gt 4194304 ] || return 0; tail -c 1048576 $BLOG > $BLOG.t && cat $BLOG.t > $BLOG; rm -f $BLOG.t; }
# Deletes only the caches below, in order, while used space is at or over 85 percent, and stops once it is under 80 percent.
# $1 is the level; ms-playwright goes only at full. Prints the bytes freed.
disk_clear() {
  local u0 step d
  disk_read; u0=$U
  [ $((U*100/T)) -ge 85 ] || { echo 0; return; }
  for step in 1 2 3 4 5 6 7; do
    case $step in
      1) rm -rf /tmp/.npm-cache /tmp/1hc-browser-home/chrome-cache ;;
      2) while read -r d; do rm -rf "/workspace/.browser/profile/Default/$d"; done < /opt/1hc/chrome-cache.txt ;;
      3) for d in "${CACHE_REL[@]}"; do rm -rf "/workspace/$d"; done ;;
      4) rm -f /var/cache/apt/archives/*.deb ;;
      5) find /tmp -maxdepth 1 -name '.1hc-out-*' -mmin +10 -delete ;;
      6) cap_log now ;;
      7) [ "$1" = full ] && rm -rf /workspace/.home/.cache/ms-playwright ;;
    esac
    disk_read; [ $((U*100/T)) -lt 80 ] && break
  done
  echo $((u0>U ? u0-U : 0))
}
# Every 15 s: caps the browser log, reads the level, clears caches when needed and reports used, total, free, the level read
# before clearing and the bytes cleared to the controller when the level changes, after a clearing, and otherwise once a minute.
disk_guard() {
  local last="" lp=0 freed now
  while sleep 15; do
    cap_log; disk_level; now=$(date +%s)
    freed=$(disk_clear $L)
    if [ "$L" != "$last" ] || [ "$freed" != 0 ] || [ $((now-lp)) -ge 60 ]; then
      curl -fsS -m 5 -X POST -H 'content-type: application/json' -d "{\"used\":$U,\"total\":$T,\"free\":$F,\"level\":\"$L\",\"cleared\":$freed}" http://computer.internal/disk >/dev/null 2>&1 && { last=$L; lp=$now; }
    fi
  done
}
