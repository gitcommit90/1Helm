#!/usr/bin/env bash
# Deploy the current branch to the 1Helm demo VPS as a brand-new first-run workspace.
# Usage: scripts/deploy-vps-fresh.sh [branch]
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
HOST="${ONEHELM_VPS_HOST:-demo1helm}"
REMOTE_DIR="${ONEHELM_VPS_DIR:-/root/1helm}"

echo "Deploying branch '$BRANCH' to $HOST:$REMOTE_DIR as a FRESH first-run workspace"

ssh -o BatchMode=yes "$HOST" bash -s -- "$BRANCH" "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
BRANCH="$1"
REMOTE_DIR="$2"
cd "$REMOTE_DIR"

# Stop whatever is actually bound to 8123. The old absolute-path pkill never
# matched Node's argv ("src/server/index.ts"), so redeploys could leave a
# completed workspace process alive and report its stale /api/setup/status.
if [[ -f 1helm.pid ]]; then
  kill "$(cat 1helm.pid)" 2>/dev/null || true
  sleep 1
fi
fuser -k 8123/tcp 2>/dev/null || true
sleep 1
if command -v ss >/dev/null 2>&1 && ss -lptn "sport = :8123" | grep -q 8123; then
  echo "port 8123 still occupied after stop attempt" >&2
  ss -lptn "sport = :8123" >&2 || true
  exit 1
fi

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# Fresh-user rule: wipe workspace state unless the operator intentionally preserves it.
rm -rf "$REMOTE_DIR/data"

export PATH="/usr/local/bin:${PATH:-/usr/bin:/bin}"
export PUPPETEER_SKIP_DOWNLOAD=1
npm install
npm run build

nohup env PATH="/usr/local/bin:${PATH:-/usr/bin:/bin}" \
  node --disable-warning=ExperimentalWarning src/server/index.ts \
  > "$REMOTE_DIR/1helm.log" 2>&1 < /dev/null &
echo $! > "$REMOTE_DIR/1helm.pid"

for n in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8123/api/setup/status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "commit=$(git rev-parse --short HEAD)"
curl -sS http://127.0.0.1:8123/api/setup/status
echo
curl -sS -o /dev/null -w "index=%{http_code} css=%{http_code} js=%{http_code}\n" \
  http://127.0.0.1:8123/ http://127.0.0.1:8123/app.css http://127.0.0.1:8123/bundle.js
tail -3 "$REMOTE_DIR/1helm.log"
REMOTE

echo "Fresh deploy complete. Open http://167.233.229.141:8123 and hard-refresh."
