#!/bin/bash
# Save = pack everything written since wake (the overlay's upper dir, including deletion markers) into one squashfs
# and hand it to the controller, which verifies the SHA-256, stores it in R2 and only then makes it current.
# Each save in a session replaces that session's previous layer. Every few sessions the controller asks for a full base.
S=/var/1hc C=http://computer.internal SESSION=$(cat /tmp/1hc-session)
. /opt/1hc/disk.sh
exec 9>/tmp/1hc-save.lock; flock 9
[ -f $S/ready ] || { echo '{"ok":true,"skipped":true,"reason":"workspace not mounted"}'; exit 0; }
t0=$(date +%s%3N); sync
plan=$(curl -fsS -m 10 "$C/save-plan?session=$SESSION") || { echo '{"ok":false,"error":"no plan"}'; exit 1; }
state=$(find $S/upper -printf '%P %s %T@ %m %y\n' 2>/dev/null | sort | sha256sum | cut -c1-16)
if [ "$plan" != "base" ] && [ "$state" = "$(cat $S/last_saved 2>/dev/null)" ]; then echo '{"ok":true,"skipped":true,"reason":"no changes"}'; exit 0; fi
if [ "$plan" != "base" ] && [ -z "$(ls -A $S/upper)" ]; then echo '{"ok":true,"skipped":true,"reason":"no changes"}'; exit 0; fi
# The reserve is freed so a pack always has room, and made again on every exit. Download caches stay out of the pack (the guard
# deletes them anyway), but the installed browsers do not.
rm -f $RESERVE; trap disk_reserve EXIT
EX=(); for d in "${CACHE_REL[@]}"; do EX+=(-e "$d"); done
while read -r d; do EX+=(-e ".browser/profile/Default/$d"); done < /opt/1hc/chrome-cache.txt
free=$(df -B1 --output=avail / | tail -1)
# A base needs room for the whole workspace packed again; when it does not fit, pack only the changes and say so in x-kind.
src=$S/upper; if [ "$plan" = "base" ]; then [ "$free" -lt "$(du -sxb /workspace | cut -f1)" ] && plan=delta || src=/workspace; fi
pack() { rm -f $S/out.sqsh; err=$(mksquashfs $src $S/out.sqsh -comp zstd -Xcompression-level 3 -noappend -no-progress -quiet "${EX[@]}" 2>&1 >/dev/null); }
pack || {
  # Relief pass: out of space, so clear the caches and pack only the changes once more.
  full=false; grep -qi 'no space' <<<"$err" && full=true
  [ $full = true ] && { disk_clear full >/dev/null; src=$S/upper; plan=delta; pack && err=""; }
  [ -n "$err" ] && { free=$(df -B1 --output=avail / | tr -d " " | tail -1); rm -f $S/out.sqsh
    echo "{\"ok\":false,\"disk_full\":$full,\"free\":$free,\"error\":\"$(head -1 <<<"$err" | tr -d '"\\' | cut -c1-300)\"}"; exit 1; }
}
t1=$(date +%s%3N); sha=$(sha256sum $S/out.sqsh | cut -c1-64)
r=$(curl -fsS -m 900 -X PUT -H "x-sha256: $sha" -H "x-kind: $plan" -H "x-session: $SESSION" -H "x-reason: ${1:-turn}" -H "x-pack-ms: $((t1-t0))" -T $S/out.sqsh "$C/save") || { echo '{"ok":false,"error":"upload failed"}'; exit 1; }
echo "$state" > $S/last_saved; rm -f $S/out.sqsh
echo "$r"
