# Contributing — 1Helm

## Status

This repository is **private** and maintainer-operated. There is no external contribution process yet.

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
5. Prefer squash merge; delete the head branch.
6. For a named ship: version bump + [release-checklist.md](./docs/release-checklist.md).

### Local layout

- GitHub: `gitcommit90/1Helm`
- ProxUI historical path: `/root/ctrl-pane` (worktrees under `.claude/worktrees/`)
- Prefer `git clone … 1Helm` for new checkouts so folder name matches the product.

### Demo VPS

Cold first-run by default. See `CLAUDE.md` and `scripts/deploy-vps-fresh.sh`. Never leave production secrets in README.

### Security

Do not commit API keys, OAuth tokens, or live `data/` directories. Prefer private maintainer channels for sensitive reports while the repo is private.
