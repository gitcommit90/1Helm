# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- GitHub Releases now require the complete numbered acceptance ledger from a
  multi-item request, plus artifact and verification evidence. Generated
  commit summaries can no longer replace the user-facing change list.
- The retained Apple Silicon release host now owns the complete macOS path:
  clean build, signing, notarization, public-download installation, launch,
  smoke verification, and Application Support preservation.

## [0.0.10] - 2026-07-25

### Fixed

- Feedback delivery now uses a durable central SQLite collector hosted on
  `1helm.com`, with bounded request bodies and attachments, validation,
  deduplication, rate limiting, a hidden authenticated inbox, and persistent
  systemd state outside versioned website snapshots. This removes the
  undeployed Cloudflare Worker route that returned `Not found` in v0.0.9.
- The final stress-test integration pass reconfirmed the full 22-item product
  sweep and the live resident follow-up countdown without weakening channel
  isolation, provider routing, or the existing app experience.

## [0.0.9] - 2026-07-25

### Added

- Open chat threads now show the resident's persisted durable follow-up with a
  live second-by-second “will check back in” countdown. Board and chat use the
  same follow-up row and WebSocket lifecycle, so the banner clears when the
  obligation completes or is cancelled.
- Channel Notes are Markdown files on the channel computer, available as a
  full tab or a resizable right-hand dock beside chat. Files now have folders,
  breadcrumbs, folder creation, folder-targeted uploads, and authenticated
  preview/download; MP3 and M4A attachments play in place.
- Focused-app speech-to-text can be toggled from the composer microphone or a
  bare Option/Alt tap, with a macOS microphone-purpose declaration and
  same-origin audio-only native permission handling.
- Channels can be favorited, grouped into per-user Favorites and Unreads
  sections, or created as resident-free human channels. Mentions are scoped to
  channel membership, and Tab in an empty composer mentions the resident.
- Provider routing now includes the live Requests → Router → provider flow, a
  credential-free channel-header activity popover, period-correct account
  activity, preview-before-apply model discovery, and OpenRouter free-model
  filtering.
- Residents receive one of nine illustrated character avatars on their
  customizable color plate. Profile images now use a crop/move/zoom step and
  upload a compressed square image.

### Changed

- New residents start with a seven-skill operational core plus focused skills
  for their channel template instead of every built-in procedure. The complete
  workspace catalog stays searchable, explicit and learned assignments are
  preserved, and Skipper retains the full catalog.
- Skipper fleet views distinguish the Files mirror quota from unknown guest
  disk capacity and report validated live or last-known load, memory, and disk
  pressure without asking the Captain to inspect a resident computer.
- Global Threads is denser, workspace names are Unicode-safe and capped at 100
  code points, long names wrap, usage is labeled as cumulative provider
  telemetry, and unclear connection language was removed.
- Starting with v0.0.9, 1Helm is licensed AGPL-3.0-only under Joseph Yaksich's
  copyright. Releases through v0.0.8 retain their MIT license; `NOTICE`
  records the exact boundary, and desktop packages retain both license files.
- Contributions now require a Developer Certificate of Origin 1.1 sign-off on
  every commit, with the certification and its non-assignment scope documented
  in `CONTRIBUTING.md`.

### Fixed

- The channel-header Router button now mounts its live animation, latest-ten
  request list, and external Base URL instead of opening an empty popover.
- Web deployments now permit first-party microphone access for explicit
  speech-to-text while continuing to deny camera and location access.
- Feedback intake now has a durable central `/v1/feedback` path with bounded
  attachments, privacy-scoped diagnostics, rate limiting, authentication for
  the team inbox, and host-side retry behavior.
- Provider activity periods and human account identities now reflect the
  selected member's real events instead of an unfiltered all-time view with
  generic “account” labels.

## [0.0.8] - 2026-07-24

### Fixed

- Successfully scheduling a durable agent follow-up now ends the active turn
  at the tool boundary. The runtime no longer makes a second model request or
  briefly exposes a fabricated completion before removing it, eliminating a
  timing race observed during the clean macOS release test.
- Gmail OAuth can now be completed from a remote browser by pasting its final
  localhost callback URL into 1Helm. Automatic host-local callbacks still
  work; the fallback validates the same one-time state and PKCE exchange.

### Changed

- The app's feedback surface and project privacy, support, and security
  guidance now identify `build@1helm.com` as the company contact address.
- Notification audio is now a per-user preference: every member can mute all
  pings globally, mute an individual channel, and choose that channel's sound
  without changing anyone else's experience.

## [0.0.7] - 2026-07-24

### Fixed

