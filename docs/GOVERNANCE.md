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
9. Each supported desktop platform owns one fresh-install verification lane.
   The Apple Silicon host owns macOS signing/notarization and its two files;
   Linux owns the systemd/OCI archive; Windows runs that archive through WSL 2
   and therefore publishes no separate artifact. Each lane checks the installed
   version, startup, and setup endpoint health.

## Versioning

- Semantic versioning on `package.json`.
- **Do not** reuse a published version tag for different bits.
- A desktop release requires one unique version and exact commit, changelog,
  the signed/notarized Mac DMG and updater ZIP, and one complete Linux archive.
  Windows publishes no artifact; it installs the Linux archive through WSL 2.
  The exact files must fresh-install, report the intended version, start, and
  answer health on macOS, Linux, and Windows before publication.
- GitHub Release notes are a first-class product artifact. They must enumerate
  every user-visible fix and feature accepted for that release, using the same
  numbered ledger as the originating request when one exists. A short summary
  can introduce that ledger but cannot replace it.
- Desktop Stable publication uses one draft Release. The same exact files are
  tested on the three computers and that draft becomes public only after every
  fresh-install lane succeeds.
- Every promoted Release includes a digest-qualified machine-readable Stable
  manifest. The site retains the last manifest it validated and must fail closed
  instead of inventing metadata. Tags and Release assets are never rewritten;
  rollback uses a new version or a supported installed-updater rollback policy.
- macOS verification proves the draft DMG and app are signed, notarized,
  stapled, accepted by Gatekeeper, installed at the intended version, launched,
  and healthy on loopback.
- Linux verification installs the draft archive as the real systemd/OCI host,
  checks the intended version, and requires the setup endpoint to answer.
- Windows verification runs as an ordinary Windows 11 user, installs that same
  Linux archive into a clean WSL 2 distribution, checks the intended version,
  and requires `http://localhost:8123/api/setup/status` to answer.

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
