#!/usr/bin/env bash
# Build the sealed Linux/Windows channel-computer image once on a builder host.
# Output is a digest-pinned OCI archive next to the recipe — not for git.
# Apple/Mac channel machines are unaffected.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n1)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "package.json version is required" >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported builder architecture: $(uname -m)" >&2; exit 1 ;;
esac

IMAGE_REF="local/1helm-channel-machine:${VERSION}"
ENGINE_IMAGE="localhost/${IMAGE_REF}"
CONTAINERFILE="$ROOT/container/Containerfile.oci"
OUT_TAR="$ROOT/container/channel-machine.oci.tar"
OUT_SHA="$ROOT/container/channel-machine.oci.sha256"
OUT_META="$ROOT/container/channel-machine.oci.json"

[[ -r "$CONTAINERFILE" ]] || { echo "Missing $CONTAINERFILE" >&2; exit 1; }
command -v podman >/dev/null || { echo "podman is required to build the sealed channel image" >&2; exit 1; }

# Host network avoids Docker FORWARD=DROP and broken IPv6 on many builder hosts.
# This is builder-only; customer hosts load the sealed archive and never apt.
echo "Building sealed channel image ${IMAGE_REF} (${ARCH})…"
podman build --network=host --pull=missing \
  --build-arg AGENT_UID=1000 --build-arg AGENT_GID=1000 \
  --tag "$ENGINE_IMAGE" \
  --file "$CONTAINERFILE" \
  "$ROOT/container"

podman image exists "$ENGINE_IMAGE"
rm -f -- "$OUT_TAR" "$OUT_SHA" "$OUT_META"
podman save --format oci-archive --output "$OUT_TAR" "$ENGINE_IMAGE"
sha256sum "$OUT_TAR" | awk '{print $1}' >"$OUT_SHA"
DIGEST="$(tr -d '[:space:]' <"$OUT_SHA")"
python3 - "$OUT_META" "$IMAGE_REF" "$ARCH" "$VERSION" "$DIGEST" "$OUT_TAR" <<'PY'
import json, os, sys
meta_path, image, arch, version, digest, archive = sys.argv[1:]
json.dump({
  "image": image,
  "arch": arch,
  "version": version,
  "sha256": digest,
  "archive": os.path.basename(archive),
  "backend": "oci",
  "platforms": ["linux", "windows"],
}, open(meta_path, "w", encoding="utf-8"), indent=2)
print(meta_path)
PY
chmod 0644 "$OUT_TAR" "$OUT_SHA" "$OUT_META"
ls -lh "$OUT_TAR" "$OUT_SHA" "$OUT_META"
printf 'Sealed channel image ready: %s sha256=%s\n' "$OUT_TAR" "$DIGEST"
