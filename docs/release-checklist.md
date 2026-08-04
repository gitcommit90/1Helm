# Release checklist — 1Helm

Required finish line for a **named** product cut or any change that claims install/deploy readiness.

Process: [release-lifecycle.md](./release-lifecycle.md). Policy: [GOVERNANCE.md](./GOVERNANCE.md).

Docs-only governance can merge without a version bump; still update `CHANGELOG.md` Unreleased when operators should notice.

**Hard gate:** every named desktop release must ship macOS, Linux, and Windows
from the same version and exact source commit. There is no Mac-only fast path.
Do not create the tag or GitHub Release, publish any platform, mark anything
latest, or say “done” until all three lanes pass. If one lane is blocked, pause
the whole release and report it.

**Four application release artifacts, not six.** A complete application release
attaches exactly `1Helm-<version>-arm64.dmg`,
`1Helm-<version>-mac-arm64.zip`, `1Helm-<version>-linux-node.tgz`, and the
complete disconnected-install `1Helm-<version>-linux-node-offline.tgz`. The
Stable manifest also binds the exact immutable channel-image Release by digest,
byte count, architecture, and contract version; unchanged OCI bytes are not
uploaded to the application Release again. **Windows publishes nothing.** There is no
Windows executable, no Windows installer package, no Windows update manifest, no
Electron host on Windows and nothing to code-sign, so no signing status exists to
record or disclose. A Windows host is the Linux host running inside a per-user WSL 2
distribution named `1helm`, installed from `https://1helm.com/install.ps1`,
which the site serves rather than a GitHub Release. Windows is therefore
accepted by behaviour (Section 7) rather than by artifact, and because a Windows
host installs the Linux archive, a Linux artifact that has not passed acceptance
blocks Windows too.

## 1. Prepare

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <branch-name>
```

Implement, update tests, `docs/VISION.md` if needed, and `CHANGELOG.md` Unreleased.

For a multi-item request, copy its numbering into the PR acceptance ledger and
keep one result/evidence line per item. That ledger must survive unchanged into
the GitHub Release notes; do not replace it with a shorter commit summary.

When this branch will be a named release:

```bash
npm version patch --no-git-tag-version   # or minor/major
# Move Unreleased → ## [x.y.z] - YYYY-MM-DD
```

## 2. Test the branch

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm run typecheck
npm run build
npm test
npm run test:onboarding-browser
ANDROID_SDK_ROOT=<sdk> npm run mobile:check
git diff --check
git status --short
```

Run any feature-specific suites (e.g. `npm run test:native` when that script exists on the branch).

## 3. Push and open PR

```bash
git push -u origin HEAD
gh pr create --fill   # use template, including the acceptance ledger
```

## 4. Merge

```bash
gh pr merge --squash --delete-branch
git fetch origin
git switch main && git pull --ff-only origin main
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
MERGED_COMMIT="$(git rev-parse origin/main)"
VERSION="$(node -p "require('./package.json').version")"
```

## 5. Build the complete desktop matrix before tagging

```bash
HEADLESS="dist/1Helm-${VERSION}-linux-node.tgz"
OFFLINE="dist/1Helm-${VERSION}-linux-node-offline.tgz"
DMG="dist/1Helm-${VERSION}-arm64.dmg"
UPDATE_ZIP="dist/1Helm-${VERSION}-mac-arm64.zip"
ANDROID_APK="dist/1Helm-${VERSION}-universal.apk"
RELEASE_NOTES="dist/1Helm-${VERSION}-release-notes.md"

# Build from clean snapshots of the same MERGED_COMMIT on the platform owners:
# macOS arm64: npm ci && npm run typecheck && npm run build && npm test && npm run package:dmg:release
# Linux:       npm ci && npm run typecheck && npm run build && npm test && npm run package:linux
# Windows:     no build. A Windows host installs "$HEADLESS" through the
#              site-served install.ps1; there is no Windows artifact to produce.

for artifact in "$DMG" "$UPDATE_ZIP" "$HEADLESS" "$OFFLINE"; do
  test -s "$artifact"
done
# Author RELEASE_NOTES from docs/release-notes-template.md. It must contain the
# complete numbered acceptance ledger, every desktop artifact digest, and all
# three platform verification records.
test -s "$RELEASE_NOTES"
rg -q '^1\. ' "$RELEASE_NOTES" # multi-item ships must retain a numbered ledger
```

