# 1Helm

**Create a channel for anything. It comes with an agent, a computer, a workspace, and a memory.**

1Helm is a self-hosted **native agent workspace**. It runs on **1Helm**, the installed host environment: a computer or VPS you own. Instead of asking you to wire bots into rooms, pick directories, or configure memory backends, 1Helm treats every channel as a complete world for one durable resident agent.

> Stop bringing AI to your work. Give AI a place to work.

The invariant model:

- **Captain** — the first user; workspace owner and final authority.
- **Skipper** — exactly one workspace-wide, root-capable chief of staff, resident in `#main`. The deliberate exception path: call it when a channel agent needs host-level work, another channel, credentials, or a missing capability.
- **Channel agent** — exactly one resident specialist per ordinary channel, bound immutably. It owns a durable computer workspace, files, threads, and provider-neutral memory.
- **Thread** — a durable session with status and a rolling summary.
- **Workspace / Memory** — per-channel durable filesystem and knowledge that survive model/provider changes and restarts.

> One Helm. One Captain. One Skipper. Many channels. Many agents. Every thread is a session.

Distribution is fully OSS and self-hosted. State lives on your machine. Connect subscription accounts or API keys once; 1Helm routes its own agents and external clients through the same local model fabric. A managed hosted offering is a future layer; this repository is the on-box runtime.

Living product record and direction history: [`docs/VISION.md`](docs/VISION.md). Full specification: [`SPEC.md`](SPEC.md).

---

## What works today

