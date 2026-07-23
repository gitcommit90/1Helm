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
| [CHANGELOG.md](./CHANGELOG.md) | User/operator-facing history |
| [docs/VISION.md](./docs/VISION.md) | Product decisions and build record |

### Every change that lands on `main`

1. Branch from current `origin/main`.
2. `npm run typecheck`, `npm run build`, `npm test`.
3. Update `CHANGELOG.md` Unreleased for user-visible work.
4. Record durable decisions in `docs/VISION.md`.
5. Use the merge method selected by the maintainer; delete the head branch.
6. For a named ship: version bump + [release-checklist.md](./docs/release-checklist.md).

### Security

Do not commit API keys, OAuth tokens, or live `data/` directories. Report
vulnerabilities through the private advisory path in [SECURITY.md](./SECURITY.md),
not a public issue.
