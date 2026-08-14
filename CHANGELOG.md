# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.6] - 2026-08-14

### Fixed

- Expanded agent work logs preserve their exact inner scroll position as new
  thoughts and tool results arrive, while keeping the complete loaded history
  visible throughout live updates.
- Scheduling a durable follow-up now finishes and retains the current agent
  message and work log in its thread, so the next wake continues from the work
  already completed instead of starting the original request over.

## [1.0.5] - 2026-08-14

### Changed

- The initial interface is substantially smaller and faster: heavyweight
  Cowork, terminal, routing, settings, avatar, speech, and dialog features load
  only when opened, while a strict client performance budget prevents the
  critical path from silently growing again.
- Startup now uses one compact, viewer-scoped bootstrap response and fetches
  channel details, older sessions, and complete work logs only when needed.
- Generated JavaScript, CSS, fonts, and other static assets are precompressed
  with Brotli and gzip and served directly with durable cache validators.
- Repeated UI work is bounded and shared: initial message rendering is capped,
  message-collapse observation is batched, cached workspace surfaces are
  reused, and native/mobile integration loads concurrently.
- Avatar and workspace images are delivered as cacheable authenticated assets
  instead of repeatedly embedding large image payloads in ordinary JSON.
- SQLite hot paths now have direct message-parent and attachment-message
  indexes, and server views batch related counts and metadata instead of
  issuing repeated per-item queries.

### Fixed

- The channel hamburger and channel name remain visible through the 640–767px
  tablet layout gap. The hamburger is available at every channel viewport and
  always opens the channel drawer; tablet landscape still keeps its full
  sidebar layout.

## [1.0.4] - 2026-08-12

### Fixed

- Opening Files in a large resident workspace no longer blocks every channel,
  thread, or health request while recursively walking dependency and cache
  trees. Files now loads one bounded directory at a time, upgrade cleanup
  removes obsolete auto-indexed metadata while preserving uploads and explicit
  attachments, and ordinary shell commands no longer rebuild that metadata.
- Channel history no longer repeats the same inline profile photo in every
  message. The client reuses the user and agent records it already loaded,
  keeping channel switches fast on bandwidth- or latency-sensitive links.
- SQLite write durability, read receipts, checkpoints, and fleet reconciliation
  no longer put avoidable synchronous storage pressure on foreground requests.
- Denied service-user `sudo` calls no longer start mail delivery processes that
  can retry forever inside the hardened Linux service sandbox.

## [1.0.3] - 2026-08-10

### Added

- Every agent channel now has a dedicated Workflows tab. Workflows and their
  chronological run histories live there exclusively; selecting a run opens its
  normal thread in the side panel.
- Channel residents can text the configured Captain phone directly through
  Photon after the Captain grants durable permission for that channel. The
  runtime owns the permission prompt, grants are revocable in Channel Settings,
  and every outbound text identifies the sending agent.

### Fixed

- Expand Message, work-log, thinking, and tool disclosures remain clickable
  while an agent is streaming instead of being replaced before a click can land.
- One-finger vertical drags scroll terminal history on mobile layouts.

## [1.0.2] - 2026-08-10

### Added

- Cowork Notes and Docs now edit as rendered documents with toolbar
  formatting; storage and collaboration remain plain Markdown for agents.

### Fixed

- Cowork no longer duplicates a document's text when its only editor's
  connection silently drops and reconnects (laptop sleep, frozen background
  tab, host restart).
- Host update checks cache the GitHub release lookup, poll far less often,
  and explain GitHub rate limiting instead of surfacing a raw HTTP error.
- Model pickers keep each custom/OpenAI-compatible provider individually
  selectable instead of collapsing them into one "Custom" group. Branded
  provider families still pool all connected accounts into one entry.

## [1.0.1] - 2026-08-07

### Fixed

- The Mac release now builds and verifies its browser bundle and stylesheet
  before signing. Version 1.0.0 omitted those generated files, so the server
  returned the HTML fallback for `bundle.js` and the interface could not load.

## [1.0.0] - 2026-08-07

### Added

- Skipper can send an explicitly authorized text to the configured Captain
  through Photon, including durable one-shot reminders that wake later.

### Changed

- Releases now have one job: prove that the exact public files install, report
  the intended version, start, and answer health on Linux, Windows through WSL
  2, and Apple Silicon Mac. The candidate/evidence/update/rollback/promotion
  matrices and duplicate aggregate failures are gone.
- Release files go directly to one draft GitHub Release instead of making
  repeated round trips through temporary Actions artifacts. The Mac packager
  resumes its pinned Cloudflare download and stops quickly on a stalled link.

### Fixed

- Human-uploaded files in Linux OCI channels now remain readable to the
  resident agent instead of inheriting a service-owned `0600` mode that denied
  access through `/workspace/files`.

## [0.0.41] - 2026-08-03

### Fixed

- Linux host updates failed and rolled back. `install-linux-units.sh` wrote the
  systemd unit files with `install /dev/stdin`, which works from an operator
  shell (every fresh install) but fails with ENOENT under `systemd-run` — the
  only context the update path uses — so the transaction aborted and correctly
  restored the prior release. Each unit file is now written via a temp file. A
  fresh install was never affected; the fix is required for updates to succeed.


## [0.0.40] - 2026-08-03

### Fixed

