<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-hero-dark.png">
    <img src="docs/assets/readme-hero-light.png" alt="1Helm — Intelligence should not be temporary. A permanent AI crew on your computer, with real memory." width="100%">
  </picture>
</p>

<p align="center">
  <strong>Intelligence should not be temporary.</strong><br>
  1Helm gives every job a permanent AI resident with its own private computer, durable memory,
  and real skills — so the agent you train today is better at the job tomorrow.
</p>

<p align="center">
  <a href="https://1helm.com/download/macos"><strong>Download for Mac</strong></a>
  &nbsp;·&nbsp;
  <a href="https://1helm.com/manual/install-windows"><strong>for Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="https://1helm.com/manual/install-linux"><strong>for Linux</strong></a>
  &nbsp;·&nbsp;
  <a href="https://1helm.com">The story</a>
  &nbsp;·&nbsp;
  <a href="https://1helm.com/manual">Ship's manual</a>
  &nbsp;·&nbsp;
  <a href="docs/VISION.md">Vision</a>
  &nbsp;·&nbsp;
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <code>AGPL-3.0-only</code>&nbsp;&nbsp;
  <code>Self-hosted</code>&nbsp;&nbsp;
  <code>Model-agnostic</code>&nbsp;&nbsp;
  <code>Apple signed + notarized</code>&nbsp;&nbsp;
  <code>macOS · Windows · Linux</code>
</p>

---

## The problem

Every AI chat you've ever had ends the same way: the context window fills, the
session dies, and everything the model learned fits on a sticky note addressed
to its replacement. One tab, one session, one race against the token timer.

That isn't a law of nature. It's a product decision — and 1Helm makes the
opposite one. Instead of renting intelligence by the session, you give each
ongoing job a **resident**: an agent with a stable identity, a persistent
private Linux computer, curated memory, and scheduled obligations that survive
restarts, model swaps, and closed laptops.

<p align="center">
  <a href="https://1helm.com">
    <img src="docs/assets/readme-story.gif" alt="The 1Helm story — a hand-drawn scrollytelling tour of the captain, Skipper, and a crew of resident agents" width="720">
  </a>
  <br>
  <sub>The whole story, as told at <a href="https://1helm.com">1helm.com</a> — click to scroll it yourself.</sub>
</p>

## The job is the durable unit

Create a channel for product, finance, research, home, support, or anything
else that deserves an owner. 1Helm provisions a complete world around it:

| Every ordinary channel receives | What that changes |
|---|---|
| **One permanent resident** | Threads are sessions; the employee identity survives them. |
| **One private Linux computer** | Chat tools and Terminal use the same persistent `/workspace`. |
| **Memory with provenance** | Decisions, corrections, preferences, files, and outcomes become continuity. |
| **A serious skill arsenal** | The agent sees what exists and loads a full procedure only when it chooses one. |
| **Durable obligations** | Follow-ups, timers, workflows, and services can wake the computer back up. |
| **Skipper at the boundary** | Host work, credentials, fleet operations, and cross-channel work route themselves. |

The human sets the outcome and brings judgment, taste, credentials, and real
authority. The resident inspects, installs, edits, runs, retries, waits, and
verifies inside its own world. When it needs something outside that world, it
calls Skipper directly. Skipper acts and returns the exact thread to the same
resident automatically.

**The Captain is the leader—not the package manager, retry loop, permission
dialogue, or message bus between agents.**

<p align="center">
  <img src="docs/assets/readme-workspace.png" alt="The real 1Helm workspace with a permanent product-launch resident and direct Skipper handoff" width="100%">
</p>

## A company, not a collection of chat sessions

```text
Captain                      1Helm
   │
   │  “Own the launch and ship the fix.”
   ▼
Resident ─── routine execution ───► private channel computer
   │                                      │
   │ needs host, credential,              │ files · tools · services
   │ or another resident                  │ memory · obligations
   ▼                                      │
Skipper ─── crosses the boundary ─────────┘
   │
   └──────── automatic return ─────► Resident verifies and finishes
```

- **Captain** is the first user, workspace owner, and final human authority.
- **Skipper** is the one workspace-wide chief of staff and host/fleet operator.
- **Residents** are permanent specialists, one per ordinary channel.
- **Threads** are durable sessions—not the agent's entire identity.
- **The computer, memory, skills, and obligations** belong to the channel and
  survive model changes and application restarts.

## Install

Whichever platform, it works best on a dedicated machine: your crew works
around the clock, and your everyday computer takes naps.

### macOS (Apple Silicon)

