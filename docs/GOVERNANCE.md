# Project governance — 1Helm

1Helm is an open-source, maintainer-led product repository. This document
defines how changes land and how release evidence is preserved.

## Product names

| Name | Meaning |
| --- | --- |
| **1Helm** | Product and GitHub repository (`1Helm`). The installed host / control plane. |

npm package name remains `1helm` (lowercase).

## Authority

| Role | Who | Authority |
| --- | --- | --- |
| Maintainer | Repository owner (`gitcommit90`) | Merge to `main`, deploy demo VPS, tags/releases, policy |
| Agents / automation | Resident tools and CI | Branch, test, open PRs, and report verifiable evidence within granted authority |
| Contributors | GitHub contributors | Issues and focused pull requests under the repository policy |

## Source of truth

| Artifact | Location |
| --- | --- |
| Product code | `main` on `https://github.com/gitcommit90/1Helm` |
| Living product decisions | `docs/VISION.md` |
| Native agent-workspace spec (when present on branch) | `SPEC.md` |
| User-facing history | `CHANGELOG.md` + GitHub Releases (when used) |
| Ship / deploy procedure | `docs/release-lifecycle.md`, `docs/release-checklist.md` |
Host-local machine aliases, credentials, signing setup, live data paths, and
operator-only deployment procedures are not repository artifacts.

## Branch model

- **Default branch:** `main` only.
- **Work branches:** short-lived:
  - `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `refactor/<slug>`
  - Existing `worktree-*` names are legacy; prefer the prefixes above for new work.
- **Merge method:** squash preferred for features; merge commits allowed when intentional.
- **Delete head branches on merge.**
- No force-push to `main`.

Large vertical slices may sit as **draft PRs** until verification is complete.
Draft does not mean abandoned: update `CHANGELOG.md` and the public product
contract as the slice hardens.

## Quality bar (every change to `main`)

1. Clear problem/outcome in PR body (or commit body for tiny maintainer docs).
2. `npm run typecheck` and `npm run build` green.
3. Relevant automated tests green (`npm test` = pipeline suite on `main`; feature branches add their suites when introduced).
4. `git diff --check` clean.
5. No secrets, operator hosts/paths, real provider keys, or `data/` SQLite dumps.
6. Significant product decisions recorded in `docs/VISION.md`.
7. User-visible changes noted under `CHANGELOG.md` → `## [Unreleased]`.
8. A multi-item user request retains a numbered acceptance ledger in the pull
   request and GitHub Release. Do not collapse completed items into a generic
   summary or rely on generated commit notes as the user-facing release record.
9. Each supported desktop platform owns its native artifact and installed-app
   verification lane. The retained Apple Silicon host owns macOS signing and
   notarization; Linux owns the systemd/OCI artifact and updater acceptance;
   Windows 11 x64 owns Squirrel and shared-WSL OCI acceptance. Authenticode is optional
   until 1Helm adopts a trusted Windows signing identity; unsigned artifacts
   must be identified honestly, but their signature status is not a release
   blocker.

## Versioning

- Semantic versioning on `package.json`.
- **Do not** reuse a published version tag for different bits.
- A desktop release requires one unique version and exact commit, changelog,
  complete Mac + Linux + Windows artifact matrix, and clean-install plus
  prior-to-new update evidence on every platform. Partial platform releases
  under the shared product version are prohibited. If one platform is blocked,
  the entire tag/publication waits.
- GitHub Release notes are a first-class product artifact. They must enumerate
  every user-visible fix and feature accepted for that release, using the same
  numbered ledger as the originating request when one exists. A short summary
  can introduce that ledger but cannot replace it.
- macOS verification must use the exact publicly downloaded artifact, preserve
  Application Support, and prove signature/ticket/Gatekeeper, launch, version,
  loopback behavior, and retained state on the retained release host.
- Linux verification must use the digest-qualified release archive and prove a
  real systemd update, health-failure rollback, and retained
  `/var/lib/1helm-oci-v1`.
- Windows verification must prove the Setup/Squirrel signature status, clean
  install, old-to-new update, loopback health, WSL lifecycle, and retained
  application data on Windows 11 x64. Do not substitute a self-signed
  certificate or block an otherwise accepted release solely because the
  artifacts are honestly disclosed as unsigned.

Never hand-edit only a deployment target to fix the product. Fix in git,
review, merge, and redeploy the exact source commit.

## Repository settings (expected)

- Delete head branches on merge: **on**
- Squash merge: **on**
- Wiki/projects: off unless needed
- GitHub Actions: typecheck + build + pipeline tests on `main` and PRs
- Required CI status checks protect `main`.

## Policy changes

Governance edits use the same PR path as code. Material policy shifts get a changelog Unreleased note.
