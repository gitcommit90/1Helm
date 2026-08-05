#!/usr/bin/env bash
# Build the retained Windows acceptance-host bootstrap ISO.
#
# Attach the result as a second CD-ROM alongside the Windows installation media
# on the dedicated Phase 4 acceptance VM. It carries the answer file and the
# first-boot bootstrap; it publishes nothing and contains no credentials beyond
# the operator's own SSH public key in setup.ps1.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-1helm-windows-unattend.iso}"
key="${2:-${HELM_ACCEPTANCE_AUTHORIZED_KEY:-}}"

if [ -z "$key" ] || [ ! -f "$key" ]; then
  echo "usage: build-unattend-iso.sh [out.iso] <path-to-authorized-key.pub>" >&2
  echo "   or: HELM_ACCEPTANCE_AUTHORIZED_KEY=/path/to/key.pub build-unattend-iso.sh [out.iso]" >&2
  echo "The operator public key is deliberately not committed to this public repository." >&2
  exit 2
fi

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp "$here/Autounattend.xml" "$here/setup.ps1" "$stage/"
printf 'Retained Windows acceptance bootstrap for 1Helm.\n' > "$stage/1helm-acceptance.txt"
install -m 0644 "$key" "$stage/authorized_key.pub"

# -iso-level 4 keeps long file names. At genisoimage's default level the
# ISO9660 namespace truncates Autounattend.xml to AUTOUNAT.XML, which Windows
# Setup does not recognize as an answer file.
#
# The volume label MUST remain ONEHELM: the auditUser pass in Autounattend.xml
# locates setup.ps1 via Get-Volume -FileSystemLabel ONEHELM.
genisoimage -quiet -iso-level 4 -J -r -V ONEHELM -o "$out" "$stage"

echo "wrote $out"
