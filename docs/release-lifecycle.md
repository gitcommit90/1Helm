# Release lifecycle — 1Helm

Process contract from intent to verified deploy. Commands: [release-checklist.md](./release-checklist.md).

## Immutable desktop release rule

1Helm has one synchronized desktop-host release train. A named desktop release
is one version, one exact source commit, and one GitHub Release containing all
of the following:

- Apple Silicon macOS DMG and native updater ZIP;
- Linux host archive;
- Windows x64 Setup executable, full Squirrel package, and `RELEASES` manifest.

All three platform lanes are mandatory even when a change appears
platform-specific, because the application source and updater version advance
together. Do not tag, create or publish a GitHub Release, mark it latest, or
update public download/feed metadata until every lane is built, signed where
required, digest-verified, installed, and update-tested from the previous
release. If any lane is unavailable or fails, pause the whole release. Never
publish a Mac-only or otherwise partial set under the product version.

Mobile distribution may have additional store/signing timing, but it never
weakens the Mac + Linux + Windows desktop invariant.

```text
  intent / issue
       │
       v
  branch from origin/main
       │
       v
  implement + tests + VISION (if decision) + CHANGELOG Unreleased
       │
       v
  typecheck · build · npm test · PR
       │
       v
  squash/merge · delete branch · CI green on main
       │
       v
  version bump on the release branch
       │
       v
  exact-commit candidates on every desktop lane
       │
       v
  Mac DMG + ZIP · Linux host archive · Windows Setup + nupkg + RELEASES
       │
       v
  clean install + prior→new updater acceptance on Mac, Linux, and Windows
       │
       v
  full numbered notes · tag · one complete GitHub Release
                         + mobile artifacts when applicable
       │
       v
  verify (local health + clean install + public artifact)
       │
       v
  done (evidence)
```

## 1. Plan

- Prefer issues for user-visible work.
- One PR ≈ one concern. Do not mix unrelated refactors into a hotfix.
- If the change is product direction, update `docs/VISION.md` in the same PR.

## 2. Branch and implement

```bash
git fetch origin
git switch main && git pull --ff-only origin main
git switch -c feat/short-slug
```

- Work in the tree that matches the process under test (verify port → cwd).
- Preserve dirty unrelated worktrees; use a clean worktree for release/governance if needed.

## 3. Verify before review

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci   # or npm install
npm run typecheck
npm run build
npm test
git diff --check
```

Feature branches that introduce `test/native-world.mjs` (or similar) must run those suites before merge.

## 4. Pull request

Use the PR template: summary, type, changelog bullets, numbered acceptance
ledger, and verification checklist. For a multi-item request, preserve its
numbering and record one concrete outcome per item. The ledger is the source
for the GitHub Release; a commit title or generated summary is not a substitute.

Draft PRs are allowed for long slices; mark ready only when the quality bar is met.

## 5. Merge

- Prefer squash into `main`.
- Delete the head branch.
- Confirm Actions on `main`.

## 6. Version and changelog for a named cut

1. Move Unreleased notes into `## [x.y.z] - YYYY-MM-DD`.
2. `npm version patch|minor|major --no-git-tag-version` (or edit `package.json`).
3. Commit the versioned source on the release branch before merge.
4. After merge, tag the exact verified `main` commit and push the tag.
5. Author release notes from the PR acceptance ledger using
   [release-notes-template.md](./release-notes-template.md). Every accepted
   user-visible item must appear once, with the same numbering as the request
   when available. Include additional fixes, artifacts/digests, and verification
   evidence in their own sections.
6. Before creating the tag or GitHub Release, finish the complete desktop
   matrix from the exact merged commit: verified macOS DMG + updater ZIP,
   Linux host archive, and Windows Setup + full `.nupkg` + literal `RELEASES`
   manifest. Record whether Windows artifacts are trusted-signed or unsigned;
   unsigned is accepted until 1Helm adopts a trusted Windows signing identity.
7. Publish those desktop artifacts and complete release notes together through
   one GitHub Release. Never publish a subset or attach a platform later to a
   version already described as complete. Include a directly distributed
   signed Android APK when applicable. Submit iOS through App Store Connect
   rather than publishing an installable IPA as a generic download. Do not use
   GitHub's generated notes as the sole or primary body.

## 7. Deploy

### Local service

- Build in the target tree.
- Preserve the configured `CTRL_DATA_DIR`, restart the intended exact service,
  and verify loopback health after startup.

### Public sandbox

```bash
# operator-specific deployment commands live outside the public repository
```

Confirm `/api/setup/status` on the intended sandbox without reusing production
workspace state.

## 8. What “done” means

| Claim | Evidence |
| --- | --- |
| Code landed | On `origin/main`, CI green |
| Behavior fixed | Tests + manual/API check |
| Install path still works | Clean `CTRL_DATA_DIR` boot through the wizard plus platform acceptance |
| Named desktop release | One version/commit, changelog, full numbered notes, exact tag, complete Mac + Linux + Windows asset matrix, and clean installation evidence for all three |
| Mac host update | Published notarized/stapled updater ZIP feed, installed-old-to-new acceptance, and preserved Application Support |
| Linux host update | Digest-qualified artifact, real systemd old-to-new update, health check/rollback, and preserved `/var/lib/1helm` |
| Windows host update | Setup + `.nupkg` + `RELEASES` with disclosed signature status, real Squirrel old-to-new update, WSL lifecycle smoke, and preserved app data |

If any platform artifact or acceptance run is skipped, the release is paused,
not partially shipped. Say exactly what is missing and do not call it “done.”