- **First-run wizard** — create the Captain account, connect one or several provider accounts or keys, and name the workspace. If needed, approve Apple's verified channel-computer runtime inline once; terminals default on. After setup, choose an optional primary model and take a short product tour.
- **Create a channel** — name it and describe what it's for. 1Helm atomically provisions its resident agent, computer workspace (`/workspace`), files, memory namespace, and model policy — no bot wiring or directory setup.
- **Resident agents** — one durable specialist per channel; shell commands and files stay in that channel's `/workspace`; curated decisions, facts, preferences, and artifact references are retained across threads, model changes, and server restarts. Session recaps remain in Threads rather than being mislabeled as Memory.
- **Durable operating arsenal** — 34+ substantive playbooks ship to every resident, activate automatically by task, and cover outcome ownership, escalation/return, obligations, tool/package management, research, communications, documents, software, infrastructure, security, and everyday operations. Skipper can search 90,000+ external metadata records, immutably pin and scan curated skills, and quarantine community content. Residents crystallize only complete procedures backed by concrete completion evidence; generic snippets are rejected.
- **Mnemosyne memory per identity** — Skipper and every resident agent own a distinct local Mnemosyne SQLite database. Curated knowledge and completed session outcomes feed long-term retrieval; memory never collapses to a profile Markdown file.
- **Growing templates** — start from a Blank slate, Project, Research, Home, or Inbox role. These are lightweight starting kits; the resident keeps learning preferences, receiving skills, and improving with the user.
- **Stable channel URLs** — channel tabs and threads have durable slug routes such as `/c/product-launch/memory` and `/c/product-launch/thread/42`.
- **Local-first collaboration** — opt in to a unique `workspace.1helm.com` address for the same headless web app running on the installed Mac. Coworkers request access, create an account after Captain approval, land in the human-only `Collab` space, and gain an agent channel only after the Captain tags and confirms them there. When the host Mac is asleep, off, or offline, the workspace is unavailable by design.
- **Cloudflare custom domains** — Settings → Domains can also create a named tunnel, DNS route, HTTPS hostname, and persistent connector from a one-time token that is never stored.
- **Silent improvement reviews** — Skipper periodically examines recent interaction signals, adds durable behavior guidance after missed corrections or frustration, and leaves a concise Activity note.
- **Thread-only expert guests** — the ordinary channel stays Skipper plus its resident expert. Skipper may invite another resident into one thread; the guest is never added to the channel and receives neither its workspace nor memory.
- **Skipper escalation** — `@skipper` (or a resident agent's `call_skipper`) routes the full invoking thread to the one workspace Skipper, which can take the broader action and records the outcome in that same thread. Skipper hands work back with `call_agent` so the resident finishes without the Captain re-tagging.
- **Bounded outcome gate** — when a model tries to end operational work as a tutorial, an unevidenced blocker, an unresolved tool failure, or “Skipper could help,” the runtime objects and keeps the same turn moving. It may object at most three times, and it does not interfere with read-only questions or a real structured human boundary.
- **Channel-native UI** — per-channel Chat, Threads, Files, Terminal, Memory, Activity, and Settings. The header shows the resident agent's identity, status, and serving model; a `Call Skipper` affordance is always one click away.
- **Outcome-first supervision** — Activity shows one mutable verb → object → outcome row per action instead of duplicate start/finish noise. Expand a row for retained input and outcome evidence; the in-chat Work log remains the live chronological rail.
- **Lifecycle** — archive pauses an agent world (cancels in-flight work, closes terminals) while preserving everything; restore reuses the same identity, workspace, memory, and threads; permanent deletion is Captain-only with typed-name confirmation.
- **Unified model fabric** — connect ChatGPT, Claude, Antigravity/Gemini, and xAI OAuth accounts; OpenRouter, NVIDIA NIM, Cloudflare, GLM, or custom API keys; pool multiple accounts; enable exact models; create fallback or round-robin routes; and use all of them inside 1Helm or through one `/v1` endpoint.
- **In-chat controls** — agents can pause for one to three structured multiple-choice questions with custom answers, and each active thread turn has a Stop control that preserves partial work and resumes cleanly from the user's next message.
- **Local operations** — request activity, token usage, account attribution, supported subscription quotas, redacted routing/OAuth logs, and revocable gateway keys live in Settings → Providers. Changing a model or route never replaces an agent or discards channel-owned state.
- **A computer per channel on macOS** — every ordinary channel gets a persistent Apple `container machine`: a separate lightweight Linux VM with its own filesystem, shell, services, and `/workspace`. Skipper chooses CPU/RAM automatically, keeps the Mac home directory unmounted, wakes scheduled work, and conservatively leaves machines running when services or timers make sleep unsafe.
- **Channel terminals** — optional. Each ordinary channel's Terminal and resident shell tools execute inside that channel's Linux computer; its screen and server session survive tab navigation and page reload, and sessions are owner- and channel-scoped and torn down on archive/delete. Skipper's `#main` terminal remains native on the Mac.
- **Scoped Gmail handoff** — when Gmail OAuth accounts already exist on the 1Helm host, Captain-authorized Skipper can grant a resident account-specific search/read/draft access without exposing tokens. Sending remains disabled by default.
- **Recurring workflows and agent CLI** — durable interval workflows open a real thread and invoke the same resident on every due run, survive restarts, and can be paused, resumed, or bounded by run count. `npm run helm -- ...` is a JSON-in/JSON-out surface for status, channels, messages, workflows, and audit verification.
- **Photon/iMessage broker** — Settings → Connections starts Photon's device login, creates/reuses a 1Helm project, rotates its secret, registers an allowlisted phone, discovers its assigned line, and supervises a loopback `spectrum-ts` stream. Inbound text becomes a real resident thread; narrow replies are allowed only to that delivered conversation unless Skipper grants new outbound sending. Rich attachment fidelity remains under verification.
- **Tamper-evident new activity** — tool starts/results, new operational activity, and external skill decisions enter an append-only SHA-256 chain with Settings/API verification. Pre-chain history is not backfilled and the chain is not a remote transparency log.
- **Public autonomy contract** — `npm run benchmark:autonomy` emits deterministic machine-readable JSON verifying the shipped arsenal, narrow human-blocker gate, bounded outcome gate, resident tool surface, wakeable recurring work, and audit-chain invariants for its executed fixture. It is explicitly not a live-model task-success or security score.

On Apple Silicon macOS 26, per-channel VM isolation is the product backend. Linux/CI/WSL source deployments deliberately use a compatibility backend; 1Helm never labels that fallback as VM isolation. Not yet shipped: a native Windows app, native Linux package, mobile clients, Linux resident VM isolation, blind community-skill execution, or a hosted control plane. The legacy "configure a bot and add it to a room" flow is retained only as migration compatibility for existing installs and is not the normal product path.

---

## Quick start

```bash
# Prefer the official Node 22 binary (some distro builds omit TypeScript support)
PUPPETEER_SKIP_DOWNLOAD=1 npm install
npm run build      # client bundle + Tailwind CSS
npm start          # http://localhost:8123
```

Open `http://localhost:8123`. On a fresh data directory you see the setup wizard, not a login screen:

1. Create the Captain account (first user is admin).
2. Connect one or several provider accounts or keys through the shared provider fabric.
3. Name the workspace. If macOS still needs Apple's verified container runtime, approve it inline once.
4. Land in `#main` with Skipper, then create your first agent channel.

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8123` | HTTP/WebSocket port. |
| `CTRL_DATA_DIR` | `./data` | SQLite control-plane state + narrow host workspace mirrors and uploaded files (internal path name kept for compatibility). |
| `HELM_CHANNEL_COMPUTER_BACKEND` | `apple` on macOS, `native` elsewhere | Explicit backend override for development/testing. The macOS product uses `apple`. |
| `HELM_CHANNEL_MACHINE_IMAGE` | `local/1helm-channel-machine:1.1.20` | Versioned OCI machine image built from `container/Containerfile`. |

On first boot 1Helm starts a private loopback Open-Terminal agent and registers it as **"This Computer"** for Skipper's native-Mac work. Ordinary residents are never assigned that host computer.

### Dev mode

```bash
npm run watch:js   # terminal 1
npm run watch:css  # terminal 2
npm start          # terminal 3
```

### macOS app

```bash
npm run desktop
```

The native Apple Silicon app carries the complete on-box 1Helm control plane.
It is not a remote view of demo.1helm.com: Skipper runs natively on that Mac,
while each ordinary channel gets its own persistent Linux computer through
Apple's `container` runtime. 1Helm uses `--home-mount none`, so a resident never
receives the Captain's whole Mac home. Durable control-plane data, provider
credentials, uploads, and narrow Files UI mirrors live at
`~/Library/Application Support/1Helm`; the canonical Linux filesystem lives in
the channel machine and survives stop/start.

Apple's runtime currently requires one administrator-approved installation.
1Helm downloads only the pinned Apple 1.1.0 signed installer, verifies its
published SHA-256, and opens the macOS approval UI. After that, Skipper manages
machine creation, health, wake/sleep, repair, unattended guest updates, and
resource sizing without asking the user infrastructure questions.

The direct-distribution release adapter is `npm run package:dmg:release`; it
requires the activated Developer ID and notarization environment described in
the maintainer release runbook.

Profile offers a manual **Check for updates** control that checks 1Helm's
public update service and opens the current GitHub Release's Apple Silicon DMG
when a newer version is available. Desktop updates remain manual DMG
replacements; replacing the app preserves `~/Library/Application Support/1Helm`.

### Collaboration and headless access

The native app always starts its local web control plane on loopback and keeps it
running after the window closes. During onboarding—or later in Settings →
Domains—the Captain can enable **Collaborate** and reserve one unique
`workspace.1helm.com` slug. 1Helm provisions an exact Cloudflare DNS record and
a tunnel whose connector runs inside the signed app against that app instance's
ephemeral loopback port. Workspace data and provider credentials remain on the
Captain's Mac; the public hostname is a route to that machine, not a hosted copy.

The app's **Join team?** path accepts another `*.1helm.com` workspace. Someone
without an account can request access when the Captain has **Accept new
requests** enabled. Approval happens in Settings → Members. The first coworker
creates `Collab`, a holding space containing people only—no resident agent, bot,
VM, terminal, Files workspace, or model policy. Coworkers see no agent channel
until the Captain writes `@username` in that channel and confirms **Add
@username**. These channel boundaries are enforced by the HTTP, file, terminal,
and WebSocket server paths, not only hidden in the client.

---

## Architecture

Compact Node/TypeScript app with a native Electron host on macOS and no server transpile step:

| Piece | How |
|---|---|
| **Runtime** | Official Node 22 runs server TypeScript directly (native type-stripping). |
| **Database** | `node:sqlite` — workspace state plus uncapped routed-usage history; no external DB. |
| **Server** | `node:http` + `ws`. |
| **Client** | Vanilla TypeScript via esbuild + Tailwind CSS. |
| **Terminals** | `node-pty`; ordinary channels spawn `container machine run -it`, while Skipper can use the native loopback computer. |
| **Channel computers** | Apple `container machine`, one persistent Linux VM per ordinary channel, controlled through a defensive argv-only CLI backend. |
| **macOS** | Electron hosts the native Skipper/control plane on loopback, persists state in Application Support, and remains available for scheduling after its window closes. |
| **Collaboration** | A Cloudflare Worker + D1 registry atomically reserves unique slugs and provisions one locally managed tunnel per opted-in workspace; the signed app bundles the pinned arm64 connector. |

```
src/
  server/
    index.ts      HTTP + WebSocket, REST API, auth, lifecycle routes
    db.ts         schema, migration, crash recovery
    agents.ts     channel provisioning, workspaces, memory, lifecycle
    setup.ts      workspace setup, #main, Skipper seed
    store.ts      messages, model policy, agent/bot views
    bots.ts       agent-turn engine (streaming, tools, escalation)
    computer.ts   Open-Terminal client
    channel-computers.ts  per-channel VM provisioning, execution, sync, obligations, and fleet reconciliation
    terms.ts      channel-scoped keep-alive terminal sessions
    events.ts     live event fan-out
    agent.ts      embedded local terminal agent
  client/
    app.ts        boot, auth, layout, chat, channel tabs
    channel.ts    create-channel, Threads/Files/Memory/Activity/Settings
    onboarding.ts first-run wizard
    settings.ts   agent roster, providers, advanced computers, members
    term.ts       channel-scoped split-pane xterm
    dom.ts        hyperscript, Markdown, sounds
    api.ts        REST + WebSocket client
```

Runtime deps include `ws`, `node-pty`, and the version-pinned ReRouted headless engine that supplies provider adapters, account pools, retries, routes, quota probes, and the local API gateway. ReRouted's dashboard is not embedded; 1Helm owns the product UI and lifecycle.

---

## Features in more detail

### Channels and resident agents
Create a channel with a name and a plain-language purpose. 1Helm provisions one resident agent for that channel, a durable `/workspace`, files, threads, and a provider-neutral memory namespace — all in one atomic operation. The agent works within its channel world and escalates to Skipper for anything outside it. Ordinary channels have exactly one resident; the binding is immutable.

### Memory and continuity
Session summaries are channel-owned Thread/session records. Decisions, facts, preferences, and artifact references are separately stored as curated Memory records with provenance (author, source thread, time). Each identity also owns a local Mnemosyne SQLite database for long-term episode and knowledge recall. The resident agent's context is assembled from its profile, session summary, curated records, Mnemosyne recall, artifact list, and transcript — so continuity survives a model or provider change and a server restart without presenting raw chat as memory.

### Computers and terminals
On Apple Silicon macOS 26, every ordinary resident works inside a distinct persistent Linux VM. Agent commands and the human Terminal share its `/workspace`; separate channel machines cannot see one another or the Mac home. A narrow streamed tar bridge mirrors Files UI/uploads without bind-mounting broad host paths. Native follow-ups are wakeable obligations; guest services, systemd timers, cron, interactive terminals, agent turns, and uncertain quiescence prevent unsafe stopping. Resource changes use drain → sync → stop → set → start → verify. Skipper remains native and has workspace-wide authority; host-level action is gated to Captain-authorized invocations.

### Admin
First user is the Captain (admin). The Captain manages workspace name/photo/theme, the Cloudflare domain, providers, members, channel lifecycle, and Skipper. The normal path never asks anyone to choose a directory, memory backend, terminal backend, or bot-channel membership.

### Providers, routes, and the shared endpoint

Settings → Providers is 1Helm's native control plane for all model access. Connected accounts and API keys immediately populate channel and thread model pickers. Standard-provider routes select provider + model and try every eligible account in that provider pool before moving to the next fallback member; custom OpenAI-compatible connections remain connection-specific.

Named routes can use ordered fallback or round-robin starting positions. Custom OpenAI-compatible endpoints may omit an API key when the upstream requires no authentication; 1Helm then sends no Authorization header. The same direct model IDs and route names are exposed at the workspace's `/v1` base URL for external OpenAI- or Anthropic-compatible tools. Supported endpoints are model discovery, Chat Completions, Responses, Anthropic Messages, and Anthropic token counting. Gateway keys are separate from 1Helm login sessions and can be created, disabled, copied, and revoked independently.

Provider configuration lives under `CTRL_DATA_DIR/routing`: restrictive local config, uncapped SQLite usage history, and a redacted operational log. Existing pre-fabric 1Helm provider assignments migrate into compatibility routes on first start so current resident model names continue to resolve.

---

## Testing

```bash
node test/mock-openai.mjs 9099 &        # deterministic OpenAI-compatible provider
npm start &
node test/native-world.mjs             # 1Helm Channel Agent World acceptance (SPEC §12)
node test/pipeline.mjs                 # legacy provider/model/tool compatibility on migrated schema

# full browser UI test (optional)
npm i -D puppeteer && npx puppeteer browsers install chrome
node test/ui.mjs
```

### Agent-first JSON CLI

```bash
export HELM_URL=http://127.0.0.1:8123
export HELM_TOKEN='a 1Helm session token'
npm run helm -- channels
printf '%s\n' '{"channel_id":2,"body":"Own this outcome and verify it."}' | npm run helm -- message
printf '%s\n' '{"channel_id":2,"name":"Weekly evidence","prompt":"Audit the launch and publish a verified status.","interval_seconds":604800}' | npm run helm -- workflow-create
npm run helm -- audit-verify
```

## Security notes
- Passwords: scrypt. Sessions: random bearer tokens.
- On macOS, resident agents run inside separate Linux VMs created with `--home-mount none`; no resident is assigned the native "This Computer" endpoint. Workspace file mirrors remain channel-scoped and symlink-contained.
- Skipper's host-level tools are gated to Captain-authorized turns; escalations from resident agents carry the full invoking thread and record their outcome visibly.
- Public registration closes after the Captain account. The Captain adds later workspace members from Settings → Members.
- Collaboration sign-in and access-request endpoints are rate-limited. Coworker channel membership is server-side, and `Collab` is kept outside agent, computer, terminal, memory, and Files surfaces.
- JSON requests are bounded to 1 MB, uploads to 25 MB, and bearer sessions expire after 30 days.
- The embedded agent binds to `127.0.0.1` only.

## License
MIT

---

## Project governance

- Living product record: [`docs/VISION.md`](docs/VISION.md)
- How the repo is run: [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)
- Release process: [`docs/release-lifecycle.md`](docs/release-lifecycle.md) · checklist [`docs/release-checklist.md`](docs/release-checklist.md)
- Changes: [`CHANGELOG.md`](CHANGELOG.md) · maintainer notes [`CONTRIBUTING.md`](CONTRIBUTING.md)

**CI:** every PR and push to `main` runs typecheck, production build, and the
complete `npm test` contract.
