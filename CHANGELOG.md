# Changelog

All notable changes to 1Helm are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/gitcommit90/1Helm/compare/v0.0.24...HEAD
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
