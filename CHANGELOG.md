# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.2
[0.0.1]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.1
