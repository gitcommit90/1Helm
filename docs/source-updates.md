# Source update: 2026-10-16

## Routed tasks, durable questions, phone replies and preparation containers

This update reconciles the Worker from `5b746f1072614964a776621c887a464d1d6a1901`
to `a8d4e6ee87d6b5f933bd5143c07ab1acde179353` and the web app from
`b4ea73bddd011f8d2baea92fce93b38e32577f6c` to
`4a1da4ca61790f301cb5f7a81abaa84b9445689f`.

Source correspondence:

- Worker: `5b746f1072614964a776621c887a464d1d6a1901` → `a8d4e6ee87d6b5f933bd5143c07ab1acde179353`.
- Web: `b4ea73bddd011f8d2baea92fce93b38e32577f6c` → `4a1da4ca61790f301cb5f7a81abaa84b9445689f`.
- Public base: `e458597c3d2952cdfe25af3aeec3214236c7ab86`.

Changes:

- A question the helper asks is now saved with its own identity, so an answer from the app, a card, an interview or a phone text always goes to the question it answers (`src/user-input.js`). Several waiting questions can be answered by number from the phone. Each message also records where it came from (app, phone, card or interview), and the memory writers keep that origin with the retained facts.
- The licensed Cloud modules gained routed tasks. The Models page can save categories with their own model lists for each privacy level, a small request sorter picks the category, and a worker returns its answer, its files and a step log for review before the helper delivers them. Raw agent records go to their own Hindsight banks. Native Workers AI models can be discovered and used. All of it stays in `src/ee/`, runs only when `ONEHELM_EE` is `1hc` and `DYNAMIC_ROUTING` is `on`, and the provider paths also need `ENV_NAME` to be `dev`, so a self-hosted install behaves as before.
- The licensed texting module can send a native iMessage poll and route a vote back to its question, send produced files with a phone reply, and bind a phone reply to its original card (`src/ee/native-polls.js`, `src/ee/phone-files.js`, `src/ee/photon-replies.js`). Migration `0057` adds the `native_text_polls` table they use.
- Native CAF voice notes (Opus and packed PCM) are converted to WAV by the audio converter when `AUDIO_CONVERT` is `on`. A recording attached as the whole request now waits up to 60 seconds for its transcript before any model is called, and a failure is reported as an application notice.
- File preparation and Bee jobs can run on container classes that start from a saved snapshot of their installed dependencies (`PrepContainer` and `BeeContainer`, with the shared helpers in `src/job-template.js`). They are used only where a `PREP_CONTAINER` or `BEE_CONTAINER` binding exists, `PREP_SNAPSHOTS` set to `off` is the kill switch, and the example configuration defines neither binding, so a self-hosted install keeps the existing `Computer` path.
- Interview and card answers carry the question identity (`input_reply`) on the chat stream route, a duplicate answer is reported as such, and the helper dispatch ignores a tool that the current delegation state does not allow.
- The licensed Models page searches the live model list, accepts the latest alias of a model family, shows each result with the privacy levels it can serve instead of hiding it, and confirms a delete in the page instead of a browser dialog. The privacy module reports which providers and host terms each model has.
- A phone file send is re-armed only after a send, and deleting a task also removes its phone file and memory origin markers.
- A decision model chosen on the Models page uses its own decision endpoint whenever its record has no chat kind, also when the page verified it. The saved settings refuse a latest-version model ID (starting with `~`) for any job except chat and decision jobs.
- The custom MCP server address check no longer fails every time: its DNS lookup used a redirect mode that Workers rejects, and it now handles redirects manually. The read only list of memory server models on the licensed Models page shows the latest aliases the server now uses.
- The licensed Models page never offers a model that OpenRouter no longer lists, flags a saved one as "No longer offered", refuses to save it, and fetches the OpenRouter lists without caching. The decision and workers decision jobs allow up to 3 fallbacks, and a decision job reports the model that actually answered and its cost.
- The web app shows a canvas activity orb while the helper and its workers are busy (the MIT licensed thinking orbs engine, noted in `THIRD-PARTY-NOTICES.md`), keeps the chat visible above the mobile keyboard, pages long inline cards, and binds a typed or tapped answer to its question.

Left out of the public source: the hosted affiliate program (referral commissions, Stripe payouts and the hosted agreement and marketing pages), the dev to Live model settings push tool (and its audit table), the hosted billing event fixtures and operator inspection of the Cloud Stripe account, the dev only container and preparation benchmark endpoints and their images, the routing counter page for the Cloud gateway logs and its two tables, the private release, wrangler and key vault tooling, the live checks, and the private design sandbox. The public example configuration is unchanged.

