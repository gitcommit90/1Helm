# 1Helm — project instructions

## Product record
- Keep `docs/VISION.md` current. Append major decisions, constraints, slice status, and VPS/test findings without waiting to be asked.
- Git/PR history holds implementation detail; `docs/VISION.md` holds anything the product owner would otherwise have to restate.

## VPS test sandbox (`ssh demo1helm`, `http://167.233.229.141:8123`)
- This machine is a **fresh-user sandbox**, not a durable workspace.
- **Default:** every VPS deploy/update is a cold first-run. Wipe `/root/1helm/data` (or the app data dir), rebuild, and restart so `/api/setup/status` reports `needs_setup: true` with no users/providers.
- **Exception only when the user explicitly says** to preserve state (e.g. "keep the existing workspace", "do not wipe data").
- Prefer the helper script: `scripts/deploy-vps-fresh.sh`.
- Do not hand-edit product files on the VPS to fix bugs — fix in the repo and redeploy fresh.

## Workflow
- Develop on the local checkout / worktree; push to private `gitcommit90/1Helm`.
- Treat the VPS as a stranger's cold install.
- Prefer acting over planning unless the user explicitly asks for a plan.