- Clicking a channel or a thread no longer takes seconds. The server made
  subprocess calls synchronously on the only thread that serves HTTP, so every
  request queued behind them. Sampling a trivial endpoint that normally answers
  in 1 ms recorded stalls of 2.9 s, 3.2 s and 21.2 s while the interface was in
  use — the click was never slow, it was waiting in line.
  - Durable memory shelled out to its Python bridge with `execFileSync`,
    blocking the event loop for the whole call: a 20-second timeout for most
    operations, 120 seconds for transcript sync, and a 771 ms floor just to
    import the embedding libraries. The 21.2 s stall was that timeout. It is now
    asynchronous, along with the runtime probes it depends on, which turned out
    to be reachable from the first memory operation on a request path rather
    than only at setup.
  - Runtime readiness ran a synchronous container-image check on request
    handlers including `/api/computers`, costing 53–73 ms of blocked event loop
    every time. Readiness is now cached with a short time-to-live and refreshed
    out of band, with one shared refresh so concurrent requests cannot cause a
    subprocess storm. Endpoints that act on readiness — setup completion and
    runtime start or prepare — await a fresh check rather than trusting the
    cache, and image preparation updates it directly so a stale result cannot
    persist.
  - A channel interaction inspected the same container twice in a row; the
    redundant call is gone.

  This was the same defect that froze the Windows interface before 0.0.39. That
  release removed the boundary those calls crossed without removing the
  blocking, so Linux and macOS kept paying it.


## [0.0.39] - 2026-08-03

### Changed

- **Windows no longer ships an application.** 1Helm on Windows now runs the
  ordinary Linux build inside a WSL 2 distribution and serves its interface to
  the browser at `http://localhost:8123`. Install it with one command in an
  ordinary PowerShell window:

  ```powershell
  irm https://1helm.com/install.ps1 | iex
  ```

  There is no Electron host, no Squirrel installer, no `.exe`, and therefore
  nothing to code-sign — so SmartScreen never appears. Windows publishes no
  release artifacts; the desktop matrix is now three files (macOS DMG, macOS
  updater ZIP, Linux archive), and the Linux archive serves both Linux and
  Windows.
- Windows setup asks for administrator approval once, to enable the WSL 2
  optional features and install Microsoft's digest- and signature-verified WSL
  package. Everything else — importing the distribution, installing 1Helm,
  registering the keepalive — runs as the signed-in user, because WSL state is
  per-user.
- Windows requires one restart partway through setup, which Windows itself
  demands before WSL 2 becomes usable. Setup reports that as a restart with
  numbered steps rather than a failure, and re-running the same command
  continues from where it stopped.
- `#main`'s terminal on Windows is now bash inside the distribution rather than
  `cmd.exe`, matching Linux.
- Removing 1Helm from Windows is `irm https://1helm.com/uninstall.ps1 | iex`.

### Fixed

- Windows file operations are roughly four times faster. Every channel storage
  operation previously crossed the Windows-to-WSL boundary through
  `wsl.exe`, costing a flat ~208 ms per call — measured at 281 ms versus 73 ms
  for the same work without the crossing. Those crossings no longer exist,
  because the server now runs inside the distribution.
- The Windows interface can no longer freeze. Those boundary crossings were
  synchronous calls on the Electron main thread, which is the thread Windows
  requires for its message pump, so a file listing could stall the window past
  the five seconds after which Windows reports "not responding". There is no
  longer a window to freeze: the browser waits on an HTTP request instead.
- Linux and Windows installs no longer build 1Helm on the target machine. The
  release archive now ships production dependencies and prebuilt assets, with
  native addons compiled against an older glibc and verified on arrival by
  loading each one and checking its Node ABI. A cold install went from 8m49s to
  3m40s, and no C/C++ toolchain is installed on the host any more.
- The Linux installer no longer reports success when another process holds port
  8123. Its readiness check required only that something answered, which a
  foreign listener satisfies; it now also requires the unit to be active, and
  refuses to start when the port is already taken.
- A version mismatch between installer and archive failed silently after
  several minutes of work. It now names both versions and states that nothing
  was installed.
- The website no longer requires a Windows Setup executable, `.nupkg` and
  `RELEASES` to exist before it will serve release metadata. That requirement
  backed the endpoint the Linux installer resolves, so the first release
  without those files would have broken the public Linux and Windows
  installers simultaneously.

## [0.0.38] - 2026-08-02

### Fixed

- Windows first-run no longer reports "Shared runtime setup failed" when all
  Windows actually needs is a restart. The signed-in pass now blocks on the
  elevated process handle and waits for a terminal status: `Start-Process
  -Verb RunAs -Wait` can return while the elevated child is still enabling
  WSL features, and probing for a WSL runtime in that window reported a
  failure the Captain could not act on.
- A reboot Windows has not taken yet is now recognised as `restart_required`
  rather than a failure, including the `EnablePending` feature state, DISM's
  ambiguous `Possible` restart flag, an absent `vmcompute` service, and a
  pending Component Based Servicing restart.
- The setup card no longer paints a pending restart in the error colour, and
  gives plain numbered steps: restart the PC, sign back in as the same user,
  reopen 1Helm and setup resumes where it left off.

## [0.0.37] - 2026-08-02

### Fixed

- Fixed Windows packaging failing with `PathTooLongException` during Squirrel
  releasify. Application code now ships inside `app.asar`, so legacy Squirrel
  handles a few hundred short paths instead of tens of thousands of deeply
  nested loose dependency files — both while building the installer and while
  installing or updating on end-user machines, where the same 260-character
  .NET path limit applies under `%LOCALAPPDATA%` regardless of username
  length.
- Assets consumed by external processes stay on real disk next to the archive:
  the WSL setup script, OCI runtime and container image, deploy configuration,
  public assets, the Squirrel uninstall helper, and native terminal modules.
- The Photon sidecar, which runs as a plain Node child process and cannot read
  modules inside an asar archive, is now built as a single self-contained
  bundle during `npm run build` and started from the unpacked tree in packaged
  Windows builds. macOS, Linux, and development startup paths are unchanged.

## [0.0.36] - 2026-08-02

### Fixed

