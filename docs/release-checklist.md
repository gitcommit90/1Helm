# Release checklist — 1Helm

Required finish line for a **named** product cut or any change that claims install/deploy readiness.

Process: [release-lifecycle.md](./release-lifecycle.md). Policy: [GOVERNANCE.md](./GOVERNANCE.md).

Docs-only governance can merge without a version bump; still update `CHANGELOG.md` Unreleased when operators should notice.

**Do not say “done” for a ship until applicable checks pass.**

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

## 5. Tag (optional but preferred for named cuts)

```bash
git tag -a "v${VERSION}" "$MERGED_COMMIT" -m "1Helm ${VERSION}"
git push origin "refs/tags/v${VERSION}"
HEADLESS="dist/1Helm-${VERSION}-linux-node.tgz"
DMG="dist/1Helm-${VERSION}-arm64.dmg"
UPDATE_ZIP="dist/1Helm-${VERSION}-mac-arm64.zip"
ANDROID_APK="dist/1Helm-${VERSION}-universal.apk"
RELEASE_NOTES="dist/1Helm-${VERSION}-release-notes.md"
# Author RELEASE_NOTES from docs/release-notes-template.md. It must contain the
# complete numbered acceptance ledger, artifact digests, and verification.
test -s "$RELEASE_NOTES"
rg -q '^1\. ' "$RELEASE_NOTES" # multi-item ships must retain a numbered ledger
gh release create "v${VERSION}" "$DMG" "$UPDATE_ZIP" "$HEADLESS" "$ANDROID_APK" --title "1Helm ${VERSION}" --notes-file "$RELEASE_NOTES" --draft
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

## 7. Host updater acceptance

- Verify the native ZIP was created only after the app was notarized and stapled; extract it and repeat strict signature, ticket, and Gatekeeper checks.
- Confirm the public Electron feed selects that ZIP for the prior Mac version and returns no update for the new version.
- On the same retained Apple Silicon release host used for the clean build,
  install the **publicly downloaded** DMG/update with preserved Application
  Support, then verify the new version, loopback health, resident state, and
  data-directory identity.
- Upload the exact `npm run package:linux` artifact and require GitHub's recorded `sha256:` digest before publication.
- In a disposable systemd host running the prior release, invoke the same Captain host-update action, observe checking/downloading/installing/restarting, verify the new version and `/var/lib/1helm` identity, and exercise rollback with an intentionally unhealthy disposable fixture.

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
Android:      <public APK digest, certificate fingerprint, install/update smoke>
iOS:          <App Store build number + validation/upload result>
CI:             Actions green on main
```
