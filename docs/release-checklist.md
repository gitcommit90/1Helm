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
git diff --check
git status --short
```

Run any feature-specific suites (e.g. `npm run test:native` when that script exists on the branch).

## 3. Push and open PR

```bash
git push -u origin HEAD
gh pr create --fill   # use template
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
gh release create "v${VERSION}" "$DMG" "$UPDATE_ZIP" "$HEADLESS" --title "1Helm ${VERSION}" --generate-notes --draft
# review notes, then:
gh release edit "v${VERSION}" --draft=false
```

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
- On an independent Mac with preserved Application Support, use Profile to make the host download the update, wait for **Restart & install**, install it, and verify the new version, loopback health, resident state, and data-directory identity.
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
Local setup:    needs_setup verified on clean CTRL_DATA_DIR
Clean deploy:   <pass / skipped + reason>
Mac host update:<old → new, updater feed + state preserved>
Linux update:  <old → new, digest + health + state preserved>
CI:             Actions green on main
```