- Kept the Windows desktop control plane available across a genuine cold WSL
  reboot by deferring retained OCI directory maintenance until runtime access
  or fleet reconciliation actually needs it, instead of synchronously waking
  WSL before the HTTP server can listen.
- Gave the Windows desktop a bounded three-minute cold-runtime readiness window
  while preserving the existing 30-second startup budget on other platforms.

## [0.0.35] - 2026-08-01

### Fixed

- Preserved the elevated Windows setup transaction's restart-required result
  before the signed-in process probes WSL, including when Windows returns an
  unreliable zero child-process exit code, and kept terminal setup state
  visible while the tracked parent process closes.
- Restored resident internet on nested Linux hosts by installing the narrow
  AppArmor address-family permissions required by `crun`, bypassing
  netavark's unavailable user-bus DNS scope, and requiring socket creation,
  public DNS, and TCP egress before a resident computer becomes ready.
- Made the essential outcome, blocker-resolution, and Skipper-escalation
  playbooks active in every resident turn so imperative setup requests are
  executed instead of answered with tutorials, and evidenced machine-wide
  network failures are escalated directly for repair.
- Made Linux release packaging fail closed unless it runs in the exact Git
  checkout whose `HEAD` contains the advertised version and a complete source
  archive, preventing a nested source copy from silently packaging only sealed
  runtime assets from a parent repository.

## [0.0.34] - 2026-08-01

### Fixed

- Fixed fresh Linux collaboration so the systemd service resolves the
  architecture-specific Cloudflare connector already shipped inside the
  verified host archive.
- Fixed fresh Windows setup so enabling WSL 2 features always stops at the
  required reboot boundary, and mapped the Windows VM-compute-not-ready import
  response to that same actionable restart state.
- Made Windows retries safely recover an app-owned partial shared-runtime
  import left behind when Windows required the feature-activation reboot.

## [0.0.33] - 2026-08-01

### Fixed

- Fixed fresh Windows shared-runtime setup so the expected pre-install
  `wsl.exe --version` failure is inspected instead of terminating PowerShell
  before the pinned Microsoft WSL package can be downloaded and installed.
- Preserved unexpected elevated Windows host-setup failures in the shared
  status file so onboarding reports the actionable cause rather than only the
  child process exit code.
- Added SHA-256-pinned x64 and arm64 Cloudflare tunnel connectors to the Linux
  host archive, selected the connector matching the running host, and made
  fresh install/update validation reject incomplete Linux packages.

## [0.0.32] - 2026-08-01

### Fixed

- Fixed macOS channel commands, stop, and archive after ordinary guest tools
  create workspace symlinks such as Python virtual environments. Symlinks now
  remain durable inside the isolated Linux computer and are omitted from the
  symlink-free host mirror instead of failing the entire mirror transaction.
- Repaired Apple resident networking when a VM is still reported running but
  its NIC or default route has vanished, without replacing the resident disk.
- Scoped live sidebar status updates to the exact resident identity so Skipper
  or guest activity cannot animate idle channel rows.
- Prevented duplicate resident-to-Skipper escalations, unchanged hand-back
  loops, and user interviews that merely bounce an agent coordination failure.
- Restored Skipper's durable chief-of-staff and cross-channel coordination
  contract, including usable skill metadata, personal scheduling and goal
  coordination, scoped history, and durable workflows across domain channels.
- Matched Skipper channel-control tool exposure to the requesting user's exact
  authority. A personal-#main owner can create channels; a non-owner member is
  no longer offered a tool that execution must reject.
- Made Cowork file contracts durable across follow-ups, queued turns, and
  restarts. Docs and Notes require Markdown, Presentations require valid
  `.slides.json`, Whiteboards require valid `.whiteboard.json`, and newly
  created incompatible command output is rejected and removed without touching
  pre-existing user files.

### Documentation

- Removed retired sandbox/test-host references from public documentation and
  agent-facing product guidance. No test or demo endpoint is represented as a
  current product environment.

## [0.0.31] - 2026-08-01

### Fixed

- Fixed fresh Linux installation from `1helm.com`: the public installer now
  downloads and SHA-256-verifies the accepted Linux host artifact instead of
  pairing its current OCI setup logic with the obsolete source-only v0.0.28
  tag, which lacked the OCI runtime installer and sealed channel image.
- Kept the website's digest-qualified installer metadata available through an
  exact last-known-complete release fallback when GitHub's unauthenticated API
  rate limit is exhausted.

### Documentation

- Updated the README, standalone website, manual, story, and user guide for the
  OCI computer generation shipped in 0.0.29/0.0.30: Linux uses native Podman,
  Windows uses one managed WSL 2 runtime with a container per channel, and
  OCI storage is authoritative.
- Scoped release-security claims by platform. Mac artifacts are signed and
  notarized, Linux assets are digest-verified, and Windows Authenticode status
  is disclosed honestly (`NotSigned` for v0.0.30).
- Documented the current desktop choice between hosting a new workspace and
  connecting to an existing HTTPS host, plus host-neutral domains and mobile
  gateway behavior.
- Brought the manual up to date with the Captain-to-Skipper Texts model and the
  Cowork HTML preview, generated-deck layout, direct folder navigation, live
  work status, automatic file refresh, and per-file session history already
  present in v0.0.30.
- Removed false current-mobile distribution claims: v0.0.30 has no Android APK,
  and 1Helm is not currently listed in the public iOS App Store. The current
  phone/tablet path is the HTTPS browser interface.

## [0.0.30] - 2026-07-31