- Linux fleet reconciliation no longer mistakes the intentional marker-less
  interval during a fresh LXC bootstrap for an ownership violation. The
  provisioning transaction retains strict post-bootstrap verification, while
  ordinary and post-crash ownership checks remain fail-closed.
- macOS and Windows desktop packages now retain their required Mnemosyne and
  Windows WSL/removal runtime scripts. Electron Packager may inspect the
  parent `scripts` directory before its allowlisted children; the release
  filters now preserve that traversal without admitting unrelated build
  helpers or tests.

## [0.0.6] - 2026-07-24

### Added

- Linux systemd hosts now give every ordinary channel a persistent
  unprivileged LXC computer with private networking, subordinate UID/GID maps,
  exact owner markers, managed CPU/RAM, host-mirrored files, and no host-home
  mount. The installer pins and verifies the Ubuntu Noble image payloads and
  installs a narrow root-owned lifecycle boundary.
- The accepted Windows 11 implementation now has a native x64 desktop and one
  private WSL 2 Ubuntu distribution per ordinary channel. Windows-drive
  automount and process interop are disabled, Ubuntu root filesystems are
  immutable-version and SHA-256 pinned for x64 and arm64, and setup/removal
  verify exact ownership. Its public installer is withheld until Authenticode
  signing is available.
- Durable feedback is always visible, accepts optional attachments and
  diagnostics, retries central delivery, and provides a Captain feedback inbox.
- Residents can search their own authoritative raw channel transcripts by
  meaning, exact text/date, or recency and hydrate a complete prior session on
  demand. Each channel keeps a separate Mnemosyne index; guests and other
  channel residents cannot access it.
- SkillsMD discovery now queries the open registry directly and displays every
  returned result. Revision pinning, bounds, scanning, hashing, and runtime
  wrapping remain enforced when the user chooses to install.

### Changed

- Linux and Windows are production isolation backends; the in-process native
  computer remains an explicit development/test seam rather than the default.
- Linux update requests are executed entirely by the host. The verified root
  updater migrates runtime files and systemd units transactionally, refuses
  downgrades, health-checks for up to one minute, and reports rollback complete
  only after the restored host answers its health endpoint.
- The website and documentation describe the macOS, Linux/LXC, and Windows/WSL
  product contracts without claiming an unsigned Windows artifact is public.

### Fixed

- Apple Silicon release validation now retries the macOS system Python from a
  clean virtual environment when a preferred Homebrew Python leaves a partial
  one behind, so the pinned Mnemosyne test runtime can be prepared reliably.
- Fresh hosts now open the 1Helm server while the optional Mnemosyne Python
  and embedding runtime is prepared in the background, instead of making
  first launch and health checks wait on virtual-environment package installs.
- Newly created and newly assigned skills now appear immediately in already
  open Arsenal and Channel Settings views without a page refresh.
- Linux upgrades migrate existing compatibility computer records to LXC while
  retaining channels, workspaces, obligations, and durable application state.
- Fresh/repeat Linux installs reject unsafe rollback symlinks and install
  Python venv support required by long-term Mnemosyne memory.
- App removal, fleet inspection, lifecycle commands, terminal execution,
  workspace synchronization, and ownership refusal now cover Apple, LXC, and
  WSL backends consistently.

## [0.0.5] - 2026-07-24

### Changed

- Agent turns now receive a compact factual capability map—identity, channel,
  Linux computer and `/workspace`, callable tools, memory, skill inventory, and
  authority scope—instead of large behavioral manifestos.
- The skill arsenal is lazy-loaded. Models can list available skill metadata
  and explicitly read one full procedure when useful; 1Helm no longer injects
  the entire playbook library into every turn.
- Removed runtime prose classifiers that rejected, rewrote, or forcibly
  re-entered otherwise valid model answers. Security, ownership, and human-only
  boundaries remain enforced in tool and server code.

### Fixed

- Human display names are no longer prefixed to user messages sent to models,
  preventing names such as the Captain's from contaminating generated search
  queries.
- A public web/news search with no parsed results now retries once with a
  concise query, so ordinary conversational wording does not consume the turn
  or force an immediate refusal.
- Real-model acceptance covers the exact West Hollywood sinkhole prompt,
  Skipper's computer awareness in `#main`, lazy skill discovery, and autonomous
  resident work on its Linux machine.

## [0.0.4] - 2026-07-24

### Added

- Every workspace member can connect private OAuth or API-key providers,
  explicitly share owned providers and routes with the workspace, select a
  personal model, create isolated revocable endpoint keys, and use a dedicated
  loopback endpoint port on the 1Helm host. Personal keys also scope the shared
  `/v1` URL to that member's own-plus-shared provider pool and usage history.
