# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.19] - 2026-07-23

### Fixed

- Repeat Linux installs now inspect an existing service-owned release as the `1helm` service account. Git's ownership safety check no longer makes an unchanged, valid release look corrupt when the root installer is run again.

### Tests

- Added a repeat-install ownership regression and verified that the service, `/var/lib/1helm` inode, and an exact state sentinel survive a second installer run on the disposable Ubuntu host.

## [1.1.18] - 2026-07-23

### Fixed

- Fresh Linux installs retain platform-specific optional packages required by the production CSS build. The installer still suppresses Puppeteer's browser download, but no longer removes Tailwind's native watcher dependency before `npm run build`.

### Tests

- Extended the installer contract and repeated the disposable Ubuntu acceptance from an empty host after reproducing the prior fresh-build failure.

## [1.1.17] - 2026-07-23

### Fixed

- The Linux installer now probes the native addon toolchain (`make`, a C++ compiler, and Python) independently of its download utilities. Minimal systemd hosts no longer skip `build-essential` merely because `curl`, Git, tar, and xz were already present.

### Tests

- Added an installer regression contract and exercised fresh install, repeat install/state preservation, and health-failure rollback on a disposable systemd Ubuntu host.

## [1.1.16] - 2026-07-23

### Added

- A complete autonomy contract for residents: routine installs, downloads, configuration, commands, retries, and reversible implementation choices are owned inside the resident computer; host/cross-channel/capability boundaries call Skipper directly; Skipper must hand the thread back so the resident finishes. `ask_user` is restricted to evidenced human judgment, missing credentials, external authority, or irreversible commitment.
- Thirty-four substantive built-in operational playbooks, selected per task from a permanently assigned safe arsenal, plus evidence-gated procedure crystallization. A bounded Hermes metadata index supplies more than 90,000 searchable records; trusted GitHub-backed skills are revision-pinned, scanned, hashed, wrapped beneath runtime authority, and installed without a human approval ceremony, while community content remains quarantined.
- Host-brokered Photon/iMessage connections with device-code setup, allowlisted inbound resident threads, deduplication, supervised reconnect/backoff, narrow conversation replies, and secret isolation. Text is the verified contract; rich attachment fidelity remains explicitly under verification.
- Durable recurring resident workflows with wakeable computer obligations, pause/resume/complete controls, bounded run counts, restart persistence, and archive suppression; a JSON-in/JSON-out agent CLI; and a deterministic machine-readable autonomy benchmark.
- An append-only SHA-256 audit chain for new activity, tool starts/results, and external-skill decisions, with verification APIs and Settings UI. This provides tamper evidence, not a remote transparency log, and does not backfill historical rows.
- A standalone screenshot-led product and documentation website for `1helm.com`, independent from the `demo.1helm.com` sandbox, plus Linux/systemd and Windows+WSL install paths, hardened website/tunnel service definitions, `SECURITY.md`, and an honest platform/capability matrix.

### Changed

- The Linux installer now verifies an exact official Node release against its published checksum manifest, builds in an immutable versioned release directory, atomically switches `/opt/1helm/current`, health-checks startup, and restores the prior release link on failure.
- The standalone website and its dedicated Cloudflare connector run as separate unprivileged dynamic systemd users; the tunnel credential is delivered read-only through systemd's credential channel instead of granting either process root execution.
- Cloudflare connector lifecycle uses generation fencing and single-settlement child handling, so a connector stopped by its owner cannot race an already-queued automatic relaunch.
- Photon sidecars launched from the packaged Electron runtime explicitly use Node mode, redact bearer/basic/token/secret material from errors, and back off boundedly when long polling fails.
- Direct Sharp and WebSocket dependencies, including transitive development consumers, are overridden to fixed current releases. The production audit still reports 17 moderate advisories in Spectrum's OpenTelemetry dependency tree; no high or critical advisory remains.

### Tests

- Expanded native autonomy/Skipper-return coverage; catalog quarantine and procedure-quality tests; Photon configuration, authorization, allowlist, deduplication, stale-waiter recovery, redaction, packaging, and backoff tests; workflow wake/archive tests; standalone-site and installer tests; connector fast-restart stress coverage; real configured-provider/Gmail browser acceptance; and a public 5/5 autonomy invariant report with an explicit machine-readable scope and limitations.

