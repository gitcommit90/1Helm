#!/bin/sh
set -eu
# Exact pinned source, applied only to the isolated builder's module cache.
target="$(go env GOMODCACHE)/tailscale.com@v1.104.1/control/controlclient/direct.go"
printf '%s  %s\n' '9fc200ba9212682f5108f83e6ec02447aa8aed723c14a3149dbf0001f7b0d1dc' "$target" | sha256sum -c -
chmod u+w "$target"
# Minimal builder images lack patch(1). This exact insertion implements the
# adjacent reviewed tailscale-resume.patch; the pre/post hashes forbid drift.
sed -i '/persist:           opts.Persist.View(),/a\		tryingNewKey:      opts.Persist.PrivateNodeKey,' "$target"
printf '%s  %s\n' 'b8daaf15bccb7bf8b3464cac7ac928999f47ca5fb69cbf84cd528a3fa3aa6f21' "$target" | sha256sum -c -
