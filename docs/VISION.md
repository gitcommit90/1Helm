# 1Helm Vision & Build Record

This is the living product record for 1Helm. Add confirmed decisions, deployment findings, and completed slices here as the product evolves.

## Vision

**1Helm** productizes self-hosting. It gives someone who owns a computer or VPS a conversational control plane instead of requiring them to learn terminals, SSH, reverse proxies, Docker, and scattered SaaS dashboards.

The workspace is Slack-like, but channels are operational objects:

- People can create unlimited ordinary channels.
- Each deployed app gets a dedicated channel and a dedicated agent.
- App agents are scoped by their session/context so an app channel can focus on its own service.
- `@skipper` in `#main` is the chief of staff: the workspace-level assistant that coordinates the system.

The first compelling demo is simple: ask the workspace to make something useful, then open the resulting service from another device.

## Product decisions

- **Distribution, for now:** fully OSS and self-hosted. A user clones the repo onto their own Mac, PC, or VPS.
- **State:** chat and workspace state live on the user's machine in local SQLite.
- **AI:** users bring a provider: an OpenAI-compatible base URL/key, OpenRouter OAuth, or Login with ChatGPT. OpenRouter free models should be chosen automatically during onboarding rather than forcing a beginner to choose a model name.
- **Terminals:** optional. Users can turn the terminal workspace on during onboarding; it remains hidden unless enabled.
- **Apps:** channels are not apps by default, but every app always receives its own dedicated channel.
- **Isolation:** soft isolation initially. An app bot receives the context for its app/session rather than global workspace context.
- **Authority:** 1Helm defines agent capabilities through available tools. There is no separate refusal-policy layer in this phase.
- **First reference app:** Uptime Kuma, chosen instead of Jellyfin because it fits the current 2 GB demo VPS and exercises deploy, health, dashboard, and alert workflows.
- **Hosted product:** a managed VPS/control-plane offering remains a future layer; this repository is the on-box workspace runtime.

## Current architecture

The starting codebase is a compact Node/TypeScript application:

- Server: Node HTTP + WebSocket, direct TypeScript execution, SQLite via `node:sqlite`.
- Client: vanilla TypeScript bundled by esbuild with Tailwind CSS.
- Terminals: embedded Open-Terminal-compatible agent plus `node-pty`.
- AI: reusable providers, bots, thread/channel model routing, and bot-to-computer command access.

Development happens on the primary development machine. The private source repository is [`gitcommit90/1Helm`](https://github.com/gitcommit90/1Helm). The isolated fresh-user sandbox is the Hetzner VPS accessed with `ssh demo1helm`, publicly reachable at `http://167.233.229.141:8123` during early HTTP-only development.

## Cold-install baseline — 2026-07-10

The first fresh VPS install established the gap between a developer checkout and a consumer install:

1. Ubuntu 26.04 did not include Node/npm or Docker.
2. The Hetzner Ubuntu package mirror timed out while fetching dependencies; switching to Ubuntu's archive mirror allowed installation.
3. Ubuntu's Node 22 package was built without TypeScript stripping, so `node src/server/index.ts` failed with `ERR_NO_TYPESCRIPT`.
4. The official Node 22 binary from nodejs.org worked.
5. Plain `npm install` attempted Puppeteer's Chrome download and failed without `unzip`; `PUPPETEER_SKIP_DOWNLOAD=1 npm install` succeeded.
6. A global `upgrade-insecure-requests` CSP made browsers rewrite HTTP JS/CSS asset requests to HTTPS, resulting in a blank page. This was fixed in PR #1 by removing the unconditional HTTPS-upgrade policy.
7. The private GitHub repo needs a read-only deploy key on the test VPS.

These findings are inputs to a future `install.sh`, not user-facing requirements.

## Slice status

### Slice 0 — baseline and reachability

- Private `gitcommit90/1Helm` repository created.
- Fresh VPS cloned and started with official Node 22.
- Plain-HTTP asset loading repaired in PR #1.

### Slice 1 — 1Helm front door (in progress)

- User-facing rename from CTRL PANE to 1Helm.
- First-run setup wizard: account, AI provider, terminal preference, workspace name.
- `#main` and a preconfigured `@skipper` welcome message.

### Next slices

1. Consumer-grade installer and managed service startup.
2. App catalog and deployment lifecycle.
3. Uptime Kuma as the first app/channel integration.
4. HTTPS/tunnel and public route story.

## Known constraints

- **OpenRouter OAuth needs a secure browser context.** It works on `localhost` and HTTPS deployments. It cannot complete on the current plain `http://VPS-IP` test URL because Web Crypto is unavailable there. The fresh-VPS test can use an OpenAI-compatible provider or Login with ChatGPT until TLS/tunnel support exists.
- The current 2 GB VPS is appropriate for 1Helm and lightweight services; it is not a good Jellyfin/transcoding target.
- `@skipper` will not claim app deployment abilities until the app catalog/tools exist. Its first welcome should be honest about the current feature set and the direction of travel.