### Fixed
- Windows shared WSL OCI bootstrap: script-scoped downloads, UTF-16 WSL output handling, tracked setup progress, and honest readiness errors after cold start.
- Windows channel Files/Cowork no longer depend on `\\wsl.localhost` (interop-off kills 9p). Host IO uses the OCI helper `storage-*` operations.
- Channel storage root stays `0711` so helper verification and Files layout stay consistent.
- Mobile keyboard: focus no longer self-dismisses on tall threads; form controls stay at 16px on small screens to avoid iOS auto-zoom.
- Main-channel `@` suggestions no longer list Skipper twice.
- Linux OCI channel networks: when Podman rejects Docker-style `com.docker.network.bridge.name` (CNI and some netavark builds), the helper falls back to a labeled network create so channel computers provision on Debian/Ubuntu hosts that previously failed with “owned network missing / labels incomplete”.
- Linux package archives now include the sealed channel-machine OCI image required by the host installer.

### Notes
- Desktop train: macOS notarized DMG + updater ZIP, Linux host archive, Windows Setup + Squirrel package from one version.

## [0.0.29] - 2026-07-30

### Changed

- Linux and Windows channel computers now use one durable OCI container per
  ordinary channel. Linux runs Podman natively; Windows hosts all channel
  containers inside one installation-scoped managed WSL 2 runtime.
- OCI workspace, Files, home, and channel state are runtime-owned and
  authoritative. Agent commands, terminals, Files, and Cowork see the same
  storage directly without whole-workspace synchronization in the command
  path. Containers retain files, tools, processes, network identity, and live
  CPU/memory controls across stop/start.
- Channel archive creates a digest-qualified recovery backup. A missing OCI
  world can be reconstructed only from an exact ownership-checked backup whose
  SHA-256 matches; unsafe labels, mounts, paths, or deletion targets fail
  closed.
- This runtime generation is a deliberate clean start. Desktop state lives in
  `1Helm-OCI-v1`, Linux state lives in `/var/lib/1helm-oci-v1`, and retired LXC,
  per-channel WSL, and application data are neither bridged, copied, imported,
  converted, nor deleted.
- The embedded ReRouted engine advances to 0.5.10 so Google Antigravity Flash
  and Pro streaming accepts CRLF-delimited Gemini SSE frames instead of
  completing with empty output.
- The hardened Linux systemd service permits only Podman/netavark's ephemeral
  runtime trees, while persistent network configuration and libpod scratch
  stay inside 1Helm-owned roots. The installed service—not only direct root
  diagnostics—can now verify and provision OCI channel computers.
- Repeat Linux installation preserves the root-owned OCI runtime and existing
  channel storage permissions instead of recursively rewriting the new state
  namespace as the application service user.
- Linux installs declare Podman's ephemeral runtime roots through systemd
  tmpfiles, so the hardened service starts on a fresh host and after reboot
  before any container has happened to create those directories.
- Windows packaging builds the app and Squirrel staging tree beneath one fresh
  drive-root scratch directory, keeping deeply nested runtime dependencies
  inside Squirrel's legacy 260-character path limit.

## [0.0.28] - 2026-07-29

### Fixed

- Linux now installs one versioned runtime manifest shared by the application,
  lifecycle helper, image payloads, and cache. Image sets and caches live under
  immutable contract-qualified paths, so deploying newer application code can
  no longer pair it with an older mutable rootfs and disable every channel.

- Systemd installations require their exact root-owned helper instead of
  silently falling back to a helper in a source checkout. Runtime readiness
  verifies the complete installed helper, manifest, image, cache, and network
  contract before a host is accepted, and same-version repair reconstructs a
  corrupt cache even if its stale contract marker still claims to be current.

- Fresh installations inside a supported unprivileged nested-LXC host now
  allocate the container's local `1..65535` subordinate-ID range correctly
  instead of confusing it with the parent namespace IDs reported by the
  kernel.

- Fresh Linux channel provisioning now waits for the new LXC guest to acquire
  its private DHCP address, default route, and working DNS before package
  bootstrap. A channel no longer repeatedly creates and cleans up its computer
  after starting `apt` during the guest-network race.

- A fresh channel now verifies and retries the same container when LXC's first
  daemonized start transiently loses its state-socket reply. The one-off
  `wait_on_daemonized_start` error no longer makes the channel appear broken
  while the automatic fleet pass successfully creates it moments later.

- 1Helm's narrow owned LXC forwarding rules are inserted ahead of host firewall
  policies such as Docker's `FORWARD=DROP`, allowing resident guests to reach
  package mirrors without replacing Docker or Tailscale chains.

- The host installer now prepares the same `/var/lib/1helm-lxc/machines` tree
  used by the runtime instead of leaving an obsolete empty `containers` tree.

- Includes the durable installer payload and API-quota corrections from the
  superseded Linux-only `0.0.27` prerelease.

## [0.0.27] - 2026-07-29

### Fixed

- Fresh Linux installs pin the intended 1Helm version without consuming
  unauthenticated GitHub API quota, and download digest-pinned Ubuntu LXC
  payloads retained as 1Helm release assets instead of short-lived upstream
  image URLs.

## [0.0.26] - 2026-07-29

### Fixed

- Linux LXC DHCP leases now live under 1Helm's dedicated writable runtime
  state instead of the system-wide `/var/lib/misc` tree made read-only by the
  hardened application service. Network recovery validates that exact lease
  tree, the running dnsmasq DHCP contract, and the exact DNS, forwarding, and
  outbound NAT rules before reporting a channel computer ready.
- Includes the retained-memory startup, Windows host-terminal and WSL
  identity, Linux LXC recovery, and honest lifecycle/command corrections
  prepared in `0.0.24` and `0.0.25`; neither version was tagged or published.

## [0.0.25] - 2026-07-29

### Fixed

- Linux systemd updates now open the health port before initializing every
  retained resident memory database. Large existing workspaces no longer miss
  the updater's bounded startup window and roll back an otherwise healthy
  release while the same durable memory initialization continues in the
  background.
