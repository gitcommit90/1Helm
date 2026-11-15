#!/bin/bash
# Save = pack everything written since wake (the overlay's upper dir, including deletion markers) into one squashfs
# and hand it to the controller, which verifies the SHA-256, stores it in R2 and only then makes it current.
# Each save in a session replaces that session's previous layer. Every few sessions the controller asks for a full base.
S=/var/1hc C=http://computer.internal SESSION=$(cat /tmp/1hc-session)
exec 9>/tmp/1hc-save.lock; flock 9
[ -f $S/ready ] || { echo '{"ok":true,"skipped":true,"reason":"workspace not mounted"}'; exit 0; }
t0=$(date +%s%3N); sync
plan=$(curl -fsS -m 10 "$C/save-plan?session=$SESSION") || { echo '{"ok":false,"error":"no plan"}'; exit 1; }
state=$(find $S/upper -printf '%P %s %T@ %m %y\n' 2>/dev/null | sort | sha256sum | cut -c1-16)
if [ "$plan" != "base" ] && [ "$state" = "$(cat $S/last_saved 2>/dev/null)" ]; then echo '{"ok":true,"skipped":true,"reason":"no changes"}'; exit 0; fi
if [ "$plan" != "base" ] && [ -z "$(ls -A $S/upper)" ]; then echo '{"ok":true,"skipped":true,"reason":"no changes"}'; exit 0; fi
src=$S/upper; [ "$plan" = "base" ] && src=/workspace
rm -f $S/out.sqsh; mksquashfs $src $S/out.sqsh -comp zstd -Xcompression-level 3 -noappend -no-progress -quiet >/dev/null 2>&1 || { echo '{"ok":false,"error":"mksquashfs failed"}'; exit 1; }
t1=$(date +%s%3N); sha=$(sha256sum $S/out.sqsh | cut -c1-64)
r=$(curl -fsS -m 900 -X PUT -H "x-sha256: $sha" -H "x-kind: $plan" -H "x-session: $SESSION" -H "x-reason: ${1:-turn}" -H "x-pack-ms: $((t1-t0))" -T $S/out.sqsh "$C/save") || { echo '{"ok":false,"error":"upload failed"}'; exit 1; }
echo "$state" > $S/last_saved; rm -f $S/out.sqsh
echo "$r"
