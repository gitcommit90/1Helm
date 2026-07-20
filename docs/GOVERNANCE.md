# Project governance — 1Helm

1Helm is a private, maintainer-driven product repository (`gitcommit90/1Helm`). This document defines how changes land so the project is not treated as a throwaway side checkout.

## Product names

| Name | Meaning |
| --- | --- |
| **1Helm** | Product and GitHub repository (`1Helm`). The installed host / control plane. |
| **1Herd** | Product surface for the native agent workspace (channel-resident agents, computers, memory) evolving on feature branches / draft PRs. |
| **ctrl-pane** | Historical local directory name on ProxUI (`/root/ctrl-pane`). Prefer cloning as `1Helm` going forward; do not rename a dirty worktree without an explicit plan. |

npm package name remains `1helm` (lowercase).

## Authority

| Role | Who | Authority |
| --- | --- | --- |
| Maintainer | Repository owner (`gitcommit90`) | Merge to `main`, deploy demo VPS, tags/releases, policy |
| Agents / automation | Hermes, Codex, CI | Branch, test, open PRs; no silent production restarts without approval |
| External contributors | N/A while private | Repo is private; no external PR process yet |

## Source of truth

| Artifact | Location |
| --- | --- |
| Product code | `main` on `https://github.com/gitcommit90/1Helm` |
| Living product decisions | `docs/VISION.md` |
| Native agent-workspace spec (when present on branch) | `SPEC.md` |
| User-facing history | `CHANGELOG.md` + GitHub Releases (when used) |
| Ship / deploy procedure | `docs/release-lifecycle.md`, `docs/release-checklist.md` |
| Maintainer agent notes | `CLAUDE.md` (in-repo); Mattermost **#1helm** for ops chat |

Host-local Hermes notes (`/root/AGENTS.md`) are **ReRouted**, not 1Helm. Do not follow them in this repo.

## Branch model

- **Default branch:** `main` only.
- **Work branches:** short-lived:
  - `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `refactor/<slug>`
  - Existing `worktree-*` names are legacy; prefer the prefixes above for new work.
- **Merge method:** squash preferred for features; merge commits allowed when intentional.
- **Delete head branches on merge.**
- No force-push to `main`.

Large vertical slices (e.g. native 1Herd) may sit as **draft PRs** until verification is complete. Draft ≠ abandoned: update `CHANGELOG.md` Unreleased and `docs/VISION.md` as the slice hardens.

## Quality bar (every change to `main`)

1. Clear problem/outcome in PR body (or commit body for tiny maintainer docs).
2. `npm run typecheck` and `npm run build` green.
3. Relevant automated tests green (`npm test` = pipeline suite on `main`; feature branches add their suites when introduced).
4. `git diff --check` clean.
5. No secrets, private VPS credentials in README, real provider keys, or `data/` SQLite dumps.
6. Significant product decisions recorded in `docs/VISION.md`.
7. User-visible changes noted under `CHANGELOG.md` → `## [Unreleased]`.

## Versioning

- Semantic versioning on `package.json`.
- **Do not** reuse a published version tag for different bits.
- Until consumer installers exist, a “release” is: version bump + changelog section + optional git tag + verified deploy path (local and/or cold VPS).

## Deploy surfaces

| Surface | Role |
| --- | --- |
| ProxUI `/root/ctrl-pane` (and worktrees) | Primary development; ports **8123** (main tree / systemd `1helm.service`) and often **8124** (feature worktree) |
| `ssh demo1helm` VPS | Fresh-user sandbox only — cold wipe by default (`scripts/deploy-vps-fresh.sh`) |

Never hand-edit product files only on the VPS to “fix prod.” Fix in git, redeploy.

## Repository settings (expected)

- Private until an explicit open-source decision.
- Delete head branches on merge: **on**
- Squash merge: **on**
- Wiki/projects: off unless needed
- GitHub Actions: typecheck + build + pipeline tests on `main` and PRs
- Branch protection: enable when the GitHub plan allows (private free orgs may block it)

## Policy changes

Governance edits use the same PR path as code. Material policy shifts get a changelog Unreleased note.
