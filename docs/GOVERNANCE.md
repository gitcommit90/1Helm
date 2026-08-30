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
| Maintainer | Repository owner (`gitcommit90`) | Merge to `main`, maintain the product website, tags/releases, policy |
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
9. Release evidence is GitHub-hosted and bound to exact product identity and
   retained producer run IDs. Linux owns the systemd/OCI archive; the hosted Mac
   stage owns signing, notarization, stapling, DMG, and updater ZIP; Windows
   consumes the Linux archive and publishes no separate artifact. Record hosted
   Windows evidence or an explicit hosted-run waiver—never silently substitute
   Captain-owned hardware.

## Versioning

- Semantic versioning on `package.json`.
- **Do not** reuse a published version tag for different bits.
- A desktop release requires one unique version and exact product commit,
  changelog, the signed/notarized Mac DMG and updater ZIP, and one complete Linux
  archive. Windows publishes no artifact. GitHub-hosted build and acceptance
  evidence must bind the exact files to the product commit; Windows carries
  hosted evidence or the explicit hosted-run waiver recorded at assembly.
- GitHub Release notes are a first-class product artifact. They must enumerate
  every user-visible fix and feature accepted for that release, using the same
  numbered ledger as the originating request when one exists. A short summary
  can introduce that ledger but cannot replace it.
- Desktop Stable publication uses one draft Release assembled from exact
  retained hosted artifacts after platform-selective acceptance succeeds.
  Windows evidence or its explicit hosted-run waiver is recorded in the draft.
- Every promoted Release includes a digest-qualified machine-readable Stable
  manifest. The site retains the last manifest it validated and must fail closed
  instead of inventing metadata. Tags and Release assets are never rewritten;
  rollback uses a new version or a supported installed-updater rollback policy.
- The hosted macOS build and acceptance stages prove the exact DMG and app are
  signed, notarized, stapled, Apple Accepted, digest-matched, and bound to the
  product commit.
- Hosted Linux build and acceptance prove the complete archive, digest, source
  identity, expected release root, server entrypoint, and native terminal addon.
- Windows consumes the accepted Linux archive and has no public asset of its own.
  Until a dedicated hosted Windows lane exists, assembly records an explicit
  hosted-run waiver rather than reaching into Captain-owned hardware.

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
