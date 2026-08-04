#!/usr/bin/env bash
# Build or reuse the immutable Linux/Windows channel-computer image. Application
# versions deliberately are not an input: unchanged image source produces the
# same cache key and digest-addressed release candidate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINERFILE="$ROOT/container/Containerfile.oci"
OUT_TAR="$ROOT/container/channel-machine.oci.tar"
OUT_SHA="$ROOT/container/channel-machine.oci.sha256"
OUT_META="$ROOT/container/channel-machine.oci.json"
CACHE_ROOT="${HELM_OCI_CACHE_DIR:-$ROOT/dist/cache/channel-images}"

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported builder architecture: $(uname -m)" >&2; exit 1 ;;
esac
[[ -r "$CONTAINERFILE" ]] || { echo "Missing $CONTAINERFILE" >&2; exit 1; }
command -v podman >/dev/null || { echo "podman is required to build the sealed channel image" >&2; exit 1; }

BASE_DIGEST="$(sed -n 's/^FROM .*@sha256:\([a-f0-9]\{64\}\)$/\1/p' "$CONTAINERFILE")"
[[ "$BASE_DIGEST" =~ ^[a-f0-9]{64}$ ]] || { echo "Containerfile.oci must pin one base image by SHA-256" >&2; exit 1; }
CONTAINERFILE_SHA="$(sha256sum "$CONTAINERFILE" | awk '{print $1}')"
CONTEXT_SHA="$(
  cd "$ROOT"
  git ls-files -z container \
    | while IFS= read -r -d '' file; do
        case "$file" in
          container/channel-machine.oci.tar|container/channel-machine.oci.sha256|container/channel-machine.oci.json) continue ;;
        esac
        printf '%s\0' "$file"
        sha256sum "$file" | awk '{printf "%s\0", $1}'
      done \
    | sha256sum | awk '{print $1}'
)"
CACHE_KEY="$(printf '1helm-channel-image-v1\n%s\n%s\n%s\n%s\n' "$ARCH" "$BASE_DIGEST" "$CONTAINERFILE_SHA" "$CONTEXT_SHA" | sha256sum | awk '{print $1}')"
CACHE_TAR="$CACHE_ROOT/$CACHE_KEY.oci.tar"
CACHE_META="$CACHE_ROOT/$CACHE_KEY.json"
CACHE_REUSED=false

validate_cache() {
  [[ -f "$CACHE_TAR" && -f "$CACHE_META" ]] || return 1
  python3 - "$CACHE_META" "$CACHE_TAR" "$CACHE_KEY" "$ARCH" "$BASE_DIGEST" "$CONTAINERFILE_SHA" "$CONTEXT_SHA" <<'PY'
import hashlib, json, os, sys
meta_path, archive, key, arch, base, containerfile, context = sys.argv[1:]
try:
    meta = json.load(open(meta_path, encoding="utf-8"))
except (OSError, ValueError):
    raise SystemExit(1)
h = hashlib.sha256()
with open(archive, "rb") as stream:
    while chunk := stream.read(1024 * 1024): h.update(chunk)
valid = (
    meta.get("schema") == 1 and meta.get("kind") == "1helm-sealed-channel-image"
    and meta.get("version") == "1" and meta.get("architecture") == arch
    and meta.get("sha256") == h.hexdigest() and meta.get("bytes") == os.path.getsize(archive)
    and (meta.get("cache") or {}).get("key") == key
    and (meta.get("inputs") or {}).get("base_image_digest") == base
    and (meta.get("inputs") or {}).get("containerfile_sha256") == containerfile
    and (meta.get("inputs") or {}).get("context_sha256") == context
)
raise SystemExit(0 if valid else 1)
PY
}

mkdir -p "$CACHE_ROOT"
if validate_cache; then
  CACHE_REUSED=true
  echo "Reusing sealed channel image cache key $CACHE_KEY"