Those four files are the whole application desktop matrix. The digest-addressed
channel image, manifest, and provenance live in their own immutable Release; do
not duplicate the image in the application Release. Do not attach `install.ps1`,
`uninstall.ps1` or the keepalive payload
to the release: they are served from the site, so a release commit that changes
them is not shipped until the site is deployed. Because Windows ships no
executable code of its own, there is no Windows signing identity and no Windows
signature status to record or disclose. Never sign anything with a self-signed
identity.

Only after Sections 6–8 pass for all three desktop platforms, use the manual
GitHub workflow. Direct tag or release commands are not a supported path:

```bash
gh workflow run "Promote exact candidate to Stable" --ref main \
  -f candidate_workflow_run_id="$CANDIDATE_RUN_ID" \
  -f candidate_artifact_id="$CANDIDATE_ARTIFACT_ID" \
  -f version="$VERSION" -f mode=dry-run
```

`--generate-notes` is not an acceptable replacement for the authored notes.
Generated commit/PR lists may be appended as secondary metadata, but the public
body must lead with the complete user-visible acceptance ledger. Before
publication, compare the notes item-by-item with the originating request and
the versioned `CHANGELOG.md` entry.

Review the dry-run's single plain-English report. It must name the candidate
identity, exact dress-rehearsal result, required Mac/Linux/Windows evidence,
eligibility, every publish blocker, and `Stable touched: NO`. Phase 3 honestly
blocks on missing retained Mac bytes and all retained platform acceptance
records until Phase 4 supplies them.

The workflow runs this same owner-facing reporter; for an already downloaded
promotion bundle it can also be invoked locally without any network mutation:

```bash
npm run stable:status -- --bundle <promotion-bundle> --version "$VERSION" \
  --candidate-run "$CANDIDATE_RUN_ID" --candidate-artifact "$CANDIDATE_ARTIFACT_ID"
```

After the owner separately creates and protects the GitHub Environment
**Stable publication**, sets its required reviewer, and adds the environment
secret `STABLE_PUBLICATION_ENABLED=PROTECTED STABLE ENVIRONMENT ENABLED`, an
eligible candidate may be dispatched again with `mode=publish` and the exact
confirmation string printed by the dry run. Those settings are not created by
this repository or by the workflow. The publish job refuses an existing tag or
release and uploads only the verified DMG, updater ZIP, online Linux TGZ,
offline Linux TGZ, and Stable manifest. It creates or exactly reuses the
separate immutable channel-image Release and never rebuilds.

### Mobile release gates

- Build Android only with the retained external production key and properties
  file. Back up that key independently, never commit either file or any
  password, and never replace the key: Android updates require the same
  certificate forever.
- Verify the universal APK with `zipalign`, `apksigner`, package/version
  inspection, release-certificate SHA-256, and an install/update smoke on a
  device or emulator. Upload the APK SHA-256 and certificate fingerprint in
  the release evidence.
- Build iOS with full Xcode from the exact merged source, archive for generic
  iOS using automatic App Store signing, validate the archive/IPA, then upload
  it to App Store Connect or TestFlight. A public GitHub IPA is not a substitute
  for Apple distribution. Record the App Store build number and validation or
  upload result.