- Residents and Skipper can search current web/news sources, inspect selected
  pages, and attach real sourced images with captions and article links.
- Native Mac releases now include a post-notarization updater ZIP, and the
  standard Linux installer provisions a root-owned atomic systemd updater with
  digest verification, health checks, and rollback.

### Fixed

- Update controls now operate on the machine hosting the 1Helm instance. The
  browser never receives a DMG or Linux artifact as the update action; native
  macOS downloads and verifies in place, while Linux accepts only a fixed
  host-side update request.
- Recent-event questions must research first and answer once with dated source
  links. Ordinary uncertainty no longer opens an immediate interview, and a
  real-photo request cannot be satisfied with generated artwork.
- Provider, route, OAuth, key, model, usage, and endpoint operations enforce
  signed-in member ownership server-side. Teammates—including the Captain—cannot
  mutate another member's shared credential, forge a private provider into a
  route, or observe another member's OAuth session.
- Terminal panes send heartbeats and silently reconnect after brief
  backgrounding or transport loss while retaining the same server session,
  shell state, working directory, and scrollback. Disconnect text is no longer
  written into the terminal.
- App-removal preparation now quiesces and fences automatic fleet care before
  deleting owned Apple channel machines, so an in-flight reconciliation pass
  cannot recreate a machine from stale pre-removal state.

## [0.0.3] - 2026-07-24

### Fixed

- `#main` is now a hard resident-free authority boundary. Skipper no longer
  exposes resident dispatch there, direct calls are rejected, historical guest
  bindings are removed during migration, and database triggers prevent them
  from returning. Relevant one-thread expert invitations continue to work in
  ordinary channels, while duplicate active invitations no longer dispatch a
  second turn.
- Skipper's command tool now names its authoritative assigned-computer
  inventory and defaults to `This Computer`, so the intentional absence of a
  per-channel resident VM in `#main` cannot be presented as absence of Skipper
  computer access.
- Learn a New Skill can inspect public HTTPS text sources directly through a
  bounded, audited reader with redirect revalidation, DNS pinning, private and
  reserved address rejection, response limits, and source digests. A
  source-derived skill cannot be created until every supplied URL has been
  successfully inspected.
- Runtime evidence checks reject unsupported claims of source inspection,
  computer provisioning, skill creation, or missing Skipper computers.

## [0.0.2] - 2026-07-23

### Fixed

- Photon now keeps every message from the same mapped sender in one durable
  1Helm thread across connector restarts and Photon conversation-ID changes.
  Sending `/new` closes that conversation without invoking the resident; the
  sender's next text starts a new thread.
- Existing Photon installations carry their latest sender thread forward on
  upgrade, and completed resident replies remain deduplicated on the return
  path.

## [0.0.1] - 2026-07-23

### Initial release

- One permanent resident agent and one persistent private Linux computer for
  every ordinary channel, with Skipper serving as the workspace-wide chief of
  staff and host/fleet operator.
- Durable per-thread agent turns with concurrent independent threads, visible
  same-thread FIFO queues, generation-fenced single-writer responses, restart
  recovery, lane-scoped Stop, and immutable finalized answers.
- Durable memory, provenance-bearing knowledge, reusable skills, scheduled
  follow-ups, recurring workflows, sleep/wake obligations, and resident ↔
  Skipper handoff with automatic return.
- A shared multi-account model fabric spanning OAuth providers, API-key
  providers, enabled models, fallback routes, quotas, logs, and an internal
  OpenAI- and Anthropic-compatible gateway.
- Host-owned Gmail and Photon connections with narrow grants, secret
  isolation, stable human blockers, deduplicated inbound messages, and durable
  external reply delivery states.
- Native channel inventory and lifecycle controls for Skipper, authenticated
  file Open/Download actions, clickable structured questions, shell-correct
  cwd-aware terminals, trusted skill discovery, smooth streaming, Settings,
  Board, Activity, Files, Terminal, and complete first-run onboarding.
- A documented reliability contract covering partner persona, prompt tiers,
  action bias, blocker and retry judgment, verification, memory, recovery,
  scheduling, connectors, and adversarial acceptance tests.
- Signed, hardened-runtime Apple Silicon desktop packaging with Apple
  notarization, stapled tickets, Gatekeeper verification, persistent
  Application Support, and isolated Apple container machines.

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v0.0.10...HEAD
[0.0.10]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.10
[0.0.9]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.9
[0.0.8]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.8
[0.0.7]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.7
[0.0.6]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.6
[0.0.5]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.5
[0.0.4]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.4
[0.0.3]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.3
[0.0.2]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.2
[0.0.1]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.1
