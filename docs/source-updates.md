# Source update: 2026-10-18 (custom MCP server host lookup fix)

## Custom MCP servers

The Worker source is reconciled from `c2cff2694b50baf2545e988437e942eec13907e1` to `10eab62d874f1e9c990d871a17057a48e127f2f9`. Adding a custom MCP server looked up the DNS name "undefined" instead of the server's host, because `createServer` in `src/ee/custom-mcp.js` read `p.u.hostname` where the parsed address has `host`. It now checks the real host (`dnsCheck(p.u.host)`), and the test resolver in `src/ee/custom-mcp-url.js` receives the host name. `test/custom-mcp.test.mjs` has a regression case that fails when the lookup uses any other name. The web source is unchanged at `bc6ba298211dfc5d5962cd0fa74f5b25cf8abf35`.

# Source update: 2026-10-18 (memory server model endpoint, twice daily memory refresh, routed browser requests)

## Memory model jobs, routed worker browser requests and web source

The Worker source is reconciled from `701499c00179ec0feb84cd0ff3fa4021a374919c` to
`c2cff2694b50baf2545e988437e942eec13907e1`. The web source is reconciled from
`b3461c749b2e59f0f39b094c22ae495bb137dbfd` to `bc6ba298211dfc5d5962cd0fa74f5b25cf8abf35`.

A Cloud deployment can now send the Hindsight memory server's model calls through the Worker (`src/ee/hindsight-llm.js`). Each of the server's language model clients and its recall reranker uses a base URL under `/_hs/`, sends the Worker secret `HINDSIGHT_LLM_KEY` as its API key, and is mapped to a saved Models page job (`hs_retain`, `hs_consolidation`, `hs_reflect`, `hs_refresh`, `hs_rerank`). The Worker rebuilds each request from a short list of fields, so the saved model, reasoning level, fallbacks, provider sort, price limit, output limit, timeout and zero data retention routing apply, and the bank id is removed before any provider sees it. The route is Cloud code: without `ONEHELM_EE` it answers 404, and without the secret it answers 503. A self-hosted install keeps using its own Hindsight server with the model settings of that server, and nothing in the public Worker changes them. The public edition has one environment, so it has no forward to another Worker.

A routed worker can now ask the person's primary agent for a saved login or a purchase, and it pauses on a browser handoff until the person hands the browser back (`src/helpers.js`, `src/resident.js`, `src/ee/orchestrator.js`, `src/ee/route2.js`, `src/resume.js`, `src/logins.js`, `src/tracker.js`). The `helpers` table gains the column `input_kind`. The web source shows the Take control card for a paused worker, resumes the auto reload check when the app returns to the foreground, and keeps the progress row for the current turn (`web/src/`). `app-assets/app-static/app.js` and `style.css` are rebuilt from the web source.

