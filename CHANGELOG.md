# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-20

### Added

- Native multi-account provider control plane with Sources, fallback/round-robin Routes, Activity, Quota, redacted Logs, and Endpoint/key management.
- OAuth sources for ChatGPT, Claude, Antigravity, and xAI; keyed presets for OpenRouter, NVIDIA NIM, Cloudflare, and GLM; custom OpenAI-compatible connections.
- One gateway at the 1Helm `/v1` base URL for model discovery, Chat Completions, Responses, Anthropic Messages, and token counting, protected by revocable gateway keys.
- Local uncapped routed-usage history, account attribution, quota probes, and provider/gateway diagnostics.

### Changed

- Skipper, resident agents, channel/thread model pickers, and external clients now share the same embedded routing engine and model/route catalog.
- Existing provider/model assignments migrate into compatibility routes, preserving current model names while moving agents onto the unified internal router.

### Fixed

- Channel / thread open no longer pins the viewport at the oldest messages; chat lands on latest and shell rebuilds preserve scroll.

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

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/gitcommit90/1Helm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gitcommit90/1Helm/commits/main