## [1.1.15] - 2026-07-23

### Added

- Every human receives a private personal `#main` shared only with Skipper. Coworkers can ask Skipper there to create their own private agent channels without Captain approval; the creator is added automatically, and the Captain gains access only after the creator tags and confirms them.
- Approved coworkers also join the human-only `Collab` holding space. Channel creators can tag and confirm coworkers into only the channels they own, while HTTP, file, terminal, and WebSocket membership boundaries stay enforced.

### Changed

- Resident agents now receive an explicit ownership contract for their isolated Linux computer: installs, downloads, setup, commands, configuration, and file work inside that machine happen autonomously without permission loops or repeated questions.
- A connected ChatGPT subscription account now makes image generation available automatically. Skipper's production tool set exposes `generate_image` directly from capability health, executes it through that same multi-account provider fabric, saves the PNG into the channel, and attaches it to chat without a second hidden toggle, stale skill assignment, or separate legacy login.
- New resident agents randomly choose an unused palette color while one remains, preventing every new agent from starting with the same avatar color.
- Every web, PWA, login, favicon, and default workspace-logo surface now derives from the sole sailboat artwork used by the macOS app; retired numeral assets and references are removed.

### Fixed

- Crowded Board swim lanes now own their vertical overflow and can scroll all the way to the final task without expanding the whole Board past its viewport.
- Native terminal bootstrap is silent: the UI no longer prints `Starting terminal…`, and PATH setup is applied before the interactive shell instead of being typed into visible scrollback.
- The Profile update notice and its explicit versioned DMG download button now stay together in one always-visible section.
- Captain-created coworkers and approved requesters receive their private `#main` immediately; legacy members are migrated without leaking those channels to the Captain or accidentally provisioning resident computers for them.

### Tests

- Added native privacy, coworker channel-ownership/invitation, autonomous install, distinct-avatar, and silent-terminal coverage; image capability/tool/PNG attachment integration coverage; and a browser regression that proves a crowded swim lane physically scrolls to its last card.

## [1.1.14] - 2026-07-22

### Fixed

- Live agent progress now replaces only the affected message rows. Streaming no longer rebuilds the thread panel or active composer, so typed drafts, focus, selection, open work logs, and user-controlled scroll positions stay stable while an agent works.
- Skipper host commands and newly opened native terminals restore the full Homebrew path after shell startup files run, so installed Apple Silicon CLI tools remain directly callable without profile edits.

### Tests

- Added browser regressions for immediate composer clearing, stable focused thread input during streamed updates, direct Files upload, and Board viewport containment, plus native integration checks for Homebrew paths, flat-color agent avatars, and custom-domain-primary fallback behavior.

## [1.1.13] - 2026-07-22

### Added

- Local-first collaboration for the native Mac app: Captains can reserve a unique `workspace.1helm.com` address that tunnels to the same headless web UI and ephemeral loopback server already running on their Mac. The Mac remains the sole workspace server, so sleep, shutdown, or lost connectivity makes the workspace unavailable by design.
- A deployed Cloudflare Worker and D1 registry atomically reserve up to 1,000 beta workspace slugs, provision one exact DNS record and locally managed tunnel per workspace, recover connector credentials only for the owning installation, and clean up partial provisioning failures. Distributed apps never contain the account-wide Cloudflare credentials.
- **Join team?**, request-access, Captain approval/denial, account claim, and Settings → Members controls including **Accept new requests**. Requests create an LLM-agnostic 1Helm notice in `#main`.
- A human-only `Collab` holding channel for the Captain and accepted coworkers. It never receives a resident agent, bot, computer, terminal, model policy, or Files workspace. Coworkers gain an agent channel only when the Captain tags them there and confirms **Add @user**; HTTP, file, terminal, and WebSocket access all enforce membership server-side.
- Direct Files-tab uploads, ChatGPT OAuth-backed image generation that saves and attaches PNG results through the `generate_image` agent tool, flat-color Skipper/resident avatars, and bundled pinned Cloudflared `2026.3.0` for signed Apple Silicon releases.

### Changed

