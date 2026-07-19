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

### VPS deploy rule (standing order)
The demo VPS is a **fresh-user sandbox**. Every deploy/update there is a cold first-run by default:

1. Pull the target branch
2. Wipe `/root/1helm/data`
3. Rebuild and restart
4. Confirm `/api/setup/status` reports `needs_setup: true` with no users/providers

Preserve VPS state only when the product owner explicitly says so. Use `scripts/deploy-vps-fresh.sh`.

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

### Slice 1 — 1Helm front door

- User-facing rename from CTRL PANE to 1Helm.
- First-run setup wizard: account, AI provider, terminal preference, workspace name.
- `#main` and a preconfigured `@skipper` welcome message.
- Wizard UX repair (`b7bdcaf`): scroll-safe layout, tested custom-provider model selection, async click locks.
- Visual redesign (quiet monochrome): no gradients, no purple/green provider badges, centered single-column surface, thin progress bar, neutral marks for OpenRouter/ChatGPT/API.
- Standing VPS rule: always redeploy as a wiped first-run unless told to preserve state.
- **Confirmed public cold-install deployment — 2026-07-10:** deployed `worktree-fix-http-assets` at commit `3fec1d3` to `http://167.233.229.141:8123` using `scripts/deploy-vps-fresh.sh`. The wipe was verified from the public endpoint: `needs_setup: true`, `has_users: false`, `setup_complete: false`, and `provider_count: 0`. This URL must open at **Create the owner account** until someone completes the wizard.
- **Product-record operating rule:** before reporting any completed implementation, verification, VPS deployment, or material product decision, update this document with the confirmed result. The record update is part of completing the work, not a later cleanup task.
- **README rewrite — 2026-07-10:** `README.md` now leads with the 1Helm product vision (self-hosting control plane, channels as operational objects, `@skipper` as chief of staff), current shipped surface, honest not-yet-shipped list, cold-install notes, and the VPS fresh-deploy rule. The completed scan found no remaining `CTRL PANE`, `CTRL-PANE`, `Slack clone`, or `agent cockpit` framing in the README.
- **Ship rule — 2026-07-10:** local work is not delivered until it is committed and pushed to the private GitHub branch/PR (`worktree-fix-http-assets` / PR #1). Reporting local file edits as “done” without push is a process failure; finish means GitHub reflects the result.
- **README/product-record shipped — 2026-07-10:** committed and pushed the README rewrite, public fresh-deploy record, and asset-stamp update as `c3d75e4` (`docs: align README with 1Helm vision`) to [draft PR #1](https://github.com/gitcommit90/1Helm/pull/1). The follow-up product-record commit carries this shipping confirmation.
- **Release-state resolved — 2026-07-10:** PR #1 was marked ready and merged into `main` as merge commit `4887e0d`. GitHub’s default branch now contains the 1Helm product vision, README, onboarding, fresh-deploy rule, and product record.

- **Public README hygiene — 2026-07-10:** removed the Demo VPS / sandbox / private-deploy section from `README.md`. Public-facing docs must not publish private VPS hostnames, IPs, SSH aliases, or internal wipe/deploy procedure. Those stay in this product record and operator tooling only.
- **VPS state check — 2026-07-10:** the public sandbox was found **not fresh**: direct `GET /api/setup/status` reported `needs_setup: false`, `has_users: true`, `setup_complete: true`, workspace `1HelmDemo`, `terminals_enabled: true`, and `provider_count: 1`. It retained a completed workspace and existing login/session state.
- **Confirmed cold redeploy — 2026-07-10:** after an explicit owner request, deployed `main` with `scripts/deploy-vps-fresh.sh`, discarding only a generated `public/index.html` stamp that had blocked the VPS branch checkout. The live public endpoint now reports `needs_setup: true`, `has_users: false`, `setup_complete: false`, and `provider_count: 0`; title is `1Helm`, and index/CSS/JS each return HTTP 200. This is a real fresh first-run until someone completes onboarding.
- **Visual identity overhaul — 2026-07-10 (locally verified):** replaced the generic AI/Slack-clone surface with a graphite and teal precision-instrument system across the workspace, Settings, terminal chrome, sign-in, and four-step first-run wizard. The user-supplied transparent PNG logo is now the browser favicon and the real 1Helm mark in auth, sidebar, and onboarding. The old purple numeral tile, Slack-purple sidebar, robot-emoji/gradient bots, rainbow identity palette, and OR/GPT text tiles are removed; bots now use a helm-derived agent mark and providers use icon marks. `npm run typecheck`, `npm run build`, and a separate cold `CTRL_DATA_DIR` browser smoke test passed: logo/CSS/JS all returned HTTP 200 and `/api/setup/status` reported a pristine first-run (`needs_setup: true`, no users/providers). Pending ship: commit, push, merge, wiped VPS reinstall, and public cold-install confirmation.
- **End-to-end visual verification — 2026-07-10:** a newly wiped local data directory was exercised in Chromium from the real first-run surface through all four onboarding stages. A mock OpenAI-compatible endpoint returned two models; the selected provider was saved, terminal access was enabled, and workspace completion rendered `#main` with the new logo, `AGENT` chip, teal token system, and `@skipper` welcome. The interactive check then posted a message, toggled light/dark, opened Settings (including the saved provider/models), and mounted the live terminal. `/`, `/app.css`, `/bundle.js`, and `/brand/1helm.png` each returned HTTP 200; the browser emitted no console or page errors. The same server was first confirmed cold with no users or providers.
- **Confirmed visual cold deployment — 2026-07-10:** merged the visual identity overhaul in PR #2 (merge commit `d93fa30`) and redeployed `main` with a forced cold restart. The public endpoint at `http://167.233.229.141:8123` now reports `needs_setup: true`, `has_users: false`, `setup_complete: false`, and `provider_count: 0` on commit `4b9e399`. A public Chromium session rendered **Create the owner account** with title `1Helm`, the new `/brand/1helm.png` mark (`image/png`), no legacy CTRL PANE / Slack-clone copy, no purple numeral tile, and no console/page errors. `/`, `/app.css`, `/bundle.js`, and `/brand/1helm.png` each returned HTTP 200.
- **Fresh-deploy restart fix — 2026-07-10:** the previous `scripts/deploy-vps-fresh.sh` stop step only pidfile-killed and then `pkill`ed an absolute `$REMOTE_DIR/src/server/index.ts` path. Node’s argv is relative (`src/server/index.ts`), so an old completed-workspace process could keep port `8123` and answer `/api/setup/status` after the data wipe. The helper now hard-stops the listener on port `8123` and refuses to continue if the port remains occupied. PR #4 merged this repair as `f0b4cfe`; the fixed helper was then run against `main`, restarting the listener and yielding a final public verification of `needs_setup: true`, no users/providers, correct 200 assets, and the real first-run browser surface.

### Next slices

1. Consumer-grade installer and managed service startup.
2. App catalog and deployment lifecycle.
3. Uptime Kuma as the first app/channel integration.
4. HTTPS/tunnel and public route story.

## Known constraints

- **OpenRouter OAuth needs a secure browser context.** It works on `localhost` and HTTPS deployments. It cannot complete on the current plain `http://VPS-IP` test URL because Web Crypto is unavailable there. The fresh-VPS test can use an OpenAI-compatible provider or Login with ChatGPT until TLS/tunnel support exists.
- The current 2 GB VPS is appropriate for 1Helm and lightweight services; it is not a good Jellyfin/transcoding target.
- `@skipper` will not claim app deployment abilities until the app catalog/tools exist. Its first welcome should be honest about the current feature set and the direction of travel.

## Repository governance — 2026-07-19

Formal maintainer process is defined in-repo:

- `docs/GOVERNANCE.md` — authority, branch model, quality bar, naming (`1Helm` vs local `ctrl-pane`)
- `docs/release-lifecycle.md` + `docs/release-checklist.md` — PR → CI → version → deploy verify
- `CHANGELOG.md` — Keep a Changelog
- GitHub Actions workflow `.github/workflows/ci.yml` on `main` and PRs
- Draft feature work (native 1Herd on `worktree-1herd-native-spec`) stays off `main` until its own verification bar is met; it must still follow the same PR template and changelog discipline when merged

Standing order unchanged: demo VPS is cold-first-run unless the product owner preserves state explicitly.
