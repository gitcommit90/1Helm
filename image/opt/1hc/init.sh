#!/bin/bash
# 1Helm Cloud channel computer: PID 1.
# Wake: fetch this channel's layer list from its controller (http://computer.internal, intercepted outside the VM,
# scoped to this channel), download + verify each squashfs layer, stack them read-only with a writable overlay on /workspace.
# Stop: on SIGTERM (idle, deploy, host restart) save from inside the container, then exit. No keys ever enter the VM.
set -u
S=/var/1hc C=http://computer.internal
export SESSION=${SESSION:-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')}
echo "$SESSION" > /tmp/1hc-session 2>/dev/null || true
log(){ echo "[1hc-init $(date +%T.%3N)] $*"; }
on_term() {
  log "SIGTERM"; curl -sS -m 5 -X POST "$C/draining" >/dev/null 2>&1
  /opt/1hc/save.sh sigterm; log "exit"; exit 0
}
trap on_term TERM INT
mount_ws() {
  local t0=$(date +%s%3N) n=0 lowers="" bytes=0
  rm -rf $S; mkdir -p $S/layers $S/lower $S/upper $S/work $S/empty /workspace
  # The controller link can be briefly unavailable right after a retried start: retry for up to ~20 s before giving up.
  local ok=0; for i in 1 2 3 4 5 6 7 8; do curl -fsS --connect-timeout 3 -m 10 "$C/manifest" > $S/manifest && { ok=1; break; }; sleep $(( i < 4 ? 1 : 2 )); done
  [ $ok = 1 ] || { echo "manifest fetch failed after retries" > $S/failed; return 1; }
  # manifest: "key sha256 bytes presigned-url" per layer, newest first. Download all in parallel straight from R2
  # (short-lived read-only link, no keys in the VM). Stalled transfers are cut (<1 MB/s for 5 s) and retried; the
  # controller path is the last resort. Every layer must match its SHA-256 before it is mounted.
  get() { # url out
    curl -fsS --retry 2 --retry-all-errors --connect-timeout 5 --speed-limit 1048576 --speed-time 5 -m 120 -o "$2" "$1"
  }
  while read -r key sha sz url; do [ -z "$key" ] && continue
    ( f=$S/layers/$n.sqsh; src=r2
      { [ "$url" != "-" ] && get "$url" $f && echo "$sha  $f" | sha256sum -c --status; } || { src=controller; get "$C/layer?key=$key" $f && echo "$sha  $f" | sha256sum -c --status; } || { echo "$key" >> $S/bad; exit; }
      echo "$src" >> $S/sources ) &
    n=$((n+1)); bytes=$((bytes+sz))
  done < $S/manifest
  wait; local t1=$(date +%s%3N)
  [ -s $S/bad ] && { echo "layer download/verify failed: $(cat $S/bad)" > $S/failed; return 1; }
  for i in $(seq 0 $((n-1))); do mkdir -p $S/lower/$i; squashfuse $S/layers/$i.sqsh $S/lower/$i || { echo "squashfuse $i failed" > $S/failed; return 1; }; lowers="${lowers:+$lowers:}$S/lower/$i"; done
  fuse-overlayfs -o "lowerdir=${lowers:-$S/empty},upperdir=$S/upper,workdir=$S/work" /workspace || { echo "overlay failed" > $S/failed; return 1; }
  local t2=$(date +%s%3N)
  echo "{\"layers\":$n,\"bytes\":$bytes,\"download_ms\":$((t1-t0)),\"mount_ms\":$((t2-t1)),\"via\":\"$(sort $S/sources 2>/dev/null | uniq -c | awk '{printf "%s%s:%s",(NR>1?",":""),$2,$1}')\",\"session\":\"$SESSION\"}" > $S/ready
  log "workspace ready $(cat $S/ready)"
}
mount_ws || log "mount failed: $(cat $S/failed 2>/dev/null)"
# Real browser service (tiny until used: Xvfb/Chrome/VNC start on the first browser request). Its profile lives in /workspace/.browser.
if [ -f /opt/1hc-browser/server.mjs ]; then
  ( while true; do node /opt/1hc-browser/server.mjs >>/var/log/1hc-browser.log 2>&1; sleep 1; done ) &
fi
while true; do sleep 3600 & wait $!; done
