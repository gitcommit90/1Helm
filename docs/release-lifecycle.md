# Release lifecycle — 1Helm

Process contract from intent to verified deploy. Commands: [release-checklist.md](./release-checklist.md).

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
  tag · signed artifact · release notes · deploy target(s)
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

Use the PR template: summary, type, changelog bullets, verification checklist.

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
5. Publish the verified artifact and release notes through a GitHub Release.

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
| Named release | Version, changelog, exact tag, verified public artifact, and clean installation |

If deploy verification was skipped, say so. Do not call a ship “done.”