- Includes the Windows host-terminal, Windows WSL identity, Linux LXC network
  recovery, and honest lifecycle/command failure corrections prepared in
  `0.0.24`; `0.0.24` was never tagged or published.

## [0.0.24] - 2026-07-29

### Fixed

- Windows `#main` host terminals now use the native `cmd.exe` contract and
  return a bounded API error when PTY startup fails instead of attempting
  `/bin/sh` or crashing the local server.
- Windows channel computers now reject Local System hosting with an explicit
  remediation before invoking WSL. The supported desktop continues to run in
  the signed-in user's session, where that user's retained WSL distributions
  are available.
- Linux LXC readiness now repairs and verifies the bridge address, the exact
  `dnsmasq` process, DHCP/DNS, and owned NAT rules. Provisioning reconstructs
  only a validated marker-less partial container left by an interrupted
  bootstrap, while preserving every ownership-marked channel computer.
- Channel creation and command activity no longer claim success before the
  private computer passes verification. Nonzero command exits and runtime
  transport errors are recorded and shown as failed rather than complete.

## [0.0.23] - 2026-07-28

### Added

- Admins now receive a one-time **Later** / **Restart Now** prompt when a
  desktop update has finished downloading and verification, without
  needing to open Profile or manually check first.
- Fresh macOS and Windows installations can connect to an existing 1Helm
  workspace with the clean `[workspace].1helm.com` gateway or its alternate
  HTTPS URL flow. **New User?** reveals the explicit option to set the current
  PC up as a new 1Helm server, while configured desktop servers continue to
  open their existing local workspace normally and Linux stays headless. A
  client-only desktop does not create a second local server or server login
  item behind the connection screen.
- The live Routes graphic includes one collapsed **Custom** provider node and
  illuminates its line when any custom OpenAI-compatible endpoint handles a
  request, while the request details retain the actual endpoint name.

### Fixed

- Presentations fit the entire dotted printable boundary into view whenever a
  deck opens or a slide is selected, created, or duplicated, without changing
  the slide's printable dimensions, content, persistence, or PDF export.
- The Cowork agent is available from a section or nested folder before a file
  is opened, and a new chat receives that exact `/workspace` folder path just
  as file-scoped chats receive their exact file path.
- Long Cowork Code files scroll inside their finite editor viewport instead of
  extending below the visible canvas.
- The Android and iOS connection shell releases its native splash after its
  first paint, uses the real 1Helm artwork, and defaults to the same clean
  workspace-name connection flow.

## [0.0.22] - 2026-07-28

### Added

- Presentations now define a visible, locked printable boundary on every
  slide, defaulting to 1500 × 1000 with configurable dimensions. The
  Excalidraw menu exports the whole bounded deck as one real multi-page PDF and
  excludes material outside each printable page.
- Android and iOS now package only a minimal HTTPS instance connection and
  recovery shell. After selection they load the chosen instance's live
  frontend directly, preserve native secure sessions, notifications, links,
  attachments, microphone, keyboard, and safe-area behavior, and confine the
  native bridge to an exact scheme/host/effective-port match.

### Changed

- Fresh browser profiles start in light mode, while retaining the existing
  user-controlled dark-mode switch.
- The Cowork section tabs are centered at normal widths.
- Routes now presents a spacious bottom-to-top request flow through **1Helm
  Router** into a stable arc of ChatGPT, Claude, Antigravity, xAI, OpenRouter,
  NVIDIA, Cloudflare, and GLM. Dotted live paths and the request ledger keep
  requested model policy separate from the routed provider or fallback.
- Structured question choices now show an accessible pressed state with a
  strong ring, fill, inset accent, and checked indicator in both themes.

### Fixed

- **Log Out** is now available in the profile menu. Native profiles also retain
  their separate **Disconnect** action for erasing the selected instance and
  secure session.
- Every composer now displays and submits the authoritative effective model
  policy using thread → channel → personal → workspace → agent precedence.
  Personal overrides are labeled and can be cleared with **Use workspace
  default**; stale submissions are rejected before admission, and queued turns
  retain the model and provider snapshot they were admitted with.
- Silent thread audits use their own `system-*` routing identity and the
  Captain-scoped provider fabric, so concurrent user requests cannot be
  mislabeled as maintenance. Router fallback remains a provider outcome rather
  than appearing to change the requested model mid-turn.
- HTTP browser instances now use `ws:` while HTTPS and native instances use
  `wss:`. Fast Cowork collaboration sync, detached Files test rows, and legacy
  presentation element ordering are also handled deterministically.

### Tests

- Native integration coverage proves visible personal-policy execution,
  immediate restoration of the workspace default, stale-policy rejection,
  durable admission metadata, and queued-model immutability across a later
  preference change.
- Browser coverage verifies profile Log Out, first-profile light mode, centered
  Cowork tabs, selected answers in both themes, the literal eight-provider
  Routes geometry, the locked presentation boundary, configurable page size,
  and a parsed two-page 1600 × 900 PDF export.
- Mobile contracts prove only gateway assets are packaged, HTTPS origins are
  normalized, native sessions stay secure, and Android/iOS navigation cannot
  broaden bridge access through an origin-prefix attack.

## [0.0.21] - 2026-07-27

### Fixed

- Desktop release policy now fail-closes on platform parity: one version and
  exact source commit must produce verified macOS DMG/updater, Linux host, and
  Windows Setup/Squirrel artifacts before any tag or GitHub Release can be
  published. Windows signature status is disclosed and unsigned output remains
  accepted until a trusted signing identity is adopted. A missing platform
  pauses the whole release instead of leaving users on a stale update line.

- Cowork new-file prompts now start blank. Names with an explicit extension are
  preserved, while extensionless names receive the active section's `.md`,
  `.whiteboard.json`, `.txt`, or `.slides.json` default.