## 6. Local verify

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm run build
CTRL_DATA_DIR="$(mktemp -d)" PORT=18123 node --disable-warning=ExperimentalWarning src/server/index.ts &
# wait for listen
curl -fsS "http://127.0.0.1:18123/api/setup/status"
# stop process; rm data dir
```

Expect first-run / needs_setup on empty data dir.

## 7. Host updater acceptance — all three lanes are required

- **macOS:** verify the native ZIP was created only after the app was notarized
  and stapled; extract it and repeat strict signature, ticket, and Gatekeeper
  checks. Confirm the staged/public Electron feed selects that ZIP for the
  prior Mac version and no update for the new version.
- On the same retained Apple Silicon release host used for the clean build,
  install the **publicly downloaded** DMG/update with preserved Application
  Support, then verify the new version, loopback health, resident state, and
  data-directory identity.
- **Linux:** verify the exact online and offline `npm run package:linux`
  archives, their source commit and SHA-256 identities, and the split image
  contract, then stage equivalent release metadata. In a disposable systemd
  host running the prior release, invoke the Captain host-update action,
  observe checking/downloading/installing/restarting, verify the new version
  and `/var/lib/1helm-oci-v1` identity, and exercise health-failure rollback.
- **Windows:** accepted by behaviour on real Windows 11 x64 hardware, not by
  artifact. There is nothing to sign and no update feed to stage. Prove every
  one of these:
  1. **Clean install from the one-liner.** In an ordinary, **non-elevated**
     PowerShell window, run `irm https://1helm.com/install.ps1 | iex`. Exactly
     **one** UAC prompt appears, and only the Windows optional features
     (`Microsoft-Windows-Subsystem-Linux`, `VirtualMachinePlatform`) and
     Microsoft's own WSL package run elevated. Everything else — importing the
     distribution, installing 1Helm inside it, registering the keepalive — runs
     as the signed-in user, because WSL state is per-user.
  2. **Restart and resume.** The first run reports the required restart and
     exits without a false failure. After the restart, re-running the identical
     command as the **same** signed-in Windows user resumes and completes.
  3. **Keepalive survives a reboot.** The keepalive is registered as that user's
     scheduled task, starts again at sign-in after a reboot, and holds the
     distribution up with `1helm.service` active.
  4. **Browser reaches the host.** A browser on that PC reaches
     `http://localhost:8123` and completes onboarding.
  5. **Prior-version update preserves the data root.** Update from the previous
     release through the in-distribution Linux updater and confirm the new
     version, loopback health, and a retained data root under
     `/var/lib/1helm-oci-v1`.
  6. **Removal.** `irm https://1helm.com/uninstall.ps1 | iex` removes the
     keepalive, the `1helm` distribution and `C:\1helm`. It must never call
     `wsl --shutdown` and must never unregister a distribution whose name is not
     an exact match for the target; other distributions on the PC are untouched.
- Before publication, compare each uploaded GitHub asset digest with the local
  verified digest and assert the application Release contains the complete
  **four-file** desktop matrix: `1Helm-<version>-arm64.dmg`,
  `1Helm-<version>-mac-arm64.zip`, `1Helm-<version>-linux-node.tgz`, and
  `1Helm-<version>-linux-node-offline.tgz`; also prove its Stable manifest binds
  the exact separate immutable channel-image Release. A missing asset is a
  release blocker, not “not applicable.” Windows contributes no
  asset, so an absent Windows file is correct — an absent Windows **behavioural
  record** is a blocker.

## 8. Clean deployment verify (when shipping install path)

```bash
# use the maintainer's host-local deployment procedure
# confirm the clean endpoint reports needs_setup: true
# walk the wizard once if this cut changes onboarding
```

## 9. Evidence block

```text
Version:        <package version>
Merged commit:  <origin/main SHA>
Tag/Release:    <if any>
Release notes:  complete numbered acceptance ledger reviewed against request
Local setup:    needs_setup verified on clean CTRL_DATA_DIR
Clean deploy:   <pass / skipped + reason>
Mac host update:<public artifact installed on release host + state preserved>
Linux update:  <old → new, digest + health + state preserved>
Windows:       <install.ps1 one-liner, single UAC prompt, restart + resume,
                keepalive survived reboot, localhost:8123 onboarding,
                old → new update with /var/lib/1helm-oci-v1 retained,
                uninstall.ps1 removal>
Desktop matrix:<DMG + Mac ZIP + online Linux TGZ + offline Linux TGZ, all same version/commit; exact shared image manifest; Windows publishes none>
Android:      <public APK digest, certificate fingerprint, install/update smoke>
iOS:          <App Store build number + validation/upload result>
CI:             Actions green on main
```

## 10. Publication rollback

Never rewrite, move, delete for reuse, or silently replace a published tag or
asset. Roll back by promoting a previously verified immutable artifact set
through a new semantic version after all current gates pass, or through a
documented supported updater rollback that restores an already installed prior
release. If the annotated tag push succeeds but Release creation fails, that
version is permanently unavailable for reuse; fix the issue and choose a new
version. The website retains the last digest-validated Stable manifest until a
complete later promotion succeeds.