Migration `0057` is additive and adds the `native_text_polls` table.

# Source update: 2026-10-15

## Memory on Hindsight, Notebook pages, audio conversion and settings defaults

This update reconciles the Worker from `3583747fc673579012edc6d20b6e8d3f911dbc96`
to `5b746f1072614964a776621c887a464d1d6a1901` and the web app from
`24c621d7a8506efb2ea8ab5457b6de520a4a4fbe` to
`b4ea73bddd011f8d2baea92fce93b38e32577f6c`.

Source correspondence:

- Worker: `3583747fc673579012edc6d20b6e8d3f911dbc96` → `5b746f1072614964a776621c887a464d1d6a1901`.
- Web: `24c621d7a8506efb2ea8ab5457b6de520a4a4fbe` → `b4ea73bddd011f8d2baea92fce93b38e32577f6c`.
- Public base: `1247b4d8cb4c13282cd66224eca0ae28e3c7c8ee`.

Changes:

- Hindsight is the only memory. The old local ledger (its rows, embeddings, ranked recall, supersede pass and segment summaries), the upkeep, people and nightly reflection jobs, the Contacts block in the prompt and the forget tool and skill are removed, and a request to forget something is an ordinary turn. When memory is on and the Hindsight service does not answer, the helper says that memory is unavailable and does not guess. An install that never sets `MEMORY` (the example configuration does not) keeps memory off and sees no change. An install that set `MEMORY` to `on` without a Hindsight service binding now has no recall, and the old ledger tables stay in storage and are not read.
- New memory features are off unless their variable is `on`, and none is in the example configuration. `HS_FOUNDATIONS` gives each bank a template (missions and mental models), cancels queued work before a delete and runs a daily bank health check. `HS_WRITERS` retains every kind of channel content into its bank and can rebuild a bank from stored source. `HS_USE` puts a profile and automatic recall into a turn. `HS_WALLS` lets the person choose whether General reads other channels without asking. `HS_ENVELOPE` adds time, place, people and source to each retained item and reads photo and video capture metadata. All of them need the Hindsight binding, and the later ones need the earlier ones.
- Notebook pages are written from a channel's own Hindsight mental models, with a profile photo, section editing and a facts box. The web app shows them only when the boot answer sets `flags.notebook_pages`, which the Worker does only when `ENV_NAME` is `dev`.
- Audio inside files (mp3, Opus, AAC, FLAC, Vorbis and ALAC) can be converted to 16 kHz mono WAV in the Worker when `AUDIO_CONVERT` is `on`. The decoders are Symphonia (MPL-2.0) compiled to WebAssembly from `tools/symphonia-wasm` and opus-decoder (MIT). Licenses and credits are in `THIRD-PARTY-NOTICES.md` and `src/vendor/audio/README.md`.
- Scanned pages in the prep container job are read by Indra OCR, with pinned wheels and model files that are checked by hash. The hosted OCR Worker and the container image layer that adds screenshot text recognition are not part of the public source, so a screenshot read reports no text unless you install the OCR packages.
- A file edited by the helper now updates the same Library file, keeps the uploaded original and never creates a second copy with a number in its name. The helper's writing rules follow a plain writing style prompt.
- Static files requested with a version are cached for a year only when the version matches the Worker's own version. The page starts the first data request before the script downloads, and long answers repaint once per frame.
- Agent check-ins have an on and off switch that is off by default (migration `0056`). The licensed Cloud ledger now keeps the spending pause preference off unless the person turns it on. A self-hosted usage ledger keeps its earlier default.
- The licensed modules received the Models page cleanup (retired jobs removed, a catalog of used models only, models chosen elsewhere shown read only), Bee raw transcripts with a speaker review, ambient search grounding and a daily read-only billing check.
- The licensed Bee sync object gained test hook methods behind its test guard, and the test hook that stores a conversation now cancels delayed deletes of the same document first, as the real sync does.
- The web app has a Notebook article editor, quieter dictation, Live notes recorded as 16 kHz WAV and an unread dot in a fixed slot of every task row.

Migrations `0051` to `0056` are additive. They add `hs_health`, `hs_rebuild_runs`, `tenants.front_door`, the memory envelope tables, the exact location columns and `agent_checkin_prefs.enabled`. Dev-only diagnostic tables, the hosted OCR Worker, operator modules, the private release and test tooling, `docs/hindsight` and every private configuration remain excluded. The hosted memory server, container and live provider checks were not run for this source update, so it is not a live-provider or deployment-transition acceptance result.