- Presentation canvases anchor at the top of their scrollable stage, and the
  Excalidraw hamburger menu escapes the editor's inner clip into a bounded,
  scrollable overlay so its complete menu remains visible and interactive.
- Cowork Code uses the normal light surface with readable dark text in light
  mode while retaining its navy editor treatment in dark mode.
- Offline shell fallbacks always resolve service-worker requests with a valid
  response instead of producing a rejected FetchEvent conversion error.
- Cowork's bare Option/Alt shortcut now carries the mic control belonging to
  the focused Notes, Docs, or agent input and uses a capture-phase fallback
  when the macOS desktop shell swallows the corresponding keyup.
- Long Cowork Notes give CodeMirror a finite editor frame and scroll through
  its actual viewport in Write mode.
- Leaving Cowork, changing sections, or opening another file now destroys the
  outgoing Yjs document and reloads the authoritative workspace file into a
  fresh document. The stale browser recovery copy that could resurrect or
  repeatedly duplicate prior text has been removed.
- Files directory, tree, text, and content reads now paint from the host mirror
  immediately. One explicit background refresh coalesces the expensive channel
  computer export and repaints the current listing when it completes.

### Added

- Files now keeps `/workspace` and the five Cowork folders first in its visual
  navigation rail, with all remaining root files and folders grouped under an
  expandable **Other** disclosure without changing the underlying filesystem.
- Selecting a Markdown file in Files exposes **Download - DOCX**, backed by an
  authenticated, contained Office Open XML export.
- Desktop workspace navigation can collapse to a compact channel-icon rail and
  expand again. The profile-bound preference persists, while the existing
  mobile drawer remains unchanged.

### Tests

- Browser coverage toggles both Cowork editor and agent dictation through bare
  Option/Alt, scrolls a 120-line Note, and proves section changes, full Cowork
  navigation, and a five-line external replacement all reopen exactly once
  without a recovery prompt.
- A fake Apple channel computer with an intentionally slow export proves cached
  Files reads stay responsive, simultaneous refreshes coalesce, and guest-only
  files appear after the background refresh.
- Browser and server coverage verify blank Cowork naming, default and explicit
  extensions, presentation-menu stage bounds and pointer hit-testing, light
  Code contrast, Files grouping, real DOCX ZIP contents, and persistent
  desktop-only sidebar collapse.

## [0.0.20] - 2026-07-27

### Added

- Cowork's agent request, Notes, and Docs editors now support the same
  explicit speech-to-text mic control and bare Option/Alt shortcut as Chat
  and Quick Note.

### Fixed

- Skipper now renders with the product avatar in Cowork rather than a plain
  `S` initial.
- Returning to Cowork after navigating away starts a fresh collaboration
  transport from the authoritative saved file. It cannot merge stale Yjs
  history into a new room and duplicate an agent's or user's document edits.
- Long Cowork Notes stay scrollable while in Write mode.
- Files selection now paints immediately. Recursive folder-tree loading is
  independent of the current directory request, removing repeated VM mirror
  work from ordinary file and folder clicks.

### Tests

- Browser coverage proves leaving and reopening a saved Cowork note retains
  exactly one copy of its content, and focused source/browser contracts cover
  Cowork dictation, Skipper identity, Notes scrolling, and non-blocking Files
  selection.

## [0.0.19] - 2026-07-27

### Fixed

- Live Activity, Board, channel Threads, global Threads, Texts, Memory, and
  channel-settings refreshes now keep the current surface visible until fresh
  data arrives, ignore stale async paints, and restore focused controls,
  cursor selection, unsaved values, scroll positions, and open or deliberately
  closed disclosures by stable identity.
- Activity remembers the selected filter and expanded evidence across live
  events, Board lane and Texts conversation scrollers retain their reading
  position, and sidebar/header status updates no longer steal focus or reset
  navigation state.
- Background skill-catalog changes no longer close and reopen Settings. The
  open Skills page stays untouched and offers an explicit **Refresh when
  ready** action so searches, drafts, focus, and scroll remain user-owned.

### Tests

- Browser regressions now trigger real WebSocket updates while a user owns a
  Texts draft, Activity evidence, channel-settings cursor selection, Board
  card, or global Threads position, and prove every state remains stable while
  the incoming data and Markdown update in place.

## [0.0.18] - 2026-07-27

### Added

- Cowork Notes, Docs, and Code now use CodeMirror 6 with shared live text,
  collaborator cursors and selections, line numbers, search, indentation,
  bracket support, language-aware highlighting, and Command/Control+S.
- Whiteboards now use a native embedded Excalidraw canvas, while Presentations
  use Excalidraw-backed slides with add, duplicate, delete, reorder, and
  distraction-free presentation mode. Both remain ordinary readable files in
  the channel's `/workspace`.
- Authenticated Yjs collaboration lets channel members edit the same Cowork
  asset together. Presence is membership-gated and scoped to the currently
  visible file; agent or Terminal changes flow into an open clean document.

### Changed

- The Cowork agent panel still creates an ordinary channel session, but its
  first message now includes the authenticated current co-viewers as well as
  the open file path. Reopening an existing session can include newly present
  collaborators without repeating the path.
- Notes and Docs add focused Markdown formatting and preview, Docs uses a
  page-oriented surface, Code rejects unsupported binary database files with a
  concise message, and the shared Cowork rail now exposes the complete nested
  create, rename, move, duplicate, delete, search, and breadcrumb flow.
- Excalidraw fonts and assets are generated into the app and loaded only from
  the same origin. Patched transitive `lodash-es` and `nanoid` versions remove
  the Cowork dependency advisories without downgrading Excalidraw.

### Fixed

