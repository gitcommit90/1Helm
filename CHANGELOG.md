# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.2] - 2026-07-21

### Added

- Native Apple Silicon macOS app that runs the complete 1Helm control plane, Skipper, terminals, agents, and durable workspace data on the installed Mac.
- One persistent Apple `container machine` per ordinary channel, with `home-mount=none`, automatic resource policy, guest command/terminal routing, narrow workspace sync, exact lifecycle, obligation-aware wake/sleep, and Skipper fleet reconciliation.
- Developer ID signing, Apple notarization, stapling, DMG packaging, and mounted-artifact verification for direct distribution.

### Changed

- First-run Computer setup handles Apple's one-time verified runtime approval before users create agent channels; Skipper owns all CPU, RAM, sleep, repair, and update decisions afterward.
- Image Generation is gated on ChatGPT OAuth plus a per-account Providers toggle that is off by default.
- Route building is multi-account agnostic, with one entry per provider family, real provider marks, and a routing-fabric Sources animation.
- Board, Threads, and chat are denser; the duplicate Threads unread toggle is removed and delete-channel confirmation is clearer.

### Fixed

- Long resident names no longer overlap the mobile channel header; long channel purposes use a soft fade and tooltip.

## [1.1.1] - 2026-07-21

### Changed

- Resident-agent model pickers now use the embedded router's authoritative catalog, including shared fill-first model IDs across same-provider accounts.
- Keyed-source connections must pass a current credential/model test before Connect; edits invalidate stale results and Connect is single-flight.

### Fixed

- Selecting one model or using All on / All off updates the open account in place instead of rebuilding and collapsing the Providers interface.
- 1Helm agents now use a durable private gateway credential that is never listed on Endpoint, so disabling or revoking every external key cannot take resident agents offline.
- Provider groups and account editors retain their expanded state across the remaining actions that legitimately refresh provider state.

### Security

- Private workspace authentication is filtered from routine state, Captain credentials, and key-mutation responses while public keys remain independently revocable.
- Expanded integration coverage verifies credential redaction, OAuth initiation/cancellation, provider/model lifecycle, real fallback and round-robin routing, quota, logs, bind changes, migration idempotence, restart persistence, and Captain-only mutations.

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

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v1.1.1...HEAD
[1.1.2]: https://github.com/gitcommit90/1Helm/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/gitcommit90/1Helm/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/gitcommit90/1Helm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gitcommit90/1Helm/commits/main