## Saved model settings, background browser jobs and helper coordinators (2026-10-13)

This update reconciles the Worker from `f551528c4b1188db5f26c2373a53a7235812fb46`
to `3583747fc673579012edc6d20b6e8d3f911dbc96` and the web app from
`7b0706aee0ffee61c9b100397287dfe75219a89c` to
`24c621d7a8506efb2ea8ab5457b6de520a4a4fbe`.

Source correspondence:

- Worker: `f551528c4b1188db5f26c2373a53a7235812fb46` → `3583747fc673579012edc6d20b6e8d3f911dbc96`.
- Web: `7b0706aee0ffee61c9b100397287dfe75219a89c` → `24c621d7a8506efb2ea8ab5457b6de520a4a4fbe`.
- Public base: `12fc9c2028f9c3f11941e862034226f5383e2533`.

Changes:

- Every model job (chat lists, background roles, speech, search index, file pictures and decisions) now has its own saved model, reasoning level and fallback models. The managed Models page and its storage stay in `src/ee/` behind the EE switch. Without the switch, a deployment uses the same first-run settings held in memory, never reads the shared settings table, and keeps own-key accounts on their own endpoint and model.
- Migration `0050_model_job_settings.sql` adds the `model_job_settings_versions` table. It is additive, it does not change `model_settings_versions`, and only the EE settings page reads or writes it.
- `browser_task` now waits about 45 seconds. A longer job moves to the background, and one job can run per channel with an owner lease and human takeover. Starting, listing and stopping browser jobs is part of the EE tool set.
- Helpers can take a bounded part of the current request, start in their own folder and receive queued follow-up messages. A coordinator helper can start at most two worker children and returns one combined report.
- A model step that stops without a reported cost is billed at the served model's saved price and no longer at the reservation ceiling. When no saved price exists, the ceiling is used and a `price_unknown` event is recorded.
- A tool batch is stopped when one call repeats 8 or more times, when fewer than half of 12 or more calls are different, or when it holds more than 64 calls. The model gets a note that matches the reason.
- The classic lane keeps one frozen tool list per run and turns tools off with `tool_choice` set to `none`, so cached prompt prefixes stay valid. The `PAYLOAD_CUT` switch, off unless set, shortens step titles and sends non-core tools as short stubs.
- Logging out revokes every session cookie the browser sends, and a storage failure now returns an error instead of looking like a success.
- Prompt, documentation and skill wording was corrected, and a `business-setup` skill and a short cost-first rule were added.
- Notes saved from General into another channel are marked as pinned there. The contacts list is read fresh into standing context, and only a person or organization becomes a contact, so a fact about a thing stays a channel note.
- Browser job busy reservations expire by kind, and a finished job's handoff note was corrected. Spending pause preferences and the spend guard received small fixes.
- The web app folds an ignored connect or share suggestion into a "Skipped" row, removes the live browser card when nothing is running, shows message actions beside the bubble on pointer devices, and never shows a handoff card's opening text as the person's message.

Portable regression tests for these paths are part of `npm run test:runtime`,
`npm run test:core` and `npm run test:web`. They use synthetic data and offline
fixtures. Hosted deployment fixtures, release and diagnostics tooling,
operator-only modules, private configuration, host paths and the `e2e/` live
checks remain excluded. This source update is not a live-provider, container
or deployment-transition acceptance result. Native clients and installation
configuration are unchanged.

## Workflow spending-limit report follow-up

Classic workflows stopped by the hard spending limit can now show a bounded
partial report from completed, already-presented steps on the same card. The
report makes no new model or tool call, does not raise the limit, and explicitly
does not claim the entire workflow finished. Secret filtering and plain-text
quoting are applied; arbitrary output is not guaranteed safe by filtering alone.

Source correspondence:

- Worker: `9e5e39c25f68b416bb591be5a6f5d6fd04254480` → `f551528c4b1188db5f26c2373a53a7235812fb46`.
- Web: `7b0706aee0ffee61c9b100397287dfe75219a89c` (unchanged).
- Public base: `c5319972b8bde90cb935c75ab780154cfc635948`.

Portable receipt/security tests and an offline classic-workflow integration
test cover this path. Own-key and optional Cloud boundaries remain unchanged.
Hosted release-check environment helpers remain excluded. No web assets,
schema, installation configuration or native clients changed. This source
update is not a live-provider or deployment-transition acceptance result.

## Bounded tool-batch follow-up

This update rejects oversized or repetitious tool batches before executing any
operation from the rejected model step. It preserves existing retry behavior,
own-key provider choice and billing, and optional Cloud feature gates.

