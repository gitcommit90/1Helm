#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_REPOSITORY:-}" == "gitcommit90/1Helm" ]] || { echo "This runner accepts only gitcommit90/1Helm." >&2; exit 1; }
[[ "${GITHUB_WORKFLOW:-}" == "Candidate dress rehearsal" ]] || { echo "This runner accepts only the candidate workflow." >&2; exit 1; }
[[ "${GITHUB_JOB:-}" == "deploy" ]] || { echo "This runner accepts only the constrained deployment job." >&2; exit 1; }
[[ "${GITHUB_EVENT_NAME:-}" == "workflow_run" ]] || { echo "This runner rejects PR and direct-push jobs." >&2; exit 1; }
[[ -r "${GITHUB_EVENT_PATH:-}" ]] || { echo "The trusted workflow event payload is unavailable." >&2; exit 1; }

python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json, re, sys
event = json.load(open(sys.argv[1], encoding="utf-8"))
run = event.get("workflow_run") or {}
repository = event.get("repository") or {}
head_repository = run.get("head_repository") or {}
trusted = (
    repository.get("full_name") == "gitcommit90/1Helm"
    and head_repository.get("full_name") == "gitcommit90/1Helm"
    and run.get("name") == "CI"
    and run.get("event") == "push"
    and run.get("head_branch") == "main"
    and run.get("conclusion") == "success"
    and re.fullmatch(r"[a-f0-9]{40}", str(run.get("head_sha") or ""))
)
if not trusted:
    raise SystemExit("The candidate runner refused an untrusted repository/ref/SHA/CI event.")
PY