The mental models of a Hindsight memory bank now refresh on a schedule of twice a day (`refresh_cron` `0 10,22 * * *`, template version `p10-4`) instead of after every consolidation. A bank that already exists gets the new trigger by a PATCH of each mental model before the template import, so the import queues no refresh (`syncMentalModelTriggers` in `src/hindsight.js`, called from `setupBank`, from the helper's bank setup and from the `triggers` action of `src/hindsight-health.js`). The BYOK meter charges one refresh window of 12 hours (`HS_REFRESH_WINDOW_MS` in `src/byok-meter.js`).

A Hindsight bank limit can be set with the optional variable `HS_BANK_CAP` (unset or 0 means no limit): a new bank is refused when the environment already holds that many banks (`assertBankCap` in `src/hindsight.js`). The banks of a test account (owner email at example.com) get mental models with no automatic trigger, and the refreshes an import queues for them are cancelled (`src/test-tenant.js`). The Resident writes its alarm registry row to D1 only when something changed, backs off a stuck user input recovery to once a minute per receipt, and throttles alarms armed for the present time (`src/resident.js`). A race when the interview task is created twice at the same time is fixed (`src/interview.js`).

The Models page lists the five memory jobs in a Memory group and lists the server's own embedding model read only. The public Models page keeps no Live comparison or dev to Live push.

Local checks are `npm run test:core`, `npm run test:sync`, `npm run test:runtime`, `npm run test:web`, `npm run check:migrations`, and `npm run build`. Synthetic local checks do not establish live provider or Hindsight server behavior in another operator's environment.

# Source update: 2026-10-18 (Add credits confirmation, self-hosted embedding model, review resume)

## Credits, file search embedding, helper reviews and the Models page

The Worker source is reconciled from `c2b8bce338d815958408b7386b1fa988b0ce0b64` to
`701499c00179ec0feb84cd0ff3fa4021a374919c`. The web source is reconciled from
`88cee249122764d5d78646153799b576fe7bac19` to `b3461c749b2e59f0f39b094c22ae495bb137dbfd`.

Add credits now asks before it charges. `POST /api/topup/confirm` names the saved card (brand and last four digits only) and returns a token signed for that account and amount that is valid for two minutes, and `POST /api/topup` refuses to charge without a valid token (`src/topup.js`). Both routes are Cloud routes in this edition (`src/ee/index.js`), so an install without the Cloud switch answers 404 for both, as it did for `/api/topup` before. Credits bought in the current month, and bought credits left over from earlier months, count in the monthly usage allowance, so a top-up lowers the usage bar at once (`src/ee/spendguard-ledger.js`).

The file search index can run its embedding model in the preparation container (`src/selfhost-models.js`). The model ID `@1hc/perplexity-ai/pplx-embed-v1-0.6b` names the public MIT licensed weights of pplx-embed-v1-0.6b, which the container downloads at one pinned commit and checks by SHA-256, and a third party notice for the weights, ONNX Runtime and tokenizers is added. The saved model of the job "File search index" can list it as a fallback of the Perplexity API model, and a fallback must be listed by the main model as equivalent (`embedding_equivalents`), so one index never holds vectors of two different models. A change to a model that is not equivalent rebuilds each channel's file vectors from the saved text, one file at a time, and does not charge the account. The Models page shows a "last served" row for each routing category, and its drawer shows the requested name when an answer names no model.

A background helper whose review never finishes is handed back once and then closed as failed, and a helper whose own run failed ends as failed (`src/helpers.js`, `src/resident.js`). After an object restart that is not a deploy, the resume notes say "1Helm restarted" in place of "1Helm was updated", and an open approve or message call to a helper is checked against the helper's saved row (`src/resume.js`). The web app shows the progress row only for the turn's own helper. APP_V is 276, and the generated web assets are rebuilt from the public web source.

The audio converter memory test (`test/audio-convert.test.mjs`) now waits until the external memory reading stops falling before each reading, so a busy machine no longer counts decoders that are dead but not yet released as live memory, and its limits are unchanged. Core sign-in, own-key access, EE gates, storage limits, backup, native clients, schema and the example configuration are unchanged, and no migration is added. Private deployment configuration, release scripts and release records, the dev to Live push, the dev admin script for the embedding fallback, coordinator instructions and the hosted end to end checks stay excluded. Local checks do not establish live provider, container or device behavior.

# Source update: 2026-10-18 (one Notebook, one progress row, hidden apps)

## Notebook, ambient search, progress row, hidden apps and chat limits

The Worker source is reconciled from `ecd084bb7f5b4359aef666bc7d90bdd1fd1cd607` to
`43c36a5510fb1b071e7caf0e670725333a22daa9`. The web source is reconciled from
`46fb5c0c258d7591cc08e9a8397546478b7338d3` to
`e6ad635c9573bd0dbeaa4595fe62b958ded08d12`. The public base is
`2797e73f6e1292b1e56b2604882b05df87e3dbed`.

The old Notebook screen and the old ambient search index are deleted. The flag `LEGACY_AMBIENT_SEARCH`, `src/legacy-flags.js`, `src/ee/ambient-index.js` and `src/ee/ambient-search.js` are gone, and a search by words in `ambient_query` is always a Hindsight recall over the Bee documents. The Notebook pages screen is the only Notebook. When its pages cannot be read it shows "Couldn't load the Notebook." with a Try again button. The public source keeps one safeguard: the boot answer still sets `flags.notebook_pages` to whether the Hindsight service is configured, and when it is `false` the web app says that memory is off and makes no pages request, so a deployment without Hindsight does not report a failed load. `test/notebook-pages-flag.test.mjs` covers both sides.

Each turn now shows one progress row (one orb with two lines of text) in a fixed place. The Activity button, the Activity link, the "N tasks working" pill and the live steps list are removed. Every answer from `/w/<slug>/api` carries an `x-app-v` header, and an open tab reloads itself quietly when the header shows a newer build, at a moment when nothing is typed, uploading or recording (`web/src/auto-reload.ts`). `APP_V` is 273 and `app.js` is rebuilt from public web source.

The list of hidden apps lives in `src/ee/app-visibility.json` and `src/ee/app-visibility.js`. Only Cloudflare MCP is offered for Cloudflare, and the catalog the app loads, `find_app`, the integration hint, the app tools and the Connect and app page routes apply the same rules. `app_run` sends a file's contents as an input and refuses a call that leaves out a required input. A request to put a website live on a domain puts the business-setup skill in front of the model (`src/website-live.js`), and in the public source that note is added only when the Cloud switch `ONEHELM_EE` is on, because it names the Cloudflare MCP app. The app answers a handed-off job with fixed plain sentences (`src/plain-ack.js`), and `src/stall-guard.js` stops a run that repeats nearly the same tool call with the same result.

Chat reply limits (maximum output, provider sort, price ceiling and timeout) are saved on each routing category, and the single chat job and the retry rows are gone. A saved version that still has them is converted when it is read, and the old version stays in the history. The `/api/chat` route and the quality recovery switch are removed. A Send now waits up to 8 seconds for a file's text to be prepared (20 seconds when scanned pages are being read by the OCR Worker), because a busy system can take several seconds. Core sign-in, own-key access, EE gates, storage limits, backup, native clients, schema and the example configuration are unchanged, and no migration is added. Private deployment configuration, the dev to Live push, the ops read tools, coordinator instructions and the hosted end to end checks stay excluded. Local checks do not establish live provider or device behavior.

# Source update: 2026-10-18 (Notebook pages and memory settings)

## Notebook pages screen and the memory test arm

The Worker source is reconciled from `80e50ee4516097b07e4b67c8ba89c0c25d805250` to
`ecd084bb7f5b4359aef666bc7d90bdd1fd1cd607`. The web source is reconciled from
`4203134316accb0c5e4b39afc6044186082b4c87` to
`46fb5c0c258d7591cc08e9a8397546478b7338d3`. The public base is
`07f115f4d67c68ebb2fa0b8d637a2537053b977a`.

The Notebook pages screen is now shown for every signed-in person, and when its pages cannot be read the web app shows the plain note lists. In the public source the boot answer sets `flags.notebook_pages` to whether the Hindsight service is configured (it was set only when `ENV_NAME` was `dev`), and the web app turns the pages screen off only when that flag is `false`. A deployment without Hindsight therefore keeps the plain note lists, and a deployment with Hindsight shows the pages. `test/notebook-pages-flag.test.mjs` covers both sides.

The memory test arm (`armOf` in `src/memory-use.js`) no longer checks the environment name. Only a development ops route stores a test arm, and the public source has no route that writes one, so every channel runs the default arm. The memory variables `HS_FOUNDATIONS`, `HS_WRITERS`, `HS_USE`, `HS_WALLS` and `HS_ENVELOPE` stay off unless set to `on`, and none is in the example configuration. `APP_V` is 261 and `app.js` is rebuilt from public web source.

Public sign-in, own-key access, EE gates, storage limits, backup, native clients, schema and the example configuration are unchanged. Private deployment configuration, the Live OCR Worker, the configuration parity test, coordinator instructions and the affiliate readiness tooling stay excluded. Local checks do not establish live provider or device behavior.

# Source update: 2026-10-17 (models and limits)

## Model calls, saved limits and the Models console

The Worker source is reconciled from `0b0e3a152a35fc5015b0823bda3ae9194bda44bd` to
`80e50ee4516097b07e4b67c8ba89c0c25d805250`. The web source is reconciled from
`68f6204aeec37ec717f27338151d49aab80e84e9` to
`4203134316accb0c5e4b39afc6044186082b4c87`. The public base is
`b2c81845d1ce7a4f1ed348c3c5dfa65d21fd7c7e`.

Every model call now goes through one function, `dispatch` in `src/ee/model-dispatch.js`. It reads the saved settings of a named job (for example `chat.general`, `label` or `stt`), builds a plan from them, and tries the job's models in order. The saved model, reasoning level, output limit, provider sort and price ceiling come from the job, so no code or environment variable chooses them. An OpenRouter model ID goes to OpenRouter and an ID that starts with `@cf/` goes to Workers AI. An own-key account still answers every chat call from its own endpoint. Remote answers are still read only up to a size limit.

The classic router, the router lab, the decision shadow, the test model rewrite and the memory use shadow are deleted. Migrations `0059` and `0060` drop their tables. The variables that selected them or chose models are no longer read. A deployment without `ONEHELM_EE` uses the built-in first-run settings, and the backup chat job (`workers_ai_chat`) runs on Workers AI through the same function. A new regression test covers that path.

The turn cost, step count, command time, helper, event and per job timeout limits are saved settings. Their starting values equal the earlier fixed values and stay in core (`src/limits.js`), so a deployment without `ONEHELM_EE` behaves as before. The licensed Models page is replaced by a console (`src/ee/models-console.js` and `app-assets/app-static/models-console*`). It shows every job with its model, limits and what last served it, and migration `0058` adds the table that records what served each job. The development to production push of model settings, the signed production report and the affiliate payout switch are not part of the public source.

The app now says that 1Helm keeps only the latest location and that the helper can use it, instead of describing a rough area of about 1 km.

Public sign-in, own-key access, EE gates, storage limits, backup, native clients and the example configuration are unchanged. The marketing website sources, design options, hosted checks and private operations tools remain excluded. Local checks do not establish live provider or device behavior.

# Source update: 2026-10-17

## Completed turns and activity controls

The Worker source is reconciled from `cf87089ff85438d0c22145355e666f7a37039244` to
`0b0e3a152a35fc5015b0823bda3ae9194bda44bd`. The web source is reconciled from
`4a1da4ca61790f301cb5f7a81abaa84b9445689f` to
`68f6204aeec37ec717f27338151d49aab80e84e9`. The public base is
`2f96d9d202c74e3112beccf907789d35985b398c`.

A completed reply is saved and released before optional task labels finish. Late
labels update the saved turn and its card, and their charge belongs to that turn.
A late label respects a manual task rename and cannot recreate a deleted task.

The web app puts live steps and the Activity button on one row. The current
progress note stays visible with an activity orb below it, and earlier notes
remain in the task activity. Keyboard focus, mobile control sizes and reduced
motion rules are retained.

Public sign-in, own-key access, EE gates, native clients, schema and deployment
configuration are unchanged. Hosted browser inspection scripts and the hosted
browser-agent fixture remain excluded. Portable completion and title tests
cover persistence, billing and late-label failures with controlled responses.
Local checks do not establish live provider or device behavior.

# Source update: 2026-10-16

## Routed tasks, durable questions, phone replies and preparation containers

This update reconciles the Worker from `5b746f1072614964a776621c887a464d1d6a1901`
to `cf87089ff85438d0c22145355e666f7a37039244` and the web app from
`b4ea73bddd011f8d2baea92fce93b38e32577f6c` to
`4a1da4ca61790f301cb5f7a81abaa84b9445689f`.

Source correspondence:

- Worker: `5b746f1072614964a776621c887a464d1d6a1901` → `cf87089ff85438d0c22145355e666f7a37039244`.
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
- When the platform refuses to start another channel computer because the class is at its instance limit, the start now stops after about two seconds and the reply says all computers are busy (`src/computer-capacity.js`), instead of waiting 30 seconds and reporting a vague failure.
- Product limits changed: 100 channels per workspace, 6 tasks at once in a channel (a plan may set its own `slots` in `src/plans-def.js`, which now holds the plan table that `src/index.js` used to carry), 6 running and 200 started helpers per day, 20,000 contacts, 500 pending send later messages, 50 custom MCP servers, 100 push messages per hour and 80 scanned pages read per file.
- A workflow that drops app events because of its hourly limit now sends one quiet push per workflow per hour about it.
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
- Notebook pages are written from a channel's own Hindsight mental models, with a profile photo, section editing and a facts box. The web app shows them unless the boot answer sets `flags.notebook_pages` to `false`, which the Worker does when no Hindsight service is configured (an earlier version set the flag only when `ENV_NAME` was `dev`).
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