1. [Download the current signed DMG](https://1helm.com/download/macos).
2. Open it and drag **1Helm** to Applications.
3. Launch 1Helm. Gatekeeper verifies its Developer ID signature and Apple
   notarization ticket.
4. Complete Captain → Providers → Workspace. If required, approve Apple's
   signed container runtime once during workspace creation.

This OCI generation starts in `~/Library/Application Support/1Helm-OCI-v1`;
the retired data directory is left untouched and is never imported. Every
update preserves it — credentials, databases, resident state, files, and
workspaces. Profile → Check for updates asks the Mac running 1Helm—not the
device displaying the web UI—to download and verify the signed update.

### Windows 11 x64

There is nothing to download and no Windows application to install. 1Helm runs
its ordinary **Linux** build inside a WSL 2 distribution named `1helm`, and your
**browser is the interface**, at `http://localhost:8123`. Because no `.exe`
ships, nothing needs code signing and **SmartScreen never appears**.

You need: Windows 11 **x64** (arm64 is not supported), virtualization enabled in
firmware, internet access, and roughly 10 GB of free disk. **You do not need to
install WSL first** — this does it for you.

1. Open **PowerShell**. The normal one — do **not** use "Run as
   Administrator".

2. Run exactly this:

   ```powershell
   irm https://1helm.com/install.ps1 | iex
   ```

3. A Windows permission pop-up appears. Click **Yes**. That one approval covers
   only turning on Windows' WSL features and installing Microsoft's own WSL
   package; everything after it deliberately runs as you, because WSL state
   belongs to the signed-in user.

4. Wait about a minute. The window finishes by printing **"Restart required"**
   and a short numbered list. **This is normal — it is not an error and nothing
   is lost.**

5. Restart the PC.

6. Sign back in as the **same** Windows user and open PowerShell again.

7. Run the **identical command** a second time:

   ```powershell
   irm https://1helm.com/install.ps1 | iex
   ```

8. Wait about six and a half minutes. Pages of `apt` output scroll past — that
   is normal progress. When it is done it prints the address and opens your
   default browser on the onboarding page.

9. Complete Captain → Providers → Workspace in the browser.

The whole thing takes about **9 minutes**, restart included.

Two things you may see along the way:

- Microsoft's own **"Welcome to WSL"** window may open during step 8. It belongs
  to Microsoft, it is harmless, and you can close it.
- After 1Helm reports that it is running, the channel-computer runtime needs
  roughly another **40 seconds** to finish preparing before your first channel
  computer can be created. It has not hung.

If you *download* `install.ps1` instead of piping it, Windows blocks running
`.ps1` files and you must run it as
`powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`. The
`irm | iex` form above is unaffected, because it pipes a string rather than
executing a file.

One behaviour difference from earlier versions: **`#main`'s Terminal is now bash
inside the WSL distribution, not `cmd.exe`.** Windows commands do not work
there. That is deliberate — the host is Linux now.

To remove it later, from the same ordinary PowerShell window:

```powershell
irm https://1helm.com/uninstall.ps1 | iex
```

### Linux (Ubuntu/Debian, systemd)

Linux hosts run the same channel containers natively under Podman. The verified
installer provisions a durable systemd service with an atomic, digest-verified,
health-checked updater:

```bash
curl -fsSLo /tmp/1helm-install.sh https://1helm.com/install.sh
less /tmp/1helm-install.sh
sudo bash /tmp/1helm-install.sh
```

It requires root, systemd, apt, cgroup v2, and x86-64 or arm64 — see the
[Linux install guide](https://1helm.com/manual/install-linux).

### Removing 1Helm

Use **Settings → Admin → Prepare to remove 1Helm** first on any platform. It is
Captain-only, requires typed confirmation, and prepares backend-owned resident
machines for safe deletion. Export irreplaceable channel files before you start.

- **macOS** — drag 1Helm to the Trash. `~/Library/Application Support/1Helm-OCI-v1`
  is preserved unless you delete it yourself.
- **Windows** — from an ordinary PowerShell window, run
  `irm https://1helm.com/uninstall.ps1 | iex`. It stops the keepalive, runs
  1Helm's own Linux uninstaller inside the distribution, then unregisters the
  `1helm` distribution and deletes `C:\1helm` and the Start Menu shortcut. It
  asks you to type `remove` first, because unregistering the distribution
  **destroys every channel's files and the database** — there is no undo and no
  copy is kept. Other WSL distributions on the PC are never touched.
- **Linux** — `sudo /opt/1helm/uninstall-host.sh` removes the services, helper,
  and 1Helm-owned containers while preserving `/var/lib/1helm-oci-v1` for
  recovery.

### Release discipline

Mac and Linux use one synchronized desktop release version, and a release is
held in full until all three artifacts — the signed/notarized Mac DMG, the
notarized Mac updater ZIP, and the verified Linux host archive — have passed
native install and update acceptance from the same source commit. Windows ships
no release artifacts at all: it installs the Linux build through
`install.ps1`, served from the site, so there is nothing to sign and no
Authenticode status to disclose.

### Connect from a phone or tablet

The mobile apps are thin, native gateways to a 1Helm you already run. Install
and finish setup on a supported Mac, Windows, or Linux host first, give that
host an HTTPS address, then select that address in the app. The app loads the
selected instance's live frontend directly, so browsers, iPhone, iPad, and
Android always use the same current interface. Sign-in happens on that live
frontend; the password is never retained and the resulting session is stored
in the iOS Keychain or encrypted with a key held by Android Keystore.

- The native iOS and Android gateway source is included in this repository,
  but neither mobile platform has a current v0.0.38 public build. The most
  recent signed Android APK is the older v0.0.23 gateway, and 1Helm is not
  currently listed in the public iOS App Store. Use the HTTPS browser interface
  for the current v0.0.38 experience.
- The native clients require HTTPS, do not contain or initialize the 1Helm
  server or a frozen copy of its product frontend, and do not retain host data
  or provider credentials beyond the selected server address and secure
  session token. Native bridge access is restricted to that exact scheme,
  host, and port. Use **Disconnect** in the profile menu to erase both from the
  device.
- iPhone notifications are opt-in under **Settings → Notifications**. Device
  registration belongs to the signed-in account, per-channel mute still wins,
  and tapping an update opens its channel or thread. iOS camera and photo
  access is requested only after an explicit attachment action.

## Ready on day one. Specialized by day one hundred.

<p align="center">
  <img src="docs/assets/readme-skills.png" alt="1Helm Skills showing automatic built-in playbooks, skill learning, and a searchable external library" width="100%">
</p>

Every resident starts with a seven-skill operational core plus the focused
playbooks selected by its channel template. The shared workspace catalog still
contains 34 complete procedures covering outcome ownership, Skipper handoff,
obligations, skill discovery, memory, research, email, calendar, contacts,
messaging, documents, spreadsheets, PDFs, meetings, projects, personal
operations, travel, finance, support, software delivery, data, media,
infrastructure, security, and more.

The model receives a compact inventory of its assigned skills—not all 34
procedures in every prompt. It loads one complete skill when useful and can ask
Skipper for another catalog skill when the job expands. A resident can also:

- search the open SkillsMD registry directly, then inspect and install a
  selected GitHub-backed skill — only after immutable revision pinning,
  bounds, scanning, hashing, provenance storage, and runtime-authority
  wrapping;
- learn a workspace-specific procedure from your local sources, URLs, and
  notes through the visible **Learn a new skill** workflow;
- crystallize a successful real workflow into a complete reusable procedure —
  activation cues, authority boundaries, recovery, retained state,
  verification, and concrete completion evidence.

That last one is the point: work through your invoices together once, and the
resident doesn't just remember the fact — it writes itself the procedure.
**Train it once. It's trained.**

## One model fabric

<p align="center">
  <img src="docs/assets/readme-terminals.png" alt="Four built-in split-pane 1Helm terminals running Claude Code, OpenAI Codex, opencode, and Grok side by side on one workspace" width="100%">
  <br>
  <sub>Built-in split-pane terminals: one workspace, four panes, four different AI CLIs running side by side.</sub>
</p>

Connect multiple ChatGPT, Claude, Gemini/Antigravity, and xAI OAuth accounts;
OpenRouter, NVIDIA NIM, Cloudflare, GLM, and custom API keys; then enable exact
models and assemble fallback or round-robin routes. Model choice cascades —
Global → Channel → Session → Message — so you can swap engines mid-thread.

Changing a route never replaces the resident or discards its computer, memory,
skills, files, obligations, or thread history. **You're changing the engine,
not replacing the employee.**

Each signed-in workspace member connects their own OAuth accounts and API keys.
New accounts and routes are private to that member unless their owner explicitly
shares them with the workspace; shared accounts are usable but remain editable
only by their owner. The same fabric also exposes an authenticated OpenAI- and
Anthropic-compatible `/v1` endpoint for external tools, with separate revocable
keys per member.

## Connections without credential sprawl

<p align="center">
  <img src="docs/assets/readme-connections.png" alt="1Helm Connections showing a host-brokered Photon iMessage capability" width="100%">
</p>

Connections are host-owned brokers, not secrets copied into every resident's
shell. Gmail exposes scoped account listing, search, read, and draft creation;
sending remains disabled by default. Photon gives the Captain one direct line
to Skipper: every text stays in a private Texts thread until `/new`, and that
same context can continue on desktop without echoing desktop-only turns back to
iMessage. Provider, Gmail, and Photon credentials stay on the host.

New connection types have to earn their place with least-privilege scoping,
secret isolation, reconnect and recovery, deduplication, deterministic tests,
and an audit trail. A prompt saying “use this service” is not a connector.

## What ships now

- Captain → Providers → Workspace onboarding on every supported host.
- Exactly one resident for every ordinary channel and one Skipper in `#main`.
- A persistent, fully isolated Linux computer per ordinary channel on every
  supported platform (exact contracts in the table below).
- Shared channel `/workspace` for the agent command surface and human Terminal,
  with automatic terminal heartbeat and silent same-session reconnection.
- A traditional two-pane Files browser over that same `/workspace`, with
  breadcrumbs, nested folders, search, sorting, distinct file-type icons, and
  familiar create, rename, move, duplicate, delete, upload, and download actions.
- Cowork as the direct visual editing plane for `/workspace/notes`,
  `/workspace/whiteboards`, `/workspace/code`, `/workspace/docs`, and
  `/workspace/presentations`, with one consistent file rail, live collaborative
  text editors, embedded whiteboard and slide canvases, and an optional
  channel-agent panel with live work status and per-file session history.
- Cowork Code can preview an HTML file with its same-project CSS and JavaScript
  in a sandbox; agent-created files appear without a reload, and folders open
  directly from the shared rail.
- Presentations define a visible, locked printable area (1500 × 1000 by
  default), allow custom page dimensions, and export the complete bounded slide
  deck as one multi-page PDF while excluding work outside each page. Simple
  agent-generated decks receive a themed, wrapping, content-aware layout.
- Quick Note in the top bar for capturing a Markdown note into
  `/workspace/notes` without leaving or repositioning the current channel view.
- Durable files, threads, curated memory, Mnemosyne long-term recall,
  corrections, follow-ups, and recurring workflows.
- Direct resident → Skipper escalation and automatic Skipper → resident return.
- Outcome-first Activity with expandable work evidence and a tamper-evident
  SHA-256 chain for new operational events.
- Local-first collaboration through an optional workspace domain routed to the
  Captain's helm host; workspace state and provider credentials remain there.
- Host-owned updates: a signed native Mac updater, and an atomic digest-verified
  Linux system service with health-check rollback — which is also how a Windows
  host updates, because Windows runs that same Linux service inside WSL.
- Signed, Apple-notarized, stapled Apple Silicon DMG releases.
- Browser access from phones and tablets to an already configured HTTPS 1Helm
  host; native mobile gateway source is present but has no v0.0.38 public build.

### Platform truth

| Platform | Current contract |
|---|---|
| **Apple Silicon macOS 26** | Native desktop product and real isolated Linux computer per resident (Apple `container machine`, `home-mount=none`). |
| **Linux / CI** | Supported headless systemd host with one durable Podman OCI container per resident, runtime-owned storage, and exact ownership checks; CI may select an explicit test backend. |
| **Windows 11 x64** | The Linux host, installed by `install.ps1` into a WSL 2 distribution named `1helm`, with the browser as the interface at `http://localhost:8123`. One durable Podman OCI container per resident, exactly as on Linux. No Windows application ships. |
| **iPhone, iPad, and Android** | Use the current HTTPS browser interface. Native gateway source exists, but v0.0.38 has no public mobile artifact and the iOS app is not publicly listed. |

Not yet shipped: current public mobile builds, a native Linux desktop shell, a
hosted control plane, rich Photon attachment fidelity, or blind execution of
community skills.

## Run the source workspace

For development or a source deployment outside the verified platform
installers, use Node 22:

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm install
npm run build
npm start                 # http://127.0.0.1:8123
```

A fresh data directory opens first-run setup. The source runtime defaults to
`./data`; do not point development at an existing production data directory.

### Core configuration

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `8123` | HTTP/WebSocket control-plane port. |
| `CTRL_DATA_DIR` | `./data` | Databases, routing state, uploads, and non-OCI development/Apple workspace mirrors. |
| `HELM_CHANNEL_COMPUTER_BACKEND` | `apple` on macOS, `oci` on Linux and Windows | Host isolation backend; `native` and `mock` are explicit development/test overrides. |
| `HELM_CHANNEL_MACHINE_IMAGE` | `local/1helm-channel-machine:0.0.40` | Versioned channel-machine image contract. |

### Agent-first JSON CLI

```bash
export HELM_URL=http://127.0.0.1:8123
export HELM_TOKEN='a 1Helm session token'

npm run helm -- channels
printf '%s\n' '{"channel_id":2,"body":"Own this outcome and verify it."}' \
  | npm run helm -- message
printf '%s\n' '{"channel_id":2,"name":"Weekly evidence","prompt":"Audit the launch and publish a verified status.","interval_seconds":604800}' \
  | npm run helm -- workflow-create
npm run helm -- audit-verify
```

## Architecture

1Helm is a compact Node/TypeScript control plane hosted by Electron on macOS, or
by systemd on Linux — including the Linux inside a Windows host's WSL 2
distribution. It does not need an external database or a server transpilation
step.

| Layer | Implementation |
|---|---|
| Runtime | Official Node 22 with native TypeScript stripping. |
| Control plane | `node:http`, WebSocket, additive SQLite migrations. |
| Client | Vanilla TypeScript bundled with esbuild and Tailwind CSS. |
| Model routing | Embedded ReRouted headless engine, private internal gateway, account pools, retries, routes, quotas, and logs. |
| Computers | Defensive argv-only Apple `container machine`; native Podman OCI on Linux, including inside a Windows host's WSL 2 distribution; explicit `native`/`mock` test seams. |
| Terminal | `node-pty`; ordinary terminals enter their channel VM while Skipper remains native. |
| Memory | Curated records with provenance plus an isolated Mnemosyne SQLite store per identity. |
| Scheduling | Durable obligations, wake reconciliation, lifecycle safety, repair, update, and pressure-aware sizing. |
| Desktop | Sandboxed Electron renderer, ephemeral loopback server, persistent host data, and native wake/update integration on supported desktop hosts. |

Start with [`docs/VISION.md`](docs/VISION.md) for the product record and
[`docs/architecture`](https://1helm.com/manual/architecture) for the readable
system tour. [`SPEC.md`](SPEC.md) is the detailed behavioral contract.

## Verification

Agent turns follow a documented
[durability and reliability contract](docs/RELIABILITY.md): per-thread
concurrency, generation-fenced single-writer responses, restart-safe queues,
durable connector delivery, narrow human blockers, and adversarial release
acceptance tests.

```bash
npm run typecheck
npm run build
npm test
npm run test:onboarding-browser
npm run benchmark:autonomy
```

The autonomy benchmark emits deterministic machine-readable JSON covering the
shipped skill arsenal, compact capability map, narrow human-blocker boundary,
resident autonomy tools, wakeable recurring work, and audit-chain invariants
for its fixture. It is deliberately not presented as a live-model success rate
or a complete security score.

Every pull request and push to `main` runs typecheck, a production build, and
the complete `npm test` contract.

## Security boundary

- Residents use separate Linux worlds: Apple machines with no Mac home mount, or
  durable OCI containers on Linux — including the Linux inside a Windows host's
  WSL 2 distribution.
- Skipper's host tools require Captain-authorized provenance.
- OCI workspace storage is runtime-owned and authoritative; Files and Cowork
  access it directly through a channel-scoped boundary. Apple mirrors remain
  size-bounded and symlink-contained.
- Provider and connection credentials stay in host-owned storage.
- Registration, sessions, JSON bodies, uploads, collaboration access, and
  gateway keys are bounded and independently controlled.
- New operational events enter an append-only hash chain. This is
  tamper-evident retained history, not a remotely witnessed transparency log.

See [`SECURITY.md`](SECURITY.md) and the
[security model](https://1helm.com/manual/security-model) for the full boundary and current
dependency debt.

## Project record

- Product direction: [`docs/VISION.md`](docs/VISION.md)
- Complete user guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Release lifecycle: [`docs/release-lifecycle.md`](docs/release-lifecycle.md)
- Release checklist: [`docs/release-checklist.md`](docs/release-checklist.md)
- Governance: [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)
- Terms & privacy: [1helm.com/terms](https://1helm.com/terms) · [1helm.com/privacy](https://1helm.com/privacy)
- Company contact: [`build@1helm.com`](mailto:build@1helm.com)

---

<p align="center">
  <img src="public/brand/1helm-sailboat.png" alt="1Helm sailboat" width="72" height="72"><br>
  <strong>Let them cook. Keep the helm.</strong><br>
  <sub>1Helm · AGPL-3.0-only · Copyright © 2026 Joseph Yaksich</sub>
</p>
