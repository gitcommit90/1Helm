# Release lifecycle — 1Helm

Process contract from intent to verified deploy. Commands: [release-checklist.md](./release-checklist.md).

## Immutable desktop release rule

1Helm has one synchronized desktop-host release train. A named desktop release
is one version, one exact source commit, and one GitHub Release containing
exactly these **four** application desktop artifacts:

- `1Helm-<version>-arm64.dmg` — Developer ID signed, Apple-notarized and stapled
  Apple Silicon macOS DMG;
- `1Helm-<version>-mac-arm64.zip` — the notarized/stapled native updater ZIP;
- `1Helm-<version>-linux-node.tgz` — the digest-qualified Linux host archive.
- `1Helm-<version>-linux-node-offline.tgz` — the complete disconnected-install
  bundle containing the exact referenced channel image.

Linux and Windows manifests also bind the immutable digest-addressed channel
image by SHA-256, byte count, architecture, and contract version. That image has
its own retained candidate/provenance and immutable Release and is not uploaded
again when an application release references unchanged bytes.

**Windows publishes nothing.** There is no Windows executable, no Windows
installer package, no Windows update manifest, no Electron host on Windows and
nothing to code-sign, so no signing status exists to record or disclose. A
Windows host is the Linux host
running inside a per-user WSL 2 distribution named `1helm`, installed from
`https://1helm.com/install.ps1`, with the browser as its interface at
`http://localhost:8123`. `install.ps1`, `uninstall.ps1` and the keepalive payload
are served from the site rather than attached to a release, so a release commit
that changes them is not shipped until the site is deployed.

All three platform lanes — macOS, Linux, and Windows — are mandatory even when a
change appears platform-specific, because the application source and updater
version advance together. Windows is accepted by **behaviour** rather than by
artifact, and since a Windows host installs the Linux archive, a Linux artifact
that has not passed acceptance blocks Windows too. Do not tag, create or publish
a GitHub Release, mark it latest, or update public download/feed metadata until
every lane is built where it has an artifact, digest-verified, installed, and
update-tested from the previous release. If any lane is unavailable or fails,
pause the whole release. Never publish a Mac-only or otherwise partial set under
the product version.

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
  Mac DMG + ZIP · Linux host archive  (Windows publishes no artifact)
       │
       v
  clean install + prior→new updater acceptance on Mac, Linux, and Windows
  (Windows via the site-served install.ps1 into WSL 2)
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
6. Before creating the tag or GitHub Release, finish the complete split-artifact
   desktop matrix from the exact merged commit: verified macOS DMG
   (`1Helm-<version>-arm64.dmg`), macOS updater ZIP
   (`1Helm-<version>-mac-arm64.zip`), and Linux host archive
   (`1Helm-<version>-linux-node.tgz`) plus its complete offline bundle and exact
   shared-image contract. Windows produces no artifact and has no
   signing status to record; complete its behavioural acceptance instead
   (`docs/release-checklist.md` Section 7).
7. Publish those desktop artifacts and complete release notes together through
   the manual `Promote exact candidate to Stable` workflow. Supply the exact
   retained candidate workflow run ID, immutable artifact ID, and intended
   version; run its default dry-run first. Never rebuild in promotion, publish
   a subset, or attach a platform later to a
   version already described as complete. Include a directly distributed
   signed Android APK when applicable. Submit iOS through App Store Connect
   rather than publishing an installable IPA as a generic download. Do not use
   GitHub's generated notes as the sole or primary body.

### Stable promotion gate

The manual workflow is the only supported desktop publication path. Its
read-only verification job checks that the exact candidate commit remains on
current `main`; successful
CI and candidate workflow identities; Linux attestation, archive digest, and
embedded commit; private dress-rehearsal health for that digest; all three
retained artifact records; and retained macOS, Linux, and Windows acceptance.
The trusted-main candidate workflow now retains the complete Phase 4 matrix:
hosted Linux candidate and acceptance, signed/notarized Mac bytes and Apple
Silicon acceptance, and Windows 11 behavior acceptance bound to the Linux TGZ.
It assembles the Phase 3 promotion bundle only when every exact byte and record
passes. Missing credentials, disabled/offline runners, failed checks, or absent
evidence appear in the retained per-platform status as blockers; they never
become skipped success. Provisioning and recovery are documented in
[phase4-platform-acceptance.md](./phase4-platform-acceptance.md).

Publication additionally requires `mode=publish`, the exact identity-bound
confirmation printed by the dry run, and owner approval in the protected
GitHub Environment named **Stable publication**. That environment must also
contain `STABLE_PUBLICATION_ENABLED` with the documented enablement value. It is
intentionally absent until the owner separately creates and protects the
environment. The publish job rechecks that the tag and release do not exist and
that the candidate remains on `origin/main`. It creates an annotated tag and one GitHub
Release from the already verified bytes; there is no package/build command.

The Release includes `1Helm-<version>-stable.json`. The site accepts GitHub
metadata only when that manifest asset's digest and the complete Release matrix
match. It retains the last validated manifest in website state, so GitHub
unavailability does not move Stable backward or cause invented metadata. The
bootstrap manifest in `site/stable-manifest.json` represents the last release
before this mechanism and is not edited per release.

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
| Named desktop release | One version/commit, changelog, full numbered notes, exact tag, the complete four-artifact application matrix (`1Helm-<version>-arm64.dmg`, `1Helm-<version>-mac-arm64.zip`, online `1Helm-<version>-linux-node.tgz`, offline `1Helm-<version>-linux-node-offline.tgz`), an exact immutable shared-image manifest/provenance, and clean installation evidence on macOS, Linux, and Windows |
| Mac host update | Published notarized/stapled updater ZIP feed, installed-old-to-new acceptance, and preserved Application Support |
| Linux host update | Digest-qualified artifact, real systemd install/update, health check/rollback, and preserved `/var/lib/1helm-oci-v1` |
| Windows host | No artifact and no signing status. Install from `https://1helm.com/install.ps1` in a non-elevated PowerShell window with a single UAC prompt, the mid-install restart and resume, a keepalive surviving a reboot, `http://localhost:8123` reached from a browser, a prior-version update through the in-distribution Linux updater with `/var/lib/1helm-oci-v1` retained, and removal via `uninstall.ps1` |

If any platform artifact or acceptance run is skipped, the release is paused,
not partially shipped. Say exactly what is missing and do not call it “done.”

## 9. Rollback after publication

Tags and assets are immutable. Never delete, move, reuse, or force-update a tag,
and never silently replace an asset. To restore older behavior, select a
previously verified immutable artifact set and promote it under a **new semantic
version** after the same complete verification, or use an explicitly supported
host-updater rollback policy that preserves the installed prior release. If
publication fails after its annotated tag is pushed but before the complete
Release exists, that version is stranded: do not reuse it; correct the cause and
promote a new version. The website continues serving its last validated Stable
manifest until a complete new promotion validates.