- Hidden Cowork channels and sections no longer retain live presence, while
  switching themes or repainting the application shell preserves the exact
  editor or canvas node, focus, selection, open asset, and unsaved work.
- In-flight file opens can no longer reconnect to a renamed, moved, or deleted
  path, stale local drafts cannot silently overwrite newer agent or
  collaborator changes, and shutdown synchronously flushes dirty Cowork files.
- Text creation and save reject embedded NUL data, collaborative rooms reject
  unsupported roots, directories, unsafe/binary or oversized files, and every
  Cowork WebSocket requires both authentication and channel membership.

## [0.0.17] - 2026-07-27

### Added

- Cowork replaces the former Notes tab with one direct editing plane for the
  channel's existing `/workspace/notes`, `/whiteboards`, `/code`, `/docs`, and
  `/presentations` trees. Its five stable work modes share nested-folder
  navigation and add focused Markdown, document, code, single-file whiteboard,
  and single-file presentation editors.
- Cowork's collapsible resident-agent panel keeps the active file visible,
  starts an ordinary channel thread, adds the open `/workspace/...` path only
  to the first message, and lets that same session continue in Chat.
- The top-bar Quick Note captures a titled or collision-safe untitled Markdown
  note directly into `/workspace/notes` without leaving the active channel,
  tab, thread, or scroll position. Collapsed drafts persist in the current
  session; dictation, Escape-to-save, and Control/Command+Enter are supported.
- Dictation now has a subtle listening waveform and active resident work uses
  a compact animated orb without obscuring content.

### Changed

- Files is now a familiar two-pane browser with a persistent folder rail,
  breadcrumbs, bounded content grid, search, sorting, metadata, distinct
  folder and file-type icons, non-color-only selection, and direct create,
  upload, open, rename, move, duplicate, delete, and download actions. Cowork
  assets open in the matching Cowork mode over the same underlying file.
- Markdown now renders consistently in global and channel Threads, Board,
  session summaries, agent and status messages, Cowork chat, Memory, Texts,
  and Activity, including spaced bold labels such as `** Goal **`.
- Photon conversations no longer repeat robotic phone-number source labels;
  legacy entries use the concise human-facing title “Text with Skipper.”
- Mobile Settings uses a compact horizontal section rail, all layouts track
  the real visual viewport and safe areas, and scrolling away from the message
  composer releases focus so the on-screen keyboard can dismiss naturally.
- The redundant **Call Skipper** button is removed; `@Skipper` remains the
  direct escalation path.

### Fixed

- Background messages, polling, synchronization, route repaints, and shell
  updates no longer remount live Files or Cowork surfaces or reset the user's
  focused input, selection/cursor, draft value, scroll position, expanded
  details, active file, panel, or workspace mode.
- Folder and file rows no longer share an ambiguous document glyph, and mobile
  panels and Terminal size against the visible screen instead of extending
  beneath browser chrome, the keyboard, or operating-system safe areas.

### Documentation

- The public privacy policy now covers the iOS gateway, just-in-time media and
  speech permissions, optional encrypted APNs relay, optional feedback,
  third-party processors, retention, deletion, and user choices.

## [0.0.16] - 2026-07-26

### Added

- Native iPhone notification registration now belongs to the signed-in 1Helm
  profile. Background channel and resident-agent updates use a
  durable, retryable, idempotent delivery queue, honor global sound and
  per-channel mute choices, skip the author, encrypt device tokens in the push
  relay, and open the relevant channel or thread when tapped.
- Settings → Notifications now lets a phone owner explicitly request system
  notification permission, see whether the current phone is registered, and
  turn registration off without changing another device.

### Changed

- Phone channel chrome now uses two calm rows: hamburger and channel name on
  top, then a right-aligned row for Favorite, Router, resident status,
  Terminal, Notes, and Skipper. Desktop remains one compact row, and every
  phone action retains a 44-point target without horizontal overflow.
- The native iOS status surface matches the current light or dark page header
  behind the Dynamic Island while WebView controls remain physically below the
  system indicators.

### Fixed

- Choosing **Take Photo or Video** from a message attachment no longer causes
  iOS to terminate 1Helm. Camera, photo-library, and video-microphone access now
  have narrow user-facing privacy declarations tied to explicit attachment
  actions.
- The Notes top bar shares the mobile surface treatment and keeps **New note**
  and **Close** visible on a 390-point phone viewport.

## [0.0.15] - 2026-07-26

### Fixed

- iPhone and iPad now reserve the iOS system status area for the Dynamic
  Island, battery, and signal indicators instead of drawing the packaged
  workspace underneath it. Full-screen headers such as Notes keep **New note**
  and **Close** visible and tappable, while Android retains its existing
  edge-to-edge behavior.

## [0.0.14] - 2026-07-26

### Changed

- iPhone, iPad, and Android now open through a restrained native launch
  transition: a compact centered sailboat mark on the platform-appropriate
  light or dark background, followed by a short fade as soon as the gateway or
  workspace has painted. The previous oversized full-screen artwork and
  artificial 1.2-second logo hold are removed.

### Fixed

- App Store packaging now safely copies an exported IPA across filesystem
  boundaries before its atomic final rename, so clean builds on the retained
  APFS release volume no longer fail after a successful Xcode export.

## [0.0.13] - 2026-07-26

### Added

- iPhone, iPad, and Android now have thin Capacitor gateway clients for an
  already configured 1Helm host. The connection screen accepts an HTTPS server
  address, username, and password, confirms the host's explicit mobile
  compatibility contract, and never exposes first-run host setup.
- Android ships as a directly distributed, signed universal APK with a stable
  application ID and permanent release certificate. Release builds fail
  closed without external signing material and verify alignment, package and
  version metadata, v2/v3 signatures, and native ABI coverage.
