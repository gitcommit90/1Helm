# 1Helm Vision & Build Record

This is the living product record for 1Helm. Add confirmed decisions, deployment findings, and completed slices here as the product evolves.

## Direction update — 1Helm native agent workspace (2026-07-18)

The product direction sharpened from "a chat app with configurable bots" into **1Helm**, the native agent workspace defined in `SPEC.md`. **1Helm is now the installed host/environment; 1Helm is the product that runs on it.** The one-sentence promise: *create a channel for anything, and it receives a persistent agent, a computer workspace, files, memory, and threads.*

This supersedes the earlier framing where "channels are not apps by default" and app-catalog/Uptime-Kuma work led the roadmap. The invariant model is now first-class:

- **Captain** — first user; workspace owner and final authority.
- **Skipper** — exactly one workspace-wide, root-capable chief of staff; lives in `#main`; the deliberate exception/escalation path.
- **Channel agent** — exactly one resident specialist per ordinary channel, bound immutably.
- **Participation boundary** — the normal channel is Skipper plus its resident specialist; other residents may be guests in one explicit thread without gaining channel workspace, memory, or ambient membership.
- **Skills and improvement** — Skipper owns the workspace-wide skill arsenal, provisions permanent purpose-aware kits, accepts reusable agent skill proposals, and silently reviews interaction signals for durable behavior improvements.
- **Memory** — every resident and Skipper has an isolated Mnemosyne database for long-term retrieval in addition to canonical 1Helm records.
- **Thread** — a durable session with status + rolling summary.
- **Workspace / Memory** — per-channel durable filesystem and provider-neutral knowledge that survive model/provider changes and restarts.

### Slice — Channel Agent World (shipped in this branch)

Implements SPEC §12 end-to-end. Key decisions:

- **Additive migration, not a rewrite.** `agents`, `agent_channels` (UNIQUE both columns), `agent_profiles`, `agent_capabilities`, `channel_workspaces`, `threads`, `thread_summaries`, `memory_items`, `artifacts`, `tool_actions`, `escalations`, and `channel_activity` were added. Each channel agent keeps a shadow `bots` row so the existing streaming/tool/provider runtime, model routing, and message attribution keep working unchanged. A one-time migration reconciles **every ordinary channel** to the one-resident-agent invariant (clones a shared legacy bot per extra channel, provisions a fresh agent for bot-less channels) and promotes/creates the single Skipper.
- **Atomic provisioning.** `POST /api/channels {name, purpose}` provisions the channel, resident agent, profile, capabilities, workspace tree (`workspace/ files/ state/ memory/ profile/`), ready announcement, initial thread/summary/memory, and activity record in one SQLite transaction; retry is idempotent and never yields duplicate residents.
- **Channel-scoped execution.** Resident `run_command` is CWD-locked to the channel's `/workspace` on the embedded local computer; terminals open there too, are owner+channel scoped, and their upstream PTYs are torn down on close/archive/delete. Workspace boundary is process-level for now with the abstraction kept explicit so container/VM isolation can slot in later (SPEC §7.2).
- **Durable sessions + memory.** Threads carry status/summary; agent context is assembled from profile + session summary + retrieved channel memory (framed as untrusted data with provenance) + artifact list + transcript. Continuity verified across model change and server restart.
- **Skipper escalation.** `@skipper` (human) and the resident `call_skipper` tool both route the full authoritative thread to the one workspace Skipper, which acts and records the outcome in the same thread; host-tool authority is gated to Captain-authorized invocations.
- **Lifecycle.** Archive pauses the agent world (cancels in-flight turns, closes terminals) while preserving everything; restore reuses the same identity/workspace/memory/threads without rewriting independently-set thread status; permanent deletion is Captain-only, requires the channel be archived + typed-name confirmation, uses a filesystem tombstone for crash-safety, and removes only the target world.
- **Native UX.** Create-channel asks name + "What is this channel all about?"; the channel header shows resident identity/status/model + Call Skipper; per-channel Chat/Threads/Files/Terminal/Memory/Activity/Settings tabs; Settings exposes editable purpose, replaceable model policy, capabilities, and lifecycle. The normal path never asks for a directory, memory backend, terminal backend, or bot-channel membership; the old "add a bot and wire it in" flow is demoted to a read-mostly Agents roster. Files are opened over an authenticated fetch (no unauthenticated content route).
- **Authorization hardening from adversarial review:** channel-scoped file/attachment authorization, symlink-escape containment via realpath, admin gating on bot-join / model-pref / terminal-open, and pre-auth PTY data-leak fix.

### Verification — 2026-07-18 (locally verified, pending VPS cold deploy)

- `npm run typecheck` and `npm run build` pass.
- New `test/native-world.mjs` (`npm run test:native`) passes **29/29**, cold-starting the server, provisioning two channel worlds, and asserting every SPEC §12 criterion plus regressions (symlink-escape rejection, archive cancelling in-flight turns, PTY teardown, authenticated Files content, thread-status preservation) — including a real server restart and DB/filesystem invariant checks.
- Legacy `test/pipeline.mjs` still passes **16/16** on the migrated schema.
- Headless-Chromium end-to-end pass through the real UI: cold onboarding → create-channel with purpose → resident identity/status → thread work → Files (authenticated open returns file; unauthenticated is 401) → channel-scoped Terminal cwd → Memory with provenance → Activity → model change preserving identity → Call Skipper answering in the invoking thread → archive/restore/typed-name delete. No unexpected console/page errors.
- **Not yet done:** VPS cold-deploy confirmation (standing fresh-wipe rule still applies), and stronger per-channel container/VM isolation (SPEC Phase 5).
- **Shipped to GitHub — 2026-07-18:** committed the native 1Helm Channel Agent World as `0513222` (`feat: native 1Helm channel-agent workspace (SPEC.md slice)`), pushed branch `worktree-1helm-native-spec`, and opened [draft PR #7](https://github.com/gitcommit90/1Helm/pull/7). The branch includes the specification, implementation, migration, verification skill, 29-case native acceptance test, adversarial-review fixes, and the successful real-browser evidence described above.
- **Completeness pass — 2026-07-18:** a final ultracode completeness audit (3 independent critics + synthesis) flagged where the legacy configurable-bot model still leaked into the user-visible product. All major/minor gaps were fixed in `f068c6c` and re-verified: (1) channel-agent `call_skipper` escalation now authorizes Skipper host tools (SPEC §6.3 primary scenario, previously untested/broken — new test case); (2) removed the user-facing add-bot-to-channel toast/join action and refused resident-agent joins; (3) replaced the per-bot Global/Channel/Thread model-routing popover with a native single-agent Session-model control; (4) rewrote README + package.json + settings copy to 1Helm language (1Helm = installed host); (5) workspace-scope memory is now retrievable across channels; (6) boot crash-recovery resets agents stuck `working` and sweeps empty placeholder turn messages (new SIGKILL test case); (7) restore preserves a legitimately waiting/failed agent's status. Final gates: typecheck + build clean, `npm run test:native` **32/32** (added escalation + crash-recovery cases), legacy `test/pipeline.mjs` 16/16, headless-Chromium end-to-end pass.


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
- **Channels (updated 2026-07-18):** every ordinary channel is an agent channel by default — it receives one resident agent, workspace, files, memory, and threads at creation (see the 1Helm direction update above). Apps remain a future capability that attach to the channel-agent model rather than a separate configuration surface.
- **Isolation:** soft (process-level) isolation initially. A resident agent works CWD-locked in its channel `/workspace`; the boundary abstraction is kept explicit so container/VM isolation can be selected later without changing the product model.
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
