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

- **First-run wizard** — create the Captain account, connect an AI brain, choose terminal visibility, name the workspace, land in `#main` with Skipper.
- **Create a channel** — name it and describe what it's for. 1Helm atomically provisions its resident agent, computer workspace (`/workspace`), files, memory namespace, and model policy — no bot wiring or directory setup.
- **Resident agents** — one durable specialist per channel; shell commands and files stay in that channel's `/workspace`; curated decisions, facts, preferences, and artifact references are retained across threads, model changes, and server restarts. Session recaps remain in Threads rather than being mislabeled as Memory.
- **Hermes-style skill arsenal** — a useful suite ships in the workspace, including approachable self-hosting guidance. Skipper has the complete catalog. New agents receive a purpose-aware permanent starter kit, know every unassigned skill they can request, and can propose reusable skills that Skipper approves into the shared arsenal.
- **Mnemosyne memory per identity** — Skipper and every resident agent own a distinct local Mnemosyne SQLite database. Curated knowledge and completed session outcomes feed long-term retrieval; memory never collapses to a profile Markdown file.
- **Growing templates** — start from a Blank slate, Project, Research, Home, or Inbox role. These are lightweight starting kits; the resident keeps learning preferences, receiving skills, and improving with the user.
- **Stable channel URLs** — channel tabs and threads have durable slug routes such as `/c/product-launch/memory` and `/c/product-launch/thread/42`.
- **Cloudflare custom domains** — onboarding and Settings → Domains create a named tunnel, DNS route, HTTPS hostname, and persistent service from a one-time token that is never stored.
- **Silent improvement reviews** — Skipper periodically examines recent interaction signals, adds durable behavior guidance after missed corrections or frustration, and leaves a concise Activity note.
- **Thread-only expert guests** — the ordinary channel stays Skipper plus its resident expert. Skipper may invite another resident into one thread; the guest is never added to the channel and receives neither its workspace nor memory.
- **Skipper escalation** — `@skipper` (or a resident agent's `call_skipper`) routes the full invoking thread to the one workspace Skipper, which can take the broader action and records the outcome in that same thread. Skipper hands work back with `call_agent` so the resident finishes without the Captain re-tagging.
- **Channel-native UI** — per-channel Chat, Threads, Files, Terminal, Memory, Activity, and Settings. The header shows the resident agent's identity, status, and serving model; a `Call Skipper` affordance is always one click away.
- **Lifecycle** — archive pauses an agent world (cancels in-flight work, closes terminals) while preserving everything; restore reuses the same identity, workspace, memory, and threads; permanent deletion is Captain-only with typed-name confirmation.
- **Unified model fabric** — connect ChatGPT, Claude, Antigravity/Gemini, and xAI OAuth accounts; OpenRouter, NVIDIA NIM, Cloudflare, GLM, or custom API keys; pool multiple accounts; enable exact models; create fallback or round-robin routes; and use all of them inside 1Helm or through one `/v1` endpoint.
- **Local operations** — request activity, token usage, account attribution, supported subscription quotas, redacted routing/OAuth logs, and revocable gateway keys live in Settings → Providers. Changing a model or route never replaces an agent or discards channel-owned state.
- **Channel terminals** — optional. Each channel's Terminal opens directly in that agent's `/workspace`; its screen and server session survive tab navigation and page reload, and sessions are owner- and channel-scoped and torn down on archive/delete.
- **Scoped Gmail handoff** — when Gmail OAuth accounts already exist on the 1Helm host, Captain-authorized Skipper can grant a resident account-specific search/read/draft access without exposing tokens. Sending remains disabled by default.

Not yet shipped: stronger per-channel container/VM isolation (process-level boundary today, abstraction kept explicit), an app catalog and one-click deploy, and a consumer installer. The legacy "configure a bot and add it to a room" flow is retained only as migration compatibility for existing installs and is not the normal product path.

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
2. Connect an AI provider.
3. Choose whether channel terminals are visible.
4. Name the workspace.
5. Land in `#main` with Skipper, then create your first agent channel.

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8123` | HTTP/WebSocket port. |
| `CTRL_DATA_DIR` | `./data` | SQLite DB + channel workspaces + uploaded files (internal path name kept for compatibility). |

On first boot 1Helm starts a private loopback Open-Terminal agent and registers it as **"This Computer"** so resident agent shells and channel terminals work.

### Dev mode

```bash
npm run watch:js   # terminal 1
npm run watch:css  # terminal 2
npm start          # terminal 3
```

### Desktop-app feel

```bash
google-chrome --app=http://localhost:8123
```

---

## Architecture

Compact Node/TypeScript app — no Electron, no server transpile step:

| Piece | How |
|---|---|
| **Runtime** | Official Node 22 runs server TypeScript directly (native type-stripping). |
| **Database** | `node:sqlite` — workspace state plus uncapped routed-usage history; no external DB. |
| **Server** | `node:http` + `ws`. |
| **Client** | Vanilla TypeScript via esbuild + Tailwind CSS. |
| **Terminals** | `node-pty` + embedded Open-Terminal-compatible agent. |

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
Every resident agent works in its channel's `/workspace` on the embedded "This Computer". Channel terminals open there too, are scoped to the user and channel, and are torn down on archive or delete. The execution boundary is process-level for now; the abstraction is kept explicit so container/VM isolation can be selected per deployment later without changing the product model. Skipper has workspace-wide authority; host-level action is gated to Captain-authorized invocations.

### Admin
First user is the Captain (admin). The Captain manages workspace name/photo/theme, the Cloudflare domain, providers, members, channel lifecycle, and Skipper. The normal path never asks anyone to choose a directory, memory backend, terminal backend, or bot-channel membership.

### Providers, routes, and the shared endpoint

Settings → Providers is 1Helm's native control plane for all model access. Connected accounts and API keys immediately populate channel and thread model pickers. Standard-provider routes select provider + model and try every eligible account in that provider pool before moving to the next fallback member; custom OpenAI-compatible connections remain connection-specific.

Named routes can use ordered fallback or round-robin starting positions. The same direct model IDs and route names are exposed at the workspace's `/v1` base URL for external OpenAI- or Anthropic-compatible tools. Supported endpoints are model discovery, Chat Completions, Responses, Anthropic Messages, and Anthropic token counting. Gateway keys are separate from 1Helm login sessions and can be created, disabled, copied, and revoked independently.

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

## Security notes
- Passwords: scrypt. Sessions: random bearer tokens.
- Resident agents run shell commands CWD-locked in their channel `/workspace`; workspace file access is channel-scoped and symlink-contained.
- Skipper's host-level tools are gated to Captain-authorized turns; escalations from resident agents carry the full invoking thread and record their outcome visibly.
- Public registration closes after the Captain account. The Captain adds later workspace members from Settings → Members.
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

**Local directory naming:** the GitHub repository is `1Helm`. Some maintainer hosts still use a historical folder name `ctrl-pane` for the same remote — treat that path as a clone of this repo, not a different product. New clones should use `1Helm` as the directory name.

**CI:** every PR and push to `main` runs typecheck, production build, and `test/pipeline.mjs`.
