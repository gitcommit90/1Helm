# Contributing — 1Helm

## Status

This repository is open source and maintainer-led. Focused bug fixes, tests,
documentation repairs, and proposals aligned with the product contract are
welcome through GitHub issues and pull requests.

## Maintainers

| Doc | Purpose |
| --- | --- |
| [docs/GOVERNANCE.md](./docs/GOVERNANCE.md) | Authority, branches, quality bar |
| [docs/release-lifecycle.md](./docs/release-lifecycle.md) | Idea → PR → deploy |
| [docs/release-checklist.md](./docs/release-checklist.md) | Ship verification commands |
| [docs/release-notes-template.md](./docs/release-notes-template.md) | Complete public release record |
| [CHANGELOG.md](./CHANGELOG.md) | User/operator-facing history |
| [docs/VISION.md](./docs/VISION.md) | Product decisions and build record |

## Developer Certificate of Origin (DCO)

1Helm uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
By contributing, you certify that you have the right to submit the work under
the project's license and agree that the contribution and its sign-off are
publicly recorded.

Every commit in a pull request must include a `Signed-off-by` trailer using the
contributor's real name and an email address they control:

```text
Signed-off-by: Your Name <you@example.com>
```

Git can add the trailer automatically:

```bash
git commit -s -m "Describe the change"
```

If a commit is already made, amend it with `git commit --amend -s` and update
the pull-request branch. A sign-off is a DCO certification, not a copyright
assignment; contributors retain copyright in contributions they author.

### Every change that lands on `main`

1. Branch from current `origin/main`.
2. Sign off every commit with `git commit -s`.
3. `npm run typecheck`, `npm run build`, `npm test`.
4. Update `CHANGELOG.md` Unreleased for user-visible work.
5. Record durable decisions in `docs/VISION.md`.
6. Use the merge method selected by the maintainer; delete the head branch.
7. For a named ship: version bump + [release-checklist.md](./docs/release-checklist.md).
8. For a multi-item ship, preserve the numbered acceptance ledger in the PR
   and GitHub Release; generated notes are not a replacement.

### Security

Do not commit API keys, OAuth tokens, or live `data/` directories. Report
vulnerabilities through the private advisory path in [SECURITY.md](./SECURITY.md),
not a public issue.