else
  [[ ! -e "$CACHE_TAR" && ! -e "$CACHE_META" ]] \
    || { echo "OCI cache key $CACHE_KEY exists but failed exact input/digest validation; refusing to overwrite it" >&2; exit 1; }
  IMAGE_REF="localhost/local/1helm-channel-machine:input-$CACHE_KEY"
  echo "Building sealed channel image input-$CACHE_KEY ($ARCH)…"
  podman build --network=host --pull=missing \
    --build-arg AGENT_UID=1000 --build-arg AGENT_GID=1000 \
    --tag "$IMAGE_REF" --file "$CONTAINERFILE" "$ROOT/container"
  podman image exists "$IMAGE_REF"
  TEMP_TAR="$(mktemp "$CACHE_ROOT/.channel-image.XXXXXX.oci.tar")"
  trap 'rm -f -- "${TEMP_TAR:-}" "${TEMP_META:-}"' EXIT
  podman save --format oci-archive --output "$TEMP_TAR" "$IMAGE_REF"
  DIGEST="$(sha256sum "$TEMP_TAR" | awk '{print $1}')"
  BYTES="$(stat -c %s "$TEMP_TAR")"
  ARTIFACT="1Helm-channel-machine-v1-$ARCH-$DIGEST.oci.tar"
  TEMP_META="$(mktemp "$CACHE_ROOT/.channel-image.XXXXXX.json")"
  python3 - "$TEMP_META" "$ARCH" "$DIGEST" "$BYTES" "$ARTIFACT" "$CACHE_KEY" "$CONTAINERFILE_SHA" "$CONTEXT_SHA" "$BASE_DIGEST" <<'PY'
import json, sys
path, arch, digest, size, artifact, key, containerfile, context, base = sys.argv[1:]
json.dump({
  "schema": 1,
  "kind": "1helm-sealed-channel-image",
  "version": "1",
  "architecture": arch,
  "sha256": digest,
  "bytes": int(size),
  "artifact": {"name": artifact},
  "platforms": ["linux", "windows-wsl"],
  "inputs": {
    "containerfile_sha256": containerfile,
    "context_sha256": context,
    "base_image_digest": base,
  },
  "cache": {"key": key, "reused": False},
}, open(path, "w", encoding="utf-8"), indent=2)
PY
  chmod 0644 "$TEMP_TAR" "$TEMP_META"
  mv "$TEMP_TAR" "$CACHE_TAR"
  mv "$TEMP_META" "$CACHE_META"
  TEMP_TAR="" TEMP_META=""
fi

# The worktree pointers are staging inputs, never the immutable cache authority.
# Preserve any unrelated or mismatched local output instead of deleting it.
for existing in "$OUT_TAR" "$OUT_SHA" "$OUT_META"; do
  [[ ! -e "$existing" ]] || {
    if [[ "$existing" == "$OUT_TAR" ]] && cmp -s "$existing" "$CACHE_TAR"; then continue; fi
    if [[ "$existing" == "$OUT_META" ]] && python3 - "$existing" "$CACHE_KEY" <<'PY'
import json, sys
try: value=json.load(open(sys.argv[1], encoding="utf-8"))
except Exception: raise SystemExit(1)
raise SystemExit(0 if (value.get("cache") or {}).get("key") == sys.argv[2] else 1)
PY
    then continue; fi
    if [[ "$existing" == "$OUT_SHA" ]] && [[ "$(tr -d '[:space:]' <"$existing")" == "$(sha256sum "$CACHE_TAR" | awk '{print $1}')" ]]; then continue; fi
    echo "Refusing to overwrite existing mismatched local artifact: $existing" >&2
    exit 1
  }
done
[[ -e "$OUT_TAR" ]] || cp "$CACHE_TAR" "$OUT_TAR"
DIGEST="$(sha256sum "$CACHE_TAR" | awk '{print $1}')"
[[ -e "$OUT_SHA" ]] || printf '%s\n' "$DIGEST" >"$OUT_SHA"
META_CANDIDATE="$(mktemp "$ROOT/container/.channel-machine.XXXXXX.json")"
python3 - "$CACHE_META" "$META_CANDIDATE" "$CACHE_REUSED" <<'PY'
import json, sys
value=json.load(open(sys.argv[1], encoding="utf-8"))
value["cache"]["reused"] = sys.argv[3] == "true"
json.dump(value, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
PY
chmod 0644 "$META_CANDIDATE"
mv "$META_CANDIDATE" "$OUT_META"
chmod 0644 "$OUT_TAR" "$OUT_SHA" "$OUT_META"
printf 'Sealed channel image ready: %s sha256=%s cache=%s reused=%s\n' "$OUT_TAR" "$DIGEST" "$CACHE_KEY" "$CACHE_REUSED"
