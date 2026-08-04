#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_REPOSITORY:-}" == "gitcommit90/1Helm" ]] || { echo "Phase 4 runner refused another repository." >&2; exit 1; }
[[ "${GITHUB_WORKFLOW:-}" == "Candidate dress rehearsal" ]] || { echo "Phase 4 runner refused another workflow." >&2; exit 1; }
[[ "${GITHUB_WORKFLOW_REF:-}" == "gitcommit90/1Helm/.github/workflows/candidate.yml@refs/heads/main" ]] || { echo "Phase 4 runner refused another workflow path or ref." >&2; exit 1; }
[[ "${GITHUB_EVENT_NAME:-}" == "workflow_run" ]] || { echo "Phase 4 runner refused PR, fork, dispatch, and direct-push events." >&2; exit 1; }
case "${GITHUB_JOB:-}" in
  build-macos) expected_label=1helm-macos-phase4 ;;
  accept-macos) expected_label=1helm-macos-phase4 ;;
  *) echo "Phase 4 runner refused job ${GITHUB_JOB:-missing}." >&2; exit 1 ;;
esac
[[ "${GITHUB_REF:-}" == "refs/heads/main" && "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] \
  || { echo "Phase 4 runner refused a non-main or invalid workflow identity." >&2; exit 1; }

event="${GITHUB_EVENT_PATH:?GitHub event payload is required}"
python3 - "$event" "$GITHUB_REPOSITORY" "$GITHUB_SHA" <<'PY'
import json, sys
event = json.load(open(sys.argv[1], encoding="utf-8"))
run = event.get("workflow_run") or {}
repo = ((run.get("head_repository") or {}).get("full_name"))
if not (
    repo == sys.argv[2] == ((event.get("repository") or {}).get("full_name"))
    and run.get("name") == "CI"
    and run.get("event") == "push"
    and run.get("head_branch") == "main"
    and run.get("head_sha") == sys.argv[3]
    and run.get("status") == "completed"
    and run.get("conclusion") == "success"
):
    raise SystemExit("Phase 4 runner refused an untrusted repository/ref/SHA/CI event.")
PY