- Board lanes now use a responsive wrapping grid instead of horizontal overflow; chat composition clears optimistically and restores the draft/attachments on failure; streaming message fan-out is coalesced; and native Skipper commands/terminals prefer Homebrew paths.
- Custom Cloudflare domains use the same in-process connector manager as collaboration, allowing the native app to run them without Linux systemd while migrating the prior single-domain connector state.
- Workspace/PWA artwork consistently uses the 1Helm logo, and enabled ChatGPT image generation assigns the corresponding capability to Skipper.

### Security

- Remote collaboration pages keep Electron context isolation, renderer sandboxing, disabled Node integration, explicit exact `*.1helm.com` navigation checks, CSP, expiring sessions, bounded requests, and rate-limited public sign-in/access-request endpoints.

## [1.1.12] - 2026-07-22

### Fixed

- Channel and full-app removal now use Apple Container's complete `machine delete` lifecycle instead of the record-only `machine rm` path, preventing invisible orphan runtime services and Virtualization processes from surviving after a machine disappears from `container machine list`.

## [1.1.11] - 2026-07-22

### Fixed

- macOS now retries its bundled Python when a preferred interpreter cannot create the app-managed Mnemosyne virtual environment, so durable on-device agent memory remains available instead of silently falling back to the canonical record alone.
- The real Apple channel-computer acceptance test now fails and preserves diagnostics if cleanup cannot delete its owned test VMs, preventing silent accumulation of container-runtime virtual machines on the signing Mac.
- Settings → Admin now includes **Prepare to remove 1Helm**, which preserves the latest mirrored files, verifies exact in-guest ownership, deletes every channel VM belonging to this installation, confirms none remain, and disables automatic login launch before the app is moved to Trash. A later reinstall can rebuild the machines from the preserved mirrors.
- macOS integration suites now clean up and verify their real Apple channel VMs instead of deleting only their temporary databases and leaving container-runtime processes behind.

## [1.1.8] - 2026-07-22

### Fixed

- The terminal integration test now verifies the correct private workspace path for both native compatibility terminals and real Apple channel machines. Apple machines execute in their intentional guest-only `/workspace` mount while native development runs use the matching host mirror.

## [1.1.7] - 2026-07-22

### Added

- The Profile popover now shows the installed 1Helm version and a compact manual **Check for updates** control. It checks 1Helm's public update service, reports whether the app is current, and opens the versioned Apple Silicon DMG when a newer release is available.

## [1.1.6] - 2026-07-22

### Changed

- The native macOS app now uses the new 1Helm sailboat artwork as its Finder, Dock, and Login Items icon. The web icon remains unchanged.

## [1.1.5] - 2026-07-22

### Fixed

- macOS now uses only the signed 1Helm main-app login service and removes the legacy per-minute LaunchAgent, so background-item notices and Login Items use the product app instead of exposing the Developer ID publisher as “Software from Bible Tiles.” 1Helm still stays available after its window closes and starts hidden at login.

### Notes

- Desktop updates remain manual DMG replacements from GitHub Releases; 1Helm does not yet ship an automatic updater or update feed.

## [1.1.4] - 2026-07-22

### Added

- Structured in-chat interviews with prefilled choices, multi-select support, and a typed-answer path, plus a thread-scoped Stop control that preserves partial work and injects one-shot continuation context on the next user reply.
- Settings → Skills now teaches Skipper from local files or folders, web URLs, and notes in a normal visible thread, finishing through the existing reusable `create_skill` workflow.
- Captain profiles now include display name, job title, description, and avatar controls from the bottom-left identity, and fresh workspaces receive an optional primary-model choice with a short post-onboarding tour.
- The Sources screen now visualizes real started, routed, and finished provider requests; quota refreshes immediately and every 60 seconds while visible.

### Changed

- Production agent tool rounds increase from 6 to 150. Channel, thread, and workspace model controls now use user-facing provider-family → model selectors, while the internal 1Helm Router remains an implementation detail.
- Onboarding uses a wider, height-bounded layout that fits Captain → Providers → Workspace without shell or panel scrolling, including the minimum 820×600 desktop window.
- Image Generation is one workspace-wide ChatGPT-family capability instead of a per-account switch. Provider/model/route edits reconcile stale workspace, channel, and thread selections immediately.
- Apple channel storage now reports the honest 2 GiB 1Helm-managed writable allocation rather than the host-backed virtual filesystem ceiling.