- iOS has an App Store archive/export path with iPhone and iPad support, stable
  bundle and callback identifiers, a privacy manifest, and the required
  microphone, speech, and encryption declarations.

### Security

- Mobile passwords are used only for the sign-in request and are never saved.
  Sessions are kept in the device-only iOS Keychain or encrypted with an
  Android Keystore-held key; Disconnect erases the session and server address.
- The packaged local web client connects only to HTTPS servers, disables
  native WebView debugging and release logging, rejects cleartext traffic and
  Android backups, and limits server CORS to the two packaged Capacitor origins.

### Changed

- Authenticated API calls, files, avatars, workspace photos, terminals, app
  events, external links, and provider OAuth flows now resolve correctly
  through a selected mobile server while bundled brand and resident character
  assets remain local.

## [0.0.12] - 2026-07-26

### Fixed

- Linux host updates now apply the verified runtime files, release symlink,
  systemd units, restart, health check, and rollback inside one bounded
  transient root transaction. This lets a v0.0.11 host escape its obsolete
  `ProtectSystem=strict` mount namespace before atomically replacing host
  files, while future updater units grant write access only to the required
  parent trees.
- Fresh Linux installs create every LXC state/cache root named by the service
  unit before systemd builds its private mount namespace, so the first launch
  no longer depends on a channel computer having already been provisioned.

## [0.0.11] - 2026-07-26

### Added

- Notes now include a focused Markdown toolbar for headings, bold, italic,
  lists, code, and links, plus Write and Preview modes that render the current
  unsaved draft.
- Configured Photon workspaces now show a private **Texts** tab only in the
  Captain's personal `#main`. It lists every Skipper conversation, preserves
  each thread, and lets the Captain select, resume, and continue it on desktop.

### Changed

- Notes use a cleaner searchable sidebar, friendly titles without a visible
  `.md` suffix, and a more spacious editor layout.
- Photon is now channel-agnostic: the configured Captain phone always texts
  Skipper, one conversation remains current until `/new`, and legacy mapped
  conversations move to the Captain's private Texts inbox during migration.
  Desktop continuations share the same context without echoing to iMessage;
  returning to the phone continues the conversation selected on desktop.
- GitHub Releases now require the complete numbered acceptance ledger from a
  multi-item request, plus artifact and verification evidence. Generated
  commit summaries can no longer replace the user-facing change list.
- The retained Apple Silicon release host now owns the complete macOS path:
  clean build, signing, notarization, public-download installation, launch,
  smoke verification, and Application Support preservation.

### Fixed

- New notes accept titles with or without `.md`, add the suffix when omitted,
  and reject another extension with a corrected `.md` suggestion.
- Theme, reconnect, and service-worker update refreshes no longer discard or
  replace the active Notes editor. The exact editor node, unsaved draft, focus,
  selection, and preview state survive shell rebuilds.
- Long channel descriptions remain single-line and truncated at narrower
  desktop widths instead of expanding the top bar into a one-character column.
- Newly provisioned residents prefer an unused character/color avatar
  combination, eliminating stochastic duplicate identities in small fleets.
- Photon content is excluded from channel Chat, channel/global Threads, Board,
  and unread counts, and the obsolete resident Photon tools and mapping UI are
  removed.

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

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v0.0.36...HEAD
[0.0.41]: https://github.com/gitcommit90/1Helm/compare/v0.0.40...v0.0.41
[0.0.40]: https://github.com/gitcommit90/1Helm/compare/v0.0.39...v0.0.40
[0.0.39]: https://github.com/gitcommit90/1Helm/compare/v0.0.30...v0.0.39
[0.0.38]: https://github.com/gitcommit90/1Helm/compare/v0.0.30...v0.0.38
[0.0.37]: https://github.com/gitcommit90/1Helm/compare/v0.0.30...v0.0.37
[0.0.36]: https://github.com/gitcommit90/1Helm/compare/v0.0.35...v0.0.36
[0.0.35]: https://github.com/gitcommit90/1Helm/compare/v0.0.34...v0.0.35
[0.0.34]: https://github.com/gitcommit90/1Helm/compare/v0.0.33...v0.0.34
[0.0.33]: https://github.com/gitcommit90/1Helm/compare/v0.0.32...v0.0.33
[0.0.32]: https://github.com/gitcommit90/1Helm/compare/v0.0.31...v0.0.32
[0.0.31]: https://github.com/gitcommit90/1Helm/compare/v0.0.30...v0.0.31
[0.0.30]: https://github.com/gitcommit90/1Helm/compare/v0.0.29...v0.0.30
[0.0.29]: https://github.com/gitcommit90/1Helm/compare/v0.0.28...v0.0.29
[0.0.28]: https://github.com/gitcommit90/1Helm/compare/v0.0.27...v0.0.28
[0.0.27]: https://github.com/gitcommit90/1Helm/compare/v0.0.26...v0.0.27
[0.0.26]: https://github.com/gitcommit90/1Helm/compare/v0.0.23...v0.0.26
[0.0.25]: https://github.com/gitcommit90/1Helm/compare/v0.0.23...v0.0.25
[0.0.24]: https://github.com/gitcommit90/1Helm/compare/v0.0.23...v0.0.24
[0.0.23]: https://github.com/gitcommit90/1Helm/compare/v0.0.22...v0.0.23
[0.0.22]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.22
[0.0.21]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.21
[0.0.20]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.20
[0.0.19]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.19
[0.0.18]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.18
[0.0.17]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.17
[0.0.16]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.16
[0.0.15]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.15
[0.0.14]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.14
[0.0.13]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.13
[0.0.12]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.12
[0.0.11]: https://github.com/gitcommit90/1Helm/releases/tag/v0.0.11
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
