# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.4
[0.0.3]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.3
[0.0.2]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.2
[0.0.1]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.1