### Fixed

- Apple channel terminals now run an explicit `/bin/bash -l` in `/workspace`, and installs repair `node-pty`'s non-executable arm64 spawn helper so new-channel and `#main` terminals no longer stall or fail with `posix_spawnp failed`.
- Fresh macOS profiles now validate and repair the pinned Mnemosyne runtime instead of mistaking a partial Python environment for working memory support; the system Python fallback retains strict recall checks.
- The native wake LaunchAgent starts the signed 1Helm executable directly, so macOS identifies the background item as 1Helm instead of `sh`; background wakes no longer force the window open.
- Router startup rotates through nearby ports when 4949 is occupied, LAN/Tailscale changes apply the confirmed host and port once, and failures restore the previous selection.
- Custom OpenAI-compatible endpoints genuinely accept an empty API key and omit Authorization headers. Image toggles no longer jump to the top, connected accounts stay compact, and routine saves avoid full-screen redraw flicker.
- Thread titles strip Markdown markers, long mention-model names and channel descriptions wrap cleanly, and channel descriptions no longer use a fade mask.

## [1.1.3] - 2026-07-21

### Changed

- First-run onboarding is now Captain → Providers → Workspace and uses the same multi-account OAuth/key provider fabric as Settings; it no longer asks users to choose one AI brain or starter model.
- Per-channel Linux computers are presented as Skipper-managed infrastructure. The only unavoidable Apple runtime approval appears inline while creating the workspace, with terminals enabled by default.
- Cloudflare domains remain available in Settings instead of appearing as a first-run requirement, while optional owner-supplied machines are clarified as Skipper computers.

### Fixed

- OAuth callbacks are completed by the native server even while the desktop renderer is backgrounded, so returning from ChatGPT and other providers automatically finishes the connection.

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

- Formalized project governance, release lifecycle, PR expectations, CI, and repository hygiene.

### Added

- Keep a Changelog narrative, CONTRIBUTING, CODEOWNERS, GitHub Actions (typecheck, build, pipeline tests).

## [1.0.0] - 2026-07-10

### Added

- First-run workspace setup wizard, owner account, provider connect, optional terminals, `#main` + `@skipper`.
- Chat (channels, DMs, threads), bots/providers, embedded terminal agent path.
- Visual identity overhaul and cold VPS deploy tooling (`scripts/deploy-vps-fresh.sh`).
- HTTP asset / CSP fix for non-HTTPS demos (PR #1).

### Notes

- The native channel-agent workspace began as a separately reviewed specification slice before becoming the normal 1Helm product path.

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v1.1.19...HEAD
[1.1.19]: https://github.com/gitcommit90/1Helm/compare/v1.1.18...v1.1.19
[1.1.18]: https://github.com/gitcommit90/1Helm/compare/v1.1.17...v1.1.18
[1.1.17]: https://github.com/gitcommit90/1Helm/compare/v1.1.16...v1.1.17
[1.1.16]: https://github.com/gitcommit90/1Helm/compare/v1.1.15...v1.1.16
[1.1.15]: https://github.com/gitcommit90/1Helm/compare/v1.1.14...v1.1.15
[1.1.14]: https://github.com/gitcommit90/1Helm/compare/v1.1.13...v1.1.14
[1.1.13]: https://github.com/gitcommit90/1Helm/compare/v1.1.12...v1.1.13
[1.1.12]: https://github.com/gitcommit90/1Helm/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/gitcommit90/1Helm/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/gitcommit90/1Helm/compare/v1.1.9...v1.1.10
[1.1.9]: https://github.com/gitcommit90/1Helm/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/gitcommit90/1Helm/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/gitcommit90/1Helm/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/gitcommit90/1Helm/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/gitcommit90/1Helm/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/gitcommit90/1Helm/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/gitcommit90/1Helm/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/gitcommit90/1Helm/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/gitcommit90/1Helm/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/gitcommit90/1Helm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gitcommit90/1Helm/commits/main
