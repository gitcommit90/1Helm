# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Formalized project governance, release lifecycle, PR expectations, CI, and repository hygiene for the private `gitcommit90/1Helm` repository.

### Added

- Keep a Changelog narrative, CONTRIBUTING, CODEOWNERS, GitHub Actions (typecheck, build, pipeline tests).

## [1.0.0] - 2026-07-10

### Added

- First-run workspace setup wizard, owner account, provider connect, optional terminals, `#main` + `@skipper`.
- Chat (channels, DMs, threads), bots/providers, embedded terminal agent path.
- Visual identity overhaul and cold VPS deploy tooling (`scripts/deploy-vps-fresh.sh`).
- HTTP asset / CSP fix for non-HTTPS demos (PR #1).

### Notes

- Native **1Herd** channel-agent workspace (SPEC.md slice) is developed on branch `worktree-1herd-native-spec` (draft PR #7) and is **not** fully merged to `main` as of this changelog baseline. Track progress there and in `docs/VISION.md` on that branch.

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gitcommit90/1Helm/commits/main