Source correspondence:

- Worker: `66d3e1c86cff0dc887c0865795d432cb2f1e15f8` → `9e5e39c25f68b416bb591be5a6f5d6fd04254480`.
- Web: `7b0706aee0ffee61c9b100397287dfe75219a89c` (unchanged).
- Public base: `24e500f0d538ae8df63f98bd0e35a94abdab2bdf`.

Portable tests cover fragmented arguments, distinct calls, malformed indices,
stream cancellation and whole-step rejection. Hosted deployment fixtures remain
excluded; this is not live-provider or full hosted append-runtime acceptance.
No web assets, schema, installation configuration or native clients changed.

## Memory-context follow-up

The comparison for this follow-up starts at public
`4705bbbddc423df1985bdea93cf689b466b15284`. Worker source is reconciled from
`39b8e9e4ce175f7bd0acc5025d55bfc04b96cbd7` through
`66d3e1c86cff0dc887c0865795d432cb2f1e15f8`; web source remains
`7b0706aee0ffee61c9b100397287dfe75219a89c`.

Context v2 now consistently describes personal memory as on-demand. Before
claiming a needed personal fact is absent, the helper is told to look it up in
the current turn, distinguish an unavailable lookup from an absent fact, and
reuse sufficient supplied facts without unrelated searches. General names the
actual source channel when answering from another channel's memory.

The public own-key runtime, optional-memory behavior and EE boundaries remain
unchanged. Local prompt-contract coverage is included in `npm run test:runtime`;
it does not establish live model behavior. Hosted deployment configuration and
release-only test harness changes remain excluded. No schema, web asset or
native-client update is included in this follow-up.

## Source correspondence

| Source | Previous reviewed snapshot | Reconciled snapshot |
| --- | --- | --- |
| Worker | `084d79ffa6d919a6a32942317ea5b4928030be76` | `39b8e9e4ce175f7bd0acc5025d55bfc04b96cbd7` |
| Web | `4cebd963315939f38073ba3785e1b72ffcf234ad` | `7b0706aee0ffee61c9b100397287dfe75219a89c` |

The public comparison starts at `7f548dd8e6f03dded2ec2c88e708ff2e87c24867`.
Reviewed runtime and regression-test content is recorded in
`bb73ae574a1e72d72d0f0e6f7b74e729e1050286`; this follow-up records source
correspondence only. These identifiers describe reviewed integration inputs;
they do not make excluded Cloud operational files part of this repository.

## Changes

This reviewed update adds strict structured responses for background work,
bounded schema retries, stable task transcripts and managed task model affinity.
The nine managed background roles retain their selected model and low reasoning
setting; provider failures do not silently substitute a different model.
Managed task selection remains inside the EE boundary. Public installs continue
to use their own provider credentials and the existing own-key task runtime.

Public response-size limits, owner sign-in, storage, backup and feature gates are
preserved. Cloud support diagnostics and operator release tooling are excluded;
this update adds no public support-access route or database migration. The native
clients are unchanged. The web bundle is rebuilt from the public source.

Run `npm run test:runtime` for the structured response, background policy,
transcript, and managed-task isolation regressions, alongside the checks below.
Synthetic local checks do not establish live provider, container, or device
behavior in another operator's environment.

## Previous source update: 2026-10-11

This update brings the Worker and web app forward to the October 11 Cloud
runtime snapshot. It includes channel/task access, task titles and checklists,
context handling, connection management, keyboard shortcuts, dictation, native
SSH/Tailscale transport, and the latest ambient and managed-app source.

The public single-owner sign-in, own-key model access, storage limits, bounded
request handling, backup tools, and EE licensing remain part of this edition.
New ambient, Composio-backed custom MCP, and managed-model administration code
is under `src/ee/` and disabled without the Cloud deployment switch. Merely
supplying a provider key does not enable those features.

Existing public documentation and `apps/` client source are retained. This is a
source update, not an installer release or a migration from the legacy Linux
product. Follow [upgrade instructions](upgrade.md), including the new transport
binding and D1 migrations, before deploying over the October 9 snapshot.

Local checks are `npm run test:core`, `npm run test:sync`, `npm run test:web`,
`npm run check:migrations`, and `npm run build`. The transport service has Go
tests in `native-transport/`. These checks do not replace sign-in, real provider,
container, backup/restore, and device checks in the operator's own account.

Source updates are reviewed integrations. Private Git history, infrastructure
configuration, test accounts, operations tools, and host-local instructions are
not part of the public source tree.
