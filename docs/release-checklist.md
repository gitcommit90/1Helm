# Release checklist — 1Helm

Required finish line for a **named** product cut or any change that claims install/deploy readiness.

Process: [release-lifecycle.md](./release-lifecycle.md). Policy: [GOVERNANCE.md](./GOVERNANCE.md).

Docs-only governance can merge without a version bump; still update `CHANGELOG.md` Unreleased when operators should notice.

**Hard gate:** every named desktop release must ship macOS, Linux, and Windows
from the same version and exact source commit. There is no Mac-only fast path.
Do not create the tag or GitHub Release, publish any platform, mark anything
latest, or say “done” until all three lanes pass. If one lane is blocked, pause
the whole release and report it.

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
DMG="dist/1Helm-${VERSION}-arm64.dmg"
UPDATE_ZIP="dist/1Helm-${VERSION}-mac-arm64.zip"
WINDOWS_SETUP="dist/1Helm-${VERSION}-windows-x64-setup.exe"
WINDOWS_NUPKG="dist/1Helm-${VERSION}-full.nupkg"
WINDOWS_RELEASES="dist/RELEASES"
ANDROID_APK="dist/1Helm-${VERSION}-universal.apk"
RELEASE_NOTES="dist/1Helm-${VERSION}-release-notes.md"

# Build from clean snapshots of the same MERGED_COMMIT on the platform owners:
# macOS arm64: npm ci && npm run typecheck && npm run build && npm test && npm run package:dmg:release
# Linux:       npm ci && npm run typecheck && npm run build && npm test && npm run package:linux
# Windows x64: npm ci && npm run typecheck && npm run build && npm test && npm run package:windows:release

for artifact in "$DMG" "$UPDATE_ZIP" "$HEADLESS" "$WINDOWS_SETUP" "$WINDOWS_NUPKG" "$WINDOWS_RELEASES"; do
  test -s "$artifact"
done
# Author RELEASE_NOTES from docs/release-notes-template.md. It must contain the
# complete numbered acceptance ledger, every desktop artifact digest, and all
# three platform verification records.
test -s "$RELEASE_NOTES"
rg -q '^1\. ' "$RELEASE_NOTES" # multi-item ships must retain a numbered ledger
```

The Windows `.nupkg` basename must exactly match the entry inside `RELEASES`.
All Windows executable code and Setup must pass Authenticode verification. Do
not use unsigned output from `npm run package:windows`; public candidates must
come from the fail-closed `package:windows:release` command on Windows x64.

Only after Sections 6–8 pass for all three desktop platforms:

```bash
git tag -a "v${VERSION}" "$MERGED_COMMIT" -m "1Helm ${VERSION}"
git push origin "refs/tags/v${VERSION}"
gh release create "v${VERSION}" \
  "$DMG" "$UPDATE_ZIP" "$HEADLESS" \
  "$WINDOWS_SETUP" "$WINDOWS_NUPKG" "$WINDOWS_RELEASES" \
  --title "1Helm ${VERSION}" --notes-file "$RELEASE_NOTES" --draft
# Upload mobile artifacts through their applicable distribution lane; their
# timing never permits a partial desktop release.
# review notes, then:
gh release edit "v${VERSION}" --draft=false
```

`--generate-notes` is not an acceptable replacement for the authored notes.
Generated commit/PR lists may be appended as secondary metadata, but the public
body must lead with the complete user-visible acceptance ledger. Before
publication, compare the notes item-by-item with the originating request and
the versioned `CHANGELOG.md` entry.

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
- **Linux:** verify the exact `npm run package:linux` archive, its source commit
  and SHA-256, then stage equivalent release metadata. In a disposable systemd
  host running the prior release, invoke the Captain host-update action,
  observe checking/downloading/installing/restarting, verify the new version
  and `/var/lib/1helm` identity, and exercise health-failure rollback.
- **Windows:** on Windows 11 x64, verify Authenticode on Setup, the packaged app,
  and its executable code; confirm `.nupkg` and `RELEASES` consistency; clean
  install Setup; exercise the real WSL 2 channel lifecycle; then expose staged
  Squirrel metadata to the prior public version and prove download,
  verification, restart installation, new version, loopback health, WSL state,
  and app-data preservation.
- Before publication, compare each uploaded GitHub asset digest with the local
  verified digest and assert the release contains the complete six-file
  desktop matrix. A missing asset is a release blocker, not “not applicable.”

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
Windows update:<old → new, Authenticode + Squirrel feed + WSL/app state preserved>
Desktop matrix:<DMG + Mac ZIP + Linux TGZ + Windows Setup + nupkg + RELEASES, all same version/commit>
Android:      <public APK digest, certificate fingerprint, install/update smoke>
iOS:          <App Store build number + validation/upload result>
CI:             Actions green on main
```
